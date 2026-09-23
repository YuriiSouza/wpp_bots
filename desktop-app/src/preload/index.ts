import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const spxAPI = {
  post: (url: string, headers: Record<string, string>, body: string): Promise<string> =>
    ipcRenderer.invoke('spx-post', { url, headers, body }),
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
}
