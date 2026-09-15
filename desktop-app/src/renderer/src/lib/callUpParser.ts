import Papa from 'papaparse'
import { type GlobalConfig, type Shift, DEFAULT_CONFIG } from './globalConfig'

export interface DriverCallUpStats {
  driverId: string
  driverName: string
  total: number
  accepted: number
  declined: number
  cancelled: number
  acceptanceRate: number
  declineReasons: Record<string, number>
  timeoutCount: number
  avgResponseSeconds: number | null
  clusters: string[]
  /** ISO date string (YYYY-MM-DD) of the most recent accepted call's Trigger Time */
  lastAcceptedDate: string | null
}

export interface CallUpDayStats {
  date: string
  total: number
  accepted: number
  declined: number
  rate: number
}

export interface ClusterCallUpStats {
  cluster: string
  total: number
  accepted: number
  declined: number
  rate: number
  topDeclineReason: string | null
}

export type { Shift }

export interface FirstCallRoute {
  atId: string
  driverId: string
  driverName: string
  status: 'Accepted' | 'Declined' | 'Cancelled'
  declineReason: string | null
  triggerTime: string
  cluster: string
  shift: Shift | null
}

export interface FirstCallDriverStats {
  driverId: string
  driverName: string
  totalFirstCalls: number
  accepted: number
  declined: number
  acceptanceRate: number
  declineReasons: Record<string, number>
}

export interface FirstCallDateStats {
  date: string       // YYYY-MM-DD
  total: number
  accepted: number
  declined: number
  acceptanceRate: number
}

export interface FirstCallAnalysis {
  totalRoutes: number          // ATs with at least one call
  accepted: number             // first call accepted
  declined: number             // first call declined/timed out
  acceptanceRate: number
  declineReasonSummary: Record<string, number>
  routes: FirstCallRoute[]     // one entry per AT, sorted by triggerTime
  byDriver: FirstCallDriverStats[]
  byDate: FirstCallDateStats[]
}

export interface CallUpAnalysis {
  fileName: string
  importedAt: string
  totalCalls: number
  accepted: number
  declined: number
  cancelled: number
  overallAcceptanceRate: number
  byDriver: DriverCallUpStats[]
  byDate: CallUpDayStats[]
  byCluster: ClusterCallUpStats[]
  declineReasonSummary: Record<string, number>
  /** driverId[] for each date (YYYY-MM-DD) that appear in Trigger Time */
  driversByDate: Record<string, string[]>
  /** driverId[] que aceitaram rota em cada data+turno. Chave: "YYYY-MM-DD|AM" / "YYYY-MM-DD|PM1" etc. */
  acceptedByDateShift: Record<string, string[]>
  firstCallAnalysis: FirstCallAnalysis
}

interface RawCallUp {
  'Notification ID': string
  'Call-up Time Slot': string
  Station: string
  Driver: string
  'Driver Type': string
  'Notification Type Type': string
  'AT ID': string
  Clusters: string
  'Decline Reason': string
  Status: string
  'Trigger Time': string
  'Accepted/Declined Time': string
}

function extractDriverId(raw: string): string {
  const m = raw.match(/\[(\d+)\]/)
  return m ? m[1] : raw.trim()
}

function extractDriverName(raw: string): string {
  return raw.replace(/^\[\d+\]\s*/, '').trim()
}

