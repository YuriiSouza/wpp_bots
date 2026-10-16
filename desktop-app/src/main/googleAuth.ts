// OAuth 2.0 por usuário (Google) para apps desktop: fluxo "installed app" com
// navegador do sistema, redirect em loopback (127.0.0.1) e PKCE. Nenhuma chave
// compartilhada é embutida — cada usuário entra com a própria conta Google e só
// acessa a planilha se ela estiver compartilhada com a conta dele.
import { app, shell, safeStorage } from 'electron'
import http from 'http'
import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { AddressInfo } from 'net'

declare const __GOOGLE_OAUTH__: { clientId: string; clientSecret: string }

const CLIENT_ID = __GOOGLE_OAUTH__.clientId
const CLIENT_SECRET = __GOOGLE_OAUTH__.clientSecret
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets openid email'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface AuthState {
  signedIn: boolean
  email?: string
}

interface StoredAuth {
  refreshToken: string
  email: string
}

let stored: StoredAuth | null = null
let accessToken: { token: string; expiresAt: number } | null = null

function storePath(): string {
  return path.join(app.getPath('userData'), 'google-auth.bin')
}

function loadStored(): StoredAuth | null {
  if (stored) return stored
  try {
    const file = storePath()
    if (!fs.existsSync(file)) return null
    const buf = fs.readFileSync(file)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
    stored = JSON.parse(json) as StoredAuth
    return stored
  } catch {
    return null
  }
}

function saveStored(data: StoredAuth): void {
  stored = data
  const json = JSON.stringify(data)
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  fs.writeFileSync(storePath(), buf)
}

function clearStored(): void {
  stored = null
  accessToken = null
  try {
    fs.unlinkSync(storePath())
  } catch {
    /* já não existe */
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = Object.entries(form)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const parsed = new URL(url)
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function decodeEmailFromIdToken(idToken?: string): string {
  if (!idToken) return ''
  try {
    const payload = idToken.split('.')[1]
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return (JSON.parse(json).email as string) ?? ''
  } catch {
    return ''
  }
}

export function getAuthState(): AuthState {
  const s = loadStored()
  return s ? { signedIn: true, email: s.email } : { signedIn: false }
}

export function signOut(): void {
  clearStored()
}

// Troca o refresh token por um access token novo (ou usa o cache em memória).
export async function getValidAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.token
  const s = loadStored()
  if (!s) throw new Error('NOT_SIGNED_IN')
  const data = await postForm(TOKEN_ENDPOINT, {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: s.refreshToken,
    grant_type: 'refresh_token',
  })
  const token = data.access_token as string | undefined
  if (!token) {
    // refresh token revogado/expirado → força novo login
    clearStored()
    throw new Error('NOT_SIGNED_IN')
  }
  accessToken = { token, expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 }
  return token
}

// Fluxo interativo: abre o navegador do sistema e captura o redirect no loopback.
export function signIn(): Promise<AuthState> {
  return new Promise((resolve, reject) => {
    const codeVerifier = b64url(crypto.randomBytes(32))
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest())
    const state = b64url(crypto.randomBytes(16))

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (!reqUrl.searchParams.has('code') && !reqUrl.searchParams.has('error')) {
          res.writeHead(404).end()
          return
        }
        const respond = (msg: string): void => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(
            `<!doctype html><html><head><meta charset="utf-8"><title>SPX Analytics</title></head>` +
              `<body style="font-family:system-ui;background:#0f1117;color:#e5e7eb;display:flex;height:100vh;` +
              `align-items:center;justify-content:center;margin:0"><div style="text-align:center">` +
              `<h2 style="color:#4ade80">${msg}</h2><p>Você já pode fechar esta aba e voltar ao app.</p></div></body></html>`,
          )
        }

        const err = reqUrl.searchParams.get('error')
        if (err) {
          respond('Login cancelado')
          server.close()
          reject(new Error(err))
          return
        }
        if (reqUrl.searchParams.get('state') !== state) {
          respond('Falha de segurança no login')
          server.close()
          reject(new Error('state mismatch'))
          return
        }

        const code = reqUrl.searchParams.get('code') as string
        const port = (server.address() as AddressInfo).port
        const tokenData = await postForm(TOKEN_ENDPOINT, {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: `http://127.0.0.1:${port}`,
        })

        const refreshToken = tokenData.refresh_token as string | undefined
        const token = tokenData.access_token as string | undefined
        if (!token) {
          respond('Falha ao autenticar')
          server.close()
          reject(new Error((tokenData.error_description as string) ?? 'sem access_token'))
          return
        }
        const email = decodeEmailFromIdToken(tokenData.id_token as string | undefined)
        if (refreshToken) saveStored({ refreshToken, email })
        accessToken = { token, expiresAt: Date.now() + (Number(tokenData.expires_in ?? 3600) - 60) * 1000 }

        respond('Login concluído ✓')
        server.close()
        resolve({ signedIn: true, email })
      } catch (e) {
        server.close()
        reject(e)
      }
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const authUrl =
        `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}`)}` +
        `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
        `&code_challenge=${codeChallenge}&code_challenge_method=S256` +
        `&access_type=offline&prompt=consent&state=${state}`
      shell.openExternal(authUrl)
    })

    // Timeout de segurança: 5 min para concluir o login.
    setTimeout(() => {
      if (server.listening) {
        server.close()
        reject(new Error('timeout'))
      }
    }, 5 * 60_000)
  })
}
