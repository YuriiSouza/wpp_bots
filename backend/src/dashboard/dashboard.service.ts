import { Injectable } from '@nestjs/common';
import { BlocklistStatus, RouteStatus } from '@prisma/client';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class DashboardService {
  constructor(private readonly common: AdminCommonService) {}

  async getDashboardData() {
    const prisma = this.common.prisma;
    const [
      totalDrivers,
      routesAvailable,
      routesAssigned,
      routesBlocked,
      blockedDrivers,
      avgDriverAgg,
      lastSync,
      topDriversRaw,
      recentRoutes,
    ] = await Promise.all([
      prisma.driver.count(),
      prisma.route.count({ where: { status: RouteStatus.DISPONIVEL } }),
      prisma.route.count({ where: { status: RouteStatus.ATRIBUIDA } }),
      prisma.route.count({ where: { status: RouteStatus.BLOQUEADA } }),
      prisma.driverBlocklist.count({ where: { status: BlocklistStatus.ACTIVE } }),
      prisma.driver.aggregate({ _avg: { declineRate: true } }),
      prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.driver.findMany({
        orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          name: true,
          priorityScore: true,
          _count: {
            select: {
              routes: {
                where: { status: RouteStatus.ATRIBUIDA },
              },
            },
          },
        },
      }),
      prisma.route.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          createdAt: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRoutes = routesAvailable + routesAssigned + routesBlocked;
    const historyMap = new Map<
      string,
      { date: string; atribuidas: number; disponiveis: number; bloqueadas: number }
    >();

    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      historyMap.set(key, {
        date: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
        atribuidas: 0,
        disponiveis: 0,
        bloqueadas: 0,
      });
    }

    recentRoutes.forEach((route) => {
      const key = route.createdAt.toISOString().slice(0, 10);
      const bucket = historyMap.get(key);
      if (!bucket) return;
      if (route.status === RouteStatus.ATRIBUIDA) bucket.atribuidas += 1;
      if (route.status === RouteStatus.DISPONIVEL) bucket.disponiveis += 1;
      if (route.status === RouteStatus.BLOQUEADA) bucket.bloqueadas += 1;
    });

    const topDrivers = topDriversRaw.map((driver) => ({
      name: driver.name?.split(' ')[0] || driver.id,
      score: driver.priorityScore,
      routes: driver._count.routes,
    }));

    return {
      stats: {
        totalDrivers,
        routesAvailable,
        routesAssigned,
        routesBlocked,
        occupationRate: totalRoutes ? Math.round((routesAssigned / totalRoutes) * 100) : 0,
        blockedDrivers,
        lastSync: lastSync
          ? {
              ...lastSync,
              startedAt: this.common.toIsoString(lastSync.startedAt),
              finishedAt: this.common.toIsoString(lastSync.finishedAt),
            }
          : null,
        avgDeclineRate: Number((avgDriverAgg._avg.declineRate || 0).toFixed(2)),
      },
      routesPerDay: Array.from(historyMap.values()),
      routeDistribution: [
        { status: 'Disponiveis', count: routesAvailable, fill: 'var(--color-chart-2)' },
        { status: 'Atribuidas', count: routesAssigned, fill: 'var(--color-chart-1)' },
        { status: 'Bloqueadas', count: routesBlocked, fill: 'var(--color-chart-3)' },
      ],
      topDrivers,
    };
  }

  async getOverviewData() {
    const prisma = this.common.prisma;
    const [overviews, routes] = await Promise.all([
      prisma.assignmentOverview.findMany({ orderBy: { rowNumber: 'asc' } }),
      prisma.route.findMany({ select: { id: true, status: true, driverId: true } }),
    ]);
    const routeMap = new Map(routes.map((route) => [route.id, route]));

    const data = overviews.map((overview) => {
      const payload = overview.payload as Record<string, unknown>;
      const routeId = String(payload.routeId || '');
      const route = routeMap.get(routeId);
      let inconsistency: string | null = null;
      if (!route) inconsistency = 'Rota nao encontrada';
      else if (route.status !== payload.status) {
        inconsistency = `Status divergente (overview: ${String(payload.status)}, real: ${route.status})`;
      } else if ((route.driverId || null) !== (overview.driverId || null)) {
        inconsistency = 'Motorista divergente';
      }

      return {
        ...overview,
        updatedAt: this.common.toIsoString(overview.updatedAt),
        createdAt: this.common.toIsoString(overview.createdAt),
        inconsistency,
      };
    });

    return {
      inconsistentCount: data.filter((item) => item.inconsistency).length,
      data,
    };
  }

  async getAuditLogs() {
    return (this.common.prisma as any).auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getBotHealthData() {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const [conversations, syncLogs, lastMinuteMessages, activeTickets, openRoutes] =
      await Promise.all([
        this.common.prisma.conversationState.findMany({ orderBy: { updatedAt: 'desc' }, take: 30 }),
        this.common.prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
        prisma.supportMessage.count({
          where: { createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
        }),
        prisma.supportTicket.count({
          where: { status: { in: ['IN_PROGRESS', 'WAITING_DRIVER'] } },
        }),
        this.common.prisma.route.count({
          where: {
            status: RouteStatus.DISPONIVEL,
            createdAt: { lte: new Date(Date.now() - 30 * 60 * 1000) },
          },
        }),
      ]);

    const recentErrors = syncLogs.filter((item) => item.status === 'FAILED').length;
    return {
      messagesPerMin: lastMinuteMessages,
      uptime: recentErrors > 3 ? 96.2 : 99.7,
      status: recentErrors > 5 ? 'DEGRADED' : 'ONLINE',
      activeConversations: conversations.filter((item) => item.step !== 'DONE').length,
      totalUsers: conversations.length,
      recentErrors,
      conversations,
      alerts: [
        activeTickets > 0
          ? {
              type: 'info',
              message: `${activeTickets} atendimento(s) em andamento na central de suporte.`,
              time: 'agora',
            }
          : null,
        recentErrors > 0
          ? {
              type: 'error',
              message: `${recentErrors} sync(s) recentes falharam. Verificar planilha e redis.`,
              time: 'recente',
            }
          : null,
        openRoutes > 0
          ? {
              type: 'warning',
              message: `${openRoutes} rotas disponiveis estao sem atribuicao ha mais de 30 minutos.`,
              time: '30min',
            }
          : null,
      ].filter(Boolean),
    };
  }

  async getSystemSettings() {
    await this.common.ensureSupportSeedData();
    const rows = await (this.common.prisma as any).systemConfig.findMany();
    const map = new Map(rows.map((row) => [row.key, row.value as Record<string, unknown>]));
    const algorithm = map.get('algorithm') || {};
    const system = map.get('system') || {};

    return {
      algorithm,
      system,
      permissions: [
        {
          role: 'ADMIN',
          desc: 'Acesso completo a todas as funcionalidades',
          perms: ['Dashboard', 'Motoristas', 'Rotas', 'Atendimento', 'Blocklist', 'FAQ', 'Sync', 'Auditoria', 'Configuracoes'],
        },
        {
          role: 'ANALISTA',
          desc: 'Acesso operacional ao hub e atendimento',
          perms: ['Dashboard', 'Motoristas', 'Rotas', 'Atendimento', 'Blocklist', 'FAQ', 'Sync'],
        },
        {
          role: 'SUPERVISOR',
          desc: 'Visualizacao multihub e atendimento',
          perms: ['Dashboard', 'Atendimento', 'Historico', 'Metricas', 'Auditoria'],
        },
      ],
      meta: {
        version: '1.0.0',
        stack: 'Next.js + NestJS + Prisma',
        database: 'PostgreSQL',
        bot: 'Telegram Bot API',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }

  async updateSystemSettings(payload: Record<string, unknown>) {
    const prisma = this.common.prisma as any;
    const algorithm = (payload.algorithm || {}) as Record<string, unknown>;
    const system = (payload.system || {}) as Record<string, unknown>;

    await prisma.systemConfig.upsert({
      where: { key: 'algorithm' },
      create: { key: 'algorithm', value: algorithm as any },
      update: { value: algorithm as any },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'system' },
      create: { key: 'system', value: system as any },
      update: { value: system as any },
    });

    await this.common.recordAudit({
      entityType: 'SystemConfig',
      entityId: 'settings',
      action: 'UPDATE',
      userId: 'system',
      userName: 'System',
      after: payload,
    });

    return { ok: true, message: 'Configuracoes salvas com sucesso.' };
  }
}
