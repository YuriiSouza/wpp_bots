import type { Shift } from './globalConfig'

const PREFIX = 'spx:noshow-queue'

export interface QueueDriver {
  driverId: string
  name: string
  vehicleType: string | null
  clusters: string[]
  priorityScore: number
  isBlocked: boolean
}

export const noShowQueueStore = {
  key(shift: Shift) { return `${PREFIX}:${shift}` },

  get(shift: Shift): QueueDriver[] {
    try { return JSON.parse(localStorage.getItem(this.key(shift)) ?? '[]') } catch { return [] }
  },

  set(shift: Shift, drivers: QueueDriver[]) {
    localStorage.setItem(this.key(shift), JSON.stringify(drivers))
  },

  remove(shift: Shift, driverIds: string | string[]) {
    const ids = new Set(Array.isArray(driverIds) ? driverIds : [driverIds])
    this.set(shift, this.get(shift).filter(d => !ids.has(d.driverId)))
  },

  clear(shift: Shift) {
    localStorage.removeItem(this.key(shift))
  },

  size(shift: Shift) { return this.get(shift).length },
}
