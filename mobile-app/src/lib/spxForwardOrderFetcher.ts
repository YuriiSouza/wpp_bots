import type { ForwardOrderAnalysis, ForwardPackage, DriverForwardStats, PivotRow } from './forwardOrderParser'

const PAGE_SIZE = 100

// API status codes → CSV status
// order_status filter "2,5" matches OnHold and Delivering in the CSV
const STATUS_MAP: Record<number, 'OnHold' | 'Delivering'> = {
  2: 'OnHold',
  5: 'Delivering',
}

const EXCLUDED_REASONS = new Set([
  'Do not deliver',
  'Parcel lost',
  'Parcel damaged',
])

function isExcluded(reason: string): boolean {
  if (!reason || reason === 'Normal') return false
  if (EXCLUDED_REASONS.has(reason)) return true
  if (reason.toLowerCase().includes('parcel')) return true
  return false
}

function tsToDate(ts: number): Date {
  return new Date(ts * 1000)
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000)
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiOrder = Record<string, any>

interface PageResult {
  total: number
  list: ApiOrder[]
}

async function fetchPage(
  creds: Record<string, string>,
  stationId: string,
  pageno: number,
): Promise<PageResult> {
  const url = 'https://spx.shopee.com.br/api/fleet_order/order/tracking_list/search'
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
  const body = JSON.stringify({
    order_status: '2,5',
    count: PAGE_SIZE,
    current_station_ids: stationId,
    page_no: pageno,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipc = (window as any).electron?.ipcRenderer
  let rawJson: string
  if (ipc?.invoke) {
    rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
  } else {
    const res = await fetch(url, { method: 'POST', headers, body })
    rawJson = await res.text()
  }

  const data = JSON.parse(rawJson) as { retcode?: number; error?: number; message?: string; data?: { total?: number; list?: ApiOrder[]; total_count?: number } }

  // This endpoint returns error/retcode differently from others
  if (data.error && data.error !== 0) throw new Error(`Erro SPX Forward Order: ${data.error}`)
  if (data.retcode !== undefined && data.retcode !== 0) throw new Error(data.message ?? 'Erro SPX Forward Order')

  const list = data.data?.list ?? []
  const total = data.data?.total ?? data.data?.total_count ?? list.length

  // Log first item structure to help debug field names
  if (pageno === 1 && list.length > 0) {
    const statuses = [...new Set(list.map((i: ApiOrder) => i.order_status))]
    console.log('[spxForwardOrder] total:', total, '| order_status values:', statuses)
    console.log('[spxForwardOrder] sample on_hold_time:', list[0].on_hold_time, '| delivering_time:', list[0].delivering_time, '| order_status:', list[0].order_status)
  }

  return { total, list }
}

export async function fetchAllSpxForwardOrder(
  creds: Record<string, string>,
  stationId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ForwardOrderAnalysis> {
  const first = await fetchPage(creds, stationId, 1)
  const all: ApiOrder[] = [...first.list]
  onProgress?.(all.length, first.total)

  if (first.total > PAGE_SIZE) {
    const totalPages = Math.ceil(first.total / PAGE_SIZE)
    // Sequential — this endpoint's x-sap-sec token may reject concurrent requests
    for (let page = 2; page <= totalPages; page++) {
      try {
        const p = await fetchPage(creds, stationId, page)
        all.push(...p.list)
        onProgress?.(all.length, first.total)
      } catch (err) {
        console.warn(`[spxForwardOrder] page ${page} failed, returning ${all.length} of ${first.total} items:`, err)
        break
      }
    }
  }

  return mapToForwardOrder(all)
}

function mapToForwardOrder(items: ApiOrder[]): ForwardOrderAnalysis {
  const now = new Date()
  const packages: ForwardPackage[] = []
  const driverMap = new Map<string, DriverForwardStats>()
  const reasonSummary: Record<string, number> = {}
  const pivotMap = new Map<string, Record<string, number>>()

  for (const item of items) {
    const statusCode: number = item.order_status ?? 0
    const status: 'OnHold' | 'Delivering' = STATUS_MAP[statusCode] ?? 'OnHold'

    const driverId = String(item.driver_id ?? '')
    const driverName = String(item.driver_name ?? '')
    const rawReason = String(item.on_hold_reason ?? '')

    let displayReason: string
    if (status === 'Delivering') {
      displayReason = 'Sem resolução (Delivering)'
    } else {
      if (isExcluded(rawReason)) continue
      displayReason = rawReason || 'Sem motivo'
    }

    const deliveringTs: number = item.delivering_time ?? 0
    const onHoldTs: number = item.on_hold_time ?? 0

    const deliveringTime = deliveringTs ? tsToDate(deliveringTs).toLocaleString('pt-BR') : ''
    const onHoldTime = onHoldTs ? tsToDate(onHoldTs).toLocaleString('pt-BR') : ''

    const refTs = status === 'OnHold' ? onHoldTs : deliveringTs
    const refDate = refTs ? tsToDate(refTs) : null
    const daysOpen = refDate ? daysBetween(refDate, now) : 0

    const onHoldCount = parseInt(String(item.on_hold_times ?? 0), 10) || 0
    const deliveryAttempts = 0  // not in this API response
    const slaTs: number = item.sla_target_time ?? 0
    const slaTargetDate = slaTs ? tsToDate(slaTs).toISOString().slice(0, 10) : ''

    const pkg: ForwardPackage = {
      orderId: String(item.shipment_id ?? ''),
      trackingNumber: String(item.sls_tracking_number ?? item.shipment_id ?? ''),
      driverId,
      driverName,
      status,
      onHoldReason: rawReason,
      displayReason,
      deliveringTime,
      onHoldTime,
      onHoldCount,
      deliveryAttempts,
      slaTargetDate,
      timeToSla: null,
      zone: String(item.zone_name ?? ''),
      daysOpen,
      latitude: null,
      longitude: null,
      locationType: String(item.location_type ?? ''),
    }
    packages.push(pkg)

    if (driverId) {
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, { driverId, driverName, totalPackages: 0, delivering: 0, onHold: 0, byReason: {}, oldestDays: 0, isCritical: false })
      }
      const d = driverMap.get(driverId)!
      d.totalPackages++
      if (status === 'Delivering') d.delivering++
      else d.onHold++
      d.byReason[displayReason] = (d.byReason[displayReason] ?? 0) + 1
      if (daysOpen > d.oldestDays) d.oldestDays = daysOpen
    }

    if (status === 'OnHold') {
      reasonSummary[displayReason] = (reasonSummary[displayReason] ?? 0) + 1
      if (refDate) {
        const dateStr = dateKey(refDate)
        if (!pivotMap.has(dateStr)) pivotMap.set(dateStr, {})
        const cell = pivotMap.get(dateStr)!
        cell[displayReason] = (cell[displayReason] ?? 0) + 1
      }
    } else if (refDate) {
      const dateStr = dateKey(refDate)
      if (!pivotMap.has(dateStr)) pivotMap.set(dateStr, {})
      const cell = pivotMap.get(dateStr)!
      cell['Sem resolução (Delivering)'] = (cell['Sem resolução (Delivering)'] ?? 0) + 1
    }
  }

  for (const d of driverMap.values()) d.isCritical = d.totalPackages >= 10

  const allDrivers = [...driverMap.values()].sort((a, b) => b.totalPackages - a.totalPackages)
  const reasonSet = new Set<string>()
  for (const row of pivotMap.values()) Object.keys(row).forEach(r => reasonSet.add(r))
  const reasons = [...reasonSet].sort()

  const pivot: PivotRow[] = [...pivotMap.entries()]
    .map(([date, byReason]) => ({ date, byReason, total: Object.values(byReason).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalDelivering = packages.filter(p => p.status === 'Delivering').length
  const totalOnHold = packages.filter(p => p.status === 'OnHold').length

  return {
    fileName: 'SPX API',
    importedAt: new Date().toISOString(),
    totalPackages: packages.length,
    totalDelivering,
    totalOnHold,
    criticalDrivers: allDrivers.filter(d => d.isCritical),
    allDrivers,
    byReason: reasonSummary,
    pivot,
    packages,
    reasons,
  }
}
