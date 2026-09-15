import { useMemo, useState } from 'react'
import type { StoredDriver } from '../../lib/localStore'

const STATUS_COLOR: Record<string, string> = {
  Active: 'badge-green',
  'Auto-Inactive': 'badge-gray',
  Onboarding: 'badge-blue',
  Suspended: 'badge-amber',
  'Suspended(KYC)': 'badge-red',
  'Suspended(FV)': 'badge-red',
  Deactivated: 'badge-red',
}

function statusClass(s: string) { return STATUS_COLOR[s] ?? 'badge-gray' }

function licenseStatus(expiryDate: string): { label: string; cls: string } | null {
  if (!expiryDate) return null
  const daysLeft = Math.floor((new Date(expiryDate).getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) return { label: 'CNH vencida', cls: 'badge-red' }
  if (daysLeft < 30) return { label: `CNH ${daysLeft}d`, cls: 'badge-red' }
  if (daysLeft < 90) return { label: `CNH ${daysLeft}d`, cls: 'badge-amber' }
  return null
}

interface Props {
  drivers: StoredDriver[]
}

export default function DriverList({ drivers }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [agencyFilter, setAgencyFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const PAGE_SIZE = 30

  const statuses = useMemo(() => ['all', ...new Set(drivers.map(d => d.status).filter(Boolean).sort())], [drivers])
  const vehicles = useMemo(() => ['all', ...new Set(drivers.map(d => d.vehicleType).filter(Boolean).sort())], [drivers])
  const agencies = useMemo(() => {
    const raw = new Set(drivers.map(d => d.agency === 'SPXOWNFLEET' ? 'SPXOWNFLEET' : d.agency).filter(Boolean))
    return ['all', ...raw]
  }, [drivers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => {
      if (q && !d.name.toLowerCase().includes(q) && !d.id.includes(q) && !d.city?.toLowerCase().includes(q)) return false
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
      if (vehicleFilter !== 'all' && d.vehicleType !== vehicleFilter) return false
      if (agencyFilter !== 'all') {
        const ag = d.agency === 'SPXOWNFLEET' ? 'SPXOWNFLEET' : d.agency
        if (ag !== agencyFilter) return false
      }
      return true
    })
  }, [drivers, search, statusFilter, vehicleFilter, agencyFilter])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const resetPage = () => setPage(0)

  const exportCSV = () => {
    const headers = ['id', 'name', 'status', 'vehicleType', 'agency', 'contractType', 'city', 'joinedDate', 'gender', 'licensePlate', 'licenseExpiryDate', 'vehicleManufacturer', 'vehicleManufacturingYear', 'lastKycDate', 'suspensionReason']
    const rows = filtered.map(d => headers.map(h => JSON.stringify((d as unknown as Record<string, unknown>)[h] ?? '')).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'motoristas_spx.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Buscar nome, ID, cidade..."
          value={search}
          onChange={e => { setSearch(e.target.value); resetPage() }}
          style={{ width: 220 }}
        />
        <Select value={statusFilter} onChange={v => { setStatusFilter(v); resetPage() }} options={statuses.map(s => ({ value: s, label: s === 'all' ? 'Todos status' : s }))} />
        <Select value={vehicleFilter} onChange={v => { setVehicleFilter(v); resetPage() }} options={vehicles.map(v => ({ value: v, label: v === 'all' ? 'Todos veículos' : v }))} />
        <Select value={agencyFilter} onChange={v => { setAgencyFilter(v); resetPage() }} options={agencies.map(a => ({ value: a, label: a === 'all' ? 'Todas agências' : a === 'SPXOWNFLEET' ? 'Frota própria' : a }))} />
        <span style={{ fontSize: 13, color: '#8892a4', marginLeft: 'auto' }}>{filtered.length} motoristas</span>
        <button onClick={exportCSV} style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
          Exportar CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 8, border: '1px solid #2d3048', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1a1d27', borderBottom: '1px solid #2d3048' }}>
                {['ID', 'Nome', 'Status', 'Veículo', 'Agência', 'Cidade', 'Entrada', 'Alertas'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((d, i) => {
                const licAlert = licenseStatus(d.licenseExpiryDate)
                const isExpanded = expanded === d.id
                return (
                  <>
                    <tr
                      key={d.id}
                      onClick={() => setExpanded(isExpanded ? null : d.id)}
                      style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>{d.id}</td>
                      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{d.name || '—'}</td>
                      <td style={{ padding: '8px 12px' }}><span className={statusClass(d.status)}>{d.status || '—'}</span></td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{d.vehicleType || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{d.agency === 'SPXOWNFLEET' ? 'Frota própria' : d.agency || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{d.city || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11 }}>{d.joinedDate || '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {d.spxBlocklisted && <span className="badge-red">Blocklist</span>}
                          {licAlert && <span className={licAlert.cls}>{licAlert.label}</span>}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${d.id}-expanded`} style={{ background: '#15182a' }}>
                        <td colSpan={8} style={{ padding: '12px 16px' }}>
                          <DriverDetail driver={d} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#8892a4', fontSize: 13 }}>Nenhum motorista encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? .4 : 1, fontSize: 13 }}>←</button>
          <span style={{ fontSize: 13, color: '#8892a4', alignSelf: 'center' }}>Pág. {page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? .4 : 1, fontSize: 13 }}>→</button>
        </div>
      )}
    </div>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#1a1d27', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Field({ label, value, highlight }: { label: string; value?: string; highlight?: boolean }) {
  if (!value) return null
  return (
    <div>
      <span style={{ fontSize: 11, color: '#8892a4' }}>{label}</span>
      <p style={{ margin: '1px 0 0', fontSize: 13, color: highlight ? '#fbbf24' : '#e2e8f0', fontWeight: highlight ? 600 : 400 }}>{value}</p>
    </div>
  )
}

function DriverDetail({ driver: d }: { driver: StoredDriver }) {
  const now = Date.now()
  const licenseExpired = d.licenseExpiryDate && new Date(d.licenseExpiryDate).getTime() < now

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px 20px' }}>
      <Field label="Telefone" value={d.phoneNumber} />
      <Field label="Gênero" value={d.gender} />
      <Field label="Data de nascimento" value={d.dateOfBirth} />
      <Field label="Placa" value={d.licensePlate} />
      <Field label="Tipo de contrato" value={d.contractType} />
      <Field label="Agência" value={d.agency === 'SPXOWNFLEET' ? 'Frota própria (SPX)' : d.agency} />
      <Field label="Cidade" value={d.city} />
      <Field label="Data de entrada" value={d.joinedDate} />
      <Field label="Validade CNH" value={d.licenseExpiryDate} highlight={!!licenseExpired} />
      <Field label="Fabricante do veículo" value={d.vehicleManufacturer} />
      <Field label="Ano do veículo" value={d.vehicleManufacturingYear} />
      <Field label="Último KYC" value={d.lastKycDate} />
      <Field label="KYC veículo" value={d.vehicleKycDate} />
      {d.suspensionReason && <Field label="Motivo suspensão" value={d.suspensionReason} highlight />}
      {d.spxBlocklisted && (
        <div><span className="badge-red" style={{ fontSize: 12 }}>Na blocklist SPX</span></div>
      )}
    </div>
  )
}
