import Constants from 'expo-constants'
import { KJUR, KEYUTIL } from 'jsrsasign'
import { storage } from './storage'

const CONFIG_KEY = 'spx:sheets-config'
const LAST_SYNC_KEY = 'mobile:last-sync'
const TAB = 'app-data'
const CHUNK = 45000
export const DEFAULT_SPREADSHEET_ID = '1LPsSbE5Jmgxrbe6ZKjq0ObBdDTOq7t5a3zLyqRBo0Y8'

export interface SheetsConfig {
  spreadsheetId: string
  serviceAccountKeyJson: string
}

const LOCAL_ONLY = new Set([CONFIG_KEY, 'spx:header', 'spx:credentials'])
const isSynced = (k: string) => (k.startsWith('spx:') || k === 'spx_ds_result') && !LOCAL_ONLY.has(k)

export function getSheetsConfig(): SheetsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { spreadsheetId: DEFAULT_SPREADSHEET_ID, serviceAccountKeyJson: (Constants.expoConfig?.extra?.serviceAccountKeyJson as string | undefined) ?? '' }
}

export function saveSheetsConfig(cfg: SheetsConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

export function getLastSync(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY)
}

export function getServiceAccountEmail(keyJson: string): string {
  try { return JSON.parse(keyJson).client_email ?? '' } catch { return '' }
}

function spreadsheetId(urlOrId: string) {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : urlOrId.trim()
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null

async function accessToken(keyJson: string): Promise<string> {
  let sa: { client_email: string; private_key: string; token_uri?: string }
  try { sa = JSON.parse(keyJson) } catch { throw new Error('Chave JSON inválida. Cole a chave da conta de serviço em Configurações.') }
  if (!sa.client_email || !sa.private_key) throw new Error('Chave JSON sem client_email/private_key.')
  if (cachedToken?.email === sa.client_email && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const jwt = KJUR.jws.JWS.sign('RS256',
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud, iat: now, exp: now + 3600 }),
    KEYUTIL.getKey(sa.private_key) as never)
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json() as { access_token?: string; error_description?: string; error?: string }
  if (!data.access_token) throw new Error(data.error_description ?? data.error ?? 'Falha ao autenticar no Google')
  cachedToken = { email: sa.client_email, token: data.access_token, expiresAt: Date.now() + 3500_000 }
  return data.access_token
}

async function api(cfg: SheetsConfig, method: string, path: string, body?: unknown) {
  const token = await accessToken(cfg.serviceAccountKeyJson)
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId(cfg.spreadsheetId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown> & { error?: { message?: string } }
  if (data.error) throw new Error(data.error.message ?? `Erro ${res.status} no Sheets`)
  return data
}

async function ensureTab(cfg: SheetsConfig) {
  const meta = await api(cfg, 'GET', '?fields=sheets.properties.title') as { sheets?: { properties: { title: string } }[] }
  if (meta.sheets?.some(s => s.properties.title === TAB)) return
  await api(cfg, 'POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: TAB } } }] })
}

function parseRows(rows: string[][]): Map<string, string> {
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

function buildRows(entries: Map<string, string>, now: string): string[][] {
  const rows: string[][] = [['key', 'part', 'value', 'exportedAt']]
  for (const [key, value] of entries) {
    for (let i = 0, part = 0; i < Math.max(value.length, 1); i += CHUNK, part++) {
      rows.push([key, String(part), value.slice(i, i + CHUNK), now])
    }
  }
  return rows
}

async function readRemote(cfg: SheetsConfig): Promise<Map<string, string>> {
  await ensureTab(cfg)
  const res = await api(cfg, 'GET', `/values/${TAB}`) as { values?: string[][] }
  return parseRows(res.values ?? [])
}

export async function testConnection(cfg: SheetsConfig): Promise<string> {
  const res = await api(cfg, 'GET', '?fields=properties.title') as { properties?: { title?: string } }
  return res.properties?.title ?? '(sem título)'
}

// Pull remote data, keep local edits made since the last sync, and write the merge back when there are local edits.
export async function syncWithSheets(): Promise<{ pulled: number; pushed: number }> {
  const cfg = getSheetsConfig()
  const remote = await readRemote(cfg)
  const localEdits = storage.dirtyKeys().filter(isSynced)
  storage.applyRemote(new Map([...remote].filter(([k]) => isSynced(k))), isSynced)

  if (localEdits.length) {
    const merged = new Map(remote)
    for (const k of localEdits) {
      const v = localStorage.getItem(k)
      if (v === null) merged.delete(k)
      else merged.set(k, v)
    }
    await api(cfg, 'POST', `/values/${TAB}:clear`, {})
    await api(cfg, 'PUT', `/values/${TAB}?valueInputOption=RAW`, { values: buildRows(merged, new Date().toISOString()) })
  }
  storage.clearDirty()
  localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
  return { pulled: remote.size, pushed: localEdits.length }
}
