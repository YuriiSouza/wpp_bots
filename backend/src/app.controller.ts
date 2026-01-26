import { Controller, Get, Header } from '@nestjs/common';
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
}
