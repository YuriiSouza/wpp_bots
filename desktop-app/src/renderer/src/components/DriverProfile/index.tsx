import { useMemo, useState } from 'react'
import type { DriverFullProfile } from '../../lib/crossAnalysis'

const LEVEL_STYLE = {
  red:    { color: '#ef4444', bg: 'rgba(239,68,68,.12)', dot: '#ef4444' },
  yellow: { color: '#f59e0b', bg: 'rgba(245,158,11,.12)', dot: '#f59e0b' },
  green:  { color: '#22c55e', bg: 'rgba(34,197,94,.10)', dot: '#22c55e' },
}

interface Props {
  profiles: DriverFullProfile[]
  today: string
}

export default function DriverProfile({ profiles, today }: Props) {
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all')
  const [availFilter, setAvailFilter] = useState<'all' | 'available' | 'not_available' | 'pending'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const counts = useMemo(() => ({
    red: profiles.filter(p => p.alertLevel === 'red').length,
    yellow: profiles.filter(p => p.alertLevel === 'yellow').length,
    green: profiles.filter(p => p.alertLevel === 'green').length,
  }), [profiles])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return profiles.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !p.id.includes(q)) return false
      if (levelFilter !== 'all' && p.alertLevel !== levelFilter) return false
      if (availFilter !== 'all') {
        const sched = p.scheduleByDate[today]
        const st = sched?.status ?? 'no_schedule'
        if (availFilter === 'available' && st !== 'available') return false
        if (availFilter === 'not_available' && st !== 'not_available') return false
        if (availFilter === 'pending' && st !== 'pending') return false
      }
      return true
    })
  }, [profiles, search, levelFilter, availFilter, today])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Visão do Motorista</h2>
        <p style={{ margin: '0 0 12px', fontSize: 11, color: '#8892a4' }}>
          Cruzamento de todos os relatórios · {profiles.length} motoristas identificados
        </p>

        {/* Level filter chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {(['all', 'red', 'yellow', 'green'] as const).map(level => {
            const active = levelFilter === level
            const s = level === 'all' ? null : LEVEL_STYLE[level]
            return (
              <button key={level}
                onClick={() => { setLevelFilter(level); setPage(0) }}
                style={{ background: active ? (s ? s.bg : 'rgba(59,130,246,.12)') : 'transparent', color: active ? (s?.color ?? '#60a5fa') : '#8892a4', border: `1px solid ${active ? (s?.color ?? '#3b82f6') + '44' : '#2d3048'}`, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: active ? 600 : 400 }}>
                {level === 'all' ? `Todos (${profiles.length})` : level === 'red' ? `🔴 Crítico (${counts.red})` : level === 'yellow' ? `🟡 Atenção (${counts.yellow})` : `🟢 OK (${counts.green})`}
              </button>
            )
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={availFilter} onChange={e => { setAvailFilter(e.target.value as typeof availFilter); setPage(0) }}
              style={{ background: '#1a1d27', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
              <option value="all">Disponibilidade: todas</option>
              <option value="available">Disponível hoje</option>
              <option value="not_available">Indisponível</option>
              <option value="pending">Pendente</option>
            </select>
            <input type="text" placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} style={{ width: 180 }} />
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{filtered.length} motoristas</p>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid #2d3048' }}>
              {['', 'Motorista', 'Status / Veículo', 'DS', 'Aceitação', 'Pacotes', 'Hoje', 'Alertas'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((p, i) => {
              const s = LEVEL_STYLE[p.alertLevel]
              const sched = p.scheduleByDate[today]
              const isExpanded = expanded === p.id
              return (
                <>
                  <tr key={p.id}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                    style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)', cursor: 'pointer' }}>
                    {/* Alert dot */}
                    <td style={{ padding: '8px 8px 8px 20px', width: 16 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot }} />
                    </td>
                    {/* Name */}
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {p.isNewDriver && <span style={{ background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>NOVO</span>}
                        <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{p.name}</span>
                      </div>
                      <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{p.id}</p>
                    </td>
                    {/* Status / Vehicle */}
                    <td style={{ padding: '8px 10px' }}>
                      <p style={{ margin: 0, color: p.status === 'Active' ? '#22c55e' : '#94a3b8', fontSize: 11 }}>{p.status || '—'}</p>
                      <p style={{ margin: 0, color: '#64748b', fontSize: 11 }}>{p.vehicleType || '—'}</p>
                    </td>
                    {/* DS */}
                    <td style={{ padding: '8px 10px' }}>
                      {p.dsReal !== null ? (
                        <>
                          <p style={{ margin: 0, fontWeight: 700, color: p.dsReal >= 0.95 ? '#22c55e' : '#ef4444' }}>
                            {(p.dsReal * 100).toFixed(1)}%
                          </p>
                          <p style={{ margin: 0, fontSize: 10, color: p.dsStatus === 'Melhorando' ? '#22c55e' : p.dsStatus === 'Piorando' ? '#ef4444' : '#64748b' }}>
                            {p.dsStatus ?? ''}
                          </p>
                        </>
                      ) : <span style={{ color: '#2d3048' }}>—</span>}
                    </td>
                    {/* Call Up acceptance */}
                    <td style={{ padding: '8px 10px' }}>
                      {p.callUpTotal > 0 ? (
                        <>
                          <p style={{ margin: 0, fontWeight: 600, color: (p.acceptanceRate ?? 0) < 50 ? '#ef4444' : (p.acceptanceRate ?? 0) < 75 ? '#f59e0b' : '#22c55e' }}>
                            {p.acceptanceRate}%
                          </p>
                          <p style={{ margin: 0, fontSize: 10, color: '#64748b' }}>{p.callUpAccepted}/{p.callUpTotal}</p>
                        </>
                      ) : <span style={{ color: '#2d3048' }}>—</span>}
                    </td>
                    {/* Pending packages */}
                    <td style={{ padding: '8px 10px' }}>
                      {p.pendingPackages > 0 ? (
                        <span style={{ background: p.isCritical ? 'rgba(167,139,250,.2)' : 'rgba(245,158,11,.12)', color: p.isCritical ? '#a78bfa' : '#f59e0b', borderRadius: 5, padding: '2px 8px', fontWeight: 700 }}>
                          {p.pendingPackages}
                        </span>
                      ) : <span style={{ color: '#2d3048' }}>—</span>}
                    </td>
                    {/* Today availability */}
                    <td style={{ padding: '8px 10px' }}>
                      {sched ? (
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: sched.status === 'available' ? '#22c55e' : sched.status === 'not_available' ? '#ef4444' : '#f59e0b' }}>
                            {sched.status === 'available' ? (sched.slots.join(' / ') || 'Disponível') : sched.status === 'not_available' ? 'Indisponível' : 'Pendente'}
                          </span>
                        </div>
                      ) : <span style={{ color: '#2d3048' }}>—</span>}
                    </td>
                    {/* Alerts */}
                    <td style={{ padding: '8px 10px' }}>
                      {p.alertReasons.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {p.alertReasons.map((r, ri) => (
                            <span key={ri} style={{ fontSize: 10, color: s.color, background: s.bg, borderRadius: 3, padding: '1px 5px' }}>{r}</span>
                          ))}
                        </div>
                      ) : <span style={{ fontSize: 10, color: '#22c55e' }}>OK</span>}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${p.id}-exp`} style={{ background: '#15182a' }}>
                      <td colSpan={8} style={{ padding: '12px 20px' }}>
                        <DriverDetail profile={p} today={today} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {paged.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#8892a4' }}>Nenhum motorista encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '8px 0', flexShrink: 0 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? .4 : 1, fontSize: 12 }}>←</button>
          <span style={{ fontSize: 12, color: '#8892a4', alignSelf: 'center' }}>Pág {page + 1}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? .4 : 1, fontSize: 12 }}>→</button>
        </div>
      )}
    </div>
  )
}

function DriverDetail({ profile: p, today }: { profile: DriverFullProfile; today: string }) {
  const upcomingDates = Object.entries(p.scheduleByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 7)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px 20px' }}>
      {/* Identity */}
      <Section title="Cadastro">
        <Row label="Cidade" value={p.city} />
        <Row label="Agência" value={p.agency === 'SPXOWNFLEET' ? 'Frota própria' : p.agency} />
        <Row label="Val. CNH" value={p.licenseExpiryDate} highlight={!!p.licenseExpiryDate && new Date(p.licenseExpiryDate) < new Date()} />
        <Row label="Último KYC" value={p.lastKycDate} />
        {p.spxBlocklisted && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444', fontWeight: 600 }}>🚫 Na blocklist SPX</p>}
      </Section>

      {/* DS */}
      {p.dsReal !== null && (
        <Section title="Análise DS">
          <Row label="DS_Real" value={p.dsReal !== null ? `${(p.dsReal * 100).toFixed(2)}%` : '—'} />
          <Row label="Tendência" value={p.dsStatus ?? '—'} />
          <Row label="Performance" value={p.performance !== null ? `${(p.performance * 100).toFixed(1)}%` : '—'} />
          <Row label="Cluster" value={p.clusterFromDs} />
        </Section>
      )}

      {/* Call Up */}
      {p.callUpTotal > 0 && (
        <Section title="Call Up">
          <Row label="Taxa aceitação" value={`${p.acceptanceRate}%`} />
          <Row label="Aceitas/Total" value={`${p.callUpAccepted}/${p.callUpTotal}`} />
          <Row label="Recusadas" value={String(p.callUpDeclined)} />
          <Row label="Timeouts" value={String(p.timeoutCount)} highlight={p.timeoutCount > 3} />
          {p.topDeclineReason && <Row label="Top motivo" value={p.topDeclineReason} />}
        </Section>
      )}

      {/* Forward Order */}
      {p.pendingPackages > 0 && (
        <Section title="Pacotes em aberto">
          <Row label="Total" value={String(p.pendingPackages)} highlight={p.isCritical} />
          <Row label="Delivering" value={String(p.deliveringPending)} />
          <Row label="On Hold" value={String(p.onHoldPending)} />
          <Row label="Mais antigo" value={p.oldestDays > 0 ? `${p.oldestDays} dias` : '—'} highlight={p.oldestDays >= 3} />
        </Section>
      )}

      {/* Schedule */}
      {upcomingDates.length > 0 && (
        <Section title="Disponibilidade">
          {upcomingDates.map(([date, s]) => (
            <div key={date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: date === today ? '#e2e8f0' : '#64748b', fontWeight: date === today ? 600 : 400 }}>
                {date.slice(5)} {date === today ? '(hoje)' : ''}
              </span>
              <span style={{ fontSize: 10, color: s.status === 'available' ? '#22c55e' : s.status === 'not_available' ? '#ef4444' : s.status === 'pending' ? '#f59e0b' : '#2d3048', fontWeight: 600 }}>
                {s.status === 'available' ? (s.slots.join(' / ') || '✓') : s.status === 'not_available' ? '✗' : s.status === 'pending' ? '?' : '—'}
              </span>
            </div>
          ))}
          {p.clustersFromWorkPref.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {p.clustersFromWorkPref.slice(0, 6).map(c => (
                <span key={c} style={{ background: 'rgba(139,92,246,.12)', color: '#a78bfa', borderRadius: 3, padding: '1px 5px', fontSize: 9 }}>{c}</span>
              ))}
              {p.clustersFromWorkPref.length > 6 && <span style={{ color: '#64748b', fontSize: 9 }}>+{p.clustersFromWorkPref.length - 6}</span>}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</p>
      {children}
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 11, color: highlight ? '#fbbf24' : '#e2e8f0', fontWeight: highlight ? 600 : 400 }}>{value}</span>
    </div>
  )
}
