import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RouteStatus } from '@prisma/client';
import { SheetsService } from '../sheets/sheets.service';
import { RedisService } from '../redis/redis.service';

const SYNC_LOCK_KEY = 'telegram:sync:lock';
const SYNC_PENDING_PREFIX = 'telegram:sync:pending';
const SYNC_TTL_SECONDS = 60 * 30;
const SYNC_PASSWORD = process.env.SYNC_PASSWORD || 'senhadoYuri';

type DriverRow = Record<string, string>;
type ConvocationStats = { total: number; declined: number };
type AvailabilityStatusValue =
  | 'available'
  | 'not_available'
  | 'pending_confirmation'
  | 'no_schedule';

export type SyncPendingType = 'all' | 'drivers';
export type SyncSummary = {
  drivers: number;
  routesAvailable: number;
  routesAssigned: number;
};
export type SyncRoutesSummary = {
  routesAvailable: number;
  routesAssigned: number;
};

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private lastScheduledRun: string | null = null;
  private readonly DASHBOARD_EXECUTIVE_CACHE_PREFIX = 'cache:dashboard:executive';
  private readonly DASHBOARD_NOSHOW_CACHE_PREFIX = 'cache:dashboard:noshow';
  private readonly DRIVERS_LIST_CACHE_PREFIX = 'cache:drivers:list';
  private readonly DRIVERS_ANALYTICS_CACHE_PREFIX = 'cache:drivers:analytics';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly redis: RedisService,
  ) {}

  private memorySnapshot() {
    const usage = process.memoryUsage();
    const toMb = (value: number) => Math.round(value / 1024 / 1024);
    return {
      rssMb: toMb(usage.rss),
      heapUsedMb: toMb(usage.heapUsed),
      heapTotalMb: toMb(usage.heapTotal),
    };
  }

  private logSync(message: string, meta?: Record<string, unknown>) {
    if (!meta) {
      this.logger.log(message);
      return;
    }
    this.logger.log(`${message} ${JSON.stringify(meta)}`);
  }

  onModuleInit() {
    setInterval(() => {
      void this.checkSchedule();
    }, 60 * 1000);
  }

  isPasswordValid(password: string) {
    return password === SYNC_PASSWORD;
  }

  pendingKey(chatId: string) {
    return `${SYNC_PENDING_PREFIX}:${chatId}`;
  }

  async setPending(chatId: string, type: SyncPendingType = 'all') {
    await this.redis.client().set(this.pendingKey(chatId), type, 'EX', 300);
  }

  async clearPending(chatId: string) {
    await this.redis.client().del(this.pendingKey(chatId));
  }

  async getPendingType(chatId: string): Promise<SyncPendingType | null> {
    const pending = await this.redis.client().get(this.pendingKey(chatId));
    if (pending === 'all' || pending === 'drivers') return pending;
    return null;
  }

  async isLocked(): Promise<boolean> {
    const lock = await this.redis.client().get(SYNC_LOCK_KEY);
    return !!lock;
  }

  private async lock() {
    await this.redis.client().set(SYNC_LOCK_KEY, '1', 'EX', SYNC_TTL_SECONDS);
  }

  private async unlock() {
    await this.redis.client().del(SYNC_LOCK_KEY);
  }

  private getSaoPauloTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    };
  }

  private async checkSchedule() {
    if (await this.isLocked()) return;

    const { year, month, day, hour, minute } = this.getSaoPauloTimeParts();
    const nowKey = `${year}-${month}-${day} ${hour}:${minute}`;
    if (this.lastScheduledRun === nowKey) return;

    const shouldRunDrivers = hour === '04' && minute === '00';
    if (!shouldRunDrivers) return;

    this.lastScheduledRun = nowKey;
    try {
      await this.syncDriversScheduled();
    } catch (error) {
      this.logger.error(
        'Falha na sincronizacao automatica de motoristas',
        (error as Error).stack,
      );
    }
  }

  private mapRows(headers: string[], rows: string[][]): DriverRow[] {
    return rows.map((row) => {
      const obj: DriverRow = {};
      headers.forEach((header, index) => {
        const key = header.trim();
        if (!key) return;
        obj[key] = row[index] ?? '';
      });
      return obj;
    });
  }

  private parsePercent(value?: string | null): number {
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    const cleaned = raw.replace('%', '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  private parseInteger(value?: string | null): number {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const match = raw.match(/-?\d+/);
    if (!match) return 0;
    const n = Number(match[0]);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  private extractDriverIdFromBrackets(value?: string | null): string | null {
    const raw = String(value || '');
    const match = raw.match(/\[([^\]]+)\]/);
    if (match) {
      const inBrackets = match[1].trim();
      if (inBrackets) return inBrackets;
    }

    const normalized = raw.trim();
    if (!normalized) return null;
    if (/^\d+$/.test(normalized)) return normalized;

    const numberMatch = normalized.match(/\b\d{3,}\b/);
    if (numberMatch) return numberMatch[0];
    return null;
  }

  private calculatePriorityScore(
    dsPercent: number,
    declineRate: number,
    noShowCount: number,
    weights?: {
      noShowWeight: number;
      declineWeight: number;
      dsWeight: number;
    },
  ): number {
    const config = weights || {
      noShowWeight: 30,
      declineWeight: 25,
      dsWeight: 20,
    };
    const totalWeight = Math.max(
      1,
      config.noShowWeight + config.declineWeight + config.dsWeight,
    );
    const noShowComponent = Math.max(0, 100 - noShowCount * 10);
    const score =
      (dsPercent * config.dsWeight +
        (100 - declineRate) * config.declineWeight +
        noShowComponent * config.noShowWeight) /
      totalWeight;
    const bounded = Math.max(0, Math.min(100, score));
    return Number(bounded.toFixed(2));
  }

  private async getAlgorithmConfig(): Promise<{
    noShowWeight: number;
    declineWeight: number;
    dsWeight: number;
    blockThreshold: number;
    autoBlock: boolean;
  }> {
    const row = await (this.prisma as any).systemConfig.findUnique({
      where: { key: 'algorithm' },
    });
    const value = (row?.value || {}) as Record<string, unknown>;
    const toNumber = (raw: unknown, fallback: number) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      noShowWeight: Math.max(0, toNumber(value.noShowWeight, 30)),
      declineWeight: Math.max(0, toNumber(value.declineWeight, 25)),
      dsWeight: Math.max(0, toNumber(value.dsWeight, 20)),
      blockThreshold: Math.max(0, Math.min(100, toNumber(value.blockThreshold, 70))),
      autoBlock: value.autoBlock === undefined ? true : Boolean(value.autoBlock),
    };
  }

  private async applyAutomaticBlocklist(
    driverId: string,
    reason: string,
    config: {
      noShowWeight: number;
      declineWeight: number;
      dsWeight: number;
      blockThreshold: number;
      autoBlock: boolean;
    },
  ): Promise<boolean> {
    const isNoviceWithoutDs = reason === 'Sem DS (novato - rota direto com analista)';
    if (!isNoviceWithoutDs && !config.autoBlock) {
      return false;
    }

    const prisma = this.prisma as any;
    const existing = await prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true, timesListed: true, reason: true },
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
      await this.redis.set(`telegram:blocklist:cache:driver:${driverId}`, true, 3600);
      return true;
    }

    const currentStatus = String(existing.status || '');
    if (currentStatus === 'BLOCKED' || currentStatus === 'ACTIVE') {
      await this.redis.set(`telegram:blocklist:cache:driver:${driverId}`, true, 3600);
      return false;
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
    await this.redis.set(`telegram:blocklist:cache:driver:${driverId}`, true, 3600);
    return true;
  }

  private async getRowsFromAnyRange(ranges: string[]): Promise<string[][]> {
    for (const range of ranges) {
      try {
        const rows = await this.sheets.getRows(range);
        if (rows.length) return rows;
      } catch (error) {
        // Ignore missing/invalid sheet names and try the next candidate.
      }
    }
    return [];
  }

  private async syncDriverPriorityMetrics(): Promise<void> {
    const algorithm = await this.getAlgorithmConfig();
    const disponibilidadeRows = await this.getRowsFromAnyRange([
      `'Disponibilidade'!A:E`,
      `'disponibilidade'!A:E`,
    ]);
    const convocacaoRows = await this.getRowsFromAnyRange([
      `'Convocação'!A:J`,
      `'Convocacao'!A:J`,
      `'convocacao'!A:J`,
    ]);

    const noShowByDriver = new Map<string, number>();
    disponibilidadeRows.slice(1).forEach((row) => {
      const driverId = String(row[0] || '').trim();
      if (!driverId) return;
      const noShowCount = this.parseInteger(row[4]);
      noShowByDriver.set(driverId, noShowCount);
    });

    const convocationByDriver = new Map<string, ConvocationStats>();
    convocacaoRows.slice(1).forEach((row) => {
      const driverId = this.extractDriverIdFromBrackets(row[3]);
      if (!driverId) return;

      const status = String(row[9] || '').trim().toLowerCase();
      const previous = convocationByDriver.get(driverId) || { total: 0, declined: 0 };
      previous.total += 1;
      if (status.includes('declin')) previous.declined += 1;
      convocationByDriver.set(driverId, previous);
    });

    const sheetDriverIds = Array.from(
      new Set([
        ...noShowByDriver.keys(),
        ...convocationByDriver.keys(),
      ]),
    );
    if (sheetDriverIds.length) {
      await this.ensureDriversExist(sheetDriverIds);
    }

    const prisma = this.prisma as any;
    const drivers = await prisma.driver.findMany({
      select: { id: true, ds: true },
    });
    let changedAutoBlock = false;

    for (const driver of drivers) {
      const conv = convocationByDriver.get(driver.id) || { total: 0, declined: 0 };
      const noShowCount = noShowByDriver.get(driver.id) || 0;
      const declineRate = conv.total > 0 ? (conv.declined / conv.total) * 100 : 0;
      const hasDs = Boolean(String(driver.ds || '').trim());
      const dsPercent = this.parsePercent(driver.ds);
      const priorityScore = this.calculatePriorityScore(dsPercent, declineRate, noShowCount, algorithm);

      await prisma.driver.update({
        where: { id: driver.id },
        data: {
          noShowCount,
          declineRate: Number(declineRate.toFixed(2)),
          priorityScore,
        },
      });

      const autoBlockReason =
        !hasDs
          ? 'Sem DS (novato - rota direto com analista)'
          : priorityScore <= algorithm.blockThreshold
            ? 'Score baixo'
            : null;

      if (autoBlockReason && await this.applyAutomaticBlocklist(driver.id, autoBlockReason, algorithm)) {
        changedAutoBlock = true;
      }
    }

    await this.clearRedisPatterns([
      `${this.DASHBOARD_EXECUTIVE_CACHE_PREFIX}:*`,
      `${this.DASHBOARD_NOSHOW_CACHE_PREFIX}:*`,
      `${this.DRIVERS_LIST_CACHE_PREFIX}:*`,
      `${this.DRIVERS_ANALYTICS_CACHE_PREFIX}:*`,
    ]);

    if (changedAutoBlock) {
      this.logger.log('Bloqueio automatico aplicado para um ou mais motoristas no sync.');
    }
  }

  private async clearRedisPatterns(patterns: string[]) {
    const client = this.redis.client();
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length) await client.del(...keys);
      } while (cursor !== '0');
    }
  }

  async resetRedisStateManual(): Promise<void> {
    await this.clearRedisPatterns([
      'telegram:queue:*',
      'telegram:state:*',
      'telegram:route:timeout*',
      'telegram:queue:member:*',
      'telegram:queue:moto:*',
      'telegram:queue:general:*',
      `${SYNC_PENDING_PREFIX}:*`,
      'telegram:blacklist:cache:driver:*',
      'telegram:blocklist:cache:driver:*',
    ]);
  }

  private async ensureDriversExist(driverIds: string[]) {
    const uniqueIds = Array.from(new Set(driverIds.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) return;

    const existing = await this.prisma.driver.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });

    const existingSet = new Set(existing.map((driver) => driver.id));
    const missing = uniqueIds.filter((id) => !existingSet.has(id));
    if (!missing.length) return;

    await this.prisma.driver.createMany({
      data: missing.map((id) => ({ id })),
      skipDuplicates: true,
    });
  }

  private getHeaderIndex(headers: string[], candidates: string[]) {
    const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
    for (const candidate of candidates) {
      const idx = normalizedHeaders.indexOf(candidate.toLowerCase());
      if (idx >= 0) return idx;
    }
    return -1;
  }

  /**
   * Sync de motoristas: lê Perfil de Motorista, e cruza com a coluna K
   * de "Visão Geral Atribuições" para marcar quem já tem rota ativa.
   */
  private async syncDriversFromSheets() {
    this.logSync('Sync motoristas: inicio');
    // Lê range largo para garantir que a coluna DS esteja incluída mesmo se a planilha
    // tiver crescido em colunas (passamos de A:BF para A:ZZ).
    const driverRows = await this.sheets.getRows(`'Perfil de Motorista'!A:ZZ`);
    if (!driverRows.length) throw new Error('Planilha Perfil de Motorista vazia');
    const [driverHeaders, ...driverData] = driverRows;

    const drivers = this.mapRows(driverHeaders, driverData);
    const statusIndex = this.getHeaderIndex(driverHeaders, ['Status', 'Driver Status']);
    // DS: aceita variações comuns do cabeçalho (com espaço, com %, etc).
    const dsIndex = this.getHeaderIndex(driverHeaders, [
      'DS',
      'DS %',
      'DS%',
      'DS Médio',
      'DS Medio',
      'DS Atual',
      'DS atual',
      'DS Final',
      'DS final',
    ]);
    if (dsIndex < 0) {
      this.logger.warn(
        `Sync motoristas: cabeçalho de DS não encontrado em "Perfil de Motorista". ` +
          `Cabeçalhos disponíveis: ${driverHeaders
            .map((h) => `"${String(h || '').trim()}"`)
            .filter((h) => h !== '""')
            .join(', ')}`,
      );
    }

    const activeDriverIds = new Set(
      await this.sheets.getActiveDriverIdsFromAssignmentOverview(),
    );

    let driverCount = 0;
    let activeCount = 0;
    let driversWithDs = 0;
    const prisma = this.prisma as any;
    for (let index = 0; index < drivers.length; index += 1) {
      const row = drivers[index];
      const rawRow = driverData[index] ?? [];
      const driverId = row['Driver ID']?.trim();
      if (!driverId) continue;
      driverCount += 1;

      const vehicleType = row['Vehicle Type']?.trim() || null;
      const rawDs =
        dsIndex >= 0 ? String(rawRow[dsIndex] ?? '').trim() : '';
      const ds = rawDs || null;
      if (ds) driversWithDs += 1;
      const status =
        (statusIndex >= 0 ? String(rawRow[statusIndex] || '').trim() : '') ||
        String(rawRow[51] || '').trim() ||
        null;

      const hasActiveRoute = activeDriverIds.has(driverId);
      if (hasActiveRoute) activeCount += 1;

      await prisma.driver.upsert({
        where: { id: driverId },
        update: {
          name: row['Driver Name'] || null,
          status,
          vehicleType,
          ds,
          hasActiveRoute,
        },
        create: {
          id: driverId,
          name: row['Driver Name'] || null,
          status,
          vehicleType,
          ds,
          hasActiveRoute,
        },
      });
    }

    // Motoristas que estão na coluna K mas não estão no Perfil de Motorista:
    // garantimos existência e marcamos como ativos.
    const missingActive = Array.from(activeDriverIds).filter(
      (id) => !drivers.some((d) => d['Driver ID']?.trim() === id),
    );
    if (missingActive.length) {
      await this.ensureDriversExist(missingActive);
      await prisma.driver.updateMany({
        where: { id: { in: missingActive } },
        data: { hasActiveRoute: true },
      });
      activeCount += missingActive.length;
    }

    // Garante consistência: qualquer driver no banco que NÃO esteja na coluna K
    // tem hasActiveRoute zerado. Cobre o edge case do motorista que foi removido
    // tanto de "Perfil de Motorista" quanto de "Visão Geral Atribuições" mas
    // ficou com a flag true de uma rodada anterior.
    const activeIdsList = Array.from(activeDriverIds);
    const clearedCount = await prisma.driver.updateMany({
      where: {
        hasActiveRoute: true,
        ...(activeIdsList.length ? { id: { notIn: activeIdsList } } : {}),
      },
      data: { hasActiveRoute: false },
    });

    this.logSync('Sync motoristas: concluido', {
      hasActiveRouteCleared: clearedCount.count,
      rowsRead: driverRows.length - 1,
      driversProcessed: driverCount,
      driversWithActiveRoute: activeCount,
      driversWithDs,
      dsHeaderIndex: dsIndex,
      memory: this.memorySnapshot(),
    });

    return driverCount;
  }

  private parseAvailabilityCell(rawValue: string): {
    status: AvailabilityStatusValue;
    availableAm: boolean;
    availablePm: boolean;
  } {
    const normalized = String(rawValue || '').trim().toUpperCase();
    if (!normalized || normalized === '--') {
      return { status: 'no_schedule', availableAm: false, availablePm: false };
    }
    if (normalized.includes('PENDING AVAILABILITY CONFIRMATION')) {
      return { status: 'pending_confirmation', availableAm: false, availablePm: false };
    }
    if (normalized.includes('NOT AVAILABLE')) {
      return { status: 'not_available', availableAm: false, availablePm: false };
    }

    const availableAm = normalized.includes('05:30-09:00') || normalized.includes('06:00-09:00');
    const availablePm = normalized.includes('11:15-15:00') || normalized.includes('11:00-14:30');
    if (availableAm || availablePm) {
      return { status: 'available', availableAm, availablePm };
    }

    return { status: 'no_schedule', availableAm: false, availablePm: false };
  }

  private normalizeRouteDate(value?: string | null): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const toIsoDate = (year: string, month: string, day: string) => {
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      const yearNumber = Number(year);
      if (
        !Number.isInteger(yearNumber) ||
        !Number.isInteger(monthNumber) ||
        !Number.isInteger(dayNumber) ||
        monthNumber < 1 ||
        monthNumber > 12 ||
        dayNumber < 1 ||
        dayNumber > 31
      ) {
        return null;
      }

      const candidate = new Date(
        Date.UTC(yearNumber, monthNumber - 1, dayNumber),
      );
      if (
        candidate.getUTCFullYear() !== yearNumber ||
        candidate.getUTCMonth() + 1 !== monthNumber ||
        candidate.getUTCDate() !== dayNumber
      ) {
        return null;
      }

      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    };

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return toIsoDate(year, month, day);
    }

    const localDateMatch = raw.match(/^(\d{1,2})([-\/])(\d{1,2})\2(\d{4})(?:\s+.*)?$/);
    if (localDateMatch) {
      const [, first, , second, year] = localDateMatch;
      const firstNumber = Number(first);
      const secondNumber = Number(second);

      if (firstNumber > 12 && secondNumber <= 12) {
        return toIsoDate(year, second, first);
      }
      if (secondNumber > 12 && firstNumber <= 12) {
        return toIsoDate(year, first, second);
      }

      const ddMmYyyy = toIsoDate(year, second, first);
      if (ddMmYyyy) {
        return ddMmYyyy;
      }

      return toIsoDate(year, first, second);
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  private async syncDriverAvailabilityFromSheet() {
    this.logSync('Sync disponibilidade: inicio');
    let availabilityRows: any[][] = [];
    try {
      availabilityRows = await this.sheets.getRows(`'Disponibilidade'!A:ZZ`);
    } catch {
      try {
        availabilityRows = await this.sheets.getRows(`'disponibilidade'!A:ZZ`);
      } catch {
        this.logSync('Sync disponibilidade: guia nao encontrada, pulando etapa');
        return 0;
      }
    }
    if (!availabilityRows.length) {
      this.logSync('Sync disponibilidade: planilha vazia');
      return 0;
    }

    const [headers, ...rows] = availabilityRows;
    const idIndex = this.getHeaderIndex(headers, ['Driver ID', 'ID']);
    const nameIndex = this.getHeaderIndex(headers, ['Driver Name', 'Nome']);
    const clusterIndex = this.getHeaderIndex(headers, ['Cluster', 'Clusters']);
    const vehicleIndex = this.getHeaderIndex(headers, ['Vehicle Type', 'Tipo de veiculo']);
    const noShowIndex = this.getHeaderIndex(headers, ['No Show Time', 'No Show']);

    const dateColumns = headers
      .map((header, index) => ({
        index,
        date: this.normalizeRouteDate(String(header || '').trim()),
      }))
      .filter((item): item is { index: number; date: string } => !!item.date);

    if (idIndex < 0 || !dateColumns.length) {
      this.logSync('Sync disponibilidade: sem colunas obrigatorias', {
        idIndex,
        dateColumns: dateColumns.length,
      });
      return 0;
    }

    const driverIds = new Set<string>();
    const availabilityEntries: Array<{
      driverId: string;
      availabilityDate: string;
      rawValue: string | null;
      status: AvailabilityStatusValue;
      availableAm: boolean;
      availablePm: boolean;
      clusterRaw: string | null;
      vehicleType: string | null;
      noShowTime: number;
    }> = [];

    for (const row of rows) {
      const driverId = String(row[idIndex] || '').trim();
      if (!driverId) continue;
      driverIds.add(driverId);

      const name = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '';
      const vehicleType = vehicleIndex >= 0 ? String(row[vehicleIndex] || '').trim() || null : null;
      const clusterRaw = clusterIndex >= 0 ? String(row[clusterIndex] || '').trim() || null : null;
      const noShowTime = noShowIndex >= 0 ? Number(String(row[noShowIndex] || '').trim() || '0') || 0 : 0;

      await this.prisma.driver.upsert({
        where: { id: driverId },
        update: {
          name: name || null,
          vehicleType,
        },
        create: {
          id: driverId,
          name: name || null,
          vehicleType,
        },
      });

      for (const dateColumn of dateColumns) {
        const rawCell = String(row[dateColumn.index] || '').trim();
        const parsed = this.parseAvailabilityCell(rawCell);
        availabilityEntries.push({
          driverId,
          availabilityDate: dateColumn.date,
          rawValue: rawCell || null,
          status: parsed.status,
          availableAm: parsed.availableAm,
          availablePm: parsed.availablePm,
          clusterRaw,
          vehicleType,
          noShowTime,
        });
      }
    }

    if (!availabilityEntries.length) {
      this.logSync('Sync disponibilidade: sem dados para persistir');
      return 0;
    }

    const dates = Array.from(new Set(availabilityEntries.map((entry) => entry.availabilityDate)));
    try {
      await (this.prisma as any).driverAvailability.deleteMany({
        where: {
          availabilityDate: { in: dates },
        },
      });

      await (this.prisma as any).driverAvailability.createMany({
        data: availabilityEntries,
        skipDuplicates: true,
      });
    } catch (error) {
      this.logSync('Sync disponibilidade: tabela indisponivel, etapa ignorada', {
        error: (error as Error).message,
      });
      return 0;
    }

    this.logSync('Sync disponibilidade: concluido', {
      rowsRead: rows.length,
      drivers: driverIds.size,
      entries: availabilityEntries.length,
      dates: dates.length,
      memory: this.memorySnapshot(),
    });

    return availabilityEntries.length;
  }

  /**
   * Sync de rotas: apaga TODA a tabela Route e reimporta a partir da guia Reatribuição.
   * Disparado manualmente pelo botão do frontend.
   */
  async syncRoutesFromReatribuicao(): Promise<SyncRoutesSummary> {
    this.logSync('Sync rotas (Reatribuição): inicio');
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao de rotas iniciada' },
    });

    try {
      const sheetRoutes = await this.sheets.getReatribuicaoRoutes();
      this.logSync('Sync rotas (Reatribuição): planilha lida', {
        rows: sheetRoutes.length,
      });

      // Wipe + reload — fonte única de verdade é a planilha.
      await this.prisma.route.deleteMany({});

      let availableCount = 0;
      let assignedCount = 0;

      if (sheetRoutes.length) {
        const data = sheetRoutes.map((r) => {
          const hasRequested = !!(r.requestedDriverId && r.requestedDriverId.trim());
          if (hasRequested) assignedCount += 1;
          else availableCount += 1;
          return {
            id: r.atId,
            atId: r.atId,
            routeDate: r.routeDate || null,
            cluster: r.cluster || null,
            gaiola: r.gaiola || null,
            cidade: r.cidade || null,
            requiredVehicleType: r.requiredVehicleType || null,
            km: r.km || null,
            spr: r.spr || null,
            paradas: r.paradas || null,
            requestedDriverId: hasRequested ? r.requestedDriverId : null,
            sheetRowNumber: r.rowIndex,
            status: (hasRequested ? 'ATRIBUIDA' : 'DISPONIVEL') as RouteStatus,
          };
        });

        await this.prisma.route.createMany({ data, skipDuplicates: true });
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          routesAvailable: availableCount,
          routesAssigned: assignedCount,
          message: 'Sincronizacao de rotas concluida',
        },
      });

      this.logSync('Sync rotas (Reatribuição): sucesso', {
        availableCount,
        assignedCount,
      });

      return { routesAvailable: availableCount, routesAssigned: assignedCount };
    } catch (error) {
      this.logger.error(
        `Sync rotas (Reatribuição): falha ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          message: (error as Error).message,
        },
      });
      throw error;
    } finally {
      await this.unlock();
    }
  }

  async syncDriversScheduled(): Promise<number> {
    this.logSync('Sync motoristas agendado: inicio');
    const prisma = this.prisma as any;
    const log = await prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao de motoristas iniciada' },
    });

    try {
      const driverCount = await this.syncDriversFromSheets();
      await this.syncDriverPriorityMetrics();
      await this.syncDriverAvailabilityFromSheet();
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          driversCount: driverCount,
          message: 'Sincronizacao de motoristas concluida',
        },
      });
      this.logSync('Sync motoristas agendado: sucesso', {
        driversCount: driverCount,
        memory: this.memorySnapshot(),
      });
      return driverCount;
    } catch (error) {
      this.logger.error(
        `Sync motoristas agendado: falha ${(error as Error).message}`,
        (error as Error).stack,
      );
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          message: (error as Error).message,
        },
      });
      throw error;
    }
  }

  /**
   * Sync completo manual — motoristas + rotas (Reatribuição). Mantido para compatibilidade
   * com o botão antigo de "sincronizar tudo".
   */
  async syncAll(): Promise<SyncSummary> {
    this.logSync('Sync completo: inicio');
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao iniciada' },
    });

    try {
      const driverCount = await this.syncDriversFromSheets();
      await this.syncDriverPriorityMetrics();
      await this.syncDriverAvailabilityFromSheet();

      // Reaproveita o pipeline de rotas via Reatribuição.
      // Como já estamos com o lock, chamamos a leitura/escrita inline.
      const sheetRoutes = await this.sheets.getReatribuicaoRoutes();
      await this.prisma.route.deleteMany({});
      let availableCount = 0;
      let assignedCount = 0;
      if (sheetRoutes.length) {
        const data = sheetRoutes.map((r) => {
          const hasRequested = !!(r.requestedDriverId && r.requestedDriverId.trim());
          if (hasRequested) assignedCount += 1;
          else availableCount += 1;
          return {
            id: r.atId,
            atId: r.atId,
            routeDate: r.routeDate || null,
            cluster: r.cluster || null,
            gaiola: r.gaiola || null,
            cidade: r.cidade || null,
            requiredVehicleType: r.requiredVehicleType || null,
            km: r.km || null,
            spr: r.spr || null,
            paradas: r.paradas || null,
            requestedDriverId: hasRequested ? r.requestedDriverId : null,
            sheetRowNumber: r.rowIndex,
            status: (hasRequested ? 'ATRIBUIDA' : 'DISPONIVEL') as RouteStatus,
          };
        });
        await this.prisma.route.createMany({ data, skipDuplicates: true });
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          driversCount: driverCount,
          routesAvailable: availableCount,
          routesAssigned: assignedCount,
          message: 'Sincronizacao concluida',
        },
      });

      this.logSync('Sync completo: sucesso', {
        drivers: driverCount,
        routesAvailable: availableCount,
        routesAssigned: assignedCount,
      });

      return {
        drivers: driverCount,
        routesAvailable: availableCount,
        routesAssigned: assignedCount,
      };
    } catch (error) {
      this.logger.error(
        `Sync completo: falha ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          message: (error as Error).message,
        },
      });
      throw error;
    } finally {
      await this.unlock();
    }
  }

  /** Mantido por compat — agora delega para syncRoutesFromReatribuicao. */
  async syncRoutesOnly(): Promise<SyncRoutesSummary> {
    return this.syncRoutesFromReatribuicao();
  }
}
