import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import https from 'https'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC handler: proxy HTTP POST para o SPX (sem restrições CORS do renderer)
ipcMain.handle('spx-post', async (_event, { url, headers, body }: { url: string; headers: Record<string, string>; body: string }) => {
  return new Promise<string>((resolve, reject) => {
    const parsed = new URL(url)
    const bodyBuf = Buffer.from(body, 'utf8')
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'content-length': bodyBuf.byteLength,
      },
    }
    console.log('[spx-post] →', options.hostname, options.path)
    const req = https.request(options, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8')
        console.log('[spx-post] ← status', res.statusCode, 'len', data.length)
        resolve(data)
      })
    })
    req.on('error', err => {
      console.error('[spx-post] error', err.message)
      reject(err)
    })
    req.write(bodyBuf)
    req.end()
  })
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.spx.analytics')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
