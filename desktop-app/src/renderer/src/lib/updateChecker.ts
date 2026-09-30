import { getSheetsConfig } from './sheetsSync'

export interface UpdateInfo {
  version: string
  name: string
  url: string
  current: string
}

// Lists the releases folder on Drive (same service account as the spreadsheet) and returns the newest installer if it beats the running version.
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const { serviceAccountKeyJson } = getSheetsConfig()
    if (!serviceAccountKeyJson) return null
    const res = await window.electron.ipcRenderer.invoke('check-update', { serviceAccountKeyJson }) as {
      current: string
      latest: { version: string; name: string; url: string } | null
    }
    return res.latest ? { ...res.latest, current: res.current } : null
  } catch {
    return null
  }
}

export function getAppVersion(): Promise<string> {
  return window.electron.ipcRenderer.invoke('app-version')
}
