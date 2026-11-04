// Busca o motorista de cada rota direto no SPX, pela AT (substitui o relatório br_assignment_task).
// Mesma chamada da tela "Assignment Task" do SPX: uma consulta por AT, com até 3 tentativas.

const DETAIL_URL = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/detail?assignment_task_id='
const CREDS_KEY = 'spx:credentials'
const CONCURRENCY = 2 // rajadas disparam o antirrobô do SPX (90309999); mantemos poucas em paralelo

export interface AtDetail {
  atId: string
  driverId: string   // '' = AT sem motorista
  driverName: string
  cage: string
}

export class SpxSessionError extends Error {}

// Igual ao outro sistema que já funciona: só os cabeçalhos de sessão, SEM os x-sap-* —
// eles são assinaturas geradas para cada requisição do site e invalidam a consulta se reaproveitados.
function headers(creds: Record<string, string>, withSap: boolean): Record<string, string> {
  return {
    'accept': 'application/json, text/plain, */*',
    'accept-language': creds['accept-language'] || 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'app': 'FMS Portal',
    'cookie': creds['cookie'] ?? '',
    'device-id': creds['device-id'] ?? '',
    'referer': 'https://spx.shopee.com.br/',
    'user-agent': creds['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-csrftoken': creds['x-csrftoken'] ?? '',
    // Mesmos cabeçalhos que o navegador manda numa chamada do próprio site
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...(withSap && creds['x-sap-ri'] ? { 'x-sap-ri': creds['x-sap-ri'] } : {}),
    ...(withSap && creds['x-sap-sec'] ? { 'x-sap-sec': creds['x-sap-sec'] } : {}),
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const snippet = (body: string) => body.replace(/\s+/g, ' ').slice(0, 140)

// 90309999 = antirrobô do SPX (a sessão segue válida: o corpo traz "is_login":true).
const isAntiBot = (body: string) => /90309999/.test(body)
// Falha real de sessão: 401, ou 403 que não é antirrobô e não indica login ativo.
const isSessionFail = (status: number, body: string) =>
  status === 401 || (status === 403 && !isAntiBot(body) && !/"is_login"\s*:\s*true/.test(body))

// Variante de cabeçalhos que funcionou (descoberta na 1ª AT e reaproveitada nas outras)
let workingSap: boolean | null = null

async function getOnce(creds: Record<string, string>, atId: string, withSap: boolean) {
  return await window.electron.ipcRenderer.invoke('spx-get', { url: DETAIL_URL + encodeURIComponent(atId), headers: headers(creds, withSap) }) as { status: number; body: string }
}

async function fetchOne(creds: Record<string, string>, atId: string): Promise<AtDetail> {
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const variants = workingSap === null ? [false, true] : [workingSap]
      let sessionFail = ''
      let antiBot = false
      for (const withSap of variants) {
        const res = await getOnce(creds, atId, withSap)
        if (res.status === 429 || res.status >= 500) { lastErr = `SPX ${res.status}`; break }
        // Antirrobô: a sessão está ok; só esperar e repetir (não é caso de colar cURL novo).
        if (isAntiBot(res.body)) { antiBot = true; lastErr = 'SPX antirrobô (90309999)'; break }
        if (isSessionFail(res.status, res.body)) { sessionFail = `SPX ${res.status}: ${snippet(res.body)}`; continue }
        let data: { retcode: number; message?: string; data?: { driver_id?: number; driver_name?: string; corridor_cage?: string } }
        try { data = JSON.parse(res.body) } catch { sessionFail = `resposta não é JSON (HTTP ${res.status}): ${snippet(res.body)}`; continue }
        if (data.retcode !== 0) { lastErr = `SPX retcode ${data.retcode}: ${data.message ?? ''}`; continue }
        workingSap = withSap
        const d = data.data ?? {}
        return { atId, driverId: d.driver_id ? String(d.driver_id) : '', driverName: d.driver_name ?? '', cage: d.corridor_cage ?? '' }
      }
      if (sessionFail && !lastErr.startsWith('SPX retcode')) throw new SpxSessionError(`Sessão do SPX recusada — cole um cURL novo em Atribuição › SPX. (${sessionFail})`)
      // Antirrobô espera mais entre as tentativas; demais falhas, espera padrão.
      if (attempt < 4) await sleep((antiBot ? 2500 : 800) * attempt)
    } catch (e) {
      if (e instanceof SpxSessionError) throw e
      if (e instanceof Error && /No handler registered/i.test(e.message)) throw new SpxSessionError('Feche e abra o app de novo para ativar a consulta de AT no SPX.')
      lastErr = e instanceof Error ? e.message : String(e)
      if (attempt < 3) await sleep(800 * attempt)
    }
  }
  if (lastErr.includes('antirrobô')) throw new Error('SPX antirrobô (90309999) — a sessão está ok; aguarde ~1 min e tente de novo.')
  throw new Error(lastErr || 'falha')
}

/** Consulta cada AT uma vez. Para tudo se a sessão expirar; outras falhas ficam em `failed`. */
export async function fetchAtDetails(atIds: string[], onProgress?: (done: number, total: number) => void): Promise<{ details: Map<string, AtDetail>; failed: { atId: string; error: string }[] }> {
  let creds: Record<string, string> | null = null
  try { creds = JSON.parse(localStorage.getItem(CREDS_KEY) ?? 'null') } catch { /* */ }
  if (!creds?.cookie) throw new SpxSessionError('Sessão do SPX não configurada. Cole o cURL em Atribuição › SPX.')
  workingSap = null
  const unique = [...new Set(atIds.filter(Boolean))]
  const details = new Map<string, AtDetail>()
  const failed: { atId: string; error: string }[] = []
  let next = 0, done = 0
  const worker = async () => {
    while (next < unique.length) {
      const atId = unique[next++]
      try { details.set(atId, await fetchOne(creds!, atId)) }
      catch (e) { if (e instanceof SpxSessionError) throw e; failed.push({ atId, error: e instanceof Error ? e.message : String(e) }) }
      onProgress?.(++done, unique.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))
  return { details, failed }
}
