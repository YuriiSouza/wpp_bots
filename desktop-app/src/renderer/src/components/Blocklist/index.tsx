import { useMemo, useState } from 'react'
import type { StoredDriver } from '../../lib/localStore'
import type { ForwardOrderAnalysis } from '../../lib/forwardOrderParser'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'

// ─── manual blocklist (shared key with NoShowReversion) ──────────────────────

interface ManualBlock {
  driverId: string
  driverName: string
  reason: string
  blockedAt: string
}

const MANUAL_BLOCKS_KEY = 'spx:noshow-manual-blocks'

function getManualBlocks(): ManualBlock[] {
  try { const raw = localStorage.getItem(MANUAL_BLOCKS_KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
}

function saveManualBlocks(blocks: ManualBlock[]) {
  localStorage.setItem(MANUAL_BLOCKS_KEY, JSON.stringify(blocks))
}

// ─── types ────────────────────────────────────────────────────────────────────

type BlockType = 'auto' | 'manual' | 'registry'

interface BlockedDriver {
  driverId: string
  name: string
  vehicleType: string | null
  blockType: BlockType
  blockReason: string
  blockedAt: string | null
  pendingPackages: number
}

// ─── ui primitives ────────────────────────────────────────────────────────────

function Chip({ label, color = '#94a3b8', bg = 'rgba(100,116,139,.1)', small }: { label: string; color?: string; bg?: string; small?: boolean }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}33`, borderRadius: 5, padding: small ? '1px 5px' : '2px 7px', fontSize: small ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Btn({ onClick, disabled, children, variant = 'default', style: ex }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'default' | 'outline' | 'ghost' | 'danger'; style?: React.CSSProperties }) {
  const base: React.CSSProperties = { border: 'none', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1, display: 'inline-flex', alignItems: 'center', gap: 5 }
  const v: Record<string, React.CSSProperties> = {
    default: { background: '#7c3aed', color: '#fff' },
    outline: { background: 'transparent', color: '#e2e8f0', border: '1px solid #2d3048' },
    ghost: { background: 'transparent', color: '#94a3b8' },
    danger: { background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' },
  }
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...v[variant], ...ex }}>{children}</button>
}

function Modal({ open, onClose, title, children, maxWidth = 520 }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; maxWidth?: number }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, padding: '20px 24px', width: '100%', maxWidth, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 16 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  registry: StoredDriver[]
  forwardOrder: ForwardOrderAnalysis | null
  workPref: WorkPreferenceData | null
}

const BLOCK_TYPE_META: Record<BlockType, { label: string; color: string; bg: string; desc: string }> = {
  auto:     { label: '📦 Redelivery',    color: '#f97316', bg: 'rgba(249,115,22,.12)', desc: 'Forward Order > 5 pacotes' },
  manual:   { label: '⊘ Manual',         color: '#f87171', bg: 'rgba(239,68,68,.12)',  desc: 'Bloqueado manualmente' },
  registry: { label: '⊘ SPX Blocklist', color: '#a78bfa', bg: 'rgba(139,92,246,.12)', desc: 'Marcado na planilha de registro' },
}

const QUICK_REASONS = ['No-show', 'Atraso', 'Documento pendente', 'Redelivery', 'Ocorrência']

export default function Blocklist({ registry, forwardOrder, workPref }: Props) {
  const [manualBlocks, setManualBlocksState] = useState<ManualBlock[]>(() => getManualBlocks())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | BlockType>('all')

  // Bulk block modal
  const [bulkIds, setBulkIds] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)

  // Single block modal
  const [singleModal, setSingleModal] = useState<{ id: string; name: string } | null>(null)
  const [singleReason, setSingleReason] = useState('')

  const setManualBlocks = (blocks: ManualBlock[]) => {
    setManualBlocksState(blocks)
    saveManualBlocks(blocks)
  }

  const removeBlock = (driverId: string) => {
    setManualBlocks(manualBlocks.filter(b => b.driverId !== driverId))
  }

  const clearAllManual = () => {
    setManualBlocks(manualBlocks.filter(b => false))
  }

  const addManual = (id: string, name: string, reason: string) => {
    const existing = manualBlocks.filter(b => b.driverId !== id)
    setManualBlocks([...existing, { driverId: id, driverName: name, reason, blockedAt: new Date().toISOString() }])
  }

  const addBulk = (idsText: string, reason: string): number => {
    const ids = idsText.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
    const nameMap = new Map(workPref?.drivers.map(d => [d.driverId, d.driverName]) ?? [])
    const existing = new Map(manualBlocks.map(b => [b.driverId, b]))
    for (const id of ids) {
      existing.set(id, { driverId: id, driverName: nameMap.get(id) ?? id, reason, blockedAt: new Date().toISOString() })
    }
    setManualBlocks([...existing.values()])
    return ids.length
  }

  // Build unified blocked list
  const allBlocked = useMemo((): BlockedDriver[] => {
    const result: BlockedDriver[] = []
    const seen = new Set<string>()

    const nameMap = new Map(workPref?.drivers.map(d => [d.driverId, d.driverName]) ?? [])
    const vehicleMap = new Map(workPref?.drivers.map(d => [d.driverId, d.vehicleType]) ?? [])
    const regMap = new Map(registry.map(d => [d.id, d]))

    // Auto-blocked (forward order > 5)
    for (const d of forwardOrder?.allDrivers ?? []) {
      if (d.totalPackages > 5) {
        seen.add(d.driverId)
        const reg = regMap.get(d.driverId)
        result.push({
          driverId: d.driverId,
          name: nameMap.get(d.driverId) ?? reg?.name ?? d.driverId,
          vehicleType: vehicleMap.get(d.driverId) ?? reg?.vehicleType ?? null,
          blockType: 'auto',
          blockReason: `${d.totalPackages} pacotes pendentes`,
          blockedAt: null,
          pendingPackages: d.totalPackages,
        })
      }
    }

    // Manual blocks
    for (const b of manualBlocks) {
      if (seen.has(b.driverId)) continue
      seen.add(b.driverId)
      const reg = regMap.get(b.driverId)
      result.push({
        driverId: b.driverId,
        name: b.driverName !== b.driverId ? b.driverName : (nameMap.get(b.driverId) ?? reg?.name ?? b.driverId),
        vehicleType: vehicleMap.get(b.driverId) ?? reg?.vehicleType ?? null,
        blockType: 'manual',
        blockReason: b.reason,
        blockedAt: b.blockedAt,
        pendingPackages: 0,
      })
    }

    // Registry (SPX Blocklist)
    for (const d of registry) {
      if (!d.spxBlocklisted || seen.has(d.id)) continue
      seen.add(d.id)
      result.push({
        driverId: d.id,
        name: d.name,
        vehicleType: d.vehicleType ?? null,
        blockType: 'registry',
        blockReason: 'SPX Blocklist (planilha de registro)',
        blockedAt: null,
        pendingPackages: 0,
      })
    }

    return result.sort((a, b) => {
      const order: Record<BlockType, number> = { auto: 0, manual: 1, registry: 2 }
      return order[a.blockType] - order[b.blockType]
    })
  }, [manualBlocks, forwardOrder, registry, workPref])

  const filtered = allBlocked.filter(d => {
    if (typeFilter !== 'all' && d.blockType !== typeFilter) return false
    const q = search.toLowerCase()
    return !q || d.driverId.includes(q) || d.name.toLowerCase().includes(q) || d.blockReason.toLowerCase().includes(q)
  })

  const counts = {
    all: allBlocked.length,
    auto: allBlocked.filter(d => d.blockType === 'auto').length,
    manual: allBlocked.filter(d => d.blockType === 'manual').length,
    registry: allBlocked.filter(d => d.blockType === 'registry').length,
  }

  const bulkIds_parsed = bulkIds.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)

  return (
    <>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Motoristas Bloqueados</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
              Gestão centralizada de bloqueios · {allBlocked.length} motorista{allBlocked.length !== 1 ? 's' : ''} bloqueado{allBlocked.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn onClick={() => { setSingleReason(''); setSingleModal({ id: '', name: '' }) }} variant="outline" style={{ color: '#f87171', borderColor: 'rgba(239,68,68,.3)' }}>
              ⊘ Bloquear motorista
            </Btn>
            <Btn onClick={() => { setBulkIds(''); setBulkReason(''); setBulkOpen(true) }} variant="outline" style={{ color: '#f87171', borderColor: 'rgba(239,68,68,.3)' }}>
              ⊘ Bloquear lista de IDs
            </Btn>
            {counts.manual > 0 && (
              <Btn variant="ghost" onClick={clearAllManual} style={{ color: '#64748b', fontSize: 11 }}>
                Limpar todos os manuais ({counts.manual})
              </Btn>
            )}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid #1e2130', flexShrink: 0, flexWrap: 'wrap' }}>
        {([
          { key: 'all', label: 'Total bloqueados', color: '#f87171', bg: 'rgba(239,68,68,.08)' },
          { key: 'auto', label: 'Redelivery (auto)', color: '#f97316', bg: 'rgba(249,115,22,.08)' },
          { key: 'manual', label: 'Bloqueio manual', color: '#f87171', bg: 'rgba(239,68,68,.08)' },
          { key: 'registry', label: 'SPX Blocklist', color: '#a78bfa', bg: 'rgba(139,92,246,.08)' },
        ] as const).map(c => (
          <div key={c.key}
            onClick={() => setTypeFilter(p => p === c.key ? 'all' : c.key as typeof p)}
            style={{ background: c.bg, border: `1px solid ${c.color}33`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', opacity: typeFilter !== 'all' && typeFilter !== c.key ? .45 : 1, minWidth: 80 }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: c.color }}>{counts[c.key]}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 20px', borderBottom: '1px solid #1e2130', flexShrink: 0, flexWrap: 'wrap' }}>
        {(Object.entries(BLOCK_TYPE_META) as [BlockType, typeof BLOCK_TYPE_META[BlockType]][]).map(([k, m]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Chip label={m.label} color={m.color} bg={m.bg} small />
            <span style={{ fontSize: 11, color: '#64748b' }}>{m.desc}</span>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 20px', flexShrink: 0 }}>
        <input
          placeholder="Buscar por ID, nome ou motivo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 300 }}
        />
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12 }}>
            <span style={{ fontSize: 40 }}>✅</span>
            <p style={{ color: '#4ade80', fontSize: 14, margin: 0 }}>Nenhum motorista bloqueado{typeFilter !== 'all' ? ' nesta categoria' : ''}.</p>
            {allBlocked.length === 0 && (
              <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>Importe o relatório Forward Order para detectar bloqueios automáticos.</p>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['Motorista', 'Veículo', 'Tipo de bloqueio', 'Motivo', 'Data', 'Ação'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const meta = BLOCK_TYPE_META[d.blockType]
                return (
                  <tr key={`${d.driverId}-${d.blockType}`} style={{ borderBottom: '1px solid #1e2130', background: 'rgba(239,68,68,.02)' }}>
                    <td style={TD}>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{d.name}</span>
                      <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{d.driverId}</p>
                    </td>
                    <td style={TD}>
                      {d.vehicleType
                        ? <Chip label={d.vehicleType} color="#94a3b8" bg="rgba(100,116,139,.1)" small />
                        : <span style={{ color: '#4a5568' }}>—</span>}
                    </td>
                    <td style={TD}>
                      <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
                    </td>
                    <td style={{ ...TD, color: '#94a3b8', maxWidth: 260 }}>
                      {d.blockType === 'auto'
                        ? <span style={{ color: '#f97316' }}>📦 {d.blockReason}</span>
                        : d.blockReason}
                    </td>
                    <td style={{ ...TD, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {d.blockedAt
                        ? new Date(d.blockedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : <span style={{ fontStyle: 'italic' }}>—</span>}
                    </td>
                    <td style={TD}>
                      {d.blockType === 'manual' && (
                        <Btn variant="outline" onClick={() => removeBlock(d.driverId)} style={{ fontSize: 11, padding: '3px 8px', color: '#4ade80', borderColor: 'rgba(74,222,128,.3)' }}>
                          ✓ Desbloquear
                        </Btn>
                      )}
                      {d.blockType === 'auto' && (
                        <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>Reimporte Forward Order para remover</span>
                      )}
                      {d.blockType === 'registry' && (
                        <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>Edite a planilha de registro para remover</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>

    {/* Bulk block modal */}
    <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="⊘ Bloquear lista de motoristas" maxWidth={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Cole os IDs dos motoristas abaixo — um por linha, ou separados por vírgula/espaço. Todos receberão o mesmo motivo.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#8892a4' }}>IDs dos motoristas</label>
          <textarea
            value={bulkIds}
            onChange={e => setBulkIds(e.target.value)}
            placeholder={'12345678\n87654321\n11223344'}
            rows={9}
            autoFocus
            style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
          />
          {bulkIds_parsed.length > 0 && (
            <p style={{ margin: 0, fontSize: 11, color: '#60a5fa' }}>{bulkIds_parsed.length} ID{bulkIds_parsed.length !== 1 ? 's' : ''} detectado{bulkIds_parsed.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#8892a4' }}>Motivo</label>
          <input value={bulkReason} onChange={e => setBulkReason(e.target.value)} placeholder="Ex: No-show, Atraso..." />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {QUICK_REASONS.map(r => (
              <button key={r} onClick={() => setBulkReason(r)}
                style={{ background: bulkReason === r ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)', border: `1px solid ${bulkReason === r ? '#7c3aed' : '#2d3048'}`, borderRadius: 5, padding: '3px 8px', fontSize: 11, color: bulkReason === r ? '#a78bfa' : '#8892a4', cursor: 'pointer' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="outline" onClick={() => setBulkOpen(false)}>Cancelar</Btn>
          <Btn variant="danger" disabled={bulkIds_parsed.length === 0 || !bulkReason.trim()} onClick={() => {
            addBulk(bulkIds, bulkReason.trim())
            setBulkOpen(false)
          }}>⊘ Bloquear {bulkIds_parsed.length > 0 ? `${bulkIds_parsed.length} motorista${bulkIds_parsed.length !== 1 ? 's' : ''}` : 'todos'}</Btn>
        </div>
      </div>
    </Modal>

    {/* Single block modal */}
    <Modal open={!!singleModal} onClose={() => setSingleModal(null)} title="⊘ Bloquear motorista" maxWidth={400}>
      {singleModal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#8892a4' }}>ID do motorista</label>
            <input
              value={singleModal.id}
              onChange={e => setSingleModal(p => p ? { ...p, id: e.target.value } : null)}
              placeholder="Ex: 12345678"
              autoFocus
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#8892a4' }}>Motivo</label>
            <input
              value={singleReason}
              onChange={e => setSingleReason(e.target.value)}
              placeholder="Ex: no-show, atraso..."
              onKeyDown={e => {
                if (e.key === 'Enter' && singleModal.id.trim() && singleReason.trim()) {
                  addManual(singleModal.id.trim(), singleModal.name || singleModal.id.trim(), singleReason.trim())
                  setSingleModal(null)
                }
              }}
            />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {QUICK_REASONS.map(r => (
                <button key={r} onClick={() => setSingleReason(r)}
                  style={{ background: singleReason === r ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)', border: `1px solid ${singleReason === r ? '#7c3aed' : '#2d3048'}`, borderRadius: 5, padding: '3px 8px', fontSize: 11, color: singleReason === r ? '#a78bfa' : '#8892a4', cursor: 'pointer' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="outline" onClick={() => setSingleModal(null)}>Cancelar</Btn>
            <Btn variant="danger" disabled={!singleModal.id.trim() || !singleReason.trim()} onClick={() => {
              addManual(singleModal.id.trim(), singleModal.name || singleModal.id.trim(), singleReason.trim())
              setSingleModal(null)
            }}>⊘ Bloquear</Btn>
          </div>
        </div>
      )}
    </Modal>
    </>
  )
}

const TH: React.CSSProperties = { padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '7px 12px', verticalAlign: 'middle' }
