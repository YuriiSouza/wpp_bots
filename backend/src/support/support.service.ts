import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { AdminCommonService } from '../admin-common/admin-common.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SupportService {
  constructor(
    private readonly common: AdminCommonService,
    private readonly telegram: TelegramService,
  ) {}

  private async resolveTicketChatId(ticketId: string, driverId: string): Promise<number | null> {
    try {
      const indexedChatId = await this.common.redisService.client().get(
        `telegram:driver:chat:${String(driverId).trim()}`,
      );
      if (!indexedChatId) return null;

      const state = await this.common.redisService.get<any>(
        `telegram:state:${indexedChatId}`,
      );
      if (!state?.driverId || state.driverId !== driverId) {
        return null;
      }
      if (state.supportTicketId && state.supportTicketId !== ticketId) {
        return null;
      }

      const chatId = Number(indexedChatId);
      if (Number.isFinite(chatId)) {
        return chatId;
      }
    } catch {
      // Redis lookup must not break support flow.
    }

    return null;
  }

  async getSupportTickets(params: {
    hubId?: string;
    status?: string;
    role?: string;
    userHubId?: string | null;
  }) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const scopedHubIds = this.common.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
        ...(params.status && params.status !== 'ALL' ? { status: params.status } : {}),
      },
      include: {
        driver: true,
        hub: true,
        analyst: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ updatedAt: 'desc' }, { waitingSince: 'asc' }],
    });

    const hubs = await prisma.hub.findMany({
      where: {
        ...(scopedHubIds ? { id: { in: scopedHubIds } } : {}),
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    const onlineAnalysts = await prisma.analyst.findMany({
      where: {
        isActive: true,
        ...(scopedHubIds ? { OR: [{ hubId: { in: scopedHubIds } }, { role: 'SUPERVISOR' }] } : {}),
      },
      include: {
        hub: true,
        _count: {
          select: {
            supportTickets: {
              where: {
                status: { in: ['IN_PROGRESS', 'WAITING_DRIVER'] },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      hubs,
      tickets: tickets.map((ticket) => ({
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
        waitingSince: this.common.toIsoString(ticket.waitingSince),
        lastMessageAt: this.common.toIsoString(ticket.messages[0]?.createdAt || ticket.updatedAt),
        unreadCount: 0,
        lastMessagePreview: ticket.messages[0]?.body || 'Sem mensagens',
      })),
      onlineAnalysts: onlineAnalysts.map((analyst) => ({
        id: analyst.id,
        name: analyst.name,
        email: analyst.email,
        role: analyst.role,
        hubId: analyst.hubId,
        hubName: analyst.hub?.name || null,
        isOnline: true,
        activeTickets: analyst._count.supportTickets,
      })),
    };
  }

  async getSupportMessages(ticketId: string) {
    await this.common.ensureSupportSeedData();
    const messages = await (this.common.prisma as any).supportMessage.findMany({
      where: { ticketId: String(ticketId).trim() },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((message) => ({
      ...message,
      createdAt: this.common.toIsoString(message.createdAt),
    }));
  }

  async getSupportContext(ticketId: string) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(ticketId).trim() },
      include: {
        driver: { include: { hub: true } },
      },
    });
    if (!ticket) return null;

    const [blocklist, lastRoutes] = await Promise.all([
      this.common.prisma.driverBlocklist.findUnique({ where: { driverId: ticket.driverId } }),
      this.common.prisma.route.findMany({
        where: { driverId: ticket.driverId },
        orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      }),
    ]);

    const activeRoute = lastRoutes.find(
      (route) => route.status === RouteStatus.ATRIBUIDA || String(route.status) === 'APROVADA',
    );
    const chatId = await this.resolveTicketChatId(ticket.id, ticket.driverId);
    return {
      driverId: ticket.driver.id,
      driverName: ticket.driver.name || ticket.driver.id,
      telegramChatId: chatId ? String(chatId) : '',
      hubId: ticket.hubId,
      hubName: ticket.driver.hub?.name || ticket.hubId,
      vehicleType: ticket.driver.vehicleType,
      ds: ticket.driver.ds,
      noShowCount: ticket.driver.noShowCount,
      declineRate: ticket.driver.declineRate,
      priorityScore: ticket.driver.priorityScore,
      isBlocked: String(blocklist?.status || '') === 'BLOCKED',
      hasActiveRoute: !!activeRoute,
      activeRouteStatus: activeRoute?.status || null,
      lastRoutes: lastRoutes.map((route) => ({
        id: route.id,
        city: route.cidade || '-',
        status: route.status,
        assignedAt: this.common.toIsoString(route.assignedAt || route.updatedAt),
      })),
    };
  }

  async getSupportAssignableAnalysts(
    ticketId: string,
    role?: string,
    userHubId?: string | null,
  ) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(ticketId).trim() },
      select: { hubId: true },
    });
    if (!ticket) return [];

    const allowedHubIds =
      role === 'ADMIN' || role === 'SUPERVISOR'
        ? [ticket.hubId]
        : userHubId
          ? [userHubId]
          : [ticket.hubId];

    const analysts = await prisma.analyst.findMany({
      where: {
        isActive: true,
        hubId: { in: allowedHubIds },
      },
      include: { hub: true },
      orderBy: { name: 'asc' },
    });

    return analysts.map((analyst) => ({
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      isOnline: true,
      activeTickets: 0,
    }));
  }

  async assumeSupportTicket(ticketId: string, analystIdRaw: string) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const analystId = String(analystIdRaw || '').trim();
    const updated = await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        analystId: analystId || null,
        status: 'IN_PROGRESS',
        queuePosition: null,
        firstResponseAt: new Date(),
      },
    });
    return this.common.mapSupportTicket(updated.id);
  }

  async closeSupportTicket(ticketId: string) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const normalizedTicketId = String(ticketId).trim();
    const updated = await prisma.supportTicket.update({
      where: { id: normalizedTicketId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });

    const closureText = 'Seu atendimento foi encerrado. Se precisar de ajuda novamente, selecione "Falar com analista" no menu.';

    await prisma.supportMessage.create({
      data: {
        ticketId: normalizedTicketId,
        authorType: 'SYSTEM',
        authorId: null,
        authorName: 'Sistema',
        body: closureText,
        telegramText: closureText,
      },
    });

    const chatId = await this.resolveTicketChatId(updated.id, updated.driverId);
    if (chatId) {
      await this.telegram.sendMessage(chatId, closureText);
    }

    return this.common.mapSupportTicket(updated.id);
  }

  async transferSupportTicket(ticketId: string, analystIdRaw: string) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const analystId = String(analystIdRaw || '').trim();
    const updated = await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        analystId: analystId || null,
        status: 'IN_PROGRESS',
      },
    });
    return this.common.mapSupportTicket(updated.id);
  }

  async createSupportMessage(
    ticketId: string,
    bodyRaw: string,
    telegramTextRaw: string,
    authorIdRaw?: string,
    authorNameRaw?: string,
  ) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const body = String(bodyRaw || '').trim();
    const telegramText = String(telegramTextRaw || body).trim();
    const authorId = String(authorIdRaw || '').trim() || null;
    const authorName = String(authorNameRaw || 'Analista').trim();

    const created = await prisma.supportMessage.create({
      data: {
        ticketId: String(ticketId).trim(),
        authorType: 'ANALYST',
        authorId,
        authorName,
        body,
        telegramText,
      },
    });

    await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        status: 'WAITING_DRIVER',
      },
    });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(ticketId).trim() },
      select: { id: true, driverId: true },
    });

    if (ticket) {
      const chatId = await this.resolveTicketChatId(ticket.id, ticket.driverId);
      if (chatId) {
        await this.telegram.sendMessage(chatId, telegramText);
      }
    }

    return {
      ...created,
      createdAt: this.common.toIsoString(created.createdAt),
    };
  }

  async getSupportMetrics(params: {
    hubId?: string;
    role?: string;
    userHubId?: string | null;
  }) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const scopedHubIds = this.common.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
      },
      include: {
        hub: true,
        analyst: true,
        messages: true,
      },
    });

    const closed = tickets.filter((item) => item.closedAt);
    const avgFirstResponseMinutes = tickets.length
      ? Number(
          (
            tickets.reduce((sum, item) => {
              if (!item.firstResponseAt) return sum;
              return sum + (item.firstResponseAt.getTime() - item.waitingSince.getTime()) / 60000;
            }, 0) / Math.max(1, tickets.filter((item) => item.firstResponseAt).length)
          ).toFixed(1),
        )
      : 0;
    const avgResolutionMinutes = closed.length
      ? Number(
          (
            closed.reduce(
              (sum, item) => sum + ((item.closedAt as Date).getTime() - item.waitingSince.getTime()) / 60000,
              0,
            ) / closed.length
          ).toFixed(1),
        )
      : 0;

    return {
      avgFirstResponseMinutes,
      avgResolutionMinutes,
      closureRate: tickets.length ? Math.round((closed.length / tickets.length) * 100) : 0,
      ticketsByHub: Array.from(
        tickets.reduce((acc, item) => {
          const current = acc.get(item.hubId) || { hubId: item.hubId, hubName: item.hub.name, total: 0 };
          current.total += 1;
          acc.set(item.hubId, current);
          return acc;
        }, new Map<string, { hubId: string; hubName: string; total: number }>()),
      ).map(([, value]) => value),
      ticketsByAnalyst: Array.from(
        tickets.reduce((acc, item) => {
          if (!item.analyst) return acc;
          const current = acc.get(item.analystId as string) || {
            analystId: item.analystId,
            analystName: item.analyst.name,
            total: 0,
          };
          current.total += 1;
          acc.set(item.analystId as string, current);
          return acc;
        }, new Map<string, { analystId: string | null; analystName: string; total: number }>()),
      ).map(([, value]) => value),
    };
  }

  async getSupportHistory(params: {
    hubId?: string;
    role?: string;
    userHubId?: string | null;
    search?: string;
    from?: string;
    to?: string;
    status?: string;
  }) {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const scopedHubIds = this.common.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const search = String(params.search || '').trim().toLowerCase();
    const rows = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
        ...(params.status && params.status !== 'ALL' ? { status: params.status } : {}),
      },
      include: {
        hub: true,
        driver: true,
        analyst: true,
        messages: true,
      },
      orderBy: { waitingSince: 'desc' },
    });

    return rows
      .filter((row) => {
        if (!search) return true;
        return (
          (row.driver.name || row.driver.id).toLowerCase().includes(search) ||
          row.driver.id.toLowerCase().includes(search) ||
          (row.analyst?.name || '').toLowerCase().includes(search)
        );
      })
      .filter((row) => (!params.from ? true : row.waitingSince >= new Date(params.from)))
      .filter((row) => (!params.to ? true : row.waitingSince <= new Date(`${params.to}T23:59:59.999Z`)))
      .map((row) => ({
        id: `history-${row.id}`,
        protocol: row.protocol,
        ticketId: row.id,
        hubName: row.hub.name,
        driverName: row.driver.name || row.driver.id,
        driverId: row.driver.id,
        analystName: row.analyst?.name || null,
        startedAt: this.common.toIsoString(row.waitingSince),
        endedAt: this.common.toIsoString(row.closedAt || row.updatedAt),
        resolutionMinutes: Math.max(
          1,
          Math.round(((row.closedAt || row.updatedAt).getTime() - row.waitingSince.getTime()) / 60000),
        ),
        messageCount: row.messages.length,
        status: row.status,
      }));
  }
}
