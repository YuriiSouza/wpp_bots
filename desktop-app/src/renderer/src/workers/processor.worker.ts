import Papa from 'papaparse'
import { analyzeCSV, parseRoutes } from '../lib/dsCalculator'
import type { RawRoute } from '../lib/types'

self.onmessage = (e: MessageEvent<{ csv: string; options?: Record<string, number> }>) => {
  try {
    const { csv, options = {} } = e.data

    self.postMessage({ type: 'progress', message: 'Parseando CSV...' })

    const parsed = Papa.parse<RawRoute>(csv, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    })

    if (parsed.errors.length > 0) {
      const fatal = parsed.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes')
      if (fatal.length > 0) {
        throw new Error(`Erro no CSV: ${fatal[0].message}`)
      }
    }

    self.postMessage({ type: 'progress', message: `${parsed.data.length} linhas lidas. Calculando DS_Real...` })

    const result = analyzeCSV(parsed.data as RawRoute[], options)
    const parsedRoutes = parseRoutes(parsed.data as RawRoute[])

    self.postMessage({ type: 'done', result, parsedRoutes })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
