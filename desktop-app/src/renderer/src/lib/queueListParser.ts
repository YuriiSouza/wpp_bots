// ─────────────────────────────────────────────────────────────────────────────
// Parser do relatório QueueList (fila de carregamento) do SPX.
//
// Cada linha é um motorista que entrou na fila (chegou). Extraímos ID, nome,
// agência, hora de chegada (Add to Queue Time), a letra/vaga (Corridor Cage,
// ex. "A-15" → letra "A"), a AT e o cluster.
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueEntry {
  queueNumber: string
  driverId: string
  driverName: string
  agency: string
  arrival: string           // texto original "2026-09-12 05:20"
  arrivalMin: number | null // minutos desde a meia-noite (null se não parseável)
  cage: string              // "A-15"
  letter: string            // "A"
  atId: string
  cluster: string
}

export interface QueueParseResult {
  entries: QueueEntry[]
  total: number
  skipped: number
  error?: string
}

// CSV robusto (aspas, vírgulas dentro de aspas, aspas escapadas "")
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** "2026-09-12 05:20" ou "05:20" → minutos desde a meia-noite. */
export function parseTimeToMinutes(raw: string): number | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (isNaN(h) || isNaN(min)) return null
  return h * 60 + min
}

export function parseQueueListCsv(text: string): QueueParseResult {
  const rows = parseCsv(text).filter(r => r.some(c => c.trim() !== ''))
  if (rows.length < 2) return { entries: [], total: 0, skipped: 0, error: 'CSV vazio.' }

  const header = rows[0].map(h => h.trim())
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase())

  const iId = idx('Driver ID')
  const iName = idx('Driver Name')
  if (iId < 0 || iName < 0) {
    return { entries: [], total: 0, skipped: 0, error: 'Arquivo não reconhecido como QueueList (faltam colunas "Driver ID"/"Driver Name").' }
  }
  const iAgency = idx('Agency')
  const iArrival = idx('Add to Queue Time')
  const iCage = idx('Corridor Cage')
  const iAt = idx('Assignment Task ID')
  const iCluster = idx('Cluster')
  const iQueue = idx('Queue Number')

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  const entries: QueueEntry[] = []
  let skipped = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const driverId = get(r, iId)
    if (!driverId) { skipped++; continue }
    const cage = get(r, iCage)
    const letter = (cage.split('-')[0] ?? '').trim().toUpperCase()
    const arrival = get(r, iArrival)
    entries.push({
      queueNumber: get(r, iQueue),
      driverId,
      driverName: get(r, iName),
      agency: get(r, iAgency),
      arrival,
      arrivalMin: parseTimeToMinutes(arrival),
      cage,
      letter,
      atId: get(r, iAt),
      cluster: get(r, iCluster),
    })
  }
  return { entries, total: entries.length, skipped }
}

// ─── Janela de carregamento por letra ───────────────────────────────────────────

// Chegou: no prazo / fora da janela. Não chegou: aguardando / atrasado.
export type LoadStatus = 'on-time' | 'out-of-window' | 'waiting' | 'overdue' | 'unknown'

/** Índice da letra (A=0, B=1, ...). null se não for A–Z. */
export function letterIndex(letter: string): number | null {
  if (!letter || letter.length !== 1) return null
  const code = letter.charCodeAt(0) - 65
  return code >= 0 && code < 26 ? code : null
}

/** Extrai a letra (primeiro caractere alfabético) de uma vaga/gaiola: "A-15" → "A", "15" → "". */
export function extractLetter(cage: string): string {
  const m = (cage ?? '').match(/[A-Za-z]/)
  return m ? m[0].toUpperCase() : ''
}

/** Janela de carregamento de uma letra. null se a letra for inválida. */
export function windowForLetter(letter: string, baseStartMin: number, slotMin = 20): { startMin: number; arriveByMin: number } | null {
  const li = letterIndex(letter)
  if (li === null) return null
  const startMin = baseStartMin + li * slotMin
  return { startMin, arriveByMin: startMin - slotMin }
}

export interface LoadWindow {
  status: LoadStatus
  startMin: number | null   // início do carregamento da letra
  arriveByMin: number | null // prazo de chegada (start - 20)
  lateMin: number           // minutos além do prazo (>0)
}

/**
 * Status de quem JÁ chegou (está na fila): no prazo vs fora da janela.
 * baseStartMin = início do carregamento da 1ª letra (A). Cada letra +20min.
 * Motorista deve chegar 20min antes do início da sua letra.
 */
export function computeLoadWindow(entry: QueueEntry, baseStartMin: number, slotMin = 20): LoadWindow {
  const w = windowForLetter(entry.letter, baseStartMin, slotMin)
  if (!w) return { status: 'unknown', startMin: null, arriveByMin: null, lateMin: 0 }
  if (entry.arrivalMin === null) return { status: 'unknown', startMin: w.startMin, arriveByMin: w.arriveByMin, lateMin: 0 }
  const lateMin = entry.arrivalMin - w.arriveByMin
  return { status: lateMin > 0 ? 'out-of-window' : 'on-time', startMin: w.startMin, arriveByMin: w.arriveByMin, lateMin }
}

export function minToHHMM(min: number | null): string {
  if (min === null) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
