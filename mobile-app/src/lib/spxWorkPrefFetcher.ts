import type { WorkPreferenceData, DriverAvailability, DaySchedule } from './workPreferenceParser'

const PAGE_SIZE = 500

interface SpxDay {
  day_time: number
  day_status: number
  shift_time_list: { shift_id: string; start_time: string; end_time: string }[] | null
}

interface SpxDriver {
  driver_id: number
  driver_name_new: string
  no_show_times: number
  working_day_list: SpxDay[] | null
  cluster_name_list: string[] | null
  driver_vehicle_type_name: string
  is_new_own_fleet_driver: boolean
}

interface PageResult {
  total: number
  list: SpxDriver[]
}

async function fetchPage(
  creds: Record<string, string>,
  startTime: number,
  endTime: number,
  pageno: number,
): Promise<PageResult> {
  const url = 'https://spx.shopee.com.br/api/driverservice/admin/driver/work_preference/own_fleet/list'
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
  const body = JSON.stringify({ start_time: startTime, end_time: endTime, count: PAGE_SIZE, pageno })

  // Route through main process to bypass Chromium's forbidden header restrictions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  console.log('[spxFetcher] window.electron:', !!w.electron, '| ipcRenderer:', !!w.electron?.ipcRenderer, '| spxBridge:', !!w.spxBridge)
  const ipc = w.electron?.ipcRenderer
  let rawJson: string
  if (ipc?.invoke) {
    rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
  } else {
    const res = await fetch(url, { method: 'POST', headers, body })
    rawJson = await res.text()
  }

  const data = JSON.parse(rawJson) as { retcode: number; message?: string; data: { total: number; list: SpxDriver[] } }
  if (data.retcode !== 0) throw new Error(data.message ?? 'Erro SPX')
  return { total: data.data.total, list: data.data.list ?? [] }
}

// "YYYY-MM-DD" → Unix timestamp for midnight UTC-3 (Brasília)
function dateToTs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  // midnight UTC-3 = 03:00 UTC
  return Date.UTC(y, m - 1, d, 3, 0, 0) / 1000
}

// Unix timestamp → "YYYY-MM-DD" (UTC-3)
function tsToDate(ts: number): string {
  // Add 3h to get from UTC-3-midnight to UTC midnight, then extract date
  const d = new Date((ts + 3 * 3600) * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildSchedule(spxDay: SpxDay): DaySchedule {
  const shifts = spxDay.shift_time_list ?? []
  const hasAM = shifts.some(s => s.start_time === '05:30')
  const hasPM = shifts.some(s => s.start_time === '11:15')
  const slotStrings = shifts.map(s => `${s.start_time}-${s.end_time}`)
  return {
    raw: slotStrings.join(', '),
    status: 'available',
    slots: slotStrings,
    hasAM,
    hasPM,
  }
}

export async function fetchAllSpxWorkPref(
  creds: Record<string, string>,
  startDate: string,
  weeksAhead = 2,
  onProgress?: (loaded: number, total: number) => void,
): Promise<SpxDriver[]> {
  const startTime = dateToTs(startDate)
  const endTime = startTime + weeksAhead * 7 * 86400 - 1

  const first = await fetchPage(creds, startTime, endTime, 1)
  const all: SpxDriver[] = [...first.list]
  onProgress?.(all.length, first.total)

  if (first.total > PAGE_SIZE) {
    const remaining = Math.ceil((first.total - PAGE_SIZE) / PAGE_SIZE)
    const pages = await Promise.all(
      Array.from({ length: remaining }, (_, i) =>
        fetchPage(creds, startTime, endTime, i + 2),
      ),
    )
    for (const p of pages) all.push(...p.list)
  }

  onProgress?.(all.length, first.total)
  return all
}

// Converts SPX API response into WorkPreferenceData.
// Merges cluster info from existing XLSX data when available.
export function spxDriversToWorkPref(
  spxDrivers: SpxDriver[],
  existingPref: WorkPreferenceData | null,
): WorkPreferenceData {
  const clusterMap = new Map<string, string[]>()
  if (existingPref) {
    for (const d of existingPref.drivers) {
      clusterMap.set(d.driverId, d.clusters)
    }
  }

  const allDates = new Set<string>()
  const drivers: DriverAvailability[] = spxDrivers.map(d => {
    const schedule: Record<string, DaySchedule> = {}
    for (const day of d.working_day_list ?? []) {
      const dateStr = tsToDate(day.day_time)
      allDates.add(dateStr)
      schedule[dateStr] = buildSchedule(day)
    }

    const driverId = String(d.driver_id)
    return {
      driverId,
      driverName: d.driver_name_new,
      clusters: d.cluster_name_list ?? clusterMap.get(driverId) ?? [],
      vehicleType: d.driver_vehicle_type_name,
      noShowTime: d.no_show_times,
      isNewDriver: d.is_new_own_fleet_driver,
      schedule,
    }
  })

  return {
    fileName: 'SPX API',
    importedAt: new Date().toISOString(),
    dates: [...allDates].sort(),
    drivers,
  }
}
