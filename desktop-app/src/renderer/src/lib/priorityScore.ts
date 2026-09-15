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

/**
 * dsPercent: 0–100
 * declineCount: quantidade absoluta de recusas (cada recusa desconta 10 pts, cap em 100)
 * noShowCount: quantidade absoluta de noshows (cada noshow desconta 10 pts, cap em 100)
 */
export function calculatePriorityScore(
  dsPercent: number,
  declineCount: number,
  noShowCount: number,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const total = Math.max(1, weights.dsWeight + weights.declineWeight + weights.noShowWeight)
  const declineComponent = Math.max(0, 100 - declineCount * 10)
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
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}
