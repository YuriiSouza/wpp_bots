// Leitura direta de planilhas Google (via login Google do usuário, processo main).
// - Roteirização: guias "Plano de expedição" (rotas) e "Calculation Tasks (CTs)" (pacotes)
// - Base de EHA: guia "[IR] Base de BRs"
// Só o LINK fica salvo; os dados são buscados na hora e guardados localmente (não sincroniza).

import { parseRoutesTsv, type LocalRoute } from './noshowRouteParser'
import type { Shift } from './globalConfig'

export function extractSheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : urlOrId.trim()
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function sheetsGet<T>(url: string): Promise<T> {
  try {
    const res = await window.electron.ipcRenderer.invoke('sheets-request', { url, method: 'GET', body: null, readOnly: true }) as T & { error?: { message?: string; status?: string } }
    if (res && (res as { error?: { message?: string } }).error) {
      const e = (res as { error: { message?: string; status?: string } }).error
      if (e.status === 'PERMISSION_DENIED') throw new Error('Sua conta Google não tem acesso a essa planilha. Peça acesso ao dono ou entre com outra conta em Configurações.')
      throw new Error(e.message ?? 'Erro ao ler a planilha')
    }
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/NOT_SIGNED_IN/i.test(msg)) throw new Error('Entre com sua conta Google em Configurações › Google Sheets para ler a planilha.')
    throw err
  }
}

async function listTabs(id: string): Promise<string[]> {
  const meta = await sheetsGet<{ sheets?: { properties: { title: string } }[] }>(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title)`)
  return (meta.sheets ?? []).map(s => s.properties.title)
}

function findTab(tabs: string[], wanted: string[]): string | null {
  for (const w of wanted) { const t = tabs.find(x => norm(x) === norm(w)); if (t) return t }
  for (const w of wanted) { const t = tabs.find(x => norm(x).includes(norm(w))); if (t) return t }
  return null
}

async function readTab(id: string, title: string, raw = false): Promise<string[][]> {
  // raw: valores sem formatação (número puro, ex. -16.3649754), sem depender do separador do locale da planilha
  const res = await sheetsGet<{ values?: string[][] }>(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}${raw ? '?valueRenderOption=UNFORMATTED_VALUE' : ''}`)
  return (res.values ?? []).map(r => r.map(c => String(c ?? '')))
}

/** Acha a linha de cabeçalho (a que contém todas as colunas pedidas) e devolve índice por nome normalizado. */
function headerOf(rows: string[][], must: string[]): { idx: number; col: (name: string) => number } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(norm)
    if (must.every(m => h.includes(norm(m)))) {
      return { idx: i, col: (name: string) => h.indexOf(norm(name)) }
    }
  }
  return null
}

