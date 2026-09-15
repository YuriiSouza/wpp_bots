import type { StoredDriver } from './localStore'

/**
 * Parse the SPX driver registry CSV (br_driver_*.csv).
 * Handles BOM, scientific-notation IDs, and Excel single-quote prefixes.
 */

function normalizeSpxId(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/^'/, '')
  if (!trimmed) return ''
  const asFloat = parseFloat(trimmed)
  if (!isNaN(asFloat) && isFinite(asFloat)) return String(Math.round(asFloat))
  return trimmed
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let inQuotes = false
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cols.push(cur)
  return cols
}

function clean(v: string | undefined): string {
  return String(v || '').replace(/^'/, '').trim()
}

export interface DriverParseResult {
  drivers: StoredDriver[]
  total: number
  skipped: number
  error?: string
}

export function parseDriverCsv(csvText: string): DriverParseResult {
  const text = csvText.replace(/^﻿/, '') // strip BOM
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return { drivers: [], total: 0, skipped: 0, error: 'CSV vazio.' }

  const headers = parseCsvLine(lines[0]).map(h => h.trim())
  const idx = (name: string) => headers.indexOf(name)

  // Validate it's the right file
  if (idx('Driver ID') < 0 || idx('Driver Name') < 0) {
    return {
      drivers: [],
      total: 0,
      skipped: 0,
      error: 'Arquivo não reconhecido como relatório de motoristas SPX. Colunas "Driver ID" e "Driver Name" não encontradas.',
    }
  }

  const drivers: StoredDriver[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = parseCsvLine(line)
    const get = (name: string) => clean(cols[idx(name)])

    const rawId = get('Driver ID')
    const id = normalizeSpxId(rawId)
    if (!id) { skipped++; continue }

    drivers.push({
      id,
      name: get('Driver Name'),
      vehicleType: get('Vehicle Type'),
      status: get('Status'),
      gender: get('Gender'),
      phoneNumber: get('Phone Number'),
      licensePlate: get('License Plate'),
      licenseExpiryDate: get('License Expiry Date'),
      contractType: get('Contract Type'),
      joinedDate: get('Joined Date'),
      city: get('City'),
      agency: get('Agency'),
      dateOfBirth: get('Date of Birth'),
      vehicleManufacturer: get("Vehicle's manufacturer"),
      vehicleManufacturingYear: get("Vehicle's manufacturing year"),
      lastKycDate: get('Last KYC Date'),
      vehicleKycDate: get('Vehicle KYC Date'),
      suspensionReason: get('Suspension Reason'),
      spxBlocklisted: get('Blocklist').toUpperCase() === 'YES',
    })
  }

  return { drivers, total: drivers.length + skipped, skipped }
}
