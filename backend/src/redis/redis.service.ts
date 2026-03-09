import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private readonly cacheMode = String(process.env.REDIS_CACHE_MODE || 'minimal')
    .trim()
    .toLowerCase();

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private shouldBypassKey(key: string): boolean {
    if (this.cacheMode === 'full') return false;

    const normalized = String(key || '').trim();
    if (!normalized) return false;

    return (
      normalized.startsWith('cache:dashboard:') ||
      normalized.startsWith('cache:drivers:') ||
      normalized.startsWith('cache:blocklist:list') ||
      normalized.startsWith('cache:overview:route-requests') ||
      normalized.startsWith('driver:hasRoute:') ||
      normalized.startsWith('routes:available:') ||
      normalized.startsWith('telegram:blocklist:cache:driver:')
    );
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.shouldBypassKey(key)) return null;
    const v = await this.redis.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (this.shouldBypassKey(key)) return;
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.redis.set(key, payload, 'EX', ttlSeconds);
    else await this.redis.set(key, payload);
  }

  async del(key: string) {
    if (this.shouldBypassKey(key)) return;
    await this.redis.del(key);
  }

  client() {
    return this.redis;
  }
}
