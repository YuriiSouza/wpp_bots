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
import {
  HELP_ANSWERS,
  HELP_MENU,
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
  private readonly ROUTE_TIMEOUT_LOCK_KEY = 'telegram:route:timeout:lock';
  private readonly LOG_PREFIX = 'telegram:log';

  private timeoutWatcher?: NodeJS.Timeout;

  constructor(
    private readonly telegram: TelegramService,
    private readonly drivers: DriverService,
    private readonly routes: RouteService,
    private readonly redis: RedisService,
    private readonly sync: SyncService,
    private readonly sheets: SheetsService,
  ) {}

  /* =======================
      Helpers Redis
  ======================== */

  private stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  private async getState(chatId: string): Promise<DriverSession | null> {
    return this.redis.get<DriverSession>(this.stateKey(chatId));
  }

  private async setState(chatId: string, state: DriverSession) {
    await this.redis.set(this.stateKey(chatId), state, this.STATE_TTL);
  }

  private async clearState(chatId: string) {
    await this.redis.del(this.stateKey(chatId));
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

  private logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  onModuleInit() {
    this.timeoutWatcher = setInterval(() => {
      void this.requeueExpiredActive('general');
      void this.requeueExpiredActive('moto');
    }, 5000);
  }

  onModuleDestroy() {
    if (this.timeoutWatcher) clearInterval(this.timeoutWatcher);
  }

  /* =======================
      FILA
  ======================== */

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

    const line = parts.join(' ');
    const key = this.logKey(now);
    const client = this.redis.client();
    await client.rpush(key, line);
    await client.ltrim(key, -500, -1);
  }

  private async pickNextFromQueue(group: 'moto' | 'general'): Promise<string | null> {
    const client = this.redis.client();
    const queue = await client.lrange(this.queueListKey(group), 0, -1);
    if (!queue.length) return null;

    const next = queue[0];
    await client.lrem(this.queueListKey(group), 1, next);
    await client.del(this.queueMarker(next));
    return next;
  }

  private queueLockKey(group: 'moto' | 'general') {
    return `telegram:queue:lock:${group}`;
  }

  private async withQueueLock<T>(
    group: 'moto' | 'general',
    fn: () => Promise<T>,
  ): Promise<T> {
    const client = this.redis.client();
    const lockKey = this.queueLockKey(group);
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const locked = await client.setnx(lockKey, '1');
      if (locked === 1) {
        await client.expire(lockKey, 5);
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

      await client.set(
        this.queueActiveKey(group),
        next,
        'EX',
        this.QUEUE_TTL,
      );
      await client.set(
        this.queueActiveMetaKey(group),
        JSON.stringify({
          chatId: next,
          startedAt: Date.now(),
        }),
        'EX',
        this.QUEUE_TTL * 2,
      );
      return next;
    });
  }

  private async clearRouteTimeout(chatId: string) {
    await this.redis.client().del(this.routeTimeoutKey(chatId));
  }

  private async refreshActiveMeta(
    chatId: string,
    group: 'moto' | 'general',
  ) {
    const client = this.redis.client();
    await client.set(
      this.queueActiveMetaKey(group),
      JSON.stringify({
        chatId,
        startedAt: Date.now(),
      }),
      'EX',
      this.QUEUE_TTL * 2,
    );
    await client.expire(this.queueActiveKey(group), this.QUEUE_TTL);
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
    const queueVehicle = state?.vehicleType || vehicleType;
    const queueGroup = state?.queueGroup || group;
    const pos = await this.enqueue(chatId, queueVehicle, queueGroup);
    if (state) {
      await this.setState(chatId, {
        ...state,
        state: DriverState.MENU,
        availableRoutes: undefined,
        inQueue: true,
        queueGroup,
      });
    }
    await this.telegram.sendMessage(
      Number(chatId),
      `Atendimento encerrado por falta de resposta. Você voltou para o final da fila. Posição: ${pos}`,
    );
    await this.logEvent('timeout', state, { position: pos });
  }

  private async requeueExpiredActive(
    group: 'moto' | 'general',
  ): Promise<boolean> {
    const client = this.redis.client();
    const lockKey = `${this.ROUTE_TIMEOUT_LOCK_KEY}:${group}`;
    const locked = await client.setnx(lockKey, '1');
    if (locked !== 1) return false;
    await client.expire(lockKey, 5);

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

  private async notifyQueueNext(next: string, group: 'moto' | 'general') {
    const state = await this.getState(next);
    if (!state?.vehicleType) {
      await this.clearState(next);
      await this.releaseAndNotifyNext(group);
      return;
    }

    await this.telegram.sendMessage(
      Number(next),
      'Sua vez chegou. Buscando rotas disponíveis...',
    );
    await this.sendRoutes(next, state);
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
      const alreadyIndex = queue.indexOf(chatId);
      const isFiorino = this.isFiorino(vehicleType);
      if (alreadyIndex >= 0 && !isFiorino) {
        await client.set(marker, '1', 'EX', this.QUEUE_TTL);
        return alreadyIndex + 1;
      }

      const filtered = queue.filter((id) => id !== chatId);

      const fiorinoQueue: string[] = [];
      const otherQueue: string[] = [];

      for (const id of filtered) {
        const state = await this.getState(id);
        if (this.isFiorino(state?.vehicleType)) fiorinoQueue.push(id);
        else otherQueue.push(id);
      }

      const nextQueue = isFiorino
        ? [...fiorinoQueue, chatId, ...otherQueue]
        : [...fiorinoQueue, ...otherQueue, chatId];

      await client.del(this.queueListKey(group));
      if (nextQueue.length)
        await client.rpush(this.queueListKey(group), ...nextQueue);
      await client.set(marker, '1', 'EX', this.QUEUE_TTL);

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

      await client.del(this.queueActiveKey(group));
      await client.del(this.queueActiveMetaKey(group));

      const next = await this.pickNextFromQueue(group);
      if (!next) return;

      await client.set(
        this.queueActiveKey(group),
        next,
        'EX',
        this.QUEUE_TTL,
      );

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
0 - Encerrar atendimento
1 - Ver rotas disponíveis
2 - Dúvidas frequentes`,
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

    const routes = await this.routes.getAvailableRoutesForDriver(state.vehicleType);
    const sorted = sortRoutes(routes);

    if (!sorted.length) {
      await this.telegram.sendMessage(Number(chatId), NO_ROUTES_AVAILABLE);
      await this.sendMainMenu(Number(chatId));
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      return;
    }

    const fiorino = sortRoutes(
      sorted.filter((r) =>
        (r.vehicleType || '').toLowerCase().includes('fiorino'),
      ),
    );
    const passeio = sortRoutes(
      sorted.filter((r) =>
        (r.vehicleType || '').toLowerCase().includes('passeio'),
      ),
    );
    const moto = sortRoutes(
      sorted.filter((r) =>
        (r.vehicleType || '').toLowerCase().includes('moto'),
      ),
    );
    const others = sorted.filter(
      (r) =>
        !fiorino.includes(r) &&
        !passeio.includes(r) &&
        !moto.includes(r),
    );

    const ordered = [...fiorino, ...passeio, ...moto, ...others];

    await this.setState(chatId, {
      ...state,
      state: DriverState.CHOOSING_ROUTE,
      availableRoutes: ordered,
      inQueue: false,
    });

    let msg = `Olá, ${state.driverName} 👋
Escolha a rota desejada:

Veículo: ${state.vehicleType}

0 - Encerrar atendimento

`;

    const pushGroup = (title: string, list: typeof ordered) => {
      if (!list.length) return;
      msg += `${title}\n`;
      list.forEach((r) => {
        const index = ordered.indexOf(r);
        msg += `${index + 1} - ${r.bairro} | ${r.cidade}\n`;
      });
      msg += '\n';
    };

    pushGroup('Fiorino', fiorino);
    pushGroup('Passeio', passeio);
    pushGroup('Moto', moto);
    if (others.length) pushGroup('Outros', others);

    await this.telegram.sendMessage(Number(chatId), msg);
    const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
    await this.refreshActiveMeta(chatId, group);
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

    if (text === '/sync' || text === '/atualizar_dados') {
      if (await this.sync.isLocked()) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atualização em andamento. Aguarde alguns minutos.',
        );
        return { ok: true };
      }
      await this.sync.setPending(chatId);
      await this.telegram.sendMessage(
        Number(chatId),
        'Informe a senha para sincronizar.',
      );
      return { ok: true };
    }

    if (await this.sync.isPending(chatId)) {
      if (!this.sync.isPasswordValid(text)) {
        await this.sync.clearPending(chatId);
        await this.telegram.sendMessage(Number(chatId), 'Senha inválida.');
        return { ok: true };
      }

      await this.sync.clearPending(chatId);
      await this.telegram.sendMessage(
        Number(chatId),
        'Atualização em andamento. Aguarde alguns minutos.',
      );

      try {
        const summary = await this.sync.syncAll();
        await this.telegram.sendMessage(
          Number(chatId),
          `✅ Dados atualizados com sucesso.\nMotoristas: ${summary.drivers}\nRotas disponíveis: ${summary.routesAvailable}\nRotas atribuídas: ${summary.routesAssigned}`,
        );
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
    if (text === '0' && state?.inQueue) {
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
      const pos = await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (canStart) {
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `Você entrou na fila. Posição: ${pos}`,
      );
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
      if (text === '0') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (text === '2') {
        await this.setState(chatId, { ...state, state: DriverState.HELP_MENU });
        await this.telegram.sendMessage(Number(chatId), HELP_MENU);
        return { ok: true };
      }

      if (text !== '1') {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      await this.logEvent('solicitou_rotas', state, { chatId });

      const hasRoute = await this.routes.driverHasRoute(state.driverId!);
      if (hasRoute) {
        await this.telegram.sendMessage(
          Number(chatId),
          `Você já possui rota atribuída. O bot não realiza trocas.
        Atendimento encerrado.
          `,
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      const pos = await this.enqueue(chatId, state.vehicleType, group);
      const canStart = await this.tryAcquireQueue(chatId, group);
      if (!canStart) {
        await this.setState(chatId, {
          ...state,
          inQueue: true,
          queueGroup: group,
        });
        await this.telegram.sendMessage(
          Number(chatId),
          `Você entrou na fila. Posição: ${pos}`,
        );
        return { ok: true };
      }

      await this.sendRoutes(chatId, state);
      return { ok: true };
    }

    /* ===== ESCOLHA DE ROTA ===== */
    if (state.state === DriverState.CHOOSING_ROUTE) {
      await this.clearRouteTimeout(chatId);
      if (text === '0') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
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
      const alreadyAssigned = await this.routes.driverHasRoute(state.driverId!);
      if (alreadyAssigned) {
        await this.telegram.sendMessage(
          Number(chatId),
          'Você já possui rota atribuída. O bot não realiza trocas.',
        );
        await this.setState(chatId, { ...state, state: DriverState.MENU });
        const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
        await this.releaseAndNotifyNext(group);
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const ok = await this.routes.assignRoute(route.atId, state.driverId!);

      if (!ok) {
        await this.telegram.sendMessage(Number(chatId), 'Rota indisponível.');
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `Rota ${route.gaiola} atribuída com sucesso.`,
      );
      await this.logEvent('rota_atribuida', state, { rota: route.atId });

      try {
        await this.sheets.updateRouteDriverId(route.atId, state.driverId!);
      } catch (error) {
        await this.logEvent('sheet_update_failed', state, {
          rota: route.atId,
        });
      }

      await this.setState(chatId, { ...state, state: DriverState.MENU });
      const group = state.queueGroup || this.queueGroupFromVehicle(state.vehicleType);
      await this.releaseAndNotifyNext(group);
      await this.sendMainMenu(Number(chatId));
      return { ok: true };
    }

    /* ===== AJUDA ===== */
    if (state.state === DriverState.HELP_MENU) {
      if (text === '0') {
        await this.telegram.sendMessage(
          Number(chatId),
          'Atendimento encerrado.',
        );
        await this.clearState(chatId);
        return { ok: true };
      }

      if (text === '9') {
        await this.setState(chatId, {
          ...state,
          state: DriverState.MENU,
          inQueue: false,
        });
        await this.sendMainMenu(Number(chatId));
        return { ok: true };
      }

      const answer = HELP_ANSWERS[text];
      if (!answer) {
        await this.telegram.sendMessage(Number(chatId), 'Opção inválida.');
        await this.telegram.sendMessage(Number(chatId), HELP_MENU);
        return { ok: true };
      }

      await this.telegram.sendMessage(
        Number(chatId),
        `${answer}\n\n${HELP_MENU}`,
      );
      return { ok: true };
    }

    return { ok: true };
  }
}
