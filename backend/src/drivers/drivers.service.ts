import { Injectable } from '@nestjs/common';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class DriversService {
  constructor(private readonly common: AdminCommonService) {}

  async getDrivers() {
    return this.common.prisma.driver.findMany({
      orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async updateDriverPriorityScore(driverId: string, priorityScoreRaw: number) {
    const priorityScore = Number(priorityScoreRaw);
    if (!Number.isFinite(priorityScore) || priorityScore < 0 || priorityScore > 100) {
      return { ok: false, message: 'Priority score deve estar entre 0 e 100.' };
    }

    const parsedDriverId = String(driverId).trim();
    const before = await this.common.prisma.driver.findUnique({
      where: { id: parsedDriverId },
      select: { priorityScore: true },
    });
    await this.common.prisma.driver.update({
      where: { id: parsedDriverId },
      data: { priorityScore },
    });
    await this.common.recordAudit({
      entityType: 'Driver',
      entityId: parsedDriverId,
      action: 'UPDATE_PRIORITY',
      userId: 'system',
      userName: 'System',
      before: before ? { priorityScore: before.priorityScore } : null,
      after: { priorityScore },
    });

    return { ok: true, message: 'Priority score atualizado com sucesso.' };
  }

  async resetDriverNoShow(driverId: string) {
    const parsedDriverId = String(driverId).trim();
    const before = await this.common.prisma.driver.findUnique({
      where: { id: parsedDriverId },
      select: { noShowCount: true },
    });
    await this.common.prisma.driver.update({
      where: { id: parsedDriverId },
      data: { noShowCount: 0 },
    });
    await this.common.recordAudit({
      entityType: 'Driver',
      entityId: parsedDriverId,
      action: 'RESET_NOSHOW',
      userId: 'system',
      userName: 'System',
      before: before ? { noShowCount: before.noShowCount } : null,
      after: { noShowCount: 0 },
    });

    return { ok: true, message: 'No-show resetado com sucesso.' };
  }

  async getBlocklist() {
    return this.common.prisma.driverBlocklist.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async addBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.common.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.common.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });

    if (!existing) {
      await this.common.prisma.driverBlocklist.create({
        data: {
          driverId,
          status: 'BLOCKED' as any,
          timesListed: 1,
          lastActivatedAt: new Date(),
        },
      });
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
      return { ok: true, message: `Motorista ${driverId} adicionado na lista de bloqueio (bloqueado).` };
    }

    if (String(existing.status) === 'BLOCKED') {
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta bloqueado na lista de bloqueio.` };
    }

    await this.common.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'BLOCKED' as any,
        timesListed: { increment: 1 },
        lastActivatedAt: new Date(),
      },
    });
    await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
    return { ok: true, message: `Motorista ${driverId} bloqueado novamente na lista de bloqueio.` };
  }

  async removeBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.common.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.common.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });
    if (!existing) {
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), false, 3600);
      return { ok: false, message: `Motorista ${driverId} nao esta cadastrado na lista de bloqueio.` };
    }

    if (String(existing.status) === 'UNBLOCKED') {
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), false, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta desbloqueado na lista de bloqueio.` };
    }

    await this.common.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'UNBLOCKED' as any,
        lastInactivatedAt: new Date(),
      },
    });
    await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), false, 3600);
    return { ok: true, message: `Motorista ${driverId} marcado como desbloqueado na lista de bloqueio.` };
  }
}
