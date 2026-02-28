import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';

@Module({
  imports: [AdminCommonModule],
  controllers: [FaqController],
  providers: [FaqService],
})
export class FaqModule {}
