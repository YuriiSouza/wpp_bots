import { useMemo, useState, useRef, useCallback, useEffect, Fragment } from 'react'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import type { StoredDriver } from '../../lib/localStore'
import type { DriverResult } from '../../lib/types'
import type { CallUpAnalysis } from '../../lib/callUpParser'
import type { ForwardOrderAnalysis } from '../../lib/forwardOrderParser'
import type { Shift } from '../../lib/globalConfig'
import { getGlobalConfig, driverMatchesShift, calcRodizio } from '../../lib/globalConfig'
import { calculatePriorityScore, daysSinceLastRoute } from '../../lib/priorityScore'

// ─── manual blocklist (shared key) ───────────────────────────────────────────
const MANUAL_BLOCKS_KEY = 'spx:noshow-manual-blocks'
function getManualBlockIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MANUAL_BLOCKS_KEY)
    const blocks: { driverId: string }[] = raw ? JSON.parse(raw) : []
    return new Set(blocks.map(b => b.driverId))
  } catch { return new Set() }
}

// ─── noshow routes (shared key, date-based) ───────────────────────────────────
function getAssignedAtId(driverId: string, day: string): string | null {
  try {
    const raw = localStorage.getItem(`spx:noshow-routes-${day}`)
    if (!raw) return null
    const routes: { assignedDriverId: string | null; atId: string; status: string }[] = JSON.parse(raw)
    const r = routes.find(r => r.assignedDriverId === driverId && r.status === 'ATRIBUIDA')
    return r?.atId ?? null
  } catch { return null }
}

// ─── types ────────────────────────────────────────────────────────────────────
type DriverStatus = 'DISPONÍVEL' | 'DOBRA' | 'INDISPONÍVEL' | 'BLOQUEADO' | 'URGENTE'
type Rodizio = 'BAIXA' | 'MÉDIA' | 'ALTA'

interface EnrichedDriver {
  driverId: string
  nome: string
  tipoVeiculo: string | null
  phoneNumber: string | null
  status: DriverStatus
  rodizio: Rodizio
  ultimaViagem: string | null
  ds: number | null
  progressaoDs: string | null
  clusters: string[]
  novato: boolean
  numeroRotas: number
  noshow: number
  declines: number
  declineRate: number
  isBlocked: boolean
  slots: string[]
  priorityScore: number
  daysSinceRoute: number
}

const STATUS_META: Record<DriverStatus, { label: string; color: string; bg: string }> = {
  'DISPONÍVEL':   { label: 'Disponível',   color: '#4ade80', bg: 'rgba(34,197,94,.12)' },
  'DOBRA':        { label: 'Dobra',        color: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
  'INDISPONÍVEL': { label: 'Indisponível', color: '#f87171', bg: 'rgba(239,68,68,.12)' },
  'BLOQUEADO':    { label: 'Bloqueado',    color: '#a78bfa', bg: 'rgba(139,92,246,.12)' },
  'URGENTE':      { label: 'Urgente',      color: '#fb923c', bg: 'rgba(249,115,22,.12)' },
}

const ROD_META: Record<Rodizio, { color: string }> = {
  BAIXA: { color: '#4ade80' },
  MÉDIA: { color: '#fbbf24' },
  ALTA:  { color: '#f87171' },
}

// ─── ui primitives ────────────────────────────────────────────────────────────
function Chip({ label, color = '#94a3b8', bg = 'rgba(100,116,139,.1)', small }: { label: string; color?: string; bg?: string; small?: boolean }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}33`, borderRadius: 5, padding: small ? '1px 5px' : '2px 7px', fontSize: small ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ─── whatsapp ─────────────────────────────────────────────────────────────────
function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const num = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${num}`
}

// ─── props ────────────────────────────────────────────────────────────────────
interface Props {
  data: WorkPreferenceData
  registry: StoredDriver[]
  dsDrivers: DriverResult[]
  callUp: CallUpAnalysis | null
  forwardOrder: ForwardOrderAnalysis | null
  selectedDay: string
  selectedShift: Shift
}

const BATCH = 40

// ─── Dashboard ────────────────────────────────────────────────────────────────

// Donut chart SVG (pure, no deps)
function DonutChart({ slices, size = 120, thickness = 22 }: {
  slices: { value: number; color: string; label: string }[]
  size?: number
  thickness?: number
}) {
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2130" strokeWidth={thickness} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#4b5563" fontSize={11}>—</text>
      </svg>
    )
  }
  let offset = 0
  const gap = total > 1 ? 2 : 0 // gap in units
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2130" strokeWidth={thickness} />
      {slices.filter(s => s.value > 0).map((s, i) => {
        const dash = ((s.value - gap) / total) * circ
        const space = circ - dash
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={thickness}
            strokeDasharray={`${Math.max(0, dash)} ${space}`}
            strokeDashoffset={-offset * circ / total}
            strokeLinecap="round"
          />
        )
        offset += s.value
        return el
      })}
    </svg>
  )
}

