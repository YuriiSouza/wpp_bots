import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PgLockService } from './pg-lock.service';

/**
 * Substitui as filas Redis `telegram:queue:list:*` e `telegram:queue:active:*`.
 *
 * Conceito:
 * - Cada grupo ("moto" | "general") tem várias entradas WAITING e até 1 ACTIVE.
 * - Ordem da fila = joinedAt ascendente.
 * - Concorrência: operações de "promover próximo" usam pg_advisory_xact_lock
 *   por grupo, garantindo que duas instâncias do bot não promovam o mesmo
 *   motorista duas vezes.
 */
@Injectable()
export class TelegramQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: PgLockService,
  ) {}

  private lockLabel(group: string) {
    return `telegram:queue:${group}`;
  }

  /** Garante que chatId está na fila do grupo. Idempotente. */
  async enqueue(group: string, chatId: string, metadata?: any): Promise<void> {
    const key = String(chatId);
    await this.prisma.telegramQueueEntry.upsert({
      where: { group_chatId: { group, chatId: key } },
      create: { group, chatId: key, status: 'WAITING', metadata },
      // Se já existe WAITING ou ACTIVE, não muda nada (preserva ordem)
      update: {},
    });
  }

  async remove(group: string, chatId: string): Promise<void> {
    await this.prisma.telegramQueueEntry.deleteMany({
      where: { group, chatId: String(chatId) },
    });
  }

  /** Retorna o chatId atualmente ACTIVE no grupo (ou null). */
  async getActiveChatId(group: string): Promise<string | null> {
    const row = await this.prisma.telegramQueueEntry.findFirst({
      where: { group, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
      select: { chatId: true },
    });
    return row?.chatId ?? null;
  }

  async isActive(group: string, chatId: string): Promise<boolean> {
    const active = await this.getActiveChatId(group);
    return active === String(chatId);
  }

  async getPosition(group: string, chatId: string): Promise<number> {
    const waiting = await this.prisma.telegramQueueEntry.findMany({
      where: { group, status: 'WAITING' },
      orderBy: { joinedAt: 'asc' },
      select: { chatId: true },
    });
    const idx = waiting.findIndex((entry) => entry.chatId === String(chatId));
    return idx >= 0 ? idx + 1 : -1;
  }

  async listWaiting(group: string): Promise<string[]> {
    const rows = await this.prisma.telegramQueueEntry.findMany({
      where: { group, status: 'WAITING' },
      orderBy: { joinedAt: 'asc' },
      select: { chatId: true },
    });
    return rows.map((r) => r.chatId);
  }

  async countWaiting(group: string): Promise<number> {
    return this.prisma.telegramQueueEntry.count({
      where: { group, status: 'WAITING' },
    });
  }

  /**
   * Promove o próximo motorista WAITING para ACTIVE, sob lock.
   * Retorna o chatId promovido ou null se não houver fila ou já houver ACTIVE.
   */
  async promoteNext(group: string): Promise<string | null> {
    return this.lock.withTransactionLock(this.lockLabel(group), async (tx) => {
      const active = await tx.telegramQueueEntry.findFirst({
        where: { group, status: 'ACTIVE' },
        select: { chatId: true },
      });
      if (active) return null;

      const next = await tx.telegramQueueEntry.findFirst({
        where: { group, status: 'WAITING' },
        orderBy: { joinedAt: 'asc' },
      });
      if (!next) return null;

      await tx.telegramQueueEntry.update({
        where: { id: next.id },
        data: { status: 'ACTIVE' },
      });
      return next.chatId as string;
    });
  }

  /**
   * Marca o ACTIVE atual como concluído (apaga a entrada). Use ao terminar atendimento.
   */
  async clearActive(group: string): Promise<void> {
    await this.prisma.telegramQueueEntry.deleteMany({
      where: { group, status: 'ACTIVE' },
    });
  }

  /** Remove qualquer entrada (waiting ou active) de todos os grupos. */
  async purgeAll(): Promise<void> {
    await this.prisma.telegramQueueEntry.deleteMany({});
  }
}