// ── números no formato brasileiro ───────────────────────────────────────────
/** "5.500" → 5500 · "1.391" → 1391 · "29.760" → 29760 · "38,716" → 38.716 */
export function brNum(v: string | undefined): number | null {
  const s = (v ?? '').trim().replace(/[^\d.,-]/g, '')
  if (!s) return null
  let t = s
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
/** Coordenada que perdeu a vírgula: "-163.649.754" / "-489848577" → -16.3649754 / -48.9848577 */
export function brCoord(v: string | undefined): number | null {
  const s = (v ?? '').trim()
  if (!s) return null
  if (/^-?\d{1,2}\.\d{4,}$/.test(s)) return Number(s)
  const neg = s.startsWith('-')
  const digits = s.replace(/\D/g, '')
  if (digits.length < 3) return null
  const n = Number(`${digits.slice(0, 2)}.${digits.slice(2)}`)
  return neg ? -n : n
}

// ── Roteirização ────────────────────────────────────────────────────────────

export interface CtPackage {
  at: string
  seq: number | null
  stop: number | null
  tn: string
  zip: string
  cluster: string
  address: string
  city: string
  neighborhood: string
  addressType: string
  category: string      // S / M / L / ...
  lat: number | null
  lon: number | null
  deliveryLabel: string
  dims: [number | null, number | null, number | null]
  volumeCm3: number | null
  weightG: number | null
  cage: string
  plannedVehicle: string
  rota: string
  durationSec: number | null
  wave: string
  routeKm: number | null
  cepHead: string
}

export interface RoutingSheetData {
  routes: LocalRoute[]
  packages: CtPackage[]
  tabs: { plano: string | null; cts: string | null }
  fetchedAt: string
}

export async function fetchRoutingSheet(url: string): Promise<RoutingSheetData> {
  const id = extractSheetId(url)
  if (!id) throw new Error('Link da planilha inválido')
  const tabs = await listTabs(id)
  const plano = findTab(tabs, ['Plano de expedição', 'Plano de expedicao'])
  const cts = findTab(tabs, ['Calculation Tasks (CTs)', 'Calculation Tasks', 'CTs'])
  if (!plano) throw new Error(`Guia "Plano de expedição" não encontrada. Guias da planilha: ${tabs.join(', ')}`)

  const planoRows = await readTab(id, plano)
  const h = headerOf(planoRows, ['AT / TO', 'Gaiola'])
  if (!h) throw new Error('Não achei o cabeçalho (AT / TO, Gaiola) na guia Plano de expedição')
  const tsv = planoRows.slice(h.idx).map(r => r.join('\t')).join('\n')
  const routes = parseRoutesTsv(tsv)

  let packages: CtPackage[] = []
  if (cts) {
    const rows = await readTab(id, cts)
    const ch = headerOf(rows, ['AT', 'SPX TN'])
    if (ch) {
      const c = (n: string) => ch.col(n)
      const I = {
        at: c('AT'), seq: c('Sequence'), stop: c('Stop'), tn: c('SPX TN'), zip: c('Zipcode'), cluster: c('Cluster'),
        addr: c('Destination Address'), city: c('City'), nb: c('Neighborhood'), at2: c('Address Type'), cat: c('Parcel Category'),
        lat: c('Latitude'), lon: c('Longitude'), label: c('Delivery Success Label'), l: c('Length(cm)'), w: c('Width(cm)'), hh: c('Height(cm)'),
        vol: c('Order Volume'), kg: c('Weight (kg)'), cage: c('Corridor Cage'), veh: c('Planned Vehicle Type'), rota: c('Rota'),
        dur: c('Duração em segundos'), wave: c('Onda de roteirização'), km: c('Distância total da rota km'), cep: c('Cabeça de CEP'),
      }
      // Latitude/Longitude: aceita variações do nome da coluna e uma coluna única "lat, lon"
      const hdr = rows[ch.idx].map(norm)
      const findCol = (names: string[], frag: RegExp) => {
        for (const n of names) { const i = hdr.indexOf(norm(n)); if (i >= 0) return i }
        return hdr.findIndex(h => frag.test(h))
      }
      I.lat = findCol(['Latitude', 'Lat', 'Destination Latitude', 'Delivery Latitude', 'Buyer Latitude'], /lat/)
      I.lon = findCol(['Longitude', 'Lon', 'Lng', 'Long', 'Destination Longitude', 'Delivery Longitude', 'Buyer Longitude'], /lon|lng/)
      if (I.lon === I.lat) I.lon = -1
      const coordCol = I.lat < 0 ? hdr.findIndex(h => /coord|latlon|latlng|geo/.test(h)) : -1
      // Mesma guia lida sem formatação: as coordenadas vêm como número puro
      let rawRows: string[][] = []
      try { rawRows = await readTab(id, cts, true) } catch { rawRows = [] }
      const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
      const coordOf = (k: number, i: number, isLat: boolean): number | null => {
        const rv = Number(g(rawRows[k] ?? [], i).replace(',', '.'))
        const lim = isLat ? 90 : 180
        if (g(rawRows[k] ?? [], i) && Number.isFinite(rv) && rv !== 0 && Math.abs(rv) <= lim) return rv
        const f = brCoord(g(rows[k], i))
        return f != null && Math.abs(f) <= lim ? f : null
      }
      const pairOf = (k: number): [number | null, number | null] => {
        if (coordCol < 0) return [I.lat >= 0 ? coordOf(k, I.lat, true) : null, I.lon >= 0 ? coordOf(k, I.lon, false) : null]
        const m = g(rows[k], coordCol).match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/)
        return m ? [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))] : [null, null]
      }
      for (let k = ch.idx + 1; k < rows.length; k++) {
        const r = rows[k]
        const at = g(r, I.at)
        const tn = g(r, I.tn)
        if (!at.startsWith('AT') || !tn) continue
        packages.push({
          at, tn, seq: brNum(g(r, I.seq)), stop: brNum(g(r, I.stop)), zip: g(r, I.zip), cluster: g(r, I.cluster),
          address: g(r, I.addr), city: g(r, I.city), neighborhood: g(r, I.nb), addressType: g(r, I.at2), category: g(r, I.cat),
          lat: pairOf(k)[0], lon: pairOf(k)[1], deliveryLabel: g(r, I.label),
          dims: [brNum(g(r, I.l)), brNum(g(r, I.w)), brNum(g(r, I.hh))],
          volumeCm3: brNum(g(r, I.vol)), weightG: brNum(g(r, I.kg)), cage: g(r, I.cage), plannedVehicle: g(r, I.veh).toUpperCase(),
          rota: g(r, I.rota), durationSec: brNum(g(r, I.dur)), wave: g(r, I.wave),
          routeKm: (() => { const v = parseFloat(g(r, I.km).replace(',', '.')); return Number.isFinite(v) ? v : null })(), cepHead: g(r, I.cep),
        })
      }
    }
  }
  return { routes, packages, tabs: { plano, cts }, fetchedAt: new Date().toISOString() }
}

