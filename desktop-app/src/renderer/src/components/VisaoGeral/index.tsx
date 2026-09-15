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

export default function VisaoGeral({ registry, dsDrivers, selectedDay, selectedShift }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'DISPONIVEL' | 'ATRIBUIDA'>('all')
  const [copied, setCopied] = useState(false)

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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                  const dsColor = r.ds === null ? '#64748b' : r.ds * 100 >= 90 ? '#4ade80' : r.ds * 100 >= 70 ? '#a3e635' : r.ds * 100 >= 30 ? '#fbbf24' : '#f87171'
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
