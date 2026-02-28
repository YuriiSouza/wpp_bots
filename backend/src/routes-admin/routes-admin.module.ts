import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesAdminService } from './routes-admin.service';

@Module({
  imports: [AdminCommonModule],
  controllers: [RoutesAdminController],
  providers: [RoutesAdminService],
})
export class RoutesAdminModule {}
