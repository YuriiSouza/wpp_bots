import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RouteStatus } from '@prisma/client';
import { SheetsService } from '../sheets/sheets.service';
import { RedisService } from '../redis/redis.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';

const SYNC_LOCK_KEY = 'telegram:sync:lock';
const SYNC_PENDING_PREFIX = 'telegram:sync:pending';
const SYNC_TTL_SECONDS = 60 * 30;
const SYNC_PASSWORD = process.env.SYNC_PASSWORD || 'senhadoYuri';

type DriverRow = Record<string, string>;
type RouteRow = Record<string, string>;
type OverviewRow = Record<string, string>;
type ConvocationStats = { total: number; declined: number };
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
    if (!match) return null;
    return match[1].trim() || null;
  }

  private calculatePriorityScore(
    dsPercent: number,
    declineRate: number,
    noShowCount: number,
  ): number {
    const noShowComponent = Math.max(0, 100 - noShowCount * 10);
    const score = dsPercent * 0.6 + (100 - declineRate) * 0.3 + noShowComponent * 0.1;
    const bounded = Math.max(0, Math.min(100, score));
    return Number(bounded.toFixed(2));
  }

  private async getRowsFromAnyRange(ranges: string[]): Promise<string[][]> {
    let lastError: Error | null = null;
    for (const range of ranges) {
      try {
        const rows = await this.sheets.getRows(range);
        if (rows.length) return rows;
      } catch (error) {
        lastError = error as Error;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  private async syncDriverPriorityMetrics(): Promise<void> {
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

    const driverIds = Array.from(
      new Set([
        ...noShowByDriver.keys(),
        ...convocationByDriver.keys(),
      ]),
    );
    if (!driverIds.length) return;

    await this.ensureDriversExist(driverIds);

    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, ds: true },
    });

    for (const driver of drivers) {
      const conv = convocationByDriver.get(driver.id) || { total: 0, declined: 0 };
      const noShowCount = noShowByDriver.get(driver.id) || 0;
      const declineRate = conv.total > 0 ? (conv.declined / conv.total) * 100 : 0;
      const dsPercent = this.parsePercent(driver.ds);
      const priorityScore = this.calculatePriorityScore(dsPercent, declineRate, noShowCount);

      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          noShowCount,
          declineRate: Number(declineRate.toFixed(2)),
          priorityScore,
        },
      });
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
    const mappedRows: OverviewRow[] = this.mapRows(headers, dataRows);
    const rowNumbers: number[] = [];
    const driverIds = new Set<string>();

    for (let i = 0; i < mappedRows.length; i += 1) {
      const row = mappedRows[i];
      const rowNumber = i + 2;
      rowNumbers.push(rowNumber);

      const rawRow = dataRows[i] ?? [];
      const driverId = this.extractOverviewDriverId(headers, rawRow);
      if (driverId) driverIds.add(driverId);

      await this.prisma.assignmentOverview.upsert({
        where: { rowNumber },
        update: {
          driverId,
          payload: row,
        },
        create: {
          rowNumber,
          driverId,
          payload: row,
        },
      });
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

    return mappedRows.length;
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

  private async syncRoutesFromSheets() {
    const routeRows = await this.sheets.getRows(`'Rotas recusadas'!A:Z`);
    if (!routeRows.length) throw new Error('Planilha Rotas recusadas vazia');
    const [routeHeaders, ...routeData] = routeRows;
    const routes = this.mapRouteRows(routeHeaders, routeData);

    const routeIds: string[] = [];
    const driverIds: string[] = [];

    for (const row of routes) {
      const routeId = row['ATs']?.trim();
      if (!routeId) continue;
      routeIds.push(routeId);

      const sheetDriverId = row['ID']?.trim() || '';
      if (sheetDriverId) driverIds.push(sheetDriverId);
    }

    await this.ensureDriversExist(driverIds);

    for (const row of routes) {
      const routeId = row['ATs']?.trim();
      if (!routeId) continue;

      const requiredVehicleType = row['Tipo de Veiculo Nescessario'] || null;
      const requiredVehicleTypeNorm = normalizeVehicleType(requiredVehicleType ?? undefined);
      const sheetDriverId = row['ID']?.trim() || '';
      const driverId = sheetDriverId || null;
      const status: RouteStatus = driverId ? 'ATRIBUIDA' : 'DISPONIVEL';
      const driverName = driverId ? row['Nome Driver'] || null : null;
      const driverVehicleType = driverId ? row['Tipo de Veiculo'] || null : null;
      const driverAccuracy = driverId ? row['Acertividade'] || null : null;
      const driverPlate = driverId ? row['Placa'] || null : null;

      await this.prisma.route.upsert({
        where: { id: routeId },
        update: {
          gaiola: row['Gaiola'] || null,
          bairro: row['Bairro'] || null,
          cidade: row['Cidade'] || null,
          requiredVehicleType,
          requiredVehicleTypeNorm,
          suggestionDriverDs: row['Sugestão [motorista ds]'] || null,
          km: row['KM'] || null,
          spr: row['SPR'] || null,
          volume: row['Volume'] || null,
          gg: row['GG'] || null,
          veiculoRoterizado: row['Veiculo Roterizado'] || null,
          driverId,
          driverName,
          driverVehicleType,
          driverAccuracy,
          driverPlate,
          status,
          assignedAt: driverId ? new Date() : null,
        },
        create: {
          id: routeId,
          gaiola: row['Gaiola'] || null,
          bairro: row['Bairro'] || null,
          cidade: row['Cidade'] || null,
          requiredVehicleType,
          requiredVehicleTypeNorm,
          suggestionDriverDs: row['Sugestão [motorista ds]'] || null,
          km: row['KM'] || null,
          spr: row['SPR'] || null,
          volume: row['Volume'] || null,
          gg: row['GG'] || null,
          veiculoRoterizado: row['Veiculo Roterizado'] || null,
          driverId,
          driverName,
          driverVehicleType,
          driverAccuracy,
          driverPlate,
          status,
          assignedAt: driverId ? new Date() : null,
        },
      });
    }

    if (routeIds.length) {
      await this.prisma.route.deleteMany({
        where: { id: { notIn: routeIds } },
      });
    } else {
      await this.prisma.route.deleteMany({});
    }

    await this.syncRoutesToSheets(routeHeaders, routes);

    const availableCount = await this.prisma.route.count({
      where: { status: 'DISPONIVEL' },
    });
    const assignedCount = await this.prisma.route.count({
      where: { status: 'ATRIBUIDA' },
    });

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

  async syncAll(): Promise<SyncSummary> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao iniciada' },
    });

    try {
      const driverCount = await this.syncDriversFromSheets();
      await this.syncDriverPriorityMetrics();
      const { availableCount, assignedCount } = await this.syncRoutesFromSheets();

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

  async syncRoutesOnly(): Promise<SyncRoutesSummary> {
    await this.lock();
    const log = await this.prisma.syncLog.create({
      data: { status: 'running', message: 'Sincronizacao de rotas iniciada' },
    });

    try {
      const { availableCount, assignedCount } = await this.syncRoutesFromSheets();
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
