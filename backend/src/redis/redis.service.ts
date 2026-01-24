import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const v = await this.redis.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.redis.set(key, payload, 'EX', ttlSeconds);
    else await this.redis.set(key, payload);
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  client() {
    return this.redis;
  }
}