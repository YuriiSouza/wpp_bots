import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { storage } from './storage'
import { localStore, type StoredDriver } from './localStore'
import { reportStore } from './reportStore'
import { buildDriverProfiles } from './crossAnalysis'
import { getGlobalConfig, driverMatchesShift, type Shift } from './globalConfig'
import { noShowQueueStore, type QueueDriver } from './noShowQueueStore'
import { calculatePriorityScore, declineRatePercent } from './priorityScore'
import type { AnalysisResult, DriverResult } from './types'
import type { CallUpAnalysis } from './callUpParser'
import type { ForwardOrderAnalysis } from './forwardOrderParser'
import type { WorkPreferenceData } from './workPreferenceParser'

const DS_KEY = 'spx_ds_result'
const HEADER_KEY = 'spx:header'

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function read<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : null } catch { return null }
}

export interface AppData {
  version: number
  day: string
  shift: Shift
  setDay: (d: string) => void
  setShift: (s: Shift) => void
  ds: { result: AnalysisResult; fileName: string } | null
  dsDrivers: DriverResult[]
  registry: StoredDriver[]
  driversMeta: ReturnType<typeof localStore.getMeta>
  callUp: CallUpAnalysis | null
  forwardOrder: ForwardOrderAnalysis | null
  workPref: WorkPreferenceData | null
  profiles: ReturnType<typeof buildDriverProfiles> | null
  driverMeta: Map<string, { vehicleType: string; ds: number | null; isNewDriver?: boolean }>
  rebuildQueues: (forDay?: string) => void
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  useEffect(() => storage.subscribe(() => setVersion(v => v + 1)), [])

  const header = read<{ day?: string; shift?: Shift }>(HEADER_KEY) ?? {}
  const day = header.day ?? localDateStr()
  const shift = header.shift ?? 'AM'

  const data = useMemo(() => {
    const ds = read<{ result: AnalysisResult; fileName: string }>(DS_KEY)
    const dsDrivers = ds?.result.drivers ?? []
    const registry = localStore.getDrivers()
    const callUp = reportStore.getCallUp()
    const forwardOrder = reportStore.getForwardOrder()
    const workPref = reportStore.getWorkPref()
    const profiles = (!registry.length && !dsDrivers.length && !callUp && !forwardOrder && !workPref) ? null
      : buildDriverProfiles({
        registry,
        dsDrivers,
        callUpDrivers: callUp?.byDriver ?? [],
        forwardDrivers: forwardOrder?.allDrivers ?? [],
        workPrefDrivers: workPref?.drivers ?? [],
        today: localDateStr(),
      })
    const driverMeta = new Map<string, { vehicleType: string; ds: number | null; isNewDriver?: boolean }>()
    for (const d of workPref?.drivers ?? []) driverMeta.set(d.driverId, { vehicleType: d.vehicleType, ds: null, isNewDriver: d.isNewDriver })
    for (const d of dsDrivers) driverMeta.set(d.driver_id, { ...(driverMeta.get(d.driver_id) ?? { vehicleType: '' }), ds: d.DS_Real })
    return { ds, dsDrivers, registry, driversMeta: localStore.getMeta(), callUp, forwardOrder, workPref, profiles, driverMeta }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const rebuildQueues = useCallback((forDay?: string) => {
    const wp = data.workPref
    if (!wp) return
    const cfg = getGlobalConfig()
    const target = forDay ?? day
    const dsMap = new Map(data.dsDrivers.map(d => [d.driver_id, d]))
    const cuMap = new Map((data.callUp?.byDriver ?? []).map(d => [d.driverId, d]))
    for (const s of ['AM', 'PM1', 'PM2'] as const) {
      const queue: QueueDriver[] = wp.drivers
        .filter(d => {
          const sched = d.schedule[target]
          return !!sched && sched.status === 'available' && driverMatchesShift(sched.slots, s, cfg)
        })
        .map(d => {
          const dsR = dsMap.get(d.driverId)
          const cu = cuMap.get(d.driverId)
          const dsPercent = dsR?.DS_Real != null ? dsR.DS_Real * 100 : 50
          return {
            driverId: d.driverId,
            name: d.driverName || d.driverId,
            vehicleType: d.vehicleType || null,
            clusters: d.clusters,
            priorityScore: calculatePriorityScore(dsPercent, declineRatePercent(cu), d.noShowTime ?? 0),
            isBlocked: false,
          }
        })
      noShowQueueStore.set(s, queue)
    }
  }, [data, day])

  const setDay = useCallback((d: string) => {
    localStorage.setItem(HEADER_KEY, JSON.stringify({ day: d, shift }))
    rebuildQueues(d)
  }, [shift, rebuildQueues])

  const setShift = useCallback((s: Shift) => {
    localStorage.setItem(HEADER_KEY, JSON.stringify({ day, shift: s }))
  }, [day])

  const value: AppData = { version, day, shift, setDay, setShift, rebuildQueues, ...data }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppData fora do AppDataProvider')
  return v
}
