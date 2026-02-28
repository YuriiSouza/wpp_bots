import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { RouteStatus } from '@prisma/client';
import { SheetsService } from '../sheets/sheets.service';

const ROUTE_ASSIGNMENT_SOURCE = {
  TELEGRAM_BOT: 'TELEGRAM_BOT' as const,
};

@Injectable()
export class RouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
  ) {}

  async driverHasRoute(driverId: string): Promise<boolean> {
    const existing = await this.prisma.route.findFirst({
      where: {
        driverId,
        status: 'ATRIBUIDA',
      },
      select: { id: true },
    });
    return !!existing;
  }

  async getAvailableRoutesForDriver(vehicleType?: string | null) {
    const normalized = normalizeVehicleType(vehicleType ?? undefined);

    const where =
      normalized === 'MOTO'
        ? {
            status: RouteStatus.DISPONIVEL,
            requiredVehicleTypeNorm: 'MOTO',
          }
        : { status: RouteStatus.DISPONIVEL };

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
    const assigned = await this.prisma.$transaction(async (tx) => {
      const prismaTx = tx as any;
      const existing = await prismaTx.route.findFirst({
        where: {
          driverId,
          status: 'ATRIBUIDA',
        },
        select: { id: true },
      });

      if (existing) return false;

      const updated = await prismaTx.route.updateMany({
        where: {
          id: routeId,
          status: 'DISPONIVEL',
          driverId: null,
        },
        data: {
          requestedDriverId: driverId,
          assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
          driverId,
          status: 'ATRIBUIDA',
          assignedAt: new Date(),
        },
      });

      return updated.count > 0;
    });

    if (!assigned) return false;
    await this.sheets.updateAssignmentRequest(routeId, driverId);
    return true;
  }
}
