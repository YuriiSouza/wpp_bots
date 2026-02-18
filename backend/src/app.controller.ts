import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
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
