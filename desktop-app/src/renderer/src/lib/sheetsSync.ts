const CONFIG_KEY = 'spx:sheets-config'
const EXTRA_KEYS = ['spx_ds_result']
const SPX_PREFIX = 'spx:'
const LOCAL_ONLY = new Set([CONFIG_KEY, 'spx:header', 'spx:credentials'])

export interface SheetsConfig {
  spreadsheetId: string
  serviceAccountKeyJson: string // raw JSON string
}

const DEFAULT_SPREADSHEET_ID = '1LPsSbE5Jmgxrbe6ZKjq0ObBdDTOq7t5a3zLyqRBo0Y8'

const DEFAULT_KEY_JSON = __SERVICE_ACCOUNT_KEY__

export function getSheetsConfig(): SheetsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { spreadsheetId: DEFAULT_SPREADSHEET_ID, serviceAccountKeyJson: DEFAULT_KEY_JSON }
}

export function saveSheetsConfig(cfg: SheetsConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

function extractSpreadsheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : urlOrId.trim()
}

export function getServiceAccountEmail(keyJson: string): string {
  try { return JSON.parse(keyJson).client_email ?? '' } catch { return '' }
}

// ─── IPC bridge ──────────────────────────────────────────────────────────────

async function sheetsRequest(opts: {
  spreadsheetId: string
  serviceAccountKeyJson: string
  method: 'GET' | 'POST' | 'PUT'
  path: string       // e.g. "/values/app-data"
  body?: unknown
}): Promise<unknown> {
  const id = extractSpreadsheetId(opts.spreadsheetId)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}${opts.path}`
  return window.electron.ipcRenderer.invoke('sheets-request', {
    url,
    method: opts.method,
    body: opts.body ?? null,
    serviceAccountKeyJson: opts.serviceAccountKeyJson,
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

export async function pushToSheets(): Promise<{ written: number }> {
  const cfg = getSheetsConfig()
  const entries: [string, string][] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (LOCAL_ONLY.has(key)) continue
    if (key.startsWith(SPX_PREFIX) || EXTRA_KEYS.includes(key)) entries.push([key, localStorage.getItem(key)!])
  }
  const rows = buildRows(entries, new Date().toISOString())
  await sheetsRequest({
    spreadsheetId: cfg.spreadsheetId,
    serviceAccountKeyJson: cfg.serviceAccountKeyJson,
    method: 'POST',
    path: '/values/app-data:clear',
  })
  await sheetsRequest({
    spreadsheetId: cfg.spreadsheetId,
    serviceAccountKeyJson: cfg.serviceAccountKeyJson,
    method: 'PUT',
    path: '/values/app-data?valueInputOption=RAW',
    body: { values: rows },
  })
  return { written: entries.length }
}

// ─── Pull from Sheets into localStorage ──────────────────────────────────────

export async function pullFromSheets(): Promise<{ restored: number }> {
  const cfg = getSheetsConfig()
  const result = await sheetsRequest({
    spreadsheetId: cfg.spreadsheetId,
    serviceAccountKeyJson: cfg.serviceAccountKeyJson,
    method: 'GET',
    path: '/values/app-data',
  }) as { values?: string[][] }
  const data = parseRows(result?.values ?? [])
  let count = 0
  for (const [key, value] of data) {
    if (LOCAL_ONLY.has(key)) continue
    if (key.startsWith(SPX_PREFIX) || EXTRA_KEYS.includes(key)) {
      localStorage.setItem(key, value)
      count++
    }
  }
  return { restored: count }
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testSheetsConnection(cfg: SheetsConfig): Promise<{ ok: boolean; error?: string; title?: string }> {
  try {
    const id = extractSpreadsheetId(cfg.spreadsheetId)
    const result = await window.electron.ipcRenderer.invoke('sheets-request', {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`,
      method: 'GET',
      body: null,
      serviceAccountKeyJson: cfg.serviceAccountKeyJson,
    }) as { properties?: { title?: string }; error?: { message?: string } }
    if (result?.error) return { ok: false, error: result.error.message ?? 'Erro desconhecido' }
    return { ok: true, title: result?.properties?.title }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
