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
export type SyncSummary = {
  drivers: number;
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

  async setPending(chatId: string) {
    await this.redis.client().set(this.pendingKey(chatId), '1', 'EX', 300);
  }

  async clearPending(chatId: string) {
    await this.redis.client().del(this.pendingKey(chatId));
  }

  async isPending(chatId: string): Promise<boolean> {
    const exists = await this.redis.client().get(this.pendingKey(chatId));
    return exists === '1';
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

  private async clearRedisState() {
    const client = this.redis.client();
    const patterns = [
      'telegram:queue:*',
      'telegram:state:*',
      'telegram:route:timeout*',
      'telegram:queue:member:*',
      'telegram:queue:moto:*',
      'telegram:queue:general:*',
    ];

    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length) await client.del(...keys);
      } while (cursor !== '0');
    }
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
      const normalizedVehicleType = normalizeVehicleType(vehicleType ?? undefined);
      const spxStatus = row['SPX Status']?.trim() || null;
      const statusLower = spxStatus?.toLowerCase() || '';
      const isActive =
        statusLower === ''
          ? true
          : !(statusLower.includes('inativo') || statusLower.includes('inactive') || statusLower.includes('bloque'));

      await this.prisma.driver.upsert({
        where: { id: driverId },
        update: {
          name: row['Driver Name'] || null,
          phone: row['Phone Number'] || null,
          contractType: row['Contract Type'] || null,
          function: row['Function'] || null,
          express: row['Express'] || null,
          fulfillmentPickup: row['Fulfillment Pickup'] || null,
          eContractTemplateId: row['E-Contract Template ID'] || null,
          gender: row['Gender'] || null,
          email: row['E-mail'] || null,
          cpf: row['CPF'] || null,
          cnpj: row['CNPJ'] || null,
          rntrcNumber: row['RNTRC Number'] || null,
          nationality: row['Nationality'] || null,
          rg: row['RG'] || null,
          ufIssueRg: row['UF Issue RG'] || null,
          rgIssueDate: row['Date of issuance of the ID card (RG)'] || null,
          countryOfOrigin: row['Country of origin'] || null,
          rne: row['RNE'] || null,
          rneExpirationDate: row['RNE Expiration date'] || null,
          registeredUfRne: row['Registered UF RNE'] || null,
          birthDate: row['Birth Date'] || null,
          motherName: row["Driver's Mother name"] || null,
          fatherName: row["Driver's Father name"] || null,
          city: row['City'] || null,
          neighbourhood: row['Neighbourhood'] || null,
          streetName: row['Street Name'] || null,
          addressNumber: row['Address Number'] || null,
          zipcode: row['Zipcode'] || null,
          cardNumber: row['Card Number'] || null,
          riskAssessmentDocument: row['Risk Assessment Document (PDF only)'] || null,
          cnhType: row['CNH Type'] || null,
          cnhNumber: row['CNH Number'] || null,
          cnhSecurityCode: row['CNH Security Code'] || null,
          cnhObservations: row['CNH Observations'] || null,
          ufIssueCnh: row['UF Issue CNH'] || null,
          firstLicenceDate: row['1st Licence Date'] || null,
          cnhIssueDate: row['CNH Issue Date'] || null,
          driverLicenseExpireDate: row['Driver License Expire Date'] || null,
          pickupStationId: row['Pickup Station ID'] || null,
          pickupStationShiftId: row['Pickup Station Shift ID'] || null,
          deliveryStationId: row['Delivery Station ID'] || null,
          deliveryStationShiftId: row['Delivery Station Shift ID'] || null,
          lineHaulStationId: row['Line Haul Station ID'] || null,
          renavam: row['RENAVAM'] || null,
          licensePlate: row['License Plate'] || null,
          ufEmittingCrlv: row['UF Emitting CRLV'] || null,
          vehicleManufacturingYear: row["Vehicle's Manufacturing Year"] || null,
          cpfCnpjOwnerVehicle: row['CPF/CNPJ Owner Vehicle'] || null,
          vehicleOwnerName: row['Vehicle Owner Name'] || null,
          vehicleType,
          spxStatus,
          radExpireTime: row['RAD Expire Time'] || null,
          digitalCertificateExpiryDate: row['Digital Certificate Expiry Date'] || null,
          driverType: row['Driver Type'] || null,
          suspensionReason: row['Suspension Reason'] || null,
          ds: row['DS'] || null,
          normalizedVehicleType,
          isActive,
        },
        create: {
          id: driverId,
          name: row['Driver Name'] || null,
          phone: row['Phone Number'] || null,
          contractType: row['Contract Type'] || null,
          function: row['Function'] || null,
          express: row['Express'] || null,
          fulfillmentPickup: row['Fulfillment Pickup'] || null,
          eContractTemplateId: row['E-Contract Template ID'] || null,
          gender: row['Gender'] || null,
          email: row['E-mail'] || null,
          cpf: row['CPF'] || null,
          cnpj: row['CNPJ'] || null,
          rntrcNumber: row['RNTRC Number'] || null,
          nationality: row['Nationality'] || null,
          rg: row['RG'] || null,
          ufIssueRg: row['UF Issue RG'] || null,
          rgIssueDate: row['Date of issuance of the ID card (RG)'] || null,
          countryOfOrigin: row['Country of origin'] || null,
          rne: row['RNE'] || null,
          rneExpirationDate: row['RNE Expiration date'] || null,
          registeredUfRne: row['Registered UF RNE'] || null,
          birthDate: row['Birth Date'] || null,
          motherName: row["Driver's Mother name"] || null,
          fatherName: row["Driver's Father name"] || null,
          city: row['City'] || null,
          neighbourhood: row['Neighbourhood'] || null,
          streetName: row['Street Name'] || null,
          addressNumber: row['Address Number'] || null,
          zipcode: row['Zipcode'] || null,
          cardNumber: row['Card Number'] || null,
          riskAssessmentDocument: row['Risk Assessment Document (PDF only)'] || null,
          cnhType: row['CNH Type'] || null,
          cnhNumber: row['CNH Number'] || null,
          cnhSecurityCode: row['CNH Security Code'] || null,
          cnhObservations: row['CNH Observations'] || null,
          ufIssueCnh: row['UF Issue CNH'] || null,
          firstLicenceDate: row['1st Licence Date'] || null,
          cnhIssueDate: row['CNH Issue Date'] || null,
          driverLicenseExpireDate: row['Driver License Expire Date'] || null,
          pickupStationId: row['Pickup Station ID'] || null,
          pickupStationShiftId: row['Pickup Station Shift ID'] || null,
          deliveryStationId: row['Delivery Station ID'] || null,
          deliveryStationShiftId: row['Delivery Station Shift ID'] || null,
          lineHaulStationId: row['Line Haul Station ID'] || null,
          renavam: row['RENAVAM'] || null,
          licensePlate: row['License Plate'] || null,
          ufEmittingCrlv: row['UF Emitting CRLV'] || null,
          vehicleManufacturingYear: row["Vehicle's Manufacturing Year"] || null,
          cpfCnpjOwnerVehicle: row['CPF/CNPJ Owner Vehicle'] || null,
          vehicleOwnerName: row['Vehicle Owner Name'] || null,
          vehicleType,
          spxStatus,
          radExpireTime: row['RAD Expire Time'] || null,
          digitalCertificateExpiryDate: row['Digital Certificate Expiry Date'] || null,
          driverType: row['Driver Type'] || null,
          suspensionReason: row['Suspension Reason'] || null,
          ds: row['DS'] || null,
          normalizedVehicleType,
          isActive,
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
      const { availableCount, assignedCount } = await this.syncRoutesFromSheets();

      await this.clearRedisState();

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
      const driverPlate = driver?.licensePlate || route.driverPlate || '';
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
