import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import type { ForwardOrderAnalysis, ForwardPackage, DriverForwardStats } from '../../lib/forwardOrderParser'
import { REASON_ACTION_MAP } from '../../lib/forwardOrderParser'
import type { StoredDriver } from '../../lib/localStore'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
})

type Tab = 'criticos' | 'agencias' | 'pivot' | 'mapa' | 'lista'

interface DriverMeta { vehicleType: string; ds: number | null; phoneNumber: string; agency: string; isNewDriver?: boolean }

interface Props {
  data: ForwardOrderAnalysis
  registry?: StoredDriver[]
  driverMeta?: Map<string, DriverMeta>
}

// 20 distinct colors for map markers
const DRIVER_COLORS = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#6366f1','#eab308','#10b981','#f43f5e','#8b5cf6',
  '#0ea5e9','#d946ef','#fb923c','#a3e635','#2dd4bf',
]

export default function ForwardOrder({ data, registry = [], driverMeta }: Props) {
  const [tab, setTab] = useState<Tab>('criticos')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Delivering' | 'OnHold'>('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 40

  // Build registry map
  const registryMap = useMemo(() => {
    const m = new Map<string, StoredDriver>()
    for (const d of registry) m.set(d.id, d)
    return m
  }, [registry])

  // Combined driver meta (registry + ds)
  const fullDriverMeta = useMemo(() => {
    const m = new Map<string, DriverMeta>()
    for (const d of registry) {
      m.set(d.id, {
        vehicleType: d.vehicleType,
        ds: null,
        phoneNumber: d.phoneNumber,
        agency: d.agency,
      })
    }
    if (driverMeta) {
      for (const [id, dm] of driverMeta) {
        const prev = m.get(id) ?? { vehicleType: '', ds: null, phoneNumber: '', agency: '' }
        m.set(id, { ...prev, vehicleType: dm.vehicleType || prev.vehicleType, ds: dm.ds, isNewDriver: dm.isNewDriver ?? prev.isNewDriver })
      }
    }
    return m
  }, [registry, driverMeta])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'criticos', label: `Críticos (${data.criticalDrivers.length})` },
    { key: 'agencias', label: 'Por Agência' },
    { key: 'pivot', label: 'Pivot Data × Motivo' },
    { key: 'mapa', label: 'Mapa' },
    { key: 'lista', label: `Todos (${data.totalPackages})` },
  ]

  const filteredPkgs = useMemo(() => data.packages.filter(p => {
    const q = search.toLowerCase()
    if (q && !p.driverName.toLowerCase().includes(q) && !p.driverId.includes(q) && !p.trackingNumber.toLowerCase().includes(q)) return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    return true
  }), [data.packages, search, statusFilter])

  const pagedPkgs = filteredPkgs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filteredPkgs.length / PAGE_SIZE)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Pacotes em Aberto</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
            {data.fileName} · {new Date(data.importedAt).toLocaleDateString('pt-BR')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <SumCard label="Total em aberto" value={data.totalPackages} color="#e2e8f0" />
          <SumCard label="Delivering (sem resolução)" value={data.totalDelivering} color="#f59e0b" />
          <SumCard label="On Hold" value={data.totalOnHold} color="#ef4444" />
          <SumCard label="Motoristas críticos (10+)" value={data.criticalDrivers.length} color="#a78bfa" />
        </div>

        <div style={{ display: 'flex', gap: 0 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ background: 'transparent', color: tab === t.key ? '#e2e8f0' : '#8892a4', border: 'none', borderBottom: `2px solid ${tab === t.key ? '#3b82f6' : 'transparent'}`, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 600 : 400 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: tab === 'mapa' ? 'hidden' : 'auto', padding: tab === 'mapa' ? 0 : '16px 20px', display: 'flex', flexDirection: 'column' }}>
        {tab === 'criticos' && <CriticosTab data={data} fullDriverMeta={fullDriverMeta} registryMap={registryMap} />}
        {tab === 'agencias' && <AgenciasTab data={data} fullDriverMeta={fullDriverMeta} />}
        {tab === 'pivot' && <PivotTab data={data} />}
        {tab === 'mapa' && <MapaTab data={data} fullDriverMeta={fullDriverMeta} />}
        {tab === 'lista' && (
          <ListaTab
            packages={pagedPkgs}
            filtered={filteredPkgs}
            search={search}
            onSearch={s => { setSearch(s); setPage(0) }}
            statusFilter={statusFilter}
            onStatusFilter={f => { setStatusFilter(f as typeof statusFilter); setPage(0) }}
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            fullDriverMeta={fullDriverMeta}
          />
        )}
      </div>
    </div>
  )
}

