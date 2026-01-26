import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { createConnection } from 'net';

@Injectable()
export class AppService {
  private readonly QUEUE_LIST_KEY = 'telegram:queue:list';
  private readonly QUEUE_ACTIVE_KEY = 'telegram:queue:active';
  private readonly LOG_PREFIX = 'telegram:log';

  constructor(private readonly redisService: RedisService) {}

  getHello(): string {
    return 'Hello World!';
  }

  private logKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${this.LOG_PREFIX}:${y}-${m}-${d}`;
  }

  private stateKey(chatId: string) {
    return `telegram:state:${chatId}`;
  }

  private async checkRedis(): Promise<string> {
    try {
      const pong = await this.redisService.client().ping();
      return pong === 'PONG' ? 'ok' : `erro (${pong})`;
    } catch (error) {
      return 'erro';
    }
  }

  private async checkPostgres(): Promise<string> {
    const url = process.env.DATABASE_URL;
    const host = process.env.PGHOST;
    const port = process.env.PGPORT;

    if (!url && !host) return 'nao_configurado';

    let targetHost = host || '';
    let targetPort = port ? Number(port) : 5432;

    if (url) {
      try {
        const parsed = new URL(url);
        targetHost = parsed.hostname;
        targetPort = parsed.port ? Number(parsed.port) : 5432;
      } catch (error) {
        return 'erro_url';
      }
    }

    return new Promise((resolve) => {
      const socket = createConnection(
        { host: targetHost, port: targetPort, timeout: 1000 },
        () => {
          socket.end();
          resolve('ok');
        },
      );

      socket.on('error', () => resolve('erro'));
      socket.on('timeout', () => {
        socket.destroy();
        resolve('timeout');
      });
    });
  }

  async getAnalystDashboardHtml(): Promise<string> {
    const redisStatus = await this.checkRedis();
    const postgresStatus = await this.checkPostgres();

    const redis = this.redisService.client();
    const activeChatId = await redis.get(this.QUEUE_ACTIVE_KEY);
    const queue = await redis.lrange(this.QUEUE_LIST_KEY, 0, -1);

    const uniqueQueue = queue.filter(
      (value, index, self) => self.indexOf(value) === index,
    );

    const queueStates = await Promise.all(
      uniqueQueue.map(async (chatId) => {
        const state = await this.redisService.get<any>(this.stateKey(chatId));
        return {
          chatId,
          driverName: state?.driverName || '-',
          vehicleType: state?.vehicleType || '-',
          state: state?.state || '-',
        };
      }),
    );

    let activeState = null as null | {
      chatId: string;
      driverName: string;
      vehicleType: string;
      state: string;
    };

    if (activeChatId) {
      const state = await this.redisService.get<any>(
        this.stateKey(activeChatId),
      );
      activeState = {
        chatId: activeChatId,
        driverName: state?.driverName || '-',
        vehicleType: state?.vehicleType || '-',
        state: state?.state || '-',
      };
    }

    const logs = await redis.lrange(this.logKey(), 0, -1);
    const assignedToday = logs.filter((line) =>
      line.includes('acao=rota_atribuida'),
    ).length;

    const recentLogs = logs.slice(-20).join('\n');

    return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="10" />
  <title>Visao do Bot</title>
  <style>
    :root { --bg: #f6f3ef; --card: #ffffff; --ink: #1f1f1f; --muted: #666; --accent: #0b6; }
    body { margin: 0; font-family: "Georgia", "Times New Roman", serif; background: var(--bg); color: var(--ink); }
    header { padding: 24px 28px; border-bottom: 2px solid #ddd; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .wrap { padding: 20px 28px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { background: var(--card); border: 1px solid #e1ddd7; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
    .label { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.08em; }
    .value { font-size: 18px; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 8px; border-bottom: 1px solid #eee; text-align: left; }
    pre { background: #111; color: #eee; padding: 12px; border-radius: 8px; overflow: auto; white-space: pre-wrap; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e9f6ef; color: #0b6; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Visao do Bot (tempo real)</h1>
  </header>
  <div class="wrap">
    <div class="grid">
      <div class="card">
        <div class="label">Redis</div>
        <div class="value">${redisStatus}</div>
      </div>
      <div class="card">
        <div class="label">Postgres</div>
        <div class="value">${postgresStatus}</div>
      </div>
      <div class="card">
        <div class="label">Rotas atribuidas hoje</div>
        <div class="value">${assignedToday}</div>
      </div>
      <div class="card">
        <div class="label">Fila</div>
        <div class="value">${queueStates.length}</div>
      </div>
    </div>

    <div class="card">
      <div class="label">Atendimento ativo</div>
      <div class="value">
        ${
          activeState
            ? `${activeState.driverName} (${activeState.vehicleType}) <span class="pill">${activeState.state}</span>`
            : 'Nenhum'
        }
      </div>
    </div>

    <div class="card">
      <div class="label">Fila atual</div>
      <table>
        <thead>
          <tr><th>Chat</th><th>Motorista</th><th>Veiculo</th><th>Estado</th></tr>
        </thead>
        <tbody>
          ${
            queueStates.length
              ? queueStates
                  .map(
                    (row) =>
                      `<tr><td>${row.chatId}</td><td>${row.driverName}</td><td>${row.vehicleType}</td><td>${row.state}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="4">Sem fila</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="label">Logs recentes</div>
      <pre>${recentLogs || 'Sem logs para hoje.'}</pre>
    </div>
  </div>
</body>
</html>
`;
  }
}
