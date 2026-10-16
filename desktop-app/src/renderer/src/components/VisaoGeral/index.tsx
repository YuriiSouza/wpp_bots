import { useMemo, useState } from 'react'
import type { StoredDriver } from '../../lib/localStore'
import type { DriverResult } from '../../lib/types'
import type { LocalRoute } from '../../lib/noshowRouteParser'
import type { Shift } from '../../lib/globalConfig'
import { routeStore } from '../../lib/routeStore'

// "A-34" → { letter: "A", num: 34 }; null/empty → sorts last
function compareGaiola(a: string | null, b: string | null): number {
  const parse = (v: string | null) => {
    const m = v?.match(/^([A-Za-z]+)-?(\d+)$/)
    return m ? { letter: m[1].toUpperCase(), num: parseInt(m[2], 10) } : null
  }
  const pa = parse(a), pb = parse(b)
  if (!pa && !pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  if (pa.letter !== pb.letter) return pa.letter.localeCompare(pb.letter)
  return pa.num - pb.num
}

interface Props {
  registry: StoredDriver[]
  dsDrivers: DriverResult[]
  selectedDay: string
  selectedShift: Shift
}

const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#f472b6' }

function normalizeVehicle(v?: string | null): string | null {
  if (!v?.trim()) return null
  const s = v.trim().toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio')) return 'PASSEIO'
  return s.toUpperCase()
}

function vehicleRequired(route: LocalRoute): string {
  const vol = route.volume ?? 0
  const gg = route.gg ?? 0
  if (vol > 700 || gg > 1) return 'FIORINO'
  if (normalizeVehicle(route.scheduledVehicle) === 'MOTO') return 'MOTO'
  return 'PASSEIO'
}

function Chip({ label, color = '#94a3b8', bg = 'rgba(100,116,139,.1)', small }: { label: string; color?: string; bg?: string; small?: boolean }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}33`, borderRadius: 5, padding: small ? '1px 5px' : '2px 7px', fontSize: small ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

const TH: React.CSSProperties = { padding: '7px 10px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', background: '#0f1117', position: 'sticky', top: 0, zIndex: 1 }
const TD: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle', fontSize: 12, whiteSpace: 'nowrap' }

// ─── Dashboard ────────────────────────────────────────────────────────────────

type Row = LocalRoute & { vehicleRequired: string; chosenVehicle: string | null; acertividade: boolean | null; ds: number | null; phone: string | null }

const VEHICLE_COLOR: Record<string, string> = { FIORINO: '#fbbf24', MOTO: '#f472b6', PASSEIO: '#60a5fa', VAN: '#a78bfa' }
const pctColor = (p: number) => (p >= 90 ? '#4ade80' : p >= 60 ? '#fbbf24' : '#f87171')
const dsPctColor = (p: number) => (p >= 95 ? '#4ade80' : '#f87171')

function Panel({ title, sub, children, span }: { title: string; sub?: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px', gridColumn: span ? `span ${span}` : undefined, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Donut({ pct, color }: { pct: number; color: string }) {
  const r = 40, circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={r} fill="none" stroke="#1e2130" strokeWidth={11} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${(pct / 100) * circ} ${circ}`} transform="rotate(-90 50 50)" />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>{pct}%</span>
    </div>
  )
}

