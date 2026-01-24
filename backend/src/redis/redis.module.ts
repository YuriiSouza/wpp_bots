import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
      const url = config.getOrThrow<string>('REDIS_URL');
      return new Redis(url);
      },
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}