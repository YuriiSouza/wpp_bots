import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { PrismaService } from './prisma/prisma.service';
import { normalizeVehicleType } from './utils/normalize-vehicle';
import { createConnection } from 'net';
import { SyncService } from './sync/sync.service';
import { BlocklistStatus } from '@prisma/client';

@Injectable()
export class AppService {
  private readonly QUEUE_LIST_KEY_GENERAL = 'telegram:queue:list:general';
  private readonly QUEUE_ACTIVE_KEY_GENERAL = 'telegram:queue:active:general';
  private readonly QUEUE_LIST_KEY_MOTO = 'telegram:queue:list:moto';
  private readonly QUEUE_ACTIVE_KEY_MOTO = 'telegram:queue:active:moto';
  private readonly LOG_PREFIX = 'telegram:log';
  private readonly ROUTES_NOTE_KEY = 'telegram:routes:note';
  private readonly BLOCKLIST_CACHE_PREFIX = 'telegram:blocklist:cache:driver';

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async updateRoutesNote(
    text: string,
  ): Promise<{ ok: boolean; message: string; text: string }> {
    const note = String(text || '').trim().slice(0, 2000);
    await this.redisService.set(this.ROUTES_NOTE_KEY, note);
    return {
      ok: true,
      message: 'Texto de orientacao salvo com sucesso.',
      text: note,
    };
  }

  private normalizeDriverId(value: string): string {
    return String(value || '')
      .trim()
      .replace(/\D/g, '');
  }