// ─── Agency Print Modal ───────────────────────────────────────────────────────
interface AgencyPrintData {
  agency: string
  date: string
  total: number
  delivering: number
  onHold: number
  drivers: number
  criticalDrivers: number
  byReason: Record<string, number>
  driverList: { driverId: string; driverName: string; vehicleType: string; total: number; delivering: number; onHold: number; isCritical: boolean; isNewDriver?: boolean }[]
}

function AgencyPrintModal({ d, onClose }: { d: AgencyPrintData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@media print { .no-print { display: none !important; } .print-root { box-shadow: none !important; border-radius: 0 !important; max-height: none !important; width: 100% !important; } }`}</style>
      <div className="print-root" style={{ background: '#fff', color: '#111', borderRadius: 10, padding: 28, width: 740, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#111' }}>{d.agency}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>Pacotes em aberto · {d.date}</p>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.print()} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨️ Imprimir</button>
            <button onClick={onClose} style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>✕ Fechar</button>
          </div>
        </div>

        {/* Cards */}
        <div style={{ display: 'flex', gap: 10, margin: '14px 0', flexWrap: 'wrap' }}>
          {[
            { label: 'Total', value: d.total, color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
            { label: 'Delivering', value: d.delivering, color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
            { label: 'On Hold', value: d.onHold, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
            { label: 'Motoristas', value: d.drivers, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
            ...(d.driverList.filter(x => x.isNewDriver).length > 0 ? [{ label: 'Novatos', value: d.driverList.filter(x => x.isNewDriver).length, color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' }] : []),
            ...(d.criticalDrivers > 0 ? [{ label: 'Críticos', value: d.criticalDrivers, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }] : []),
          ].map(c => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 16px', minWidth: 80 }}>
              <p style={{ margin: 0, fontSize: 10, color: c.color, textTransform: 'uppercase', fontWeight: 600 }}>{c.label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Motivos */}
        <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>Motivos</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(d.byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
            <span key={reason} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 10px', fontSize: 11 }}>
              {reason}: <strong>{count}</strong>
            </span>
          ))}
        </div>

        {/* Motoristas */}
        <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>Motoristas</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              {['Motorista', 'Veículo', 'Total', 'Delivering', 'On Hold'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.driverList.map((dr, i) => (
              <tr key={dr.driverId} style={{ borderBottom: '1px solid #f3f4f6', background: dr.isCritical ? '#fef2f2' : i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ fontWeight: dr.isCritical ? 700 : 400, color: dr.isCritical ? '#dc2626' : '#111' }}>{dr.driverName}</span>
                  {dr.isNewDriver && <span style={{ marginLeft: 6, fontSize: 9, background: '#ede9fe', color: '#7c3aed', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>NOVATO</span>}
                  {dr.isCritical && <span style={{ marginLeft: 6, fontSize: 9, background: '#fee2e2', color: '#dc2626', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>CRÍTICO</span>}
                  <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{dr.driverId}</p>
                </td>
                <td style={{ padding: '6px 12px', color: '#6b7280' }}>{dr.vehicleType || '—'}</td>
                <td style={{ padding: '6px 12px', fontWeight: 700, color: '#7c3aed' }}>{dr.total}</td>
                <td style={{ padding: '6px 12px', color: '#d97706' }}>{dr.delivering || '—'}</td>
                <td style={{ padding: '6px 12px', color: '#dc2626' }}>{dr.onHold || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Agências Tab ─────────────────────────────────────────────────────────────
function AgenciasTab({ data, fullDriverMeta }: { data: ForwardOrderAnalysis; fullDriverMeta: Map<string, DriverMeta> }) {
  interface AgencyDriver {
    driverId: string
    driverName: string
    total: number
    delivering: number
    onHold: number
    isCritical: boolean
    vehicleType: string
    isNewDriver: boolean
  }

  interface AgencyStat {
    agency: string
    total: number
    delivering: number
    onHold: number
    drivers: number
    criticalDrivers: number
    byReason: Record<string, number>
    driverList: AgencyDriver[]
  }

  const stats = useMemo((): AgencyStat[] => {
    const map = new Map<string, AgencyStat>()
    const UNKNOWN = '(sem agência)'
    // Per-driver stats
    const driverMap = new Map<string, AgencyDriver & { agency: string }>()
    for (const pkg of data.packages) {
      const agency = fullDriverMeta.get(pkg.driverId)?.agency?.trim() || UNKNOWN
      if (!map.has(agency)) map.set(agency, { agency, total: 0, delivering: 0, onHold: 0, drivers: 0, criticalDrivers: 0, byReason: {}, driverList: [] })
      const s = map.get(agency)!
      s.total++
      if (pkg.status === 'Delivering') s.delivering++
      else s.onHold++
      if (pkg.displayReason) s.byReason[pkg.displayReason] = (s.byReason[pkg.displayReason] ?? 0) + 1

      if (!driverMap.has(pkg.driverId)) {
        driverMap.set(pkg.driverId, {
          driverId: pkg.driverId,
          driverName: pkg.driverName,
          total: 0, delivering: 0, onHold: 0,
          isCritical: false,
          vehicleType: fullDriverMeta.get(pkg.driverId)?.vehicleType ?? '',
          isNewDriver: fullDriverMeta.get(pkg.driverId)?.isNewDriver ?? false,
          agency,
        })
      }
      const d = driverMap.get(pkg.driverId)!
      d.total++
      if (pkg.status === 'Delivering') d.delivering++
      else d.onHold++
    }
    const criticalIds = new Set(data.criticalDrivers.map(d => d.driverId))
    for (const d of driverMap.values()) {
      d.isCritical = criticalIds.has(d.driverId)
      const s = map.get(d.agency)
      if (s) s.driverList.push(d)
    }
    for (const s of map.values()) {
      s.drivers = s.driverList.length
      s.criticalDrivers = s.driverList.filter(d => d.isCritical).length
      s.driverList.sort((a, b) => b.total - a.total)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [data, fullDriverMeta])

  const grandTotal = stats.reduce((s, a) => s + a.total, 0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [printModal, setPrintModal] = useState<AgencyPrintData | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {printModal && <AgencyPrintModal d={printModal} onClose={() => setPrintModal(null)} />}
      <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
        {stats.length} agências · {grandTotal} pacotes em aberto
        {stats.some(s => s.agency === '(sem agência)') && (
          <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠ Motoristas sem agência no cadastro contam como "(sem agência)"</span>
        )}
      </p>

      <div style={{ borderRadius: 8, border: '1px solid #2d3048', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#1a1d27', borderBottom: '1px solid #2d3048' }}>
              {['Agência', 'Total', 'Delivering', 'On Hold', 'Motoristas', 'Críticos', '% do total', 'Top motivo'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => {
              const pct = grandTotal > 0 ? (s.total / grandTotal) * 100 : 0
              const topReason = Object.entries(s.byReason).sort((a, b) => b[1] - a[1])[0]
              const isExp = expanded === s.agency
              return (
                <>
                  <tr
                    key={s.agency}
                    onClick={() => setExpanded(isExp ? null : s.agency)}
                    style={{ borderBottom: isExp ? 'none' : '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '7px 12px', color: '#e2e8f0', fontWeight: 600 }}>
                      <span style={{ marginRight: 6, color: '#4b5563', fontSize: 10 }}>{isExp ? '▾' : '▸'}</span>
                      {s.agency}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ background: 'rgba(167,139,250,.15)', color: '#a78bfa', borderRadius: 5, padding: '2px 8px', fontWeight: 700, fontSize: 13 }}>{s.total}</span>
                    </td>
                    <td style={{ padding: '7px 12px', color: '#f59e0b', fontWeight: 600 }}>{s.delivering}</td>
                    <td style={{ padding: '7px 12px', color: '#ef4444', fontWeight: 600 }}>{s.onHold}</td>
                    <td style={{ padding: '7px 12px', color: '#94a3b8' }}>{s.drivers}</td>
                    <td style={{ padding: '7px 12px' }}>
                      {s.criticalDrivers > 0
                        ? <span style={{ background: 'rgba(239,68,68,.12)', color: '#f87171', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{s.criticalDrivers}</span>
                        : <span style={{ color: '#374151' }}>—</span>}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#7c3aed', borderRadius: 3 }} />
                        </div>
                        <span style={{ color: '#8892a4', fontSize: 11 }}>{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '7px 12px', color: '#94a3b8', fontSize: 11 }}>
                      {topReason ? <><strong style={{ color: '#e2e8f0' }}>{topReason[1]}</strong> {topReason[0]}</> : '—'}
                    </td>
                  </tr>
                  {isExp && (
                    <tr key={s.agency + '-exp'} style={{ borderBottom: '1px solid #2d3048', background: '#0d0f1a' }}>
                      <td colSpan={8} style={{ padding: '10px 20px 14px' }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                          {/* Motivos */}
                          <div style={{ flex: '0 0 auto' }}>
                            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#8892a4' }}>Motivos</p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {Object.entries(s.byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                                <div key={reason} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                                  <span style={{ color: '#94a3b8' }}>{reason}: </span>
                                  <strong style={{ color: '#e2e8f0' }}>{count}</strong>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Motoristas */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 6px' }}>
                          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8892a4' }}>Motoristas ({s.driverList.length})</p>
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              setPrintModal({
                                agency: s.agency,
                                date: new Date(data.importedAt).toLocaleDateString('pt-BR'),
                                total: s.total, delivering: s.delivering, onHold: s.onHold,
                                drivers: s.drivers, criticalDrivers: s.criticalDrivers,
                                byReason: s.byReason, driverList: s.driverList,
                              })
                            }}
                            style={{ background: 'rgba(124,58,237,.15)', border: '1px solid rgba(124,58,237,.3)', color: '#a78bfa', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                          >
                            🖨️ Gerar print
                          </button>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr style={{ background: '#13151f', borderBottom: '1px solid #2d3048' }}>
                              {['Motorista', 'Veículo', 'Total', 'Delivering', 'On Hold'].map(h => (
                                <th key={h} style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {s.driverList.map(d => (
                              <tr key={d.driverId} style={{ borderBottom: '1px solid #1a1d27', background: d.isCritical ? 'rgba(239,68,68,.04)' : 'transparent' }}>
                                <td style={{ padding: '5px 10px' }}>
                                  <span style={{ color: d.isCritical ? '#f87171' : '#e2e8f0', fontWeight: d.isCritical ? 600 : 400 }}>{d.driverName}</span>
                                  {d.isNewDriver && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(139,92,246,.15)', color: '#a78bfa', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>NOVATO</span>}
                                  {d.isCritical && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(239,68,68,.15)', color: '#f87171', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>CRÍTICO</span>}
                                  <p style={{ margin: 0, fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>{d.driverId}</p>
                                </td>
                                <td style={{ padding: '5px 10px', color: '#64748b' }}>{d.vehicleType || '—'}</td>
                                <td style={{ padding: '5px 10px' }}>
                                  <span style={{ background: 'rgba(167,139,250,.12)', color: '#a78bfa', borderRadius: 4, padding: '1px 7px', fontWeight: 700 }}>{d.total}</span>
                                </td>
                                <td style={{ padding: '5px 10px', color: '#f59e0b' }}>{d.delivering || '—'}</td>
                                <td style={{ padding: '5px 10px', color: '#ef4444' }}>{d.onHold || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SumCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card-sm">
      <p style={{ margin: '0 0 2px', fontSize: 11, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color }}>{value}</p>
    </div>
  )
}

// ─── Driver meta badge (vehicle + DS) ─────────────────────────────────────────
function DriverMetaBadge({ driverId, meta }: { driverId: string; meta: Map<string, DriverMeta> }) {
  const m = meta.get(driverId)
  if (!m) return null
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
      {m.vehicleType && (
        <span style={{ fontSize: 9, color: '#475569', background: '#1e2130', borderRadius: 3, padding: '1px 5px', fontWeight: 600, letterSpacing: '.03em' }}>
          {m.vehicleType}
        </span>
      )}
      {m.ds != null && (
        <span style={{ fontSize: 9, color: '#475569' }}>DS {(m.ds * 100).toFixed(2)}%</span>
      )}
      {m.agency && (
        <span style={{ fontSize: 9, color: '#475569' }}>{m.agency}</span>
      )}
    </span>
  )
}

// ─── Críticos Tab ─────────────────────────────────────────────────────────────
function CriticosTab({ data, fullDriverMeta, registryMap }: {
  data: ForwardOrderAnalysis
  fullDriverMeta: Map<string, DriverMeta>
  registryMap: Map<string, StoredDriver>
}) {
  const [copied, setCopied] = useState<string | null>(null)

  const handleCopy = useCallback((driverId: string) => {
    const driver = registryMap.get(driverId)
    const phone = fullDriverMeta.get(driverId)?.phoneNumber || driver?.phoneNumber || ''
    if (!phone) return
    navigator.clipboard.writeText(phone)
    setCopied(driverId)
    setTimeout(() => setCopied(null), 1500)
  }, [registryMap, fullDriverMeta])

  const handleWhatsApp = useCallback((driverId: string, driverName: string) => {
    const driver = registryMap.get(driverId)
    const phone = fullDriverMeta.get(driverId)?.phoneNumber || driver?.phoneNumber || ''
    if (!phone) return
    // Strip non-digits, ensure country code
    const digits = phone.replace(/\D/g, '')
    const withCode = digits.startsWith('55') ? digits : `55${digits}`
    const msg = encodeURIComponent(`Olá ${driverName}, tudo bem? Preciso falar sobre seus pacotes em aberto.`)
    window.open(`https://wa.me/${withCode}?text=${msg}`, '_blank')
  }, [registryMap, fullDriverMeta])

  const [copiedAll, setCopiedAll] = useState(false)

  const handleCopyAll = useCallback(() => {
    const phones = data.criticalDrivers
      .map(d => fullDriverMeta.get(d.driverId)?.phoneNumber || registryMap.get(d.driverId)?.phoneNumber || '')
      .filter(Boolean)
    if (!phones.length) return
    navigator.clipboard.writeText(phones.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }, [data.criticalDrivers, fullDriverMeta, registryMap])

  if (data.criticalDrivers.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: 28 }}>✅</p>
        <p style={{ color: '#4ade80', fontWeight: 600 }}>Nenhum motorista crítico</p>
        <p style={{ color: '#8892a4', fontSize: 13 }}>Todos os motoristas têm menos de 10 pacotes em aberto</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleCopyAll}
          style={{ background: copiedAll ? 'rgba(34,197,94,.15)' : '#1e2130', border: `1px solid ${copiedAll ? 'rgba(34,197,94,.4)' : '#2d3048'}`, borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: copiedAll ? '#4ade80' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
          {copiedAll ? '✓ Copiado!' : '📋 Copiar todos os números'}
        </button>
      </div>

      <div style={{ borderRadius: 8, border: '1px solid #2d3048', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#1a1d27', borderBottom: '1px solid #2d3048' }}>
              {['Motorista', 'Contato', 'Total', 'Delivering', 'On Hold', 'Motivos', 'Mais antigo'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.criticalDrivers.map((d, i) => {
              const phone = fullDriverMeta.get(d.driverId)?.phoneNumber || registryMap.get(d.driverId)?.phoneNumber || ''
              return (
                <tr key={d.driverId} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                  <td style={{ padding: '7px 12px' }}>
                    <p style={{ margin: 0, color: '#e2e8f0', fontWeight: 500 }}>{d.driverName}</p>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{d.driverId}</span>
                    </span>
                    <DriverMetaBadge driverId={d.driverId} meta={fullDriverMeta} />
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    {phone ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          onClick={() => handleCopy(d.driverId)}
                          title="Copiar número"
                          style={{ background: copied === d.driverId ? 'rgba(34,197,94,.15)' : '#1e2130', border: '1px solid #2d3048', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: copied === d.driverId ? '#4ade80' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {copied === d.driverId ? '✓' : '📋'} {phone}
                        </button>
                        <button
                          onClick={() => handleWhatsApp(d.driverId, d.driverName)}
                          title="Abrir WhatsApp"
                          style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: '#4ade80' }}>
                          WhatsApp
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#374151' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{ background: 'rgba(167,139,250,.15)', color: '#a78bfa', borderRadius: 5, padding: '2px 8px', fontWeight: 700, fontSize: 13 }}>{d.totalPackages}</span>
                  </td>
                  <td style={{ padding: '7px 12px', color: '#f59e0b' }}>{d.delivering}</td>
                  <td style={{ padding: '7px 12px', color: '#ef4444' }}>{d.onHold}</td>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: '#94a3b8', maxWidth: 220 }}>
                    {Object.entries(d.byReason).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => (
                      <div key={r}>{r}: <strong style={{ color: '#e2e8f0' }}>{n}</strong></div>
                    ))}
                  </td>
                  <td style={{ padding: '7px 12px', color: d.oldestDays >= 3 ? '#ef4444' : d.oldestDays >= 2 ? '#f59e0b' : '#8892a4' }}>
                    {d.oldestDays > 0 ? `${d.oldestDays}d` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Pivot Tab (heatmap) ───────────────────────────────────────────────────────
function PivotTab({ data }: { data: ForwardOrderAnalysis }) {
  const onHoldReasons = data.reasons.filter(r => r !== 'Sem resolução (Delivering)')
  const showDelivering = data.reasons.includes('Sem resolução (Delivering)')

  // Max value per reason column for heatmap intensity
  const colMax = useMemo(() => {
    const m: Record<string, number> = {}
    for (const row of data.pivot) {
      for (const [r, v] of Object.entries(row.byReason)) {
        m[r] = Math.max(m[r] ?? 0, v)
      }
    }
    return m
  }, [data.pivot])

  const heatBg = (reason: string, value: number | undefined) => {
    if (!value) return 'transparent'
    const max = colMax[reason] || 1
    const intensity = value / max
    if (reason === 'Sem resolução (Delivering)') {
      return `rgba(245,158,11,${0.08 + intensity * 0.35})`
    }
    return `rgba(239,68,68,${0.06 + intensity * 0.35})`
  }

  const heatColor = (reason: string, value: number | undefined) => {
    if (!value) return '#374151'
    return reason === 'Sem resolução (Delivering)' ? '#fbbf24' : '#f87171'
  }

  const totalsRow: Record<string, number> = {}
  for (const row of data.pivot) {
    for (const [r, v] of Object.entries(row.byReason)) {
      totalsRow[r] = (totalsRow[r] ?? 0) + v
    }
  }

  // Transposed: reasons as rows, dates as columns — fewer rows than columns, no horizontal scroll
  const allReasons = [
    ...(showDelivering ? ['Sem resolução (Delivering)'] : []),
    ...onHoldReasons,
  ]
  const dates = data.pivot.map(r => r.date)

  const rowMax = useMemo(() => {
    const m: Record<string, number> = {}
    for (const reason of allReasons) {
      m[reason] = Math.max(...data.pivot.map(r => r.byReason[reason] ?? 0), 1)
    }
    return m
  }, [data.pivot])

  const cellBg = (reason: string, v: number | undefined) => {
    if (!v) return 'transparent'
    const intensity = v / (rowMax[reason] || 1)
    return reason === 'Sem resolução (Delivering)'
      ? `rgba(245,158,11,${0.07 + intensity * 0.38})`
      : `rgba(239,68,68,${0.05 + intensity * 0.38})`
  }
  const cellColor = (reason: string, v: number | undefined) =>
    !v ? '#374151' : reason === 'Sem resolução (Delivering)' ? '#fbbf24' : '#f87171'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(239,68,68,.4)', display: 'inline-block' }} />
          On Hold — intensidade relativa por motivo
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(245,158,11,.4)', display: 'inline-block' }} />
          Delivering
        </span>
      </div>

      <div style={{ borderRadius: 10, border: '1px solid #2d3048', overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: '#1a1d27', borderBottom: '2px solid #2d3048' }}>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', position: 'sticky', left: 0, background: '#1a1d27', zIndex: 2, whiteSpace: 'nowrap', minWidth: 210 }}>Motivo</th>
              {dates.map(d => (
                <th key={d} style={{ padding: '8px 8px', textAlign: 'center', fontSize: 10, color: '#8892a4', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 52 }}>
                  {d.slice(5)}
                </th>
              ))}
              <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {allReasons.map((reason, i) => (
              <tr key={reason} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                <td style={{ padding: '7px 14px', position: 'sticky', left: 0, background: i % 2 === 0 ? '#0f1117' : '#111420', zIndex: 1, whiteSpace: 'nowrap', fontSize: 12, color: reason === 'Sem resolução (Delivering)' ? '#fbbf24' : '#f87171', fontWeight: 500 }}>
                  {reason}
                </td>
                {dates.map(d => {
                  const v = data.pivot.find(r => r.date === d)?.byReason[reason]
                  return (
                    <td key={d} style={{ padding: '7px 8px', textAlign: 'center', background: cellBg(reason, v), color: cellColor(reason, v), fontWeight: v ? 700 : 400, fontSize: 12 }}>
                      {v ?? '—'}
                    </td>
                  )
                })}
                <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: reason === 'Sem resolução (Delivering)' ? '#fbbf24' : '#f87171' }}>
                  {totalsRow[reason] || '—'}
                </td>
              </tr>
            ))}
            <tr style={{ background: '#1a1d27', borderTop: '2px solid #2d3048' }}>
              <td style={{ padding: '8px 14px', color: '#8892a4', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', position: 'sticky', left: 0, background: '#1a1d27', zIndex: 1 }}>Total por data</td>
              {dates.map(d => {
                const row = data.pivot.find(r => r.date === d)
                return <td key={d} style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 700, color: '#e2e8f0' }}>{row?.total ?? '—'}</td>
              })}
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#e2e8f0' }}>{data.totalPackages}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Mapa Tab ─────────────────────────────────────────────────────────────────
function MapaTab({ data, fullDriverMeta }: { data: ForwardOrderAnalysis; fullDriverMeta: Map<string, DriverMeta> }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.LayerGroup | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<string>('all')

  const pkgsWithCoords = useMemo(() =>
    data.packages.filter(p => p.latitude != null && p.longitude != null),
    [data.packages]
  )

  // Assign a color per driver
  const driverColorMap = useMemo(() => {
    const ids = [...new Set(pkgsWithCoords.map(p => p.driverId))]
    const m = new Map<string, string>()
    ids.forEach((id, i) => m.set(id, DRIVER_COLORS[i % DRIVER_COLORS.length]))
    return m
  }, [pkgsWithCoords])

  const driverList = useMemo(() => {
    const ids = [...new Set(pkgsWithCoords.map(p => p.driverId))]
    return ids.map(id => ({ id, name: pkgsWithCoords.find(p => p.driverId === id)?.driverName ?? id }))
  }, [pkgsWithCoords])

  const makeIcon = useCallback((color: string, isOffice: boolean) => {
    const shape = isOffice
      ? `<rect x="4" y="4" width="16" height="16" rx="3" fill="${color}"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-family="sans-serif">🏢</text>`
      : `<circle cx="12" cy="12" r="8" fill="${color}"/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${shape}</svg>`
    return L.divIcon({
      html: `<div style="width:24px;height:24px">${svg}</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
  }, [])

  // Init map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)
    mapInstanceRef.current = map
    markersRef.current = L.layerGroup().addTo(map)
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  // Update markers when filter changes
  useEffect(() => {
    const map = mapInstanceRef.current
    const layer = markersRef.current
    if (!map || !layer) return
    layer.clearLayers()

    const filtered = selectedDriver === 'all'
      ? pkgsWithCoords
      : pkgsWithCoords.filter(p => p.driverId === selectedDriver)

    if (filtered.length === 0) return

    filtered.forEach(p => {
      const color = driverColorMap.get(p.driverId) ?? '#94a3b8'
      const isOffice = (p.locationType || '').toLowerCase().includes('office')
      const icon = makeIcon(color, isOffice)
      const marker = L.marker([p.latitude!, p.longitude!], { icon })
      marker.bindPopup(`
        <div style="font-size:12px;line-height:1.5">
          <strong>${p.trackingNumber || p.orderId}</strong><br/>
          ${p.driverName} · ${p.driverId}<br/>
          ${p.locationType || ''}<br/>
          <span style="color:${p.status === 'Delivering' ? '#f59e0b' : '#ef4444'}">${p.status}</span>
          ${p.displayReason ? ` — ${p.displayReason}` : ''}
        </div>
      `)
      layer.addLayer(marker)
    })

    // Fit bounds
    const coords = filtered.map(p => [p.latitude!, p.longitude!] as [number, number])
    if (coords.length === 1) {
      map.setView(coords[0], 14)
    } else {
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] })
    }
  }, [pkgsWithCoords, selectedDriver, driverColorMap, makeIcon])

  if (pkgsWithCoords.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#64748b' }}>
        <span style={{ fontSize: 32 }}>🗺️</span>
        <p style={{ margin: 0, fontSize: 13 }}>Nenhum pacote com coordenadas disponíveis</p>
        <p style={{ margin: 0, fontSize: 11 }}>As colunas Latitude e Longitude precisam estar preenchidas no CSV</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2d3048', background: '#0f1117', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={selectedDriver}
          onChange={e => setSelectedDriver(e.target.value)}
          style={{ background: '#1a1d27', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
          <option value="all">Todos os motoristas ({pkgsWithCoords.length} pacotes)</option>
          {driverList.map(d => (
            <option key={d.id} value={d.id}>{d.name} — {pkgsWithCoords.filter(p => p.driverId === d.id).length} pacotes</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {driverList.slice(0, 10).map(d => (
            <button key={d.id} onClick={() => setSelectedDriver(d.id === selectedDriver ? 'all' : d.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, border: `1px solid ${selectedDriver === d.id ? driverColorMap.get(d.id)! : '#2d3048'}`, background: selectedDriver === d.id ? `${driverColorMap.get(d.id)}22` : 'transparent', cursor: 'pointer', fontSize: 11, color: selectedDriver === d.id ? driverColorMap.get(d.id)! : '#8892a4' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: driverColorMap.get(d.id), display: 'inline-block', flexShrink: 0 }} />
              {d.name.split(' ')[0]}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, color: '#64748b', alignItems: 'center' }}>
          <span>🏠 Home</span>
          <span>🏢 Office</span>
        </div>
      </div>
      {/* Map */}
      <div ref={mapRef} style={{ flex: 1 }} />
    </div>
  )
}

// ─── Lista Tab ────────────────────────────────────────────────────────────────
function ListaTab({ packages, filtered, search, onSearch, statusFilter, onStatusFilter, page, totalPages, onPage, fullDriverMeta }: {
  packages: ForwardPackage[]
  filtered: ForwardPackage[]
  search: string
  onSearch: (s: string) => void
  statusFilter: string
  onStatusFilter: (f: string) => void
  page: number
  totalPages: number
  onPage: (p: number) => void
  fullDriverMeta: Map<string, DriverMeta>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Buscar motorista, rastreio..." value={search} onChange={e => onSearch(e.target.value)} style={{ width: 220 }} />
        <select value={statusFilter} onChange={e => onStatusFilter(e.target.value)}
          style={{ background: '#1a1d27', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
          <option value="all">Todos</option>
          <option value="Delivering">Delivering</option>
          <option value="OnHold">On Hold</option>
        </select>
        <span style={{ fontSize: 12, color: '#8892a4' }}>{filtered.length} pacotes</span>
      </div>

      <div style={{ borderRadius: 8, border: '1px solid #2d3048', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#1a1d27', borderBottom: '1px solid #2d3048' }}>
              {['Rastreio', 'Motorista', 'Status', 'Motivo', 'Data saída', 'Dias', 'Tentativas'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packages.map((p, i) => (
              <tr key={p.orderId + i} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11, color: '#60a5fa' }}>{p.trackingNumber || p.orderId}</td>
                <td style={{ padding: '6px 12px' }}>
                  <p style={{ margin: 0, color: '#e2e8f0' }}>{p.driverName}</p>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
                    <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{p.driverId}</span>
                  </span>
                  <DriverMetaBadge driverId={p.driverId} meta={fullDriverMeta} />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ background: p.status === 'Delivering' ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)', color: p.status === 'Delivering' ? '#fbbf24' : '#f87171', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600 }}>
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>{p.displayReason}</td>
                <td style={{ padding: '6px 12px', color: '#64748b' }}>{p.deliveringTime || p.onHoldTime}</td>
                <td style={{ padding: '6px 12px', color: p.daysOpen >= 3 ? '#ef4444' : p.daysOpen >= 2 ? '#f59e0b' : '#8892a4', fontWeight: p.daysOpen >= 2 ? 600 : 400 }}>
                  {p.daysOpen > 0 ? `${p.daysOpen}d` : '—'}
                </td>
                <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{p.deliveryAttempts || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? .4 : 1, fontSize: 12 }}>←</button>
          <span style={{ fontSize: 12, color: '#8892a4', alignSelf: 'center' }}>Pág {page + 1}/{totalPages}</span>
          <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page === totalPages - 1}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? .4 : 1, fontSize: 12 }}>→</button>
        </div>
      )}
    </div>
  )
}
