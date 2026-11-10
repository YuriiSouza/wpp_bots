import { useMemo, useState } from 'react'
import type { Shift } from '../../lib/globalConfig'
import type { StoredDriver } from '../../lib/localStore'
import type { LocalRoute } from '../../lib/noshowRouteParser'
import { routeStore } from '../../lib/routeStore'
import { queueStore } from '../../lib/queueStore'
import { fetchSpxQueue, dockKey, SITUATION_LABEL, type QueueSituation } from '../../lib/spxQueueFetcher'
import { overrideVehicle } from '../../lib/fiorinoOverride'
import { getCtPackages, classifyPackage } from '../../lib/planilhas'

// Volumosos:
// 1) digita o BR e recebe sugestões de rota com Fiorino atribuída que ainda não foi carregada
// 2) rotas programadas para Fiorino que estão saindo com Passeio
// "Carregada" vem da fila do carregamento do SPX (situação "Saiu").

const C = { bg: '#0f1117', card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', red: '#f87171', amber: '#fbbf24', green: '#4ade80' }
const fmt = (n: number, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const vehicleOf = (v?: string | null) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino') || s.includes('van')) return 'FIORINO'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return null
}
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, t = Math.PI / 180
  const dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type Load = { state: 'loaded' | 'loading' | 'free' | 'unknown'; label: string }

export default function Volumosos({ registry, selectedDay, selectedShift }: { registry: StoredDriver[]; selectedDay: string; selectedShift: Shift }) {
  const [queueVer, setQueueVer] = useState(0)
  const [qLoading, setQLoading] = useState(false)
  const [qErr, setQErr] = useState('')
  const [br, setBr] = useState('')
  const [copied, setCopied] = useState('')
  const copy = async (k: string, t: string) => { if (!t) return; await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1800) }

  const routes = useMemo(() => routeStore.get(selectedDay, selectedShift) ?? [], [selectedDay, selectedShift])
  const packages = useMemo(() => getCtPackages(selectedDay, selectedShift), [selectedDay, selectedShift])
  const queue = useMemo(() => queueStore.get(selectedDay, selectedShift), [selectedDay, selectedShift, queueVer])
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

  const loadOf = useMemo(() => {
    const m = new Map<string, { s?: QueueSituation; dock?: string }>()
    for (const e of queue?.entries ?? []) if (e.atId) m.set(e.atId, { s: e.situation, dock: e.dock })
    return (atId: string): Load => {
      if (!queue) return { state: 'unknown', label: 'sem dados da fila' }
      const q = m.get(atId)
      if (!q) return { state: 'free', label: 'ainda não chegou' }
      if (q.s === 'done') return { state: 'loaded', label: 'já saiu (carregada)' }
      if (q.s === 'at-dock') return { state: 'loading', label: `carregando · ${dockKey(q.dock ?? '')}` }
      return { state: 'free', label: q.s ? SITUATION_LABEL[q.s] : 'na fila' }
    }
  }, [queue])

  const driverVehicle = (r: LocalRoute) => r.assignedDriverId ? vehicleOf(overrideVehicle(r.assignedDriverId, regMap.get(r.assignedDriverId)?.vehicleType)) : null
  const phoneOf = (id?: string | null) => (id ? (regMap.get(id)?.phoneNumber ?? '').replace(/\D/g, '') : '')
  const chip = (l: Load) => {
    const c = l.state === 'loaded' ? C.red : l.state === 'loading' ? C.amber : l.state === 'free' ? C.green : C.muted
    return <span style={{ fontSize: 10, fontWeight: 700, color: c, border: `1px solid ${c}55`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{l.label}</span>
  }

  // ── 1) BR → sugestões ──
  const pkg = useMemo(() => {
    const q = br.trim().toUpperCase()
    return q ? packages.find(p => p.tn.toUpperCase() === q) ?? null : null
  }, [br, packages])
  const suggestions = useMemo(() => {
    if (!pkg) return []
    return routes
      .filter(r => r.atId !== pkg.at && r.status === 'ATRIBUIDA' && r.assignedDriverId && driverVehicle(r) === 'FIORINO')
      .map(r => {
        const pts = packages.filter(p => p.at === r.atId && p.lat != null && p.lon != null)
        const dist = pkg.lat != null && pkg.lon != null && pts.length ? Math.min(...pts.map(p => km({ lat: pkg.lat!, lon: pkg.lon! }, { lat: p.lat!, lon: p.lon! }))) : null
        return { r, dist, load: loadOf(r.atId), sameCluster: !!pkg.cluster && r.cluster.toLowerCase().includes(pkg.cluster.toLowerCase()) }
      })
      .filter(x => x.load.state !== 'loaded')
      .sort((a, b) => (a.load.state === 'loading' ? 1 : 0) - (b.load.state === 'loading' ? 1 : 0) || (a.dist ?? 999) - (b.dist ?? 999))
  }, [pkg, routes, packages, loadOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const origin = pkg ? rMap.get(pkg.at) : undefined

  // ── 2) Rotas de Fiorino saindo com Passeio ──
  const fiorinoComPasseio = useMemo(() => routes
    .filter(r => vehicleOf(r.scheduledVehicle) === 'FIORINO' && r.status === 'ATRIBUIDA' && r.assignedDriverId && driverVehicle(r) === 'PASSEIO')
    .map(r => ({ r, load: loadOf(r.atId) }))
    .sort((a, b) => (a.load.state === 'loaded' ? 1 : 0) - (b.load.state === 'loaded' ? 1 : 0) || (b.r.volume ?? 0) - (a.r.volume ?? 0)),
  [routes, loadOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const th: React.CSSProperties = { textAlign: 'left', padding: '5px 8px', fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12, color: C.sub }
  const btn: React.CSSProperties = { background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 7, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>🧱 Volumosos</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
            {selectedShift} · {selectedDay} · {queue ? `carregamento lido às ${new Date(queue.importedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'sem dados do carregamento'}
          </p>
        </div>
        <button onClick={() => void refreshQueue()} disabled={qLoading} style={{ ...btn, background: '#7c3aed', border: 'none', color: '#fff', fontWeight: 700 }}>{qLoading ? '⏳…' : '🔄 Atualizar carregamento (SPX)'}</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {qErr && <p style={{ margin: 0, fontSize: 12, color: C.red }}>✕ {qErr}</p>}
        {!queue && <p style={{ margin: 0, fontSize: 12, color: C.amber }}>⚠ Sem o carregamento não dá para saber quais rotas já saíram. Clique em “Atualizar carregamento (SPX)”.</p>}

        {/* 1) BR */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Onde colocar o pacote?</p>
          <input value={br} onChange={e => setBr(e.target.value)} placeholder="Digite ou cole o código BR (ex.: BR262059286734D)" autoFocus
            style={{ maxWidth: 420, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'monospace', outline: 'none' }} />
          {!packages.length && <p style={{ margin: 0, fontSize: 12, color: C.amber }}>Sem pacotes deste turno: busque a roteirização pelo link da planilha (Uploads › Roteirização por Turno).</p>}
          {br.trim() && packages.length > 0 && !pkg && <p style={{ margin: 0, fontSize: 12, color: C.amber }}>BR não encontrado na roteirização de {selectedShift} · {selectedDay}.</p>}
          {pkg && (
            <>
              <div style={{ background: C.bg, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: C.sub, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div><b style={{ color: C.text, fontFamily: 'monospace' }}>{pkg.tn}</b> · classe <b style={{ color: C.text }}>{classifyPackage(pkg)}</b> · {pkg.dims.map(d => d ?? '—').join('×')} cm · {fmt((pkg.volumeCm3 ?? 0) / 1000, 1)} L{pkg.weightG != null ? ` · ${fmt(pkg.weightG / 1000, 1)} kg` : ''}</div>
                <div>Está na rota <b style={{ color: C.text }}>{origin?.gaiola ?? '—'}</b> <span style={{ fontFamily: 'monospace' }}>{pkg.at}</span> · {vehicleOf(origin ? (driverVehicle(origin) ?? origin.scheduledVehicle) : pkg.plannedVehicle) ?? '—'} · {origin?.assignedDriverName ?? 'sem motorista'} · {chip(loadOf(pkg.at))}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{pkg.address} — {pkg.neighborhood}</div>
              </div>
              {suggestions.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.amber }}>Nenhuma rota com Fiorino atribuída e ainda não carregada.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['', 'Gaiola', 'AT', 'Cluster', 'Motorista (Fiorino)', 'Parada mais próxima', 'Volume da rota', 'Carregamento'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {suggestions.slice(0, 10).map((x, i) => (
                      <tr key={x.r.atId} style={{ borderTop: `1px solid ${C.line}`, background: i === 0 ? 'rgba(74,222,128,.05)' : undefined }}>
                        <td style={{ ...td, color: i === 0 ? C.green : C.muted, fontWeight: 700 }}>{i === 0 ? '★' : i + 1}</td>
                        <td style={{ ...td, fontSize: 14, fontWeight: 800, color: C.text }}>{x.r.gaiola ?? '—'}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                          <button onClick={() => void copy(x.r.atId, x.r.atId)} title="Copiar AT" style={{ background: 'none', border: 'none', padding: 0, color: C.sub, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>{x.r.atId} {copied === x.r.atId ? '✓' : '📋'}</button>
                        </td>
                        <td style={td}>{x.r.cluster}{x.sameCluster ? <span style={{ color: C.green }}> · mesmo cluster</span> : ''}</td>
                        <td style={{ ...td, color: C.text }}>{x.r.assignedDriverName ?? x.r.assignedDriverId}</td>
                        <td style={{ ...td, fontWeight: 700, color: x.dist != null && x.dist <= 2 ? C.green : x.dist != null && x.dist <= 6 ? C.amber : C.sub }}>{x.dist != null ? `${fmt(x.dist, 1)} km` : '—'}</td>
                        <td style={td}>{x.r.volume ?? '—'} L</td>
                        <td style={td}>{chip(x.load)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* 2) Fiorino com Passeio */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Rotas de Fiorino saindo com Passeio ({fiorinoComPasseio.length})</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>Veículo programado Fiorino, mas o motorista atribuído é de Passeio (pelo cadastro).</p>
            </div>
            {fiorinoComPasseio.length > 0 && <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => void copy('ats', fiorinoComPasseio.map(x => x.r.atId).join('\n'))} style={btn}>{copied === 'ats' ? '✓ Copiado' : '🧾 Copiar ATs'}</button>
              <button onClick={() => void copy('tel', fiorinoComPasseio.map(x => phoneOf(x.r.assignedDriverId)).filter(Boolean).join('\n'))} style={btn}>{copied === 'tel' ? '✓ Copiado' : '📞 Copiar telefones'}</button>
            </div>}
          </div>
          {fiorinoComPasseio.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: routes.length ? C.green : C.muted }}>{routes.length ? '✓ Nenhuma rota de Fiorino com Passeio.' : 'Nenhuma rota carregada neste turno.'}</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Gaiola', 'AT', 'Cluster', 'Volume', 'GG', 'Motorista (Passeio)', 'Telefone', 'Carregamento'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fiorinoComPasseio.map(({ r, load }) => (
                  <tr key={r.atId} style={{ borderTop: `1px solid ${C.line}`, opacity: load.state === 'loaded' ? .5 : 1 }}>
                    <td style={{ ...td, fontSize: 14, fontWeight: 800, color: C.text }}>{r.gaiola ?? '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.atId}</td>
                    <td style={td}>{r.cluster}</td>
                    <td style={{ ...td, fontWeight: 700, color: (r.volume ?? 0) > 700 ? C.amber : C.text }}>{r.volume ?? '—'} L</td>
                    <td style={{ ...td, color: (r.gg ?? 0) > 1 ? C.amber : C.sub }}>{r.gg ?? '—'}</td>
                    <td style={{ ...td, color: C.text }}>{r.assignedDriverName ?? r.assignedDriverId}<div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.assignedDriverId}</div></td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{phoneOf(r.assignedDriverId) || '—'}</td>
                    <td style={td}>{chip(load)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
