// Dados fictícios para demonstração (vídeos, prints). Nenhum nome, ID, telefone ou AT aqui é real.
import { localStore, type StoredDriver } from './localStore'
import { reportStore } from './reportStore'
import { routeStore } from './routeStore'
import { queueStore } from './queueStore'
import { noShowQueueStore, type QueueDriver } from './noShowQueueStore'
import { parseCallUpCsv } from './callUpParser'
import { parseForwardOrderCsv } from './forwardOrderParser'
import { analyzeCSV } from './dsCalculator'
import { calculatePriorityScore, declineRatePercent } from './priorityScore'
import { DEFAULT_CONFIG, saveGlobalConfig, type Shift } from './globalConfig'
import type { LocalRoute } from './noshowRouteParser'
import type { QueueEntry } from './queueListParser'
import type { DriverAvailability, WorkPreferenceData } from './workPreferenceParser'
import type { RawRoute } from './types'

export const DEMO_FLAG = 'demo:active'
const LOCAL_ONLY = new Set(['spx:sheets-config', 'spx:credentials'])
const isAppKey = (k: string) => (k.startsWith('spx:') || k === 'spx_ds_result') && !LOCAL_ONLY.has(k)

export const isDemoActive = () => localStorage.getItem(DEMO_FLAG) === '1'

export function appDataKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && isAppKey(k)) keys.push(k) }
  return keys
}

export function wipeAppData() {
  for (const k of appDataKeys()) localStorage.removeItem(k)
}

const DEMO_BACKUP = 'demo:backup'

/** Sai do modo demonstração: apaga os dados fictícios e devolve o backup dos reais, se houver. */
export function leaveDemo() {
  if (!isDemoActive()) return false
  wipeAppData()
  try {
    const backup = JSON.parse(localStorage.getItem(DEMO_BACKUP) ?? '{}') as Record<string, string>
    for (const [k, v] of Object.entries(backup)) localStorage.setItem(k, v)
  } catch { /* sem backup: fica vazio até a próxima sincronização */ }
  localStorage.removeItem(DEMO_BACKUP)
  localStorage.removeItem(DEMO_FLAG)
  return true
}

// Gerador determinístico: os mesmos dados a cada vez, para regravar um vídeo sem surpresas.
function rng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
}

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Karen', 'Lucas', 'Marina', 'Nathan', 'Olívia', 'Paulo', 'Rafaela', 'Sérgio', 'Tatiane', 'Vitor', 'Wesley', 'Yasmin', 'Caio', 'Débora', 'Enzo', 'Flávia']
const LAST = ['Almeida', 'Barros', 'Cardoso', 'Duarte', 'Esteves', 'Farias', 'Guimarães', 'Herrera', 'Lacerda', 'Macedo', 'Nogueira', 'Pacheco', 'Queiroz', 'Rezende', 'Siqueira', 'Teixeira', 'Valente', 'Xavier']
const CLUSTERS = ['Centro', 'Jardim das Acácias', 'Vila Aurora', 'Parque do Lago', 'Setor Industrial', 'Bela Vista', 'Santa Clara', 'Alto da Serra', 'Recanto Verde', 'Nova Esperança']
const CITIES = ['Cidade Modelo', 'Vila Exemplo', 'Porto Demo']
const AGENCIES = ['SPXOWNFLEET', 'SPXOWNFLEET', 'SPXOWNFLEET', 'Transportes Aurora', 'Rota Certa Log', 'Expresso Horizonte']
const VEHICLES = ['PASSEIO', 'PASSEIO', 'PASSEIO', 'PASSEIO', 'MOTO', 'MOTO', 'FIORINO', 'VAN']
const DECLINE = ['Timeout', 'Timeout', 'Fora da região de preferência', 'Veículo indisponível', 'Compromisso pessoal', 'Rota muito longa']
const HOLD = ['Recipient unavailable for parcel', 'Cannot find address', 'Office closed', 'Insufficient time', 'Unforeseen Circumstances']
const SLOT: Record<Shift, string> = { AM: '05:30-09:00', PM1: '11:15-15:00', PM2: '17:00-21:00' }
const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const csv = (rows: (string | number)[][]) => rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')

