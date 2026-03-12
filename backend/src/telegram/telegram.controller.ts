import { Body, Controller, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { RedisService } from '../redis/redis.service';
import { sortRoutes } from '../utils/sort-routes';
import { DriverSession, DriverState } from './telegram.state';
import { DriverService } from '../data/driver.service';
import { RouteService } from '../data/route.service';
import { normalizeVehicleType } from '../utils/normalize-vehicle';
import { SyncService } from '../sync/sync.service';
import { SheetsService } from '../sheets/sheets.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  NO_ROUTES_AVAILABLE,
} from './telegram.messages';

@Controller('telegram/webhook')
export class TelegramController implements OnModuleInit, OnModuleDestroy {
  // Sessão do motorista
  private readonly STATE_TTL = 10800; // 30 min

  // Controle de fila
  private readonly QUEUE_TTL = 30; // 30s
  private readonly QUEUE_LIST_KEY_GENERAL = 'telegram:queue:list:general';
  private readonly QUEUE_ACTIVE_KEY_GENERAL = 'telegram:queue:active:general';
  private readonly QUEUE_ACTIVE_META_KEY_GENERAL =
    'telegram:queue:active:meta:general';
  private readonly QUEUE_LIST_KEY_MOTO = 'telegram:queue:list:moto';
  private readonly QUEUE_ACTIVE_KEY_MOTO = 'telegram:queue:active:moto';
  private readonly QUEUE_ACTIVE_META_KEY_MOTO =
    'telegram:queue:active:meta:moto';
  private readonly ROUTE_TIMEOUT_PREFIX = 'telegram:route:timeout';
  private readonly ROUTE_DISPATCH_PREFIX = 'telegram:route:dispatch';
  private readonly QUEUE_WAIT_NOTICE_PREFIX = 'telegram:queue:wait-notice';
  private readonly ROUTE_TIMEOUT_LOCK_KEY = 'telegram:route:timeout:lock';
  private readonly LOG_PREFIX = 'telegram:log';
  private readonly ROUTES_NOTE_KEY = 'telegram:routes:note';
  private readonly BLOCKLIST_CACHE_PREFIX = 'telegram:blocklist:cache:driver';
  private readonly DRIVER_CHAT_PREFIX = 'telegram:driver:chat';
  private readonly CHAT_DRIVER_PREFIX = 'telegram:chat:driver';
  private readonly OVERVIEW_ROUTE_REQUESTS_CACHE_KEY =
    'cache:overview:route-requests:v1';
  private readonly BLOCKLIST_WAIT_SECONDS = 120;

  private timeoutWatcher?: NodeJS.Timeout;

  constructor(
    private readonly telegram: TelegramService,
    private readonly drivers: DriverService,
    private readonly routes: RouteService,
    private readonly redis: RedisService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
    private readonly prisma: PrismaService,
  ) {}

  /* =======================
      Helpers Redis
  ======================== */

  private stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  private driverChatKey(driverId: string) {
    return `${this.DRIVER_CHAT_PREFIX}:${driverId}`;
  }

  private chatDriverKey(chatId: string) {
    return `${this.CHAT_DRIVER_PREFIX}:${chatId}`;
  }

  private async getState(chatId: string): Promise<DriverSession | null> {
    return this.redis.get<DriverSession>(this.stateKey(chatId));
  }

  private async setState(chatId: string, state: DriverSession) {
    const client = this.redis.client();
    const previousDriverId = await client.get(this.chatDriverKey(chatId));

    await this.redis.set(this.stateKey(chatId), state, this.STATE_TTL);

    const nextDriverId = String(state.driverId || '').trim();
    if (previousDriverId && previousDriverId !== nextDriverId) {
      await client.del(this.driverChatKey(previousDriverId));
    }

    if (nextDriverId) {
      await client.set(this.driverChatKey(nextDriverId), chatId, 'EX', this.STATE_TTL);
      await client.set(this.chatDriverKey(chatId), nextDriverId, 'EX', this.STATE_TTL);
      return;
    }

    await client.del(this.chatDriverKey(chatId));
  }

  private async clearState(chatId: string) {
    const client = this.redis.client();
    const driverId = await client.get(this.chatDriverKey(chatId));
    await this.redis.del(this.stateKey(chatId));
    await client.del(this.chatDriverKey(chatId));
    if (driverId) {
      await client.del(this.driverChatKey(driverId));
    }
  }

  private queueMarker(chatId: string) {
    return `telegram:queue:member:${chatId}`;
  }

  private isFiorino(vehicleType?: string) {
    const type = (vehicleType || '').toLowerCase();
    return type.includes('fiorino');
  }

  private isMoto(vehicleType?: string) {
    return normalizeVehicleType(vehicleType) === 'MOTO';
  }

  private queueGroupFromVehicle(vehicleType?: string) {
    return this.isMoto(vehicleType) ? 'moto' : 'general';
  }

  private queueListKey(group: 'moto' | 'general') {
    return group === 'moto' ? this.QUEUE_LIST_KEY_MOTO : this.QUEUE_LIST_KEY_GENERAL;
  }

  private queueActiveKey(group: 'moto' | 'general') {
    return group === 'moto' ? this.QUEUE_ACTIVE_KEY_MOTO : this.QUEUE_ACTIVE_KEY_GENERAL;
  }

  private queueActiveMetaKey(group: 'moto' | 'general') {
    return group === 'moto'
      ? this.QUEUE_ACTIVE_META_KEY_MOTO
      : this.QUEUE_ACTIVE_META_KEY_GENERAL;
  }

  private routeTimeoutKey(chatId: string) {
    return `${this.ROUTE_TIMEOUT_PREFIX}:${chatId}`;
  }

  private routeDispatchKey(chatId: string) {
    return `${this.ROUTE_DISPATCH_PREFIX}:${chatId}`;
  }

  private queueWaitNoticeKey(chatId: string) {
    return `${this.QUEUE_WAIT_NOTICE_PREFIX}:${chatId}`;
  }

  private logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  onModuleInit() {
    this.timeoutWatcher = setInterval(() => {
      void this.maintainQueueGroup('general');
      void this.maintainQueueGroup('moto');
    }, 5000);
  }

  onModuleDestroy() {
    if (this.timeoutWatcher) clearInterval(this.timeoutWatcher);
  }

  /* =======================
      FILA
  ======================== */

  private queueEmptySinceKey(group: 'moto' | 'general') {
    return `telegram:queue:empty_since:${group}`;
  }

