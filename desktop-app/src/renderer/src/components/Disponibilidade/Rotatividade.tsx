import { useMemo, useState } from 'react'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import type { StoredDriver } from '../../lib/localStore'
import type { DriverResult } from '../../lib/types'
import type { CallUpAnalysis } from '../../lib/callUpParser'
import type { ForwardOrderAnalysis } from '../../lib/forwardOrderParser'
import { getGlobalConfig } from '../../lib/globalConfig'
import { calculatePriorityScore, declineRatePercent } from '../../lib/priorityScore'
import { firstCallDay } from '../../lib/callUpParser'
import { loadRouteHistory, routeDs, routeRevenue, rateFor, brl } from '../../lib/routeHistory'
import type { DriverAvailability } from '../../lib/workPreferenceParser'

// Rotatividade: quem roda muito e quem roda pouco no período do Call Up, e se há motivo para isso.
// Sem disponibilidade retroativa, a base é só a quantidade de rotas: total de rotas do período ÷ motoristas
// da base = quantas rotas cada um faria se fossem divididas igualmente. A base é
// quem rodou no período mais os novatos do Work Preference.

const C = {
  panel: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b',
  good: '#4ade80', warn: '#fbbf24', bad: '#f87171', blue: '#60a5fa', violet: '#a78bfa', orange: '#fb923c',
}

type Level = 'muito' | 'normal' | 'pouco'
interface Reason { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }
interface Row {
  driverId: string; name: string; vehicle: string; novato: boolean; ds: number | null; score: number
  routes: number; days: number; ratio: number; level: Level
  declineRate: number; noShow: number; blocked: boolean; reasons: Reason[]; explained: boolean
}

