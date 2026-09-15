import type { Shift } from './globalConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Parser das mensagens 3PL (transportadoras).
//
// Modelo: a transportadora informa, por região e por turno, a QUANTIDADE de
// rotas que ela consegue absorver. A atribuição é rota→transportadora (agência),
// não rota→motorista. A transportadora é escolhida no app (dropdown), então a
// mensagem em si NÃO precisa trazer o nome da transportadora.
//
// Formato padrão (uma transportadora por vez):
//
//   AM
//   1 Abadiânia - z
//   2 Munir Calixto
//
//   PM1
//   3 Guarulhos
//
// Sem disponibilidade:
//
//   SEM DISPONIBILIDADE HOJE
//
// ─────────────────────────────────────────────────────────────────────────────

export interface ThreePlDemand {
  region: string             // região exatamente como escrita pela transportadora
  quantity: number           // quantidade de rotas pedidas
  shift: Shift
  matchedCluster: string | null  // cluster oficial correspondente (null = desconhecido)
  anyRegion: boolean         // "ALL" / "qualquer região": aceita rota de qualquer cluster
}

export interface ThreePlParseResult {
  demands: ThreePlDemand[]
  noAvailability: boolean    // mensagem "SEM DISPONIBILIDADE HOJE"
  ignoredLines: string[]     // linhas que não deram pra interpretar
  unknownRegions: string[]   // regiões que não bateram com nenhum cluster (sem duplicatas)
  totalRoutes: number        // soma das quantidades
}

export interface ThreePlParseOptions {
  /** Turno aplicado às linhas antes de qualquer cabeçalho de turno. */
  defaultShift: Shift
  /** Lista de clusters válidos do sistema, para validar/mapear as regiões. */
  knownClusters?: string[]
}

const SHIFT_RE = /^\[?\s*(AM|PM1|PM2)\s*\]?\s*:?\s*$/i
// quantidade primeiro: "2 Guarulhos", "2  Abadiânia - z"
const QTY_FIRST_RE = /^(\d{1,3})\s+(.+?)\s*$/
// forma alternativa explícita: "Guarulhos = 2"
const REGION_EQ_RE = /^(.+?)\s*=\s*(\d{1,3})\s*$/

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
/** Normalização tolerante: sem acento, sem espaço/pontuação, maiúsculo. */
export const normRegion = (s: string) => stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

const SEM_DISPO_RE = /sem\s+disponibilidade/i
// "qualquer região": ALL / TODAS / TODOS / QUALQUER / QUALQUERREGIAO
const ANY_REGION = new Set(['ALL', 'TODAS', 'TODOS', 'QUALQUER', 'QUALQUERREGIAO', 'TODASREGIOES', 'QUALQUERLUGAR'])

export function parseThreePlMessage(raw: string, opts: ThreePlParseOptions): ThreePlParseResult {
  const clusterMap = new Map<string, string>()
  for (const c of opts.knownClusters ?? []) {
    const key = normRegion(c)
    if (key && !clusterMap.has(key)) clusterMap.set(key, c)
  }
  const validate = clusterMap.size > 0

  const lines = raw.split(/\r?\n/)

  // "Sem disponibilidade" em qualquer linha encerra: transportadora respondeu, 0 rotas.
  if (lines.some(l => SEM_DISPO_RE.test(l))) {
    return { demands: [], noAvailability: true, ignoredLines: [], unknownRegions: [], totalRoutes: 0 }
  }

  const demands: ThreePlDemand[] = []
  const ignoredLines: string[] = []
  const unknownSet = new Set<string>()
  let currentShift = opts.defaultShift

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const shiftMatch = line.match(SHIFT_RE)
    if (shiftMatch) {
      currentShift = shiftMatch[1].toUpperCase() as Shift
      continue
    }

    let quantity: number | null = null
    let region = ''

    const qtyFirst = line.match(QTY_FIRST_RE)
    const regionEq = line.match(REGION_EQ_RE)
    if (qtyFirst) {
      quantity = parseInt(qtyFirst[1], 10)
      region = qtyFirst[2].trim()
    } else if (regionEq) {
      region = regionEq[1].trim()
      quantity = parseInt(regionEq[2], 10)
    }

    if (quantity === null || !region || quantity <= 0) {
      ignoredLines.push(line)
      continue
    }

    const anyRegion = ANY_REGION.has(normRegion(region))
    const matchedCluster = anyRegion ? null : (clusterMap.get(normRegion(region)) ?? null)
    if (validate && !matchedCluster && !anyRegion) unknownSet.add(region)

    demands.push({ region, quantity, shift: currentShift, matchedCluster, anyRegion })
  }

  return {
    demands,
    noAvailability: false,
    ignoredLines,
    unknownRegions: [...unknownSet],
    totalRoutes: demands.reduce((sum, d) => sum + d.quantity, 0),
  }
}
