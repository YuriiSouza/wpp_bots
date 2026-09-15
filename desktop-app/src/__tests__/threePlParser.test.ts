import { describe, it, expect } from 'vitest'
import { parseThreePlMessage, normRegion } from '../renderer/src/lib/threePlParser'

const clusters = ['Abadiania - z', 'Munir Calixto', 'Guarulhos', 'Zona Norte']

describe('normRegion', () => {
  it('strips accents, spaces and punctuation, uppercases', () => {
    expect(normRegion('Abadiânia - z')).toBe('ABADIANIAZ')
    expect(normRegion('abadiania - z')).toBe('ABADIANIAZ')
    expect(normRegion('  Munir Calixto ')).toBe('MUNIRCALIXTO')
  })
})

describe('parseThreePlMessage — formato padrão (quantidade primeiro)', () => {
  it('lê quantidade + região com turno da seleção quando não há cabeçalho', () => {
    const r = parseThreePlMessage('1 Abadiania - z\n2 Munir Calixto', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.noAvailability).toBe(false)
    expect(r.demands).toHaveLength(2)
    expect(r.demands[0]).toMatchObject({ region: 'Abadiania - z', quantity: 1, shift: 'AM', matchedCluster: 'Abadiania - z' })
    expect(r.demands[1]).toMatchObject({ region: 'Munir Calixto', quantity: 2, shift: 'AM' })
    expect(r.totalRoutes).toBe(3)
    expect(r.unknownRegions).toEqual([])
  })

  it('respeita cabeçalhos de turno AM / PM1 / PM2', () => {
    const msg = ['AM', '1 Guarulhos', '', 'PM1', '3 Zona Norte'].join('\n')
    const r = parseThreePlMessage(msg, { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands).toHaveLength(2)
    expect(r.demands[0]).toMatchObject({ region: 'Guarulhos', quantity: 1, shift: 'AM' })
    expect(r.demands[1]).toMatchObject({ region: 'Zona Norte', quantity: 3, shift: 'PM1' })
  })

  it('aceita cabeçalho de turno com [] ou : e em minúsculas', () => {
    const msg = ['[pm2]:', '2 Guarulhos'].join('\n')
    const r = parseThreePlMessage(msg, { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0]).toMatchObject({ shift: 'PM2', region: 'Guarulhos', quantity: 2 })
  })

  it('casa região com acento contra cluster sem acento', () => {
    const r = parseThreePlMessage('1 Abadiânia - z', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0].matchedCluster).toBe('Abadiania - z')
    expect(r.unknownRegions).toEqual([])
  })
})

describe('parseThreePlMessage — forma alternativa e tolerâncias', () => {
  it('aceita "Região = quantidade"', () => {
    const r = parseThreePlMessage('Guarulhos = 4', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0]).toMatchObject({ region: 'Guarulhos', quantity: 4 })
  })

  it('ignora saudações e linhas sem sentido, reportando-as', () => {
    const msg = ['bom dia!', '2 Guarulhos', 'obrigado'].join('\n')
    const r = parseThreePlMessage(msg, { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands).toHaveLength(1)
    expect(r.ignoredLines).toEqual(['bom dia!', 'obrigado'])
  })

  it('marca região desconhecida quando não bate com nenhum cluster', () => {
    const r = parseThreePlMessage('2 Regiao Inexistente', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0].matchedCluster).toBeNull()
    expect(r.unknownRegions).toEqual(['Regiao Inexistente'])
  })

  it('sem knownClusters não marca nada como desconhecido', () => {
    const r = parseThreePlMessage('2 Qualquer Lugar', { defaultShift: 'AM' })
    expect(r.demands[0].matchedCluster).toBeNull()
    expect(r.unknownRegions).toEqual([])
  })

  it('ignora quantidade zero ou negativa', () => {
    const r = parseThreePlMessage('0 Guarulhos', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands).toHaveLength(0)
    expect(r.ignoredLines).toEqual(['0 Guarulhos'])
  })
})

describe('parseThreePlMessage — qualquer região (ALL)', () => {
  it('marca ALL como anyRegion e não como região desconhecida', () => {
    const r = parseThreePlMessage('3 ALL', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0]).toMatchObject({ quantity: 3, anyRegion: true, matchedCluster: null })
    expect(r.unknownRegions).toEqual([])
  })

  it('aceita sinônimos: TODAS, QUALQUER', () => {
    const r = parseThreePlMessage('2 TODAS\n1 qualquer', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands.every(d => d.anyRegion)).toBe(true)
  })

  it('região específica não é anyRegion', () => {
    const r = parseThreePlMessage('2 Guarulhos', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.demands[0].anyRegion).toBe(false)
  })
})

describe('parseThreePlMessage — sem disponibilidade', () => {
  it('detecta "SEM DISPONIBILIDADE HOJE"', () => {
    const r = parseThreePlMessage('SEM DISPONIBILIDADE HOJE', { defaultShift: 'AM', knownClusters: clusters })
    expect(r.noAvailability).toBe(true)
    expect(r.demands).toHaveLength(0)
    expect(r.totalRoutes).toBe(0)
  })

  it('detecta variação em minúsculas mesmo com outras linhas', () => {
    const r = parseThreePlMessage('oi\nsem disponibilidade hoje', { defaultShift: 'AM' })
    expect(r.noAvailability).toBe(true)
  })
})
