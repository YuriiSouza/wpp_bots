import { useMemo, useState, useEffect } from 'react'
import type { Shift } from '../../lib/globalConfig'
import type { StoredDriver } from '../../lib/localStore'
import { routeStore } from '../../lib/routeStore'
import { queueStore } from '../../lib/queueStore'
import { parseQueueListCsv, computeLoadWindow, windowForLetter, extractLetter, minToHHMM, parseTimeToMinutes, type QueueEntry } from '../../lib/queueListParser'

interface Props {
  registry: StoredDriver[]
  selectedDay: string
  selectedShift: Shift
}

const DEFAULT_START: Record<Shift, string> = { AM: '05:30', PM1: '', PM2: '' }

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

  const startKey = `spx:load-start:${selectedShift}`
  const [startStr, setStartStr] = useState('')

  // Relógio real (atualiza a cada 30s) para separar "aguardando" de "atrasado"
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const saved = queueStore.get(selectedDay, selectedShift)
    setQueue(saved ? { entries: saved.entries, fileName: saved.fileName } : null)
    setError(null)
    setStartStr(localStorage.getItem(startKey) ?? DEFAULT_START[selectedShift])
  }, [selectedDay, selectedShift, startKey])

  // Recalcula os "esperados" quando a janela recebe foco (ex.: voltou da tela de Atribuição após mudar rotas)
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    const onFocus = () => setRefreshTick(t => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const setStart = (v: string) => { setStartStr(v); try { localStorage.setItem(startKey, v) } catch { /* */ } }
  const baseStartMin = parseTimeToMinutes(startStr)

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
    return entries.map(e => ({ e, w: computeLoadWindow(e, baseStartMin ?? 330) }))
      .sort((a, b) => {
        const rank = (s: string) => (s === 'out-of-window' ? 0 : s === 'unknown' ? 1 : 2)
        return rank(a.w.status) - rank(b.w.status) || a.e.letter.localeCompare(b.e.letter) || (a.e.arrivalMin ?? 0) - (b.e.arrivalMin ?? 0)
      })
  }, [queue, baseStartMin])

  const arrivedIds = useMemo(() => new Set((queue?.entries ?? []).map(e => e.driverId)), [queue])

  const notArrived = useMemo<NotArrived[]>(() => {
    const base = baseStartMin ?? 330
    const list: NotArrived[] = []
    for (const [driverId, info] of expected) {
      if (arrivedIds.has(driverId)) continue
      const letter = extractLetter(info.gaiola)
      const w = windowForLetter(letter, base)
      let status: NotArrivedStatus
      if (!w) status = 'unknown-letter'
      else status = nowMin >= w.arriveByMin ? 'overdue' : 'waiting'
      list.push({ driverId, ...info, letter, arriveByMin: w?.arriveByMin ?? null, status })
    }
    const rank = (s: NotArrivedStatus) => (s === 'overdue' ? 0 : s === 'waiting' ? 1 : 2)
    return list.sort((a, b) => rank(a.status) - rank(b.status) || (a.arriveByMin ?? 0) - (b.arriveByMin ?? 0))
  }, [expected, arrivedIds, baseStartMin, nowMin])

  const onTime = rows.filter(r => r.w.status === 'on-time')
  const outOfWindow = rows.filter(r => r.w.status === 'out-of-window')
  const unknownArrived = rows.filter(r => r.w.status === 'unknown')
  const overdue = notArrived.filter(n => n.status === 'overdue')
  const waiting = notArrived.filter(n => n.status === 'waiting')
  const unknownLetter = notArrived.filter(n => n.status === 'unknown-letter')

  const [reportOpen, setReportOpen] = useState(false)

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
            <label style={{ fontSize: 11, color: '#8892a4' }}>Início da letra A:{' '}
              <input type="time" value={startStr} onChange={e => setStart(e.target.value)}
                style={{ background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none' }} />
            </label>
            {queue && <Btn outline color="#a78bfa" onClick={() => setReportOpen(true)}>📊 Gerar report</Btn>}
            <label style={{ cursor: 'pointer' }}>
              <span style={{ display: 'inline-block', background: '#7c3aed', color: '#fff', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600 }}>📤 Importar QueueList</span>
              <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = '' }} />
            </label>
            {queue && <Btn outline color="#f87171" onClick={() => { if (window.confirm('Remover a fila importada deste turno?')) { queueStore.clear(selectedDay, selectedShift); setQueue(null) } }}>🗑 Limpar</Btn>}
          </div>
        </div>
        {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f87171' }}>⚠ {error}</p>}
        {!baseStartMin && queue && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#fbbf24' }}>⚠ Defina o horário de início do carregamento (letra A) para calcular os prazos.</p>}
      </div>

      {!queue ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, textAlign: 'center', padding: 40 }}>
          <p style={{ margin: 0, maxWidth: 420 }}>Importe o relatório <b>QueueList</b> deste turno para ver quem chegou no prazo, quem chegou fora da janela, quem está aguardando e quem está atrasado.</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
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
                {['Motorista', 'Letra', 'Janela da letra', 'Prazo chegada', 'Chegou', 'Status', 'AT', 'Cluster'].map(h => <th key={h} style={TH}>{h}</th>)}
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
            `Turno: ${selectedShift} · Início letra A: ${startStr || '—'} · Gerado ${minToHHMM(nowMin)}`,
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
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>{selectedShift} · {dateFmt} · início letra A {startStr || '—'} · agora {minToHHMM(nowMin)}</p>
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
