import { useMemo, useState, useEffect, useRef } from 'react'
import type { Shift } from '../../lib/globalConfig'
import type { StoredDriver } from '../../lib/localStore'
import { routeStore } from '../../lib/routeStore'
import { queueStore } from '../../lib/queueStore'
import CarregamentoDashboard from './Dashboard'
import { fetchSpxQueue, dockKey, SITUATION_LABEL, type QueueSituation } from '../../lib/spxQueueFetcher'
import { computeLoadWindowMulti, windowForLetterMulti, extractLetter, minToHHMM, type QueueEntry, type LoadWindowConfig } from '../../lib/queueListParser'

interface Props {
  registry: StoredDriver[]
  selectedDay: string
  selectedShift: Shift
}

const DEFAULT_WINDOWS: Record<Shift, LoadWindowConfig[]> = {
  AM: [{ startCage: 'A', startTime: '05:30' }],
  PM1: [{ startCage: 'A', startTime: '' }],
  PM2: [{ startCage: 'A', startTime: '' }],
}

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ background: bg, color, border: `1px solid ${color}33`, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
}

function Btn({ onClick, children, disabled, color = '#7c3aed', outline }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; color?: string; outline?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ border: outline ? `1px solid ${color}55` : 'none', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1, background: outline ? 'transparent' : color, color: outline ? color : '#fff' }}>
      {children}
    </button>
  )
}

const TH = { padding: '7px 10px', textAlign: 'left' as const, fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const }
const TD = { padding: '6px 10px', fontSize: 12, color: '#e2e8f0' }

type NotArrivedStatus = 'waiting' | 'overdue' | 'unknown-letter'
interface NotArrived {
  driverId: string; name: string; atId: string; cluster: string; gaiola: string
  letter: string; arriveByMin: number | null; status: NotArrivedStatus
}

