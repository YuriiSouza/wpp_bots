import { Module } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
