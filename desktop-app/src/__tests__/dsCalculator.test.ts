import { describe, it, expect } from 'vitest'
import {
  parseFlexibleDate,
  median,
  linearRegressionSlope,
  computeDriverResults,
  parseRoutes,
  analyzeCSV,
} from '../renderer/src/lib/dsCalculator'
import type { RawRoute } from '../renderer/src/lib/types'

// ──────────────────────────────────────────────────────────────────────────────
// parseFlexibleDate
// ──────────────────────────────────────────────────────────────────────────────
describe('parseFlexibleDate', () => {
  it('parses full ISO with seconds', () => {
    const d = parseFlexibleDate('2026-07-13T10:29:00')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(6) // July = 6
    expect(d!.getDate()).toBe(13)
  })

  it('parses ISO without seconds (the critical bug case)', () => {
    const d = parseFlexibleDate('2026-07-13T10:29')
    expect(d).not.toBeNull()
    expect(d!.getHours()).toBe(10)
  })

  it('parses date with space separator', () => {
    const d = parseFlexibleDate('2026-07-13 10:29:00')
    expect(d).not.toBeNull()
  })

  it('parses date with space and no seconds', () => {
    const d = parseFlexibleDate('2026-07-13 10:29')
    expect(d).not.toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseFlexibleDate('')).toBeNull()
    expect(parseFlexibleDate(null)).toBeNull()
    expect(parseFlexibleDate(undefined)).toBeNull()
  })

  it('returns null for invalid date', () => {
    expect(parseFlexibleDate('not-a-date')).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// median
// ──────────────────────────────────────────────────────────────────────────────
describe('median', () => {
  it('returns null for empty array', () => {
    expect(median([])).toBeNull()
  })

  it('returns single value', () => {
    expect(median([0.9])).toBe(0.9)
  })

  it('returns middle value for odd count', () => {
    expect(median([0.8, 0.95, 1.0])).toBe(0.95)
  })

  it('returns average of two middle values for even count', () => {
    expect(median([0.8, 0.9, 0.95, 1.0])).toBe(0.925)
  })

  it('is not distorted by outliers unlike mean', () => {
    // median should ignore 0.0 outlier
    expect(median([1.0, 1.0, 1.0, 1.0, 0.0])).toBe(1.0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// linearRegressionSlope
// ──────────────────────────────────────────────────────────────────────────────
describe('linearRegressionSlope', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(linearRegressionSlope([0], [95])).toBe(0)
    expect(linearRegressionSlope([], [])).toBe(0)
  })

  it('detects positive slope (improving)', () => {
    const slope = linearRegressionSlope([0, 1, 2], [90, 93, 96])
    expect(slope).toBeCloseTo(3, 4)
  })

  it('detects negative slope (declining)', () => {
    const slope = linearRegressionSlope([0, 1, 2], [96, 93, 90])
    expect(slope).toBeCloseTo(-3, 4)
  })

  it('returns ~0 for flat series', () => {
    const slope = linearRegressionSlope([0, 1, 2], [95, 95, 95])
    expect(Math.abs(slope)).toBeLessThan(0.001)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// DS_Real full calculation
// ──────────────────────────────────────────────────────────────────────────────
describe('computeDriverResults — DS_Real', () => {
  const makeRoute = (overrides: Partial<RawRoute> = {}): RawRoute => ({
    date: '2026-07-01',
    driver_id: 'DRV001',
    dispatch_window: 'AM',
    cluster_name: 'A',
    Performance: '0.95',
    DataHoraPrimDelivered: '2026-07-01T08:00:00',
    DataHoraUltDelivered: '2026-07-01T17:00:00',
    ...overrides,
  })

  it('computes DS_Real correctly for same-day delivery', () => {
    const raw = [makeRoute(), makeRoute({ Performance: '1.0' }), makeRoute({ Performance: '0.90' })]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)

    // median([0.95, 1.0, 0.90]) = 0.95
    expect(driver.Media_Performance).toBeCloseTo(0.95, 4)
    // All same-day → Nivel_Entrega_Dia = 1.0
    expect(driver.Nivel_Entrega_Dia).toBeCloseTo(1.0, 4)
    // DS_Real = 0.95 × 1.0 = 0.95
    expect(driver.DS_Real).toBeCloseTo(0.95, 4)
  })

  it('computes Nivel_Entrega_Dia = 0.85 for cross-day delivery', () => {
    const raw = [
      makeRoute({
        DataHoraPrimDelivered: '2026-07-01T08:00:00',
        DataHoraUltDelivered: '2026-07-02T08:00:00', // different day
      }),
    ]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    expect(driver.Nivel_Entrega_Dia).toBeCloseTo(0.85, 4)
  })

  it('ignores routes with missing date columns in Nivel_Entrega_Dia', () => {
    const raw = [
      makeRoute({ DataHoraPrimDelivered: '', DataHoraUltDelivered: '' }),
      makeRoute({ DataHoraPrimDelivered: '2026-07-01T08:00', DataHoraUltDelivered: '2026-07-01T17:00' }),
    ]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    // only 1 valid pair, same day → 1.0
    expect(driver.Nivel_Entrega_Dia).toBeCloseTo(1.0, 4)
  })

  it('returns null DS_Real when no valid Performance', () => {
    const raw = [makeRoute({ Performance: '' })]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    expect(driver.Media_Performance).toBeNull()
    expect(driver.DS_Real).toBeNull()
  })

  it('returns null DS_Real when no valid date pairs', () => {
    const raw = [makeRoute({ DataHoraPrimDelivered: '', DataHoraUltDelivered: '' })]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    expect(driver.Nivel_Entrega_Dia).toBeNull()
    expect(driver.DS_Real).toBeNull()
  })

  it('still includes driver with 0 valid Performance rows', () => {
    const raw = [makeRoute({ Performance: 'invalid', driver_id: 'NOVATO' })]
    const routes = parseRoutes(raw)
    const results = computeDriverResults(routes)
    const d = results.find(r => r.driver_id === 'NOVATO')
    expect(d).toBeDefined()
    expect(d!.Media_Performance).toBeNull()
  })

  it('classifies Melhorando when slope > 0.2 pp/month', () => {
    // Two months with clearly different medians (90% in Jan, 96% in Feb)
    const raw = [
      makeRoute({ date: '2026-01-10', Performance: '0.90' }),
      makeRoute({ date: '2026-01-15', Performance: '0.90' }),
      makeRoute({ date: '2026-02-10', Performance: '0.96' }),
      makeRoute({ date: '2026-02-15', Performance: '0.96' }),
    ]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    // slope should be (96 - 90) = 6 pp/month > 0.2
    expect(driver.Status).toBe('Melhorando')
  })

  it('classifies Piorando when slope < -0.2 pp/month', () => {
    const raw = [
      makeRoute({ date: '2026-01-10', Performance: '0.96' }),
      makeRoute({ date: '2026-01-15', Performance: '0.96' }),
      makeRoute({ date: '2026-02-10', Performance: '0.90' }),
      makeRoute({ date: '2026-02-15', Performance: '0.90' }),
    ]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    expect(driver.Status).toBe('Piorando')
  })

  it('classifies Estagnado for single month', () => {
    const raw = [makeRoute({ date: '2026-07-01' }), makeRoute({ date: '2026-07-15' })]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    expect(driver.Status).toBe('Estagnado')
  })

  it('rounds DS_Real to 4 decimal places', () => {
    // 0.95 × 0.925 = 0.87875
    const raw = [
      makeRoute({ Performance: '0.95', DataHoraPrimDelivered: '2026-07-01T08:00', DataHoraUltDelivered: '2026-07-01T17:00' }),
      makeRoute({ Performance: '0.95', DataHoraPrimDelivered: '2026-07-01T08:00', DataHoraUltDelivered: '2026-07-02T08:00' }), // cross-day
    ]
    const routes = parseRoutes(raw)
    const [driver] = computeDriverResults(routes)
    // median([0.95, 0.95]) = 0.95, nivel = (1.0 + 0.85) / 2 = 0.925
    // DS_Real = 0.95 * 0.925 = 0.87875
    expect(driver.DS_Real).toBe(0.8788)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// analyzeCSV — error handling
// ──────────────────────────────────────────────────────────────────────────────
describe('analyzeCSV — error handling', () => {
  it('throws on missing required columns', () => {
    const raw = [{ cluster_name: 'A', Performance: '0.9' }] as RawRoute[]
    expect(() => analyzeCSV(raw)).toThrow(/Colunas obrigatórias ausentes/)
  })

  it('throws on empty array', () => {
    expect(() => analyzeCSV([])).toThrow()
  })

  it('lists unavailable optional columns', () => {
    const raw = [{ date: '2026-07-01', driver_id: 'DRV001', Performance: '0.95' }] as RawRoute[]
    const result = analyzeCSV(raw)
    expect(result.missingColumns).toContain('DataHoraPrimDelivered')
  })
})