// Barra com a parte atribuída (verde) sobre o total.
function Progress({ done, total, color = '#4ade80' }: { done: number; total: number; color?: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: '#1e2130', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${total > 0 ? (done / total) * 100 : 0}%`, height: '100%', background: color, borderRadius: 4 }} />
    </div>
  )
}

function RouteDashboard({ rows, onOpenTable }: { rows: Row[]; onOpenTable: (search: string, status: 'all' | 'DISPONIVEL' | 'ATRIBUIDA') => void }) {
  const d = useMemo(() => {
    const total = rows.length
    const assigned = rows.filter(r => r.status === 'ATRIBUIDA')
    const open = rows.filter(r => r.status === 'DISPONIVEL')
    const judged = rows.filter(r => r.acertividade !== null)
    const withDs = assigned.filter(r => r.ds !== null)
    const sum = (f: (r: Row) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0)

    const group = (key: (r: Row) => string) => {
      const m = new Map<string, { total: number; assigned: number }>()
      for (const r of rows) {
        const k = key(r) || '—'
        const g = m.get(k) ?? { total: 0, assigned: 0 }
        g.total++
        if (r.status === 'ATRIBUIDA') g.assigned++
        m.set(k, g)
      }
      return [...m.entries()].map(([name, g]) => ({ name, ...g, open: g.total - g.assigned }))
    }

    return {
      total, assigned: assigned.length, open: open.length,
      acert: judged.length ? Math.round((judged.filter(r => r.acertividade).length / judged.length) * 100) : null,
      dsAvg: withDs.length ? (withDs.reduce((s, r) => s + r.ds! * 100, 0) / withDs.length) : null,
      paradas: sum(r => r.paradas), km: sum(r => r.km), volume: sum(r => r.volume),
      byLetter: group(r => (r.gaiola ?? '').split('-')[0].toUpperCase()).sort((a, b) => a.name.localeCompare(b.name)),
      byCluster: group(r => r.cluster).sort((a, b) => b.open - a.open || b.total - a.total),
      byVehicle: group(r => r.vehicleRequired).sort((a, b) => b.total - a.total),
      // Crítico: moto numa rota que não é de moto (a carga não cabe). Leve: rota de moto com outro veículo (cabe, mas custa mais).
      motoOnBigRoute: assigned.filter(r => r.chosenVehicle === 'MOTO' && r.vehicleRequired !== 'MOTO'),
      otherOnMotoRoute: assigned.filter(r => r.vehicleRequired === 'MOTO' && r.chosenVehicle !== null && r.chosenVehicle !== 'MOTO'),
      wrongVehicle: rows.filter(r => r.acertividade === false),
      heavyOpen: open.filter(r => r.vehicleRequired === 'FIORINO'),
      lowDs: assigned.filter(r => r.ds !== null && r.ds * 100 < 95).sort((a, b) => a.ds! - b.ds!),
      // Necessário × alocado (só atribuídas com veículo conhecido)
      matrix: (() => {
        const m = new Map<string, number>()
        for (const r of assigned) if (r.chosenVehicle) m.set(`${r.vehicleRequired}|${r.chosenVehicle}`, (m.get(`${r.vehicleRequired}|${r.chosenVehicle}`) ?? 0) + 1)
        return m
      })(),
      dsBuckets: [
        { label: 'abaixo de 90%', n: withDs.filter(r => r.ds! * 100 < 90).length, c: '#f87171' },
        { label: '90–95%', n: withDs.filter(r => r.ds! * 100 >= 90 && r.ds! * 100 < 95).length, c: '#fb923c' },
        { label: '95–98%', n: withDs.filter(r => r.ds! * 100 >= 95 && r.ds! * 100 < 98).length, c: '#60a5fa' },
        { label: '98% ou mais', n: withDs.filter(r => r.ds! * 100 >= 98).length, c: '#4ade80' },
        { label: 'sem DS', n: assigned.length - withDs.length, c: '#374151' },
      ],
      // Média de carga por veículo necessário
      sizeByVehicle: (() => {
        const m = new Map<string, { n: number; paradas: number; km: number; volume: number }>()
        for (const r of rows) {
          const g = m.get(r.vehicleRequired) ?? { n: 0, paradas: 0, km: 0, volume: 0 }
          g.n++; g.paradas += r.paradas ?? 0; g.km += r.km ?? 0; g.volume += r.volume ?? 0
          m.set(r.vehicleRequired, g)
        }
        return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
      })(),
    }
  }, [rows])

  const pctAssigned = d.total > 0 ? Math.round((d.assigned / d.total) * 100) : 0
  const kpis = [
    { label: 'Rotas no turno', value: d.total, color: '#e2e8f0' },
    { label: 'Atribuídas', value: `${d.assigned}`, sub: `${pctAssigned}% do turno`, color: pctColor(pctAssigned) },
    { label: 'Sem motorista', value: d.open, sub: d.open === 0 ? 'turno completo' : 'faltam atribuir', color: d.open === 0 ? '#4ade80' : '#f87171' },
    { label: 'Veículo certo', value: d.acert !== null ? `${d.acert}%` : '—', sub: 'das rotas atribuídas', color: d.acert !== null ? pctColor(d.acert) : '#64748b' },
    { label: 'DS médio', value: d.dsAvg !== null ? `${d.dsAvg.toFixed(1)}%` : '—', sub: 'dos motoristas atribuídos', color: d.dsAvg !== null ? dsPctColor(d.dsAvg) : '#64748b' },
  ]
  const link: React.CSSProperties = { background: 'none', border: 'none', color: '#60a5fa', fontSize: 11, cursor: 'pointer', padding: 0, textAlign: 'left' }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 60px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 3fr)', gap: 14 }}>
        <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
          <Donut pct={pctAssigned} color={pctColor(pctAssigned)} />
          <div>
            <p style={{ margin: 0, fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Atribuição do turno</p>
            <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>{d.assigned}<span style={{ fontSize: 16, color: '#64748b' }}> / {d.total}</span></p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: d.open === 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>{d.open === 0 ? '✓ turno completo' : `${d.open} rota${d.open !== 1 ? 's' : ''} sem motorista`}</p>
            {d.open > 0 && <button onClick={() => onOpenTable('', 'DISPONIVEL')} style={{ ...link, marginTop: 4 }}>ver rotas em aberto →</button>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[
            ...kpis.slice(3),
            { label: 'Paradas', value: d.paradas.toLocaleString('pt-BR'), sub: d.total ? `${Math.round(d.paradas / d.total)} por rota` : '', color: '#e2e8f0' },
            { label: 'Quilômetros', value: Math.round(d.km).toLocaleString('pt-BR'), sub: d.total ? `${Math.round(d.km / d.total)} km por rota` : '', color: '#e2e8f0' },
            { label: 'Volume', value: `${(d.volume / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³`, sub: d.total ? `${Math.round(d.volume / d.total)} L por rota` : '', color: '#e2e8f0' },
            { label: 'Alertas de veículo', value: d.motoOnBigRoute.length + d.otherOnMotoRoute.length, sub: d.motoOnBigRoute.length ? `${d.motoOnBigRoute.length} críticos` : 'nenhum crítico', color: d.motoOnBigRoute.length ? '#f87171' : d.otherOnMotoRoute.length ? '#fbbf24' : '#4ade80' },
          ].map(k => (
            <div key={k.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, padding: '12px 14px' }}>
              <p style={{ margin: 0, fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
              <p style={{ margin: '6px 0 2px', fontSize: 24, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>{k.value}</p>
              {k.sub && <p style={{ margin: 0, fontSize: 11, color: '#8892a4' }}>{k.sub}</p>}
              <div style={{ height: 3, width: 28, background: k.color, borderRadius: 2, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Alerta crítico: moto em rota de passeio/fiorino */}
      {d.motoOnBigRoute.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '2px solid #ef4444', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28, lineHeight: 1 }}>🚨</span>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#fca5a5' }}>
                {d.motoOnBigRoute.length} rota{d.motoOnBigRoute.length !== 1 ? 's' : ''} de passeio/Fiorino atribuída{d.motoOnBigRoute.length !== 1 ? 's' : ''} a moto
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#fecaca' }}>A carga não cabe numa moto. Troque o motorista antes do carregamento.</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
            {d.motoOnBigRoute.map(r => (
              <button key={r.id} onClick={() => onOpenTable(r.atId, 'all')}
                style={{ background: 'rgba(0,0,0,.25)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: '#e2e8f0' }}>
                  <b style={{ fontFamily: 'monospace' }}>{r.atId}</b> · {r.gaiola ?? '—'} · precisa <b style={{ color: VEHICLE_COLOR[r.vehicleRequired] ?? '#94a3b8' }}>{r.vehicleRequired}</b>
                </span>
                <span style={{ fontSize: 11, color: '#fecaca', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  🏍 {r.assignedDriverName ?? r.assignedDriverId} · {r.cluster}{r.volume !== null ? ` · ${r.volume} L` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Alerta leve: rota de moto com outro veículo */}
      {d.otherOnMotoRoute.length > 0 && (
        <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24' }}>⚠ {d.otherOnMotoRoute.length} rota{d.otherOnMotoRoute.length !== 1 ? 's' : ''} de moto com outro veículo</span>
          {d.otherOnMotoRoute.slice(0, 8).map(r => (
            <button key={r.id} onClick={() => onOpenTable(r.atId, 'all')} style={{ ...link, color: '#94a3b8' }}>
              <span style={{ fontFamily: 'monospace' }}>{r.atId}</span> ({r.chosenVehicle})
            </button>
          ))}
          {d.otherOnMotoRoute.length > 8 && <span style={{ fontSize: 11, color: '#64748b' }}>+{d.otherOnMotoRoute.length - 8}</span>}
        </div>
      )}

      {/* Por letra (colunas) */}
      <Panel title="Por letra de gaiola" sub="Ordem de carregamento — verde atribuído, vermelho sem motorista. Clique numa letra para ver as rotas.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 170, paddingTop: 18 }}>
          {(() => {
            const max = Math.max(1, ...d.byLetter.map(g => g.total))
            return d.byLetter.map(g => (
              <button key={g.name} onClick={() => onOpenTable(g.name === '—' ? '' : `${g.name}-`, 'all')} title={`${g.name}: ${g.assigned} atribuídas, ${g.open} sem motorista`}
                style={{ flex: 1, maxWidth: 56, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <span style={{ fontSize: 10, color: g.open ? '#f87171' : '#4ade80', fontWeight: 700 }}>{g.open ? `−${g.open}` : '✓'}</span>
                <div style={{ width: '70%', height: `${(g.total / max) * 78}%`, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {g.open > 0 && <div style={{ flex: g.open, background: 'rgba(248,113,113,.75)', borderRadius: g.assigned ? '4px 4px 2px 2px' : 4 }} />}
                  {g.assigned > 0 && <div style={{ flex: g.assigned, background: '#4ade80', borderRadius: g.open ? '2px 2px 4px 4px' : 4 }} />}
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{g.name}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{g.assigned}/{g.total}</span>
              </button>
            ))
          })()}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        {/* Necessário × alocado */}
        <Panel title="Veículo necessário × alocado" sub="Linha = o que a rota precisa · coluna = veículo do motorista atribuído">
          {(() => {
            const need = [...new Set(d.byVehicle.map(g => g.name))]
            const got = [...new Set([...d.matrix.keys()].map(k => k.split('|')[1]))].sort()
            if (got.length === 0) return <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Nenhuma rota atribuída com veículo conhecido.</p>
            const cellColor = (n: string, c: string) => n === c ? '#4ade80' : c === 'MOTO' ? '#f87171' : n === 'MOTO' ? '#fbbf24' : '#fb923c'
            return (
              <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
                <thead><tr><th />{got.map(c => <th key={c} style={{ fontSize: 10, color: VEHICLE_COLOR[c] ?? '#94a3b8', fontWeight: 700, padding: '0 6px' }}>{c}</th>)}</tr></thead>
                <tbody>
                  {need.map(n => (
                    <tr key={n}>
                      <td style={{ fontSize: 10, fontWeight: 700, color: VEHICLE_COLOR[n] ?? '#94a3b8', paddingRight: 8 }}>{n}</td>
                      {got.map(c => {
                        const v = d.matrix.get(`${n}|${c}`) ?? 0
                        const col = cellColor(n, c)
                        return <td key={c} title={`Precisa ${n}, foi ${c}: ${v}`} style={{ minWidth: 54, height: 34, textAlign: 'center', borderRadius: 6, fontWeight: 700, background: v ? `${col}26` : '#0f1117', color: v ? col : '#374151', border: `1px solid ${v ? `${col}55` : '#1e2130'}` }}>{v || '·'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
          <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Verde = certo · vermelho = moto em rota maior · amarelo = rota de moto com veículo maior</p>
        </Panel>

        {/* Por veículo */}
        <Panel title="Por veículo necessário" sub="Fiorino: volume acima de 700 L ou mais de 1 GG">
          {d.byVehicle.map(g => {
            const sz = d.sizeByVehicle.find(([k]) => k === g.name)?.[1]
            return (
              <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 70, fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[g.name] ?? '#94a3b8' }}>{g.name}</span>
                  <Progress done={g.assigned} total={g.total} color={VEHICLE_COLOR[g.name] ?? '#94a3b8'} />
                  <span style={{ width: 54, textAlign: 'right', fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{g.assigned}/{g.total}</span>
                </div>
                {sz && sz.n > 0 && <span style={{ marginLeft: 80, fontSize: 10, color: '#64748b' }}>média {Math.round(sz.paradas / sz.n)} paradas · {Math.round(sz.km / sz.n)} km · {Math.round(sz.volume / sz.n)} L</span>}
              </div>
            )
          })}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        {/* Por cluster */}
        <Panel title="Clusters com rota sem motorista" sub="Clique para ver as rotas na tabela">
          {d.byCluster.filter(g => g.open > 0).length === 0
            ? <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>✓ Nenhum cluster com rota em aberto.</p>
            : d.byCluster.filter(g => g.open > 0).slice(0, 12).map(g => (
              <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => onOpenTable(g.name, 'DISPONIVEL')} style={{ ...link, width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</button>
                <Progress done={g.assigned} total={g.total} />
                <span style={{ width: 66, textAlign: 'right', fontSize: 11, color: '#f87171', fontWeight: 700 }}>{g.open} em aberto</span>
              </div>
            ))}
        </Panel>

        {/* DS dos atribuídos */}
        <Panel title="DS dos motoristas atribuídos" sub="Qualidade de entrega de quem vai rodar hoje (meta 95%)">
          {(() => {
            const items = d.dsBuckets.filter(b => b.n > 0)
            const tot = items.reduce((a, b) => a + b.n, 0)
            if (!tot) return <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Sem rotas atribuídas.</p>
            return (
              <>
                <div style={{ display: 'flex', gap: 2, height: 26 }}>
                  {items.map(b => <div key={b.label} title={`${b.label}: ${b.n}`} style={{ flex: b.n, background: b.c, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0f1117', minWidth: 3 }}>{b.n / tot >= 0.08 ? b.n : ''}</div>)}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {items.map(b => <span key={b.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: b.c }} />{b.label} <b style={{ color: '#e2e8f0' }}>{b.n}</b></span>)}
                </div>
              </>
            )
          })()}
        </Panel>
      </div>

      {/* Pontos de atenção */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Panel title={`Rotas pesadas sem motorista (${d.heavyOpen.length})`} sub="Precisam de Fiorino e ainda não foram atribuídas">
          {d.heavyOpen.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>✓ Nenhuma.</p> : d.heavyOpen.slice(0, 10).map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
              <button onClick={() => onOpenTable(r.atId, 'all')} style={{ ...link, fontFamily: 'monospace' }}>{r.atId}</button>
              <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cluster} · {r.volume ?? '—'} L · GG {r.gg ?? '—'}</span>
            </div>
          ))}
          {d.heavyOpen.length > 10 && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>+{d.heavyOpen.length - 10} outras</p>}
        </Panel>

        <Panel title={`Veículo diferente do necessário (${d.wrongVehicle.length})`} sub="Rota atribuída a um veículo que não é o indicado">
          {d.wrongVehicle.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>✓ Nenhuma.</p> : d.wrongVehicle.slice(0, 10).map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
              <button onClick={() => onOpenTable(r.atId, 'all')} style={{ ...link, fontFamily: 'monospace' }}>{r.atId}</button>
              <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.assignedDriverName ?? '—'} · precisa <b style={{ color: VEHICLE_COLOR[r.vehicleRequired] ?? '#94a3b8' }}>{r.vehicleRequired}</b>, foi {r.chosenVehicle}</span>
            </div>
          ))}
          {d.wrongVehicle.length > 10 && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>+{d.wrongVehicle.length - 10} outras</p>}
        </Panel>

        <Panel title={`Motoristas com DS abaixo de 95% (${d.lowDs.length})`} sub="Rotas atribuídas que merecem acompanhamento">
          {d.lowDs.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>✓ Nenhum.</p> : d.lowDs.slice(0, 10).map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
              <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.assignedDriverName ?? r.assignedDriverId}</span>
              <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.cluster} · <b style={{ color: dsPctColor(r.ds! * 100) }}>{(r.ds! * 100).toFixed(1)}%</b></span>
            </div>
          ))}
          {d.lowDs.length > 10 && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>+{d.lowDs.length - 10} outros</p>}
        </Panel>
      </div>
    </div>
  )
}

export default function VisaoGeral({ registry, dsDrivers, selectedDay, selectedShift }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'DISPONIVEL' | 'ATRIBUIDA'>('all')
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'dashboard' | 'tabela'>('dashboard')

  const routes = useMemo(() => routeStore.get(selectedDay, selectedShift) ?? [], [selectedDay, selectedShift])

  const registryMap = useMemo(() => new Map(registry.map(d => [d.id, d])), [registry])
  const dsMap = useMemo(() => new Map(dsDrivers.map(d => [d.driver_id, d])), [dsDrivers])

  const savedSets = useMemo(() => routeStore.list(), [selectedDay, selectedShift])

  const enriched = useMemo(() => routes.map(r => {
    const assignedReg = r.assignedDriverId ? registryMap.get(r.assignedDriverId) : null
    const assignedDs = r.assignedDriverId ? dsMap.get(r.assignedDriverId) : null
    const chosenVehicle = normalizeVehicle(assignedReg?.vehicleType ?? null)
    const needed = vehicleRequired(r)
    const acertividade = chosenVehicle ? chosenVehicle === needed : null
    return {
      ...r,
      vehicleRequired: needed,
      chosenVehicle,
      acertividade,
      ds: assignedDs?.DS_Real ?? null,
      phone: assignedReg?.phoneNumber ?? null,
    }
  }), [routes, registryMap, dsMap])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const result = enriched.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.atId.toLowerCase().includes(q) ||
        (r.gaiola ?? '').toLowerCase().startsWith(q) ||
        r.cluster.toLowerCase().includes(q) ||
        (r.cidade ?? '').toLowerCase().includes(q) ||
        (r.assignedDriverName ?? '').toLowerCase().includes(q) ||
        (r.assignedDriverId ?? '').includes(q)
      )
    })
    return result.sort((a, b) => compareGaiola(a.gaiola, b.gaiola))
  }, [enriched, search, statusFilter])

  const stats = useMemo(() => ({
    total: enriched.length,
    atribuidas: enriched.filter(r => r.status === 'ATRIBUIDA').length,
    acertos: enriched.filter(r => r.acertividade === true).length,
    totalAcertividade: enriched.filter(r => r.acertividade !== null).length,
  }), [enriched])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Visão Geral das Rotas</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
              Análise detalhada por turno — {routes.length > 0 ? `${routes.length} rotas carregadas` : 'nenhuma rota carregada para este turno'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, overflow: 'hidden' }}>
              {(['dashboard', 'tabela'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={{ background: view === v ? 'rgba(99,102,241,.2)' : 'transparent', color: view === v ? '#a5b4fc' : '#64748b', border: 'none', padding: '5px 14px', fontSize: 12, fontWeight: view === v ? 700 : 400, cursor: 'pointer' }}>
                  {v === 'dashboard' ? '📊 Dashboard' : '☰ Tabela'}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#64748b' }}>{selectedDay}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: SHIFT_COLOR[selectedShift], background: `${SHIFT_COLOR[selectedShift]}18`, border: `1px solid ${SHIFT_COLOR[selectedShift]}44`, borderRadius: 6, padding: '3px 10px' }}>{selectedShift}</span>
          </div>
        </div>
      </div>


      {routes.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
          <p style={{ color: '#8892a4', fontSize: 14 }}>Nenhuma rota carregada para <strong style={{ color: SHIFT_COLOR[selectedShift] }}>{selectedShift}</strong> de <strong style={{ color: '#e2e8f0' }}>{selectedDay}</strong></p>
          <p style={{ color: '#64748b', fontSize: 12 }}>Cole a roteirização na tela de Atribuição para salvar as rotas deste turno.</p>
        </div>
      ) : view === 'dashboard' ? (
        <RouteDashboard rows={enriched} onOpenTable={(q, status) => { setSearch(q); setStatusFilter(status); setView('tabela') }} />
      ) : (
        <>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid #1e2130', flexShrink: 0, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', value: stats.total, color: '#94a3b8' },
              { label: 'Atribuídas', value: `${stats.atribuidas} (${stats.total ? Math.round(stats.atribuidas / stats.total * 100) : 0}%)`, color: '#4ade80' },
              { label: 'Disponíveis', value: stats.total - stats.atribuidas, color: '#60a5fa' },
              { label: 'Acertividade', value: stats.totalAcertividade > 0 ? `${Math.round(stats.acertos / stats.totalAcertividade * 100)}%` : '—', color: '#a78bfa' },
            ].map(s => (
              <div key={s.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '6px 14px', minWidth: 90 }}>
                <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{s.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ padding: '8px 20px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, borderBottom: '1px solid #1e2130', flexWrap: 'wrap' }}>
            <input
              placeholder="🔍  Buscar AT, cluster, cidade, motorista..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 300, fontSize: 12, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 12px', outline: 'none' }}
            />
            {(['all', 'DISPONIVEL', 'ATRIBUIDA'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} style={{ border: `1px solid ${statusFilter === f ? '#7c3aed' : '#2d3048'}`, background: statusFilter === f ? 'rgba(124,58,237,.15)' : 'transparent', color: statusFilter === f ? '#a78bfa' : '#8892a4', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                {f === 'all' ? 'Todas' : f === 'DISPONIVEL' ? 'Disponíveis' : 'Atribuídas'}
              </button>
            ))}
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>{filtered.length} rota{filtered.length !== 1 ? 's' : ''}</span>
            <div style={{ marginLeft: 'auto' }}>
              {(() => {
                const phones = [...new Set(
                  filtered
                    .filter(r => r.status === 'ATRIBUIDA' && r.phone)
                    .map(r => r.phone!.replace(/\D/g, ''))
                    .filter(p => p.length >= 8)
                )]
                return (
                  <button
                    disabled={phones.length === 0}
                    onClick={() => {
                      navigator.clipboard.writeText(phones.join('\n'))
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    style={{ background: copied ? 'rgba(34,197,94,.15)' : phones.length === 0 ? '#1a1d27' : 'rgba(59,130,246,.12)', color: copied ? '#4ade80' : phones.length === 0 ? '#4a5568' : '#60a5fa', border: `1px solid ${copied ? 'rgba(34,197,94,.3)' : phones.length === 0 ? '#2d3048' : 'rgba(59,130,246,.3)'}`, borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: phones.length === 0 ? 'default' : 'pointer', transition: 'all .15s' }}
                  >
                    {copied ? '✓ Copiado!' : `📋 Copiar telefones (${phones.length})`}
                  </button>
                )
              })()}
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #2d3048' }}>
                  {['AT', 'Gaiola', 'Cluster', 'Cidade', 'Paradas', 'KM', 'SPR', 'Volume', 'GG', 'Veíc. Prog.', 'ID Driver', 'Nome Driver', 'DS', 'Status', 'Veíc. Nec.', 'Veíc. Esc.', 'Acertividade', 'Telefone'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={18} style={{ padding: '3rem', textAlign: 'center', color: '#8892a4' }}>Nenhuma rota encontrada.</td></tr>
                ) : filtered.map(r => {
                  const dsVal = r.ds !== null ? (r.ds * 100).toFixed(1) : null
                  const dsColor = r.ds === null ? '#64748b' : r.ds * 100 >= 95 ? '#4ade80' : '#f87171'
                  const acertColor = r.acertividade === true ? '#4ade80' : r.acertividade === false ? '#f87171' : '#64748b'

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #1e2130', background: r.status === 'ATRIBUIDA' ? 'rgba(34,197,94,.02)' : r.isInterior ? 'rgba(245,158,11,.02)' : 'transparent' }}>
                      <td style={TD}><span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0', fontSize: 11 }}>{r.atId}</span></td>
                      <td style={{ ...TD, color: '#94a3b8' }}>{r.gaiola || '—'}</td>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {r.isInterior && <span style={{ fontSize: 9 }}>📍</span>}
                          <span style={{ color: '#e2e8f0' }}>{r.cluster || '—'}</span>
                        </div>
                      </td>
                      <td style={{ ...TD, color: '#94a3b8' }}>{r.cidade || '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: '#e2e8f0' }}>{r.paradas ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: '#94a3b8' }}>{r.km !== null ? r.km.toFixed(1) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: '#94a3b8' }}>{r.spr ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: r.volume !== null && r.volume > 700 ? '#fbbf24' : '#94a3b8' }}>{r.volume ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: r.gg !== null && r.gg > 1 ? '#fbbf24' : '#94a3b8' }}>{r.gg ?? '—'}</td>
                      <td style={TD}>{r.scheduledVehicle ? <Chip label={r.scheduledVehicle} small /> : <span style={{ color: '#64748b' }}>—</span>}</td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 10, color: '#8892a4' }}>{r.assignedDriverId || '—'}</td>
                      <td style={TD}><span style={{ color: r.assignedDriverName ? '#e2e8f0' : '#64748b' }}>{r.assignedDriverName || '—'}</span></td>
                      <td style={TD}>{dsVal ? <span style={{ fontWeight: 600, color: dsColor }}>{dsVal}%</span> : <span style={{ color: '#64748b' }}>—</span>}</td>
                      <td style={TD}>
                        {r.status === 'ATRIBUIDA'
                          ? <Chip label="Atribuída" color="#4ade80" bg="rgba(34,197,94,.1)" small />
                          : <Chip label="Disponível" color="#60a5fa" bg="rgba(59,130,246,.08)" small />}
                      </td>
                      <td style={TD}><Chip label={r.vehicleRequired} color={r.vehicleRequired === 'FIORINO' ? '#fbbf24' : r.vehicleRequired === 'MOTO' ? '#f472b6' : '#94a3b8'} bg={r.vehicleRequired === 'FIORINO' ? 'rgba(251,191,36,.1)' : r.vehicleRequired === 'MOTO' ? 'rgba(244,114,182,.1)' : 'rgba(100,116,139,.1)'} small /></td>
                      <td style={TD}>{r.chosenVehicle ? <Chip label={r.chosenVehicle} small /> : <span style={{ color: '#64748b' }}>—</span>}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>
                        {r.acertividade === null
                          ? <span style={{ color: '#64748b' }}>—</span>
                          : <span style={{ fontWeight: 700, color: acertColor }}>{r.acertividade ? '✓' : '✗'}</span>}
                      </td>
                      <td style={TD}>
                        {r.phone
                          ? <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#8892a4' }}>{r.phone}</span>
                              <a href={`https://wa.me/55${r.phone.replace(/\D/g, '')}?text=Ol%C3%A1%2C+tudo+bem%3F`} target="_blank" rel="noreferrer" style={{ color: '#4ade80', fontSize: 11, textDecoration: 'none' }}>WhatsApp</a>
                            </div>
                          : <span style={{ color: '#64748b' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
