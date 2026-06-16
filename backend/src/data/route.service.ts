import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { RouteStatus } from '@prisma/client';
import { SheetsService } from '../sheets/sheets.service';
import { RedisService } from '../redis/redis.service';

const ROUTE_ASSIGNMENT_SOURCE = {
  SYNC: 'SYNC' as const,
  TELEGRAM_BOT: 'TELEGRAM_BOT' as const,
};

@Injectable()
export class RouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly redis: RedisService,
  ) {}

  private async invalidateRoutesCache() {
    const client = this.redis.client();
    const keys = await client.keys('cache:routes:list:*');
    if (keys.length) {
      await client.del(...keys);
    }
  }

  private getCurrentRouteWindowFallback() {
    const now = new Date();
    const shift = now.getHours() < 12 ? 'AM' : now.getHours() < 18 ? 'PM' : 'PM2';
    return {
      date: now.toISOString().slice(0, 10),
      shift,
    };
  }

  private async getCurrentRouteWindow() {
    const fallback = this.getCurrentRouteWindowFallback();
    const calculationWindow = await this.sheets.getCurrentCalculationWindow();
    if (calculationWindow) {
      return calculationWindow;
    }

    return fallback;
  }

  async driverHasRoute(driverId: string): Promise<boolean> {
    // 1) já tem rota ativa segundo a planilha "Visão Geral Atribuições" col K
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { hasActiveRoute: true },
    });
    if (driver?.hasActiveRoute) return true;

    // 2) já solicitou uma rota pelo bot (com ou sem aprovação do analista)
    const requested = await this.prisma.route.findFirst({
      where: {
        requestedDriverId: driverId,
        status: { in: ['DISPONIVEL', 'ATRIBUIDA', 'APROVADA'] as any },
      },
      select: { id: true },
    });
    return !!requested;
  }

  async getCurrentRouteForDriver(driverId: string) {
    return this.prisma.route.findFirst({
      where: {
        OR: [
          {
            driverId,
            status: { in: ['ATRIBUIDA', 'APROVADA'] as any },
          },
          {
            requestedDriverId: driverId,
            status: { in: ['DISPONIVEL', 'ATRIBUIDA', 'APROVADA'] as any },
          },
        ],
      },
      orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        atId: true,
        gaiola: true,
        cluster: true,
        cidade: true,
        routeDate: true,
        status: true,
        assignmentSource: true,
        requiredVehicleType: true,
      },
    });
  }

  async getAvailableRoutesForDriver(vehicleType?: string | null) {
    const normalized = normalizeVehicleType(vehicleType ?? undefined);

    // Rotas DISPONIVEL (sem requestedDriverId) — fonte é a guia Reatribuição
    // sincronizada para a tabela Route.
    const where: any = {
      status: RouteStatus.DISPONIVEL,
      requestedDriverId: null,
    };
    if (normalized === 'MOTO') {
      where.requiredVehicleType = { contains: 'MOTO', mode: 'insensitive' };
    }

    const routes = await this.prisma.route.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });

    return routes.map((route) => ({
      routeId: route.id,
      atId: route.atId || route.id,
      gaiola: route.gaiola ?? undefined,
      cluster: route.cluster ?? undefined,
      cidade: route.cidade ?? undefined,
      vehicleType: route.requiredVehicleType ?? undefined,
    }));
  }

  async assignRoute(routeId: string, driverId: string): Promise<boolean> {
    const assigned = await this.prisma.$transaction(async (tx) => {
      const prismaTx = tx as any;
      // Motorista já tem rota ativa? (Driver.hasActiveRoute alimentado pelo sync via col K
      // de "Visão Geral Atribuições")
      const driver = await prismaTx.driver.findUnique({
        where: { id: driverId },
        select: { hasActiveRoute: true },
      });
      if (driver?.hasActiveRoute) return false;

      const updated = await prismaTx.route.updateMany({
        where: {
          id: routeId,
          status: 'DISPONIVEL',
          requestedDriverId: null,
        },
        data: {
          requestedDriverId: driverId,
          assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
        },
      });

      return updated.count > 0;
    });

    if (!assigned) return false;
    await this.sheets.updateAssignmentRequest(routeId, driverId);
    await this.invalidateRoutesCache();
    return true;
  }

  async cancelTelegramRouteRequest(driverId: string) {
    const route = await this.prisma.route.findFirst({
      where: {
        requestedDriverId: driverId,
        assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
      },
      orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        atId: true,
        gaiola: true,
        cidade: true,
        cluster: true,
        assignmentSource: true,
        sheetRowNumber: true,
      },
    });

    if (!route) {
      return { ok: false, reason: 'NO_ROUTE' as const };
    }

    if (String(route.assignmentSource || '') !== ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT) {
      return { ok: false, reason: 'NOT_TELEGRAM' as const, route };
    }

    await this.prisma.route.update({
      where: { id: route.id },
      data: {
        requestedDriverId: null,
        assignmentSource: ROUTE_ASSIGNMENT_SOURCE.SYNC,
        driverId: null,
        driverName: null,
        driverVehicleType: null,
        driverAccuracy: null,
        driverPlate: null,
        status: 'DISPONIVEL',
        assignedAt: null,
      },
    });

    await this.sheets.clearAssignmentRequest(route.id);
    await this.sheets.clearDriverRouteCache(driverId);
    await this.invalidateRoutesCache();
    return { ok: true, route };
  }
}
