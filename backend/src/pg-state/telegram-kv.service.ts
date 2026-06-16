import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Substitui chaves Redis pontuais com TTL (route timeout, wait notice, pending sync, etc).
 * É um KV genérico com expiração lógica (não há job de limpeza — leitura ignora expirados).
 *
 * Para limpeza periódica, chamar `purgeExpired()` em algum cron.
 */
@Injectable()
export class TelegramKvService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T = any>(key: string): Promise<T | null> {
    const row = await this.prisma.telegramKv.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      // expirado — apaga sob demanda
      await this.prisma.telegramKv.deleteMany({ where: { key } }).catch(() => undefined);
      return null;
    }
    return (row.value as T) ?? null;
  }

  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds && ttlSeconds > 0
        ? new Date(Date.now() + ttlSeconds * 1000)
        : null;
    await this.prisma.telegramKv.upsert({
      where: { key },
      create: { key, value: value as any, expiresAt },
      update: { value: value as any, expiresAt },
    });
  }

  async del(key: string): Promise<void> {
    await this.prisma.telegramKv.deleteMany({ where: { key } });
  }

  async exists(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async purgeExpired(): Promise<number> {
    const result = await this.prisma.telegramKv.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
