import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';

export interface ReatribuicaoRoute {
  rowIndex: number;
  atId: string;
  gaiola?: string;
  cluster?: string;
  cidade?: string;
  requiredVehicleType?: string;
  routeDate?: string;
  km?: string;
  spr?: string;
  paradas?: string;
  requestedDriverId?: string;
}

export interface RotaDisponivel {
  rowIndex: number;
  atId: string;
  gaiola?: string;
  cluster?: string;
  cidade?: string;
  vehicleType?: string;
  driverId?: string;
}

@Injectable()
export class SheetsService {
  private sheets;
  private spreadsheetId = process.env.SHEET_ID;
  private readonly reatribuicaoSheetName = 'Reatribuição';
  private readonly assignmentSheetName = 'Visão Geral Atribuições';

  // Headers esperados na aba Reatribuição. Ordem ignorada — uso findIndex por nome.
  private readonly reatribuicaoHeaders = {
    idSugerido: 'ID Sugerido',
    ats: 'ATs',
    gaiola: 'Gaiola',
    cluster: 'Cluster',
    cidade: 'Cidade',
    requiredVehicleType: 'Tipo de Veiculo Nescessario',
    data: 'Data',
    km: 'KM',
    spr: 'SPR',
    paradas: 'Paradas',
  };

  constructor(private readonly prisma: PrismaService) {
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

  private reatribuicaoRange(range: string) {
    return `${this.sanitizeSheetName(this.reatribuicaoSheetName)}!${range}`;
  }

  private assignmentRange(range: string) {
    return `${this.sanitizeSheetName(this.assignmentSheetName)}!${range}`;
  }

  /**
   * Lê todas as rotas atualmente disponíveis na guia Reatribuição.
   * É a fonte única de verdade para a tabela Route — qualquer rota fora daqui é descartada.
   */
  async getReatribuicaoRoutes(): Promise<ReatribuicaoRoute[]> {
    const rows = await this.getRows(this.reatribuicaoRange('A:L'));
    if (rows.length <= 1) return [];

    const headers = rows[0].map((h) => String(h || '').trim());
    const idx = {
      idSugerido: headers.indexOf(this.reatribuicaoHeaders.idSugerido),
      ats: headers.indexOf(this.reatribuicaoHeaders.ats),
      gaiola: headers.indexOf(this.reatribuicaoHeaders.gaiola),
      cluster: headers.indexOf(this.reatribuicaoHeaders.cluster),
      cidade: headers.indexOf(this.reatribuicaoHeaders.cidade),
      requiredVehicleType: headers.indexOf(
        this.reatribuicaoHeaders.requiredVehicleType,
      ),
      data: headers.indexOf(this.reatribuicaoHeaders.data),
      km: headers.indexOf(this.reatribuicaoHeaders.km),
      spr: headers.indexOf(this.reatribuicaoHeaders.spr),
      paradas: headers.indexOf(this.reatribuicaoHeaders.paradas),
    };

    if (idx.ats < 0) {
      throw new Error(
        `Coluna "${this.reatribuicaoHeaders.ats}" não encontrada na guia ${this.reatribuicaoSheetName}`,
      );
    }

    const routes: ReatribuicaoRoute[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const atId = String(row[idx.ats] || '').trim();
      if (!atId) continue;
      routes.push({
        rowIndex: i + 1,
        atId,
        gaiola: idx.gaiola >= 0 ? String(row[idx.gaiola] || '').trim() : '',
        cluster: idx.cluster >= 0 ? String(row[idx.cluster] || '').trim() : '',
        cidade: idx.cidade >= 0 ? String(row[idx.cidade] || '').trim() : '',
        requiredVehicleType:
          idx.requiredVehicleType >= 0
            ? String(row[idx.requiredVehicleType] || '').trim()
            : '',
        routeDate: idx.data >= 0 ? String(row[idx.data] || '').trim() : '',
        km: idx.km >= 0 ? String(row[idx.km] || '').trim() : '',
        spr: idx.spr >= 0 ? String(row[idx.spr] || '').trim() : '',
        paradas:
          idx.paradas >= 0 ? String(row[idx.paradas] || '').trim() : '',
        requestedDriverId:
          idx.idSugerido >= 0
            ? String(row[idx.idSugerido] || '').trim()
            : '',
      });
    }
    return routes;
  }

  /**
   * Resolve a coluna da "ID Sugerido" na guia Reatribuição (lendo o cabeçalho).
   */
  private async getIdSugeridoColumnLetter(): Promise<string> {
    const headerRow = await this.getRows(this.reatribuicaoRange('1:1'));
    const headers = (headerRow[0] || []).map((h) => String(h || '').trim());
    const idx = headers.indexOf(this.reatribuicaoHeaders.idSugerido);
    if (idx < 0) {
      throw new Error(
        `Coluna "${this.reatribuicaoHeaders.idSugerido}" não encontrada na guia ${this.reatribuicaoSheetName}`,
      );
    }
    return this.columnIndexToLetter(idx);
  }

  /**
   * Escreve o ID do motorista aprovado na coluna ID Sugerido da guia Reatribuição.
   */
  async writeIdSugerido(rowNumber: number, driverId: string) {
    const column = await this.getIdSugeridoColumnLetter();
    const range = this.reatribuicaoRange(`${column}${rowNumber}`);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[driverId]] },
    });
  }

  async clearIdSugerido(rowNumber: number) {
    const column = await this.getIdSugeridoColumnLetter();
    const range = this.reatribuicaoRange(`${column}${rowNumber}`);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [['']] },
    });
  }

  /**
   * Lê a coluna K da guia "Visão Geral Atribuições" — IDs de motoristas que já têm rota.
   * Usado pelo sync de drivers para marcar Driver.hasActiveRoute.
   */
  async getActiveDriverIdsFromAssignmentOverview(): Promise<string[]> {
    const rows = await this.getRows(this.assignmentRange('K:K'));
    if (rows.length <= 1) return [];
    const ids = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const id = String((rows[i] || [])[0] || '').trim();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }

  async getAssignmentOverviewRows(): Promise<string[][]> {
    return this.getRows(this.assignmentRange('A:R'));
  }

  /**
   * Compat: chamadas legadas (bot, route.service) usam updateAssignmentRequest(routeId, driverId)
   * para registrar a intenção de atribuição. Agora isso escreve a "ID Sugerido"
   * da Reatribuição, em vez da coluna R de Visão Geral.
   */
  async updateAssignmentRequest(routeId: string, driverId: string) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true },
    });
    if (!route?.sheetRowNumber) return false;
    await this.writeIdSugerido(route.sheetRowNumber, driverId);
    return true;
  }

  async clearAssignmentRequest(routeId: string) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { sheetRowNumber: true },
    });
    if (!route?.sheetRowNumber) return false;
    await this.clearIdSugerido(route.sheetRowNumber);
    return true;
  }

  /** Compat: sem cache Redis, no-op. */
  async clearDriverRouteCache(_driverId: string) {
    return;
  }

  /**
   * Compat: a noção de "janela de cálculo" (shift atual) foi descontinuada.
   * Retorna null para callsites legados — eles aplicam fallback próprio.
   */
  async getCurrentCalculationWindow(): Promise<{ date: string; shift: 'AM' | 'PM' | 'PM2' } | null> {
    return null;
  }

  /**
   * Verifica se um motorista já tem rota — consulta Driver.hasActiveRoute no DB.
   * O sync periódico de drivers mantém esse campo alinhado com a coluna K
   * de "Visão Geral Atribuições".
   */
  async driverAlreadyHasRoute(driverId: string): Promise<boolean> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: String(driverId) },
      select: { hasActiveRoute: true },
    });
    return !!driver?.hasActiveRoute;
  }

  async getDriverVehicle(driverId: number): Promise<{
    id: number;
    name: string;
    vehicleType: string;
  } | null> {
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

    return {
      id: driverId,
      name: String(driverRow[nameIndex] || ''),
      vehicleType: String(driverRow[vehicleIndex] || ''),
    };
  }

  /**
   * Rotas disponíveis para o bot — vem direto do banco (Route).
   * O Route é alimentado pelo botão "Atualizar rotas" do frontend, que limpa
   * tudo e reimporta da guia Reatribuição.
   */
  async getAvailableRoutes(vehicleType: string): Promise<RotaDisponivel[]> {
    const routes = await this.prisma.route.findMany({
      where: {
        status: 'DISPONIVEL',
        requiredVehicleType: { equals: vehicleType, mode: 'insensitive' },
      },
      select: {
        sheetRowNumber: true,
        atId: true,
        gaiola: true,
        cluster: true,
        cidade: true,
        requiredVehicleType: true,
        requestedDriverId: true,
      },
    });
    return routes.map((r) => ({
      rowIndex: r.sheetRowNumber || 0,
      atId: r.atId,
      gaiola: r.gaiola || '',
      cluster: r.cluster || '',
      cidade: r.cidade || '',
      vehicleType: r.requiredVehicleType || '',
      driverId: r.requestedDriverId || '',
    }));
  }

  async getAllAvailableRoutes(): Promise<RotaDisponivel[]> {
    const routes = await this.prisma.route.findMany({
      where: { status: 'DISPONIVEL' },
      select: {
        sheetRowNumber: true,
        atId: true,
        gaiola: true,
        cluster: true,
        cidade: true,
        requiredVehicleType: true,
        requestedDriverId: true,
      },
    });
    return routes.map((r) => ({
      rowIndex: r.sheetRowNumber || 0,
      atId: r.atId,
      gaiola: r.gaiola || '',
      cluster: r.cluster || '',
      cidade: r.cidade || '',
      vehicleType: r.requiredVehicleType || '',
      driverId: r.requestedDriverId || '',
    }));
  }

  /**
   * Marca uma rota como atribuída a um motorista — atualiza DB e escreve ID Sugerido na planilha.
   */
  async assignRoute(atId: string, driverId: number | string): Promise<boolean> {
    const route = await this.prisma.route.findUnique({
      where: { atId: String(atId) },
      select: {
        id: true,
        sheetRowNumber: true,
        requestedDriverId: true,
        status: true,
      },
    });
    if (!route) return false;
    if (route.requestedDriverId) return false;
    if (route.status !== 'DISPONIVEL') return false;

    await this.prisma.route.update({
      where: { id: route.id },
      data: {
        requestedDriverId: String(driverId),
      },
    });

    if (route.sheetRowNumber) {
      await this.writeIdSugerido(route.sheetRowNumber, String(driverId));
    }

    return true;
  }
}
