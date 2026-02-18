import { Body, Controller, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { RedisService } from '../redis/redis.service';
import { sortRoutes } from '../utils/sort-routes';
import { DriverSession, DriverState } from './telegram.state';
import { DriverService } from '../data/driver.service';
import { RouteService } from '../data/route.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { SyncService } from '../sync/sync.service';
import { SheetsService } from '../sheets/sheets.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  NO_ROUTES_AVAILABLE,
} from './telegram.messages';

@Controller('telegram/webhook')
export class TelegramController implements OnModuleInit, OnModuleDestroy {
  // Sessão do motorista
  private readonly STATE_TTL = 10800; // 30 min

  // Controle de fila
  private readonly QUEUE_TTL = 30; // 30s
  private readonly QUEUE_LIST_KEY_GENERAL = 'telegram:queue:list:general';
  private readonly QUEUE_ACTIVE_KEY_GENERAL = 'telegram:queue:active:general';
  private readonly QUEUE_ACTIVE_META_KEY_GENERAL =
    'telegram:queue:active:meta:general';
  private readonly QUEUE_LIST_KEY_MOTO = 'telegram:queue:list:moto';
  private readonly QUEUE_ACTIVE_KEY_MOTO = 'telegram:queue:active:moto';
  private readonly QUEUE_ACTIVE_META_KEY_MOTO =
    'telegram:queue:active:meta:moto';
  private readonly ROUTE_TIMEOUT_PREFIX = 'telegram:route:timeout';
  private readonly ROUTE_TIMEOUT_LOCK_KEY = 'telegram:route:timeout:lock';
  private readonly LOG_PREFIX = 'telegram:log';
  private readonly ROUTES_NOTE_KEY = 'telegram:routes:note';
  private readonly BLOCKLIST_CACHE_PREFIX = 'telegram:blocklist:cache:driver';
  private readonly BLOCKLIST_WAIT_SECONDS = 120;

  private timeoutWatcher?: NodeJS.Timeout;

  constructor(
    private readonly telegram: TelegramService,
    private readonly drivers: DriverService,
    private readonly routes: RouteService,
    private readonly redis: RedisService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
    private readonly prisma: PrismaService,
  ) {}

  /* =======================
      Helpers Redis
  ======================== */

  private stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  private async getState(chatId: string): Promise<DriverSession | null> {
    return this.redis.get<DriverSession>(this.stateKey(chatId));
  }

  private async setState(chatId: string, state: DriverSession) {
    await this.redis.set(this.stateKey(chatId), state, this.STATE_TTL);
  }

  private async clearState(chatId: string) {
    await this.redis.del(this.stateKey(chatId));
  }

  private queueMarker(chatId: string) {
    return `telegram:queue:member:${chatId}`;
  }

  private isFiorino(vehicleType?: string) {
    const type = (vehicleType || '').toLowerCase();
    return type.includes('fiorino');
  }

  private isMoto(vehicleType?: string) {
    return normalizeVehicleType(vehicleType) === 'MOTO';
  }

  private queueGroupFromVehicle(vehicleType?: string) {
    return this.isMoto(vehicleType) ? 'moto' : 'general';
  }

  private queueListKey(group: 'moto' | 'general') {
    return group === 'moto' ? this.QUEUE_LIST_KEY_MOTO : this.QUEUE_LIST_KEY_GENERAL;
  }

  private queueActiveKey(group: 'moto' | 'general') {
    return group === 'moto' ? this.QUEUE_ACTIVE_KEY_MOTO : this.QUEUE_ACTIVE_KEY_GENERAL;
  }

  private queueActiveMetaKey(group: 'moto' | 'general') {
    return group === 'moto'
      ? this.QUEUE_ACTIVE_META_KEY_MOTO
      : this.QUEUE_ACTIVE_META_KEY_GENERAL;
  }

  private routeTimeoutKey(chatId: string) {
    return `${this.ROUTE_TIMEOUT_PREFIX}:${chatId}`;
  }