const vehicleOf = (v: string | null | undefined) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return v?.trim() ? v.trim().toUpperCase() : 'SEM VEÍCULO'
}
const TONE: Record<Reason['tone'], string> = { ok: C.good, warn: C.warn, bad: C.bad, info: C.blue }
// Agrupa os motivos (que têm números no texto) em categorias para o resumo
function reasonCat(label: string): string {
  const l = label.toLowerCase()
  if (l.startsWith('fiorino')) return 'Fiorino (prioridade)'
  if (l.startsWith('veículo com muita')) return 'Veículo com muita rota'
  if (l.startsWith('veículo com pouca')) return 'Veículo com pouca rota'
  if (l.startsWith('ds baixo')) return 'DS abaixo de 95%'
  if (l.startsWith('ds ')) return 'DS'
  if (l.startsWith('score')) return 'Score alto'
  if (l.startsWith('novato')) return 'Novato (em processo)'
  if (l.startsWith('bloqueado')) return 'Bloqueado'
  if (l.startsWith('recusa')) return 'Recusa muitas chamadas'
  if (l.includes('no-show')) return 'No-show'
  if (l.startsWith('não foi chamado')) return 'Não chamado no Call Up'
  if (l.startsWith('fora da disponibilidade')) return 'Fora da disponibilidade atual'
  return 'Sem motivo aparente'
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

function Panel({ title, sub, children, style }: { title: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', minWidth: 0, ...style }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sub}</p>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}

export default function Rotatividade({ data, registry, dsDrivers, callUp, forwardOrder, selectedDay }: {
  data: WorkPreferenceData; registry: StoredDriver[]; dsDrivers: DriverResult[]; callUp: CallUpAnalysis | null; forwardOrder: ForwardOrderAnalysis | null; selectedDay: string
}) {
  const [onlyUnexplained, setOnlyUnexplained] = useState(false)
  const [vehicleSel, setVehicleSel] = useState<string>('')
  const [detail, setDetail] = useState<Row | null>(null)
  // Período da análise: todos os motoristas são comparados dentro da mesma janela
  const allDates = useMemo(() => [...new Set(Object.keys(callUp?.acceptedByDateShift ?? {}).map(k => k.split('|')[0]))].sort(), [callUp])
  const lastDate = allDates[allDates.length - 1] ?? ''
  const shiftDate = (d: string, days: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + days); return x.toISOString().slice(0, 10) }
  const [from, setFrom] = useState(() => (lastDate ? shiftDate(lastDate, -29) : ''))
  const [to, setTo] = useState(() => lastDate)

  const a = useMemo(() => {
    if (!callUp) return null
    // Dias do período: os que têm rota aceita no Call Up
    const routesByDriver = new Map<string, number>()
    const routesByDate = new Map<string, number>()
    const datesWithRoute = new Map<string, Set<string>>() // driver → dias em que rodou
    for (const [key, ids] of Object.entries(callUp.acceptedByDateShift)) {
      const date = key.split('|')[0]
      if ((from && date < from) || (to && date > to)) continue
      routesByDate.set(date, (routesByDate.get(date) ?? 0) + ids.length)
      for (const id of ids) {
        routesByDriver.set(id, (routesByDriver.get(id) ?? 0) + 1)
        if (!datesWithRoute.has(id)) datesWithRoute.set(id, new Set())
        datesWithRoute.get(id)!.add(date)
      }
    }
    const dates = [...routesByDate.keys()].sort()
    if (dates.length === 0) return null

    // Motoristas distintos que rodaram em cada dia
    const driversByDate = new Map<string, number>()
    for (const date of dates) driversByDate.set(date, 0)
    for (const set of datesWithRoute.values()) for (const date of set) driversByDate.set(date, (driversByDate.get(date) ?? 0) + 1)
    const totalRoutes = [...routesByDate.values()].reduce((x, y) => x + y, 0)

    const regMap = new Map(registry.map(r => [r.id, r]))
    const wpMap = new Map(data.drivers.map(d => [d.driverId, d]))
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const cuMap = new Map(callUp.byDriver.map(d => [d.driverId, d]))
    const fwdMap = new Map((forwardOrder?.allDrivers ?? []).map(d => [d.driverId, d.totalPackages]))
    let manual = new Set<string>()
    try { manual = new Set((JSON.parse(localStorage.getItem('spx:noshow-manual-blocks') ?? '[]') as { driverId: string }[]).map(b => b.driverId)) } catch { /* */ }
    const cfg = getGlobalConfig()

    // Base: quem rodou no período + quem o Work Preference marca como novato.
    // Cadastrado que nunca rodou (e não é novato) fica de fora: normalmente é quem não tem interesse.
    // Novato só entra se estiver disponível no dia selecionado (a planilha marca muitos como novatos).
    const pool = new Set<string>([...routesByDriver.keys(), ...data.drivers.filter(d => d.isNewDriver && d.schedule[selectedDay]?.status === 'available').map(d => d.driverId)])
    const expectedRoutes = pool.size ? totalRoutes / pool.size : 0

    const base = [...pool].map(id => {
      const wp = wpMap.get(id), reg = regMap.get(id), cu = cuMap.get(id)
      return {
        id, wp, reg, cu,
        name: wp?.driverName || reg?.name || cu?.driverName || id,
        routes: routesByDriver.get(id) ?? 0,
        days: datesWithRoute.get(id)?.size ?? 0,
        vehicle: vehicleOf(reg?.vehicleType || wp?.vehicleType), // vale o cadastro do motorista
      }
    })

    // Rotas por motorista em cada tipo de veículo (mostra se o veículo tem pouca rota)
    const byVehicle = new Map<string, { drivers: number; routes: number }>()
    for (const x of base) {
      const g = byVehicle.get(x.vehicle) ?? { drivers: 0, routes: 0 }
      g.drivers++; g.routes += x.routes
      byVehicle.set(x.vehicle, g)
    }
    const vehAvg = (v: string) => { const g = byVehicle.get(v); return g && g.drivers ? g.routes / g.drivers : 0 }

    const rows: Row[] = base.map(({ id, wp, reg, cu, name, routes, days, vehicle }) => {
      const dsReal = dsMap.get(id)?.DS_Real ?? null
      const dr = declineRatePercent(cu)
      const noShow = wp?.noShowTime ?? 0
      const novato = wp?.isNewDriver ?? false
      const score = calculatePriorityScore(dsReal !== null ? dsReal * 100 : 50, dr, noShow, cfg.scoreWeights)
      const blocked = !!reg?.spxBlocklisted || manual.has(id) || (fwdMap.get(id) ?? 0) > 5
      const ratio = expectedRoutes > 0 ? routes / expectedRoutes : 0
      const level: Level = ratio >= 1.5 ? 'muito' : ratio <= 0.5 ? 'pouco' : 'normal'
      const reasons: Reason[] = []
      let explained = level === 'normal'
      const va = vehAvg(vehicle)
      const vaLabel = `${vehicle}: ${va.toFixed(1)} rotas por motorista`
      if (level === 'muito') {
        if (vehicle === 'FIORINO') { reasons.push({ label: 'Fiorino tem prioridade', tone: 'ok' }); explained = true }
        if (vehicle !== 'FIORINO' && va >= expectedRoutes * 1.3) { reasons.push({ label: `veículo com muita rota (${vaLabel})`, tone: 'ok' }); explained = true }
        if (dsReal !== null && dsReal >= 0.95) { reasons.push({ label: `DS ${(dsReal * 100).toFixed(1)}%`, tone: 'ok' }); explained = true }
        if (score >= 70) { reasons.push({ label: `score alto (${Math.round(score)})`, tone: 'ok' }); explained = true }
        if (dsReal !== null && dsReal < 0.95) reasons.push({ label: `DS baixo ${(dsReal * 100).toFixed(1)}%`, tone: 'bad' })
        if (!explained) reasons.push({ label: 'sem motivo aparente', tone: 'bad' })
      } else if (level === 'pouco') {
        if (novato) { reasons.push({ label: 'novato (em processo)', tone: 'info' }); explained = true }
        if (blocked) { reasons.push({ label: 'bloqueado', tone: 'warn' }); explained = true }
        if (dsReal !== null && dsReal < 0.95) { reasons.push({ label: `DS ${(dsReal * 100).toFixed(1)}%`, tone: 'warn' }); explained = true }
        if (dr >= 30) { reasons.push({ label: `recusa ${Math.round(dr)}% das chamadas`, tone: 'warn' }); explained = true }
        if (noShow > 0) { reasons.push({ label: `${noShow} no-show`, tone: 'warn' }); explained = true }
        if (va <= expectedRoutes * 0.7) { reasons.push({ label: `veículo com pouca rota (${vaLabel})`, tone: 'info' }); explained = true }
        if (!cu || cu.total === 0) { reasons.push({ label: 'não foi chamado no Call Up', tone: 'info' }); explained = true }
        if (!wp) { reasons.push({ label: 'fora da disponibilidade atual', tone: 'info' }); explained = true }
        if (!explained) reasons.push({ label: score >= 70 ? `alta prioridade (${Math.round(score)}) e não roda` : 'sem motivo aparente', tone: 'bad' })
      }
      return { driverId: id, name, vehicle, novato, ds: dsReal, score, routes, days, ratio, level, declineRate: dr, noShow, blocked, reasons, explained }
    })

    return {
      dates, routesByDate, driversByDate, totalRoutes, rows, expectedRoutes, poolSize: pool.size,
      ranDrivers: routesByDriver.size,
      avgRoutes: totalRoutes / dates.length,
      byVehicle: [...byVehicle.entries()].map(([v, g]) => ({ v, ...g, avg: g.drivers ? g.routes / g.drivers : 0 })).sort((x, y) => y.drivers - x.drivers),
    }
  }, [data, registry, dsDrivers, callUp, forwardOrder, selectedDay, from, to])

  if (!callUp) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>Importe o Call Up para ver a rotatividade — é dele que saem as rotas aceitas por motorista.</div>
  const periodBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Período da análise</span>
      {([['7 dias', 7], ['15 dias', 15], ['30 dias', 30], ['60 dias', 60], ['Tudo', 0]] as [string, number][]).map(([l, n]) => {
        const f = n ? shiftDate(lastDate, -(n - 1)) : allDates[0]
        const active = from === f && to === lastDate
        return <button key={l} onClick={() => { setFrom(f); setTo(lastDate) }} style={{ background: active ? 'rgba(124,58,237,.2)' : 'transparent', color: active ? '#c4b5fd' : C.sub, border: `1px solid ${active ? '#7c3aed' : C.border}`, borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' }}>{l}</button>
      })}
      <input type="date" value={from} min={allDates[0]} max={to} onChange={e => setFrom(e.target.value)} style={{ background: '#0f1117', border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12, colorScheme: 'dark' }} />
      <span style={{ fontSize: 11, color: C.muted }}>até</span>
      <input type="date" value={to} min={from} max={lastDate} onChange={e => setTo(e.target.value)} style={{ background: '#0f1117', border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12, colorScheme: 'dark' }} />
      <span style={{ fontSize: 11, color: C.muted }}>Todos os motoristas são comparados dentro deste mesmo período · Call Up vai de {allDates[0] ? fmtDate(allDates[0]) : '—'} a {lastDate ? fmtDate(lastDate) : '—'}</span>
    </div>
  )
  if (!a) return <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>{periodBar}<p style={{ margin: 0, textAlign: 'center', color: C.muted, fontSize: 13 }}>Sem rotas aceitas no período escolhido.</p></div>

  const muito = a.rows.filter(r => r.level === 'muito')
  const pouco = a.rows.filter(r => r.level === 'pouco')
  const show = (l: Row[]) => l.filter(r => (!onlyUnexplained || !r.explained) && (!vehicleSel || r.vehicle === vehicleSel))
  const unexplained = [...muito, ...pouco].filter(r => !r.explained).length
  const maxDay = Math.max(1, ...a.dates.map(d => a.routesByDate.get(d) ?? 0))
  const maxVeh = Math.max(a.expectedRoutes, ...a.byVehicle.map(g => g.avg), 1)

  const list = (title: string, sub: string, color: string, rows: Row[]) => (
    <Panel title={title} sub={sub} style={{ borderTop: `3px solid ${color}` }}>
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Ninguém aqui{onlyUnexplained ? ' sem explicação' : ''}.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflow: 'auto' }}>
          {rows.sort((x, y) => Number(x.explained) - Number(y.explained) || (title.includes('muito') ? y.ratio - x.ratio : x.ratio - y.ratio)).map(r => (
            <div key={r.driverId} onClick={() => setDetail(r)} title="Ver as rotas deste motorista"
              style={{ padding: '8px 4px', borderBottom: `1px solid ${C.line}`, background: r.explained ? 'transparent' : 'rgba(239,68,68,.05)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{r.name}</span>
                  {r.novato && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(96,165,250,.15)', color: C.blue, borderRadius: 3, padding: '1px 5px' }}>NOVATO</span>}
                  <span style={{ display: 'block', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.driverId} · {r.vehicle} · DS {r.ds !== null ? `${(r.ds * 100).toFixed(1)}%` : '—'} · score {Math.round(r.score)}</span>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color }}>{r.routes}</span>
                  <span style={{ fontSize: 11, color: C.muted }}> rotas em {a.dates.length} dia{a.dates.length !== 1 ? 's' : ''}</span>
                  <span style={{ display: 'block', fontSize: 10, color: C.sub }}>em {r.days} dia{r.days !== 1 ? 's' : ''} diferente{r.days !== 1 ? 's' : ''}{r.routes > r.days ? ` (${r.routes - r.days} dobra${r.routes - r.days !== 1 ? 's' : ''})` : ''}</span>
                  <span style={{ display: 'block', fontSize: 10, color: C.sub }}>{r.ratio.toFixed(1)}× a média de {a.expectedRoutes.toFixed(1)} rotas por motorista</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {r.reasons.map(x => <span key={x.label} style={{ fontSize: 10, fontWeight: 600, color: TONE[x.tone], background: `${TONE[x.tone]}17`, border: `1px solid ${TONE[x.tone]}40`, borderRadius: 4, padding: '1px 6px' }}>{x.label}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 80px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {periodBar}
      {detail && callUp && <DriverRoutesModal row={detail} reg={registry.find(x => x.id === detail.driverId)} wp={data.drivers.find(x => x.driverId === detail.driverId)} callUp={callUp} from={from} to={to} onClose={() => setDetail(null)} />}

      {/* Veredito: os extremos se justificam? */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 14 }}>
        {([['muito', '🔁 Quem roda muito', muito, C.orange], ['pouco', '💤 Quem roda pouco', pouco, C.blue]] as const).map(([lvl, title, rows, color]) => {
          const ok = rows.filter(r => r.explained).length
          const bad = rows.length - ok
          const share = rows.length ? ok / rows.length : 1
          const verdict = rows.length === 0 ? 'Ninguém neste grupo' : bad === 0 ? 'Todos justificados' : share >= 0.8 ? 'Quase todos justificados' : share >= 0.5 ? 'Parte sem justificativa' : 'Maioria sem justificativa'
          const vColor = rows.length === 0 || bad === 0 ? C.good : share >= 0.8 ? C.warn : C.bad
          // Motivo de cada um (o primeiro que justifica); conta por categoria
          const cats = new Map<string, number>()
          for (const r of rows) {
            if (!r.explained) continue
            const firstOk = r.reasons.find(x => reasonCat(x.label) !== 'Sem motivo aparente' && reasonCat(x.label) !== 'DS abaixo de 95%') ?? r.reasons[0]
            const raw = reasonCat(firstOk.label)
            const c = raw === 'DS' ? (lvl === 'muito' ? 'DS alto (≥ 95%)' : 'DS abaixo de 95%') : raw
            cats.set(c, (cats.get(c) ?? 0) + 1)
          }
          const catList = [...cats.entries()].sort((x, y) => y[1] - x[1])
          const r0 = 48, circ = 2 * Math.PI * r0
          return (
            <div key={lvl} style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 18, alignItems: 'center', minWidth: 0 }}>
              <div style={{ position: 'relative', width: 116, height: 116, flexShrink: 0 }}>
                <svg width={116} height={116} viewBox="0 0 116 116">
                  <circle cx={58} cy={58} r={r0} fill="none" stroke={rows.length ? 'rgba(248,113,113,.55)' : '#1e2130'} strokeWidth={8} />
                  {rows.length > 0 && <circle cx={58} cy={58} r={r0} fill="none" stroke={C.good} strokeWidth={8} strokeLinecap={share < 1 ? 'round' : 'butt'} strokeDasharray={`${share * circ} ${circ}`} transform="rotate(-90 58 58)" />}
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>{rows.length ? `${Math.round(share * 100)}%` : '—'}</span>
                  <span style={{ fontSize: 10, color: C.sub }}>{ok} de {rows.length}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>justificados</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title} <span style={{ color: C.muted, fontWeight: 400 }}>({rows.length})</span></p>
                <p style={{ margin: '2px 0 8px', fontSize: 15, fontWeight: 800, color: vColor }}>{rows.length > 0 && bad === 0 ? '✓ ' : bad > 0 ? '⚠ ' : ''}{verdict}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {catList.map(([c, n]) => <span key={c} style={{ fontSize: 11, color: C.sub, background: '#0f1117', border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 9px' }}>{c} <b style={{ color: C.text }}>{n}</b></span>)}
                  {bad > 0 && (
                    <button onClick={() => setOnlyUnexplained(true)} title="Mostrar só os sem justificativa"
                      style={{ fontSize: 11, color: C.bad, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 999, padding: '2px 9px', cursor: 'pointer', fontWeight: 700 }}>
                      sem motivo {bad} →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Contexto: dá para todo mundo rodar? */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {[
          { label: 'Período analisado', value: `${a.dates.length} dias`, sub: `${fmtDate(a.dates[0])} a ${fmtDate(a.dates[a.dates.length - 1])}`, c: C.blue },
          { label: 'Rotas no período', value: a.totalRoutes, sub: `${Math.round(a.avgRoutes)} por dia`, c: C.blue },
          { label: 'Base de motoristas', value: a.poolSize, sub: `${a.ranDrivers} rodaram no período + ${a.poolSize - a.ranDrivers} novatos disponíveis em ${fmtDate(selectedDay)} sem rota`, c: C.violet },
          { label: 'Rotas por motorista', value: a.expectedRoutes.toFixed(1), sub: `se dividir igual · ≈ ${(a.expectedRoutes / a.dates.length * 7).toFixed(1)} por semana`, c: C.good },
          { label: 'Fora da curva sem motivo', value: unexplained, sub: `${muito.length} rodam muito · ${pouco.length} rodam pouco`, c: unexplained ? C.bad : C.good },
        ].map(k => (
          <div key={k.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <p style={{ margin: 0, fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
            <p style={{ margin: '6px 0 2px', fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1 }}>{k.value}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.sub }}>{k.sub}</p>
            <div style={{ height: 3, width: 28, background: k.c, borderRadius: 2, marginTop: 8 }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
        <Panel title="Rotas por dia" sub={`Barra = rotas aceitas · número em cima = motoristas diferentes que rodaram · base de ${a.poolSize} motoristas`}>
          <div style={{ display: 'flex', gap: a.dates.length > 30 ? 1 : 3, height: 150, overflow: 'hidden' }}>
            {a.dates.map(d => {
              const r = a.routesByDate.get(d) ?? 0, dr = a.driversByDate.get(d) ?? 0
              return (
                <div key={d} title={`${fmtDate(d)}: ${r} rotas · ${dr} motoristas (${fmtPct(a.poolSize ? dr / a.poolSize : 0)} da base)`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ height: 14, fontSize: 9, color: C.sub, lineHeight: '14px', overflow: 'hidden' }}>{a.dates.length <= 20 ? dr : ''}</span>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{ width: '70%', maxWidth: 22, height: `${(r / maxDay) * 100}%`, background: C.blue, borderRadius: '3px 3px 0 0' }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: a.dates.length > 30 ? 1 : 3, marginTop: 4, overflow: 'hidden' }}>
            {a.dates.map((d, i) => {
              const step = Math.ceil(a.dates.length / 10)
              return <span key={d} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 9, color: C.muted, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'visible' }}>{i % step === 0 ? fmtDate(d) : ''}</span>
            })}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: C.sub }}>Em média rodam {Math.round(a.avgRoutes)} por dia de uma base de {a.poolSize}: cerca de {fmtPct(a.poolSize ? a.avgRoutes / a.poolSize : 0)} da base por dia.</p>
        </Panel>

        <Panel title="Uso por tipo de veículo" sub={`Rotas por motorista em cada veículo · média geral ${a.expectedRoutes.toFixed(1)} (tracejado). Clique para filtrar.`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.byVehicle.map(g => (
              <button key={g.v} onClick={() => setVehicleSel(vehicleSel === g.v ? '' : g.v)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: vehicleSel === g.v ? 'rgba(124,58,237,.15)' : 'transparent', border: `1px solid ${vehicleSel === g.v ? '#7c3aed' : 'transparent'}`, borderRadius: 6, padding: '3px 4px', cursor: 'pointer' }}>
                <span style={{ width: 92, flexShrink: 0, textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.v}</span>
                <div style={{ flex: 1, minWidth: 40, height: 10, background: '#0f1117', borderRadius: 5, position: 'relative' }}>
                  <div style={{ width: `${(g.avg / maxVeh) * 100}%`, height: '100%', background: g.avg >= a.expectedRoutes * 1.3 ? C.good : g.avg <= a.expectedRoutes * 0.7 ? C.warn : C.blue, borderRadius: 5 }} />
                  <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(a.expectedRoutes / maxVeh) * 100}%`, borderLeft: `1px dashed ${C.sub}` }} />
                </div>
                <span style={{ width: 110, flexShrink: 0, textAlign: 'right', fontSize: 11, color: C.sub }}>{g.avg.toFixed(1)} rotas · {g.drivers} mot.</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyUnexplained} onChange={e => setOnlyUnexplained(e.target.checked)} /> Só quem está fora da curva <b style={{ color: C.bad }}>sem motivo aparente</b>
        </label>
        {vehicleSel && <button onClick={() => setVehicleSel('')} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 12, cursor: 'pointer' }}>✕ veículo: {vehicleSel}</button>}
        <span style={{ fontSize: 11, color: C.muted }}>“Roda muito” = 1,5× ou mais as rotas por motorista · “roda pouco” = metade ou menos (inclui quem não rodou nenhuma).</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 14 }}>
        {list(`🔁 Rodam muito (${show(muito).length})`, 'Motivos esperados: Fiorino (prioridade), DS alto, score alto, veículo com muita rota', C.orange, show(muito))}
        {list(`💤 Rodam pouco (${show(pouco).length})`, 'Motivos esperados: novato, bloqueio, DS baixo, recusa, no-show, veículo com pouca rota', C.blue, show(pouco))}
      </div>
    </div>
  )
}

// ─── Rotas de um motorista no período ────────────────────────────────────────
const SHIFT_COLOR: Record<string, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#a78bfa' }
const STATUS_PT: Record<string, { label: string; color: string }> = {
  Accepted: { label: 'Aceitou', color: C.good }, Declined: { label: 'Recusou', color: C.bad },
  Cancelled: { label: 'Cancelada', color: C.muted }, Pending: { label: 'Sem resposta', color: C.warn },
}
const pctTxt = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)

function DriverRoutesModal({ row, reg, wp, callUp, from, to, onClose }: {
  row: Row; reg?: StoredDriver; wp?: DriverAvailability; callUp: CallUpAnalysis; from: string; to: string; onClose: () => void
}) {
  const id = row.driverId
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to)
  // Turnos rodados por dia (Call Up, rotas aceitas)
  const days = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [k, ids] of Object.entries(callUp.acceptedByDateShift)) {
      const [date, shift] = k.split('|')
      if (!inRange(date) || !ids.includes(id)) continue
      m.set(date, [...(m.get(date) ?? []), shift].sort())
    }
    return m
  }, [callUp, id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const calls = useMemo(() => callUp.firstCallAnalysis.routes.filter(r => r.driverId === id && inRange(firstCallDay(r)))
    .sort((a, b) => b.triggerTime.localeCompare(a.triggerTime)), [callUp, id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => loadRouteHistory().filter(r => r.driverId === id && inRange(r.date)).sort((a, b) => b.date.localeCompare(a.date) || b.shift.localeCompare(a.shift)), [id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calendário do período
  const allDays: string[] = []
  if (from && to) { const d = new Date(`${from}T12:00:00`); while (d.toISOString().slice(0, 10) <= to) { allDays.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) } }
  const shiftCount = new Map<string, number>()
  for (const l of days.values()) for (const s2 of l) shiftCount.set(s2, (shiftCount.get(s2) ?? 0) + 1)
  const clusterCount = new Map<string, number>()
  for (const r of results) clusterCount.set(r.cluster || '—', (clusterCount.get(r.cluster || '—') ?? 0) + 1)
  if (!results.length) for (const c of calls.filter(c => (c.finalStatus ?? c.status) === 'Accepted')) clusterCount.set(c.cluster || '—', (clusterCount.get(c.cluster || '—') ?? 0) + 1)
  const dsVals = results.map(routeDs).filter((v): v is number => v !== null)
  const dsAvg = dsVals.length ? dsVals.reduce((a, b) => a + b, 0) / dsVals.length : null
  const declined = calls.filter(c => c.status === 'Declined')
  const reasons = new Map<string, number>()
  for (const c of declined) if (c.declineReason) reasons.set(c.declineReason, (reasons.get(c.declineReason) ?? 0) + 1)
  const totalRoutes = [...days.values()].reduce((a, l) => a + l.length, 0)
  // Faturamento estimado: entregues × R$/pacote + km × R$/km, pelo veículo do cadastro do motorista
  const cadVehicle = reg?.vehicleType || row.vehicle
  const revs = results.map(r => routeRevenue(r, cadVehicle)).filter((v): v is number => v !== null)
  const revTotal = revs.reduce((a, b) => a + b, 0)
  const revDays = new Set(results.filter(r => routeRevenue(r, cadVehicle) !== null).map(r => r.date)).size
  const noKm = results.some(r => r.km === null)
  const rate = rateFor(cadVehicle)
  const weekday = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

  const Kpi = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div style={{ background: '#0f1117', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ margin: 0, fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: color ?? C.text, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 10, color: C.sub }}>{sub}</p>}
    </div>
  )
  const box: React.CSSProperties = { background: '#0f1117', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', minWidth: 0 }
  const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#0f1117', padding: '4px 6px', textAlign: 'left', fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '4px 6px', color: C.sub, whiteSpace: 'nowrap' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 1000, maxHeight: '92vh', overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{row.name}{row.novato && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(96,165,250,.15)', color: C.blue, borderRadius: 4, padding: '2px 6px', verticalAlign: 'middle' }}>NOVATO</span>}</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: C.sub }}>
              <span style={{ fontFamily: 'monospace' }}>{id}</span> · {row.vehicle}{reg?.phoneNumber ? ` · ${reg.phoneNumber}` : ''}{reg?.agency ? ` · ${reg.agency}` : ''}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: C.muted }}>
              {from && to ? `${from.slice(8, 10)}/${from.slice(5, 7)} a ${to.slice(8, 10)}/${to.slice(5, 7)}` : ''}{wp?.clusters?.length ? ` · clusters: ${wp.clusters.join(', ')}` : ''}
            </p>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {row.reasons.map(x => <span key={x.label} style={{ fontSize: 10, fontWeight: 600, color: TONE[x.tone], background: `${TONE[x.tone]}17`, border: `1px solid ${TONE[x.tone]}40`, borderRadius: 4, padding: '1px 6px' }}>{x.label}</span>)}
            </div>
          </div>
          <button onClick={onClose} style={{ alignSelf: 'flex-start', background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <Kpi label="Rotas (Call Up)" value={totalRoutes} sub={`em ${days.size} dias · ${Math.max(0, totalRoutes - days.size)} dobras`} />
          <Kpi label="Média do período" value={`${row.ratio.toFixed(1)}×`} sub="rotas vs média por motorista" color={row.level === 'muito' ? C.orange : row.level === 'pouco' ? C.blue : C.text} />
          <Kpi label="Por turno" value={[...shiftCount.entries()].map(([k, n]) => `${k} ${n}`).join(' · ') || '—'} />
          <Kpi label="DS nas rotas" value={pctTxt(dsAvg)} color={dsAvg === null ? C.muted : dsAvg >= 0.95 ? C.good : C.bad} sub={`DS geral ${pctTxt(row.ds)} · score ${Math.round(row.score)}`} />
          <Kpi label="Faturamento estimado" value={revs.length ? brl(revTotal) : '—'} color={C.good}
            sub={revs.length ? `${brl(revTotal / revs.length)} por rota · ${brl(revTotal / Math.max(1, revDays))} por dia rodado` : 'sem rotas no relatório de resultados'} />
          <Kpi label="Chamadas" value={calls.length} sub={`${declined.length} recusadas · ${row.noShow} no-show`} color={declined.length && declined.length / Math.max(1, calls.length) >= 0.3 ? C.warn : C.text} />
        </div>

        {/* Quando rodou */}
        <div style={box}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em' }}>Quando rodou</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))', gap: 4 }}>
            {allDays.map(d => {
              const sh = days.get(d) ?? []
              const wd = new Date(`${d}T12:00:00`).getDay()
              return (
                <div key={d} title={`${d.slice(8, 10)}/${d.slice(5, 7)}: ${sh.length ? sh.join(' + ') : 'não rodou'}`}
                  style={{ border: `1px solid ${sh.length ? C.border : C.line}`, background: sh.length ? '#13151f' : 'transparent', borderRadius: 6, padding: '3px 2px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: wd === 0 ? C.bad : C.muted }}>{weekday[wd]} {d.slice(8, 10)}</div>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2, minHeight: 10 }}>
                    {sh.map(x => <span key={x} style={{ fontSize: 8, fontWeight: 800, color: '#0f1117', background: SHIFT_COLOR[x] ?? C.sub, borderRadius: 3, padding: '0 3px' }}>{x}</span>)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div style={box}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em' }}>Onde rodou</p>
            {[...clusterCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => (
              <div key={c} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}><span style={{ color: C.text }}>{c}</span><span style={{ color: C.muted }}>{n}</span></div>
            ))}
            {clusterCount.size === 0 && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>—</p>}
          </div>
          <div style={box}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em' }}>Motivos de recusa</p>
            {reasons.size === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{declined.length ? 'sem motivo informado' : 'Não recusou no período'}</p>
              : [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                <div key={r} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '2px 0' }}><span style={{ color: C.text }}>{r}</span><span style={{ color: C.muted }}>{n}</span></div>
              ))}
          </div>
        </div>

        {/* Como rodou: relatório de resultados */}
        <div style={box}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.text }}>Como rodou <span style={{ fontWeight: 400, color: C.muted }}>· relatório de resultados ({results.length} rotas){rate ? ` · ${cadVehicle} (cadastro): R$ ${rate.pkg.toFixed(2).replace('.', ',')}/pacote + R$ ${rate.km.toFixed(2).replace('.', ',')}/km` : ''}</span></p>
          {noKm && results.length > 0 && <p style={{ margin: '0 0 6px', fontSize: 11, color: C.warn }}>⚠ Parte das rotas está sem km (relatório importado antes desta versão): o faturamento delas conta só os pacotes. Importe o relatório de resultados de novo.</p>}
          {results.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Sem rotas deste período no relatório de resultados importado (importe o relatório mais recente em Uploads).</p> : (
            <div style={{ overflow: 'auto', maxHeight: 260 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>{['Data', 'Turno', 'Cluster', 'Veículo', 'Entregues', 'Paradas', 'Km', 'Performance', 'No mesmo dia', 'DS da rota', 'Faturamento'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {results.map((r, i) => {
                    const v = routeDs(r)
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ ...td, fontFamily: 'monospace' }}>{r.date.slice(8, 10)}/{r.date.slice(5, 7)}</td>
                        <td style={{ ...td, color: SHIFT_COLOR[r.shift] ?? C.sub, fontWeight: 700 }}>{r.shift}</td>
                        <td style={td}>{r.cluster}</td>
                        <td style={td}>{r.vehicle || '—'}</td>
                        <td style={{ ...td, color: C.text }}>{r.delivered ?? '—'}</td>
                        <td style={{ ...td, color: C.text }}>{r.stops ?? '—'}</td>
                        <td style={{ ...td, color: C.text }}>{r.km === null ? '—' : r.km.toFixed(1)}</td>
                        <td style={{ ...td, color: C.text }}>{pctTxt(r.perf)}</td>
                        <td style={{ ...td, color: r.sameDay === false ? C.bad : C.sub }}>{r.sameDay === null ? '—' : r.sameDay ? 'sim' : 'não'}</td>
                        <td style={{ ...td, fontWeight: 800, color: v === null ? C.muted : v >= 0.95 ? C.good : C.bad }}>{pctTxt(v)}</td>
                        <td style={{ ...td, color: C.good, fontWeight: 700 }}>{(() => { const rv = routeRevenue(r, cadVehicle); return rv === null ? '—' : brl(rv) })()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Chamadas do Call Up */}
        <div style={box}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.text }}>Chamadas do Call Up <span style={{ fontWeight: 400, color: C.muted }}>· 1ª chamada de cada rota ({calls.length})</span></p>
          {calls.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Não foi chamado no período.</p> : (
            <div style={{ overflow: 'auto', maxHeight: 260 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>{['Chamado em', 'Dia da rota', 'Turno', 'AT', 'Cluster', 'Resposta', 'Situação final', 'Motivo'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {calls.map((c, i) => {
                    const st = STATUS_PT[c.status] ?? { label: c.status, color: C.sub }
                    const fin = STATUS_PT[c.finalStatus ?? c.status] ?? st
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ ...td, fontFamily: 'monospace' }}>{c.triggerTime}</td>
                        <td style={{ ...td, fontFamily: 'monospace' }}>{firstCallDay(c).slice(8, 10)}/{firstCallDay(c).slice(5, 7)}</td>
                        <td style={{ ...td, color: SHIFT_COLOR[c.shift ?? ''] ?? C.sub, fontWeight: 700 }}>{c.shift ?? '—'}</td>
                        <td style={{ ...td, fontFamily: 'monospace', color: C.text }}>{c.atId}</td>
                        <td style={td}>{c.cluster}</td>
                        <td style={{ ...td, color: st.color, fontWeight: 700 }}>{st.label}</td>
                        <td style={{ ...td, color: fin.color }}>{fin.label}</td>
                        <td style={{ ...td, whiteSpace: 'normal' }}>{c.declineReason ?? ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