  async addBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });

    if (!existing) {
      await this.prisma.driverBlocklist.create({
        data: {
          driverId,
          status: BlocklistStatus.ACTIVE,
          timesListed: 1,
          lastActivatedAt: new Date(),
        },
      });
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
      return { ok: true, message: `Motorista ${driverId} adicionado na lista de bloqueio (ativo).` };
    }

    if (existing.status === BlocklistStatus.ACTIVE) {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta ativo na lista de bloqueio.` };
    }

    await this.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: BlocklistStatus.ACTIVE,
        timesListed: { increment: 1 },
        lastActivatedAt: new Date(),
      },
    });
    await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, true, 3600);
    return { ok: true, message: `Motorista ${driverId} reativado na lista de bloqueio.` };
  }

  async removeBlocklistDriver(driverIdRaw: string): Promise<{ ok: boolean; message: string }> {
    const driverId = this.normalizeDriverId(driverIdRaw);
    if (!driverId) return { ok: false, message: 'Informe um Driver ID valido.' };

    const existing = await this.prisma.driverBlocklist.findUnique({
      where: { driverId },
      select: { status: true },
    });
    if (!existing) {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
      return { ok: false, message: `Motorista ${driverId} nao esta cadastrado na lista de bloqueio.` };
    }

    if (existing.status === BlocklistStatus.INACTIVE) {
      await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
      return { ok: true, message: `Motorista ${driverId} ja esta inativo na lista de bloqueio.` };
    }

    await this.prisma.driverBlocklist.update({
      where: { driverId },
      data: {
        status: BlocklistStatus.INACTIVE,
        lastInactivatedAt: new Date(),
      },
    });
    await this.redisService.set(`${this.BLOCKLIST_CACHE_PREFIX}:${driverId}`, false, 3600);
    return { ok: true, message: `Motorista ${driverId} marcado como inativo na lista de bloqueio.` };
  }

  async createFaqItem(
    title: string,
    answer: string,
    position?: number,
  ): Promise<{ ok: boolean; message: string }> {
    const parsedTitle = String(title || '').trim();
    const parsedAnswer = String(answer || '').trim();
    if (!parsedTitle || !parsedAnswer) {
      return { ok: false, message: 'Titulo e resposta sao obrigatorios.' };
    }

    const maxPosition = await this.prisma.faqItem.aggregate({
      _max: { position: true },
    });

    await this.prisma.faqItem.create({
      data: {
        title: parsedTitle,
        answer: parsedAnswer,
        position:
          Number.isFinite(Number(position)) && Number(position) >= 0
            ? Number(position)
            : (maxPosition._max.position || 0) + 1,
      },
    });

    return { ok: true, message: 'Duvida criada com sucesso.' };
  }

  async updateFaqItem(
    id: string,
    title: string,
    answer: string,
    position?: number,
    active?: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    const parsedId = String(id || '').trim();
    if (!parsedId) return { ok: false, message: 'ID invalido.' };

    const parsedTitle = String(title || '').trim();
    const parsedAnswer = String(answer || '').trim();
    if (!parsedTitle || !parsedAnswer) {
      return { ok: false, message: 'Titulo e resposta sao obrigatorios.' };
    }

    await this.prisma.faqItem.update({
      where: { id: parsedId },
      data: {
        title: parsedTitle,
        answer: parsedAnswer,
        position:
          Number.isFinite(Number(position)) && Number(position) >= 0
            ? Number(position)
            : 0,
        active: active !== false,
      },
    });

    return { ok: true, message: 'Duvida atualizada com sucesso.' };
  }

  async deleteFaqItem(id: string): Promise<{ ok: boolean; message: string }> {
    const parsedId = String(id || '').trim();
    if (!parsedId) return { ok: false, message: 'ID invalido.' };

    await this.prisma.faqItem.delete({ where: { id: parsedId } });
    return { ok: true, message: 'Duvida removida com sucesso.' };
  }

  async getFaqDashboardHtml(): Promise<string> {
    const faqs = await this.prisma.faqItem.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Painel de Dúvidas</title>
  <style>
    body { margin:0; font-family: Georgia, "Times New Roman", serif; background:#f6f3ef; color:#1f1f1f; }
    .wrap { max-width:1200px; margin:0 auto; padding:20px; display:grid; gap:16px; }
    .card { background:#fff; border:1px solid #e1ddd7; border-radius:10px; padding:14px 16px; }
    h1 { margin:0 0 8px 0; font-size:24px; }
    label { display:block; font-size:13px; color:#666; margin-bottom:4px; }
    input, textarea { width:100%; border:1px solid #d2cec8; border-radius:8px; padding:8px; font-family:inherit; box-sizing:border-box; }
    .row { display:grid; grid-template-columns:1fr 1fr 140px; gap:10px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    button { border:1px solid #d2cec8; background:#fff; padding:8px 12px; border-radius:8px; cursor:pointer; font-family:inherit; }
    button:hover { border-color:#999; }
    .nav { display:flex; gap:8px; margin-top:10px; }
    .nav a { text-decoration:none; border:1px solid #d2cec8; color:#1f1f1f; background:#fff; padding:6px 10px; border-radius:8px; font-size:14px; }
    .nav a:hover { border-color:#999; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { padding:8px; border-bottom:1px solid #eee; text-align:left; vertical-align:top; }
    .muted { color:#666; font-size:13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Dúvidas frequentes</h1>
      <div class="muted">Crie, edite, ative/inative e exclua itens do bot.</div>
      <div class="nav">
        <a href="/acess/analist">Painel Operação</a>
        <a href="/acess/duvidas">Painel Dúvidas</a>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div>
          <label>Título</label>
          <input id="new-title" />
        </div>
        <div>
          <label>Ordem</label>
          <input id="new-position" type="number" min="0" />
        </div>
        <div></div>
      </div>
      <div style="margin-top:10px;">
        <label>Resposta</label>
        <textarea id="new-answer" rows="5"></textarea>
      </div>
      <div class="actions">
        <button onclick="createFaq()">Criar dúvida</button>
      </div>
      <div id="create-status" class="muted">Pronto.</div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr><th>Ordem</th><th>Título</th><th>Resposta</th><th>Ativo</th><th>Ações</th></tr>
        </thead>
        <tbody>
          ${
            faqs.length
              ? faqs
                  .map(
                    (item) => `
                    <tr>
                      <td><input id="pos-${item.id}" type="number" min="0" value="${item.position}" style="width:90px;" /></td>
                      <td><input id="title-${item.id}" value="${this.escapeHtml(item.title)}" /></td>
                      <td><textarea id="answer-${item.id}" rows="4">${this.escapeHtml(item.answer)}</textarea></td>
                      <td><input id="active-${item.id}" type="checkbox" ${item.active ? 'checked' : ''} /></td>
                      <td>
                        <div class="actions">
                          <button onclick="updateFaq('${item.id}')">Salvar</button>
                          <button onclick="deleteFaq('${item.id}')">Excluir</button>
                        </div>
                        <div id="status-${item.id}" class="muted">-</div>
                      </td>
                    </tr>`,
                  )
                  .join('')
              : '<tr><td colspan="5">Nenhuma dúvida cadastrada.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  </div>
  <script>
    async function createFaq() {
      const status = document.getElementById('create-status');
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/duvidas/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('new-title').value,
            answer: document.getElementById('new-answer').value,
            position: Number(document.getElementById('new-position').value || 0),
          }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao criar dúvida.';
      }
    }

    async function updateFaq(id) {
      const status = document.getElementById('status-' + id);
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/duvidas/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            title: document.getElementById('title-' + id).value,
            answer: document.getElementById('answer-' + id).value,
            position: Number(document.getElementById('pos-' + id).value || 0),
            active: document.getElementById('active-' + id).checked,
          }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
      } catch (error) {
        status.textContent = 'Falha ao salvar.';
      }
    }

    async function deleteFaq(id) {
      const status = document.getElementById('status-' + id);
      status.textContent = 'Excluindo...';
      try {
        const res = await fetch('/acess/duvidas/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluído.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao excluir.';
      }
    }
  </script>
</body>
</html>
`;
  }

  async runAnalystSync(
    action: 'drivers' | 'routes' | 'all',
  ): Promise<{ ok: boolean; message: string }> {
    if (!['drivers', 'routes', 'all'].includes(action)) {
      return { ok: false, message: 'Acao invalida.' };
    }

    if (await this.sync.isLocked()) {
      return { ok: false, message: 'Ja existe uma sincronizacao em andamento.' };
    }

    try {
      if (action === 'drivers') {
        const drivers = await this.sync.syncDriversScheduled();
        return {
          ok: true,
          message: `Motoristas atualizados com sucesso. Total: ${drivers}.`,
        };
      }

      if (action === 'routes') {
        const routes = await this.sync.syncRoutesOnly();
        return {
          ok: true,
          message: `Rotas atualizadas com sucesso. Disponiveis: ${routes.routesAvailable}. Atribuidas: ${routes.routesAssigned}.`,
        };
      }

      await this.sync.resetRedisStateManual();
      return {
        ok: true,
        message: 'Redis/fila resetados com sucesso.',
      };
    } catch (error) {
      return {
        ok: false,
        message: `Erro ao sincronizar: ${(error as Error).message}`,
      };
    }
  }

  async getAnalystDashboardHtml(): Promise<string> {
    const redisStatus = await this.checkRedis();
    const postgresStatus = await this.checkPostgres();

    const redis = this.redisService.client();
    const activeChatId = await redis.get(this.QUEUE_ACTIVE_KEY_GENERAL);
    const activeMotoChatId = await redis.get(this.QUEUE_ACTIVE_KEY_MOTO);
    const queue = await redis.lrange(this.QUEUE_LIST_KEY_GENERAL, 0, -1);
    const motoQueue = await redis.lrange(this.QUEUE_LIST_KEY_MOTO, 0, -1);
    const combinedQueue = [...queue, ...motoQueue];

    const uniqueQueue = combinedQueue.filter(
      (value, index, self) => self.indexOf(value) === index,
    );

    const queueStates = await Promise.all(
      uniqueQueue.map(async (chatId) => {
        const state = await this.redisService.get<any>(this.stateKey(chatId));
        return {
          chatId,
          driverId: state?.driverId || null,
          driverName: state?.driverName || '-',
          vehicleType: state?.vehicleType || '-',
          state: state?.state || '-',
          group: state?.queueGroup || '-',
        };
      }),
    );

    const queueDriverIds = Array.from(
      new Set(
        queueStates
          .map((row) => row.driverId)
          .filter((id): id is string => !!id),
      ),
    );
    const queueDrivers = queueDriverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: queueDriverIds } },
          select: {
            id: true,
            ds: true,
            noShowCount: true,
            declineRate: true,
            priorityScore: true,
          },
        })
      : [];
    const queueDriverMap = new Map(queueDrivers.map((d) => [d.id, d]));

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

    let activeMotoState = null as null | {
      chatId: string;
      driverName: string;
      vehicleType: string;
      state: string;
    };

    if (activeMotoChatId) {
      const state = await this.redisService.get<any>(
        this.stateKey(activeMotoChatId),
      );
      activeMotoState = {
        chatId: activeMotoChatId,
        driverName: state?.driverName || '-',
        vehicleType: state?.vehicleType || '-',
        state: state?.state || '-',
      };
    }

    const logs = await redis.lrange(this.logKey(), 0, -1);
    const requestedToday = logs.filter(
      (line) =>
        line.includes('acao=rota_solicitada') ||
        line.includes('acao=rota_atribuida'),
    ).length;
    const routesNote = (await this.redisService.get<string>(this.ROUTES_NOTE_KEY)) || '';
    const routesNoteEscaped = this.escapeHtml(routesNote);
    const blocklistEntries = await this.prisma.driverBlocklist.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const blocklistIds = blocklistEntries.map((row) => row.driverId);
    const blocklistDrivers = blocklistIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: blocklistIds } },
          select: {
            id: true,
            name: true,
            vehicleType: true,
            ds: true,
            noShowCount: true,
            declineRate: true,
            priorityScore: true,
          },
        })
      : [];
    const blocklistMap = new Map(blocklistDrivers.map((d) => [d.id, d]));

    const recentLogs = logs.slice(-20).join('\n');

    const routes = await this.prisma.route.findMany({
      include: { driver: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const routeRows = routes.map((route) => {
      const driver = route.driver;
      const driverVehicle = driver?.vehicleType || route.driverVehicleType || '-';
      const requiredNorm = normalizeVehicleType(route.requiredVehicleType ?? undefined);
      const driverNorm = normalizeVehicleType(driverVehicle);
      const accuracy =
        route.driverId && requiredNorm && driverNorm && requiredNorm === driverNorm
          ? 'OK'
          : route.driverId
          ? 'NAO'
          : '-';

      return {
        id: route.id,
        bairro: route.bairro || '-',
        cidade: route.cidade || '-',
        required: route.requiredVehicleType || '-',
        status: route.status,
        driverId: route.driverId || '-',
        driverName: driver?.name || route.driverName || '-',
        driverDs: driver?.ds || '-',
        driverNoShow: driver?.noShowCount ?? 0,
        driverDeclineRate:
          typeof driver?.declineRate === 'number' ? driver.declineRate.toFixed(2) : '0.00',
        driverScore:
          typeof driver?.priorityScore === 'number' ? driver.priorityScore.toFixed(2) : '0.00',
        driverVehicle,
        accuracy,
      };
    });

    const priorityDrivers = await this.prisma.driver.findMany({
      orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        vehicleType: true,
        ds: true,
        noShowCount: true,
        declineRate: true,
        priorityScore: true,
      },
    });

    return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
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
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { border: 1px solid #d2cec8; background: #fff; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-family: inherit; }
    button:hover { border-color: #999; }
    .nav { display:flex; gap:8px; margin-top:10px; }
    .nav a { text-decoration:none; border:1px solid #d2cec8; color:#1f1f1f; background:#fff; padding:6px 10px; border-radius:8px; font-size:14px; }
    .nav a:hover { border-color:#999; }
    #sync-status { margin-top: 10px; color: var(--muted); font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <h1>Visao do Bot (tempo real)</h1>
    <div class="nav">
      <a href="/acess/analist">Painel Operação</a>
      <a href="/acess/duvidas">Painel Dúvidas</a>
    </div>
  </header>
  <div class="wrap">
    <div class="card">
      <div class="label">Sincronizacao</div>
      <div class="actions">
        <button onclick="runSync('drivers')">Atualizar motoristas</button>
        <button onclick="runSync('routes')">Atualizar rotas</button>
        <button onclick="runSync('all')">Resetar fila</button>
      </div>
      <div id="sync-status">Pronto.</div>
    </div>

    <div class="card">
      <div class="label">Texto da lista de rotas</div>
      <textarea id="routes-note" rows="4" style="width:100%; margin-top:8px; font-family:inherit;">${routesNoteEscaped}</textarea>
      <div class="actions" style="margin-top:10px;">
        <button onclick="saveRoutesNote()">Salvar texto</button>
      </div>
      <div id="routes-note-status" style="margin-top:8px; color:#666; font-size:14px;">Pronto.</div>
    </div>

    <div class="card">
      <div class="label">Lista de bloqueio (permanente, prioridade zero)</div>
      <div class="actions" style="margin-top:8px;">
        <input id="blocklist-driver-id" placeholder="Driver ID" style="padding:8px; border:1px solid #d2cec8; border-radius:8px; font-family:inherit;" />
        <button onclick="addBlocklistDriver()">Adicionar</button>
      </div>
      <div id="blocklist-status" style="margin-top:8px; color:#666; font-size:14px;">Pronto.</div>
      <table style="margin-top:10px;">
        <thead>
          <tr><th>Driver ID</th><th>Nome</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th><th>Status</th><th>Vezes</th><th>Ação</th></tr>
        </thead>
        <tbody>
          ${
            blocklistEntries.length
              ? blocklistEntries
                  .map((entry) => {
                    const id = entry.driverId;
                    const info = blocklistMap.get(id);
                    const name = this.escapeHtml(info?.name || '-');
                    const vehicle = this.escapeHtml(info?.vehicleType || '-');
                    const ds = this.escapeHtml(info?.ds || '-');
                    const noShow = info?.noShowCount ?? 0;
                    const declineRate =
                      typeof info?.declineRate === 'number'
                        ? info.declineRate.toFixed(2)
                        : '0.00';
                    const score =
                      typeof info?.priorityScore === 'number'
                        ? info.priorityScore.toFixed(2)
                        : '0.00';
                    const status = entry.status === 'ACTIVE' ? 'Ativo' : 'Inativo';
                    const actionButton =
                      entry.status === 'ACTIVE'
                        ? `<button onclick="removeBlocklistDriver('${id}')">Inativar</button>`
                        : `<button onclick="addBlocklistDriverById('${id}')">Ativar</button>`;
                    return `<tr><td>${id}</td><td>${name}</td><td>${vehicle}</td><td>${ds}</td><td>${noShow}</td><td>${declineRate}</td><td>${score}</td><td>${status}</td><td>${entry.timesListed}</td><td>${actionButton}</td></tr>`;
                  })
                  .join('')
              : '<tr><td colspan="10">Sem motoristas na lista de bloqueio</td></tr>'
          }
        </tbody>
      </table>
    </div>

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
        <div class="label">Rotas solicitadas hoje</div>
        <div class="value">${requestedToday}</div>
      </div>
      <div class="card">
        <div class="label">Fila geral</div>
        <div class="value">${queue.length}</div>
      </div>
      <div class="card">
        <div class="label">Fila moto</div>
        <div class="value">${motoQueue.length}</div>
      </div>
    </div>

    <div class="card">
      <div class="label">Atendimento ativo (geral)</div>
      <div class="value">
        ${
          activeState
            ? `${activeState.driverName} (${activeState.vehicleType}) <span class="pill">${activeState.state}</span>`
            : 'Nenhum'
        }
      </div>
    </div>

    <div class="card">
      <div class="label">Atendimento ativo (moto)</div>
      <div class="value">
        ${
          activeMotoState
            ? `${activeMotoState.driverName} (${activeMotoState.vehicleType}) <span class="pill">${activeMotoState.state}</span>`
            : 'Nenhum'
        }
      </div>
    </div>

    <div class="card">
      <div class="label">Fila atual</div>
      <table>
        <thead>
          <tr><th>Chat</th><th>Motorista</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th><th>Estado</th><th>Grupo</th></tr>
        </thead>
        <tbody>
          ${
            queueStates.length
              ? queueStates
                  .map(
                    (row) => {
                      const d = row.driverId
                        ? queueDriverMap.get(row.driverId)
                        : undefined;
                      const ds = this.escapeHtml(d?.ds || '-');
                      const noShow = d?.noShowCount ?? 0;
                      const declineRate =
                        typeof d?.declineRate === 'number'
                          ? d.declineRate.toFixed(2)
                          : '0.00';
                      const score =
                        typeof d?.priorityScore === 'number'
                          ? d.priorityScore.toFixed(2)
                          : '0.00';
                      return `<tr><td>${row.chatId}</td><td>${row.driverName}</td><td>${row.vehicleType}</td><td>${ds}</td><td>${noShow}</td><td>${declineRate}</td><td>${score}</td><td>${row.state}</td><td>${row.group}</td></tr>`;
                    },
                  )
                  .join('')
              : '<tr><td colspan="9">Sem fila</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="label">Logs recentes</div>
      <pre>${recentLogs || 'Sem logs para hoje.'}</pre>
    </div>

    <div class="card">
      <div class="label">Rotas (ultimas 200)</div>
      <table>
        <thead>
          <tr>
            <th>AT</th>
            <th>Bairro</th>
            <th>Cidade</th>
            <th>Tipo rota</th>
            <th>Status</th>
            <th>Driver ID</th>
            <th>Motorista</th>
            <th>DS</th>
            <th>No-show</th>
            <th>Recusa %</th>
            <th>Score</th>
            <th>Veiculo</th>
            <th>Acertividade</th>
          </tr>
        </thead>
        <tbody>
          ${
            routeRows.length
              ? routeRows
                  .map(
                    (row) =>
                      `<tr><td>${row.id}</td><td>${row.bairro}</td><td>${row.cidade}</td><td>${row.required}</td><td>${row.status}</td><td>${row.driverId}</td><td>${row.driverName}</td><td>${row.driverDs}</td><td>${row.driverNoShow}</td><td>${row.driverDeclineRate}</td><td>${row.driverScore}</td><td>${row.driverVehicle}</td><td>${row.accuracy}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="13">Sem rotas no banco</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="label">Prioridade dos motoristas (top 200)</div>
      <table>
        <thead>
          <tr><th>Driver ID</th><th>Nome</th><th>Veiculo</th><th>DS</th><th>No-show</th><th>Recusa %</th><th>Score</th></tr>
        </thead>
        <tbody>
          ${
            priorityDrivers.length
              ? priorityDrivers
                  .map(
                    (d) =>
                      `<tr><td>${d.id}</td><td>${this.escapeHtml(d.name || '-')}</td><td>${this.escapeHtml(d.vehicleType || '-')}</td><td>${this.escapeHtml(d.ds || '-')}</td><td>${d.noShowCount}</td><td>${d.declineRate.toFixed(2)}</td><td>${d.priorityScore.toFixed(2)}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="7">Sem motoristas no banco</td></tr>'
          }
        </tbody>
      </table>
    </div>
  </div>
  <script>
    let routesNoteDirty = false;

    async function runSync(action) {
      const status = document.getElementById('sync-status');
      status.textContent = 'Sincronizando...';
      try {
        const res = await fetch('/acess/analist/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Concluido.';
      } catch (error) {
        status.textContent = 'Falha ao iniciar sincronizacao.';
      }
    }

    async function saveRoutesNote() {
      const status = document.getElementById('routes-note-status');
      const noteEl = document.getElementById('routes-note');
      const text = noteEl.value;
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/analist/routes-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        routesNoteDirty = false;
        status.textContent = data.message || 'Texto salvo.';
      } catch (error) {
        status.textContent = 'Falha ao salvar texto.';
      }
    }

    async function addBlocklistDriver() {
      const status = document.getElementById('blocklist-status');
      const input = document.getElementById('blocklist-driver-id');
      const driverId = input.value;
      status.textContent = 'Salvando...';
      try {
        const res = await fetch('/acess/analist/blocklist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao salvar lista de bloqueio.';
      }
    }

    async function addBlocklistDriverById(driverId) {
      const status = document.getElementById('blocklist-status');
      status.textContent = 'Atualizando...';
      try {
        const res = await fetch('/acess/analist/blocklist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao atualizar lista de bloqueio.';
      }
    }

    async function removeBlocklistDriver(driverId) {
      const status = document.getElementById('blocklist-status');
      status.textContent = 'Removendo...';
      try {
        const res = await fetch('/acess/analist/blocklist/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        const data = await res.json();
        status.textContent = data.message || 'Atualizado.';
        if (data.ok) window.location.reload();
      } catch (error) {
        status.textContent = 'Falha ao remover de lista de bloqueio.';
      }
    }

    const noteEl = document.getElementById('routes-note');
    if (noteEl) {
      noteEl.addEventListener('input', () => {
        routesNoteDirty = true;
      });
    }

    setInterval(() => {
      const active = document.activeElement;
      const isTypingNote = active && active.id === 'routes-note';
      if (isTypingNote || routesNoteDirty) return;
      window.location.reload();
    }, 15000);
  </script>
</body>
</html>
`;
  }
}
