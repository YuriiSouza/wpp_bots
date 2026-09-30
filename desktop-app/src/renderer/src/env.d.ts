declare const __SERVICE_ACCOUNT_KEY__: string

interface Window {
  electron: {
    ipcRenderer: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: (channel: string, ...args: unknown[]) => Promise<any>
    }
  }
}
