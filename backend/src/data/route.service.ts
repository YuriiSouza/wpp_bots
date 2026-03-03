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
    const currentWindow = await this.getCurrentRouteWindow();
    const existing = await this.prisma.route.findFirst({
      where: {
        OR: [
          {
            driverId,
            status: 'ATRIBUIDA',
          },
          {
            requestedDriverId: driverId,
            assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
          },
        ],
        routeDate: currentWindow.date,
        shift: currentWindow.shift,
      },
      select: { id: true },
    });
    return !!existing;
  }

  async getCurrentRouteForDriver(driverId: string) {
    const currentWindow = await this.getCurrentRouteWindow();
    return (this.prisma as any).route.findFirst({
      where: {
        OR: [
          {
            driverId,
            status: 'ATRIBUIDA',
          },
          {
            requestedDriverId: driverId,
            assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
          },
        ],
        routeDate: currentWindow.date,
        shift: currentWindow.shift,
      },
      orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        atId: true,
        gaiola: true,
        bairro: true,
        cidade: true,
        routeDate: true,
        shift: true,
        status: true,
        noShow: true,
        assignmentSource: true,
        requiredVehicleType: true,
      },
    });
  }

  async getAvailableRoutesForDriver(vehicleType?: string | null) {
    const normalized = normalizeVehicleType(vehicleType ?? undefined);
    const currentWindow = await this.getCurrentRouteWindow();

    const where =
      normalized === 'MOTO'
        ? {
            botAvailable: true,
            status: RouteStatus.DISPONIVEL,
            requiredVehicleTypeNorm: 'MOTO',
            routeDate: currentWindow.date,
            shift: currentWindow.shift,
          }
        : {
            botAvailable: true,
            status: RouteStatus.DISPONIVEL,
            routeDate: currentWindow.date,
            shift: currentWindow.shift,
          };

    const routes = await (this.prisma as any).route.findMany({
      where,
      orderBy: [{ noShow: 'desc' }, { createdAt: 'asc' }],
    });

    return routes.map((route) => ({
      routeId: route.id,
      atId: route.atId || route.id,
      gaiola: route.gaiola ?? undefined,
      bairro: route.bairro ?? undefined,
      cidade: route.cidade ?? undefined,
      vehicleType: route.requiredVehicleType ?? undefined,
    }));
  }

  async assignRoute(routeId: string, driverId: string): Promise<boolean> {
    const currentWindow = await this.getCurrentRouteWindow();
    const assigned = await this.prisma.$transaction(async (tx) => {
      const prismaTx = tx as any;
      const existing = await prismaTx.route.findFirst({
        where: {
          driverId,
          status: 'ATRIBUIDA',
          routeDate: currentWindow.date,
          shift: currentWindow.shift,
        },
        select: { id: true },
      });

      if (existing) return false;

      const updated = await prismaTx.route.updateMany({
        where: {
          id: routeId,
          botAvailable: true,
          status: 'DISPONIVEL',
          requestedDriverId: null,
        },
        data: {
          requestedDriverId: driverId,
          assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
          driverId: null,
          driverName: null,
          driverVehicleType: null,
          driverAccuracy: null,
          driverPlate: null,
          status: 'DISPONIVEL',
          assignedAt: null,
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
    const currentWindow = await this.getCurrentRouteWindow();
    const route = await (this.prisma as any).route.findFirst({
      where: {
        requestedDriverId: driverId,
        assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
        routeDate: currentWindow.date,
        shift: currentWindow.shift,
      },
      orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        atId: true,
        gaiola: true,
        bairro: true,
        cidade: true,
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

    await this.prisma.$transaction(async (tx) => {
      const prismaTx = tx as any;
      await prismaTx.route.update({
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

      if (route.sheetRowNumber) {
        await prismaTx.assignmentOverview.updateMany({
          where: { rowNumber: route.sheetRowNumber },
          data: { driverId: null },
        });
      }
    });

    await this.sheets.clearAssignmentRequest(route.id);
    await this.sheets.clearDriverRouteCache(driverId);
    await this.invalidateRoutesCache();
    return { ok: true, route };
  }
}
