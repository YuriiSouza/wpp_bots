import type { CallUpAnalysis } from './callUpParser'
import type { ForwardOrderAnalysis } from './forwardOrderParser'
import type { WorkPreferenceData } from './workPreferenceParser'

const KEYS = {
  callUp: 'spx:callup',
  forwardOrder: 'spx:fwdorder',
  workPref: 'spx:workpref',
}

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

function safeSet(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* quota */ }
}

export const reportStore = {
  // Call Up
  saveCallUp: (d: CallUpAnalysis) => safeSet(KEYS.callUp, d),
  getCallUp: (): CallUpAnalysis | null => {
    const d = safeGet<CallUpAnalysis>(KEYS.callUp)
    if (!d) return null
    // Migrate old stored data that may not have new fields
    const emptyFca = { totalRoutes: 0, accepted: 0, declined: 0, acceptanceRate: 0, declineReasonSummary: {}, routes: [], byDriver: [], byDate: [] }
    const fca = { ...emptyFca, ...(d.firstCallAnalysis ?? {}) }
    // Ensure shift field exists on old stored routes
    fca.routes = fca.routes.map((r: import('./callUpParser').FirstCallRoute) => ({ ...r, shift: r.shift ?? null }))
    return { ...d, driversByDate: d.driversByDate ?? {}, firstCallAnalysis: fca }
  },
  clearCallUp: () => localStorage.removeItem(KEYS.callUp),

  // Forward Order
  saveForwardOrder: (d: ForwardOrderAnalysis) => safeSet(KEYS.forwardOrder, d),
  getForwardOrder: (): ForwardOrderAnalysis | null => safeGet(KEYS.forwardOrder),
  clearForwardOrder: () => localStorage.removeItem(KEYS.forwardOrder),

  // Work Preference
  saveWorkPref: (d: WorkPreferenceData) => safeSet(KEYS.workPref, d),
  getWorkPref: (): WorkPreferenceData | null => safeGet(KEYS.workPref),
  clearWorkPref: () => localStorage.removeItem(KEYS.workPref),

  // Meta check — which reports are loaded
  getLoadedReports(): { callUp: boolean; forwardOrder: boolean; workPref: boolean } {
    return {
      callUp: !!localStorage.getItem(KEYS.callUp),
      forwardOrder: !!localStorage.getItem(KEYS.forwardOrder),
      workPref: !!localStorage.getItem(KEYS.workPref),
    }
  },
}
