import { useMemo, useState } from 'react'
import type { Shift } from '../../lib/globalConfig'
import { getGlobalConfig } from '../../lib/globalConfig'
import { routeStore } from '../../lib/routeStore'
import EhaDashboard from './Dashboard'
import { fetchEhaBase, getEhaCache, saveEhaCache, getCtPackages, type EhaRow, type CtPackage } from '../../lib/planilhas'

// Pacotes que receberam "EHA - Não Coube no Veículo" em dias/turnos anteriores (base atualizada a cada 4h),
// cruzados com a roteirização do turno: em qual rota/gaiola/veículo cada um está saindo agora.

const C = { bg: '#0f1117', card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', red: '#f87171', amber: '#fbbf24', green: '#4ade80', blue: '#60a5fa', violet: '#a78bfa' }
const VEHICLE_COLOR: Record<string, string> = { FIORINO: C.amber, MOTO: '#f472b6', PASSEIO: C.blue, VAN: C.violet }
const isHigh = (r: EhaRow) => /verm/i.test(r.risco) || r.count >= 2
const vehicleOf = (v?: string | null) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return s ? s.toUpperCase() : '—'
}
const fmt = (n: number, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const since = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `há ${Math.floor(m / 1440)} dia(s)`
}

interface Row extends EhaRow {
  pkg?: CtPackage
  gaiola: string | null
  vehicle: string
  routeVolume: number | null
  driver: string | null
}

function Kpi({ label, value, sub, color, onClick, active }: { label: string; value: React.ReactNode; sub?: string; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{ textAlign: 'left', background: active ? `${color}18` : C.card, border: `1px solid ${active ? color : C.border}`, borderRadius: 10, padding: '10px 14px', cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 800, color }}>{value}</p>
      {sub && <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{sub}</p>}
    </button>
  )
}

