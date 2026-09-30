/**
 * DS_Real calculation engine.
 * All logic isolated here for testability.
 * Algorithm validated against Python/Apps Script reference implementation.
 */

import type {
  RawRoute,
  ParsedRoute,
  DriverResult,
  TrendStatus,
  SummaryStats,
  TurnStats,
  ClusterStats,
  TimelinePoint,
  DsBucket,
  DriverActivity,
  VehicleConcentration,
  TurnoverByVehicle,
  SPRSuggestion,
  LateStartAlert,
  NightDeliveryAlert,
  AnalysisResult,
} from './types'

// ──────────────────────────────────────────────────────────────────────────────
// Date parsing — row-by-row, tolerant of multiple ISO 8601 formats
// CRITICAL: never do batch vectorized parsing — it silently discards rows with
// missing seconds (e.g. "2026-07-13T10:29" vs "2026-07-13T10:29:00")
// ──────────────────────────────────────────────────────────────────────────────
export function parseFlexibleDate(str: string | null | undefined): Date | null {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s) return null

  // 1. direct parse
  let d = new Date(s)
  if (!isNaN(d.getTime())) return d

  // 2. space → T
  d = new Date(s.replace(' ', 'T'))
  if (!isNaN(d.getTime())) return d

  // 3. append :00 if time ends at HH:MM (no seconds)
  const noSeconds = s.replace(/(\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})?$/, '$1:00$2')
  if (noSeconds !== s) {
    d = new Date(noSeconds)
    if (!isNaN(d.getTime())) return d
    d = new Date(noSeconds.replace(' ', 'T'))
    if (!isNaN(d.getTime())) return d
  }

  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// Math helpers
