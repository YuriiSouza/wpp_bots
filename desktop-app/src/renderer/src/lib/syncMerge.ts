// Mescla os dados do app com os da planilha em vez de substituir: o que um computador tem e o outro não,
// fica dos dois lados. Assim, quem sobe menos dados não apaga o que outro já tinha subido.

const ID_FIELDS = ['atId', 'id', 'driverId', 'tn', 'shipment_id', 'date', 'key', 'cluster', 'agency', 'name']

type J = unknown
const isObj = (v: J): v is Record<string, J> => !!v && typeof v === 'object' && !Array.isArray(v)
const isEmpty = (v: J) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0)

function idOf(item: J, field: string | null): string | null {
  if (Array.isArray(item)) return typeof item[0] === 'string' || typeof item[0] === 'number' ? `t:${item[0]}` : null
  if (isObj(item) && field && item[field] != null) return `o:${String(item[field])}`
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return `p:${String(item)}`
  return null
}
function idFieldOf(arr: J[]): string | null {
  const objs = arr.filter(isObj)
  if (!objs.length) return null
  // Campo de identidade: o primeiro da lista presente em (quase) todos os itens
  return ID_FIELDS.find(f => objs.filter(o => o[f] != null).length >= objs.length * 0.9) ?? null
}

/** Qual dos dois itens é "mais completo": rota atribuída vence rota disponível; senão o que tem mais campos preenchidos. */
function richer(a: Record<string, J>, b: Record<string, J>): boolean {
  if (a.status === 'ATRIBUIDA' && b.status !== 'ATRIBUIDA') return true
  if (b.status === 'ATRIBUIDA' && a.status !== 'ATRIBUIDA') return false
  const filled = (o: Record<string, J>) => Object.values(o).filter(v => !isEmpty(v)).length
  return filled(a) >= filled(b)
}

function mergeArrays(a: J[], b: J[], depth: number): J[] {
  const field = idFieldOf([...a, ...b])
  const out: J[] = []
  const pos = new Map<string, number>()
  for (const item of a) {
    const id = idOf(item, field)
    if (id && pos.has(id)) continue
    if (id) pos.set(id, out.length)
    out.push(item)
  }
  // Sem identidade (lista de números, gráficos…): fica a lista maior
  if (!field && a.some(x => isObj(x)) ) return a.length >= b.length ? a : b
  for (const item of b) {
    const id = idOf(item, field)
    if (!id) { if (!out.some(x => JSON.stringify(x) === JSON.stringify(item))) out.push(item); continue }
    const i = pos.get(id)
    if (i === undefined) { pos.set(id, out.length); out.push(item); continue }
    out[i] = mergeValue(out[i], item, depth + 1)
  }
  return out
}

/** a = base (vence nos conflitos), b = o outro lado. */
export function mergeValue(a: J, b: J, depth = 0): J {
  if (isEmpty(a)) return b
  if (isEmpty(b) || depth > 12) return a
  if (Array.isArray(a) && Array.isArray(b)) return mergeArrays(a, b, depth)
  if (isObj(a) && isObj(b)) {
    // Relatório importado: o mais recente é a base, e as listas do outro são somadas
    let base = a, other = b
    if (typeof a.importedAt === 'string' && typeof b.importedAt === 'string' && b.importedAt > a.importedAt) { base = b; other = a }
    else if (('status' in a || 'status' in b) && !richer(a, b)) { base = b; other = a }
    const out: Record<string, J> = { ...base }
    for (const [k, v] of Object.entries(other)) out[k] = k in base ? mergeValue(base[k], v, depth + 1) : v
    return out
  }
  return a
}

/** Mescla dois valores guardados como texto (JSON ou não). */
export function mergeStored(local: string | null, remote: string | null): string | null {
  if (local == null || local === '') return remote
  if (remote == null || remote === '' || local === remote) return local
  let l: J, r: J
  try { l = JSON.parse(local); r = JSON.parse(remote) } catch { return local }
  return JSON.stringify(mergeValue(l, r))
}
