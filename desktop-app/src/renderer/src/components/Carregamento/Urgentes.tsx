import { useEffect, useMemo, useState } from 'react'
import type { Shift } from '../../lib/globalConfig'
import { routeStore } from '../../lib/routeStore'
import { getCtPackages, getEhaCache } from '../../lib/planilhas'
import { dockKey, SITUATION_LABEL } from '../../lib/spxQueueFetcher'
import { minToHHMM, windowForLetterMulti, extractLetter, type QueueEntry, type LoadWindowConfig } from '../../lib/queueListParser'

// Pacotes que precisam sair hoje: os que já voltaram por EHA (não couberam) + os marcados à mão.
// A rota que leva algum deles fica destacada no carregamento.

export interface UrgentInfo { tns: { tn: string; why: string; high: boolean }[]; high: boolean }

const manualKey = (d: string, s: Shift) => `spx:urgentes:${d}:${s}`

export function useUrgentes(day: string, shift: Shift) {
  const [manual, setManualState] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(manualKey(day, shift)) ?? '[]') } catch { return [] } })
  const [includeEha, setIncludeEha] = useState(() => { try { return localStorage.getItem('ui:urgentes-eha') !== '0' } catch { return true } })
  useEffect(() => { try { setManualState(JSON.parse(localStorage.getItem(manualKey(day, shift)) ?? '[]')) } catch { setManualState([]) } }, [day, shift])
  const setManual = (list: string[]) => { setManualState(list); try { localStorage.setItem(manualKey(day, shift), JSON.stringify(list)) } catch { /* */ } }
  const toggleEha = () => setIncludeEha(v => { try { localStorage.setItem('ui:urgentes-eha', v ? '0' : '1') } catch { /* */ } return !v })

  const byAt = useMemo(() => {
    const m = new Map<string, UrgentInfo>()
    const pk = getCtPackages(day, shift)
    const tnToAt = new Map(pk.map(p => [p.tn.toUpperCase(), p.at]))
    const add = (at: string, tn: string, why: string, high: boolean) => {
      const c = m.get(at) ?? { tns: [], high: false }
      if (!c.tns.some(x => x.tn === tn)) c.tns.push({ tn, why, high })
      c.high = c.high || high
      m.set(at, c)
    }
    if (includeEha) for (const e of getEhaCache()?.rows ?? []) {
      const at = tnToAt.get(e.tn.toUpperCase())
      if (at) add(at, e.tn, `${e.count} EHA`, /verm/i.test(e.risco) || e.count >= 2)
    }
    for (const raw of manual) {
      const tn = raw.toUpperCase()
      const at = tnToAt.get(tn) ?? (tn.startsWith('AT') ? tn : undefined)
      if (at) add(at, tn, 'marcado como urgente', true)
    }
    return m
  }, [day, shift, manual, includeEha])

  const unmatched = useMemo(() => {
    const tns = new Set(getCtPackages(day, shift).map(p => p.tn.toUpperCase()))
    return manual.filter(t => !t.toUpperCase().startsWith('AT') && !tns.has(t.toUpperCase()))
  }, [day, shift, manual])

  return { byAt, manual, setManual, includeEha, toggleEha, unmatched }
}

