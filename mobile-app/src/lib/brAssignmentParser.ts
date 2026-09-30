export interface BrAssignmentEntry {
  atId: string
  driverName: string
  driverId: string
  deliveryDate: string // YYYY-MM-DD
}

// Parses the br_assignment_task CSV. One row per package, so deduplicate by Task ID.
export function parseBrAssignment(csv: string): Map<string, BrAssignmentEntry> {
  const result = new Map<string, BrAssignmentEntry>()
  const lines = csv.split('\n')
  if (lines.length < 2) return result

  const header = lines[0].split(',')
  const idx = {
    taskId: header.findIndex(h => h.trim() === 'Task ID'),
    driverName: header.findIndex(h => h.trim() === 'Driver name'),
    driverId: header.findIndex(h => h.trim() === 'Driver ID'),
    deliveryDate: header.findIndex(h => h.trim() === 'Delivery Date'),
  }

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvRow(lines[i])
    if (row.length < 4) continue

    const atId = row[idx.taskId]?.trim()
    if (!atId || result.has(atId)) continue

    const driverName = row[idx.driverName]?.trim() ?? ''
    const driverId = row[idx.driverId]?.trim() ?? ''
    const rawDate = row[idx.deliveryDate]?.trim() ?? ''

    result.set(atId, {
      atId,
      driverName,
      driverId: normalizeId(driverId),
      deliveryDate: parseDate(rawDate),
    })
  }

  return result
}

// Splits a CSV row handling quoted fields with commas inside
function splitCsvRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += ch }
  }
  result.push(current)
  return result
}

// "3.407262E+06" → "3407262"
function normalizeId(val: string): string {
  if (!val) return ''
  if (/[eE]/.test(val)) {
    const n = Number(val)
    if (!isNaN(n)) return String(Math.round(n))
  }
  return val
}

// "07-09-2026 00:00" → "2026-09-07"
function parseDate(raw: string): string {
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return raw
  return `${m[3]}-${m[2]}-${m[1]}`
}
