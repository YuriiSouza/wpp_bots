import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { FaqService } from './faq.service';

@Controller()
export class FaqController {
  constructor(private readonly faqService: FaqService) {}

  @Get('api/faq')
  async getFaqItems() {
    return this.faqService.getFaqItems();
  }

  @Get('acess/duvidas')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getFaqView(): Promise<string> {
    return this.faqService.getFaqDashboardHtml();
  }

  @Post('acess/duvidas/create')
  async createFaqItem(
    @Body('title') title: string,
    @Body('answer') answer: string,
    @Body('position') position?: number,
  ) {
    return this.faqService.createFaqItem(title, answer, position);
  }

  @Post('acess/duvidas/update')
  async updateFaqItem(
    @Body('id') id: string,
    @Body('title') title: string,
    @Body('answer') answer: string,
    @Body('position') position?: number,
    @Body('active') active?: boolean,
  ) {
    return this.faqService.updateFaqItem(id, title, answer, position, active);
  }

  @Post('acess/duvidas/delete')
  async deleteFaqItem(@Body('id') id: string) {
    return this.faqService.deleteFaqItem(id);
  }
}
