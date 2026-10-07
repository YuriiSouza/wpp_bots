// Rotas com junção de clusters chegam como "Abadiania - z; Planalmira - z".
const norm = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '')

export const splitClusters = (cluster: string | null | undefined) => (cluster ?? '').split(';').map(c => c.trim()).filter(Boolean)

/** O motorista atende a rota se tem pelo menos um dos clusters dela ('all' exige todos). */
export function coversCluster(driverClusters: string[] | null | undefined, routeCluster: string | null | undefined, mode: 'any' | 'all' = 'any') {
  const parts = splitClusters(routeCluster).map(norm)
  if (parts.length === 0 || !driverClusters?.length) return false
  const own = new Set(driverClusters.map(norm))
  return mode === 'all' ? parts.every(p => own.has(p)) : parts.some(p => own.has(p))
}
