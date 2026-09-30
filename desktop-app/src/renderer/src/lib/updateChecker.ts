export const CURRENT_VERSION = '1.0.0'

const UPDATE_URL = 'https://drive.google.com/uc?export=download&id=1GPuzg9PX68NEwwejOIaX4bxWriRDzTOe'

export interface UpdateInfo {
  version: string
  notes?: string
  url?: string
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
  try {
    const url = UPDATE_URL
    const raw = await window.electron.ipcRenderer.invoke('fetch-url', url)
    const data = JSON.parse(raw) as UpdateInfo
    if (!data.version) return null
    return isNewer(data.version, CURRENT_VERSION) ? data : null
  } catch {
    return null
  }
}
