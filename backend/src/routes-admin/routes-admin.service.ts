import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { AdminCommonService } from '../admin-common/admin-common.service';
import { SyncService } from '../sync/sync.service';
import { SheetsService } from '../sheets/sheets.service';

@Injectable()
export class RoutesAdminService {
  constructor(
    private readonly common: AdminCommonService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
  ) {}

  async getRoutes() {
    return this.common.prisma.route.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Atualiza as rotas a partir da guia Reatribuição da planilha.
   * Apaga toda a tabela Route e reimporta o conteúdo da planilha.
   * Chamado pelo botão "Atualizar rotas" do frontend.
   */
  async refreshRoutesFromSheet() {
    const result = await this.sync.syncRoutesFromReatribuicao();
    return { ok: true, ...result };
  }

  async assignRoute(routeIdRaw: string, driverIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    const driverId = String(driverIdRaw || '').trim();

    if (!routeId || !driverId) {
      return { ok: false, message: 'Rota e motorista sao obrigatorios.' };
    }

    const [route, driver] = await Promise.all([
      this.common.prisma.route.findUnique({ where: { id: routeId } }),
      this.common.prisma.driver.findUnique({ where: { id: driverId } }),
    ]);

    if (!route) return { ok: false, message: 'Rota nao encontrada.' };
    if (!driver) return { ok: false, message: 'Motorista nao encontrado.' };
    if (route.status === RouteStatus.BLOQUEADA) {
      return { ok: false, message: 'Rotas bloqueadas nao podem ser atribuidas.' };
    }
    if (driver.hasActiveRoute) {
      return { ok: false, message: 'Motorista ja possui uma rota ativa.' };
    }

    const normalizedRequired = normalizeVehicleType(route.requiredVehicleType || undefined);
    const normalizedDriver = normalizeVehicleType(driver.vehicleType || undefined);
    if (normalizedRequired === 'MOTO' && normalizedDriver !== 'MOTO') {
      return { ok: false, message: 'O motorista nao atende o veiculo requerido para a rota.' };
    }

    const nextStatus: RouteStatus = 'APROVADA';

    await this.common.prisma.route.update({
      where: { id: routeId },
      data: {
        requestedDriverId: driver.id,
        driverId: driver.id,
        driverName: driver.name,
        driverVehicleType: driver.vehicleType,
        driverAccuracy: null,
        driverPlate: null,
        status: nextStatus,
        assignedAt: new Date(),
      },
    });

    // Reflete na planilha — escreve o ID na coluna "ID Sugerido" da guia Reatribuição.
    if (route.sheetRowNumber) {
      try {
        await this.sheets.writeIdSugerido(route.sheetRowNumber, driver.id);
      } catch (error) {
        // Não desfaz a atribuição local se falhar a escrita.
      }
    }

    await this.common.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'MANUAL_ASSIGN',
      userId: 'system',
      userName: 'System',
      after: {
        driverId: driver.id,
        status: nextStatus,
        requestedDriverId: driver.id,
      },
    });

    return { ok: true, message: 'Rota atribuida com sucesso.' };
  }

  async unassignRoute(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    const route = await this.common.prisma.route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true },
    });

    await this.common.prisma.route.update({
      where: { id: routeId },
      data: {
        driverId: null,
        driverName: null,
        driverVehicleType: null,
        driverAccuracy: null,
        driverPlate: null,
        requestedDriverId: null,
        status: RouteStatus.DISPONIVEL,
        assignedAt: null,
      },
    });

    if (route?.sheetRowNumber) {
      try {
        await this.sheets.clearIdSugerido(route.sheetRowNumber);
      } catch (error) {
        // Ignora falha de escrita na planilha.
      }
    }

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
