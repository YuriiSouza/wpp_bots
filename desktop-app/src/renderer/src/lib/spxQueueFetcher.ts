import { extractLetter, type QueueEntry } from './queueListParser'

// Busca a fila de carregamento (tela "Queue List" do SPX) direto da API, usando a sessão
// do SPX que o app já guarda (cURL colado em Atribuição). Substitui o CSV do QueueList.

const URL = 'https://spx.shopee.com.br/api/in-station/dock_management/queue/list'
const PAGE_SIZE = 500
const CREDS_KEY = 'spx:credentials'

interface SpxQueueItem {
  queue_number: string
  driver_id: number
  driver_name: string
  agency: string
  vehicle_number: string
  queue_status: number          // 1 pendente · 2 na fila · 3 em mesa · 4 finalizado · 5 em espera (on hold)
  add_to_queue_time: number     // unix (s)
  last_inform_driver_time: number
  waiting_time: number          // minutos
  assigned_dock_name: string
  occupied_dock_name: string
  allocated_dock_name: string
  on_hold_dock_name: string
  queue_sequence: number
  out_of_waiting_time_threshold: boolean
  order_quantity: number
  assignment_task_id: string
  cluster: string
  corridor_cage: string
}

export type QueueSituation = 'pending' | 'waiting' | 'calling' | 'at-dock' | 'on-hold' | 'done'

export const SITUATION_LABEL: Record<QueueSituation, string> = {
  pending: 'Pendente',
  waiting: 'Na fila',
  calling: 'Chamado p/ mesa',
  'at-dock': 'Na mesa',
  'on-hold': 'Em espera',
  done: 'Saiu',
}

export function getSpxCreds(): Record<string, string> | null {
  try { const raw = localStorage.getItem(CREDS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

const pad = (n: number) => String(n).padStart(2, '0')

function situationOf(q: SpxQueueItem): QueueSituation {
  switch (q.queue_status) {
    case 1: return 'pending'
    case 3: return 'at-dock'
    case 4: return 'done'
    case 5: return 'on-hold'
    default: return (q.allocated_dock_name || q.assigned_dock_name) ? 'calling' : 'waiting'
  }
}

function toEntry(q: SpxQueueItem): QueueEntry {
  const d = q.add_to_queue_time ? new Date(q.add_to_queue_time * 1000) : null
  const cage = q.corridor_cage ?? ''
  const situation = situationOf(q)
  const dock = situation === 'at-dock' ? q.occupied_dock_name
    : situation === 'calling' ? (q.allocated_dock_name || q.assigned_dock_name)
    : situation === 'on-hold' ? q.on_hold_dock_name : ''
  return {
    queueNumber: q.queue_number,
    driverId: String(q.driver_id),
    driverName: q.driver_name,
    agency: q.agency,
    arrival: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
    arrivalMin: d ? d.getHours() * 60 + d.getMinutes() : null,
    waitingTime: q.waiting_time != null ? `${pad(Math.floor(q.waiting_time / 60))}:${pad(q.waiting_time % 60)}` : '',
    waitingMin: q.waiting_time ?? null,
    cage,
    letter: extractLetter(cage),
    atId: q.assignment_task_id,
    cluster: q.cluster,
    situation,
    dock: (dock ?? '').replace(/\s+/g, ' ').trim(),
    calledAt: q.last_inform_driver_time || 0,
    // O SPX congela o waiting_time quando o motorista ocupa a mesa: entrada na fila + espera = hora em que ocupou
    occupiedAt: (q.queue_status === 3 || q.queue_status === 4) && q.add_to_queue_time && q.waiting_time != null ? q.add_to_queue_time + q.waiting_time * 60 : 0,
    queueSequence: q.queue_sequence,
    overWaitLimit: q.out_of_waiting_time_threshold,
    orderQty: q.order_quantity,
    plate: q.vehicle_number,
  }
}

async function fetchPage(creds: Record<string, string>, pageno: number): Promise<{ total: number; list: SpxQueueItem[] }> {
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
  const body = JSON.stringify({ pageno, count: PAGE_SIZE, queue_type: 2, add_to_queue_time: '', queue_status: '1,2,3,5,4' })
  const raw = await window.electron.ipcRenderer.invoke('spx-post', { url: URL, headers, body }) as string
  let data: { retcode: number; message?: string; data?: { total: number; list: SpxQueueItem[] } }
  try { data = JSON.parse(raw) } catch { throw new Error('Resposta inválida do SPX — a sessão pode ter expirado.') }
  if (data.retcode !== 0) throw new Error(`SPX: ${data.message ?? 'erro'} (a sessão pode ter expirado — cole um cURL novo em Atribuição › SPX)`)
  return { total: data.data?.total ?? 0, list: data.data?.list ?? [] }
}

/** Busca a fila inteira do turno atual no SPX. */
export async function fetchSpxQueue(): Promise<QueueEntry[]> {
  const creds = getSpxCreds()
  if (!creds) throw new Error('Sessão do SPX não configurada. Cole o cURL em Atribuição › SPX.')
  const first = await fetchPage(creds, 1)
  const all = [...first.list]
  for (let p = 2; all.length < first.total && p <= 20; p++) {
    const page = await fetchPage(creds, p)
    if (page.list.length === 0) break
    all.push(...page.list)
  }
  return all.map(toEntry)
}

/** "Mesa  4", "MESA 4" e "mesa 4" viram a mesma mesa. */
export function dockKey(name: string): string {
  const n = name.match(/\d+/)
  return n ? `Mesa ${parseInt(n[0], 10)}` : name.trim()
}
