import { useMemo, useState, useEffect, useCallback } from 'react'
import type { StoredDriver } from '../../lib/localStore'
import type { DriverResult } from '../../lib/types'
import type { ForwardOrderAnalysis } from '../../lib/forwardOrderParser'
import type { CallUpAnalysis } from '../../lib/callUpParser'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import { parseRoutesTsv, type LocalRoute } from '../../lib/noshowRouteParser'
import { parseThreePlMessage, normRegion, type ThreePlParseResult } from '../../lib/threePlParser'
import type { Shift } from '../../lib/globalConfig'
import { getGlobalConfig, saveGlobalConfig } from '../../lib/globalConfig'
import { routeStore, migrateOldRoutes } from '../../lib/routeStore'
import { noShowQueueStore, type QueueDriver } from '../../lib/noShowQueueStore'
import { calculatePriorityScore, daysSinceLastRoute } from '../../lib/priorityScore'

// ─── manual blocklist ─────────────────────────────────────────────────────────

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

// ─── SPX integration ──────────────────────────────────────────────────────────

const SPX_CREDS_KEY = 'spx:credentials'

function parseCurl(curl: string): Record<string, string> {
  const creds: Record<string, string> = {}
  const cookieMatch = curl.match(/-b\s+'([^']+)'/)
  if (cookieMatch) creds['cookie'] = cookieMatch[1]
  const extract = (p: RegExp) => { const m = curl.match(p); return m ? m[1].trim() : undefined }
  const csrf = extract(/x-csrftoken:\s*([^\s'\\]+)/i)
  if (csrf) creds['x-csrftoken'] = csrf
  const sapRi = extract(/x-sap-ri:\s*([^\s'\\]+)/i)
  if (sapRi) creds['x-sap-ri'] = sapRi
  const dev = extract(/device-id:\s*([^\s'\\]+)/i)
  if (dev) creds['device-id'] = dev
  const sapSec = curl.match(/x-sap-sec:\s*([^']+?)'[\s\\]*(?:-H|--data|$)/i)
  if (sapSec) creds['x-sap-sec'] = sapSec[1].trim()
  return creds
}

function getSpxCreds(): Record<string, string> | null {
  try { const raw = localStorage.getItem(SPX_CREDS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

function saveSpxCreds(creds: Record<string, string>) {
  localStorage.setItem(SPX_CREDS_KEY, JSON.stringify(creds))
}

async function spxReassign(driverId: string, atId: string): Promise<{ ok: boolean; message: string }> {
  const creds = getSpxCreds()
  if (!creds) return { ok: false, message: 'Credenciais SPX não configuradas.' }
  const driverIdNum = parseInt(driverId, 10)
  if (isNaN(driverIdNum)) return { ok: false, message: `Driver ID inválido: ${driverId}` }
  try {
    const url = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/reassign'
    const headers: Record<string, string> = {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9,pt;q=0.8',
      'app': 'FMS Portal',
      'content-type': 'application/json;charset=UTF-8',
      'cookie': creds['cookie'] ?? '',
      'device-id': creds['device-id'] ?? '',
      'origin': 'https://spx.shopee.com.br',
      'referer': 'https://spx.shopee.com.br/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'x-csrftoken': creds['x-csrftoken'] ?? '',
      'x-sap-ri': creds['x-sap-ri'] ?? '',
      'x-sap-sec': creds['x-sap-sec'] ?? '',
    }
    const body = JSON.stringify({
      driver_id: driverIdNum,
      assignment_task_id: atId,
      assign_driver_across_station: false,
      driver_vehicle_id: '',
    })
    const ipc = (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } } }).electron?.ipcRenderer
    let rawJson: string
    if (ipc) {
      rawJson = await ipc.invoke('spx-post', { url, headers, body }) as string
    } else {
      const res = await fetch(url, { method: 'POST', headers, body })
      rawJson = await res.text()
    }
    const data = JSON.parse(rawJson) as Record<string, unknown>
    const ok = data?.retcode === 0 || data?.code === 0 || data?.success === true
    const errMsg = String(data?.message || data?.msg || data?.error || 'Erro desconhecido do SPX')
    return { ok, message: ok ? 'Atribuído no SPX.' : errMsg }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao chamar SPX'
    return { ok: false, message: msg }
  }
}

const normCluster = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '')

// ─── types ───────────────────────────────────────────────────────────────────

interface LocalDriver {
  driverId: string
  name: string
  vehicleType: string | null
  clusters: string[]
  isNewDriver: boolean
  isBlocked: boolean
  blockReason: string | null
  blockType: 'auto' | 'manual' | 'registry' | null
  pendingPackages: number
  dsReal: number | null
  dsStatus: string | null
  priorityScore: number
  daysSinceRoute: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const INTERIOR_CLUSTERS = new Set([
  'Abadiania - z', 'Campo Limpo', 'Gameleira de Goias', 'Goianapolis',
  'Leopoldo de Bulhões', 'Neropolis', 'Nova Veneza', 'Ouro Verde',
  'Silvania', 'Terezopolis', 'Vianópolis - z',
])

function normalizeVehicle(v?: string | null) {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio')) return 'PASSEIO'
  return s.toUpperCase()
}

function vehiclePriority(driverV: string | null, routeV: string | null) {
  const d = normalizeVehicle(driverV); const r = normalizeVehicle(routeV)
  if (r === 'MOTO') { if (d === 'MOTO') return 0; if (d === 'PASSEIO') return 1; if (d === 'FIORINO') return 2; return 3 }
  if (d === 'VAN') return 0; if (d === 'FIORINO') return 1; return 2
}

// Regra de veículo: moto só pega rota de moto; fiorino não pega rota de moto.
function vehicleAllowed(driverV: string | null | undefined, routeV: string | null | undefined) {
  const dv = normalizeVehicle(driverV); const rv = normalizeVehicle(routeV)
  if (rv !== 'MOTO' && dv === 'MOTO') return false
  if (rv === 'MOTO' && dv === 'FIORINO') return false
  return true
}

function getDsMeta(ds: number | null) {
  if (ds === null) return { label: '—', color: '#64748b', bg: 'rgba(100,116,139,.1)' }
  const pct = Math.round(ds * 100)
  if (pct < 30) return { label: `${pct}%`, color: '#f87171', bg: 'rgba(239,68,68,.12)' }
  if (pct < 70) return { label: `${pct}%`, color: '#fbbf24', bg: 'rgba(245,158,11,.12)' }
  if (pct < 90) return { label: `${pct}%`, color: '#a3e635', bg: 'rgba(163,230,53,.1)' }
  return { label: `${pct}%`, color: '#4ade80', bg: 'rgba(34,197,94,.1)' }
}

function getBestCandidate(route: LocalRoute, drivers: LocalDriver[], usedIds: Set<string>) {
  const sorter = (a: LocalDriver, b: LocalDriver) => {
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
    const pa = vehiclePriority(a.vehicleType, route.requiredVehicleType)
    const pb = vehiclePriority(b.vehicleType, route.requiredVehicleType)
    return pa !== pb ? pa - pb : b.priorityScore - a.priorityScore
  }
  const base = drivers.filter(d => !usedIds.has(d.driverId) && vehicleAllowed(d.vehicleType, route.requiredVehicleType))
  // Tenta com cluster exato primeiro; se não achar, usa todos os disponíveis
  const withCluster = base.filter(d => d.clusters.some(c => normCluster(c) === normCluster(route.cluster)))
  return withCluster.sort(sorter)[0] ?? null
}

function computeEffective(routes: LocalRoute[], drivers: LocalDriver[], overrides: Map<string, LocalDriver>) {
  const map = new Map<string, LocalDriver>()
  const usedIds = new Set<string>()
  for (const [rid, d] of overrides) { map.set(rid, d); usedIds.add(d.driverId) }

  const disponivel = routes.filter(r => r.status === 'DISPONIVEL')
  const sorted = [...disponivel].sort((a, b) => {
    const count = (r: LocalRoute) => {
      const rv = normalizeVehicle(r.requiredVehicleType)
      return drivers.filter(d => d.clusters.some(c => normCluster(c) === normCluster(r.cluster)) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO')).length
    }
    return count(a) - count(b)
  })

  for (const route of sorted) {
    if (map.has(route.id)) continue
    const best = getBestCandidate(route, drivers, usedIds)
    if (best) { map.set(route.id, best); usedIds.add(best.driverId) }
  }
  return map
}

// ─── ui primitives ───────────────────────────────────────────────────────────

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

// ─── route paste screen ───────────────────────────────────────────────────────

const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#f472b6' }

function RoutePasteScreen({ onLoad, defaultDate, defaultShift }: { onLoad: (routes: LocalRoute[], date: string, shift: Shift) => void; defaultDate: string; defaultShift: Shift }) {
  const [text, setText] = useState('')
  const [pasteDate, setPasteDate] = useState(defaultDate)
  const [pasteShift, setPasteShift] = useState<Shift>(defaultShift)

  const preview = useMemo(() => {
    if (!text.trim()) return []
    return parseRoutesTsv(text)
  }, [text])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: 16 }}>
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Colar rotas do SPX</h3>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Abra o planejamento de rotas no SPX, selecione toda a tabela e cole aqui (Ctrl+A → Ctrl+C na tabela).
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: '#8892a4', fontWeight: 600 }}>DATA DA ROTEIRIZAÇÃO</label>
            <input type="date" value={pasteDate} onChange={e => setPasteDate(e.target.value)} style={{ width: 150 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: '#8892a4', fontWeight: 600 }}>TURNO</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {SHIFTS.map(s => (
                <button key={s} onClick={() => setPasteShift(s)} style={{ border: `1px solid ${pasteShift === s ? SHIFT_COLOR[s] : '#2d3048'}`, background: pasteShift === s ? `${SHIFT_COLOR[s]}22` : 'transparent', color: pasteShift === s ? SHIFT_COLOR[s] : '#8892a4', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Rota\tAT / TO\tGaiola\t...\n001\tAT2026...\tA-1\t...'}
          rows={10}
          style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
          autoFocus
        />
        {preview.length > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>
            ✓ {preview.length} rota{preview.length !== 1 ? 's' : ''} reconhecida{preview.length !== 1 ? 's' : ''} — {preview.filter(r => r.status === 'DISPONIVEL').length} disponíveis para atribuição
          </p>
        )}
        {text.trim() && preview.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: '#f87171' }}>Nenhuma rota reconhecida. Verifique se o formato está correto (TSV com coluna AT / TO).</p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn disabled={preview.length === 0} onClick={() => onLoad(preview, pasteDate, pasteShift)}>
            Carregar {preview.length > 0 ? `${preview.length} rotas` : 'rotas'} — {pasteShift} · {pasteDate}
          </Btn>
          {text && <Btn variant="ghost" onClick={() => setText('')}>Limpar</Btn>}
        </div>
      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

interface Props {
  registry: StoredDriver[]
  dsDrivers: DriverResult[]
  forwardOrder: ForwardOrderAnalysis | null
  callUp: CallUpAnalysis | null
  workPref: WorkPreferenceData | null
  selectedDay: string
  selectedShift: Shift
}

// ─── Header overflow menu ─────────────────────────────────────────────────────
function HeaderMenu({ spxConfigured, onSpx, onPaste, onAddRoute, onBatch, onCopyRelation, onCopyPhones, phoneCount, copiedPhones, onReport, onClear }: {
  spxConfigured: boolean
  onSpx: () => void
  onPaste: () => void
  onAddRoute: () => void
  onBatch: () => void
  onCopyRelation: () => void
  onCopyPhones: () => void
  phoneCount: number
  copiedPhones: boolean
  onReport: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useState(() => ({ current: null as HTMLDivElement | null }))[0]

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, ref])

  const item = (icon: string, label: string, onClick: () => void, color?: string, danger?: boolean) => (
    <button
      key={label}
      onClick={() => { onClick(); setOpen(false) }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: danger ? '#f87171' : color ?? '#e2e8f0', textAlign: 'left', borderRadius: 6 }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(239,68,68,.1)' : '#1e2130')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ width: 16, textAlign: 'center' }}>{icon}</span> {label}
    </button>
  )

  return (
    <div ref={el => { ref.current = el }} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background: open ? '#1e2130' : '#13151f', border: '1px solid #2d3048', color: '#94a3b8', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center' }}
      >⋯</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '4px', zIndex: 100, minWidth: 210, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
          {item('📋', 'Nova colagem', onPaste)}
          {item('＋', 'Reatribuir rota (AT)', onAddRoute, '#4ade80')}
          {item('📥', 'Atribuir lote', onBatch, '#60a5fa')}
          <div style={{ height: 1, background: '#2d3048', margin: '4px 8px' }} />
          {item('⬇', 'Copiar relação', onCopyRelation)}
          {item('📱', copiedPhones ? '✓ Telefones copiados!' : `Copiar telefones (${phoneCount})`, onCopyPhones, '#60a5fa')}
          <div style={{ height: 1, background: '#2d3048', margin: '4px 8px' }} />
          {item('🔑', spxConfigured ? 'SPX configurado' : 'Configurar SPX', onSpx, spxConfigured ? '#4ade80' : '#fbbf24')}
          {item('📊', 'Gerar report', onReport, '#a78bfa')}
          <div style={{ height: 1, background: '#2d3048', margin: '4px 8px' }} />
          {item('🗑', 'Limpar rotas', onClear, undefined, true)}
        </div>
      )}
    </div>
  )
}

// ─── Report modal body ────────────────────────────────────────────────────────
function ReportModalBody({ hub, onHubChange, selectedDay, selectedShift, snap, onSnapChange, copied, onCopy }: {
  hub: string
  onHubChange: (h: string) => void
  selectedDay: string
  selectedShift: Shift
  snap: { total: number; auto: number; manual: number; threepl: number; novatos: number }
  onSnapChange: (s: { total: number; auto: number; manual: number; threepl: number; novatos: number }) => void
  copied: boolean
  onCopy: (text: string) => Promise<void>
}) {
  const [tpl, set] = useState(snap)
  const [threepl, setThreepl] = useState(snap.threepl)
  const [novatos, setNovatos] = useState(snap.novatos)

  const total = tpl.total
  // auto = rotas atribuídas manualmente pelo app
  const manual = Math.max(0, tpl.auto)
  const automatico = Math.max(0, total - manual - threepl - novatos)
  const pctManual = total > 0 ? ((manual / total) * 100).toFixed(0) : '0'
  const pctAuto = total > 0 ? ((automatico / total) * 100).toFixed(0) : '0'
  const pctThreepl = total > 0 ? ((threepl / total) * 100).toFixed(0) : '0'
  const dateFormatted = selectedDay.split('-').reverse().join('/')

  const text = [
    `📊 Resumo Alocação – ${dateFormatted}`,
    ``,
    `🏢 Hub: ${hub || '—'}`,
    `📍 Turno: ${selectedShift}`,
    ``,
    `🚚 Distribuição de Rotas:`,
    `* Total de rotas: ${total}`,
    `* Rotas alocadas Manualmente: ${manual}`,
    `* Percentual alocado Manualmente: ${pctManual}%`,
    `* Rotas alocadas 3PL: ${threepl}`,
    `* Percentual alocado 3PL: ${pctThreepl}%`,
    `* Novatos adicionados: ${novatos}`,
    `* Rotas alocadas automaticamente: ${automatico}`,
    `* Percentual alocado automaticamente: ${pctAuto}%`,
  ].join('\n')

  const inputStyle: React.CSSProperties = { width: 72, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'center', outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Hub */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 11, color: '#8892a4', display: 'block', marginBottom: 4 }}>Hub</label>
          <input value={hub} onChange={e => onHubChange(e.target.value)} placeholder="Ex: LGO 03"
            style={{ width: '100%', background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </div>

      {/* Campos editáveis */}
      <div style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>Ajuste os valores se necessário</p>
        {[
          { label: 'Total de rotas', value: tpl.total, onChange: (v: number) => { const s = { ...tpl, total: v }; set(s); onSnapChange(s) } },
          { label: 'Rotas manuais (app)', value: tpl.auto, onChange: (v: number) => { const s = { ...tpl, auto: v }; set(s); onSnapChange(s) } },
          { label: 'Rotas 3PL', value: threepl, onChange: (v: number) => { setThreepl(v); onSnapChange({ ...tpl, threepl: v, novatos }) } },
          { label: 'Novatos adicionados', value: novatos, onChange: (v: number) => { setNovatos(v); onSnapChange({ ...tpl, threepl, novatos: v }) } },
        ].map(f => (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{f.label}</span>
            <input
              type="number" min={0} value={f.value}
              onChange={e => f.onChange(parseInt(e.target.value) || 0)}
              style={inputStyle}
            />
          </div>
        ))}
        <div style={{ borderTop: '1px solid #2d3048', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Rotas automaticamente (calculado)</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', width: 72, textAlign: 'center' }}>{automatico}</span>
        </div>
      </div>

      {/* Preview */}
      <pre style={{ margin: 0, background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {text}
      </pre>

      <Btn onClick={() => void onCopy(text)} style={{ alignSelf: 'flex-start' }}>
        {copied ? '✓ Copiado!' : '📋 Copiar para área de transferência'}
      </Btn>
    </div>
  )
}

// ─── Novatos Modal ────────────────────────────────────────────────────────────
interface NovatoSuggestion {
  driverId: string
  name: string
  clusters: string[]
  vehicleType: string | null
  suggestedRoute: LocalRoute | null
  suggestedRouteCluster: string
  availableToday: boolean   // está na disponibilidade do dia
  resolvable: boolean       // encontrado na disponibilidade OU no Work Preference
}

interface NovatoResult {
  driverId: string
  name: string
  status: 'ok' | 'no-route' | 'not-found'
  atId?: string
  cluster?: string
  availableToday?: boolean
}

function NovatosPanel({ workPref, routes, availableDrivers, onAssign }: {
  workPref: import('../../lib/workPreferenceParser').WorkPreferenceData | null
  routes: LocalRoute[]
  availableDrivers: LocalDriver[]
  onAssign: (assignments: { route: LocalRoute; driver: LocalDriver }[]) => void
}) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<NovatoSuggestion[]>([])
  const [overrideRoute, setOverrideRoute] = useState<Record<string, string>>({})
  const [analyzed, setAnalyzed] = useState(false)
  const [result, setResult] = useState<NovatoResult[] | null>(null)

  const disponivel = routes.filter(r => r.status === 'DISPONIVEL')

  const wpMap = useMemo(
    () => new Map((workPref?.drivers ?? []).map(d => [d.driverId, d])),
    [workPref],
  )

  // Resolve um motorista pelo ID: primeiro na disponibilidade do dia; se não estiver,
  // constrói um motorista "sintético" a partir do Work Preference (que tem os clusters
  // em que ele está disponível, mesmo fora do dia). Retorna null se não achar em lugar nenhum.
  const resolveDriver = (driverId: string): { driver: LocalDriver; availableToday: boolean } | null => {
    const av = availableDrivers.find(d => d.driverId === driverId)
    if (av) return { driver: av, availableToday: true }
    const wp = wpMap.get(driverId)
    if (wp) {
      return {
        driver: {
          driverId,
          name: wp.driverName || driverId,
          vehicleType: wp.vehicleType || null,
          clusters: wp.clusters ?? [],
          isNewDriver: true,
          isBlocked: false,
          blockReason: null,
          blockType: null,
          pendingPackages: 0,
          dsReal: null,
          dsStatus: null,
          priorityScore: 0,
          daysSinceRoute: 9999,
        },
        availableToday: false,
      }
    }
    return null
  }

  const analyze = () => {
    const ids = input.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean)
    const usedRouteIds = new Set<string>()

    const result: NovatoSuggestion[] = ids.map(driverId => {
      const resolved = resolveDriver(driverId)
      const clusters = resolved?.driver.clusters ?? []
      const name = resolved?.driver.name ?? driverId

      // Encontrar melhor rota disponível: prioriza cluster compatível, não usada ainda
      const hasAll = clusters.some(c => c.toUpperCase() === 'ALL')
      const vehicle = resolved?.driver.vehicleType ?? null
      const compatible = disponivel.filter(r => {
        if (usedRouteIds.has(r.id)) return false
        if (!vehicleAllowed(vehicle, r.requiredVehicleType)) return false
        if (hasAll) return true
        return clusters.some(c => normCluster(c) === normCluster(r.cluster))
      }).sort((a, b) => vehiclePriority(vehicle, a.requiredVehicleType) - vehiclePriority(vehicle, b.requiredVehicleType))

      const best = compatible[0] ?? null
      if (best) usedRouteIds.add(best.id)

      return {
        driverId, name, clusters,
        vehicleType: vehicle,
        suggestedRoute: best,
        suggestedRouteCluster: best?.cluster ?? '',
        availableToday: resolved?.availableToday ?? false,
        resolvable: resolved != null,
      }
    })

    setSuggestions(result)
    setOverrideRoute({})
    setAnalyzed(true)
  }

  const getSelectedRoute = (s: NovatoSuggestion): LocalRoute | null => {
    const rid = overrideRoute[s.driverId]
    if (rid) return routes.find(r => r.id === rid) ?? s.suggestedRoute
    return s.suggestedRoute
  }

  const handleConfirm = () => {
    const assignments: { route: LocalRoute; driver: LocalDriver }[] = []
    const res: NovatoResult[] = []
    for (const s of suggestions) {
      const resolved = resolveDriver(s.driverId)
      if (!resolved) { res.push({ driverId: s.driverId, name: s.name, status: 'not-found' }); continue }
      const route = getSelectedRoute(s)
      if (!route) { res.push({ driverId: s.driverId, name: s.name, status: 'no-route', availableToday: resolved.availableToday }); continue }
      assignments.push({ route, driver: { ...resolved.driver, isNewDriver: true } })
      res.push({ driverId: s.driverId, name: s.name, status: 'ok', atId: route.atId, cluster: route.cluster, availableToday: resolved.availableToday })
    }
    onAssign(assignments)
    setResult(res)
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>🆕 Novatos</p>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: '#8892a4' }}>
        Inclua novatos manualmente — inclusive quem <b>não está na disponibilidade de hoje</b> (buscamos os clusters no Work Preference).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {result ? (
          (() => {
            const ok = result.filter(r => r.status === 'ok')
            const noRoute = result.filter(r => r.status === 'no-route')
            const notFound = result.filter(r => r.status === 'not-found')
            const foraDisp = result.filter(r => r.status === 'ok' && r.availableToday === false)
            return (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Chip label={`✅ ${ok.length} alocado(s)`} color="#34d399" bg="rgba(52,211,153,.12)" />
                  {foraDisp.length > 0 && <Chip label={`↪ ${foraDisp.length} fora da disp. (via WP)`} color="#60a5fa" bg="rgba(59,130,246,.12)" />}
                  {noRoute.length > 0 && <Chip label={`⚠️ ${noRoute.length} sem rota`} color="#fbbf24" bg="rgba(245,158,11,.12)" />}
                  {notFound.length > 0 && <Chip label={`⛔ ${notFound.length} não encontrado(s)`} color="#f87171" bg="rgba(239,68,68,.12)" />}
                </div>
                <div style={{ overflow: 'auto', maxHeight: 360 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#13151f' }}>
                      <tr style={{ borderBottom: '1px solid #2d3048' }}>
                        {['Motorista', 'Resultado', 'Rota', 'Cluster'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.map(r => (
                        <tr key={r.driverId} style={{ borderBottom: '1px solid #1e2130' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{r.name}</span>
                            {r.availableToday === false && r.status !== 'not-found' && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 3, padding: '1px 5px' }}>via WP</span>}
                            <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{r.driverId}</span>
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            {r.status === 'ok' && <span style={{ color: '#34d399' }}>✅ Alocado</span>}
                            {r.status === 'no-route' && <span style={{ color: '#fbbf24' }}>⚠️ Sem rota disponível</span>}
                            {r.status === 'not-found' && <span style={{ color: '#f87171' }}>⛔ ID não encontrado (disp./WP)</span>}
                          </td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: r.atId ? '#e2e8f0' : '#374151' }}>{r.atId ?? '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#94a3b8', fontSize: 11 }}>{r.cluster ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: '#8892a4' }}>
                  As atribuições ficaram em pré-visualização na aba "Rotas recusadas" (chip roxo <b>Novato</b>). Clique em <b>✦ Atribuir</b> para gravar no SPX.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn onClick={() => { setResult(null); setAnalyzed(false); setSuggestions([]); setInput('') }}>Alocar mais</Btn>
                </div>
              </>
            )
          })()
        ) : !analyzed ? (
          <>
            <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>Cole os IDs dos novatos, um por linha.</p>
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              placeholder={'3173241\n2811188\n3943776'}
              style={{ width: '100%', height: 160, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
            <Btn onClick={analyze} disabled={!input.trim()}>Analisar</Btn>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>{suggestions.length} novato(s) analisado(s)</p>
              <button onClick={() => { setAnalyzed(false); setSuggestions([]) }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>← Editar IDs</button>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#13151f' }}>
                  <tr style={{ borderBottom: '1px solid #2d3048' }}>
                    {['Motorista', 'Clusters WP', 'Rota sugerida', 'Cluster'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map(s => {
                    const route = getSelectedRoute(s)
                    return (
                      <tr key={s.driverId} style={{ borderBottom: '1px solid #1e2130', opacity: s.resolvable ? 1 : 0.5 }}>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{s.name}</span>
                          {s.resolvable && !s.availableToday && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 3, padding: '1px 5px' }}>via WP</span>}
                          <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{s.driverId}{s.vehicleType ? ` · ${s.vehicleType}` : ''}</span>
                          {!s.resolvable && <span style={{ fontSize: 9, color: '#f87171' }}>ID não encontrado (disp./WP)</span>}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: '#64748b' }}>
                          {s.clusters.length ? s.clusters.join(', ') : <span style={{ color: '#374151' }}>sem dados WP</span>}
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          <select
                            value={overrideRoute[s.driverId] ?? route?.id ?? ''}
                            onChange={e => setOverrideRoute(prev => ({ ...prev, [s.driverId]: e.target.value }))}
                            style={{ background: '#0f1117', border: `1px solid ${route ? '#2d3048' : 'rgba(239,68,68,.4)'}`, color: route ? '#e2e8f0' : '#f87171', borderRadius: 5, padding: '3px 6px', fontSize: 11, outline: 'none', maxWidth: 130 }}
                          >
                            {!route && <option value="">— sem rota —</option>}
                            {disponivel.filter(r => vehicleAllowed(s.vehicleType, r.requiredVehicleType)).map(r => <option key={r.id} value={r.id}>{r.atId}{r.requiredVehicleType ? ` · ${r.requiredVehicleType}` : ''}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '7px 10px', color: '#94a3b8', fontSize: 11 }}>{route?.cluster ?? '—'}{route?.requiredVehicleType ? ` · ${route.requiredVehicleType}` : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={handleConfirm} disabled={suggestions.every(s => !getSelectedRoute(s) || !s.resolvable)}>
                Confirmar atribuições
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 3PL Panel (transportadoras) ───────────────────────────────────────────────
function ThreePlPanel({ routes, selectedShift, agencies, excludedRouteIds, assignments, setAssignments }: {
  routes: LocalRoute[]
  selectedShift: Shift
  agencies: string[]
  excludedRouteIds: Set<string>
  assignments: Map<string, { agency: string; region: string; shift: Shift }>
  setAssignments: (m: Map<string, { agency: string; region: string; shift: Shift }>) => void
}) {
  const [agency, setAgency] = useState('')
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ThreePlParseResult | null>(null)
  const [copied, setCopied] = useState(false)

  const allClusters = useMemo(() => {
    const set = new Set<string>()
    for (const r of routes) { const c = (r.cluster ?? '').trim(); if (c) set.add(c) }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [routes])

  // Rotas livres para 3PL: disponíveis, não usadas por outros fluxos, não já atribuídas a 3PL
  const availableRoutes = useMemo(
    () => routes.filter(r => r.status === 'DISPONIVEL' && !excludedRouteIds.has(r.id) && !assignments.has(r.id)),
    [routes, excludedRouteIds, assignments],
  )

  // Pré-visualização a partir do parse atual, apenas para o turno selecionado
  const preview = useMemo(() => {
    if (!parsed) return null
    const used = new Set<string>()
    const rows: { region: string; route: LocalRoute }[] = []
    const shortfalls: { region: string; requested: number; assigned: number }[] = []
    // Regiões específicas primeiro; "ALL" (qualquer região) por último, para não roubar rota das específicas
    const demands = parsed.demands
      .filter(d => d.shift === selectedShift)
      .sort((a, b) => Number(a.anyRegion) - Number(b.anyRegion))
    for (const d of demands) {
      const pool = availableRoutes.filter(r => !used.has(r.id) && (d.anyRegion || normRegion(r.cluster) === normRegion(d.region)))
      const take = pool.slice(0, d.quantity)
      take.forEach(r => { used.add(r.id); rows.push({ region: d.anyRegion ? `${r.cluster} (ALL)` : d.region, route: r }) })
      if (take.length < d.quantity) shortfalls.push({ region: d.region, requested: d.quantity, assigned: take.length })
    }
    const otherShift = parsed.demands.filter(d => d.shift !== selectedShift).length
    return { rows, shortfalls, otherShift }
  }, [parsed, availableRoutes, selectedShift])

  const analyze = () => setParsed(parseThreePlMessage(input, { defaultShift: selectedShift, knownClusters: allClusters }))

  const confirm = () => {
    if (!preview || !agency || preview.rows.length === 0) return
    const next = new Map(assignments)
    for (const { region, route } of preview.rows) next.set(route.id, { agency, region, shift: selectedShift })
    setAssignments(next)
    setInput(''); setParsed(null)
  }

  const copyRegions = () => {
    navigator.clipboard.writeText(allClusters.join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const removeAgency = (a: string) => {
    const next = new Map(assignments)
    for (const [id, v] of assignments) if (v.agency === a) next.delete(id)
    setAssignments(next)
  }

  const byAgency = useMemo(() => {
    const m = new Map<string, { region: string; atId: string }[]>()
    for (const [id, v] of assignments) {
      const r = routes.find(rt => rt.id === id)
      if (!r) continue
      if (!m.has(v.agency)) m.set(v.agency, [])
      m.get(v.agency)!.push({ region: v.region, atId: r.atId })
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [assignments, routes])

  const inputStyle = { background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12, outline: 'none' } as const

  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>📦 3PL — Transportadoras</p>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: '#8892a4' }}>
        Selecione a transportadora, cole a mensagem dela (formato: <code style={{ color: '#94a3b8' }}>quantidade região</code> por linha) e confira a pré-visualização das rotas antes de gravar no SPX manualmente.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={agency} onChange={e => setAgency(e.target.value)} style={{ ...inputStyle, minWidth: 200 }}>
          <option value="">— Selecione a transportadora —</option>
          {agencies.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <Btn variant="outline" onClick={copyRegions} style={{ fontSize: 11 }}>
          {copied ? '✓ Copiado!' : '📋 Copiar lista de regiões'}
        </Btn>
        <span style={{ fontSize: 11, color: '#64748b' }}>Turno atual: <b style={{ color: '#e2e8f0' }}>{selectedShift}</b></span>
      </div>

      {agencies.length === 0 && (
        <p style={{ margin: '0 0 10px', fontSize: 11, color: '#fbbf24' }}>⚠ Nenhuma agência encontrada. Importe o relatório de motoristas para listar as transportadoras.</p>
      )}

      <textarea
        value={input} onChange={e => setInput(e.target.value)}
        placeholder={'AM\n1 Abadiânia - z\n2 Munir Calixto\n\nPM1\n3 Guarulhos'}
        style={{ width: '100%', height: 130, ...inputStyle, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Btn onClick={analyze} disabled={!agency || !input.trim()} style={{ background: (!agency || !input.trim()) ? undefined : '#0ea5e9' }}>Analisar</Btn>
      </div>

      {parsed && preview && (
        <div style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          {parsed.noAvailability ? (
            <p style={{ margin: 0, fontSize: 12, color: '#fbbf24' }}>Transportadora informou <b>SEM DISPONIBILIDADE HOJE</b>.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <Chip label={`✅ ${preview.rows.length} rota(s) a atribuir`} color="#34d399" bg="rgba(52,211,153,.12)" />
                {preview.shortfalls.length > 0 && <Chip label={`⚠️ ${preview.shortfalls.length} região(ões) sem rota suficiente`} color="#fbbf24" bg="rgba(245,158,11,.12)" />}
                {parsed.unknownRegions.length > 0 && <Chip label={`❓ ${parsed.unknownRegions.length} região(ões) desconhecida(s)`} color="#f87171" bg="rgba(239,68,68,.12)" />}
                {preview.otherShift > 0 && <Chip label={`↪ ${preview.otherShift} linha(s) de outros turnos`} color="#60a5fa" bg="rgba(59,130,246,.12)" />}
              </div>

              {preview.rows.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048' }}>
                      {['Região', 'Rota (AT ID)', 'Cluster'].map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(({ region, route }) => (
                      <tr key={route.id} style={{ borderBottom: '1px solid #1e2130' }}>
                        <td style={{ padding: '6px 10px', color: '#e2e8f0' }}>{region}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#e2e8f0' }}>{route.atId}</td>
                        <td style={{ padding: '6px 10px', color: '#94a3b8', fontSize: 11 }}>{route.cluster}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {preview.shortfalls.map(s => (
                <p key={s.region} style={{ margin: '2px 0', fontSize: 11, color: '#fbbf24' }}>
                  ⚠️ {s.region}: pediu {s.requested}, só há {s.assigned} rota(s) disponível(is).
                </p>
              ))}
              {parsed.unknownRegions.length > 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>
                  ❓ Regiões não reconhecidas: {parsed.unknownRegions.join(', ')} — confira a grafia com a lista oficial.
                </p>
              )}
              {parsed.ignoredLines.length > 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#64748b' }}>{parsed.ignoredLines.length} linha(s) ignorada(s): {parsed.ignoredLines.join(' · ')}</p>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Btn onClick={confirm} disabled={preview.rows.length === 0 || !agency} style={{ background: preview.rows.length === 0 ? undefined : '#0ea5e9' }}>
                  Confirmar ({preview.rows.length}) para {agency || '—'}
                </Btn>
              </div>
            </>
          )}
        </div>
      )}

      {byAgency.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
            Pré-visualização 3PL ({assignments.size} rota(s) no total)
          </p>
          {byAgency.map(([a, list]) => (
            <div key={a} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0ea5e9' }}>{a} · {list.length} rota(s)</span>
                <Btn variant="ghost" onClick={() => removeAgency(a)} style={{ fontSize: 10, color: '#f87171', padding: '2px 6px' }}>✕ Remover</Btn>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {list.map(item => (
                  <Chip key={item.atId} label={`${item.atId} · ${item.region}`} color="#94a3b8" bg="rgba(100,116,139,.12)" small />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Atribuição em lote (colar AT + motorista) ───────────────────────────────────
interface BatchAssignRow {
  atId: string
  driverId: string
  status: 'ok' | 'fail' | 'no-driver'
  driverName?: string
  foundDriver?: boolean
  spxMsg?: string
}

function BatchAssignModal({ open, onClose, onApply, spxConfigured }: {
  open: boolean
  onClose: () => void
  onApply: (text: string) => Promise<BatchAssignRow[]>
  spxConfigured: boolean
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<BatchAssignRow[] | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => { if (open) { setInput(''); setResult(null); setRunning(false) } }, [open])
  if (!open) return null

  const run = async () => {
    setRunning(true)
    try { setResult(await onApply(input)) }
    finally { setRunning(false) }
  }

  const ok = result?.filter(r => r.status === 'ok') ?? []
  const fail = result?.filter(r => r.status === 'fail') ?? []
  const noDriver = result?.filter(r => r.status === 'no-driver') ?? []
  const unknownDriver = ok.filter(r => r.foundDriver === false)

  return (
    <Modal open={open} onClose={onClose} title="📥 Atribuir lote (AT + motorista)" maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!result ? (
          <>
            <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
              Cole uma rota por linha: <b>AT ID</b> e o <b>ID do motorista</b> (separados por tab/espaço). Linha sem motorista é ignorada.
              Cada linha é gravada <b>direto no SPX</b> — não precisa das rotas estarem carregadas no turno.
            </p>
            {!spxConfigured && (
              <p style={{ margin: 0, fontSize: 11, color: '#f87171' }}>⚠ SPX não está configurado. Configure em <b>⋯ → Configurar SPX</b> antes de atribuir.</p>
            )}
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              placeholder={'AT202609129NT0P\t3599407\nAT202609129O9P0\t568742\nAT202609129NT8E'}
              style={{ width: '100%', height: 200, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
            <div><Btn onClick={() => void run()} disabled={!input.trim() || running || !spxConfigured}>{running ? '⏳ Atribuindo no SPX...' : 'Atribuir no SPX'}</Btn></div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Chip label={`✅ ${ok.length} atribuída(s) no SPX`} color="#34d399" bg="rgba(52,211,153,.12)" />
              {fail.length > 0 && <Chip label={`✗ ${fail.length} falha(s)`} color="#f87171" bg="rgba(239,68,68,.12)" />}
              {noDriver.length > 0 && <Chip label={`⏭️ ${noDriver.length} sem motorista (ignoradas)`} color="#94a3b8" bg="rgba(100,116,139,.12)" />}
              {unknownDriver.length > 0 && <Chip label={`❓ ${unknownDriver.length} motorista fora do cadastro`} color="#fbbf24" bg="rgba(245,158,11,.12)" />}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 340 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#13151f' }}>
                  <tr style={{ borderBottom: '1px solid #2d3048' }}>
                    {['AT ID', 'Motorista', 'Resultado'].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.map((r, i) => (
                    <tr key={`${r.atId}-${i}`} style={{ borderBottom: '1px solid #1e2130', opacity: r.status === 'no-driver' ? 0.5 : 1 }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#e2e8f0' }}>{r.atId}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.driverId ? (
                          <>
                            <span style={{ color: '#e2e8f0' }}>{r.driverName ?? r.driverId}</span>
                            <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{r.driverId}</span>
                          </>
                        ) : <span style={{ color: '#64748b' }}>—</span>}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.status === 'ok' && <span style={{ color: r.foundDriver === false ? '#fbbf24' : '#34d399' }}>{r.foundDriver === false ? '✅ SPX (motorista fora do cadastro)' : '✅ Atribuída no SPX'}</span>}
                        {r.status === 'fail' && <span style={{ color: '#f87171' }}>✗ {r.spxMsg ?? 'Falha no SPX'}</span>}
                        {r.status === 'no-driver' && <span style={{ color: '#94a3b8' }}>⏭️ Ignorada (sem motorista)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={onClose}>Fechar</Btn>
              <Btn variant="ghost" onClick={() => { setResult(null); setInput('') }}>Colar outro lote</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default function NoShowReversion({ registry, dsDrivers, forwardOrder, callUp, workPref, selectedDay, selectedShift }: Props) {
  const today = selectedDay

  // Migrate old single-key format on first load
  useEffect(() => { migrateOldRoutes(today, selectedShift) }, [today, selectedShift])

  const [routes, setRoutesState] = useState<LocalRoute[]>(() =>
    routeStore.get(selectedDay, selectedShift) ?? []
  )

  const [overrides, setOverridesState] = useState<Map<string, LocalDriver>>(() => {
    const raw = routeStore.getOverrides(selectedDay, selectedShift)
    return raw ? new Map(raw as [string, LocalDriver][]) : new Map()
  })

  // Reload routes when day or shift changes
  useEffect(() => {
    migrateOldRoutes(selectedDay, selectedShift)
    setRoutesState(routeStore.get(selectedDay, selectedShift) ?? [])
    const raw = routeStore.getOverrides(selectedDay, selectedShift)
    setOverridesState(raw ? new Map(raw as [string, LocalDriver][]) : new Map())
    const key = `spx:noshow-ignored:${selectedDay}:${selectedShift}`
    try { setIgnoredAtIdsState(new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])) } catch { setIgnoredAtIdsState(new Set()) }
    setForcedAtIdsState(readForced(`spx:noshow-forced:${selectedDay}:${selectedShift}`))
  }, [selectedDay, selectedShift])

  const setRoutes = (r: LocalRoute[]) => {
    setRoutesState(r)
    routeStore.save(selectedDay, selectedShift, r)
  }

  const setOverrides = (m: Map<string, LocalDriver>) => {
    setOverridesState(m)
    routeStore.saveOverrides(selectedDay, selectedShift, [...m.entries()])
  }

  const [activeTab, setActiveTab] = useState<'routes' | 'drivers' | 'fiorino'>('routes')
  const [routeSearch, setRouteSearch] = useState('')
  const [driverSearch, setDriverSearch] = useState('')
  const ignoredKey = `spx:noshow-ignored:${selectedDay}:${selectedShift}`
  // Motoristas que já receberam atribuição nesta sessão: driverId → ordem de atribuição (menor = foi primeiro)
  const [sessionAssignedOrder, setSessionAssignedOrder] = useState<Map<string, number>>(new Map())

  const [ignoredAtIds, setIgnoredAtIdsState] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ignoredKey) ?? '[]') as string[]) } catch { return new Set() }
  })
  const setIgnoredAtIds = (fn: (prev: Set<string>) => Set<string>) => {
    setIgnoredAtIdsState(prev => {
      const next = fn(prev)
      try { localStorage.setItem(ignoredKey, JSON.stringify([...next])) } catch {}
      return next
    })
  }
  // ATs colados manualmente: entram na reatribuição mesmo sem recusa no Call Up
  const forcedKey = `spx:noshow-forced:${selectedDay}:${selectedShift}`
  const readForced = (key: string) => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) } catch { return new Set<string>() } }
  const [forcedAtIds, setForcedAtIdsState] = useState<Set<string>>(() => readForced(forcedKey))
  const addForcedAtIds = (atIds: string[]) => {
    const next = new Set([...forcedAtIds, ...atIds])
    setForcedAtIdsState(next)
    try { localStorage.setItem(forcedKey, JSON.stringify([...next])) } catch {}
  }
  const [assignModal, setAssignModal] = useState<LocalRoute | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [addRouteModal, setAddRouteModal] = useState(false)
  const [batchModal, setBatchModal] = useState(false)
  const [addRouteText, setAddRouteText] = useState('')
  const [displacementConfirm, setDisplacementConfirm] = useState<{ newOverrides: Map<string, LocalDriver>; displaced: LocalRoute[]; driverName: string; targetAtId: string } | null>(null)

  // Manual blocklist
  const [manualBlocks, setManualBlocksState] = useState<ManualBlock[]>(() => getManualBlocks())
  const [blockModal, setBlockModal] = useState<{ driverId: string; name: string } | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [bulkBlockModal, setBulkBlockModal] = useState(false)
  const [bulkBlockIds, setBulkBlockIds] = useState('')
  const [bulkBlockReason, setBulkBlockReason] = useState('')

  const setManualBlocks = (blocks: ManualBlock[]) => {
    setManualBlocksState(blocks)
    saveManualBlocks(blocks)
  }

  const addManualBlock = (driverId: string, name: string, reason: string) => {
    const existing = manualBlocks.filter(b => b.driverId !== driverId)
    setManualBlocks([...existing, { driverId, driverName: name, reason, blockedAt: new Date().toISOString() }])
  }

  const removeManualBlock = (driverId: string) => {
    setManualBlocks(manualBlocks.filter(b => b.driverId !== driverId))
  }

  const addBulkBlocks = (idsText: string, reason: string) => {
    const ids = idsText.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
    const existing = new Map(manualBlocks.map(b => [b.driverId, b]))
    for (const id of ids) {
      const driver = availableDrivers.find(d => d.driverId === id)
      existing.set(id, { driverId: id, driverName: driver?.name ?? id, reason, blockedAt: new Date().toISOString() })
    }
    setManualBlocks([...existing.values()])
    return ids.length
  }

  // SPX
  const [spxConfigured, setSpxConfigured] = useState(() => !!getSpxCreds())
  const [spxModalOpen, setSpxModalOpen] = useState(false)
  const [spxCurlInput, setSpxCurlInput] = useState('')
  // Assign results
  const [assignResults, setAssignResults] = useState<{ atId: string; driverId: string; local: boolean; spxOk?: boolean; spxMsg?: string }[] | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [copiedPhones, setCopiedPhones] = useState(false)
  const [copiedAts, setCopiedAts] = useState(false)
  const [copiedAssignedPhones, setCopiedAssignedPhones] = useState(false)

  // Fila do turno lida do noShowQueueStore — recarrega quando turno muda
  const [queue, setQueue] = useState<QueueDriver[]>(() => noShowQueueStore.get(selectedShift))
  useEffect(() => { setQueue(noShowQueueStore.get(selectedShift)) }, [selectedShift])

  const removeFromQueue = useCallback((driverIds: string | string[]) => {
    const ids = Array.isArray(driverIds) ? driverIds : [driverIds]
    noShowQueueStore.remove(selectedShift, ids)
    setQueue(prev => { const s = new Set(ids); return prev.filter(d => !s.has(d.driverId)) })
  }, [selectedShift])

  // Enriquecer fila com DS, blocklist, forward order, callUp stats
  const availableDrivers = useMemo((): LocalDriver[] => {
    const registryMap = new Map(registry.map(d => [d.id, d]))
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const manualBlockMap = new Map(manualBlocks.map(b => [b.driverId, b]))
    const autoBlockMap = new Map<string, number>(
      (forwardOrder?.allDrivers ?? [])
        .filter(d => d.totalPackages > 5)
        .map(d => [d.driverId, d.totalPackages])
    )
    const callUpDriverMap = new Map((callUp?.byDriver ?? []).map(d => [d.driverId, d]))
    // WorkPreference é a fonte autoritária de clusters: reflete onde o motorista declarou disponibilidade
    const workPrefClusters = new Map((workPref?.drivers ?? []).map(d => [d.driverId, d.clusters]))

    return queue.map(q => {
      const reg = registryMap.get(q.driverId)
      const ds = dsMap.get(q.driverId)
      const cu = callUpDriverMap.get(q.driverId)
      const dsReal = ds?.DS_Real ?? null
      const pendingPackages = forwardOrder?.allDrivers.find(x => x.driverId === q.driverId)?.totalPackages ?? 0

      const isRegistryBlocked = reg?.spxBlocklisted ?? false
      const isAutoBlocked = autoBlockMap.has(q.driverId)
      const isManualBlocked = manualBlockMap.has(q.driverId)
      const isBlocked = isRegistryBlocked || isAutoBlocked || isManualBlocked || q.isBlocked

      const blockType: LocalDriver['blockType'] = isAutoBlocked ? 'auto' : isManualBlocked ? 'manual' : isRegistryBlocked ? 'registry' : null
      const blockReason = isAutoBlocked
        ? `Redelivery — ${autoBlockMap.get(q.driverId)} pacotes pendentes`
        : isManualBlocked ? manualBlockMap.get(q.driverId)!.reason
        : isRegistryBlocked ? 'SPX Blocklist' : null

      const dsPercent = dsReal !== null ? dsReal * 100 : 50
      const declineCount = cu?.declined ?? 0
      const noShowCount = cu?.timeoutCount ?? 0
      const priorityScore = calculatePriorityScore(dsPercent, declineCount, noShowCount)
      const lastAccepted = cu?.lastAcceptedDate ?? null
      const days = daysSinceLastRoute(lastAccepted)

      return {
        driverId: q.driverId,
        name: q.name || reg?.name || q.driverId,
        vehicleType: q.vehicleType || reg?.vehicleType || null,
        clusters: workPrefClusters.get(q.driverId) ?? q.clusters,
        isNewDriver: false,
        isBlocked,
        blockReason,
        blockType,
        pendingPackages,
        dsReal,
        dsStatus: ds?.Status ?? null,
        priorityScore,
        daysSinceRoute: days,
      }
    }).sort((a, b) => {
      if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
      return b.priorityScore - a.priorityScore
    })
  }, [queue, registry, dsDrivers, forwardOrder, manualBlocks, callUp])

  // Rotas do turno atual que foram recusadas no Call Up
  const declinedAtIds = useMemo(() => {
    if (!callUp) return new Set<string>()
    const declined = new Set<string>()
    for (const fc of callUp.firstCallAnalysis.routes) {
      // 'Pending' (sem resposta) também é no-show
      if (fc.status !== 'Accepted' && fc.shift === selectedShift) {
        declined.add(fc.atId)
      }
    }
    return declined
  }, [callUp, selectedShift])

  // Motoristas bloqueados: têm rota no MESMO turno (vem do routeStore do turno atual)
  const alreadyRoutedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of routeStore.get(selectedDay, selectedShift) ?? []) {
      if (r.assignedDriverId) ids.add(r.assignedDriverId)
    }
    return ids
  }, [selectedDay, selectedShift, routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Motoristas dobra: têm rota em OUTRO turno do mesmo dia (elegíveis, mas sinalizados)
  const dobraIds = useMemo(() => {
    const ids = new Set<string>()
    for (const { date, shift } of routeStore.list()) {
      if (date !== selectedDay || shift === selectedShift) continue
      for (const r of routeStore.get(date, shift) ?? []) {
        if (r.assignedDriverId && !alreadyRoutedIds.has(r.assignedDriverId)) ids.add(r.assignedDriverId)
      }
    }
    return ids
  }, [selectedDay, selectedShift, alreadyRoutedIds, routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-devolver rotas ATRIBUIDA que foram recusadas no Call Up
  useEffect(() => {
    if (declinedAtIds.size === 0) return
    const hasAny = routes.some(r => declinedAtIds.has(r.atId) && r.status === 'ATRIBUIDA')
    if (!hasAny) return
    const updated = routes.map(r =>
      declinedAtIds.has(r.atId) && r.status === 'ATRIBUIDA'
        ? { ...r, status: 'DISPONIVEL' as const }  // mantém assignedDriverId para alreadyRoutedIds excluir o driver original
        : r
    )
    setRoutes(updated)
  }, [declinedAtIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotas a mostrar: apenas as que foram recusadas no Call Up (se callUp disponível), senão todas DISPONIVEL
  // ignoredAtIds é local (não persiste) — remove da view sem apagar do routeStore
  const noShowRoutes = useMemo(() => {
    const base = (!callUp || declinedAtIds.size === 0)
      ? routes.filter(r => r.status === 'DISPONIVEL')
      : routes.filter(r => declinedAtIds.has(r.atId) || forcedAtIds.has(r.atId))
    return base.filter(r => !ignoredAtIds.has(r.atId))
  }, [routes, callUp, declinedAtIds, ignoredAtIds, forcedAtIds])

  // Drivers ordenados: bloqueados por último, depois já atribuídos nesta sessão (FIFO — quem foi primeiro fica por último), depois por score
  const orderedDrivers = useMemo(() => {
    return [...availableDrivers].sort((a, b) => {
      if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
      const aOrder = sessionAssignedOrder.get(a.driverId) ?? -1
      const bOrder = sessionAssignedOrder.get(b.driverId) ?? -1
      const aInSession = aOrder >= 0 ? 1 : 0
      const bInSession = bOrder >= 0 ? 1 : 0
      if (aInSession !== bInSession) return aInSession - bInSession
      // Ambos já foram atribuídos: quem foi mais recente vai antes (menor ordem = foi mais cedo = fica por último)
      if (aInSession && bInSession) return aOrder - bOrder
      if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore
      return b.daysSinceRoute - a.daysSinceRoute
    })
  }, [availableDrivers, sessionAssignedOrder])

  const effectiveAssignments = useMemo(
    () => computeEffective(noShowRoutes.filter(r => r.status === 'DISPONIVEL'), orderedDrivers.filter(d => !alreadyRoutedIds.has(d.driverId)), overrides),
    [noShowRoutes, orderedDrivers, overrides, alreadyRoutedIds]
  )

  const disponivel = noShowRoutes.filter(r => r.status === 'DISPONIVEL')
  const atribuidas = noShowRoutes.filter(r => r.status === 'ATRIBUIDA')

  const sortedDisponivel = [...disponivel].sort((a, b) =>
    (effectiveAssignments.has(a.id) ? 1 : 0) - (effectiveAssignments.has(b.id) ? 1 : 0)
  )
  const allRoutes = [...sortedDisponivel, ...atribuidas]

  const filteredRoutes = allRoutes.filter(r => {
    const q = routeSearch.toLowerCase()
    return !q || r.atId.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q)
  })

  // Fila de motoristas: disponíveis e sem rota no turno atual
  const queueDrivers = orderedDrivers.filter(d => !alreadyRoutedIds.has(d.driverId))
  const alreadyRoutedDrivers = orderedDrivers.filter(d => alreadyRoutedIds.has(d.driverId))

  // ── Fiorino tab ───────────────────────────────────────────────────────────
  const [fioMode, setFioMode] = useState<'strict' | 'maximize'>('strict')

  const fiorino = useMemo(() => {
    // Motoristas Fiorino disponíveis: ordenados por score desc, tiebreaker dias sem rota desc
    const fioDrivers = orderedDrivers.filter(d =>
      normalizeVehicle(d.vehicleType) === 'FIORINO' &&
      !d.isBlocked &&
      !alreadyRoutedIds.has(d.driverId)
    ).sort((a, b) =>
      b.priorityScore !== a.priorityScore ? b.priorityScore - a.priorityScore : b.daysSinceRoute - a.daysSinceRoute
    )

    // Rotas que exigem Fiorino (GG ≥ 2 E volume ≥ 800)
    const strictRoutes = routes.filter(r =>
      r.status === 'DISPONIVEL' && !ignoredAtIds.has(r.atId) &&
      (r.gg ?? 0) >= 2 && (r.volume ?? 0) >= 800
    )

    // Todas as rotas disponíveis (para modo maximize)
    const allAvailableRoutes = routes.filter(r =>
      r.status === 'DISPONIVEL' && !ignoredAtIds.has(r.atId)
    )

    // Greedy assignment — rotas mais restritivas de cluster primeiro
    function buildAssignments(targetRoutes: LocalRoute[], pool: LocalDriver[]): Map<string, LocalDriver> {
      const result = new Map<string, LocalDriver>()
      const usedIds = new Set<string>()
      const sorted = [...targetRoutes].sort((a, b) => {
        const ca = pool.filter(d => d.clusters.some(c => normCluster(c) === normCluster(a.cluster))).length
        const cb = pool.filter(d => d.clusters.some(c => normCluster(c) === normCluster(b.cluster))).length
        return ca - cb
      })
      for (const route of sorted) {
        const withCluster = pool.filter(d => !usedIds.has(d.driverId) && d.clusters.some(c => normCluster(c) === normCluster(route.cluster)))
        const candidate = withCluster[0]
        if (candidate) { result.set(route.atId, candidate); usedIds.add(candidate.driverId) }
      }
      return result
    }

    // Modo strict: apenas rotas com GG≥2 e volume≥800
    const strictAssignments = buildAssignments(strictRoutes, fioDrivers)

    // Modo maximize: primeiro atribui rotas obrigatórias, depois usa Fiorinos restantes em qualquer rota
    const maximizeAssignments = (() => {
      const result = new Map<string, LocalDriver>(strictAssignments)
      const usedIds = new Set([...result.values()].map(d => d.driverId))
      const remainingDrivers = fioDrivers.filter(d => !usedIds.has(d.driverId))
      const remainingRoutes = allAvailableRoutes.filter(r => !result.has(r.atId))
      const extra = buildAssignments(remainingRoutes, remainingDrivers)
      for (const [atId, driver] of extra) result.set(atId, driver)
      return result
    })()

    const assignments = fioMode === 'strict' ? strictAssignments : maximizeAssignments
    const eligibleRoutes = fioMode === 'strict' ? strictRoutes : allAvailableRoutes.filter(r => assignments.has(r.atId) || strictRoutes.some(s => s.atId === r.atId))

    return { eligibleRoutes: fioMode === 'strict' ? strictRoutes : allAvailableRoutes, strictRoutes, fioDrivers, assignments, strictAssignments, maximizeAssignments }
  }, [routes, orderedDrivers, alreadyRoutedIds, ignoredAtIds, fioMode])

  const [fioAssigning, setFioAssigning] = useState(false)
  const [fioResults, setFioResults] = useState<{ atId: string; driverId: string; spxOk?: boolean; spxMsg?: string }[] | null>(null)
  const [fioSearch, setFioSearch] = useState('')

  const filteredFioRoutes = (fioMode === 'strict' ? fiorino.strictRoutes : fiorino.eligibleRoutes).filter(r => {
    const q = fioSearch.toLowerCase()
    return !q || r.atId.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q)
  })

  const handleFioAssign = async () => {
    if (fioAssigning || fiorino.assignments.size === 0) return
    setFioAssigning(true)
    setFioResults(null)
    const results: { atId: string; driverId: string; spxOk?: boolean; spxMsg?: string }[] = []
    const assignedIds: string[] = []
    for (const [atId, driver] of fiorino.assignments) {
      let spxOk: boolean | undefined
      let spxMsg: string | undefined
      if (spxConfigured) {
        const res = await spxReassign(driver.driverId, atId)
        spxOk = res.ok
        spxMsg = res.message
      }
      results.push({ atId, driverId: driver.driverId, spxOk, spxMsg })
      assignedIds.push(driver.driverId)
      setRoutesState(prev => prev.map(r => r.atId === atId
        ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: driver.driverId, assignedDriverName: driver.name }
        : r
      ))
    }
    // Persist
    setRoutes(routes.map(r => {
      const driver = fiorino.assignments.get(r.atId)
      if (driver) return { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: driver.driverId, assignedDriverName: driver.name }
      return r
    }))
    removeFromQueue(assignedIds)
    setFioResults(results)
    setFioAssigning(false)
  }

  // Sub-abas internas do "First Convocation"
  const [fcSection, setFcSection] = useState<'fiorino' | 'novatos' | '3pl'>('fiorino')

  // Pré-visualização 3PL (rota→transportadora), mantida no pai para sobreviver à troca de abas
  const [threePlAssignments, setThreePlAssignments] = useState<Map<string, { agency: string; region: string; shift: Shift }>>(new Map())
  // Zera a pré-visualização 3PL ao trocar de dia/turno (é específica do turno)
  useEffect(() => { setThreePlAssignments(new Map()) }, [selectedDay, selectedShift])

  // Transportadoras (agências) do relatório de motoristas, excluindo frota própria
  const agencies = useMemo(() => {
    const set = new Set<string>()
    for (const d of registry) {
      const a = (d.agency ?? '').trim()
      if (a && a.toUpperCase() !== 'SPXOWNFLEET') set.add(a)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [registry])

  // Rotas já comprometidas em outros fluxos (não podem ir para o 3PL)
  const excludedRouteIds = useMemo(() => {
    const s = new Set<string>()
    for (const id of overrides.keys()) s.add(id)
    const atIdToId = new Map(routes.map(r => [r.atId, r.id]))
    for (const atId of fiorino.assignments.keys()) { const id = atIdToId.get(atId); if (id) s.add(id) }
    return s
  }, [overrides, fiorino.assignments, routes])

  const applyOverrideAssignments = (assignments: { route: LocalRoute; driver: LocalDriver }[]) => {
    const newOverrides = new Map(overrides)
    for (const { route, driver } of assignments) {
      newOverrides.set(route.id, driver)
    }
    setOverrides(newOverrides)
  }

  // Resolve um motorista pelo ID: disponibilidade → cadastro → work preference → mínimo (só ID)
  const resolveDriverById = (driverId: string): { driver: LocalDriver; found: boolean } => {
    const av = availableDrivers.find(d => d.driverId === driverId)
    if (av) return { driver: av, found: true }
    const reg = registry.find(d => d.id === driverId)
    const wp = workPref?.drivers.find(d => d.driverId === driverId)
    return {
      driver: {
        driverId,
        name: reg?.name || wp?.driverName || driverId,
        vehicleType: reg?.vehicleType || wp?.vehicleType || null,
        clusters: wp?.clusters ?? [],
        isNewDriver: false, isBlocked: false, blockReason: null, blockType: null,
        pendingPackages: 0, dsReal: null, dsStatus: null, priorityScore: 0, daysSinceRoute: 9999,
      },
      found: Boolean(reg || wp),
    }
  }

  // Atribuição em lote: cola "AT<tab>driverId" por linha; grava DIRETO no SPX.
  // Linha sem motorista é ignorada. Não depende das rotas estarem carregadas no turno.
  const handleBatchAssign = async (text: string): Promise<BatchAssignRow[]> => {
    const routeByAt = new Map(routes.map(r => [r.atId.trim().toUpperCase(), r]))
    const rows: BatchAssignRow[] = []
    const localUpdates: { rid: string; driver: LocalDriver }[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const parts = line.split(/\s+/)
      const atId = parts[0]
      const driverId = (parts[1] ?? '').trim()
      if (!driverId) { rows.push({ atId, driverId: '', status: 'no-driver' }); continue }
      const { driver, found } = resolveDriverById(driverId)
      if (!spxConfigured) {
        rows.push({ atId, driverId, status: 'fail', driverName: driver.name, foundDriver: found, spxMsg: 'SPX não configurado' })
        continue
      }
      const res = await spxReassign(driverId, atId)
      rows.push({ atId, driverId, status: res.ok ? 'ok' : 'fail', driverName: driver.name, foundDriver: found, spxMsg: res.message })
      if (res.ok) {
        const route = routeByAt.get(atId.trim().toUpperCase())
        if (route) localUpdates.push({ rid: route.id, driver })
      }
    }
    // Atualiza o estado local das rotas que existem no turno (as que não existem foram gravadas só no SPX)
    if (localUpdates.length) {
      setRoutes(routes.map(r => {
        const u = localUpdates.find(x => x.rid === r.id)
        return u ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: u.driver.driverId, assignedDriverName: u.driver.name } : r
      }))
    }
    return rows
  }

  const filteredDrivers = queueDrivers.filter(d => {
    const q = driverSearch.toLowerCase()
    return !q || d.driverId.includes(q) || d.name.toLowerCase().includes(q)
  })

  const filteredRoutedDrivers = alreadyRoutedDrivers.filter(d => {
    const q = driverSearch.toLowerCase()
    return !q || d.driverId.includes(q) || d.name.toLowerCase().includes(q)
  })

  const stats = {
    recusadas: declinedAtIds.size,
    disponivel: disponivel.length,
    atribuidas: atribuidas.length,
    drivers: queueDrivers.filter(d => !d.isBlocked).length,
    emRota: alreadyRoutedDrivers.length,
    blocked: queueDrivers.filter(d => d.isBlocked).length,
    preview: effectiveAssignments.size,
  }

  // ── Report modal ──────────────────────────────────────────────────────────
  const [reportModal, setReportModal] = useState(false)
  const [reportHub, setReportHub] = useState(() => getGlobalConfig().hubName || '')
  const [reportCopied, setReportCopied] = useState(false)
  // Snapshot dos valores de atribuição no momento em que o report é aberto
  const [reportSnapshot, setReportSnapshot] = useState<{ total: number; auto: number; manual: number; threepl: number; novatos: number } | null>(null)

  const buildReportSnapshot = () => {
    const totalRoutes = routes.length
    const novatosCount = [...overrides.values()].filter(d => d.isNewDriver).length
    const threeplCount = threePlAssignments.size
    const manualCount = overrides.size
    const atribuidasCount = routes.filter(r => r.status === 'ATRIBUIDA').length
    const autoCount = Math.max(0, atribuidasCount - manualCount - threeplCount - novatosCount)
    return { total: totalRoutes, auto: autoCount, manual: manualCount, threepl: threeplCount, novatos: novatosCount }
  }

  const buildReport = (snap?: { total: number; auto: number; manual: number }) => {
    const s = snap ?? reportSnapshot
    const totalRoutes = s?.total ?? routes.length
    const manualCount = s?.manual ?? overrides.size
    const autoCount = s?.auto ?? (routes.filter(r => r.status === 'ATRIBUIDA').length - manualCount)
    const pctAuto = totalRoutes > 0 ? ((autoCount / totalRoutes) * 100).toFixed(0) : '0'
    const pctManual = totalRoutes > 0 ? ((manualCount / totalRoutes) * 100).toFixed(0) : '0'
    const dateFormatted = selectedDay.split('-').reverse().join('/')
    return [
      `📊 Resumo Alocação – ${dateFormatted}`,
      ``,
      `🏢 Hub: ${reportHub || '—'}`,
      `📍 Turno: ${selectedShift}`,
      ``,
      `🚚 Distribuição de Rotas:`,
      `* Total de rotas: ${totalRoutes}`,
      `* Rotas alocadas no sistema oficial: ${autoCount}`,
      `* Percentual alocado no sistema oficial: ${pctAuto}%`,
      `* Rotas alocadas 3PL: 0`,
      `* Percentual alocado 3PL: 0%`,
      `* Rotas alocadas manualmente (app): ${manualCount}`,
      `* Percentual alocado manualmente (app): ${pctManual}%`,
      ``,
      `---`,
      ``,
      `⚠️ Ajustes Manuais:`,
      ``,
      `* 0 rotas atribuídas manualmente a Novatos.`,
      `* 0 rotas atribuídas manualmente a Utilitários do interior.`,
    ].join('\n')
  }

  const handleSelectDriver = (route: LocalRoute, driver: LocalDriver) => {
    const newOverrides = new Map([...overrides, [route.id, driver]])
    const newEffective = computeEffective(routes, availableDrivers, newOverrides)
    const displaced = routes.filter(r =>
      r.id !== route.id && r.status === 'DISPONIVEL' && effectiveAssignments.has(r.id) && !newEffective.has(r.id)
    )
    if (displaced.length > 0) {
      setDisplacementConfirm({ newOverrides, displaced, driverName: driver.name, targetAtId: route.atId })
      return
    }
    setOverrides(newOverrides)
    setAssignModal(null)
  }

  const handleConfirmAssign = async () => {
    if (isAssigning || effectiveAssignments.size === 0) return
    setIsAssigning(true)
    setAssignResults(null)

    const pairs = [...effectiveAssignments.entries()].map(([rid, driver]) => {
      const route = routes.find(r => r.id === rid)!
      return { rid, atId: route.atId, driver }
    })

    const results: { atId: string; driverId: string; local: boolean; spxOk?: boolean; spxMsg?: string }[] = []

    for (const { rid, atId, driver } of pairs) {
      let spxOk: boolean | undefined
      let spxMsg: string | undefined

      if (spxConfigured) {
        const res = await spxReassign(driver.driverId, atId)
        spxOk = res.ok
        spxMsg = res.message
      }

      // Apply locally regardless
      setRoutesState(prev => prev.map(r => r.id === rid
        ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: driver.driverId, assignedDriverName: driver.name }
        : r
      ))

      results.push({ atId, driverId: driver.driverId, local: true, spxOk, spxMsg })
    }

    // Persist final routes state
    setRoutes(routes.map(r => {
      const driver = effectiveAssignments.get(r.id)
      if (driver) return { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: driver.driverId, assignedDriverName: driver.name }
      return r
    }))
    // Remover motoristas atribuídos da fila permanentemente
    const assignedIds = [...effectiveAssignments.values()].map(d => d.driverId)
    removeFromQueue(assignedIds)
    setSessionAssignedOrder(new Map()) // resetar ordem de sessão pois já saíram da fila
    setOverrides(new Map())
    setAssignResults(results)
    setIsAssigning(false)
  }

  const handleRetryFailed = async () => {
    if (!assignResults || isRetrying) return
    const failed = assignResults.filter(r => r.spxOk === false)
    if (failed.length === 0) return
    setIsRetrying(true)
    const updated = [...assignResults]
    for (const entry of failed) {
      const res = await spxReassign(entry.driverId, entry.atId)
      const idx = updated.findIndex(r => r.atId === entry.atId && r.driverId === entry.driverId)
      if (idx >= 0) updated[idx] = { ...updated[idx], spxOk: res.ok, spxMsg: res.message }
    }
    setAssignResults([...updated])
    setIsRetrying(false)
  }

  const handleReturnRoute = (route: LocalRoute) => {
    const updated = routes.map(r => r.id === route.id ? { ...r, status: 'DISPONIVEL' as const, assignedDriverId: null, assignedDriverName: null } : r)
    setRoutes(updated)
    const newOv = new Map(overrides)
    newOv.delete(route.id)
    setOverrides(newOv)
  }

  const handleCopyRelation = async () => {
    const lines: string[] = []
    for (const [rid, driver] of effectiveAssignments) {
      const route = routes.find(r => r.id === rid)
      if (route) lines.push(`${driver.driverId};${route.atId}`)
    }
    if (lines.length === 0) { return }
    await navigator.clipboard.writeText(lines.join('\n'))
  }

  const driverCountForRoute = (route: LocalRoute) => {
    const rv = normalizeVehicle(route.requiredVehicleType)
    return availableDrivers.filter(d =>
      d.clusters.some(c => normCluster(c) === normCluster(route.cluster)) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO')
    ).length
  }

  // ── fila vazia ────────────────────────────────────────────────────────────
  if (queue.length === 0 && routes.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: '#8892a4', fontSize: 14 }}>📅 Importe o <strong style={{ color: '#e2e8f0' }}>Work Preference</strong> para criar a fila de motoristas do turno <strong style={{ color: '#e2e8f0' }}>{selectedShift}</strong>.</p>
        <p style={{ color: '#64748b', fontSize: 12 }}>A fila é criada automaticamente ao importar e fica separada por turno (AM / PM1 / PM2).</p>
      </div>
    )
  }

  // ── no routes yet ─────────────────────────────────────────────────────────
  if (routes.length === 0 || showPaste) {
    return (
      <RoutePasteScreen
        defaultDate={selectedDay}
        defaultShift={selectedShift}
        onLoad={(r, date, shift) => {
          routeStore.save(date, shift, r)
          // If saved date/shift matches current view, update local state
          if (date === selectedDay && shift === selectedShift) {
            setRoutesState(r)
          }
          setShowPaste(false)
          setOverrides(new Map())
        }}
      />
    )
  }

  // ── main board ────────────────────────────────────────────────────────────
  return (
    <>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #2d3048', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Atribuição</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
              <span style={{ color: SHIFT_COLOR[selectedShift], fontWeight: 600 }}>{selectedShift}</span> · {selectedDay} ·{' '}
              {callUp
                ? <><span style={{ color: '#f87171', fontWeight: 600 }}>{declinedAtIds.size} recusadas</span> no Call Up</>
                : <span style={{ color: '#fbbf24' }}>importe o Call Up para filtrar recusadas</span>
              }
              {' '}· {routes.length} rotas no turno
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Btn
              variant="outline"
              onClick={() => { setReportSnapshot(buildReportSnapshot()); setReportCopied(false); setReportModal(true) }}
              style={{ fontSize: 12, color: '#a78bfa', borderColor: 'rgba(167,139,250,.35)' }}
            >📊 Gerar Report</Btn>
            <Btn
              onClick={() => void handleConfirmAssign()}
              disabled={isAssigning || effectiveAssignments.size === 0}
            >{isAssigning ? '⏳ Atribuindo...' : `✦ Atribuir (${effectiveAssignments.size})`}</Btn>
            <HeaderMenu
              spxConfigured={spxConfigured}
              onSpx={() => { setSpxCurlInput(''); setSpxModalOpen(true) }}
              onPaste={() => setShowPaste(true)}
              onAddRoute={() => { setAddRouteText(''); setAddRouteModal(true) }}
              onBatch={() => setBatchModal(true)}
              onCopyRelation={() => void handleCopyRelation()}
              onCopyPhones={() => {
                const registryMap = new Map(registry.map(d => [d.id, d]))
                const phones = [...new Set(
                  [...effectiveAssignments.values()]
                    .map(d => registryMap.get(d.driverId)?.phoneNumber?.replace(/\D/g, '') ?? '')
                    .filter(p => p.length >= 8)
                )]
                if (phones.length === 0) return
                navigator.clipboard.writeText(phones.join('\n'))
                setCopiedPhones(true)
                setTimeout(() => setCopiedPhones(false), 2000)
              }}
              phoneCount={(() => {
                const registryMap = new Map(registry.map(d => [d.id, d]))
                return [...new Set(
                  [...effectiveAssignments.values()]
                    .map(d => registryMap.get(d.driverId)?.phoneNumber?.replace(/\D/g, '') ?? '')
                    .filter(p => p.length >= 8)
                )].length
              })()}
              copiedPhones={copiedPhones}
              onReport={() => { setReportSnapshot(buildReportSnapshot()); setReportCopied(false); setReportModal(true) }}
              onClear={() => { if (window.confirm('Limpar todas as rotas da tela? Esta ação não pode ser desfeita.')) { setRoutes([]); setOverrides(new Map()); setAssignResults(null) } }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid #1e2130', flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          { icon: '🚫', label: 'Recusadas', value: stats.recusadas, color: '#f87171' },
          { icon: '🛣', label: 'Para reverter', value: stats.disponivel, color: '#60a5fa' },
          { icon: '✅', label: 'Revertidas', value: stats.atribuidas, color: '#4ade80' },
          { icon: '👥', label: 'Motoristas livres', value: stats.drivers, color: '#4ade80' },
          { icon: '🔒', label: 'Já em rota', value: stats.emRota, color: '#94a3b8' },
          { icon: '⊘', label: 'Bloqueados', value: stats.blocked, color: '#f87171' },
          { icon: '✦', label: 'Previsão', value: stats.preview, color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '6px 12px', minWidth: 80 }}>
            <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{s.icon} {s.label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2d3048', flexShrink: 0, paddingLeft: 20 }}>
        <button onClick={() => setActiveTab('routes')} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeTab === 'routes' ? '2px solid #7c3aed' : '2px solid transparent', background: 'transparent', color: activeTab === 'routes' ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
          Rotas recusadas ({noShowRoutes.length})
        </button>
        <button onClick={() => setActiveTab('drivers')} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeTab === 'drivers' ? '2px solid #7c3aed' : '2px solid transparent', background: 'transparent', color: activeTab === 'drivers' ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
          Fila de motoristas ({queueDrivers.length}{alreadyRoutedDrivers.length > 0 ? ` · ${alreadyRoutedDrivers.length} já em rota` : ''})
        </button>
        <button onClick={() => setActiveTab('fiorino')} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeTab === 'fiorino' ? '2px solid #f59e0b' : '2px solid transparent', background: 'transparent', color: activeTab === 'fiorino' ? '#fbbf24' : '#8892a4', cursor: 'pointer' }}>
          🚐 First Convocation ({fiorino.strictRoutes.length} obrig. · {fiorino.fioDrivers.length} moto.)
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab !== 'fiorino' && (
        <div style={{ padding: '8px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder={activeTab === 'routes' ? '🔍  Buscar AT ID ou cluster...' : '🔍  Buscar motorista...'}
            value={activeTab === 'routes' ? routeSearch : driverSearch}
            onChange={e => activeTab === 'routes' ? setRouteSearch(e.target.value) : setDriverSearch(e.target.value)}
            style={{ width: 260, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12, outline: 'none' }}
          />
          {activeTab === 'drivers' && (
            <Btn variant="outline" onClick={() => { setBulkBlockIds(''); setBulkBlockReason(''); setBulkBlockModal(true) }} style={{ fontSize: 11, color: '#f87171', borderColor: 'rgba(239,68,68,.3)' }}>
              ⊘ Bloquear lista
            </Btn>
          )}
          {activeTab === 'routes' && (
            <Btn variant="outline" onClick={() => { setAddRouteText(''); setAddRouteModal(true) }} style={{ fontSize: 11, color: '#4ade80', borderColor: 'rgba(74,222,128,.3)' }}>
              ＋ Reatribuir AT
            </Btn>
          )}
          {activeTab === 'routes' && (
            <Btn variant="outline" onClick={() => {
              const ats = filteredRoutes.map(r => r.atId).filter(Boolean)
              if (ats.length === 0) return
              navigator.clipboard.writeText(ats.join('\n'))
              setCopiedAts(true)
              setTimeout(() => setCopiedAts(false), 2000)
            }} style={{ fontSize: 11, color: '#60a5fa', borderColor: 'rgba(59,130,246,.3)' }}>
              {copiedAts ? '✓ ATs copiadas!' : `📋 Copiar ATs (${filteredRoutes.length})`}
            </Btn>
          )}
          {activeTab === 'routes' && (() => {
            // Telefones dos motoristas com rota já atribuída na lista (respeita a busca)
            const registryMap = new Map(registry.map(d => [d.id, d]))
            const phones = [...new Set(
              filteredRoutes
                .filter(r => r.status === 'ATRIBUIDA' && r.assignedDriverId)
                .map(r => registryMap.get(r.assignedDriverId!)?.phoneNumber?.replace(/\D/g, '') ?? '')
                .filter(p => p.length >= 8)
            )]
            return (
              <Btn variant="outline" disabled={phones.length === 0} onClick={() => {
                navigator.clipboard.writeText(phones.join('\n'))
                setCopiedAssignedPhones(true)
                setTimeout(() => setCopiedAssignedPhones(false), 2000)
              }} style={{ fontSize: 11, color: '#4ade80', borderColor: 'rgba(74,222,128,.3)' }}>
                {copiedAssignedPhones ? '✓ Telefones copiados!' : `📱 Tel. atribuídos (${phones.length})`}
              </Btn>
            )
          })()}
        </div>
        )}

        {/* Routes table */}
        {activeTab === 'routes' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['#', 'AT ID', 'Cluster', 'Veículo', 'Gaiola', 'Motoristas', 'Motorista sugerido', 'Status'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRoutes.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: '#8892a4' }}>Nenhuma rota encontrada.</td></tr>
              ) : filteredRoutes.map((route, idx) => {
                if (route.status === 'ATRIBUIDA') {
                  return (
                    <tr key={route.id} style={{ borderBottom: '1px solid #1e2130', background: 'rgba(34,197,94,.03)' }}>
                      <td style={TD}><span style={{ color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</span></td>
                      <td style={TD}><span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0' }}>{route.atId}</span></td>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {route.isInterior && <span style={{ color: '#fbbf24', fontSize: 10 }}>📍</span>}
                          <span style={{ color: '#e2e8f0' }}>{route.cluster}</span>
                        </div>
                      </td>
                      <td style={TD}>{route.requiredVehicleType ? <Chip label={route.requiredVehicleType} small /> : '—'}</td>
                      <td style={{ ...TD, color: '#64748b' }}>{route.gaiola || '—'}</td>
                      <td style={{ ...TD, textAlign: 'center', color: '#64748b' }}>—</td>
                      <td style={TD}><span style={{ color: '#e2e8f0', fontWeight: 500 }}>{route.assignedDriverName || '—'}</span></td>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Chip label="Atribuída" color="#4ade80" bg="rgba(34,197,94,.1)" small />
                          <Btn variant="ghost" onClick={() => handleReturnRoute(route)} style={{ fontSize: 11 }}>↩ Devolver</Btn>
                          <Btn variant="ghost" onClick={() => setIgnoredAtIds(s => new Set([...s, route.atId]))} style={{ fontSize: 10, color: '#64748b', padding: '2px 6px' }}>✕</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                }

                const effective = effectiveAssignments.get(route.id)
                const isOverridden = overrides.has(route.id)
                const dsMeta = getDsMeta(effective?.dsReal ?? null)
                const driverCount = driverCountForRoute(route)
                const rv = normalizeVehicle(route.requiredVehicleType)

                return (
                  <tr key={route.id}
                    onClick={() => setAssignModal(route)}
                    style={{ borderBottom: '1px solid #1e2130', cursor: 'pointer', background: !effective ? 'rgba(239,68,68,.03)' : route.isInterior ? 'rgba(245,158,11,.03)' : 'transparent' }}>
                    <td style={TD}><span style={{ color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</span></td>
                    <td style={TD}><span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0' }}>{route.atId}</span></td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {route.isInterior && <span style={{ color: '#fbbf24', fontSize: 10 }}>📍</span>}
                        <span style={{ color: '#e2e8f0' }}>{route.cluster}</span>
                        {route.isInterior && <Chip label="Interior" color="#fbbf24" bg="rgba(245,158,11,.1)" small />}
                      </div>
                    </td>
                    <td style={TD}>{route.requiredVehicleType ? <Chip label={route.requiredVehicleType} small /> : '—'}</td>
                    <td style={{ ...TD, color: '#64748b' }}>{route.gaiola || '—'}</td>
                    <td style={{ ...TD, textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, color: driverCount === 0 ? '#f87171' : driverCount === 1 ? '#fbbf24' : '#4ade80' }}>{driverCount}</span>
                    </td>
                    <td style={TD}>
                      {effective ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: effective.isBlocked ? '#f87171' : '#e2e8f0', fontWeight: 500 }}>{effective.name}</span>
                          {effective.vehicleType && <Chip label={effective.vehicleType} color="#94a3b8" bg="rgba(100,116,139,.1)" small />}
                          {rv === 'MOTO' && normalizeVehicle(effective.vehicleType) !== 'MOTO' && <Chip label="⚠ Não é moto" color="#fbbf24" bg="rgba(245,158,11,.1)" small />}
                          {effective.isNewDriver && <Chip label="Novato" color="#a78bfa" bg="rgba(139,92,246,.1)" small />}
                          {dobraIds.has(effective.driverId) && <Chip label="Dobra" color="#f97316" bg="rgba(249,115,22,.1)" small />}
                          {sessionAssignedOrder.has(effective.driverId) && <Chip label="Já atribuído" color="#f59e0b" bg="rgba(245,158,11,.1)" small />}
                          {effective.isBlocked && <Chip label={effective.blockType === 'auto' ? '📦 Redelivery' : effective.blockType === 'registry' ? '⊘ SPX Blocklist' : '⊘ Bloqueado'} color="#f87171" bg="rgba(239,68,68,.12)" small />}
                          <Chip label={`DS ${dsMeta.label}`} color={dsMeta.color} bg={dsMeta.bg} small />
                          <Chip label={`Score ${effective.priorityScore}`} color="#94a3b8" bg="rgba(100,116,139,.1)" small />
                          {isOverridden && <Chip label="Editado" color="#60a5fa" bg="rgba(59,130,246,.1)" small />}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ Sem motorista disponível</span>
                      )}
                    </td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Chip label="Disponível" color="#60a5fa" bg="rgba(59,130,246,.08)" small />
                        <Btn variant="ghost" onClick={e => { e.stopPropagation(); setIgnoredAtIds(s => new Set([...s, route.atId])) }} style={{ fontSize: 10, color: '#64748b', padding: '2px 6px' }}>✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Drivers table */}
        {activeTab === 'drivers' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['#', 'Motorista', 'Veículo', 'DS', 'Score', 'Clusters', 'Status / Ação'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length === 0 && filteredRoutedDrivers.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#8892a4' }}>Nenhum motorista disponível hoje.</td></tr>
              ) : filteredDrivers.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#8892a4' }}>Todos os motoristas já receberam rota.</td></tr>
              ) : filteredDrivers.map((driver, idx) => {
                const dsMeta = getDsMeta(driver.dsReal)
                const clusterCount = (c: string) => queueDrivers.filter(d => !d.isBlocked && d.clusters.some(dc => normCluster(dc) === normCluster(c))).length
                return (
                  <tr key={driver.driverId} style={{ borderBottom: '1px solid #1e2130', background: driver.isBlocked ? 'rgba(239,68,68,.03)' : 'transparent' }}>
                    <td style={{ ...TD, color: '#64748b', fontFamily: 'monospace', width: 32 }}>{idx + 1}</td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ color: driver.isBlocked ? '#f87171' : '#e2e8f0', fontWeight: 500 }}>{driver.name}</span>
                        {driver.isNewDriver && <Chip label="Novato" color="#a78bfa" bg="rgba(139,92,246,.1)" small />}
                        {dobraIds.has(driver.driverId) && <Chip label="Dobra" color="#f97316" bg="rgba(249,115,22,.1)" small />}
                        {sessionAssignedOrder.has(driver.driverId) && <Chip label="Já atribuído" color="#f59e0b" bg="rgba(245,158,11,.1)" small />}
                        {driver.isBlocked && <Chip label={driver.blockType === 'auto' ? '📦 Redelivery' : driver.blockType === 'registry' ? '⊘ SPX Blocklist' : '⊘ Bloqueado'} color="#f87171" bg="rgba(239,68,68,.12)" small />}
                      </div>
                      <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{driver.driverId}</p>
                    </td>
                    <td style={TD}>{driver.vehicleType ? <Chip label={driver.vehicleType} color="#94a3b8" bg="rgba(100,116,139,.1)" small /> : '—'}</td>
                    <td style={TD}><Chip label={dsMeta.label} color={dsMeta.color} bg={dsMeta.bg} small /></td>
                    <td style={TD}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: driver.priorityScore >= 70 ? '#4ade80' : driver.priorityScore >= 40 ? '#fbbf24' : '#f87171' }}>
                        {driver.priorityScore.toFixed(0)}
                      </span>
                    </td>
                    <td style={TD}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {[...driver.clusters].sort((a, b) => clusterCount(a) - clusterCount(b)).map(c => {
                          const cnt = clusterCount(c)
                          const col = cnt <= 1 ? '#f87171' : cnt === 2 ? '#fbbf24' : INTERIOR_CLUSTERS.has(c) ? '#fbbf24' : '#64748b'
                          return <Chip key={c} label={`${c} (${cnt})`} color={col} bg={`${col}18`} small />
                        })}
                      </div>
                    </td>
                    <td style={TD}>
                      {driver.isBlocked ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <Chip
                              label={driver.blockType === 'auto' ? '📦 Redelivery' : driver.blockType === 'registry' ? '⊘ SPX Blocklist' : '⊘ Bloqueado'}
                              color="#f87171" bg="rgba(239,68,68,.1)" small
                            />
                            {driver.blockType === 'auto' && <span style={{ fontSize: 10, color: '#64748b' }}>(automático)</span>}
                          </div>
                          {driver.blockReason && <p style={{ margin: 0, fontSize: 10, color: '#f87171' }}>{driver.blockReason}</p>}
                          {driver.blockType === 'manual' && (
                            <Btn variant="outline" onClick={() => removeManualBlock(driver.driverId)} style={{ fontSize: 10, padding: '3px 8px', color: '#4ade80', borderColor: 'rgba(74,222,128,.3)' }}>
                              ✓ Desbloquear
                            </Btn>
                          )}
                          {driver.blockType === 'auto' && (
                            <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>Atualize o relatório de pacotes para remover</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Chip label="Na fila" color="#60a5fa" bg="rgba(59,130,246,.08)" small />
                          <Btn variant="ghost" onClick={() => { setBlockModal({ driverId: driver.driverId, name: driver.name }); setBlockReason('') }} style={{ fontSize: 10, padding: '2px 6px', color: '#f87171' }}>⊘ Bloquear</Btn>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Drivers who already received a confirmed route */}
              {filteredRoutedDrivers.length > 0 && (
                <>
                  <tr>
                    <td colSpan={7} style={{ padding: '8px 16px', background: '#0f1117', borderBottom: '1px solid #2d3048', borderTop: '2px solid #2d3048' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>🔒 Já em rota ou aceitaram chamada em {selectedDay} — não elegíveis ({filteredRoutedDrivers.length})</span>
                    </td>
                  </tr>
                  {filteredRoutedDrivers.map(driver => {
                    const dsMeta = getDsMeta(driver.dsReal)
                    const assignedRoute = routes.find(r => r.status === 'ATRIBUIDA' && r.assignedDriverId === driver.driverId)
                    return (
                      <tr key={driver.driverId} style={{ borderBottom: '1px solid #1e2130', background: 'rgba(34,197,94,.02)', opacity: 0.7 }}>
                        <td style={{ ...TD, color: '#64748b' }}>—</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <span style={{ color: '#94a3b8', fontWeight: 500 }}>{driver.name}</span>
                          </div>
                          <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{driver.driverId}</p>
                        </td>
                        <td style={TD}>{driver.vehicleType ? <Chip label={driver.vehicleType} color="#94a3b8" bg="rgba(100,116,139,.1)" small /> : '—'}</td>
                        <td style={TD}><Chip label={dsMeta.label} color={dsMeta.color} bg={dsMeta.bg} small /></td>
                        <td style={TD}><span style={{ color: '#64748b', fontSize: 12 }}>{driver.priorityScore.toFixed(0)}</span></td>
                        <td style={TD}>—</td>
                        <td style={TD}>
                          <Chip label={`✓ ${assignedRoute?.atId ?? 'Atribuída'}`} color="#4ade80" bg="rgba(34,197,94,.1)" small />
                        </td>
                      </tr>
                    )
                  })}
                </>
              )}
            </tbody>
          </table>
        )}

        {/* Fiorino tab */}
        {activeTab === 'fiorino' && (
          <div>
            {/* Sub-abas internas do First Convocation */}
            <div style={{ display: 'flex', gap: 6, padding: '10px 20px 0' }}>
              {([
                { id: 'fiorino', label: '🚐 Fiorino' },
                { id: 'novatos', label: '🆕 Novatos' },
                { id: '3pl', label: '📦 3PL' },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setFcSection(t.id)}
                  style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${fcSection === t.id ? '#0ea5e9' : '#2d3048'}`,
                    background: fcSection === t.id ? 'rgba(14,165,233,.12)' : 'transparent',
                    color: fcSection === t.id ? '#38bdf8' : '#8892a4' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {fcSection === 'fiorino' && (
          <div style={{ padding: '12px 20px' }}>
            {/* Header Fiorino */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Toggle de modo */}
                <div style={{ display: 'flex', background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    onClick={() => setFioMode('strict')}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', background: fioMode === 'strict' ? '#d97706' : 'transparent', color: fioMode === 'strict' ? '#fff' : '#8892a4', cursor: 'pointer' }}
                  >
                    🎯 Apenas obrigatórias
                  </button>
                  <button
                    onClick={() => setFioMode('maximize')}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', background: fioMode === 'maximize' ? '#d97706' : 'transparent', color: fioMode === 'maximize' ? '#fff' : '#8892a4', cursor: 'pointer' }}
                  >
                    🚀 Maximizar convocações
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                  {fioMode === 'strict'
                    ? 'Fiorino apenas em rotas com GG ≥ 2 e volume ≥ 800'
                    : 'Fiorino em rotas obrigatórias + qualquer rota disponível para aproveitar o restante da fila'}
                </p>
              </div>
              <Btn
                onClick={() => void handleFioAssign()}
                disabled={fioAssigning || fiorino.assignments.size === 0}
                style={{ background: fioAssigning ? undefined : '#d97706' }}
              >
                {fioAssigning ? '⏳ Atribuindo...' : `🚐 Atribuir Fiorino (${fiorino.assignments.size})`}
              </Btn>
            </div>

            {/* Stats Fiorino */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                { label: 'Rotas obrigatórias (GG≥2 vol≥800)', value: fiorino.strictRoutes.length, color: '#fbbf24' },
                ...(fioMode === 'maximize' ? [{ label: 'Rotas extras (qualquer)', value: fiorino.assignments.size - fiorino.strictAssignments.size, color: '#60a5fa' }] : []),
                { label: 'Motoristas Fiorino', value: fiorino.fioDrivers.length, color: '#4ade80' },
                { label: 'Atribuições previstas', value: fiorino.assignments.size, color: '#a78bfa' },
                { label: 'Fiorinos sem rota', value: fiorino.fioDrivers.length - fiorino.assignments.size, color: '#f87171' },
              ].map(s => (
                <div key={s.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '6px 12px', minWidth: 80 }}>
                  <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{s.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Fiorino Results */}
            {fioResults && (
              <div style={{ marginBottom: 12, background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, padding: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Resultado da atribuição Fiorino:</p>
                {fioResults.map(r => (
                  <p key={r.atId} style={{ margin: '2px 0', fontSize: 11 }}>
                    <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{r.atId}</span>
                    {' → '}
                    <span style={{ color: r.spxOk === false ? '#f87171' : '#4ade80' }}>
                      {r.spxOk === undefined ? '✓ Local' : r.spxOk ? `✓ SPX: ${r.spxMsg}` : `✗ SPX: ${r.spxMsg}`}
                    </span>
                  </p>
                ))}
              </div>
            )}

            <input
              placeholder="🔍  Buscar AT ID ou cluster..."
              value={fioSearch}
              onChange={e => setFioSearch(e.target.value)}
              style={{ width: 260, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12, outline: 'none', marginBottom: 10 }}
            />

            {/* Routes table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 24 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid #2d3048' }}>
                  {['#', 'AT ID', 'Cluster', 'GG', 'Volume', 'Motorista atribuído', 'Score', 'Dias s/ rota'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredFioRoutes.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: '#8892a4' }}>
                    {fiorino.strictRoutes.length === 0
                      ? 'Nenhuma rota com GG ≥ 2 e volume ≥ 800 disponível.'
                      : 'Nenhuma rota encontrada na busca.'}
                  </td></tr>
                ) : filteredFioRoutes.map((route, idx) => {
                  const assigned = fiorino.assignments.get(route.atId)
                  const isObrigatory = fiorino.strictRoutes.some(r => r.atId === route.atId)
                  const dsMeta = assigned ? getDsMeta(assigned.dsReal) : null
                  return (
                    <tr key={route.id} style={{ borderBottom: '1px solid #1e2130', background: assigned ? (isObrigatory ? 'rgba(245,158,11,.03)' : 'rgba(59,130,246,.03)') : 'rgba(239,68,68,.03)' }}>
                      <td style={{ ...TD, color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</td>
                      <td style={TD}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: isObrigatory ? '#fbbf24' : '#60a5fa' }}>{route.atId}</span>
                        {fioMode === 'maximize' && !isObrigatory && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 3, padding: '1px 5px' }}>extra</span>}
                      </td>
                      <td style={TD}><span style={{ color: '#e2e8f0' }}>{route.cluster}</span></td>
                      <td style={{ ...TD, textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#4ade80' }}>{route.gg ?? '—'}</span></td>
                      <td style={{ ...TD, textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#60a5fa' }}>{route.volume?.toLocaleString('pt-BR') ?? '—'}</span></td>
                      <td style={TD}>
                        {assigned ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{assigned.name}</span>
                            <Chip label="FIORINO" color="#fbbf24" bg="rgba(245,158,11,.1)" small />
                            {assigned.daysSinceRoute < 9999 && <Chip label={`${assigned.daysSinceRoute}d s/ rota`} color="#94a3b8" bg="rgba(100,116,139,.1)" small />}
                          </div>
                        ) : (
                          <span style={{ color: '#f87171', fontSize: 11 }}>⚠ Sem Fiorino disponível</span>
                        )}
                      </td>
                      <td style={TD}>{dsMeta ? <Chip label={dsMeta.label} color={dsMeta.color} bg={dsMeta.bg} small /> : '—'}</td>
                      <td style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>
                        {assigned?.daysSinceRoute === 9999 ? '—' : (assigned?.daysSinceRoute ?? '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Fiorino driver pool */}
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Pool de motoristas Fiorino disponíveis ({fiorino.fioDrivers.length})</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2d3048' }}>
                  {['#', 'Motorista', 'DS', 'Score', 'Dias s/ rota', 'Clusters', 'Atribuição prevista'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fiorino.fioDrivers.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#8892a4' }}>Nenhum motorista Fiorino na fila para este turno.</td></tr>
                ) : fiorino.fioDrivers.map((driver, idx) => {
                  const dsMeta = getDsMeta(driver.dsReal)
                  const assignedRoute = [...fiorino.assignments.entries()].find(([, d]) => d.driverId === driver.driverId)?.[0]
                  return (
                    <tr key={driver.driverId} style={{ borderBottom: '1px solid #1e2130', background: assignedRoute ? 'rgba(245,158,11,.02)' : 'transparent' }}>
                      <td style={{ ...TD, color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</td>
                      <td style={TD}>
                        <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{driver.name}</span>
                        <p style={{ margin: '1px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{driver.driverId}</p>
                      </td>
                      <td style={TD}><Chip label={dsMeta.label} color={dsMeta.color} bg={dsMeta.bg} small /></td>
                      <td style={TD}><span style={{ fontWeight: 600, color: '#e2e8f0' }}>{driver.priorityScore.toFixed(0)}</span></td>
                      <td style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>{driver.daysSinceRoute === 9999 ? '—' : driver.daysSinceRoute}</td>
                      <td style={TD}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {driver.clusters.slice(0, 3).map(c => <Chip key={c} label={c} small />)}
                          {driver.clusters.length > 3 && <Chip label={`+${driver.clusters.length - 3}`} small />}
                        </div>
                      </td>
                      <td style={TD}>
                        {assignedRoute
                          ? <Chip label={assignedRoute} color="#fbbf24" bg="rgba(245,158,11,.1)" small />
                          : <span style={{ color: '#64748b', fontSize: 11 }}>Sem rota elegível no cluster</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
            )}

            {fcSection === 'novatos' && (
              <div style={{ padding: '12px 20px' }}>
                <NovatosPanel workPref={workPref} routes={routes} availableDrivers={availableDrivers} onAssign={applyOverrideAssignments} />
              </div>
            )}

            {fcSection === '3pl' && (
              <div style={{ padding: '12px 20px' }}>
                <ThreePlPanel routes={routes} selectedShift={selectedShift} agencies={agencies} excludedRouteIds={excludedRouteIds} assignments={threePlAssignments} setAssignments={setThreePlAssignments} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Batch assign modal */}
    <BatchAssignModal open={batchModal} onClose={() => setBatchModal(false)} onApply={handleBatchAssign} spxConfigured={spxConfigured} />

    {/* Report modal */}
    {reportModal && (() => {
      const snap = reportSnapshot ?? buildReportSnapshot()
      return (
        <Modal open={reportModal} onClose={() => setReportModal(false)} title="📊 Gerar Report de Alocação" maxWidth={560}>
          <ReportModalBody
            hub={reportHub}
            onHubChange={h => {
              setReportHub(h)
              const cfg = getGlobalConfig(); saveGlobalConfig({ ...cfg, hubName: h })
            }}
            selectedDay={selectedDay}
            selectedShift={selectedShift}
            snap={snap}
            onSnapChange={setReportSnapshot}
            copied={reportCopied}
            onCopy={async (text) => { await navigator.clipboard.writeText(text); setReportCopied(true); setTimeout(() => setReportCopied(false), 2000) }}
          />
        </Modal>
      )
    })()}

    {/* Assign driver modal */}
    <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Selecionar motorista — ${assignModal?.atId}`} maxWidth={560}>
      {assignModal && (() => {
        const currentDriver = effectiveAssignments.get(assignModal.id)
        const rv = normalizeVehicle(assignModal.requiredVehicleType)
        const _candidateBase = availableDrivers.filter(d => !alreadyRoutedIds.has(d.driverId) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO'))
        const _withCluster = _candidateBase.filter(d => d.clusters.some(c => normCluster(c) === normCluster(assignModal.cluster)))
        const candidates = (_withCluster.length > 0 ? _withCluster : _candidateBase)
          .sort((a, b) => {
            if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
            const pa = vehiclePriority(a.vehicleType, assignModal.requiredVehicleType)
            const pb = vehiclePriority(b.vehicleType, assignModal.requiredVehicleType)
            return pa !== pb ? pa - pb : b.priorityScore - a.priorityScore
          })
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8892a4' }}>📍 {assignModal.cluster}</span>
              {assignModal.isInterior && <Chip label="Interior" color="#fbbf24" bg="rgba(245,158,11,.1)" small />}
              {assignModal.requiredVehicleType && <Chip label={assignModal.requiredVehicleType} small />}
              {assignModal.gaiola && <span style={{ fontSize: 12, color: '#64748b' }}>Gaiola {assignModal.gaiola}</span>}
            </div>
            {candidates.length === 0 ? (
              <p style={{ color: '#8892a4', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>Nenhum motorista disponível para este cluster.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {candidates.map(driver => {
                  const dsMeta = getDsMeta(driver.dsReal)
                  const isSelected = currentDriver?.driverId === driver.driverId
                  const clusterCount = (c: string) => availableDrivers.filter(d => !d.isBlocked && d.clusters.some(dc => normCluster(dc) === normCluster(c))).length
                  return (
                    <div key={driver.driverId} style={{ border: `1px solid ${isSelected ? '#7c3aed' : driver.isBlocked ? 'rgba(239,68,68,.25)' : '#2d3048'}`, borderRadius: 8, padding: '10px 14px', background: isSelected ? 'rgba(124,58,237,.05)' : driver.isBlocked ? 'rgba(239,68,68,.04)' : 'rgba(255,255,255,.015)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <span style={{ color: driver.isBlocked ? '#f87171' : '#e2e8f0', fontWeight: 500, fontSize: 13 }}>{driver.name}</span>
                          {isSelected && <Chip label="Selecionado" color="#a78bfa" bg="rgba(139,92,246,.1)" small />}
                          {driver.isNewDriver && <Chip label="Novato" color="#a78bfa" bg="rgba(139,92,246,.1)" small />}
                          {dobraIds.has(driver.driverId) && <Chip label="Dobra" color="#f97316" bg="rgba(249,115,22,.1)" small />}
                          {driver.isBlocked && <Chip label={driver.blockType === 'auto' ? '📦 Redelivery' : driver.blockType === 'registry' ? '⊘ SPX Blocklist' : '⊘ Bloqueado'} color="#f87171" bg="rgba(239,68,68,.12)" small />}
                        </div>
                        <p style={{ margin: '1px 0 4px', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{driver.driverId}</p>
                        {driver.isBlocked && driver.blockReason && (
                          <p style={{ margin: '0 0 4px', fontSize: 10, color: '#f87171', fontStyle: 'italic' }}>{driver.blockReason}</p>
                        )}
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {driver.vehicleType && <Chip label={driver.vehicleType} color="#94a3b8" bg="rgba(100,116,139,.1)" small />}
                          <Chip label={`DS ${dsMeta.label}`} color={dsMeta.color} bg={dsMeta.bg} small />
                          <Chip label={`Score ${driver.priorityScore}`} color="#94a3b8" bg="rgba(100,116,139,.1)" small />
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                          {[...driver.clusters].sort((a, b) => clusterCount(a) - clusterCount(b)).map(c => {
                            const cnt = clusterCount(c)
                            const col = cnt <= 1 ? '#f87171' : cnt === 2 ? '#fbbf24' : '#64748b'
                            return <Chip key={c} label={`${c}(${cnt})`} color={col} bg={`${col}18`} small />
                          })}
                        </div>
                      </div>
                      <Btn onClick={() => handleSelectDriver(assignModal, driver)} variant={isSelected ? 'outline' : 'default'} style={{ flexShrink: 0 }}>
                        {isSelected ? 'Selecionado' : 'Selecionar'}
                      </Btn>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
    </Modal>

    {/* Manual block modal */}
    <Modal open={!!blockModal} onClose={() => setBlockModal(null)} title={`⊘ Bloquear motorista`} maxWidth={400}>
      {blockModal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0' }}>
            <strong>{blockModal.name}</strong>
            <span style={{ fontFamily: 'monospace', color: '#64748b', fontSize: 11, marginLeft: 8 }}>{blockModal.driverId}</span>
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>O motorista ficará bloqueado para receber rotas hoje.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#8892a4' }}>Motivo</label>
            <input
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              placeholder="Ex: no-show, atraso, documento pendente..."
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && blockReason.trim()) {
                  addManualBlock(blockModal.driverId, blockModal.name, blockReason.trim())
                  setBlockModal(null)
                }
              }}
            />
            {/* Quick reasons */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
              {['No-show', 'Atraso', 'Documento pendente', 'Redelivery', 'Ocorrência'].map(r => (
                <button key={r} onClick={() => setBlockReason(r)} style={{ background: blockReason === r ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)', border: `1px solid ${blockReason === r ? '#7c3aed' : '#2d3048'}`, borderRadius: 5, padding: '3px 8px', fontSize: 11, color: blockReason === r ? '#a78bfa' : '#8892a4', cursor: 'pointer' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="outline" onClick={() => setBlockModal(null)}>Cancelar</Btn>
            <Btn variant="danger" disabled={!blockReason.trim()} onClick={() => {
              addManualBlock(blockModal.driverId, blockModal.name, blockReason.trim())
              setBlockModal(null)
            }}>⊘ Bloquear</Btn>
          </div>
        </div>
      )}
    </Modal>

    {/* SPX credentials modal */}
    <Modal open={spxModalOpen} onClose={() => setSpxModalOpen(false)} title="🔑 Credenciais SPX" maxWidth={540}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Abra o painel SPX no navegador, pressione F12 → Network, faça qualquer ação e copie uma requisição como cURL (botão direito → "Copy as cURL"). Cole abaixo.
        </p>
        <textarea
          value={spxCurlInput}
          onChange={e => setSpxCurlInput(e.target.value)}
          placeholder="curl 'https://spx.shopee.com.br/...' -H 'x-csrftoken: ...' -b '...'"
          rows={9}
          style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
        />
        {spxCurlInput && (() => {
          const p = parseCurl(spxCurlInput)
          const hasMin = !!(p['cookie'] && p['x-csrftoken'])
          const hasAll = hasMin && !!(p['x-sap-ri'] && p['x-sap-sec'])
          return (
            <div style={{ background: hasMin ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)', border: `1px solid ${hasMin ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`, borderRadius: 7, padding: '10px 12px', fontSize: 11 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: hasAll ? '#4ade80' : hasMin ? '#fbbf24' : '#f87171' }}>
                {hasAll ? '✓ Todas as credenciais identificadas' : hasMin ? '⚠ Credenciais básicas ok (x-sap-ri/sec não encontrados)' : '✗ Cookie ou csrftoken não encontrados'}
              </p>
              {[
                ['cookie', p['cookie'] ? `${p['cookie'].slice(0, 50)}…` : null],
                ['x-csrftoken', p['x-csrftoken'] ?? null],
                ['device-id', p['device-id'] ?? null],
                ['x-sap-ri', p['x-sap-ri'] ?? null],
                ['x-sap-sec', p['x-sap-sec'] ? `${p['x-sap-sec'].slice(0, 30)}…` : null],
              ].map(([k, v]) => (
                <p key={k} style={{ margin: '2px 0', color: v ? '#94a3b8' : '#64748b' }}>
                  <span style={{ color: '#64748b' }}>{k}:</span> {v ?? <span style={{ color: '#64748b', fontStyle: 'italic' }}>não encontrado</span>}
                </p>
              ))}
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="outline" onClick={() => setSpxModalOpen(false)}>Cancelar</Btn>
          <Btn
            disabled={!spxCurlInput.trim() || !parseCurl(spxCurlInput)['cookie']}
            onClick={() => {
              const creds = parseCurl(spxCurlInput)
              saveSpxCreds(creds)
              setSpxConfigured(true)
              setSpxModalOpen(false)
              setSpxCurlInput('')
            }}
          >Salvar credenciais</Btn>
          {spxConfigured && (
            <Btn variant="danger" onClick={() => {
              localStorage.removeItem(SPX_CREDS_KEY)
              setSpxConfigured(false)
              setSpxModalOpen(false)
            }}>Remover</Btn>
          )}
        </div>
      </div>
    </Modal>

    {/* Assign results modal */}
    <Modal open={!!assignResults} onClose={() => setAssignResults(null)} title="Resultado da atribuição" maxWidth={500}>
      {assignResults && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ border: '1px solid #2d3048', borderRadius: 8, overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
            {assignResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px', borderBottom: '1px solid #1e2130' }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{spxConfigured ? (r.spxOk ? '✅' : '❌') : '✅'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    <span style={{ color: '#8892a4' }}>{r.driverId}</span>
                    <span style={{ color: '#64748b', margin: '0 6px' }}>→</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{r.atId}</span>
                  </div>
                  {spxConfigured && (
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: r.spxOk ? '#4ade80' : '#f87171' }}>
                      SPX: {r.spxMsg}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {spxConfigured && (() => {
            const ok = assignResults.filter(r => r.spxOk).length
            const fail = assignResults.filter(r => r.spxOk === false).length
            return (
              <p style={{ margin: 0, fontSize: 12, color: '#8892a4', textAlign: 'right' }}>
                <span style={{ color: '#4ade80' }}>{ok} enviado{ok !== 1 ? 's' : ''} ao SPX</span>
                {fail > 0 && <span style={{ color: '#f87171' }}> · {fail} falha{fail !== 1 ? 's' : ''}</span>}
              </p>
            )
          })()}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {spxConfigured && assignResults.some(r => r.spxOk === false) && (
              <Btn
                variant="outline"
                disabled={isRetrying}
                onClick={() => void handleRetryFailed()}
                style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,.3)' }}
              >
                {isRetrying ? '⏳ Tentando...' : '↺ Tentar novamente (falhas)'}
              </Btn>
            )}
            <Btn onClick={() => setAssignResults(null)}>Fechar</Btn>
          </div>
        </div>
      )}
    </Modal>

    {/* Bulk block modal */}
    <Modal open={bulkBlockModal} onClose={() => setBulkBlockModal(false)} title="⊘ Bloquear lista de motoristas" maxWidth={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Cole os IDs dos motoristas abaixo (um por linha, ou separados por vírgula/espaço). Todos receberão o mesmo motivo de bloqueio.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#8892a4' }}>IDs dos motoristas</label>
          <textarea
            value={bulkBlockIds}
            onChange={e => setBulkBlockIds(e.target.value)}
            placeholder={'12345678\n87654321\n11223344'}
            rows={8}
            autoFocus
            style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
          />
          {bulkBlockIds.trim() && (() => {
            const count = bulkBlockIds.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean).length
            return <p style={{ margin: 0, fontSize: 11, color: '#60a5fa' }}>{count} ID{count !== 1 ? 's' : ''} detectado{count !== 1 ? 's' : ''}</p>
          })()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#8892a4' }}>Motivo</label>
          <input
            value={bulkBlockReason}
            onChange={e => setBulkBlockReason(e.target.value)}
            placeholder="Ex: no-show, atraso, documento pendente..."
          />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
            {['No-show', 'Atraso', 'Documento pendente', 'Redelivery', 'Ocorrência'].map(r => (
              <button key={r} onClick={() => setBulkBlockReason(r)} style={{ background: bulkBlockReason === r ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)', border: `1px solid ${bulkBlockReason === r ? '#7c3aed' : '#2d3048'}`, borderRadius: 5, padding: '3px 8px', fontSize: 11, color: bulkBlockReason === r ? '#a78bfa' : '#8892a4', cursor: 'pointer' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="outline" onClick={() => setBulkBlockModal(false)}>Cancelar</Btn>
          <Btn variant="danger" disabled={!bulkBlockIds.trim() || !bulkBlockReason.trim()} onClick={() => {
            addBulkBlocks(bulkBlockIds, bulkBlockReason.trim())
            setBulkBlockModal(false)
          }}>⊘ Bloquear todos</Btn>
        </div>
      </div>
    </Modal>

    {/* Add single route modal */}
    <Modal open={addRouteModal} onClose={() => setAddRouteModal(false)} title="＋ Adicionar rota à reatribuição" maxWidth={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Cole um ou vários códigos AT (ex: <code style={{ color: '#a78bfa' }}>AT202609099HRB7</code>) — um por linha ou separados por vírgula/espaço. Cada rota volta para a reatribuição mesmo que não esteja recusada no Call Up. Também aceita a linha inteira da tabela SPX.
        </p>
        <textarea
          value={addRouteText}
          onChange={e => setAddRouteText(e.target.value)}
          placeholder={'AT202609099HRB7\nAT202609099HRB8\nAT202609099HRB9\n\nou cole a linha do SPX:\nRota\tAT / TO\tGaiola\tCluster\t...'}
          rows={8}
          autoFocus
          style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
        />
        {(() => {
          const raw = addRouteText.trim()
          if (!raw) return null

          // Detect AT ID lookup mode: each non-empty line is a bare AT code (no tabs)
          // Lista de ATs: um por linha ou separados por vírgula, ponto e vírgula, espaço ou tab (sem duplicados)
          const lines = [...new Set(raw.split(/[\s,;]+/).map(l => l.trim().toUpperCase()).filter(Boolean))]
          const isAtIdMode = lines.every(l => /^AT\w+$/i.test(l))

          let parsed: LocalRoute[] = []
          let notFound: string[] = []

          if (isAtIdMode) {
            // Look up routes from all loaded shifts in routeStore
            const allStored: LocalRoute[] = []
            for (const { date, shift } of routeStore.list()) {
              for (const r of routeStore.get(date, shift) ?? []) allStored.push(r)
            }
            for (const atId of lines) {
              const found = allStored.find(r => r.atId.toLowerCase() === atId.toLowerCase())
              if (found) parsed.push(found)
              else notFound.push(atId)
            }
          } else {
            parsed = parseRoutesTsv(raw)
          }

          // Rotas ignoradas via ✕ que estão de volta no campo
          const toRestore = parsed.filter(r => ignoredAtIds.has(r.atId))
          // Já existem no turno: voltam para a reatribuição se estiverem fora da lista ou já atribuídas
          const visibleAtIds = new Set(noShowRoutes.map(r => r.atId))
          const existing = parsed.filter(r => routes.some(e => e.atId === r.atId) && !ignoredAtIds.has(r.atId))
          const toForce = existing.filter(r => { const cur = routes.find(e => e.atId === r.atId)!; return !visibleAtIds.has(r.atId) || cur.status === 'ATRIBUIDA' })
          const dupes = existing.filter(r => !toForce.includes(r))
          const toAdd = parsed.filter(r => !routes.some(e => e.atId === r.atId))

          const canConfirm = toAdd.length > 0 || toRestore.length > 0 || toForce.length > 0

          return (
            <>
              {(parsed.length > 0 || notFound.length > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {toAdd.length > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: '#4ade80' }}>
                      ✓ {toAdd.length} rota{toAdd.length !== 1 ? 's' : ''} nova{toAdd.length !== 1 ? 's' : ''}
                      {toAdd.map(r => ` · ${r.atId} (${r.cluster})`).join('')}
                    </p>
                  )}
                  {toRestore.length > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: '#60a5fa' }}>
                      ↩ {toRestore.length} rota{toRestore.length !== 1 ? 's' : ''} oculta{toRestore.length !== 1 ? 's' : ''} — será{toRestore.length !== 1 ? 'ão' : ''} restaurada{toRestore.length !== 1 ? 's' : ''}
                      {toRestore.map(r => ` · ${r.atId}`).join('')}
                    </p>
                  )}
                  {toForce.length > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: '#a78bfa' }}>
                      ↺ {toForce.length} volta{toForce.length !== 1 ? 'm' : ''} para a reatribuição
                      {toForce.map(r => ` · ${r.atId}`).join('')}
                    </p>
                  )}
                  {dupes.length > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: '#fbbf24' }}>
                      {dupes.length} já está{dupes.length !== 1 ? 'ão' : ''} na lista de reatribuição
                    </p>
                  )}
                  {notFound.length > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: '#f87171' }}>
                      ⚠ Não encontrada{notFound.length !== 1 ? 's' : ''} nos dados: {notFound.join(', ')}
                    </p>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn variant="outline" onClick={() => setAddRouteModal(false)}>Cancelar</Btn>
                <Btn
                  disabled={!canConfirm}
                  onClick={() => {
                    if (toRestore.length > 0) {
                      setIgnoredAtIds(s => { const n = new Set(s); toRestore.forEach(r => n.delete(r.atId)); return n })
                    }
                    if (toAdd.length > 0 || toForce.length > 0) {
                      // Rota forçada volta a DISPONIVEL; mantém o motorista original para ele não ser sugerido de novo
                      const forceSet = new Set(toForce.map(r => r.atId))
                      setRoutes([
                        ...routes.map(r => forceSet.has(r.atId) ? { ...r, status: 'DISPONIVEL' as const } : r),
                        ...toAdd.map(r => ({ ...r, status: 'DISPONIVEL' as const })),
                      ])
                      addForcedAtIds([...toAdd, ...toForce].map(r => r.atId))
                    }
                    setAddRouteModal(false)
                    setAddRouteText('')
                  }}
                >
                  {toRestore.length > 0 && toAdd.length === 0 && toForce.length === 0 ? `↩ Restaurar (${toRestore.length})` : `Adicionar ${canConfirm ? toAdd.length + toRestore.length + toForce.length : ''}`}
                </Btn>
              </div>
            </>
          )
        })()}
      </div>
    </Modal>

    {/* Displacement confirm */}
    <Modal open={!!displacementConfirm} onClose={() => setDisplacementConfirm(null)} title="⚠ Rota ficará sem motorista" maxWidth={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          Ao selecionar <strong style={{ color: '#e2e8f0' }}>{displacementConfirm?.driverName}</strong> para <strong style={{ color: '#e2e8f0' }}>{displacementConfirm?.targetAtId}</strong>, a{displacementConfirm && displacementConfirm.displaced.length > 1 ? 's' : ''} rota{displacementConfirm && displacementConfirm.displaced.length > 1 ? 's' : ''} abaixo ficará{displacementConfirm && displacementConfirm.displaced.length > 1 ? 'o' : ''} sem motorista:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {displacementConfirm?.displaced.map(r => (
            <div key={r.id} style={{ border: '1px solid rgba(245,158,11,.2)', background: 'rgba(245,158,11,.05)', borderRadius: 7, padding: '8px 12px' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0' }}>{r.atId}</span>
              <span style={{ margin: '0 6px', color: '#64748b' }}>·</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{r.cluster}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="outline" onClick={() => setDisplacementConfirm(null)}>Cancelar</Btn>
          <Btn variant="danger" onClick={() => {
            if (!displacementConfirm) return
            setOverrides(displacementConfirm.newOverrides)
            setDisplacementConfirm(null)
            setAssignModal(null)
          }}>Confirmar mesmo assim</Btn>
        </div>
      </div>
    </Modal>
    </>
  )
}

const TH: React.CSSProperties = { padding: '7px 12px', textAlign: 'left', fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '7px 12px', verticalAlign: 'middle' }