// Link por dia/turno (sincroniza: é só o link) + último usado como sugestão
const LINKS_KEY = 'spx:routing-sheet-links'
export function getRoutingLink(day: string, shift: Shift): string {
  try {
    const m = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') as Record<string, string>
    return m[`${day}|${shift}`] ?? ''
  } catch { return '' }
}
export function getLastRoutingLink(): string {
  try { return (JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') as Record<string, string>)['__last'] ?? '' } catch { return '' }
}
export function saveRoutingLink(day: string, shift: Shift, url: string) {
  try {
    const m = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') as Record<string, string>
    m[`${day}|${shift}`] = url
    m.__last = url
    // guarda só os 60 mais recentes
    const keys = Object.keys(m).filter(k => k !== '__last').sort()
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete m[k]
    localStorage.setItem(LINKS_KEY, JSON.stringify(m))
  } catch { /* */ }
}

// Pacotes (CTs) guardados localmente por dia/turno — volume grande, não vai para o Sheets
const ctKey = (day: string, shift: Shift) => `local:ct:${day}:${shift}`
export function saveCtPackages(day: string, shift: Shift, pk: CtPackage[]) {
  try {
    // remove CTs antigos para não estourar o localStorage (fica com os 6 últimos turnos)
    const old = Object.keys(localStorage).filter(k => k.startsWith('local:ct:')).sort()
    for (const k of old.slice(0, Math.max(0, old.length - 5))) if (k !== ctKey(day, shift)) localStorage.removeItem(k)
    localStorage.setItem(ctKey(day, shift), JSON.stringify(pk))
  } catch {
    // Sem espaço: apaga os CTs dos outros turnos e tenta de novo
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('local:ct:') && k !== ctKey(day, shift)) localStorage.removeItem(k)
      localStorage.setItem(ctKey(day, shift), JSON.stringify(pk))
    } catch { console.warn('[CT] pacotes não couberam no armazenamento local', pk.length) }
  }
}
export function getCtPackages(day: string, shift: Shift): CtPackage[] {
  try { return JSON.parse(localStorage.getItem(ctKey(day, shift)) ?? '[]') as CtPackage[] } catch { return [] }
}

// ── Base de EHA ─────────────────────────────────────────────────────────────

export interface EhaRow {
  tn: string
  count: number
  lastEha: string
  lastStatusDesc: string
  lastStatus: string
  station: string
  regional: string
  subRegional: string
  classificacao: string
  risco: string   // Vermelho / Amarelo / ...
}

export interface EhaPeer { station: string; lastEha: string }

