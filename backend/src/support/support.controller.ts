import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller()
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('api/support/tickets')
  async getSupportTickets(
    @Query('hubId') hubId?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('userHubId') userHubId?: string,
  ) {
    return this.supportService.getSupportTickets({ hubId, status, role, userHubId });
  }

  @Get('api/support/tickets/:ticketId/messages')
  async getSupportMessages(@Param('ticketId') ticketId: string) {
    return this.supportService.getSupportMessages(ticketId);
  }

  @Get('api/support/tickets/:ticketId/context')
  async getSupportContext(@Param('ticketId') ticketId: string) {
    return this.supportService.getSupportContext(ticketId);
  }

  @Get('api/support/tickets/:ticketId/analysts')
  async getSupportAssignableAnalysts(
    @Param('ticketId') ticketId: string,
    @Query('role') role?: string,
    @Query('userHubId') userHubId?: string,
  ) {
    return this.supportService.getSupportAssignableAnalysts(ticketId, role, userHubId);
  }

  @Post('api/support/tickets/:ticketId/assume')
  async assumeSupportTicket(
    @Param('ticketId') ticketId: string,
    @Body('analystId') analystId: string,
  ) {
    return this.supportService.assumeSupportTicket(ticketId, analystId);
  }

  @Post('api/support/tickets/:ticketId/close')
  async closeSupportTicket(@Param('ticketId') ticketId: string) {
    return this.supportService.closeSupportTicket(ticketId);
  }

  @Post('api/support/tickets/:ticketId/transfer')
  async transferSupportTicket(
    @Param('ticketId') ticketId: string,
    @Body('analystId') analystId: string,
  ) {
    return this.supportService.transferSupportTicket(ticketId, analystId);
  }

  @Post('api/support/tickets/:ticketId/messages')
  async createSupportMessage(
    @Param('ticketId') ticketId: string,
    @Body('body') body: string,
    @Body('telegramText') telegramText: string,
    @Body('authorId') authorId?: string,
    @Body('authorName') authorName?: string,
  ) {
    return this.supportService.createSupportMessage(
      ticketId,
      body,
      telegramText,
      authorId,
      authorName,
    );
  }

  @Get('api/support/metrics')
  async getSupportMetrics(
    @Query('hubId') hubId?: string,
    @Query('role') role?: string,
    @Query('userHubId') userHubId?: string,
  ) {
    return this.supportService.getSupportMetrics({ hubId, role, userHubId });
  }

  @Get('api/support/history')
  async getSupportHistory(
    @Query('hubId') hubId?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('userHubId') userHubId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.supportService.getSupportHistory({
      hubId,
      status,
      role,
      userHubId,
      search,
      from,
      to,
    });
  }
}
