import { Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { RouteService } from './route.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SheetsModule } from '../sheets/sheets.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, SheetsModule, RedisModule],
  providers: [DriverService, RouteService],
  exports: [DriverService, RouteService],
})
export class DataModule {}
