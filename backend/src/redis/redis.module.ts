import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
