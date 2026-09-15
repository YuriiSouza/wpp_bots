import Papa from 'papaparse'

export interface ForwardPackage {
  orderId: string
  trackingNumber: string
  driverId: string
  driverName: string
  status: 'Delivering' | 'OnHold'
  onHoldReason: string
  displayReason: string
  deliveringTime: string
  onHoldTime: string
  onHoldCount: number
  deliveryAttempts: number
  slaTargetDate: string
  timeToSla: number | null
  zone: string
  daysOpen: number
  latitude: number | null
  longitude: number | null
  locationType: 'Home' | 'Office' | string
}

export interface DriverForwardStats {
  driverId: string
  driverName: string
  totalPackages: number
  delivering: number
  onHold: number
  byReason: Record<string, number>
  oldestDays: number
  isCritical: boolean
}

export interface PivotRow {
  date: string
  byReason: Record<string, number>
  total: number
}

export interface ForwardOrderAnalysis {
  fileName: string
  importedAt: string
  totalPackages: number
  totalDelivering: number
  totalOnHold: number
  criticalDrivers: DriverForwardStats[]
  allDrivers: DriverForwardStats[]
  byReason: Record<string, number>
  pivot: PivotRow[]
  packages: ForwardPackage[]
  reasons: string[]
}

// Reasons excluded from analysis per business rules
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

const REASON_ACTIONS: Record<string, string> = {
  'Unforeseen Circumstances': 'Pedir descrição real do ocorrido',
  'Insufficient time': 'Válido apenas para rotas carregadas após 17h com autorização',
  'Recipient unavailable for parcel': 'Sugerir ligação prévia ao destinatário',
  'Cannot find address': 'Sugerir ligação prévia ao destinatário',
  'Office closed': 'Priorizar endereços comerciais no início da rota',
  'Vehicle breakdown': 'Verificar comunicação com o hub e tentativa de redistribuição',
  'Wrongly assigned': 'Erro operacional — escalar para a operação',
  'Risky area of delivery': 'Verificar protocolo e comunicação ao hub',
  'Theft': 'Caso urgente — acionar imediatamente para abertura de ocorrência',
  'Recipient change location': 'Verificar novo endereço e reagendar',
}

export const REASON_ACTION_MAP = REASON_ACTIONS

function parseDate(s: string): Date | null {
  if (!s) return null
  // "07-09-2026 06:58" → parse as DD-MM-YYYY HH:mm
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/)
  if (m) {
    return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000)
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseForwardOrderCsv(csvText: string, fileName: string): ForwardOrderAnalysis {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  const now = new Date()
  const rawRows = result.data as Record<string, string>[]

  const packages: ForwardPackage[] = []
  const driverMap = new Map<string, DriverForwardStats>()
  const reasonSummary: Record<string, number> = {}
  const pivotMap = new Map<string, Record<string, number>>()

  for (const row of rawRows) {
    const status = (row['Status'] || '').trim() as 'Delivering' | 'OnHold'
    if (status !== 'Delivering' && status !== 'OnHold') continue

    const rawReason = (row['OnHoldReason'] || '').trim()

    // For Delivering, reason is "Normal" (meaningless) → display as "Sem resolução"
    // For OnHold, use actual reason, skip excluded
    let displayReason: string
    if (status === 'Delivering') {
      displayReason = 'Sem resolução (Delivering)'
    } else {
      if (isExcluded(rawReason)) continue
      displayReason = rawReason || 'Sem motivo'
    }

    const driverId = (row['Driver ID'] || '').trim()
    const driverName = (row['Driver Name'] || '').trim()
    const deliveringTime = (row['Delivering Time'] || '').trim()
    const onHoldTime = (row['OnHold Time'] || '').trim()

    const refTimeStr = status === 'OnHold' ? onHoldTime : deliveringTime
    const refDate = parseDate(refTimeStr)
    const daysOpen = refDate ? daysBetween(refDate, now) : 0

    const onHoldCount = parseInt(row['Total of On Hold Times'] || '0', 10) || 0
    const deliveryAttempts = parseInt(row['Delivery Attempts'] || '0', 10) || 0
    const timeToSlaRaw = parseFloat(row['Time to SLA'] || '')
    const timeToSla = isNaN(timeToSlaRaw) ? null : timeToSlaRaw

    const pkg: ForwardPackage = {
      orderId: row['Order ID'] || '',
      trackingNumber: row['SLS Tracking Number'] || '',
      driverId,
      driverName,
      status,
      onHoldReason: rawReason,
      displayReason,
      deliveringTime,
      onHoldTime,
      onHoldCount,
      deliveryAttempts,
      slaTargetDate: row['SLA Target Date'] || '',
      timeToSla,
      zone: row['Zone'] || '',
      daysOpen,
      latitude: parseFloat(row['Latitude'] || '') || null,
      longitude: parseFloat(row['Longitude'] || '') || null,
      locationType: (row['Location Type'] || '').trim(),
    }
    packages.push(pkg)

    // Per driver
    if (driverId) {
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          driverId,
          driverName,
          totalPackages: 0,
          delivering: 0,
          onHold: 0,
          byReason: {},
          oldestDays: 0,
          isCritical: false,
        })
      }
      const d = driverMap.get(driverId)!
      d.totalPackages++
      if (status === 'Delivering') d.delivering++
      else d.onHold++
      d.byReason[displayReason] = (d.byReason[displayReason] ?? 0) + 1
      if (daysOpen > d.oldestDays) d.oldestDays = daysOpen
    }

    // Reason summary (exclude Delivering "Sem resolução" from On Hold pivot)
    if (status === 'OnHold') {
      reasonSummary[displayReason] = (reasonSummary[displayReason] ?? 0) + 1
      // Pivot: date × reason
      const dateStr = refDate ? dateKey(refDate) : 'desconhecida'
      if (!pivotMap.has(dateStr)) pivotMap.set(dateStr, {})
      const cell = pivotMap.get(dateStr)!
      cell[displayReason] = (cell[displayReason] ?? 0) + 1
    } else {
      // Delivering pivot
      if (refDate) {
        const dateStr = dateKey(refDate)
        if (!pivotMap.has(dateStr)) pivotMap.set(dateStr, {})
        const cell = pivotMap.get(dateStr)!
        cell['Sem resolução (Delivering)'] = (cell['Sem resolução (Delivering)'] ?? 0) + 1
      }
    }
  }

  // Mark critical (10+ packages)
  for (const d of driverMap.values()) {
    d.isCritical = d.totalPackages >= 10
  }

  const allDrivers = [...driverMap.values()].sort((a, b) => b.totalPackages - a.totalPackages)
  const criticalDrivers = allDrivers.filter(d => d.isCritical)

  // Build all unique reasons for pivot columns
  const reasonSet = new Set<string>()
  for (const row of pivotMap.values()) Object.keys(row).forEach(r => reasonSet.add(r))
  const reasons = [...reasonSet].sort()

  const pivot: PivotRow[] = [...pivotMap.entries()]
    .map(([date, byReason]) => ({
      date,
      byReason,
      total: Object.values(byReason).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalDelivering = packages.filter(p => p.status === 'Delivering').length
  const totalOnHold = packages.filter(p => p.status === 'OnHold').length

  return {
    fileName,
    importedAt: new Date().toISOString(),
    totalPackages: packages.length,
    totalDelivering,
    totalOnHold,
    criticalDrivers,
    allDrivers,
    byReason: reasonSummary,
    pivot,
    packages,
    reasons,
  }
}
