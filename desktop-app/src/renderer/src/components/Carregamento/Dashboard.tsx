import { useMemo, useState } from 'react'
import { minToHHMM, type QueueEntry, type LoadWindow } from '../../lib/queueListParser'

// Dashboard do carregamento: situação agora, pontualidade, chegadas ao longo do turno, espera e letras.

export interface DashRow { e: QueueEntry; w: LoadWindow }
export interface DashMissing { driverId: string; name: string; letter: string; arriveByMin: number | null; status: 'waiting' | 'overdue' | 'unknown-letter' }

const C = {
  panel: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b',
  good: '#4ade80', warn: '#fbbf24', late: '#fb923c', bad: '#f87171', blue: '#60a5fa', violet: '#a78bfa', none: '#374151',
}

function Panel({ title, sub, children, style }: { title: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', minWidth: 0, ...style }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sub}</p>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}

function Legend({ items }: { items: { label: string; n: number; c: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
      {items.map(s => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c }} />{s.label} <b style={{ color: C.text }}>{s.n}</b>
        </span>
      ))}
    </div>
  )
}

/** Barra empilhada com 2px de respiro entre os segmentos e dica ao passar o mouse. */
function StackBar({ items, height = 26 }: { items: { label: string; n: number; c: string }[]; height?: number }) {
  const total = items.reduce((a, b) => a + b.n, 0)
  if (!total) return <div style={{ height, borderRadius: 6, background: '#0f1117' }} />
  return (
    <div style={{ display: 'flex', gap: 2, height }}>
      {items.filter(s => s.n > 0).map(s => (
        <div key={s.label} title={`${s.label}: ${s.n} (${Math.round((s.n / total) * 100)}%)`}
          style={{ flex: s.n, background: s.c, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0f1117', overflow: 'hidden', minWidth: 3 }}>
          {s.n / total >= 0.08 ? s.n : ''}
        </div>
      ))}
    </div>
  )
}

function Donut({ value, color, label }: { value: number | null; color: string; label: string }) {
  const r = 42, circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
      <svg width={110} height={110} viewBox="0 0 110 110">
        <circle cx={55} cy={55} r={r} fill="none" stroke="#0f1117" strokeWidth={12} />
        {value !== null && <circle cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circ} ${circ}`} transform="rotate(-90 55 55)" />}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{value === null ? '—' : `${value}%`}</span>
        <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
      </div>
    </div>
  )
}

export default function CarregamentoDashboard({ rows, notArrived, nowMin, phoneMap }: {
  rows: DashRow[]; notArrived: DashMissing[]; nowMin: number; phoneMap: Map<string, string>
}) {
  const [hoverSlot, setHoverSlot] = useState<number | null>(null)
  const onTime = rows.filter(r => r.w.status === 'on-time').length
  const outOfWindow = rows.filter(r => r.w.status === 'out-of-window').length
  const overdue = notArrived.filter(n => n.status === 'overdue')
  const waiting = notArrived.filter(n => n.status === 'waiting').length
  const expected = rows.length + notArrived.length
  const arrivedPct = expected ? Math.round((rows.length / expected) * 100) : 0
  const punctual = onTime + outOfWindow ? Math.round((onTime / (onTime + outOfWindow)) * 100) : null
  const hasApi = rows.some(r => r.e.situation)

  // Situação agora (só com dados da API do SPX)
  const sit = (s: string) => rows.filter(r => r.e.situation === s)
  const done = sit('done'), atDock = sit('at-dock'), calling = sit('calling'), inLine = [...sit('waiting'), ...sit('pending'), ...sit('on-hold')]
  const pkgs = (l: DashRow[]) => l.reduce((a, r) => a + (r.e.orderQty ?? 0), 0)
  const pkgTotal = pkgs(rows), pkgDone = pkgs(done)

  // Espera de quem ainda está na fila
  const waitNow = inLine.map(r => r.e.waitingMin ?? 0)
  const avgWait = waitNow.length ? Math.round(waitNow.reduce((a, b) => a + b, 0) / waitNow.length) : null
  const allWaits = rows.map(r => r.e.waitingMin).filter((v): v is number => v != null)
  const avgAll = allWaits.length ? Math.round(allWaits.reduce((a, b) => a + b, 0) / allWaits.length) : null
  const waitBuckets = [
    { label: 'até 15 min', n: allWaits.filter(v => v < 15).length, c: C.good },
    { label: '15–30 min', n: allWaits.filter(v => v >= 15 && v < 30).length, c: C.blue },
    { label: '30–60 min', n: allWaits.filter(v => v >= 30 && v < 60).length, c: C.warn },
    { label: '60+ min', n: allWaits.filter(v => v >= 60).length, c: C.bad },
  ]

  // Chegadas por 15 min
  const timeline = useMemo(() => {
    const m = new Map<number, { on: number; out: number; unk: number }>()
    for (const { e, w } of rows) {
      if (e.arrivalMin == null) continue
      const k = Math.floor(e.arrivalMin / 15) * 15
      if (!m.has(k)) m.set(k, { on: 0, out: 0, unk: 0 })
      const x = m.get(k)!
      if (w.status === 'on-time') x.on++; else if (w.status === 'out-of-window') x.out++; else x.unk++
    }
    if (m.size === 0) return []
    const keys = [...m.keys()]
    const out: [number, { on: number; out: number; unk: number }][] = []
    for (let k = Math.min(...keys); k <= Math.max(...keys); k += 15) out.push([k, m.get(k) ?? { on: 0, out: 0, unk: 0 }])
    return out
  }, [rows])
  const tlMax = Math.max(1, ...timeline.map(([, s]) => s.on + s.out + s.unk))

  // Por letra
  const letters = useMemo(() => {
    const m = new Map<string, { done: number; dock: number; line: number; missing: number; late: number; total: number }>()
    const g = (l: string) => { const k = l || '—'; if (!m.has(k)) m.set(k, { done: 0, dock: 0, line: 0, missing: 0, late: 0, total: 0 }); return m.get(k)! }
    for (const r of rows) {
      const x = g(r.e.letter); x.total++
      if (r.e.situation === 'done') x.done++
      else if (r.e.situation === 'at-dock' || r.e.situation === 'calling') x.dock++
      else x.line++
    }
    for (const n of notArrived) { const x = g(n.letter); x.total++; x.missing++; if (n.status === 'overdue') x.late++ }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, notArrived])

  const longest = [...inLine].sort((a, b) => (b.e.waitingMin ?? 0) - (a.e.waitingMin ?? 0)).slice(0, 8)
  const toneOf = (v: number, good: number, warn: number, higherIsBetter = true) =>
    higherIsBetter ? (v >= good ? C.good : v >= warn ? C.warn : C.bad) : (v <= good ? C.good : v <= warn ? C.warn : C.bad)

  const kpis = [
    { label: 'Chegaram', value: `${rows.length}/${expected}`, sub: `${arrivedPct}% dos esperados`, color: toneOf(arrivedPct, 80, 50), bar: arrivedPct },
    { label: 'Pontualidade', value: punctual === null ? '—' : `${punctual}%`, sub: `${outOfWindow} fora da janela`, color: punctual === null ? C.muted : toneOf(punctual, 80, 50), bar: punctual ?? 0 },
    { label: 'Atrasados', value: String(overdue.length), sub: `${waiting} ainda no prazo`, color: overdue.length ? C.bad : C.good },
    ...(hasApi ? [
      { label: 'Saíram', value: String(done.length), sub: pkgTotal ? `${pkgDone.toLocaleString('pt-BR')} de ${pkgTotal.toLocaleString('pt-BR')} pacotes` : '', color: C.good, bar: rows.length ? Math.round((done.length / rows.length) * 100) : 0 },
      { label: 'Nas mesas', value: String(atDock.length + calling.length), sub: `${calling.length} sendo chamados`, color: C.violet },
      { label: 'Espera na fila', value: avgWait === null ? '—' : `${avgWait} min`, sub: `${inLine.length} aguardando mesa`, color: avgWait === null ? C.muted : toneOf(avgWait, 20, 40, false) },
    ] : [
      { label: 'Espera média', value: avgAll === null ? '—' : `${avgAll} min`, sub: 'dos que chegaram', color: avgAll === null ? C.muted : toneOf(avgAll, 20, 40, false) },
    ]),
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 80px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <p style={{ margin: 0, fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
            <p style={{ margin: '6px 0 2px', fontSize: 26, fontWeight: 800, color: C.text, lineHeight: 1 }}>{k.value}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.sub }}>{k.sub}</p>
            {'bar' in k && k.bar !== undefined && (
              <div style={{ height: 4, background: '#0f1117', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ width: `${k.bar}%`, height: '100%', background: k.color, borderRadius: 2 }} />
              </div>
            )}
            {!('bar' in k) && <div style={{ height: 3, width: 28, background: k.color, borderRadius: 2, marginTop: 8 }} />}
          </div>
        ))}
      </div>

      {/* Progresso + pontualidade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 14 }}>
        <Panel title="Andamento do turno" sub={hasApi ? 'Onde está cada motorista esperado agora' : 'Atualize do SPX para ver mesas e saídas'}>
          {(() => {
            const items = hasApi ? [
              { label: 'Saíram', n: done.length, c: C.good },
              { label: 'Na mesa', n: atDock.length, c: C.violet },
              { label: 'Chamados', n: calling.length, c: C.warn },
              { label: 'Na fila', n: inLine.length, c: C.blue },
              { label: 'Não chegaram (no prazo)', n: waiting, c: C.none },
              { label: 'Atrasados', n: overdue.length, c: C.bad },
            ] : [
              { label: 'No prazo', n: onTime, c: C.good },
              { label: 'Fora da janela', n: outOfWindow, c: C.late },
              { label: 'Aguardando', n: waiting, c: C.none },
              { label: 'Atrasados', n: overdue.length, c: C.bad },
            ]
            return <><StackBar items={items} height={30} /><Legend items={items} /></>
          })()}
        </Panel>
        <Panel title="Chegada no prazo" sub="Dos que já chegaram">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Donut value={punctual} color={punctual === null ? C.muted : toneOf(punctual, 80, 50)} label="no prazo" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <span style={{ color: C.sub }}><b style={{ color: C.good }}>{onTime}</b> no prazo</span>
              <span style={{ color: C.sub }}><b style={{ color: C.late }}>{outOfWindow}</b> fora da janela</span>
              <span style={{ color: C.sub }}><b style={{ color: C.bad }}>{overdue.length}</b> atrasados sem chegar</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* Chegadas ao longo do turno */}
      {timeline.length > 0 && (
        <Panel title="Chegadas ao longo do turno" sub="Motoristas que entraram na fila a cada 15 min — passe o mouse nas barras">
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, borderBottom: `1px solid ${C.border}` }}>
              {timeline.map(([slot, s]) => {
                const tot = s.on + s.out + s.unk
                const isNow = nowMin >= slot && nowMin < slot + 15
                return (
                  <div key={slot} onMouseEnter={() => setHoverSlot(slot)} onMouseLeave={() => setHoverSlot(null)}
                    style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 2, cursor: 'default', background: hoverSlot === slot ? 'rgba(148,163,184,.06)' : 'transparent', borderRadius: 4, position: 'relative' }}>
                    {tot > 0 && <span style={{ fontSize: 10, color: C.sub }}>{tot}</span>}
                    <div style={{ width: '70%', maxWidth: 34, display: 'flex', flexDirection: 'column-reverse', gap: 2, height: `${(tot / tlMax) * 85}%` }}>
                      {s.on > 0 && <div style={{ flex: s.on, background: C.good, borderRadius: s.out + s.unk ? 2 : '4px 4px 2px 2px' }} />}
                      {s.out > 0 && <div style={{ flex: s.out, background: C.late, borderRadius: s.unk ? 2 : '4px 4px 2px 2px' }} />}
                      {s.unk > 0 && <div style={{ flex: s.unk, background: C.none, borderRadius: '4px 4px 2px 2px' }} />}
                    </div>
                    {isNow && <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 0, borderLeft: `1px dashed ${C.blue}` }} title="agora" />}
                    {hoverSlot === slot && (
                      <div style={{ position: 'absolute', bottom: '100%', zIndex: 2, background: '#0a0c14', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', fontSize: 11, color: C.text, whiteSpace: 'nowrap', marginBottom: 4 }}>
                        <b>{minToHHMM(slot)}–{minToHHMM(slot + 15)}</b><br />
                        <span style={{ color: C.good }}>●</span> {s.on} no prazo · <span style={{ color: C.late }}>●</span> {s.out} fora{s.unk ? ` · ${s.unk} s/ janela` : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {timeline.map(([slot], i) => (
                <span key={slot} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{i % 2 === 0 || timeline.length < 14 ? minToHHMM(slot) : ''}</span>
              ))}
            </div>
          </div>
          <Legend items={[{ label: 'No prazo', n: onTime, c: C.good }, { label: 'Fora da janela', n: outOfWindow, c: C.late }]} />
        </Panel>
      )}

      {/* Letras + espera */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 14 }}>
        <Panel title="Por letra" sub={hasApi ? 'Saíram · na mesa · na fila · não chegaram' : 'Chegaram × não chegaram'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {letters.map(([l, g]) => {
              const items = [
                { label: 'Saíram', n: g.done, c: C.good }, { label: 'Na mesa', n: g.dock, c: C.violet },
                { label: 'Na fila', n: g.line, c: C.blue }, { label: 'Não chegaram', n: g.missing - g.late, c: C.none }, { label: 'Atrasados', n: g.late, c: C.bad },
              ]
              return (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 22, fontSize: 14, fontWeight: 800, color: C.text }}>{l}</span>
                  <div style={{ flex: 1 }}><StackBar items={items} height={18} /></div>
                  <span style={{ width: 64, fontSize: 11, color: C.sub, textAlign: 'right' }}>{g.total - g.missing}/{g.total}{g.late ? <b style={{ color: C.bad }}> · {g.late}🔴</b> : ''}</span>
                </div>
              )
            })}
          </div>
          <Legend items={[{ label: 'Saíram', n: done.length, c: C.good }, { label: 'Na mesa', n: atDock.length + calling.length, c: C.violet }, { label: 'Na fila', n: inLine.length, c: C.blue }, { label: 'Não chegaram', n: waiting, c: C.none }, { label: 'Atrasados', n: overdue.length, c: C.bad }]} />
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Panel title="Tempo de espera" sub="Quanto cada motorista esperou na fila">
            <StackBar items={waitBuckets} height={22} />
            <Legend items={waitBuckets} />
          </Panel>
          {hasApi && (
            <Panel title="Esperando há mais tempo" sub="Na fila, sem mesa">
              {longest.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Ninguém aguardando.</p> : longest.map(r => (
                <div key={r.e.driverId + r.e.atId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.e.driverName}</span>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.e.cage}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: toneOf(r.e.waitingMin ?? 0, 20, 40, false) }}>{r.e.waitingMin ?? '—'}m</span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>

      {overdue.length > 0 && (
        <Panel title={`🔴 Atrasados sem chegar (${overdue.length})`} sub="Passaram do prazo da letra e não entraram na fila" style={{ borderColor: 'rgba(239,68,68,.35)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {overdue.map(n => (
              <div key={n.driverId} style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '7px 10px' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name || n.driverId}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub, fontFamily: 'monospace' }}>letra {n.letter || '—'} · prazo {minToHHMM(n.arriveByMin)}{n.arriveByMin != null ? ` · +${nowMin - n.arriveByMin} min` : ''}</p>
                {phoneMap.get(n.driverId) && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>{phoneMap.get(n.driverId)}</p>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
