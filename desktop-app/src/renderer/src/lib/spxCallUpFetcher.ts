import type { CallUpAnalysis, DriverCallUpStats, CallUpDayStats, ClusterCallUpStats, FirstCallRoute, FirstCallAnalysis, FirstCallDriverStats, FirstCallDateStats } from './callUpParser'
import type { Shift } from './globalConfig'
import { DEFAULT_CONFIG } from './globalConfig'

const PAGE_SIZE = 500

interface SpxNotification {
  id: number
  notification_id: string
  station_id: number
  driver_id: number
  shift_name: string
  notification_status: number  // 1=pending, 2=accepted, 3=declined, 4=cancelled
  decline_reason: string
  trigger_time: number         // unix ts
  accepted_time: number        // unix ts (0 if not accepted)
  decline_time: number         // unix ts (0 if not declined)
  notification_date: number    // unix ts (midnight)
  cluster_name: string
  assignment_task_id: string
  time_slot: string            // "2026-09-08 05:30 - 09:00"
  driver_name: string
  driver: string               // "[1947797] JARDEL GAMA DE SOUSA"
}

interface PageResult {
  total: number
  list: SpxNotification[]
}

function statusLabel(n: SpxNotification): 'Accepted' | 'Declined' | 'Cancelled' {
  if (n.notification_status === 2) return 'Accepted'
  if (n.notification_status === 3) return 'Declined'
  return 'Cancelled'
}

