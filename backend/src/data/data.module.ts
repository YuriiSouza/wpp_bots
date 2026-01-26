import { Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { RouteService } from './route.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [DriverService, RouteService],
  exports: [DriverService, RouteService],
})
export class DataModule {}
