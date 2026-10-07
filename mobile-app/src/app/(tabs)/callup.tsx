import { useMemo, useState } from 'react'
import { coversCluster } from '@/lib/clusterMatch'
import { FlatList, View } from 'react-native'
import { Bar, Btn, C, Card, Chip, Empty, Input, NeedsData, Row, Segmented, SHIFT_COLOR, Sheet, Stat, StatRow, T, copy, fmtDate, rateColor } from '@/components/ui'
import { DayBars } from '@/components/DayBars'
import { useAppData } from '@/lib/appData'
import type { FirstCallAnalysis, FirstCallRoute } from '@/lib/callUpParser'
import type { Shift } from '@/lib/globalConfig'

type ShiftF = 'all' | Shift
const REGION_REASON = 'Fora da região de preferência'

function defaultMonthRange(dates: string[]) {
  if (!dates.length) return { from: '', to: '' }
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let month = dates.filter(d => d.startsWith(ym))
  if (!month.length) { const latest = [...dates].sort().slice(-1)[0].slice(0, 7); month = dates.filter(d => d.startsWith(latest)) }
  const s = [...month].sort()
  return { from: s[0], to: s[s.length - 1] }
}

const routeDate = (r: FirstCallRoute) => (r.triggerTime ? r.triggerTime.slice(0, 10).replace(/\//g, '-') : null)

function regionCheck(r: FirstCallRoute, wp: Map<string, string[]>) {
  const dc = wp.get(r.driverId)
  if (!dc) return { label: 'sem dados WP', color: C.dim, clusters: null as string[] | null, hasAll: false }
  const hasAll = dc.some(c => c.toUpperCase() === 'ALL')
  const has = hasAll || coversCluster(dc, r.cluster)
  return { label: hasAll ? '✓ ALL' : has ? '✓ tem disponibilidade' : '✗ fora mesmo', color: has ? C.green : C.red, clusters: dc, hasAll }
}

function DatePickerSheet({ open, onClose, dates, from, to, onChange }: { open: boolean; onClose: () => void; dates: string[]; from: string; to: string; onChange: (f: string, t: string) => void }) {
  const [step, setStep] = useState<'from' | 'to'>('from')
  const sorted = [...dates].sort().reverse()
  return (
    <Sheet open={open} onClose={() => { setStep('from'); onClose() }} title={step === 'from' ? 'Início do período' : 'Fim do período'}>
      <Row>
        <Btn small variant="outline" onPress={() => { onChange('', ''); setStep('from'); onClose() }}>Todo o período</Btn>
        <Btn small variant="outline" onPress={() => { const r = defaultMonthRange(dates); onChange(r.from, r.to); setStep('from'); onClose() }}>Mês atual</Btn>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {sorted.map(d => {
          const edge = d === from || d === to
          const inRange = from && to && d > from && d < to
          return (
            <Btn key={d} small variant={edge ? 'default' : 'outline'} style={inRange ? { backgroundColor: 'rgba(59,130,246,.15)' } : undefined}
              onPress={() => {
                if (step === 'from') { onChange(d, to && d > to ? '' : to); setStep('to') }
                else { if (d < from) onChange(d, from); else onChange(from, d); setStep('from'); onClose() }
              }}>
              {fmtDate(d).slice(0, 5)}
            </Btn>
          )
        })}
      </View>
    </Sheet>
  )
}

function ReportSheet({ open, onClose, routes, periodLabel, shiftFilter, wp, fileName, vehicleOf }: {
  open: boolean; onClose: () => void; routes: FirstCallRoute[]; periodLabel: string; shiftFilter: ShiftF; wp: Map<string, string[]>; fileName: string; vehicleOf: (id: string) => string | undefined
}) {
  const total = routes.length
  const accepted = routes.filter(r => r.status === 'Accepted').length
  const declined = routes.filter(r => r.status === 'Declined').length
  const rate = total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0
  const reasonMap: Record<string, number> = {}
  for (const r of routes) if (r.status === 'Declined' && r.declineReason) reasonMap[r.declineReason] = (reasonMap[r.declineReason] ?? 0) + 1
  const reasons = Object.entries(reasonMap).sort((a, b) => b[1] - a[1])
  const cm: Record<string, { total: number; accepted: number }> = {}
  for (const r of routes) { if (!r.cluster) continue; cm[r.cluster] ??= { total: 0, accepted: 0 }; cm[r.cluster].total++; if (r.status === 'Accepted') cm[r.cluster].accepted++ }
  const clusters = Object.entries(cm).map(([cluster, s]) => ({ cluster, rate: s.total > 0 ? Math.round((s.accepted / s.total) * 100) : 0 })).sort((a, b) => a.rate - b.rate).slice(0, 12)
  const declinedRegion = routes.filter(r => r.status === 'Declined' && r.declineReason === REGION_REASON)
  const mismatch = declinedRegion.filter(r => { const dc = wp.get(r.driverId); return !!dc && !dc.some(c => c.toUpperCase() === 'ALL') && coversCluster(dc, r.cluster) })
  const maxReason = reasons[0]?.[1] ?? 1
  return (
    <Sheet open={open} onClose={onClose} title={<View><T size={16} bold>Relatório de Call Up</T><T size={11} color={C.dim}>{periodLabel}{shiftFilter !== 'all' ? ` · Turno ${shiftFilter}` : ''}</T></View>}>
      <StatRow>
        <Stat label="ATs" value={total} color={C.blue} />
        <Stat label="Aceitas" value={accepted} color={C.green} />
        <Stat label="Recusadas" value={declined} color={C.red} />
        <Stat label="Taxa aceite" value={`${rate}%`} color={rateColor(rate)} />
      </StatRow>
      {reasons.length > 0 && (
        <Card>
          <T bold size={12}>Motivos de recusa</T>
          {reasons.map(([reason, count]) => (
            <View key={reason} style={{ gap: 3 }}>
              <Row style={{ justifyContent: 'space-between' }}><T size={11} color={C.sub} style={{ flex: 1 }}>{reason}</T><T size={11} bold color={C.red}>{count}×</T></Row>
              <Bar value={(count / maxReason) * 100} color="#ef4444" />
            </View>
          ))}
        </Card>
      )}
      {clusters.length > 0 && (
        <Card>
          <T bold size={12}>12 piores clusters</T>
          {clusters.map(c => (
            <Row key={c.cluster}>
              <T size={11} color={C.sub} numberOfLines={1} style={{ width: 110 }}>{c.cluster}</T>
              <View style={{ flex: 1 }}><Bar value={c.rate} color={rateColor(c.rate)} /></View>
              <T size={11} bold color={rateColor(c.rate)} style={{ width: 36, textAlign: 'right' }}>{c.rate}%</T>
            </Row>
          ))}
        </Card>
      )}
      {declinedRegion.length > 0 && (
        <Card>
          <T bold size={12}>“{REGION_REASON}” — {declinedRegion.length}</T>
          {mismatch.length > 0 && <T size={11} color={C.yellow}>⚠️ {mismatch.length} desses têm disponibilidade para o cluster enviado (justificativa incorreta)</T>}
          {declinedRegion.map((r, i) => {
            const rc = regionCheck(r, wp)
            return (
              <View key={r.atId + i} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, gap: 2 }}>
                <T size={12}>{r.driverName} <T size={10} mono color={C.dim}>{r.driverId}</T> {vehicleOf(r.driverId) ? <T size={10} color={C.faint}>{vehicleOf(r.driverId)}</T> : null}</T>
                <T size={11} color={C.sub}>Enviado: {r.cluster || '—'} · WP: {rc.clusters ? (rc.hasAll ? 'TODAS' : rc.clusters.join(', ')) : '—'}</T>
                <T size={11} bold color={rc.color}>{rc.label}</T>
              </View>
            )
          })}
        </Card>
      )}
      <T size={10} color={C.faint}>Gerado em {new Date().toLocaleString('pt-BR')} · {fileName}</T>
    </Sheet>
  )
}

