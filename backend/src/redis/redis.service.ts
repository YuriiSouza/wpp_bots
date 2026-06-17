import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RedisService SEM Redis — wrapper sobre Postgres com a mesma API.
 *
 * Mantém a interface antiga (get/set/del/client()) para evitar reescrever
 * centenas de callsites em app.service.ts e telegram.controller.ts.
 *
 * Estratégia por padrão de chave:
 * - `cache:*`, `driver:hasRoute:*`, `routes:available:*`,
 *   `telegram:blocklist:cache:driver:*`: bypass — get sempre null, set/del no-op.
 *   (esses eram cache puro; sem Redis, o caller cai direto no DB)
 * - `telegram:state:<chatId>`: vai pra TelegramSession.
 * - `telegram:queue:list:<group>` (LIST): TelegramKv com value=array JSON.
 * - `telegram:queue:active:<group>`: TelegramKv string com TTL.
 * - Demais chaves: TelegramKv key-value com TTL.
 *
 * Comandos de lista (lrange/lpush/rpush/lpop/lrem/ltrim/llen) são emulados em
 * cima de uma única linha TelegramKv contendo um array JSON.
 *
 * Concorrência: para operações que precisam de atomicidade real, use
 * PgLockService.withTransactionLock; este wrapper apenas serializa por
 * upsert + JSON merge, o que é OK para o uso atual do bot.
 */

type RedisLikeMultiResult = Array<[Error | null, any]>;

interface FakeMulti {
  setnx(key: string, value: string): FakeMulti;
  expire(key: string, seconds: number): FakeMulti;
  exec(): Promise<RedisLikeMultiResult | null>;
}

class FakeRedisClient {
  constructor(private readonly service: RedisService) {}