export function seedDemoData(day: string) {
  const rand = rng(20260917)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

  // ── Motoristas ──
  const drivers: (StoredDriver & { clusters: string[]; skill: number; isNew: boolean; shifts: Shift[] })[] = []
  for (let i = 0; i < 90; i++) {
    const vehicleType = VEHICLES[i % VEHICLES.length]
    const r = rand()
    const status = r < 0.78 ? 'Active' : r < 0.88 ? 'Onboarding' : r < 0.94 ? 'Auto-Inactive' : 'Suspended'
    const nClusters = between(1, 4)
    const clusters = [...new Set(Array.from({ length: nClusters }, () => pick(CLUSTERS)))]
    const shifts = SHIFTS.filter(() => rand() < 0.6)
    drivers.push({
      id: String(9000001 + i * 37),
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${LAST[(i * 11 + 3) % LAST.length]}`,
      vehicleType,
      status,
      gender: i % 4 === 0 ? 'Female' : 'Male',
      phoneNumber: `(00) 90000-${pad(1000 + i, 4)}`,
      licensePlate: `DEM${i % 10}A${pad(i % 100)}`,
      licenseExpiryDate: addDays(day, between(-20, 900)),
      contractType: 'Freelancer',
      joinedDate: addDays(day, -between(5, 900)),
      city: pick(CITIES),
      agency: pick(AGENCIES),
      dateOfBirth: `${between(1975, 2002)}-${pad(between(1, 12))}-${pad(between(1, 28))}`,
      vehicleManufacturer: pick(['Fiat', 'Honda', 'Volkswagen', 'Chevrolet', 'Yamaha']),
      vehicleManufacturingYear: String(between(2012, 2025)),
      lastKycDate: addDays(day, -between(10, 300)),
      vehicleKycDate: addDays(day, -between(10, 300)),
      suspensionReason: status === 'Suspended' ? 'Documentação pendente' : '',
      spxBlocklisted: i % 41 === 0,
      clusters,
      skill: 0.86 + rand() * 0.13,
      isNew: i % 9 === 0,
      shifts: shifts.length ? shifts : ['AM'],
    })
  }
  const active = drivers.filter(d => d.status === 'Active')
  localStore.saveDrivers(drivers.map(({ clusters: _c, skill: _s, isNew: _n, shifts: _sh, ...d }) => d), { total: drivers.length, fileName: 'motoristas_demo.csv' })

  // ── Work Preference (disponibilidade) ──
  const dates = Array.from({ length: 7 }, (_, i) => addDays(day, i - 3))
  const wpDrivers: DriverAvailability[] = active.map(d => {
    const schedule: DriverAvailability['schedule'] = {}
    for (const date of dates) {
      const r = rand()
      const slots = d.shifts.map(s => SLOT[s])
      schedule[date] = date === day || r < 0.75
        ? { raw: slots.join(' / '), status: 'available', slots, hasAM: d.shifts.includes('AM'), hasPM: d.shifts.includes('PM1') }
        : r < 0.9 ? { raw: 'Not available', status: 'not_available', slots: [], hasAM: false, hasPM: false }
        : { raw: 'Pending', status: 'pending', slots: [], hasAM: false, hasPM: false }
    }
    return { driverId: d.id, driverName: d.name, clusters: d.clusters, vehicleType: d.vehicleType, noShowTime: rand() < 0.7 ? 0 : between(1, 6), isNewDriver: d.isNew, schedule }
  })
  const workPref: WorkPreferenceData = { fileName: 'work_preference_demo.xlsx', importedAt: new Date().toISOString(), dates, drivers: wpDrivers }
  reportStore.saveWorkPref(workPref)

  // ── Rotas dos últimos 30 dias (Análise DS) ──
  const raw: RawRoute[] = []
  for (const d of active.filter(x => !x.isNew)) {
    const n = between(8, 24)
    for (let k = 0; k < n; k++) {
      const date = addDays(day, -between(1, 30))
      const window = pick(d.shifts.filter(s => s !== 'PM2').length ? d.shifts.filter(s => s !== 'PM2') : ['AM'])
      const delivering = between(60, 140)
      const perf = Math.min(1, Math.max(0.6, d.skill + (rand() - 0.5) * 0.08))
      const start = window === 'AM' ? 6 : 12
      raw.push({
        date, driver_id: d.id, dispatch_window: window, cluster_name: pick(d.clusters),
        Performance: perf.toFixed(4), TaxaAderencia: (0.9 + rand() * 0.1).toFixed(4),
        qty_delivering: delivering, qty_delivered: Math.round(delivering * perf), qty_route_stop: Math.round(delivering * 0.8),
        vehicle_plan: d.vehicleType, vehicle_actual: d.vehicleType,
        DataHoraInicioRota: `${date}T${pad(start)}:${pad(between(0, 59))}:00`,
        DataHoraPrimDelivered: `${date}T${pad(start + 1)}:${pad(between(0, 59))}:00`,
        DataHoraUltDelivered: `${date}T${pad(start + between(5, 8))}:${pad(between(0, 59))}:00`,
        PacoteHora: between(12, 22), PacoteParada: (1 + rand() * 0.4).toFixed(2), route_distance_plan_km: between(25, 90),
      })
    }
  }
  const dsResult = analyzeCSV(raw)
  localStorage.setItem('spx_ds_result', JSON.stringify({ result: dsResult, fileName: 'rotas_demo.csv' }))
  const dsMap = new Map(dsResult.drivers.map(d => [d.driver_id, d.DS_Real]))

  // ── Rotas do dia + Call Up ──
  const callRows: (string | number)[][] = [['Notification ID', 'Call-up Time Slot', 'Station', 'Driver', 'Driver Type', 'Notification Type Type', 'AT ID', 'Clusters', 'Decline Reason', 'Status', 'Trigger Time', 'Accepted/Declined Time']]
  let notif = 500000
  const call = (date: string, shift: Shift, d: (typeof drivers)[number], atId: string, cluster: string, accepted: boolean, hour: number) => {
    const t = `${date.replace(/-/g, '/')} ${pad(hour)}:${pad(between(0, 59))}:${pad(between(0, 59))}`
    callRows.push([notif++, `${date} ${SLOT[shift].replace('-', ' - ')}`, 'HUB DEMO', `[${d.id}] ${d.name}`, 'Freelancer', 'Call-up', atId, cluster, accepted ? '' : pick(DECLINE), accepted ? 'Accepted' : 'Declined', t, t])
  }
  const atCode = (date: string, n: number) => `AT${date.replace(/-/g, '')}DM${n.toString(36).toUpperCase().padStart(3, '0')}`

  // histórico de 20 dias para os gráficos e as taxas de aceite
  let atSeq = 1
  for (let back = 20; back >= 1; back--) {
    const date = addDays(day, -back)
    for (const shift of SHIFTS) {
      const pool = active.filter(d => d.shifts.includes(shift))
      for (let k = 0; k < (shift === 'PM2' ? 6 : 14); k++) {
        const d = pick(pool)
        call(date, shift, d, atCode(date, atSeq++), pick(d.clusters), rand() < d.skill - 0.18, shift === 'AM' ? 4 : shift === 'PM1' ? 10 : 16)
      }
    }
  }

  const acceptedToday = new Map<Shift, Set<string>>(SHIFTS.map(s => [s, new Set<string>()]))
  const routesByShift = new Map<Shift, LocalRoute[]>()
  for (const shift of SHIFTS) {
    const total = shift === 'AM' ? 34 : shift === 'PM1' ? 22 : 12
    const pool = active.filter(d => d.shifts.includes(shift))
    const routes: LocalRoute[] = []
    for (let k = 0; k < total; k++) {
      const cluster = CLUSTERS[k % CLUSTERS.length]
      const heavy = k % 8 === 0
      const vehicle = heavy ? 'FIORINO' : k % 5 === 0 ? 'MOTO' : 'PASSEIO'
      const atId = atCode(day, atSeq++)
      const candidates = pool.filter(d => d.clusters.includes(cluster) && !acceptedToday.get(shift)!.has(d.id) && (vehicle === 'MOTO' ? d.vehicleType === 'MOTO' : d.vehicleType !== 'MOTO'))
      const d = candidates.length ? pick(candidates) : null
      const accepted = !!d && rand() < 0.68
      if (d) {
        call(day, shift, d, atId, cluster, accepted, shift === 'AM' ? 4 : shift === 'PM1' ? 10 : 16)
        if (accepted) acceptedToday.get(shift)!.add(d.id)
      }
      routes.push({
        id: atId, atId, gaiola: `${String.fromCharCode(65 + Math.floor(k / 9))}-${(k % 9) + 1}`, cluster,
        requiredVehicleType: vehicle, cidade: pick(CITIES), isInterior: false, ciclo: shift,
        paradas: between(55, 110), spr: between(70, 130), km: between(25, 90), gg: heavy ? between(2, 4) : between(0, 1), volume: heavy ? between(820, 1100) : between(380, 690),
        scheduledVehicle: vehicle,
        status: accepted ? 'ATRIBUIDA' : 'DISPONIVEL',
        assignedDriverId: accepted ? d!.id : null,
        assignedDriverName: accepted ? d!.name : null,
      })
    }
    routesByShift.set(shift, routes)
    routeStore.save(day, shift, routes)
  }
  const callUp = parseCallUpCsv(csv(callRows), 'call_up_demo.csv', DEFAULT_CONFIG)
  reportStore.saveCallUp(callUp)
  const cuMap = new Map(callUp.byDriver.map(d => [d.driverId, d]))

  // ── Fila de sugestão por turno ──
  for (const shift of SHIFTS) {
    const queue: QueueDriver[] = active
      .filter(d => d.shifts.includes(shift) && !acceptedToday.get(shift)!.has(d.id))
      .map(d => {
        const ds = dsMap.get(d.id)
        const cu = cuMap.get(d.id)
        return { driverId: d.id, name: d.name, vehicleType: d.vehicleType, clusters: d.clusters, isBlocked: false, priorityScore: calculatePriorityScore(ds != null ? ds * 100 : 50, declineRatePercent(cu), wpDrivers.find(w => w.driverId === d.id)?.noShowTime ?? 0) }
      })
    noShowQueueStore.set(shift, queue)
  }

  // ── Pacotes em aberto ──
  const pkgRows: (string | number)[][] = [['Order ID', 'SLS Tracking Number', 'Driver ID', 'Driver Name', 'Status', 'OnHoldReason', 'Delivering Time', 'OnHold Time', 'Total of On Hold Times', 'Delivery Attempts', 'SLA Target Date', 'Time to SLA', 'Zone', 'Latitude', 'Longitude', 'Location Type']]
  let pkg = 1
  active.slice(0, 26).forEach((d, i) => {
    const n = i < 3 ? between(11, 16) : i < 7 ? between(6, 9) : between(1, 4)
    for (let k = 0; k < n; k++) {
      const onHold = rand() < 0.45
      const date = addDays(day, -between(0, 4))
      const time = `${date} ${pad(between(8, 19))}:${pad(between(0, 59))}:00`
      pkgRows.push([`DEMO${pad(pkg, 6)}`, `BR00DEMO${pad(pkg++, 6)}`, d.id, d.name, onHold ? 'OnHold' : 'Delivering', onHold ? pick(HOLD) : 'Normal', time, onHold ? time : '', onHold ? between(1, 3) : 0, between(0, 3), addDays(date, 2), between(-20, 40), pick(d.clusters), (-10.5 + (rand() - 0.5) * 0.12).toFixed(5), (-48.3 + (rand() - 0.5) * 0.12).toFixed(5), rand() < 0.7 ? 'Home' : 'Office'])
    }
  })
  reportStore.saveForwardOrder(parseForwardOrderCsv(csv(pkgRows), 'pacotes_demo.csv'))

  // ── Carregamento (fila de chegada) ──
  for (const shift of SHIFTS) {
    const base = shift === 'AM' ? 5 * 60 + 30 : shift === 'PM1' ? 11 * 60 + 15 : 17 * 60
    const entries: QueueEntry[] = []
    routesByShift.get(shift)!.filter(r => r.status === 'ATRIBUIDA').forEach((r, i) => {
      if (rand() < 0.2) return // ainda não chegou
      const letter = r.gaiola!.split('-')[0]
      const slotStart = base + (letter.charCodeAt(0) - 65) * 20
      const arrival = slotStart + between(-45, rand() < 0.2 ? 25 : -5)
      const waiting = between(5, 70)
      const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
      entries.push({
        queueNumber: String(i + 1), driverId: r.assignedDriverId!, driverName: r.assignedDriverName!, agency: 'SPXOWNFLEET',
        arrival: `${day} ${hhmm(arrival)}`, arrivalMin: arrival, waitingTime: hhmm(waiting), waitingMin: waiting,
        cage: r.gaiola!, letter, atId: r.atId, cluster: r.cluster,
      })
    })
    queueStore.save(day, shift, entries, 'queuelist_demo.csv')
    localStorage.setItem(`spx:load-windows:${shift}`, JSON.stringify([{ startCage: 'A', startTime: `${pad(Math.floor(base / 60))}:${pad(base % 60)}` }]))
  }

  saveGlobalConfig({ ...DEFAULT_CONFIG, hubName: 'HUB DEMO' })
  localStorage.setItem('spx:header', JSON.stringify({ day, shift: 'AM' }))
  localStorage.setItem(DEMO_FLAG, '1')
}
