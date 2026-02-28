import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AdminCommonModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
