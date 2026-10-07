import { useMemo, useState, useRef, useCallback, useEffect, Component } from 'react'
import { coversCluster } from '../../lib/clusterMatch'
import type { ReactNode } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { CallUpAnalysis, FirstCallAnalysis } from '../../lib/callUpParser'
import type { Shift } from '../../lib/globalConfig'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import type { StoredDriver } from '../../lib/localStore'

class CallUpErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, color: '#f87171', fontSize: 13 }}>
        <p style={{ fontWeight: 700, marginBottom: 8 }}>Erro ao carregar Call Up</p>
        <pre style={{ background: '#13151f', padding: 12, borderRadius: 8, color: '#94a3b8', fontSize: 11, whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
        <p style={{ color: '#64748b', marginTop: 8 }}>Reimporte o CSV do Call Up na tela de Uploads.</p>
      </div>
    )
    return this.props.children
  }
}

// ─── DateRangePicker ──────────────────────────────────────────────────────────
function DateRangePicker({ from, to, onChange, availableDates }: {
  from: string; to: string
  onChange: (from: string, to: string) => void
  availableDates: string[]
}) {
  const [open, setOpen] = useState(false)
  const [selecting, setSelecting] = useState<'from' | 'to'>('from')
  const [hovered, setHovered] = useState('')
  const [viewYear, setViewYear] = useState(() => {
    const ref = from || availableDates[0] || new Date().toISOString().slice(0, 7)
    return parseInt(ref.slice(0, 4))
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const ref = from || availableDates[0] || new Date().toISOString().slice(0, 7)
    return parseInt(ref.slice(5, 7)) - 1
  })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const label = from || to
    ? `${from || '—'}  →  ${to || '—'}`
    : 'Selecionar período'

  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  const firstDayOfWeek = (y: number, m: number) => new Date(y, m, 1).getDay()

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1) }

  const monthName = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][viewMonth]
  const available = new Set(availableDates)

  const handleDay = (dateStr: string) => {
    if (!available.has(dateStr)) return
    if (selecting === 'from') {
      onChange(dateStr, to && dateStr > to ? '' : to)
      setSelecting('to')
    } else {
      if (dateStr < from) { onChange(dateStr, from); setSelecting('from') }
      else { onChange(from, dateStr); setOpen(false); setSelecting('from') }
    }
  }

  const inRange = (d: string) => {
    const end = selecting === 'to' && hovered ? hovered : to
    return from && end && d > (from < end ? from : end) && d < (from < end ? end : from)
  }
  const isEdge = (d: string) => d === from || d === to || (selecting === 'to' && d === hovered)

  const days = daysInMonth(viewYear, viewMonth)
  const startPad = firstDayOfWeek(viewYear, viewMonth)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: open || from || to ? 'rgba(59,130,246,.15)' : '#13151f',
        border: `1px solid ${open || from || to ? 'rgba(59,130,246,.4)' : '#2d3048'}`,
        color: from || to ? '#60a5fa' : '#8892a4',
        borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap'
      }}>
        📅 {label}
        {(from || to) && (
          <span onClick={e => { e.stopPropagation(); onChange('', ''); setSelecting('from') }}
            style={{ color: '#64748b', fontWeight: 400, marginLeft: 2 }}>✕</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 999,
          background: '#13151f', border: '1px solid #2d3048', borderRadius: 10,
          padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.5)', minWidth: 260
        }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{monthName} {viewYear}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>›</button>
          </div>

          {/* Day-of-week header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {['D','S','T','Q','Q','S','S'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10, color: '#64748b', fontWeight: 600 }}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} />)}
            {Array.from({ length: days }).map((_, i) => {
              const day = i + 1
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isAvail = available.has(dateStr)
              const edge = isEdge(dateStr)
              const range = inRange(dateStr)
              return (
                <div key={day}
                  onClick={() => handleDay(dateStr)}
                  onMouseEnter={() => selecting === 'to' && setHovered(dateStr)}
                  onMouseLeave={() => setHovered('')}
                  style={{
                    textAlign: 'center', fontSize: 12, padding: '5px 0', borderRadius: 5, cursor: isAvail ? 'pointer' : 'default',
                    color: edge ? '#fff' : range ? '#60a5fa' : isAvail ? '#e2e8f0' : '#374151',
                    background: edge ? '#3b82f6' : range ? 'rgba(59,130,246,.15)' : 'transparent',
                    fontWeight: edge ? 700 : 400,
                  }}>
                  {day}
                </div>
              )
            })}
          </div>

          <p style={{ margin: '10px 0 0', fontSize: 10, color: '#64748b', textAlign: 'center' }}>
            {selecting === 'from' ? 'Clique para selecionar o início' : 'Clique para selecionar o fim'}
          </p>
        </div>
      )}
    </div>
  )
}

interface DriverMeta { vehicleType: string; ds: number | null }

interface Props {
  data: CallUpAnalysis
  driverMeta?: Map<string, DriverMeta>
  workPref?: WorkPreferenceData | null
  registry?: StoredDriver[]
}

export default function CallUp({ data, driverMeta, workPref, registry }: Props) {
  return (
    <CallUpErrorBoundary>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Call Up — Primeira Chamada</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
            {data.totalCalls.toLocaleString('pt-BR')} chamadas · {data.fileName} · {new Date(data.importedAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          <FirstCallTab data={data} driverMeta={driverMeta} workPref={workPref} registry={registry} />
        </div>
      </div>
    </CallUpErrorBoundary>
  )
}

// ─── FirstCallTab ─────────────────────────────────────────────────────────────

const BATCH_FC = 50

// Range padrão do filtro de data: mês atual (se houver dados nele), senão o mês mais recente disponível.
function defaultMonthRange(dates: string[]): { from: string; to: string } {
  if (!dates.length) return { from: '', to: '' }
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let month = dates.filter(d => d.startsWith(ym))
  if (!month.length) {
    const latestYm = [...dates].sort().slice(-1)[0].slice(0, 7)
    month = dates.filter(d => d.startsWith(latestYm))
  }
  const sorted = [...month].sort()
  return { from: sorted[0], to: sorted[sorted.length - 1] }
}

// ─── CallUpReport modal ───────────────────────────────────────────────────────
function CallUpReportModal({ open, onClose, routes, dateFrom, dateTo, shiftFilter, workPrefClusters, fileName, driverMeta }: {
  open: boolean
  onClose: () => void
  routes: import('../../lib/callUpParser').FirstCallRoute[]
  dateFrom: string
  dateTo: string
  shiftFilter: string
  workPrefClusters: Map<string, string[]>
  fileName: string
  driverMeta?: Map<string, DriverMeta>
}) {
  if (!open) return null

  const total = routes.length
  const accepted = routes.filter(r => r.status === 'Accepted').length
  const declined = routes.filter(r => r.status === 'Declined').length
  const rate = total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0

  const reasonMap: Record<string, number> = {}
  for (const r of routes) {
    if (r.status === 'Declined' && r.declineReason) {
      reasonMap[r.declineReason] = (reasonMap[r.declineReason] ?? 0) + 1
    }
  }
  const reasons = Object.entries(reasonMap).sort((a, b) => b[1] - a[1])

  const clusterMap: Record<string, { total: number; accepted: number }> = {}
  for (const r of routes) {
    if (!r.cluster) continue
    if (!clusterMap[r.cluster]) clusterMap[r.cluster] = { total: 0, accepted: 0 }
    clusterMap[r.cluster].total++
    if (r.status === 'Accepted') clusterMap[r.cluster].accepted++
  }
  const clusters = Object.entries(clusterMap)
    .map(([cluster, s]) => ({ cluster, ...s, rate: s.total > 0 ? Math.round((s.accepted / s.total) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 12)

  const declinedRegion = routes.filter(r => r.status === 'Declined' && r.declineReason === 'Fora da região de preferência')
  const mismatch = declinedRegion.filter(r => {
    const dc = workPrefClusters.get(r.driverId)
    if (!dc) return false
    if (dc.some(c => c.toUpperCase() === 'ALL')) return false
    return coversCluster(dc, r.cluster)
  })

  const periodLabel = dateFrom && dateTo ? `${dateFrom.split('-').reverse().join('/')} – ${dateTo.split('-').reverse().join('/')}`
    : dateFrom ? `a partir de ${dateFrom.split('-').reverse().join('/')}` : dateTo ? `até ${dateTo.split('-').reverse().join('/')}` : 'Todo o período'

  const rateColor = (r: number) => r >= 70 ? '#4ade80' : r >= 40 ? '#fbbf24' : '#f87171'
  const maxReasonCount = reasons[0]?.[1] ?? 1

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '20px', overflowY: 'auto',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#0f1117', border: '1px solid #2d3048', borderRadius: 14,
        width: '100%', maxWidth: 760, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Relatório de Call Up</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              {periodLabel}{shiftFilter !== 'all' ? ` · Turno ${shiftFilter}` : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>✕</button>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'ATs', value: total, color: '#60a5fa' },
            { label: 'Aceitas', value: accepted, color: '#4ade80' },
            { label: 'Recusadas', value: declined, color: '#f87171' },
            { label: 'Taxa Aceite', value: `${rate}%`, color: rateColor(rate) },
          ].map(c => (
            <div key={c.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '8px 14px', flex: 1 }}>
              <p style={{ margin: 0, fontSize: 9, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{c.label}</p>
              <p style={{ margin: '3px 0 0', fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: reasons.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
          {/* Decline reasons */}
          {reasons.length > 0 && (
            <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Motivos de Recusa</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {reasons.map(([reason, count]) => (
                  <div key={reason}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{reason}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>{count}×</span>
                    </div>
                    <div style={{ height: 5, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: '#ef4444', borderRadius: 3, width: `${(count / maxReasonCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clusters */}
          {clusters.length > 0 && (
            <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>12 piores clusters (menor → maior aceite)</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {clusters.map(({ cluster, rate: cr }) => (
                    <div key={cluster} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#94a3b8', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cluster}</span>
                      <div style={{ flex: 1, height: 5, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: rateColor(cr), borderRadius: 3, width: `${cr}%`, opacity: .8 }} />
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: rateColor(cr), width: 30, textAlign: 'right' }}>{cr}%</span>
                    </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mismatch de região */}
        {declinedRegion.length > 0 && (
          <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '16px 18px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
              Recusas "Fora da região de preferência" — {declinedRegion.length} ocorrências
            </p>
            {mismatch.length > 0 && (
              <p style={{ margin: '0 0 12px', fontSize: 11, color: '#fbbf24' }}>
                ⚠️ {mismatch.length} desses motoristas têm disponibilidade para o cluster enviado (recusa com justificativa incorreta)
              </p>
            )}
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2d3048' }}>
                    {['Motorista', 'Veículo', 'Cluster enviado', 'Clusters WP', 'Status'].map(h => (
                      <th key={h} style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {declinedRegion.map((r, i) => {
                    const dc = workPrefClusters.get(r.driverId)
                    const hasAll = dc?.some(c => c.toUpperCase() === 'ALL')
                    const hasCluster = hasAll || coversCluster(dc, r.cluster)
                    const statusLabel = !dc ? 'Sem dados WP' : hasAll ? '✓ ALL' : hasCluster ? '✓ tem disponibilidade' : '✗ fora mesmo'
                    const statusColor = !dc ? '#64748b' : hasCluster ? '#4ade80' : '#f87171'
                    return (
                      <tr key={r.atId + i} style={{ borderBottom: '1px solid #1e2130' }}>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ color: '#e2e8f0' }}>{r.driverName}</span>
                          <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginLeft: 6 }}>{r.driverId}</span>
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {driverMeta?.get(r.driverId)?.vehicleType
                            ? <span style={{ fontSize: 10, color: '#475569', background: '#1e2130', borderRadius: 3, padding: '1px 6px', fontWeight: 600 }}>{driverMeta.get(r.driverId)!.vehicleType}</span>
                            : <span style={{ color: '#374151' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{r.cluster || '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#64748b', fontSize: 10 }}>{dc ? (hasAll ? 'TODAS' : dc.join(', ')) : '—'}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: statusColor }}>{statusLabel}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <p style={{ margin: 0, fontSize: 10, color: '#374151', textAlign: 'right' }}>
          Gerado em {new Date().toLocaleString('pt-BR')} · {fileName}
        </p>
      </div>
    </div>
  )
}

function FirstCallTab({ data, driverMeta, workPref, registry }: { data: CallUpAnalysis; driverMeta?: Map<string, DriverMeta>; workPref?: WorkPreferenceData | null; registry?: StoredDriver[] }) {
  const fc: FirstCallAnalysis = data.firstCallAnalysis ?? { totalRoutes: 0, accepted: 0, declined: 0, acceptanceRate: 0, declineReasonSummary: {}, routes: [], byDriver: [], byDate: [] }
  const [routeSearch, setRouteSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Accepted' | 'Declined' | 'Pending'>('all')
  const [declineReasonFilter, setDeclineReasonFilter] = useState<string>('all')
  const [driverView, setDriverView] = useState(false)
  const [driverSearch, setDriverSearch] = useState('')
  const [driverRateFilter, setDriverRateFilter] = useState<'all' | 'high' | 'mid' | 'low'>('all')
  const [visible, setVisible] = useState(BATCH_FC)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const allDates = useMemo(() => fc.byDate.map(d => d.date), [fc.byDate])
  const [dateFrom, setDateFrom] = useState(() => defaultMonthRange(fc.byDate.map(d => d.date)).from)
  const [dateTo, setDateTo] = useState(() => defaultMonthRange(fc.byDate.map(d => d.date)).to)
  const [shiftFilter, setShiftFilter] = useState<'all' | Shift>('all')

  const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
  const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#f472b6' }

  const chartData = useMemo(() => {
    // If no shift filter, use pre-computed byDate; otherwise rebuild from routes
    if (shiftFilter === 'all') {
      return fc.byDate.filter(d => {
        if (dateFrom && d.date < dateFrom) return false
        if (dateTo && d.date > dateTo) return false
        return true
      })
    }
    const byDate = new Map<string, { total: number; accepted: number; declined: number }>()
    for (const r of fc.routes) {
      if (r.shift !== shiftFilter) continue
      if (r.status === 'Cancelled' || r.status === 'Pending') continue
      const date = r.triggerTime ? r.triggerTime.slice(0, 10).replace(/\//g, '-') : null
      if (!date) continue
      if (dateFrom && date < dateFrom) continue
      if (dateTo && date > dateTo) continue
      if (!byDate.has(date)) byDate.set(date, { total: 0, accepted: 0, declined: 0 })
      const d = byDate.get(date)!
      d.total++
      if (r.status === 'Accepted') d.accepted++
      else d.declined++
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({
        date,
        total: d.total,
        accepted: d.accepted,
        declined: d.declined,
        acceptanceRate: d.total > 0 ? Math.round((d.accepted / d.total) * 1000) / 10 : 0,
      }))
  }, [fc.byDate, fc.routes, dateFrom, dateTo, shiftFilter])

  // KPIs dos 4 cards — dinâmicos com o período (data) e o turno selecionados
  const kpi = useMemo(() => {
    let accepted = 0, declined = 0, pending = 0
    for (const r of fc.routes) {
      if (shiftFilter !== 'all' && r.shift !== shiftFilter) continue
      if (dateFrom || dateTo) {
        const d = r.triggerTime ? r.triggerTime.slice(0, 10).replace(/\//g, '-') : null
        if (!d) continue
        if (dateFrom && d < dateFrom) continue
        if (dateTo && d > dateTo) continue
      }
      if (r.status === 'Accepted') accepted++
      else if (r.status === 'Declined') declined++
      else if (r.status === 'Pending') pending++
    }
    // A taxa considera só chamadas respondidas; as pendentes ficam à parte.
    const total = accepted + declined
    return { total, accepted, declined, pending, rate: total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0 }
  }, [fc.routes, shiftFilter, dateFrom, dateTo])

  const workPrefClusters = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of (workPref?.drivers ?? [])) m.set(d.driverId, d.clusters)
    return m
  }, [workPref])

  const filteredRoutes = useMemo(() => {
    const q = routeSearch.toLowerCase()
    return fc.routes.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (shiftFilter !== 'all' && r.shift !== shiftFilter) return false
      if (declineReasonFilter !== 'all' && r.declineReason !== declineReasonFilter) return false
      if (dateFrom || dateTo) {
        const routeDate = r.triggerTime ? r.triggerTime.slice(0, 10).replace(/\//g, '-') : null
        if (!routeDate) return false
        if (dateFrom && routeDate < dateFrom) return false
        if (dateTo && routeDate > dateTo) return false
      }
      if (q && !r.atId.toLowerCase().includes(q) && !r.driverName.toLowerCase().includes(q) && !r.cluster.toLowerCase().includes(q)) return false
      return true
    })
  }, [fc.routes, routeSearch, statusFilter, shiftFilter, declineReasonFilter, dateFrom, dateTo])

  useEffect(() => { setVisible(BATCH_FC) }, [filteredRoutes])

  const loadMore = useCallback(() => setVisible(v => Math.min(v + BATCH_FC, filteredRoutes.length)), [filteredRoutes.length])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const filteredDrivers = useMemo(() => {
    // rebuild per-driver stats from filteredRoutes so shiftFilter + dateRange apply
    const driverMap = new Map<string, { driverId: string; driverName: string; accepted: number; declined: number; total: number; totalFirstCalls: number; declineReasons: Record<string, number> }>()
    for (const r of filteredRoutes) {
      let d = driverMap.get(r.driverId)
      if (!d) { d = { driverId: r.driverId, driverName: r.driverName, accepted: 0, declined: 0, total: 0, totalFirstCalls: 1, declineReasons: {} }; driverMap.set(r.driverId, d) }
      d.total++
      d.totalFirstCalls = d.total
      if (r.status === 'Accepted') d.accepted++
      else if (r.status === 'Declined') {
        d.declined++
        if (r.declineReason) d.declineReasons[r.declineReason] = (d.declineReasons[r.declineReason] ?? 0) + 1
      }
    }
    const q = driverSearch.toLowerCase()
    return [...driverMap.values()]
      .map(d => ({ ...d, acceptanceRate: d.total > 0 ? Math.round((d.accepted / d.total) * 100) : 0 }))
      .filter(d => {
        if (q && !d.driverName.toLowerCase().includes(q) && !d.driverId.includes(q)) return false
        if (driverRateFilter === 'high' && d.acceptanceRate < 70) return false
        if (driverRateFilter === 'mid' && (d.acceptanceRate < 40 || d.acceptanceRate >= 70)) return false
        if (driverRateFilter === 'low' && d.acceptanceRate >= 40) return false
        return true
      })
      .sort((a, b) => a.acceptanceRate - b.acceptanceRate)
  }, [filteredRoutes, driverSearch, driverRateFilter])

  const [copiedPhones, setCopiedPhones] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const phoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of (registry ?? [])) if (d.phoneNumber) m.set(d.id, d.phoneNumber)
    return m
  }, [registry])

  const allDeclineReasons = useMemo(() => {
    const s = new Set<string>()
    for (const r of fc.routes) if (r.status === 'Declined' && r.declineReason) s.add(r.declineReason)
    return [...s].sort()
  }, [fc.routes])

  const rateColor = (r: number) => r >= 70 ? '#4ade80' : r >= 40 ? '#fbbf24' : '#f87171'
  const topReasons = Object.entries(fc.declineReasonSummary).sort((a, b) => b[1] - a[1])

  if (!data.firstCallAnalysis) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
      <p style={{ color: '#f87171', fontSize: 14, fontWeight: 600 }}>Relatório de Call Up desatualizado</p>
      <p style={{ color: '#64748b', fontSize: 12, textAlign: 'center' }}>Reimporte o CSV do Call Up para atualizar os dados.</p>
    </div>
  )

  return (
    <>
    <CallUpReportModal
      open={reportOpen}
      onClose={() => setReportOpen(false)}
      routes={filteredRoutes}
      dateFrom={dateFrom}
      dateTo={dateTo}
      shiftFilter={shiftFilter}
      workPrefClusters={workPrefClusters}
      fileName={data.fileName}
      driverMeta={driverMeta}
    />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary cards + report button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'ATs respondidas', value: kpi.total, color: '#60a5fa' },
            { label: '1ª chamada aceita', value: kpi.accepted, color: '#4ade80' },
            { label: '1ª chamada recusada', value: kpi.declined, color: '#f87171' },
            ...(kpi.pending > 0 ? [{ label: 'Aguardando resposta', value: kpi.pending, color: '#fbbf24' }] : []),
            { label: 'Taxa de aceite (1ª chamada)', value: `${kpi.rate}%`, color: rateColor(kpi.rate) },
          ].map(c => (
            <div key={c.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 18px', minWidth: 160 }}>
              <p style={{ margin: 0, fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{c.label}</p>
              <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700, color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
        <button onClick={() => setReportOpen(true)} style={{
          background: 'rgba(139,92,246,.15)', border: '1px solid rgba(139,92,246,.35)',
          color: '#a78bfa', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', alignSelf: 'flex-start'
        }}>
          📊 Gerar Report{(dateFrom || dateTo || shiftFilter !== 'all' || statusFilter !== 'all') ? ' (filtros ativos)' : ''}
        </button>
      </div>

      {/* Line chart — acceptance rate over time */}
      {fc.byDate.length > 0 && (
        <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>% Aceite na 1ª chamada por dia</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden' }}>
                <button onClick={() => setShiftFilter('all')}
                  style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: shiftFilter === 'all' ? '#2d3048' : 'transparent', color: shiftFilter === 'all' ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
                  Todos
                </button>
                {SHIFTS.map(s => (
                  <button key={s} onClick={() => setShiftFilter(s)}
                    style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: shiftFilter === s ? `${SHIFT_COLOR[s]}22` : 'transparent', color: shiftFilter === s ? SHIFT_COLOR[s] : '#8892a4', cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
              <DateRangePicker
                from={dateFrom} to={dateTo}
                onChange={(f, t) => { setDateFrom(f); setDateTo(t) }}
                availableDates={allDates}
              />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8892a4' }} tickFormatter={d => d.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#8892a4' }} tickFormatter={v => `${v}%`} width={36} />
              <Tooltip
                contentStyle={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, _: string, p: { payload: { accepted: number; total: number } }) => [`${v}% (${p.payload.accepted}/${p.payload.total})`, '% aceite 1ª chamada']}
                labelFormatter={l => `Data: ${l}`}
              />
              <Line type="monotone" dataKey="acceptanceRate" stroke={shiftFilter !== 'all' ? SHIFT_COLOR[shiftFilter] : '#60a5fa'} strokeWidth={2} dot={{ r: 3, fill: shiftFilter !== 'all' ? SHIFT_COLOR[shiftFilter] : '#60a5fa' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Decline reasons for first calls */}
      {topReasons.length > 0 && (
        <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 18px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Motivos de recusa (1ª chamada)</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {topReasons.map(([reason, count]) => (
              <div key={reason} style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 7, padding: '5px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#f87171', fontWeight: 600 }}>{count}×</span>
                <span style={{ fontSize: 12, color: '#e2e8f0' }}>{reason}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>({fc.declined > 0 ? Math.round(count / fc.declined * 100) : 0}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggle: routes vs drivers */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden' }}>
          {[{ v: false, l: 'Por AT' }, { v: true, l: 'Por Motorista' }].map(({ v, l }) => (
            <button key={l} onClick={() => setDriverView(v)}
              style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, border: 'none', background: driverView === v ? '#7c3aed' : 'transparent', color: driverView === v ? '#fff' : '#8892a4', cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
        {!driverView && (
          <>
            <input placeholder="Buscar AT ID, motorista ou cluster..."
              value={routeSearch} onChange={e => setRouteSearch(e.target.value)}
              style={{ width: 260, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
            <div style={{ display: 'flex', background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden' }}>
              {([['all', 'Todas'], ['Accepted', 'Aceitas'], ['Declined', 'Recusadas'], ['Pending', 'Pendentes']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  style={{ padding: '5px 12px', fontSize: 12, border: 'none', background: statusFilter === v ? (v === 'Declined' ? 'rgba(239,68,68,.2)' : v === 'Accepted' ? 'rgba(34,197,94,.2)' : '#2d3048') : 'transparent', color: statusFilter === v ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#64748b' }}>{filteredRoutes.length} ATs</span>
            {allDeclineReasons.length > 0 && (
              <select value={declineReasonFilter} onChange={e => setDeclineReasonFilter(e.target.value)}
                style={{ background: '#0f1117', border: '1px solid #2d3048', color: declineReasonFilter !== 'all' ? '#f87171' : '#8892a4', borderRadius: 6, padding: '5px 8px', fontSize: 11, cursor: 'pointer', outline: 'none', maxWidth: 220 }}>
                <option value="all">Todos os motivos</option>
                {allDeclineReasons.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            {phoneMap.size > 0 && (
              <button onClick={() => {
                const phones = [...new Set(filteredRoutes.map(r => phoneMap.get(r.driverId)).filter(Boolean))].join('\n')
                navigator.clipboard.writeText(phones).then(() => { setCopiedPhones(true); setTimeout(() => setCopiedPhones(false), 2000) })
              }} style={{
                background: copiedPhones ? 'rgba(74,222,128,.15)' : '#13151f',
                border: `1px solid ${copiedPhones ? 'rgba(74,222,128,.4)' : '#2d3048'}`,
                color: copiedPhones ? '#4ade80' : '#8892a4', borderRadius: 6, padding: '5px 10px',
                fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap'
              }}>
                {copiedPhones ? '✓ Copiado!' : '📋 Copiar telefones'}
              </button>
            )}
          </>
        )}
        {driverView && (
          <>
            <input placeholder="Buscar motorista..."
              value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
              style={{ width: 220, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
            <div style={{ display: 'flex', background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden' }}>
              {([['all', 'Todos'], ['high', '≥70%'], ['mid', '40–69%'], ['low', '<40%']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setDriverRateFilter(v)}
                  style={{ padding: '5px 12px', fontSize: 12, border: 'none', background: driverRateFilter === v ? (v === 'high' ? 'rgba(74,222,128,.2)' : v === 'low' ? 'rgba(248,113,113,.2)' : v === 'mid' ? 'rgba(251,191,36,.2)' : '#2d3048') : 'transparent', color: driverRateFilter === v ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#64748b' }}>{filteredDrivers.length} motoristas</span>
          </>
        )}
      </div>

      {/* Routes table */}
      {!driverView && (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['AT ID', 'Cluster', 'Motorista (1ª chamada)', 'Horário', 'Resultado', 'Motivo recusa'].map(h => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRoutes.slice(0, visible).map((r, i) => (
                <tr key={r.atId + i} style={{ borderBottom: '1px solid #1e2130', background: r.status === 'Declined' ? 'rgba(239,68,68,.02)' : 'transparent' }}>
                  <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0' }}>{r.atId}</td>
                  <td style={{ padding: '7px 12px', color: '#94a3b8' }}>{r.cluster || '—'}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{ color: '#e2e8f0' }}>{r.driverName}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 1 }}>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{r.driverId}</span>
                      {driverMeta?.get(r.driverId)?.vehicleType && (
                        <span style={{ fontSize: 9, color: '#475569', background: '#1e2130', borderRadius: 3, padding: '1px 5px', fontWeight: 600, letterSpacing: '.03em' }}>
                          {driverMeta.get(r.driverId)!.vehicleType}
                        </span>
                      )}
                      {driverMeta?.get(r.driverId)?.ds != null && (
                        <span style={{ fontSize: 9, color: '#475569' }}>DS {(driverMeta.get(r.driverId)!.ds! * 100).toFixed(2)}%</span>
                      )}
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.triggerTime.slice(0, 16).replace('/', '-').replace('/', '-')}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{
                      background: r.status === 'Accepted' ? 'rgba(34,197,94,.1)' : r.status === 'Declined' ? 'rgba(239,68,68,.1)' : r.status === 'Pending' ? 'rgba(245,158,11,.1)' : 'rgba(100,116,139,.1)',
                      color: r.status === 'Accepted' ? '#4ade80' : r.status === 'Declined' ? '#f87171' : r.status === 'Pending' ? '#fbbf24' : '#94a3b8',
                      borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600
                    }}>
                      {r.status === 'Accepted' ? 'Aceita' : r.status === 'Declined' ? 'Recusada' : r.status === 'Pending' ? 'Pendente' : 'Cancelada'}
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px', fontSize: 11 }}>
                    {r.declineReason
                      ? r.declineReason === 'Fora da região de preferência' && r.cluster
                        ? (() => {
                            const driverClusters = workPrefClusters.get(r.driverId)
                            if (!driverClusters) {
                              return (
                                <span>
                                  <span style={{ color: '#f87171' }}>{r.declineReason}</span>
                                  <span style={{ marginLeft: 6, fontSize: 10, color: '#64748b', background: '#1e2130', borderRadius: 3, padding: '1px 5px' }}>sem dados WP</span>
                                </span>
                              )
                            }
                            const hasAll = driverClusters.some(c => c.toUpperCase() === 'ALL')
                            const isActuallyOutside = !hasAll && !coversCluster(driverClusters, r.cluster)
                            return (
                              <span>
                                <span style={{ color: '#f87171' }}>{r.declineReason}</span>
                                <span style={{
                                  marginLeft: 6, fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '1px 6px',
                                  background: isActuallyOutside ? 'rgba(239,68,68,.12)' : 'rgba(34,197,94,.12)',
                                  color: isActuallyOutside ? '#f87171' : '#4ade80',
                                  border: `1px solid ${isActuallyOutside ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'}`,
                                }}>
                                  {isActuallyOutside ? '✗ fora mesmo' : '✓ tem disponibilidade'}
                                </span>
                                {driverClusters.length > 0 && (
                                  <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b' }}>WP: {driverClusters.join(', ')}</span>
                                )}
                              </span>
                            )
                          })()
                        : <span style={{ color: '#f87171' }}>{r.declineReason}</span>
                      : <span style={{ color: '#64748b' }}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={sentinelRef} style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {visible < filteredRoutes.length && <span style={{ fontSize: 11, color: '#64748b' }}>Carregando… ({visible}/{filteredRoutes.length})</span>}
          </div>
        </div>
      )}

      {/* Per-driver table — inside the outer <> fragment that wraps modal + content */}
      {driverView && (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['Motorista', '1ªs chamadas', 'Aceitas', 'Recusadas', 'Taxa aceite', 'Principal motivo recusa'].map(h => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map(d => {
                const topReason = Object.entries(d.declineReasons).sort((a, b) => b[1] - a[1])[0]
                return (
                  <tr key={d.driverId} style={{ borderBottom: '1px solid #1e2130' }}>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{d.driverName}</span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 1 }}>
                        <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{d.driverId}</span>
                        {driverMeta?.get(d.driverId)?.vehicleType && (
                          <span style={{ fontSize: 9, color: '#475569', background: '#1e2130', borderRadius: 3, padding: '1px 5px', fontWeight: 600, letterSpacing: '.03em' }}>
                            {driverMeta.get(d.driverId)!.vehicleType}
                          </span>
                        )}
                        {driverMeta?.get(d.driverId)?.ds != null && (
                          <span style={{ fontSize: 9, color: '#475569' }}>DS {(driverMeta.get(d.driverId)!.ds! * 100).toFixed(2)}%</span>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', color: '#94a3b8', textAlign: 'center' }}>{d.totalFirstCalls}</td>
                    <td style={{ padding: '7px 12px', color: '#4ade80', textAlign: 'center' }}>{d.accepted}</td>
                    <td style={{ padding: '7px 12px', color: '#f87171', textAlign: 'center' }}>{d.declined}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 700, color: rateColor(d.acceptanceRate) }}>{d.acceptanceRate}%</td>
                    <td style={{ padding: '7px 12px', color: '#f87171', fontSize: 11 }}>{topReason ? `${topReason[0]} (${topReason[1]}×)` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  )
}
