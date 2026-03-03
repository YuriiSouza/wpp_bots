import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RouteStatus } from '@prisma/client';
import { SheetsService } from '../sheets/sheets.service';
import { RedisService } from '../redis/redis.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';

type RouteAssignmentSourceValue = 'SYNC' | 'MANUAL' | 'TELEGRAM_BOT';

const SYNC_LOCK_KEY = 'telegram:sync:lock';
const SYNC_PENDING_PREFIX = 'telegram:sync:pending';
const SYNC_TTL_SECONDS = 60 * 30;
const SYNC_PASSWORD = process.env.SYNC_PASSWORD || 'senhadoYuri';

type DriverRow = Record<string, string>;
type RouteRow = Record<string, string>;
type OverviewRow = Record<string, string>;
type ConvocationStats = { total: number; declined: number };
type RouteRecordInput = {
  atId: string;
  routeDate: string | null;
  shift: string | null;
  gaiola: string | null;
  bairro: string | null;
  cidade: string | null;
  requiredVehicleType: string | null;
  requiredVehicleTypeNorm: string | null;
  suggestionDriverDs: string | null;
  km: string | null;
  spr: string | null;
  volume: string | null;
  gg: string | null;
  veiculoRoterizado: string | null;
  requestedDriverId: string | null;
  assignmentSource: RouteAssignmentSourceValue;
  sheetRowNumber: number;
  driverId: string | null;
  driverName: string | null;
  driverVehicleType: string | null;
  driverAccuracy: string | null;
  driverPlate: string | null;
  status: RouteStatus;
  assignedAt: Date | null;
};
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
export type SyncRouteAssignmentsSummary = {
  routesAvailable: number;
  routesAssigned: number;
  processed: number;
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

  private mapRouteRows(headers: string[], rows: string[][]): RouteRow[] {
    return rows.map((row) => {
      const obj: RouteRow = {};
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
    priorityScore: number,
    config: {
      noShowWeight: number;
      declineWeight: number;
      dsWeight: number;
      blockThreshold: number;
      autoBlock: boolean;
    },
  ): Promise<boolean> {
    if (!config.autoBlock || priorityScore > config.blockThreshold) {
      return false;
    }

    const existing = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true, timesListed: true },
    });

    if (!existing) {
      await this.prisma.driverBlocklist.create({
        data: {
          driverId,
          status: 'BLOCKED' as any,
          timesListed: 1,
          lastActivatedAt: new Date(),
        },
      });
      await this.redis.client().set(`telegram:blocklist:cache:driver:${driverId}`, '1', 'EX', 3600);
      return true;
    }

    const currentStatus = String(existing.status || '');
    if (currentStatus === 'BLOCKED' || currentStatus === 'ACTIVE') {
      await this.redis.client().set(`telegram:blocklist:cache:driver:${driverId}`, '1', 'EX', 3600);
      return false;
    }

    await this.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'BLOCKED' as any,
        timesListed: { increment: 1 },
        lastActivatedAt: new Date(),
      },
    });
    await this.redis.client().set(`telegram:blocklist:cache:driver:${driverId}`, '1', 'EX', 3600);
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

    const drivers = await this.prisma.driver.findMany({
      select: { id: true, ds: true },
    });
    let changedAutoBlock = false;

    for (const driver of drivers) {
      const conv = convocationByDriver.get(driver.id) || { total: 0, declined: 0 };
      const noShowCount = noShowByDriver.get(driver.id) || 0;
      const declineRate = conv.total > 0 ? (conv.declined / conv.total) * 100 : 0;
      const dsPercent = this.parsePercent(driver.ds);
      const priorityScore = this.calculatePriorityScore(dsPercent, declineRate, noShowCount, algorithm);

      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          noShowCount,
          declineRate: Number(declineRate.toFixed(2)),
          priorityScore,
        },
      });

      if (await this.applyAutomaticBlocklist(driver.id, priorityScore, algorithm)) {
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
      'driver:hasRoute:*',
      'routes:available:*',
      `${SYNC_PENDING_PREFIX}:*`,
      'telegram:blacklist:cache:driver:*',
      'telegram:blocklist:cache:driver:*',
    ]);
  }

  private columnIndexToLetter(index: number) {
    let result = '';
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  private buildRouteUpdateRange(rowIndex: number, startIndex: number, endIndex: number) {
    const start = this.columnIndexToLetter(startIndex);
    const end = this.columnIndexToLetter(endIndex);
    return `'Rotas recusadas'!${start}${rowIndex}:${end}${rowIndex}`;
  }

  private async runInBatches<T>(
    items: T[],
    batchSize: number,
    worker: (item: T) => Promise<unknown>,
  ) {
    for (let index = 0; index < items.length; index += batchSize) {
      const batch = items.slice(index, index + batchSize);
      await Promise.all(batch.map((item) => worker(item)));
    }
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

  private extractOverviewDriverId(
    headers: string[],
    row: string[],
  ): string | null {
    const candidates = [
      'ID',
      'Driver ID',
      'ID Driver',
      'ID Motorista',
      'Id Motorista',
    ];
    const byHeader = this.getHeaderIndex(headers, candidates);
    const fallbackJ = 9;
    const index = byHeader >= 0 ? byHeader : fallbackJ;
    const value = String(row[index] ?? '').trim();
    return value || null;
  }

  private async syncAssignmentOverviewFromSheets(): Promise<number> {
    const overviewRows = await this.sheets.getRows(`'Visão Geral Atribuições'!A:Q`);
    if (!overviewRows.length) throw new Error('Planilha Visão Geral Atribuições vazia');

    const [headers, ...dataRows] = overviewRows;
    const entries: Array<{ rowNumber: number; driverId: string | null; payload: OverviewRow }> = [];
    const driverIds = new Set<string>();

    for (let i = 0; i < dataRows.length; i += 1) {
      const rawRow = dataRows[i] ?? [];
      const rowNumber = i + 2;
      const driverId = this.extractOverviewDriverId(headers, rawRow);
      if (driverId) driverIds.add(driverId);

      entries.push({
        rowNumber,
        driverId,
        payload: this.mapRows(headers, [rawRow])[0] || {},
      });
    }

    const rowNumbers = entries.map((entry) => entry.rowNumber);
    const existingRows = rowNumbers.length
      ? await this.prisma.assignmentOverview.findMany({
          where: { rowNumber: { in: rowNumbers } },
          select: { rowNumber: true },
        })
      : [];
    const existingSet = new Set(existingRows.map((entry) => entry.rowNumber));

    const toCreate = entries.filter((entry) => !existingSet.has(entry.rowNumber));
    const toUpdate = entries.filter((entry) => existingSet.has(entry.rowNumber));

    if (toCreate.length) {
      await this.prisma.assignmentOverview.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    if (toUpdate.length) {
      await this.runInBatches(toUpdate, 50, (entry) =>
        this.prisma.assignmentOverview.update({
          where: { rowNumber: entry.rowNumber },
          data: {
            driverId: entry.driverId,
            payload: entry.payload,
          },
        }),
      );
    }

    if (rowNumbers.length) {
      await this.prisma.assignmentOverview.deleteMany({
        where: { rowNumber: { notIn: rowNumbers } },
      });
    } else {
      await this.prisma.assignmentOverview.deleteMany({});
    }

    await Promise.all(
      Array.from(driverIds).map((driverId) =>
        this.redis.set(`driver:hasRoute:${driverId}`, true, 300),
      ),
    );

    return entries.length;
  }

  private async syncDriversFromSheets() {
    const driverRows = await this.sheets.getRows(`'Perfil de Motorista'!A:BF`);
    if (!driverRows.length) throw new Error('Planilha Perfil de Motorista vazia');
    const [driverHeaders, ...driverData] = driverRows;

    const drivers = this.mapRows(driverHeaders, driverData);

    let driverCount = 0;
    for (const row of drivers) {
      const driverId = row['Driver ID']?.trim();
      if (!driverId) continue;
      driverCount += 1;

      const vehicleType = row['Vehicle Type']?.trim() || null;
      const ds = row['DS'] || null;

      await this.prisma.driver.upsert({
        where: { id: driverId },
        update: {
          name: row['Driver Name'] || null,
          vehicleType,
          ds,
        },
        create: {
          id: driverId,
          name: row['Driver Name'] || null,
          vehicleType,
          ds,
        },
      });
    }

    return driverCount;
  }

  private normalizeSheetDriverId(value?: string | null): string | null {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '0') return null;
    return raw;
  }

  private normalizeShift(value?: string | null): 'AM' | 'PM' | 'PM2' | null {
    const raw = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (raw === 'AM' || raw === 'PM' || raw === 'PM2') return raw;
    return null;
  }

  private resolveRouteDate(
    headers: string[],
    row: string[],
    selectedDate?: string,
  ): string | null {
    if (selectedDate) return selectedDate;
    const dateIndex = this.getHeaderIndex(headers, ['Data', 'DATE', 'Dia']);
    if (dateIndex < 0) return null;
    const raw = String(row[dateIndex] ?? '').trim();
    return raw || null;
  }

  private getSheetRouteShift(headers: string[], row: string[]): 'AM' | 'PM' | 'PM2' | null {
    const shiftIndex = this.getHeaderIndex(headers, ['Turno', 'SHIFT']);
    if (shiftIndex < 0) return null;
    return this.normalizeShift(row[shiftIndex]);
  }

  private resolveRouteShift(
    headers: string[],
    row: string[],
    selectedShift?: 'AM' | 'PM' | 'PM2',
  ): 'AM' | 'PM' | 'PM2' | null {
    return this.getSheetRouteShift(headers, row) || selectedShift || null;
  }

  private buildPersistentRouteId(
    routeDate: string | null,
    shift: string | null,
    atId: string,
  ): string {
    return `${routeDate || 'sem-data'}:${shift || 'sem-turno'}:${atId}`;
  }

  private async syncRoutesFromSheets(
    selectedDate?: string,
    selectedShift?: 'AM' | 'PM' | 'PM2',
  ) {
    const routeRows = await this.sheets.getAssignmentOverviewRows();
    if (!routeRows.length) throw new Error('Planilha Visão Geral Atribuições vazia');
    const [routeHeaders, ...routeData] = routeRows;
    const prisma = this.prisma as any;
    const mappedRows = this.mapRouteRows(routeHeaders, routeData);
    const entries: Array<{ routeId: string; payload: RouteRecordInput }> = [];
    const driverIds: string[] = [];

    for (let index = 0; index < routeData.length; index += 1) {
      const rawRow = routeData[index] ?? [];
      const row = mappedRows[index] || {};
      const atId = String(rawRow[0] ?? '').trim();
      if (!atId) continue;
      const routeDate = this.resolveRouteDate(routeHeaders, rawRow, selectedDate);
      if (selectedDate && routeDate && routeDate !== selectedDate) continue;
      const sheetShift = this.getSheetRouteShift(routeHeaders, rawRow);
      if (selectedShift && sheetShift && sheetShift !== selectedShift) continue;
      const routeShift = this.resolveRouteShift(routeHeaders, rawRow, selectedShift);
      const routeId = this.buildPersistentRouteId(routeDate, routeShift, atId);
      const currentDriverId = this.normalizeSheetDriverId(rawRow[9]);
      const requestedDriverId = this.normalizeSheetDriverId(rawRow[17]);
      if (currentDriverId) driverIds.push(currentDriverId);
      if (requestedDriverId) driverIds.push(requestedDriverId);
      const requiredVehicleType = String(rawRow[4] ?? row['Tipo de Veiculo Nescessario'] ?? '').trim() || null;
      const requiredVehicleTypeNorm = normalizeVehicleType(requiredVehicleType ?? undefined);
      const effectiveDriverId = currentDriverId;
      const status: RouteStatus = currentDriverId ? 'ATRIBUIDA' : 'DISPONIVEL';
      const assignmentSource: RouteAssignmentSourceValue = requestedDriverId ? 'TELEGRAM_BOT' : 'SYNC';
      const sourceRowNumber = index + 2;

      entries.push({
        routeId,
        payload: {
          atId,
          routeDate,
          shift: routeShift,
          gaiola: String(rawRow[1] ?? row['Gaiola'] ?? '').trim() || null,
          bairro: String(rawRow[2] ?? row['Bairro'] ?? '').trim() || null,
          cidade: String(rawRow[3] ?? row['Cidade'] ?? '').trim() || null,
          requiredVehicleType,
          requiredVehicleTypeNorm,
          suggestionDriverDs: String(rawRow[5] ?? row['Sugestão [motorista ds]'] ?? '').trim() || null,
          km: String(rawRow[6] ?? row['KM'] ?? '').trim() || null,
          spr: String(rawRow[7] ?? row['SPR'] ?? '').trim() || null,
          volume: String(rawRow[8] ?? row['Volume'] ?? '').trim() || null,
          gg: String(rawRow[13] ?? row['GG'] ?? '').trim() || null,
          veiculoRoterizado: String(row['Veiculo Roterizado'] ?? '').trim() || null,
          requestedDriverId,
          assignmentSource,
          sheetRowNumber: sourceRowNumber,
          driverId: effectiveDriverId,
          driverName: null,
          driverVehicleType: null,
          driverAccuracy: null,
          driverPlate: null,
          status,
          assignedAt: effectiveDriverId ? new Date() : null,
        },
      });
    }

    await this.ensureDriversExist(driverIds);

    const routeIds = entries.map((entry) => entry.routeId);
    const existingRoutes = routeIds.length
      ? await prisma.route.findMany({
          where: { id: { in: routeIds } },
          select: { id: true },
        })
      : [];
    const existingSet = new Set(existingRoutes.map((route: { id: string }) => route.id));
    const toCreate = entries.filter((entry) => !existingSet.has(entry.routeId));
    const toUpdate = entries.filter((entry) => existingSet.has(entry.routeId));

    if (toCreate.length) {
      await prisma.route.createMany({
        data: toCreate.map((entry) => ({
          id: entry.routeId,
          ...entry.payload,
        })),
        skipDuplicates: true,
      });
    }

    if (toUpdate.length) {
      await this.runInBatches(toUpdate, 25, (entry) =>
        prisma.route.update({
          where: { id: entry.routeId },
          data: entry.payload,
        }),
      );
    }

    let availableCount = 0;
    let assignedCount = 0;
    for (const entry of entries) {
      if (entry.payload.status === 'DISPONIVEL') availableCount += 1;
      if (entry.payload.status === 'ATRIBUIDA') assignedCount += 1;
    }

    return { availableCount, assignedCount };
  }

  async syncDriversScheduled(): Promise<number> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao de motoristas iniciada' },
    });

    try {
      const driverCount = await this.syncDriversFromSheets();
      await this.syncDriverPriorityMetrics();
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          driversCount: driverCount,
          message: 'Sincronizacao de motoristas concluida',
        },
      });
      return driverCount;
    } catch (error) {
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

  async syncAll(
    selectedDate?: string,
    selectedShift?: 'AM' | 'PM' | 'PM2',
  ): Promise<SyncSummary> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao iniciada' },
    });

    try {
      const driverCount = await this.syncDriversFromSheets();
      await this.syncDriverPriorityMetrics();
      const { availableCount, assignedCount } = await this.syncRoutesFromSheets(
        selectedDate,
        selectedShift,
      );

      await this.syncAssignmentOverviewFromSheets();

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

      return {
        drivers: driverCount,
        routesAvailable: availableCount,
        routesAssigned: assignedCount,
      };
    } catch (error) {
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

  async syncRoutesOnly(
    selectedDate?: string,
    selectedShift?: 'AM' | 'PM' | 'PM2',
  ): Promise<SyncRoutesSummary> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao de rotas iniciada' },
    });

    try {
      const { availableCount, assignedCount } = await this.syncRoutesFromSheets(
        selectedDate,
        selectedShift,
      );
      await this.syncAssignmentOverviewFromSheets();

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

      return {
        routesAvailable: availableCount,
        routesAssigned: assignedCount,
      };
    } catch (error) {
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

  async syncRouteAssignmentsFromOverview(
    selectedDate?: string,
    selectedShift?: 'AM' | 'PM' | 'PM2',
  ): Promise<SyncRouteAssignmentsSummary> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao pontual de atribuicoes iniciada' },
    });

    try {
      const overviewRows = await this.sheets.getAssignmentOverviewRows();
      if (!overviewRows.length) {
        throw new Error('Planilha Visão Geral Atribuições vazia');
      }

      const [, ...routeData] = overviewRows;
      const currentAssignments = new Map<string, string | null>();
      const assignedDriverIds: string[] = [];

      for (const rawRow of routeData) {
        const atId = String(rawRow?.[0] ?? '').trim();
        if (!atId) continue;
        const currentDriverId = this.normalizeSheetDriverId(rawRow?.[9]);
        currentAssignments.set(atId, currentDriverId);
        if (currentDriverId) assignedDriverIds.push(currentDriverId);
      }

      const atIds = Array.from(currentAssignments.keys());
      await this.ensureDriversExist(assignedDriverIds);

      const routes = await (this.prisma as any).route.findMany({
        where: {
          atId: { in: atIds },
          ...(selectedDate ? { routeDate: selectedDate } : {}),
          ...(selectedShift ? { shift: selectedShift } : {}),
        },
        select: {
          id: true,
          atId: true,
          requestedDriverId: true,
          assignmentSource: true,
          assignedAt: true,
        },
      });

      await this.runInBatches(
        routes as Array<{
          id: string;
          atId: string;
          requestedDriverId: string | null;
          assignmentSource: RouteAssignmentSourceValue;
          assignedAt: Date | null;
        }>,
        25,
        (route) => {
          const currentDriverId = currentAssignments.get(String(route.atId || '').trim()) || null;
          const keepTelegramPending =
            route.assignmentSource === 'TELEGRAM_BOT' &&
            route.requestedDriverId &&
            !currentDriverId;

          return (this.prisma as any).route.update({
            where: { id: route.id },
            data: {
              driverId: currentDriverId,
              driverName: null,
              driverVehicleType: null,
              driverAccuracy: null,
              driverPlate: null,
              requestedDriverId: keepTelegramPending
                ? route.requestedDriverId
                : route.assignmentSource === 'MANUAL' && !currentDriverId
                  ? null
                  : route.requestedDriverId,
              assignmentSource:
                route.assignmentSource === 'MANUAL' && !currentDriverId
                  ? 'SYNC'
                  : route.assignmentSource,
              status: currentDriverId ? 'ATRIBUIDA' : 'DISPONIVEL',
              assignedAt: currentDriverId ? route.assignedAt || new Date() : null,
            },
          });
        },
      );

      let routesAvailable = 0;
      let routesAssigned = 0;
      for (const route of routes) {
        const currentDriverId = currentAssignments.get(String(route.atId || '').trim()) || null;
        if (currentDriverId) routesAssigned += 1;
        else routesAvailable += 1;
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          routesAvailable,
          routesAssigned,
          message: 'Sincronizacao pontual de atribuicoes concluida',
        },
      });

      return {
        routesAvailable,
        routesAssigned,
        processed: routes.length,
      };
    } catch (error) {
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

  private async syncRoutesToSheets(headers: string[], routes: RouteRow[]) {
    const headerIndex = (name: string) => headers.findIndex((h) => h.trim() === name);
    const idIndex = headerIndex('ID');
    const nameIndex = headerIndex('Nome Driver');
    const typeIndex = headerIndex('Tipo de Veiculo');
    const accuracyIndex = headerIndex('Acertividade');
    const plateIndex = headerIndex('Placa');

    if ([idIndex, nameIndex, typeIndex, accuracyIndex, plateIndex].some((idx) => idx < 0)) {
      return;
    }

    const updates: { range: string; values: string[][] }[] = [];

    const routeIds = routes
      .map((row) => row['ATs']?.trim())
      .filter((id): id is string => !!id);

    if (!routeIds.length) return;

    const dbRoutes = await this.prisma.route.findMany({
      where: { id: { in: routeIds } },
      include: { driver: true },
    });

    const routeMap = new Map(dbRoutes.map((route) => [route.id, route]));

    for (let i = 0; i < routes.length; i += 1) {
      const row = routes[i];
      const routeId = row['ATs']?.trim();
      if (!routeId) continue;

      const route = routeMap.get(routeId);
      if (!route) continue;

      const driver = route.driver;
      const driverVehicleType = driver?.vehicleType || route.driverVehicleType || '';
      const driverName = driver?.name || route.driverName || '';
      const driverId = driver?.id || route.driverId || '';
      const driverPlate = route.driverPlate || '';
      const requiredNorm = normalizeVehicleType(route.requiredVehicleType ?? undefined);
      const driverNorm = normalizeVehicleType(driverVehicleType);
      const accuracy = driverId
        ? requiredNorm && driverNorm && requiredNorm === driverNorm
          ? 'OK'
          : 'NAO'
        : '';

      const rowIndex = i + 2;
      const startIndex = idIndex;
      const endIndex = plateIndex;
      const range = this.buildRouteUpdateRange(rowIndex, startIndex, endIndex);
      const values = [[driverId, driverName, driverVehicleType, accuracy, driverPlate]];

      updates.push({ range, values });
    }

    if (!updates.length) return;

    await this.sheets.batchUpdateValues(updates);
  }
}
