import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { RouteStatus } from '@prisma/client';

@Injectable()
export class RouteService {
  constructor(private readonly prisma: PrismaService) {}

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

    const routes = await this.prisma.route.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    return routes.map((route) => ({
      atId: route.id,
      gaiola: route.gaiola ?? undefined,
      bairro: route.bairro ?? undefined,
      cidade: route.cidade ?? undefined,
      vehicleType: route.requiredVehicleType ?? undefined,
    }));
  }

  async assignRoute(routeId: string, driverId: string): Promise<boolean> {
    const updated = await this.prisma.route.updateMany({
      where: {
        id: routeId,
        status: 'DISPONIVEL',
        driverId: null,
      },
      data: {
        driverId,
        status: 'ATRIBUIDA',
        assignedAt: new Date(),
      },
    });

    return updated.count > 0;
  }
}
