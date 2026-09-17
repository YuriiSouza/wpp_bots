import { useState, useMemo, useRef, useEffect } from 'react'
import type { AnalysisResult, ParsedRoute } from '../../lib/types'
import {
  computeDriverResults,
  computeSummary,
  computeTurnStats,
  computeClusterStats,
  computeTimeline,
  computeDsBuckets,
} from '../../lib/dsCalculator'
import SummaryCards from './SummaryCards'
import DSTable from './DSTable'
import DSDistributionChart from './charts/DSDistributionChart'
import ClusterRankChart from './charts/ClusterRankChart'
import TimelineChart from './charts/TimelineChart'
import TurnComparisonChart from './charts/TurnComparisonChart'

const TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'motoristas', label: 'Motoristas DS' },
  { id: 'cluster', label: 'Por Cluster' },
  { id: 'rotatividade', label: 'Rotatividade' },
  { id: 'spr', label: 'Sugestão SPR' },
]

interface Filters {
  turns: string[]
  clusters: string[]
  dateFrom: string
  dateTo: string
}

const LS_KEY = 'spx:analytics-filters'

function loadFilters(): Filters {
  try {
    const s = localStorage.getItem(LS_KEY)
    return s ? { turns: [], clusters: [], dateFrom: '', dateTo: '', ...JSON.parse(s) } : { turns: [], clusters: [], dateFrom: '', dateTo: '' }
  } catch { return { turns: [], clusters: [], dateFrom: '', dateTo: '' } }
}

function saveFilters(f: Filters) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(f)) } catch { /* ignore */ }
}

interface Props {
  result: AnalysisResult
  fileName: string
  onReset: () => void
  parsedRoutes?: ParsedRoute[]
}

function Section({ title, children, unavailable }: { title: string; children: React.ReactNode; unavailable?: boolean }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>{title}</h3>
        {unavailable && <span className="badge-amber">dados parcialmente indisponíveis</span>}
      </div>
      {children}
    </div>
  )
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: active ? '#3b82f6' : '#1a1d27',
      color: active ? '#fff' : '#94a3b8',
      border: `1px solid ${active ? '#3b82f6' : '#2d3048'}`,
      borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
      fontSize: 12, fontWeight: active ? 600 : 400, transition: 'all .1s',
    }}>{label}</button>
  )
}

// ─── DateRangePicker (same as CallUp) ─────────────────────────────────────────
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

  const label = from || to ? `${from || '—'}  →  ${to || '—'}` : 'Selecionar período'
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
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      }}>
        📅 {label}
        {(from || to) && (
          <span onClick={e => { e.stopPropagation(); onChange('', ''); setSelecting('from') }}
            style={{ color: '#64748b', fontWeight: 400, marginLeft: 2 }}>✕</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 999,
          background: '#13151f', border: '1px solid #2d3048', borderRadius: 10,
          padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.5)', minWidth: 260,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{monthName} {viewYear}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {['D','S','T','Q','Q','S','S'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10, color: '#64748b', fontWeight: 600 }}>{d}</div>
            ))}
          </div>
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
                    textAlign: 'center', fontSize: 12, padding: '5px 0', borderRadius: 5,
                    cursor: isAvail ? 'pointer' : 'default',
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

