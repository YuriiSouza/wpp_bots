export function getAppVersion(): Promise<string> {
  return window.electron.ipcRenderer.invoke('app-version')
}