export default function Carregamento({ registry, selectedDay, selectedShift }: Props) {
  const [queue, setQueue] = useState<{ entries: QueueEntry[]; fileName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const windowsKey = `spx:load-windows:${selectedShift}`
  const [windows, setWindowsState] = useState<LoadWindowConfig[]>(DEFAULT_WINDOWS[selectedShift])

  // Relógio real (atualiza a cada 30s) para separar "aguardando" de "atrasado"
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }, 30000)
    return () => clearInterval(t)
  }, [])

  const saveWindows = (w: LoadWindowConfig[]) => {
    setWindowsState(w)
    try { localStorage.setItem(windowsKey, JSON.stringify(w)) } catch { /* */ }
  }

  useEffect(() => {
    const saved = queueStore.get(selectedDay, selectedShift)
    setQueue(saved ? { entries: saved.entries, fileName: saved.fileName } : null)
    setError(null)
    try {
      const raw = localStorage.getItem(windowsKey)
      setWindowsState(raw ? JSON.parse(raw) as LoadWindowConfig[] : DEFAULT_WINDOWS[selectedShift])
    } catch { setWindowsState(DEFAULT_WINDOWS[selectedShift]) }
  }, [selectedDay, selectedShift, windowsKey])

  // Recalcula os "esperados" quando a janela recebe foco (ex.: voltou da tela de Atribuição após mudar rotas)
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    const onFocus = () => setRefreshTick(t => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const hasValidWindows = windows.some(w => w.startCage && w.startTime)

  const phoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of registry) m.set(d.id, (d.phoneNumber ?? '').replace(/\D/g, ''))
    return m
  }, [registry])

  // Atualiza a fila direto da API do SPX (mesma sessão usada em Atribuição)
  const [loading, setLoading] = useState(false)
  const refreshFromSpx = async () => {
    if (loading) return
    setLoading(true)
    try {
      const entries = await fetchSpxQueue()
      const name = `SPX · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      setError(null)
      setQueue({ entries, fileName: name })
      queueStore.save(selectedDay, selectedShift, entries, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  // Ao abrir a tela (ou trocar o turno), já busca a fila atual
  useEffect(() => { void refreshFromSpx() }, [selectedDay, selectedShift]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esperados (rota atribuída no app), com a gaiola — para achar quem não chegou e o prazo dele.
  // Por ROTA: cada rota conta 1 motorista efetivo (override manda sobre o assignedDriverId),
  // assim quem perdeu a rota (foi reatribuída a outro) não aparece mais como esperado.
  const expected = useMemo(() => {
    const map = new Map<string, { name: string; atId: string; cluster: string; gaiola: string }>()
    const routes = routeStore.get(selectedDay, selectedShift) ?? []
    const overrides = new Map((routeStore.getOverrides(selectedDay, selectedShift) ?? []) as [string, { driverId: string; name: string }][])
    const seen = new Set<string>()
    for (const r of routes) {
      seen.add(r.id)
      const ov = overrides.get(r.id)
      // Rota já atribuída (no SPX ou confirmada no app) vale o motorista dela; a sugestão pendente só conta para rota livre
      if (ov && r.status !== 'ATRIBUIDA') map.set(ov.driverId, { name: ov.name, atId: r.atId, cluster: r.cluster, gaiola: r.gaiola ?? '' })
      else if (r.assignedDriverId) map.set(r.assignedDriverId, { name: r.assignedDriverName ?? '', atId: r.atId, cluster: r.cluster, gaiola: r.gaiola ?? '' })
    }
    for (const [rid, ov] of overrides) if (!seen.has(rid)) map.set(ov.driverId, { name: ov.name, atId: '', cluster: '', gaiola: '' })
    return map
  }, [selectedDay, selectedShift, queue, refreshTick])

  const rows = useMemo(() => {
    const entries = queue?.entries ?? []
    return entries.map(e => ({ e, w: computeLoadWindowMulti(e, windows) }))
      .sort((a, b) => {
        const rank = (s: string) => (s === 'out-of-window' ? 0 : s === 'unknown' ? 1 : 2)
        return rank(a.w.status) - rank(b.w.status) || a.e.letter.localeCompare(b.e.letter) || (a.e.arrivalMin ?? 0) - (b.e.arrivalMin ?? 0)
      })
  }, [queue, windows])

  const arrivedIds = useMemo(() => new Set((queue?.entries ?? []).map(e => e.driverId)), [queue])
  // A rota já está na fila com outro motorista (trocada direto no SPX): não conta como "não chegou"
  const arrivedAts = useMemo(() => new Set((queue?.entries ?? []).map(e => e.atId).filter(Boolean)), [queue])

  const notArrived = useMemo<NotArrived[]>(() => {
    const list: NotArrived[] = []
    for (const [driverId, info] of expected) {
      if (arrivedIds.has(driverId)) continue
      if (info.atId && arrivedAts.has(info.atId)) continue
      const letter = extractLetter(info.gaiola)
      const w = windowForLetterMulti(letter, windows)
      let status: NotArrivedStatus
      if (!w) status = 'unknown-letter'
      else status = nowMin >= w.arriveByMin ? 'overdue' : 'waiting'
      list.push({ driverId, ...info, letter, arriveByMin: w?.arriveByMin ?? null, status })
    }
    const rank = (s: NotArrivedStatus) => (s === 'overdue' ? 0 : s === 'waiting' ? 1 : 2)
    return list.sort((a, b) => rank(a.status) - rank(b.status) || (a.arriveByMin ?? 0) - (b.arriveByMin ?? 0))
  }, [expected, arrivedIds, arrivedAts, windows, nowMin])

  const onTime = rows.filter(r => r.w.status === 'on-time')
  const outOfWindow = rows.filter(r => r.w.status === 'out-of-window')
  const unknownArrived = rows.filter(r => r.w.status === 'unknown')
  const overdue = notArrived.filter(n => n.status === 'overdue')
  const waiting = notArrived.filter(n => n.status === 'waiting')
  const unknownLetter = notArrived.filter(n => n.status === 'unknown-letter')

  const [reportOpen, setReportOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Busca sem diferenciar maiúsculas nem acentos ("joao" acha "João")
  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = norm(search.trim())
  // Letra selecionada ('' = todas; '—' = sem letra)
  const [letterFilter, setLetterFilter] = useState('')
  const inLetter = (letter: string) => !letterFilter || (letter || '—') === letterFilter
  const shownRows = rows.filter(({ e }) => inLetter(e.letter) && (!q || norm(e.driverName).includes(q) || e.driverId.includes(q) || norm(e.atId).includes(q)))
  const shownNotArrived = notArrived.filter(n => inLetter(n.letter) && (!q || norm(n.name).includes(q) || n.driverId.includes(q) || norm(n.atId).includes(q)))
  const letterRows = rows.filter(({ e }) => inLetter(e.letter))
  const letterNotArrived = notArrived.filter(n => inLetter(n.letter))
  const [activeView, setActiveView] = useState<'lista' | 'dashboard' | 'mesas'>('lista')
  const [showWindows, setShowWindows] = useState(false)

  // Quebra por letra (chegaram + não chegaram)
  const perLetter = useMemo(() => {
    const m = new Map<string, { onTime: number; outOfWindow: number; overdue: number; waiting: number; unknown: number }>()
    const g = (l: string) => { const k = l || '—'; if (!m.has(k)) m.set(k, { onTime: 0, outOfWindow: 0, overdue: 0, waiting: 0, unknown: 0 }); return m.get(k)! }
    for (const { e, w } of rows) { const x = g(e.letter); if (w.status === 'on-time') x.onTime++; else if (w.status === 'out-of-window') x.outOfWindow++; else x.unknown++ }
    for (const n of notArrived) { const x = g(n.letter); if (n.status === 'overdue') x.overdue++; else if (n.status === 'waiting') x.waiting++; else x.unknown++ }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, notArrived])

  const copy = (key: string, values: string[]) => {
    const clean = [...new Set(values.filter(Boolean))]
    if (clean.length === 0) return
    navigator.clipboard.writeText(clean.join('\n'))
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 2000)
  }
  const lbl = (key: string, base: string) => (copiedKey === key ? '✓ Copiado!' : base)
  const phones = (ids: string[]) => ids.map(id => phoneMap.get(id) ?? '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2130', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Carregamento</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
              {selectedShift} · {selectedDay} · agora {minToHHMM(nowMin)}{queue ? <> · <span style={{ color: '#4ade80' }}>●</span> {queue.fileName.replace('SPX · ', 'atualizado às ')}</> : ' · clique em Atualizar do SPX'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn outline color="#94a3b8" onClick={() => setShowWindows(v => !v)}>⏱ Janelas: {windows.filter(w => w.startCage && w.startTime).map(w => `${w.startCage} ${w.startTime}`).join(' · ') || 'definir'}</Btn>
            {queue && <Btn outline color="#a78bfa" onClick={() => setReportOpen(true)}>📊 Report</Btn>}
            {queue && <button title="Remover a fila salva deste turno" onClick={() => { if (window.confirm('Remover a fila salva deste turno?')) { queueStore.clear(selectedDay, selectedShift); setQueue(null) } }}
              style={{ background: 'transparent', border: '1px solid #2d3048', color: '#64748b', borderRadius: 7, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }}>🗑</button>}
            <Btn onClick={() => void refreshFromSpx()} disabled={loading}>{loading ? '⏳ Atualizando…' : '🔄 Atualizar do SPX'}</Btn>
          </div>
        </div>
        {showWindows && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Janelas</span>
              {windows.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {i > 0 && <span style={{ color: '#374151', fontSize: 11 }}>·</span>}
                  <input
                    value={w.startCage}
                    onChange={e => { const next = windows.map((x, j) => j === i ? { ...x, startCage: e.target.value.toUpperCase() } : x); saveWindows(next) }}
                    placeholder="A ou D-7"
                    style={{ background: '#13151f', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 5, padding: '3px 6px', fontSize: 11, outline: 'none', width: 58 }}
                  />
                  <input type="time" value={w.startTime}
                    onChange={e => { const next = windows.map((x, j) => j === i ? { ...x, startTime: e.target.value } : x); saveWindows(next) }}
                    style={{ background: '#13151f', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 5, padding: '3px 5px', fontSize: 11, outline: 'none', width: 80 }} />
                  {windows.length > 1 && (
                    <button onClick={() => saveWindows(windows.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={() => saveWindows([...windows, { startCage: 'A', startTime: '' }])}
                style={{ background: 'none', border: '1px dashed #2d3048', color: '#64748b', borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '2px 7px' }}>+ janela</button>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>Letra/gaiola em que começa o carregamento e o horário. Cada letra seguinte = +20 min; o prazo de chegada é 20 min antes.</span>
          </div>
        )}
        {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f87171' }}>⚠ {error}</p>}
        {!hasValidWindows && queue && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#fbbf24' }}>⚠ Defina pelo menos uma janela de carregamento (letra + horário) para calcular os prazos.</p>}
      </div>

      {/* Tab bar — só exibe quando há dados */}
      {queue && (
        <div style={{ display: 'flex', borderBottom: '1px solid #2d3048', flexShrink: 0, paddingLeft: 20 }}>
          {(['lista', 'mesas', 'dashboard'] as const).map(v => (
            <button key={v} onClick={() => setActiveView(v)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeView === v ? '2px solid #7c3aed' : '2px solid transparent', background: 'transparent', color: activeView === v ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
              {v === 'lista' ? `📋 Motoristas (${rows.length + notArrived.length})` : v === 'mesas' ? `🪑 Mesas${queue.entries.some(e => e.situation === 'at-dock' || e.situation === 'calling') ? ` (${queue.entries.filter(e => e.situation === 'at-dock' || e.situation === 'calling').length} em uso)` : ''}` : '📊 Dashboard'}
            </button>
          ))}
        </div>
      )}

      {!queue ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, textAlign: 'center', padding: 40 }}>
          <p style={{ margin: 0, maxWidth: 420 }}>{loading ? 'Buscando a fila no SPX…' : <>Clique em <b>🔄 Atualizar do SPX</b> para buscar a fila deste turno e ver</>} quem chegou no prazo, quem chegou fora da janela, quem está aguardando e quem está atrasado.</p>
        </div>
      ) : activeView === 'mesas' ? (
        <MesasView entries={queue.entries} phoneMap={phoneMap} day={selectedDay} onRefresh={refreshFromSpx} />
      ) : activeView === 'dashboard' ? (
        <CarregamentoDashboard rows={rows} notArrived={notArrived} nowMin={nowMin} phoneMap={phoneMap} />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 80 }}>
          {/* Barra: busca + copiar telefones */}
          <div style={{ margin: '14px 20px 12px', background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              placeholder="🔍  Buscar motorista, ID ou AT..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: '1 1 220px', maxWidth: 320, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '7px 12px', fontSize: 12, outline: 'none' }}
            />
            {q && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>✕</button>}
            {(q || letterFilter) && <span style={{ fontSize: 11, color: '#8892a4' }}>{shownRows.length} na fila · {shownNotArrived.length} não chegaram</span>}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Copiar telefones</span>
            <Btn outline color="#f87171" onClick={() => copy('op', phones(overdue.map(n => n.driverId)))} disabled={overdue.length === 0}>{lbl('op', `🔴 Atrasados (${overdue.length})`)}</Btn>
            <Btn outline color="#fbbf24" onClick={() => copy('wp', phones(waiting.map(n => n.driverId)))} disabled={waiting.length === 0}>{lbl('wp', `⏳ Aguardando (${waiting.length})`)}</Btn>
            <Btn outline color="#fb923c" onClick={() => copy('fp', phones(outOfWindow.map(r => r.e.driverId)))} disabled={outOfWindow.length === 0}>{lbl('fp', `🟠 Fora da janela (${outOfWindow.length})`)}</Btn>
            <Btn outline color="#94a3b8" onClick={() => copy('oi', overdue.map(n => n.driverId))} disabled={overdue.length === 0}>{lbl('oi', '🆔 IDs atrasados')}</Btn>
          </div>
          {registry.length === 0 && <p style={{ margin: '-4px 20px 10px', fontSize: 11, color: '#fbbf24' }}>⚠ Importe o relatório de motoristas para ter os telefones.</p>}

          {/* Por letra */}
          <div style={{ padding: '0 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Por letra</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>clique numa letra para ver só os motoristas dela</span>
              {letterFilter && <button onClick={() => setLetterFilter('')} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✕ ver todas</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
              {perLetter.map(([letter, g]) => {
                const arrived = g.onTime + g.outOfWindow
                const t = arrived + g.overdue + g.waiting + g.unknown
                const active = letterFilter === letter
                const win = hasValidWindows && letter !== '—' ? windowForLetterMulti(letter, windows) : null
                const seg = [[g.onTime, '#4ade80'], [g.outOfWindow, '#fb923c'], [g.waiting, '#fbbf24'], [g.overdue, '#f87171'], [g.unknown, '#374151']] as [number, string][]
                const ids = [...rows.filter(r => (r.e.letter || '—') === letter).map(r => r.e.driverId), ...notArrived.filter(n => (n.letter || '—') === letter).map(n => n.driverId)]
                const accent = g.overdue > 0 ? '#f87171' : g.waiting > 0 ? '#fbbf24' : '#4ade80'
                return (
                  <div key={letter} onClick={() => setLetterFilter(active ? '' : letter)}
                    style={{ cursor: 'pointer', background: active ? 'rgba(124,58,237,.14)' : '#13151f', border: `1px solid ${active ? '#7c3aed' : '#2d3048'}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '10px 12px', opacity: letterFilter && !active ? .55 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>{letter}</span>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{win ? `prazo ${minToHHMM(win.arriveByMin)} · carrega ${minToHHMM(win.startMin)}` : 'sem janela'}</span>
                    </div>
                    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e2130', margin: '8px 0 6px' }}>
                      {seg.filter(([n]) => n > 0).map(([n, c]) => <div key={c} style={{ width: `${(n / t) * 100}%`, background: c }} />)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}><b style={{ color: '#e2e8f0' }}>{arrived}</b>/{t} chegaram</span>
                      <button title={`Copiar telefones da letra ${letter}`} onClick={ev => { ev.stopPropagation(); copy(`L${letter}`, phones(ids)) }}
                        style={{ background: 'transparent', border: '1px solid #2d3048', color: copiedKey === `L${letter}` ? '#4ade80' : '#94a3b8', borderRadius: 6, padding: '2px 7px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {copiedKey === `L${letter}` ? '✓ copiado' : '📱 copiar'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 11, fontWeight: 600, flexWrap: 'wrap' }}>
                      {g.overdue > 0 && <span style={{ color: '#f87171' }}>🔴 {g.overdue} atrasado{g.overdue > 1 ? 's' : ''}</span>}
                      {g.waiting > 0 && <span style={{ color: '#fbbf24' }}>⏳ {g.waiting}</span>}
                      {g.outOfWindow > 0 && <span style={{ color: '#fb923c' }}>🟠 {g.outOfWindow}</span>}
                      {g.overdue + g.waiting === 0 && <span style={{ color: '#4ade80' }}>✅ completa</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {letterFilter && (
              <div style={{ marginTop: 10, background: '#13151f', border: '1px solid #7c3aed55', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Letra {letterFilter}</span>
                  <span style={{ fontSize: 11, color: '#8892a4' }}>{letterRows.length} na fila · {letterNotArrived.length} não chegaram</span>
                  <span style={{ flex: 1 }} />
                  <Btn outline color="#a78bfa" onClick={() => copy('lt', phones([...letterRows.map(r => r.e.driverId), ...letterNotArrived.map(n => n.driverId)]))} disabled={letterRows.length + letterNotArrived.length === 0}>📱 {lbl('lt', `Tel. de todos (${letterRows.length + letterNotArrived.length})`)}</Btn>
                  <Btn outline color="#f87171" onClick={() => copy('ln', phones(letterNotArrived.map(n => n.driverId)))} disabled={letterNotArrived.length === 0}>📱 {lbl('ln', `Tel. não chegaram (${letterNotArrived.length})`)}</Btn>
                  <Btn outline color="#60a5fa" onClick={() => copy('lq', phones(letterRows.map(r => r.e.driverId)))} disabled={letterRows.length === 0}>📱 {lbl('lq', `Tel. na fila (${letterRows.length})`)}</Btn>
                </div>
                {([
                  ['🔴 Atrasados', '#f87171', letterNotArrived.filter(n => n.status === 'overdue').map(n => ({ id: n.driverId, name: n.name }))],
                  ['⏳ Aguardando', '#fbbf24', letterNotArrived.filter(n => n.status !== 'overdue').map(n => ({ id: n.driverId, name: n.name }))],
                  ['🟠 Fora da janela', '#fb923c', letterRows.filter(r => r.w.status === 'out-of-window').map(r => ({ id: r.e.driverId, name: r.e.driverName }))],
                  ['✅ Na fila no prazo', '#4ade80', letterRows.filter(r => r.w.status !== 'out-of-window').map(r => ({ id: r.e.driverId, name: r.e.driverName }))],
                ] as [string, string, { id: string; name: string }[]][]).filter(([, , list]) => list.length > 0).map(([title, color, list]) => (
                  <div key={title} style={{ marginBottom: 8 }}>
                    <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 700, color }}>{title} ({list.length})</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {list.map(d => (
                        <span key={d.id} title="Clique para copiar o telefone" onClick={() => copy(`D${d.id}`, [phoneMap.get(d.id) ?? ''])}
                          style={{ cursor: phoneMap.get(d.id) ? 'pointer' : 'default', fontSize: 11, background: `${color}14`, border: `1px solid ${color}40`, borderRadius: 6, padding: '3px 8px', color: '#e2e8f0' }}>
                          {d.name || d.id} <span style={{ color: '#8892a4', fontFamily: 'monospace', fontSize: 10 }}>{copiedKey === `D${d.id}` ? '✓ copiado' : phoneMap.get(d.id) || 'sem tel.'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Não chegaram (aguardando + atrasados) */}
          <div style={{ padding: '0 20px 24px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
              Não chegaram ({q || letterFilter ? `${shownNotArrived.length} de ${notArrived.length}` : notArrived.length}) — <span style={{ color: '#f87171' }}>{overdue.length} atrasados</span> · <span style={{ color: '#fbbf24' }}>{waiting.length} aguardando</span>
            </p>
            {expected.size === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Nenhuma rota atribuída neste dia/turno na tela Atribuição — sem base para comparar quem não chegou.</p>
            ) : notArrived.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: '#4ade80' }}>✅ Todos os motoristas com rota atribuída já estão na fila.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2d3048' }}>
                    {['Motorista', 'Letra', 'Prazo chegada', 'Status', 'AT', 'Cluster', 'Telefone'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shownNotArrived.map(n => (
                    <tr key={n.driverId} style={{ borderBottom: '1px solid #1e2130', background: n.status === 'overdue' ? 'rgba(239,68,68,.05)' : 'transparent' }}>
                      <td style={TD}>
                        <span style={{ fontWeight: 500 }}>{n.name || n.driverId}</span>
                        <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{n.driverId}</span>
                      </td>
                      <td style={TD}><span style={{ fontWeight: 700 }}>{n.letter || '—'}</span> <span style={{ color: '#64748b', fontSize: 10 }}>{n.gaiola}</span></td>
                      <td style={{ ...TD, color: '#94a3b8' }}>{minToHHMM(n.arriveByMin)}</td>
                      <td style={TD}>
                        {n.status === 'overdue' && <Chip label="🔴 Atrasado" color="#f87171" bg="rgba(239,68,68,.12)" />}
                        {n.status === 'waiting' && <Chip label="⏳ Aguardando" color="#fbbf24" bg="rgba(245,158,11,.12)" />}
                        {n.status === 'unknown-letter' && <Chip label="— sem gaiola" color="#94a3b8" bg="rgba(100,116,139,.12)" />}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#94a3b8' }}>{n.atId || '—'}</td>
                      <td style={{ ...TD, color: '#94a3b8' }}>{n.cluster || '—'}</td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#94a3b8' }}>{phoneMap.get(n.driverId) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Fila (quem chegou) */}
          <p style={{ margin: '0 0 6px', padding: '0 20px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Na fila ({q || letterFilter ? `${shownRows.length} de ${rows.length}` : rows.length})</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 24 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['Motorista', 'Situação', 'Letra', 'Janela da letra', 'Prazo chegada', 'Chegou', 'Aguardou', 'Status', 'AT', 'Cluster', 'Telefone'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shownRows.map(({ e, w }) => (
                <tr key={e.driverId + e.atId} style={{ borderBottom: '1px solid #1e2130', background: w.status === 'out-of-window' ? 'rgba(251,146,60,.05)' : 'transparent' }}>
                  <td style={TD}>
                    <span style={{ fontWeight: 500 }}>{e.driverName}</span>
                    <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{e.driverId}</span>
                  </td>
                  <td style={TD}>{e.situation ? <SituationChip s={e.situation} dock={e.dock} /> : '—'}</td>
                  <td style={TD}><span style={{ fontWeight: 700 }}>{e.letter || '—'}</span> <span style={{ color: '#64748b', fontSize: 10 }}>{e.cage}</span></td>
                  <td style={{ ...TD, color: '#94a3b8' }}>{minToHHMM(w.startMin)}{w.startMin !== null ? `–${minToHHMM(w.startMin + 20)}` : ''}</td>
                  <td style={{ ...TD, color: '#94a3b8' }}>{minToHHMM(w.arriveByMin)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{minToHHMM(e.arrivalMin)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: e.waitingMin !== null ? (e.waitingMin >= 60 ? '#f87171' : e.waitingMin >= 30 ? '#fbbf24' : '#4ade80') : '#64748b' }}>
                    {e.waitingTime || '—'}
                  </td>
                  <td style={TD}>
                    {w.status === 'out-of-window' && <Chip label={`🟠 Fora da janela +${w.lateMin} min`} color="#fb923c" bg="rgba(251,146,60,.12)" />}
                    {w.status === 'on-time' && <Chip label="✅ No prazo" color="#4ade80" bg="rgba(74,222,128,.12)" />}
                    {w.status === 'unknown' && <Chip label="— sem letra/hora" color="#94a3b8" bg="rgba(100,116,139,.12)" />}
                  </td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: '#94a3b8' }}>{e.atId}</td>
                  <td style={{ ...TD, color: '#94a3b8' }}>{e.cluster}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: '#94a3b8' }}>{phoneMap.get(e.driverId) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

        </div>
      )}

      {reportOpen && (() => {
        const total = rows.length + notArrived.length
        const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
        const unknownAll = unknownArrived.length + unknownLetter.length
        const punctual = onTime.length + outOfWindow.length > 0 ? Math.round((onTime.length / (onTime.length + outOfWindow.length)) * 100) : 0
        const segs = [
          { label: 'No prazo', n: onTime.length, c: '#4ade80' },
          { label: 'Fora da janela', n: outOfWindow.length, c: '#fb923c' },
          { label: 'Aguardando', n: waiting.length, c: '#fbbf24' },
          { label: 'Atrasados', n: overdue.length, c: '#f87171' },
          { label: 'Sem letra/hora', n: unknownAll, c: '#4b5563' },
        ].filter(s => s.n > 0)
        const dateFmt = selectedDay.split('-').reverse().join('/')

        const buildText = () => {
          const L: string[] = [
            `🚚 Report de Carregamento — ${dateFmt}`,
            `Turno: ${selectedShift} · Janelas: ${windows.filter(w => w.startTime).map(w => `${w.startCage}=${w.startTime}`).join(', ') || '—'} · Gerado ${minToHHMM(nowMin)}`,
            ``,
            `👥 Na fila: ${rows.length}`,
            `✅ No prazo: ${onTime.length} (${pct(onTime.length)}%)`,
            `🟠 Fora da janela: ${outOfWindow.length} (${pct(outOfWindow.length)}%)`,
            `⏳ Aguardando: ${waiting.length}`,
            `🔴 Atrasados (não chegaram): ${overdue.length}`,
            `🎯 Pontualidade (dos que chegaram): ${punctual}%`,
          ]
          if (overdue.length) {
            L.push(``, `🔴 Atrasados:`)
            for (const n of overdue) L.push(`- ${n.name || n.driverId} (letra ${n.letter || '—'}, prazo ${minToHHMM(n.arriveByMin)})${phoneMap.get(n.driverId) ? ` — ${phoneMap.get(n.driverId)}` : ''}`)
          }
          if (outOfWindow.length) {
            L.push(``, `🟠 Fora da janela:`)
            for (const r of outOfWindow) L.push(`- ${r.e.driverName || r.e.driverId} (letra ${r.e.letter || '—'}, +${r.w.lateMin} min)`)
          }
          return L.join('\n')
        }

        return (
          <div onClick={() => setReportOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 12, width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1e2130', position: 'sticky', top: 0, background: '#0f1117' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>📊 Report de Carregamento</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>{selectedShift} · {dateFmt} · {windows.filter(w => w.startTime).map(w => `${w.startCage}=${w.startTime}`).join(', ') || '—'} · agora {minToHHMM(nowMin)}</p>
                </div>
                <button onClick={() => setReportOpen(false)} style={{ background: 'none', border: 'none', color: '#8892a4', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Barra proporcional */}
                <div>
                  <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', background: '#13151f', border: '1px solid #2d3048' }}>
                    {segs.map(s => <div key={s.label} title={`${s.label}: ${s.n}`} style={{ width: `${pct(s.n)}%`, background: s.c }} />)}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
                    {segs.map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c, display: 'inline-block' }} />
                        <span style={{ color: '#e2e8f0' }}>{s.label}</span>
                        <span style={{ color: '#64748b' }}>{s.n} · {pct(s.n)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Esperados', value: total, color: '#60a5fa' },
                    { label: 'Na fila', value: rows.length, color: '#60a5fa' },
                    { label: 'Pontualidade', value: `${punctual}%`, color: punctual >= 80 ? '#4ade80' : punctual >= 50 ? '#fbbf24' : '#f87171' },
                    { label: 'Atrasados', value: overdue.length, color: '#f87171' },
                  ].map(c => (
                    <div key={c.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '8px 14px', minWidth: 90 }}>
                      <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{c.label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Por letra */}
                {perLetter.length > 0 && (
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Por letra</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2d3048' }}>
                          {['Letra', 'No prazo', 'Fora janela', 'Aguardando', 'Atrasado', 'Distribuição'].map(h => <th key={h} style={TH}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {perLetter.map(([letter, g]) => {
                          const t = g.onTime + g.outOfWindow + g.overdue + g.waiting + g.unknown
                          const seg = [[g.onTime, '#4ade80'], [g.outOfWindow, '#fb923c'], [g.waiting, '#fbbf24'], [g.overdue, '#f87171'], [g.unknown, '#4b5563']] as [number, string][]
                          return (
                            <tr key={letter} style={{ borderBottom: '1px solid #1e2130' }}>
                              <td style={{ ...TD, fontWeight: 700 }}>{letter}</td>
                              <td style={{ ...TD, color: '#4ade80' }}>{g.onTime}</td>
                              <td style={{ ...TD, color: '#fb923c' }}>{g.outOfWindow}</td>
                              <td style={{ ...TD, color: '#fbbf24' }}>{g.waiting}</td>
                              <td style={{ ...TD, color: '#f87171' }}>{g.overdue}</td>
                              <td style={TD}>
                                <div style={{ display: 'flex', height: 10, width: 140, borderRadius: 3, overflow: 'hidden', background: '#13151f' }}>
                                  {seg.filter(([n]) => n > 0).map(([n, c], i) => <div key={i} style={{ width: `${t > 0 ? (n / t) * 100 : 0}%`, background: c }} />)}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Listas */}
                {overdue.length > 0 && (
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#f87171' }}>🔴 Atrasados ({overdue.length})</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {overdue.map(n => <span key={n.driverId} style={{ fontSize: 11, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 6, padding: '3px 8px', color: '#e2e8f0' }}>{n.name || n.driverId} · {n.letter || '—'}</span>)}
                    </div>
                  </div>
                )}
                {outOfWindow.length > 0 && (
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#fb923c' }}>🟠 Fora da janela ({outOfWindow.length})</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {outOfWindow.map(r => <span key={r.e.driverId + r.e.atId} style={{ fontSize: 11, background: 'rgba(251,146,60,.1)', border: '1px solid rgba(251,146,60,.25)', borderRadius: 6, padding: '3px 8px', color: '#e2e8f0' }}>{r.e.driverName || r.e.driverId} · {r.e.letter || '—'} · +{r.w.lateMin}min</span>)}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #1e2130', paddingTop: 14 }}>
                  <Btn color="#7c3aed" onClick={() => copy('rep', [buildText()])}>{copiedKey === 'rep' ? '✓ Copiado!' : '📋 Copiar resumo (texto)'}</Btn>
                  <Btn outline color="#94a3b8" onClick={() => setReportOpen(false)}>Fechar</Btn>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const SITUATION_COLOR: Record<QueueSituation, string> = {
  pending: '#94a3b8', waiting: '#60a5fa', calling: '#fbbf24', 'at-dock': '#f87171', 'on-hold': '#a78bfa', done: '#4ade80',
}

function SituationChip({ s, dock }: { s: QueueSituation; dock?: string }) {
  const c = SITUATION_COLOR[s]
  return <Chip label={`${SITUATION_LABEL[s]}${dock && (s === 'at-dock' || s === 'calling' || s === 'on-hold') ? ` · ${dockKey(dock)}` : ''}`} color={c} bg={`${c}1f`} />
}

// ─── Mesas: ocupada / chamando motorista / livre ─────────────────────────────
const DOCK_COUNT_KEY = 'spx:dock-count'

function MesasView({ entries, phoneMap, day, onRefresh }: { entries: QueueEntry[]; phoneMap: Map<string, string>; day: string; onRefresh: () => Promise<void> }) {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => { const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000); return () => clearInterval(t) }, [])

  // Quem está em cada mesa (ocupando ou chamado para ela)
  const byDock = useMemo(() => {
    const m = new Map<string, { occupied: QueueEntry[]; calling: QueueEntry[] }>()
    for (const e of entries) {
      if (!e.dock || (e.situation !== 'at-dock' && e.situation !== 'calling')) continue
      const k = dockKey(e.dock)
      if (!m.has(k)) m.set(k, { occupied: [], calling: [] })
      m.get(k)![e.situation === 'at-dock' ? 'occupied' : 'calling'].push(e)
    }
    return m
  }, [entries])

  const maxSeen = Math.max(0, ...[...byDock.keys()].map(k => parseInt(k.replace(/\D/g, ''), 10) || 0))
  const [dockCount, setDockCountState] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(DOCK_COUNT_KEY) ?? '', 10) || 0 } catch { return 0 }
  })
  const setDockCount = (n: number) => { setDockCountState(n); try { localStorage.setItem(DOCK_COUNT_KEY, String(n)) } catch { /* */ } }
  const total = Math.max(dockCount || maxSeen, maxSeen)

  const docks = useMemo(() => {
    const names = new Set<string>(Array.from({ length: total }, (_, i) => `Mesa ${i + 1}`))
    for (const k of byDock.keys()) names.add(k)
    return [...names].sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 999) - (parseInt(b.replace(/\D/g, ''), 10) || 999) || a.localeCompare(b))
  }, [total, byDock])

  const state = (k: string) => {
    const d = byDock.get(k)
    if (d?.occupied.length) return 'occupied' as const
    if (d?.calling.length) return 'calling' as const
    return 'free' as const
  }
  const counts = { occupied: docks.filter(k => state(k) === 'occupied').length, calling: docks.filter(k => state(k) === 'calling').length, free: docks.filter(k => state(k) === 'free').length }
  const nextInLine = entries.filter(e => e.situation === 'waiting').sort((a, b) => (a.queueSequence ?? 999) - (b.queueSequence ?? 999) || (a.arrivalMin ?? 0) - (b.arrivalMin ?? 0))
  const onHold = entries.filter(e => e.situation === 'on-hold')
  // Painel "Próximos na fila" recolhível (lembra a escolha)
  const [sideCollapsed, setSideCollapsed] = useState(() => { try { return localStorage.getItem('ui:mesas-side-collapsed') === '1' } catch { return false } })
  const toggleSide = () => setSideCollapsed(v => { try { localStorage.setItem('ui:mesas-side-collapsed', v ? '0' : '1') } catch { /* */ } return !v })
  const STYLE = {
    occupied: { label: 'Ocupada', color: '#f87171', bg: 'rgba(239,68,68,.08)' },
    calling: { label: 'Chamando motorista', color: '#fbbf24', bg: 'rgba(245,158,11,.10)' },
    free: { label: 'Livre', color: '#4ade80', bg: 'rgba(74,222,128,.06)' },
  }
  const minsAgo = (ts?: number) => (ts ? Math.max(0, Math.round((nowSec - ts) / 60)) : null)

  // Atualiza sozinho a cada minuto enquanto a aba de mesas está aberta
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh
  useEffect(() => { const t = setInterval(() => { void refreshRef.current() }, 60000); return () => clearInterval(t) }, [])

  // O SPX não diz desde quando a mesa está ocupada ou vazia: o app anota a hora em que viu cada mudança.
  // `exact` = vimos a mudança acontecer (entre duas atualizações); senão é "pelo menos desde".
  const historyKey = `spx:dock-history:${day}`
  const [history, setHistory] = useState<Record<string, { state: string; who: string; since: number; exact: boolean }>>({})
  useEffect(() => {
    let prev: typeof history = {}
    try { prev = JSON.parse(localStorage.getItem(historyKey) ?? '{}') } catch { /* */ }
    const firstLook = Object.keys(prev).length === 0
    const now = Math.floor(Date.now() / 1000)
    const next: typeof history = {}
    for (const k of docks) {
      const st = state(k)
      const d = byDock.get(k)
      const who = (st === 'occupied' ? d!.occupied : st === 'calling' ? d!.calling : []).map(e => e.driverId).join(',')
      const old = prev[k]
      next[k] = old && old.state === st && old.who === who ? old : { state: st, who, since: now, exact: !firstLook && !!old }
    }
    setHistory(next)
    try { localStorage.setItem(historyKey, JSON.stringify(next)) } catch { /* */ }
  }, [entries, docks, historyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const fmtDur = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`
  const durationOf = (k: string, st: 'occupied' | 'calling' | 'free', calledAt?: number) => {
    // Chamando: o SPX informa a hora da chamada
    if (st === 'calling' && calledAt) return { min: minsAgo(calledAt)!, exact: true }
    const h = history[k]
    if (!h || h.state !== st) return null
    return { min: minsAgo(h.since)!, exact: h.exact }
  }
  const noApiData = !entries.some(e => e.situation)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 80px', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 560px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {(['occupied', 'calling', 'free'] as const).map(k => (
            <div key={k} style={{ background: '#13151f', border: '1px solid #2d3048', borderLeft: `3px solid ${STYLE[k].color}`, borderRadius: 8, padding: '8px 14px', minWidth: 110 }}>
              <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{STYLE[k].label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: STYLE[k].color }}>{counts[k]}</p>
            </div>
          ))}
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 11, color: '#8892a4', display: 'flex', alignItems: 'center', gap: 6 }}>
            Mesas no hub
            <input type="number" min={1} max={99} value={total || ''} onChange={e => setDockCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
              style={{ width: 56, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 6px', fontSize: 12, outline: 'none' }} />
          </label>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: '#64748b' }}>Atualiza sozinho a cada minuto. Tempo em vermelho: ocupada há 40+ min, chamando há 10+ min, vazia há 15+ min. "≥" = o app começou a acompanhar a mesa depois que ela já estava assim.</p>
        {noApiData && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#fbbf24' }}>⚠ Esta fila veio de um CSV antigo, que não tem as mesas. Clique em 🔄 Atualizar do SPX.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
          {docks.map(k => {
            const st = state(k)
            const sty = STYLE[st]
            const d = byDock.get(k)
            const people = st === 'occupied' ? d!.occupied : st === 'calling' ? d!.calling : []
            return (
              <div key={k} style={{ background: sty.bg, border: `1px solid ${sty.color}55`, borderTop: `3px solid ${sty.color}`, borderRadius: 10, padding: '10px 12px', minHeight: 92 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>{k}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: sty.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>{st === 'calling' ? '📣 ' : ''}{sty.label}</span>
                </div>
                {(() => {
                  const dur = durationOf(k, st, people[0]?.calledAt)
                  if (!dur) return null
                  const limit = st === 'occupied' ? 40 : st === 'calling' ? 10 : 15
                  return (
                    <p title={dur.exact ? undefined : 'O app só começou a acompanhar esta mesa agora — o tempo real pode ser maior.'}
                      style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: dur.min >= limit ? '#f87171' : sty.color }}>
                      {dur.exact ? '' : '≥ '}{fmtDur(dur.min)}
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#8892a4', fontFamily: 'inherit', marginLeft: 6 }}>{st === 'occupied' ? 'ocupada' : st === 'calling' ? 'chamando' : 'vazia'}</span>
                    </p>
                  )
                })()}
                {people.length === 0 ? (
                  <p style={{ margin: '14px 0 0', fontSize: 12, color: '#4ade80aa' }}>Disponível</p>
                ) : people.map(e => {
                  return (
                    <div key={e.driverId + e.atId} style={{ marginTop: 8 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.driverName}>{e.driverName}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8892a4', fontFamily: 'monospace' }}>
                        {e.cage || '—'} · {e.orderQty ?? '—'} pct · {e.plate || ''}
                      </p>
                      {st === 'calling' && phoneMap.get(e.driverId) && (
                        <button onClick={() => navigator.clipboard.writeText(phoneMap.get(e.driverId)!)} title="Copiar telefone"
                          style={{ marginTop: 4, background: 'transparent', border: '1px solid #2d3048', color: '#94a3b8', borderRadius: 5, padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}>📱 {phoneMap.get(e.driverId)}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Próximos da fila */}
      {sideCollapsed ? (
        <button onClick={toggleSide} title="Mostrar próximos na fila"
          style={{ alignSelf: 'stretch', width: 38, background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, color: '#94a3b8', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '10px 0' }}>
          <span style={{ fontSize: 13 }}>‹</span>
          <span style={{ writingMode: 'vertical-rl', fontSize: 12, fontWeight: 700 }}>Próximos na fila ({nextInLine.length})</span>
        </button>
      ) : (
      <div style={{ flex: '0 1 300px', minWidth: 260, background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Próximos na fila ({nextInLine.length})</p>
          <button onClick={toggleSide} title="Recolher"
            style={{ background: 'transparent', border: '1px solid #2d3048', color: '#8892a4', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>›</button>
        </div>
        {nextInLine.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Ninguém aguardando mesa.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflow: 'auto' }}>
            {nextInLine.map((e, i) => (
              <div key={e.driverId + e.atId} style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #1e2130', paddingBottom: 5 }}>
                <span style={{ width: 20, fontSize: 11, color: '#64748b', textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.driverName}</p>
                  <p style={{ margin: 0, fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{e.cage || '—'} · {e.cluster}</p>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: e.overWaitLimit || (e.waitingMin ?? 0) >= 60 ? '#f87171' : (e.waitingMin ?? 0) >= 30 ? '#fbbf24' : '#4ade80' }}>{e.waitingMin ?? '—'}min</span>
              </div>
            ))}
          </div>
        )}
        {onHold.length > 0 && (
          <>
            <p style={{ margin: '14px 0 6px', fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>Em espera ({onHold.length})</p>
            {onHold.map(e => <p key={e.driverId + e.atId} style={{ margin: '0 0 4px', fontSize: 11, color: '#e2e8f0' }}>{e.driverName} <span style={{ color: '#64748b' }}>{e.dock ? `· ${dockKey(e.dock)}` : ''}</span></p>)}
          </>
        )}
      </div>
      )}
    </div>
  )
}
