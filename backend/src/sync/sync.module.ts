import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SheetsModule } from '../sheets/sheets.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, SheetsModule, RedisModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
