import { app, shell, BrowserWindow, ipcMain, dialog, clipboard, net } from 'electron'
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
// O Chromium recusa (net::ERR_INVALID_ARGUMENT) cabeçalhos que só o próprio navegador pode definir
const FORBIDDEN = /^(sec-|host$|connection$|content-length$|accept-encoding$|keep-alive$|transfer-encoding$|upgrade$|via$|te$|trailer$|expect$|proxy-|origin$)/i
const chromiumHeaders = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k, v]) => v !== '' && !FORBIDDEN.test(k)))

// Plano B: o módulo https do Node, caso a pilha do Chromium recuse a requisição
function nodeRequest(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const buf = body ? Buffer.from(body, 'utf8') : null
    const req = https.request({ hostname: parsed.hostname, port: 443, path: parsed.pathname + parsed.search, method, headers: buf ? { ...headers, 'content-length': buf.byteLength } : headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(30000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (buf) req.write(buf)
    req.end()
  })
}

async function spxRequest(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string, timeoutMs = 30000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, { method, headers: chromiumHeaders(headers), body, signal: ctrl.signal })
    return { status: res.status, body: await res.text() }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('timeout')
    console.warn('[spx] net.fetch falhou, usando https do Node:', e instanceof Error ? e.message : e)
    return nodeRequest(url, method, headers, body)
  } finally {
    clearTimeout(timer)
  }
}

ipcMain.handle('spx-post', async (_event, { url, headers, body }: { url: string; headers: Record<string, string>; body: string }) => {
  // Pilha de rede do Chromium (igual ao navegador): o antirrobô do SPX recusa com 90309999
  // parte das chamadas feitas pelo módulo https do Node.
  console.log('[spx-post] →', new URL(url).pathname)
  const res = await spxRequest(url, 'POST', headers, body)
  console.log('[spx-post] ← status', res.status, 'len', res.body.length)
  return res.body
})



// IPC: GET autenticado no SPX (ex.: detalhe da AT). Devolve status + corpo; 15 s de limite.
ipcMain.handle('spx-get', async (_event, { url, headers }: { url: string; headers: Record<string, string> }) => {
  return spxRequest(url, 'GET', headers, undefined, 15000)
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