// ──────────────────────────────────────────────────────────────────────────────
export function median(values: number[]): number | null {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function mean(values: number[]): number | null {
  if (!values || values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function linearRegressionSlope(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0)
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null
  const mx = mean(xs)!
  const my = mean(ys)!
  let num = 0, sdx = 0, sdy = 0
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    sdx += dx * dx
    sdy += dy * dy
  }
  const denom = Math.sqrt(sdx * sdy)
  if (denom === 0) return null
  return num / denom
}

function toNum(v: string | number | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function dateOnlyMs(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

// ──────────────────────────────────────────────────────────────────────────────
// Required columns check
// ──────────────────────────────────────────────────────────────────────────────
const REQUIRED_COLUMNS = ['date', 'driver_id']
const OPTIONAL_COLUMNS = [
  'dispatch_window', 'cluster_name', 'Performance', 'TaxaAderencia',
  'qty_delivering', 'qty_delivered', 'qty_route_stop', 'vehicle_plan', 'vehicle_actual',
  'DataHoraInicioRota', 'DataHoraPrimDelivered', 'DataHoraUltDelivered',
  'PacoteHora', 'PacoteParada', 'route_distance_plan_km',
]

export function detectMissingColumns(columnNames: string[]): { missing: string[]; unavailable: string[] } {
  const cols = new Set(columnNames.map(c => c.trim()))
  const missing = REQUIRED_COLUMNS.filter(c => !cols.has(c))
  const unavailable = OPTIONAL_COLUMNS.filter(c => !cols.has(c))
  return { missing, unavailable }
}

// ──────────────────────────────────────────────────────────────────────────────
// Parse raw CSV rows into typed structs
// ──────────────────────────────────────────────────────────────────────────────
export function parseRoutes(raw: RawRoute[]): ParsedRoute[] {
  return raw
    .filter(r => r.driver_id && String(r.driver_id).trim())
    .map(r => ({
      date: String(r.date || '').slice(0, 10),
      driver_id: String(r.driver_id || '').trim(),
      dispatch_window: String(r.dispatch_window || '').trim().toUpperCase(),
      cluster_name: String(r.cluster_name || '').trim(),
      Performance: toNum(r.Performance),
      TaxaAderencia: toNum(r.TaxaAderencia),
      qty_delivering: toNum(r.qty_delivering),
      qty_delivered: toNum(r.qty_delivered),
      qty_route_stop: toNum(r.qty_route_stop),
      vehicle_plan: String(r.vehicle_plan || '').trim().toUpperCase(),
      vehicle_actual: String(r.vehicle_actual || '').trim().toUpperCase(),
      DataHoraInicioRota: parseFlexibleDate(r.DataHoraInicioRota as string),
      DataHoraPrimDelivered: parseFlexibleDate(r.DataHoraPrimDelivered as string),
      DataHoraUltDelivered: parseFlexibleDate(r.DataHoraUltDelivered as string),
      PacoteHora: toNum(r.PacoteHora),
      PacoteParada: toNum(r.PacoteParada),
      route_distance_plan_km: toNum(r.route_distance_plan_km),
    }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Part 1 — DS_Real calculation per driver
// ──────────────────────────────────────────────────────────────────────────────
export function computeDriverResults(routes: ParsedRoute[]): DriverResult[] {
  const byDriver = new Map<string, ParsedRoute[]>()
  for (const r of routes) {
    if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, [])
    byDriver.get(r.driver_id)!.push(r)
  }

  const results: DriverResult[] = []

  for (const [driverId, driverRoutes] of byDriver) {
    // 1. Media_Performance: median of valid Performance values
    const perfValues = driverRoutes
      .filter(r => r.Performance !== null)
      .map(r => r.Performance as number)

    const mediaPerformance = median(perfValues)

    // 2. Status: monthly median → linear regression slope
    const byMonth = new Map<string, number[]>()
    for (const r of driverRoutes) {
      if (r.Performance === null) continue
      const monthKey = r.date.slice(0, 7) // YYYY-MM
      if (!monthKey || monthKey.length < 7) continue
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, [])
      byMonth.get(monthKey)!.push(r.Performance)
    }

    let status: TrendStatus = 'Estagnado'
    if (byMonth.size >= 2) {
      const months = [...byMonth.keys()].sort()
      const xs = months.map((_, i) => i)
      // medians in percentage points (×100) for slope threshold comparison
      const ys = months.map(m => (median(byMonth.get(m)!) ?? 0) * 100)
      const slope = linearRegressionSlope(xs, ys)
      if (slope > 0.2) status = 'Melhorando'
      else if (slope < -0.2) status = 'Piorando'
    }

    // 3. Nivel_Entrega_Dia: compare date-only of first vs last delivery
    const niveisValidos: number[] = []
    for (const r of driverRoutes) {
      const prim = r.DataHoraPrimDelivered
      const ult = r.DataHoraUltDelivered
      if (!prim || !ult) continue
      const diffDays = Math.round((dateOnlyMs(ult) - dateOnlyMs(prim)) / 86400000)
      niveisValidos.push(diffDays <= 0 ? 1.0 : 0.85)
    }

    const nivelEntregaDia = niveisValidos.length > 0
      ? niveisValidos.reduce((a, b) => a + b, 0) / niveisValidos.length
      : null

    // 4. DS_Real
    const dsReal =
      mediaPerformance !== null && nivelEntregaDia !== null
        ? Math.round(mediaPerformance * nivelEntregaDia * 10000) / 10000
        : null

    results.push({
      driver_id: driverId,
      Media_Performance: mediaPerformance,
      Status: status,
      Nivel_Entrega_Dia: nivelEntregaDia,
      DS_Real: dsReal,
      route_count: driverRoutes.length,
    })
  }

  return results
}

// ──────────────────────────────────────────────────────────────────────────────
// Part 2 — Additional dashboard metrics
// ──────────────────────────────────────────────────────────────────────────────

export function computeSummary(routes: ParsedRoute[], drivers: DriverResult[]): SummaryStats {
  const dates = routes.map(r => r.date).filter(Boolean).sort()
  const dsValues = drivers.map(d => d.DS_Real).filter(v => v !== null) as number[]
  const statusCounts = { Melhorando: 0, Piorando: 0, Estagnado: 0 }
  for (const d of drivers) statusCounts[d.Status]++

  return {
    totalRoutes: routes.length,
    totalDrivers: drivers.length,
    periodStart: dates[0] || '',
    periodEnd: dates[dates.length - 1] || '',
    avgDsReal: mean(dsValues),
    medianDsReal: median(dsValues),
    statusCounts,
  }
}

export function computeTurnStats(routes: ParsedRoute[]): TurnStats[] {
  const turns = ['AM', 'PM1']
  return turns.map(turn => {
    const turnRoutes = routes.filter(r => r.dispatch_window === turn)
    const perfValues = turnRoutes.map(r => r.Performance).filter(v => v !== null) as number[]

    const byClusterMap = new Map<string, number[]>()
    for (const r of turnRoutes) {
      if (r.Performance === null || !r.cluster_name) continue
      if (!byClusterMap.has(r.cluster_name)) byClusterMap.set(r.cluster_name, [])
      byClusterMap.get(r.cluster_name)!.push(r.Performance)
    }

    const byCluster = [...byClusterMap.entries()].map(([cluster, vals]) => ({
      cluster,
      avgPerformance: mean(vals) ?? 0,
      routeCount: vals.length,
    }))

    return {
      turn,
      avgPerformance: mean(perfValues) ?? 0,
      routeCount: turnRoutes.length,
      byCluster,
    }
  })
}

export function computeClusterStats(routes: ParsedRoute[], minRoutes = 15): ClusterStats[] {
  const byCluster = new Map<string, ParsedRoute[]>()
  for (const r of routes) {
    if (!r.cluster_name) continue
    if (!byCluster.has(r.cluster_name)) byCluster.set(r.cluster_name, [])
    byCluster.get(r.cluster_name)!.push(r)
  }

  const stats: ClusterStats[] = []
  for (const [cluster, cRoutes] of byCluster) {
    if (cRoutes.length < minRoutes) continue
    const perfValues = cRoutes.map(r => r.Performance).filter(v => v !== null) as number[]
    const amPerf = cRoutes.filter(r => r.dispatch_window === 'AM').map(r => r.Performance).filter(v => v !== null) as number[]
    const pm1Perf = cRoutes.filter(r => r.dispatch_window === 'PM1').map(r => r.Performance).filter(v => v !== null) as number[]

    const volVsPerf = cRoutes.filter(r => r.qty_delivering !== null && r.Performance !== null)
    const corrVol = pearsonCorrelation(
      volVsPerf.map(r => r.qty_delivering as number),
      volVsPerf.map(r => r.Performance as number),
    )
    const stopsVsPerf = cRoutes.filter(r => r.qty_route_stop !== null && r.Performance !== null)
    const corrStops = pearsonCorrelation(
      stopsVsPerf.map(r => r.qty_route_stop as number),
      stopsVsPerf.map(r => r.Performance as number),
    )

    stats.push({
      cluster,
      avgPerformance: mean(perfValues) ?? 0,
      routeCount: cRoutes.length,
      amAvg: amPerf.length > 0 ? mean(amPerf) : null,
      pm1Avg: pm1Perf.length > 0 ? mean(pm1Perf) : null,
      correlationVolume: corrVol,
      correlationStops: corrStops,
      isSensitiveToVolume: corrVol !== null && corrVol < -0.3,
    })
  }

  return stats.sort((a, b) => a.avgPerformance - b.avgPerformance)
}

export function computeTimeline(routes: ParsedRoute[]): TimelinePoint[] {
  const byDate = new Map<string, number>()
  for (const r of routes) {
    if (!r.date) continue
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, routeCount]) => ({ date, routeCount }))
}

const DS_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '< 80%', min: 0, max: 0.8 },
  { label: '80–85%', min: 0.8, max: 0.85 },
  { label: '85–90%', min: 0.85, max: 0.9 },
  { label: '90–93%', min: 0.9, max: 0.93 },
  { label: '93–95%', min: 0.93, max: 0.95 },
  { label: '95–97%', min: 0.95, max: 0.97 },
  { label: '97–98%', min: 0.97, max: 0.98 },
  { label: '98–99%', min: 0.98, max: 0.99 },
  { label: '99–100%', min: 0.99, max: 1.0001 },
]

