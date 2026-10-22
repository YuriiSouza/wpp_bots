import { Fragment, useMemo, useState } from 'react'
import type { StoredDriver } from '../../lib/localStore'
import { loadRouteHistory, routeDs, type RouteRecord } from '../../lib/routeHistory'

// Novatos = motoristas cuja primeira rota no relatório de resultados cai no período filtrado.
// A primeira aparição do ID é tratada como a primeira vez que ele rodou.

const C = {
  bg: '#0f1117', panel: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b',
  good: '#4ade80', warn: '#fbbf24', bad: '#f87171', blue: '#60a5fa', violet: '#a78bfa', pink: '#f472b6', orange: '#fb923c',
}
const SHIFT_COLOR: Record<string, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#a78bfa' }
const shiftColor = (s: string) => SHIFT_COLOR[s] ?? '#94a3b8'
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (ym: string) => `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]}/${ym.slice(2, 4)}`
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const pct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`)
const dsColor = (v: number | null) => (v === null ? C.muted : v >= 0.95 ? C.good : C.bad)
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

interface Novato {
  driverId: string; name: string; vehicle: string; firstDate: string; firstShift: string; firstCluster: string
  routes: RouteRecord[]; ds: number | null; dsFirst: number | null; dsLast: number | null; active: boolean; daysSinceLast: number
}

function Panel({ title, sub, children, style, right }: { title: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties; right?: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</p>
          {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sub}</p>}
        </div>
        {right}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}

/** DS rota a rota de um motorista, com a linha da meta de 95%. */
function RouteLine({ values, height = 120 }: { values: (number | null)[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  if (pts.length === 0) return <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Sem performance nas rotas.</p>
  const W = 600, H = height, pad = 6
  const min = Math.min(0.8, ...pts.map(p => p.v)), max = 1
  const x = (i: number) => pad + (values.length <= 1 ? (W - 2 * pad) / 2 : (i / (values.length - 1)) * (W - 2 * pad))
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad)
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)); setHover(Math.max(0, Math.min(values.length - 1, i))) }}>
        <line x1={0} x2={W} y1={y(0.95)} y2={y(0.95)} stroke={C.good} strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
        <path d={path} fill="none" stroke={C.blue} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {pts.map(p => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={3.5} fill={p.v >= 0.95 ? C.good : C.bad} stroke={C.panel} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke={C.sub} strokeWidth={1} opacity={0.4} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span style={{ position: 'absolute', right: 4, top: Math.max(0, y(0.95) * (H / H) - 14), fontSize: 9, color: C.good }}>meta 95%</span>
      {hover !== null && (
        <div style={{ position: 'absolute', left: `${(x(hover) / W) * 100}%`, top: 0, transform: 'translateX(-50%)', background: '#0a0c14', border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 7px', fontSize: 11, color: C.text, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          rota {hover + 1}: <b style={{ color: dsColor(values[hover]) }}>{pct(values[hover])}</b>
        </div>
      )}
    </div>
  )
}

export default function NovatosAnalise({ registry, onGoUploads }: { registry: StoredDriver[]; onGoUploads: () => void }) {
  const all = loadRouteHistory()
  const months = useMemo(() => [...new Set(all.map(r => r.date.slice(0, 7)))].filter(m => m.length === 7).sort(), [all])
  const reportStart = all.reduce((m, r) => (r.date && r.date < m ? r.date : m), '9999')
  const reportEnd = all.reduce((m, r) => (r.date > m ? r.date : m), '')

  // Por padrão ignora o 1º mês do relatório: quem aparece nele pode já rodar antes do início dos dados
  // Datas completas (AAAA-MM-DD). Início padrão: 1º dia do 2º mês do relatório
  const [from, setFrom] = useState(() => (months[1] ? `${months[1]}-01` : reportStart.length === 10 ? reportStart : ''))
  const [to, setTo] = useState(() => reportEnd)
  const [detail, setDetail] = useState<Novato | null>(null)
  const [shiftSel, setShiftSel] = useState('')
  const [sort, setSort] = useState<'first' | 'ds' | 'routes'>('first')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  const shifts = useMemo(() => [...new Set(all.map(r => r.shift).filter(Boolean))].sort(), [all])
  const regMap = useMemo(() => new Map(registry.map(d => [d.id, d])), [registry])

  // Rotas por motorista, em ordem
  const byDriver = useMemo(() => {
    const m = new Map<string, RouteRecord[]>()
    for (const r of all) { if (!m.has(r.driverId)) m.set(r.driverId, []); m.get(r.driverId)!.push(r) }
    for (const l of m.values()) l.sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift))
    return m
  }, [all])

  const novatos = useMemo((): Novato[] => {
    const endMs = reportEnd ? Date.parse(reportEnd) : 0
    const out: Novato[] = []
    for (const [driverId, routes] of byDriver) {
      const first = routes[0]
      if (!from || first.date < from || first.date > to) continue
      if (shiftSel && first.shift !== shiftSel) continue
      const ds = routes.map(routeDs).filter((v): v is number => v !== null)
      const last = routes[routes.length - 1]
      const daysSinceLast = Math.round((endMs - Date.parse(last.date)) / 86400000)
      const reg = regMap.get(driverId)
      out.push({
        driverId, name: reg?.name || driverId, vehicle: reg?.vehicleType || first.vehicle || '—',
        firstDate: first.date, firstShift: first.shift, firstCluster: first.cluster, routes,
        ds: avg(ds), dsFirst: avg(ds.slice(0, 5)), dsLast: ds.length > 5 ? avg(ds.slice(-5)) : null,
        active: daysSinceLast <= 14, daysSinceLast,
      })
    }
    return out
  }, [byDriver, from, to, shiftSel, regMap, reportEnd])

  // Novatos que começaram em cada mês (ou semana, em períodos curtos), por turno
  const byWeek = from && to ? (Date.parse(to) - Date.parse(from)) / 86400000 <= 62 : false
  const bucketOf = (d: string) => {
    if (!byWeek) return d.slice(0, 7)
    const dt = new Date(`${d}T12:00:00`)
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)) // segunda-feira da semana
    return dt.toISOString().slice(0, 10)
  }
  const bucketLabel = (k: string) => (k.length === 7 ? monthLabel(k) : `sem ${fmtDate(k).slice(0, 5)}`)
  const perMonth = useMemo(() => {
    const keys: string[] = []
    if (from && to) {
      const dt = new Date(`${from}T12:00:00`)
      while (dt.toISOString().slice(0, 10) <= to) {
        const k = bucketOf(dt.toISOString().slice(0, 10))
        if (!keys.includes(k)) keys.push(k)
        dt.setDate(dt.getDate() + (byWeek ? 7 : 28))
      }
      const kt = bucketOf(to); if (!keys.includes(kt)) keys.push(kt)
    }
    return keys.map(m => {
      const counts: Record<string, number> = {}
      for (const n of novatos) if (bucketOf(n.firstDate) === m) counts[n.firstShift] = (counts[n.firstShift] ?? 0) + 1
      return { m, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
    })
  }, [novatos, from, to, byWeek]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxMonth = Math.max(1, ...perMonth.map(p => p.total))

  // Curva de aprendizado: DS médio na 1ª, 2ª, ... rota dos novatos × DS médio dos veteranos
  const curve = useMemo(() => {
    const N = 15
    const sums = Array.from({ length: N }, () => ({ s: 0, n: 0 }))
    for (const nv of novatos) nv.routes.slice(0, N).forEach((r, i) => { const v = routeDs(r); if (v !== null) { sums[i].s += v; sums[i].n++ } })
    const novIds = new Set(novatos.map(n => n.driverId))
    const vet = all.filter(r => !novIds.has(r.driverId) && r.date >= from && r.date <= to).map(routeDs).filter((v): v is number => v !== null)
    return { points: sums.map((x, i) => ({ i: i + 1, v: x.n >= 2 ? x.s / x.n : null, n: x.n })), veteran: avg(vet) }
  }, [novatos, all, from, to])

  const nq = search.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const matches = (n: Novato) => !nq || n.driverId.includes(nq) || n.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(nq) || n.firstCluster.toLowerCase().includes(nq)
  const sorted = novatos.filter(matches).sort((a, b) =>
    sort === 'ds' ? (b.ds ?? -1) - (a.ds ?? -1) : sort === 'routes' ? b.routes.length - a.routes.length : b.firstDate.localeCompare(a.firstDate))

  const dsAll = avg(novatos.flatMap(n => n.routes.map(routeDs).filter((v): v is number => v !== null)))
  const active = novatos.filter(n => n.active).length
  const improving = novatos.filter(n => n.dsFirst !== null && n.dsLast !== null && n.dsLast > n.dsFirst + 0.01).length
  const withTrend = novatos.filter(n => n.dsFirst !== null && n.dsLast !== null).length
  const onTarget = novatos.filter(n => n.ds !== null && n.ds >= 0.95).length

  const copySummary = async () => {
    const L = [
      `🆕 Novatos que começaram a rodar — ${fmtDate(from)} a ${fmtDate(to)}${shiftSel ? ` · turno ${shiftSel}` : ''}`, '',
      `* Novatos: ${novatos.length} (${active} rodaram nos últimos 14 dias)`,
      `* DS médio dos novatos: ${pct(dsAll)} · veteranos no mesmo período: ${pct(curve.veteran)}`,
      `* Novatos com DS ≥ 95%: ${onTarget} de ${novatos.length}`,
      ...(withTrend ? [`* Melhoraram o DS (5 primeiras × 5 últimas rotas): ${improving} de ${withTrend}`] : []), '',
      byWeek ? 'Por semana:' : 'Por mês:',
      ...perMonth.map(p => `- ${bucketLabel(p.m)}: ${p.total}${Object.keys(p.counts).length ? ` (${Object.entries(p.counts).map(([s, n]) => `${s} ${n}`).join(' · ')})` : ''}`),
    ]
    await navigator.clipboard.writeText(L.join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  if (all.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, color: C.muted, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14, color: C.sub }}>Importe o relatório de resultados (rotas) para ver os novatos.</p>
        <p style={{ margin: 0, fontSize: 12, maxWidth: 460 }}>A primeira vez que o ID do motorista aparece no relatório é tratada como a primeira rota dele. Relatórios importados antes desta versão precisam ser importados de novo.</p>
        <button onClick={onGoUploads} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📤 Ir para Uploads</button>
      </div>
    )
  }

  const selStyle: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 10px', fontSize: 12, outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Cabeçalho + filtros */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>🆕 Novatos</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>Primeira rota de cada motorista no relatório de resultados · dados de {fmtDate(reportStart)} a {fmtDate(reportEnd)}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              ['30 dias', -30], ['60 dias', -60], ['90 dias', -90], ['Este mês', 'month'], ['Tudo', 'all'],
            ] as [string, number | string][]).map(([l, v]) => (
              <button key={l} onClick={() => {
                if (v === 'all') { setFrom(months[1] ? `${months[1]}-01` : reportStart); setTo(reportEnd); return }
                if (v === 'month') { setFrom(`${reportEnd.slice(0, 7)}-01`); setTo(reportEnd); return }
                const d = new Date(`${reportEnd}T12:00:00`); d.setDate(d.getDate() + (v as number))
                setFrom(d.toISOString().slice(0, 10)); setTo(reportEnd)
              }} style={{ background: 'transparent', color: C.sub, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 11, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          <input type="date" value={from} min={reportStart} max={reportEnd} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} style={{ ...selStyle, colorScheme: 'dark' }} />
          <span style={{ fontSize: 11, color: C.muted }}>até</span>
          <input type="date" value={to} min={reportStart} max={reportEnd} onChange={e => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value) }} style={{ ...selStyle, colorScheme: 'dark' }} />
          <div style={{ display: 'flex', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, overflow: 'hidden' }}>
            {['', ...shifts].map(s => (
              <button key={s || 'all'} onClick={() => setShiftSel(s)} style={{ background: shiftSel === s ? 'rgba(124,58,237,.2)' : 'transparent', color: shiftSel === s ? '#c4b5fd' : C.muted, border: 'none', padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{s || 'Todos'}</button>
            ))}
          </div>
          <button onClick={() => void copySummary()} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{copied ? '✓ Copiado' : '📋 Copiar resumo'}</button>
        </div>
      </div>

      {detail && <NovatoFicha n={detail} reg={regMap.get(detail.driverId)} novatos={novatos} vetDs={curve.veteran} reportEnd={reportEnd} onClose={() => setDetail(null)} />}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 80px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {from && months[0] && from.slice(0, 7) === months[0] && <p style={{ margin: 0, fontSize: 12, color: C.warn }}>⚠ {monthLabel(months[0])} é o primeiro mês do relatório: quem aparece nele pode já rodar antes, então não é necessariamente novato.</p>}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {[
            { label: 'Novatos no período', value: novatos.length, sub: `${(novatos.length / Math.max(1, perMonth.length)).toFixed(1)} por ${byWeek ? 'semana' : 'mês'} em média`, c: C.blue },
            { label: 'Seguem rodando', value: `${active}/${novatos.length}`, sub: 'rodaram nos últimos 14 dias do relatório', c: novatos.length && active / novatos.length >= 0.6 ? C.good : C.warn },
            { label: 'DS dos novatos', value: pct(dsAll), sub: `veteranos: ${pct(curve.veteran)}`, c: dsColor(dsAll) },
            { label: 'Na meta (≥ 95%)', value: `${onTarget}/${novatos.length}`, sub: 'DS médio do novato', c: C.good },
            { label: 'Melhoraram o DS', value: withTrend ? `${improving}/${withTrend}` : '—', sub: '5 primeiras × 5 últimas rotas', c: C.violet },
          ].map(k => (
            <div key={k.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <p style={{ margin: 0, fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
              <p style={{ margin: '6px 0 2px', fontSize: 26, fontWeight: 800, color: C.text, lineHeight: 1 }}>{k.value}</p>
              <p style={{ margin: 0, fontSize: 11, color: C.sub }}>{k.sub}</p>
              <div style={{ height: 3, width: 28, background: k.c, borderRadius: 2, marginTop: 8 }} />
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          {/* Por mês e turno */}
          <Panel title={`Novatos que começaram a rodar, por ${byWeek ? 'semana' : 'mês'}`} sub="Turno da primeira rota">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 170, paddingTop: 16 }}>
              {perMonth.map(p => (
                <div key={p.m} title={`${bucketLabel(p.m)}: ${p.total} novatos\n${Object.entries(p.counts).map(([s, n]) => `${s}: ${n}`).join('\n')}`}
                  style={{ flex: 1, maxWidth: 70, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{p.total}</span>
                  <div style={{ width: '70%', height: `${(p.total / maxMonth) * 80}%`, display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
                    {Object.keys(p.counts).sort().map(s => <div key={s} style={{ flex: p.counts[s], background: shiftColor(s), borderRadius: 3 }} />)}
                  </div>
                  <span style={{ fontSize: 10, color: C.sub, whiteSpace: 'nowrap' }}>{bucketLabel(p.m)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              {shifts.map(s => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.sub }}><span style={{ width: 9, height: 9, borderRadius: 2, background: shiftColor(s) }} />{s} <b style={{ color: C.text }}>{novatos.filter(n => n.firstShift === s).length}</b></span>)}
            </div>
          </Panel>

          {/* Curva de aprendizado */}
          <Panel title="Curva de aprendizado" sub={`DS médio dos novatos na 1ª, 2ª, 3ª… rota · linha tracejada = veteranos (${pct(curve.veteran)})`}>
            {(() => {
              const pts = curve.points.filter(p => p.v !== null) as { i: number; v: number; n: number }[]
              if (pts.length < 2) return <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Poucos dados para a curva.</p>
              const vals = [...pts.map(p => p.v), curve.veteran ?? 0.95, 0.95]
              const min = Math.min(...vals) - 0.01, max = Math.max(...vals, 1)
              const W = 600, H = 150
              const x = (i: number) => 20 + ((i - 1) / 14) * (W - 40)
              const y = (v: number) => 10 + (1 - (v - min) / (max - min)) * (H - 30)
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
                  {curve.veteran !== null && <line x1={20} x2={W - 20} y1={y(curve.veteran)} y2={y(curve.veteran)} stroke={C.sub} strokeDasharray="5 4" />}
                  <line x1={20} x2={W - 20} y1={y(0.95)} y2={y(0.95)} stroke={C.good} strokeDasharray="2 4" opacity={0.6} />
                  <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={C.blue} strokeWidth={2} />
                  {pts.map(p => (
                    <g key={p.i}>
                      <circle cx={x(p.i)} cy={y(p.v)} r={4} fill={dsColor(p.v)} stroke={C.panel} strokeWidth={1.5}><title>{`${p.i}ª rota: ${pct(p.v)} (${p.n} novatos)`}</title></circle>
                      <text x={x(p.i)} y={H - 4} fontSize={10} fill={C.muted} textAnchor="middle">{p.i}ª</text>
                    </g>
                  ))}
                </svg>
              )
            })()}
          </Panel>
        </div>

        {/* Lista */}
        <Panel title={`Quem são os novatos (${nq ? `${sorted.length} de ${novatos.length}` : novatos.length})`} sub="Clique num motorista para abrir a ficha completa"
          right={
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Nome, ID ou cluster"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 10px', fontSize: 12, outline: 'none', width: 200, marginRight: 6 }} />
              {([['first', 'Mais recentes'], ['ds', 'Maior DS'], ['routes', 'Mais rotas']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSort(k)} style={{ background: sort === k ? 'rgba(124,58,237,.2)' : 'transparent', color: sort === k ? '#c4b5fd' : C.muted, border: `1px solid ${sort === k ? '#7c3aed' : C.border}`, borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
          }>
          {novatos.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Nenhum novato no período filtrado.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Motorista', '1ª rota', 'Turno', 'Cluster', 'Rotas', 'DS', 'Início → agora', 'Evolução', 'Situação'].map(h => (
                    <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(n => {
                  const vals = n.routes.map(routeDs)
                  const delta = n.dsFirst !== null && n.dsLast !== null ? n.dsLast - n.dsFirst : null
                  return (
                    <Fragment key={n.driverId}>
                      <tr onClick={() => setDetail(n)} style={{ borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,.06)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{ color: C.text, fontWeight: 600 }}>{n.name}</span>
                          <span style={{ display: 'block', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{n.driverId} · {n.vehicle}</span>
                        </td>
                        <td style={{ padding: '7px 8px', color: C.sub, fontFamily: 'monospace' }}>{fmtDate(n.firstDate)}</td>
                        <td style={{ padding: '7px 8px' }}><span style={{ color: shiftColor(n.firstShift), fontWeight: 700 }}>{n.firstShift || '—'}</span></td>
                        <td style={{ padding: '7px 8px', color: C.sub, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.firstCluster || '—'}</td>
                        <td style={{ padding: '7px 8px', color: C.text, fontWeight: 700 }}>{n.routes.length}</td>
                        <td style={{ padding: '7px 8px', fontWeight: 800, color: dsColor(n.ds) }}>{pct(n.ds)}</td>
                        <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11 }}>
                          <span style={{ color: dsColor(n.dsFirst) }}>{pct(n.dsFirst)}</span>
                          {n.dsLast !== null && <> → <span style={{ color: dsColor(n.dsLast) }}>{pct(n.dsLast)}</span> <b style={{ color: delta! > 0.01 ? C.good : delta! < -0.01 ? C.bad : C.muted }}>{delta! > 0.01 ? '▲' : delta! < -0.01 ? '▼' : '='}</b></>}
                        </td>
                        <td style={{ padding: '7px 8px', width: 130 }}>
                          {/* mini DS rota a rota */}
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 22 }}>
                            {vals.slice(-20).map((v, i) => <div key={i} style={{ flex: 1, maxWidth: 6, height: v === null ? 2 : `${Math.max(8, ((v - 0.75) / 0.25) * 100)}%`, background: v === null ? C.line : dsColor(v), borderRadius: 1 }} />)}
                          </div>
                        </td>
                        <td style={{ padding: '7px 8px' }}>
                          {n.active
                            ? <span style={{ fontSize: 11, color: C.good, fontWeight: 600 }}>● rodando</span>
                            : <span style={{ fontSize: 11, color: C.warn, fontWeight: 600 }}>parado há {n.daysSinceLast}d</span>}
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ─── Ficha do novato ──────────────────────────────────────────────────────────
function NovatoFicha({ n, reg, novatos, vetDs, reportEnd, onClose }: {
  n: Novato; reg?: StoredDriver; novatos: Novato[]; vetDs: number | null; reportEnd: string; onClose: () => void
}) {
  const vals = n.routes.map(routeDs)
  const ds = vals.filter((v): v is number => v !== null)
  const daysIn = Math.round((Date.parse(reportEnd) - Date.parse(n.firstDate)) / 86400000) + 1
  const weeks = Math.max(1, daysIn / 7)
  const onTarget = ds.filter(v => v >= 0.95).length
  const sameDay = n.routes.filter(r => r.sameDay !== null)
  const sameDayPct = sameDay.length ? sameDay.filter(r => r.sameDay).length / sameDay.length : null
  const avgDelivered = avg(n.routes.map(r => r.delivered).filter((v): v is number => v !== null))
  const avgStops = avg(n.routes.map(r => r.stops).filter((v): v is number => v !== null))
  const novAvg = avg(novatos.map(x => x.ds).filter((v): v is number => v !== null))
  // Marco: primeira vez com 3 rotas seguidas na meta
  let streakAt: number | null = null
  for (let i = 2; i < vals.length; i++) if ([vals[i - 2], vals[i - 1], vals[i]].every(v => v !== null && v >= 0.95)) { streakAt = i + 1; break }
  const firstHit = vals.findIndex(v => v !== null && v >= 0.95)

  const group = (key: (r: RouteRecord) => string) => {
    const m = new Map<string, number[]>()
    for (const r of n.routes) { const k = key(r) || '—'; if (!m.has(k)) m.set(k, []); const v = routeDs(r); m.get(k)!.push(v ?? NaN) }
    return [...m.entries()].map(([k, l]) => ({ k, n: l.length, ds: avg(l.filter(v => !isNaN(v))) })).sort((a, b) => b.n - a.n)
  }
  const byShift = group(r => r.shift), byCluster = group(r => r.cluster), byVehicle = group(r => r.vehicle)

  // Rotas por semana desde o início (cadência)
  const weekly = (() => {
    const start = Date.parse(n.firstDate)
    const total = Math.ceil(daysIn / 7)
    const arr = Array.from({ length: total }, () => 0)
    for (const r of n.routes) { const w = Math.floor((Date.parse(r.date) - start) / (7 * 86400000)); if (w >= 0 && w < total) arr[w]++ }
    return arr
  })()
  const maxW = Math.max(1, ...weekly)

  const Kpi = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ margin: 0, fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: color ?? C.text, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 10, color: C.sub }}>{sub}</p>}
    </div>
  )
  const Breakdown = ({ title, rows }: { title: string; rows: { k: string; n: number; ds: number | null }[] }) => (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</p>
      {rows.slice(0, 6).map(r => (
        <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.k}>{r.k}</span>
          <span style={{ color: C.muted, fontSize: 11 }}>{r.n} rota{r.n !== 1 ? 's' : ''}</span>
          <span style={{ width: 52, textAlign: 'right', fontWeight: 700, color: dsColor(r.ds) }}>{pct(r.ds)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 980, maxHeight: '92vh', overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{n.name}</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: C.sub }}>
              <span style={{ fontFamily: 'monospace' }}>{n.driverId}</span> · {n.vehicle}{reg?.phoneNumber ? ` · ${reg.phoneNumber}` : ''}{reg?.agency ? ` · ${reg.agency}` : ''}
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, background: 'rgba(96,165,250,.12)', color: C.blue, borderRadius: 999, padding: '2px 9px' }}>1ª rota {fmtDate(n.firstDate)} · {n.firstShift}</span>
              <span style={{ fontSize: 11, background: 'rgba(148,163,184,.1)', color: C.sub, borderRadius: 999, padding: '2px 9px' }}>{daysIn} dias desde o início</span>
              {n.active
                ? <span style={{ fontSize: 11, background: 'rgba(74,222,128,.12)', color: C.good, borderRadius: 999, padding: '2px 9px' }}>● rodando</span>
                : <span style={{ fontSize: 11, background: 'rgba(251,191,36,.12)', color: C.warn, borderRadius: 999, padding: '2px 9px' }}>parado há {n.daysSinceLast} dias</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        {/* Números */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <Kpi label="Rotas" value={n.routes.length} sub={`${(n.routes.length / weeks).toFixed(1)} por semana`} />
          <Kpi label="DS geral" value={pct(n.ds)} color={dsColor(n.ds)} sub={`novatos ${pct(novAvg)} · veteranos ${pct(vetDs)}`} />
          <Kpi label="Início → agora" value={n.dsLast !== null ? `${pct(n.dsFirst, 0)} → ${pct(n.dsLast, 0)}` : pct(n.dsFirst)} color={n.dsLast !== null && n.dsFirst !== null ? (n.dsLast > n.dsFirst + 0.01 ? C.good : n.dsLast < n.dsFirst - 0.01 ? C.bad : C.text) : C.text} sub="5 primeiras × 5 últimas rotas" />
          <Kpi label="Rotas na meta" value={`${onTarget}/${ds.length}`} sub="DS ≥ 95%" />
          <Kpi label="Terminou no dia" value={sameDayPct === null ? '—' : `${Math.round(sameDayPct * 100)}%`} sub="das rotas" color={sameDayPct !== null && sameDayPct < 0.9 ? C.warn : C.text} />
          <Kpi label="Média por rota" value={avgDelivered === null ? '—' : Math.round(avgDelivered)} sub={`entregas · ${avgStops === null ? '—' : Math.round(avgStops)} paradas`} />
        </div>

        {/* Marcos */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.sub, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px' }}>
            🎯 1ª rota na meta: <b style={{ color: firstHit >= 0 ? C.good : C.warn }}>{firstHit >= 0 ? `${firstHit + 1}ª rota (${fmtDate(n.routes[firstHit].date)})` : 'ainda não'}</b>
          </span>
          <span style={{ fontSize: 12, color: C.sub, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px' }}>
            📈 3 rotas seguidas na meta: <b style={{ color: streakAt ? C.good : C.warn }}>{streakAt ? `a partir da ${streakAt}ª rota` : 'ainda não'}</b>
          </span>
        </div>

        {/* DS rota a rota */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.text }}>DS rota a rota <span style={{ fontWeight: 400, color: C.muted }}>· passe o mouse para ver cada rota</span></p>
          <RouteLine values={vals} height={150} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {/* Cadência */}
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
            <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em' }}>Rotas por semana desde o início</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
              {weekly.map((w, i) => (
                <div key={i} title={`${i + 1}ª semana: ${w} rota${w !== 1 ? 's' : ''}`} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${(w / maxW) * 100}%`, minHeight: w ? 3 : 1, background: w ? C.blue : C.line, borderRadius: '2px 2px 0 0' }} />
                </div>
              ))}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 10, color: C.muted }}>1ª semana → semana atual</p>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}><Breakdown title="Por turno" rows={byShift} /></div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}><Breakdown title="Por cluster" rows={byCluster} /></div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}><Breakdown title="Por veículo" rows={byVehicle} /></div>
        </div>

        {/* Todas as rotas */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.text }}>Todas as rotas ({n.routes.length})</p>
          <div style={{ overflow: 'auto', maxHeight: 300 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>{['#', 'Data', 'Turno', 'Cluster', 'Veículo', 'Entregues', 'Paradas', 'Performance', 'No mesmo dia', 'DS da rota'].map(h => <th key={h} style={{ position: 'sticky', top: 0, background: C.bg, padding: '4px 6px', textAlign: 'left', fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {n.routes.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '4px 6px', color: C.muted }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px', color: C.sub, fontFamily: 'monospace' }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: '4px 6px', color: shiftColor(r.shift), fontWeight: 700 }}>{r.shift}</td>
                    <td style={{ padding: '4px 6px', color: C.sub }}>{r.cluster}</td>
                    <td style={{ padding: '4px 6px', color: C.sub }}>{r.vehicle || '—'}</td>
                    <td style={{ padding: '4px 6px', color: C.text }}>{r.delivered ?? '—'}</td>
                    <td style={{ padding: '4px 6px', color: C.text }}>{r.stops ?? '—'}</td>
                    <td style={{ padding: '4px 6px', color: C.text }}>{pct(r.perf)}</td>
                    <td style={{ padding: '4px 6px', color: r.sameDay === false ? C.bad : C.sub }}>{r.sameDay === null ? '—' : r.sameDay ? 'sim' : 'não (×0,85)'}</td>
                    <td style={{ padding: '4px 6px', fontWeight: 800, color: dsColor(routeDs(r)) }}>{pct(routeDs(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
