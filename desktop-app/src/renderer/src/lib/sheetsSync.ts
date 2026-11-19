import { diskStore } from './diskStore'
import { mergeStored } from './syncMerge'
const CONFIG_KEY = 'spx:sheets-config'
const EXTRA_KEYS = ['spx_ds_result']
const SPX_PREFIX = 'spx:'
// Chaves sincronizadas que ficam em disco (não no localStorage)
const DISK_SYNCED = ['spx:fwdorder']
const LOCAL_ONLY = new Set([CONFIG_KEY, 'spx:header', 'spx:credentials'])

export interface SheetsConfig {
  spreadsheetId: string
}

const DEFAULT_SPREADSHEET_ID = '1LPsSbE5Jmgxrbe6ZKjq0ObBdDTOq7t5a3zLyqRBo0Y8'

export function getSheetsConfig(): SheetsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.spreadsheetId) return { spreadsheetId: parsed.spreadsheetId }
    }
  } catch {}
  return { spreadsheetId: DEFAULT_SPREADSHEET_ID }
}

export function saveSheetsConfig(cfg: SheetsConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

function extractSpreadsheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : urlOrId.trim()
}

// ─── IPC bridge (o token OAuth do usuário é resolvido no processo main) ───────

async function sheetsRequest(opts: {
  spreadsheetId: string
  method: 'GET' | 'POST' | 'PUT'
  path: string // e.g. "/values/app-data"
  body?: unknown
}): Promise<unknown> {
  const id = extractSpreadsheetId(opts.spreadsheetId)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}${opts.path}`
  return window.electron.ipcRenderer.invoke('sheets-request', {
    url,
    method: opts.method,
    body: opts.body ?? null,
  })
}

// ─── Push all spx:* localStorage to Sheets ───────────────────────────────────

export const CHUNK = 45000 // limite do Sheets é 50k caracteres por célula

export function buildRows(entries: [string, string][], now: string): string[][] {
  const rows: string[][] = [['key', 'part', 'value', 'exportedAt']]
  for (const [key, value] of entries) {
    for (let i = 0, part = 0; i < Math.max(value.length, 1); i += CHUNK, part++) {
      rows.push([key, String(part), value.slice(i, i + CHUNK), now])
    }
  }
  return rows
}

export function parseRows(rows: string[][]): Map<string, string> {
  const parts = new Map<string, string[]>()
  for (let i = 1; i < rows.length; i++) {
    const [key, part, value] = rows[i]
    if (!key) continue
    const arr = parts.get(key) ?? []
    arr[Number(part) || 0] = value ?? ''
    parts.set(key, arr)
  }
  return new Map([...parts].map(([k, arr]) => [k, arr.join('')]))
}

function syncedEntries(): Map<string, string> {
  const m = new Map<string, string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (LOCAL_ONLY.has(key)) continue
    if (key.startsWith(SPX_PREFIX) || EXTRA_KEYS.includes(key)) m.set(key, localStorage.getItem(key)!)
  }
  for (const key of DISK_SYNCED) { const v = diskStore.getRaw(key); if (v !== null) m.set(key, v) }
  return m
}
const isSynced = (key: string) => !LOCAL_ONLY.has(key) && (key.startsWith(SPX_PREFIX) || EXTRA_KEYS.includes(key))

async function readRemote(spreadsheetId: string): Promise<Map<string, string>> {
  const result = (await sheetsRequest({ spreadsheetId, method: 'GET', path: '/values/app-data' })) as { values?: string[][] }
  return parseRows(result?.values ?? [])
}

/** Junta o que está no app com o que está na planilha (nada é apagado) e grava o resultado no app. */
function mergeIntoLocal(remote: Map<string, string>): Map<string, string> {
  const local = syncedEntries()
  const merged = new Map<string, string>()
  for (const key of new Set([...local.keys(), ...remote.keys()])) {
    if (!isSynced(key)) continue
    const v = mergeStored(local.get(key) ?? null, remote.get(key) ?? null)
    if (v == null) continue
    merged.set(key, v)
    if (v !== local.get(key) && DISK_SYNCED.includes(key)) { diskStore.set(key, JSON.parse(v)); continue }
    if (v !== local.get(key)) { try { localStorage.setItem(key, v) } catch { /* sem espaço: fica só na planilha */ } }
  }
  return merged
}

export interface SyncReport { written: number; added: number; missing: string[] }

/** Envia: lê a planilha, soma com o app e regrava a soma. Depois confere se tudo chegou. */
export async function pushToSheets(): Promise<SyncReport> {
  const cfg = getSheetsConfig()
  const remote = await readRemote(cfg.spreadsheetId)
  const before = syncedEntries().size
  const merged = mergeIntoLocal(remote)
  const rows = buildRows([...merged], new Date().toISOString())
  await sheetsRequest({ spreadsheetId: cfg.spreadsheetId, method: 'POST', path: '/values/app-data:clear' })
  await sheetsRequest({ spreadsheetId: cfg.spreadsheetId, method: 'PUT', path: '/values/app-data?valueInputOption=RAW', body: { values: rows } })
  // Conferência: relê a planilha e compara chave a chave
  const check = await readRemote(cfg.spreadsheetId)
  const missing = [...merged].filter(([k, v]) => check.get(k) !== v).map(([k]) => k)
  return { written: merged.size, added: Math.max(0, merged.size - before), missing }
}

// ─── Pull from Sheets into localStorage ──────────────────────────────────────

/** Baixa: soma o que está na planilha com o que está no app (o app não perde nada). */
export async function pullFromSheets(): Promise<{ restored: number }> {
  const cfg = getSheetsConfig()
  const remote = await readRemote(cfg.spreadsheetId)
  mergeIntoLocal(remote)
  return { restored: remote.size }
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testSheetsConnection(cfg: SheetsConfig): Promise<{ ok: boolean; error?: string; title?: string }> {
  try {
    const id = extractSpreadsheetId(cfg.spreadsheetId)
    const result = (await window.electron.ipcRenderer.invoke('sheets-request', {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`,
      method: 'GET',
      body: null,
    })) as { properties?: { title?: string }; error?: { message?: string } }
    if (result?.error) return { ok: false, error: result.error.message ?? 'Erro desconhecido' }
    return { ok: true, title: result?.properties?.title }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('NOT_SIGNED_IN')) return { ok: false, error: 'Entre com sua conta Google primeiro.' }
    return { ok: false, error: msg }
  }
}
