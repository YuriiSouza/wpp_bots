import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

export interface RotaDisponivel {
  rowIndex: number;
  atId: string;
  gaiola?: string;
  bairro?: string;
  cidade?: string;
  vehicleType?: string;
  volume: number;
  driverId?: string;
}

@Injectable()
export class SheetsService {
  private sheets;
  private spreadsheetId = process.env.SHEET_ID;
  private readonly cacheTtlSeconds = 300;
  private readonly assignmentSheetName = 'Visão Geral Atribuições';

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const credentials = this.getServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }


  private getServiceAccountCredentials() {
    const envB64 = process.env.GOOGLE_CREDENTIALS_B64;

    if (envB64) {
      try {
        const decoded = Buffer.from(envB64, 'base64').toString('utf8');
        return JSON.parse(decoded);
      } catch (error) {
        throw new Error('Erro ao parsear GOOGLE_CREDENTIALS_B64');
      }
    }
    throw new Error('GOOGLE_CREDENTIALS_B64 não informado');
  }

  async getRows(range: string): Promise<string[][]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });

    return res.data.values || [];
  }

  private normalizeCalculationDate(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashMatch) {
      const [, day, month, year] = dashMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  private normalizeCalculationShift(value: unknown) {
    const raw = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\s*-\s*/g, ' - ');
    if (raw === 'AM') return 'AM';
    if (raw === 'PM' || raw === 'PM1') return 'PM';
    if (raw === 'PM2') return 'PM2';
    if (raw === '06:00 - 09:00') return 'AM';
    const rangeMatch = raw.match(/^(\d{1,2}):(\d{2}) - (\d{1,2}):(\d{2})$/);
    if (rangeMatch) {
      const [, startHour, startMinute, endHour, endMinute] = rangeMatch;
      const start = Number(startHour) * 60 + Number(startMinute);
      const end = Number(endHour) * 60 + Number(endMinute);

      if (end <= 10 * 60) return 'AM';
      if (start >= 15 * 60 || end > 18 * 60) return 'PM2';
      return 'PM';
    }
    return '';
  }

  async getCurrentCalculationWindow(): Promise<{ date: string; shift: 'AM' | 'PM' | 'PM2' } | null> {
    const rows = await this.getRows("'Calculation Tasks'!K:AF");
    if (rows.length <= 1) return null;

    const today = new Date().toISOString().slice(0, 10);
    const counts = new Map<string, number>();

    for (const row of rows.slice(1)) {
      const date = this.normalizeCalculationDate(row[0]);
      const shift = this.normalizeCalculationShift(row[21] || row[1]);
      const atId = String(row[17] || '').trim();
      if (!date || !atId || !shift) continue;

      const key = `${date}|${shift}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    if (!counts.size) return null;

    const sorted = Array.from(counts.entries()).sort((left, right) => {
      const [leftKey, leftCount] = left;
      const [rightKey, rightCount] = right;
      const [leftDate] = leftKey.split('|');
      const [rightDate] = rightKey.split('|');

      const leftIsToday = leftDate === today ? 1 : 0;
      const rightIsToday = rightDate === today ? 1 : 0;
      if (leftIsToday !== rightIsToday) return rightIsToday - leftIsToday;
      if (leftCount !== rightCount) return rightCount - leftCount;
      return rightKey.localeCompare(leftKey);
    });

    const [selectedKey] = sorted[0];
    const [date, shift] = selectedKey.split('|');
    if (!date || !shift) return null;

    return {
      date,
      shift: shift as 'AM' | 'PM' | 'PM2',
    };
  }

  async batchUpdateValues(
    updates: { range: string; values: string[][] }[],
  ) {
    if (!updates.length) return;

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
  }

  async clearValues(range: string) {
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range,
    });
  }

  async ensureSheetExists(sheetName: string) {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.title',
    });

    const exists = (spreadsheet.data.sheets || []).some(
      (sheet: any) => String(sheet?.properties?.title || '') === sheetName,
    );

    if (exists) return;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
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

  private sanitizeSheetName(name: string) {
    return `'${name.replace(/'/g, "''")}'`;
  }

  private assignmentRange(range: string) {
    return `${this.sanitizeSheetName(this.assignmentSheetName)}!${range}`;
  }

  async getAssignmentOverviewRows(): Promise<string[][]> {
    return this.getRows(this.assignmentRange('A:R'));
  }

  async updateAssignmentRequestByRow(rowNumber: number, driverId: string) {
    const range = this.assignmentRange(`R${rowNumber}`);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[driverId]],
      },
    });
    return true;
  }

  async updateAssignmentRequest(routeId: string, driverId: string) {
    const route = await (this.prisma as any).route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true },
    });
    if (!route?.sheetRowNumber) return false;
    await this.updateAssignmentRequestByRow(route.sheetRowNumber, driverId);
    return true;
  }

  async clearAssignmentRequest(routeId: string) {
    const route = await (this.prisma as any).route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true, driverId: true },
    });
    if (!route?.sheetRowNumber) return false;
    await this.updateAssignmentRequestByRow(route.sheetRowNumber, '');
    if (route.driverId) {
      await this.clearDriverRouteCache(route.driverId);
    }
    return true;
  }

  async clearDriverRouteCache(driverId: string) {
    await this.redisService.del(`driver:hasRoute:${String(driverId)}`);
  }

  async updateRouteDriverId(atId: string, driverId: string) {
    const rows = await this.getRows(`'Rotas recusadas'!A:Z`);
    if (!rows.length) return false;

    const headers = rows[0];
    const idIndex = headers.findIndex((h) => h.trim() === 'ID');
    const atIndex = headers.findIndex((h) => h.trim() === 'ATs');
    if (idIndex < 0 || atIndex < 0) return false;

    const rowIndex = rows
      .slice(1)
      .findIndex((row) => String(row[atIndex] || '').trim() === atId);
    if (rowIndex < 0) return false;

    const sheetRow = rowIndex + 2;
    const column = this.columnIndexToLetter(idIndex);
    const range = `'Rotas recusadas'!${column}${sheetRow}`;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[driverId]],
      },
    });

    return true;
  }

  async driverAlreadyHasRoute(driverId: string): Promise<boolean> {
    const cacheKey = `driver:hasRoute:${driverId}`;
    const cached = await this.redisService.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    const hasRoute = await this.prisma.assignmentOverview.findFirst({
      where: { driverId: String(driverId) },
      select: { id: true },
    });

    const result = !!hasRoute;
    await this.redisService.set(cacheKey, result, this.cacheTtlSeconds);
    return result;
  }

  async getDriverVehicle(driverId: number): Promise<{
    id: number;
    name: string;
    vehicleType: string;
  } | null> {
    const cacheKey = `driver:info:${driverId}`;
    const cached = await this.redisService.get<{
      id: number;
      name: string;
      vehicleType: string;
    }>(cacheKey);

    if (cached) return cached;

    const rows = await this.getRows('Perfil de Motorista!A1:AZ');
    if (rows.length === 0) return null;

    const headers = rows[0];
    const idIndex = headers.indexOf('Driver ID');
    const nameIndex = headers.indexOf('Driver Name');
    const vehicleIndex = headers.indexOf('Vehicle Type');

    if (idIndex === -1) {
      throw new Error('Coluna "Driver ID" não encontrada');
    }

    const driverRow = rows
      .slice(1)
      .find((r) => String(r[idIndex] || '') === String(driverId));

    if (!driverRow) return null;

    const driver = {
      id: driverId,
      name: String(driverRow[nameIndex] || ''),
      vehicleType: String(driverRow[vehicleIndex] || ''),
    };

    await this.redisService.set(cacheKey, driver, this.cacheTtlSeconds);
    return driver;
  }

  async getAvailableRoutes(vehicleType: string): Promise<RotaDisponivel[]> {
    const cacheKey = `routes:available:${vehicleType.toLowerCase()}`;
    const cached = await this.redisService.get<RotaDisponivel[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.getRows(`'Rotas recusadas'!A:L`);
    if (rows.length <= 1) return [];

    const routes = rows
      .slice(1)
      .map((row, index) => ({
        rowIndex: index + 2,
        atId: String(row[0] || ''),
        gaiola: row[1],
        bairro: row[2],
        cidade: row[3],
        vehicleType: row[4],
        volume: Number(row[8] || 0),
        driverId: row[11],
      }))
      .filter(
        (r) =>
          r.vehicleType?.toLowerCase() === vehicleType.toLowerCase() &&
          (!r.driverId || r.driverId === ''),
      );

    await this.redisService.set(cacheKey, routes, this.cacheTtlSeconds);
    return routes;
  }

  async getAllAvailableRoutes(): Promise<RotaDisponivel[]> {
    const cacheKey = 'routes:available:all';
    const cached = await this.redisService.get<RotaDisponivel[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.getRows(`'Rotas recusadas'!A:L`);
    if (rows.length <= 1) return [];

    const routes = rows
      .slice(1)
      .map((row, index) => ({
        rowIndex: index + 2,
        gaiola: row[1],
        atId: String(row[0] || ''),
        bairro: row[2],
        cidade: row[3],
        vehicleType: row[4],
        volume: Number(row[8] || 0),
        driverId: row[11],
      }))
      .filter((r) => !r.driverId || r.driverId === '');

    await this.redisService.set(cacheKey, routes, this.cacheTtlSeconds);
    return routes;
  }

  async assignRoute(atId: string, driverId: number): Promise<boolean> {
    const rows = await this.getRows(`'Rotas recusadas'!A:L`);
    if (rows.length <= 1) return false;

    const data = rows.slice(1);
    const matchIndex = data.findIndex(
      (row) => String(row[0] || '') === String(atId),
    );

    if (matchIndex === -1) return false;

    const rowIndex = matchIndex + 2;
    const currentDriverId = data[matchIndex][11];
    const vehicleType = String(data[matchIndex][4] || '');

    if (currentDriverId) return false;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `'Rotas recusadas'!L${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[driverId]],
      },
    });

    if (vehicleType) {
      await this.redisService.del(
        `routes:available:${vehicleType.toLowerCase()}`,
      );
    }
    await this.redisService.del('routes:available:all');
    await this.redisService.del(`driver:hasRoute:${driverId}`);
    return true;
  }
}
