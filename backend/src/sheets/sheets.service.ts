import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { RedisService } from '../redis/redis.service';

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

  constructor(private readonly redisService: RedisService) {
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

  async driverAlreadyHasRoute(driverId: number): Promise<boolean> {
    const cacheKey = `driver:hasRoute:${driverId}`;
    const cached = await this.redisService.get<boolean>(cacheKey);
    if (cached === false) return false;

    const rotasRows = await this.getRows(`'Rotas recusadas'!A:L`);
    const visaoRows = await this.getRows(`'Visão Geral Atribuições'!J:J`);

    const hasRouteInRotas = rotasRows
      .slice(1)
      .some((row) => String(row[11] || '') === String(driverId));

    const hasRouteInVisao = visaoRows
      .slice(1)
      .some((row) => String(row[0] || '') === String(driverId));

    const hasRoute = hasRouteInRotas || hasRouteInVisao;

    await this.redisService.set(cacheKey, hasRoute, this.cacheTtlSeconds);
    return hasRoute;
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
