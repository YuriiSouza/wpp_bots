import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { createConnection } from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SyncService } from '../sync/sync.service';

@Injectable()
export class AdminCommonService {
  readonly QUEUE_LIST_KEY_GENERAL = 'telegram:queue:list:general';
  readonly QUEUE_ACTIVE_KEY_GENERAL = 'telegram:queue:active:general';
  readonly QUEUE_LIST_KEY_MOTO = 'telegram:queue:list:moto';
  readonly QUEUE_ACTIVE_KEY_MOTO = 'telegram:queue:active:moto';
  readonly LOG_PREFIX = 'telegram:log';
  readonly ROUTES_NOTE_KEY = 'telegram:routes:note';
  readonly BLOCKLIST_CACHE_PREFIX = 'telegram:blocklist:cache:driver';

  constructor(
    public readonly redisService: RedisService,
    public readonly prisma: PrismaService,
    public readonly sync: SyncService,
  ) {}

  toIsoString(value?: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  createJwtToken(payload: Record<string, unknown>): string {
    const header = this.encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.encodeBase64Url(JSON.stringify(payload));
    return `${header}.${body}.dev-signature`;
  }

  async recordAudit(params: {
    entityType: string;
    entityId: string;
    action: string;
    userId?: string | null;
    userName: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          userId: params.userId || null,
          userName: params.userName,
          before: params.before || undefined,
          after: params.after || undefined,
        },
      });
    } catch {
      // Audit must not break core operations.
    }
  }

  async ensureSupportSeedData(): Promise<void> {
    const prisma = this.prisma as any;
    const hubCount = await prisma.hub.count();
    if (!hubCount) {
      await prisma.hub.createMany({
        data: [
          { id: 'hub-sp', name: 'Hub Sao Paulo', timezone: 'America/Sao_Paulo' },
          { id: 'hub-cps', name: 'Hub Campinas', timezone: 'America/Sao_Paulo' },
          { id: 'hub-sts', name: 'Hub Santos', timezone: 'America/Sao_Paulo' },
        ],
        skipDuplicates: true,
      });
    }

    const analystCount = await prisma.analyst.count();
    if (!analystCount) {
      await prisma.analyst.createMany({
        data: [
          {
            id: 'admin-1',
            name: 'Aline Costa',
            email: 'admin@rotabot.com',
            password: 'admin123',
            role: 'ADMIN',
            hubId: 'hub-sp',
          },
          {
            id: 'analyst-1',
            name: 'Ana Analista',
            email: 'analista@rotabot.com',
            password: 'analista123',
            role: 'ANALISTA',
            hubId: 'hub-sp',
          },
          {
            id: 'super-1',
            name: 'Sergio Supervisor',
            email: 'supervisor@rotabot.com',
            password: 'super123',
            role: 'SUPERVISOR',
            hubId: null,
          },
          {
            id: 'analyst-2',
            name: 'Bruna Lemos',
            email: 'bruna@rotabot.com',
            password: 'bruna123',
            role: 'ANALISTA',
            hubId: 'hub-cps',
          },
        ],
        skipDuplicates: true,
      });
    }

    const drivers = await prisma.driver.findMany({
      orderBy: { createdAt: 'asc' },
      take: 6,
      select: { id: true, name: true, hubId: true },
    });
    const hubCycle = ['hub-sp', 'hub-sp', 'hub-cps', 'hub-sts', 'hub-sp', 'hub-cps'];
    await Promise.all(
      drivers.map((driver, index) => {
        if (driver.hubId) return Promise.resolve();
        return prisma.driver.update({
          where: { id: driver.id },
          data: { hubId: hubCycle[index] || 'hub-sp' },
        });
      }),
    );

    const configCount = await prisma.systemConfig.count();
    if (!configCount) {
      await prisma.systemConfig.createMany({
        data: [
          {
            key: 'algorithm',
            value: {
              noShowWeight: 30,
              declineWeight: 25,
              dsWeight: 20,
              blockThreshold: 70,
              autoBlock: true,
            } as any,
          },
          {
            key: 'system',
            value: {
              apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3001',
              telegramBotName: 'RotaBot Telegram',
              environment: process.env.NODE_ENV || 'development',
            } as any,
          },
        ],
        skipDuplicates: true,
      });
    }

    const ticketCount = await prisma.supportTicket.count();
    if (!ticketCount && drivers.length >= 3) {
      const protocols = ['ATD-20260228-001', 'ATD-20260228-002', 'ATD-20260228-003'];
      const createdTickets = await Promise.all(
        [0, 1, 2].map((index) =>
          prisma.supportTicket.create({
            data: {
              protocol: protocols[index],
              driverId: drivers[index].id,
              hubId: drivers[index].hubId || hubCycle[index] || 'hub-sp',
              analystId: index === 1 ? 'analyst-1' : index === 2 ? 'analyst-2' : null,
              status:
                index === 0
                  ? 'WAITING_ANALYST'
                  : index === 1
                    ? 'IN_PROGRESS'
                    : 'WAITING_DRIVER',
              queuePosition: index === 0 ? 1 : null,
              waitingSince: new Date(Date.now() - (index + 1) * 15 * 60 * 1000),
            },
          }),
        ),
      );

      await prisma.supportMessage.createMany({
        data: [
          {
            ticketId: createdTickets[0].id,
            authorType: 'DRIVER',
            authorId: null,
            authorName: drivers[0].name || drivers[0].id,
            body: 'Preciso confirmar minha rota de hoje.',
            telegramText: 'Preciso confirmar minha rota de hoje.',
          },
          {
            ticketId: createdTickets[1].id,
            authorType: 'DRIVER',
            authorId: null,
            authorName: drivers[1].name || drivers[1].id,
            body: 'Consigo trocar o horario da coleta?',
            telegramText: 'Consigo trocar o horario da coleta?',
          },
          {
            ticketId: createdTickets[1].id,
            authorType: 'ANALYST',
            authorId: 'analyst-1',
            authorName: 'Ana Analista',
            body: 'Estou validando com a operacao.',
            telegramText: 'Ana Analista: Estou validando com a operacao.',
          },
          {
            ticketId: createdTickets[2].id,
            authorType: 'ANALYST',
            authorId: 'analyst-2',
            authorName: 'Bruna Lemos',
            body: 'Me envie a foto do canhoto, por favor.',
            telegramText: 'Bruna Lemos: Me envie a foto do canhoto, por favor.',
          },
        ],
      });
    }

    const auditCount = await prisma.auditLog.count();
    if (!auditCount) {
      await prisma.auditLog.createMany({
        data: [
          {
            entityType: 'Driver',
            entityId: 'seed',
            action: 'SYSTEM_BOOTSTRAP',
            userId: 'system',
            userName: 'System',
          },
        ],
      });
    }
  }

  resolveSupportScope(
    role?: string,
    userHubId?: string | null,
    requestedHubId?: string | null,
  ): string[] | null {
    if (role === 'ADMIN' || role === 'SUPERVISOR') {
      if (requestedHubId && requestedHubId !== 'all') return [requestedHubId];
      return null;
    }
    if (userHubId) return [userHubId];
    if (requestedHubId && requestedHubId !== 'all') return [requestedHubId];
    return null;
  }

  async mapSupportTicket(ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        driver: true,
        hub: true,
        analyst: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!ticket) return null;

    const lastMessage = ticket.messages[0];
    return {
      id: ticket.id,
      protocol: ticket.protocol,
      status: ticket.status,
      hubId: ticket.hubId,
      hubName: ticket.hub.name,
      driverId: ticket.driverId,
      driverName: ticket.driver.name || ticket.driver.id,
      analystId: ticket.analystId,
      analystName: ticket.analyst?.name || null,
      queuePosition: ticket.queuePosition,
      waitingSince: this.toIsoString(ticket.waitingSince),
      lastMessageAt: this.toIsoString(lastMessage?.createdAt || ticket.updatedAt),
      unreadCount: 0,
      lastMessagePreview: lastMessage?.body || 'Sem mensagens',
    };
  }

  logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  async checkRedis(): Promise<string> {
    try {
      const pong = await this.redisService.client().ping();
      return pong === 'PONG' ? 'ok' : `erro (${pong})`;
    } catch {
      return 'erro';
    }
  }

  async checkPostgres(): Promise<string> {
    const url = process.env.DATABASE_URL;
    const host = process.env.PGHOST;
    const port = process.env.PGPORT;

    if (!url && !host) return 'nao_configurado';

    let targetHost = host || '';
    let targetPort = port ? Number(port) : 5432;

    if (url) {
      try {
        const parsed = new URL(url);
        targetHost = parsed.hostname;
        targetPort = parsed.port ? Number(parsed.port) : 5432;
      } catch {
        return 'erro_url';
      }
    }

    return new Promise((resolve) => {
      const socket = createConnection(
        { host: targetHost, port: targetPort, timeout: 1000 },
        () => {
          socket.end();
          resolve('ok');
        },
      );

      socket.on('error', () => resolve('erro'));
      socket.on('timeout', () => {
        socket.destroy();
        resolve('timeout');
      });
    });
  }

  escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  normalizeDriverId(value: string): string {
    return String(value || '')
      .trim()
      .replace(/\D/g, '');
  }

  getBlocklistCacheKey(driverId: string): string {
    return `${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`;
  }

  private encodeBase64Url(value: string): string {
    return Buffer.from(value, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
}
