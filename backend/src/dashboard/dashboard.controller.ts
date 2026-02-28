import { Body, Controller, Get, Put } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('api/dashboard')
  async getDashboardData() {
    return this.dashboardService.getDashboardData();
  }

  @Get('api/overview')
  async getOverviewData() {
    return this.dashboardService.getOverviewData();
  }

  @Get('api/audit-logs')
  async getAuditLogs() {
    return this.dashboardService.getAuditLogs();
  }

  @Get('api/bot-health')
  async getBotHealth() {
    return this.dashboardService.getBotHealthData();
  }

  @Get('api/settings')
  async getSettings() {
    return this.dashboardService.getSystemSettings();
  }

  @Put('api/settings')
  async updateSettings(@Body() payload: Record<string, unknown>) {
    return this.dashboardService.updateSystemSettings(payload);
  }
}