export function UrgentBadge({ info }: { info?: UrgentInfo }) {
  if (!info) return null
  const c = info.high ? '#f87171' : '#fbbf24'
  return (
    <span title={info.tns.map(t => `${t.tn} · ${t.why}`).join('\n')}
      style={{ background: `${c}22`, color: c, border: `1px solid ${c}66`, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
      🚨 {info.tns.length} urgente{info.tns.length > 1 ? 's' : ''}
    </span>
  )
}

type Stage = { order: number; label: string; color: string }

export function UrgentPanel({ day, shift, entries, windows, nowMin, state }: {
  day: string; shift: Shift; entries: QueueEntry[]; windows: LoadWindowConfig[]; nowMin: number
  state: ReturnType<typeof useUrgentes>
}) {
  const { byAt, manual, setManual, includeEha, toggleEha, unmatched } = state
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const routes = useMemo(() => new Map((routeStore.get(day, shift) ?? []).map(r => [r.atId, r])), [day, shift])
  const byQueueAt = useMemo(() => new Map(entries.filter(e => e.atId).map(e => [e.atId, e])), [entries])
  const waitingOrder = useMemo(() => entries.filter(e => e.situation === 'waiting').sort((a, b) => (a.queueSequence ?? 999) - (b.queueSequence ?? 999) || (a.arrivalMin ?? 0) - (b.arrivalMin ?? 0)).map(e => e.atId), [entries])

  const items = [...byAt.entries()].map(([at, info]) => {
    const r = routes.get(at)
    const e = byQueueAt.get(at)
    const gaiola = r?.gaiola ?? e?.cage ?? ''
    const w = windowForLetterMulti(extractLetter(gaiola), windows)
    let st: Stage
    if (!e) st = { order: 1, label: w && nowMin >= w.arriveByMin ? '🔴 Não chegou (atrasado)' : '⏳ Ainda não chegou', color: w && nowMin >= w.arriveByMin ? '#f87171' : '#94a3b8' }
    else if (e.situation === 'at-dock') st = { order: 0, label: `🟢 NA MESA AGORA · ${dockKey(e.dock ?? '')}`, color: '#4ade80' }
    else if (e.situation === 'calling') st = { order: 0, label: `📣 Chamado para ${dockKey(e.dock ?? '')}`, color: '#fbbf24' }
    else if (e.situation === 'done') st = { order: 4, label: '✓ Saiu (carregada)', color: '#64748b' }
    else if (e.situation === 'waiting') { const pos = waitingOrder.indexOf(at) + 1; st = { order: 2, label: `Na fila${pos ? ` · ${pos}º` : ''}`, color: '#60a5fa' } }
    else st = { order: 3, label: e.situation ? SITUATION_LABEL[e.situation] : 'Na fila', color: '#a78bfa' }
    return { at, info, r, e, gaiola, w, st }
  }).sort((a, b) => a.st.order - b.st.order || Number(b.info.high) - Number(a.info.high) || (a.w?.startMin ?? 9999) - (b.w?.startMin ?? 9999))

  const pending = items.filter(i => i.st.order < 4).length
  const btn: React.CSSProperties = { background: 'transparent', border: '1px solid #2d3048', color: '#94a3b8', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer' }

  return (
    <div style={{ margin: '12px 20px 0', background: 'rgba(248,113,113,.05)', border: '1px solid rgba(248,113,113,.35)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setCollapsed(c => !c)} style={{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: 13, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
          {collapsed ? '▸' : '▾'} 🚨 Rotas com pacote urgente ({pending} a carregar{items.length - pending ? ` · ${items.length - pending} já saíram` : ''})
        </button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeEha} onChange={toggleEha} /> pacotes com EHA
        </label>
        <button onClick={() => { setText(manual.join('\n')); setEditing(v => !v) }} style={btn}>✎ Marcar urgentes ({manual.length})</button>
      </div>

      {editing && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={'Cole os BRs (ou ATs) que precisam sair hoje, um por linha'}
            style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: 8, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => { setManual([...new Set(text.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean))]); setEditing(false) }} style={{ ...btn, background: '#7c3aed', border: 'none', color: '#fff', fontWeight: 700 }}>Salvar</button>
            <button onClick={() => setEditing(false)} style={btn}>Cancelar</button>
            {unmatched.length > 0 && <span style={{ fontSize: 11, color: '#fbbf24' }}>{unmatched.length} BR não encontrado(s) na roteirização deste turno</span>}
          </div>
        </div>
      )}

      {!collapsed && (items.length === 0 ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>Nenhuma rota com pacote urgente neste turno{includeEha ? ' (EHA vem da tela ♻ EHA e precisa da roteirização buscada pelo link)' : ''}.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8, marginTop: 8 }}>
          {items.map(i => (
            <div key={i.at} style={{ background: '#13151f', border: `1px solid ${i.st.order === 0 ? i.st.color : '#2d3048'}`, borderLeft: `4px solid ${i.info.high ? '#f87171' : '#fbbf24'}`, borderRadius: 8, padding: '7px 10px', opacity: i.st.order === 4 ? .55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: '#e2e8f0' }}>{i.gaiola || '—'}</span>
                <UrgentBadge info={i.info} />
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700, color: i.st.color }}>{i.st.label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {i.e?.driverName || i.r?.assignedDriverName || 'sem motorista'}{i.w ? ` · janela ${minToHHMM(i.w.startMin)}` : ''}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }} title={i.info.tns.map(t => `${t.tn} · ${t.why}`).join('\n')}>
                {i.at} · {i.info.tns.slice(0, 2).map(t => t.tn).join(', ')}{i.info.tns.length > 2 ? ` +${i.info.tns.length - 2}` : ''}
              </p>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
