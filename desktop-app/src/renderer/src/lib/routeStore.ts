import type { LocalRoute } from './noshowRouteParser'
import type { Shift } from './globalConfig'

function routeKey(date: string, shift: Shift) {
  return `spx:routes:${date}:${shift}`
}

function overrideKey(date: string, shift: Shift) {
  return `spx:overrides:${date}:${shift}`
}

function safeGet<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null } catch { return null }
}

function safeSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* quota */ }
}

// Migrate old ROUTES_KEY format to new per-shift key
export function migrateOldRoutes(today: string, shift: Shift) {
  const oldKey = `spx:noshow-routes-${today}`
  const oldData = safeGet<LocalRoute[]>(oldKey)
  if (!oldData || oldData.length === 0) return
  if (safeGet(routeKey(today, shift))) return  // already migrated
  safeSet(routeKey(today, shift), oldData)
}

export const routeStore = {
  save(date: string, shift: Shift, routes: LocalRoute[]) {
    safeSet(routeKey(date, shift), routes)
  },

  get(date: string, shift: Shift): LocalRoute[] | null {
    return safeGet<LocalRoute[]>(routeKey(date, shift))
  },

  list(): { date: string; shift: Shift; count: number }[] {
    const result: { date: string; shift: Shift; count: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('spx:routes:')) continue
      const rest = key.slice('spx:routes:'.length)
      const dateMatch = rest.match(/^(\d{4}-\d{2}-\d{2}):(AM|PM1|PM2)$/)
      if (!dateMatch) continue
      const date = dateMatch[1]
      const shift = dateMatch[2] as Shift
      const routes = safeGet<LocalRoute[]>(key) ?? []
      result.push({ date, shift, count: routes.length })
    }
    return result.sort((a, b) => b.date.localeCompare(a.date) || a.shift.localeCompare(b.shift))
  },

  delete(date: string, shift: Shift) {
    localStorage.removeItem(routeKey(date, shift))
    localStorage.removeItem(overrideKey(date, shift))
  },

  saveOverrides(date: string, shift: Shift, entries: [string, unknown][]) {
    safeSet(overrideKey(date, shift), entries)
  },

  getOverrides(date: string, shift: Shift): [string, unknown][] | null {
    return safeGet(overrideKey(date, shift))
  },
}
