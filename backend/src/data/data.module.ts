import { Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { RouteService } from './route.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [PrismaModule, SheetsModule],
  providers: [DriverService, RouteService],
  exports: [DriverService, RouteService],
})
export class DataModule {}
