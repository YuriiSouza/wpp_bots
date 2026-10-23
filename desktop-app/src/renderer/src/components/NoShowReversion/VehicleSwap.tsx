import { useMemo, useState } from 'react'
import type { LocalRoute } from '../../lib/noshowRouteParser'
import type { StoredDriver } from '../../lib/localStore'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import { splitClusters } from '../../lib/clusterMatch'

// Trocas Fiorino ↔ Passeio na mesma região: rota volumosa (precisa de Fiorino) saindo com Passeio
// enquanto uma rota menor da mesma região sai com Fiorino. A sugestão é inverter os motoristas.

export interface SwapPair {
  big: LocalRoute    // precisa de Fiorino, hoje com Passeio
  small: LocalRoute  // não precisa, hoje com Fiorino
  passeio: { id: string; name: string }
  fiorino: { id: string; name: string }
  sameCluster: boolean
}

const vehicleOf = (v?: string | null) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino') || s.includes('van')) return 'FIORINO'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return null
}
/** Mesma regra da Visão Geral: volume acima de 700 L ou mais de 1 GG pede Fiorino. */
export const needsFiorino = (r: LocalRoute) => (r.volume ?? 0) > 700 || (r.gg ?? 0) > 1
const isMotoRoute = (r: LocalRoute) => vehicleOf(r.scheduledVehicle) === 'MOTO' || vehicleOf(r.requiredVehicleType) === 'MOTO'
const norm = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '')

export function findSwaps(routes: LocalRoute[], registry: StoredDriver[], workPref: WorkPreferenceData | null): SwapPair[] {
  const regMap = new Map(registry.map(d => [d.id, d]))
  const wpMap = new Map((workPref?.drivers ?? []).map(d => [d.driverId, d]))
  // Vale o veículo do cadastro do motorista
  const vOf = (id: string) => vehicleOf(regMap.get(id)?.vehicleType || wpMap.get(id)?.vehicleType)
  const assigned = routes.filter(r => r.status === 'ATRIBUIDA' && r.assignedDriverId)
  const bigs = assigned.filter(r => needsFiorino(r) && vOf(r.assignedDriverId!) === 'PASSEIO')
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  const smalls = assigned.filter(r => !needsFiorino(r) && !isMotoRoute(r) && vOf(r.assignedDriverId!) === 'FIORINO')
  const used = new Set<string>()
  const pairs: SwapPair[] = []
  for (const big of bigs) {
    const bigClusters = new Set(splitClusters(big.cluster).map(norm))
    const candidates = smalls.filter(s => !used.has(s.id)).map(s => {
      const sc = splitClusters(s.cluster).map(norm)
      const same = norm(s.cluster) === norm(big.cluster)
      const overlap = sc.some(c => bigClusters.has(c))
      return { s, same, overlap }
    }).filter(x => x.same || x.overlap)
      // mesmo cluster primeiro; depois a rota mais leve (libera a Fiorino de onde ela menos faz falta)
      .sort((a, b) => Number(b.same) - Number(a.same) || (a.s.volume ?? 0) - (b.s.volume ?? 0))
    const pick = candidates[0]
    if (!pick) continue
    used.add(pick.s.id)
    pairs.push({
      big, small: pick.s, sameCluster: pick.same,
      passeio: { id: big.assignedDriverId!, name: big.assignedDriverName || big.assignedDriverId! },
      fiorino: { id: pick.s.assignedDriverId!, name: pick.s.assignedDriverName || pick.s.assignedDriverId! },
    })
  }
  return pairs
}

type Result = { ok: boolean; msg: string }

