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
      return new Redis(url, {
          maxRetriesPerRequest: 3,
          connectTimeout: 10_000,
          enableReadyCheck: true,
          retryStrategy(times) {
            if (times > 3) {
              return null; // PARA de tentar
            }
            return Math.min(times * 500, 2000);
          },
      });
      },
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}