export async function fetchEhaBase(url: string, station: string): Promise<{ rows: EhaRow[]; totalBase: number; fetchedAt: string; subRegional: string; peers: EhaPeer[] }> {
  const id = extractSheetId(url)
  if (!id) throw new Error('Link da planilha de EHA não configurado')
  const tabs = await listTabs(id)
  const tab = findTab(tabs, ['[IR] Base de BRs', 'Base de BRs'])
  if (!tab) throw new Error(`Guia "[IR] Base de BRs" não encontrada. Guias: ${tabs.join(', ')}`)
  const rows = await readTab(id, tab)
  const h = headerOf(rows, ['shipment_id', 'station_name'])
  if (!h) throw new Error('Cabeçalho (shipment_id, station_name) não encontrado na guia')
  const c = h.col
  const I = { tn: c('shipment_id'), n: c('qtd_eha_total'), d: c('data_ultimo_eha'), sd: c('last_status_desc'), s: c('last_status'), st: c('station_name'), rg: c('lm_regional'), sr: c('sub_regional'), cl: c('classificacao_eha'), rk: c('Risco') }
  const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const want = norm(station)
  const all = rows.slice(h.idx + 1).filter(r => g(r, I.tn))
  const out: EhaRow[] = []
  for (const r of all) {
    const st = g(r, I.st)
    if (want && norm(st) !== want) continue
    out.push({
      tn: g(r, I.tn), count: brNum(g(r, I.n)) ?? 0, lastEha: g(r, I.d), lastStatusDesc: g(r, I.sd), lastStatus: g(r, I.s),
      station: st, regional: g(r, I.rg), subRegional: g(r, I.sr), classificacao: g(r, I.cl), risco: g(r, I.rk),
    })
  }
  // Outras stations da mesma sub-regional (para comparar no dashboard)
  const subRegional = out.find(r => r.subRegional)?.subRegional ?? ''
  const peers: EhaPeer[] = subRegional
    ? all.filter(r => norm(g(r, I.sr)) === norm(subRegional)).map(r => ({ station: g(r, I.st), lastEha: g(r, I.d) }))
    : []
  return { rows: out, totalBase: all.length, fetchedAt: new Date().toISOString(), subRegional, peers }
}

const EHA_KEY = 'local:eha-base'
export interface EhaCache { rows: EhaRow[]; totalBase: number; fetchedAt: string; station: string; subRegional?: string; peers?: EhaPeer[] }
export function saveEhaCache(d: EhaCache) {
  try { localStorage.setItem(EHA_KEY, JSON.stringify(d)) } catch { /* */ }
}
export function getEhaCache(): EhaCache | null {
  try { return JSON.parse(localStorage.getItem(EHA_KEY) ?? 'null') } catch { return null }
}

// ── Classificação do pacote (mesma fórmula da planilha) ─────────────────────
export type Classe = 'PP' | 'P' | 'M' | 'G' | 'GG'
export const CLASSES: Classe[] = ['PP', 'P', 'M', 'G', 'GG']

/** Categoria do SPX primeiro; sem ela, decide por dimensões (cm) e peso (valor sem o ponto, como na planilha). */
export function classifyPackage(p: Pick<CtPackage, 'category' | 'dims' | 'weightG'>): Classe {
  switch ((p.category ?? '').trim().toUpperCase()) {
    case 'BULKY': return 'GG'
    case 'L': return 'G'
    case 'M': return 'M'
    case 'S': return 'P'
    case 'ES': return 'PP'
  }
  const [a, b, c] = p.dims.map(x => x ?? 0)
  const w = p.weightG ?? 0
  const valid = !(a === 0 && b === 0 && c === 0) && !(a === 1 && b === 1 && c === 1) && !(a === 10 && b === 10 && c === 10)
  const vol = a * b * c, mx = Math.max(a, b, c), mn = Math.min(a, b, c), mid = a + b + c - mx - mn
  if (valid && vol >= 40000) return 'GG'
  if (valid && vol <= 2000 && mx <= 10 && mn <= 2 && mid <= 10 && w < 2000) return 'PP'
  if (valid && vol <= 2000 && mx <= 20 && mn <= 10 && mid <= 15 && w < 2000) return 'P'
  if (mx <= 40 && w <= 5000) return 'M'
  if (mx > 100) return 'GG'
  if (w > 15000) return 'GG'
  if (mx <= 100) return 'G'
  return 'GG'
}
