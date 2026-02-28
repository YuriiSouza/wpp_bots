import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SyncModule } from '../sync/sync.module';
import { AdminCommonService } from './admin-common.service';

@Module({
  imports: [PrismaModule, RedisModule, SyncModule],
  providers: [AdminCommonService],
  exports: [AdminCommonService],
})
export class AdminCommonModule {}
