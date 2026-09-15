export type DriverStatus = 'DISPONÍVEL' | 'DOBRA' | 'INDISPONÍVEL' | 'BLOQUEADO' | 'URGENTE' | 'OUTRO'
export type Rodizio = 'BAIXA' | 'MÉDIA' | 'ALTA' | 'DESCONHECIDO'
export type DsProgression = 'Melhorando' | 'Estagnado' | 'Piorando' | 'Sem dados'

export interface DisponibilidadeDriver {
  id: string
  atSugerida: string | null
  nome: string
  tipoVeiculo: string | null
  status: DriverStatus
  rodizio: Rodizio
  ultimaViagem: string | null
  ds: number | null          // 0-1
  clusters: string[]
  bairrosRecentes: string[]
  numero: string | null
  progressaoDs: DsProgression
  novato: boolean
  numeroRotas: number
  noshow: number
}

export interface DisponibilidadeReport {
  drivers: DisponibilidadeDriver[]
  importedAt: string
  fileName: string
}

function normalizeStatus(raw: string): DriverStatus {
  const s = raw.trim().toUpperCase()
  if (s === 'DISPONÍVEL' || s === 'DISPONIVEL') return 'DISPONÍVEL'
  if (s === 'DOBRA') return 'DOBRA'
  if (s.includes('INDISPONÍV') || s.includes('INDISPONIV')) return 'INDISPONÍVEL'
  if (s === 'BLOQUEADO') return 'BLOQUEADO'
  if (s === 'URGENTE') return 'URGENTE'
  return 'OUTRO'
}

function normalizeRodizio(raw: string): Rodizio {
  const s = raw.trim().toUpperCase()
  if (s === 'BAIXA') return 'BAIXA'
  if (s === 'MÉDIA' || s === 'MEDIA') return 'MÉDIA'
  if (s === 'ALTA') return 'ALTA'
  return 'DESCONHECIDO'
}

function parseDs(raw: string): number | null {
  const s = raw.trim().replace('%', '').replace(',', '.')
  const n = parseFloat(s)
  if (isNaN(n)) return null
  return n > 1 ? n / 100 : n
}

function parseProgression(raw: string): DsProgression {
  const s = raw.trim()
  if (s === 'Melhorando') return 'Melhorando'
  if (s === 'Estagnado') return 'Estagnado'
  if (s === 'Piorando') return 'Piorando'
  return 'Sem dados'
}

// Columns (0-indexed):
// 0: ID | 1: AT sugerida | 2: Nome | 3: Tipo de veiculo | 4: Status
// 5: Rodizio | 6: Ultima viagem | 7: DS | 8: Clusters | 9: Bairros Recentes
// 10: Numero | 11: Progressão DS | 12: Novato | 13: Numero de rotas | 14: noshow
export function parseDisponibilidadeTsv(text: string, fileName = 'colagem'): DisponibilidadeReport | null {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (lines.length < 2) return null

  let dataStart = 0
  const first = lines[0].toLowerCase()
  if (first.includes('id') && (first.includes('status') || first.includes('nome'))) {
    dataStart = 1
  }

  const drivers: DisponibilidadeDriver[] = []

  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    if (cols.length < 5) continue
    const id = cols[0]?.trim()
    if (!id || isNaN(Number(id))) continue

    const clusters = (cols[8] ?? '').trim()
    const bairros = (cols[9] ?? '').trim()

    drivers.push({
      id,
      atSugerida: cols[1]?.trim() || null,
      nome: cols[2]?.trim() || id,
      tipoVeiculo: cols[3]?.trim() || null,
      status: normalizeStatus(cols[4] ?? ''),
      rodizio: normalizeRodizio(cols[5] ?? ''),
      ultimaViagem: cols[6]?.trim() || null,
      ds: parseDs(cols[7] ?? ''),
      clusters: clusters ? clusters.split(',').map(s => s.trim()).filter(Boolean) : [],
      bairrosRecentes: bairros ? bairros.split(',').map(s => s.trim()).filter(Boolean) : [],
      numero: cols[10]?.trim() || null,
      progressaoDs: parseProgression(cols[11] ?? ''),
      novato: (cols[12] ?? '').trim().toLowerCase() === 'novato',
      numeroRotas: parseInt(cols[13] ?? '0', 10) || 0,
      noshow: parseInt(cols[14] ?? '0', 10) || 0,
    })
  }

  if (drivers.length === 0) return null

  return { drivers, importedAt: new Date().toISOString(), fileName }
}
