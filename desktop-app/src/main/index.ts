import { app, shell, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import electronUpdater from 'electron-updater'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getAuthState, getValidAccessToken, signIn, signOut } from './googleAuth'

// electron-updater é CommonJS; em ESM o named export vem via default.
const { autoUpdater } = electronUpdater

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

// IPC: GET autenticado no SPX (ex.: detalhe da AT). Devolve status + corpo; 15 s de limite.
ipcMain.handle('spx-get', async (_event, { url, headers }: { url: string; headers: Record<string, string> }) => {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({ hostname: parsed.hostname, port: 443, path: parsed.pathname + parsed.search, method: 'GET', headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', err => reject(err))
    req.end()
  })
})

// IPC: tira um "print" de uma área da janela e põe na área de transferência (para colar no WhatsApp)
ipcMain.handle('copy-region-image', async (event, rect: { x: number; y: number; width: number; height: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  const img = await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
  clipboard.writeImage(img)
  return true
})

// IPC: abre dialog para escolher pasta
ipcMain.handle('pick-folder', async (_event, defaultPath?: string) => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: defaultPath || os.homedir() })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// IPC: encontra o arquivo mais recente numa pasta que bate com um padrão glob simples
ipcMain.handle('find-latest-file', async (_event, { folder, pattern }: { folder: string; pattern: string }) => {
  try {
    const resolved = folder.replace(/^~/, os.homedir())
    if (!fs.existsSync(resolved)) return { error: 'Pasta não encontrada: ' + resolved }

    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
    const allFiles = fs.readdirSync(resolved).filter(f => {
      try { return fs.statSync(path.join(resolved, f)).isFile() } catch { return false }
    })
    console.log('[find-latest-file] pattern:', pattern, 'regex:', regex.toString(), 'files in folder:', allFiles.slice(0, 20))
    const files = allFiles
      .filter(f => regex.test(f))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(resolved, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) {
      const similar = allFiles.filter(f => f.toLowerCase().includes(pattern.split('*')[0].toLowerCase())).slice(0, 5)
      return { error: `Nenhum arquivo encontrado com o padrão "${pattern}"${similar.length ? '. Parecidos: ' + similar.join(', ') : ''}` }
    }

    const filePath = path.join(resolved, files[0].name)
    const isBinary = /\.(xlsx?|xls)$/i.test(files[0].name)
    if (isBinary) {
      const content = fs.readFileSync(filePath).toString('base64')
      return { name: files[0].name, content, encoding: 'base64' }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return { name: files[0].name, content }
  } catch (err) {
    return { error: String(err) }
  }
})

// ─── Google Sheets API (token OAuth do usuário) ───────────────────────────────

function httpsGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
    req.end()
  })
}

function httpsPutPost(method: 'PUT' | 'POST', url: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const bodyBuf = Buffer.from(body, 'utf8')
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': bodyBuf.byteLength },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
    req.write(bodyBuf)
    req.end()
  })
}

async function ensureSheetTab(spreadsheetId: string, tabName: string, token: string): Promise<void> {
  // Get existing sheets
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`
  const meta = JSON.parse(await httpsGet(metaUrl, token)) as { sheets?: { properties: { title: string } }[] }
  const exists = meta.sheets?.some(s => s.properties.title === tabName)
  if (exists) return
  // Add new sheet
  await httpsPutPost('POST', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }), token)
}

ipcMain.handle('sheets-request', async (_event, { url, method, body }: {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  body: unknown
}) => {
  const token = await getValidAccessToken()

  // Auto-create app-data tab when writing/reading values
  const tabMatch = url.match(/\/spreadsheets\/([^/]+)\/values\/([^?:/]+)/)
  if (tabMatch) {
    const [, sid, tabRaw] = tabMatch
    const tabName = decodeURIComponent(tabRaw).replace(/:.*$/, '') // strip :clear etc
    try { await ensureSheetTab(sid, tabName, token) } catch {}
  }

  let raw: string
  if (method === 'GET') {
    raw = await httpsGet(url, token)
  } else {
    raw = await httpsPutPost(method, url, body ? JSON.stringify(body) : '', token)
  }
  return JSON.parse(raw)
})

// ─── Autenticação Google (OAuth por usuário) ──────────────────────────────────
ipcMain.handle('auth:state', () => getAuthState())
ipcMain.handle('auth:sign-in', async () => {
  try {
    return await signIn()
  } catch (err) {
    return { signedIn: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('auth:sign-out', () => {
  signOut()
  return { signedIn: false }
})

ipcMain.handle('app-version', () => app.getVersion())

// ─── Auto-update via GitHub Releases (electron-updater) ───────────────────────

function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false // só baixa quando o usuário clicar
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', info => sendToRenderer('updater:available', { version: info.version }))
  autoUpdater.on('update-not-available', () => sendToRenderer('updater:not-available'))
  autoUpdater.on('download-progress', p =>
    sendToRenderer('updater:progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    }),
  )
  autoUpdater.on('update-downloaded', info => sendToRenderer('updater:downloaded', { version: info.version }))
  autoUpdater.on('error', err =>
    sendToRenderer('updater:error', { message: err == null ? 'erro desconhecido' : err.message || String(err) }),
  )
}

// Renderer dispara a verificação (quando já está pronto pra ouvir os eventos).
ipcMain.handle('updater:check', async () => {
  if (is.dev) return { dev: true }
  try {
    const r = await autoUpdater.checkForUpdates()
    return { ok: true, version: r?.updateInfo?.version ?? null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('updater:install', () => {
  // isSilent=false mostra o assistente do NSIS; isForceRunAfter=true reabre o app ao terminar.
  autoUpdater.quitAndInstall(false, true)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.spx.analytics')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  setupAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