export function VehicleSwapModal({ pairs, open, onClose, onApply, spxConfigured }: {
  pairs: SwapPair[]; open: boolean; onClose: () => void; spxConfigured: boolean
  onApply: (p: SwapPair) => Promise<Result>
}) {
  const [results, setResults] = useState<Record<string, Result | 'running'>>({})
  const [copied, setCopied] = useState(false)
  const key = (p: SwapPair) => `${p.big.id}|${p.small.id}`
  const pending = useMemo(() => pairs.filter(p => !results[key(p)]), [pairs, results])
  if (!open) return null

  const run = async (p: SwapPair) => {
    setResults(r => ({ ...r, [key(p)]: 'running' }))
    const res = await onApply(p)
    setResults(r => ({ ...r, [key(p)]: res }))
  }
  const runAll = async () => { for (const p of pending) await run(p) }
  const copy = async () => {
    const lines = pairs.map(p => `🔁 ${p.big.cluster}: ${p.big.atId} (${p.big.volume ?? '—'} L) → ${p.fiorino.name} (Fiorino) | ${p.small.atId} (${p.small.volume ?? '—'} L) → ${p.passeio.name} (Passeio)`)
    await navigator.clipboard.writeText(['Trocas Fiorino ↔ Passeio', '', ...lines].join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const card = (r: LocalRoute, tag: string, color: string) => (
    <div style={{ flex: 1, minWidth: 0, background: '#0f1117', border: `1px solid ${color}40`, borderRadius: 8, padding: '7px 10px' }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase' }}>{tag}</p>
      <p style={{ margin: '2px 0 0', fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0' }}>{r.atId}</p>
      <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{r.gaiola ?? '—'} · {r.volume ?? '—'} L · GG {r.gg ?? '—'}</p>
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, width: '100%', maxWidth: 820, maxHeight: '88vh', overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>🔁 Trocas Fiorino ↔ Passeio</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#8892a4' }}>Rota volumosa saindo com Passeio e, na mesma região, rota menor saindo com Fiorino. A troca põe a Fiorino na rota que precisa e o Passeio na menor.</p>
          </div>
          <button onClick={onClose} style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #2d3048', color: '#94a3b8', borderRadius: 8, width: 30, height: 30, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        {pairs.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: '#4ade80' }}>✓ Nenhuma troca a fazer: as rotas volumosas já estão com Fiorino (ou não há Fiorino em rota menor na mesma região).</p> : pairs.map(p => {
          const st = results[key(p)]
          return (
            <div key={key(p)} style={{ border: '1px solid #2d3048', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, opacity: st && st !== 'running' && st.ok ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>📍 {p.big.cluster}{!p.sameCluster && <span style={{ fontWeight: 400, color: '#fbbf24' }}> · região próxima: {p.small.cluster}</span>}</span>
                {!st && <button onClick={() => void run(p)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{spxConfigured ? 'Trocar no SPX' : 'Trocar no app'}</button>}
                {st === 'running' && <span style={{ fontSize: 12, color: '#fbbf24' }}>⏳ trocando…</span>}
                {st && st !== 'running' && <span style={{ fontSize: 12, fontWeight: 700, color: st.ok ? '#4ade80' : '#f87171' }}>{st.ok ? '✓ ' : '✕ '}{st.msg}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                {card(p.big, 'Rota volumosa', '#fbbf24')}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, fontSize: 11, color: '#cbd5e1', minWidth: 230 }}>
                  <span>🚐 <b>{p.fiorino.name}</b> (Fiorino) → <span style={{ fontFamily: 'monospace' }}>{p.big.atId}</span></span>
                  <span>🚗 <b>{p.passeio.name}</b> (Passeio) → <span style={{ fontFamily: 'monospace' }}>{p.small.atId}</span></span>
                </div>
                {card(p.small, 'Rota menor', '#60a5fa')}
              </div>
            </div>
          )
        })}

        {pairs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void runAll()} disabled={pending.length === 0}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: pending.length ? 'pointer' : 'default', opacity: pending.length ? 1 : .5 }}>
              🔁 Fazer todas as trocas ({pending.length})
            </button>
            <button onClick={() => void copy()} style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #2d3048', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>{copied ? '✓ Copiado' : '📋 Copiar lista'}</button>
            {!spxConfigured && <span style={{ fontSize: 11, color: '#fbbf24' }}>Sem sessão do SPX: a troca fica só no app. Cole o cURL para gravar no SPX.</span>}
          </div>
        )}
      </div>
    </div>
  )
}
