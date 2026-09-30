const CONFIG_KEY = 'spx:sheets-config'
const EXTRA_KEYS = ['spx_ds_result']
const SPX_PREFIX = 'spx:'

export interface SheetsConfig {
  spreadsheetId: string
  serviceAccountKeyJson: string // raw JSON string
}

const DEFAULT_SPREADSHEET_ID = '1LPsSbE5Jmgxrbe6ZKjq0ObBdDTOq7t5a3zLyqRBo0Y8'

const DEFAULT_KEY_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'shopee-convocation-control',
  private_key_id: 'REMOVED',
  private_key: 'REMOVED',
  client_email: 'sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com',
  client_id: '110967511887028605112',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/sheets-convocation%40shopee-convocation-control.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
})

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

export async function pushToSheets(): Promise<{ written: number }> {
  const cfg = getSheetsConfig()
  const rows: string[][] = [['key', 'value', 'exportedAt']]
  const now = new Date().toISOString()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (key.startsWith(SPX_PREFIX) || EXTRA_KEYS.includes(key)) {
      rows.push([key, localStorage.getItem(key)!, now])
    }
  }
  // Clear existing data then write
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
  return { written: rows.length - 1 }
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
  const rows = result?.values ?? []
  let count = 0
  // skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const [key, value] = rows[i]
    if (!key || !value) continue
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