function tsToDateStr(ts: number): string {
  // SPX timestamps are UTC-3 midnight — convert to YYYY-MM-DD
  const d = new Date((ts + 3 * 3600) * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function slotToShift(slot: string): Shift | null {
  const cfg = DEFAULT_CONFIG
  const shifts: Shift[] = ['AM', 'PM1', 'PM2']
  for (const s of shifts) {
    if (cfg.shifts[s].patterns.some(p => slot.includes(p))) return s
  }
  return null
}

async function fetchPage(
  creds: Record<string, string>,
  pageno: number,
  extraFilters: Record<string, unknown> = {},
): Promise<PageResult> {
  const url = 'https://spx.shopee.com.br/spx_delivery/admin/call_up_tool/notification/list'
  const headers: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'app': 'FMS Portal',
    'content-type': 'application/json;charset=UTF-8',
    'cookie': creds['cookie'] ?? '',
    'device-id': creds['device-id'] ?? '',
    'origin': 'https://spx.shopee.com.br',
    'referer': 'https://spx.shopee.com.br/',
    'x-csrftoken': creds['x-csrftoken'] ?? '',
    'x-sap-ri': creds['x-sap-ri'] ?? '',
    'x-sap-sec': creds['x-sap-sec'] ?? '',
  }
  const body = JSON.stringify({ pageno, count: PAGE_SIZE, ...extraFilters })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipc = (window as any).electron?.ipcRenderer
  let rawJson: string
  if (ipc?.invoke) {
    rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
  } else {
    const res = await fetch(url, { method: 'POST', headers, body })
    rawJson = await res.text()
  }

  const data = JSON.parse(rawJson) as { retcode: number; message?: string; data: { total: number; list: SpxNotification[] } }
  if (data.retcode !== 0) throw new Error(data.message ?? 'Erro SPX Call Up')
  return { total: data.data.total, list: data.data.list ?? [] }
}

export async function fetchAllSpxCallUp(
  creds: Record<string, string>,
  extraFilters: Record<string, unknown> = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<SpxNotification[]> {
  const first = await fetchPage(creds, 1, extraFilters)
  const all: SpxNotification[] = [...first.list]
  onProgress?.(all.length, first.total)

  if (first.total > PAGE_SIZE) {
    const remaining = Math.ceil((first.total - PAGE_SIZE) / PAGE_SIZE)
    const pages = await Promise.all(
      Array.from({ length: remaining }, (_, i) => fetchPage(creds, i + 2, extraFilters)),
    )
    for (const p of pages) all.push(...p.list)
  }

  onProgress?.(all.length, first.total)
  return all
}

export function spxNotificationsToCallUp(
  notifications: SpxNotification[],
  fileName = 'SPX API',
): CallUpAnalysis {
  const driverMap = new Map<string, DriverCallUpStats>()
  const dateMap = new Map<string, { total: number; accepted: number; declined: number }>()
  const clusterMap = new Map<string, { total: number; accepted: number; declined: number; reasons: Record<string, number> }>()
  const reasonSummary: Record<string, number> = {}
  const driversByDateMap = new Map<string, Set<string>>()

  let totalAccepted = 0, totalDeclined = 0, totalCancelled = 0

  for (const n of notifications) {
    const driverId = String(n.driver_id)
    const driverName = n.driver_name
    const status = statusLabel(n)
    const cluster = n.cluster_name ?? ''
    const reason = n.decline_reason ?? ''
    const date = n.notification_date ? tsToDateStr(n.notification_date) : ''
    const triggerDate = n.trigger_time ? tsToDateStr(n.trigger_time) : null

    if (triggerDate && driverId) {
      if (!driversByDateMap.has(triggerDate)) driversByDateMap.set(triggerDate, new Set())
      driversByDateMap.get(triggerDate)!.add(driverId)
    }

    if (status === 'Accepted') totalAccepted++
    else if (status === 'Declined') totalDeclined++
    else totalCancelled++

    const responseSeconds = (status === 'Accepted' && n.accepted_time && n.trigger_time)
      ? n.accepted_time - n.trigger_time
      : (status === 'Declined' && n.decline_time && n.trigger_time)
        ? n.decline_time - n.trigger_time
        : null

    if (driverId) {
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          driverId, driverName, total: 0, accepted: 0, declined: 0, cancelled: 0,
          acceptanceRate: 0, declineReasons: {}, timeoutCount: 0,
          avgResponseSeconds: null, clusters: [], lastAcceptedDate: null,
        })
      }
      const d = driverMap.get(driverId)!
      d.total++
      if (status === 'Accepted') {
        d.accepted++
        if (triggerDate && (!d.lastAcceptedDate || triggerDate > d.lastAcceptedDate)) {
          d.lastAcceptedDate = triggerDate
        }
      } else if (status === 'Declined') {
        d.declined++
        if (reason) d.declineReasons[reason] = (d.declineReasons[reason] ?? 0) + 1
        if (reason === 'Timeout' || reason === '') d.timeoutCount++
      } else {
        d.cancelled++
      }
      if (cluster && !d.clusters.includes(cluster)) d.clusters.push(cluster)
      if (responseSeconds !== null && responseSeconds > 0) {
        d.avgResponseSeconds = d.avgResponseSeconds === null
          ? responseSeconds
          : Math.round((d.avgResponseSeconds + responseSeconds) / 2)
      }
    }

    if (date) {
      if (!dateMap.has(date)) dateMap.set(date, { total: 0, accepted: 0, declined: 0 })
      const dd = dateMap.get(date)!
      dd.total++
      if (status === 'Accepted') dd.accepted++
      if (status === 'Declined') dd.declined++
    }

    if (cluster) {
      if (!clusterMap.has(cluster)) clusterMap.set(cluster, { total: 0, accepted: 0, declined: 0, reasons: {} })
      const cc = clusterMap.get(cluster)!
      cc.total++
      if (status === 'Accepted') cc.accepted++
      else if (status === 'Declined') {
        cc.declined++
        if (reason) cc.reasons[reason] = (cc.reasons[reason] ?? 0) + 1
      }
    }

    if (status === 'Declined' && reason) {
      reasonSummary[reason] = (reasonSummary[reason] ?? 0) + 1
    }
  }

  for (const d of driverMap.values()) {
    const denom = d.total - d.cancelled
    d.acceptanceRate = denom > 0 ? Math.round((d.accepted / denom) * 1000) / 10 : 0
  }

  const totalCalls = notifications.length
  const effectiveCalls = totalCalls - totalCancelled
  const overallAcceptanceRate = effectiveCalls > 0
    ? Math.round((totalAccepted / effectiveCalls) * 1000) / 10 : 0

  const byDate: CallUpDayStats[] = [...dateMap.entries()]
    .map(([date, d]) => ({ date, total: d.total, accepted: d.accepted, declined: d.declined, rate: d.total > 0 ? Math.round((d.accepted / d.total) * 1000) / 10 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const byCluster: ClusterCallUpStats[] = [...clusterMap.entries()]
    .map(([cluster, c]) => ({
      cluster, total: c.total, accepted: c.accepted, declined: c.declined,
      rate: c.total > 0 ? Math.round((c.accepted / c.total) * 1000) / 10 : 0,
      topDeclineReason: Object.entries(c.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.total - a.total)

  const byDriver = [...driverMap.values()].sort((a, b) => a.acceptanceRate - b.acceptanceRate)

  const driversByDate: Record<string, string[]> = {}
  for (const [date, ids] of driversByDateMap) driversByDate[date] = [...ids]

  // First call analysis: one entry per AT ID (earliest trigger_time)
  const atMap = new Map<string, SpxNotification>()
  for (const n of notifications) {
    const atId = n.assignment_task_id
    if (!atId) continue
    const existing = atMap.get(atId)
    if (!existing || n.trigger_time < existing.trigger_time) atMap.set(atId, n)
  }

  const firstDriverMap = new Map<string, FirstCallDriverStats>()
  const firstDateMap = new Map<string, { total: number; accepted: number; declined: number }>()
  const firstReasonSummary: Record<string, number> = {}
  let fcAccepted = 0, fcDeclined = 0

  const fcRoutes: FirstCallRoute[] = [...atMap.values()]
    .sort((a, b) => a.trigger_time - b.trigger_time)
    .map(n => {
      const driverId = String(n.driver_id)
      const driverName = n.driver_name
      const status = statusLabel(n)
      const reason = n.decline_reason || null
      const atId = n.assignment_task_id
      const cluster = n.cluster_name ?? ''
      const triggerDate = n.trigger_time ? tsToDateStr(n.trigger_time) : null
      const effective = status !== 'Cancelled'

      if (effective) {
        if (status === 'Accepted') fcAccepted++
        else fcDeclined++
        if (status === 'Declined' && reason) firstReasonSummary[reason] = (firstReasonSummary[reason] ?? 0) + 1
        if (triggerDate) {
          if (!firstDateMap.has(triggerDate)) firstDateMap.set(triggerDate, { total: 0, accepted: 0, declined: 0 })
          const dd = firstDateMap.get(triggerDate)!
          dd.total++
          if (status === 'Accepted') dd.accepted++
          else dd.declined++
        }
        if (driverId) {
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
      }

      const shift = slotToShift(n.time_slot ?? '')
      const triggerTimeStr = n.trigger_time ? new Date(n.trigger_time * 1000).toISOString().replace('T', ' ').slice(0, 19) : ''
      return { atId, driverId, driverName, status, declineReason: reason, triggerTime: triggerTimeStr, cluster, shift }
    })

  for (const fd of firstDriverMap.values()) {
    fd.acceptanceRate = fd.totalFirstCalls > 0 ? Math.round((fd.accepted / fd.totalFirstCalls) * 1000) / 10 : 0
  }

  const fcTotal = fcAccepted + fcDeclined
  const fcByDate: FirstCallDateStats[] = [...firstDateMap.entries()]
    .map(([date, d]) => ({ date, total: d.total, accepted: d.accepted, declined: d.declined, acceptanceRate: d.total > 0 ? Math.round((d.accepted / d.total) * 1000) / 10 : 0 }))
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
    firstCallAnalysis,
  }
}
