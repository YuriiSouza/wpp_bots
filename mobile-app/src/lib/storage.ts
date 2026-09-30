import AsyncStorage from '@react-native-async-storage/async-storage'

// Sync in-memory mirror of AsyncStorage exposed as `localStorage`, so the lib code shared with desktop runs unchanged.
const mem = new Map<string, string>()
const dirty = new Set<string>()
const listeners = new Set<() => void>()
const DIRTY_KEY = '__dirty_keys'
let flushTimer: ReturnType<typeof setTimeout> | null = null
const pendingWrites = new Map<string, string | null>()

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(async () => {
    flushTimer = null
    const writes = [...pendingWrites]
    pendingWrites.clear()
    const sets = writes.filter(([, v]) => v !== null) as [string, string][]
    const removes = writes.filter(([, v]) => v === null).map(([k]) => k)
    if (sets.length) await AsyncStorage.multiSet(sets)
    if (removes.length) await AsyncStorage.multiRemove(removes)
    await AsyncStorage.setItem(DIRTY_KEY, JSON.stringify([...dirty]))
  }, 300)
}

function notify() { listeners.forEach(l => l()) }

const shim: Storage = {
  get length() { return mem.size },
  key(i: number) { return [...mem.keys()][i] ?? null },
  getItem(k: string) { return mem.has(k) ? mem.get(k)! : null },
  setItem(k: string, v: string) {
    v = String(v)
    if (mem.get(k) === v) return
    mem.set(k, v); dirty.add(k); pendingWrites.set(k, v); scheduleFlush(); notify()
  },
  removeItem(k: string) {
    if (!mem.has(k)) return
    mem.delete(k); dirty.add(k); pendingWrites.set(k, null); scheduleFlush(); notify()
  },
  clear() { [...mem.keys()].forEach(k => shim.removeItem(k)) },
}

;(globalThis as unknown as { localStorage: Storage }).localStorage = shim

export async function hydrateStorage() {
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k !== DIRTY_KEY)
  const pairs = await AsyncStorage.multiGet(keys)
  for (const [k, v] of pairs) if (v !== null) mem.set(k, v)
  try { for (const k of JSON.parse((await AsyncStorage.getItem(DIRTY_KEY)) ?? '[]')) dirty.add(k) } catch {}
}

export const storage = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
  dirtyKeys: () => [...dirty],
  clearDirty() { dirty.clear(); AsyncStorage.setItem(DIRTY_KEY, '[]') },
  // Replace local values with remote ones without marking them dirty.
  applyRemote(entries: Map<string, string>, keep: (k: string) => boolean) {
    for (const [k, v] of entries) {
      if (dirty.has(k)) continue
      mem.set(k, v); pendingWrites.set(k, v)
    }
    for (const k of [...mem.keys()]) {
      if (keep(k) && !entries.has(k) && !dirty.has(k)) { mem.delete(k); pendingWrites.set(k, null) }
    }
    scheduleFlush(); notify()
  },
}

// Shared SPX fetchers call window.electron.ipcRenderer.invoke('spx-post'); on mobile there is no CORS, so plain fetch works.
;(globalThis as unknown as { window: unknown }).window = globalThis
;(globalThis as unknown as { electron: unknown }).electron = {
  ipcRenderer: {
    async invoke(channel: string, arg: { url: string; headers: Record<string, string>; body: string }) {
      if (channel !== 'spx-post') throw new Error(`Canal não suportado no celular: ${channel}`)
      const res = await fetch(arg.url, { method: 'POST', headers: arg.headers, body: arg.body })
      return res.text()
    },
  },
}
