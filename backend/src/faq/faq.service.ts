import { Injectable } from '@nestjs/common';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class FaqService {
  constructor(private readonly common: AdminCommonService) {}

  async getFaqItems() {
    return this.common.prisma.faqItem.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
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

    const maxPosition = await this.common.prisma.faqItem.aggregate({
      _max: { position: true },
    });

    await this.common.prisma.faqItem.create({
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

    await this.common.prisma.faqItem.update({
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

    await this.common.prisma.faqItem.delete({ where: { id: parsedId } });
    return { ok: true, message: 'Duvida removida com sucesso.' };
  }

  async getFaqDashboardHtml(): Promise<string> {
    const faqs = await this.common.prisma.faqItem.findMany({
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
                      <td><input id="title-${item.id}" value="${this.common.escapeHtml(item.title)}" /></td>
                      <td><textarea id="answer-${item.id}" rows="4">${this.common.escapeHtml(item.answer)}</textarea></td>
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
}