  private async isChatBlocklisted(
    chatId: string,
    state?: DriverSession | null,
  ): Promise<boolean> {
    const currentState = state ?? (await this.getState(chatId));
    const driverId = currentState?.driverId;
    if (!driverId) return false;
    const cacheKey = `${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`;
    const cached = await this.redis.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    const row = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });
    const isActive = String(row?.status || '') === 'BLOCKED';
    await this.redis.set(cacheKey, isActive, 3600);
    return isActive;
  }

  private async getBlockedQueueRequest(driverId: string) {
    const prisma = this.prisma as any;
    return prisma.blockedQueueRequest.findUnique({
      where: { driverId },
    });
  }

  private async createOrRefreshBlockedQueueRequest(
    chatId: string,
    state: DriverSession,
  ) {
    const prisma = this.prisma as any;
    const blocklist = await prisma.driverBlocklist.findUnique({
      where: { driverId: state.driverId },
      select: { reason: true },
    });
    const existing = await this.getBlockedQueueRequest(String(state.driverId || ''));
    const payload = {
      chatId,
      driverName: state.driverName || null,
      vehicleType: state.vehicleType || null,
      blockReason: blocklist?.reason || null,
      requestedAt: new Date(),
      approvedById: null,
      approvedByName: null,
      resolvedAt: null,
    };

    if (!existing) {
      const created = await prisma.blockedQueueRequest.create({
        data: {
          driverId: state.driverId,
          status: 'PENDING',
          cooldownUntil: null,
          ...payload,
        },
      });
      return { request: created, created: true, cooldownActive: false };
    }

    if (String(existing.status || '') === 'APPROVED') {
      return { request: existing, created: false, cooldownActive: false };
    }

    const cooldownUntil = existing.cooldownUntil ? new Date(existing.cooldownUntil) : null;
    if (
      String(existing.status || '') === 'REJECTED' &&
      cooldownUntil &&
      !Number.isNaN(cooldownUntil.getTime()) &&
      cooldownUntil.getTime() > Date.now()
    ) {
      return { request: existing, created: false, cooldownActive: true };
    }

    const updated = await prisma.blockedQueueRequest.update({
      where: { driverId: state.driverId },
      data: {
        status: 'PENDING',
        cooldownUntil: null,
        ...payload,
      },
    });
    return {
      request: updated,
      created: String(existing.status || '') !== 'PENDING',
      cooldownActive: false,
    };
  }

  private async consumeBlockedQueueApproval(driverId: string) {
    const prisma = this.prisma as any;
    await prisma.blockedQueueRequest.updateMany({
      where: {
        driverId,
        status: 'APPROVED',
      },
      data: {
        status: 'CONSUMED',
        resolvedAt: new Date(),
      },
    });
  }

  private async notifyAnalystsAboutBlockedQueueRequest(input: {
    driverId: string;
    driverName?: string | null;
    vehicleType?: string | null;
    reason?: string | null;
  }) {
    const targets = await this.getAnalystNotificationTargets(input.driverId);
    if (!targets.length) return;

    const messageLines = [
      'Solicitacao de fila devido analise de DS.',
      `Motorista: ${input.driverName || input.driverId} (${input.driverId})`,
    ];

    if (input.vehicleType) {
      messageLines.push(`Veiculo: ${input.vehicleType}`);
    }

    if (input.reason) {
      messageLines.push(`Motivo: ${input.reason}`);
    }

    messageLines.push(`Horario: ${new Date().toLocaleString('pt-BR')}`);

    await Promise.allSettled(
      targets.map((target) =>
        this.telegram.sendMessage(target.telegramChatId, messageLines.join('\n')),
      ),
    );
  }

  private getBusinessBlockReasonLabel(reason?: string | null) {
    const normalized = String(reason || '').trim().toLowerCase();
    if (normalized.includes('novato') || normalized.includes('sem ds')) {
      return 'Acompanhamento das primeiras rotas';
    }
    if (!normalized) {
      return 'Nao informado';
    }
    return 'Acompanhamento de performance';
  }

  private parsePriorityScore(value: unknown): number {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
  }

  private async resolveChatPriorityScore(
    chatId: string,
    state?: DriverSession | null,
  ): Promise<number> {
    const current = state ?? (await this.getState(chatId));
    if (typeof current?.priorityScore === 'number') {
      return this.parsePriorityScore(current.priorityScore);
    }
    if (!current?.driverId) return 0;

    const driver = await this.drivers.findById(current.driverId);
    return this.parsePriorityScore(driver?.priorityScore);
  }

  private async logEvent(
    action: string,
    state?: DriverSession | null,
    details?: Record<string, string | number | undefined>,
  ) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const parts = [`[${time}]`, `acao=${action}`];

    if (state?.driverId) parts.push(`driverId=${state.driverId}`);
    if (state?.driverName) parts.push(`nome=${state.driverName}`);
    if (state?.vehicleType) parts.push(`veiculo=${state.vehicleType}`);

    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          parts.push(`${key}=${value}`);
        }
      });
    }

    if (
      state?.driverId &&
      ['solicitou_rotas', 'rotas_exibidas', 'rota_solicitada', 'rota_atribuida', 'rota_cancelada'].includes(action)
    ) {
      await this.prisma.auditLog.create({
        data: {
          entityType: 'ROUTE_REQUEST',
          entityId: `${state.driverId}:${now.getTime()}:${action}`,
          action,
          userId: state.driverId,
          userName: state.driverName || state.driverId,
          after: {
            driverId: state.driverId,
            driverName: state.driverName || null,
            vehicleType: state.vehicleType || null,
            happenedAt: now.toISOString(),
            ...(details || {}),
          },
        },
      });
      await this.redis.client().del(this.OVERVIEW_ROUTE_REQUESTS_CACHE_KEY);
      return;
    }

    const line = parts.join(' ');
    const key = this.logKey(now);
    const client = this.redis.client();
    await client.rpush(key, line);
    await client.ltrim(key, -500, -1);
  }

  private async driverAlreadyAssigned(driverId: string): Promise<boolean> {
    return this.routes.driverHasRoute(driverId);
  }

  private formatCurrentRouteMessage(route: {
    id?: string | null;
    atId?: string | null;
    gaiola?: string | null;
    cidade?: string | null;
    bairro?: string | null;
    routeDate?: string | null;
    shift?: string | null;
    requiredVehicleType?: string | null;
    assignmentSource?: string | null;
  }) {
    let message = `Você já possui uma rota ativa:
Gaiola: ${route.gaiola || '-'}
Data: ${route.routeDate || '-'}
Turno: ${route.shift || '-'}
Cidade: ${route.cidade || '-'}
Bairro: ${route.bairro || '-'}`;

    if (String(route.assignmentSource || '') === 'TELEGRAM_BOT') {
      message += '\n\nSe quiser cancelar esta solicitação, digite: 5';
    }

    return message;
  }

  private async showCurrentRoute(chatId: string, state: DriverSession) {
    if (!state.driverId) {
      await this.telegram.sendMessage(Number(chatId), 'Sessão expirada. Informe seu ID novamente.');
      await this.clearState(chatId);
      return;
    }

    const route = await this.routes.getCurrentRouteForDriver(state.driverId);
    if (!route) {
      await this.telegram.sendMessage(Number(chatId), 'Você não possui rota ativa no momento.');
      await this.sendMainMenu(Number(chatId));
      return;
    }

    await this.telegram.sendMessage(Number(chatId), this.formatCurrentRouteMessage(route));
    await this.sendMainMenu(Number(chatId));
  }

  private async cancelCurrentTelegramRoute(chatId: string, state: DriverSession) {
    if (!state.driverId) {
      await this.telegram.sendMessage(Number(chatId), 'Sessão expirada. Informe seu ID novamente.');
      await this.clearState(chatId);
      return;
    }

    const result = await this.routes.cancelTelegramRouteRequest(state.driverId);
    if (!result.ok) {
      if (result.reason === 'NO_ROUTE') {
        await this.telegram.sendMessage(Number(chatId), 'Você não possui rota ativa para cancelar.');
      } else {
        await this.telegram.sendMessage(
          Number(chatId),
          'Sua rota atual não foi solicitada pelo bot e não pode ser cancelada por aqui.',
        );
      }
      await this.sendMainMenu(Number(chatId));
      return;
    }

    await this.logEvent('rota_cancelada', state, {
      rota: result.route.atId || result.route.id,
    });
    await this.notifyAnalystsAboutRouteEvent({
      action: 'CANCELOU',
      driverId: state.driverId,
      driverName: state.driverName,
      vehicleType: state.vehicleType,
      routeLabel: result.route.gaiola || result.route.atId || result.route.id,
      atId: result.route.atId,
      bairro: result.route.bairro,
      cidade: result.route.cidade,
    });
    await this.telegram.sendMessage(
      Number(chatId),
      `Solicitação da rota ${result.route.gaiola || result.route.atId || result.route.id} cancelada com sucesso.

Ela já voltou a ficar disponível para outros motoristas.`,
    );
    await this.sendMainMenu(Number(chatId));
  }

  private async pickNextFromQueue(group: 'moto' | 'general'): Promise<string | null> {
    const client = this.redis.client();
    const queue = await client.lrange(this.queueListKey(group), 0, -1);
    const emptySinceKey = this.queueEmptySinceKey(group);
    if (!queue.length) {
      await client.del(emptySinceKey);
      return null;
    }

    const queueMeta = await Promise.all(
      queue.map(async (chatId, index) => {
        const state = await this.getState(chatId);
        return {
          chatId,
          index,
          score: await this.resolveChatPriorityScore(chatId, state),
          isFiorino: this.isFiorino(state?.vehicleType),
          blocklisted: await this.isChatBlocklisted(chatId, state),
        };
      }),
    );

    const regularMeta = queueMeta
      .filter((item) => !item.blocklisted)
      .sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
    const regularNext = regularMeta[0];
    if (regularNext) {
      await client.del(emptySinceKey);
      await client.lrem(this.queueListKey(group), 1, regularNext.chatId);
      await client.del(this.queueMarker(regularNext.chatId));
      return regularNext.chatId;
    }

    const blocklistedMeta = queueMeta
      .filter((item) => item.blocklisted)
      .sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
    const firstBlocklisted = blocklistedMeta[0];
    const emptySinceRaw = await client.get(emptySinceKey);
    const now = Date.now();
    if (!emptySinceRaw) {
      await client.set(emptySinceKey, String(now), 'EX', this.BLOCKLIST_WAIT_SECONDS * 6);
      return null;
    }

    const elapsed = now - Number(emptySinceRaw);
    if (Number.isNaN(elapsed) || elapsed < this.BLOCKLIST_WAIT_SECONDS * 1000) {
      return null;
    }

    await client.del(emptySinceKey);
    const next = firstBlocklisted.chatId;
    await client.lrem(this.queueListKey(group), 1, next);
    await client.del(this.queueMarker(next));
    return next;
  }

  private queueLockKey(group: 'moto' | 'general') {
    return `telegram:queue:lock:${group}`;
  }

  private async maintainQueueGroup(group: 'moto' | 'general') {
    const active = await this.redis.client().get(this.queueActiveKey(group));
    if (active) {
      await this.requeueExpiredActive(group);
      return;
    }

    await this.tryActivateWaitingQueue(group);
  }

  private async withQueueLock<T>(
    group: 'moto' | 'general',
    fn: () => Promise<T>,
  ): Promise<T> {
    const client = this.redis.client();
    const lockKey = this.queueLockKey(group);
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const locked = await client.set(lockKey, '1', 'EX', 5, 'NX');
      if (locked === 'OK') {
        try {
          return await fn();
        } finally {
          await client.del(lockKey);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return fn();
  }

  private async activateNextInQueue(
    group: 'moto' | 'general',
  ): Promise<string | null> {
    return this.withQueueLock(group, async () => {
      const client = this.redis.client();
      const next = await this.pickNextFromQueue(group);
      if (!next) return null;

      await this.setActiveQueueChat(group, next);
      return next;
    });
  }

  private async clearRouteTimeout(chatId: string) {
    await this.redis.client().del(this.routeTimeoutKey(chatId));
  }

  private async clearRouteDispatch(chatId: string) {
    await this.redis.client().del(this.routeDispatchKey(chatId));
  }

  private async sendQueueWaitingNotice(chatId: string) {
    const client = this.redis.client();
    const lock = await client.set(
      this.queueWaitNoticeKey(chatId),
      '1',
      'EX',
      8,
      'NX',
    );
    if (lock !== 'OK') return;
    await this.telegram.sendMessage(
      Number(chatId),
      'Você está na fila. Aguarde atendimento.',
    );
  }

  private async setActiveQueueChat(
    group: 'moto' | 'general',
    chatId: string,
  ) {
    const client = this.redis.client();
    await client.set(
      this.queueActiveKey(group),
      chatId,
      'EX',
      this.QUEUE_TTL,
    );
    await client.set(
      this.queueActiveMetaKey(group),
      JSON.stringify({
        chatId,
        startedAt: Date.now(),
      }),
      'EX',
      this.QUEUE_TTL * 2,
    );
  }

  private async setRouteTimeout(
    chatId: string,
    vehicleType: string | undefined,
    group: 'moto' | 'general',
  ) {
    const client = this.redis.client();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await client.set(this.routeTimeoutKey(chatId), token, 'EX', this.QUEUE_TTL);

    setTimeout(() => {
      void (async () => {
        const current = await client.get(this.routeTimeoutKey(chatId));
        if (current !== token) return;

        const active = await client.get(this.queueActiveKey(group));
        if (active !== chatId) {
          await client.del(this.routeTimeoutKey(chatId));
          return;
        }

        const state = await this.getState(chatId);
        if (!state || state.state !== DriverState.CHOOSING_ROUTE) {
          await client.del(this.routeTimeoutKey(chatId));
          return;
        }

        await client.del(this.routeTimeoutKey(chatId));
        await this.handleTimeout(chatId, state.vehicleType, group);
      })();
    }, this.QUEUE_TTL * 1000);
  }

  private async handleTimeout(
    chatId: string,
    vehicleType: string | undefined,
    group: 'moto' | 'general',
  ) {
    await this.releaseAndNotifyNext(group);
    const state = await this.getState(chatId);
    await this.clearState(chatId);
    await this.telegram.sendMessage(
      Number(chatId),
      'Atendimento encerrado automaticamente por falta de resposta.',
    );
    await this.logEvent('timeout_encerrado', state, {
      motivo: 'falta_resposta',
      veiculo: vehicleType,
    });
  }

  private async requeueExpiredActive(
    group: 'moto' | 'general',
  ): Promise<boolean> {
    const client = this.redis.client();
    const lockKey = `${this.ROUTE_TIMEOUT_LOCK_KEY}:${group}`;
    const locked = await client.set(lockKey, '1', 'EX', 5, 'NX');
    if (locked !== 'OK') return false;

    const metaRaw = await client.get(this.queueActiveMetaKey(group));
    if (!metaRaw) {
      await client.del(lockKey);
      return false;
    }

    const meta = JSON.parse(metaRaw) as {
      chatId: string;
      startedAt: number;
    };

    if (Date.now() - meta.startedAt < this.QUEUE_TTL * 1000) {
      await client.del(lockKey);
      return false;
    }

    await client.del(this.queueActiveMetaKey(group));
    await client.del(this.queueActiveKey(group));
    await this.clearRouteTimeout(meta.chatId);
    await client.del(lockKey);

    await this.handleTimeout(meta.chatId, undefined, group);
    return true;
  }

  private async notifyQueueNext(
    next: string,
    group: 'moto' | 'general',
    announce = true,
  ) {
    const state = await this.getState(next);
    if (!state?.vehicleType) {
      await this.clearState(next);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const client = this.redis.client();
    const lock = await client.set(
      this.routeDispatchKey(next),
      '1',
      'EX',
      this.QUEUE_TTL * 2,
      'NX',
    );
    if (lock !== 'OK') return;
    await client.del(this.queueWaitNoticeKey(next));

    if (announce) {
      await this.telegram.sendMessage(
        Number(next),
        'Sua vez chegou. Buscando rotas disponíveis...',
      );
    }
    await this.sendRoutes(next, state);
  }

  private async tryActivateWaitingQueue(group: 'moto' | 'general') {
    const active = await this.redis.client().get(this.queueActiveKey(group));
    if (active) return;

    const next = await this.activateNextInQueue(group);
    if (!next) return;
    await this.notifyQueueNext(next, group);
  }

  private async tryAcquireQueue(
    chatId: string,
    group: 'moto' | 'general',
  ): Promise<boolean> {
    const client = this.redis.client();
    const active = await client.get(this.queueActiveKey(group));
    if (active) {
      const expired = await this.requeueExpiredActive(group);
      if (!expired) return active === chatId;
    }

    const next = await this.activateNextInQueue(group);
    if (!next) return false;
    if (next !== chatId) {
      await this.notifyQueueNext(next, group);
      return false;
    }
    return true;
  }

  private async enqueue(
    chatId: string,
    vehicleType?: string,
    group: 'moto' | 'general' = 'general',
  ): Promise<number> {
    return this.withQueueLock(group, async () => {
      const client = this.redis.client();
      const marker = this.queueMarker(chatId);

      await client.expire(marker, this.QUEUE_TTL);

      const queue = await client.lrange(this.queueListKey(group), 0, -1);
      const isFiorino = this.isFiorino(vehicleType);
      const filtered = queue.filter((id) => id !== chatId);
      const rankedQueue = await Promise.all(
        filtered.map(async (id, index) => {
          const itemState = await this.getState(id);
          const score = await this.resolveChatPriorityScore(id, itemState);
          return {
            id,
            index,
            isFiorino: this.isFiorino(itemState?.vehicleType),
            score,
          };
        }),
      );

      const currentState = await this.getState(chatId);
      rankedQueue.push({
        id: chatId,
        index: Number.MAX_SAFE_INTEGER,
        isFiorino,
        score: await this.resolveChatPriorityScore(chatId, currentState),
      });

      rankedQueue.sort((a, b) => {
        if (a.isFiorino !== b.isFiorino) return a.isFiorino ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
      const nextQueue = rankedQueue.map((item) => item.id);

      await client.del(this.queueListKey(group));
      if (nextQueue.length)
        await client.rpush(this.queueListKey(group), ...nextQueue);
      await client.set(marker, '1', 'EX', this.QUEUE_TTL);

      const isBlocklisted = await this.isChatBlocklisted(chatId, currentState);
      if (!isBlocklisted) {
        await client.del(this.queueEmptySinceKey(group));
      }

      return nextQueue.indexOf(chatId) + 1;
    });
  }

  private async removeFromQueue(chatId: string, group: 'moto' | 'general') {
    const client = this.redis.client();
    await client.lrem(this.queueListKey(group), 0, chatId);
    await client.del(this.queueMarker(chatId));
  }

  private async releaseAndNotifyNext(group: 'moto' | 'general') {
    await this.withQueueLock(group, async () => {
      const client = this.redis.client();
      const active = await client.get(this.queueActiveKey(group));
      if (active) {
        await this.clearRouteDispatch(active);
      }

      await client.del(this.queueActiveKey(group));
      await client.del(this.queueActiveMetaKey(group));

      const next = await this.pickNextFromQueue(group);
      if (!next) return;

      await this.setActiveQueueChat(group, next);

      await this.notifyQueueNext(next, group);
    });
  }

  /* =======================
      MENUS
  ======================== */

  private async sendMainMenu(chatId: number) {
    await this.telegram.sendMessage(
      chatId,
      `Menu principal:
encerrar - Encerrar atendimento
1 - Ver rotas disponíveis
2 - Dúvidas frequentes
3 - Falar com analista
4 - Consultar minha rota
5 - Cancelar solicitação da rota`,
    );
  }

  private normalizeCommand(text: string) {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .split(/\s+/)[0];
  }

  private nextFaqOption(current: number) {
    const next = current + 1;
    return next === 9 ? 10 : next;
  }

  private async getDynamicHelp() {
    const items = await this.prisma.faqItem.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 50,
    });

    if (!items.length) {
      const menu = `Dúvidas frequentes:
Digite "encerrar" para encerrar atendimento
Digite "voltar" para voltar.

No momento, não há dúvidas cadastradas.
Peça ao analista para cadastrar em /acess/duvidas.
`;
      return { menu, answers: {} as Record<string, string> };
    }

    let option = 0;
    const answers: Record<string, string> = {};
    const lines = ['Dúvidas frequentes:', 'encerrar - Encerrar atendimento'];

    for (const item of items) {
      option = this.nextFaqOption(option);
      const key = String(option);
      lines.push(`${key} - ${item.title}`);
      answers[key] = item.answer;
    }

    lines.push('Digite "voltar" para voltar.');
    return { menu: `${lines.join('\n')}\n`, answers };
  }

  private buildSupportProtocol(chatId: string) {
    const suffix = String(Date.now()).slice(-8);
    const chatSuffix = String(chatId).slice(-4);
    return `ATD-${suffix}-${chatSuffix}`;
  }

  private normalizeTelegramChatId(value: unknown): number | null {
    const normalized = String(value ?? '').trim();
    if (!/^-?\d+$/.test(normalized)) return null;
    const chatId = Number(normalized);
    return Number.isSafeInteger(chatId) ? chatId : null;
  }

  private async getAnalystNotificationTargets(driverId: string) {
    const prisma = this.prisma as any;
    const [driver, analysts] = await Promise.all([
      prisma.driver.findUnique({
        where: { id: driverId },
        select: { hubId: true },
      }),
      prisma.analyst.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          role: true,
          hubId: true,
          telegramChatId: true,
        },
      }),
    ]);

    const withChat = analysts
      .map((analyst) => ({
        ...analyst,
        telegramChatId: this.normalizeTelegramChatId(analyst.telegramChatId),
      }))
      .filter(
        (
          analyst,
        ): analyst is {
          id: string;
          name: string;
          role: string;
          hubId: string | null;
          telegramChatId: number;
        } => analyst.telegramChatId !== null,
      );

    const prioritized = withChat.filter(
      (analyst) =>
        analyst.hubId === driver?.hubId ||
        analyst.role === 'ADMIN' ||
        analyst.role === 'SUPERVISOR',
    );

    return prioritized.length ? prioritized : withChat;
  }

  private async notifyAnalystsAboutRouteEvent(input: {
    action: 'SOLICITOU' | 'CANCELOU';
    driverId: string;
    driverName?: string | null;
    vehicleType?: string | null;
    routeLabel: string;
    atId?: string | null;
    bairro?: string | null;
    cidade?: string | null;
  }) {
    const targets = await this.getAnalystNotificationTargets(input.driverId);
    if (!targets.length) return;

    const messageLines = [
      'Atualizacao de rota',
      `Acao: ${input.action}`,
      `Motorista: ${input.driverName || input.driverId} (${input.driverId})`,
    ];

    if (input.vehicleType) {
      messageLines.push(`Veiculo: ${input.vehicleType}`);
    }

    messageLines.push(`Rota: ${input.routeLabel}`);

    if (input.atId) {
      messageLines.push(`AT: ${input.atId}`);
    }

    if (input.bairro || input.cidade) {
      messageLines.push(
        `Local: ${input.cidade || '-'}${input.bairro ? ` | ${input.bairro}` : ''}`,
      );
    }

    messageLines.push(`Horario: ${new Date().toLocaleString('pt-BR')}`);

    await Promise.allSettled(
      targets.map((target) =>
        this.telegram.sendMessage(target.telegramChatId, messageLines.join('\n')),
      ),
    );
  }

  private async ensureSupportHub(driverId: string) {
    const prisma = this.prisma as any;
    await prisma.hub.upsert({
      where: { id: 'hub-sp' },
      create: {
        id: 'hub-sp',
        name: 'Hub Sao Paulo',
        timezone: 'America/Sao_Paulo',
      },
      update: {},
    });

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, hubId: true },
    });
    if (!driver) return null;

    if (!driver.hubId) {
      await prisma.driver.update({
        where: { id: driver.id },
        data: { hubId: 'hub-sp' },
      });
    }

    return {
      id: driver.id,
      name: driver.name || driver.id,
      hubId: driver.hubId || 'hub-sp',
    };
  }

  private async createOrResumeSupportTicket(chatId: string, state: DriverSession) {
    if (!state.driverId) return null;

    const prisma = this.prisma as any;
    const driver = await this.ensureSupportHub(state.driverId);
    if (!driver) return null;

    const existing = await prisma.supportTicket.findFirst({
      where: {
        driverId: driver.id,
        status: { in: ['WAITING_ANALYST', 'IN_PROGRESS', 'WAITING_DRIVER'] },
      },
      orderBy: { waitingSince: 'desc' },
    });

    if (existing) {
      return { ticket: existing, created: false };
    }

    const queuePosition =
      (await prisma.supportTicket.count({
        where: {
          hubId: driver.hubId,
          status: 'WAITING_ANALYST',
        },
      })) + 1;

    const ticket = await prisma.supportTicket.create({
      data: {
        protocol: this.buildSupportProtocol(chatId),
        driverId: driver.id,
        hubId: driver.hubId,
        status: 'WAITING_ANALYST',
        queuePosition,
        waitingSince: new Date(),
      },
    });

    await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: 'DRIVER',
        authorId: null,
        authorName: state.driverName || driver.name,
        body: 'Motorista solicitou falar com analista pelo bot do Telegram.',
        telegramText: 'Motorista solicitou falar com analista pelo bot do Telegram.',
      },
    });

    return { ticket, created: true };
  }

  private async appendDriverSupportMessage(
    ticketId: string,
    text: string,
    state: DriverSession,
  ) {
    const prisma = this.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket || ticket.status === 'CLOSED') {
      return null;
    }

    const created = await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: 'DRIVER',
        authorId: null,
        authorName: state.driverName || state.driverId || 'Motorista',
        body: text,
        telegramText: text,
      },
    });

    if (ticket.status === 'WAITING_DRIVER') {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: 'IN_PROGRESS',
        },
      });
    }

    return created;
  }

  private async closeSupportTicket(ticketId?: string) {
    if (!ticketId) return;

    const prisma = this.prisma as any;
    await prisma.supportTicket.updateMany({
      where: {
        id: ticketId,
        status: { in: ['WAITING_ANALYST', 'IN_PROGRESS', 'WAITING_DRIVER'] },
      },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
  }

  private async isSupportTicketStillOpen(ticketId?: string) {
    if (!ticketId) return false;

    const prisma = this.prisma as any;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });

    return ['WAITING_ANALYST', 'IN_PROGRESS', 'WAITING_DRIVER'].includes(
      String(ticket?.status || ''),
    );
  }

  /* =======================
      ROTAS
  ======================== */

  private async sendRoutes(chatId: string, state: DriverSession) {
    if (!state.driverId || !state.vehicleType) {
      await this.telegram.sendMessage(
        Number(chatId),
        'Sessão expirada. Informe seu ID novamente.',
      );
      await this.clearState(chatId);
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const isBlocklisted = await this.isChatBlocklisted(chatId, state);
    if (isBlocklisted && !state.blockedQueueApproved) {
      const requestState = await this.createOrRefreshBlockedQueueRequest(chatId, state);
      if (requestState.cooldownActive) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Converse com um analista para verificar as rotas disponiveis.',
        );
      } else {
        if (requestState.created) {
          await this.notifyAnalystsAboutBlockedQueueRequest({
            driverId: state.driverId,
            driverName: state.driverName,
            vehicleType: state.vehicleType,
            reason: requestState.request?.blockReason || null,
          });
        }
        await this.telegram.sendMessage(
          Number(chatId),
          `Sua entrada na fila precisa de validacao da analista.\nMotivo: ${this.getBusinessBlockReasonLabel(requestState.request?.blockReason)}\n\nAguarde a analise.`,
        );
      }
      await this.setState(chatId, {
        ...state,
        state: DriverState.MENU,
        inQueue: false,
        blockedQueueApproved: false,
      });
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      await this.sendMainMenu(Number(chatId));
      return;
    }

    const routes = await this.routes.getAvailableRoutesForDriver(state.vehicleType);
    const sorted = sortRoutes(routes);

    if (!sorted.length) {
      await this.telegram.sendMessage(Number(chatId), NO_ROUTES_AVAILABLE);
      await this.sendMainMenu(Number(chatId));
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const moto = sortRoutes(
      sorted.filter((r) =>
        (r.vehicleType || '').toLowerCase().includes('moto'),
      ),
    );
    const nonMoto = sortRoutes(
      sorted.filter(
        (r) => !(r.vehicleType || '').toLowerCase().includes('moto'),
      ),
    );

    const ordered = [...nonMoto, ...moto];

    await this.setState(chatId, {
      ...state,
      state: DriverState.CHOOSING_ROUTE,
      availableRoutes: ordered,
      inQueue: false,
    });

    const normalizeCity = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const incentiveCities = new Set(['vianopolis', 'abadiania']);
    const routesNote = (await this.redis.get<string>(this.ROUTES_NOTE_KEY)) || '';

    let msg = `Olá, ${state.driverName} 👋
Escolha a rota desejada digitando o número:
Veículo: ${state.vehicleType}
DS: ${state.ds || '-'} (DS = taxa de pacotes entregues)
Para encerrar, digite: "encerrar"
`;
    if (routesNote.trim()) {
      msg += `\n📢 Informações do dia:\n${routesNote.trim()}\n`;
    }

    const pushCityGroups = (title: string, list: typeof ordered) => {
      if (!list.length) return;
      msg += `\n━━━━━━━━━━━━━━\n${title} (${list.length})\n━━━━━━━━━━━━━━\n`;

      const byCity = new Map<string, typeof ordered>();
      list.forEach((route) => {
        const city = (route.cidade || 'Sem cidade').trim() || 'Sem cidade';
        const current = byCity.get(city) || [];
        current.push(route);
        byCity.set(city, current);
      });

      const cityNames = Array.from(byCity.keys()).sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      );

      cityNames.forEach((city) => {
        const hasIncentive = incentiveCities.has(normalizeCity(city));
        msg += `\n📍 ${city}${hasIncentive ? ' | +R$45 incentivo' : ''}\n`;
        const cityRoutes = byCity.get(city) || [];
        cityRoutes.forEach((r) => {
          const index = ordered.indexOf(r);
          msg += `${index + 1}. ${r.bairro || 'Sem bairro'}\n`;
        });
      });
    };

    pushCityGroups('', nonMoto);
    pushCityGroups('Rotas de moto', moto);

    await this.telegram.sendMessage(Number(chatId), msg);
    await this.logEvent('rotas_exibidas', state, {
      qtd: String(ordered.length),
      rotas: ordered.map((route) => route.atId).join(','),
    });
    const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
    await this.setRouteTimeout(chatId, state.vehicleType, group);
  }

  /* =======================
      WEBHOOK
  ======================== */

  @Post()
  async onUpdate(@Body() body: any) {
    const message = body.message;
    if (!message?.text) return { ok: true };

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const command = this.normalizeCommand(text);

    if (command === '/meuchatid') {
      await this.telegram.sendMessage(
        Number(chatId),
        `Seu Telegram Chat ID e:\n${chatId}\n\nUse esse valor no campo "Telegram Chat ID" do usuario no painel.`,
      );
      return { ok: true };
    }

    if (text === '/sync' || text === '/atualizar_dados') {
      if (await this.sync.isLocked()) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atualização em andamento. Aguarde alguns minutos.',
        );
        return { ok: true };
      }
      await this.sync.setPending(chatId, 'all');
      await this.telegram.sendMessage(
        Number(chatId),
        'Informe a senha para sincronizar.',
      );
      return { ok: true };
    }

    if (text === '/syncDriver' || text === '/syncdriver') {
      if (await this.sync.isLocked()) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atualização em andamento. Aguarde alguns minutos.',
        );
        return { ok: true };
      }
      await this.sync.setPending(chatId, 'drivers');
      await this.telegram.sendMessage(
        Number(chatId),
        'Informe a senha para sincronizar.',
      );
      return { ok: true };
    }

    const pendingType = await this.sync.getPendingType(chatId);
    if (pendingType) {
      if (!this.sync.isPasswordValid(text)) {
        await this.sync.clearPending(chatId);
        await this.telegram.sendMessage(Number(chatId), 'Senha inválida.');
        return { ok: true };
      }

      await this.sync.clearPending(chatId);
      // await this.telegram.sendMessage(
      //   Number(chatId),
      //   'Atualização em andamento. Aguarde alguns minutos.',
      // );

      try {
        if (pendingType === 'drivers') {
          const drivers = await this.sync.syncDriversScheduled();
          await this.telegram.sendMessage(
            Number(chatId),
            `✅ Motoristas atualizados com sucesso.\nMotoristas: ${drivers}`,
          );
        } else {
          const summary = await this.sync.syncAll();
          await this.telegram.sendMessage(
            Number(chatId),
            `✅ Dados atualizados com sucesso.\nMotoristas: ${summary.drivers}\nRotas disponíveis: ${summary.routesAvailable}\nRotas atribuídas: ${summary.routesAssigned}`,
          );
        }
      } catch (error) {
        await this.telegram.sendMessage(
          Number(chatId),
          `Erro ao sincronizar: ${(error as Error).message}`,
        );
      }
      return { ok: true };
    }

    if (await this.sync.isLocked()) {
      await this.telegram.sendMessage(
        Number(chatId),
        'Atualização em andamento. Aguarde alguns minutos.',
      );
      return { ok: true };
    }

    if (text.startsWith('/logdiario')) {
      const key = this.logKey();
      const logs = await this.redis.client().lrange(key, 0, -1);
      if (!logs.length) {
        await this.telegram.sendMessage(Number(chatId), 'Sem logs para hoje.');
        return { ok: true };
      }

      let chunk = '';
      for (const line of logs) {
        if (chunk.length + line.length + 1 > 3500) {
          await this.telegram.sendMessage(Number(chatId), chunk);
          chunk = '';
        }
        chunk += `${line}\n`;
      }
      if (chunk.trim().length) {
        await this.telegram.sendMessage(Number(chatId), chunk.trim());
      }
      return { ok: true };
    }

    let state = await this.getState(chatId);
    if (command === 'encerrar' && state?.inQueue) {
      const group = state.queueGroup || 'general';
      await this.removeFromQueue(chatId, group);
      await this.clearState(chatId);
      await this.telegram.sendMessage(
        Number(chatId),
        'Atendimento encerrado.',
      );
      return { ok: true };
    }
    if (state?.inQueue) {
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (canStart) {
        await this.notifyQueueNext(chatId, group, false);
        return { ok: true };
      }

      await this.sendQueueWaitingNotice(chatId);
      return { ok: true };
    }

    /* ===== INÍCIO ===== */
    if (!state) {
      await this.setState(chatId, { state: DriverState.WAITING_ID });
      await this.telegram.sendMessage(
        Number(chatId),
        'Olá 👋\nInforme seu ID de motorista.',
      );
      return { ok: true };
    }

    /* ===== ESPERANDO ID ===== */
    if (state.state === DriverState.WAITING_ID) {
      const driverId = text.trim();
      if (!/^\d+$/.test(driverId)) {
        await this.telegram.sendMessage(Number(chatId), 'ID inválido.');
        return { ok: true };
      }

      const driver = await this.drivers.findById(driverId);
      if (!driver) {
        await this.telegram.sendMessage(Number(chatId), 'ID não encontrado.');
        return { ok: true };
      }

      await this.setState(chatId, {
        state: DriverState.MENU,
        driverId: driver.id,
        driverName: driver.name || '',
        vehicleType: driver.vehicleType || '',
        ds: driver.ds || '',
        priorityScore: this.parsePriorityScore(driver.priorityScore),
        queueGroup: this.queueGroupFromVehicle(driver.vehicleType || undefined),
      });

      await this.telegram.sendMessage(
        Number(chatId),
        `Olá, ${driver.name || 'motorista'}!`,
      );
      await this.sendMainMenu(Number(chatId));
      return { ok: true };
    }

    /* ===== MENU ===== */
    if (state.state === DriverState.MENU) {
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (text === '4') {
        await this.showCurrentRoute(chatId, state);
        return { ok: true };
      }

      if (text === '5') {
        await this.cancelCurrentTelegramRoute(chatId, state);
        return { ok: true };
      }

      if (text === '2') {
        await this.setState(chatId, { ...state, state: DriverState.HELP_MENU });
        const help = await this.getDynamicHelp();
        await this.telegram.sendMessage(Number(chatId), help.menu);
        return { ok: true };
      }

      if (text === '3' || command === 'falar' || command === 'analista') {
        const support = await this.createOrResumeSupportTicket(chatId, state);
        if (!support) {
          await this.telegram.sendMessage(
            Number(chatId),
            'Nao foi possivel abrir atendimento com analista agora.',
          );
          await this.sendMainMenu(Number(chatId));
          return { ok: true };
        }

        await this.setState(chatId, {
          ...state,
          state: DriverState.SUPPORT_CHAT,
          supportTicketId: support.ticket.id,
        });
        await this.logEvent('solicitou_analista', state, {
          protocolo: support.ticket.protocol,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          support.created
            ? `Seu atendimento foi aberto com sucesso.\nProtocolo: ${support.ticket.protocol}\n\nEscreva sua mensagem para o analista.\nPara encerrar, digite: encerrar`
            : `Voce ja possui um atendimento em aberto.\nProtocolo: ${support.ticket.protocol}\n\nEscreva sua mensagem para continuar a conversa.\nPara encerrar, digite: encerrar`,
        );
        return { ok: true };
      }

      if (text !== '1') {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      await this.logEvent('solicitou_rotas', state, { chatId });

      const hasRoute = await this.driverAlreadyAssigned(state.driverId!);
      if (hasRoute) {
        const route = await this.routes.getCurrentRouteForDriver(state.driverId!);
        if (route) {
          await this.telegram.sendMessage(
            Number(chatId),
            this.formatCurrentRouteMessage(route),
          );
        } else {
          await this.telegram.sendMessage(
            Number(chatId),
            'Você já possui rota solicitada no turno atual. O bot não realiza trocas.',
          );
        }
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const isBlocklisted = await this.isChatBlocklisted(chatId, state);
      if (isBlocklisted && !state.blockedQueueApproved) {
        const queueRequest = await this.getBlockedQueueRequest(state.driverId!);
        if (String(queueRequest?.status || '') !== 'APPROVED') {
          const requestState = await this.createOrRefreshBlockedQueueRequest(chatId, state);
          if (requestState.cooldownActive) {
            await this.telegram.sendMessage(
              Number(chatId),
              'A rota não esta disponivel. Para verificar, fale com um dos analistas.',
            );
          } else {
            if (requestState.created) {
              await this.notifyAnalystsAboutBlockedQueueRequest({
                driverId: state.driverId!,
                driverName: state.driverName,
                vehicleType: state.vehicleType,
                reason: requestState.request?.blockReason || null,
              });
            }
            await this.telegram.sendMessage(
              Number(chatId),
              `Sua entrada na fila precisa de validacao da analista.\nMotivo: ${this.getBusinessBlockReasonLabel(requestState.request?.blockReason)}\n\nAguarde a analise.`,
            );
          }
          await this.sendMainMenu(Number(chatId));
          return { ok: true };
        }
        state = {
          ...state,
          blockedQueueApproved: true,
        };
        await this.setState(chatId, state);
      }

      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (!canStart) {
        await this.setState(chatId, {
          ...state,
          inQueue: true,
          queueGroup: group,
        });
        await this.sendQueueWaitingNotice(chatId);
        return { ok: true };
      }

      await this.notifyQueueNext(chatId, group, false);
      return { ok: true };
    }

    /* ===== ESCOLHA DE ROTA ===== */
    if (state.state === DriverState.CHOOSING_ROUTE) {
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      const timeoutToken = await this.redis.client().get(this.routeTimeoutKey(chatId));
      if (!timeoutToken) {
        await this.handleTimeout(chatId, state.vehicleType, group);
        return { ok: true };
      }

      await this.clearRouteTimeout(chatId);
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        await this.releaseAndNotifyNext(group);
        return { ok: true };
      }

      const choice = Number(text) - 1;
      const routes = state.availableRoutes || [];

      if (isNaN(choice) || !routes[choice]) {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      const route = routes[choice];
      const alreadyAssigned = await this.driverAlreadyAssigned(state.driverId!);
      if (alreadyAssigned) {
        const currentRoute = await this.routes.getCurrentRouteForDriver(state.driverId!);
        await this.telegram.sendMessage(
          Number(chatId),
          currentRoute
            ? this.formatCurrentRouteMessage(currentRoute)
            : 'Você já possui rota solicitada. O bot não realiza trocas.',
        );
        await this.setState(chatId, { ...state, state: DriverState.MENU });
        await this.releaseAndNotifyNext(group);
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const ok = await this.routes.assignRoute(route.routeId, state.driverId!);

      if (!ok) {
        await this.telegram.sendMessage(Number(chatId), 'Rota indisponível.');
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `✅ Rota ${route.gaiola || route.atId} solicitada com sucesso.

Sua solicitação foi enviada para validação do analista.

Como pegar a rota:
1. Aguarde a confirmação do analista.
2. Após confirmar, siga o dia/horário de carregamento informado.
3. Em caso de dúvida, responda esta conversa para suporte.`,
      );
      await this.logEvent('rota_solicitada', state, { rota: route.atId });
      await this.notifyAnalystsAboutRouteEvent({
        action: 'SOLICITOU',
        driverId: state.driverId!,
        driverName: state.driverName,
        vehicleType: state.vehicleType,
        routeLabel: route.gaiola || route.atId || route.routeId,
        atId: route.atId,
        bairro: route.bairro,
        cidade: route.cidade,
      });

      try {
        await this.sheets.updateAssignmentRequest(route.routeId, state.driverId!);
      } catch (error) {
        await this.logEvent('sheet_update_failed', state, {
          rota: route.atId,
        });
      }

      await this.clearState(chatId);
      await this.releaseAndNotifyNext(group);
      await this.telegram.sendMessage(
        Number(chatId),
        'Atendimento encerrado automaticamente após a solicitação da rota.',
      );
      return { ok: true };
    }

    /* ===== ATENDIMENTO HUMANO ===== */
    if (state.state === DriverState.SUPPORT_CHAT) {
      if (command === 'encerrar') {
        await this.closeSupportTicket(state.supportTicketId);
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          supportTicketId: undefined,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento com analista encerrado.',
        );
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      if (state.supportTicketId && !(await this.isSupportTicketStillOpen(state.supportTicketId))) {
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          supportTicketId: undefined,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          'Seu atendimento com o analista ja foi encerrado. Se precisar, escolha novamente a opcao 3 - Falar com analista.',
        );
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      let ticketId = state.supportTicketId;
      if (!ticketId) {
        const support = await this.createOrResumeSupportTicket(chatId, state);
        ticketId = support?.ticket.id;
      }

      if (!ticketId) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Nao foi possivel registrar sua mensagem no atendimento.',
        );
        return { ok: true };
      }

      const created = await this.appendDriverSupportMessage(ticketId, text, state);
      if (!created) {
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          supportTicketId: undefined,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          'Seu atendimento com o analista foi encerrado. Para abrir um novo atendimento, escolha novamente a opcao 3 - Falar com analista.',
        );
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        'Mensagem enviada para o analista. Aguarde o retorno por aqui.',
      );
      return { ok: true };
    }

    /* ===== AJUDA ===== */
    if (state.state === DriverState.HELP_MENU) {
      if (command === 'encerrar') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (command === 'voltar') {
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          inQueue: false,
        });
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const help = await this.getDynamicHelp();
      const answer = help.answers[text];
      if (!answer) {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.telegram.sendMessage(Number(chatId), help.menu);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `${answer}\n\n${help.menu}`,
      );
      return { ok: true };
    }

    return { ok: true };
  }
}
