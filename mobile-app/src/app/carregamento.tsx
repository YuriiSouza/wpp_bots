import { useEffect, useMemo, useState } from 'react'
import { Alert, View } from 'react-native'
import DayShiftBar from '@/components/DayShiftBar'
import { Btn, C, Card, Chip, Empty, Input, PhoneActions, Row, Screen, Segmented, Sheet, Stat, StatRow, T, copy } from '@/components/ui'
import { Legend, StackBar } from '@/components/HBar'
import { useAppData } from '@/lib/appData'
import type { Shift } from '@/lib/globalConfig'
import { routeStore } from '@/lib/routeStore'
import { queueStore } from '@/lib/queueStore'
import { computeLoadWindowMulti, extractLetter, minToHHMM, windowForLetterMulti, type LoadWindowConfig, type QueueEntry } from '@/lib/queueListParser'

const DEFAULT_WINDOWS: Record<Shift, LoadWindowConfig[]> = {
  AM: [{ startCage: 'A', startTime: '05:30' }],
  PM1: [{ startCage: 'A', startTime: '' }],
  PM2: [{ startCage: 'A', startTime: '' }],
}

type NotArrivedStatus = 'waiting' | 'overdue' | 'unknown-letter'
interface NotArrived { driverId: string; name: string; atId: string; cluster: string; gaiola: string; letter: string; arriveByMin: number | null; status: NotArrivedStatus }

function readWindows(shift: Shift): LoadWindowConfig[] {
  try { const raw = localStorage.getItem(`spx:load-windows:${shift}`); return raw ? JSON.parse(raw) : DEFAULT_WINDOWS[shift] } catch { return DEFAULT_WINDOWS[shift] }
}