export function computeDsBuckets(drivers: DriverResult[]): DsBucket[] {
  return DS_BUCKETS.map(b => ({
    ...b,
    count: drivers.filter(d => d.DS_Real !== null && d.DS_Real >= b.min && d.DS_Real < b.max).length,
  }))
}

function computeDriverActivity(routes: ParsedRoute[]): DriverActivity[] {
  const byDriver = new Map<string, ParsedRoute[]>()
  for (const r of routes) {
    if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, [])
    byDriver.get(r.driver_id)!.push(r)
  }

  return [...byDriver.entries()].map(([driver_id, dRoutes]) => {
    const dates = [...new Set(dRoutes.map(r => r.date))].sort()
    const vehicle = dRoutes.find(r => r.vehicle_actual)?.vehicle_actual || 'N/A'

    let maxGap = 0
    let totalGap = 0
    for (let i = 1; i < dates.length; i++) {
      const gap = Math.round(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000,
      )
      if (gap > maxGap) maxGap = gap
      totalGap += gap
    }
    const avgGap = dates.length > 1 ? totalGap / (dates.length - 1) : 0

    return {
      driver_id,
      daysActive: dates.length,
      maxGap,
      avgGap: Math.round(avgGap * 10) / 10,
      vehicle,
      routeCount: dRoutes.length,
    }
  })
}

