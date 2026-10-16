import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const spxAPI = {
  post: (url: string, headers: Record<string, string>, body: string): Promise<string> =>
    ipcRenderer.invoke('spx-post', { url, headers, body }),
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const updaterAPI = {
  check: (): Promise<{ ok?: boolean; dev?: boolean; version?: string | null; error?: string }> =>
    ipcRenderer.invoke('updater:check'),
  download: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('updater:download'),
  install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  onAvailable: (cb: (info: { version: string }) => void): (() => void) => subscribe('updater:available', cb),
  onNotAvailable: (cb: () => void): (() => void) => subscribe('updater:not-available', cb),
  onProgress: (cb: (p: UpdateProgress) => void): (() => void) => subscribe('updater:progress', cb),
  onDownloaded: (cb: (info: { version: string }) => void): (() => void) => subscribe('updater:downloaded', cb),
  onError: (cb: (e: { message: string }) => void): (() => void) => subscribe('updater:error', cb),
}

const fileAPI = {
  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('pick-folder', defaultPath),
  findLatestFile: (folder: string, pattern: string): Promise<{ name: string; content: string } | { error: string }> =>
    ipcRenderer.invoke('find-latest-file', { folder, pattern }),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('spxBridge', spxAPI)
    contextBridge.exposeInMainWorld('fileBridge', fileAPI)
    contextBridge.exposeInMainWorld('updater', updaterAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore
  window.spxBridge = spxAPI
  // @ts-ignore
  window.fileBridge = fileAPI
  // @ts-ignore
  window.updater = updaterAPI
}