export default function CallUpScreen() {
  const { callUp, workPref, registry, driverMeta } = useAppData()
  const fc: FirstCallAnalysis = callUp?.firstCallAnalysis ?? { totalRoutes: 0, accepted: 0, declined: 0, acceptanceRate: 0, declineReasonSummary: {}, routes: [], byDriver: [], byDate: [] }
  const allDates = useMemo(() => fc.byDate.map(d => d.date), [fc.byDate])
  const initial = useMemo(() => defaultMonthRange(allDates), [allDates])
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [shiftFilter, setShiftFilter] = useState<ShiftF>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Accepted' | 'Declined' | 'Pending'>('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [driverView, setDriverView] = useState(false)
  const [routeSearch, setRouteSearch] = useState('')
  const [driverSearch, setDriverSearch] = useState('')
  const [rateFilter, setRateFilter] = useState<'all' | 'high' | 'mid' | 'low'>('all')
  const [dateOpen, setDateOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const wp = useMemo(() => new Map((workPref?.drivers ?? []).map(d => [d.driverId, d.clusters])), [workPref])
  const phoneMap = useMemo(() => new Map(registry.filter(d => d.phoneNumber).map(d => [d.id, d.phoneNumber])), [registry])

  const inPeriod = (d: string | null) => !(dateFrom || dateTo) || (!!d && (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo))

  const chartData = useMemo(() => {
    if (shiftFilter === 'all') return fc.byDate.filter(d => inPeriod(d.date)).map(d => ({ date: d.date, value: d.acceptanceRate, accepted: d.accepted, total: d.total }))
    const m = new Map<string, { total: number; accepted: number }>()
    for (const r of fc.routes) {
      if (r.shift !== shiftFilter || r.status === 'Cancelled' || r.status === 'Pending') continue
      const d = routeDate(r)
      if (!d || !inPeriod(d)) continue
      const e = m.get(d) ?? { total: 0, accepted: 0 }
      e.total++; if (r.status === 'Accepted') e.accepted++
      m.set(d, e)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => ({ date, value: d.total ? Math.round((d.accepted / d.total) * 1000) / 10 : 0, accepted: d.accepted, total: d.total }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, dateFrom, dateTo, shiftFilter])

  const kpi = useMemo(() => {
    let accepted = 0, declined = 0, pending = 0
    for (const r of fc.routes) {
      if (shiftFilter !== 'all' && r.shift !== shiftFilter) continue
      if (!inPeriod(routeDate(r))) continue
      if (r.status === 'Accepted') accepted++; else if (r.status === 'Declined') declined++; else if (r.status === 'Pending') pending++
    }
    const total = accepted + declined
    return { total, accepted, declined, pending, rate: total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0 }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc.routes, shiftFilter, dateFrom, dateTo])

  const filteredRoutes = useMemo(() => {
    const q = routeSearch.toLowerCase()
    return fc.routes.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (shiftFilter !== 'all' && r.shift !== shiftFilter) return false
      if (reasonFilter !== 'all' && r.declineReason !== reasonFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(routeDate(r))) return false
      if (q && !r.atId.toLowerCase().includes(q) && !r.driverName.toLowerCase().includes(q) && !r.cluster.toLowerCase().includes(q)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc.routes, routeSearch, statusFilter, shiftFilter, reasonFilter, dateFrom, dateTo])

  const filteredDrivers = useMemo(() => {
    const m = new Map<string, { driverId: string; driverName: string; accepted: number; declined: number; total: number; declineReasons: Record<string, number> }>()
    for (const r of filteredRoutes) {
      const d = m.get(r.driverId) ?? { driverId: r.driverId, driverName: r.driverName, accepted: 0, declined: 0, total: 0, declineReasons: {} }
      d.total++
      if (r.status === 'Accepted') d.accepted++
      else if (r.status === 'Declined') { d.declined++; if (r.declineReason) d.declineReasons[r.declineReason] = (d.declineReasons[r.declineReason] ?? 0) + 1 }
      m.set(r.driverId, d)
    }
    const q = driverSearch.toLowerCase()
    return [...m.values()]
      .map(d => ({ ...d, acceptanceRate: d.total > 0 ? Math.round((d.accepted / d.total) * 100) : 0 }))
      .filter(d => {
        if (q && !d.driverName.toLowerCase().includes(q) && !d.driverId.includes(q)) return false
        if (rateFilter === 'high' && d.acceptanceRate < 70) return false
        if (rateFilter === 'mid' && (d.acceptanceRate < 40 || d.acceptanceRate >= 70)) return false
        if (rateFilter === 'low' && d.acceptanceRate >= 40) return false
        return true
      })
      .sort((a, b) => a.acceptanceRate - b.acceptanceRate)
  }, [filteredRoutes, driverSearch, rateFilter])

  const allReasons = useMemo(() => [...new Set(fc.routes.filter(r => r.status === 'Declined' && r.declineReason).map(r => r.declineReason!))].sort(), [fc.routes])
  const topReasons = Object.entries(fc.declineReasonSummary).sort((a, b) => b[1] - a[1])

  if (!callUp) return <NeedsData what="Call Up" />
  if (!callUp.firstCallAnalysis) return <Empty title="Relatório de Call Up desatualizado." sub="Reimporte o CSV do Call Up no PC e sincronize." />

  const periodLabel = dateFrom && dateTo ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}` : dateFrom ? `a partir de ${fmtDate(dateFrom)}` : dateTo ? `até ${fmtDate(dateTo)}` : 'Todo o período'
  const meta = (id: string) => driverMeta.get(id)
  const lineColor = shiftFilter !== 'all' ? SHIFT_COLOR[shiftFilter] : C.blue

  const header = (
    <View style={{ gap: 12, marginBottom: 4 }}>
      <T size={11} color={C.muted}>{callUp.totalCalls.toLocaleString('pt-BR')} chamadas · {callUp.fileName} · {new Date(callUp.importedAt).toLocaleDateString('pt-BR')}</T>
      <Row>
        <Btn small variant="outline" onPress={() => setDateOpen(true)}>{`📅 ${periodLabel}`}</Btn>
        <Btn small variant="outline" onPress={() => setReportOpen(true)}><T size={12} bold color="#a78bfa">📊 Report</T></Btn>
      </Row>
      <Segmented<ShiftF> value={shiftFilter} onChange={setShiftFilter} options={[{ value: 'all', label: 'Todos turnos' }, { value: 'AM', label: 'AM' }, { value: 'PM1', label: 'PM1' }, { value: 'PM2', label: 'PM2' }]} colors={SHIFT_COLOR} />
      <StatRow>
        <Stat label="ATs respondidas" value={kpi.total} color={C.blue} />
        <Stat label="1ª aceita" value={kpi.accepted} color={C.green} />
        <Stat label="1ª recusada" value={kpi.declined} color={C.red} />
        {kpi.pending > 0 && <Stat label="Aguardando resposta" value={kpi.pending} color={C.yellow} />}
        <Stat label="Taxa de aceite" value={`${kpi.rate}%`} color={rateColor(kpi.rate)} />
      </StatRow>
      {fc.byDate.length > 0 && (
        <Card>
          <T bold size={12}>% aceite na 1ª chamada por dia</T>
          <DayBars data={chartData} color={lineColor} detail={i => `${chartData[i].value}% (${chartData[i].accepted}/${chartData[i].total})`} />
        </Card>
      )}
      {topReasons.length > 0 && (
        <Card>
          <T bold size={12}>Motivos de recusa (1ª chamada)</T>
          <Row gap={6}>
            {topReasons.map(([reason, count]) => <Chip key={reason} color={C.red} bg="rgba(239,68,68,.08)" label={`${count}× ${reason} (${fc.declined > 0 ? Math.round((count / fc.declined) * 100) : 0}%)`} />)}
          </Row>
        </Card>
      )}
      <Segmented value={driverView ? 'd' : 'r'} onChange={v => setDriverView(v === 'd')} options={[{ value: 'r', label: 'Por AT' }, { value: 'd', label: 'Por Motorista' }]} colors={{ r: C.accent, d: C.accent }} />
      {!driverView ? (
        <>
          <Input value={routeSearch} onChangeText={setRouteSearch} placeholder="🔍 AT ID, motorista ou cluster" />
          <Segmented value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'Todas' }, { value: 'Accepted', label: 'Aceitas' }, { value: 'Declined', label: 'Recusadas' }, { value: 'Pending', label: 'Pendentes' }]} colors={{ Pending: C.yellow, Accepted: C.green, Declined: C.red }} />
          <Row>
            <T size={12} color={C.dim}>{filteredRoutes.length} ATs</T>
            {allReasons.length > 0 && <Btn small variant="outline" onPress={() => setReasonOpen(true)}>{reasonFilter === 'all' ? 'Todos os motivos ▾' : `${reasonFilter} ▾`}</Btn>}
            {phoneMap.size > 0 && (
              <Btn small variant={copied ? 'success' : 'outline'} onPress={async () => {
                await copy([...new Set(filteredRoutes.map(r => phoneMap.get(r.driverId)).filter(Boolean))].join('\n'))
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }}>{copied ? '✓ Copiado!' : '📋 Telefones'}</Btn>
            )}
          </Row>
        </>
      ) : (
        <>
          <Input value={driverSearch} onChangeText={setDriverSearch} placeholder="🔍 Buscar motorista" />
          <Segmented value={rateFilter} onChange={setRateFilter} options={[{ value: 'all', label: 'Todos' }, { value: 'high', label: '≥70%' }, { value: 'mid', label: '40–69%' }, { value: 'low', label: '<40%' }]} colors={{ high: C.green, mid: C.yellow, low: C.red }} />
          <T size={12} color={C.dim}>{filteredDrivers.length} motoristas</T>
        </>
      )}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {!driverView ? (
        <FlatList
          data={filteredRoutes}
          keyExtractor={(r, i) => r.atId + i}
          initialNumToRender={20}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: r }) => {
            const m = meta(r.driverId)
            const rc = r.declineReason === REGION_REASON && r.cluster ? regionCheck(r, wp) : null
            return (
              <Card style={{ borderColor: r.status === 'Declined' ? 'rgba(239,68,68,.25)' : C.border }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T mono bold size={12}>{r.atId}</T>
                  <Chip label={r.status === 'Accepted' ? 'Aceita' : r.status === 'Declined' ? 'Recusada' : r.status === 'Pending' ? 'Pendente' : 'Cancelada'} color={r.status === 'Accepted' ? C.green : r.status === 'Declined' ? C.red : r.status === 'Pending' ? C.yellow : C.sub} />
                </Row>
                <T size={12} color={C.sub}>{r.cluster || '—'} · {r.triggerTime.slice(0, 16).replace(/\//g, '-')}</T>
                <T size={12}>{r.driverName} <T size={10} mono color={C.dim}>{r.driverId}</T>{m?.vehicleType ? <T size={10} color={C.faint}>  {m.vehicleType}</T> : null}{m?.ds != null ? <T size={10} color={C.faint}>  DS {(m.ds * 100).toFixed(2)}%</T> : null}</T>
                {r.declineReason ? (
                  <View style={{ gap: 2 }}>
                    <T size={11} color={C.red}>{r.declineReason}</T>
                    {rc && <T size={10} bold color={rc.color}>{rc.label}{rc.clusters && rc.clusters.length ? <T size={10} color={C.dim}>  WP: {rc.clusters.join(', ')}</T> : null}</T>}
                  </View>
                ) : null}
              </Card>
            )
          }}
        />
      ) : (
        <FlatList
          data={filteredDrivers}
          keyExtractor={d => d.driverId}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: d }) => {
            const top = Object.entries(d.declineReasons).sort((a, b) => b[1] - a[1])[0]
            const m = meta(d.driverId)
            return (
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T bold>{d.driverName}</T>
                    <T size={10} mono color={C.dim}>{d.driverId}{m?.vehicleType ? `  ${m.vehicleType}` : ''}{m?.ds != null ? `  DS ${(m.ds * 100).toFixed(2)}%` : ''}</T>
                  </View>
                  <T size={18} bold color={rateColor(d.acceptanceRate)}>{d.acceptanceRate}%</T>
                </Row>
                <T size={11} color={C.sub}>{d.total} 1ªs chamadas · <T size={11} color={C.green}>{d.accepted} aceitas</T> · <T size={11} color={C.red}>{d.declined} recusadas</T></T>
                {top && <T size={11} color={C.red}>{top[0]} ({top[1]}×)</T>}
              </Card>
            )
          }}
        />
      )}
      <DatePickerSheet open={dateOpen} onClose={() => setDateOpen(false)} dates={allDates} from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t) }} />
      <Sheet open={reasonOpen} onClose={() => setReasonOpen(false)} title="Motivo de recusa">
        {['all', ...allReasons].map(r => (
          <Card key={r} onPress={() => { setReasonFilter(r); setReasonOpen(false) }} style={{ borderColor: r === reasonFilter ? C.accent : C.border }}>
            <T>{r === 'all' ? 'Todos os motivos' : r}</T>
          </Card>
        ))}
      </Sheet>
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} routes={filteredRoutes} periodLabel={periodLabel} shiftFilter={shiftFilter} wp={wp} fileName={callUp.fileName} vehicleOf={id => meta(id)?.vehicleType} />
    </View>
  )
}
