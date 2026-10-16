interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface Window {
  electron: {
    ipcRenderer: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: (channel: string, ...args: unknown[]) => Promise<any>
    }
  }
  updater: {
    check: () => Promise<{ ok?: boolean; dev?: boolean; version?: string | null; error?: string }>
    download: () => Promise<{ ok: boolean; error?: string }>
    install: () => Promise<void>
    onAvailable: (cb: (info: { version: string }) => void) => () => void
    onNotAvailable: (cb: () => void) => () => void
    onProgress: (cb: (p: UpdateProgress) => void) => () => void
    onDownloaded: (cb: (info: { version: string }) => void) => () => void
    onError: (cb: (e: { message: string }) => void) => () => void
  }
  auth: {
    getState: () => Promise<{ signedIn: boolean; email?: string }>
    signIn: () => Promise<{ signedIn: boolean; email?: string; error?: string }>
    signOut: () => Promise<{ signedIn: boolean }>
  }
}
