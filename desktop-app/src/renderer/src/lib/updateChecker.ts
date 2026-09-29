export const CURRENT_VERSION = '1.0.0'

const UPDATE_URL_KEY = 'spx:update-url'
const DEFAULT_URL = '' // preenchido nas configurações

export interface UpdateInfo {
  version: string
  notes?: string
  url?: string
}

export function getUpdateUrl(): string {
  try { return localStorage.getItem(UPDATE_URL_KEY) ?? DEFAULT_URL } catch { return DEFAULT_URL }
}

export function saveUpdateUrl(url: string) {
  localStorage.setItem(UPDATE_URL_KEY, url)
}

function parseVersion(v: string): number[] {
  return v.replace(/[^0-9.]/g, '').split('.').map(Number)
}

function isNewer(remote: string, current: string): boolean {
  const r = parseVersion(remote)
  const c = parseVersion(current)
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] ?? 0, cv = c[i] ?? 0
    if (rv > cv) return true
    if (rv < cv) return false
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const url = getUpdateUrl()
  if (!url) return null
  try {
    const raw = await window.electron.ipcRenderer.invoke('fetch-url', url)
    const data = JSON.parse(raw) as UpdateInfo
    if (!data.version) return null
    return isNewer(data.version, CURRENT_VERSION) ? data : null
  } catch {
    return null
  }
}
