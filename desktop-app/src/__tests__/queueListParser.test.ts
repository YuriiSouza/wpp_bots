import { describe, it, expect } from 'vitest'
import { parseQueueListCsv, computeLoadWindow, letterIndex, parseTimeToMinutes, minToHHMM, windowForLetter, extractLetter } from '../renderer/src/lib/queueListParser'

const HEADER = 'Queue Number,Arrival Type,Vehicle Number,Waiting Time,LH Trip Name,Pending Inbound Parcel Qty,LH Trip Nnumber,HV,Bulky,Return,Driver ID,Driver Name,Agency,Add to Queue Time,Status,Assigned Dock,Occupied Dock,Handover Task Number,OnHold Time,Prioritised,Prioritised Factors,Occupancy Sequence,Entry Tag,Assignment Task ID,Cluster,Corridor Cage'

function row(over: Partial<Record<string, string>>): string {
  const cols = new Array(26).fill('')
  cols[0] = over.queue ?? 'OB0001'
  cols[10] = over.id ?? '648159'
  cols[11] = over.name ?? 'Patrick Aires'
  cols[12] = over.agency ?? 'SPXOWNFLEET'
  cols[13] = over.arrival ?? '2026-09-12 05:20'
  cols[20] = over.factors ?? 'Ascending Corridor'   // pode ter vírgulas
  cols[23] = over.at ?? 'AT202609129NSY7'
  cols[24] = over.cluster ?? 'Vianópolis - z'
  cols[25] = over.cage ?? 'A-15'
  // campo com vírgula precisa de aspas
  return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',')
}

describe('parseTimeToMinutes', () => {
  it('parses datetime and time', () => {
    expect(parseTimeToMinutes('2026-09-12 05:30')).toBe(330)
    expect(parseTimeToMinutes('05:50')).toBe(350)
    expect(parseTimeToMinutes('')).toBeNull()
  })
})

describe('parseQueueListCsv', () => {
  it('lê linhas e extrai letra da Corridor Cage', () => {
    const csv = [HEADER, row({}), row({ id: '115873', cage: 'C-16', arrival: '2026-09-12 05:30' })].join('\n')
    const r = parseQueueListCsv(csv)
    expect(r.error).toBeUndefined()
    expect(r.entries).toHaveLength(2)
    expect(r.entries[0]).toMatchObject({ driverId: '648159', letter: 'A', cage: 'A-15', arrivalMin: 320 })
    expect(r.entries[1]).toMatchObject({ driverId: '115873', letter: 'C', arrivalMin: 330 })
  })

  it('lida com campos entre aspas contendo vírgula', () => {
    const csv = [HEADER, row({ factors: 'Ascending Corridor,,MOTO' })].join('\n')
    const r = parseQueueListCsv(csv)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].driverId).toBe('648159')
    expect(r.entries[0].atId).toBe('AT202609129NSY7')
  })

  it('rejeita arquivo sem as colunas certas', () => {
    const r = parseQueueListCsv('a,b,c\n1,2,3')
    expect(r.error).toBeTruthy()
  })
})

describe('computeLoadWindow — janelas alfabéticas, 20 min, base 05:30', () => {
  const base = 330 // 05:30
  it('letra A: início 05:30, prazo 05:10', () => {
    expect(letterIndex('A')).toBe(0)
    const w = computeLoadWindow({ letter: 'A', arrivalMin: 320 } as never, base)
    expect(minToHHMM(w.startMin)).toBe('05:30')
    expect(minToHHMM(w.arriveByMin)).toBe('05:10')
    expect(w.status).toBe('out-of-window') // chegou 05:20, prazo 05:10
    expect(w.lateMin).toBe(10)
  })

  it('letra C: início 06:10, prazo 05:50, chegada 05:45 no prazo', () => {
    const w = computeLoadWindow({ letter: 'C', arrivalMin: 345 } as never, base)
    expect(minToHHMM(w.startMin)).toBe('06:10')
    expect(minToHHMM(w.arriveByMin)).toBe('05:50')
    expect(w.status).toBe('on-time')
  })

  it('letra desconhecida → unknown', () => {
    const w = computeLoadWindow({ letter: '', arrivalMin: 330 } as never, base)
    expect(w.status).toBe('unknown')
  })
})

describe('windowForLetter e extractLetter (para quem não chegou)', () => {
  it('extractLetter pega a letra de gaiolas variadas', () => {
    expect(extractLetter('A-15')).toBe('A')
    expect(extractLetter('B12')).toBe('B')
    expect(extractLetter('15')).toBe('')
    expect(extractLetter('')).toBe('')
  })
  it('windowForLetter calcula início e prazo', () => {
    const w = windowForLetter('B', 330) // B: início 05:50, prazo 05:30
    expect(minToHHMM(w!.startMin)).toBe('05:50')
    expect(minToHHMM(w!.arriveByMin)).toBe('05:30')
    expect(windowForLetter('9', 330)).toBeNull()
  })
})
