import { useMemo, useState } from 'react'
import type { Shift } from '../../lib/globalConfig'
import { DateRangePicker } from './index'
import { firstCallDay, isAcceptedInCallUp, type CallUpAnalysis, type FirstCallRoute } from '../../lib/callUpParser'

// Dashboard do indicador de Call Up: aceite na 1ª chamada (uma linha por AT, a 1ª chamada dela).

const C = { bg: '#0f1117', card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', green: '#4ade80', red: '#f87171', amber: '#fbbf24', blue: '#60a5fa', violet: '#a78bfa' }
const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#f472b6' }
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const META_KEY = 'ui:callup-meta'
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTH = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1] ?? ym.slice(5, 7)}/${ym.slice(2, 4)}`

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0)
const rateColor = (p: number, meta: number) => (p >= meta ? C.green : p >= meta - 10 ? C.amber : C.red)
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
/** Hora do disparo: aceita "2026-11-04 05:31:10" ou "04/11/2026 05:31" */
const hourOf = (t: string) => { const m = t.match(/(\d{1,2}):\d{2}/); return m ? +m[1] : null }

function stats(list: FirstCallRoute[]) {
  const answered = list.filter(r => r.status === 'Accepted' || r.status === 'Declined')
  const acc = list.filter(r => r.status === 'Accepted').length
  const dec = list.filter(r => r.status === 'Declined').length
  const recovered = list.filter(r => r.status !== 'Accepted' && isAcceptedInCallUp(r)).length
  const lost = list.filter(r => r.status !== 'Accepted' && !isAcceptedInCallUp(r) && (r.finalStatus ?? r.status) !== 'Pending').length
  return { n: list.length, answered: answered.length, acc, dec, rate: pct(acc, answered.length), recovered, lost, finalRate: pct(list.filter(isAcceptedInCallUp).length, list.length) }
}

function Kpi({ label, value, sub, color = C.text, delta }: { label: string; value: string; sub?: string; color?: string; delta?: number | null }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <p style={{ margin: '4px 0 2px', fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
        {delta != null && Number.isFinite(delta) && <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8, color: delta >= 0 ? C.green : C.red }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pp</span>}
      </p>
      {sub && <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{sub}</p>}
    </div>
  )
}
function Panel({ title, sub, children, span }: { title: string; sub?: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, gridColumn: span ? '1 / -1' : undefined }}>
      <div>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>{title}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}
function RateBars({ items, meta }: { items: { k: string; n: number; rate: number; color?: string }[]; meta: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map(it => (
        <div key={it.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 150px) 1fr 92px', gap: 8, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: it.color ?? C.sub, fontWeight: it.color ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.k}>{it.k}</span>
          <div style={{ position: 'relative', height: 10, background: C.line, borderRadius: 5 }}>
            <div style={{ width: `${it.rate}%`, height: '100%', background: rateColor(it.rate, meta), borderRadius: 5 }} />
            <div title={`meta ${meta}%`} style={{ position: 'absolute', left: `${meta}%`, top: -2, bottom: -2, width: 2, background: C.text, opacity: .5 }} />
          </div>
          <span style={{ textAlign: 'right', color: C.text, fontWeight: 700 }}>{it.rate.toFixed(0)}% <span style={{ color: C.muted, fontWeight: 400 }}>({it.n})</span></span>
        </div>
      ))}
    </div>
  )
}

export default function CallUpDashboard({ data, selectedDay }: { data: CallUpAnalysis; selectedDay: string }) {
  const all = data.firstCallAnalysis.routes
  const allDates = useMemo(() => [...new Set(all.map(firstCallDay).filter(Boolean))].sort(), [all])
  const lastAvail = allDates.at(-1) ?? selectedDay
  // Padrão: mês atual (ou o último mês com dados), igual à aba de 1ª chamada
  const [range, setRange] = useState(() => {
    const ym = new Date().toISOString().slice(0, 7)
    const month = allDates.filter(d => d.startsWith(ym))
    const m = month.length ? month : allDates.filter(d => d.startsWith(lastAvail.slice(0, 7)))
    return { from: m[0] ?? '', to: m.at(-1) ?? '' }
  })
  const [shift, setShift] = useState<'' | Shift>('')
  const [meta, setMetaState] = useState<number>(() => { try { return +(localStorage.getItem(META_KEY) ?? '') || 85 } catch { return 85 } })
  const setMeta = (v: number) => { setMetaState(v); try { localStorage.setItem(META_KEY, String(v)) } catch { /* */ } }

  const from = range.from || allDates[0] || '0000'
  const lastDay = range.to || lastAvail
  const spanDays = Math.max(1, Math.round((Date.parse(`${lastDay}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000) + 1)
  const period = range.from ? spanDays : 0
  const prevFrom = period ? addDays(from, -period) : '0000'
  const inShift = (r: FirstCallRoute) => !shift || r.shift === shift
  const cur = useMemo(() => all.filter(r => { const d = firstCallDay(r); return d >= from && d <= lastDay && inShift(r) }), [all, from, lastDay, shift]) // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => period ? all.filter(r => { const d = firstCallDay(r); return d >= prevFrom && d < from && inShift(r) }) : [], [all, prevFrom, from, period, shift]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = stats(cur), p = stats(prev)

  const byDay = useMemo(() => {
    const days = [...new Set(cur.map(firstCallDay))].sort()
    return days.map(d => ({ d, ...stats(cur.filter(r => firstCallDay(r) === d)) }))
  }, [cur])
  const byShift = (['AM', 'PM1', 'PM2'] as Shift[]).map(sh => ({ k: sh, color: SHIFT_COLOR[sh], ...stats(cur.filter(r => r.shift === sh)) })).filter(x => x.n)
  const byHour = useMemo(() => {
    const m = new Map<number, FirstCallRoute[]>()
    for (const r of cur) { const h = hourOf(r.triggerTime); if (h == null) continue; if (!m.has(h)) m.set(h, []); m.get(h)!.push(r) }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, l]) => ({ k: `${String(h).padStart(2, '0')}h`, ...stats(l) }))
  }, [cur])
  const byWeekday = useMemo(() => WEEKDAYS.map((w, i) => ({ k: w, ...stats(cur.filter(r => new Date(`${firstCallDay(r)}T12:00:00`).getDay() === i)) })).filter(x => x.n), [cur])
  // Análise mensal (todo o histórico, respeitando o turno)
  const byMonth = useMemo(() => {
    const m = new Map<string, FirstCallRoute[]>()
    for (const r of all) { if (!inShift(r)) continue; const k = firstCallDay(r).slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, l]) => ({ k, days: new Set(l.map(firstCallDay)).size, ...stats(l) }))
  }, [all, shift]) // eslint-disable-line react-hooks/exhaustive-deps
  const byCluster = useMemo(() => {
    const m = new Map<string, FirstCallRoute[]>()
    for (const r of cur) { const k = r.cluster || '—'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) }
    return [...m.entries()].map(([k, l]) => ({ k, ...stats(l) })).filter(x => x.answered >= 3).sort((a, b) => a.rate - b.rate)
  }, [cur])
  const byDriver = useMemo(() => {
    const m = new Map<string, FirstCallRoute[]>()
    for (const r of cur) { if (!m.has(r.driverId)) m.set(r.driverId, []); m.get(r.driverId)!.push(r) }
    return [...m.entries()].map(([id, l]) => ({ id, name: l[0].driverName, ...stats(l) }))
  }, [cur])
  const worstDrivers = byDriver.filter(d => d.answered >= 3 && d.dec > 0).sort((a, b) => a.rate - b.rate || b.dec - a.dec).slice(0, 12)

  // Gráfico de tendência
  const W = 920, H = 220, padL = 34, padB = 24, padT = 12
  const maxN = Math.max(1, ...byDay.map(d => d.n))
  const slot = (W - padL) / Math.max(1, byDay.length)
  const yR = (v: number) => padT + (H - padT - padB) * (1 - v / 100)
  const yN = (v: number) => padT + (H - padT - padB) * (1 - v / maxN)
  const pts = byDay.map((d, i) => ({ x: padL + slot * i + slot / 2, y: yR(d.rate) }))

  const pill = (active: boolean): React.CSSProperties => ({ background: active ? 'rgba(124,58,237,.25)' : 'transparent', border: `1px solid ${active ? '#7c3aed' : C.border}`, color: active ? '#fff' : C.sub, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' })

  if (!all.length) return <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Sem chamadas no relatório.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} availableDates={allDates} />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['', 'AM', 'PM1', 'PM2'] as const).map(v => <button key={v || 'all'} onClick={() => setShift(v)} style={{ ...pill(shift === v), color: shift === v ? '#fff' : v ? SHIFT_COLOR[v] : C.sub }}>{v || 'Todos os turnos'}</button>)}
        </div>
        <label style={{ fontSize: 11, color: C.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
          meta <input type="number" min={1} max={100} value={meta} onChange={e => setMeta(Math.min(100, Math.max(1, +e.target.value || 85)))} style={{ width: 48, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '3px 6px', fontSize: 12 }} />%
        </label>
        <span style={{ fontSize: 11, color: C.muted }}>{period ? `${ddmm(from)} a ${ddmm(lastDay)}${prev.length ? ` · comparado com ${ddmm(prevFrom)}–${ddmm(addDays(from, -1))}` : ''}` : 'todo o histórico do relatório'}</span>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Kpi label="Aceite na 1ª chamada" value={`${s.rate.toFixed(1)}%`} color={rateColor(s.rate, meta)} delta={prev.length ? s.rate - p.rate : null} sub={`meta ${meta}% · ${s.acc} de ${s.answered} respondidas`} />
        <Kpi label="Rotas chamadas" value={String(s.n)} sub={`${byDay.length ? (s.n / byDay.length).toFixed(0) : 0} por dia`} />
        <Kpi label="Recusadas na 1ª" value={String(s.dec)} color={C.red} sub={`${pct(s.dec, s.answered).toFixed(1)}% das respondidas`} />
        <Kpi label="Recuperadas" value={String(s.recovered)} color={C.blue} sub="recusada na 1ª, aceita depois" />
        <Kpi label="Sem aceite no fim" value={String(s.lost)} color={s.lost ? C.amber : C.green} sub="nenhuma chamada aceita" />
        <Kpi label="Aceite final" value={`${s.finalRate.toFixed(1)}%`} delta={prev.length ? s.finalRate - p.finalRate : null} sub="considerando as rechamadas" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <Panel title="Aceite na 1ª chamada por dia" sub="Linha = % de aceite · barras = rotas chamadas · tracejado = meta" span>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
            {[0, 25, 50, 75, 100].map(v => (
              <g key={v}><line x1={padL} x2={W} y1={yR(v)} y2={yR(v)} stroke={C.line} /><text x={padL - 6} y={yR(v) + 4} textAnchor="end" fontSize={10} fill={C.muted}>{v}%</text></g>
            ))}
            {byDay.map((d, i) => {
              const x = padL + slot * i + slot / 2, bw = Math.min(22, slot * 0.6)
              return (
                <g key={d.d}>
                  <rect x={x - bw / 2} y={yN(d.n)} width={bw} height={yN(0) - yN(d.n)} fill={C.violet} opacity={0.18}><title>{`${ddmm(d.d)}: ${d.n} rotas · ${d.rate.toFixed(1)}% na 1ª`}</title></rect>
                  {(byDay.length <= 16 || i % Math.ceil(byDay.length / 16) === 0) && <text x={x} y={H - 6} textAnchor="middle" fontSize={10} fill={C.muted}>{ddmm(d.d)}</text>}
                </g>
              )
            })}
            <line x1={padL} x2={W} y1={yR(meta)} y2={yR(meta)} stroke={C.green} strokeDasharray="5 4" opacity={0.7} />
            <polyline points={pts.map(p2 => `${p2.x},${p2.y}`).join(' ')} fill="none" stroke={C.text} strokeWidth={2} />
            {pts.map((p2, i) => <circle key={i} cx={p2.x} cy={p2.y} r={3.5} fill={rateColor(byDay[i].rate, meta)}><title>{`${ddmm(byDay[i].d)}: ${byDay[i].rate.toFixed(1)}%`}</title></circle>)}
          </svg>
        </Panel>

        <Panel title="Análise mensal" sub="Todo o histórico do relatório (respeita o filtro de turno)" span>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr)', gap: 16, alignItems: 'start' }}>
            <RateBars meta={meta} items={byMonth.map(x => ({ k: MONTH(x.k), n: x.answered, rate: x.rate }))} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr>{['Mês', 'Dias', 'Rotas', 'Aceite 1ª', 'Δ mês ant.', 'Recusas', 'Recuperadas', 'Aceite final'].map(h => <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {byMonth.map((x, i) => {
                  const d = i > 0 ? x.rate - byMonth[i - 1].rate : null
                  return (
                    <tr key={x.k} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: '4px 6px', color: C.text, fontWeight: 700 }}>{MONTH(x.k)}</td>
                      <td style={{ padding: '4px 6px', color: C.sub }}>{x.days}</td>
                      <td style={{ padding: '4px 6px', color: C.sub }}>{x.n}</td>
                      <td style={{ padding: '4px 6px', color: rateColor(x.rate, meta), fontWeight: 800 }}>{x.rate.toFixed(1)}%</td>
                      <td style={{ padding: '4px 6px', color: d == null ? C.muted : d >= 0 ? C.green : C.red, fontWeight: 700 }}>{d == null ? '—' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} pp`}</td>
                      <td style={{ padding: '4px 6px', color: C.red }}>{x.dec}</td>
                      <td style={{ padding: '4px 6px', color: C.blue }}>{x.recovered}</td>
                      <td style={{ padding: '4px 6px', color: C.text }}>{x.finalRate.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Por turno"><RateBars meta={meta} items={byShift.map(x => ({ k: x.k, n: x.answered, rate: x.rate, color: x.color }))} /></Panel>
        <Panel title="Por dia da semana"><RateBars meta={meta} items={byWeekday.map(x => ({ k: x.k, n: x.answered, rate: x.rate }))} /></Panel>
        <Panel title="Por hora do disparo" sub="Quando a chamada foi feita"><RateBars meta={meta} items={byHour.map(x => ({ k: x.k, n: x.answered, rate: x.rate }))} /></Panel>
        <Panel title="Clusters com menor aceite" sub="Mínimo de 3 respostas"><RateBars meta={meta} items={byCluster.slice(0, 10).map(x => ({ k: x.k, n: x.answered, rate: x.rate }))} /></Panel>

        <Panel title="Motoristas que mais recusam na 1ª" sub="Mínimo de 3 respostas no período">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr>{['Motorista', 'Chamadas', 'Recusas', 'Aceite 1ª'].map(h => <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
            <tbody>
              {worstDrivers.map(d => (
                <tr key={d.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: '4px 6px', color: C.text }}>{d.name}<span style={{ display: 'block', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{d.id}</span></td>
                  <td style={{ padding: '4px 6px', color: C.sub }}>{d.answered}</td>
                  <td style={{ padding: '4px 6px', color: C.red, fontWeight: 700 }}>{d.dec}</td>
                  <td style={{ padding: '4px 6px', color: rateColor(d.rate, meta), fontWeight: 700 }}>{d.rate.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>
        Indicador: % de rotas aceitas na primeira chamada, entre as que tiveram resposta (aceitou ou recusou; recusa inclui tempo esgotado). Cada rota (AT) conta uma vez. “Recuperadas” foram recusadas na 1ª e aceitas numa chamada seguinte.
      </p>
    </div>
  )
}