  async get(key: string): Promise<string | null> {
    const value = await this.service.getRaw(key);
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    ttlSeconds?: number,
    condition?: string,
  ): Promise<'OK' | null> {
    let ttl: number | undefined;
    if (mode === 'EX' && typeof ttlSeconds === 'number') ttl = ttlSeconds;
    const onlyIfAbsent = condition === 'NX';
    if (onlyIfAbsent) {
      const ok = await this.service.setnxRaw(key, value);
      if (!ok) return null;
      if (ttl) await this.service.expireRaw(key, ttl);
      return 'OK';
    }
    await this.service.setRaw(key, value, ttl);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      n += (await this.service.delRaw(k)) ? 1 : 0;
    }
    return n;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return (await this.service.expireRaw(key, seconds)) ? 1 : 0;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.service.listAppend(key, values, 'right');
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.service.listAppend(key, values, 'left');
  }

  async lpop(key: string): Promise<string | null> {
    return this.service.listPop(key, 'left');
  }

  async rpop(key: string): Promise<string | null> {
    return this.service.listPop(key, 'right');
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.service.listRange(key, start, stop);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.service.listRemove(key, count, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    await this.service.listTrim(key, start, stop);
    return 'OK';
  }

  async llen(key: string): Promise<number> {
    const list = await this.service.listRange(key, 0, -1);
    return list.length;
  }

  async setnx(key: string, value: string): Promise<number> {
    return (await this.service.setnxRaw(key, value)) ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    return this.service.scanKeys(pattern);
  }

  async scan(
    cursor: string,
    _matchKw: string,
    pattern: string,
    _countKw: string,
    _count: number,
  ): Promise<[string, string[]]> {
    // Sem cursor real — fazemos um único batch e fingimos cursor encerrado.
    if (cursor !== '0') return ['0', []];
    const keys = await this.service.scanKeys(pattern);
    return ['0', keys];
  }

  multi(): FakeMulti {
    const ops: Array<() => Promise<[Error | null, any]>> = [];
    const builder: FakeMulti = {
      setnx: (key: string, value: string) => {
        ops.push(async () => {
          try {
            const ok = await this.service.setnxRaw(key, value);
            return [null, ok ? 1 : 0];
          } catch (err) {
            return [err as Error, null];
          }
        });
        return builder;
      },
      expire: (key: string, seconds: number) => {
        ops.push(async () => {
          try {
            const ok = await this.service.expireRaw(key, seconds);
            return [null, ok ? 1 : 0];
          } catch (err) {
            return [err as Error, null];
          }
        });
        return builder;
      },
      exec: async () => {
        const out: RedisLikeMultiResult = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return builder;
  }
}

@Injectable()
export class RedisService {
  private readonly fakeClient: FakeRedisClient;

  constructor(private readonly prisma: PrismaService) {
    this.fakeClient = new FakeRedisClient(this);
  }

  private shouldBypassKey(key: string): boolean {
    const normalized = String(key || '').trim();
    if (!normalized) return false;
    return (
      normalized.startsWith('cache:dashboard:') ||
      normalized.startsWith('cache:drivers:') ||
      normalized.startsWith('cache:routes:') ||
      normalized.startsWith('cache:blocklist:list') ||
      normalized.startsWith('cache:overview:route-requests') ||
      normalized.startsWith('driver:hasRoute:') ||
      normalized.startsWith('routes:available:') ||
      normalized.startsWith('telegram:blocklist:cache:driver:')
    );
  }

  // ----- API pública usada pelos serviços (get/set/del JSON) -----

  async get<T>(key: string): Promise<T | null> {
    if (this.shouldBypassKey(key)) return null;
    const raw = await this.getRaw(key);
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }
    return raw as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (this.shouldBypassKey(key)) return;
    await this.setRaw(key, JSON.stringify(value), ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.shouldBypassKey(key)) return;
    await this.delRaw(key);
  }

  client(): FakeRedisClient {
    return this.fakeClient;
  }

  // ----- Backing store -----

  async getRaw(key: string): Promise<any> {
    if (this.shouldBypassKey(key)) return null;

    // telegram:state:<chatId> => TelegramSession.payload
    const stateMatch = key.match(/^telegram:state:(.+)$/);
    if (stateMatch) {
      const row = await this.prisma.telegramSession.findUnique({
        where: { chatId: stateMatch[1] },
        select: { payload: true },
      });
      return row?.payload ?? null;
    }

    const row = await this.prisma.telegramKv.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await this.prisma.telegramKv.deleteMany({ where: { key } }).catch(() => undefined);
      return null;
    }
    return row.value;
  }

  async setRaw(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (this.shouldBypassKey(key)) return;

    const stateMatch = key.match(/^telegram:state:(.+)$/);
    if (stateMatch) {
      const chatId = stateMatch[1];
      const payload = typeof value === 'string' ? safeParseJson(value) : value;
      await this.prisma.telegramSession.upsert({
        where: { chatId },
        create: { chatId, payload },
        update: { payload },
      });
      return;
    }

    const expiresAt =
      ttlSeconds && ttlSeconds > 0
        ? new Date(Date.now() + ttlSeconds * 1000)
        : null;
    const parsedValue = typeof value === 'string' ? safeParseJson(value) : value;
    await this.prisma.telegramKv.upsert({
      where: { key },
      create: { key, value: parsedValue, expiresAt },
      update: { value: parsedValue, expiresAt },
    });
  }

  async delRaw(key: string): Promise<boolean> {
    if (this.shouldBypassKey(key)) return false;

    const stateMatch = key.match(/^telegram:state:(.+)$/);
    if (stateMatch) {
      const r = await this.prisma.telegramSession.deleteMany({ where: { chatId: stateMatch[1] } });
      return r.count > 0;
    }

    const r = await this.prisma.telegramKv.deleteMany({ where: { key } });
    return r.count > 0;
  }

  async expireRaw(key: string, seconds: number): Promise<boolean> {
    if (this.shouldBypassKey(key)) return false;
    const expiresAt = new Date(Date.now() + seconds * 1000);
    const r = await this.prisma.telegramKv.updateMany({
      where: { key },
      data: { expiresAt },
    });
    return r.count > 0;
  }

  async setnxRaw(key: string, value: any): Promise<boolean> {
    if (this.shouldBypassKey(key)) return false;
    const parsedValue = typeof value === 'string' ? safeParseJson(value) : value;

    // 1) tenta INSERT direto
    try {
      await this.prisma.telegramKv.create({
        data: { key, value: parsedValue },
      });
      return true;
    } catch {
      // conflito de PK — pode ser linha viva ou expirada
    }

    // 2) linha existe — só "rouba" se estiver expirada
    const existing = await this.prisma.telegramKv.findUnique({
      where: { key },
      select: { expiresAt: true },
    });

    if (!existing) {
      // foi apagada nesse meio tempo — tenta inserir de novo
      try {
        await this.prisma.telegramKv.create({
          data: { key, value: parsedValue },
        });
        return true;
      } catch {
        return false;
      }
    }

    const isExpired =
      existing.expiresAt !== null &&
      existing.expiresAt.getTime() < Date.now();

    if (!isExpired) return false;

    // 3) linha expirada — sobreescreve atomicamente (updateMany filtrando por expirado)
    const updated = await this.prisma.telegramKv.updateMany({
      where: {
        key,
        expiresAt: { lt: new Date() },
      },
      data: { value: parsedValue, expiresAt: null },
    });
    return updated.count > 0;
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*+$/, '');
    const rows = await this.prisma.telegramKv.findMany({
      where: { key: { startsWith: prefix } },
      select: { key: true },
      take: 5000,
    });
    return rows.map((r) => r.key);
  }

  // ----- List ops -----
  // Cada mutação de LIST roda dentro de uma transação com pg_advisory_xact_lock
  // por chave, garantindo serialização entre processos/conexões concorrentes.

  private listLockKey(key: string): bigint {
    // Hash determinístico (variante de djb2) → BIGINT do Postgres.
    let h = 5381n;
    const mask = (1n << 63n) - 1n;
    for (let i = 0; i < key.length; i += 1) {
      h = ((h << 5n) + h + BigInt(key.charCodeAt(i))) & mask;
    }
    // Mapeia para int64 signed (centra em torno de zero pra não estourar)
    return h - (1n << 62n);
  }

  private async withListLock<T>(
    key: string,
    fn: (tx: any) => Promise<T>,
  ): Promise<T> {
    const lockId = this.listLockKey(key);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
      return fn(tx);
    });
  }

  private async readListInTx(tx: any, key: string): Promise<string[]> {
    if (this.shouldBypassKey(key)) return [];
    const row = await tx.telegramKv.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    });
    if (!row) return [];
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await tx.telegramKv.deleteMany({ where: { key } }).catch(() => undefined);
      return [];
    }
    if (Array.isArray(row.value)) return (row.value as any[]).map((v) => String(v));
    return [];
  }

  private async writeListInTx(tx: any, key: string, list: string[]): Promise<void> {
    if (this.shouldBypassKey(key)) return;
    if (list.length === 0) {
      await tx.telegramKv.deleteMany({ where: { key } });
      return;
    }
    await tx.telegramKv.upsert({
      where: { key },
      create: { key, value: list as any, expiresAt: null },
      update: { value: list as any, expiresAt: null },
    });
  }

  // Versão não-transacional usada SOMENTE por leitura (lrange/llen) — sem mutação,
  // não precisa de lock; uma leitura "suja" ainda é OK pro caller que só está exibindo.
  private async getList(key: string): Promise<string[]> {
    const value = await this.getRaw(key);
    if (Array.isArray(value)) return value.map((v) => String(v));
    return [];
  }

  async listAppend(
    key: string,
    values: string[],
    side: 'left' | 'right',
  ): Promise<number> {
    return this.withListLock(key, async (tx) => {
      const list = await this.readListInTx(tx, key);
      if (side === 'right') list.push(...values);
      else list.unshift(...values);
      await this.writeListInTx(tx, key, list);
      return list.length;
    });
  }

  async listPop(key: string, side: 'left' | 'right'): Promise<string | null> {
    return this.withListLock(key, async (tx) => {
      const list = await this.readListInTx(tx, key);
      if (!list.length) return null;
      const popped = side === 'left' ? list.shift()! : list.pop()!;
      await this.writeListInTx(tx, key, list);
      return popped;
    });
  }

  async listRange(key: string, start: number, stop: number): Promise<string[]> {
    const list = await this.getList(key);
    const length = list.length;
    const normalizedStart = start < 0 ? Math.max(0, length + start) : start;
    const normalizedStop =
      stop < 0 ? length + stop : Math.min(length - 1, stop);
    if (normalizedStop < normalizedStart) return [];
    return list.slice(normalizedStart, normalizedStop + 1);
  }

  async listRemove(key: string, count: number, value: string): Promise<number> {
    return this.withListLock(key, async (tx) => {
      const list = await this.readListInTx(tx, key);
      let removed = 0;
      if (count === 0) {
        const filtered = list.filter((v) => v !== value);
        removed = list.length - filtered.length;
        await this.writeListInTx(tx, key, filtered);
        return removed;
      }
      const forward = count > 0;
      const max = Math.abs(count);
      const next: string[] = [];
      if (forward) {
        for (const v of list) {
          if (removed < max && v === value) {
            removed += 1;
            continue;
          }
          next.push(v);
        }
      } else {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const v = list[i];
          if (removed < max && v === value) {
            removed += 1;
            continue;
          }
          next.unshift(v);
        }
      }
      await this.writeListInTx(tx, key, next);
      return removed;
    });
  }

  async listTrim(key: string, start: number, stop: number): Promise<void> {
    await this.withListLock(key, async (tx) => {
      const list = await this.readListInTx(tx, key);
      const length = list.length;
      const normalizedStart = start < 0 ? Math.max(0, length + start) : start;
      const normalizedStop =
        stop < 0 ? length + stop : Math.min(length - 1, stop);
      const next =
        normalizedStop < normalizedStart
          ? []
          : list.slice(normalizedStart, normalizedStop + 1);
      await this.writeListInTx(tx, key, next);
    });
  }
}

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
