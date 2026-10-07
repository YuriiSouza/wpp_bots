export interface ScoreWeights {
  dsWeight: number       // default 20
  declineWeight: number  // default 25
  noShowWeight: number   // default 30
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  dsWeight: 20,
  declineWeight: 25,
  noShowWeight: 30,
}

/** Taxa de recusa no Call Up, em % (recusas ÷ chamadas respondidas, sem contar canceladas nem pendentes). Sem chamadas = 0. */
export function declineRatePercent(cu?: { declined: number; total: number; cancelled?: number; pending?: number } | null): number {
  if (!cu) return 0
  const calls = cu.total - (cu.cancelled ?? 0) - (cu.pending ?? 0)
  return calls > 0 ? (cu.declined / calls) * 100 : 0
}

/**
 * dsPercent: 0–100
 * declineRate: taxa de recusa no Call Up, 0–100 (use declineRatePercent)
 * noShowCount: campo "No Show Time" do relatório de disponibilidade (cada noshow desconta 10 pts, cap em 100)
 */
export function calculatePriorityScore(
  dsPercent: number,
  declineRate: number,
  noShowCount: number,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const total = Math.max(1, weights.dsWeight + weights.declineWeight + weights.noShowWeight)
  const declineComponent = Math.max(0, 100 - declineRate)
  const noShowComponent  = Math.max(0, 100 - noShowCount  * 10)
  const score =
    (dsPercent          * weights.dsWeight +
     declineComponent   * weights.declineWeight +
     noShowComponent    * weights.noShowWeight) /
    total
  return Number(Math.max(0, Math.min(100, score)).toFixed(2))
}

/** Days since a date string (various formats). Used as tiebreaker — more days = higher urgency. */
export function daysSinceLastRoute(lastRouteDateRaw: string | null | undefined): number {
  if (!lastRouteDateRaw) return 9999
  const clean = lastRouteDateRaw
    .replace(/(\d{2})-(\d{2})-(\d{4}).*/, '$3-$2-$1')
    .replace(/(\d{4})\/(\d{2})\/(\d{2}).*/, '$1-$2-$3')
    .slice(0, 10)
  const d = new Date(clean + 'T12:00:00')
  if (isNaN(d.getTime())) return 0
  // Antes do meio-dia de hoje a diferença fica negativa; nunca menos que 0.
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
}
