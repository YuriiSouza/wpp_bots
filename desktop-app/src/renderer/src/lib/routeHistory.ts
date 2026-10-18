import type { ParsedRoute } from './types'

// Guarda, de forma compacta, as rotas do relatório de resultados para análises rota a rota
// (ex.: tela Novatos). Fica só neste computador — não vai para a planilha (é grande).
const KEY = 'local:ds-routes'

export interface RouteRecord {
  date: string        // YYYY-MM-DD
  driverId: string
  shift: string       // AM / PM1 / PM2
  cluster: string
  vehicle: string
  perf: number | null // Performance da rota (0–1)
  sameDay: boolean | null // entregou tudo no mesmo dia?
  delivered: number | null
  stops: number | null
  km: number | null   // distância planejada da rota
}

/** DS de uma rota, com a mesma regra do DS_Real: performance × (1 se terminou no dia, 0,85 se não). */
export const routeDs = (r: RouteRecord) => (r.perf === null ? null : r.perf * (r.sameDay === false ? 0.85 : 1))

const dayMs = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

export function saveRouteHistory(routes: ParsedRoute[]) {
  const rows = routes.filter(r => r.date && r.driver_id).map(r => {
    const same = r.DataHoraPrimDelivered && r.DataHoraUltDelivered
      ? (dayMs(new Date(r.DataHoraUltDelivered)) - dayMs(new Date(r.DataHoraPrimDelivered)) <= 0 ? 1 : 0) : -1
    return [r.date, r.driver_id, r.dispatch_window, r.cluster_name, r.vehicle_actual || r.vehicle_plan,
      r.Performance === null ? null : Math.round(r.Performance * 10000), same, r.qty_delivered, r.qty_route_stop, r.route_distance_plan_km]
  })
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* sem espaço: a análise só fica disponível até fechar o app */ }
  cache = null
}

let cache: RouteRecord[] | null = null
export function loadRouteHistory(): RouteRecord[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as (string | number | null)[][]
    cache = raw.map(a => ({
      date: String(a[0]), driverId: String(a[1]), shift: String(a[2] ?? ''), cluster: String(a[3] ?? ''), vehicle: String(a[4] ?? ''),
      perf: a[5] === null ? null : Number(a[5]) / 10000, sameDay: a[6] === -1 ? null : a[6] === 1,
      delivered: a[7] == null ? null : Number(a[7]), stops: a[8] == null ? null : Number(a[8]), km: a[9] == null ? null : Number(a[9]),
    }))
  } catch { cache = [] }
  return cache
}

// Valores pagos por veículo: R$ por pacote entregue e por km
export const RATES: Record<string, { pkg: number; km: number }> = {
  MOTO: { pkg: 2.25, km: 0.5 },
  PASSEIO: { pkg: 2.35, km: 0.5 },
  FIORINO: { pkg: 2.6, km: 0.6 },
}
export function rateFor(vehicle: string | null | undefined) {
  const v = (vehicle ?? '').toUpperCase()
  if (v.includes('MOTO')) return RATES.MOTO
  if (v.includes('FIORINO') || v.includes('VAN') || v.includes('UTIL')) return RATES.FIORINO
  if (v.includes('PASSEIO') || v.includes('CARRO') || v.includes('CAR')) return RATES.PASSEIO
  return null
}
/** Faturamento estimado da rota: pacotes entregues × valor do pacote + km × valor do km.
 *  O valor segue o veículo do CADASTRO do motorista (não o da rota). Van paga como Fiorino. */
export function routeRevenue(r: RouteRecord, driverVehicle: string | null | undefined): number | null {
  const rate = rateFor(driverVehicle)
  if (!rate || r.delivered === null) return null
  return r.delivered * rate.pkg + (r.km ?? 0) * rate.km
}
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