export default function Dashboard({ result, fileName, onReset, parsedRoutes = [] }: Props) {
  const [tab, setTab] = useState('visao-geral')
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [clusterOpen, setClusterOpen] = useState(false)

  const allTurns = useMemo(() => result.turnStats.map(t => t.turn), [result])
  const allClusters = useMemo(() => result.clusterStats.map(c => c.cluster), [result])
  const availableDates = useMemo(() => {
    if (parsedRoutes.length > 0) return [...new Set(parsedRoutes.map(r => r.date).filter(Boolean))].sort()
    return result.timeline.map(t => t.date).sort()
  }, [parsedRoutes, result])

  const updateFilters = (next: Filters) => { setFilters(next); saveFilters(next) }
  const toggleTurn = (t: string) => {
    const turns = filters.turns.includes(t) ? filters.turns.filter(x => x !== t) : [...filters.turns, t]
    updateFilters({ ...filters, turns })
  }
  const toggleCluster = (c: string) => {
    const clusters = filters.clusters.includes(c) ? filters.clusters.filter(x => x !== c) : [...filters.clusters, c]
    updateFilters({ ...filters, clusters })
  }
  const clearFilters = () => updateFilters({ turns: [], clusters: [], dateFrom: '', dateTo: '' })
  const hasFilters = filters.turns.length > 0 || filters.clusters.length > 0 || filters.dateFrom || filters.dateTo

  // ── Apply filters to parsedRoutes and recompute all stats ─────────────────
  const effectiveData = useMemo(() => {
    const hasRaw = parsedRoutes.length > 0
    const isFiltered = filters.turns.length > 0 || filters.clusters.length > 0 || filters.dateFrom || filters.dateTo

    if (!hasRaw || !isFiltered) {
      return {
        summary: result.summary,
        turnStats: result.turnStats,
        clusterStats: result.clusterStats,
        timeline: result.timeline,
        dsBuckets: result.dsBuckets,
        drivers: result.drivers,
      }
    }

    const filtered = parsedRoutes.filter(r => {
      if (filters.turns.length > 0 && !filters.turns.includes(r.dispatch_window)) return false
      if (filters.clusters.length > 0 && !filters.clusters.includes(r.cluster_name)) return false
      if (filters.dateFrom && r.date < filters.dateFrom) return false
      if (filters.dateTo && r.date > filters.dateTo) return false
      return true
    })

    const drivers = computeDriverResults(filtered)
    return {
      summary: computeSummary(filtered, drivers),
      turnStats: computeTurnStats(filtered),
      clusterStats: computeClusterStats(filtered),
      timeline: computeTimeline(filtered),
      dsBuckets: computeDsBuckets(drivers),
      drivers,
    }
  }, [parsedRoutes, filters, result])

  const noRawWarning = hasFilters && parsedRoutes.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: '1px solid #2d3048', background: '#0f1117', flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>📦</span>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>SPX Analytics</span>
        <span style={{ color: '#8892a4', fontSize: 13, fontFamily: 'monospace' }}>{fileName}</span>
        {result.missingColumns.length > 0 && (
          <span className="badge-amber" title={`Colunas ausentes: ${result.missingColumns.join(', ')}`}>
            ⚠ {result.missingColumns.length} col. indisponíveis
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onReset} style={{ background: '#22263a', color: '#94a3b8', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}>
          ← Novo arquivo
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px 0', borderBottom: '1px solid #2d3048', background: '#0f1117', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#1a1d27' : 'transparent',
            color: tab === t.id ? '#e2e8f0' : '#8892a4',
            border: 'none',
            borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
            borderRadius: '6px 6px 0 0', padding: '7px 14px', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t.id ? 600 : 400, transition: 'all .1s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, paddingBottom: 60 }}>

        {/* ── Visão Geral ── */}
        {tab === 'visao-geral' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Filter bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '8px 14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Filtros</span>

              {/* Date range */}
              <DateRangePicker
                from={filters.dateFrom}
                to={filters.dateTo}
                availableDates={availableDates}
                onChange={(dateFrom, dateTo) => updateFilters({ ...filters, dateFrom, dateTo })}
              />

              <span style={{ width: 1, height: 20, background: '#2d3048', flexShrink: 0 }} />

              {/* Turno chips */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#8892a4' }}>Turno:</span>
                {allTurns.map(t => (
                  <ToggleChip key={t} label={t} active={filters.turns.includes(t)} onClick={() => toggleTurn(t)} />
                ))}
              </div>

              <span style={{ width: 1, height: 20, background: '#2d3048', flexShrink: 0 }} />

              {/* Cluster dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setClusterOpen(o => !o)}
                  style={{
                    background: filters.clusters.length > 0 ? '#1e3a5f' : '#1a1d27',
                    color: filters.clusters.length > 0 ? '#60a5fa' : '#94a3b8',
                    border: `1px solid ${filters.clusters.length > 0 ? '#3b82f6' : '#2d3048'}`,
                    borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  Cluster {filters.clusters.length > 0 ? `(${filters.clusters.length})` : ''}
                  <span style={{ fontSize: 10 }}>{clusterOpen ? '▲' : '▼'}</span>
                </button>
                {clusterOpen && (
                  <div style={{
                    position: 'absolute', top: '110%', left: 0, zIndex: 100,
                    background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8,
                    padding: '6px 4px', maxHeight: 220, overflowY: 'auto', minWidth: 200,
                    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
                  }}>
                    {allClusters.map(c => (
                      <div key={c} onClick={() => toggleCluster(c)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                        cursor: 'pointer', borderRadius: 5, fontSize: 12,
                        color: filters.clusters.includes(c) ? '#e2e8f0' : '#94a3b8',
                        background: filters.clusters.includes(c) ? 'rgba(59,130,246,.15)' : 'transparent',
                      }}>
                        <span style={{ width: 14, height: 14, border: `1px solid ${filters.clusters.includes(c) ? '#3b82f6' : '#4a5568'}`, borderRadius: 3, background: filters.clusters.includes(c) ? '#3b82f6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {filters.clusters.includes(c) && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                        </span>
                        {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {hasFilters && (
                <button onClick={clearFilters} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,.3)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                  × Limpar
                </button>
              )}

              {noRawWarning && (
                <span style={{ fontSize: 11, color: '#fbbf24' }}>⚠ Reimporte o arquivo para aplicar filtros</span>
              )}

              {hasFilters && !noRawWarning && (
                <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
                  {effectiveData.summary.totalRoutes.toLocaleString('pt-BR')} rotas filtradas
                </span>
              )}
            </div>

            {/* Summary cards */}
            <SummaryCards summary={effectiveData.summary} />

            {/* Charts 2×2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="card" style={{ marginBottom: 0 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Distribuição de DS_Real</p>
                <DSDistributionChart buckets={effectiveData.dsBuckets} height={150} />
              </div>

              <div className="card" style={{ marginBottom: 0 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Volume de rotas por dia</p>
                <TimelineChart timeline={effectiveData.timeline} height={150} />
              </div>

              <div className="card" style={{ marginBottom: 0 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Performance por turno</p>
                {effectiveData.turnStats.every(t => t.routeCount === 0) ? (
                  <p style={{ color: '#8892a4', fontSize: 13 }}>Dados de turno indisponíveis.</p>
                ) : (
                  <TurnComparisonChart turnStats={effectiveData.turnStats} />
                )}
              </div>

              <div className="card" style={{ marginBottom: 0 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                  Ranking clusters
                  {effectiveData.clusterStats.length > 0 && effectiveData.clusterStats.length < result.clusterStats.length
                    ? ` (${effectiveData.clusterStats.length} de ${result.clusterStats.length})` : ''}
                </p>
                {effectiveData.clusterStats.length === 0 ? (
                  <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum cluster com volume mínimo suficiente (15+ rotas).</p>
                ) : (
                  <div style={{ height: Math.min(180, Math.max(100, effectiveData.clusterStats.length * 24)), overflow: 'hidden' }}>
                    <ClusterRankChart clusters={effectiveData.clusterStats} maxItems={7} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Motoristas DS ── */}
        {tab === 'motoristas' && (
          <Section title="Resultado por motorista — DS_Real">
            <DSTable drivers={result.drivers} />
          </Section>
        )}

        {/* ── Por Cluster ── */}
        {tab === 'cluster' && (
          <Section title="Detalhes por cluster" unavailable={result.missingColumns.includes('cluster_name') || result.missingColumns.includes('Performance')}>
            {result.clusterStats.length === 0 ? (
              <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum cluster com volume mínimo suficiente (15+ rotas) encontrado.</p>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Cluster', 'Rotas', 'Perf. Geral', 'AM', 'PM1', 'Corr. Volume', 'Corr. Paradas', 'Obs.'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.clusterStats.map((c, i) => (
                      <tr key={c.cluster} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{c.cluster}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.routeCount}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={c.avgPerformance >= 0.96 ? 'badge-green' : c.avgPerformance >= 0.93 ? 'badge-blue' : 'badge-red'}>
                            {(c.avgPerformance * 100).toFixed(2)}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.amAvg !== null ? (c.amAvg * 100).toFixed(2) + '%' : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.pm1Avg !== null ? (c.pm1Avg * 100).toFixed(2) + '%' : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.correlationVolume !== null ? c.correlationVolume.toFixed(3) : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.correlationStops !== null ? c.correlationStops.toFixed(3) : '—'}</td>
                        <td style={{ padding: '8px 12px' }}>{c.isSensitiveToVolume ? <span className="badge-amber">⚠ Sensível a volume</span> : <span className="badge-gray">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}

        {/* ── Rotatividade ── */}
        {tab === 'rotatividade' && (
          <div>
            <Section title="Concentração de rotas por tipo de veículo">
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Veículo', 'Motoristas', 'Top 20% concentram', 'Bottom 20% concentram'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.vehicleConcentration.map((v, i) => (
                      <tr key={v.vehicle} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{v.vehicle || 'N/A'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.totalDrivers}</td>
                        <td style={{ padding: '8px 12px' }}><span className={v.top20Pct > 60 ? 'badge-amber' : 'badge-green'}>{v.top20Pct}% das rotas</span></td>
                        <td style={{ padding: '8px 12px' }}><span className="badge-gray">{v.bottom20Pct}% das rotas</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section title="Turnover por tipo de veículo">
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Veículo', 'Retidos', 'Saíram', 'Novos', 'Taxa de Turnover'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.turnoverByVehicle.map((v, i) => (
                      <tr key={v.vehicle} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{v.vehicle}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.retained}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.churned}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.newDrivers}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={v.turnoverRate > 30 ? 'badge-red' : v.turnoverRate > 15 ? 'badge-amber' : 'badge-green'}>
                            {v.turnoverRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {/* ── Sugestão SPR ── */}
        {tab === 'spr' && (
          <Section title="Sugestão de SPR — rotas PM1 por cluster" unavailable={result.missingColumns.includes('qty_delivering') || result.missingColumns.includes('Performance')}>
            {result.sprSuggestions.length === 0 ? (
              <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum cluster PM1 com volume suficiente para sugestão de SPR.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.sprSuggestions.map(s => (
                  <div key={s.cluster} style={{ background: '#22263a', border: '1px solid #2d3048', borderRadius: 8, padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{s.cluster}</span>
                      {s.suggestedSPR !== null
                        ? <span className="badge-green">SPR sugerido: {s.suggestedSPR} pacotes</span>
                        : <span className="badge-amber">{s.note}</span>
                      }
                    </div>
                    {s.bins.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.bins.map(b => (
                          <span key={b.label} style={{ fontSize: 11, background: b.avgPerformance >= 0.96 ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: b.avgPerformance >= 0.96 ? '#4ade80' : '#f87171', borderRadius: 4, padding: '2px 8px' }}>
                            {b.label}: {(b.avgPerformance * 100).toFixed(1)}% ({b.count})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}
