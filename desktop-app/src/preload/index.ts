import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const spxAPI = {
  post: (url: string, headers: Record<string, string>, body: string): Promise<string> =>
    ipcRenderer.invoke('spx-post', { url, headers, body }),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('spxBridge', spxAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore
  window.spxBridge = spxAPI
}
