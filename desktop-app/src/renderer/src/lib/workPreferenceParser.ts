import * as XLSX from 'xlsx'

export type AvailabilityStatus = 'available' | 'not_available' | 'pending' | 'no_schedule'

export interface DaySchedule {
  raw: string
  status: AvailabilityStatus
  slots: string[]  // e.g. ['05:30-09:00', '11:15-15:00']
  hasAM: boolean   // 05:30-09:00
  hasPM: boolean   // 11:15-15:00
}

export interface DriverAvailability {
  driverId: string
  driverName: string
  clusters: string[]
  vehicleType: string
  noShowTime: number
  isNewDriver: boolean
  schedule: Record<string, DaySchedule>  // date string (YYYY-MM-DD) → schedule
}

export interface WorkPreferenceData {
  fileName: string
  importedAt: string
  dates: string[]
  drivers: DriverAvailability[]
}

function parseScheduleCell(raw: string | null | undefined): DaySchedule {
  const s = (raw ?? '').toString().trim()

  if (!s || s === '--') {
    return { raw: s, status: 'no_schedule', slots: [], hasAM: false, hasPM: false }
  }

  const lower = s.toLowerCase()
  if (lower === 'not available') {
    return { raw: s, status: 'not_available', slots: [], hasAM: false, hasPM: false }
  }
  if (lower.includes('pending')) {
    return { raw: s, status: 'pending', slots: [], hasAM: false, hasPM: false }
  }

  // Contains time slots like "05:30-09:00" or "11:15-15:00"
  const timePattern = /\d{2}:\d{2}-\d{2}:\d{2}/g
  const slots = s.match(timePattern) ?? []
  const hasAM = slots.some(sl => sl.startsWith('05:') || sl.startsWith('06:') || sl.startsWith('07:'))
  const hasPM = slots.some(sl => sl.startsWith('11:') || sl.startsWith('12:') || sl.startsWith('13:') || sl.startsWith('14:'))

  return {
    raw: s,
    status: slots.length > 0 ? 'available' : 'pending',
    slots,
    hasAM,
    hasPM,
  }
}

function excelDateToISO(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

export function parseWorkPreferenceXlsx(arrayBuffer: ArrayBuffer, fileName: string): WorkPreferenceData {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, defval: null }) as unknown[][]

  if (rows.length < 2) {
    return { fileName, importedAt: new Date().toISOString(), dates: [], drivers: [] }
  }

  const headers = rows[0] as (string | null)[]

  // Find date columns (indices 5..n-2, last column is "New Driver")
  const fixedCols = ['Driver ID', 'Driver Name', 'Cluster', 'Vehicle Type', 'No Show Time']
  const dateColIndices: number[] = []
  const dates: string[] = []

  for (let i = 5; i < headers.length - 1; i++) {
    const h = headers[i]
    const iso = excelDateToISO(h)
    if (iso) {
      dateColIndices.push(i)
      dates.push(iso)
    } else if (typeof h === 'string' && h.match(/\d{4}-\d{2}-\d{2}/)) {
      dateColIndices.push(i)
      dates.push(h)
    }
  }

  // New Driver is the last column
  const newDriverIdx = headers.length - 1

  const drivers: DriverAvailability[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[]
    const rawId = row[0]
    if (!rawId) continue

    const driverId = typeof rawId === 'number'
      ? Math.round(rawId).toString()
      : String(rawId).trim()

    const driverName = String(row[1] ?? '').trim()
    const clusterRaw = String(row[2] ?? '').trim()
    const clusters = clusterRaw ? clusterRaw.split(',').map(c => c.trim()).filter(Boolean) : []
    const vehicleType = String(row[3] ?? '').trim()
    const noShowTime = typeof row[4] === 'number' ? row[4] : parseFloat(String(row[4] ?? '0')) || 0
    const newDriverRaw = String(row[newDriverIdx] ?? '').trim().toLowerCase()
    const isNewDriver = newDriverRaw === 'yes' || newDriverRaw === '1' || newDriverRaw === 'true'

    const schedule: Record<string, DaySchedule> = {}
    for (let di = 0; di < dateColIndices.length; di++) {
      const colIdx = dateColIndices[di]
      const date = dates[di]
      const cellValue = colIdx < row.length ? row[colIdx] : null
      schedule[date] = parseScheduleCell(cellValue as string)
    }

    drivers.push({
      driverId,
      driverName,
      clusters,
      vehicleType,
      noShowTime,
      isNewDriver,
      schedule,
    })
  }

  return {
    fileName,
    importedAt: new Date().toISOString(),
    dates,
    drivers,
  }
}
