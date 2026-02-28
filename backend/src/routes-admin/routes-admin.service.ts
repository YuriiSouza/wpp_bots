import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class RoutesAdminService {
  constructor(private readonly common: AdminCommonService) {}

  async getRoutes() {
    return this.common.prisma.route.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async assignRoute(routeIdRaw: string, driverIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    const driverId = String(driverIdRaw || '').trim();

    if (!routeId || !driverId) {
      return { ok: false, message: 'Rota e motorista sao obrigatorios.' };
    }

    const [route, driver, alreadyAssigned] = await Promise.all([
      this.common.prisma.route.findUnique({ where: { id: routeId } }),
      this.common.prisma.driver.findUnique({ where: { id: driverId } }),
      this.common.prisma.route.findFirst({
        where: { driverId, status: RouteStatus.ATRIBUIDA },
        select: { id: true },
      }),
    ]);

    if (!route) return { ok: false, message: 'Rota nao encontrada.' };
    if (!driver) return { ok: false, message: 'Motorista nao encontrado.' };
    if (route.status === RouteStatus.BLOQUEADA) {
      return { ok: false, message: 'Rotas bloqueadas nao podem ser atribuidas.' };
    }
    if (alreadyAssigned && alreadyAssigned.id !== routeId) {
      return { ok: false, message: 'Motorista ja possui uma rota atribuida.' };
    }

    const normalizedRequired = normalizeVehicleType(route.requiredVehicleType || undefined);
    const normalizedDriver = normalizeVehicleType(driver.vehicleType || undefined);
    if (normalizedRequired === 'MOTO' && normalizedDriver !== 'MOTO') {
      return { ok: false, message: 'O motorista nao atende o veiculo requerido para a rota.' };
    }

    await this.common.prisma.route.update({
      where: { id: routeId },
      data: {
        driverId: driver.id,
        driverName: driver.name,
        driverVehicleType: driver.vehicleType,
        status: RouteStatus.ATRIBUIDA,
        assignedAt: new Date(),
      },
    });
    await this.common.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'MANUAL_ASSIGN',
      userId: 'system',
      userName: 'System',
      after: { driverId: driver.id, status: RouteStatus.ATRIBUIDA },
    });

    return { ok: true, message: 'Rota atribuida com sucesso.' };
  }

  async unassignRoute(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    await this.common.prisma.route.update({
      where: { id: routeId },
      data: {
        driverId: null,
        driverName: null,
        driverVehicleType: null,
        driverAccuracy: null,
        driverPlate: null,
        status: RouteStatus.DISPONIVEL,
        assignedAt: null,
      },
    });
    await this.common.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'UNASSIGN',
      userId: 'system',
      userName: 'System',
      after: { driverId: null, status: RouteStatus.DISPONIVEL },
    });

    return { ok: true, message: 'Rota desatribuida com sucesso.' };
  }

  async blockRoute(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    await this.common.prisma.route.update({
      where: { id: routeId },
      data: {
        driverId: null,
        driverName: null,
        driverVehicleType: null,
        driverAccuracy: null,
        driverPlate: null,
        assignedAt: null,
        status: RouteStatus.BLOQUEADA,
      },
    });
    await this.common.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'BLOCK',
      userId: 'system',
      userName: 'System',
      after: { status: RouteStatus.BLOQUEADA },
    });

    return { ok: true, message: 'Rota bloqueada com sucesso.' };
  }
}
