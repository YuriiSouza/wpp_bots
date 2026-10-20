// Lê o "Copy as cURL" do navegador e tira só o que o app usa para falar com o SPX.
// Aceita o formato bash (Mac/Linux e "cURL (bash)" no Windows) e o formato cmd do Windows (^"...^").

export type SpxCreds = Record<string, string>

const WANTED = ['cookie', 'x-csrftoken', 'device-id', 'x-sap-ri', 'x-sap-sec'] as const

function normalize(curl: string): string {
  let s = curl.replace(/\r\n?/g, '\n')
  // cmd do Windows: tudo escapado com ^ (^" aspas, ^ no fim da linha, ^% etc.)
  if (s.includes('^"')) s = s.replace(/\^\n/g, ' ').replace(/\^(.)/g, '$1')
  // continuação de linha do bash
  s = s.replace(/\\\n/g, ' ')
  return s
}

export function parseSpxCurl(curl: string): SpxCreds {
  const s = normalize(curl)
  const out: SpxCreds = {}
  // -H 'x: y' · -H "x: y" · -H $'x: y' · --header ... · -b '...' · --cookie '...'
  const re = /(-H|--header|-b|--cookie)\s+\$?(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const flag = m[1]
    const value = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\(.)/g, '$1').trim()
    if (flag === '-b' || flag === '--cookie') { out['cookie'] = value; continue }
    const i = value.indexOf(':')
    if (i < 0) continue
    const name = value.slice(0, i).trim().toLowerCase()
    const v = value.slice(i + 1).trim()
    if ((WANTED as readonly string[]).includes(name) && v) out[name] = v
  }
  // Sem o cabeçalho x-csrftoken, o valor costuma estar no cookie csrftoken
  if (!out['x-csrftoken'] && out['cookie']) {
    const c = out['cookie'].match(/(?:^|;\s*)csrftoken=([^;]+)/)
    if (c) out['x-csrftoken'] = c[1]
  }
  return out
}

/** Explica por que o texto colado não serve, quando for o caso. */
export function curlProblem(curl: string): string | null {
  const t = curl.trim()
  if (!t) return null
  if (/Invoke-WebRequest|Invoke-RestMethod|New-Object Microsoft\.PowerShell/i.test(t)) return 'Isso é "Copy as PowerShell". Use "Copy as cURL (bash)" ou "Copy as cURL (cmd)".'
  if (/^fetch\(/i.test(t)) return 'Isso é "Copy as fetch". Use "Copy as cURL".'
  if (!/curl/i.test(t)) return 'Não parece um cURL. No F12 → Network, clique com o botão direito na requisição → Copy → Copy as cURL.'
  if (!/spx\.shopee/i.test(t)) return 'Esse cURL não é do SPX (spx.shopee.com.br).'
  return null
}
