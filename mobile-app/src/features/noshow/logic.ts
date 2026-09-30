// Lógica copiada de desktop-app/src/renderer/src/components/NoShowReversion/index.tsx — mantenha as duas em sincronia.
import type { LocalRoute } from '@/lib/noshowRouteParser'

// ─── manual blocklist ─────────────────────────────────────────────────────────

export interface ManualBlock {
  driverId: string
  driverName: string
  reason: string
  blockedAt: string
}

const MANUAL_BLOCKS_KEY = 'spx:noshow-manual-blocks'

export function getManualBlocks(): ManualBlock[] {
  try { const raw = localStorage.getItem(MANUAL_BLOCKS_KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
}

export function saveManualBlocks(blocks: ManualBlock[]) {
  localStorage.setItem(MANUAL_BLOCKS_KEY, JSON.stringify(blocks))
}

// ─── SPX integration ──────────────────────────────────────────────────────────

export const SPX_CREDS_KEY = 'spx:credentials'

export function parseCurl(curl: string): Record<string, string> {
  const creds: Record<string, string> = {}
  const cookieMatch = curl.match(/-b\s+'([^']+)'/)
  if (cookieMatch) creds['cookie'] = cookieMatch[1]
  const extract = (p: RegExp) => { const m = curl.match(p); return m ? m[1].trim() : undefined }
  const csrf = extract(/x-csrftoken:\s*([^\s'\\]+)/i)
  if (csrf) creds['x-csrftoken'] = csrf
  const sapRi = extract(/x-sap-ri:\s*([^\s'\\]+)/i)
  if (sapRi) creds['x-sap-ri'] = sapRi
  const dev = extract(/device-id:\s*([^\s'\\]+)/i)
  if (dev) creds['device-id'] = dev
  const sapSec = curl.match(/x-sap-sec:\s*([^']+?)'[\s\\]*(?:-H|--data|$)/i)
  if (sapSec) creds['x-sap-sec'] = sapSec[1].trim()
  return creds
}

export function getSpxCreds(): Record<string, string> | null {
  try { const raw = localStorage.getItem(SPX_CREDS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

export function saveSpxCreds(creds: Record<string, string>) {
  localStorage.setItem(SPX_CREDS_KEY, JSON.stringify(creds))
}

export async function spxReassign(driverId: string, atId: string): Promise<{ ok: boolean; message: string }> {
  const creds = getSpxCreds()
  if (!creds) return { ok: false, message: 'Credenciais SPX não configuradas.' }
  const driverIdNum = parseInt(driverId, 10)
  if (isNaN(driverIdNum)) return { ok: false, message: `Driver ID inválido: ${driverId}` }
  try {
    const url = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/reassign'
    const headers: Record<string, string> = {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9,pt;q=0.8',
      'app': 'FMS Portal',
      'content-type': 'application/json;charset=UTF-8',
      'cookie': creds['cookie'] ?? '',
      'device-id': creds['device-id'] ?? '',
      'origin': 'https://spx.shopee.com.br',
      'referer': 'https://spx.shopee.com.br/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'x-csrftoken': creds['x-csrftoken'] ?? '',
      'x-sap-ri': creds['x-sap-ri'] ?? '',
      'x-sap-sec': creds['x-sap-sec'] ?? '',
    }
    const body = JSON.stringify({
      driver_id: driverIdNum,
      assignment_task_id: atId,
      assign_driver_across_station: false,
      driver_vehicle_id: '',
    })
    const ipc = (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } } }).electron?.ipcRenderer
    let rawJson: string
    if (ipc) {
      rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
    } else {
      const res = await fetch(url, { method: 'POST', headers, body })
      rawJson = await res.text()
    }
    const data = JSON.parse(rawJson) as Record<string, unknown>
    const ok = data?.retcode === 0 || data?.code === 0 || data?.success === true
    const errMsg = String(data?.message || data?.msg || data?.error || 'Erro desconhecido do SPX')
    return { ok, message: ok ? 'Atribuído no SPX.' : errMsg }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao chamar SPX'
    return { ok: false, message: msg }
  }
}

export const normCluster = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '')

// ─── types ───────────────────────────────────────────────────────────────────

export interface LocalDriver {
  driverId: string
  name: string
  vehicleType: string | null
  clusters: string[]
  isNewDriver: boolean
  isBlocked: boolean
  blockReason: string | null
  blockType: 'auto' | 'manual' | 'registry' | null
  pendingPackages: number
  dsReal: number | null
  dsStatus: string | null
  priorityScore: number
  daysSinceRoute: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export const INTERIOR_CLUSTERS = new Set([
  'Abadiania - z', 'Campo Limpo', 'Gameleira de Goias', 'Goianapolis',
  'Leopoldo de Bulhões', 'Neropolis', 'Nova Veneza', 'Ouro Verde',
  'Silvania', 'Terezopolis', 'Vianópolis - z',
])

export function normalizeVehicle(v?: string | null) {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio')) return 'PASSEIO'
  return s.toUpperCase()
}

export function vehiclePriority(driverV: string | null, routeV: string | null) {
  const d = normalizeVehicle(driverV); const r = normalizeVehicle(routeV)
  if (r === 'MOTO') { if (d === 'MOTO') return 0; if (d === 'PASSEIO') return 1; if (d === 'FIORINO') return 2; return 3 }
  if (d === 'VAN') return 0; if (d === 'FIORINO') return 1; return 2
}

export function getDsMeta(ds: number | null) {
  if (ds === null) return { label: '—', color: '#64748b', bg: 'rgba(100,116,139,.1)' }
  const pct = Math.round(ds * 100)
  if (pct < 30) return { label: `${pct}%`, color: '#f87171', bg: 'rgba(239,68,68,.12)' }
  if (pct < 70) return { label: `${pct}%`, color: '#fbbf24', bg: 'rgba(245,158,11,.12)' }
  if (pct < 90) return { label: `${pct}%`, color: '#a3e635', bg: 'rgba(163,230,53,.1)' }
  return { label: `${pct}%`, color: '#4ade80', bg: 'rgba(34,197,94,.1)' }
}

export function getBestCandidate(route: LocalRoute, drivers: LocalDriver[], usedIds: Set<string>) {
  const rv = normalizeVehicle(route.requiredVehicleType)
  const sorter = (a: LocalDriver, b: LocalDriver) => {
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
    const pa = vehiclePriority(a.vehicleType, route.requiredVehicleType)
    const pb = vehiclePriority(b.vehicleType, route.requiredVehicleType)
    return pa !== pb ? pa - pb : b.priorityScore - a.priorityScore
  }
  const base = drivers.filter(d => {
    if (usedIds.has(d.driverId)) return false
    const dv = normalizeVehicle(d.vehicleType)
    if (rv !== 'MOTO' && dv === 'MOTO') return false   // moto só aceita rota de moto
    if (rv === 'MOTO' && dv === 'FIORINO') return false // fiorino não aceita rota de moto
    return true
  })
  // Tenta com cluster exato primeiro; se não achar, usa todos os disponíveis
  const withCluster = base.filter(d => d.clusters.some(c => normCluster(c) === normCluster(route.cluster)))
  return withCluster.sort(sorter)[0] ?? null
}

export function computeEffective(routes: LocalRoute[], drivers: LocalDriver[], overrides: Map<string, LocalDriver>) {
  const map = new Map<string, LocalDriver>()
  const usedIds = new Set<string>()
  for (const [rid, d] of overrides) { map.set(rid, d); usedIds.add(d.driverId) }

  const disponivel = routes.filter(r => r.status === 'DISPONIVEL')
  const sorted = [...disponivel].sort((a, b) => {
    const count = (r: LocalRoute) => {
      const rv = normalizeVehicle(r.requiredVehicleType)
      return drivers.filter(d => d.clusters.some(c => normCluster(c) === normCluster(r.cluster)) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO')).length
    }
    return count(a) - count(b)
  })

  for (const route of sorted) {
    if (map.has(route.id)) continue
    const best = getBestCandidate(route, drivers, usedIds)
    if (best) { map.set(route.id, best); usedIds.add(best.driverId) }
  }
  return map
}