  private logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  onModuleInit() {
    this.timeoutWatcher = setInterval(() => {
      void this.requeueExpiredActive('general');
      void this.requeueExpiredActive('moto');
      void this.tryActivateWaitingQueue('general');
      void this.tryActivateWaitingQueue('moto');
    }, 5000);
  }

  onModuleDestroy() {
    if (this.timeoutWatcher) clearInterval(this.timeoutWatcher);
  }

  /* =======================
      FILA
  ======================== */

  private queueEmptySinceKey(group: 'moto' | 'general') {
    return `telegram:queue:empty_since:${group}`;
  }

  private async isChatBlocklisted(chatId: string): Promise<boolean> {
    const state = await this.getState(chatId);
    const driverId = state?.driverId;
    if (!driverId) return false;
    const cacheKey = `${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`;
    const cached = await this.redis.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    const row = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });
    const isActive = row?.status === 'ACTIVE';
    await this.redis.set(cacheKey, isActive, 3600);
    return isActive;
  }

  private parsePriorityScore(value: unknown): number {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
  }

  private async resolveChatPriorityScore(
    chatId: string,
    state?: DriverSession | null,
  ): Promise<number> {
    const current = state ?? (await this.getState(chatId));
    if (typeof current?.priorityScore === 'number') {
      return this.parsePriorityScore(current.priorityScore);
    }
    if (!current?.driverId) return 0;

    const driver = await this.drivers.findById(current.driverId);
    return this.parsePriorityScore(driver?.priorityScore);
  }

  private async logEvent(
    action: string,
    state?: DriverSession | null,
    details?: Record<string, string | number | undefined>,
  ) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const parts = [`[${time}]`, `acao=${action}`];

    if (state?.driverId) parts.push(`driverId=${state.driverId}`);
    if (state?.driverName) parts.push(`nome=${state.driverName}`);
    if (state?.vehicleType) parts.push(`veiculo=${state.vehicleType}`);

    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          parts.push(`${key}=${value}`);
        }
      });
    }

    const line = parts.join(' ');
    const key = this.logKey(now);
    const client = this.redis.client();
    await client.rpush(key, line);
    await client.ltrim(key, -500, -1);
  }

  private async driverAlreadyAssigned(driverId: string): Promise<boolean> {
    const hasSheet = await this.sheets.driverAlreadyHasRoute(driverId);
    if (hasSheet) return true;
    return this.routes.driverHasRoute(driverId);
  }

  private async pickNextFromQueue(group: 'moto' | 'general'): Promise<string | null> {
    const client = this.redis.client();
    const queue = await client.lrange(this.queueListKey(group), 0, -1);
    const emptySinceKey = this.queueEmptySinceKey(group);
    if (!queue.length) {
      await client.del(emptySinceKey);
      return null;
    }

    const queueMeta = await Promise.all(
      queue.map(async (chatId, index) => {
        const state = await this.getState(chatId);
        return {
          chatId,
          index,
          score: await this.resolveChatPriorityScore(chatId, state),
          isFiorino: this.isFiorino(state?.vehicleType),
          blocklisted: await this.isChatBlocklisted(chatId),
        };
      }),
    );

    const regularMeta = queueMeta
      .filter((item) => !item.blocklisted)
      .sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
    const regularNext = regularMeta[0];
    if (regularNext) {
      await client.del(emptySinceKey);
      await client.lrem(this.queueListKey(group), 1, regularNext.chatId);
      await client.del(this.queueMarker(regularNext.chatId));
      return regularNext.chatId;
    }

    const blocklistedMeta = queueMeta
      .filter((item) => item.blocklisted)
      .sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
    const firstBlocklisted = blocklistedMeta[0];
    const emptySinceRaw = await client.get(emptySinceKey);
    const now = Date.now();
    if (!emptySinceRaw) {
      await client.set(emptySinceKey, String(now), 'EX', this.BLOCKLIST_WAIT_SECONDS * 6);
      return null;
    }

    const elapsed = now - Number(emptySinceRaw);
    if (Number.isNaN(elapsed) || elapsed < this.BLOCKLIST_WAIT_SECONDS * 1000) {
      return null;
    }

    await client.del(emptySinceKey);
    const next = firstBlocklisted.chatId;
    await client.lrem(this.queueListKey(group), 1, next);
    await client.del(this.queueMarker(next));
    return next;
  }

  private queueLockKey(group: 'moto' | 'general') {
    return `telegram:queue:lock:${group}`;
  }

  private async withQueueLock<T>(
    group: 'moto' | 'general',
    fn: () => Promise<T>,
  ): Promise<T> {
    const client = this.redis.client();
    const lockKey = this.queueLockKey(group);
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const locked = await client.setnx(lockKey, '1');
      if (locked === 1) {
        await client.expire(lockKey, 5);
        try {
          return await fn();
        } finally {
          await client.del(lockKey);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return fn();
  }

  private async activateNextInQueue(
    group: 'moto' | 'general',
  ): Promise<string | null> {
    return this.withQueueLock(group, async () => {
      const client = this.redis.client();
      const next = await this.pickNextFromQueue(group);
      if (!next) return null;

      await client.set(
        this.queueActiveKey(group),
        next,
        'EX',
        this.QUEUE_TTL,
      );
      await client.set(
        this.queueActiveMetaKey(group),
        JSON.stringify({
          chatId: next,
          startedAt: Date.now(),
        }),
        'EX',
        this.QUEUE_TTL * 2,
      );
      return next;
    });
  }

  private async clearRouteTimeout(chatId: string) {
    await this.redis.client().del(this.routeTimeoutKey(chatId));
  }

  private async refreshActiveMeta(
    chatId: string,
    group: 'moto' | 'general',
  ) {
    const client = this.redis.client();
    await client.set(
      this.queueActiveMetaKey(group),
      JSON.stringify({
        chatId,
        startedAt: Date.now(),
      }),
      'EX',
      this.QUEUE_TTL * 2,
    );
    await client.expire(this.queueActiveKey(group), this.QUEUE_TTL);
  }

  private async setRouteTimeout(
    chatId: string,
    vehicleType: string | undefined,
    group: 'moto' | 'general',
  ) {
    const client = this.redis.client();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await client.set(this.routeTimeoutKey(chatId), token, 'EX', this.QUEUE_TTL);

    setTimeout(() => {
      void (async () => {
        const current = await client.get(this.routeTimeoutKey(chatId));
        if (current !== token) return;

        const active = await client.get(this.queueActiveKey(group));
        if (active !== chatId) {
          await client.del(this.routeTimeoutKey(chatId));
          return;
        }

        const state = await this.getState(chatId);
        if (!state || state.state !== DriverState.CHOOSING_ROUTE) {
          await client.del(this.routeTimeoutKey(chatId));
          return;
        }

        await client.del(this.routeTimeoutKey(chatId));
        await this.handleTimeout(chatId, state.vehicleType, group);
      })();
    }, this.QUEUE_TTL * 1000);
  }

  private async handleTimeout(
    chatId: string,
    vehicleType: string | undefined,
    group: 'moto' | 'general',
  ) {
    await this.releaseAndNotifyNext(group);
    const state = await this.getState(chatId);
    await this.clearState(chatId);
    await this.telegram.sendMessage(
      Number(chatId),
      'Atendimento encerrado automaticamente por falta de resposta.',
    );
    await this.logEvent('timeout_encerrado', state, {
      motivo: 'falta_resposta',
      veiculo: vehicleType,
    });
  }

  private async requeueExpiredActive(
    group: 'moto' | 'general',
  ): Promise<boolean> {
    const client = this.redis.client();
    const lockKey = `${this.ROUTE_TIMEOUT_LOCK_KEY}:${group}`;
    const locked = await client.setnx(lockKey, '1');
    if (locked !== 1) return false;
    await client.expire(lockKey, 5);

    const metaRaw = await client.get(this.queueActiveMetaKey(group));
    if (!metaRaw) {
      await client.del(lockKey);
      return false;
    }

    const meta = JSON.parse(metaRaw) as {
      chatId: string;
      startedAt: number;
    };

    if (Date.now() - meta.startedAt < this.QUEUE_TTL * 1000) {
      await client.del(lockKey);
      return false;
    }

    await client.del(this.queueActiveMetaKey(group));
    await client.del(this.queueActiveKey(group));
    await this.clearRouteTimeout(meta.chatId);
    await client.del(lockKey);

    await this.handleTimeout(meta.chatId, undefined, group);
    return true;
  }

  private async notifyQueueNext(next: string, group: 'moto' | 'general') {
    const state = await this.getState(next);
    if (!state?.vehicleType) {
      await this.clearState(next);
      await this.releaseAndNotifyNext(group);
      return;
    }

    await this.telegram.sendMessage(
      Number(next),
      'Sua vez chegou. Buscando rotas disponíveis...',
    );
    await this.sendRoutes(next, state);
  }

  private async tryActivateWaitingQueue(group: 'moto' | 'general') {
    const active = await this.redis.client().get(this.queueActiveKey(group));
    if (active) return;

    const next = await this.activateNextInQueue(group);
    if (!next) return;
    await this.notifyQueueNext(next, group);
  }

  private async tryAcquireQueue(
    chatId: string,
    group: 'moto' | 'general',
  ): Promise<boolean> {
    const client = this.redis.client();
    const active = await client.get(this.queueActiveKey(group));
    if (active) {
      const expired = await this.requeueExpiredActive(group);
      if (!expired) return active === chatId;
    }

    const next = await this.activateNextInQueue(group);
    if (!next) return false;
    if (next !== chatId) {
      await this.notifyQueueNext(next, group);
      return false;
    }
    return true;
  }

  private async enqueue(
    chatId: string,
    vehicleType?: string,
    group: 'moto' | 'general' = 'general',
  ): Promise<number> {
    return this.withQueueLock(group, async () => {
      const client = this.redis.client();
      const marker = this.queueMarker(chatId);

      await client.expire(marker, this.QUEUE_TTL);

      const queue = await client.lrange(this.queueListKey(group), 0, -1);
      const isFiorino = this.isFiorino(vehicleType);
      const filtered = queue.filter((id) => id !== chatId);
      const rankedQueue = await Promise.all(
        filtered.map(async (id, index) => {
          const itemState = await this.getState(id);
          const score = await this.resolveChatPriorityScore(id, itemState);
          return {
            id,
            index,
            isFiorino: this.isFiorino(itemState?.vehicleType),
            score,
          };
        }),
      );

      const currentState = await this.getState(chatId);
      rankedQueue.push({
        id: chatId,
        index: Number.MAX_SAFE_INTEGER,
        isFiorino,
        score: await this.resolveChatPriorityScore(chatId, currentState),
      });

      rankedQueue.sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
      const nextQueue = rankedQueue.map((item) => item.id);

      await client.del(this.queueListKey(group));
      if (nextQueue.length)
        await client.rpush(this.queueListKey(group), ...nextQueue);
      await client.set(marker, '1', 'EX', this.QUEUE_TTL);

      const isBlocklisted = await this.isChatBlocklisted(chatId);
      if (!isBlocklisted) {
        await client.del(this.queueEmptySinceKey(group));
      }

      return nextQueue.indexOf(chatId) + 1;
    });
  }

  private async removeFromQueue(chatId: string, group: 'moto' | 'general') {
    const client = this.redis.client();
    await client.lrem(this.queueListKey(group), 0, chatId);
    await client.del(this.queueMarker(chatId));
  }

  private async releaseAndNotifyNext(group: 'moto' | 'general') {
    await this.withQueueLock(group, async () => {
      const client = this.redis.client();

      await client.del(this.queueActiveKey(group));
      await client.del(this.queueActiveMetaKey(group));

      const next = await this.pickNextFromQueue(group);
      if (!next) return;

      await client.set(
        this.queueActiveKey(group),
        next,
        'EX',
        this.QUEUE_TTL,
      );

      await this.notifyQueueNext(next, group);
    });
  }

  /* =======================
      MENUS
  ======================== */

  private async sendMainMenu(chatId: number) {
    await this.telegram.sendMessage(
      chatId,
      `Menu principal:
encerrar - Encerrar atendimento
1 - Ver rotas disponíveis
2 - Dúvidas frequentes`,
    );
  }

  private normalizeCommand(text: string) {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .split(/\s+/)[0];
  }

  private nextFaqOption(current: number) {
    const next = current + 1;
    return next === 9 ? 10 : next;
  }

  private async getDynamicHelp() {
    const items = await this.prisma.faqItem.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 50,
    });

    if (!items.length) {
      const menu = `Dúvidas frequentes:
encerrar - Encerrar atendimento
voltar - Voltar

No momento, não há dúvidas cadastradas.
Peça ao analista para cadastrar em /acess/duvidas.
`;
      return { menu, answers: {} as Record<string, string> };
    }

    let option = 0;
    const answers: Record<string, string> = {};
    const lines = ['Dúvidas frequentes:', 'encerrar - Encerrar atendimento'];

    for (const item of items) {
      option = this.nextFaqOption(option);
      const key = String(option);
      lines.push(`${key} - ${item.title}`);
      answers[key] = item.answer;
    }

    lines.push('voltar - Voltar');
    return { menu: `${lines.join('\n')}\n`, answers };
  }

  /* =======================
      ROTAS
  ======================== */

  private async sendRoutes(chatId: string, state: DriverSession) {
    if (!state.driverId || !state.vehicleType) {
      await this.telegram.sendMessage(
        Number(chatId),
        'Sessão expirada. Informe seu ID novamente.',
      );
      await this.clearState(chatId);
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const routes = await this.routes.getAvailableRoutesForDriver(state.vehicleType);
    const sorted = sortRoutes(routes);

    if (!sorted.length) {
      await this.telegram.sendMessage(Number(chatId), NO_ROUTES_AVAILABLE);
      await this.sendMainMenu(Number(chatId));
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const moto = sortRoutes(
      sorted.filter((r) =>
        (r.vehicleType || '').toLowerCase().includes('moto'),
      ),
    );
    const nonMoto = sortRoutes(
      sorted.filter(
        (r) => !(r.vehicleType || '').toLowerCase().includes('moto'),
      ),
    );

    const ordered = [...nonMoto, ...moto];

    await this.setState(chatId, {
      ...state,
      state: DriverState.CHOOSING_ROUTE,
      availableRoutes: ordered,
      inQueue: false,
    });

    const normalizeCity = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const incentiveCities = new Set(['vianopolis', 'abadiania']);
    const routesNote = (await this.redis.get<string>(this.ROUTES_NOTE_KEY)) || '';

    let msg = `Olá, ${state.driverName} 👋
Escolha a rota desejada digitando o número:
Veículo: ${state.vehicleType}
DS: ${state.ds || '-'} (DS = taxa de pacotes entregues)
Para encerrar, digite: encerrar
`;
    if (routesNote.trim()) {
      msg += `\n📢 Informações do dia:\n${routesNote.trim()}\n`;
    }

    const pushCityGroups = (title: string, list: typeof ordered) => {
      if (!list.length) return;
      msg += `\n━━━━━━━━━━━━━━\n${title} (${list.length})\n━━━━━━━━━━━━━━\n`;

      const byCity = new Map<string, typeof ordered>();
      list.forEach((route) => {
        const city = (route.cidade || 'Sem cidade').trim() || 'Sem cidade';
        const current = byCity.get(city) || [];
        current.push(route);
        byCity.set(city, current);
      });

      const cityNames = Array.from(byCity.keys()).sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      );

      cityNames.forEach((city) => {
        const hasIncentive = incentiveCities.has(normalizeCity(city));
        msg += `\n📍 ${city}${hasIncentive ? ' | +R$45 incentivo' : ''}\n`;
        const cityRoutes = byCity.get(city) || [];
        cityRoutes.forEach((r) => {
          const index = ordered.indexOf(r);
          msg += `${index + 1}. ${r.bairro || 'Sem bairro'}\n`;
        });
      });
    };

    pushCityGroups('Outras rotas', nonMoto);
    pushCityGroups('Rotas de moto', moto);

    await this.telegram.sendMessage(Number(chatId), msg);
    const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
    await this.refreshActiveMeta(chatId, group);
    await this.setRouteTimeout(chatId, state.vehicleType, group);
  }

  /* =======================
      WEBHOOK
  ======================== */

  @Post()
  async onUpdate(@Body() body: any) {
    const message = body.message;
    if (!message?.text) return { ok: true };

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const command = this.normalizeCommand(text);

    if (text === '/sync' || text === '/atualizar_dados') {
      if (await this.sync.isLocked()) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atualização em andamento. Aguarde alguns minutos.',
        );
        return { ok: true };
      }
      await this.sync.setPending(chatId, 'all');
      await this.telegram.sendMessage(
        Number(chatId),
        'Informe a senha para sincronizar.',
      );
      return { ok: true };
    }

    if (text === '/syncDriver' || text === '/syncdriver') {
      if (await this.sync.isLocked()) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atualização em andamento. Aguarde alguns minutos.',
        );
        return { ok: true };
      }
      await this.sync.setPending(chatId, 'drivers');
      await this.telegram.sendMessage(
        Number(chatId),
        'Informe a senha para sincronizar.',
      );
      return { ok: true };
    }

    const pendingType = await this.sync.getPendingType(chatId);
    if (pendingType) {
      if (!this.sync.isPasswordValid(text)) {
        await this.sync.clearPending(chatId);
        await this.telegram.sendMessage(Number(chatId), 'Senha inválida.');
        return { ok: true };
      }

      await this.sync.clearPending(chatId);
      // await this.telegram.sendMessage(
      //   Number(chatId),
      //   'Atualização em andamento. Aguarde alguns minutos.',
      // );

      try {
        if (pendingType === 'drivers') {
          const drivers = await this.sync.syncDriversScheduled();
          await this.telegram.sendMessage(
            Number(chatId),
            `✅ Motoristas atualizados com sucesso.\nMotoristas: ${drivers}`,
          );
        } else {
          const summary = await this.sync.syncAll();
          await this.telegram.sendMessage(
            Number(chatId),
            `✅ Dados atualizados com sucesso.\nMotoristas: ${summary.drivers}\nRotas disponíveis: ${summary.routesAvailable}\nRotas atribuídas: ${summary.routesAssigned}`,
          );
        }
      } catch (error) {
        await this.telegram.sendMessage(
          Number(chatId),
          `Erro ao sincronizar: ${(error as Error).message}`,
        );
      }
      return { ok: true };
    }

    if (await this.sync.isLocked()) {
      await this.telegram.sendMessage(
        Number(chatId),
        'Atualização em andamento. Aguarde alguns minutos.',
      );
      return { ok: true };
    }

    if (text.startsWith('/logdiario')) {
      const key = this.logKey();
      const logs = await this.redis.client().lrange(key, 0, -1);
      if (!logs.length) {
        await this.telegram.sendMessage(Number(chatId), 'Sem logs para hoje.');
        return { ok: true };
      }

      let chunk = '';
      for (const line of logs) {
        if (chunk.length + line.length + 1 > 3500) {
          await this.telegram.sendMessage(Number(chatId), chunk);
          chunk = '';
        }
        chunk += `${line}\n`;
      }
      if (chunk.trim().length) {
        await this.telegram.sendMessage(Number(chatId), chunk.trim());
      }
      return { ok: true };
    }

    let state = await this.getState(chatId);
    if (command === 'encerrar' && state?.inQueue) {
      const group = state.queueGroup || 'general';
      await this.removeFromQueue(chatId, group);
      await this.clearState(chatId);
      await this.telegram.sendMessage(
        Number(chatId),
        'Atendimento encerrado.',
      );
      return { ok: true };
    }
    if (state?.inQueue) {
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (canStart) {
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        'Você está na fila. Aguarde atendimento.',
      );
      return { ok: true };
    }

    /* ===== INÍCIO ===== */
    if (!state) {
      await this.setState(chatId, { state: DriverState.WAITING_ID });
      await this.telegram.sendMessage(
        Number(chatId),
        'Olá 👋\nInforme seu ID de motorista.',
      );
      return { ok: true };
    }

    /* ===== ESPERANDO ID ===== */
    if (state.state === DriverState.WAITING_ID) {
      const driverId = text.trim();
      if (!/^\d+$/.test(driverId)) {
        await this.telegram.sendMessage(Number(chatId), 'ID inválido.');
        return { ok: true };
      }

      const driver = await this.drivers.findById(driverId);
      if (!driver) {
        await this.telegram.sendMessage(Number(chatId), 'ID não encontrado.');
        return { ok: true };
      }

      await this.setState(chatId, {
        state: DriverState.MENU,
        driverId: driver.id,
        driverName: driver.name || '',
        vehicleType: driver.vehicleType || '',
        ds: driver.ds || '',
        priorityScore: this.parsePriorityScore(driver.priorityScore),
        queueGroup: this.queueGroupFromVehicle(driver.vehicleType || undefined),
      });

      await this.telegram.sendMessage(
        Number(chatId),
        `Olá, ${driver.name || 'motorista'}!`,
      );
      await this.sendMainMenu(Number(chatId));
      return { ok: true };
    }

    /* ===== MENU ===== */
    if (state.state === DriverState.MENU) {
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (text === '2') {
        await this.setState(chatId, { ...state, state: DriverState.HELP_MENU });
        const help = await this.getDynamicHelp();
        await this.telegram.sendMessage(Number(chatId), help.menu);
        return { ok: true };
      }

      if (text !== '1') {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      await this.logEvent('solicitou_rotas', state, { chatId });

      const hasRoute = await this.driverAlreadyAssigned(state.driverId!);
      if (hasRoute) {
        await this.telegram.sendMessage(
          Number(chatId),
          `Você já possui rota solicitada. O bot não realiza trocas.
        Atendimento encerrado.
          `,
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (!canStart) {
        await this.setState(chatId, {
          ...state,
          inQueue: true,
          queueGroup: group,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          'Você está na fila. Aguarde atendimento.',
        );
        return { ok: true };
      }

      await this.sendRoutes(chatId, state);
      return { ok: true };
    }

    /* ===== ESCOLHA DE ROTA ===== */
    if (state.state === DriverState.CHOOSING_ROUTE) {
      await this.clearRouteTimeout(chatId);
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
        await this.releaseAndNotifyNext(group);
        return { ok: true };
      }

      const choice = Number(text) - 1;
      const routes = state.availableRoutes || [];

      if (isNaN(choice) || !routes[choice]) {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      const route = routes[choice];
      const alreadyAssigned = await this.driverAlreadyAssigned(state.driverId!);
      if (alreadyAssigned) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Você já possui rota solicitada. O bot não realiza trocas.',
        );
        await this.setState(chatId, { ...state, state: DriverState.MENU });
        const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
        await this.releaseAndNotifyNext(group);
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const ok = await this.routes.assignRoute(route.atId, state.driverId!);

      if (!ok) {
        await this.telegram.sendMessage(Number(chatId), 'Rota indisponível.');
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `✅ Rota ${route.gaiola || route.atId} solicitada com sucesso.

Sua solicitação foi enviada para validação do analista.

Como pegar a rota:
1. Aguarde a confirmação do analista.
2. Após confirmar, siga o dia/horário de carregamento informado.
3. Em caso de dúvida, responda esta conversa para suporte.`,
      );
      await this.logEvent('rota_solicitada', state, { rota: route.atId });

      try {
        await this.sheets.updateRouteDriverId(route.atId, state.driverId!);
      } catch (error) {
        await this.logEvent('sheet_update_failed', state, {
          rota: route.atId,
        });
      }

      await this.clearState(chatId);
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      await this.telegram.sendMessage(
        Number(chatId),
        'Atendimento encerrado automaticamente após a solicitação da rota.',
      );
      return { ok: true };
    }

    /* ===== AJUDA ===== */
    if (state.state === DriverState.HELP_MENU) {
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (command === 'voltar') {
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          inQueue: false,
        });
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const help = await this.getDynamicHelp();
      const answer = help.answers[text];
      if (!answer) {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.telegram.sendMessage(Number(chatId), help.menu);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `${answer}\n\n${help.menu}`,
      );
      return { ok: true };
    }

    return { ok: true };
  }
}
