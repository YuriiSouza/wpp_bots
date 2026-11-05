import { useMemo, useState } from 'react'
import type { Shift } from '../../lib/globalConfig'
import type { StoredDriver } from '../../lib/localStore'
import type { LocalRoute } from '../../lib/noshowRouteParser'
import { routeStore } from '../../lib/routeStore'
import { queueStore } from '../../lib/queueStore'
import { fetchSpxQueue, SITUATION_LABEL, type QueueSituation } from '../../lib/spxQueueFetcher'
import { overrideVehicle } from '../../lib/fiorinoOverride'
import { getCtPackages, getEhaCache, type CtPackage } from '../../lib/planilhas'

// Volumosos: pacotes grandes que estão em rotas de Passeio/Moto e podem ir para uma rota que
// já tem Fiorino atribuída e ainda NÃO foi carregada (pela fila do SPX: situação "Saiu" = carregada).

const C = { bg: '#0f1117', card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', red: '#f87171', amber: '#fbbf24', green: '#4ade80', blue: '#60a5fa', violet: '#a78bfa' }
const VEHICLE_COLOR: Record<string, string> = { FIORINO: C.amber, MOTO: '#f472b6', PASSEIO: C.blue, VAN: C.violet }
const fmt = (n: number, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const vehicleOf = (v?: string | null) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino') || s.includes('van')) return 'FIORINO'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return null
}
const BIG_CATS = new Set(['GG', 'XG', 'XL', 'XXL', 'EG'])
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, t = Math.PI / 180
  const dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const SETTINGS_KEY = 'ui:volumosos'

interface Move { tn: string; fromAt: string; fromGaiola: string | null; toAt: string; toGaiola: string | null; toDriver: string; volL: number; at: string; done: boolean }
const movesKey = (d: string, s: Shift) => `spx:volumosos-moves:${d}:${s}`

type Load = { state: 'loaded' | 'loading' | 'free' | 'unknown'; label: string }

export default function Volumosos({ registry, selectedDay, selectedShift }: { registry: StoredDriver[]; selectedDay: string; selectedShift: Shift }) {
  const [tab, setTab] = useState<'secao' | 'reatribuir'>('secao')
  const [cfg, setCfg] = useState<{ minL: number; cats: boolean }>(() => { try { return { minL: 30, cats: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return { minL: 30, cats: true } } })
  const saveCfg = (c: typeof cfg) => { setCfg(c); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(c)) } catch { /* */ } }
  const [queueVer, setQueueVer] = useState(0)
  const [qLoading, setQLoading] = useState(false)
  const [qErr, setQErr] = useState('')
  const [moves, setMoves] = useState<Move[]>(() => { try { return JSON.parse(localStorage.getItem(movesKey(selectedDay, selectedShift)) ?? '[]') } catch { return [] } })
  const saveMoves = (m: Move[]) => { setMoves(m); try { localStorage.setItem(movesKey(selectedDay, selectedShift), JSON.stringify(m)) } catch { /* */ } }
  const [sel, setSel] = useState<string>('')
  const [q, setQ] = useState('')
  const [onlyMovable, setOnlyMovable] = useState(true)
  const [copied, setCopied] = useState('')
  const copy = async (k: string, t: string) => { if (!t) return; await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1800) }

  const routes = useMemo(() => routeStore.get(selectedDay, selectedShift) ?? [], [selectedDay, selectedShift])
  const packages = useMemo(() => getCtPackages(selectedDay, selectedShift), [selectedDay, selectedShift])
  const queue = useMemo(() => queueStore.get(selectedDay, selectedShift), [selectedDay, selectedShift, queueVer])
  const ehaSet = useMemo(() => new Set((getEhaCache()?.rows ?? []).map(r => r.tn)), [])
  const regMap = useMemo(() => new Map(registry.map(d => [d.id, d])), [registry])
  const rMap = useMemo(() => new Map(routes.map(r => [r.atId, r])), [routes])

  const refreshQueue = async () => {
    setQLoading(true); setQErr('')
    try {
      const entries = await fetchSpxQueue()
      queueStore.save(selectedDay, selectedShift, entries, 'SPX (Volumosos)')
      setQueueVer(v => v + 1)
    } catch (e) { setQErr(e instanceof Error ? e.message : String(e)) }
    setQLoading(false)
  }

  // Situação de carregamento por AT (mesma fonte da tela de Carregamento)
  const loadOf = useMemo(() => {
    const m = new Map<string, QueueSituation | undefined>()
    for (const e of queue?.entries ?? []) if (e.atId) m.set(e.atId, e.situation)
    return (atId: string): Load => {
      if (!queue) return { state: 'unknown', label: 'sem dados da fila' }
      if (!m.has(atId)) return { state: 'free', label: 'ainda não chegou na fila' }
      const s = m.get(atId)
      if (s === 'done') return { state: 'loaded', label: 'já saiu (carregada)' }
      if (s === 'at-dock') return { state: 'loading', label: 'carregando agora na mesa' }
      return { state: 'free', label: s ? SITUATION_LABEL[s] : 'na fila' }
    }
  }, [queue])

  const driverVehicle = (r: LocalRoute) => r.assignedDriverId ? vehicleOf(overrideVehicle(r.assignedDriverId, regMap.get(r.assignedDriverId)?.vehicleType)) : null
  const routeVehicle = (r: LocalRoute) => driverVehicle(r) ?? vehicleOf(r.scheduledVehicle)

  const movedTns = new Set(moves.map(m => m.tn))
  const isBig = (p: CtPackage) => ((p.volumeCm3 ?? 0) / 1000 >= cfg.minL) || (cfg.cats && BIG_CATS.has(p.category.toUpperCase()))

  const big = useMemo(() => packages.filter(isBig).map(p => {
    const r = rMap.get(p.at)
    const v = r ? routeVehicle(r) : vehicleOf(p.plannedVehicle)
    return { p, r, v, volL: (p.volumeCm3 ?? 0) / 1000, load: loadOf(p.at) }
  }).sort((a, b) => b.volL - a.volL), [packages, cfg, rMap, loadOf]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotas destino: Fiorino atribuída e ainda não carregada
  const targets = useMemo(() => routes.filter(r => r.status === 'ATRIBUIDA' && r.assignedDriverId && driverVehicle(r) === 'FIORINO').map(r => {
    const pts = packages.filter(p => p.at === r.atId && p.lat != null && p.lon != null).map(p => ({ lat: p.lat!, lon: p.lon! }))
    const extra = moves.filter(m => m.toAt === r.atId).reduce((s, m) => s + m.volL, 0)
    return { r, pts, load: loadOf(r.atId), extraL: extra }
  }), [routes, packages, moves, loadOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const openTargets = targets.filter(t => t.load.state !== 'loaded')

  const candidatesFor = (p: CtPackage) => openTargets.filter(t => t.r.atId !== p.at).map(t => {
    const d = p.lat != null && p.lon != null && t.pts.length ? Math.min(...t.pts.map(x => km({ lat: p.lat!, lon: p.lon! }, x))) : null
    const sameCluster = !!t.r.cluster && !!p.cluster && t.r.cluster.toLowerCase().includes(p.cluster.toLowerCase())
    return { ...t, dist: d, sameCluster }
  }).sort((a, b) => (a.load.state === 'loading' ? 1 : 0) - (b.load.state === 'loading' ? 1 : 0) || (a.dist ?? 999) - (b.dist ?? 999))

  const movable = big.filter(b => b.v !== 'FIORINO' && b.load.state !== 'loaded' && !movedTns.has(b.p.tn))
  const s = q.trim().toLowerCase()
  const listForMove = (onlyMovable ? movable : big.filter(b => !movedTns.has(b.p.tn))).filter(b => !s || b.p.tn.toLowerCase().includes(s) || b.p.at.toLowerCase().includes(s) || (b.r?.gaiola ?? '').toLowerCase().startsWith(s) || b.p.neighborhood.toLowerCase().includes(s))
  const selected = big.find(b => b.p.tn === sel)

  const doMove = (b: typeof big[number], t: ReturnType<typeof candidatesFor>[number]) => {
    saveMoves([...moves, { tn: b.p.tn, fromAt: b.p.at, fromGaiola: b.r?.gaiola ?? null, toAt: t.r.atId, toGaiola: t.r.gaiola, toDriver: t.r.assignedDriverName ?? t.r.assignedDriverId ?? '', volL: b.volL, at: new Date().toISOString(), done: false }])
    setSel('')
  }

  const btn: React.CSSProperties = { background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 7, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }
  const chip = (txt: string, color: string) => <span style={{ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}55`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{txt}</span>
  const loadChip = (l: Load) => chip(l.label, l.state === 'loaded' ? C.red : l.state === 'loading' ? C.amber : l.state === 'free' ? C.green : C.muted)

  // Seção: por rota
  const byRoute = useMemo(() => {
    const m = new Map<string, { at: string; r?: LocalRoute; v: string | null; n: number; volL: number; load: Load }>()
    for (const b of big) {
      const c = m.get(b.p.at) ?? { at: b.p.at, r: b.r, v: b.v, n: 0, volL: 0, load: b.load }
      c.n++; c.volL += b.volL
      m.set(b.p.at, c)
    }
    return [...m.values()].sort((a, b) => b.volL - a.volL)
  }, [big])

  const header = (
    <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>🧱 Volumosos</h2>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
          {selectedShift} · {selectedDay} · {queue ? `fila do carregamento lida às ${new Date(queue.importedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'sem dados da fila de carregamento'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, overflow: 'hidden' }}>
          {([['secao', '📊 Visão'], ['reatribuir', `🔀 Reatribuir (${movable.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? 'rgba(99,102,241,.2)' : 'transparent', color: tab === k ? '#a5b4fc' : C.muted, border: 'none', padding: '5px 14px', fontSize: 12, fontWeight: tab === k ? 700 : 400, cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
        <label style={{ fontSize: 11, color: C.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
          volumoso a partir de
          <input type="number" min={1} value={cfg.minL} onChange={e => saveCfg({ ...cfg, minL: Math.max(1, +e.target.value || 1) })} style={{ width: 56, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '3px 6px', fontSize: 12 }} /> L
        </label>
        <label style={{ fontSize: 11, color: C.sub, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.cats} onChange={e => saveCfg({ ...cfg, cats: e.target.checked })} /> categoria GG/XL
        </label>
        <button onClick={() => void refreshQueue()} disabled={qLoading} style={{ ...btn, background: '#7c3aed', border: 'none', color: '#fff', fontWeight: 700 }}>{qLoading ? '⏳…' : '🔄 Atualizar carregamento (SPX)'}</button>
      </div>
    </div>
  )

  if (!packages.length) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {header}
      <p style={{ margin: 20, fontSize: 13, color: C.amber }}>Sem dados de pacotes deste turno. Busque a roteirização pelo link da planilha (guia Calculation Tasks) na tela de Atribuição.</p>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {header}
      <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {qErr && <p style={{ margin: 0, fontSize: 12, color: C.red }}>✕ {qErr}</p>}
        {!queue && <p style={{ margin: 0, fontSize: 12, color: C.amber }}>⚠ Sem a fila de carregamento não dá para saber quais rotas já saíram. Clique em “Atualizar carregamento (SPX)”.</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            { l: 'Pacotes volumosos', v: big.length, sub: `${fmt(big.reduce((a, b) => a + b.volL, 0))} L no total`, c: C.violet },
            { l: 'Fora de Fiorino', v: big.filter(b => b.v !== 'FIORINO').length, sub: 'em rota de Passeio/Moto', c: C.amber },
            { l: 'Dá para mover', v: movable.length, sub: 'rota de origem ainda não saiu', c: C.blue },
            { l: 'Fiorinos abertas', v: openTargets.length, sub: `de ${targets.length} com Fiorino · não carregadas`, c: C.green },
            { l: 'Movimentos planejados', v: moves.length, sub: `${moves.filter(m => m.done).length} feitos`, c: C.text },
          ].map(k => (
            <div key={k.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
              <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{k.l}</p>
              <p style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 800, color: k.c }}>{k.v}</p>
              <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{k.sub}</p>
            </div>
          ))}
        </div>

        {tab === 'secao' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1.3fr)', gap: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>Rotas com volumosos ({byRoute.length})</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Gaiola', 'Veículo', 'Volumosos', 'Volume', 'Carregamento'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {byRoute.map(x => (
                    <tr key={x.at} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: '5px 6px' }}><b style={{ color: C.text }}>{x.r?.gaiola ?? '—'}</b> <span style={{ fontFamily: 'monospace', fontSize: 10, color: C.muted }}>{x.at}</span></td>
                      <td style={{ padding: '5px 6px', fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[x.v ?? ''] ?? C.muted }}>{x.v ?? '—'}</td>
                      <td style={{ padding: '5px 6px', fontWeight: 700, color: C.text }}>{x.n}</td>
                      <td style={{ padding: '5px 6px', color: C.sub }}>{fmt(x.volL, 1)} L</td>
                      <td style={{ padding: '5px 6px' }}>{loadChip(x.load)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>Pacotes volumosos ({big.length})</p>
                <button onClick={() => void copy('all', big.map(b => b.p.tn).join('\n'))} style={btn}>{copied === 'all' ? '✓ Copiado' : '📋 Copiar BRs'}</button>
              </div>
              <div style={{ maxHeight: 520, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>{['BR', 'Tam.', 'Volume', 'Peso', 'Rota', 'Veículo', 'Bairro'].map(h => <th key={h} style={{ position: 'sticky', top: 0, background: C.card, textAlign: 'left', padding: '4px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {big.map(b => (
                      <tr key={b.p.tn} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, color: ehaSet.has(b.p.tn) ? C.red : C.text }} title={ehaSet.has(b.p.tn) ? 'já teve EHA (não coube)' : ''}>{b.p.tn}{ehaSet.has(b.p.tn) ? ' ♻' : ''}{movedTns.has(b.p.tn) ? ' 🔀' : ''}</td>
                        <td style={{ padding: '4px 6px', color: C.sub }}>{b.p.category || '—'}</td>
                        <td style={{ padding: '4px 6px', fontWeight: 700, color: C.text }}>{fmt(b.volL, 1)} L</td>
                        <td style={{ padding: '4px 6px', color: C.sub }}>{b.p.weightG != null ? `${fmt(b.p.weightG / 1000, 1)} kg` : '—'}</td>
                        <td style={{ padding: '4px 6px', color: C.text }}>{b.r?.gaiola ?? '—'}</td>
                        <td style={{ padding: '4px 6px', fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[b.v ?? ''] ?? C.muted }}>{b.v ?? '—'}</td>
                        <td style={{ padding: '4px 6px', color: C.sub, fontSize: 11 }}>{b.p.neighborhood}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.2fr)', gap: 12, alignItems: 'start' }}>
              {/* Pacotes para mover */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>1 · Escolha o pacote</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 BR, AT, gaiola, bairro" style={{ flex: 1, minWidth: 160, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
                  <label style={{ fontSize: 11, color: C.sub, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={onlyMovable} onChange={e => setOnlyMovable(e.target.checked)} /> só fora de Fiorino e não carregados</label>
                </div>
                <div style={{ maxHeight: 460, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {listForMove.length === 0 && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Nenhum pacote volumoso para mover.</p>}
                  {listForMove.map(b => (
                    <button key={b.p.tn} onClick={() => setSel(b.p.tn)} style={{ textAlign: 'left', background: sel === b.p.tn ? 'rgba(59,130,246,.12)' : C.bg, border: `1px solid ${sel === b.p.tn ? C.blue : C.line}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.text }}>{b.p.tn}{ehaSet.has(b.p.tn) ? <span style={{ color: C.red }}> ♻ EHA</span> : ''}</span>
                        <b style={{ fontSize: 12, color: C.text }}>{fmt(b.volL, 1)} L</b>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: C.sub }}>{b.r?.gaiola ?? '—'} · {b.p.neighborhood}</span>
                        {b.v && chip(b.v, VEHICLE_COLOR[b.v] ?? C.sub)}
                        {loadChip(b.load)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Destinos */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>2 · Escolha a Fiorino de destino</p>
                <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Só rotas com Fiorino atribuída que ainda não saíram. Ordenadas pela parada mais próxima do endereço do pacote.</p>
                {!selected ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Selecione um pacote à esquerda.</p> : (() => {
                  const cands = candidatesFor(selected.p)
                  return (
                    <>
                      <div style={{ background: C.bg, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.sub }}>
                        <b style={{ color: C.text, fontFamily: 'monospace' }}>{selected.p.tn}</b> · {fmt(selected.volL, 1)} L · {selected.p.category} · de <b style={{ color: C.text }}>{selected.r?.gaiola ?? selected.p.at}</b> ({selected.v ?? '—'})
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{selected.p.address} — {selected.p.neighborhood}</div>
                        {selected.load.state === 'loaded' && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>⚠ A rota de origem já saiu: o pacote já foi carregado.</div>}
                      </div>
                      {cands.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.amber }}>Nenhuma rota com Fiorino atribuída e ainda não carregada.</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr>{['Gaiola', 'Motorista (Fiorino)', 'Distância', 'Volume rota', 'Carregamento', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {cands.slice(0, 12).map((t, i) => (
                              <tr key={t.r.atId} style={{ borderTop: `1px solid ${C.line}`, background: i === 0 ? 'rgba(74,222,128,.04)' : undefined }}>
                                <td style={{ padding: '5px 6px' }}><b style={{ color: C.text }}>{t.r.gaiola ?? '—'}</b><div style={{ fontSize: 10, color: C.muted }}>{t.r.cluster}{t.sameCluster ? ' · mesmo cluster' : ''}</div></td>
                                <td style={{ padding: '5px 6px', color: C.text, fontSize: 11 }}>{t.r.assignedDriverName ?? t.r.assignedDriverId}</td>
                                <td style={{ padding: '5px 6px', color: t.dist != null && t.dist <= 2 ? C.green : t.dist != null && t.dist <= 6 ? C.amber : C.sub, fontWeight: 700 }}>{t.dist != null ? `${fmt(t.dist, 1)} km` : '—'}</td>
                                <td style={{ padding: '5px 6px', color: C.sub, fontSize: 11 }}>{t.r.volume ?? '—'} L{t.extraL ? <span style={{ color: C.amber }}> +{fmt(t.extraL, 0)} L movidos</span> : ''}</td>
                                <td style={{ padding: '5px 6px' }}>{loadChip(t.load)}</td>
                                <td style={{ padding: '5px 6px' }}><button onClick={() => doMove(selected, t)} style={{ ...btn, background: '#7c3aed', border: 'none', color: '#fff', fontWeight: 700, padding: '4px 10px' }}>Mover</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            {/* Movimentos */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>3 · Movimentos ({moves.length})</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void copy('moves', ['Pacotes volumosos — reatribuição', '', ...moves.filter(m => !m.done).map(m => `${m.tn} (${fmt(m.volL, 0)} L): ${m.fromGaiola ?? m.fromAt} → ${m.toGaiola ?? m.toAt} (${m.toDriver})`)].join('\n'))} disabled={!moves.some(m => !m.done)} style={btn}>{copied === 'moves' ? '✓ Copiado' : '📋 Copiar pendentes'}</button>
                  <button onClick={() => void copy('brs', moves.filter(m => !m.done).map(m => m.tn).join('\n'))} disabled={!moves.some(m => !m.done)} style={btn}>{copied === 'brs' ? '✓ Copiado' : '🧾 BRs'}</button>
                </div>
              </div>
              {moves.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Nenhum movimento ainda.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>{['Feito', 'BR', 'Volume', 'De', 'Para', 'Motorista', 'Carregamento destino', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {moves.map((m, i) => {
                      const l = loadOf(m.toAt)
                      return (
                        <tr key={m.tn} style={{ borderTop: `1px solid ${C.line}`, opacity: m.done ? .55 : 1 }}>
                          <td style={{ padding: '4px 6px' }}><input type="checkbox" checked={m.done} onChange={() => saveMoves(moves.map((x, j) => j === i ? { ...x, done: !x.done } : x))} /></td>
                          <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, color: C.text }}>{m.tn}</td>
                          <td style={{ padding: '4px 6px', color: C.sub }}>{fmt(m.volL, 1)} L</td>
                          <td style={{ padding: '4px 6px', color: C.sub }}>{m.fromGaiola ?? m.fromAt}</td>
                          <td style={{ padding: '4px 6px', fontWeight: 700, color: C.text }}>{m.toGaiola ?? m.toAt}</td>
                          <td style={{ padding: '4px 6px', color: C.sub, fontSize: 11 }}>{m.toDriver}</td>
                          <td style={{ padding: '4px 6px' }}>{!m.done && l.state === 'loaded' ? chip('⚠ destino já saiu', C.red) : loadChip(l)}</td>
                          <td style={{ padding: '4px 6px' }}><button onClick={() => saveMoves(moves.filter((_, j) => j !== i))} title="Desfazer" style={{ ...btn, padding: '2px 8px', fontSize: 11, color: C.red }}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>O movimento fica registrado no app (e na planilha compartilhada). A troca física do pacote e a transferência no SPX são feitas pela equipe; marque “Feito” quando concluir.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
