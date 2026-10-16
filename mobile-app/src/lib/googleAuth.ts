// OAuth por usuário (Google) no mobile via expo-auth-session: authorization code
// + PKCE, sem segredo embutido. Cada usuário entra com a própria conta e só acessa
// a planilha se ela estiver compartilhada com a conta dele.
import { useEffect } from 'react'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import * as SecureStore from 'expo-secure-store'

WebBrowser.maybeCompleteAuthSession()

// Client ID do tipo "Android" (sem secret). O redirect usa o esquema reverso do
// client id, que também está registrado em app.json → expo.scheme.
const ANDROID_CLIENT_ID = '196424894215-2s93ruclcqadgq9ukdcackmmn6nqq22d.apps.googleusercontent.com'
const REVERSED = 'com.googleusercontent.apps.196424894215-2s93ruclcqadgq9ukdcackmmn6nqq22d'
const REDIRECT_URI = AuthSession.makeRedirectUri({ native: `${REVERSED}:/oauthredirect` })
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'openid', 'email']

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
}

const RT_KEY = 'google_refresh_token'
const EMAIL_KEY = 'google_email'

let memToken: { token: string; expiresAt: number } | null = null

function emailFromIdToken(idToken?: string | null): string {
  if (!idToken) return ''
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    // atob existe no Hermes (RN 0.86)
    const json = decodeURIComponent(
      Array.prototype.map
        .call(atob(payload), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    return (JSON.parse(json).email as string) ?? ''
  } catch {
    return ''
  }
}

async function saveSession(tok: AuthSession.TokenResponse): Promise<void> {
  memToken = {
    token: tok.accessToken,
    expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000 - 60_000,
  }
  if (tok.refreshToken) await SecureStore.setItemAsync(RT_KEY, tok.refreshToken)
  const email = emailFromIdToken(tok.idToken)
  if (email) await SecureStore.setItemAsync(EMAIL_KEY, email)
}

export async function isSignedIn(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(RT_KEY))
}

export async function getAuthEmail(): Promise<string> {
  return (await SecureStore.getItemAsync(EMAIL_KEY)) ?? ''
}

export async function signOut(): Promise<void> {
  memToken = null
  await SecureStore.deleteItemAsync(RT_KEY)
  await SecureStore.deleteItemAsync(EMAIL_KEY)
}

// Usado pelo sheetsSync: devolve um access token válido (renovando pelo refresh token).
export async function getValidAccessToken(): Promise<string> {
  if (memToken && memToken.expiresAt > Date.now()) return memToken.token
  const refreshToken = await SecureStore.getItemAsync(RT_KEY)
  if (!refreshToken) throw new Error('NOT_SIGNED_IN')
  const res = await AuthSession.refreshAsync({ clientId: ANDROID_CLIENT_ID, refreshToken }, DISCOVERY)
  memToken = { token: res.accessToken, expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000 - 60_000 }
  if (res.refreshToken) await SecureStore.setItemAsync(RT_KEY, res.refreshToken)
  return res.accessToken
}

// Hook para a tela de configurações: dispara o login interativo.
export function useGoogleSignIn(onDone: (email: string | null, error?: string) => void): {
  ready: boolean
  promptAsync: () => void
} {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: ANDROID_CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scopes: SCOPES,
      usePKCE: true,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    DISCOVERY,
  )

  useEffect(() => {
    if (!response) return
    if (response.type === 'success' && request?.codeVerifier) {
      AuthSession.exchangeCodeAsync(
        {
          clientId: ANDROID_CLIENT_ID,
          code: response.params.code,
          redirectUri: REDIRECT_URI,
          extraParams: { code_verifier: request.codeVerifier },
        },
        DISCOVERY,
      )
        .then(async tok => {
          await saveSession(tok)
          onDone(await getAuthEmail())
        })
        .catch(e => onDone(null, e instanceof Error ? e.message : String(e)))
    } else if (response.type === 'error') {
      onDone(null, response.error?.message ?? 'Falha no login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só à resposta do fluxo OAuth
  }, [response])

  return { ready: !!request, promptAsync: () => void promptAsync() }
}
