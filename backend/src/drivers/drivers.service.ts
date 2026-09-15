import { Injectable, Logger } from '@nestjs/common';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);
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

  // ──────────────────────────────────────────────────────────────────────
  // SPX CSV import — enriches Driver rows with registration data
  // ──────────────────────────────────────────────────────────────────────

  private normalizeSpxId(raw: string): string {
    // SPX exports Driver ID in scientific notation (Excel artifact): "4.250019e+06" → "4250019"
    const trimmed = String(raw || '').trim()
    if (!trimmed) return ''
    const asFloat = parseFloat(trimmed)
    if (!isNaN(asFloat)) return String(Math.round(asFloat))
    return trimmed
  }

  private parseSpxCsv(csvText: string): Record<string, string>[] {
    // Strip BOM if present
    const text = csvText.replace(/^﻿/, '')
    const lines = text.split(/\r?\n/)
    if (lines.length < 2) return []

    const parseLine = (line: string): string[] => {
      const cols: string[] = []
      let inQuotes = false
      let cur = ''
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
          else inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
          cols.push(cur.trim())
          cur = ''
        } else {
          cur += ch
        }
      }
      cols.push(cur.trim())
      return cols
    }

    const headers = parseLine(lines[0])
    const rows: Record<string, string>[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const cols = parseLine(line)
      const row: Record<string, string> = {}
      headers.forEach((h, idx) => {
        // Strip leading single-quote (Excel "force text" prefix)
        row[h.trim()] = String(cols[idx] ?? '').replace(/^'/, '').trim()
      })
      rows.push(row)
    }
    return rows
  }

  async importSpxCsv(csvText: string): Promise<{
    ok: boolean
    total: number
    updated: number
    skipped: number
    message: string
  }> {
    const rows = this.parseSpxCsv(csvText)
    if (!rows.length) return { ok: false, total: 0, updated: 0, skipped: 0, message: 'CSV vazio ou sem dados válidos.' }

    const firstRow = rows[0]
    if (!('Driver ID' in firstRow) || !('Driver Name' in firstRow)) {
      return { ok: false, total: 0, updated: 0, skipped: 0, message: 'CSV não parece ser o relatório de motoristas da SPX (colunas "Driver ID" e "Driver Name" ausentes).' }
    }

    const prisma = this.common.prisma as any
    let updated = 0
    let skipped = 0

    for (const row of rows) {
      const rawId = row['Driver ID']
      const driverId = this.normalizeSpxId(rawId)
      if (!driverId) { skipped++; continue }

      const data: Record<string, unknown> = {
        name: row['Driver Name'] || undefined,
        vehicleType: row['Vehicle Type'] || undefined,
        status: row['Status'] || undefined,
        gender: row['Gender'] || null,
        phoneNumber: row['Phone Number'] || null,
        licensePlate: row['License Plate'] || null,
        licenseExpiryDate: row['License Expiry Date'] || null,
        contractType: row['Contract Type'] || null,
        joinedDate: row['Joined Date'] || null,
        city: row['City'] || null,
        agency: row['Agency'] || null,
        dateOfBirth: row['Date of Birth'] || null,
        vehicleManufacturer: row["Vehicle's manufacturer"] || null,
        vehicleManufacturingYear: row["Vehicle's manufacturing year"] || null,
        lastKycDate: row['Last KYC Date'] || null,
        vehicleKycDate: row['Vehicle KYC Date'] || null,
        suspensionReason: row['Suspension Reason'] || null,
        spxBlocklisted: String(row['Blocklist'] || '').toUpperCase() === 'YES',
      }

      // Remove undefined values (don't overwrite existing data with empty)
      Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k] })

      try {
        await prisma.driver.upsert({
          where: { id: driverId },
          update: data,
          create: { id: driverId, ...data },
        })
        updated++
      } catch (err) {
        this.logger.warn(`importSpxCsv: erro ao upsert driver ${driverId}: ${err}`)
        skipped++
      }
    }

    this.logger.log(`importSpxCsv: ${updated} atualizados, ${skipped} ignorados de ${rows.length} linhas`)
    return {
      ok: true,
      total: rows.length,
      updated,
      skipped,
      message: `${updated} motoristas atualizados com dados cadastrais da SPX.`,
    }
  }

  async getBlocklist() {
    return this.common.prisma.driverBlocklist.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async addBlocklistDriver(driverIdRaw: string, reasonRaw?: string): Promise<{ ok: boolean; message: string }> {
    const prisma = this.common.prisma as any;
    const driverId = this.common.normalizeDriverId(driverIdRaw);
    const reason = String(reasonRaw || '').trim();
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };
    if (!reason) return { ok: false, message: 'Informe a justificativa do bloqueio.' };

    const existing = await prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true, reason: true },
    });

    if (!existing) {
      await prisma.driverBlocklist.create({
        data: {
          driverId,
          status: 'BLOCKED' as any,
          reason,
          timesListed: 1,
          lastActivatedAt: new Date(),
        },
      });
      await prisma.blockedQueueRequest.updateMany({
        where: { driverId },
        data: {
          status: 'REJECTED',
          cooldownUntil: null,
          resolvedAt: new Date(),
          approvedById: null,
          approvedByName: null,
        },
      });
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
      return { ok: true, message: `Motorista ${driverId} adicionado na lista de bloqueio (bloqueado).` };
    }

    if (String(existing.status) === 'BLOCKED') {
      await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta bloqueado na lista de bloqueio.` };
    }

    await prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'BLOCKED' as any,
        reason,
        timesListed: { increment: 1 },
        lastActivatedAt: new Date(),
      },
    });
    await prisma.blockedQueueRequest.updateMany({
      where: { driverId },
      data: {
        status: 'REJECTED',
        cooldownUntil: null,
        resolvedAt: new Date(),
        approvedById: null,
        approvedByName: null,
      },
    });
    await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), true, 3600);
    return { ok: true, message: `Motorista ${driverId} bloqueado novamente na lista de bloqueio.` };
  }

  async removeBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const prisma = this.common.prisma as any;
    const driverId = this.common.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await prisma.driverBlocklist.findUnique({
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

    await prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'UNBLOCKED' as any,
        reason: null,
        lastInactivatedAt: new Date(),
      },
    });
    await prisma.blockedQueueRequest.updateMany({
      where: { driverId },
      data: {
        status: 'CONSUMED',
        cooldownUntil: null,
        resolvedAt: new Date(),
      },
    });
    await this.common.redisService.set(this.common.getBlocklistCacheKey(driverId), false, 3600);
    return { ok: true, message: `Motorista ${driverId} marcado como desbloqueado na lista de bloqueio.` };
  }
}
