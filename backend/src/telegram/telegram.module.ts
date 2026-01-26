import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { RedisModule } from '../redis/redis.module';
import { DataModule } from '../data/data.module';
import { SyncModule } from '../sync/sync.module';
import { SheetsModule } from '../sheets/sheets.module';


@Module({
  controllers: [TelegramController],
  providers: [TelegramService],
  imports: [RedisModule, DataModule, SyncModule, SheetsModule],
})
export class TelegramModule {}
