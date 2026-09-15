export interface LocalRoute {
  id: string
  atId: string
  gaiola: string | null
  cluster: string
  requiredVehicleType: string | null
  cidade: string | null
  isInterior: boolean
  ciclo: string | null
  // new fields
  paradas: number | null
  spr: number | null
  km: number | null
  gg: number | null
  volume: number | null
  scheduledVehicle: string | null  // Tipo de veículo (Veículo Programado)
  // assignment state (local)
  status: 'DISPONIVEL' | 'ATRIBUIDA'
  assignedDriverId: string | null
  assignedDriverName: string | null
}

const INTERIOR_CLUSTERS = new Set([
  'Abadiania - z', 'Campo Limpo', 'Gameleira de Goias', 'Goianapolis',
  'Leopoldo de Bulhões', 'Neropolis', 'Nova Veneza', 'Ouro Verde',
  'Silvania', 'Terezopolis', 'Vianópolis - z',
])

function normalizeVehicle(v: string | null | undefined): string | null {
  if (!v?.trim()) return null
  const s = v.trim().toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio')) return 'PASSEIO'
  return s.toUpperCase()
}

function parseVolume(v: string): number | null {
  // Brazilian thousands separator: "1.023" = 1023
  const n = parseInt(v.replace(/\./g, '').replace(/,/g, ''), 10)
  return isNaN(n) ? null : n
}

function parseKm(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function parseIntOrNull(v: string): number | null {
  const n = parseInt(v, 10)
  return isNaN(n) ? null : n
}

// Header-based column detection — more resilient than fixed indices
function buildColMap(headerLine: string): Record<string, number> {
  const cols = headerLine.split('\t')
  const map: Record<string, number> = {}
  cols.forEach((h, i) => { map[h.trim().toLowerCase()] = i })
  return map
}

function col(cols: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0) return ''
  return cols[idx]?.trim() ?? ''
}

export function parseRoutesTsv(text: string): LocalRoute[] {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (lines.length < 2) return []

  // Detect header row
  let headerIdx = 0
  if (lines[0].toLowerCase().includes('at') && lines[0].toLowerCase().includes('cluster')) {
    headerIdx = 0
  }
  const colMap = buildColMap(lines[headerIdx])
  const dataStart = headerIdx + 1

  // Column indices by name
  const I = {
    atId:      colMap['at / to']    ?? colMap['at/to']   ?? 1,
    gaiola:    colMap['gaiola']                           ?? 2,
    paradas:   colMap['parada']     ?? colMap['paradas']  ?? 3,
    spr:       colMap['spr']                              ?? 4,
    cidade:    colMap['cidade']                           ?? 5,
    km:        colMap['km']                               ?? 8,
    ciclo:     colMap['ciclo']                            ?? 11,
    gg:        colMap['gg']                               ?? 18,
    volume:    colMap['volume total da rota (litros)'] ?? colMap['volume'] ?? 19,
    vehicle:   colMap['tipo de veículo'] ?? colMap['tipo de veiculo'] ?? 23,
    driverLoad: colMap['driver carregado']               ?? 26,
    clusters:  colMap['clusters']                         ?? 28,
  }

  const routes: LocalRoute[] = []

  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    if (cols.length < 5) continue
    const atId = col(cols, I.atId)
    if (!atId || !atId.startsWith('AT')) continue

    const gaiola = col(cols, I.gaiola) || null
    const cidade = col(cols, I.cidade) || null
    const ciclo = col(cols, I.ciclo) || null
    const rawVehicle = col(cols, I.vehicle) || null
    const driverCarregado = col(cols, I.driverLoad) || null
    const cluster = col(cols, I.clusters) || ''

    const paradas = parseIntOrNull(col(cols, I.paradas))
    const spr = parseIntOrNull(col(cols, I.spr))
    const km = parseKm(col(cols, I.km))
    const gg = parseIntOrNull(col(cols, I.gg))
    const volume = parseVolume(col(cols, I.volume))
    const scheduledVehicle = normalizeVehicle(rawVehicle)

    routes.push({
      id: atId,
      atId,
      gaiola,
      cluster,
      requiredVehicleType: scheduledVehicle,
      cidade,
      isInterior: INTERIOR_CLUSTERS.has(cluster),
      ciclo,
      paradas,
      spr,
      km,
      gg,
      volume,
      scheduledVehicle,
      status: driverCarregado ? 'ATRIBUIDA' : 'DISPONIVEL',
      assignedDriverId: null,
      assignedDriverName: driverCarregado || null,
    })
  }

  return routes
}