function parseDateTime(s: string): Date | null {
  if (!s) return null
  // "2026/09/08 04:11:14"
  const cleaned = s.replace(/\//g, '-')
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? null : d
}

function parseSlotDate(slot: string): string {
  // "2026-09-08 05:30 - 09:00" → "2026-09-08"
  const m = slot.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : slot
}

function slotToShift(slot: string, config: GlobalConfig): Shift | null {
  const shifts: Shift[] = ['AM', 'PM1', 'PM2']
  for (const s of shifts) {
    if (config.shifts[s].patterns.some(p => slot.includes(p))) return s
  }
  return null
}

export function parseCallUpCsv(csvText: string, fileName: string, config: GlobalConfig = DEFAULT_CONFIG): CallUpAnalysis {
  const result = Papa.parse<RawCallUp>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  const rows = result.data

  const driverMap = new Map<string, DriverCallUpStats>()
  const dateMap = new Map<string, { total: number; accepted: number; declined: number }>()
  const clusterMap = new Map<string, { total: number; accepted: number; declined: number; reasons: Record<string, number> }>()
  const reasonSummary: Record<string, number> = {}

  let totalAccepted = 0, totalDeclined = 0, totalCancelled = 0
  const driversByDateMap = new Map<string, Set<string>>()
  const acceptedByDateShiftMap = new Map<string, Set<string>>()

  for (const row of rows) {
    const driverId = extractDriverId(row.Driver || '')
    const driverName = extractDriverName(row.Driver || '')
    const status = (row.Status || '').trim()
    const cluster = (row.Clusters || '').trim()
    const reason = (row['Decline Reason'] || '').trim()
    const date = parseSlotDate((row['Call-up Time Slot'] || '').trim())

    // Track drivers by Trigger Time date (which day they actually received the call)
    const triggerDate = row['Trigger Time'] ? row['Trigger Time'].slice(0, 10).replace(/\//g, '-') : null
    if (triggerDate && driverId) {
      if (!driversByDateMap.has(triggerDate)) driversByDateMap.set(triggerDate, new Set())
      driversByDateMap.get(triggerDate)!.add(driverId)
    }

    // Track motoristas que ACEITARAM por data+turno (via Call-up Time Slot)
    if (status === 'Accepted' && driverId && date) {
      const shift = slotToShift((row['Call-up Time Slot'] || '').trim(), config)
      if (shift) {
        const key = `${date}|${shift}`
        if (!acceptedByDateShiftMap.has(key)) acceptedByDateShiftMap.set(key, new Set())
        acceptedByDateShiftMap.get(key)!.add(driverId)
      }
    }

    // Count totals
    if (status === 'Accepted') totalAccepted++
    else if (status === 'Declined') totalDeclined++
    else if (status === 'Cancelled') totalCancelled++

    // Response time
    const triggerTime = parseDateTime(row['Trigger Time'])
    const responseTime = parseDateTime(row['Accepted/Declined Time'])
    const responseSeconds =
      triggerTime && responseTime
        ? Math.round((responseTime.getTime() - triggerTime.getTime()) / 1000)
        : null

    // Per driver
    if (driverId) {
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          driverId,
          driverName,
          total: 0,
          accepted: 0,
          declined: 0,
          cancelled: 0,
          acceptanceRate: 0,
          declineReasons: {},
          timeoutCount: 0,
          avgResponseSeconds: null,
          clusters: [],
          lastAcceptedDate: null,
        })
      }
      const d = driverMap.get(driverId)!
      d.total++
      if (status === 'Accepted') {
        d.accepted++
        // Track latest accepted trigger date
        if (triggerDate) {
          if (!d.lastAcceptedDate || triggerDate > d.lastAcceptedDate) {
            d.lastAcceptedDate = triggerDate
          }
        }
      } else if (status === 'Declined') {
        d.declined++
        if (reason) d.declineReasons[reason] = (d.declineReasons[reason] ?? 0) + 1
        if (reason === 'Timeout') d.timeoutCount++
      } else if (status === 'Cancelled') d.cancelled++

      if (cluster && !d.clusters.includes(cluster)) d.clusters.push(cluster)

      if (responseSeconds !== null && responseSeconds > 0) {
        d.avgResponseSeconds = d.avgResponseSeconds === null
          ? responseSeconds
          : Math.round((d.avgResponseSeconds + responseSeconds) / 2)
      }
    }

    // Per date
    if (date) {
      if (!dateMap.has(date)) dateMap.set(date, { total: 0, accepted: 0, declined: 0 })
      const dd = dateMap.get(date)!
      dd.total++
      if (status === 'Accepted') dd.accepted++
      if (status === 'Declined') dd.declined++
    }

    // Per cluster
    if (cluster) {
      if (!clusterMap.has(cluster)) clusterMap.set(cluster, { total: 0, accepted: 0, declined: 0, reasons: {} })
      const cc = clusterMap.get(cluster)!
      cc.total++
      if (status === 'Accepted') cc.accepted++
      if (status === 'Declined') {
        cc.declined++
        if (reason) cc.reasons[reason] = (cc.reasons[reason] ?? 0) + 1
      }
    }

    // Decline reason summary
    if (status === 'Declined' && reason) {
      reasonSummary[reason] = (reasonSummary[reason] ?? 0) + 1
    }
  }

  // Compute acceptance rates
  for (const d of driverMap.values()) {
    const denominator = d.total - d.cancelled
    d.acceptanceRate = denominator > 0 ? Math.round((d.accepted / denominator) * 1000) / 10 : 0
  }

  const totalCalls = rows.length
  const effectiveCalls = totalCalls - totalCancelled
  const overallAcceptanceRate = effectiveCalls > 0
    ? Math.round((totalAccepted / effectiveCalls) * 1000) / 10
    : 0

  const byDate: CallUpDayStats[] = [...dateMap.entries()]
    .map(([date, d]) => ({
      date,
      total: d.total,
      accepted: d.accepted,
      declined: d.declined,
      rate: d.total > 0 ? Math.round((d.accepted / d.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const byCluster: ClusterCallUpStats[] = [...clusterMap.entries()]
    .map(([cluster, c]) => ({
      cluster,
      total: c.total,
      accepted: c.accepted,
      declined: c.declined,
      rate: c.total > 0 ? Math.round((c.accepted / c.total) * 1000) / 10 : 0,
      topDeclineReason: Object.entries(c.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.total - a.total)

  const byDriver = [...driverMap.values()].sort((a, b) => a.acceptanceRate - b.acceptanceRate)

  const driversByDate: Record<string, string[]> = {}
  for (const [date, ids] of driversByDateMap) {
    driversByDate[date] = [...ids]
  }

  const acceptedByDateShift: Record<string, string[]> = {}
  for (const [key, ids] of acceptedByDateShiftMap) {
    acceptedByDateShift[key] = [...ids]
  }

  // ── First call analysis ─────────────────────────────────────────────────────
  // Group all rows by AT ID, pick earliest Trigger Time as the "first call"
  const atMap = new Map<string, { row: RawCallUp; triggerMs: number }>()
  for (const row of rows) {
    const atId = (row['AT ID'] || '').trim()
    if (!atId) continue
    const t = parseDateTime(row['Trigger Time'])
    if (!t) continue
    const existing = atMap.get(atId)
    if (!existing || t.getTime() < existing.triggerMs) {
      atMap.set(atId, { row, triggerMs: t.getTime() })
    }
  }

  const firstDriverMap = new Map<string, FirstCallDriverStats>()
  const firstDateMap = new Map<string, { total: number; accepted: number; declined: number }>()
  const firstReasonSummary: Record<string, number> = {}
  let fcAccepted = 0, fcDeclined = 0

  const fcRoutes: FirstCallRoute[] = [...atMap.values()]
    .sort((a, b) => a.triggerMs - b.triggerMs)
    .map(({ row }) => {
      const driverId = extractDriverId(row.Driver || '')
      const driverName = extractDriverName(row.Driver || '')
      const status = (row.Status || '').trim() as 'Accepted' | 'Declined' | 'Cancelled'
      const reason = (row['Decline Reason'] || '').trim() || null
      const atId = (row['AT ID'] || '').trim()
      const cluster = (row.Clusters || '').trim()

      const effective = status !== 'Cancelled'
      const fcDate = row['Trigger Time'] ? row['Trigger Time'].slice(0, 10).replace(/\//g, '-') : null
      if (effective) {
        if (status === 'Accepted') fcAccepted++
        else fcDeclined++
        if (status === 'Declined' && reason) {
          firstReasonSummary[reason] = (firstReasonSummary[reason] ?? 0) + 1
        }
        if (fcDate) {
          if (!firstDateMap.has(fcDate)) firstDateMap.set(fcDate, { total: 0, accepted: 0, declined: 0 })
          const dd = firstDateMap.get(fcDate)!
          dd.total++
          if (status === 'Accepted') dd.accepted++
          else dd.declined++
        }
      }

      if (driverId && effective) {
        if (!firstDriverMap.has(driverId)) {
          firstDriverMap.set(driverId, { driverId, driverName, totalFirstCalls: 0, accepted: 0, declined: 0, acceptanceRate: 0, declineReasons: {} })
        }
        const fd = firstDriverMap.get(driverId)!
        fd.totalFirstCalls++
        if (status === 'Accepted') fd.accepted++
        else if (status === 'Declined') {
          fd.declined++
          if (reason) fd.declineReasons[reason] = (fd.declineReasons[reason] ?? 0) + 1
        }
      }

      const shift = slotToShift((row['Call-up Time Slot'] || '').trim(), config)
      return { atId, driverId, driverName, status, declineReason: reason, triggerTime: row['Trigger Time'], cluster, shift }
    })

  for (const fd of firstDriverMap.values()) {
    fd.acceptanceRate = fd.totalFirstCalls > 0 ? Math.round((fd.accepted / fd.totalFirstCalls) * 1000) / 10 : 0
  }

  const fcTotal = fcAccepted + fcDeclined
  const fcByDate: FirstCallDateStats[] = [...firstDateMap.entries()]
    .map(([date, d]) => ({
      date,
      total: d.total,
      accepted: d.accepted,
      declined: d.declined,
      acceptanceRate: d.total > 0 ? Math.round((d.accepted / d.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const firstCallAnalysis: FirstCallAnalysis = {
    totalRoutes: atMap.size,
    accepted: fcAccepted,
    declined: fcDeclined,
    acceptanceRate: fcTotal > 0 ? Math.round((fcAccepted / fcTotal) * 1000) / 10 : 0,
    declineReasonSummary: firstReasonSummary,
    routes: fcRoutes,
    byDriver: [...firstDriverMap.values()].sort((a, b) => b.totalFirstCalls - a.totalFirstCalls),
    byDate: fcByDate,
  }

  return {
    fileName,
    importedAt: new Date().toISOString(),
    totalCalls,
    accepted: totalAccepted,
    declined: totalDeclined,
    cancelled: totalCancelled,
    overallAcceptanceRate,
    byDriver,
    byDate,
    byCluster,
    declineReasonSummary: reasonSummary,
    driversByDate,
    acceptedByDateShift,
    firstCallAnalysis,
  }
}
