import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [AdminCommonModule, TelegramModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
