import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ConversationStep } from './conversation.types';

export interface ConversationState {
  phone: string;
  step: ConversationStep;
  driverId?: string;
  availableRoutes?: any[];
  startedAt: string;
  lastActivityAt: string;
}

const QUEUE_KEY = 'queue:drivers';
const ACTIVE_LOCK_KEY = 'lock:active';

type Step = 'WAITING_ID' | 'WAITING_ROUTE';

@Injectable()
export class QueueService {
  constructor(private readonly redisService: RedisService) {}

  private redis() {
    return this.redisService.client();
  }

  async isActive(phone: string): Promise<boolean> {
    const active = await this.redis().get(ACTIVE_LOCK_KEY);
    return active === phone;
  }

  async getActivePhone(): Promise<string | null> {
    return this.redis().get(ACTIVE_LOCK_KEY);
  }

  async ensureEnqueued(phone: string): Promise<void> {
    const active = await this.getActivePhone();
    if (active === phone) return;

    // evita duplicar na fila: checagem simples via set auxiliar
    const markerKey = `queue:marker:${phone}`;
    const result = await this.redis()
      .multi()
      .setnx(markerKey, '1')
      .expire(markerKey, 60 * 60)
      .exec();

    const setOk = result?.[0]?.[1] === 1;

    if (!setOk) {
      return;
    }

    await this.redis().rpush(QUEUE_KEY, phone);
  }

  async tryStartNextConversation(ttlSeconds: number): Promise<ConversationState | null> {
    const active = await this.getActivePhone();
    if (active) return null;

    const nextPhone = await this.redis().lpop(QUEUE_KEY);
    if (!nextPhone) return null;

    // lock global (somente 1 atendimento)
    const redis = this.redis();

    const result = await redis
      .multi()
      .setnx(ACTIVE_LOCK_KEY, nextPhone)
      .expire(ACTIVE_LOCK_KEY, ttlSeconds)
      .exec();

    const lockOk = result?.[0]?.[1] === 1;

    if (!lockOk) {
      return null;
    }

    // remove marker da fila (se existir)
    await this.redis().del(`queue:marker:${nextPhone}`);

    const now = new Date().toISOString();
    const state: ConversationState = {
      phone: nextPhone,
      step: 'WAITING_ID',
      startedAt: now,
      lastActivityAt: now,
    };

    await this.redisService.set(`state:${nextPhone}`, state, ttlSeconds);
    return state;
  }

  async touchActive(ttlSeconds: number): Promise<void> {
    const phone = await this.getActivePhone();
    if (!phone) return;

    const now = new Date().toISOString();
    const stateKey = `state:${phone}`;
    const state = (await this.redisService.get<ConversationState>(stateKey)) ?? {
      phone,
      step: 'WAITING_ID',
      startedAt: now,
      lastActivityAt: now,
    };

    state.lastActivityAt = now;

    // estende TTL do lock e do estado para manter 5 min a partir da última interação
    await this.redis().expire(ACTIVE_LOCK_KEY, ttlSeconds);
    await this.redisService.set(stateKey, state, ttlSeconds);
  }

  async endConversation(): Promise<void> {
    const phone = await this.getActivePhone();
    if (!phone) return;

    await this.redis().del(ACTIVE_LOCK_KEY);
    await this.redisService.del(`state:${phone}`);
  }

  async getState(phone: string): Promise<ConversationState | null> {
    return this.redisService.get<ConversationState>(`state:${phone}`);
  }

  async setState(phone: string, state: ConversationState, ttlSeconds: number): Promise<void> {
    await this.redisService.set(`state:${phone}`, state, ttlSeconds);
  }

  async enqueue(phone: string) {
    await this.redis().rpush('queue:drivers', phone);
  }

  async getPosition(phone: string): Promise<number> {
    const queue = await this.redis().lrange('queue:drivers', 0, -1);
    const index = queue.indexOf(phone);
    return index >= 0 ? index + 1 : -1;
  }

  async clearState(phone: string) {
    await this.redis().del(`state:${phone}`);
  }
}