function computeVehicleConcentration(activity: DriverActivity[]): VehicleConcentration[] {
  const vehicles = [...new Set(activity.map(a => a.vehicle))]
  return vehicles.map(vehicle => {
    const group = activity.filter(a => a.vehicle === vehicle).sort((a, b) => b.routeCount - a.routeCount)
    const total = group.reduce((s, a) => s + a.routeCount, 0)
    const top20Count = Math.max(1, Math.ceil(group.length * 0.2))
    const bot20Count = Math.max(1, Math.ceil(group.length * 0.2))
    const top20Routes = group.slice(0, top20Count).reduce((s, a) => s + a.routeCount, 0)
    const bot20Routes = group.slice(-bot20Count).reduce((s, a) => s + a.routeCount, 0)
    return {
      vehicle,
      top20Pct: total > 0 ? Math.round((top20Routes / total) * 1000) / 10 : 0,
      bottom20Pct: total > 0 ? Math.round((bot20Routes / total) * 1000) / 10 : 0,
      totalDrivers: group.length,
    }
  })
}

function computeTurnover(routes: ParsedRoute[]): TurnoverByVehicle[] {
  const sortedDates = [...new Set(routes.map(r => r.date))].filter(Boolean).sort()
  if (sortedDates.length < 2) return []

  const midIdx = Math.floor(sortedDates.length / 2)
  const firstHalf = new Set(sortedDates.slice(0, midIdx))
  const secondHalf = new Set(sortedDates.slice(midIdx))

  const vehicles = [...new Set(routes.map(r => r.vehicle_actual).filter(Boolean))]

  return vehicles.map(vehicle => {
    const vRoutes = routes.filter(r => r.vehicle_actual === vehicle)
    const inFirst = new Set(vRoutes.filter(r => firstHalf.has(r.date)).map(r => r.driver_id))
    const inSecond = new Set(vRoutes.filter(r => secondHalf.has(r.date)).map(r => r.driver_id))

    const retained = [...inFirst].filter(d => inSecond.has(d)).length
    const churned = [...inFirst].filter(d => !inSecond.has(d)).length
    const newDrivers = [...inSecond].filter(d => !inFirst.has(d)).length

    return {
      vehicle,
      retained,
      churned,
      newDrivers,
      turnoverRate: retained + churned > 0
        ? Math.round((churned / (churned + retained)) * 1000) / 10
        : 0,
    }
  })
}

