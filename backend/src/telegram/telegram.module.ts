import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { SheetsModule } from '../sheets/sheets.module';
import { RedisModule } from '../redis/redis.module';


@Module({
  controllers: [TelegramController],
  providers: [TelegramService],
  imports: [SheetsModule, RedisModule],
})
export class TelegramModule {}
