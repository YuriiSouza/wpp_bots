/**
 * Local persistence for the desktop app.
 * Uses localStorage — Electron has no 5MB browser limit here.
 */

export interface StoredDriver {
  id: string
  name: string
  vehicleType: string
  status: string
  gender: string
  phoneNumber: string
  licensePlate: string
  licenseExpiryDate: string
  contractType: string
  joinedDate: string
  city: string
  agency: string
  dateOfBirth: string
  vehicleManufacturer: string
  vehicleManufacturingYear: string
  lastKycDate: string
  vehicleKycDate: string
  suspensionReason: string
  spxBlocklisted: boolean
}

export interface DriverStoreMeta {
  importedAt: string
  total: number
  fileName: string
}

const DRIVERS_KEY = 'spx:drivers'
const META_KEY = 'spx:drivers:meta'

export const localStore = {
  saveDrivers(drivers: StoredDriver[], meta: Omit<DriverStoreMeta, 'importedAt'>) {
    try {
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers))
      localStorage.setItem(META_KEY, JSON.stringify({ ...meta, importedAt: new Date().toISOString() }))
    } catch (e) {
      console.error('localStore.saveDrivers failed:', e)
    }
  },

  getDrivers(): StoredDriver[] {
    try {
      const raw = localStorage.getItem(DRIVERS_KEY)
      return raw ? (JSON.parse(raw) as StoredDriver[]) : []
    } catch {
      return []
    }
  },

  getMeta(): DriverStoreMeta | null {
    try {
      const raw = localStorage.getItem(META_KEY)
      return raw ? (JSON.parse(raw) as DriverStoreMeta) : null
    } catch {
      return null
    }
  },

  clearDrivers() {
    localStorage.removeItem(DRIVERS_KEY)
    localStorage.removeItem(META_KEY)
  },

  getDriverMap(): Map<string, StoredDriver> {
    const drivers = this.getDrivers()
    return new Map(drivers.map(d => [d.id, d]))
  },
}