export default function Eha({ selectedDay, selectedShift, onOpenRoute }: { selectedDay: string; selectedShift: Shift; onOpenRoute?: (atId: string) => void }) {
  const cfg = getGlobalConfig()
  const station = cfg.ehaStation || cfg.hubName
  const [cache, setCache] = useState(() => getEhaCache())
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [view, setView] = useState<'dashboard' | 'lista'>('lista')
  const [scope, setScope] = useState<'turno' | 'fora' | 'todos'>('turno')
  const [risk, setRisk] = useState<'' | 'alto' | 'moderado'>('')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState('')
  const copy = async (k: string, t: string) => { if (!t) return; await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1800) }

  const refresh = async () => {
    setLoading(true); setErr('')
    try {
      const d = await fetchEhaBase(cfg.ehaSheetUrl, station)
      const c = { ...d, station }
      saveEhaCache(c); setCache(c)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }

  const routes = useMemo(() => routeStore.get(selectedDay, selectedShift) ?? [], [selectedDay, selectedShift])
  const packages = useMemo(() => getCtPackages(selectedDay, selectedShift), [selectedDay, selectedShift])

  const rows: Row[] = useMemo(() => {
    const pkMap = new Map(packages.map(p => [p.tn, p]))
    const rMap = new Map(routes.map(r => [r.atId, r]))
    return (cache?.rows ?? []).map(e => {
      const pkg = pkMap.get(e.tn)
      const r = pkg ? rMap.get(pkg.at) : undefined
      return {
        ...e, pkg,
        gaiola: r?.gaiola ?? pkg?.cage ?? null,
        vehicle: vehicleOf(r?.scheduledVehicle ?? pkg?.plannedVehicle),
        routeVolume: r?.volume ?? null,
        driver: r?.assignedDriverName ?? null,
      }
    }).sort((a, b) => b.count - a.count || (b.lastEha > a.lastEha ? 1 : -1))
  }, [cache, packages, routes])

  const inShift = rows.filter(r => r.pkg)
  const base = scope === 'turno' ? inShift : scope === 'fora' ? rows.filter(r => !r.pkg) : rows
  const s = q.trim().toLowerCase()
  const shown = base.filter(r =>
    (!risk || (risk === 'alto' ? isHigh(r) : !isHigh(r))) &&
    (!s || r.tn.toLowerCase().includes(s) || (r.pkg?.at ?? '').toLowerCase().includes(s) || (r.gaiola ?? '').toLowerCase().startsWith(s) || r.lastStatusDesc.toLowerCase().includes(s) || (r.pkg?.neighborhood ?? '').toLowerCase().includes(s)))

  // Por rota: onde estão os pacotes com EHA neste turno
  const byRoute = useMemo(() => {
    const m = new Map<string, { at: string; gaiola: string | null; vehicle: string; volume: number | null; driver: string | null; n: number; high: number; maxCount: number; volL: number }>()
    for (const r of inShift) {
      const at = r.pkg!.at
      const cur = m.get(at) ?? { at, gaiola: r.gaiola, vehicle: r.vehicle, volume: r.routeVolume, driver: r.driver, n: 0, high: 0, maxCount: 0, volL: 0 }
      cur.n++; if (isHigh(r)) cur.high++
      cur.maxCount = Math.max(cur.maxCount, r.count)
      cur.volL += (r.pkg!.volumeCm3 ?? 0) / 1000
      m.set(at, cur)
    }
    return [...m.values()].sort((a, b) => b.high - a.high || b.n - a.n)
  }, [inShift])

  const statusDist = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.lastStatusDesc || '—', (m.get(r.lastStatusDesc || '—') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [rows])
  const countDist = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) m.set(r.count, (m.get(r.count) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [rows])

  const high = rows.filter(isHigh).length
  const btn: React.CSSProperties = { background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>♻ Pacotes com EHA — não couberam no veículo</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
            {station || 'station não configurado'} · {cache ? `base lida ${since(cache.fetchedAt)} (a planilha atualiza a cada 4h)` : 'base ainda não lida'} · turno {selectedShift} · {selectedDay}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, overflow: 'hidden' }}>
            {([['dashboard', '📊 Dashboard'], ['lista', '☰ Pacotes do turno']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{ background: view === k ? 'rgba(99,102,241,.2)' : 'transparent', color: view === k ? '#a5b4fc' : C.muted, border: 'none', padding: '5px 14px', fontSize: 12, fontWeight: view === k ? 700 : 400, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          {view === 'lista' && !packages.length && <span style={{ fontSize: 11, color: C.amber }}>Sem pacotes do turno: busque a roteirização pelo link para cruzar com as rotas.</span>}
          <button onClick={() => void refresh()} disabled={loading || !cfg.ehaSheetUrl} style={{ ...btn, background: '#7c3aed', border: 'none', color: '#fff', fontWeight: 700, opacity: loading || !cfg.ehaSheetUrl ? .5 : 1 }}>{loading ? '⏳ Lendo…' : '🔄 Atualizar base'}</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!cfg.ehaSheetUrl && <p style={{ margin: 0, fontSize: 13, color: C.amber }}>Configure o link da planilha de EHA e o station name em ⚙ Configurações › Base de EHA.</p>}
        {err && <p style={{ margin: 0, fontSize: 12, color: C.red }}>✕ {err}</p>}

        {cache && view === 'dashboard' && <EhaDashboard cache={cache} />}
        {cache && view === 'lista' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <Kpi label="Pacotes com EHA no hub" value={rows.length} sub={`de ${fmt(cache.totalBase)} na base geral`} color={C.violet} onClick={() => { setScope('todos'); setRisk('') }} active={scope === 'todos' && !risk} />
              <Kpi label="Na roteirização do turno" value={inShift.length} sub="saindo de novo agora" color={C.blue} onClick={() => { setScope('turno'); setRisk('') }} active={scope === 'turno' && !risk} />
              <Kpi label="Alto risco de cancelamento" value={high} sub="2+ EHAs (vermelho)" color={C.red} onClick={() => { setScope('todos'); setRisk('alto') }} active={risk === 'alto'} />
              <Kpi label="Risco moderado" value={rows.length - high} sub="1 EHA (amarelo)" color={C.amber} onClick={() => { setScope('todos'); setRisk('moderado') }} active={risk === 'moderado'} />
              <Kpi label="Fora da roteirização" value={rows.length - inShift.length} sub="não estão neste turno" color={C.muted} onClick={() => { setScope('fora'); setRisk('') }} active={scope === 'fora' && !risk} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1.4fr) minmax(240px, 1fr)', gap: 12 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>Rotas do turno com pacotes de EHA ({byRoute.length})</p>
                <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Confira se esses pacotes cabem no veículo antes de liberar — se voltarem de novo, o risco de cancelamento aumenta.</p>
                {!byRoute.length ? <p style={{ margin: 0, fontSize: 12, color: packages.length ? C.green : C.muted }}>{packages.length ? '✓ Nenhum pacote com EHA nas rotas deste turno.' : 'Sem pacotes do turno para cruzar.'}</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>{['Gaiola', 'AT', 'Veículo', 'Vol. rota', 'EHA', 'Alto risco', 'Motorista'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {byRoute.map(r => (
                        <tr key={r.at} onClick={() => onOpenRoute?.(r.at)} style={{ borderTop: `1px solid ${C.line}`, cursor: onOpenRoute ? 'pointer' : 'default' }} title="Abrir detalhe da rota">
                          <td style={{ padding: '5px 6px', fontWeight: 800, color: C.text }}>{r.gaiola ?? '—'}</td>
                          <td style={{ padding: '5px 6px', fontFamily: 'monospace', fontSize: 11, color: C.sub }}>{r.at}</td>
                          <td style={{ padding: '5px 6px', fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[r.vehicle] ?? C.sub }}>{r.vehicle}</td>
                          <td style={{ padding: '5px 6px', color: (r.volume ?? 0) > 700 ? C.amber : C.sub }}>{r.volume ?? '—'} L</td>
                          <td style={{ padding: '5px 6px', fontWeight: 700, color: C.text }}>{r.n} <span style={{ fontWeight: 400, fontSize: 10, color: C.muted }}>({fmt(r.volL, 1)} L)</span></td>
                          <td style={{ padding: '5px 6px', fontWeight: 700, color: r.high ? C.red : C.muted }}>{r.high || '—'}</td>
                          <td style={{ padding: '5px 6px', color: r.driver ? C.text : C.muted, fontSize: 11 }}>{r.driver ?? 'sem motorista'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>Quantas vezes já voltou</p>
                  {countDist.map(([n, v]) => { const max = Math.max(1, ...countDist.map(x => x[1])); return (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 34px', gap: 8, alignItems: 'center', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: n >= 2 ? C.red : C.amber, fontWeight: 700 }}>{n} EHA{n > 1 ? 's' : ''}</span>
                      <div style={{ height: 8, background: C.line, borderRadius: 4 }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', background: n >= 2 ? C.red : C.amber, borderRadius: 4 }} /></div>
                      <span style={{ color: C.text, textAlign: 'right', fontWeight: 600 }}>{v}</span>
                    </div>
                  ) })}
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase' }}>Último status</p>
                  {statusDist.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3, gap: 8 }}>
                      <span style={{ color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
                      <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Lista */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {([['turno', 'No turno'], ['fora', 'Fora do turno'], ['todos', 'Todos']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setScope(k)} style={{ ...btn, padding: '4px 10px', fontSize: 11, color: scope === k ? '#fff' : C.sub, background: scope === k ? 'rgba(124,58,237,.25)' : 'transparent', borderColor: scope === k ? '#7c3aed' : C.border }}>{l}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {([['', 'Todos os riscos'], ['alto', '🔴 Alto'], ['moderado', '🟡 Moderado']] as const).map(([k, l]) => (
                    <button key={k || 'all'} onClick={() => setRisk(k)} style={{ ...btn, padding: '4px 10px', fontSize: 11, color: risk === k ? '#fff' : C.sub, background: risk === k ? 'rgba(124,58,237,.25)' : 'transparent', borderColor: risk === k ? '#7c3aed' : C.border }}>{l}</button>
                  ))}
                </div>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 BR, AT, gaiola, bairro, status" style={{ width: 240, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
                <span style={{ fontSize: 11, color: C.muted }}>{shown.length} pacote(s)</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => void copy('brs', shown.map(r => r.tn).join('\n'))} style={btn}>{copied === 'brs' ? '✓ Copiado' : '📋 Copiar BRs'}</button>
                  <button onClick={() => void copy('tab', ['BR\tEHAs\tAT\tGaiola\tVeículo\tRisco', ...shown.map(r => [r.tn, r.count, r.pkg?.at ?? '', r.gaiola ?? '', r.vehicle, isHigh(r) ? 'Alto' : 'Moderado'].join('\t'))].join('\n'))} style={btn}>{copied === 'tab' ? '✓ Copiado' : '📊 Copiar tabela'}</button>
                </div>
              </div>
              <div style={{ maxHeight: 520, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>{['BR', 'EHAs', 'Último EHA', 'Gaiola', 'AT', 'Veículo', 'Parada · bairro', 'Tam. · vol', 'Último status'].map(h => <th key={h} style={{ position: 'sticky', top: 0, background: C.card, textAlign: 'left', padding: '5px 6px', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map(r => (
                      <tr key={r.tn} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: '5px 6px', fontFamily: 'monospace', color: C.text }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: isHigh(r) ? C.red : C.amber, marginRight: 6 }} />{r.tn}</td>
                        <td style={{ padding: '5px 6px', fontWeight: 800, color: isHigh(r) ? C.red : C.amber }}>{r.count}</td>
                        <td style={{ padding: '5px 6px', color: C.sub, fontSize: 11 }}>{r.lastEha}</td>
                        <td style={{ padding: '5px 6px', fontWeight: 700, color: C.text }}>{r.gaiola ?? '—'}</td>
                        <td style={{ padding: '5px 6px', fontFamily: 'monospace', fontSize: 11 }}>
                          {r.pkg ? <button onClick={() => onOpenRoute?.(r.pkg!.at)} style={{ background: 'none', border: 'none', padding: 0, color: C.blue, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>{r.pkg.at}</button> : <span style={{ color: C.muted }}>fora do turno</span>}
                        </td>
                        <td style={{ padding: '5px 6px', fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[r.vehicle] ?? C.muted }}>{r.pkg ? r.vehicle : '—'}</td>
                        <td style={{ padding: '5px 6px', color: C.sub, fontSize: 11 }}>{r.pkg ? `${r.pkg.stop ?? '—'} · ${r.pkg.neighborhood}` : '—'}</td>
                        <td style={{ padding: '5px 6px', color: C.sub, fontSize: 11 }}>{r.pkg ? `${r.pkg.category || '—'} · ${fmt((r.pkg.volumeCm3 ?? 0) / 1000, 1)} L` : '—'}</td>
                        <td style={{ padding: '5px 6px', color: C.muted, fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.lastStatusDesc}>{r.lastStatusDesc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
              Premissas da base: pacotes com status “EHA - Não Coube no Veículo”, com o último status aplicado por um LM Hub. Vermelho (2+ EHAs) = alto risco de cancelamento; amarelo (1 EHA) = risco moderado. A planilha atualiza a cada 4 horas (02:00, 04:00 … 22:00).
            </p>
          </>
        )}
      </div>
    </div>
  )
}
