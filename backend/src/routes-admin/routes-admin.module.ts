import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesAdminService } from './routes-admin.service';
import { SyncModule } from '../sync/sync.module';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [AdminCommonModule, SyncModule, SheetsModule],
  controllers: [RoutesAdminController],
  providers: [RoutesAdminService],
})
export class RoutesAdminModule {}
