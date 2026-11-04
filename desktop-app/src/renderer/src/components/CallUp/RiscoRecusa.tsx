import { useMemo, useState } from 'react'
import type { CallUpAnalysis, FirstCallRoute } from '../../lib/callUpParser'
import { firstCallDay } from '../../lib/callUpParser'
import type { WorkPreferenceData } from '../../lib/workPreferenceParser'
import type { StoredDriver } from '../../lib/localStore'
import type { Shift } from '../../lib/globalConfig'
import { getGlobalConfig, driverMatchesShift } from '../../lib/globalConfig'
import { routeStore } from '../../lib/routeStore'

// Risco de recusa: para os motoristas disponíveis no turno, a chance de recusarem a 1ª chamada.
// Base: histórico de 1ª chamada do próprio motorista no Call Up, dando mais peso às chamadas recentes
// (meia-vida de 14 dias) e "puxando" para a média do turno quem tem pouco histórico.
// p = (recusas ponderadas + K × média do turno) / (chamadas ponderadas + K)

const HALF_LIFE_DAYS = 14
const K = 4 // quanto histórico o motorista precisa para "valer mais" que a média
const C = {
  panel: '#13151f', bg: '#0f1117', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b',
  high: '#f87171', mid: '#fbbf24', low: '#4ade80', blue: '#60a5fa', violet: '#a78bfa',
}
const level = (p: number) => (p >= 0.6 ? 'alta' : p >= 0.3 ? 'media' : 'baixa') as 'alta' | 'media' | 'baixa'
const LEVEL = { alta: { label: 'Alta', color: C.high }, media: { label: 'Média', color: C.mid }, baixa: { label: 'Baixa', color: C.low } }
const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Row {
  driverId: string; name: string; phone: string; vehicle: string; clusters: string[]
  p: number; n: number; nShift: number; declined: number; lastAnswers: ('A' | 'R')[]
  reasons: [string, number][]; confidence: 'baixa' | 'media' | 'alta'; hasRoute: boolean; noShow: number
}

