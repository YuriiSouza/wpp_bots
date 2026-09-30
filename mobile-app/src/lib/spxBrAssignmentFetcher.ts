import type { BrAssignmentEntry } from './brAssignmentParser'

const PAGE_SIZE = 100

interface SpxAssignmentTask {
  assignment_task_id: string
  driver_id: number
  driver_name: string
  delivery_time: number  // unix ts UTC-3 midnight
}

interface PageResult {
  total: number
  list: SpxAssignmentTask[]
}

function tsToDate(ts: number): string {
  const d = new Date((ts + 3 * 3600) * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function fetchPage(
  creds: Record<string, string>,
  pageno: number,
  extraFilters: Record<string, unknown> = {},
): Promise<PageResult> {
  const url = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/search/v2'
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
  const body = JSON.stringify({ pageno, count: PAGE_SIZE, search_type: 0, ...extraFilters })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipc = (window as any).electron?.ipcRenderer
  let rawJson: string
  if (ipc?.invoke) {
    rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
  } else {
    const res = await fetch(url, { method: 'POST', headers, body })
    rawJson = await res.text()
  }

  const data = JSON.parse(rawJson) as { retcode: number; message?: string; data: { total: number; list: SpxAssignmentTask[] } }
  if (data.retcode !== 0) throw new Error(data.message ?? 'Erro SPX BR Assignment')
  return { total: data.data.total, list: data.data.list ?? [] }
}

export async function fetchAllSpxBrAssignment(
  creds: Record<string, string>,
  extraFilters: Record<string, unknown> = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<Map<string, BrAssignmentEntry>> {
  const first = await fetchPage(creds, 1, extraFilters)
  const all: SpxAssignmentTask[] = [...first.list]
  onProgress?.(all.length, first.total)

  if (first.total > PAGE_SIZE) {
    const remaining = Math.ceil((first.total - PAGE_SIZE) / PAGE_SIZE)
    const pages = await Promise.all(
      Array.from({ length: remaining }, (_, i) => fetchPage(creds, i + 2, extraFilters)),
    )
    for (const p of pages) all.push(...p.list)
  }

  onProgress?.(all.length, first.total)

  const result = new Map<string, BrAssignmentEntry>()
  for (const t of all) {
    if (!t.assignment_task_id || !t.driver_id) continue
    result.set(t.assignment_task_id, {
      atId: t.assignment_task_id,
      driverId: String(t.driver_id),
      driverName: t.driver_name ?? '',
      deliveryDate: t.delivery_time ? tsToDate(t.delivery_time) : '',
    })
  }
  return result
}