// Horizontal bar chart
function HBarChart({ items, maxVal }: { items: { label: string; value: number; color: string }[]; maxVal: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={item.label}>{item.label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: item.color }}>{item.value}</span>
          </div>
          <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${maxVal > 0 ? (item.value / maxVal) * 100 : 0}%`, height: '100%', background: item.color, borderRadius: 3, transition: 'width .4s ease' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Semi-circle gauge (0-100)
function Gauge({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 50; const cx = 60; const cy = 60
  const circ = Math.PI * r // semi-circle
  const dash = (value / 100) * circ
  return (
    <svg width={120} height={68} viewBox="0 0 120 68">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e2130" strokeWidth={12} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`} style={{ transition: 'stroke-dasharray .5s ease' }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#e2e8f0" fontSize={16} fontWeight="700">{value.toFixed(0)}%</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#64748b" fontSize={9}>{label}</text>
    </svg>
  )
}

// ─── Cluster × Veículo matrix ─────────────────────────────────────────────────
const VEHICLE_ORDER = ['FIORINO', 'MOTO', 'PASSEIO', 'VAN']
const VEHICLE_COLOR_MAP: Record<string, string> = { FIORINO: '#f59e0b', MOTO: '#10b981', PASSEIO: '#3b82f6', VAN: '#6366f1' }

