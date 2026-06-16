import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { AdminCommonService } from '../admin-common/admin-common.service';
import { SyncService } from '../sync/sync.service';
import { SheetsService } from '../sheets/sheets.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class RoutesAdminService {
  constructor(
    private readonly common: AdminCommonService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Notifica o motorista no Telegram sobre o resultado da análise da rota.
   * Falha silenciosamente — não bloqueia o fluxo principal se o chat não
   * estiver vinculado ou se o envio falhar.
   */
  private async notifyDriverDecision(
    driverId: string,
    kind: 'APPROVED' | 'REJECTED',
    atLabel: string,
  ) {
    try {
      const chatId = await this.common.redisService
        .client()
        .get(`telegram:driver:chat:${String(driverId).trim()}`);
      const numericChatId = Number(chatId);
      if (!Number.isSafeInteger(numericChatId) || numericChatId <= 0) return;

      const message =
        kind === 'APPROVED'
          ? `✅ Sua solicitação da rota ${atLabel} foi aprovada!\n\n` +
            `A confirmação chegará no aplicativo. Você só vai carregar se aceitar no SPX Motorista Parceiro ou se o analista autorizar pelo WhatsApp.`
          : `❌ Sua solicitação da rota ${atLabel} não foi aprovada.\n\n` +
            `Para saber mais, entre em contato com o analista.`;

      await this.telegram.sendMessage(numericChatId, message);
    } catch {
      // ignora — comunicação opcional
    }
  }

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

    await this.notifyDriverDecision(
      driver.id,
      'APPROVED',
      route.atId || route.id,
    );

    return { ok: true, message: 'Rota atribuida com sucesso.' };
  }

  async unassignRoute(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    const route = await this.common.prisma.route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true, atId: true, driverId: true, requestedDriverId: true },
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

    const notifyDriverId = route?.driverId || route?.requestedDriverId;
    if (notifyDriverId) {
      await this.notifyDriverDecision(
        notifyDriverId,
        'REJECTED',
        route?.atId || routeId,
      );
    }

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
