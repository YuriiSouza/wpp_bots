// Motoristas que estão cadastrados como PASSEIO no SPX mas, pela planilha de
// validação de veículo (respostas de formulário), têm Fiorino. O app passa a
// considerá-los Fiorino em todo lugar. A lista é lida da planilha via o login
// Google do usuário (que precisa ter acesso a ela) e guardada em localStorage
// (sincroniza junto com os demais dados spx:*).

const SHEET_ID = '1HpavXoQc-AYc9Ypb7UyfbOs1-58sMcZiTTxnjMbh65Q'
const SHEET_GID = 1437706602
const STORE_KEY = 'spx:fiorino-driver-ids'

export function getFiorinoIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {}
  return new Set()
}

// Força 'Fiorino' quando o motorista está na lista de validação; senão mantém o valor original.
export function overrideVehicle(driverId: string | null | undefined, raw: string | null | undefined): string {
  const id = (driverId ?? '').trim()
  if (id && getFiorinoIds().has(id)) return 'Fiorino'
  return raw ?? ''
}

interface SheetMeta {
  sheets?: { properties: { title: string; sheetId: number } }[]
  error?: { message?: string }
}

// Busca a planilha e atualiza o conjunto de IDs. Lança NOT_SIGNED_IN se não logado.
export async function refreshFiorinoIds(): Promise<number> {
  const meta = (await window.electron.ipcRenderer.invoke('sheets-request', {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(title,sheetId)`,
    method: 'GET',
    body: null,
  })) as SheetMeta
  if (meta.error) throw new Error(meta.error.message ?? 'Erro ao ler a planilha de validação')

  const sheets = meta.sheets ?? []
  const target = sheets.find(s => s.properties.sheetId === SHEET_GID) ?? sheets[0]
  if (!target) throw new Error('Planilha de validação sem abas')

  const res = (await window.electron.ipcRenderer.invoke('sheets-request', {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(target.properties.title)}`,
    method: 'GET',
    body: null,
  })) as { values?: string[][] }

  const rows = res.values ?? []
  if (rows.length < 2) {
    localStorage.setItem(STORE_KEY, '[]')
    return 0
  }

  // Acha a coluna "ID do motorista" pelo cabeçalho; fallback para a coluna B (índice 1).
  const header = rows[0].map(h => String(h ?? '').trim().toLowerCase())
  let idCol = header.findIndex(h => h.includes('id do motorista'))
  if (idCol < 0) idCol = header.findIndex(h => h.includes('motorista') || h === 'id')
  if (idCol < 0) idCol = 1

  const ids = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][idCol] ?? '').trim()
    if (id) ids.add(id)
  }
  localStorage.setItem(STORE_KEY, JSON.stringify([...ids]))
  return ids.size
}
