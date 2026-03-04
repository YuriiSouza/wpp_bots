import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { PrismaService } from './prisma/prisma.service';
import { normalizeVehicleType } from './utils/normalize-vehicle';
import { createConnection } from 'net';
import { SyncService } from './sync/sync.service';
import { SheetsService } from './sheets/sheets.service';
import {
  Prisma,
  RouteStatus,
} from '@prisma/client';

type RouteAssignmentSourceValue = 'SYNC' | 'MANUAL' | 'TELEGRAM_BOT';

const ROUTE_ASSIGNMENT_SOURCE: Record<RouteAssignmentSourceValue, RouteAssignmentSourceValue> = {
  SYNC: 'SYNC',
  MANUAL: 'MANUAL',
  TELEGRAM_BOT: 'TELEGRAM_BOT',
};

type PlanningPhase = 'FASE A' | 'FASE B';

interface PlanningDriver {
  id: string;
  name: string;
  veiculo: string;
  disponivel: boolean;
  ds: number;
  perfil: string;
  clusters: string[];
  rowIndex: number;
}

interface PlanningAssignment {
  atId: string;
  suggestedDriverId: string;
  phase: PlanningPhase;
  obs: string;
  tipoProgRaw: string;
  currentDriverId: string;
  currentDriverVehicle: string;
  currentDriverDs: number;
  currentDriverProfile: string;
  clusterRoute: string;
  clusterDriver: string;
  suggestedDriverVehicle: string;
  suggestedDriverDs: number;
  suggestedDriverProfile: string;
}

interface RoutePlanningComputation {
  assignments: PlanningAssignment[];
  drivers: PlanningDriver[];
  preferredAssignments: Array<{
    cluster: string;
    clusterName: string | null;
    driverId: string;
    driverName: string | null;
    vehicleType: string | null;
    available: boolean;
  }>;
  outputK: string[][];
  logRows: string[][];
}

interface RoutePlanningPreferenceEntry {
  cluster: string;
  driverId: string;
}

type RoutePlanningFocus = 'DS' | 'VOLUME' | 'PM';

type RoutePlanningShift = 'AM' | 'PM' | 'PM2';
type RoutePlanningAvailabilitySlot = 'AM' | 'PM';
type RoutePlanningAvailabilityStatus = 'available' | 'not_available' | 'pending_confirmation' | 'no_schedule';

interface RoutePlanningWindow {
  date: string;
  shift: RoutePlanningShift;
}

interface RoutePlanningAvailableDriver {
  id: string;
  name: string;
  vehicleType: string;
  status: string;
  available: boolean;
  availabilityStatus: RoutePlanningAvailabilityStatus;
  rawAvailability: string | null;
  availableShifts: RoutePlanningAvailabilitySlot[];
  noShowTime: number;
  reason: string | null;
  lastTrip: string | null;
  ds: number;
  clusters: string[];
  clusterLabels: string[];
  recentNeighborhoods: string | null;
  phone: string | null;
  currentRouteAtId: string | null;
  currentRouteBairro: string | null;
  hasCurrentRoute: boolean;
  hasPreviousRoute: boolean;
  lastRouteAtId: string | null;
  lastRouteBairro: string | null;
  lastRouteDate: string | null;
  lastRouteShift: RoutePlanningShift | null;
  recentRouteCount: number;
  turnsSinceLastRoute: number | null;
}

@Injectable()
export class AppService {
  private readonly QUEUE_LIST_KEY_GENERAL = 'telegram:queue:list:general';
  private readonly QUEUE_ACTIVE_KEY_GENERAL = 'telegram:queue:active:general';
  private readonly QUEUE_LIST_KEY_MOTO = 'telegram:queue:list:moto';
  private readonly QUEUE_ACTIVE_KEY_MOTO = 'telegram:queue:active:moto';
  private readonly DASHBOARD_EXECUTIVE_CACHE_PREFIX = 'cache:dashboard:executive';
  private readonly DASHBOARD_NOSHOW_CACHE_PREFIX = 'cache:dashboard:noshow';
  private readonly DRIVERS_LIST_CACHE_PREFIX = 'cache:drivers:list';
  private readonly DRIVERS_ANALYTICS_CACHE_PREFIX = 'cache:drivers:analytics';
  private readonly ROUTES_CACHE_PREFIX = 'cache:routes:list';
  private readonly BLOCKLIST_LIST_CACHE_PREFIX = 'cache:blocklist:list';
  private readonly OVERVIEW_ROUTE_REQUESTS_CACHE_PREFIX = 'cache:overview:route-requests';
  private readonly DASHBOARD_EXECUTIVE_CACHE_TTL_SECONDS = 60;
  private readonly DASHBOARD_NOSHOW_CACHE_TTL_SECONDS = 60;
  private readonly DRIVERS_LIST_CACHE_TTL_SECONDS = 45;
  private readonly DRIVERS_ANALYTICS_CACHE_TTL_SECONDS = 90;
  private readonly ROUTES_CACHE_TTL_SECONDS = 60 * 10;
  private readonly BLOCKLIST_LIST_CACHE_TTL_SECONDS = 20;
  private readonly OVERVIEW_ROUTE_REQUESTS_CACHE_TTL_SECONDS = 15;
  private readonly LOG_PREFIX = 'telegram:log';
  private readonly ROUTES_NOTE_KEY = 'telegram:routes:note';
  private readonly BLOCKLIST_CACHE_PREFIX = 'telegram:blocklist:cache:driver';
  private readonly ROUTE_PLANNING_PREFERENCES_KEY = 'routePlanningPreferences';

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  private toIsoString(value?: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private getCurrentRouteWindow() {
    const now = new Date();
    const shift = now.getHours() < 12 ? 'AM' : now.getHours() < 18 ? 'PM' : 'PM2';
    return {
      date: now.toISOString().slice(0, 10),
      shift: shift as 'AM' | 'PM' | 'PM2',
    };
  }

  private async getEffectiveRouteWindow() {
    const fallback = this.getCurrentRouteWindow();
    const prisma = this.prisma as any;
    const configured = await prisma.systemConfig.findUnique({
      where: { key: 'operationContext' },
      select: { value: true },
    });
    const value = (configured?.value || {}) as Record<string, unknown>;
    const date = String(value.date || '').trim();
    const shift = String(value.shift || '').trim().toUpperCase();

    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback.date,
      shift: shift === 'AM' || shift === 'PM' || shift === 'PM2' ? (shift as 'AM' | 'PM' | 'PM2') : fallback.shift,
    };
  }

  private normalizePlanningHeader(value: unknown) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private findPlanningHeaderIndex(headers: unknown[], aliases: string[], fallbackIndex: number) {
    const normalizedHeaders = headers.map((header) => this.normalizePlanningHeader(header));
    const normalizedAliases = aliases.map((alias) => this.normalizePlanningHeader(alias));

    for (const alias of normalizedAliases) {
      const exactIndex = normalizedHeaders.findIndex((header) => header === alias);
      if (exactIndex >= 0) return exactIndex;
    }

    for (const alias of normalizedAliases) {
      const partialIndex = normalizedHeaders.findIndex((header) => header.includes(alias) || alias.includes(header));
      if (partialIndex >= 0) return partialIndex;
    }

    return fallbackIndex;
  }

  private async resolveRoutePlanningWindow(
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
  ): Promise<RoutePlanningWindow> {
    const fallback = await this.getEffectiveRouteWindow();
    return {
      date: String(date || '').trim() || fallback.date,
      shift: shift === 'AM' || shift === 'PM' || shift === 'PM2' ? shift : fallback.shift,
    };
  }

  private getPreviousRoutePlanningWindow(window: RoutePlanningWindow): RoutePlanningWindow {
    if (window.shift === 'PM2') {
      return { date: window.date, shift: 'PM' };
    }

    if (window.shift === 'PM') {
      return { date: window.date, shift: 'AM' };
    }

    const previousDate = new Date(`${window.date}T12:00:00.000Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);

    return {
      date: previousDate.toISOString().slice(0, 10),
      shift: 'PM2',
    };
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

  private getRoutePlanningShiftAvailabilitySlots(shift: RoutePlanningShift): RoutePlanningAvailabilitySlot[] {
    if (shift === 'AM') return ['AM'];
    return ['PM'];
  }

  private parseRoutePlanningAvailabilityCell(
    value: unknown,
    shift: RoutePlanningShift,
  ): {
    rawValue: string | null;
    label: string;
    status: RoutePlanningAvailabilityStatus;
    available: boolean;
    availableShifts: RoutePlanningAvailabilitySlot[];
  } {
    const rawValue = String(value || '').trim();
    const normalized = rawValue.toUpperCase();
    const availableShifts: RoutePlanningAvailabilitySlot[] = [];

    if (normalized.includes('06:00-09:00')) {
      availableShifts.push('AM');
    }
    if (normalized.includes('11:00-14:30')) {
      availableShifts.push('PM');
    }

    const hasCurrentShiftAvailability = this.getRoutePlanningShiftAvailabilitySlots(shift).some((slot) =>
      availableShifts.includes(slot),
    );

    if (!rawValue || rawValue === '--') {
      return {
        rawValue: rawValue || null,
        label: 'Sem agenda',
        status: 'no_schedule',
        available: false,
        availableShifts,
      };
    }

    if (normalized.includes('PENDING AVAILABILITY CONFIRMATION')) {
      return {
        rawValue,
        label: rawValue,
        status: 'pending_confirmation',
        available: false,
        availableShifts,
      };
    }

    if (normalized.includes('NOT AVAILABLE')) {
      return {
        rawValue,
        label: rawValue,
        status: 'not_available',
        available: false,
        availableShifts,
      };
    }

    if (availableShifts.length) {
      return {
        rawValue,
        label: rawValue,
        status: hasCurrentShiftAvailability ? 'available' : 'not_available',
        available: hasCurrentShiftAvailability,
        availableShifts,
      };
    }

    if (this.normalizePlanningAvailable(rawValue)) {
      return {
        rawValue,
        label: rawValue,
        status: 'available',
        available: true,
        availableShifts: this.getRoutePlanningShiftAvailabilitySlots(shift),
      };
    }

    return {
      rawValue,
      label: rawValue,
      status: 'no_schedule',
      available: false,
      availableShifts,
    };
  }

  private calculateRoutePlanningTurnsBetween(
    currentWindow: RoutePlanningWindow,
    lastDate?: string | null,
    lastShift?: RoutePlanningShift | null,
  ) {
    const date = String(lastDate || '').trim();
    const shift = lastShift === 'AM' || lastShift === 'PM' || lastShift === 'PM2' ? lastShift : null;
    if (!date || !shift) return null;

    const shiftOrder: Record<RoutePlanningShift, number> = {
      AM: 0,
      PM: 1,
      PM2: 2,
    };

    const currentDate = new Date(`${currentWindow.date}T12:00:00.000Z`);
    const previousDate = new Date(`${date}T12:00:00.000Z`);
    const dayDiff = Math.round((currentDate.getTime() - previousDate.getTime()) / 86400000);
    if (!Number.isFinite(dayDiff)) return null;

    return Math.max(0, dayDiff * 3 + (shiftOrder[currentWindow.shift] - shiftOrder[shift]));
  }

  private async getRoutePlanningAvailableDriversFromDriversSheet(
    window: RoutePlanningWindow,
    rows?: string[][],
  ) {
    const rowsToUse = rows || (await this.getRowsFromAnyRange(["'Drivers Disponiveis'!A:M"]));
    const previousWindow = this.getPreviousRoutePlanningWindow(window);

    if (rowsToUse.length < 2) {
      return {
        window,
        previousWindow,
        drivers: [] as RoutePlanningAvailableDriver[],
      };
    }

    const [headers, ...dataRows] = rowsToUse;
    const idIndex = this.findPlanningHeaderIndex(headers, ['ID', 'Driver ID'], 0);
    const nameIndex = this.findPlanningHeaderIndex(headers, ['Nome', 'Driver Name'], 1);
    const vehicleIndex = this.findPlanningHeaderIndex(headers, ['Tipo de veiculo', 'Vehicle Type'], 2);
    const statusIndex = this.findPlanningHeaderIndex(headers, ['Status', 'Disponivel'], 3);
    const reasonIndex = this.findPlanningHeaderIndex(headers, ['Motivo de nao rodar', 'Motivo'], 4);
    const lastTripIndex = this.findPlanningHeaderIndex(headers, ['Ultima viagem', 'Ultima rota'], 5);
    const dsIndex = this.findPlanningHeaderIndex(headers, ['DS'], 6);
    const clustersIndex = this.findPlanningHeaderIndex(headers, ['Clusters', 'Cluster'], 7);
    const neighborhoodsIndex = this.findPlanningHeaderIndex(headers, ['Bairros Recentes', 'Bairros'], 8);
    const phoneIndex = this.findPlanningHeaderIndex(headers, ['Numero', 'Telefone', 'Whatsapp', 'Phone'], 9);

    const baseDrivers = dataRows
      .map((row) => {
        const id = String(row[idIndex] || '').trim();
        if (!id) return null;

        const rawStatus = String(row[statusIndex] || '').trim();
        const clusterEntries = this.extractPlanningClusterEntries(row[clustersIndex]);

        return {
          id,
          name: String(row[nameIndex] || '').trim() || id,
          vehicleType: this.normalizePlanningVehicle(row[vehicleIndex]),
          status: rawStatus,
          available: this.normalizePlanningAvailable(rawStatus),
          reason: String(row[reasonIndex] || '').trim() || null,
          lastTrip: String(row[lastTripIndex] || '').trim() || null,
          ds: this.normalizePlanningDs(row[dsIndex]),
          clusters: clusterEntries.map((entry) => entry.code),
          clusterLabels: clusterEntries.map((entry) => (entry.name ? `${entry.code} - ${entry.name}` : entry.code)),
          recentNeighborhoods: String(row[neighborhoodsIndex] || '').trim() || null,
          phone: String(row[phoneIndex] || '').trim() || null,
        };
      })
      .filter((driver): driver is NonNullable<typeof driver> => !!driver);

    if (!baseDrivers.length) {
      return {
        window,
        previousWindow,
        drivers: [] as RoutePlanningAvailableDriver[],
      };
    }

    const driverIds = baseDrivers.map((driver) => driver.id);
    const [currentRoutes, previousRoutes] = await Promise.all([
      (this.prisma as any).route.findMany({
        where: {
          driverId: { in: driverIds },
          routeDate: window.date,
          shift: window.shift,
        },
        select: {
          driverId: true,
          atId: true,
          bairro: true,
          assignedAt: true,
          createdAt: true,
        },
        orderBy: [
          { assignedAt: 'desc' },
          { createdAt: 'desc' },
          { atId: 'asc' },
        ],
      }),
      (this.prisma as any).route.findMany({
        where: {
          driverId: { in: driverIds },
          routeDate: previousWindow.date,
          shift: previousWindow.shift,
        },
        select: {
          driverId: true,
        },
      }),
    ]);

    const currentRouteByDriver = new Map<string, { atId: string | null; bairro: string | null }>();
    for (const route of currentRoutes) {
      const driverId = String(route.driverId || '').trim();
      if (!driverId || currentRouteByDriver.has(driverId)) continue;
      currentRouteByDriver.set(driverId, {
        atId: String(route.atId || '').trim() || null,
        bairro: String(route.bairro || '').trim() || null,
      });
    }

    const previousRouteDriverIds = new Set(
      previousRoutes
        .map((route: { driverId?: string | null }) => String(route.driverId || '').trim())
        .filter(Boolean),
    );

    return {
      window,
      previousWindow,
      drivers: baseDrivers.map((driver) => {
        const currentRoute = currentRouteByDriver.get(driver.id);

        return {
          ...driver,
          ds: Number(driver.ds.toFixed(2)),
          availabilityStatus: driver.available ? 'available' : 'not_available',
          rawAvailability: driver.status || null,
          availableShifts: driver.available
            ? this.getRoutePlanningShiftAvailabilitySlots(window.shift)
            : [],
          noShowTime: 0,
          currentRouteAtId: currentRoute?.atId || null,
          currentRouteBairro: currentRoute?.bairro || null,
          hasCurrentRoute: !!currentRoute,
          hasPreviousRoute: previousRouteDriverIds.has(driver.id),
          lastRouteAtId: currentRoute?.atId || null,
          lastRouteBairro: currentRoute?.bairro || null,
          lastRouteDate: currentRoute ? window.date : null,
          lastRouteShift: currentRoute ? window.shift : null,
          recentRouteCount: currentRoute || previousRouteDriverIds.has(driver.id) ? 1 : 0,
          turnsSinceLastRoute: currentRoute
            ? 0
            : previousRouteDriverIds.has(driver.id)
              ? this.calculateRoutePlanningTurnsBetween(window, previousWindow.date, previousWindow.shift)
              : null,
        };
      }),
    };
  }

  private async getRoutePlanningAvailableDrivers(window: RoutePlanningWindow) {
    const [availabilityRows, driversRows] = await Promise.all([
      this.getRowsFromAnyRange([
        "'Disponibilidade'!A:ZZ",
        "'disponibilidade'!A:ZZ",
      ]),
      this.getRowsFromAnyRange(["'Drivers Disponiveis'!A:M"]),
    ]);

    if (availabilityRows.length < 2) {
      return this.getRoutePlanningAvailableDriversFromDriversSheet(window, driversRows);
    }

    const previousWindow = this.getPreviousRoutePlanningWindow(window);
    const [headers, ...dataRows] = availabilityRows;
    const idIndex = this.findPlanningHeaderIndex(headers, ['Driver ID', 'ID'], 0);
    const nameIndex = this.findPlanningHeaderIndex(headers, ['Driver Name', 'Nome'], 1);
    const clusterIndex = this.findPlanningHeaderIndex(headers, ['Cluster', 'Clusters'], 2);
    const vehicleIndex = this.findPlanningHeaderIndex(headers, ['Vehicle Type', 'Tipo de veiculo'], 3);
    const noShowIndex = this.findPlanningHeaderIndex(headers, ['No Show Time', 'No Show'], 4);
    const dateIndex = headers.findIndex((header) => String(header || '').trim() === window.date);

    if (dateIndex < 0) {
      return this.getRoutePlanningAvailableDriversFromDriversSheet(window, driversRows);
    }

    const supportHeaders = driversRows[0] || [];
    const supportIdIndex = this.findPlanningHeaderIndex(supportHeaders, ['ID', 'Driver ID'], 0);
    const supportNameIndex = this.findPlanningHeaderIndex(supportHeaders, ['Nome', 'Driver Name'], 1);
    const supportVehicleIndex = this.findPlanningHeaderIndex(supportHeaders, ['Tipo de veiculo', 'Vehicle Type'], 2);
    const supportStatusIndex = this.findPlanningHeaderIndex(supportHeaders, ['Status', 'Disponivel'], 3);
    const supportReasonIndex = this.findPlanningHeaderIndex(supportHeaders, ['Motivo de nao rodar', 'Motivo'], 4);
    const supportLastTripIndex = this.findPlanningHeaderIndex(supportHeaders, ['Ultima viagem', 'Ultima rota'], 5);
    const supportDsIndex = this.findPlanningHeaderIndex(supportHeaders, ['DS'], 6);
    const supportClustersIndex = this.findPlanningHeaderIndex(supportHeaders, ['Clusters', 'Cluster'], 7);
    const supportNeighborhoodsIndex = this.findPlanningHeaderIndex(supportHeaders, ['Bairros Recentes', 'Bairros'], 8);
    const supportPhoneIndex = this.findPlanningHeaderIndex(supportHeaders, ['Numero', 'Telefone', 'Whatsapp', 'Phone'], 9);

    const supportDriverById = new Map(
      (driversRows.slice(1) || [])
        .map((row) => {
          const id = String(row[supportIdIndex] || '').trim();
          if (!id) return null;

          return [
            id,
            {
              name: String(row[supportNameIndex] || '').trim() || null,
              vehicleType: this.normalizePlanningVehicle(row[supportVehicleIndex]),
              status: String(row[supportStatusIndex] || '').trim() || null,
              reason: String(row[supportReasonIndex] || '').trim() || null,
              lastTrip: String(row[supportLastTripIndex] || '').trim() || null,
              ds: this.normalizePlanningDs(row[supportDsIndex]),
              clusters: this.extractPlanningClusters(row[supportClustersIndex]),
              clusterLabels: this.extractPlanningClusterEntries(row[supportClustersIndex]).map((entry) =>
                entry.name ? `${entry.code} - ${entry.name}` : entry.code,
              ),
              recentNeighborhoods: String(row[supportNeighborhoodsIndex] || '').trim() || null,
              phone: String(row[supportPhoneIndex] || '').trim() || null,
            },
          ] as const;
        })
        .filter(Boolean) as Array<
        readonly [string, {
          name: string | null;
          vehicleType: string;
          status: string | null;
          reason: string | null;
          lastTrip: string | null;
          ds: number;
          clusters: string[];
          clusterLabels: string[];
          recentNeighborhoods: string | null;
          phone: string | null;
        }]
      >,
    );

    const baseDrivers = dataRows
      .map((row) => {
        const id = String(row[idIndex] || '').trim();
        if (!id) return null;

        const parsedAvailability = this.parseRoutePlanningAvailabilityCell(row[dateIndex], window.shift);
        const support = supportDriverById.get(id);
        const availabilityClusterEntries = this.extractPlanningClusterEntries(row[clusterIndex]);
        const availabilityClusterLabels = availabilityClusterEntries.map((entry) =>
          entry.name ? `${entry.code} - ${entry.name}` : entry.code,
        );
        const availabilityClusters = availabilityClusterEntries.map((entry) => entry.code);

        return {
          id,
          name: String(row[nameIndex] || '').trim() || support?.name || id,
          vehicleType: this.normalizePlanningVehicle(row[vehicleIndex]) || support?.vehicleType || '',
          status: parsedAvailability.label || support?.status || 'Sem agenda',
          available: parsedAvailability.available,
          availabilityStatus: parsedAvailability.status,
          rawAvailability: parsedAvailability.rawValue,
          availableShifts: parsedAvailability.availableShifts,
          noShowTime: this.parsePlanningNumber(row[noShowIndex]),
          reason: support?.reason || null,
          lastTrip: support?.lastTrip || null,
          ds: support?.ds || 0,
          clusters: availabilityClusters.length ? availabilityClusters : support?.clusters || [],
          clusterLabels: availabilityClusterLabels.length ? availabilityClusterLabels : support?.clusterLabels || [],
          recentNeighborhoods: support?.recentNeighborhoods || null,
          phone: support?.phone || null,
        };
      })
      .filter((driver): driver is NonNullable<typeof driver> => !!driver);

    if (!baseDrivers.length) {
      return {
        window,
        previousWindow,
        drivers: [] as RoutePlanningAvailableDriver[],
      };
    }

    const driverIds = baseDrivers.map((driver) => driver.id);
    const historyThreshold = new Date(`${window.date}T12:00:00.000Z`);
    historyThreshold.setUTCDate(historyThreshold.getUTCDate() - 21);

    const [routeHistory, driverMetadata] = await Promise.all([
      (this.prisma as any).route.findMany({
        where: {
          driverId: { in: driverIds },
          routeDate: {
            gte: historyThreshold.toISOString().slice(0, 10),
            lte: window.date,
          },
        },
        select: {
          driverId: true,
          routeDate: true,
          shift: true,
          atId: true,
          bairro: true,
          assignedAt: true,
          createdAt: true,
        },
        orderBy: [
          { routeDate: 'desc' },
          { assignedAt: 'desc' },
          { createdAt: 'desc' },
          { atId: 'asc' },
        ],
      }),
      (this.prisma as any).driver.findMany({
        where: {
          id: { in: driverIds },
        },
        select: {
          id: true,
          name: true,
          vehicleType: true,
          ds: true,
        },
      }),
    ]);

    const currentRouteByDriver = new Map<string, { atId: string | null; bairro: string | null }>();
    const previousRouteDriverIds = new Set<string>();
    const recentRouteCountByDriver = new Map<string, number>();
    const lastRouteByDriver = new Map<string, {
      atId: string | null;
      bairro: string | null;
      routeDate: string | null;
      shift: RoutePlanningShift | null;
    }>();

    for (const route of routeHistory) {
      const driverId = String(route.driverId || '').trim();
      const routeDate = String(route.routeDate || '').trim();
      const routeShift = route.shift === 'AM' || route.shift === 'PM' || route.shift === 'PM2'
        ? (route.shift as RoutePlanningShift)
        : null;
      if (!driverId) continue;

      recentRouteCountByDriver.set(driverId, (recentRouteCountByDriver.get(driverId) || 0) + 1);

      if (!lastRouteByDriver.has(driverId)) {
        lastRouteByDriver.set(driverId, {
          atId: String(route.atId || '').trim() || null,
          bairro: String(route.bairro || '').trim() || null,
          routeDate: routeDate || null,
          shift: routeShift,
        });
      }

      if (routeDate === window.date && routeShift === window.shift && !currentRouteByDriver.has(driverId)) {
        currentRouteByDriver.set(driverId, {
          atId: String(route.atId || '').trim() || null,
          bairro: String(route.bairro || '').trim() || null,
        });
      }

      if (routeDate === previousWindow.date && routeShift === previousWindow.shift) {
        previousRouteDriverIds.add(driverId);
      }
    }

    const driverMetadataById = new Map<string, (typeof driverMetadata)[number]>(
      driverMetadata.map((driver) => [String(driver.id || '').trim(), driver]),
    );

    return {
      window,
      previousWindow,
      drivers: baseDrivers.map((driver) => {
        const currentRoute = currentRouteByDriver.get(driver.id);
        const lastRoute = lastRouteByDriver.get(driver.id);
        const metadata = driverMetadataById.get(driver.id);
        const mergedDs = driver.ds || this.normalizePlanningDs(metadata?.ds);

        return {
          ...driver,
          name: driver.name || String(metadata?.name || driver.id),
          vehicleType: driver.vehicleType || this.normalizePlanningVehicle(metadata?.vehicleType),
          ds: Number(mergedDs.toFixed(2)),
          currentRouteAtId: currentRoute?.atId || null,
          currentRouteBairro: currentRoute?.bairro || null,
          hasCurrentRoute: !!currentRoute,
          hasPreviousRoute: previousRouteDriverIds.has(driver.id),
          lastRouteAtId: lastRoute?.atId || null,
          lastRouteBairro: lastRoute?.bairro || null,
          lastRouteDate: lastRoute?.routeDate || null,
          lastRouteShift: lastRoute?.shift || null,
          recentRouteCount: recentRouteCountByDriver.get(driver.id) || 0,
          turnsSinceLastRoute: this.calculateRoutePlanningTurnsBetween(
            window,
            lastRoute?.routeDate || null,
            lastRoute?.shift || null,
          ),
        };
      }),
    };
  }

  async getOperationContext() {
    const window = await this.getEffectiveRouteWindow();
    return {
      date: window.date,
      shift: window.shift,
    };
  }

  async updateOperationContext(payload: { date?: string; shift?: string }) {
    const fallback = this.getCurrentRouteWindow();
    const date = String(payload?.date || '').trim() || fallback.date;
    const shiftRaw = String(payload?.shift || '').trim().toUpperCase() || fallback.shift;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Data invalida');
    }
    if (!['AM', 'PM', 'PM2'].includes(shiftRaw)) {
      throw new BadRequestException('Turno invalido');
    }

    const prisma = this.prisma as any;
    await prisma.systemConfig.upsert({
      where: { key: 'operationContext' },
      create: {
        key: 'operationContext',
        value: { date, shift: shiftRaw },
      },
      update: {
        value: { date, shift: shiftRaw },
      },
    });

    return {
      ok: true,
      message: 'Turno vigente atualizado com sucesso',
      context: { date, shift: shiftRaw as 'AM' | 'PM' | 'PM2' },
    };
  }

  private formatDayLabel(dateValue: Date) {
    return `${String(dateValue.getDate()).padStart(2, '0')}/${String(dateValue.getMonth() + 1).padStart(2, '0')}`;
  }

  private normalizeBlocklistStatusValue(status: unknown): 'BLOCKED' | 'UNBLOCKED' {
    return String(status || '') === 'BLOCKED' || String(status || '') === 'ACTIVE'
      ? 'BLOCKED'
      : 'UNBLOCKED';
  }

  private normalizeTelegramChatIdInput(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    if (!/^-?\d+$/.test(normalized)) {
      throw new BadRequestException('Telegram Chat ID invalido');
    }
    return normalized;
  }

  private decodeBase64Url(input: string) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf-8');
  }

  private resolveAuthenticatedUserId(authorization?: string | null) {
    const raw = String(authorization || '').trim();
    if (!raw.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Sessao invalida');
    }

    const token = raw.slice(7).trim();
    const parts = token.split('.');
    if (parts.length < 2) {
      throw new UnauthorizedException('Sessao invalida');
    }

    try {
      const payload = JSON.parse(this.decodeBase64Url(parts[1])) as { sub?: string };
      const userId = String(payload?.sub || '').trim();
      if (!userId) {
        throw new Error('missing-sub');
      }
      return userId;
    } catch {
      throw new UnauthorizedException('Sessao invalida');
    }
  }

  private resolveRouteReferenceDate(route: { routeDate?: string | null; createdAt: Date }) {
    const rawDate = String(route.routeDate || '').trim();
    if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      const parsed = new Date(`${rawDate}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return route.createdAt;
  }

  private toTopBreakdownEntries(counts: Map<string, number>, limit = 8) {
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, limit);
  }