function ClusterVehicleMatrix({ drivers }: { drivers: EnrichedDriver[] }) {
  const available = drivers.filter(d => d.status === 'DISPONÍVEL' || d.status === 'URGENTE')

  // cluster → vehicle → count
  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const d of available) {
      const v = (d.tipoVeiculo?.toUpperCase() ?? 'OUTRO')
      for (const c of d.clusters) {
        if (!m.has(c)) m.set(c, new Map())
        const row = m.get(c)!
        row.set(v, (row.get(v) ?? 0) + 1)
      }
    }
    return m
  }, [available])

  // vehicles present across all clusters
  const vehicles = useMemo(() => {
    const set = new Set<string>()
    for (const row of matrix.values()) for (const v of row.keys()) set.add(v)
    const ordered = VEHICLE_ORDER.filter(v => set.has(v))
    for (const v of set) if (!VEHICLE_ORDER.includes(v)) ordered.push(v)
    return ordered
  }, [matrix])

  // sort clusters by total desc
  const clusters = useMemo(() =>
    [...matrix.entries()]
      .map(([c, row]) => ({ cluster: c, total: [...row.values()].reduce((a, b) => a + b, 0), row }))
      .sort((a, b) => b.total - a.total)
  , [matrix])

  if (clusters.length === 0) return null

  const maxTotal = clusters[0].total

  return (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px', gridColumn: '1 / -1' }}>
      <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        Disponíveis por cluster e tipo de veículo
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 400 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontSize: 10, color: '#4b5563', fontWeight: 600, padding: '0 12px 8px 0', whiteSpace: 'nowrap' }}>Cluster</th>
              {vehicles.map(v => (
                <th key={v} style={{ textAlign: 'center', fontSize: 10, color: VEHICLE_COLOR_MAP[v] ?? '#94a3b8', fontWeight: 700, padding: '0 10px 8px', whiteSpace: 'nowrap' }}>{v}</th>
              ))}
              <th style={{ textAlign: 'right', fontSize: 10, color: '#4b5563', fontWeight: 600, padding: '0 0 8px 10px' }}>Total</th>
              <th style={{ width: 120, padding: '0 0 8px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {clusters.map(({ cluster, total, row }) => (
              <tr key={cluster} style={{ borderTop: '1px solid #1e2130' }}>
                <td style={{ padding: '6px 12px 6px 0', fontSize: 11, color: '#e2e8f0', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={cluster}>
                  {cluster}
                </td>
                {vehicles.map(v => {
                  const n = row.get(v) ?? 0
                  return (
                    <td key={v} style={{ textAlign: 'center', padding: '6px 10px', fontSize: 13, fontWeight: n > 0 ? 700 : 400, color: n > 0 ? (VEHICLE_COLOR_MAP[v] ?? '#94a3b8') : '#2d3048' }}>
                      {n > 0 ? n : '—'}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'right', padding: '6px 0 6px 10px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{total}</td>
                <td style={{ padding: '6px 0 6px 10px', minWidth: 100 }}>
                  {/* stacked bar */}
                  <div style={{ height: 8, background: '#1e2130', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    {vehicles.map(v => {
                      const n = row.get(v) ?? 0
                      if (n === 0) return null
                      return <div key={v} style={{ width: `${(n / maxTotal) * 100}%`, height: '100%', background: VEHICLE_COLOR_MAP[v] ?? '#94a3b8', transition: 'width .3s' }} />
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashboardView({ drivers }: { drivers: EnrichedDriver[] }) {
  const total = drivers.length
  const disponivel = drivers.filter(d => d.status === 'DISPONÍVEL').length

  const byVehicle = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of drivers) {
      const v = d.tipoVeiculo?.toUpperCase() || 'SEM VEÍCULO'
      m.set(v, (m.get(v) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [drivers])

  const VEHICLE_COLOR: Record<string, string> = { VAN: '#6366f1', FIORINO: '#f59e0b', MOTO: '#10b981', PASSEIO: '#3b82f6', 'SEM VEÍCULO': '#4b5563' }

  const statusSlices = useMemo(() => [
    { label: 'Disponível', value: drivers.filter(d => d.status === 'DISPONÍVEL').length,  color: '#4ade80' },
    { label: 'Dobra',      value: drivers.filter(d => d.status === 'DOBRA').length,        color: '#fbbf24' },
    { label: 'Urgente',    value: drivers.filter(d => d.status === 'URGENTE').length,      color: '#fb923c' },
    { label: 'Bloqueado',  value: drivers.filter(d => d.status === 'BLOQUEADO').length,    color: '#a78bfa' },
  ], [drivers])

  const rodizioSlices = useMemo(() => [
    { label: 'BAIXA', value: drivers.filter(d => d.rodizio === 'BAIXA').length, color: '#4ade80' },
    { label: 'MÉDIA', value: drivers.filter(d => d.rodizio === 'MÉDIA').length, color: '#fbbf24' },
    { label: 'ALTA',  value: drivers.filter(d => d.rodizio === 'ALTA').length,  color: '#f87171' },
  ], [drivers])

  const vehicleSlices = useMemo(() =>
    byVehicle.map(([v, n]) => ({ label: v, value: n, color: VEHICLE_COLOR[v] ?? '#94a3b8' }))
  , [byVehicle])

  const dsRanges = useMemo(() => {
    const sem  = drivers.filter(d => d.ds === null).length
    const low  = drivers.filter(d => d.ds !== null && d.ds * 100 < 30).length
    const mid  = drivers.filter(d => d.ds !== null && d.ds * 100 >= 30 && d.ds * 100 < 70).length
    const good = drivers.filter(d => d.ds !== null && d.ds * 100 >= 70 && d.ds * 100 < 90).length
    const exc  = drivers.filter(d => d.ds !== null && d.ds * 100 >= 90).length
    return [
      { label: 'Excelente ≥90%', value: exc,  color: '#4ade80' },
      { label: 'Bom 70–89%',     value: good, color: '#a3e635' },
      { label: 'Médio 30–69%',   value: mid,  color: '#fbbf24' },
      { label: 'Baixo <30%',     value: low,  color: '#f87171' },
      { label: 'Sem DS',         value: sem,  color: '#4b5563' },
    ]
  }, [drivers])

  const scoreItems = useMemo(() => [
    { label: 'Alto ≥70',    value: drivers.filter(d => d.priorityScore >= 70).length,                             color: '#4ade80' },
    { label: 'Médio 40–69', value: drivers.filter(d => d.priorityScore >= 40 && d.priorityScore < 70).length,    color: '#fbbf24' },
    { label: 'Baixo <40',   value: drivers.filter(d => d.priorityScore < 40).length,                              color: '#f87171' },
  ], [drivers])

  const noShowItems = useMemo(() => [
    { label: 'Sem noshow',   value: drivers.filter(d => d.noshow === 0).length,                              color: '#4ade80' },
    { label: '1–2 noshows', value: drivers.filter(d => d.noshow >= 1 && d.noshow <= 2).length,              color: '#fbbf24' },
    { label: '3–5 noshows', value: drivers.filter(d => d.noshow >= 3 && d.noshow <= 5).length,              color: '#f97316' },
    { label: '6+ noshows',  value: drivers.filter(d => d.noshow > 5).length,                                color: '#f87171' },
  ], [drivers])

  const diasItems = useMemo(() => {
    const withHist = drivers.filter(d => d.daysSinceRoute < 9999)
    return [
      { label: '0–1 dia',      value: withHist.filter(x => x.daysSinceRoute <= 1).length,                           color: '#4ade80' },
      { label: '2–3 dias',     value: withHist.filter(x => x.daysSinceRoute >= 2 && x.daysSinceRoute <= 3).length,  color: '#a3e635' },
      { label: '4–7 dias',     value: withHist.filter(x => x.daysSinceRoute >= 4 && x.daysSinceRoute <= 7).length,  color: '#fbbf24' },
      { label: '8–14 dias',    value: withHist.filter(x => x.daysSinceRoute >= 8 && x.daysSinceRoute <= 14).length, color: '#f97316' },
      { label: '+14 dias',     value: withHist.filter(x => x.daysSinceRoute > 14).length,                           color: '#f87171' },
      { label: 'Sem histórico',value: drivers.filter(x => x.daysSinceRoute === 9999).length,                         color: '#374151' },
    ]
  }, [drivers])

  const topClusters = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of drivers.filter(d => d.status === 'DISPONÍVEL')) {
      for (const c of d.clusters) m.set(c, (m.get(c) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [drivers])

  const dsAvg = useMemo(() => {
    const withDs = drivers.filter(d => d.ds !== null)
    if (withDs.length === 0) return null
    return withDs.reduce((s, d) => s + d.ds! * 100, 0) / withDs.length
  }, [drivers])

  const scoreAvg = total > 0 ? drivers.reduce((s, d) => s + d.priorityScore, 0) / total : 0

  const Section = ({ title, children, span2 }: { title: string; children: React.ReactNode; span2?: boolean }) => (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px', gridColumn: span2 ? 'span 2' : undefined }}>
      <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</p>
      {children}
    </div>
  )

  const Legend = ({ slices }: { slices: { label: string; value: number; color: string }[] }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      {slices.filter(s => s.value > 0).map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>{s.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.value}</span>
          <span style={{ fontSize: 10, color: '#4b5563', minWidth: 32, textAlign: 'right' }}>{total > 0 ? ((s.value / total) * 100).toFixed(0) : 0}%</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignContent: 'start' }}>

      {/* Status — donut */}
      <Section title={`Status — ${total} motoristas`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <DonutChart slices={statusSlices} size={110} thickness={20} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: '#4ade80', lineHeight: 1 }}>{disponivel}</span>
              <span style={{ fontSize: 9, color: '#64748b' }}>disponíveis</span>
            </div>
          </div>
          <Legend slices={statusSlices} />
        </div>
      </Section>

      {/* Rodízio — donut */}
      <Section title="Rodízio">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <DonutChart slices={rodizioSlices} size={110} thickness={20} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            {rodizioSlices.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Veículos — donut */}
      <Section title="Tipo de veículo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <DonutChart slices={vehicleSlices} size={110} thickness={20} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
            {vehicleSlices.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* DS Score — gauge + barras */}
      <Section title="DS Score">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {dsAvg !== null
            ? <Gauge value={dsAvg} color={dsAvg >= 90 ? '#4ade80' : dsAvg >= 70 ? '#a3e635' : dsAvg >= 30 ? '#fbbf24' : '#f87171'} label="média DS" />
            : <span style={{ fontSize: 12, color: '#4b5563' }}>Sem dados DS</span>}
          <HBarChart items={dsRanges} maxVal={total} />
        </div>
      </Section>

      {/* Score de prioridade — gauge + barras */}
      <Section title="Score de prioridade">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Gauge value={Math.min(scoreAvg, 100)} color={scoreAvg >= 70 ? '#4ade80' : scoreAvg >= 40 ? '#fbbf24' : '#f87171'} label="média score" />
          <HBarChart items={scoreItems} maxVal={total} />
        </div>
      </Section>

      {/* Dias sem rota — barras */}
      <Section title="Dias sem rota">
        <HBarChart items={diasItems} maxVal={total} />
      </Section>

      {/* NoShow — barras */}
      <Section title="NoShow (timeouts)">
        <HBarChart items={noShowItems} maxVal={total} />
      </Section>

      {/* Top clusters — barras horizontais largas */}
      <Section title={`Top clusters disponíveis (${disponivel} moto.)`} span2>
        {topClusters.length === 0
          ? <p style={{ margin: 0, fontSize: 12, color: '#4b5563' }}>Nenhum dado</p>
          : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
              {topClusters.map(([cluster, n]) => (
                <div key={cluster}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }} title={cluster}>{cluster}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>{n}</span>
                  </div>
                  <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(n / (topClusters[0]?.[1] ?? 1)) * 100}%`, height: '100%', background: '#7c3aed', borderRadius: 3, transition: 'width .4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
        }
      </Section>

      {/* Disponibilidade por cluster × veículo */}
      <ClusterVehicleMatrix drivers={drivers} />

    </div>
  )
}

export default function Disponibilidade({ data, registry, dsDrivers, callUp, forwardOrder, selectedDay, selectedShift }: Props) {
  const [activeView, setActiveView] = useState<'lista' | 'dashboard'>('lista')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<DriverStatus>>(new Set())
  const [rodizioFilter, setRodizioFilter] = useState<Set<Rodizio>>(new Set())
  const [vehicleFilter, setVehicleFilter] = useState<Set<string>>(new Set())
  const [clusterFilter, setClusterFilter] = useState<Set<string>>(new Set())
  const [scoreFilter, setScoreFilter] = useState<Set<'high' | 'mid' | 'low'>>(new Set())
  const [showNewOnly, setShowNewOnly] = useState(false)
  const [showWithPhone, setShowWithPhone] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [copiedFiltered, setCopiedFiltered] = useState(false)
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null)
  const [visible, setVisible] = useState(BATCH)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [cfg, setCfg] = useState(() => getGlobalConfig())
  useEffect(() => {
    const refresh = () => setCfg(getGlobalConfig())
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const drivers = useMemo((): EnrichedDriver[] => {
    const regMap = new Map(registry.map(d => [d.id, d]))
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const callUpMap = new Map(callUp?.byDriver.map(d => [d.driverId, d]) ?? [])
    const fwdMap = new Map(forwardOrder?.allDrivers.map(d => [d.driverId, d]) ?? [])
    const manualBlockIds = getManualBlockIds()

    return data.drivers
      .filter(d => {
        const sched = d.schedule[selectedDay]
        if (!sched || sched.status !== 'available') return false
        return driverMatchesShift(sched.slots, selectedShift, cfg)
      })
      .map(d => {
        const reg = regMap.get(d.driverId)
        const ds = dsMap.get(d.driverId)
        const cu = callUpMap.get(d.driverId)
        const fwd = fwdMap.get(d.driverId)

        const isRegistryBlocked = reg?.spxBlocklisted ?? false
        const isManualBlocked = manualBlockIds.has(d.driverId)
        const isAutoBlocked = (fwd?.totalPackages ?? 0) > 5
        const isBlocked = isRegistryBlocked || isManualBlocked || isAutoBlocked

        // Last trip = last accepted call date from CallUp
        const ultimaViagem = cu?.lastAcceptedDate ?? null
        const rodizio = calcRodizio(ultimaViagem, cfg)

        // INDISPONÍVEL: aceitou rota no próprio turno atual
        const acceptedCurrentShift = (callUp?.acceptedByDateShift[`${selectedDay}|${selectedShift}`] ?? []).includes(d.driverId)
        // DOBRA: aceitou rota em turno anterior do mesmo dia
        const prevShifts: Shift[] = selectedShift === 'PM2' ? ['AM', 'PM1'] : selectedShift === 'PM1' ? ['AM'] : []
        const isDobra = !acceptedCurrentShift && prevShifts.some(s => (callUp?.acceptedByDateShift[`${selectedDay}|${s}`] ?? []).includes(d.driverId))

        let status: DriverStatus = 'DISPONÍVEL'
        if (isBlocked) status = 'BLOQUEADO'
        else if (acceptedCurrentShift) status = 'INDISPONÍVEL'
        else if (isDobra) status = 'DOBRA'

        const dsReal = ds?.DS_Real ?? null
        const dsPercent = dsReal !== null ? dsReal * 100 : 50
        const declineCount = cu?.declined ?? 0
        const noShowCount = cu?.timeoutCount ?? 0
        const priorityScore = calculatePriorityScore(dsPercent, declineCount, noShowCount, cfg.scoreWeights)
        const daysSinceRoute = daysSinceLastRoute(ultimaViagem)

        return {
          driverId: d.driverId,
          nome: d.driverName || reg?.name || d.driverId,
          tipoVeiculo: d.vehicleType || reg?.vehicleType || null,
          phoneNumber: reg?.phoneNumber || null,
          status,
          rodizio,
          ultimaViagem,
          ds: dsReal,
          progressaoDs: ds?.Status ?? null,
          clusters: d.clusters,
          novato: d.isNewDriver,
          numeroRotas: ds?.route_count ?? 0,
          noshow: d.noShowTime ?? 0,
          declines: declineCount,
          declineRate: cu && cu.total > 0 ? Math.round((cu.declined / cu.total) * 100) : 0,
          isBlocked,
          slots: d.schedule[selectedDay]?.slots ?? [],
          priorityScore,
          daysSinceRoute,
        }
      })
      .sort((a, b) => {
        const vOrder = (v: string | null) => { if (!v) return 5; const s = v.toUpperCase(); if (s === 'VAN') return 0; if (s === 'FIORINO') return 1; if (s === 'MOTO') return 2; if (s === 'PASSEIO') return 3; return 4 }
        const vd = vOrder(a.tipoVeiculo) - vOrder(b.tipoVeiculo)
        if (vd !== 0) return vd
        // Within same vehicle type: DS desc, then score desc
        const aDs = a.ds ?? -1
        const bDs = b.ds ?? -1
        if (aDs !== bDs) return bDs - aDs
        return b.priorityScore - a.priorityScore
      })
  }, [data, registry, dsDrivers, callUp, forwardOrder, selectedDay, selectedShift, cfg])

  const vehicles = useMemo(() => ['all', ...new Set(drivers.map(d => d.tipoVeiculo).filter((v): v is string => !!v).sort())], [drivers])
  const clusters = useMemo(() => ['all', ...new Set(drivers.flatMap(d => d.clusters).sort())], [drivers])

  function toggle<T>(set: Set<T>, val: T): Set<T> {
    const n = new Set(set)
    n.has(val) ? n.delete(val) : n.add(val)
    return n
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => {
      if (statusFilter.size > 0 && !statusFilter.has(d.status)) return false
      if (rodizioFilter.size > 0 && !rodizioFilter.has(d.rodizio)) return false
      if (vehicleFilter.size > 0 && !vehicleFilter.has(d.tipoVeiculo ?? '')) return false
      if (clusterFilter.size > 0 && !d.clusters.some(c => clusterFilter.has(c))) return false
      if (scoreFilter.size > 0) {
        const inHigh = d.priorityScore >= 70
        const inMid  = d.priorityScore >= 40 && d.priorityScore < 70
        const inLow  = d.priorityScore < 40
        const match = (scoreFilter.has('high') && inHigh) || (scoreFilter.has('mid') && inMid) || (scoreFilter.has('low') && inLow)
        if (!match) return false
      }
      if (showNewOnly && !d.novato) return false
      if (showWithPhone && !d.phoneNumber) return false
      if (q && !d.driverId.includes(q) && !d.nome.toLowerCase().includes(q)) return false
      return true
    })
  }, [drivers, search, statusFilter, rodizioFilter, vehicleFilter, clusterFilter, scoreFilter, showNewOnly, showWithPhone])


  // Reset visible count when filters change
  useEffect(() => { setVisible(BATCH) }, [filtered])

  // Infinite scroll via IntersectionObserver
  const loadMore = useCallback(() => setVisible(v => Math.min(v + BATCH, filtered.length)), [filtered.length])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const paged = filtered.slice(0, visible)

  const stats = useMemo(() => ({
    total: drivers.length,
    disponivel: drivers.filter(d => d.status === 'DISPONÍVEL').length,
    dobra: drivers.filter(d => d.status === 'DOBRA').length,
    indisponivel: drivers.filter(d => d.status === 'INDISPONÍVEL').length,
    bloqueado: drivers.filter(d => d.status === 'BLOQUEADO').length,
    urgente: drivers.filter(d => d.status === 'URGENTE').length,
    rodAlt: drivers.filter(d => d.rodizio === 'ALTA').length,
  }), [drivers])

  const handleCopyPhones = async () => {
    const available = drivers.filter(d => d.status === 'DISPONÍVEL' || d.status === 'URGENTE')
    const phones = available.map(d => d.phoneNumber).filter(Boolean).join('\n')
    if (phones) await navigator.clipboard.writeText(phones)
  }

  const handleCopyFiltered = async () => {
    const phones = filtered.map(d => d.phoneNumber).filter(Boolean).join('\n')
    if (!phones) return
    await navigator.clipboard.writeText(phones)
    setCopiedFiltered(true)
    setTimeout(() => setCopiedFiltered(false), 2000)
  }

  const formatDs = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`
  const dsColor = (v: number | null) => {
    if (v === null) return '#64748b'
    const p = Math.round(v * 100)
    if (p < 30) return '#f87171'
    if (p < 70) return '#fbbf24'
    if (p < 90) return '#a3e635'
    return '#4ade80'
  }

  const fmtDate = (raw: string | null) => {
    if (!raw) return '—'
    // YYYY-MM-DD → DD/MM/YYYY
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[3]}/${m[2]}/${m[1]}`
    return raw.slice(0, 10)
  }

  const hasActiveFilters = statusFilter.size > 0 || rodizioFilter.size > 0 || vehicleFilter.size > 0 ||
    clusterFilter.size > 0 || scoreFilter.size > 0 || showNewOnly || showWithPhone || !!search

  const clearFilters = () => {
    setSearch(''); setStatusFilter(new Set()); setRodizioFilter(new Set())
    setVehicleFilter(new Set()); setClusterFilter(new Set()); setScoreFilter(new Set())
    setShowNewOnly(false); setShowWithPhone(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px 0', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Disponibilidade</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
              {drivers.length} motorista{drivers.length !== 1 ? 's' : ''} no turno · {data.fileName}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Vista toggle */}
            <div style={{ display: 'flex', background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, overflow: 'hidden' }}>
              {(['lista', 'dashboard'] as const).map(v => (
                <button key={v} onClick={() => setActiveView(v)}
                  style={{ background: activeView === v ? 'rgba(99,102,241,.2)' : 'transparent', color: activeView === v ? '#a5b4fc' : '#64748b', border: 'none', padding: '5px 14px', fontSize: 12, fontWeight: activeView === v ? 700 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {v === 'lista' ? '☰ Lista' : '📊 Dashboard'}
                </button>
              ))}
            </div>
            <button onClick={handleCopyPhones} style={{ background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.3)', color: '#60a5fa', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              📋 Copiar números
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {([
            { key: 'all',           label: 'No turno',      value: stats.total,         color: '#60a5fa', bg: 'rgba(59,130,246,.08)' },
            { key: 'DISPONÍVEL',    label: 'Disponíveis',   value: stats.disponivel,    color: '#4ade80', bg: 'rgba(34,197,94,.08)' },
            { key: 'DOBRA',         label: 'Dobra',         value: stats.dobra,         color: '#fbbf24', bg: 'rgba(245,158,11,.08)' },
            { key: 'INDISPONÍVEL',  label: 'Indisponíveis', value: stats.indisponivel,  color: '#f87171', bg: 'rgba(239,68,68,.08)' },
            { key: 'BLOQUEADO',  label: 'Bloqueados',   value: stats.bloqueado,  color: '#a78bfa', bg: 'rgba(139,92,246,.08)' },
            { key: 'rod-alta',   label: 'Rodízio Alto', value: stats.rodAlt,     color: '#f87171', bg: 'rgba(239,68,68,.08)' },
          ] as const).map(c => (
            <div key={c.key}
              onClick={() => {
                if (c.key === 'all') { setStatusFilter(new Set()); setRodizioFilter(new Set()) }
                else if (c.key === 'rod-alta') setRodizioFilter(p => toggle(p, 'ALTA' as Rodizio))
                else setStatusFilter(p => toggle(p, c.key as DriverStatus))
              }}
              style={{ background: c.bg, border: `1px solid ${c.color}33`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', minWidth: 72 }}>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</p>
              <p style={{ margin: '1px 0 0', fontSize: 10, color: '#8892a4' }}>{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {activeView === 'dashboard' && <DashboardView drivers={drivers} />}

      {activeView === 'lista' && <>
      {/* Filters */}
      {(() => {
        const FC = ({ label, active, onClick, color = '#6366f1' }: { label: string; active: boolean; onClick: () => void; color?: string }) => (
          <button onClick={onClick} style={{
            background: active ? `${color}30` : 'rgba(255,255,255,.04)',
            border: `1px solid ${active ? color : '#2d3048'}`,
            color: active ? color : '#64748b',
            borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: active ? 700 : 400,
            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
          }}>{label}</button>
        )
        return (
          <div style={{ padding: '8px 20px', borderBottom: '1px solid #1e2130', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            {/* Row 1: search + copy */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                placeholder="Buscar motorista ou ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 210, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, outline: 'none' }}
              />
              <span style={{ fontSize: 12, color: '#8892a4', marginLeft: 4 }}>
                {filtered.length}{filtered.length !== drivers.length ? ` / ${drivers.length}` : ''} motoristas
              </span>
              {(() => {
                const activeCount = statusFilter.size + vehicleFilter.size + rodizioFilter.size + scoreFilter.size + clusterFilter.size + (showNewOnly ? 1 : 0) + (showWithPhone ? 1 : 0)
                return (
                  <button onClick={() => setShowFilters(v => !v)}
                    style={{ background: showFilters ? 'rgba(99,102,241,.15)' : 'transparent', border: `1px solid ${activeCount > 0 ? 'rgba(99,102,241,.5)' : '#2d3048'}`, color: activeCount > 0 ? '#a5b4fc' : '#8892a4', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    🎛 Filtros{activeCount > 0 ? ` (${activeCount})` : ''} {showFilters ? '▲' : '▼'}
                  </button>
                )
              })()}
              {hasActiveFilters && (
                <button onClick={clearFilters} style={{ background: 'transparent', border: '1px solid #2d3048', color: '#64748b', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                  ✕ Limpar
                </button>
              )}
              <button onClick={handleCopyFiltered}
                style={{ background: copiedFiltered ? 'rgba(34,197,94,.15)' : 'rgba(99,102,241,.1)', border: `1px solid ${copiedFiltered ? 'rgba(34,197,94,.4)' : 'rgba(99,102,241,.3)'}`, color: copiedFiltered ? '#4ade80' : '#a5b4fc', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                {copiedFiltered ? '✓ Copiado!' : `📋 Copiar números (${filtered.filter(d => d.phoneNumber).length})`}
              </button>
            </div>
            {showFilters && (<>
            {/* Row 2: status chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#4b5563', minWidth: 52 }}>Status</span>
              {(['DISPONÍVEL', 'DOBRA', 'INDISPONÍVEL', 'BLOQUEADO'] as DriverStatus[]).map(s => {
                const colors: Record<string, string> = { 'DISPONÍVEL': '#4ade80', 'DOBRA': '#fbbf24', 'INDISPONÍVEL': '#f87171', 'BLOQUEADO': '#a78bfa' }
                return <FC key={s} label={s} active={statusFilter.has(s)} onClick={() => setStatusFilter(toggle(statusFilter, s))} color={colors[s]} />
              })}
            </div>
            {/* Row 3: vehicle */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#4b5563', minWidth: 52 }}>Veículo</span>
              {vehicles.filter(v => v !== 'all').map(v => {
                const vc: Record<string, string> = { FIORINO: '#f59e0b', MOTO: '#10b981', PASSEIO: '#3b82f6', VAN: '#6366f1' }
                return <FC key={v} label={v} active={vehicleFilter.has(v)} onClick={() => setVehicleFilter(toggle(vehicleFilter, v))} color={vc[v] ?? '#94a3b8'} />
              })}
            </div>
            {/* Row 4: rodízio + score + cluster + extras */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#4b5563', minWidth: 52 }}>Rodízio</span>
              {(['BAIXA', 'MÉDIA', 'ALTA'] as Rodizio[]).map(r => {
                const rc: Record<string, string> = { BAIXA: '#4ade80', MÉDIA: '#fbbf24', ALTA: '#f87171' }
                return <FC key={r} label={r} active={rodizioFilter.has(r)} onClick={() => setRodizioFilter(toggle(rodizioFilter, r))} color={rc[r]} />
              })}
              <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 8, minWidth: 36 }}>Score</span>
              {([['high', 'Alto ≥70', '#4ade80'], ['mid', 'Médio 40–69', '#fbbf24'], ['low', 'Baixo <40', '#f87171']] as [string, string, string][]).map(([v, lbl, c]) =>
                <FC key={v} label={lbl} active={scoreFilter.has(v as 'high' | 'mid' | 'low')} onClick={() => setScoreFilter(toggle(scoreFilter, v as 'high' | 'mid' | 'low'))} color={c} />
              )}
              <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 8, minWidth: 48 }}>Cluster</span>
              <select value="" onChange={e => { if (e.target.value) setClusterFilter(toggle(clusterFilter, e.target.value)) }}
                style={{ background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', outline: 'none' }}>
                <option value="">Adicionar...</option>
                {clusters.filter(c => c !== 'all' && !clusterFilter.has(c)).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {[...clusterFilter].map(c => (
                <FC key={c} label={`${c} ✕`} active onClick={() => setClusterFilter(toggle(clusterFilter, c))} color="#a78bfa" />
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#8892a4', cursor: 'pointer', userSelect: 'none', marginLeft: 8 }}>
                <input type="checkbox" checked={showNewOnly} onChange={e => setShowNewOnly(e.target.checked)} /> Novatos
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#8892a4', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={showWithPhone} onChange={e => setShowWithPhone(e.target.checked)} /> Com telefone
              </label>
            </div>
            </>)}
          </div>
        )
      })()}

      {/* Table */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid #2d3048' }}>
              {['Motorista', 'Veículo', 'Status', 'Rodízio', 'DS', 'Score', 'Última viagem', 'Rotas', 'NoShow', 'Recusas', 'Clusters', 'Ações'].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={12} style={{ padding: '3rem', textAlign: 'center', color: '#8892a4' }}>
                Nenhum motorista disponível neste turno.
              </td></tr>
            ) : paged.map((d, i) => {
              const sm = STATUS_META[d.status]
              const rm = ROD_META[d.rodizio]
              const isExpanded = expandedDriver === d.driverId
              return (
                <Fragment key={d.driverId}>
                <tr onClick={() => setExpandedDriver(isExpanded ? null : d.driverId)} style={{ borderBottom: isExpanded ? 'none' : '1px solid #1e2130', background: isExpanded ? 'rgba(139,92,246,.06)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)', cursor: 'pointer' }}>
                  {/* Motorista */}
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{d.nome}</span>
                      {d.novato && <Chip label="Novo" color="#a78bfa" bg="rgba(139,92,246,.12)" small />}
                    </div>
                    <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{d.driverId}</p>
                    {d.slots.length > 0 && (
                      <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b' }}>{d.slots.join(' / ')}</p>
                    )}
                  </td>

                  {/* Veículo */}
                  <td style={TD}>{d.tipoVeiculo ? <Chip label={d.tipoVeiculo} color="#94a3b8" bg="rgba(100,116,139,.1)" small /> : '—'}</td>

                  {/* Status */}
                  <td style={TD}><Chip label={sm.label} color={sm.color} bg={sm.bg} small /></td>

                  {/* Rodízio */}
                  <td style={TD}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: rm.color }}>{d.rodizio}</span>
                  </td>

                  {/* DS */}
                  <td style={TD}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontWeight: 700, color: dsColor(d.ds) }}>{formatDs(d.ds)}</span>
                      {d.progressaoDs && (
                        <span style={{ fontSize: 10, color: d.progressaoDs === 'Melhorando' ? '#4ade80' : d.progressaoDs === 'Piorando' ? '#f87171' : '#64748b' }}>
                          {d.progressaoDs}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Score */}
                  <td style={{ ...TD, textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: d.priorityScore >= 70 ? '#4ade80' : d.priorityScore >= 40 ? '#fbbf24' : '#f87171' }}>
                      {d.priorityScore}
                    </span>
                  </td>

                  {/* Última viagem */}
                  <td style={{ ...TD, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{fmtDate(d.ultimaViagem)}</span>
                      {d.ultimaViagem && d.daysSinceRoute < 9999 && (
                        <span style={{ fontSize: 10, color: d.daysSinceRoute <= 1 ? '#4ade80' : d.daysSinceRoute <= 3 ? '#fbbf24' : '#f87171' }}>
                          {d.daysSinceRoute === 0 ? 'hoje' : `${d.daysSinceRoute}d atrás`}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Rotas */}
                  <td style={{ ...TD, textAlign: 'center', color: '#e2e8f0' }}>{d.numeroRotas || '—'}</td>

                  {/* NoShow */}
                  <td style={{ ...TD, textAlign: 'center' }}>
                    {d.noshow > 0
                      ? <span style={{ color: '#f87171', fontWeight: 700 }}>{d.noshow}</span>
                      : <span style={{ color: '#4a5568' }}>—</span>}
                  </td>

                  {/* Recusas */}
                  <td style={{ ...TD, textAlign: 'center' }}>
                    {d.declines > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <span style={{ color: d.declineRate >= 50 ? '#f87171' : d.declineRate >= 25 ? '#f97316' : '#fbbf24', fontWeight: 700 }}>{d.declines}</span>
                        <span style={{ fontSize: 10, color: '#64748b' }}>{d.declineRate}%</span>
                      </div>
                    ) : <span style={{ color: '#4a5568' }}>—</span>}
                  </td>

                  {/* Clusters */}
                  <td style={{ ...TD, maxWidth: 200 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {d.clusters.slice(0, 4).map(c => (
                        <span key={c}
                          onClick={() => setClusterFilter(f => toggle(f, c))}
                          style={{ background: clusterFilter.has(c) ? 'rgba(139,92,246,.25)' : 'rgba(139,92,246,.1)', color: '#a78bfa', borderRadius: 3, padding: '1px 4px', fontSize: 10, cursor: 'pointer' }}>
                          {c}
                        </span>
                      ))}
                      {d.clusters.length > 4 && <span style={{ color: '#8892a4', fontSize: 10 }}>+{d.clusters.length - 4}</span>}
                    </div>
                  </td>

                  {/* Ações */}
                  <td style={TD}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {d.phoneNumber && (
                        <a href={waLink(d.phoneNumber)} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', color: '#4ade80', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${d.driverId}-exp`} style={{ borderBottom: '1px solid #2d3048', background: 'rgba(139,92,246,.04)' }}>
                    <td colSpan={12} style={{ padding: '10px 16px 14px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Todos os clusters ({d.clusters.length})
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {d.clusters.sort().map(c => (
                          <span key={c}
                            onClick={e => { e.stopPropagation(); setClusterFilter(f => toggle(f, c)) }}
                            style={{ background: clusterFilter.has(c) ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.12)', color: '#a78bfa', border: `1px solid ${clusterFilter.has(c) ? 'rgba(139,92,246,.5)' : 'rgba(139,92,246,.2)'}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontWeight: clusterFilter.has(c) ? 700 : 400 }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {visible < filtered.length && (
            <span style={{ fontSize: 11, color: '#64748b' }}>Carregando mais… ({visible}/{filtered.length})</span>
          )}
        </div>
      </div>
      </>}
    </div>
  )
}

const TH: React.CSSProperties = { padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '7px 12px', verticalAlign: 'middle' }
