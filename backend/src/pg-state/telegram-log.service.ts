import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Substitui a lista Redis `telegram:log:<bucket>` por uma tabela em append-only.
 */
@Injectable()
export class TelegramLogService {
  constructor(private readonly prisma: PrismaService) {}

  async push(bucket: string, message: string): Promise<void> {
    await this.prisma.telegramLogEntry.create({
      data: { bucket, message },
    });
  }

  async tail(bucket: string, limit = 100): Promise<string[]> {
    const rows = await this.prisma.telegramLogEntry.findMany({
      where: { bucket },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
      select: { message: true },
    });
    return rows.reverse().map((r) => r.message);
  }

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.prisma.telegramLogEntry.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