export default function Carregamento() {
  const { registry, day, shift, version } = useAppData()
  const [view, setView] = useState<'lista' | 'dashboard'>('lista')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const windows = useMemo(() => readWindows(shift), [shift, version])
  const [winOpen, setWinOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })

  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }, 30000)
    return () => clearInterval(t)
  }, [])
  const saveWindows = (w: LoadWindowConfig[]) => localStorage.setItem(`spx:load-windows:${shift}`, JSON.stringify(w))

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queue = useMemo(() => queueStore.get(day, shift) as { entries: QueueEntry[]; fileName: string; importedAt: string } | null, [day, shift, version])
  const hasValidWindows = windows.some(w => w.startCage && w.startTime)
  const phoneMap = useMemo(() => new Map(registry.map(d => [d.id, (d.phoneNumber ?? '').replace(/\D/g, '')])), [registry])

  const expected = useMemo(() => {
    const map = new Map<string, { name: string; atId: string; cluster: string; gaiola: string }>()
    const routes = routeStore.get(day, shift) ?? []
    const overrides = new Map((routeStore.getOverrides(day, shift) ?? []) as [string, { driverId: string; name: string }][])
    const seen = new Set<string>()
    for (const r of routes) {
      seen.add(r.id)
      const ov = overrides.get(r.id)
      if (ov) map.set(ov.driverId, { name: ov.name, atId: r.atId, cluster: r.cluster, gaiola: r.gaiola ?? '' })
      else if (r.assignedDriverId) map.set(r.assignedDriverId, { name: r.assignedDriverName ?? '', atId: r.atId, cluster: r.cluster, gaiola: r.gaiola ?? '' })
    }
    for (const [rid, ov] of overrides) if (!seen.has(rid)) map.set(ov.driverId, { name: ov.name, atId: '', cluster: '', gaiola: '' })
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, shift, version])

  const rows = useMemo(() => (queue?.entries ?? []).map(e => ({ e, w: computeLoadWindowMulti(e, windows) })).sort((a, b) => {
    const rank = (s: string) => (s === 'out-of-window' ? 0 : s === 'unknown' ? 1 : 2)
    return rank(a.w.status) - rank(b.w.status) || a.e.letter.localeCompare(b.e.letter) || (a.e.arrivalMin ?? 0) - (b.e.arrivalMin ?? 0)
  }), [queue, windows])

  const notArrived = useMemo<NotArrived[]>(() => {
    const arrived = new Set((queue?.entries ?? []).map(e => e.driverId))
    const list: NotArrived[] = []
    for (const [driverId, info] of expected) {
      if (arrived.has(driverId)) continue
      const letter = extractLetter(info.gaiola)
      const w = windowForLetterMulti(letter, windows)
      list.push({ driverId, ...info, letter, arriveByMin: w?.arriveByMin ?? null, status: !w ? 'unknown-letter' : nowMin >= w.arriveByMin ? 'overdue' : 'waiting' })
    }
    const rank = (s: NotArrivedStatus) => (s === 'overdue' ? 0 : s === 'waiting' ? 1 : 2)
    return list.sort((a, b) => rank(a.status) - rank(b.status) || (a.arriveByMin ?? 0) - (b.arriveByMin ?? 0))
  }, [expected, queue, windows, nowMin])

  const onTime = rows.filter(r => r.w.status === 'on-time')
  const outOfWindow = rows.filter(r => r.w.status === 'out-of-window')
  const unknownArrived = rows.filter(r => r.w.status === 'unknown')
  const overdue = notArrived.filter(n => n.status === 'overdue')
  const waiting = notArrived.filter(n => n.status === 'waiting')
  const unknownLetter = notArrived.filter(n => n.status === 'unknown-letter')
  const total = rows.length + notArrived.length
  const q = search.trim().toLowerCase()
  const shownRows = !q ? rows : rows.filter(({ e }) => e.driverName.toLowerCase().includes(q) || e.driverId.includes(q) || e.atId.toLowerCase().includes(q))
  const shownNotArrived = !q ? notArrived : notArrived.filter(n => n.name.toLowerCase().includes(q) || n.driverId.includes(q) || n.atId.toLowerCase().includes(q))
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const punctual = onTime.length + outOfWindow.length > 0 ? Math.round((onTime.length / (onTime.length + outOfWindow.length)) * 100) : 0

  const timeline = useMemo(() => {
    const slots = new Map<number, { onTime: number; out: number }>()
    for (const { e, w } of rows) {
      if (e.arrivalMin === null) continue
      const slot = Math.floor(e.arrivalMin / 15) * 15
      const s = slots.get(slot) ?? { onTime: 0, out: 0 }
      if (w.status === 'on-time') s.onTime++; else s.out++
      slots.set(slot, s)
    }
    return [...slots.entries()].sort((a, b) => a[0] - b[0])
  }, [rows])

  const waitVals = rows.map(r => r.e.waitingMin).filter((v): v is number => v !== null)
  const waitAvg = waitVals.length ? Math.round(waitVals.reduce((a, b) => a + b, 0) / waitVals.length) : null

  const perLetter = useMemo(() => {
    const m = new Map<string, { onTime: number; out: number; overdue: number; waiting: number; unknown: number }>()
    const g = (l: string) => { const k = l || '—'; const x = m.get(k) ?? { onTime: 0, out: 0, overdue: 0, waiting: 0, unknown: 0 }; m.set(k, x); return x }
    for (const { e, w } of rows) { const x = g(e.letter); if (w.status === 'on-time') x.onTime++; else if (w.status === 'out-of-window') x.out++; else x.unknown++ }
    for (const n of notArrived) { const x = g(n.letter); if (n.status === 'overdue') x.overdue++; else if (n.status === 'waiting') x.waiting++; else x.unknown++ }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, notArrived])

  const doCopy = async (key: string, values: string[]) => {
    const clean = [...new Set(values.filter(Boolean))]
    if (!clean.length) return
    await copy(clean.join('\n'))
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 2000)
  }
  const lbl = (k: string, base: string) => (copiedKey === k ? '✓ Copiado!' : base)
  const phones = (ids: string[]) => ids.map(id => phoneMap.get(id) ?? '')
  const winLabel = windows.filter(w => w.startTime).map(w => `${w.startCage}=${w.startTime}`).join(', ') || '—'

  const segs = [
    { label: 'No prazo', n: onTime.length, c: '#4ade80' },
    { label: 'Fora da janela', n: outOfWindow.length, c: '#fb923c' },
    { label: 'Aguardando', n: waiting.length, c: '#fbbf24' },
    { label: 'Atrasados', n: overdue.length, c: '#f87171' },
    { label: 'Sem letra/hora', n: unknownArrived.length + unknownLetter.length, c: '#4b5563' },
  ].filter(s => s.n > 0)

  const reportText = () => {
    const L = [
      `🚚 Report de Carregamento — ${day.split('-').reverse().join('/')}`,
      `Turno: ${shift} · Janelas: ${winLabel} · Gerado ${minToHHMM(nowMin)}`, '',
      `👥 Na fila: ${rows.length}`,
      `✅ No prazo: ${onTime.length} (${pct(onTime.length)}%)`,
      `🟠 Fora da janela: ${outOfWindow.length} (${pct(outOfWindow.length)}%)`,
      `⏳ Aguardando: ${waiting.length}`,
      `🔴 Atrasados (não chegaram): ${overdue.length}`,
      `🎯 Pontualidade (dos que chegaram): ${punctual}%`,
    ]
    if (overdue.length) { L.push('', '🔴 Atrasados:'); for (const n of overdue) L.push(`- ${n.name || n.driverId} (letra ${n.letter || '—'}, prazo ${minToHHMM(n.arriveByMin)})${phoneMap.get(n.driverId) ? ` — ${phoneMap.get(n.driverId)}` : ''}`) }
    if (outOfWindow.length) { L.push('', '🟠 Fora da janela:'); for (const r of outOfWindow) L.push(`- ${r.e.driverName || r.e.driverId} (letra ${r.e.letter || '—'}, +${r.w.lateMin} min)`) }
    return L.join('\n')
  }

  const header = (
    <View style={{ gap: 10 }}>
      <T size={11} color={C.muted}>{queue ? `${queue.entries.length} na fila · ${queue.fileName}` : 'Sem QueueList para este turno'} · agora {minToHHMM(nowMin)}</T>
      <Row>
        <Btn small variant="outline" onPress={() => setWinOpen(true)}>{`⏱ Janelas: ${winLabel}`}</Btn>
        {queue && <Btn small variant="outline" onPress={() => setReportOpen(true)}><T size={12} bold color="#a78bfa">📊 Report</T></Btn>}
        {queue && <Btn small variant="danger" onPress={() => Alert.alert('Limpar fila', 'Remover a fila importada deste turno?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Remover', style: 'destructive', onPress: () => queueStore.clear(day, shift) }])}>🗑</Btn>}
      </Row>
      {!hasValidWindows && queue && <T size={12} color={C.yellow}>⚠ Defina pelo menos uma janela (gaiola + horário) para calcular os prazos.</T>}
      {queue && <Segmented value={view} onChange={setView} options={[{ value: 'lista', label: 'Lista' }, { value: 'dashboard', label: '📊 Dashboard' }]} colors={{ lista: C.accent, dashboard: C.accent }} />}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <DayShiftBar />
      <Screen>
        {header}
        {!queue ? (
          <Empty title="Sem QueueList deste turno." sub="Importe o QueueList no PC (Carregamento → Atualizar QueueList) e sincronize para acompanhar as chegadas aqui." />
        ) : view === 'dashboard' ? (
          <>
            <StatRow>
              <Stat label="Esperados" value={total} color={C.blue} />
              <Stat label="Chegaram" value={rows.length} color={pct(rows.length) >= 80 ? C.green : pct(rows.length) >= 50 ? C.yellow : C.red} sub={`${pct(rows.length)}%`} />
              <Stat label="No prazo" value={onTime.length} color="#4ade80" sub={`${pct(onTime.length)}%`} />
              <Stat label="Fora da janela" value={outOfWindow.length} color="#fb923c" sub={`${pct(outOfWindow.length)}%`} />
              <Stat label="Aguardando" value={waiting.length} color="#fbbf24" />
              <Stat label="Atrasados" value={overdue.length} color="#f87171" />
              <Stat label="Pontualidade" value={`${punctual}%`} color={punctual >= 80 ? C.green : punctual >= 50 ? C.yellow : C.red} />
              {waitAvg !== null && <Stat label="Espera média" value={`${waitAvg}min`} color={waitAvg >= 60 ? C.red : waitAvg >= 30 ? C.yellow : C.green} sub={`máx ${Math.max(...waitVals)}min`} />}
            </StatRow>
            <Card>
              <T bold size={12}>Distribuição geral</T>
              <StackBar parts={segs.map(s => ({ key: s.label, value: s.n, color: s.c }))} />
              <Legend items={segs.map(s => ({ label: s.label, value: `${s.n} (${pct(s.n)}%)`, color: s.c }))} />
            </Card>
            <Card>
              <T bold size={12}>Por letra</T>
              {perLetter.map(([letter, g]) => {
                const arrived = g.onTime + g.out
                const pt = arrived > 0 ? Math.round((g.onTime / arrived) * 100) : null
                const w = hasValidWindows ? windowForLetterMulti(letter, windows) : null
                return (
                  <View key={letter} style={{ gap: 4, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <T size={15} bold>{letter}{w ? <T size={11} mono color={C.dim}>  {minToHHMM(w.arriveByMin)}→{minToHHMM(w.startMin)}</T> : null}</T>
                      {pt !== null ? <T bold color={pt >= 80 ? C.green : pt >= 50 ? C.yellow : C.red}>{pt}%</T> : null}
                    </Row>
                    <StackBar parts={[{ key: 'a', value: g.onTime, color: '#4ade80' }, { key: 'b', value: g.out, color: '#fb923c' }, { key: 'c', value: g.waiting, color: '#fbbf24' }, { key: 'd', value: g.overdue, color: '#f87171' }, { key: 'e', value: g.unknown, color: '#374151' }]} />
                    <T size={11} color={C.sub}><T size={11} color="#4ade80">{g.onTime} prazo</T> · <T size={11} color="#fb923c">{g.out} fora</T> · <T size={11} color="#fbbf24">{g.waiting} aguard.</T> · <T size={11} color="#f87171">{g.overdue} atras.</T></T>
                  </View>
                )
              })}
            </Card>
            {timeline.length > 0 && (
              <Card>
                <T bold size={12}>Chegadas (slots de 15 min)</T>
                {timeline.map(([slot, s]) => {
                  const max = Math.max(...timeline.map(([, x]) => x.onTime + x.out))
                  const tot = s.onTime + s.out
                  return (
                    <Row key={slot} gap={8}>
                      <T size={11} mono color={C.dim} style={{ width: 42 }}>{minToHHMM(slot)}</T>
                      <View style={{ flex: 1, flexDirection: 'row', height: 14, borderRadius: 4, overflow: 'hidden', backgroundColor: C.bg }}>
                        <View style={{ width: `${(s.onTime / max) * 100}%`, backgroundColor: '#4ade80' }} />
                        <View style={{ width: `${(s.out / max) * 100}%`, backgroundColor: '#fb923c' }} />
                      </View>
                      <T size={11} color={C.sub} style={{ width: 24 }}>{tot}</T>
                    </Row>
                  )
                })}
              </Card>
            )}
          </>
        ) : (
          <>
            <StatRow>
              <Stat label="Na fila" value={rows.length} color={C.blue} />
              <Stat label="✅ No prazo" value={onTime.length} color="#4ade80" />
              <Stat label="🟠 Fora janela" value={outOfWindow.length} color="#fb923c" />
              <Stat label="⏳ Aguardando" value={waiting.length} color="#fbbf24" />
              <Stat label="🔴 Atrasados" value={overdue.length} color="#f87171" />
            </StatRow>
            <Row gap={6}>
              <Btn small variant="danger" disabled={!overdue.length} onPress={() => doCopy('op', phones(overdue.map(n => n.driverId)))}>{lbl('op', `📱 Atrasados (${overdue.length})`)}</Btn>
              <Btn small variant="outline" disabled={!overdue.length} onPress={() => doCopy('oi', overdue.map(n => n.driverId))}>{lbl('oi', '🆔 IDs')}</Btn>
              <Btn small variant="outline" disabled={!waiting.length} onPress={() => doCopy('wp', phones(waiting.map(n => n.driverId)))}>{lbl('wp', `📱 Aguardando (${waiting.length})`)}</Btn>
              <Btn small variant="outline" disabled={!outOfWindow.length} onPress={() => doCopy('fp', phones(outOfWindow.map(r => r.e.driverId)))}>{lbl('fp', `📱 Fora janela (${outOfWindow.length})`)}</Btn>
              <Btn small variant="outline" disabled={!outOfWindow.length} onPress={() => doCopy('fi', outOfWindow.map(r => r.e.driverId))}>{lbl('fi', '🆔 IDs')}</Btn>
            </Row>
            {registry.length === 0 && <T size={11} color={C.yellow}>⚠ Sem cadastro de motoristas: telefones indisponíveis.</T>}

            <Input value={search} onChangeText={setSearch} placeholder="🔍 Motorista, ID ou AT" />
            <T bold>Não chegaram ({q ? `${shownNotArrived.length} de ${notArrived.length}` : notArrived.length}) — <T bold color={C.red}>{overdue.length} atrasados</T> · <T bold color={C.yellow}>{waiting.length} aguardando</T></T>
            {expected.size === 0 ? <T size={12} color={C.dim}>Nenhuma rota atribuída neste turno — sem base para comparar.</T>
              : notArrived.length === 0 ? <T size={12} color={C.green}>✅ Todos com rota atribuída já estão na fila.</T>
              : shownNotArrived.map(n => (
                <Card key={n.driverId} style={n.status === 'overdue' ? { borderColor: 'rgba(239,68,68,.35)' } : undefined}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T bold style={{ flex: 1 }}>{n.name || n.driverId}</T>
                    <Chip label={n.status === 'overdue' ? '🔴 Atrasado' : n.status === 'waiting' ? '⏳ Aguardando' : '— sem gaiola'} color={n.status === 'overdue' ? C.red : n.status === 'waiting' ? C.yellow : C.sub} />
                  </Row>
                  <T size={11} color={C.sub}>Letra <T size={11} bold>{n.letter || '—'}</T> {n.gaiola} · prazo {minToHHMM(n.arriveByMin)} · {n.atId || '—'} · {n.cluster || '—'}</T>
                  <PhoneActions phone={phoneMap.get(n.driverId) || null} />
                </Card>
              ))}

            <T bold>Na fila ({q ? `${shownRows.length} de ${rows.length}` : rows.length})</T>
            {shownRows.map(({ e, w }) => (
              <Card key={e.driverId + e.atId} style={w.status === 'out-of-window' ? { borderColor: 'rgba(251,146,60,.35)' } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T bold style={{ flex: 1 }}>{e.driverName}</T>
                  <Chip label={w.status === 'out-of-window' ? `🟠 +${w.lateMin} min` : w.status === 'on-time' ? '✅ No prazo' : '— sem letra/hora'} color={w.status === 'out-of-window' ? '#fb923c' : w.status === 'on-time' ? C.green : C.sub} />
                </Row>
                <T size={10} mono color={C.dim}>{e.driverId}</T>
                <T size={11} color={C.sub}>Letra <T size={11} bold>{e.letter || '—'}</T> {e.cage} · janela {minToHHMM(w.startMin)}{w.startMin !== null ? `–${minToHHMM(w.startMin + 20)}` : ''} · prazo {minToHHMM(w.arriveByMin)}</T>
                <T size={11} color={C.sub}>Chegou {minToHHMM(e.arrivalMin)} · aguardou <T size={11} color={e.waitingMin !== null ? (e.waitingMin >= 60 ? C.red : e.waitingMin >= 30 ? C.yellow : C.green) : C.dim}>{e.waitingTime || '—'}</T> · {e.atId} · {e.cluster}</T>
              </Card>
            ))}
          </>
        )}
      </Screen>

      <Sheet open={winOpen} onClose={() => setWinOpen(false)} title={`Janelas de carregamento — ${shift}`}>
        <T size={12} color={C.muted}>Gaiola onde a janela começa (ex: A ou D-7) e o horário de início do carregamento.</T>
        {windows.map((w, i) => (
          <Row key={i}>
            <Input value={w.startCage} onChangeText={v => saveWindows(windows.map((x, j) => (j === i ? { ...x, startCage: v.toUpperCase() } : x)))} placeholder="A ou D-7" style={{ width: 90 }} />
            <Input value={w.startTime} onChangeText={v => saveWindows(windows.map((x, j) => (j === i ? { ...x, startTime: v } : x)))} placeholder="05:30" keyboardType="numbers-and-punctuation" style={{ width: 90 }} />
            {windows.length > 1 && <Btn small variant="ghost" onPress={() => saveWindows(windows.filter((_, j) => j !== i))}>✕</Btn>}
          </Row>
        ))}
        <Btn variant="outline" onPress={() => saveWindows([...windows, { startCage: 'A', startTime: '' }])}>+ janela</Btn>
      </Sheet>

      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title="📊 Report de Carregamento">
        <T size={11} color={C.dim}>{shift} · {day.split('-').reverse().join('/')} · {winLabel} · agora {minToHHMM(nowMin)}</T>
        <StackBar parts={segs.map(s => ({ key: s.label, value: s.n, color: s.c }))} />
        <Legend items={segs.map(s => ({ label: s.label, value: `${s.n} · ${pct(s.n)}%`, color: s.c }))} />
        <Card><T size={12} mono>{reportText()}</T></Card>
        <Btn onPress={() => doCopy('rep', [reportText()])}>{copiedKey === 'rep' ? '✓ Copiado!' : '📋 Copiar resumo'}</Btn>
      </Sheet>
    </View>
  )
}
