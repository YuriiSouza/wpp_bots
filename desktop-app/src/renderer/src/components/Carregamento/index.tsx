import { useMemo, useState, useEffect } from 'react'
import type { Shift } from '../../lib/globalConfig'
import { findLatestFile, FILE_PATTERNS, pickFolder } from '../../lib/fileFinder'
import { getGlobalConfig, saveGlobalConfig } from '../../lib/globalConfig'
import type { StoredDriver } from '../../lib/localStore'
import { routeStore } from '../../lib/routeStore'
import { queueStore } from '../../lib/queueStore'
import { parseQueueListCsv, computeLoadWindowMulti, windowForLetterMulti, extractLetter, minToHHMM, parseTimeToMinutes, type QueueEntry, type LoadWindowConfig } from '../../lib/queueListParser'

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

  const hasValidWindows = windows.some(w => w.startLetter && w.startTime)

  const phoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of registry) m.set(d.id, (d.phoneNumber ?? '').replace(/\D/g, ''))
    return m
  }, [registry])

  const handleFile = async (file: File) => {
    const text = await file.text()
    const res = parseQueueListCsv(text)
    if (res.error) { setError(res.error); return }
    setError(null)
    setQueue({ entries: res.entries, fileName: file.name })
    queueStore.save(selectedDay, selectedShift, res.entries, file.name)
  }

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
      if (ov) map.set(ov.driverId, { name: ov.name, atId: r.atId, cluster: r.cluster, gaiola: r.gaiola ?? '' })
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

  const notArrived = useMemo<NotArrived[]>(() => {
    const list: NotArrived[] = []
    for (const [driverId, info] of expected) {
      if (arrivedIds.has(driverId)) continue
      const letter = extractLetter(info.gaiola)
      const w = windowForLetterMulti(letter, windows)
      let status: NotArrivedStatus
      if (!w) status = 'unknown-letter'
      else status = nowMin >= w.arriveByMin ? 'overdue' : 'waiting'
      list.push({ driverId, ...info, letter, arriveByMin: w?.arriveByMin ?? null, status })
    }
    const rank = (s: NotArrivedStatus) => (s === 'overdue' ? 0 : s === 'waiting' ? 1 : 2)
    return list.sort((a, b) => rank(a.status) - rank(b.status) || (a.arriveByMin ?? 0) - (b.arriveByMin ?? 0))
  }, [expected, arrivedIds, windows, nowMin])

  const onTime = rows.filter(r => r.w.status === 'on-time')
  const outOfWindow = rows.filter(r => r.w.status === 'out-of-window')
  const unknownArrived = rows.filter(r => r.w.status === 'unknown')
  const overdue = notArrived.filter(n => n.status === 'overdue')
  const waiting = notArrived.filter(n => n.status === 'waiting')
  const unknownLetter = notArrived.filter(n => n.status === 'unknown-letter')

  const [reportOpen, setReportOpen] = useState(false)
  const [activeView, setActiveView] = useState<'lista' | 'dashboard'>('lista')

  // Timeline de chegadas (agrupada por slots de 15 min)
  const timeline = useMemo(() => {
    const slots = new Map<number, { onTime: number; outOfWindow: number }>()
    for (const { e, w } of rows) {
      if (e.arrivalMin === null) continue
      const slot = Math.floor(e.arrivalMin / 15) * 15
      if (!slots.has(slot)) slots.set(slot, { onTime: 0, outOfWindow: 0 })
      const s = slots.get(slot)!
      if (w.status === 'on-time') s.onTime++; else s.outOfWindow++
    }
    return [...slots.entries()].sort((a, b) => a[0] - b[0])
  }, [rows])

  // Tempo médio de espera (waitingMin dos que chegaram)
  const waitingStats = useMemo(() => {
    const vals = rows.map(r => r.e.waitingMin).filter((v): v is number => v !== null)
    if (vals.length === 0) return { avg: null, max: null }
    return { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), max: Math.max(...vals) }
  }, [rows])

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
              {selectedShift} · {selectedDay}{queue ? ` · ${queue.entries.length} na fila · ${queue.fileName}` : ' · importe o QueueList'} · agora {minToHHMM(nowMin)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Janelas de carregamento */}
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
              <button onClick={() => saveWindows([...windows, { startLetter: 'A', startTime: '' }])}
                style={{ background: 'none', border: '1px dashed #2d3048', color: '#64748b', borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '2px 7px' }}>+ janela</button>
            </div>
            {queue && <Btn outline color="#a78bfa" onClick={() => setReportOpen(true)}>📊 Gerar report</Btn>}
            <AutoQueueFind onFound={(content, name) => {
              const res = parseQueueListCsv(content)
              if (!res.error) { setError(null); setQueue({ entries: res.entries, fileName: name }); queueStore.save(selectedDay, selectedShift, res.entries, name) }
              else setError(res.error)
            }} />
            <label style={{ cursor: 'pointer' }}>
              <span style={{ display: 'inline-block', background: '#7c3aed', color: '#fff', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600 }}>📤 Importar QueueList</span>
              <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = '' }} />
            </label>
            {queue && <Btn outline color="#f87171" onClick={() => { if (window.confirm('Remover a fila importada deste turno?')) { queueStore.clear(selectedDay, selectedShift); setQueue(null) } }}>🗑 Limpar</Btn>}
          </div>
        </div>
        {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f87171' }}>⚠ {error}</p>}
        {!hasValidWindows && queue && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#fbbf24' }}>⚠ Defina pelo menos uma janela de carregamento (letra + horário) para calcular os prazos.</p>}
      </div>

      {/* Tab bar — só exibe quando há dados */}
      {queue && (
        <div style={{ display: 'flex', borderBottom: '1px solid #2d3048', flexShrink: 0, paddingLeft: 20 }}>
          {(['lista', 'dashboard'] as const).map(v => (
            <button key={v} onClick={() => setActiveView(v)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeView === v ? '2px solid #7c3aed' : '2px solid transparent', background: 'transparent', color: activeView === v ? '#e2e8f0' : '#8892a4', cursor: 'pointer' }}>
              {v === 'lista' ? 'Lista' : '📊 Dashboard'}
            </button>
          ))}
        </div>
      )}

      {!queue ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, textAlign: 'center', padding: 40 }}>
          <p style={{ margin: 0, maxWidth: 420 }}>Importe o relatório <b>QueueList</b> deste turno para ver quem chegou no prazo, quem chegou fora da janela, quem está aguardando e quem está atrasado.</p>
        </div>
      ) : activeView === 'dashboard' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {(() => {
            const total = rows.length + notArrived.length
            const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0
            const pctArrived = total > 0 ? Math.round((rows.length / total) * 100) : 0
            const punctual = (onTime.length + outOfWindow.length) > 0 ? Math.round((onTime.length / (onTime.length + outOfWindow.length)) * 100) : 0
            const tlMax = timeline.length > 0 ? Math.max(...timeline.map(([, s]) => s.onTime + s.outOfWindow)) : 1

            const kpis = [
              { label: 'Total esperado', value: total, color: '#60a5fa', sub: '' },
              { label: 'Chegaram', value: rows.length, color: pctArrived >= 80 ? '#4ade80' : pctArrived >= 50 ? '#fbbf24' : '#f87171', sub: `${pctArrived}% do total` },
              { label: 'No prazo', value: onTime.length, color: '#4ade80', sub: `${pct(onTime.length)}% do total` },
              { label: 'Fora da janela', value: outOfWindow.length, color: '#fb923c', sub: `${pct(outOfWindow.length)}% do total` },
              { label: 'Aguardando', value: waiting.length, color: '#fbbf24', sub: 'não chegaram ainda' },
              { label: 'Atrasados', value: overdue.length, color: '#f87171', sub: 'passaram do prazo' },
              { label: 'Pontualidade', value: `${punctual}%`, color: punctual >= 80 ? '#4ade80' : punctual >= 50 ? '#fbbf24' : '#f87171', sub: 'dos que chegaram' },
              ...(waitingStats.avg !== null ? [{ label: 'Espera média', value: `${waitingStats.avg}min`, color: (waitingStats.avg ?? 0) >= 60 ? '#f87171' : (waitingStats.avg ?? 0) >= 30 ? '#fbbf24' : '#4ade80', sub: `máx ${waitingStats.max}min` }] : []),
            ]

            const segs = [
              { label: 'No prazo', n: onTime.length, c: '#4ade80' },
              { label: 'Fora da janela', n: outOfWindow.length, c: '#fb923c' },
              { label: 'Aguardando', n: waiting.length, c: '#fbbf24' },
              { label: 'Atrasados', n: overdue.length, c: '#f87171' },
              { label: 'Sem dados', n: unknownArrived.length + unknownLetter.length, c: '#374151' },
            ].filter(s => s.n > 0)

            return (
              <>
                {/* KPI cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {kpis.map(k => (
                    <div key={k.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '10px 16px', minWidth: 110, flex: '1 1 110px' }}>
                      <p style={{ margin: 0, fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{k.label}</p>
                      <p style={{ margin: '4px 0 2px', fontSize: 26, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</p>
                      {k.sub && <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{k.sub}</p>}
                    </div>
                  ))}
                </div>

                {/* Barra de status */}
                <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Distribuição geral</p>
                  <div style={{ display: 'flex', height: 28, borderRadius: 7, overflow: 'hidden', background: '#0f1117' }}>
                    {segs.map(s => <div key={s.label} title={`${s.label}: ${s.n} (${pct(s.n)}%)`} style={{ width: `${pct(s.n)}%`, background: s.c, transition: 'width .3s' }} />)}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
                    {segs.map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c, flexShrink: 0 }} />
                        <span style={{ color: '#94a3b8' }}>{s.label}</span>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{s.n}</span>
                        <span style={{ color: '#64748b' }}>({pct(s.n)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Por letra */}
                <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Por letra</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2d3048' }}>
                        {['Letra', 'Janela', 'No prazo', 'Fora janela', 'Aguardando', 'Atrasado', 'Pontualidade', 'Distribuição'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perLetter.map(([letter, g]) => {
                        const arrived = g.onTime + g.outOfWindow
                        const t = arrived + g.overdue + g.waiting + g.unknown
                        const pt = arrived > 0 ? Math.round((g.onTime / arrived) * 100) : null
                        const seg = [[g.onTime, '#4ade80'], [g.outOfWindow, '#fb923c'], [g.waiting, '#fbbf24'], [g.overdue, '#f87171'], [g.unknown, '#374151']] as [number, string][]
                        // Encontra a janela desta letra para mostrar o horário
                        const winInfo = (() => {
                          if (!hasValidWindows) return null
                          // Usa a primeira entrada desta letra para calcular
                          const sample = rows.find(r => r.e.letter === letter)
                          return sample ? { startMin: sample.w.startMin, arriveByMin: sample.w.arriveByMin } : null
                        })()
                        return (
                          <tr key={letter} style={{ borderBottom: '1px solid #1e2130' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{letter}</td>
                            <td style={{ padding: '8px 10px', color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
                              {winInfo ? `${minToHHMM(winInfo.arriveByMin)}→${minToHHMM(winInfo.startMin)}` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#4ade80', fontWeight: 600 }}>{g.onTime}</td>
                            <td style={{ padding: '8px 10px', color: '#fb923c', fontWeight: 600 }}>{g.outOfWindow}</td>
                            <td style={{ padding: '8px 10px', color: '#fbbf24', fontWeight: 600 }}>{g.waiting}</td>
                            <td style={{ padding: '8px 10px', color: '#f87171', fontWeight: 600 }}>{g.overdue}</td>
                            <td style={{ padding: '8px 10px' }}>
                              {pt !== null
                                ? <span style={{ color: pt >= 80 ? '#4ade80' : pt >= 50 ? '#fbbf24' : '#f87171', fontWeight: 700 }}>{pt}%</span>
                                : <span style={{ color: '#374151' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', height: 12, width: 120, borderRadius: 3, overflow: 'hidden', background: '#0f1117' }}>
                                  {seg.filter(([n]) => n > 0).map(([n, c], i) => <div key={i} style={{ width: `${t > 0 ? (n / t) * 100 : 0}%`, background: c }} />)}
                                </div>
                                <span style={{ fontSize: 10, color: '#64748b' }}>{t}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Timeline de chegadas */}
                {timeline.length > 0 && (
                  <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '14px 16px' }}>
                    <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Timeline de chegadas (slots de 15 min)</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {timeline.map(([slot, s]) => {
                        const tot = s.onTime + s.outOfWindow
                        const barW = tlMax > 0 ? Math.round((tot / tlMax) * 100) : 0
                        const onTimeW = tot > 0 ? Math.round((s.onTime / tot) * barW) : 0
                        const outW = barW - onTimeW
                        return (
                          <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b', width: 42, flexShrink: 0, textAlign: 'right' }}>{minToHHMM(slot)}</span>
                            <div style={{ flex: 1, display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', background: '#0f1117' }}>
                              {onTimeW > 0 && <div style={{ width: `${onTimeW}%`, background: '#4ade80' }} />}
                              {outW > 0 && <div style={{ width: `${outW}%`, background: '#fb923c' }} />}
                            </div>
                            <span style={{ fontSize: 11, color: '#94a3b8', width: 24, flexShrink: 0 }}>{tot}</span>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4ade80', display: 'inline-block' }} />No prazo</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#fb923c', display: 'inline-block' }} />Fora da janela</div>
                    </div>
                  </div>
                )}

                {/* Atrasados */}
                {overdue.length > 0 && (
                  <div style={{ background: '#13151f', border: '1px solid rgba(239,68,68,.25)', borderRadius: 10, padding: '14px 16px' }}>
                    <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#f87171' }}>🔴 Atrasados ({overdue.length})</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {overdue.map(n => (
                        <div key={n.driverId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: '#e2e8f0' }}>{n.name || n.driverId}</span>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{n.letter || '—'} · prazo {minToHHMM(n.arriveByMin)}</span>
                            {phoneMap.get(n.driverId) && <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 10 }}>{phoneMap.get(n.driverId)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 80 }}>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 10, padding: '12px 20px', flexWrap: 'wrap' }}>
            {[
              { label: 'Na fila', value: rows.length, color: '#60a5fa' },
              { label: '✅ No prazo', value: onTime.length, color: '#4ade80' },
              { label: '🟠 Fora da janela', value: outOfWindow.length, color: '#fb923c' },
              { label: '⏳ Aguardando', value: waiting.length, color: '#fbbf24' },
              { label: '🔴 Atrasados', value: overdue.length, color: '#f87171' },
              ...(unknownArrived.length + unknownLetter.length ? [{ label: 'Sem letra/hora', value: unknownArrived.length + unknownLetter.length, color: '#94a3b8' }] : []),
            ].map(s => (
              <div key={s.label} style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '8px 14px', minWidth: 92 }}>
                <p style={{ margin: 0, fontSize: 10, color: '#8892a4' }}>{s.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Copy actions */}
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn outline color="#f87171" onClick={() => copy('op', phones(overdue.map(n => n.driverId)))} disabled={overdue.length === 0}>📱 {lbl('op', `Tel. atrasados (${overdue.length})`)}</Btn>
            <Btn outline color="#f87171" onClick={() => copy('oi', overdue.map(n => n.driverId))} disabled={overdue.length === 0}>🆔 {lbl('oi', 'IDs')}</Btn>
            <span style={{ width: 1, height: 20, background: '#2d3048' }} />
            <Btn outline color="#fbbf24" onClick={() => copy('wp', phones(waiting.map(n => n.driverId)))} disabled={waiting.length === 0}>📱 {lbl('wp', `Tel. aguardando (${waiting.length})`)}</Btn>
            <span style={{ width: 1, height: 20, background: '#2d3048' }} />
            <Btn outline color="#fb923c" onClick={() => copy('fp', phones(outOfWindow.map(r => r.e.driverId)))} disabled={outOfWindow.length === 0}>📱 {lbl('fp', `Tel. fora da janela (${outOfWindow.length})`)}</Btn>
            <Btn outline color="#fb923c" onClick={() => copy('fi', outOfWindow.map(r => r.e.driverId))} disabled={outOfWindow.length === 0}>🆔 {lbl('fi', 'IDs')}</Btn>
            {registry.length === 0 && <span style={{ fontSize: 11, color: '#fbbf24' }}>⚠ Importe o relatório de motoristas para ter os telefones.</span>}
          </div>

          {/* Fila (quem chegou) */}
          <p style={{ margin: '0 0 6px', padding: '0 20px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Na fila ({rows.length})</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 24 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f1117', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #2d3048' }}>
                {['Motorista', 'Letra', 'Janela da letra', 'Prazo chegada', 'Chegou', 'Aguardou', 'Status', 'AT', 'Cluster'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, w }) => (
                <tr key={e.driverId + e.atId} style={{ borderBottom: '1px solid #1e2130', background: w.status === 'out-of-window' ? 'rgba(251,146,60,.05)' : 'transparent' }}>
                  <td style={TD}>
                    <span style={{ fontWeight: 500 }}>{e.driverName}</span>
                    <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{e.driverId}</span>
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>

          {/* Não chegaram (aguardando + atrasados) */}
          <div style={{ padding: '0 20px 24px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
              Não chegaram ({notArrived.length}) — <span style={{ color: '#f87171' }}>{overdue.length} atrasados</span> · <span style={{ color: '#fbbf24' }}>{waiting.length} aguardando</span>
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
                  {notArrived.map(n => (
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

function AutoQueueFind({ onFound }: { onFound: (content: string, name: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'searching' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const folder = getGlobalConfig().downloadsFolder

  if (!folder) return null

  const handleFind = async () => {
    setStatus('searching')
    const res = await findLatestFile(folder, FILE_PATTERNS.queueList)
    if ('error' in res) { setStatus('err'); setMsg(res.error) }
    else { setStatus('ok'); setMsg(res.name); onFound(res.content, res.name); setTimeout(() => setStatus('idle'), 2500) }
  }

  return (
    <button
      onClick={() => void handleFind()}
      disabled={status === 'searching'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: status === 'ok' ? 'rgba(74,222,128,.12)' : status === 'err' ? 'rgba(248,113,113,.12)' : '#7c3aed', color: status === 'ok' ? '#4ade80' : status === 'err' ? '#f87171' : '#fff', border: status === 'idle' ? 'none' : `1px solid ${status === 'ok' ? 'rgba(74,222,128,.3)' : 'rgba(248,113,113,.3)'}`, borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: status === 'searching' ? 'default' : 'pointer' }}
    >
      {status === 'searching' ? '⏳ Buscando…' : status === 'ok' ? `✓ ${msg}` : status === 'err' ? `✕ ${msg}` : '🔍 Atualizar QueueList'}
    </button>
  )
}