export default function RiscoRecusa({ data, workPref, registry, selectedDay, selectedShift }: {
  data: CallUpAnalysis; workPref?: WorkPreferenceData | null; registry?: StoredDriver[]; selectedDay: string; selectedShift: Shift
}) {
  const [minP, setMinP] = useState(30)
  const [levelSel, setLevelSel] = useState<'' | 'alta' | 'media' | 'baixa'>('')
  const [vehicleSel, setVehicleSel] = useState('')
  const [search, setSearch] = useState('')
  const [includeWithRoute, setIncludeWithRoute] = useState(false)
  const [hideContacted, setHideContacted] = useState(false)
  const [copied, setCopied] = useState('')
  const contactedKey = `spx:callup-contatados:${selectedDay}:${selectedShift}`
  const [contacted, setContacted] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(contactedKey) ?? '[]')) } catch { return new Set() } })
  const toggleContacted = (id: string) => setContacted(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id)
    try { localStorage.setItem(contactedKey, JSON.stringify([...next])) } catch { /* */ }
    return next
  })

  const result = useMemo(() => {
    const today = Date.parse(`${selectedDay}T12:00:00`)
    const weight = (r: FirstCallRoute) => Math.pow(0.5, Math.max(0, (today - Date.parse(`${firstCallDay(r)}T12:00:00`)) / 86400000) / HALF_LIFE_DAYS)
    // Só respostas (aceitou/recusou) e só o que aconteceu até o dia analisado
    const answered = data.firstCallAnalysis.routes.filter(r => (r.status === 'Accepted' || r.status === 'Declined') && firstCallDay(r) <= selectedDay)
    const byDriver = new Map<string, FirstCallRoute[]>()
    for (const r of answered) { if (!byDriver.has(r.driverId)) byDriver.set(r.driverId, []); byDriver.get(r.driverId)!.push(r) }
    const rate = (list: FirstCallRoute[]) => { let w = 0, d = 0; for (const r of list) { const x = weight(r); w += x; if (r.status === 'Declined') d += x } return { w, d } }
    const shiftCalls = answered.filter(r => r.shift === selectedShift)
    const base = rate(shiftCalls.length >= 20 ? shiftCalls : answered)
    const p0 = base.w ? base.d / base.w : 0.3

    // Quem está disponível no turno escolhido
    const cfg = getGlobalConfig()
    const regMap = new Map((registry ?? []).map(d => [d.id, d]))
    const withRoute = new Set<string>(data.acceptedByDateShift[`${selectedDay}|${selectedShift}`] ?? [])
    for (const r of routeStore.get(selectedDay, selectedShift) ?? []) if (r.status === 'ATRIBUIDA' && r.assignedDriverId) withRoute.add(r.assignedDriverId)
    const pool = (workPref?.drivers ?? []).filter(d => {
      const s = d.schedule[selectedDay]
      return !!s && s.status === 'available' && driverMatchesShift(s.slots, selectedShift, cfg)
    })

    const rows: Row[] = pool.map(d => {
      const all = (byDriver.get(d.driverId) ?? []).sort((a, b) => a.triggerTime.localeCompare(b.triggerTime))
      const inShift = all.filter(r => r.shift === selectedShift)
      const use = inShift.length >= 3 ? inShift : all // histórico do turno quando houver o bastante
      const { w, d: dec } = rate(use)
      const p = (dec + K * p0) / (w + K)
      const reasons = new Map<string, number>()
      for (const r of all) if (r.status === 'Declined' && r.declineReason) reasons.set(r.declineReason, (reasons.get(r.declineReason) ?? 0) + 1)
      const reg = regMap.get(d.driverId)
      return {
        driverId: d.driverId, name: d.driverName || reg?.name || d.driverId, phone: (reg?.phoneNumber ?? '').replace(/\D/g, ''),
        vehicle: (reg?.vehicleType || d.vehicleType || '—').toUpperCase(), clusters: d.clusters,
        p, n: all.length, nShift: inShift.length, declined: all.filter(r => r.status === 'Declined').length,
        lastAnswers: all.slice(-5).map(r => (r.status === 'Accepted' ? 'A' : 'R')),
        reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2),
        confidence: (all.length >= 10 ? 'alta' : all.length >= 3 ? 'media' : 'baixa') as Row['confidence'],
        hasRoute: withRoute.has(d.driverId), noShow: d.noShowTime ?? 0,
      }
    }).sort((a, b) => b.p - a.p)
    return { rows, p0, totalAvailable: pool.length }
  }, [data, workPref, registry, selectedDay, selectedShift])

  const vehicles = [...new Set(result.rows.map(r => r.vehicle))].sort()
  const q = norm(search.trim())
  const shown = result.rows.filter(r =>
    (includeWithRoute || !r.hasRoute) &&
    r.p * 100 >= minP &&
    (!levelSel || level(r.p) === levelSel) &&
    (!vehicleSel || r.vehicle === vehicleSel) &&
    (!hideContacted || !contacted.has(r.driverId)) &&
    (!q || r.driverId.includes(q) || norm(r.name).includes(q) || r.clusters.some(c => norm(c).includes(q))))
  const pool = result.rows.filter(r => includeWithRoute || !r.hasRoute)
  const counts = { alta: pool.filter(r => level(r.p) === 'alta').length, media: pool.filter(r => level(r.p) === 'media').length, baixa: pool.filter(r => level(r.p) === 'baixa').length }

  const copy = async (key: string, text: string) => { if (!text) return; await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000) }
  const phones = shown.map(r => r.phone).filter(Boolean)

  if (!workPref) return <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Importe a disponibilidade (Work Preference) para saber quem está disponível no turno.</p>

  const btn: React.CSSProperties = { background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { label: `Disponíveis ${selectedShift}`, value: pool.length, sub: `${result.totalAvailable - pool.length} já com rota${includeWithRoute ? ' (incluídos)' : ' (fora da lista)'}`, c: C.blue, onClick: () => setLevelSel('') },
          { label: 'Risco alto (≥ 60%)', value: counts.alta, sub: 'ligar primeiro', c: C.high, onClick: () => { setLevelSel('alta'); setMinP(0) } },
          { label: 'Risco médio (30–60%)', value: counts.media, sub: 'mandar mensagem', c: C.mid, onClick: () => { setLevelSel('media'); setMinP(0) } },
          { label: 'Risco baixo (< 30%)', value: counts.baixa, sub: 'costumam aceitar', c: C.low, onClick: () => { setLevelSel('baixa'); setMinP(0) } },
          { label: 'Média de recusa do turno', value: `${Math.round(result.p0 * 100)}%`, sub: 'base para quem tem pouco histórico', c: C.violet },
        ].map(k => (
          <div key={k.label} onClick={k.onClick} style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: `3px solid ${k.c}`, borderRadius: 12, padding: '12px 14px', cursor: k.onClick ? 'pointer' : 'default' }}>
            <p style={{ margin: 0, fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
            <p style={{ margin: '6px 0 2px', fontSize: 26, fontWeight: 800, color: C.text, lineHeight: 1 }}>{k.value}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.sub }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Nome, ID ou cluster"
          style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 10px', fontSize: 12, outline: 'none', width: 200 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub }}>
          Chance de recusar ≥ <b style={{ color: C.text, width: 34 }}>{minP}%</b>
          <input type="range" min={0} max={90} step={5} value={minP} onChange={e => setMinP(Number(e.target.value))} style={{ width: 140 }} />
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['', 'alta', 'media', 'baixa'] as const).map(l => (
            <button key={l || 'todas'} onClick={() => setLevelSel(l)}
              style={{ ...btn, padding: '4px 10px', fontSize: 11, color: levelSel === l ? '#fff' : C.sub, background: levelSel === l ? (l ? LEVEL[l].color + '33' : 'rgba(124,58,237,.25)') : 'transparent', borderColor: levelSel === l ? (l ? LEVEL[l].color : '#7c3aed') : C.border }}>
              {l ? LEVEL[l].label : 'Todas'}
            </button>
          ))}
        </div>
        <select value={vehicleSel} onChange={e => setVehicleSel(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '5px 8px', fontSize: 12 }}>
          <option value="">Todos os veículos</option>
          {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeWithRoute} onChange={e => setIncludeWithRoute(e.target.checked)} /> incluir quem já tem rota
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideContacted} onChange={e => setHideContacted(e.target.checked)} /> esconder contatados ({contacted.size})
        </label>
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{shown.length} motorista{shown.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 11, color: C.muted }}>{phones.length} com telefone</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => void copy('tel', phones.join('\n'))} disabled={!phones.length} style={{ ...btn, background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 700 }}>{copied === 'tel' ? '✓ Copiado' : `📱 Copiar telefones (${phones.length})`}</button>
        <button onClick={() => void copy('lista', shown.map(r => `${r.name};${r.driverId};${r.phone};${Math.round(r.p * 100)}%`).join('\n'))} disabled={!shown.length} style={btn}>{copied === 'lista' ? '✓ Copiado' : '📋 Copiar lista (nome;ID;telefone;%)'}</button>
        <button onClick={() => void copy('ids', shown.map(r => r.driverId).join('\n'))} disabled={!shown.length} style={btn}>{copied === 'ids' ? '✓ Copiado' : '🆔 IDs'}</button>
      </div>

      {/* Lista */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['', 'Motorista', 'Chance de recusar', 'Histórico', 'Últimas 5', 'Motivos mais comuns', 'Telefone', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', background: C.bg }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Ninguém com esses filtros.</td></tr>}
            {shown.map(r => {
              const lv = LEVEL[level(r.p)]
              const done = contacted.has(r.driverId)
              return (
                <tr key={r.driverId} style={{ borderBottom: `1px solid ${C.line}`, opacity: done ? 0.55 : 1 }}>
                  <td style={{ padding: '7px 10px' }}>
                    <input type="checkbox" checked={done} onChange={() => toggleContacted(r.driverId)} title="Marcar como contatado" />
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ color: C.text, fontWeight: 600 }}>{r.name}</span>
                    {r.hasRoute && <span style={{ marginLeft: 6, fontSize: 9, color: C.low, border: `1px solid ${C.low}55`, borderRadius: 3, padding: '0 4px' }}>JÁ TEM ROTA</span>}
                    <span style={{ display: 'block', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.driverId} · {r.vehicle}{r.clusters.length ? ` · ${r.clusters.slice(0, 2).join(', ')}` : ''}</span>
                  </td>
                  <td style={{ padding: '7px 10px', minWidth: 170 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: C.bg, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(r.p * 100)}%`, height: '100%', background: lv.color, borderRadius: 4 }} />
                      </div>
                      <span style={{ width: 40, textAlign: 'right', fontSize: 14, fontWeight: 800, color: lv.color }}>{Math.round(r.p * 100)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', color: C.sub, whiteSpace: 'nowrap' }}>
                    {r.n ? `${r.declined} recusas em ${r.n}` : 'sem histórico'}
                    <span style={{ display: 'block', fontSize: 10, color: r.confidence === 'baixa' ? C.mid : C.muted }}>confiança {r.confidence}{r.nShift ? ` · ${r.nShift} no ${selectedShift}` : ''}{r.noShow ? ` · ${r.noShow} no-show` : ''}</span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {r.lastAnswers.length === 0 ? <span style={{ color: C.muted }}>—</span> : r.lastAnswers.map((a, i) => (
                        <span key={i} title={a === 'A' ? 'aceitou' : 'recusou'} style={{ width: 16, height: 16, borderRadius: 3, fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#0f1117', background: a === 'A' ? C.low : C.high }}>{a}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', color: C.sub, fontSize: 11, maxWidth: 220 }}>{r.reasons.length ? r.reasons.map(([m, n]) => `${m} (${n})`).join(' · ') : '—'}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: r.phone ? C.text : C.muted }}>{r.phone || 'sem telefone'}</td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                    {r.phone && <>
                      <button onClick={() => void copy(`p${r.driverId}`, r.phone)} style={{ ...btn, padding: '2px 7px', fontSize: 11 }}>{copied === `p${r.driverId}` ? '✓' : '📋'}</button>{' '}
                      <a href={`https://wa.me/55${r.phone}`} target="_blank" rel="noreferrer" style={{ ...btn, padding: '2px 7px', fontSize: 11, color: C.low, textDecoration: 'none', display: 'inline-block' }}>WhatsApp</a>
                    </>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>
        Como é calculado: recusas do motorista na 1ª chamada, com mais peso para as recentes (cada 14 dias vale metade), usando o histórico do próprio turno quando há 3+ chamadas nele.
        Quem tem pouco histórico fica perto da média do turno ({Math.round(result.p0 * 100)}%). “Sem resposta” e canceladas não contam.
      </p>
    </div>
  )
}
