import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'

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

// ─── Google Sheets API via Service Account JWT ────────────────────────────────

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

// Simple in-memory token cache: { email -> { token, expiresAt } }
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeServiceAccountJWT(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const unsigned = `${header}.${payload}`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(unsigned)
  const sig = sign.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${unsigned}.${sig}`
}

function httpsPost(url: string, body: string, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const bodyBuf = Buffer.from(body, 'utf8')
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': bodyBuf.byteLength },
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

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const cached = tokenCache.get(sa.client_email)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const jwt = makeServiceAccountJWT(sa)
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  const raw = await httpsPost(sa.token_uri ?? 'https://oauth2.googleapis.com/token', body, 'application/x-www-form-urlencoded')
  const data = JSON.parse(raw) as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(data.error ?? 'Falha ao obter token')
  tokenCache.set(sa.client_email, { token: data.access_token, expiresAt: Date.now() + 3500_000 })
  return data.access_token
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

ipcMain.handle('sheets-request', async (_event, { url, method, body, serviceAccountKeyJson }: {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  body: unknown
  serviceAccountKeyJson: string
}) => {
  const sa = JSON.parse(serviceAccountKeyJson) as ServiceAccountKey
  const token = await getAccessToken(sa)

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

// IPC: fetch simples GET (para verificar atualizações)
ipcMain.handle('fetch-url', async (_event, url: string) => {
  return new Promise<string>((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : require('http')
    const req = mod.get(url, { headers: { 'User-Agent': 'SPX-Analytics/1.0' } }, (res: import('http').IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        mod.get(res.headers.location, { headers: { 'User-Agent': 'SPX-Analytics/1.0' } }, (res2: import('http').IncomingMessage) => {
          const chunks: Buffer[] = []
          res2.on('data', (c: Buffer) => chunks.push(c))
          res2.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        }).on('error', reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
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
