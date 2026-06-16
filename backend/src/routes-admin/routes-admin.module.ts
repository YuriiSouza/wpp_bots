import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesAdminService } from './routes-admin.service';
import { SyncModule } from '../sync/sync.module';
import { SheetsModule } from '../sheets/sheets.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [AdminCommonModule, SyncModule, SheetsModule, TelegramModule],
  controllers: [RoutesAdminController],
  providers: [RoutesAdminService],
})
export class RoutesAdminModule {}
