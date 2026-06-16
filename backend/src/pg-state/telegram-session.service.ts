import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Substitui as chaves `telegram:state:<chatId>` do Redis.
 * Estado completo da conversa do motorista vive em TelegramSession.payload.
 *
 * NÃO usa TTL — diferente do Redis, sessões ficam no DB até serem deletadas.
 * Use `clear(chatId)` quando a conversa terminar.
 */
@Injectable()
export class TelegramSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T = any>(chatId: string): Promise<T | null> {
    const row = await this.prisma.telegramSession.findUnique({
      where: { chatId: String(chatId) },
      select: { payload: true },
    });
    return (row?.payload as T) ?? null;
  }

  async set<T = any>(chatId: string, payload: T): Promise<void> {
    const key = String(chatId);
    await this.prisma.telegramSession.upsert({
      where: { chatId: key },
      create: { chatId: key, payload: payload as any },
      update: { payload: payload as any },
    });
  }

  async clear(chatId: string): Promise<void> {
    await this.prisma.telegramSession.deleteMany({
      where: { chatId: String(chatId) },
    });
  }
}
