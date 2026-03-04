import { Body, Controller, Get, Header, Headers, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/dashboard')
  async getDashboardData() {
    return this.appService.getDashboardData();
  }

  @Get('api/drivers')
  async getDrivers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('ds') ds?: string,
    @Query('sortBy') sortBy?: 'name' | 'priorityScore' | 'noShowCount' | 'declineRate',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    return this.appService.getDrivers({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
      vehicleType: vehicleType && vehicleType !== 'all' ? vehicleType : undefined,
      ds: ds && ds !== 'all' ? ds : undefined,
      sortBy,
      sortDir,
    });
  }

  @Get('api/drivers/analytics')
  async getDriversAnalytics() {
    return this.appService.getDriversAnalytics();
  }

  @Patch('api/drivers/:driverId/priority-score')
  async updateDriverPriorityScore(
    @Param('driverId') driverId: string,
    @Body('priorityScore') priorityScore: number,
  ) {
    return this.appService.updateDriverPriorityScore(driverId, priorityScore);
  }

  @Post('api/drivers/:driverId/reset-no-show')
  async resetDriverNoShow(@Param('driverId') driverId: string) {
    return this.appService.resetDriverNoShow(driverId);
  }

  @Get('api/routes')
  async getRoutes(
    @Query('date') date?: string,
    @Query('shift') shift?: 'AM' | 'PM' | 'PM2',
  ) {
    return this.appService.getRoutes(date, shift);
  }

  @Get('api/route-planning')
  async getRoutePlanning(
    @Query('date') date?: string,
    @Query('shift') shift?: 'AM' | 'PM' | 'PM2',
    @Query('atId') atId?: string,
    @Query('focus') focus?: 'DS' | 'VOLUME' | 'PM',
  ) {
    return this.appService.getRoutePlanning(date, shift, atId, focus);
  }

  @Post('api/route-planning/run')
  async runRoutePlanning(
    @Body('date') date?: string,
    @Body('shift') shift?: 'AM' | 'PM' | 'PM2',
    @Body('focus') focus?: 'DS' | 'VOLUME' | 'PM',
  ) {
    return this.appService.runRoutePlanning(date, shift, focus);
  }

  @Put('api/route-planning/preferences')
  async updateRoutePlanningPreferences(@Body('preferences') preferences?: Array<Record<string, unknown>>) {
    return this.appService.updateRoutePlanningPreferences(preferences || []);
  }

  @Get('api/route-planning/map')
  async getRoutePlanningMap(
    @Query('atId') atId?: string,
    @Query('cluster') cluster?: string,
    @Query('br') br?: string,
  ) {
    return this.appService.getRoutePlanningMap(atId, cluster, br);
  }

  @Get('api/routes/export/bot-csv')
  async exportRoutesAssignedByBotCsv(
    @Query('date') date: string | undefined,
    @Res() response: Response,
  ) {
    const csv = await this.appService.getAssignedRoutesCsv(date);
    const suffix = date ? `-${date}` : '';

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="rotas-atribuidas${suffix}.csv"`,
    );

    response.send(csv);
  }

  @Post('api/routes/:routeId/assign')
  async assignRoute(
    @Param('routeId') routeId: string,
    @Body('driverId') driverId: string,
  ) {
    return this.appService.assignRoute(routeId, driverId);
  }

  @Post('api/routes/:routeId/unassign')
  async unassignRoute(
    @Param('routeId') routeId: string,
    @Body('markNoShow') markNoShow?: boolean,
  ) {
    return this.appService.unassignRoute(routeId, markNoShow);
  }

  @Post('api/routes/:routeId/block')
  async blockRoute(@Param('routeId') routeId: string) {
    return this.appService.blockRoute(routeId);
  }

  @Post('api/routes/:routeId/no-show')
  async markRouteNoShow(
    @Param('routeId') routeId: string,
    @Body('makeAvailable') makeAvailable?: boolean,
  ) {
    return this.appService.markRouteNoShow(routeId, makeAvailable);
  }

  @Post('api/routes/:routeId/release-bot')
  async releaseRouteToBot(@Param('routeId') routeId: string) {
    return this.appService.releaseRouteToBot(routeId);
  }

  @Post('api/routes/release-bot')
  async releaseRoutesToBotByAt(
    @Body('atIds') atIds?: string[] | string,
    @Body('date') date?: string,
    @Body('shift') shift?: 'AM' | 'PM' | 'PM2',
  ) {
    return this.appService.releaseRoutesToBotByAt(atIds, date, shift);
  }

  @Post('api/routes/sync-overview-assignments')
  async refreshRoutesFromHistory(
    @Body('date') date?: string,
    @Body('shift') shift?: 'AM' | 'PM' | 'PM2',
  ) {
    return this.appService.triggerSync('routes', date, shift);
  }

  @Post('api/routes/:routeId/clear-no-show')
  async clearRouteNoShow(@Param('routeId') routeId: string) {
    return this.appService.clearRouteNoShow(routeId);
  }

  @Get('api/blocklist')
  async getBlocklist() {
    return this.appService.getBlocklist();
  }

  @Get('api/faq')
  async getFaqItems() {
    return this.appService.getFaqItems();
  }

  @Post('auth/login')
  async login(@Body('email') email: string, @Body('password') password: string) {
    return this.appService.login(email, password);
  }

  @Post('auth/google')
  async loginWithGoogle(@Body('credential') credential: string, @Body('hubId') hubId?: string) {
    return this.appService.loginWithGoogle(credential, hubId);
  }

  @Post('auth/register')
  async register(
    @Body('name') name: string,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('hubId') hubId?: string,
    @Body('telegramChatId') telegramChatId?: string,
  ) {
    return this.appService.register(name, email, password, hubId, telegramChatId);
  }

  @Get('api/hubs')
  async getHubs() {
    return this.appService.getHubs();
  }

  @Get('api/operation-context')
  async getOperationContext() {
    return this.appService.getOperationContext();
  }

  @Put('api/operation-context')
  async updateOperationContext(@Body() payload: Record<string, unknown>) {
    return this.appService.updateOperationContext(payload);
  }

  @Post('api/hubs')
  async createHub(@Body() payload: Record<string, unknown>) {
    return this.appService.createHub(payload);
  }

  @Get('api/users')
  async getManagedUsers() {
    return this.appService.getManagedUsers();
  }

  @Patch('api/auth/onboarding')
  async completeAuthOnboarding(
    @Headers('authorization') authorization?: string,
    @Body('hubId') hubId?: string,
    @Body('telegramChatId') telegramChatId?: string,
  ) {
    return this.appService.completeAuthOnboarding(authorization, hubId, telegramChatId);
  }

  @Post('api/users')
  async createManagedUser(@Body() payload: Record<string, unknown>) {
    return this.appService.createManagedUser(payload);
  }

  @Patch('api/users/:userId')
  async updateManagedUser(
    @Param('userId') userId: string,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.appService.updateManagedUser(userId, payload);
  }

  @Get('api/overview')
  async getOverviewData() {
    return this.appService.getOverviewData();
  }

  @Get('api/sync/logs')
  async getSyncLogs() {
    return this.appService.getSyncLogs();
  }

  @Post('api/sync/run')
  async triggerSync(
    @Body('action') action: 'drivers' | 'routes' | 'all',
    @Body('date') date?: string,
    @Body('shift') shift?: 'AM' | 'PM' | 'PM2',
  ) {
    return this.appService.triggerSync(action || 'all', date, shift);
  }

  @Post('api/sync/reset-queue')
  async resetQueue() {
    return this.appService.resetQueue();
  }

  @Get('api/audit-logs')
  async getAuditLogs() {
    return this.appService.getAuditLogs();
  }

  @Get('api/bot-health')
  async getBotHealth() {
    return this.appService.getBotHealthData();
  }

  @Get('api/settings')
  async getSettings() {
    return this.appService.getSystemSettings();
  }

  @Put('api/settings')
  async updateSettings(@Body() payload: Record<string, unknown>) {
    return this.appService.updateSystemSettings(payload);
  }

  @Get('acess/analist')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getAnalystView(): Promise<string> {
    return this.appService.getAnalystDashboardHtml();
  }

  @Get('acess/duvidas')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getFaqView(): Promise<string> {
    return this.appService.getFaqDashboardHtml();
  }

  @Post('acess/analist/sync')
  async syncFromAnalyst(
    @Body('action') action: 'drivers' | 'routes' | 'all',
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.runAnalystSync(action);
  }

  @Post('acess/analist/routes-note')
  async updateRoutesNote(
    @Body('text') text: string,
  ): Promise<{ ok: boolean; message: string; text: string }> {
    return this.appService.updateRoutesNote(text);
  }

  @Post('acess/analist/blocklist/add')
  @Post('acess/analist/blacklist/add')
  async addBlocklistDriver(
    @Body('driverId') driverId: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.addBlocklistDriver(driverId);
  }

  @Post('acess/analist/blocklist/remove')
  @Post('acess/analist/blacklist/remove')
  async removeBlocklistDriver(
    @Body('driverId') driverId: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.removeBlocklistDriver(driverId);
  }

  @Post('acess/duvidas/create')
  async createFaqItem(
    @Body('title') title: string,
    @Body('answer') answer: string,
    @Body('position') position?: number,
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.createFaqItem(title, answer, position);
  }

  @Post('acess/duvidas/update')
  async updateFaqItem(
    @Body('id') id: string,
    @Body('title') title: string,
    @Body('answer') answer: string,
    @Body('position') position?: number,
    @Body('active') active?: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.updateFaqItem(id, title, answer, position, active);
  }

  @Post('acess/duvidas/delete')
  async deleteFaqItem(
    @Body('id') id: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.appService.deleteFaqItem(id);
  }
}
