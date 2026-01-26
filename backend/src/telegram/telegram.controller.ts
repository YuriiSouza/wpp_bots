import { Body, Controller, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { SheetsService } from '../sheets/sheets.service';
import { RedisService } from '../redis/redis.service';
import { sortRoutes } from '../utils/sort-routes';
import { DriverSession, DriverState } from './telegram.state';
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
  private readonly QUEUE_LIST_KEY = 'telegram:queue:list';
  private readonly QUEUE_ACTIVE_KEY = 'telegram:queue:active';
  private readonly QUEUE_ACTIVE_META_KEY = 'telegram:queue:active:meta';
  private readonly ROUTE_TIMEOUT_PREFIX = 'telegram:route:timeout';
  private readonly ROUTE_TIMEOUT_LOCK_KEY = 'telegram:route:timeout:lock';
  private readonly LOG_PREFIX = 'telegram:log';

  private timeoutWatcher?: NodeJS.Timeout;

  constructor(
    private readonly telegram: TelegramService,
    private readonly sheets: SheetsService,
    private readonly redis: RedisService,
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

  private queueListKey() {
    return this.QUEUE_LIST_KEY;
  }

  private queueActiveKey() {
    return this.QUEUE_ACTIVE_KEY;
  }

  private queueActiveMetaKey() {
    return this.QUEUE_ACTIVE_META_KEY;
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
      void this.requeueExpiredActive();
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

  private async pickNextFromQueue(): Promise<string | null> {
    const client = this.redis.client();
    const queue = await client.lrange(this.queueListKey(), 0, -1);
    if (!queue.length) return null;

    const next = queue[0];
    await client.lrem(this.queueListKey(), 1, next);
    await client.del(this.queueMarker(next));
    return next;
  }

  private async activateNextInQueue(): Promise<string | null> {
    const client = this.redis.client();
    const next = await this.pickNextFromQueue();
    if (!next) return null;

    await client.set(
      this.queueActiveKey(),
      next,
      'EX',
      this.QUEUE_TTL,
    );
    await client.set(
      this.queueActiveMetaKey(),
      JSON.stringify({
        chatId: next,
        startedAt: Date.now(),
      }),
      'EX',
      this.QUEUE_TTL * 2,
    );
    return next;
  }

  private async clearRouteTimeout(chatId: string) {
    await this.redis.client().del(this.routeTimeoutKey(chatId));
  }

  private async refreshActiveMeta(chatId: string) {
    const client = this.redis.client();
    await client.set(
      this.queueActiveMetaKey(),
      JSON.stringify({
        chatId,
        startedAt: Date.now(),
      }),
      'EX',
      this.QUEUE_TTL * 2,
    );
    await client.expire(this.queueActiveKey(), this.QUEUE_TTL);
  }

  private async setRouteTimeout(chatId: string, vehicleType?: string) {
    const client = this.redis.client();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await client.set(this.routeTimeoutKey(chatId), token, 'EX', this.QUEUE_TTL);

    setTimeout(() => {
      void (async () => {
        const current = await client.get(this.routeTimeoutKey(chatId));
        if (current !== token) return;

        const active = await client.get(this.queueActiveKey());
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
        await this.handleTimeout(chatId, state.vehicleType);
      })();
    }, this.QUEUE_TTL * 1000);
  }

  private async handleTimeout(chatId: string, vehicleType?: string) {
    await this.releaseAndNotifyNext();
    const state = await this.getState(chatId);
    const queueVehicle = state?.vehicleType || vehicleType;
    const pos = await this.enqueue(chatId, queueVehicle);
    if (state) {
      await this.setState(chatId, {
        ...state,
        state: DriverState.MENU,
        availableRoutes: undefined,
        inQueue: true,
      });
    }
    await this.telegram.sendMessage(
      Number(chatId),
      `Atendimento encerrado por falta de resposta. Você voltou para o final da fila. Posição: ${pos}`,
    );
    await this.logEvent('timeout', state, { position: pos });
  }

  private async requeueExpiredActive(): Promise<boolean> {
    const client = this.redis.client();
    const lockKey = this.ROUTE_TIMEOUT_LOCK_KEY;
    const locked = await client.setnx(lockKey, '1');
    if (locked !== 1) return false;
    await client.expire(lockKey, 5);

    const metaRaw = await client.get(this.queueActiveMetaKey());
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

    await client.del(this.queueActiveMetaKey());
    await client.del(this.queueActiveKey());
    await this.clearRouteTimeout(meta.chatId);
    await client.del(lockKey);

    await this.handleTimeout(meta.chatId);
    return true;
  }

  private async notifyQueueNext(next: string) {
    const state = await this.getState(next);
    if (!state?.vehicleType) {
      await this.clearState(next);
      await this.releaseAndNotifyNext();
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
  ): Promise<boolean> {
    const client = this.redis.client();
    const active = await client.get(this.queueActiveKey());
    if (active) {
      const expired = await this.requeueExpiredActive();
      if (!expired) return active === chatId;
    }

    const next = await this.activateNextInQueue();
    if (!next) return false;
    if (next !== chatId) {
      await this.notifyQueueNext(next);
      return false;
    }
    return true;
  }

  private async enqueue(
    chatId: string,
    vehicleType?: string,
  ): Promise<number> {
    const client = this.redis.client();
    const marker = this.queueMarker(chatId);

    await client.expire(marker, this.QUEUE_TTL);

    const queue = await client.lrange(this.queueListKey(), 0, -1);
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

    await client.del(this.queueListKey());
    if (nextQueue.length) await client.rpush(this.queueListKey(), ...nextQueue);
    await client.set(marker, '1', 'EX', this.QUEUE_TTL);

    return nextQueue.indexOf(chatId) + 1;
  }

  private async getQueuePosition(chatId: string): Promise<number> {
    const client = this.redis.client();
    const queue = await client.lrange(this.queueListKey(), 0, -1);
    const index = queue.indexOf(chatId);
    return index >= 0 ? index + 1 : -1;
  }

  private async releaseAndNotifyNext() {
    const client = this.redis.client();

    await client.del(this.queueActiveKey());
    await client.del(this.queueActiveMetaKey());

    const next = await this.pickNextFromQueue();
    if (!next) return;

    await client.set(
      this.queueActiveKey(),
      next,
      'EX',
      this.QUEUE_TTL,
    );

    await this.notifyQueueNext(next);
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
      await this.releaseAndNotifyNext();
      return;
    }

    const routes = await this.sheets.getAllAvailableRoutes();
    const sorted = sortRoutes(routes);

    if (!sorted.length) {
      await this.telegram.sendMessage(Number(chatId), NO_ROUTES_AVAILABLE);
      await this.sendMainMenu(Number(chatId));
      await this.releaseAndNotifyNext();
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
    await this.refreshActiveMeta(chatId);
    await this.setRouteTimeout(chatId, state.vehicleType);
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
    if (state?.inQueue) {
      await this.enqueue(chatId, state.vehicleType);
      const canStart = await this.tryAcquireQueue(chatId);
      if (canStart) {
        await this.sendRoutes(chatId, state);
        return { ok: true };
      }

      const pos = await this.getQueuePosition(chatId);
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
      const driverId = Number(text);
      if (!Number.isInteger(driverId)) {
        await this.telegram.sendMessage(Number(chatId), 'ID inválido.');
        return { ok: true };
      }

      const driver = await this.sheets.getDriverVehicle(driverId);
      if (!driver) {
        await this.telegram.sendMessage(Number(chatId), 'ID não encontrado.');
        return { ok: true };
      }

      await this.setState(chatId, {
        state: DriverState.MENU,
        driverId,
        driverName: driver.name,
        vehicleType: driver.vehicleType,
      });

      await this.telegram.sendMessage(
        Number(chatId),
        `Olá, ${driver.name}!`,
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

      const hasRoute = await this.sheets.driverAlreadyHasRoute(state.driverId!);
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

      await this.enqueue(chatId, state.vehicleType);
      const canStart = await this.tryAcquireQueue(chatId);
      if (!canStart) {
        const pos = await this.getQueuePosition(chatId);
        await this.setState(chatId, { ...state, inQueue: true });
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
        await this.releaseAndNotifyNext();
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
      const ok = await this.sheets.assignRoute(route.atId, state.driverId!);

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

      await this.setState(chatId, { ...state, state: DriverState.MENU });
      await this.releaseAndNotifyNext();
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