function computeSPR(routes: ParsedRoute[], minRoutes = 15, threshold = 0.96, binSize = 20): SPRSuggestion[] {
  const pm1Routes = routes.filter(r => r.dispatch_window === 'PM1')
  const clusters = [...new Set(pm1Routes.map(r => r.cluster_name).filter(Boolean))]

  return clusters.map(cluster => {
    const cRoutes = pm1Routes.filter(
      r => r.cluster_name === cluster && r.qty_delivering !== null && r.Performance !== null,
    )
    if (cRoutes.length < minRoutes) {
      return { cluster, suggestedSPR: null, note: 'Volume insuficiente', bins: [] }
    }

    const minPkg = Math.min(...cRoutes.map(r => r.qty_delivering as number))
    const maxPkg = Math.max(...cRoutes.map(r => r.qty_delivering as number))

    const bins: { label: string; avgPerformance: number; count: number; maxPkg: number }[] = []
    for (let lo = Math.floor(minPkg / binSize) * binSize; lo <= maxPkg; lo += binSize) {
      const hi = lo + binSize
      const binRoutes = cRoutes.filter(r => (r.qty_delivering as number) >= lo && (r.qty_delivering as number) < hi)
      if (binRoutes.length === 0) continue
      const avg = mean(binRoutes.map(r => r.Performance as number)) ?? 0
      bins.push({ label: `${lo}–${hi - 1}`, avgPerformance: avg, count: binRoutes.length, maxPkg: hi - 1 })
    }

    // SPR = highest bin still at or above threshold
    const validBins = bins.filter(b => b.avgPerformance >= threshold)
    if (validBins.length === 0) {
      const allBelowEvenAtLow = bins[0]?.avgPerformance !== undefined && bins[0].avgPerformance < threshold
      return {
        cluster,
        suggestedSPR: null,
        note: allBelowEvenAtLow
          ? 'Performance abaixo do limiar mesmo nas faixas mais baixas — investigar separadamente'
          : 'Nenhuma faixa atinge o limiar',
        bins: bins.map(b => ({ label: b.label, avgPerformance: b.avgPerformance, count: b.count })),
      }
    }

    const suggestedSPR = validBins[validBins.length - 1].maxPkg
    return {
      cluster,
      suggestedSPR,
      note: `SPR máximo sugerido: ${suggestedSPR} pacotes`,
      bins: bins.map(b => ({ label: b.label, avgPerformance: b.avgPerformance, count: b.count })),
    }
  })
}

function computeLateStartAlerts(routes: ParsedRoute[], lateHour = 12): LateStartAlert[] {
  const amRoutes = routes.filter(r => r.dispatch_window === 'AM' && r.DataHoraPrimDelivered !== null)
  const byDriver = new Map<string, { late: number; total: number }>()

  for (const r of amRoutes) {
    const d = r.DataHoraPrimDelivered!
    const prev = byDriver.get(r.driver_id) ?? { late: 0, total: 0 }
    byDriver.set(r.driver_id, {
      total: prev.total + 1,
      late: prev.late + (d.getHours() >= lateHour ? 1 : 0),
    })
  }

  return [...byDriver.entries()]
    .filter(([, v]) => v.late > 0)
    .map(([driver_id, v]) => ({
      driver_id,
      lateCount: v.late,
      totalAmRoutes: v.total,
      latePct: Math.round((v.late / v.total) * 1000) / 10,
    }))
    .sort((a, b) => b.lateCount - a.lateCount)
}

function computeNightAlerts(routes: ParsedRoute[]): NightDeliveryAlert[] {
  return routes
    .filter(r => {
      const d = r.DataHoraUltDelivered
      if (!d) return false
      const h = d.getHours()
      return h >= 0 && h < 5
    })
    .map(r => ({
      driver_id: r.driver_id,
      date: r.date,
      cluster: r.cluster_name,
      ultDelivered: r.DataHoraUltDelivered!.toISOString(),
    }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────────
export function analyzeCSV(
  raw: RawRoute[],
  options: { minClusterRoutes?: number; sprThreshold?: number; lateHour?: number } = {},
): AnalysisResult {
  const { minClusterRoutes = 15, sprThreshold = 0.96, lateHour = 12 } = options

  if (!raw || raw.length === 0) {
    throw new Error('CSV vazio ou sem dados válidos.')
  }

  // Detect missing columns
  const cols = raw.length > 0 ? Object.keys(raw[0]) : []
  const { missing, unavailable } = detectMissingColumns(cols)
  if (missing.length > 0) {
    throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}`)
  }

  const routes = parseRoutes(raw)
  const drivers = computeDriverResults(routes)

  return {
    drivers,
    summary: computeSummary(routes, drivers),
    turnStats: computeTurnStats(routes),
    clusterStats: computeClusterStats(routes, minClusterRoutes),
    timeline: computeTimeline(routes),
    dsBuckets: computeDsBuckets(drivers),
    driverActivity: computeDriverActivity(routes),
    vehicleConcentration: computeVehicleConcentration(computeDriverActivity(routes)),
    turnoverByVehicle: computeTurnover(routes),
    sprSuggestions: computeSPR(routes, minClusterRoutes, sprThreshold),
    lateStartAlerts: computeLateStartAlerts(routes, lateHour),
    nightDeliveryAlerts: computeNightAlerts(routes),
    missingColumns: unavailable,
  }
}
