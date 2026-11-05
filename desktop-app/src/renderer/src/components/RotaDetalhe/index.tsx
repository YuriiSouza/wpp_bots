import { useEffect, useMemo, useState } from 'react'
import type { StoredDriver } from '../../lib/localStore'
import type { Shift } from '../../lib/globalConfig'
import type { LocalRoute } from '../../lib/noshowRouteParser'
import { routeStore } from '../../lib/routeStore'
import { getCtPackages, getEhaCache, type CtPackage, type EhaRow } from '../../lib/planilhas'

const C = { bg: '#0f1117', card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', red: '#f87171', amber: '#fbbf24', green: '#4ade80', blue: '#60a5fa', violet: '#a78bfa' }
const VEHICLE_COLOR: Record<string, string> = { FIORINO: C.amber, MOTO: '#f472b6', PASSEIO: C.blue, VAN: C.violet }

const vehicleOf = (v?: string | null) => {
  const s = (v ?? '').toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio') || s.includes('carro')) return 'PASSEIO'
  return s ? s.toUpperCase() : null
}
function compareGaiola(a: string | null, b: string | null): number {
  const p = (v: string | null) => { const m = v?.match(/^([A-Za-z]+)-?(\d+)$/); return m ? { l: m[1].toUpperCase(), n: +m[2] } : null }
  const pa = p(a), pb = p(b)
  if (!pa && !pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa.l !== pb.l ? pa.l.localeCompare(pb.l) : pa.n - pb.n
}
const fmt = (n: number, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const dur = (s: number | null) => (s == null ? '—' : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`)
const RISK_COLOR = (r: EhaRow) => (/verm/i.test(r.risco) || r.count >= 2 ? C.red : C.amber)

function Card({ label, value, sub, color = C.text }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 12px', minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 800, color }}>{value}</p>
      {sub && <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{sub}</p>}
    </div>
  )
}
function Panel({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}
function Bars({ items, color = C.blue }: { items: [string, number][]; color?: string }) {
  const max = Math.max(1, ...items.map(i => i[1]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 140px) 1fr 34px', gap: 8, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k || '—'}</span>
          <div style={{ height: 8, background: C.line, borderRadius: 4 }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} /></div>
          <span style={{ color: C.text, textAlign: 'right', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}
const countBy = <T,>(list: T[], key: (x: T) => string) => {
  const m = new Map<string, number>()
  for (const x of list) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

/** Mapa (OpenStreetMap) com as paradas na ordem de entrega. */
const TILE = 256
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z
const lat2y = (lat: number, z: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z }

function StopMap({ pk, eha }: { pk: CtPackage[]; eha: Map<string, EhaRow> }) {
  const stops = useMemo(() => {
    const m = new Map<number, { lat: number; lon: number; n: number; eha: boolean; seq: number; addr: string }>()
    for (const p of pk) {
      if (p.lat == null || p.lon == null || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue
      const k = p.stop ?? p.seq ?? 0
      const cur = m.get(k)
      if (cur) { cur.n++; cur.eha = cur.eha || eha.has(p.tn) } else m.set(k, { lat: p.lat, lon: p.lon, n: 1, eha: eha.has(p.tn), seq: k, addr: `${p.address} — ${p.neighborhood}` })
    }
    return [...m.values()].sort((a, b) => a.seq - b.seq)
  }, [pk, eha])
  const [extraZoom, setExtraZoom] = useState(0)
  if (stops.length < 1) return <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Sem coordenadas.</p>
  const W = 640, H = 380, pad = 30
  const lats = stops.map(s => s.lat), lons = stops.map(s => s.lon)
  const [minLa, maxLa, minLo, maxLo] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
  let z = 17
  while (z > 3 && (lon2x(maxLo, z) - lon2x(minLo, z) > W - 2 * pad || lat2y(minLa, z) - lat2y(maxLa, z) > H - 2 * pad)) z--
  z = Math.max(3, Math.min(18, z + extraZoom))
  const cx = (lon2x(minLo, z) + lon2x(maxLo, z)) / 2, cy = (lat2y(minLa, z) + lat2y(maxLa, z)) / 2
  const ox = cx - W / 2, oy = cy - H / 2
  const tiles: { x: number; y: number }[] = []
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++)
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) tiles.push({ x: tx, y: ty })
  const px = (s: { lat: number; lon: number }) => ({ x: lon2x(s.lon, z) - ox, y: lat2y(s.lat, z) - oy })
  const btn: React.CSSProperties = { width: 26, height: 26, background: '#fff', border: '1px solid #999', borderRadius: 4, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: '#333', lineHeight: 1 }
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${W} / ${H}`, overflow: 'hidden', borderRadius: 8, background: '#dfe6ea' }}>
      <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {tiles.map(t => {
            const n = 2 ** z
            const wx = ((t.x % n) + n) % n
            if (t.y < 0 || t.y >= n) return null
            return <image key={`${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${z}/${wx}/${t.y}.png`} x={t.x * TILE - ox} y={t.y * TILE - oy} width={TILE} height={TILE} />
          })}
          <polyline points={stops.map(s => { const p = px(s); return `${p.x},${p.y}` }).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeOpacity={0.75} strokeLinejoin="round" />
          {stops.map((s, i) => {
            const p = px(s)
            const fill = s.eha ? '#dc2626' : i === 0 ? '#16a34a' : '#1d4ed8'
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={8} fill={fill} stroke="#fff" strokeWidth={1.5}>
                  <title>{`Parada ${s.seq} · ${s.n} pacote(s)${s.eha ? ' · tem pacote com EHA' : ''}\n${s.addr}`}</title>
                </circle>
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>{s.seq}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button style={btn} onClick={() => setExtraZoom(v => Math.min(v + 1, 4))}>+</button>
        <button style={btn} onClick={() => setExtraZoom(v => Math.max(v - 1, -4))}>−</button>
      </div>
      <span style={{ position: 'absolute', bottom: 2, right: 6, fontSize: 9, color: '#333', background: 'rgba(255,255,255,.7)', padding: '0 4px' }}>© OpenStreetMap</span>
    </div>
  )
}

export default function RotaDetalhe({ registry, selectedDay, selectedShift, focusAt, onBack }: { registry: StoredDriver[]; selectedDay: string; selectedShift: Shift; focusAt?: string; onBack?: () => void }) {
  const routes = useMemo(() => [...(routeStore.get(selectedDay, selectedShift) ?? [])].sort((a, b) => compareGaiola(a.gaiola, b.gaiola)), [selectedDay, selectedShift])
  const packages = useMemo(() => getCtPackages(selectedDay, selectedShift), [selectedDay, selectedShift])
  const ehaMap = useMemo(() => new Map((getEhaCache()?.rows ?? []).map(r => [r.tn, r])), [])
  const byAt = useMemo(() => {
    const m = new Map<string, CtPackage[]>()
    for (const p of packages) { if (!m.has(p.at)) m.set(p.at, []); m.get(p.at)!.push(p) }
    for (const l of m.values()) l.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    return m
  }, [packages])
  const regMap = useMemo(() => new Map(registry.map(d => [d.id, d])), [registry])

  const [sel, setSel] = useState<string>(focusAt || routes[0]?.atId || '')
  useEffect(() => { if (focusAt) setSel(focusAt) }, [focusAt])
  useEffect(() => { if (!routes.some(r => r.atId === sel)) setSel(routes[0]?.atId ?? '') }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [pkQ, setPkQ] = useState('')
  const [copied, setCopied] = useState('')
  const copy = async (k: string, t: string) => { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1800) }

  const list = routes.filter(r => {
    const s = q.trim().toLowerCase()
    return !s || r.atId.toLowerCase().includes(s) || (r.gaiola ?? '').toLowerCase().startsWith(s) || r.cluster.toLowerCase().includes(s) || (r.assignedDriverName ?? '').toLowerCase().includes(s)
  })
  const route: LocalRoute | undefined = routes.find(r => r.atId === sel)
  const pk = byAt.get(sel) ?? []

  if (!routes.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
      <p style={{ color: C.sub, fontSize: 14, margin: 0 }}>Nenhuma rota carregada para {selectedShift} · {selectedDay}</p>
      <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>Carregue a roteirização pelo link da planilha na tela de Atribuição.</p>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Lista de rotas */}
      <div style={{ width: 270, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: `1px solid ${C.line}` }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Gaiola, AT, cluster, motorista" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
          <p style={{ margin: '6px 0 0', fontSize: 10, color: packages.length ? C.muted : C.amber }}>
            {list.length} rotas · {packages.length ? `${fmt(packages.length)} pacotes (CTs)` : 'sem dados de pacotes — busque a roteirização pelo link'}
          </p>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {list.map(r => {
            const n = byAt.get(r.atId)?.length ?? 0
            const e = (byAt.get(r.atId) ?? []).filter(p => ehaMap.has(p.tn)).length
            const active = r.atId === sel
            const v = vehicleOf(r.scheduledVehicle)
            return (
              <button key={r.atId} onClick={() => setSel(r.atId)} style={{ display: 'block', width: '100%', textAlign: 'left', background: active ? 'rgba(59,130,246,.12)' : 'transparent', border: 'none', borderLeft: `3px solid ${active ? C.blue : 'transparent'}`, borderBottom: `1px solid ${C.line}`, padding: '7px 10px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{r.gaiola ?? '—'}</span>
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {e > 0 && <span title="pacotes com EHA" style={{ fontSize: 10, fontWeight: 700, color: C.red, background: 'rgba(248,113,113,.12)', borderRadius: 4, padding: '0 5px' }}>EHA {e}</span>}
                    {v && <span style={{ fontSize: 9, fontWeight: 700, color: VEHICLE_COLOR[v] ?? C.sub }}>{v}</span>}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.atId}</div>
                <div style={{ fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cluster} · {n || r.spr || '—'} pct · {r.volume ?? '—'} L</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detalhe */}
      {route ? (() => {
        const drv = route.assignedDriverId ? regMap.get(route.assignedDriverId) : undefined
        const phone = (drv?.phoneNumber ?? '').replace(/\D/g, '')
        const v = vehicleOf(route.scheduledVehicle)
        const dv = vehicleOf(drv?.vehicleType)
        const volL = pk.reduce((s, p) => s + (p.volumeCm3 ?? 0), 0) / 1000
        const kg = pk.reduce((s, p) => s + (p.weightG ?? 0), 0) / 1000
        const stops = new Set(pk.map(p => p.stop ?? p.seq)).size
        const durSec = pk.find(p => p.durationSec != null)?.durationSec ?? null
        const ehaPk = pk.filter(p => ehaMap.has(p.tn))
        const big = [...pk].sort((a, b) => (b.volumeCm3 ?? 0) - (a.volumeCm3 ?? 0)).slice(0, 5)
        const cats = countBy(pk, p => p.category || '—')
        const catOrder = ['PP', 'P', 'S', 'M', 'G', 'L', 'GG', 'XL']
        const ord = (k: string) => { const i = catOrder.indexOf(k.toUpperCase()); return i < 0 ? 99 : i }
        cats.sort((a, b) => ord(a[0]) - ord(b[0]))
        const s = pkQ.trim().toLowerCase()
        const pkShown = pk.filter(p => !s || p.tn.toLowerCase().includes(s) || p.neighborhood.toLowerCase().includes(s) || p.address.toLowerCase().includes(s) || p.zip.includes(s))
        return (
          <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {onBack && (
              <button onClick={onBack} style={{ alignSelf: 'flex-start', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>← Voltar para a Visão Geral</button>
            )}
            {/* Cabeçalho */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: C.text }}>{route.gaiola ?? '—'}</span>
                  <button onClick={() => void copy('at', route.atId)} title="Copiar AT" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, color: C.sub }}>{route.atId} {copied === 'at' ? '✓' : '📋'}</button>
                  {v && <span style={{ fontSize: 11, fontWeight: 700, color: VEHICLE_COLOR[v] ?? C.sub, border: `1px solid ${(VEHICLE_COLOR[v] ?? C.sub)}55`, borderRadius: 5, padding: '1px 7px' }}>{v}</span>}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: C.sub }}>{route.cluster || '—'} · {route.cidade ?? '—'}{route.ciclo ? ` · ciclo ${route.ciclo}` : ''}{pk[0]?.rota ? ` · ${pk[0].rota}` : ''}</p>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', minWidth: 240 }}>
                {route.status === 'ATRIBUIDA' ? (
                  <>
                    <p style={{ margin: 0, fontSize: 10, color: C.green, fontWeight: 700 }}>ATRIBUÍDA</p>
                    <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 700, color: C.text }}>{route.assignedDriverName ?? '—'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
                      {route.assignedDriverId ?? ''}{dv ? ` · ${dv}` : ''}{dv && v && dv !== v ? ' ⚠ veículo diferente do programado' : ''}
                    </p>
                    {phone && <p style={{ margin: '3px 0 0', fontSize: 11 }}><span style={{ fontFamily: 'monospace', color: C.sub }}>{phone}</span> · <a href={`https://wa.me/55${phone}`} target="_blank" rel="noreferrer" style={{ color: C.green, textDecoration: 'none' }}>WhatsApp</a></p>}
                  </>
                ) : <p style={{ margin: 0, fontSize: 12, color: C.blue, fontWeight: 700 }}>DISPONÍVEL — sem motorista</p>}
              </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <Card label="Paradas" value={route.paradas ?? (stops || '—')} />
              <Card label="Pacotes" value={pk.length || route.spr || '—'} sub={route.paradas && (pk.length || route.spr) ? `${fmt((pk.length || route.spr || 0) / route.paradas, 1)} por parada` : undefined} />
              <Card label="Volume" value={`${route.volume ?? (volL ? fmt(volL) : '—')} L`} sub={pk.length ? `soma dos pacotes: ${fmt(volL, 1)} L` : undefined} color={(route.volume ?? 0) > 700 ? C.amber : C.text} />
              <Card label="Peso" value={pk.length ? `${fmt(kg, 1)} kg` : '—'} />
              <Card label="GG" value={route.gg ?? '—'} color={(route.gg ?? 0) > 1 ? C.amber : C.text} />
              <Card label="KM" value={route.km != null ? fmt(route.km, 1) : '—'} />
              <Card label="Duração prevista" value={dur(durSec)} />
              <Card label="Pacotes com EHA" value={ehaPk.length} color={ehaPk.length ? C.red : C.green} sub={ehaPk.length ? 'já voltaram por não caber' : undefined} />
            </div>

            {!pk.length ? (
              <p style={{ margin: 0, fontSize: 12, color: C.amber }}>Sem dados de pacotes desta rota. Busque a roteirização pelo link da planilha (guia Calculation Tasks) na tela de Atribuição.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.3fr) minmax(260px, 1fr)', gap: 12 }}>
                  <Panel title="Mapa das paradas" sub="Número = ordem de entrega · verde = 1ª parada · vermelho = parada com pacote que já teve EHA">
                    <StopMap pk={pk} eha={ehaMap} />
                  </Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Panel title="Tamanho dos pacotes"><Bars items={cats} color={C.violet} /></Panel>
                    <Panel title="Bairros"><Bars items={countBy(pk, p => p.neighborhood).slice(0, 6)} /></Panel>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  <Panel title="Tipo de endereço"><Bars items={countBy(pk, p => p.addressType)} color={C.green} /></Panel>
                  <Panel title="Cabeças de CEP"><Bars items={countBy(pk, p => p.cepHead || p.zip.slice(0, 5)).slice(0, 6)} color={C.amber} /></Panel>
                  <Panel title="Maiores pacotes">
                    {big.map(p => (
                      <div key={p.tn} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', color: ehaMap.has(p.tn) ? C.red : C.sub }}>{p.tn}</span>
                        <span style={{ color: C.text }}>{fmt((p.volumeCm3 ?? 0) / 1000, 1)} L · {fmt((p.weightG ?? 0) / 1000, 1)} kg</span>
                      </div>
                    ))}
                  </Panel>
                </div>

                {ehaPk.length > 0 && (
                  <Panel title={`Pacotes que já tiveram EHA (${ehaPk.length})`} sub="Saíram em dias/turnos anteriores e voltaram por não caber no veículo — confira se cabem antes de liberar">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ehaPk.map(p => { const e = ehaMap.get(p.tn)!; return (
                        <span key={p.tn} style={{ fontSize: 11, fontFamily: 'monospace', color: RISK_COLOR(e), border: `1px solid ${RISK_COLOR(e)}55`, borderRadius: 5, padding: '2px 7px' }}>{p.tn} · {e.count} EHA · parada {p.stop ?? '—'}</span>
                      ) })}
                    </div>
                    <button onClick={() => void copy('eha', ehaPk.map(p => p.tn).join('\n'))} style={{ alignSelf: 'flex-start', background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>{copied === 'eha' ? '✓ Copiado' : '📋 Copiar BRs'}</button>
                  </Panel>
                )}

                <Panel title={`Pacotes da rota (${pk.length})`}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input value={pkQ} onChange={e => setPkQ(e.target.value)} placeholder="🔍 BR, bairro, endereço, CEP" style={{ width: 260, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
                    <button onClick={() => void copy('tns', pkShown.map(p => p.tn).join('\n'))} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>{copied === 'tns' ? '✓ Copiado' : `📋 Copiar BRs (${pkShown.length})`}</button>
                  </div>
                  <div style={{ maxHeight: 420, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead><tr>{['Parada', 'BR', 'Endereço', 'Bairro', 'Tam.', 'Vol (L)', 'Peso (kg)', 'EHA'].map(h => <th key={h} style={{ position: 'sticky', top: 0, background: C.card, textAlign: 'left', padding: '5px 6px', color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {pkShown.map(p => { const e = ehaMap.get(p.tn); return (
                          <tr key={p.tn} style={{ borderTop: `1px solid ${C.line}`, background: e ? 'rgba(248,113,113,.05)' : undefined }}>
                            <td style={{ padding: '4px 6px', color: C.sub }}>{p.stop ?? '—'}</td>
                            <td style={{ padding: '4px 6px', fontFamily: 'monospace', color: C.text }}>{p.tn}</td>
                            <td style={{ padding: '4px 6px', color: C.sub, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.address}>{p.address}</td>
                            <td style={{ padding: '4px 6px', color: C.sub }}>{p.neighborhood}</td>
                            <td style={{ padding: '4px 6px', color: C.text }}>{p.category}</td>
                            <td style={{ padding: '4px 6px', color: C.text, textAlign: 'right' }}>{p.volumeCm3 != null ? fmt(p.volumeCm3 / 1000, 1) : '—'}</td>
                            <td style={{ padding: '4px 6px', color: C.text, textAlign: 'right' }}>{p.weightG != null ? fmt(p.weightG / 1000, 2) : '—'}</td>
                            <td style={{ padding: '4px 6px', color: e ? RISK_COLOR(e) : C.muted, fontWeight: e ? 700 : 400 }}>{e ? `${e.count}×` : '—'}</td>
                          </tr>
                        ) })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}
          </div>
        )
      })() : <div style={{ flex: 1 }} />}
    </div>
  )
}