  private async clearCacheByPrefix(prefix: string) {
    const client = this.redisService.client();
    const match = `${prefix}:*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        match,
        'COUNT',
        100,
      );

      if (keys.length) {
        await client.del(...keys);
      }

      cursor = nextCursor;
    } while (cursor !== '0');
  }

  private async invalidateExecutiveDashboardCache() {
    await this.clearCacheByPrefix(this.DASHBOARD_EXECUTIVE_CACHE_PREFIX);
  }

  private async invalidateNoShowDashboardCache() {
    await this.clearCacheByPrefix(this.DASHBOARD_NOSHOW_CACHE_PREFIX);
  }

  private async invalidateDriversCaches() {
    await Promise.all([
      this.clearCacheByPrefix(this.DRIVERS_LIST_CACHE_PREFIX),
      this.clearCacheByPrefix(this.DRIVERS_ANALYTICS_CACHE_PREFIX),
    ]);
  }

  private async invalidateRoutesCache() {
    await this.clearCacheByPrefix(this.ROUTES_CACHE_PREFIX);
  }

  private async invalidateBlocklistListCache() {
    await this.clearCacheByPrefix(this.BLOCKLIST_LIST_CACHE_PREFIX);
  }

  private async invalidateOverviewRouteRequestsCache() {
    await this.clearCacheByPrefix(this.OVERVIEW_ROUTE_REQUESTS_CACHE_PREFIX);
  }

  private normalizeAtIds(atIds: string[] | string | undefined) {
    const values = Array.isArray(atIds)
      ? atIds
      : String(atIds || '')
          .split(/[\s,;\n\r\t]+/g);

    return Array.from(
      new Set(
        values
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    );
  }

  private async getPlanningClusterMap(): Promise<Map<string, string>> {
    try {
      const relatorioRows = await this.sheets.getRows("'Relatorio de Expedição'!A:AC");
      const clusterMap = new Map<string, string>();

      for (const row of relatorioRows.slice(1)) {
        const atId = String(row[1] || '').trim();
        const rawClusters = row[28];
        if (!atId || !rawClusters) continue;

        const clusters = this.extractPlanningClusters(rawClusters);
        if (clusters.length) {
          clusterMap.set(atId, clusters[0]);
        }
      }

      return clusterMap;
    } catch {
      return new Map<string, string>();
    }
  }

  private async getExecutiveDashboardSection() {
    const cacheKey = `${this.DASHBOARD_EXECUTIVE_CACHE_PREFIX}:v1`;
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const [
      totalDrivers,
      routesAvailable,
      routesAssigned,
      routesBlocked,
      blocklistStatuses,
      avgDriverAgg,
      lastSuccessfulSync,
      lastSyncAttempt,
      topDriversRaw,
      recentRoutes,
    ] = await Promise.all([
      this.prisma.driver.count(),
      this.prisma.route.count({ where: { status: RouteStatus.DISPONIVEL } }),
      this.prisma.route.count({ where: { status: RouteStatus.ATRIBUIDA } }),
      this.prisma.route.count({ where: { status: RouteStatus.BLOQUEADA } }),
      this.prisma.driverBlocklist.findMany({
        select: { status: true },
      }),
      this.prisma.driver.aggregate({ _avg: { declineRate: true } }),
      this.prisma.syncLog.findFirst({
        where: { status: 'success' },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.driver.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          name: true,
          ds: true,
          _count: {
            select: {
              routes: {
                where: { status: RouteStatus.ATRIBUIDA },
              },
            },
          },
        },
      }),
      this.prisma.route.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          createdAt: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const blockedDrivers = blocklistStatuses.filter(
      (entry) => this.normalizeBlocklistStatusValue(entry.status) === 'BLOCKED',
    ).length;
    const lastSync = lastSuccessfulSync || lastSyncAttempt;

    const totalRoutes = routesAvailable + routesAssigned + routesBlocked;
    const historyMap = new Map<string, { date: string; atribuidas: number; disponiveis: number; bloqueadas: number }>();

    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      historyMap.set(key, {
        date: this.formatDayLabel(date),
        atribuidas: 0,
        disponiveis: 0,
        bloqueadas: 0,
      });
    }

    recentRoutes.forEach((route) => {
      const key = route.createdAt.toISOString().slice(0, 10);
      const bucket = historyMap.get(key);
      if (!bucket) return;
      if (route.status === RouteStatus.ATRIBUIDA) bucket.atribuidas += 1;
      if (route.status === RouteStatus.DISPONIVEL) bucket.disponiveis += 1;
      if (route.status === RouteStatus.BLOQUEADA) bucket.bloqueadas += 1;
    });

    const payload = {
      stats: {
        totalDrivers,
        routesAvailable,
        routesAssigned,
        routesBlocked,
        occupationRate: totalRoutes ? Math.round((routesAssigned / totalRoutes) * 100) : 0,
        blockedDrivers,
        lastSync: lastSync
          ? {
              ...lastSync,
              startedAt: this.toIsoString(lastSync.startedAt),
              finishedAt: this.toIsoString(lastSync.finishedAt),
            }
          : null,
        avgDeclineRate: Number((avgDriverAgg._avg.declineRate || 0).toFixed(2)),
      },
      routesPerDay: Array.from(historyMap.values()),
      routeDistribution: [
        { status: 'Disponiveis', count: routesAvailable, fill: 'var(--color-chart-2)' },
        { status: 'Atribuidas', count: routesAssigned, fill: 'var(--color-chart-1)' },
        { status: 'Bloqueadas', count: routesBlocked, fill: 'var(--color-chart-3)' },
      ],
      topDrivers: topDriversRaw
        .map((driver) => ({
          name: driver.name?.split(' ')[0] || driver.id,
          score: Number((this.normalizePlanningDs(driver.ds) * 100).toFixed(1)),
          routes: driver._count.routes,
        }))
        .sort((left, right) => right.score - left.score || right.routes - left.routes)
        .slice(0, 10),
    };

    await this.redisService.set(
      cacheKey,
      payload,
      this.DASHBOARD_EXECUTIVE_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  private async getNoShowDashboardSection() {
    const cacheKey = `${this.DASHBOARD_NOSHOW_CACHE_PREFIX}:v1`;
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const noShowWindowStart = new Date();
    noShowWindowStart.setHours(0, 0, 0, 0);
    noShowWindowStart.setDate(noShowWindowStart.getDate() - 29);

    const noShowTodayStart = new Date();
    noShowTodayStart.setHours(0, 0, 0, 0);

    const [totalRoutesAll, totalNoShowAll, noShowRoutesWindow, noShowRoutesRecent, clusterMap] =
      await Promise.all([
        this.prisma.route.count(),
        this.prisma.route.count({ where: { noShow: true } }),
        this.prisma.route.findMany({
          where: {
            noShow: true,
            createdAt: {
              gte: noShowWindowStart,
            },
          },
          select: {
            id: true,
            atId: true,
            routeDate: true,
            shift: true,
            cidade: true,
            bairro: true,
            driverId: true,
            driverName: true,
            driverVehicleType: true,
            assignmentSource: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.route.findMany({
          where: { noShow: true },
          select: {
            id: true,
            atId: true,
            routeDate: true,
            shift: true,
            cidade: true,
            bairro: true,
            driverId: true,
            driverName: true,
            driverVehicleType: true,
            assignmentSource: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 12,
        }),
        this.getPlanningClusterMap(),
      ]);

    const noShowByDayMap = new Map<string, { date: string; count: number }>();
    const noShowByShiftMap = new Map<string, number>();
    const noShowByCityMap = new Map<string, number>();
    const noShowByVehicleMap = new Map<string, number>();
    const noShowByAssignmentSourceMap = new Map<string, number>();
    const noShowByWeekdayMap = new Map<string, number>();
    const noShowByClusterMap = new Map<string, number>();
    const noShowByClusterTrendMap = new Map<string, Map<string, number>>();

    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      noShowByDayMap.set(key, {
        date: this.formatDayLabel(date),
        count: 0,
      });
    }

    let noShowToday = 0;

    for (const route of noShowRoutesWindow) {
      const referenceDate = this.resolveRouteReferenceDate(route);
      const dayKey = referenceDate.toISOString().slice(0, 10);
      const dayBucket = noShowByDayMap.get(dayKey);
      if (dayBucket) {
        dayBucket.count += 1;
      }

      if (referenceDate >= noShowTodayStart) {
        noShowToday += 1;
      }

      const shiftLabel = String(route.shift || 'Sem turno').trim() || 'Sem turno';
      noShowByShiftMap.set(shiftLabel, (noShowByShiftMap.get(shiftLabel) || 0) + 1);

      const cityLabel = String(route.cidade || 'Sem cidade').trim() || 'Sem cidade';
      noShowByCityMap.set(cityLabel, (noShowByCityMap.get(cityLabel) || 0) + 1);

      const vehicleLabel = String(route.driverVehicleType || 'Sem veiculo').trim() || 'Sem veiculo';
      noShowByVehicleMap.set(vehicleLabel, (noShowByVehicleMap.get(vehicleLabel) || 0) + 1);

      const sourceLabel = String(route.assignmentSource || 'SYNC').trim() || 'SYNC';
      noShowByAssignmentSourceMap.set(
        sourceLabel,
        (noShowByAssignmentSourceMap.get(sourceLabel) || 0) + 1,
      );

      const weekdayLabel = referenceDate.toLocaleDateString('pt-BR', { weekday: 'short' });
      noShowByWeekdayMap.set(weekdayLabel, (noShowByWeekdayMap.get(weekdayLabel) || 0) + 1);

      const clusterLabel = clusterMap.get(route.atId) || 'Sem cluster';
      noShowByClusterMap.set(clusterLabel, (noShowByClusterMap.get(clusterLabel) || 0) + 1);
      const clusterTrendBucket = noShowByClusterTrendMap.get(dayKey) || new Map<string, number>();
      clusterTrendBucket.set(clusterLabel, (clusterTrendBucket.get(clusterLabel) || 0) + 1);
      noShowByClusterTrendMap.set(dayKey, clusterTrendBucket);
    }

    const noShowRate = totalRoutesAll ? Math.round((totalNoShowAll / totalRoutesAll) * 1000) / 10 : 0;
    const topShift = this.toTopBreakdownEntries(noShowByShiftMap, 1)[0] || null;
    const topCity = this.toTopBreakdownEntries(noShowByCityMap, 1)[0] || null;
    const topCluster = this.toTopBreakdownEntries(noShowByClusterMap, 1)[0] || null;

    const payload = {
      noShow: {
        summary: {
          total: totalNoShowAll,
          last30Days: noShowRoutesWindow.length,
          today: noShowToday,
          rate: noShowRate,
          affectedCities: noShowByCityMap.size,
          affectedClusters: Array.from(noShowByClusterMap.keys()).filter((value) => value !== 'Sem cluster').length,
          topShift: topShift?.label || null,
          topCity: topCity?.label || null,
          topCluster: topCluster?.label || null,
        },
        byDay: Array.from(noShowByDayMap.values()),
        byShift: this.toTopBreakdownEntries(noShowByShiftMap),
        byCity: this.toTopBreakdownEntries(noShowByCityMap),
        byCluster: this.toTopBreakdownEntries(noShowByClusterMap),
        byClusterTrend: Array.from(noShowByDayMap.entries()).map(([dayKey, item]) => {
          const trendBucket = noShowByClusterTrendMap.get(dayKey) || new Map<string, number>();
          return {
            date: item.date,
            values: Array.from(trendBucket.entries())
              .map(([label, count]) => ({ label, count }))
              .sort((left, right) => left.label.localeCompare(right.label)),
          };
        }),
        byVehicle: this.toTopBreakdownEntries(noShowByVehicleMap),
        byAssignmentSource: this.toTopBreakdownEntries(noShowByAssignmentSourceMap),
        byWeekday: this.toTopBreakdownEntries(noShowByWeekdayMap, 7),
        recentRoutes: noShowRoutesRecent.map((route) => ({
          id: route.id,
          atId: route.atId,
          routeDate: route.routeDate,
          shift: route.shift,
          cidade: route.cidade,
          bairro: route.bairro,
          driverId: route.driverId,
          driverName: route.driverName,
          driverVehicleType: route.driverVehicleType,
          assignmentSource: route.assignmentSource,
          cluster: clusterMap.get(route.atId) || null,
          createdAt: this.toIsoString(route.createdAt),
          updatedAt: this.toIsoString(route.updatedAt),
        })),
      },
    };

    await this.redisService.set(
      cacheKey,
      payload,
      this.DASHBOARD_NOSHOW_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async getDashboardData() {
    const [executive, noShow] = await Promise.all([
      this.getExecutiveDashboardSection(),
      this.getNoShowDashboardSection(),
    ]);

    return {
      ...executive,
      ...noShow,
    };
  }

  async getDrivers(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    vehicleType?: string;
    ds?: string;
    sortBy?: 'name' | 'priorityScore' | 'noShowCount' | 'declineRate';
    sortDir?: 'asc' | 'desc';
  }) {
    const page = Math.max(1, Number(params?.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(params?.pageSize || 20)));
    const search = String(params?.search || '').trim();
    const vehicleType = String(params?.vehicleType || '').trim();
    const ds = String(params?.ds || '').trim();
    const sortBy = params?.sortBy || 'priorityScore';
    const sortDir = params?.sortDir === 'asc' ? 'asc' : 'desc';
    const driversCacheKey = `${this.DRIVERS_LIST_CACHE_PREFIX}:${JSON.stringify({
      page,
      pageSize,
      search,
      vehicleType,
      ds,
      sortBy,
      sortDir,
    })}`;
    const cachedDrivers = await this.redisService.get<any>(driversCacheKey);
    if (cachedDrivers) {
      return cachedDrivers;
    }

    const where = {
      ...(search
        ? {
            OR: [
              {
                id: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                name: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      ...(vehicleType ? { vehicleType } : {}),
      ...(ds ? { ds } : {}),
    };

    const orderBy: any =
      sortBy === 'name'
        ? [{ name: sortDir }, { updatedAt: 'desc' as const }]
        : [{ [sortBy]: sortDir }, { updatedAt: 'desc' as const }];

    const [data, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.driver.count({ where }),
    ]);

    const payload = {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };

    await this.redisService.set(
      driversCacheKey,
      payload,
      this.DRIVERS_LIST_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async getDriversAnalytics() {
    const cacheKey = `${this.DRIVERS_ANALYTICS_CACHE_PREFIX}:v1`;
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const activeDriversSql = Prisma.sql`
      WITH active_drivers AS (
        SELECT d.*
        FROM "Driver" d
        LEFT JOIN "DriverBlocklist" db
          ON db."driverId" = d."id"
         AND db."status"::text IN ('BLOCKED', 'ACTIVE')
        WHERE db."driverId" IS NULL
      )
    `;

    const dsSanitizedSql = Prisma.sql`
      NULLIF(
        REGEXP_REPLACE(COALESCE(ad."ds", ''), '[^0-9,.-]', '', 'g'),
        ''
      )
    `;

    const dsNumericSql = Prisma.sql`
      CASE
        WHEN ${dsSanitizedSql} IS NOT NULL
          THEN REPLACE(${dsSanitizedSql}, ',', '.')::double precision
        ELSE NULL
      END
    `;

    const dsPercentSql = Prisma.sql`
      CASE
        WHEN ${dsNumericSql} IS NULL THEN NULL
        WHEN ${dsNumericSql} <= 1 THEN ${dsNumericSql} * 100
        ELSE ${dsNumericSql}
      END
    `;

    const [summaryRows, blockedRows, byVehicleRows, topScoreRows, topRiskRows, filterRows, dsSummaryRows, dsByVehicleRows, topDsRows, lowDsRows] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{
          totalactivedrivers: bigint | number;
          highriskcount: bigint | number;
          totalnoshow: bigint | number;
          avgscore: number | null;
          avgds: number | null;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            COUNT(*) AS "totalactivedrivers",
            COUNT(*) FILTER (WHERE (ad."noShowCount" * 10) + (ad."declineRate" * 100) > 60) AS "highriskcount",
            COALESCE(SUM(ad."noShowCount"), 0) AS "totalnoshow",
            COALESCE(ROUND(AVG(ad."priorityScore")::numeric, 1), 0) AS "avgscore",
            COALESCE(ROUND(AVG(${dsPercentSql})::numeric, 1), 0) AS "avgds"
          FROM active_drivers ad
        `),
        this.prisma.$queryRaw<Array<{ blockedcount: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS "blockedcount"
          FROM "DriverBlocklist"
          WHERE "status"::text IN ('BLOCKED', 'ACTIVE')
        `),
        this.prisma.$queryRaw<Array<{ label: string; count: bigint | number }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            COALESCE(NULLIF(TRIM(ad."vehicleType"), ''), 'Sem veiculo') AS "label",
            COUNT(*) AS "count"
          FROM active_drivers ad
          GROUP BY 1
          ORDER BY COUNT(*) DESC, 1 ASC
          LIMIT 5
        `),
        this.prisma.$queryRaw<Array<{
          id: string;
          name: string | null;
          vehicletype: string | null;
          ds: string | null;
          noshowcount: number;
          declinerate: number;
          priorityscore: number;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            ad."id",
            ad."name",
            ad."vehicleType" AS "vehicletype",
            ad."ds",
            ad."noShowCount" AS "noshowcount",
            ad."declineRate" AS "declinerate",
            ad."priorityScore" AS "priorityscore"
          FROM active_drivers ad
          ORDER BY ad."priorityScore" DESC, ad."updatedAt" DESC
          LIMIT 5
        `),
        this.prisma.$queryRaw<Array<{
          id: string;
          name: string | null;
          vehicletype: string | null;
          ds: string | null;
          noshowcount: number;
          declinerate: number;
          priorityscore: number;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            ad."id",
            ad."name",
            ad."vehicleType" AS "vehicletype",
            ad."ds",
            ad."noShowCount" AS "noshowcount",
            ad."declineRate" AS "declinerate",
            ad."priorityScore" AS "priorityscore"
          FROM active_drivers ad
          ORDER BY ((ad."noShowCount" * 10) + (ad."declineRate" * 100)) DESC, ad."updatedAt" DESC
          LIMIT 5
        `),
        this.prisma.$queryRaw<Array<{ vehicletype: string | null; ds: string | null }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT DISTINCT
            ad."vehicleType" AS "vehicletype",
            ad."ds"
          FROM active_drivers ad
        `),
        this.prisma.$queryRaw<Array<{
          dsabove90count: bigint | number;
          dsbetween80and90count: bigint | number;
          dsbelow80count: bigint | number;
          maxds: number | null;
          minds: number | null;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            COUNT(*) FILTER (WHERE ${dsPercentSql} >= 90) AS "dsabove90count",
            COUNT(*) FILTER (WHERE ${dsPercentSql} >= 80 AND ${dsPercentSql} < 90) AS "dsbetween80and90count",
            COUNT(*) FILTER (WHERE ${dsPercentSql} < 80) AS "dsbelow80count",
            COALESCE(MAX(${dsPercentSql}), 0) AS "maxds",
            COALESCE(MIN(${dsPercentSql}), 0) AS "minds"
          FROM active_drivers ad
          WHERE ${dsPercentSql} IS NOT NULL
        `),
        this.prisma.$queryRaw<Array<{
          label: string;
          avgds: number | null;
          count: bigint | number;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            COALESCE(NULLIF(TRIM(ad."vehicleType"), ''), 'Sem veiculo') AS "label",
            COALESCE(ROUND(AVG(${dsPercentSql})::numeric, 1), 0) AS "avgds",
            COUNT(*) AS "count"
          FROM active_drivers ad
          WHERE ${dsPercentSql} IS NOT NULL
          GROUP BY 1
          ORDER BY "avgds" DESC, "count" DESC, 1 ASC
          LIMIT 5
        `),
        this.prisma.$queryRaw<Array<{
          id: string;
          name: string | null;
          vehicletype: string | null;
          dspercent: number;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            ad."id",
            ad."name",
            ad."vehicleType" AS "vehicletype",
            ${dsPercentSql} AS "dspercent"
          FROM active_drivers ad
          WHERE ${dsPercentSql} IS NOT NULL
          ORDER BY ${dsPercentSql} DESC, ad."updatedAt" DESC
          LIMIT 5
        `),
        this.prisma.$queryRaw<Array<{
          id: string;
          name: string | null;
          vehicletype: string | null;
          dspercent: number;
        }>>(Prisma.sql`
          ${activeDriversSql}
          SELECT
            ad."id",
            ad."name",
            ad."vehicleType" AS "vehicletype",
            ${dsPercentSql} AS "dspercent"
          FROM active_drivers ad
          WHERE ${dsPercentSql} IS NOT NULL
          ORDER BY ${dsPercentSql} ASC, ad."updatedAt" DESC
          LIMIT 5
        `),
      ]);

    const summary = summaryRows[0] || {
      totalactivedrivers: 0,
      highriskcount: 0,
      totalnoshow: 0,
      avgscore: 0,
      avgds: 0,
    };
    const blocked = blockedRows[0] || { blockedcount: 0 };
    const dsSummary = dsSummaryRows[0] || {
      dsabove90count: 0,
      dsbetween80and90count: 0,
      dsbelow80count: 0,
      maxds: 0,
      minds: 0,
    };

    const normalizeDriverRow = (row: {
      id: string;
      name: string | null;
      vehicletype: string | null;
      ds: string | null;
      noshowcount: number;
      declinerate: number;
      priorityscore: number;
    }) => ({
      id: row.id,
      name: row.name,
      vehicleType: row.vehicletype,
      ds: row.ds,
      noShowCount: Number(row.noshowcount || 0),
      declineRate: Number(row.declinerate || 0),
      priorityScore: Number(row.priorityscore || 0),
    });

    const payload = {
      summary: {
        totalActiveDrivers: Number(summary.totalactivedrivers || 0),
        blockedCount: Number(blocked.blockedcount || 0),
        highRiskCount: Number(summary.highriskcount || 0),
        totalNoShow: Number(summary.totalnoshow || 0),
        avgScore: Number(summary.avgscore || 0),
        avgDs: Number(summary.avgds || 0),
      },
      dsAnalysis: {
        above90Count: Number(dsSummary.dsabove90count || 0),
        between80And90Count: Number(dsSummary.dsbetween80and90count || 0),
        below80Count: Number(dsSummary.dsbelow80count || 0),
        maxDs: Number(dsSummary.maxds || 0),
        minDs: Number(dsSummary.minds || 0),
        byVehicle: dsByVehicleRows.map((row) => ({
          label: row.label,
          avgDs: Number(row.avgds || 0),
          count: Number(row.count || 0),
        })),
        topDs: topDsRows.map((row) => ({
          id: row.id,
          name: row.name,
          vehicleType: row.vehicletype,
          ds: Number(row.dspercent || 0),
        })),
        lowDs: lowDsRows.map((row) => ({
          id: row.id,
          name: row.name,
          vehicleType: row.vehicletype,
          ds: Number(row.dspercent || 0),
        })),
      },
      byVehicle: byVehicleRows.map((row) => ({
        label: row.label,
        count: Number(row.count || 0),
      })),
      topScore: topScoreRows.map(normalizeDriverRow),
      topRisk: topRiskRows.map(normalizeDriverRow),
      filterOptions: {
        vehicleTypes: Array.from(
          new Set(
            filterRows
              .map((row) => String(row.vehicletype || '').trim())
              .filter(Boolean),
          ),
        ).sort((left, right) => left.localeCompare(right)),
        dsValues: Array.from(
          new Set(
            filterRows
              .map((row) => String(row.ds || '').trim())
              .filter(Boolean),
          ),
        ).sort((left, right) => left.localeCompare(right)),
      },
    };

    await this.redisService.set(
      cacheKey,
      payload,
      this.DRIVERS_ANALYTICS_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async updateDriverPriorityScore(driverId: string, priorityScoreRaw: number) {
    const priorityScore = Number(priorityScoreRaw);
    if (!Number.isFinite(priorityScore) || priorityScore < 0 || priorityScore > 100) {
      return { ok: false, message: 'Priority score deve estar entre 0 e 100.' };
    }

    const before = await this.prisma.driver.findUnique({
      where: { id: String(driverId).trim() },
      select: { priorityScore: true },
    });
    await this.prisma.driver.update({
      where: { id: String(driverId).trim() },
      data: { priorityScore },
    });
    await this.recordAudit({
      entityType: 'Driver',
      entityId: String(driverId).trim(),
      action: 'UPDATE_PRIORITY',
      userId: 'system',
      userName: 'System',
      before: before ? { priorityScore: before.priorityScore } : null,
      after: { priorityScore },
    });

    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateDriversCaches(),
    ]);

    return { ok: true, message: 'Priority score atualizado com sucesso.' };
  }

  async resetDriverNoShow(driverId: string) {
    const before = await this.prisma.driver.findUnique({
      where: { id: String(driverId).trim() },
      select: { noShowCount: true },
    });
    await this.prisma.driver.update({
      where: { id: String(driverId).trim() },
      data: { noShowCount: 0 },
    });
    await this.recordAudit({
      entityType: 'Driver',
      entityId: String(driverId).trim(),
      action: 'RESET_NOSHOW',
      userId: 'system',
      userName: 'System',
      before: before ? { noShowCount: before.noShowCount } : null,
      after: { noShowCount: 0 },
    });

    await this.invalidateDriversCaches();

    return { ok: true, message: 'No-show resetado com sucesso.' };
  }

  async getRoutes(date?: string, shift?: 'AM' | 'PM' | 'PM2') {
    const effectiveWindow = await this.getEffectiveRouteWindow();
    const selectedDate = String(date || '').trim() || effectiveWindow.date;
    const selectedShift =
      String(shift || '').trim().toUpperCase() === 'AM' ||
      String(shift || '').trim().toUpperCase() === 'PM' ||
      String(shift || '').trim().toUpperCase() === 'PM2'
        ? (String(shift || '').trim().toUpperCase() as 'AM' | 'PM' | 'PM2')
        : undefined;
    const cacheKey = `${this.ROUTES_CACHE_PREFIX}:v2:${selectedDate}:${selectedShift || 'all'}`;
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const historyRows = await this.sheets.getRows("'Historico ATs'!A:X").catch(() => []);
    const clusterByAt = new Map<string, string>();

    for (const row of historyRows.slice(1)) {
      const atId = String(row[0] || '').trim();
      const cluster = String(row[23] || '').trim();
      if (!atId || !cluster) continue;
      if (!clusterByAt.has(atId)) {
        clusterByAt.set(atId, cluster);
      }
    }

    const routes = await (this.prisma as any).route.findMany({
      where: {
        AND: [
          selectedShift ? { shift: selectedShift } : {},
          {
            OR: [
              { routeDate: selectedDate },
              { noShow: true, status: RouteStatus.DISPONIVEL },
            ],
          },
        ],
      },
      include: { driver: true },
      orderBy: [{ routeDate: 'desc' }, { createdAt: 'desc' }],
    });

    const requestedDriverIds: string[] = Array.from(
      new Set<string>(
        routes
          .map((route: any) => String(route.requestedDriverId || '').trim())
          .filter((value: string): value is string => Boolean(value)),
      ),
    );
    const requestedDrivers = requestedDriverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: requestedDriverIds } },
          select: { id: true, name: true },
        })
      : [];
    const requestedDriverNameById = new Map(
      requestedDrivers.map((driver) => [driver.id, driver.name || driver.id]),
    );

    const normalized = routes.map((route: any) => ({
      ...route,
      cluster: clusterByAt.get(String(route.atId || '').trim()) || null,
      driverName: route.driverName || route.driver?.name || null,
      driverVehicleType: route.driverVehicleType || route.driver?.vehicleType || null,
      requestedDriverName: route.requestedDriverId
        ? requestedDriverNameById.get(String(route.requestedDriverId).trim()) || route.requestedDriverId
        : null,
    }));

    const payload = normalized.sort((a: any, b: any) => {
      const aPriority = a.noShow && a.status === RouteStatus.DISPONIVEL ? 0 : a.noShow ? 1 : 2;
      const bPriority = b.noShow && b.status === RouteStatus.DISPONIVEL ? 0 : b.noShow ? 1 : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return String(b.routeDate || '').localeCompare(String(a.routeDate || ''));
    });

    await this.redisService.set(
      cacheKey,
      payload,
      this.ROUTES_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async getRoutePlanning(
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
    atId?: string,
    focus?: RoutePlanningFocus,
  ) {
    const selectedDate = String(date || '').trim() || new Date().toISOString().slice(0, 10);
    const requestedShift = String(shift || '').trim() || undefined;
    const selectedAtId = String(atId || '').trim() || undefined;
    const selectedFocus: RoutePlanningFocus = focus === 'VOLUME' ? 'VOLUME' : focus === 'PM' ? 'PM' : 'DS';
    const selectedShift = selectedFocus === 'PM' ? 'PM' : requestedShift;
    const driverWindow = await this.resolveRoutePlanningWindow(selectedDate, selectedShift as 'AM' | 'PM' | 'PM2' | undefined);

    const [planning, availableDrivers, routes] = await Promise.all([
      this.computeRoutePlanningAssignments(selectedFocus, driverWindow),
      this.getRoutePlanningAvailableDrivers(driverWindow),
      (this.prisma as any).route.findMany({
        include: { driver: true },
        where: {
          AND: [
            selectedShift ? { shift: selectedShift } : {},
            selectedAtId ? { atId: selectedAtId } : {},
            {
              OR: [
                { routeDate: selectedDate },
                { noShow: true, status: RouteStatus.DISPONIVEL },
              ],
            },
          ],
        },
        orderBy: [
          { noShow: 'desc' },
          { assignmentSource: 'asc' },
          { atId: 'asc' },
        ],
      }),
    ]);

    const planningDriverIds = planning.drivers
      .map((driver) => String(driver.id || '').trim())
      .filter(Boolean);

    const planningDriverMetadata: Array<{
      id: string;
      name: string | null;
      vehicleType: string | null;
      ds: string | null;
    }> = planningDriverIds.length
      ? await (this.prisma as any).driver.findMany({
          where: {
            id: {
              in: planningDriverIds,
            },
          },
          select: {
            id: true,
            name: true,
            vehicleType: true,
            ds: true,
          },
        })
      : [];

    const planningDriverMetadataById = new Map<string, (typeof planningDriverMetadata)[number]>(
      planningDriverMetadata.map((driver) => [driver.id, driver]),
    );

    const assignmentByAt = new Map(
      planning.assignments.map((assignment) => [assignment.atId, assignment]),
    );
    const planningDriverById = new Map(
      planning.drivers.map((driver) => [driver.id, driver]),
    );

    const data = routes.map((route: any) => {
      const assignment = assignmentByAt.get(route.atId);
      const suggestedDriver = assignment
        ? planningDriverById.get(assignment.suggestedDriverId)
        : null;

      return {
        ...route,
        driverName: route.driverName || route.driver?.name || null,
        driverVehicleType: route.driverVehicleType || route.driver?.vehicleType || null,
        hasTelegramRequest: route.assignmentSource === ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
        hasManualRequest: route.assignmentSource === ROUTE_ASSIGNMENT_SOURCE.MANUAL,
        suggestedDriverId: assignment?.suggestedDriverId || null,
        suggestedDriverName: suggestedDriver?.name || null,
        suggestedPhase: assignment?.phase || null,
        suggestedObservation: assignment?.obs || null,
        suggestedDriverVehicle: assignment?.suggestedDriverVehicle || null,
        suggestedDriverDs: assignment ? Number(assignment.suggestedDriverDs.toFixed(2)) : null,
        clusterRoute: assignment?.clusterRoute || null,
        clusterDriver: assignment?.clusterDriver || null,
      };
    });

    return {
      date: selectedDate,
      shift: selectedShift || null,
      focus: selectedFocus,
      driverWindow: {
        date: availableDrivers.window.date,
        shift: availableDrivers.window.shift,
        previousDate: availableDrivers.previousWindow.date,
        previousShift: availableDrivers.previousWindow.shift,
      },
      totals: {
        routes: data.length,
        noShowAvailable: data.filter((route: any) => route.noShow && route.status === RouteStatus.DISPONIVEL).length,
        telegramRequested: data.filter((route: any) => route.assignmentSource === ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT).length,
        manualRequested: data.filter((route: any) => route.assignmentSource === ROUTE_ASSIGNMENT_SOURCE.MANUAL).length,
        pendingRequest: data.filter((route: any) => !route.requestedDriverId).length,
        suggestions: data.filter((route: any) => !!route.suggestedDriverId).length,
      },
      drivers: planning.drivers.map((driver) => {
        const metadata = planningDriverMetadataById.get(driver.id);
        const fallbackDs = this.normalizePlanningDs(metadata?.ds);
        const normalizedDs = Number.isFinite(driver.ds) ? driver.ds : fallbackDs;

        return {
          id: driver.id,
          name: String(driver.name || metadata?.name || driver.id),
          vehicleType: String(driver.veiculo || metadata?.vehicleType || ''),
          available: driver.disponivel,
          ds: Number(normalizedDs.toFixed(2)),
          profile: driver.perfil,
          clusters: driver.clusters,
        };
      }),
      preferredAssignments: planning.preferredAssignments,
      availableDrivers: availableDrivers.drivers,
      data,
    };
  }

  async updateRoutePlanningPreferences(preferences: Array<Record<string, unknown>>) {
    const normalized = this.normalizeRoutePlanningPreferences(preferences);
    const existingDrivers = await (this.prisma as any).driver.findMany({
      where: {
        id: {
          in: normalized.map((entry) => entry.driverId),
        },
      },
      select: {
        id: true,
      },
    });

    const validDriverIds = new Set(existingDrivers.map((driver: any) => String(driver.id)));
    const filtered = normalized.filter((entry) => validDriverIds.has(entry.driverId));
    await (this.prisma as any).systemConfig.upsert({
      where: { key: this.ROUTE_PLANNING_PREFERENCES_KEY },
      create: { key: this.ROUTE_PLANNING_PREFERENCES_KEY, value: filtered as any },
      update: { value: filtered as any },
    });

    const allDrivers: Array<{
      id: string;
      name: string | null;
      vehicleType: string | null;
    }> = await (this.prisma as any).driver.findMany({
      select: {
        id: true,
        name: true,
        vehicleType: true,
      },
    });
    const driverMap = new Map<string, (typeof allDrivers)[number]>(
      allDrivers.map((driver) => [String(driver.id), driver]),
    );
    const clusterLabelByCode = await this.getPlanningClusterLabelMap();

    return {
      ok: true,
      message: 'Preferencias de cluster atualizadas com sucesso.',
      preferences: filtered.map((entry) => {
        const driver = driverMap.get(entry.driverId);
        return {
          cluster: entry.cluster,
          clusterName: clusterLabelByCode.get(entry.cluster) || null,
          driverId: entry.driverId,
          driverName: driver?.name || null,
          vehicleType: driver?.vehicleType || null,
          available: false,
        };
      }),
    };
  }

  async runRoutePlanning(
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
    focus?: RoutePlanningFocus,
  ) {
    const selectedDate = String(date || '').trim() || new Date().toISOString().slice(0, 10);
    const requestedShift = String(shift || '').trim() || null;
    const selectedFocus: RoutePlanningFocus = focus === 'VOLUME' ? 'VOLUME' : focus === 'PM' ? 'PM' : 'DS';
    const selectedShift = selectedFocus === 'PM' ? 'PM' : requestedShift;
    const driverWindow = await this.resolveRoutePlanningWindow(selectedDate, selectedShift as 'AM' | 'PM' | 'PM2' | undefined);
    const planning = await this.computeRoutePlanningAssignments(selectedFocus, driverWindow);

    await this.sheets.clearValues("'Drivers Disponiveis'!K2:K");
    await this.sheets.ensureSheetExists('Sheet42');
    await this.sheets.clearValues("'Sheet42'!A:N");

    if (planning.outputK.length > 0) {
      await this.sheets.batchUpdateValues([
        {
          range: `'Drivers Disponiveis'!K2:K${planning.outputK.length + 1}`,
          values: planning.outputK,
        },
      ]);
    }

    if (planning.logRows.length > 0) {
      await this.sheets.batchUpdateValues([
        {
          range: `'Sheet42'!A1:N${planning.logRows.length}`,
          values: planning.logRows,
        },
      ]);
    }

    return {
      ok: true,
      message: `Planejamento executado para ${selectedDate}${selectedShift ? ` (${selectedShift})` : ''} com foco ${selectedFocus}.`,
      focus: selectedFocus,
      totalAssignments: planning.assignments.length,
      totalDriversUsed: new Set(planning.assignments.map((assignment) => assignment.suggestedDriverId)).size,
      assignments: planning.assignments,
    };
  }

  async getRoutePlanningMap(atId?: string, cluster?: string, br?: string) {
    const rows = await this.sheets.getRows("'Calculation Tasks'!A:AB");
    if (!rows.length) {
      return {
        routes: [],
        clusters: [],
        nearbyRoutes: [],
        searchedBr: null,
      };
    }

    const selectedAtId = String(atId || '').trim();
    const selectedCluster = String(cluster || '').trim();
    const searchedBr = String(br || '').trim().toUpperCase();
    const grouped = new Map<
      string,
      Map<string, { stop: number; latitude: number; longitude: number; packageCount: number; cluster: string; brs: string[] }>
    >();
    const availableClusters = new Set<string>();
    let matchedBrPoint:
      | {
          br: string;
          latitude: number;
          longitude: number;
          routeAtId: string;
          stop: number;
          cluster: string;
        }
      | null = null;
    let lastRouteAtId = '';
    let lastStop = 0;
    let lastCluster = '';
    let lastBr = '';

    for (const row of rows.slice(1)) {
      const routeAtIdRaw = String(row[27] || '').trim();
      if (routeAtIdRaw) {
        lastRouteAtId = routeAtIdRaw;
      }

      const routeAtId = lastRouteAtId;
      if (!routeAtId) continue;
      if (selectedAtId && routeAtId !== selectedAtId) continue;

      const clusterRaw = String(row[9] || '').trim().toUpperCase();
      if (clusterRaw) {
        lastCluster = clusterRaw;
      }
      const routeCluster = lastCluster;
      if (routeCluster) {
        availableClusters.add(routeCluster);
      }
      if (selectedCluster && routeCluster !== selectedCluster) continue;

      const coordinates = this.normalizePlanningCoordinates(row[16], row[17]);
      const latitude = coordinates.latitude;
      const longitude = coordinates.longitude;

      const stopRaw = String(row[3] || '').trim();
      if (stopRaw) {
        const parsedStop = Number(stopRaw);
        if (Number.isFinite(parsedStop)) {
          lastStop = parsedStop;
        }
      }

      const stop = lastStop;
      const brRaw = String(row[7] || '').trim().toUpperCase();
      if (brRaw) {
        lastBr = brRaw;
      }
      const packageBr = lastBr;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      if (!Number.isFinite(stop)) continue;

      const routeStops = grouped.get(routeAtId) || new Map();
      const key = `${stop}:${latitude}:${longitude}`;
      const existing = routeStops.get(key);

      if (existing) {
        existing.packageCount += 1;
      } else {
        routeStops.set(key, {
          stop,
          latitude,
          longitude,
          packageCount: 1,
          cluster: routeCluster,
          brs: packageBr ? [packageBr] : [],
        });
      }

      if (existing && packageBr && !existing.brs.includes(packageBr)) {
        existing.brs.push(packageBr);
      }

      if (
        searchedBr &&
        packageBr === searchedBr &&
        !matchedBrPoint
      ) {
        matchedBrPoint = {
          br: packageBr,
          latitude,
          longitude,
          routeAtId,
          stop,
          cluster: routeCluster,
        };
      }

      grouped.set(routeAtId, routeStops);
    }

    const palette = [
      '#dc2626',
      '#2563eb',
      '#16a34a',
      '#d97706',
      '#7c3aed',
      '#0891b2',
      '#be123c',
      '#4f46e5',
      '#65a30d',
      '#0f766e',
    ];

    const routes = Array.from(grouped.entries()).map(([routeAtId, stopsMap], index) => {
      const stops = Array.from(stopsMap.values()).sort((a, b) => a.stop - b.stop);

      return {
        atId: routeAtId,
        color: palette[index % palette.length],
        stops,
      };
    });

    const routeMetaRows = await (this.prisma as any).route.findMany({
      where: {
        atId: {
          in: routes.map((route) => route.atId),
        },
      },
      include: {
        driver: {
          select: {
            name: true,
            vehicleType: true,
          },
        },
      },
      orderBy: [{ routeDate: 'desc' }, { updatedAt: 'desc' }],
    });

    const routeMetaByAt = new Map<string, any>();
    for (const routeMeta of routeMetaRows) {
      if (!routeMetaByAt.has(routeMeta.atId)) {
        routeMetaByAt.set(routeMeta.atId, routeMeta);
      }
    }

    const nearbyRoutes = matchedBrPoint
      ? routes
          .map((route) => {
            const routeMeta = routeMetaByAt.get(route.atId);
            const nearest = route.stops.reduce(
              (best, stop) => {
                const distanceKm = this.calculateHaversineDistanceKm(
                  matchedBrPoint!.latitude,
                  matchedBrPoint!.longitude,
                  stop.latitude,
                  stop.longitude,
                );

                if (!best || distanceKm < best.distanceKm) {
                  return {
                    distanceKm,
                    stop: stop.stop,
                    cluster: stop.cluster,
                  };
                }

                return best;
              },
              null as null | { distanceKm: number; stop: number; cluster: string },
            );

            if (!nearest) return null;

            return {
              atId: route.atId,
              color: route.color,
              distanceKm: Number(nearest.distanceKm.toFixed(2)),
              nearestStop: nearest.stop,
              cluster: nearest.cluster,
              isSameRoute: route.atId === matchedBrPoint.routeAtId,
              driverName:
                routeMeta?.driverName ||
                routeMeta?.driver?.name ||
                routeMeta?.driverId ||
                null,
              vehicleType:
                routeMeta?.driverVehicleType ||
                routeMeta?.driver?.vehicleType ||
                null,
            };
          })
          .filter(Boolean)
          .sort((left: any, right: any) => left.distanceKm - right.distanceKm)
          .slice(0, 10)
      : [];

    return {
      routes,
      clusters: Array.from(availableClusters).sort((left, right) => left.localeCompare(right)),
      searchedBr: matchedBrPoint
        ? {
            br: matchedBrPoint.br,
            latitude: matchedBrPoint.latitude,
            longitude: matchedBrPoint.longitude,
            atId: matchedBrPoint.routeAtId,
            stop: matchedBrPoint.stop,
            cluster: matchedBrPoint.cluster,
          }
        : searchedBr
          ? { br: searchedBr, latitude: null, longitude: null, atId: null, stop: null, cluster: null }
          : null,
      nearbyRoutes,
    };
  }

  private calculateHaversineDistanceKm(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
  ) {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(latitudeB - latitudeA);
    const dLng = toRad(longitudeB - longitudeA);
    const lat1 = toRad(latitudeA);
    const lat2 = toRad(latitudeB);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private normalizePlanningCoordinates(latitudeValue: unknown, longitudeValue: unknown) {
    let latitude = this.parsePlanningCoordinate(latitudeValue);
    let longitude = this.parsePlanningCoordinate(longitudeValue);

    const latitudeLooksValid = Number.isFinite(latitude) && Math.abs(latitude) <= 90;
    const longitudeLooksValid = Number.isFinite(longitude) && Math.abs(longitude) <= 180;

    if (!latitudeLooksValid || !longitudeLooksValid) {
      const swappedLatitudeLooksValid = Number.isFinite(longitude) && Math.abs(longitude) <= 90;
      const swappedLongitudeLooksValid = Number.isFinite(latitude) && Math.abs(latitude) <= 180;

      if (swappedLatitudeLooksValid && swappedLongitudeLooksValid) {
        const originalLatitude = latitude;
        latitude = longitude;
        longitude = originalLatitude;
      }
    }

    return { latitude, longitude };
  }

  private parsePlanningCoordinate(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) return Number.NaN;

    const compact = raw.replace(/\s+/g, '');
    const sign = compact.startsWith('-') ? -1 : 1;
    const digitsOnly = compact.replace(/\./g, '').replace(/[^\d]/g, '');

    if (!digitsOnly) return Number.NaN;

    const numeric = Number(digitsOnly);
    if (!Number.isFinite(numeric)) return Number.NaN;

    return (numeric / 10000000) * sign;
  }

  private async computeRoutePlanningAssignments(
    focus: RoutePlanningFocus = 'DS',
    window?: RoutePlanningWindow,
  ): Promise<RoutePlanningComputation> {
    const effectiveWindow = window || (await this.resolveRoutePlanningWindow());
    const [driversRows, visaoRows, relatorioRows, availabilityContext] = await Promise.all([
      this.sheets.getRows("'Drivers Disponiveis'!A:M"),
      this.sheets.getRows("'Visão Geral Atribuições'!A:R"),
      this.sheets.getRows("'Relatorio de Expedição'!A:AC"),
      this.getRoutePlanningAvailableDrivers(window || effectiveWindow),
    ]);

    if (visaoRows.length < 2 || relatorioRows.length < 2) {
      return {
        assignments: [],
        drivers: [],
        preferredAssignments: [],
        outputK: Array.from({ length: Math.max(0, driversRows.length - 1) }, () => ['']),
        logRows: [
          [
            'AT',
            'Veículo Programado',
            'Motorista Atual',
            'Veículo Atual',
            'DS Atual',
            'Perfil Atual',
            'Novo Motorista',
            'Veículo Novo',
            'DS Novo',
            'Perfil Novo',
            'Cluster Rota',
            'Cluster Motorista',
            'Fase',
            'Obs',
          ],
        ],
      };
    }

    const mapaATClusters = new Map<string, string[]>();
    for (const row of relatorioRows.slice(1)) {
      const atId = String(row[1] || '').trim();
      const rawClusters = row[28];
      if (!atId || !rawClusters) continue;

      const clusters = this.extractPlanningClusters(rawClusters);
      if (clusters.length) mapaATClusters.set(atId, clusters);
    }

    const mapaDrivers = new Map<string, PlanningDriver>();
    const rowById = new Map<string, number>();
    const profileById = new Map<string, string>();

    for (let index = 1; index < driversRows.length; index += 1) {
      const row = driversRows[index] || [];
      const id = String(row[0] || '').trim();
      if (!id) continue;
      rowById.set(id, index);
      profileById.set(id, this.normalizePlanningProfile(row[12]));
    }

    for (const availableDriver of availabilityContext.drivers) {
      const inferredProfile =
        availableDriver.ds >= 0.92 ? 'VETERANO' : availableDriver.ds > 0 ? 'NOVATO' : '';
      const rowIndex = rowById.get(availableDriver.id) || 0;

      const driver: PlanningDriver = {
        id: availableDriver.id,
        name: availableDriver.name,
        veiculo: availableDriver.vehicleType,
        disponivel: availableDriver.available,
        ds: availableDriver.ds,
        clusters: availableDriver.clusters,
        perfil: profileById.get(availableDriver.id) || inferredProfile,
        rowIndex,
      };

      mapaDrivers.set(driver.id, driver);
    }

    const clusterLabelByCode = this.buildPlanningClusterLabelMap([
      ...relatorioRows.slice(1).map((row) => row?.[28]),
      ...driversRows.slice(1).map((row) => row?.[7]),
    ]);

    const savedPreferences = await this.getRoutePlanningPreferences();

    const outputK = Array.from({ length: Math.max(0, driversRows.length - 1) }, () => ['']);
    const atsUsadas = new Set<string>();
    const motoristasUsados = new Set<string>();
    const assignments: PlanningAssignment[] = [];
    const logRows: string[][] = [
      [
        'AT',
        'Veículo Programado',
        'Motorista Atual',
        'Veículo Atual',
        'DS Atual',
        'Perfil Atual',
        'Novo Motorista',
        'Veículo Novo',
        'DS Novo',
        'Perfil Novo',
        'Cluster Rota',
        'Cluster Motorista',
        'Fase',
        'Obs',
      ],
    ];

    const rotasOrdenadasBase = visaoRows
      .slice(1)
      .map((row) => ({
        atId: String(row[0] || '').trim(),
        tipoProgRaw: String(row[8] || '').toUpperCase().trim(),
        volume: this.parsePlanningNumber(row[6]),
      }))
      .filter((row) => row.atId && mapaATClusters.has(row.atId))
      .sort((a, b) => b.volume - a.volume);

    if (focus === 'PM') {
      await this.computePmPlanningAssignments({
        window: effectiveWindow,
        routes: rotasOrdenadasBase,
        routeClusters: mapaATClusters,
        drivers: Array.from(mapaDrivers.values()),
        usedRouteIds: atsUsadas,
        usedDriverIds: motoristasUsados,
        rowById,
        outputK,
        assignments,
        logRows,
      });

      return {
        assignments,
        drivers: Array.from(mapaDrivers.values()),
        preferredAssignments: savedPreferences.map((entry) => {
          const driver = mapaDrivers.get(entry.driverId);
          return {
            cluster: entry.cluster,
            clusterName: clusterLabelByCode.get(entry.cluster) || null,
            driverId: entry.driverId,
            driverName: driver?.name || null,
            vehicleType: driver?.veiculo || null,
            available: !!driver?.disponivel,
          };
        }),
        outputK,
        logRows,
      };
    }

    this.preAllocateManualClusterPreferences({
      preferences: savedPreferences,
      routes: rotasOrdenadasBase,
      routeClusters: mapaATClusters,
      drivers: Array.from(mapaDrivers.values()),
      usedRouteIds: atsUsadas,
      usedDriverIds: motoristasUsados,
      rowById,
      outputK,
      assignments,
      logRows,
    });

    this.preAllocatePreferredVehicles({
      focus,
      routes: rotasOrdenadasBase,
      routeClusters: mapaATClusters,
      drivers: Array.from(mapaDrivers.values()),
      usedRouteIds: atsUsadas,
      usedDriverIds: motoristasUsados,
      rowById,
      outputK,
      assignments,
      logRows,
    });

    for (let index = 1; index < visaoRows.length; index += 1) {
      const row = visaoRows[index] || [];
      const atId = String(row[0] || '').trim();
      const tipoProgRaw = String(row[8] || '').toUpperCase().trim();
      const motoristaAtual = String(row[9] || '').trim();
      const volume = this.parsePlanningNumber(row[6]);

      if (!atId || !motoristaAtual) continue;
      if (!mapaATClusters.has(atId)) continue;
      if (atsUsadas.has(atId)) continue;

      const infoAtual = mapaDrivers.get(motoristaAtual);
      if (!infoAtual) continue;

      const atualRuim = infoAtual.perfil === 'VETERANO' && infoAtual.ds < 0.92;
      if (!atualRuim) continue;

      const clustersAT = mapaATClusters.get(atId) || [];
      const isMoto = tipoProgRaw.includes('MOTO');
      const candidato = this.escolherPlanejamentoCandidato(
        Array.from(mapaDrivers.values()),
        motoristasUsados,
        clustersAT,
        isMoto,
        volume,
      );

      if (!candidato) continue;

      atsUsadas.add(atId);
      motoristasUsados.add(candidato.id);

      const rowIndex = rowById.get(candidato.id);
      if (typeof rowIndex === 'number' && outputK[rowIndex - 1]) {
        outputK[rowIndex - 1][0] = atId;
      }

      const assignment = this.buildPlanningAssignment({
        atId,
        tipoProgRaw,
        currentDriverId: motoristaAtual,
        currentDriver: infoAtual,
        suggestedDriver: candidato,
        clusterRoute: clustersAT[0] || '',
        phase: 'FASE A',
        obs: `Volume: ${volume}`,
      });

      assignments.push(assignment);
      logRows.push(this.planningAssignmentToLogRow(assignment));
    }

    const rotasOrdenadas = rotasOrdenadasBase;

    for (const rota of rotasOrdenadas) {
      if (atsUsadas.has(rota.atId)) continue;

      const isMoto = rota.tipoProgRaw.includes('MOTO');
      const clustersAT = mapaATClusters.get(rota.atId) || [];

      const candidatos = Array.from(mapaDrivers.values())
        .filter((driver) => {
          if (motoristasUsados.has(driver.id)) return false;
          if (!driver.disponivel) return false;
          if (!this.isPlanningDriverEligible(driver)) return false;
          if (!this.hasPlanningClusterIntersection(driver.clusters, clustersAT)) return false;

          if (isMoto) return driver.veiculo === 'MOTO';
          if (driver.veiculo === 'MOTO') return false;
          if (rota.volume >= 600) return ['FIORINO', 'VAN'].includes(driver.veiculo);
          return true;
        })
        .sort((left, right) => {
          if (isMoto) {
            return right.ds - left.ds;
          }

          if (rota.volume >= 600) {
            const dsDiff = right.ds - left.ds;
            if (dsDiff !== 0) return dsDiff;
            return this.getPlanningVehicleScore(left.veiculo) - this.getPlanningVehicleScore(right.veiculo);
          }

          const dsDiff = right.ds - left.ds;
          if (dsDiff !== 0) return dsDiff;
          return this.getPlanningVehicleScore(left.veiculo) - this.getPlanningVehicleScore(right.veiculo);
        });

      const escolhido = candidatos[0];
      if (!escolhido) continue;
      if (rota.volume >= 600 && !['FIORINO', 'VAN'].includes(escolhido.veiculo)) continue;

      atsUsadas.add(rota.atId);
      motoristasUsados.add(escolhido.id);

      const rowIndex = rowById.get(escolhido.id);
      if (typeof rowIndex === 'number' && outputK[rowIndex - 1]) {
        outputK[rowIndex - 1][0] = rota.atId;
      }

      const assignment = this.buildPlanningAssignment({
        atId: rota.atId,
        tipoProgRaw: rota.tipoProgRaw,
        currentDriverId: '',
        currentDriver: null,
        suggestedDriver: escolhido,
        clusterRoute: clustersAT[0] || '',
        phase: 'FASE B',
        obs: `Volume: ${rota.volume}`,
      });

      assignments.push(assignment);
      logRows.push(this.planningAssignmentToLogRow(assignment));
    }

    return {
      assignments,
      drivers: Array.from(mapaDrivers.values()),
      preferredAssignments: savedPreferences.map((entry) => {
        const driver = mapaDrivers.get(entry.driverId);
        return {
          cluster: entry.cluster,
          clusterName: clusterLabelByCode.get(entry.cluster) || null,
          driverId: entry.driverId,
          driverName: driver?.name || null,
          vehicleType: driver?.veiculo || null,
          available: !!driver?.disponivel,
        };
      }),
      outputK,
      logRows,
    };
  }

  private escolherPlanejamentoCandidato(
    drivers: PlanningDriver[],
    usedDriverIds: Set<string>,
    clustersAT: string[],
    isMoto: boolean,
    volume: number,
  ) {
    let melhor: PlanningDriver | null = null;

    for (const driver of drivers) {
      if (usedDriverIds.has(driver.id)) continue;
      if (!driver.disponivel) continue;
      if (!this.isPlanningDriverEligible(driver)) continue;
      if (!this.hasPlanningClusterIntersection(driver.clusters, clustersAT)) continue;

      if (isMoto) {
        if (driver.veiculo !== 'MOTO') continue;
        if (!melhor || driver.ds > melhor.ds) melhor = driver;
        continue;
      }

      if (driver.veiculo === 'MOTO') continue;
      if (volume >= 600 && !['FIORINO', 'VAN'].includes(driver.veiculo)) continue;

      if (
        !melhor ||
        driver.ds > melhor.ds ||
        (driver.ds === melhor.ds &&
          this.getPlanningVehicleScore(driver.veiculo) < this.getPlanningVehicleScore(melhor.veiculo))
      ) {
        melhor = driver;
      }
    }

    return melhor;
  }

  private async computePmPlanningAssignments(params: {
    window: RoutePlanningWindow;
    routes: Array<{ atId: string; tipoProgRaw: string; volume: number }>;
    routeClusters: Map<string, string[]>;
    drivers: PlanningDriver[];
    usedRouteIds: Set<string>;
    usedDriverIds: Set<string>;
    rowById: Map<string, number>;
    outputK: string[][];
    assignments: PlanningAssignment[];
    logRows: string[][];
  }) {
    const previousWindow = this.getPreviousRoutePlanningWindow(params.window);
    const driverIds = params.drivers.map((driver) => driver.id);

    const [currentRoutes, previousRoutes, targetRoutes] = driverIds.length
      ? await Promise.all([
          (this.prisma as any).route.findMany({
            where: {
              driverId: { in: driverIds },
              routeDate: params.window.date,
              shift: params.window.shift,
            },
            select: { driverId: true },
          }),
          (this.prisma as any).route.findMany({
            where: {
              driverId: { in: driverIds },
              routeDate: previousWindow.date,
              shift: previousWindow.shift,
            },
            select: { driverId: true },
          }),
          (this.prisma as any).route.findMany({
            where: {
              routeDate: params.window.date,
              shift: params.window.shift,
            },
            select: { atId: true },
          }),
        ])
      : [[], [], []];

    const unavailableDriverIds = new Set(
      [...currentRoutes, ...previousRoutes]
        .map((route: { driverId?: string | null }) => String(route.driverId || '').trim())
        .filter(Boolean),
    );
    const targetAtIds = new Set(
      targetRoutes
        .map((route: { atId?: string | null }) => String(route.atId || '').trim())
        .filter(Boolean),
    );

    const candidates = params.drivers
      .filter((driver) => driver.disponivel)
      .filter((driver) => driver.veiculo === 'FIORINO')
      .filter((driver) => !params.usedDriverIds.has(driver.id))
      .filter((driver) => !unavailableDriverIds.has(driver.id))
      .sort((left, right) => right.ds - left.ds);

    for (const driver of candidates) {
      const route =
        params.routes.find((candidateRoute) => {
          if (params.usedRouteIds.has(candidateRoute.atId)) return false;
          if (targetAtIds.size && !targetAtIds.has(candidateRoute.atId)) return false;
          if (candidateRoute.tipoProgRaw.includes('MOTO')) return false;

          const routeClusters = params.routeClusters.get(candidateRoute.atId) || [];
          return this.hasPlanningClusterIntersection(driver.clusters, routeClusters);
        }) ||
        params.routes.find((candidateRoute) => {
          if (params.usedRouteIds.has(candidateRoute.atId)) return false;
          if (targetAtIds.size && !targetAtIds.has(candidateRoute.atId)) return false;
          return !candidateRoute.tipoProgRaw.includes('MOTO');
        });

      if (!route) continue;

      const routeClusters = params.routeClusters.get(route.atId) || [];

      params.usedRouteIds.add(route.atId);
      params.usedDriverIds.add(driver.id);

      const rowIndex = params.rowById.get(driver.id);
      if (typeof rowIndex === 'number' && params.outputK[rowIndex - 1]) {
        params.outputK[rowIndex - 1][0] = route.atId;
      }

      const assignment = this.buildPlanningAssignment({
        atId: route.atId,
        tipoProgRaw: route.tipoProgRaw,
        currentDriverId: '',
        currentDriver: null,
        suggestedDriver: driver,
        clusterRoute: routeClusters[0] || '',
        phase: 'FASE A',
        obs: `Algoritmo PM | Turno ${params.window.shift} | Exclui ${previousWindow.shift} anterior`,
      });

      params.assignments.push(assignment);
      params.logRows.push(this.planningAssignmentToLogRow(assignment));
    }
  }

  private preAllocatePreferredVehicles(params: {
    focus: RoutePlanningFocus;
    routes: Array<{ atId: string; tipoProgRaw: string; volume: number }>;
    routeClusters: Map<string, string[]>;
    drivers: PlanningDriver[];
    usedRouteIds: Set<string>;
    usedDriverIds: Set<string>;
    rowById: Map<string, number>;
    outputK: string[][];
    assignments: PlanningAssignment[];
    logRows: string[][];
  }) {
    const vehicleConfigs =
      params.focus === 'VOLUME'
        ? [
            {
              vehicle: 'FIORINO',
              minDs: 0,
              label: 'Foco VOLUME (Fiorino priorizada)',
            },
            {
              vehicle: 'VAN',
              minDs: 0,
              label: 'Foco VOLUME (Van garantida)',
            },
          ]
        : [
            {
              vehicle: 'FIORINO',
              minDs: 0.9,
              label: 'Foco DS (Fiorino > 90%)',
            },
            {
              vehicle: 'VAN',
              minDs: 0,
              label: 'Foco DS (Van garantida)',
            },
          ];

    const maxRouteClusterDepth = params.routes.reduce((maxDepth, route) => {
      const clusters = params.routeClusters.get(route.atId) || [];
      return Math.max(maxDepth, clusters.length);
    }, 0);

    for (const config of vehicleConfigs) {
      for (let clusterIndex = 0; clusterIndex < maxRouteClusterDepth; clusterIndex += 1) {
        const candidates = params.drivers
          .filter(
            (driver) =>
              !params.usedDriverIds.has(driver.id) &&
              driver.disponivel &&
              driver.veiculo === config.vehicle &&
              driver.ds >= config.minDs,
          )
          .sort((left, right) => right.ds - left.ds);

        if (!candidates.length) continue;

        for (const driver of candidates) {
          if (params.usedDriverIds.has(driver.id)) continue;

          const route = params.routes.find((candidateRoute) => {
            if (params.usedRouteIds.has(candidateRoute.atId)) return false;
            if (candidateRoute.tipoProgRaw.includes('MOTO')) return false;

            const routeClusters = params.routeClusters.get(candidateRoute.atId) || [];
            const routeCluster = routeClusters[clusterIndex];
            if (!routeCluster) return false;

            return driver.clusters.includes(routeCluster);
          });

          if (!route) continue;

          const matchedRouteClusters = params.routeClusters.get(route.atId) || [];
          const matchedRouteCluster = matchedRouteClusters[clusterIndex] || matchedRouteClusters[0] || '';

          params.usedRouteIds.add(route.atId);
          params.usedDriverIds.add(driver.id);

          const rowIndex = params.rowById.get(driver.id);
          if (typeof rowIndex === 'number' && params.outputK[rowIndex - 1]) {
            params.outputK[rowIndex - 1][0] = route.atId;
          }

          const assignment = this.buildPlanningAssignment({
            atId: route.atId,
            tipoProgRaw: route.tipoProgRaw,
            currentDriverId: '',
            currentDriver: null,
            suggestedDriver: driver,
            clusterRoute: matchedRouteCluster,
            phase: 'FASE A',
            obs: `Volume: ${route.volume} | ${config.label} | Cluster #${clusterIndex + 1}`,
          });

          params.assignments.push(assignment);
          params.logRows.push(this.planningAssignmentToLogRow(assignment));
        }
      }
    }
  }

  private preAllocateManualClusterPreferences(params: {
    preferences: RoutePlanningPreferenceEntry[];
    routes: Array<{ atId: string; tipoProgRaw: string; volume: number }>;
    routeClusters: Map<string, string[]>;
    drivers: PlanningDriver[];
    usedRouteIds: Set<string>;
    usedDriverIds: Set<string>;
    rowById: Map<string, number>;
    outputK: string[][];
    assignments: PlanningAssignment[];
    logRows: string[][];
  }) {
    const driversById = new Map(params.drivers.map((driver) => [driver.id, driver]));

    const orderedPreferences = params.preferences
      .map((entry) => ({
        ...entry,
        driver: driversById.get(entry.driverId) || null,
      }))
      .filter((entry): entry is RoutePlanningPreferenceEntry & { driver: PlanningDriver } => !!entry.driver)
      .sort((left, right) => right.driver.ds - left.driver.ds);

    for (const preference of orderedPreferences) {
      if (params.usedDriverIds.has(preference.driverId)) continue;
      if (!preference.driver.disponivel) continue;

      const route = params.routes.find((candidateRoute) => {
        if (params.usedRouteIds.has(candidateRoute.atId)) return false;

        const isMotoRoute = candidateRoute.tipoProgRaw.includes('MOTO');
        if (isMotoRoute) return preference.driver.veiculo === 'MOTO';
        if (preference.driver.veiculo === 'MOTO') return false;
        if (candidateRoute.volume >= 600 && !['FIORINO', 'VAN'].includes(preference.driver.veiculo)) return false;

        const primaryRouteCluster = (params.routeClusters.get(candidateRoute.atId) || [])[0];
        if (!primaryRouteCluster) return false;
        return primaryRouteCluster === preference.cluster;
      });

      if (!route) continue;

      params.usedRouteIds.add(route.atId);
      params.usedDriverIds.add(preference.driverId);

      const rowIndex = params.rowById.get(preference.driverId);
      if (typeof rowIndex === 'number' && params.outputK[rowIndex - 1]) {
        params.outputK[rowIndex - 1][0] = route.atId;
      }

      const assignment = this.buildPlanningAssignment({
        atId: route.atId,
        tipoProgRaw: route.tipoProgRaw,
        currentDriverId: '',
        currentDriver: null,
        suggestedDriver: preference.driver,
        clusterRoute: preference.cluster,
        phase: 'FASE A',
        obs: `Volume: ${route.volume} | Preferencia manual de cluster`,
      });

      params.assignments.push(assignment);
      params.logRows.push(this.planningAssignmentToLogRow(assignment));
    }
  }

  private normalizeRoutePlanningPreferences(
    preferences: Array<Record<string, unknown>>,
  ): RoutePlanningPreferenceEntry[] {
    const normalized = preferences
      .map((entry) => ({
        cluster: String(entry.cluster || '')
          .trim()
          .padStart(2, '0')
          .slice(0, 2),
        driverId: String(entry.driverId || '').trim(),
      }))
      .filter((entry) => /^\d{2}$/.test(entry.cluster) && !!entry.driverId);

    const unique = new Map<string, RoutePlanningPreferenceEntry>();
    for (const entry of normalized) {
      unique.set(`${entry.cluster}:${entry.driverId}`, entry);
    }

    return Array.from(unique.values());
  }

  private async getRoutePlanningPreferences(): Promise<RoutePlanningPreferenceEntry[]> {
    const row = await (this.prisma as any).systemConfig.findUnique({
      where: { key: this.ROUTE_PLANNING_PREFERENCES_KEY },
    });

    const raw = Array.isArray(row?.value) ? (row.value as Array<Record<string, unknown>>) : [];
    return this.normalizeRoutePlanningPreferences(raw);
  }

  private async getPlanningClusterLabelMap(): Promise<Map<string, string>> {
    try {
      const [driverClusterRows, relatorioClusterRows] = await Promise.all([
        this.sheets.getRows("'Drivers Disponiveis'!H:H"),
        this.sheets.getRows("'Relatorio de Expedição'!AC:AC"),
      ]);

      return this.buildPlanningClusterLabelMap([
        ...driverClusterRows.slice(1).map((row) => row?.[0]),
        ...relatorioClusterRows.slice(1).map((row) => row?.[0]),
      ]);
    } catch {
      return new Map<string, string>();
    }
  }

  private buildPlanningClusterLabelMap(values: unknown[]) {
    const labels = new Map<string, string>();

    for (const value of values) {
      for (const entry of this.extractPlanningClusterEntries(value)) {
        if (!labels.has(entry.code) && entry.name) {
          labels.set(entry.code, entry.name);
        }
      }
    }

    return labels;
  }

  private buildPlanningAssignment(params: {
    atId: string;
    tipoProgRaw: string;
    currentDriverId: string;
    currentDriver: PlanningDriver | null;
    suggestedDriver: PlanningDriver;
    clusterRoute: string;
    phase: PlanningPhase;
    obs: string;
  }): PlanningAssignment {
    return {
      atId: params.atId,
      suggestedDriverId: params.suggestedDriver.id,
      phase: params.phase,
      obs: params.obs,
      tipoProgRaw: params.tipoProgRaw,
      currentDriverId: params.currentDriverId,
      currentDriverVehicle: params.currentDriver?.veiculo || '',
      currentDriverDs: params.currentDriver?.ds || 0,
      currentDriverProfile: params.currentDriver?.perfil || '',
      clusterRoute: params.clusterRoute,
      clusterDriver: params.suggestedDriver.clusters[0] || '',
      suggestedDriverVehicle: params.suggestedDriver.veiculo,
      suggestedDriverDs: params.suggestedDriver.ds,
      suggestedDriverProfile: params.suggestedDriver.perfil,
    };
  }

  private planningAssignmentToLogRow(assignment: PlanningAssignment): string[] {
    return [
      assignment.atId,
      assignment.tipoProgRaw,
      assignment.currentDriverId,
      assignment.currentDriverVehicle,
      assignment.currentDriverDs ? String(assignment.currentDriverDs) : '',
      assignment.currentDriverProfile,
      assignment.suggestedDriverId,
      assignment.suggestedDriverVehicle,
      String(assignment.suggestedDriverDs),
      assignment.suggestedDriverProfile,
      assignment.clusterRoute,
      assignment.clusterDriver,
      assignment.phase,
      assignment.obs,
    ];
  }

  private isPlanningDriverEligible(driver: PlanningDriver) {
    return (
      driver.perfil === 'NOVATO' ||
      (driver.perfil === 'VETERANO' && driver.ds >= 0.92)
    );
  }

  private getPlanningVehicleScore(vehicle: string) {
    if (vehicle === 'FIORINO') return 1;
    if (vehicle === 'VAN') return 2;
    if (vehicle === 'PASSEIO') return 3;
    return 99;
  }

  private normalizePlanningAvailable(value: unknown) {
    return ['SIM', 'TRUE', 'DISPONÍVEL', 'DISPONIVEL', '1', 'YES'].includes(
      String(value || '').toUpperCase().trim(),
    );
  }

  private normalizePlanningVehicle(value: unknown) {
    const text = String(value || '').toUpperCase();
    if (text.includes('FIORINO')) return 'FIORINO';
    if (text.includes('VAN')) return 'VAN';
    if (text.includes('MOTO')) return 'MOTO';
    if (text.includes('PASSEIO')) return 'PASSEIO';
    return text.trim();
  }

  private normalizePlanningProfile(value: unknown) {
    const text = String(value || '').toUpperCase();
    if (text.includes('NOVATO')) return 'NOVATO';
    if (text.includes('VETERANO')) return 'VETERANO';
    return '';
  }

  private normalizePlanningDs(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;

    const compact = raw.replace(/\s+/g, '').replace(/%/g, '');
    const sanitized = compact.includes(',')
      ? compact.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
      : compact.replace(/[^\d.-]/g, '');

    const numeric = Number(sanitized);
    if (!Number.isFinite(numeric)) return 0;
    return numeric > 1 ? numeric / 100 : numeric;
  }

  private extractPlanningClusters(value: unknown) {
    return this.extractPlanningClusterEntries(value).map((entry) => entry.code);
  }

  private extractPlanningClusterEntries(value: unknown) {
    const text = String(value || '');
    if (!text.trim()) return [];

    const clusters = new Map<string, { code: string; name: string | null }>();
    text.split(/[;,]/).forEach((chunk) => {
      const normalizedChunk = String(chunk || '').trim();
      if (!normalizedChunk) return;

      const match = normalizedChunk.match(/^(\d{1,2})(.*)$/);
      if (!match) return;

      const code = match[1].padStart(2, '0');
      const suffix = String(match[2] || '')
        .replace(/^[\s\-–—:|]+/, '')
        .trim();

      if (!clusters.has(code)) {
        clusters.set(code, {
          code,
          name: suffix || null,
        });
      }
    });

    return Array.from(clusters.values());
  }

  private hasPlanningClusterIntersection(driverClusters: string[], routeClusters: string[]) {
    if (!driverClusters.length || !routeClusters.length) return false;
    const routePrimaryCluster = routeClusters[0];
    return driverClusters.includes(routePrimaryCluster);
  }

  private parsePlanningNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  async getAssignedRoutesCsv(date?: string) {
    const routeDate = String(date || '').trim() || undefined;
    const routes = await (this.prisma as any).route.findMany({
      where: {
        OR: [
          {
            assignmentSource: ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT,
            requestedDriverId: { not: null },
          },
          {
            assignmentSource: ROUTE_ASSIGNMENT_SOURCE.MANUAL,
            status: RouteStatus.ATRIBUIDA,
          },
        ],
        ...(routeDate ? { routeDate } : {}),
      },
      orderBy: [{ routeDate: 'asc' }, { shift: 'asc' }, { atId: 'asc' }],
      select: {
        atId: true,
        requestedDriverId: true,
        driverId: true,
        routeDate: true,
        shift: true,
        assignmentSource: true,
        status: true,
      },
    });

    const escapeCsv = (value: string | null | undefined) => {
      const text = String(value ?? '');
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const header = ['AT', 'ID Motorista', 'Data', 'Turno', 'Origem', 'Situacao'];
    const rows = routes.map((route: {
      atId: string;
      requestedDriverId: string | null;
      driverId: string | null;
      routeDate: string | null;
      shift: string | null;
      assignmentSource: RouteAssignmentSourceValue;
      status: RouteStatus;
    }) =>
      [
        route.atId,
        route.driverId || route.requestedDriverId,
        route.routeDate,
        route.shift,
        route.assignmentSource,
        route.status === RouteStatus.ATRIBUIDA ? 'ATRIBUIDA' : 'SOLICITADA',
      ]
        .map(escapeCsv)
        .join(','),
    );

    return [header.join(','), ...rows].join('\n');
  }

  async assignRoute(routeIdRaw: string, driverIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    const driverId = String(driverIdRaw || '').trim();

    if (!routeId || !driverId) {
      return { ok: false, message: 'Rota e motorista sao obrigatorios.' };
    }

    const prisma = this.prisma as any;
    const [route, driver, alreadyAssigned] = await Promise.all([
      prisma.route.findUnique({ where: { id: routeId } }),
      this.prisma.driver.findUnique({ where: { id: driverId } }),
      prisma.route.findFirst({
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
    if (
      normalizedRequired === 'MOTO' &&
      normalizedDriver !== 'MOTO'
    ) {
      return { ok: false, message: 'O motorista nao atende o veiculo requerido para a rota.' };
    }

    const nextAssignmentSource =
      route.assignmentSource === ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT &&
      route.requestedDriverId &&
      route.requestedDriverId === driver.id
        ? ROUTE_ASSIGNMENT_SOURCE.TELEGRAM_BOT
        : ROUTE_ASSIGNMENT_SOURCE.MANUAL;

    await prisma.route.update({
      where: { id: routeId },
      data: {
        requestedDriverId: driver.id,
        assignmentSource: nextAssignmentSource,
        driverId: driver.id,
        driverName: driver.name,
        driverVehicleType: driver.vehicleType,
        status: RouteStatus.ATRIBUIDA,
        assignedAt: new Date(),
      },
    });
    await this.sheets.updateAssignmentRequest(routeId, driver.id);
    await this.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'MANUAL_ASSIGN',
      userId: 'system',
      userName: 'System',
      after: { driverId: driver.id, status: RouteStatus.ATRIBUIDA },
    });

    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateNoShowDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateRoutesCache(),
    ]);

    return { ok: true, message: 'Rota atribuida com sucesso.' };
  }

  async unassignRoute(routeIdRaw: string, markNoShow = false) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    await (this.prisma as any).route.update({
      where: { id: routeId },
      data: {
        requestedDriverId: null,
        assignmentSource: ROUTE_ASSIGNMENT_SOURCE.SYNC,
        noShow: markNoShow,
        driverId: null,
        driverName: null,
        driverVehicleType: null,
        driverAccuracy: null,
        driverPlate: null,
        status: RouteStatus.DISPONIVEL,
        assignedAt: null,
      },
    });
    await this.sheets.clearAssignmentRequest(routeId);
    await this.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: markNoShow ? 'UNASSIGN_NOSHOW' : 'UNASSIGN',
      userId: 'system',
      userName: 'System',
      after: { driverId: null, status: RouteStatus.DISPONIVEL, noShow: markNoShow },
    });

    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateNoShowDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateRoutesCache(),
    ]);

    return {
      ok: true,
      message: markNoShow
        ? 'Rota marcada como no-show e disponibilizada novamente.'
        : 'Rota desatribuida com sucesso.',
    };
  }

  async blockRoute(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    await this.prisma.route.update({
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
    await this.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'BLOCK',
      userId: 'system',
      userName: 'System',
      after: { status: RouteStatus.BLOQUEADA },
    });

    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateNoShowDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateRoutesCache(),
    ]);

    return { ok: true, message: 'Rota bloqueada com sucesso.' };
  }

  async markRouteNoShow(routeIdRaw: string, makeAvailable = false) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    const prisma = this.prisma as any;
    await prisma.route.update({
      where: { id: routeId },
      data: {
        noShow: true,
        ...(makeAvailable
          ? {
              requestedDriverId: null,
              assignmentSource: ROUTE_ASSIGNMENT_SOURCE.SYNC,
              driverId: null,
              driverName: null,
              driverVehicleType: null,
              driverAccuracy: null,
              driverPlate: null,
              assignedAt: null,
              status: RouteStatus.DISPONIVEL,
            }
          : {}),
      },
    });

    if (makeAvailable) {
      await this.sheets.clearAssignmentRequest(routeId);
    }

    await this.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: makeAvailable ? 'MARK_NOSHOW_AND_RELEASE' : 'MARK_NOSHOW',
      userId: 'system',
      userName: 'System',
      after: { noShow: true, makeAvailable },
    });

    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateNoShowDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateRoutesCache(),
    ]);

    return {
      ok: true,
      message: makeAvailable
        ? 'Rota marcada como no-show e liberada para nova selecao.'
        : 'Rota marcada como no-show com sucesso.',
    };
  }

  async releaseRouteToBot(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    const route = await (this.prisma as any).route.findUnique({
      where: { id: routeId },
      select: {
        id: true,
        atId: true,
        status: true,
        botAvailable: true,
      },
    });

    if (!route) {
      return { ok: false, message: 'Rota nao encontrada.' };
    }

    if (route.status !== RouteStatus.DISPONIVEL) {
      return { ok: false, message: 'Apenas rotas disponiveis podem ser liberadas no bot.' };
    }

    if (route.botAvailable) {
      return { ok: true, message: 'Rota ja estava liberada no bot.' };
    }

    await (this.prisma as any).route.update({
      where: { id: route.id },
      data: {
        botAvailable: true,
      },
    });

    await this.recordAudit({
      entityType: 'Route',
      entityId: route.id,
      action: 'RELEASE_TO_BOT',
      userId: 'system',
      userName: 'System',
      after: { botAvailable: true },
    });

    await Promise.all([
      this.invalidateRoutesCache(),
      this.invalidateOverviewRouteRequestsCache(),
    ]);

    return {
      ok: true,
      message: `Rota ${route.atId || route.id} liberada no bot.`,
    };
  }

  async releaseRoutesToBotByAt(
    atIdsRaw: string[] | string | undefined,
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
  ) {
    const atIds = this.normalizeAtIds(atIdsRaw);
    if (!atIds.length) {
      return { ok: false, message: 'Informe ao menos um AT para liberar no bot.' };
    }

    const selectedDate = String(date || '').trim() || undefined;
    const selectedShift =
      String(shift || '').trim().toUpperCase() === 'AM' ||
      String(shift || '').trim().toUpperCase() === 'PM' ||
      String(shift || '').trim().toUpperCase() === 'PM2'
        ? (String(shift || '').trim().toUpperCase() as 'AM' | 'PM' | 'PM2')
        : undefined;

    const result = await (this.prisma as any).route.updateMany({
      where: {
        atId: { in: atIds },
        status: RouteStatus.DISPONIVEL,
        botAvailable: false,
        ...(selectedDate ? { routeDate: selectedDate } : {}),
        ...(selectedShift ? { shift: selectedShift } : {}),
      },
      data: {
        botAvailable: true,
      },
    });

    await this.recordAudit({
      entityType: 'Route',
      entityId: atIds.join(','),
      action: 'BULK_RELEASE_TO_BOT',
      userId: 'system',
      userName: 'System',
      after: {
        atIds,
        date: selectedDate || null,
        shift: selectedShift || null,
        releasedCount: result.count,
      },
    });

    if (result.count > 0) {
      await Promise.all([
        this.invalidateRoutesCache(),
        this.invalidateOverviewRouteRequestsCache(),
      ]);
    }

    return {
      ok: true,
      count: result.count,
      message:
        result.count > 0
          ? `${result.count} rota(s) liberada(s) no bot.`
          : 'Nenhuma rota disponivel correspondente foi encontrada para liberar.',
    };
  }

  async clearRouteNoShow(routeIdRaw: string) {
    const routeId = String(routeIdRaw || '').trim();
    if (!routeId) return { ok: false, message: 'Rota invalida.' };

    await (this.prisma as any).route.update({
      where: { id: routeId },
      data: {
        noShow: false,
      },
    });

    await this.recordAudit({
      entityType: 'Route',
      entityId: routeId,
      action: 'CLEAR_NOSHOW',
      userId: 'system',
      userName: 'System',
      after: { noShow: false },
    });

    await Promise.all([
      this.invalidateNoShowDashboardCache(),
      this.invalidateRoutesCache(),
    ]);

    return {
      ok: true,
      message: 'Marcacao de no-show removida com sucesso.',
    };
  }

  async getBlocklist() {
    const cacheKey = `${this.BLOCKLIST_LIST_CACHE_PREFIX}:v1`;
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const entries = await this.prisma.driverBlocklist.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const driverIds = entries.map((entry) => entry.driverId);
    const [drivers, recentRoutes, overviewRows] = driverIds.length
      ? await Promise.all([
          this.prisma.driver.findMany({
            where: { id: { in: driverIds } },
            select: {
              id: true,
              name: true,
            },
          }),
          this.prisma.route.findMany({
            where: {
              driverId: { in: driverIds },
            },
            select: {
              driverId: true,
              driverName: true,
              updatedAt: true,
            },
            orderBy: [{ updatedAt: 'desc' }],
          }),
          this.prisma.assignmentOverview.findMany({
            where: {
              driverId: { in: driverIds },
            },
            select: {
              driverId: true,
              payload: true,
              updatedAt: true,
            },
            orderBy: [{ updatedAt: 'desc' }],
          }),
        ])
      : [[], [], []];
    const driverNameById = new Map<string, string | null>();

    recentRoutes.forEach((route) => {
      if (!route.driverId || driverNameById.has(route.driverId)) return;
      const routeName = String(route.driverName || '').trim();
      if (routeName && routeName !== route.driverId) {
        driverNameById.set(route.driverId, routeName);
      }
    });

    overviewRows.forEach((row) => {
      if (!row.driverId || driverNameById.has(row.driverId)) return;
      const payload = (row.payload || {}) as Record<string, unknown>;
      const overviewName = String(payload.driverName || '').trim();
      if (overviewName && overviewName !== row.driverId) {
        driverNameById.set(row.driverId, overviewName);
      }
    });

    drivers.forEach((driver) => {
      if (driverNameById.has(driver.id)) return;
      const driverName = String(driver.name || '').trim();
      driverNameById.set(driver.id, driverName && driverName !== driver.id ? driverName : null);
    });

    const payload = entries.map((entry) => ({
      ...entry,
      status: this.normalizeBlocklistStatusValue(entry.status),
      driverName: driverNameById.get(entry.driverId) || null,
    }));

    await this.redisService.set(
      cacheKey,
      payload,
      this.BLOCKLIST_LIST_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async getFaqItems() {
    return this.prisma.faqItem.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private encodeBase64Url(value: string): string {
    return Buffer.from(value, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private createJwtToken(payload: Record<string, unknown>): string {
    const header = this.encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.encodeBase64Url(JSON.stringify(payload));
    return `${header}.${body}.dev-signature`;
  }

  private async recordAudit(params: {
    entityType: string;
    entityId: string;
    action: string;
    userId?: string | null;
    userName: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          userId: params.userId || null,
          userName: params.userName,
          before: params.before || undefined,
          after: params.after || undefined,
        },
      });
    } catch {
      // Audit must not break core operations.
    }
  }

  private async ensureSupportSeedData(): Promise<void> {
    const prisma = this.prisma as any;
    const hubCount = await prisma.hub.count();
    if (!hubCount) {
      await prisma.hub.createMany({
        data: [
          { id: 'hub-sp', name: 'Hub Sao Paulo', timezone: 'America/Sao_Paulo' },
          { id: 'hub-cps', name: 'Hub Campinas', timezone: 'America/Sao_Paulo' },
          { id: 'hub-sts', name: 'Hub Santos', timezone: 'America/Sao_Paulo' },
        ],
        skipDuplicates: true,
      });
    }

    const analystCount = await prisma.analyst.count();
    if (!analystCount) {
      await prisma.analyst.createMany({
        data: [
          {
            id: 'admin-1',
            name: 'Aline Costa',
            email: 'admin@rotabot.com',
            password: 'admin123',
            role: 'ADMIN',
            hubId: 'hub-sp',
          },
          {
            id: 'analyst-1',
            name: 'Ana Analista',
            email: 'analista@rotabot.com',
            password: 'analista123',
            role: 'ANALISTA',
            hubId: 'hub-sp',
          },
          {
            id: 'super-1',
            name: 'Sergio Supervisor',
            email: 'supervisor@rotabot.com',
            password: 'super123',
            role: 'SUPERVISOR',
            hubId: null,
          },
          {
            id: 'analyst-2',
            name: 'Bruna Lemos',
            email: 'bruna@rotabot.com',
            password: 'bruna123',
            role: 'ANALISTA',
            hubId: 'hub-cps',
          },
        ],
        skipDuplicates: true,
      });
    }

    const drivers = await prisma.driver.findMany({
      orderBy: { createdAt: 'asc' },
      take: 6,
        select: { id: true, name: true, hubId: true },
      });
    const hubCycle = ['hub-sp', 'hub-sp', 'hub-cps', 'hub-sts', 'hub-sp', 'hub-cps'];
    await Promise.all(
      drivers.map((driver, index) => {
        if (driver.hubId) return Promise.resolve();
        return prisma.driver.update({
          where: { id: driver.id },
          data: { hubId: hubCycle[index] || 'hub-sp' },
        });
      }),
    );

    const configCount = await prisma.systemConfig.count();
    if (!configCount) {
      await prisma.systemConfig.createMany({
        data: [
          {
            key: 'algorithm',
            value: {
              noShowWeight: 30,
              declineWeight: 25,
              dsWeight: 20,
              blockThreshold: 70,
              autoBlock: true,
            } as any,
          },
          {
            key: 'system',
            value: {
              apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3001',
              telegramBotName: 'RotaBot Telegram',
              environment: process.env.NODE_ENV || 'development',
            } as any,
          },
        ],
        skipDuplicates: true,
      });
    }

    const ticketCount = await prisma.supportTicket.count();
    if (!ticketCount && drivers.length >= 3) {
      const protocols = ['ATD-20260228-001', 'ATD-20260228-002', 'ATD-20260228-003'];
      const createdTickets = await Promise.all(
        [0, 1, 2].map((index) =>
          prisma.supportTicket.create({
            data: {
              protocol: protocols[index],
              driverId: drivers[index].id,
              hubId: drivers[index].hubId || hubCycle[index] || 'hub-sp',
              analystId:
                index === 1 ? 'analyst-1' : index === 2 ? 'analyst-2' : null,
              status:
                index === 0
                  ? 'WAITING_ANALYST'
                  : index === 1
                    ? 'IN_PROGRESS'
                    : 'WAITING_DRIVER',
              queuePosition: index === 0 ? 1 : null,
              waitingSince: new Date(Date.now() - (index + 1) * 15 * 60 * 1000),
            },
          }),
        ),
      );

      await prisma.supportMessage.createMany({
        data: [
          {
            ticketId: createdTickets[0].id,
            authorType: 'DRIVER',
            authorId: null,
            authorName: drivers[0].name || drivers[0].id,
            body: 'Preciso confirmar minha rota de hoje.',
            telegramText: 'Preciso confirmar minha rota de hoje.',
          },
          {
            ticketId: createdTickets[1].id,
            authorType: 'DRIVER',
            authorId: null,
            authorName: drivers[1].name || drivers[1].id,
            body: 'Consigo trocar o horario da coleta?',
            telegramText: 'Consigo trocar o horario da coleta?',
          },
          {
            ticketId: createdTickets[1].id,
            authorType: 'ANALYST',
            authorId: 'analyst-1',
            authorName: 'Ana Analista',
            body: 'Estou validando com a operacao.',
            telegramText: 'Ana Analista: Estou validando com a operacao.',
          },
          {
            ticketId: createdTickets[2].id,
            authorType: 'ANALYST',
            authorId: 'analyst-2',
            authorName: 'Bruna Lemos',
            body: 'Me envie a foto do canhoto, por favor.',
            telegramText: 'Bruna Lemos: Me envie a foto do canhoto, por favor.',
          },
        ],
      });
    }

    const auditCount = await prisma.auditLog.count();
    if (!auditCount) {
      await prisma.auditLog.createMany({
        data: [
          {
            entityType: 'Driver',
            entityId: 'seed',
            action: 'SYSTEM_BOOTSTRAP',
            userId: 'system',
            userName: 'System',
          },
        ],
      });
    }
  }

  async login(
    emailRaw: string,
    passwordRaw: string,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const email = String(emailRaw || '').trim().toLowerCase();
    const password = String(passwordRaw || '').trim();

    const analyst = await prisma.analyst.findUnique({
      where: { email },
      include: { hub: true },
    });

    if (!analyst || analyst.password !== password || !analyst.isActive) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const user = {
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
    };

    const accessToken = this.createJwtToken({
      sub: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    });

    return { accessToken, user };
  }

  async loginWithGoogle(
    credentialRaw: string,
    hubIdRaw?: string | null,
  ): Promise<{
    accessToken?: string;
    user?: Record<string, unknown>;
    requiresApproval?: boolean;
    message?: string;
  }> {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const credential = String(credentialRaw || '').trim();
    void hubIdRaw;

    if (!credential) {
      throw new BadRequestException('Token do Google invalido');
    }

    let googleResponse: Response;
    try {
      googleResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      );
    } catch {
      throw new UnauthorizedException('Nao foi possivel validar o login com Google');
    }

    if (!googleResponse.ok) {
      throw new UnauthorizedException('Nao foi possivel validar o login com Google');
    }

    const googleData = (await googleResponse.json()) as {
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string;
      name?: string;
    };

    const allowedAudience = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    if (allowedAudience && googleData.aud !== allowedAudience) {
      throw new UnauthorizedException('Cliente Google invalido');
    }

    const email = String(googleData.email || '').trim().toLowerCase();
    const name = String(googleData.name || '').trim();
    const googleSub = String(googleData.sub || '').trim();

    if (!googleSub || !email || googleData.email_verified !== 'true') {
      throw new UnauthorizedException('Conta Google invalida');
    }

    let analyst = await prisma.analyst.findUnique({
      where: { email },
      include: { hub: true },
    });

    if (!analyst) {
      const baseId = email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'analyst';
      const analystId = `${baseId}-${Date.now()}`;

      analyst = await prisma.analyst.create({
        data: {
          id: analystId,
          name: name || email.split('@')[0],
          email,
          password: 'GOOGLE_AUTH_ONLY',
          telegramChatId: null,
          role: 'ANALISTA',
          hubId: null,
          isActive: false,
        },
        include: { hub: true },
      });

      await this.recordAudit({
        entityType: 'ANALYST',
        entityId: analyst.id,
        action: 'ACCESS_REQUEST_CREATED',
        userId: analyst.id,
        userName: analyst.name,
        after: {
          email: analyst.email,
          role: analyst.role,
          hubId: analyst.hubId,
          telegramChatId: analyst.telegramChatId,
          provider: 'GOOGLE',
        },
      });

      return {
        requiresApproval: true,
        message: 'Cadastro recebido. Aguarde a aprovacao de um admin para acessar o painel.',
      };
    }

    if (!analyst.isActive) {
      return {
        requiresApproval: true,
        message: 'Seu acesso ainda nao foi aprovado por um admin.',
      };
    }

    const user = {
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
    };

    const accessToken = this.createJwtToken({
      sub: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    });

    return { accessToken, user };
  }

  async register(
    nameRaw: string,
    emailRaw: string,
    passwordRaw: string,
    hubIdRaw?: string | null,
    telegramChatIdRaw?: string | null,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    void nameRaw;
    void emailRaw;
    void passwordRaw;
    void hubIdRaw;
    void telegramChatIdRaw;
    throw new BadRequestException('Use o login com Google');
  }

  async getHubs() {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;

    const hubs = await prisma.hub.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return hubs;
  }

  async createHub(payload: {
    name?: string;
    timezone?: string;
  }) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const name = String(payload?.name || '').trim();
    const timezone = String(payload?.timezone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';

    if (!name || name.length < 2) {
      throw new BadRequestException('Nome do hub invalido');
    }

    const slugBase = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'hub';
    let hubId = `hub-${slugBase}`;
    let suffix = 1;

    while (
      await prisma.hub.findUnique({
        where: { id: hubId },
        select: { id: true },
      })
    ) {
      suffix += 1;
      hubId = `hub-${slugBase}-${suffix}`;
    }

    const created = await prisma.hub.create({
      data: {
        id: hubId,
        name,
        timezone,
        isActive: true,
      },
      select: { id: true, name: true },
    });

    return {
      ok: true,
      message: 'Hub criado com sucesso',
      hub: created,
    };
  }

  private serializeManagedUser(analyst: {
    id: string;
    name: string;
    email: string;
    telegramChatId: string | null;
    role: string;
    hubId: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    hub?: { name: string } | null;
  }) {
    return {
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      isActive: analyst.isActive,
      telegramChatId: analyst.telegramChatId || null,
      createdAt: this.toIsoString(analyst.createdAt),
      updatedAt: this.toIsoString(analyst.updatedAt),
    };
  }

  async getManagedUsers() {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;

    const [users, hubs] = await Promise.all([
      prisma.analyst.findMany({
        include: { hub: true },
        orderBy: [{ isActive: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.hub.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    return {
      users: users.map((analyst) => this.serializeManagedUser(analyst)),
      hubs,
    };
  }

  async createManagedUser(payload: {
    name?: string;
    email?: string;
    role?: string;
    hubId?: string | null;
    telegramChatId?: string | null;
  }) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const name = String(payload?.name || '').trim();
    const email = String(payload?.email || '').trim().toLowerCase();
    const role = String(payload?.role || 'ANALISTA').trim().toUpperCase();
    const hubIdRaw = payload?.hubId == null ? 'hub-sp' : String(payload.hubId).trim();
    const hubId = hubIdRaw || null;
    const telegramChatId = this.normalizeTelegramChatIdInput(payload?.telegramChatId);

    if (!name || name.length < 3) {
      throw new BadRequestException('Nome invalido');
    }
    if (!email || !email.includes('@')) {
      throw new BadRequestException('E-mail invalido');
    }
    if (!['ADMIN', 'ANALISTA', 'SUPERVISOR'].includes(role)) {
      throw new BadRequestException('Papel invalido');
    }

    if (hubId) {
      const hubExists = await prisma.hub.findUnique({
        where: { id: hubId },
        select: { id: true },
      });
      if (!hubExists) {
        throw new BadRequestException('Hub invalido');
      }
    }

    const existing = await prisma.analyst.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado');
    }

    const baseId = email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'user';
    const analystId = `${baseId}-${Date.now()}`;

    const created = await prisma.analyst.create({
      data: {
        id: analystId,
        name,
        email,
        password: 'GOOGLE_AUTH_ONLY',
        telegramChatId,
        role,
        hubId,
        isActive: true,
      },
      include: { hub: true },
    });

    return {
      ok: true,
      message: 'Usuario criado com sucesso',
      user: this.serializeManagedUser(created),
    };
  }

  async updateManagedUser(
    userId: string,
    payload: {
      role?: string;
      hubId?: string | null;
      isActive?: boolean;
      telegramChatId?: string | null;
    },
  ) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const role = payload?.role ? String(payload.role).trim().toUpperCase() : undefined;
    const hubId =
      payload && Object.prototype.hasOwnProperty.call(payload, 'hubId')
        ? payload.hubId == null
          ? null
          : String(payload.hubId).trim() || null
        : undefined;
    const isActive =
      typeof payload?.isActive === 'boolean' ? payload.isActive : undefined;
    const hasTelegramChatId =
      payload && Object.prototype.hasOwnProperty.call(payload, 'telegramChatId');
    const telegramChatId = hasTelegramChatId
      ? this.normalizeTelegramChatIdInput(payload?.telegramChatId)
      : undefined;

    if (role && !['ADMIN', 'ANALISTA', 'SUPERVISOR'].includes(role)) {
      throw new BadRequestException('Papel invalido');
    }

    if (hubId !== undefined && hubId) {
      const hubExists = await prisma.hub.findUnique({
        where: { id: hubId },
        select: { id: true },
      });
      if (!hubExists) {
        throw new BadRequestException('Hub invalido');
      }
    }

    const existing = await prisma.analyst.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Usuario nao encontrado');
    }

    const updated = await prisma.analyst.update({
      where: { id: userId },
      data: {
        ...(role ? { role } : {}),
        ...(hubId !== undefined ? { hubId } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(hasTelegramChatId ? { telegramChatId } : {}),
      },
      include: { hub: true },
    });

    return {
      ok: true,
      message: 'Usuario atualizado com sucesso',
      user: this.serializeManagedUser(updated),
    };
  }

  async completeAuthOnboarding(
    authorization: string | undefined,
    hubIdRaw?: string | null,
    telegramChatIdRaw?: string | null,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const userId = this.resolveAuthenticatedUserId(authorization);
    const hubId = String(hubIdRaw || '').trim();
    const telegramChatId = this.normalizeTelegramChatIdInput(telegramChatIdRaw);

    if (!hubId) {
      throw new BadRequestException('Hub invalido');
    }
    if (!telegramChatId) {
      throw new BadRequestException('Telegram Chat ID invalido');
    }

    const hub = await prisma.hub.findUnique({
      where: { id: hubId },
      select: { id: true, name: true },
    });
    if (!hub) {
      throw new BadRequestException('Hub invalido');
    }

    const analyst = await prisma.analyst.update({
      where: { id: userId },
      data: {
        hubId,
        telegramChatId,
      },
      include: { hub: true },
    });

    const user = {
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
    };

    const accessToken = this.createJwtToken({
      sub: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      telegramChatId: analyst.telegramChatId || null,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    });

    return { accessToken, user };
  }

  async getOverviewData() {
    return {
      routeRequests: await this.getTodayRouteRequestOverview(),
    };
  }

  private async getTodayRouteRequestOverview() {
    const cacheKey = `${this.OVERVIEW_ROUTE_REQUESTS_CACHE_PREFIX}:v1`;
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'ROUTE_REQUEST',
        createdAt: {
          gte: startOfDay,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const requestMap = new Map<
      string,
      {
        driverId: string;
        driverName: string | null;
        vehicleType: string | null;
        displayedRoutes: string[];
        displayedAt: string | null;
        requestedAt: string | null;
        chosenRoute: string | null;
        chosenAt: string | null;
      }
    >();

    for (const log of logs) {
      const fields = (log.after || {}) as Record<string, unknown>;
      const action = log.action;
      const driverId = String(fields.driverId || log.userId || '');
      if (!action || !driverId) continue;
      const happenedAtRaw = fields.happenedAt;
      const happenedAt =
        happenedAtRaw instanceof Date
          ? happenedAtRaw.toISOString()
          : typeof happenedAtRaw === 'string'
            ? happenedAtRaw
            : log.createdAt.toISOString();
      const time = happenedAt.slice(11, 19) || this.toIsoString(log.createdAt).slice(11, 19);

      const current =
        requestMap.get(driverId) || {
          driverId,
          driverName: typeof fields.driverName === 'string' ? fields.driverName : log.userName || null,
          vehicleType: typeof fields.vehicleType === 'string' ? fields.vehicleType : null,
          displayedRoutes: [],
          displayedAt: null,
          requestedAt: null,
          chosenRoute: null,
          chosenAt: null,
        };

      if (!current.driverName && typeof fields.driverName === 'string') {
        current.driverName = fields.driverName;
      }

      if (!current.vehicleType && typeof fields.vehicleType === 'string') {
        current.vehicleType = fields.vehicleType;
      }

      if (action === 'rotas_exibidas') {
        current.displayedRoutes = String(fields.rotas || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        current.displayedAt = time;
      }

      if (action === 'solicitou_rotas') {
        current.requestedAt = time;
      }

      if (action === 'rota_solicitada' || action === 'rota_atribuida') {
        if (typeof fields.rota === 'string' && fields.rota.trim()) {
          current.chosenRoute = fields.rota;
        }
        current.chosenAt = time;
      }

      requestMap.set(driverId, current);
    }

    const driverIds = Array.from(requestMap.keys());
    const drivers = driverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: driverIds } },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
    const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.name || null]));
    const routeIds = Array.from(
      new Set(
        Array.from(requestMap.values()).flatMap((item) => [
          ...item.displayedRoutes,
          ...(item.chosenRoute ? [item.chosenRoute] : []),
        ]),
      ),
    ).filter(Boolean);
    const routes = routeIds.length
      ? await this.prisma.route.findMany({
          where: { atId: { in: routeIds } },
          select: {
            atId: true,
            bairro: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }],
        })
      : [];
    const routeBairroByAtId = new Map<string, string | null>();
    for (const route of routes) {
      const atId = String(route.atId || '').trim();
      if (!atId || routeBairroByAtId.has(atId)) continue;
      routeBairroByAtId.set(atId, route.bairro || null);
    }

    const payload = Array.from(requestMap.values())
      .map((item) => ({
        driverId: item.driverId,
        driverName: item.driverName || driverNameById.get(item.driverId) || null,
        vehicleType: item.vehicleType,
        displayedRoutes: item.displayedRoutes.map((atId) => ({
          atId,
          bairro: routeBairroByAtId.get(atId) || null,
        })),
        displayedAt: item.displayedAt,
        requestedAt: item.requestedAt,
        choseRoute: !!item.chosenRoute,
        chosenRoute: item.chosenRoute,
        chosenAt: item.chosenAt,
      }))
      .sort((left, right) =>
        String(right.chosenAt || right.displayedAt || '').localeCompare(
          String(left.chosenAt || left.displayedAt || ''),
        ),
      );

    await this.redisService.set(
      cacheKey,
      payload,
      this.OVERVIEW_ROUTE_REQUESTS_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  async getSyncLogs() {
    return this.prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async triggerSync(
    action: 'drivers' | 'routes' | 'all',
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
  ) {
    return this.runAnalystSync(action, date, shift);
  }

  private async refreshRoutesFromHistory(
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
  ): Promise<{ ok: boolean; message: string }> {
    if (await this.sync.isLocked()) {
      return { ok: false, message: 'Ja existe uma sincronizacao em andamento.' };
    }

    try {
      const inferredWindow = await this.sheets.getCurrentCalculationWindow();
      const fallbackWindow = this.getCurrentRouteWindow();
      const selectedDate =
        String(date || '').trim() || inferredWindow?.date || fallbackWindow.date;
      const selectedShift =
        (String(shift || '').trim().toUpperCase() as 'AM' | 'PM' | 'PM2' | '') ||
        inferredWindow?.shift ||
        fallbackWindow.shift;

      const summary = await this.sync.syncRoutesOnly(selectedDate, selectedShift);
      await this.invalidateRoutesCache();

      return {
        ok: true,
        message: `Rotas atualizadas pelo Historico ATs para ${selectedDate} (${selectedShift}). Disponiveis: ${summary.routesAvailable}. Atribuidas: ${summary.routesAssigned}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Erro ao atualizar rotas: ${(error as Error).message}`,
      };
    }
  }

  async resetQueue() {
    return this.runAnalystSync('all');
  }

  async getAuditLogs() {
    return (this.prisma as any).auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getBotHealthData() {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const redis = this.redisService.client();
    const [conversations, syncLogs, lastMinuteMessages, activeTickets, openRoutes] =
      await Promise.all([
        this.prisma.conversationState.findMany({ orderBy: { updatedAt: 'desc' }, take: 30 }),
        this.prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
        prisma.supportMessage.count({
          where: { createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
        }),
        prisma.supportTicket.count({
          where: { status: { in: ['IN_PROGRESS', 'WAITING_DRIVER'] } },
        }),
        this.prisma.route.count({
          where: { status: RouteStatus.DISPONIVEL, createdAt: { lte: new Date(Date.now() - 30 * 60 * 1000) } },
        }),
      ]);

    const [queue, motoQueue, activeChatId, activeMotoChatId] = await Promise.all([
      redis.lrange(this.QUEUE_LIST_KEY_GENERAL, 0, -1),
      redis.lrange(this.QUEUE_LIST_KEY_MOTO, 0, -1),
      redis.get(this.QUEUE_ACTIVE_KEY_GENERAL),
      redis.get(this.QUEUE_ACTIVE_KEY_MOTO),
    ]);

    const queueEntries = [
      ...queue.map((chatId, index) => ({ chatId, position: index + 1, group: 'general' as const })),
      ...motoQueue.map((chatId, index) => ({ chatId, position: index + 1, group: 'moto' as const })),
    ];

    const queueStates = await Promise.all(
      queueEntries.map(async (entry) => {
        const state = await this.redisService.get<any>(this.stateKey(entry.chatId));
        return {
          chatId: entry.chatId,
          position: entry.position,
          group: entry.group,
          driverId: state?.driverId || null,
          driverName: state?.driverName || null,
          vehicleType: state?.vehicleType || null,
          step: state?.step || null,
        };
      }),
    );

    const activeEntries = (
      await Promise.all(
        [
          activeChatId ? { chatId: activeChatId, group: 'general' as const } : null,
          activeMotoChatId ? { chatId: activeMotoChatId, group: 'moto' as const } : null,
        ]
          .filter((value): value is { chatId: string; group: 'general' | 'moto' } => Boolean(value))
          .map(async (entry) => {
            const state = await this.redisService.get<any>(this.stateKey(entry.chatId));
            return {
              chatId: entry.chatId,
              group: entry.group,
              driverId: state?.driverId || null,
              driverName: state?.driverName || null,
              vehicleType: state?.vehicleType || null,
              step: state?.step || null,
            };
          }),
      )
    );

    const recentErrors = syncLogs.filter((item) => item.status === 'FAILED').length;
    return {
      messagesPerMin: lastMinuteMessages,
      uptime: recentErrors > 3 ? 96.2 : 99.7,
      status: recentErrors > 5 ? 'DEGRADED' : 'ONLINE',
      activeConversations: conversations.filter((item) => item.step !== 'DONE').length,
      totalUsers: conversations.length,
      recentErrors,
      conversations,
      queue: queueStates,
      activeQueue: activeEntries,
      alerts: [
        activeTickets > 0
          ? {
              type: 'info',
              message: `${activeTickets} atendimento(s) em andamento na central de suporte.`,
              time: 'agora',
            }
          : null,
        recentErrors > 0
          ? {
              type: 'error',
              message: `${recentErrors} sync(s) recentes falharam. Verificar planilha e redis.`,
              time: 'recente',
            }
          : null,
        openRoutes > 0
          ? {
              type: 'warning',
              message: `${openRoutes} rotas disponiveis estao sem atribuicao ha mais de 30 minutos.`,
              time: '30min',
            }
          : null,
      ].filter(Boolean),
    };
  }

  async getSystemSettings() {
    await this.ensureSupportSeedData();
    const rows = await (this.prisma as any).systemConfig.findMany();
    const map = new Map(rows.map((row) => [row.key, row.value as Record<string, unknown>]));
    const algorithm = map.get('algorithm') || {};
    const system = map.get('system') || {};

    return {
      algorithm,
      system,
      permissions: [
        {
          role: 'ADMIN',
          desc: 'Acesso completo a todas as funcionalidades',
          perms: ['Dashboard', 'Motoristas', 'Rotas', 'Atendimento', 'Blocklist', 'FAQ', 'Sync', 'Auditoria', 'Configuracoes'],
        },
        {
          role: 'ANALISTA',
          desc: 'Acesso operacional ao hub e atendimento',
          perms: ['Dashboard', 'Motoristas', 'Rotas', 'Atendimento', 'Blocklist', 'FAQ', 'Sync'],
        },
        {
          role: 'SUPERVISOR',
          desc: 'Visualizacao multihub e atendimento',
          perms: ['Dashboard', 'Atendimento', 'Historico', 'Metricas', 'Auditoria'],
        },
      ],
      meta: {
        version: '1.0.0',
        stack: 'Next.js + NestJS + Prisma',
        database: 'PostgreSQL',
        bot: 'Telegram Bot API',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }

  async updateSystemSettings(payload: Record<string, unknown>) {
    const prisma = this.prisma as any;
    const algorithm = (payload.algorithm || {}) as Record<string, unknown>;
    const system = (payload.system || {}) as Record<string, unknown>;

    await prisma.systemConfig.upsert({
      where: { key: 'algorithm' },
      create: { key: 'algorithm', value: algorithm as any },
      update: { value: algorithm as any },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'system' },
      create: { key: 'system', value: system as any },
      update: { value: system as any },
    });

    await this.recordAudit({
      entityType: 'SystemConfig',
      entityId: 'settings',
      action: 'UPDATE',
      userId: 'system',
      userName: 'System',
      after: payload,
    });

    return { ok: true, message: 'Configuracoes salvas com sucesso.' };
  }

  private resolveSupportScope(
    role?: string,
    userHubId?: string | null,
    requestedHubId?: string | null,
  ): string[] | null {
    if (role === 'ADMIN' || role === 'SUPERVISOR') {
      if (requestedHubId && requestedHubId !== 'all') return [requestedHubId];
      return null;
    }
    if (userHubId) return [userHubId];
    if (requestedHubId && requestedHubId !== 'all') return [requestedHubId];
    return null;
  }

  private async mapSupportTicket(ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        driver: true,
        hub: true,
        analyst: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!ticket) return null;
    const lastMessage = ticket.messages[0];
    return {
      id: ticket.id,
      protocol: ticket.protocol,
      status: ticket.status,
      hubId: ticket.hubId,
      hubName: ticket.hub.name,
      driverId: ticket.driverId,
      driverName: ticket.driver.name || ticket.driver.id,
      analystId: ticket.analystId,
      analystName: ticket.analyst?.name || null,
      queuePosition: ticket.queuePosition,
      waitingSince: this.toIsoString(ticket.waitingSince),
      lastMessageAt: this.toIsoString(lastMessage?.createdAt || ticket.updatedAt),
      unreadCount: 0,
      lastMessagePreview: lastMessage?.body || 'Sem mensagens',
    };
  }

  async getSupportTickets(params: {
    hubId?: string;
    status?: string;
    role?: string;
    userHubId?: string | null;
  }) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const scopedHubIds = this.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
        ...(params.status && params.status !== 'ALL'
          ? { status: params.status }
          : {}),
      },
      include: {
        driver: true,
        hub: true,
        analyst: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ updatedAt: 'desc' }, { waitingSince: 'asc' }],
    });

    const hubs = await prisma.hub.findMany({
      where: {
        ...(scopedHubIds ? { id: { in: scopedHubIds } } : {}),
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    const onlineAnalysts = await prisma.analyst.findMany({
      where: {
        isActive: true,
        ...(scopedHubIds ? { OR: [{ hubId: { in: scopedHubIds } }, { role: 'SUPERVISOR' }] } : {}),
      },
      include: {
        hub: true,
        _count: {
          select: {
            supportTickets: {
              where: {
                status: { in: ['IN_PROGRESS', 'WAITING_DRIVER'] },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      hubs,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        protocol: ticket.protocol,
        status: ticket.status,
        hubId: ticket.hubId,
        hubName: ticket.hub.name,
        driverId: ticket.driverId,
        driverName: ticket.driver.name || ticket.driver.id,
        analystId: ticket.analystId,
        analystName: ticket.analyst?.name || null,
        queuePosition: ticket.queuePosition,
        waitingSince: this.toIsoString(ticket.waitingSince),
        lastMessageAt: this.toIsoString(ticket.messages[0]?.createdAt || ticket.updatedAt),
        unreadCount: 0,
        lastMessagePreview: ticket.messages[0]?.body || 'Sem mensagens',
      })),
      onlineAnalysts: onlineAnalysts.map((analyst) => ({
        id: analyst.id,
        name: analyst.name,
        email: analyst.email,
        role: analyst.role,
        hubId: analyst.hubId,
        hubName: analyst.hub?.name || null,
        isOnline: true,
        activeTickets: analyst._count.supportTickets,
      })),
    };
  }

  async getSupportMessages(ticketId: string) {
    await this.ensureSupportSeedData();
    const messages = await (this.prisma as any).supportMessage.findMany({
      where: { ticketId: String(ticketId).trim() },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((message) => ({
      ...message,
      createdAt: this.toIsoString(message.createdAt),
    }));
  }

  async getSupportContext(ticketId: string) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(ticketId).trim() },
      include: {
        driver: { include: { hub: true } },
      },
    });
    if (!ticket) return null;

    const [blocklist, lastRoutes] = await Promise.all([
      this.prisma.driverBlocklist.findUnique({ where: { driverId: ticket.driverId } }),
      this.prisma.route.findMany({
        where: { driverId: ticket.driverId },
        orderBy: [{ assignedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      }),
    ]);

    const activeRoute = lastRoutes.find((route) => route.status === RouteStatus.ATRIBUIDA);
    return {
      driverId: ticket.driver.id,
      driverName: ticket.driver.name || ticket.driver.id,
      telegramChatId: ticket.driver.id,
      hubId: ticket.hubId,
      hubName: ticket.driver.hub?.name || ticket.hubId,
      vehicleType: ticket.driver.vehicleType,
      ds: ticket.driver.ds,
      noShowCount: ticket.driver.noShowCount,
      declineRate: ticket.driver.declineRate,
      priorityScore: ticket.driver.priorityScore,
      isBlocked: String(blocklist?.status || '') === 'BLOCKED',
      hasActiveRoute: !!activeRoute,
      activeRouteStatus: activeRoute?.status || null,
      lastRoutes: lastRoutes.map((route) => ({
        id: route.id,
        city: route.cidade || '-',
        status: route.status,
        assignedAt: this.toIsoString(route.assignedAt || route.updatedAt),
      })),
    };
  }

  async getSupportAssignableAnalysts(
    ticketId: string,
    role?: string,
    userHubId?: string | null,
  ) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(ticketId).trim() },
      select: { hubId: true },
    });
    if (!ticket) return [];

    const allowedHubIds =
      role === 'ADMIN' || role === 'SUPERVISOR'
        ? [ticket.hubId]
        : userHubId
          ? [userHubId]
          : [ticket.hubId];

    const analysts = await prisma.analyst.findMany({
      where: {
        isActive: true,
        hubId: { in: allowedHubIds },
      },
      include: { hub: true },
      orderBy: { name: 'asc' },
    });

    return analysts.map((analyst) => ({
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      isOnline: true,
      activeTickets: 0,
    }));
  }

  async assumeSupportTicket(ticketId: string, analystIdRaw: string) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const analystId = String(analystIdRaw || '').trim();
    const updated = await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        analystId: analystId || null,
        status: 'IN_PROGRESS',
        queuePosition: null,
        firstResponseAt: new Date(),
      },
    });
    return this.mapSupportTicket(updated.id);
  }

  async closeSupportTicket(ticketId: string) {
    await this.ensureSupportSeedData();
    const updated = await (this.prisma as any).supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
    return this.mapSupportTicket(updated.id);
  }

  async transferSupportTicket(ticketId: string, analystIdRaw: string) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const analystId = String(analystIdRaw || '').trim();
    const updated = await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        analystId: analystId || null,
        status: 'IN_PROGRESS',
      },
    });
    return this.mapSupportTicket(updated.id);
  }

  async createSupportMessage(
    ticketId: string,
    bodyRaw: string,
    telegramTextRaw: string,
    authorIdRaw?: string,
    authorNameRaw?: string,
  ) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const body = String(bodyRaw || '').trim();
    const telegramText = String(telegramTextRaw || body).trim();
    const authorId = String(authorIdRaw || '').trim() || null;
    const authorName = String(authorNameRaw || 'Analista').trim();

    const created = await prisma.supportMessage.create({
      data: {
        ticketId: String(ticketId).trim(),
        authorType: 'ANALYST',
        authorId,
        authorName,
        body,
        telegramText,
      },
    });

    await prisma.supportTicket.update({
      where: { id: String(ticketId).trim() },
      data: {
        status: 'WAITING_DRIVER',
      },
    });

    return {
      ...created,
      createdAt: this.toIsoString(created.createdAt),
    };
  }

  async getSupportMetrics(params: {
    hubId?: string;
    role?: string;
    userHubId?: string | null;
  }) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const scopedHubIds = this.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
      },
      include: {
        hub: true,
        analyst: true,
        messages: true,
      },
    });

    const closed = tickets.filter((item) => item.closedAt);
    const avgFirstResponseMinutes = tickets.length
      ? Number(
          (
            tickets.reduce((sum, item) => {
              if (!item.firstResponseAt) return sum;
              return sum + (item.firstResponseAt.getTime() - item.waitingSince.getTime()) / 60000;
            }, 0) / Math.max(1, tickets.filter((item) => item.firstResponseAt).length)
          ).toFixed(1),
        )
      : 0;
    const avgResolutionMinutes = closed.length
      ? Number(
          (
            closed.reduce(
              (sum, item) => sum + ((item.closedAt as Date).getTime() - item.waitingSince.getTime()) / 60000,
              0,
            ) / closed.length
          ).toFixed(1),
        )
      : 0;

    return {
      avgFirstResponseMinutes,
      avgResolutionMinutes,
      closureRate: tickets.length ? Math.round((closed.length / tickets.length) * 100) : 0,
      ticketsByHub: Array.from(
        tickets.reduce((acc, item) => {
          const current = acc.get(item.hubId) || { hubId: item.hubId, hubName: item.hub.name, total: 0 };
          current.total += 1;
          acc.set(item.hubId, current);
          return acc;
        }, new Map<string, { hubId: string; hubName: string; total: number }>()),
      ).map(([, value]) => value),
      ticketsByAnalyst: Array.from(
        tickets.reduce((acc, item) => {
          if (!item.analyst) return acc;
          const current = acc.get(item.analystId as string) || {
            analystId: item.analystId,
            analystName: item.analyst.name,
            total: 0,
          };
          current.total += 1;
          acc.set(item.analystId as string, current);
          return acc;
        }, new Map<string, { analystId: string | null; analystName: string; total: number }>()),
      ).map(([, value]) => value),
    };
  }

  async getSupportHistory(params: {
    hubId?: string;
    role?: string;
    userHubId?: string | null;
    search?: string;
    from?: string;
    to?: string;
    status?: string;
  }) {
    await this.ensureSupportSeedData();
    const prisma = this.prisma as any;
    const scopedHubIds = this.resolveSupportScope(params.role, params.userHubId, params.hubId);
    const search = String(params.search || '').trim().toLowerCase();
    const rows = await prisma.supportTicket.findMany({
      where: {
        ...(scopedHubIds ? { hubId: { in: scopedHubIds } } : {}),
        ...(params.status && params.status !== 'ALL'
          ? { status: params.status }
          : {}),
      },
      include: {
        hub: true,
        driver: true,
        analyst: true,
        messages: true,
      },
      orderBy: { waitingSince: 'desc' },
    });

    return rows
      .filter((row) => {
        if (!search) return true;
        return (
          (row.driver.name || row.driver.id).toLowerCase().includes(search) ||
          row.driver.id.toLowerCase().includes(search) ||
          (row.analyst?.name || '').toLowerCase().includes(search)
        );
      })
      .filter((row) => (!params.from ? true : row.waitingSince >= new Date(params.from)))
      .filter((row) => (!params.to ? true : row.waitingSince <= new Date(`${params.to}T23:59:59.999Z`)))
      .map((row) => ({
        id: `history-${row.id}`,
        protocol: row.protocol,
        ticketId: row.id,
        hubName: row.hub.name,
        driverName: row.driver.name || row.driver.id,
        driverId: row.driver.id,
        analystName: row.analyst?.name || null,
        startedAt: this.toIsoString(row.waitingSince),
        endedAt: this.toIsoString(row.closedAt || row.updatedAt),
        resolutionMinutes: Math.max(
          1,
          Math.round(((row.closedAt || row.updatedAt).getTime() - row.waitingSince.getTime()) / 60000),
        ),
        messageCount: row.messages.length,
        status: row.status,
      }));
  }

  private logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  private stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  private async checkRedis(): Promise<string> {
    try {
      const pong = await this.redisService.client().ping();
      return pong === 'PONG' ? 'ok' : `erro (${pong})`;
    } catch (error) {
      return 'erro';
    }
  }

  private async checkPostgres(): Promise<string> {
    const url = process.env.DATABASE_URL;
    const host = process.env.PGHOST;
    const port = process.env.PGPORT;

    if (!url && !host) return 'nao_configurado';

    let targetHost = host || '';
    let targetPort = port ? Number(port) : 5432;

    if (url) {
      try {
        const parsed = new URL(url);
        targetHost = parsed.hostname;
        targetPort = parsed.port ? Number(parsed.port) : 5432;
      } catch (error) {
        return 'erro_url';
      }
    }

    return new Promise((resolve) => {
      const socket = createConnection(
        { host: targetHost, port: targetPort, timeout: 1000 },
        () => {
          socket.end();
          resolve('ok');
        },
      );

      socket.on('error', () => resolve('erro'));
      socket.on('timeout', () => {
        socket.destroy();
        resolve('timeout');
      });
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async updateRoutesNote(
    text: string,
  ): Promise<{ ok: boolean; message: string; text: string }> {
    const note = String(text || '').trim().slice(0, 2000);
    await this.redisService.set(this.ROUTES_NOTE_KEY, note);
    return {
      ok: true,
      message: 'Texto de orientacao salvo com sucesso.',
      text: note,
    };
  }

  private normalizeDriverId(value: string): string {
    return String(value || '')
      .trim()
      .replace(/\D/g, '');
  }

  async addBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
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
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
      await Promise.all([
        this.invalidateExecutiveDashboardCache(),
        this.invalidateDriversCaches(),
        this.invalidateBlocklistListCache(),
      ]);
      return { ok: true, message: `Motorista ${driverId} adicionado na lista de bloqueio (bloqueado).` };
    }

    if (String(existing.status) === 'BLOCKED') {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta bloqueado na lista de bloqueio.` };
    }

    await this.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'BLOCKED' as any,
        timesListed: { increment: 1 },
        lastActivatedAt: new Date(),
      },
    });
    await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateBlocklistListCache(),
    ]);
    return { ok: true, message: `Motorista ${driverId} bloqueado novamente na lista de bloqueio.` };
  }

  async removeBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });
    if (!existing) {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
      return { ok: false, message: `Motorista ${driverId} nao esta cadastrado na lista de bloqueio.` };
    }

    if (String(existing.status) === 'UNBLOCKED') {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta desbloqueado na lista de bloqueio.` };
    }

    await this.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: 'UNBLOCKED' as any,
        lastInactivatedAt: new Date(),
      },
    });
    await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
    await Promise.all([
      this.invalidateExecutiveDashboardCache(),
      this.invalidateDriversCaches(),
      this.invalidateBlocklistListCache(),
    ]);
    return { ok: true, message: `Motorista ${driverId} marcado como desbloqueado na lista de bloqueio.` };
  }

  async createFaqItem(
    title: string,
    answer: string,
    position?: number,
  ): Promise<{ ok: boolean; message: string }> {
    const parsedTitle = String(title || '').trim();
    const parsedAnswer = String(answer || '').trim();
    if (!parsedTitle || !parsedAnswer) {
      return { ok: false, message: 'Titulo e resposta sao obrigatorios.' };
    }

    const maxPosition = await this.prisma.faqItem.aggregate({
      _max: { position: true },
    });

    await this.prisma.faqItem.create({
      data: {
        title: parsedTitle,
        answer: parsedAnswer,
        position:
          Number.isFinite(Number(position)) && Number(position) >= 0
            ? Number(position)
            : (maxPosition._max.position || 0) + 1,
      },
    });

    return { ok: true, message: 'Duvida criada com sucesso.' };
  }

  async updateFaqItem(
    id: string,
    title: string,
    answer: string,
    position?: number,
    active?: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    const parsedId = String(id || '').trim();
    if (!parsedId) return { ok: false, message: 'ID invalido.' };

    const parsedTitle = String(title || '').trim();
    const parsedAnswer = String(answer || '').trim();
    if (!parsedTitle || !parsedAnswer) {
      return { ok: false, message: 'Titulo e resposta sao obrigatorios.' };
    }

    await this.prisma.faqItem.update({
      where: { id: parsedId },
      data: {
        title: parsedTitle,
        answer: parsedAnswer,
        position:
          Number.isFinite(Number(position)) && Number(position) >= 0
            ? Number(position)
            : 0,
        active: active !== false,
      },
    });

    return { ok: true, message: 'Duvida atualizada com sucesso.' };
  }

  async deleteFaqItem(id: string): Promise<{ ok: boolean; message: string }> {
    const parsedId = String(id || '').trim();
    if (!parsedId) return { ok: false, message: 'ID invalido.' };

    await this.prisma.faqItem.delete({ where: { id: parsedId } });
    return { ok: true, message: 'Duvida removida com sucesso.' };
  }

  async getFaqDashboardHtml(): Promise<string> {
    const faqs = await this.prisma.faqItem.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Painel de Dúvidas</title>
  <style>
    body { margin:0; font-family: Georgia, "Times New Roman", serif; background:#f6f3ef; color:#1f1f1f; }
    .wrap { max-width:1200px; margin:0 auto; padding:20px; display:grid; gap:16px; }
    .card { background:#fff; border:1px solid #e1ddd7; border-radius:10px; padding:14px 16px; }
    h1 { margin:0 0 8px 0; font-size:24px; }
    label { display:block; font-size:13px; color:#666; margin-bottom:4px; }
    input, textarea { width:100%; border:1px solid #d2cec8; border-radius:8px; padding:8px; font-family:inherit; box-sizing:border-box; }
    .row { display:grid; grid-template-columns:1fr 1fr 140px; gap:10px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    button { border:1px solid #d2cec8; background:#fff; padding:8px 12px; border-radius:8px; cursor:pointer; font-family:inherit; }
    button:hover { border-color:#999; }
    .nav { display:flex; gap:8px; margin-top:10px; }
    .nav a { text-decoration:none; border:1px solid #d2cec8; color:#1f1f1f; background:#fff; padding:6px 10px; border-radius:8px; font-size:14px; }
    .nav a:hover { border-color:#999; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { padding:8px; border-bottom:1px solid #eee; text-align:left; vertical-align:top; }
    .muted { color:#666; font-size:13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Dúvidas frequentes</h1>
      <div class="muted">Crie, edite, ative/inative e exclua itens do bot.</div>
      <div class="nav">
        <a href="/acess/analist">Painel Operação</a>
        <a href="/acess/duvidas">Painel Dúvidas</a>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div>
          <label>Título</label>
          <input id="new-title" />
        </div>
        <div>
          <label>Ordem</label>
          <input id="new-position" type="number" min="0" />
        </div>
        <div></div>
      </div>
      <div style="margin-top:10px;">
        <label>Resposta</label>
        <textarea id="new-answer" rows="5"></textarea>
      </div>
      <div class="actions">
        <button onclick="createFaq()">Criar dúvida</button>
      </div>
      <div id="create-status" class="muted">Pronto.</div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr><th>Ordem</th><th>Título</th><th>Resposta</th><th>Ativo</th><th>Ações</th></tr>
        </thead>
        <tbody>
          ${
            faqs.length
              ? faqs
                  .map(
                    (item) => `
                    <tr>
                      <td><input id="pos-${item.id}" type="number" min="0" value="${item.position}" style="width:90px;" /></td>
                      <td><input id="title-${item.id}" value="${this.escapeHtml(item.title)}" /></td>
                      <td><textarea id="answer-${item.id}" rows="4">${this.escapeHtml(item.answer)}</textarea></td>
                      <td><input id="active-${item.id}" type="checkbox" ${item.active ? 'checked' : ''} /></td>
                      <td>
                        <div class="actions">
                          <button onclick="updateFaq('${item.id}')">Salvar</button>
                          <button onclick="deleteFaq('${item.id}')">Excluir</button>
                        </div>
                        <div id="status-${item.id}" class="muted">-</div>
                      </td>
                    </tr>`,
                  )
                  .join('')
              : '<tr><td colspan="5">Nenhuma dúvida cadastrada.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  </div>
  <script>
    async function createFaq() {
      const status = document.getElementById('create-status');
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/duvidas/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('new-title').value,
            answer: document.getElementById('new-answer').value,
            position: Number(document.getElementById('new-position').value || 0),
          }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao criar dúvida.';
      }
    }

    async function updateFaq(id) {
      const status = document.getElementById('status-' + id);
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/duvidas/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            title: document.getElementById('title-' + id).value,
            answer: document.getElementById('answer-' + id).value,
            position: Number(document.getElementById('pos-' + id).value || 0),
            active: document.getElementById('active-' + id).checked,
          }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
      } catch (error) {
        status.textContent = 'Falha ao salvar.';
      }
    }

    async function deleteFaq(id) {
      const status = document.getElementById('status-' + id);
      status.textContent = 'Excluindo...';
      try {
        const res = await fetch('/acess/duvidas/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao excluir.';
      }
    }
  </script>
</body>
</html>
`;
  }

  async runAnalystSync(
    action: 'drivers' | 'routes' | 'all',
    date?: string,
    shift?: 'AM' | 'PM' | 'PM2',
  ): Promise<{ ok: boolean; message: string }> {
    if (!['drivers', 'routes', 'all'].includes(action)) {
      return { ok: false, message: 'Acao invalida.' };
    }

    if (await this.sync.isLocked()) {
      return { ok: false, message: 'Ja existe uma sincronizacao em andamento.' };
    }

    try {
      if (action === 'drivers') {
        const drivers = await this.sync.syncDriversScheduled();
        return {
          ok: true,
          message: `Motoristas atualizados com sucesso. Total: ${drivers}.`,
        };
      }

      if (action === 'routes') {
        return this.refreshRoutesFromHistory(date, shift);
      }

      await this.sync.resetRedisStateManual();
      return {
        ok: true,
        message: 'Redis/fila resetados com sucesso.',
      };
    } catch (error) {
      return {
        ok: false,
        message: `Erro ao sincronizar: ${(error as Error).message}`,
      };
    }
  }

  async getAnalystDashboardHtml(): Promise<string> {
    const redisStatus = await this.checkRedis();
    const postgresStatus = await this.checkPostgres();

    const redis = this.redisService.client();
    const activeChatId = await redis.get(this.QUEUE_ACTIVE_KEY_GENERAL);
    const activeMotoChatId = await redis.get(this.QUEUE_ACTIVE_KEY_MOTO);
    const queue = await redis.lrange(this.QUEUE_LIST_KEY_GENERAL, 0, -1);
    const motoQueue = await redis.lrange(this.QUEUE_LIST_KEY_MOTO, 0, -1);
    const combinedQueue = [...queue, ...motoQueue];

    const uniqueQueue = combinedQueue.filter(
      (value, index, self) => self.indexOf(value) === index,
    );

    const queueStates = await Promise.all(
      uniqueQueue.map(async (chatId) => {
        const state = await this.redisService.get<any>(this.stateKey(chatId));
        return {
          chatId,
          driverId: state?.driverId || null,
          driverName: state?.driverName || '-',
          vehicleType: state?.vehicleType || '-',
          state: state?.state || '-',
          group: state?.queueGroup || '-',
        };
      }),
    );

    const queueDriverIds = Array.from(
      new Set(
        queueStates
          .map((row) => row.driverId)
          .filter((id): id is string => !!id),
      ),
    );
    const queueDrivers = queueDriverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: queueDriverIds } },
          select: {
            id: true,
            ds: true,
            noShowCount: true,
            declineRate: true,
            priorityScore: true,
          },
        })
      : [];
    const queueDriverMap = new Map(queueDrivers.map((d) => [d.id, d]));

    let activeState = null as null | {
      chatId: string;
      driverName: string;
      vehicleType: string;
      state: string;
    };

    if (activeChatId) {
      const state = await this.redisService.get<any>(
        this.stateKey(activeChatId),
      );
      activeState = {
        chatId: activeChatId,
        driverName: state?.driverName || '-',
        vehicleType: state?.vehicleType || '-',
        state: state?.state || '-',
      };
    }

    let activeMotoState = null as null | {
      chatId: string;
      driverName: string;
      vehicleType: string;
      state: string;
    };

    if (activeMotoChatId) {
      const state = await this.redisService.get<any>(
        this.stateKey(activeMotoChatId),
      );
      activeMotoState = {
        chatId: activeMotoChatId,
        driverName: state?.driverName || '-',
        vehicleType: state?.vehicleType || '-',
        state: state?.state || '-',
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const requestedToday = await this.prisma.auditLog.count({
      where: {
        entityType: 'ROUTE_REQUEST',
        action: {
          in: ['rota_solicitada', 'rota_atribuida'],
        },
        createdAt: {
          gte: startOfDay,
        },
      },
    });
    const routesNote = (await this.redisService.get<string>(this.ROUTES_NOTE_KEY)) || '';
    const routesNoteEscaped = this.escapeHtml(routesNote);
    const blocklistEntries = await this.prisma.driverBlocklist.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const blocklistIds = blocklistEntries.map((row) => row.driverId);
    const blocklistDrivers = blocklistIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: blocklistIds } },
          select: {
            id: true,
            name: true,
            vehicleType: true,
            ds: true,
            noShowCount: true,
            declineRate: true,
            priorityScore: true,
          },
        })
      : [];
    const blocklistMap = new Map(blocklistDrivers.map((d) => [d.id, d]));
    const logLines = await redis.lrange(this.logKey(), 0, -1);
    const recentLogs = logLines.slice(-20).join('\n');

    const routes = await this.prisma.route.findMany({
      include: { driver: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const routeRows = routes.map((route) => {
      const driver = route.driver;
      const driverVehicle = driver?.vehicleType || route.driverVehicleType || '-';
      const requiredNorm = normalizeVehicleType(route.requiredVehicleType ?? undefined);
      const driverNorm = normalizeVehicleType(driverVehicle);
      const accuracy =
        route.driverId && requiredNorm && driverNorm && requiredNorm === driverNorm
          ? 'OK'
          : route.driverId
          ? 'NAO'
          : '-';

      return {
        id: route.id,
        bairro: route.bairro || '-',
        cidade: route.cidade || '-',
        required: route.requiredVehicleType || '-',
        status: route.status,
        driverId: route.driverId || '-',
        driverName: driver?.name || route.driverName || '-',
        driverDs: driver?.ds || '-',
        driverNoShow: driver?.noShowCount ?? 0,
        driverDeclineRate:
          typeof driver?.declineRate === 'number' ? driver.declineRate.toFixed(2) : '0.00',
        driverScore:
          typeof driver?.priorityScore === 'number' ? driver.priorityScore.toFixed(2) : '0.00',
        driverVehicle,
        accuracy,
      };
    });

    const priorityDrivers = await this.prisma.driver.findMany({
      orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        vehicleType: true,
        ds: true,
        noShowCount: true,
        declineRate: true,
        priorityScore: true,
      },
    });

    return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Visao do Bot</title>
  <style>
    :root { --bg: #f6f3ef; --card: #ffffff; --ink: #1f1f1f; --muted: #666; --accent: #0b6; }
    body { margin: 0; font-family: "Georgia", "Times New Roman", serif; background: var(--bg); color: var(--ink); }
    header { padding: 24px 28px; border-bottom: 2px solid #ddd; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .wrap { padding: 20px 28px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { background: var(--card); border: 1px solid #e1ddd7; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
    .label { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.08em; }
    .value { font-size: 18px; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 8px; border-bottom: 1px solid #eee; text-align: left; }
    pre { background: #111; color: #eee; padding: 12px; border-radius: 8px; overflow: auto; white-space: pre-wrap; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e9f6ef; color: #0b6; font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { border: 1px solid #d2cec8; background: #fff; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-family: inherit; }
    button:hover { border-color: #999; }
    .nav { display:flex; gap:8px; margin-top:10px; }
    .nav a { text-decoration:none; border:1px solid #d2cec8; color:#1f1f1f; background:#fff; padding:6px 10px; border-radius:8px; font-size:14px; }
    .nav a:hover { border-color:#999; }
    #sync-status { margin-top: 10px; color: var(--muted); font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <h1>Visao do Bot (tempo real)</h1>
    <div class="nav">
      <a href="/acess/analist">Painel Operação</a>
      <a href="/acess/duvidas">Painel Dúvidas</a>
    </div>
  </header>
  <div class="wrap">
    <div class="card">
      <div class="label">Sincronizacao</div>
      <div class="actions">
        <button onclick="runSync('drivers')">Atualizar motoristas</button>
        <button onclick="runSync('routes')">Atualizar rotas (Historico ATs)</button>
        <button onclick="runSync('all')">Resetar fila</button>
      </div>
      <div id="sync-status">Pronto.</div>
    </div>

    <div class="card">
      <div class="label">Texto da lista de rotas</div>
      <textarea id="routes-note" rows="4" style="width:100%; margin-top:8px; font-family:inherit;">${routesNoteEscaped}</textarea>
      <div class="actions" style="margin-top:10px;">
        <button onclick="saveRoutesNote()">Salvar texto</button>
      </div>
      <div id="routes-note-status" style="margin-top:8px; color:#666; font-size:14px;">Pronto.</div>
    </div>

    <div class="card">
      <div class="label">Lista de bloqueio (permanente, prioridade zero)</div>
      <div class="actions" style="margin-top:8px;">
        <input id="blocklist-driver-id" placeholder="Driver ID" style="padding:8px; border:1px solid #d2cec8; border-radius:8px; font-family:inherit;" />
        <button onclick="addBlocklistDriver()">Adicionar</button>
      </div>
      <div id="blocklist-status" style="margin-top:8px; color:#666; font-size:14px;">Pronto.</div>
      <table style="margin-top:10px;">
        <thead>
          <tr><th>Driver ID</th><th>Nome</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th><th>Status</th><th>Vezes</th><th>Ação</th></tr>
        </thead>
        <tbody>
          ${
            blocklistEntries.length
              ? blocklistEntries
                  .map((entry) => {
                    const id = entry.driverId;
                    const info = blocklistMap.get(id);
                    const name = this.escapeHtml(info?.name || '-');
                    const vehicle = this.escapeHtml(info?.vehicleType || '-');
                    const ds = this.escapeHtml(info?.ds || '-');
                    const noShow = info?.noShowCount ?? 0;
                    const declineRate =
                      typeof info?.declineRate === 'number'
                        ? info.declineRate.toFixed(2)
                        : '0.00';
                    const score =
                      typeof info?.priorityScore === 'number'
                        ? info.priorityScore.toFixed(2)
                        : '0.00';
                    const normalizedStatus = this.normalizeBlocklistStatusValue(entry.status);
                    const status = normalizedStatus === 'BLOCKED' ? 'Bloqueado' : 'Desbloqueado';
                    const actionButton =
                      normalizedStatus === 'BLOCKED'
                        ? `<button onclick="removeBlocklistDriver('${id}')">Desbloquear</button>`
                        : `<button onclick="addBlocklistDriverById('${id}')">Bloquear</button>`;
                    return `<tr><td>${id}</td><td>${name}</td><td>${vehicle}</td><td>${ds}</td><td>${noShow}</td><td>${declineRate}</td><td>${score}</td><td>${status}</td><td>${entry.timesListed}</td><td>${actionButton}</td></tr>`;
                  })
                  .join('')
              : '<tr><td colspan="10">Sem motoristas na lista de bloqueio</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="grid">
      <div class="card">
        <div class="label">Redis</div>
        <div class="value">${redisStatus}</div>
      </div>
      <div class="card">
        <div class="label">Postgres</div>
        <div class="value">${postgresStatus}</div>
      </div>
      <div class="card">
        <div class="label">Rotas solicitadas hoje</div>
        <div class="value">${requestedToday}</div>
      </div>
      <div class="card">
        <div class="label">Fila geral</div>
        <div class="value">${queue.length}</div>
      </div>
      <div class="card">
        <div class="label">Fila moto</div>
        <div class="value">${motoQueue.length}</div>
      </div>
    </div>

    <div class="card">
      <div class="label">Atendimento ativo (geral)</div>
      <div class="value">
        ${
          activeState
            ? `${activeState.driverName} (${activeState.vehicleType}) <span class="pill">${activeState.state}</span>`
            : 'Nenhum'
        }
      </div>
    </div>

    <div class="card">
      <div class="label">Atendimento ativo (moto)</div>
      <div class="value">
        ${
          activeMotoState
            ? `${activeMotoState.driverName} (${activeMotoState.vehicleType}) <span class="pill">${activeMotoState.state}</span>`
            : 'Nenhum'
        }
      </div>
    </div>

    <div class="card">
      <div class="label">Fila atual</div>
      <table>
        <thead>
          <tr><th>Chat</th><th>Motorista</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th><th>Estado</th><th>Grupo</th></tr>
        </thead>
        <tbody>
          ${
            queueStates.length
              ? queueStates
                  .map(
                    (row) => {
                      const d = row.driverId
                        ? queueDriverMap.get(row.driverId)
                        : undefined;
                      const ds = this.escapeHtml(d?.ds || '-');
                      const noShow = d?.noShowCount ?? 0;
                      const declineRate =
                        typeof d?.declineRate === 'number'
                          ? d.declineRate.toFixed(2)
                          : '0.00';
                      const score =
                        typeof d?.priorityScore === 'number'
                          ? d.priorityScore.toFixed(2)
                          : '0.00';
                      return `<tr><td>${row.chatId}</td><td>${row.driverName}</td><td>${row.vehicleType}</td><td>${ds}</td><td>${noShow}</td><td>${declineRate}</td><td>${score}</td><td>${row.state}</td><td>${row.group}</td></tr>`;
                    },
                  )
                  .join('')
              : '<tr><td colspan="9">Sem fila</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="label">Logs recentes</div>
      <pre>${recentLogs || 'Sem logs para hoje.'}</pre>
    </div>

    <div class="card">
      <div class="label">Rotas (ultimas 200)</div>
      <table>
        <thead>
          <tr>
            <th>AT</th>
            <th>Bairro</th>
            <th>Cidade</th>
            <th>Tipo rota</th>
            <th>Status</th>
            <th>Driver ID</th>
            <th>Motorista</th>
            <th>DS</th>
            <th>No-show</th>
            <th>Recusa %</th>
            <th>Score</th>
            <th>Veiculo</th>
            <th>Acertividade</th>
          </tr>
        </thead>
        <tbody>
          ${
            routeRows.length
              ? routeRows
                  .map(
                    (row) =>
                      `<tr><td>${row.id}</td><td>${row.bairro}</td><td>${row.cidade}</td><td>${row.required}</td><td>${row.status}</td><td>${row.driverId}</td><td>${row.driverName}</td><td>${row.driverDs}</td><td>${row.driverNoShow}</td><td>${row.driverDeclineRate}</td><td>${row.driverScore}</td><td>${row.driverVehicle}</td><td>${row.accuracy}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="13">Sem rotas no banco</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="label">Prioridade dos motoristas (top 200)</div>
      <table>
        <thead>
          <tr><th>Driver ID</th><th>Nome</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th></tr>
        </thead>
        <tbody>
          ${
            priorityDrivers.length
              ? priorityDrivers
                  .map(
                    (d) =>
                      `<tr><td>${d.id}</td><td>${this.escapeHtml(d.name || '-')}</td><td>${this.escapeHtml(d.vehicleType || '-')}</td><td>${this.escapeHtml(d.ds || '-')}</td><td>${d.noShowCount}</td><td>${d.declineRate.toFixed(2)}</td><td>${d.priorityScore.toFixed(2)}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="7">Sem motoristas no banco</td></tr>'
          }
        </tbody>
      </table>
    </div>
  </div>
  <script>
    let routesNoteDirty = false;

    async function runSync(action) {
      const status = document.getElementById('sync-status');
      status.textContent = 'Sincronizando...';
      try {
        const res = await fetch('/acess/analist/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluido.';
      } catch (error) {
        status.textContent = 'Falha ao iniciar sincronizacao.';
      }
    }

    async function saveRoutesNote() {
      const status = document.getElementById('routes-note-status');
      const noteEl = document.getElementById('routes-note');
      const text = noteEl.value;
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/analist/routes-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        routesNoteDirty = false;
        status.textContent = data.message || 'Texto salvo.';
      } catch (error) {
        status.textContent = 'Falha ao salvar texto.';
      }
    }

    async function addBlocklistDriver() {
      const status = document.getElementById('blocklist-status');
      const input = document.getElementById('blocklist-driver-id');
      const driverId = input.value;
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/analist/blocklist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao salvar lista de bloqueio.';
      }
    }

    async function addBlocklistDriverById(driverId) {
      const status = document.getElementById('blocklist-status');
      status.textContent = 'Atualizando...';
      try {
        const res = await fetch('/acess/analist/blocklist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao atualizar lista de bloqueio.';
      }
    }

    async function removeBlocklistDriver(driverId) {
      const status = document.getElementById('blocklist-status');
      status.textContent = 'Removendo...';
      try {
        const res = await fetch('/acess/analist/blocklist/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao remover de lista de bloqueio.';
      }
    }

    const noteEl = document.getElementById('routes-note');
    if (noteEl) {
      noteEl.addEventListener('input', () => {
        routesNoteDirty = true;
      });
    }

    setInterval(() => {
      const active = document.activeElement;
      const isTypingNote = active && active.id === 'routes-note';
      if (isTypingNote || routesNoteDirty) return;
      window.location.reload();
    }, 15000);
  </script>
</body>
</html>
`;
  }
}
