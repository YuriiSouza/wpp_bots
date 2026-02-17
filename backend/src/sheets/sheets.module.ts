import { Module } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [RedisModule, PrismaModule],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
