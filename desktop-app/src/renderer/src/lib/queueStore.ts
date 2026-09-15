import type { Shift } from './globalConfig'
import type { QueueEntry } from './queueListParser'

// Persistência da fila de carregamento (QueueList) por dia/turno.

function key(date: string, shift: Shift) {
  return `spx:queue:${date}:${shift}`
}

interface StoredQueue {
  entries: QueueEntry[]
  importedAt: string
  fileName: string
}

export const queueStore = {
  save(date: string, shift: Shift, entries: QueueEntry[], fileName: string) {
    try {
      localStorage.setItem(key(date, shift), JSON.stringify({ entries, importedAt: new Date().toISOString(), fileName }))
    } catch { /* quota */ }
  },
  get(date: string, shift: Shift): StoredQueue | null {
    try { const r = localStorage.getItem(key(date, shift)); return r ? JSON.parse(r) : null } catch { return null }
  },
  clear(date: string, shift: Shift) {
    localStorage.removeItem(key(date, shift))
  },
}
