import { useMemo, useState } from 'react'
import { FlatList, Linking, Pressable, ScrollView, View } from 'react-native'
import DayShiftBar from '@/components/DayShiftBar'
import { Btn, C, Card, Chip, Input, NeedsData, Row, Screen, Segmented, Sheet, T, copy } from '@/components/ui'
import { HBar, Legend, StackBar } from '@/components/HBar'
import { useAppData } from '@/lib/appData'
import { calcRodizio, driverMatchesShift, getGlobalConfig, type Shift } from '@/lib/globalConfig'
import { calculatePriorityScore, daysSinceLastRoute, declineRatePercent } from '@/lib/priorityScore'

type DriverStatus = 'DISPONÍVEL' | 'DOBRA' | 'INDISPONÍVEL' | 'BLOQUEADO' | 'URGENTE'
type Rodizio = 'BAIXA' | 'MÉDIA' | 'ALTA'
type ScoreBand = 'high' | 'mid' | 'low'

interface EnrichedDriver {
  driverId: string; nome: string; tipoVeiculo: string | null; phoneNumber: string | null
  status: DriverStatus; rodizio: Rodizio; ultimaViagem: string | null; ds: number | null; progressaoDs: string | null
  clusters: string[]; novato: boolean; numeroRotas: number; noshow: number; declines: number; declineRate: number
  isBlocked: boolean; slots: string[]; priorityScore: number; daysSinceRoute: number
}

const STATUS_META: Record<DriverStatus, { label: string; color: string }> = {
  'DISPONÍVEL': { label: 'Disponível', color: '#4ade80' },
  'DOBRA': { label: 'Dobra', color: '#fbbf24' },
  'INDISPONÍVEL': { label: 'Indisponível', color: '#f87171' },
  'BLOQUEADO': { label: 'Bloqueado', color: '#a78bfa' },
  'URGENTE': { label: 'Urgente', color: '#fb923c' },
}
const ROD_COLOR: Record<Rodizio, string> = { BAIXA: '#4ade80', MÉDIA: '#fbbf24', ALTA: '#f87171' }
const VEH_COLOR: Record<string, string> = { VAN: '#6366f1', FIORINO: '#f59e0b', MOTO: '#10b981', PASSEIO: '#3b82f6', 'SEM VEÍCULO': '#4b5563' }

function manualBlockIds(): Set<string> {
  try { return new Set((JSON.parse(localStorage.getItem('spx:noshow-manual-blocks') ?? '[]') as { driverId: string }[]).map(b => b.driverId)) } catch { return new Set() }
}

const dsColor = (v: number | null) => (v === null ? C.dim : v * 100 < 95 ? '#f87171' : '#4ade80')
const fmtDay = (raw: string | null) => { if (!raw) return '—'; const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : raw.slice(0, 10) }
const waLink = (phone: string) => { const d = phone.replace(/\D/g, ''); return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}` }

function toggle<V>(set: Set<V>, v: V) { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><T size={10} bold color={C.dim} style={{ letterSpacing: 0.5 }}>{title.toUpperCase()}</T>{children}</Card>
}

function Dashboard({ drivers }: { drivers: EnrichedDriver[] }) {
  const total = drivers.length
  const count = (f: (d: EnrichedDriver) => boolean) => drivers.filter(f).length
  const status = [
    { label: 'Disponível', value: count(d => d.status === 'DISPONÍVEL'), color: '#4ade80' },
    { label: 'Dobra', value: count(d => d.status === 'DOBRA'), color: '#fbbf24' },
    { label: 'Urgente', value: count(d => d.status === 'URGENTE'), color: '#fb923c' },
    { label: 'Bloqueado', value: count(d => d.status === 'BLOQUEADO'), color: '#a78bfa' },
  ]
  const rod = (['BAIXA', 'MÉDIA', 'ALTA'] as Rodizio[]).map(r => ({ label: r, value: count(d => d.rodizio === r), color: ROD_COLOR[r] }))
  const vm = new Map<string, number>()
  for (const d of drivers) { const v = d.tipoVeiculo?.toUpperCase() || 'SEM VEÍCULO'; vm.set(v, (vm.get(v) ?? 0) + 1) }
  const veh = [...vm.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: VEH_COLOR[label] ?? C.sub }))
  const withDs = drivers.filter(d => d.ds !== null)
  const dsAvg = withDs.length ? withDs.reduce((s, d) => s + d.ds! * 100, 0) / withDs.length : null
  const dsRanges = [
    { label: 'Dentro da meta ≥95%', value: count(d => d.ds !== null && d.ds * 100 >= 95), color: '#4ade80' },
    { label: 'Abaixo de 95%', value: count(d => d.ds !== null && d.ds * 100 < 95), color: '#f87171' },
    { label: 'Sem DS', value: count(d => d.ds === null), color: '#4b5563' },
  ]
  const scoreAvg = total ? drivers.reduce((s, d) => s + d.priorityScore, 0) / total : 0
  const score = [
    { label: 'Alto ≥70', value: count(d => d.priorityScore >= 70), color: '#4ade80' },
    { label: 'Médio 40–69', value: count(d => d.priorityScore >= 40 && d.priorityScore < 70), color: '#fbbf24' },
    { label: 'Baixo <40', value: count(d => d.priorityScore < 40), color: '#f87171' },
  ]
  const hist = drivers.filter(d => d.daysSinceRoute < 9999)
  const dias = [
    { label: '0–1 dia', value: hist.filter(x => x.daysSinceRoute <= 1).length, color: '#4ade80' },
    { label: '2–3 dias', value: hist.filter(x => x.daysSinceRoute >= 2 && x.daysSinceRoute <= 3).length, color: '#a3e635' },
    { label: '4–7 dias', value: hist.filter(x => x.daysSinceRoute >= 4 && x.daysSinceRoute <= 7).length, color: '#fbbf24' },
    { label: '8–14 dias', value: hist.filter(x => x.daysSinceRoute >= 8 && x.daysSinceRoute <= 14).length, color: '#f97316' },
    { label: '+14 dias', value: hist.filter(x => x.daysSinceRoute > 14).length, color: '#f87171' },
    { label: 'Sem histórico', value: count(x => x.daysSinceRoute === 9999), color: '#374151' },
  ]
  const noshow = [
    { label: 'Sem noshow', value: count(d => d.noshow === 0), color: '#4ade80' },
    { label: '1–2 noshows', value: count(d => d.noshow >= 1 && d.noshow <= 2), color: '#fbbf24' },
    { label: '3–5 noshows', value: count(d => d.noshow >= 3 && d.noshow <= 5), color: '#f97316' },
    { label: '6+ noshows', value: count(d => d.noshow > 5), color: '#f87171' },
  ]
  const available = drivers.filter(d => d.status === 'DISPONÍVEL' || d.status === 'URGENTE')
  const cm = new Map<string, Map<string, number>>()
  for (const d of available) {
    const v = d.tipoVeiculo?.toUpperCase() ?? 'OUTRO'
    for (const c of d.clusters) { const row = cm.get(c) ?? new Map(); row.set(v, (row.get(v) ?? 0) + 1); cm.set(c, row) }
  }
  const matrix = [...cm.entries()].map(([cluster, row]) => ({ cluster, row, total: [...row.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total)
  const bars = (items: { label: string; value: number; color: string }[]) => items.map(i => <HBar key={i.label} name={i.label} count={i.value} max={total} color={i.color} />)
  const stack = (items: { label: string; value: number; color: string }[]) => (
    <>
      <StackBar parts={items.map(i => ({ key: i.label, value: i.value, color: i.color }))} />
      <Legend items={items.filter(i => i.value > 0).map(i => ({ label: i.label, value: `${i.value} · ${total ? Math.round((i.value / total) * 100) : 0}%`, color: i.color }))} />
    </>
  )
  return (
    <View style={{ gap: 12 }}>
      <Panel title={`Status — ${total} motoristas (${status[0].value} disponíveis)`}>{stack(status)}</Panel>
      <Panel title="Rodízio">{stack(rod)}</Panel>
      <Panel title="Tipo de veículo">{stack(veh)}</Panel>
      <Panel title="DS Score">
        {dsAvg !== null ? <T size={22} bold color={dsAvg >= 95 ? '#4ade80' : '#f87171'}>{dsAvg.toFixed(0)}% <T size={11} color={C.dim}>média DS</T></T> : <T size={12} color={C.faint}>Sem dados DS</T>}
        {bars(dsRanges)}
      </Panel>
      <Panel title="Score de prioridade">
        <T size={22} bold color={scoreAvg >= 70 ? '#4ade80' : scoreAvg >= 40 ? '#fbbf24' : '#f87171'}>{Math.min(scoreAvg, 100).toFixed(0)} <T size={11} color={C.dim}>média score</T></T>
        {bars(score)}
      </Panel>
      <Panel title="Dias sem rota">{bars(dias)}</Panel>
      <Panel title="NoShow (timeouts)">{bars(noshow)}</Panel>
      <Panel title="Disponíveis por cluster e veículo">
        {matrix.length === 0 ? <T size={12} color={C.faint}>Nenhum dado</T> : matrix.map(({ cluster, row, total: t }) => (
          <View key={cluster} style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={12} numberOfLines={1} style={{ flex: 1 }}>{cluster}</T>
              <T size={13} bold>{t}</T>
            </Row>
            <Row gap={8}>{[...row.entries()].map(([v, n]) => <T key={v} size={11} bold color={VEH_COLOR[v] ?? C.sub}>{v} {n}</T>)}</Row>
          </View>
        ))}
      </Panel>
    </View>
  )
}

export default function Disponibilidade() {
  const { workPref, registry, dsDrivers, callUp, forwardOrder, day, shift, version } = useAppData()
  const [view, setView] = useState<'lista' | 'dashboard'>('lista')
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState<Set<DriverStatus>>(new Set())
  const [rodF, setRodF] = useState<Set<Rodizio>>(new Set())
  const [vehF, setVehF] = useState<Set<string>>(new Set())
  const [clusterF, setClusterF] = useState<Set<string>>(new Set())
  const [scoreF, setScoreF] = useState<Set<ScoreBand>>(new Set())
  const [newOnly, setNewOnly] = useState(false)
  const [withPhone, setWithPhone] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [clusterPick, setClusterPick] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const drivers = useMemo((): EnrichedDriver[] => {
    if (!workPref) return []
    const cfg = getGlobalConfig()
    const regMap = new Map(registry.map(d => [d.id, d]))
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const cuMap = new Map(callUp?.byDriver.map(d => [d.driverId, d]) ?? [])
    const fwdMap = new Map(forwardOrder?.allDrivers.map(d => [d.driverId, d]) ?? [])
    const blocks = manualBlockIds()
    const accepted = (s: Shift) => callUp?.acceptedByDateShift?.[`${day}|${s}`] ?? []
    const prevShifts: Shift[] = shift === 'PM2' ? ['AM', 'PM1'] : shift === 'PM1' ? ['AM'] : []
    const vOrder = (v: string | null) => { if (!v) return 5; const s = v.toUpperCase(); return s === 'VAN' ? 0 : s === 'FIORINO' ? 1 : s === 'MOTO' ? 2 : s === 'PASSEIO' ? 3 : 4 }
    return workPref.drivers
      .filter(d => { const s = d.schedule[day]; return !!s && s.status === 'available' && driverMatchesShift(s.slots, shift, cfg) })
      .map(d => {
        const reg = regMap.get(d.driverId)
        const ds = dsMap.get(d.driverId)
        const cu = cuMap.get(d.driverId)
        const isBlocked = (reg?.spxBlocklisted ?? false) || blocks.has(d.driverId) || (fwdMap.get(d.driverId)?.totalPackages ?? 0) > 5
        const ultimaViagem = cu?.lastAcceptedDate ?? null
        const acceptedCurrent = accepted(shift).includes(d.driverId)
        const isDobra = !acceptedCurrent && prevShifts.some(s => accepted(s).includes(d.driverId))
        const status: DriverStatus = isBlocked ? 'BLOQUEADO' : acceptedCurrent ? 'INDISPONÍVEL' : isDobra ? 'DOBRA' : 'DISPONÍVEL'
        const dsReal = ds?.DS_Real ?? null
        return {
          driverId: d.driverId,
          nome: d.driverName || reg?.name || d.driverId,
          tipoVeiculo: d.vehicleType || reg?.vehicleType || null,
          phoneNumber: reg?.phoneNumber || null,
          status,
          rodizio: calcRodizio(ultimaViagem, cfg),
          ultimaViagem,
          ds: dsReal,
          progressaoDs: ds?.Status ?? null,
          clusters: d.clusters,
          novato: d.isNewDriver,
          numeroRotas: ds?.route_count ?? 0,
          noshow: d.noShowTime ?? 0,
          declines: cu?.declined ?? 0,
          declineRate: cu && cu.total > 0 ? Math.round((cu.declined / cu.total) * 100) : 0,
          isBlocked,
          slots: d.schedule[day]?.slots ?? [],
          priorityScore: calculatePriorityScore(dsReal !== null ? dsReal * 100 : 50, declineRatePercent(cu), d.noShowTime ?? 0, cfg.scoreWeights),
          daysSinceRoute: daysSinceLastRoute(ultimaViagem),
        }
      })
      .sort((a, b) => {
        const v = vOrder(a.tipoVeiculo) - vOrder(b.tipoVeiculo)
        if (v !== 0) return v
        const ad = a.ds ?? -1, bd = b.ds ?? -1
        return ad !== bd ? bd - ad : b.priorityScore - a.priorityScore
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workPref, registry, dsDrivers, callUp, forwardOrder, day, shift, version])

  const vehicles = useMemo(() => [...new Set(drivers.map(d => d.tipoVeiculo).filter((v): v is string => !!v))].sort(), [drivers])
  const clusters = useMemo(() => [...new Set(drivers.flatMap(d => d.clusters))].sort(), [drivers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => {
      if (statusF.size && !statusF.has(d.status)) return false
      if (rodF.size && !rodF.has(d.rodizio)) return false
      if (vehF.size && !vehF.has(d.tipoVeiculo ?? '')) return false
      if (clusterF.size && !d.clusters.some(c => clusterF.has(c))) return false
      if (scoreF.size) {
        const band: ScoreBand = d.priorityScore >= 70 ? 'high' : d.priorityScore >= 40 ? 'mid' : 'low'
        if (!scoreF.has(band)) return false
      }
      if (newOnly && !d.novato) return false
      if (withPhone && !d.phoneNumber) return false
      if (q && !d.driverId.includes(q) && !d.nome.toLowerCase().includes(q)) return false
      return true
    })
  }, [drivers, search, statusF, rodF, vehF, clusterF, scoreF, newOnly, withPhone])

  if (!workPref) return <View style={{ flex: 1, backgroundColor: C.bg }}><DayShiftBar /><NeedsData what="Work Preference" /></View>

  const count = (s: DriverStatus) => drivers.filter(d => d.status === s).length
  const activeCount = statusF.size + rodF.size + vehF.size + scoreF.size + clusterF.size + (newOnly ? 1 : 0) + (withPhone ? 1 : 0)
  const doCopy = async (phones: (string | null)[], key: string) => {
    const t = phones.filter(Boolean).join('\n')
    if (!t) return
    await copy(t); setCopied(key); setTimeout(() => setCopied(null), 2000)
  }
  const clear = () => { setSearch(''); setStatusF(new Set()); setRodF(new Set()); setVehF(new Set()); setClusterF(new Set()); setScoreF(new Set()); setNewOnly(false); setWithPhone(false) }

  const statCards = [
    { key: 'all', label: 'No turno', value: drivers.length, color: '#60a5fa', onPress: () => { setStatusF(new Set()); setRodF(new Set()) } },
    { key: 'DISPONÍVEL', label: 'Disponíveis', value: count('DISPONÍVEL'), color: '#4ade80', onPress: () => setStatusF(p => toggle(p, 'DISPONÍVEL' as DriverStatus)) },
    { key: 'DOBRA', label: 'Dobra', value: count('DOBRA'), color: '#fbbf24', onPress: () => setStatusF(p => toggle(p, 'DOBRA' as DriverStatus)) },
    { key: 'INDISPONÍVEL', label: 'Indisponíveis', value: count('INDISPONÍVEL'), color: '#f87171', onPress: () => setStatusF(p => toggle(p, 'INDISPONÍVEL' as DriverStatus)) },
    { key: 'BLOQUEADO', label: 'Bloqueados', value: count('BLOQUEADO'), color: '#a78bfa', onPress: () => setStatusF(p => toggle(p, 'BLOQUEADO' as DriverStatus)) },
    { key: 'rod', label: 'Rodízio Alto', value: drivers.filter(d => d.rodizio === 'ALTA').length, color: '#f87171', onPress: () => setRodF(p => toggle(p, 'ALTA' as Rodizio)) },
  ]

  const header = (
    <View style={{ gap: 10, marginBottom: 4 }}>
      <T size={11} color={C.muted}>{drivers.length} motorista(s) no turno · {workPref.fileName}</T>
      <Row>
        <Segmented value={view} onChange={setView} options={[{ value: 'lista', label: '☰ Lista' }, { value: 'dashboard', label: '📊 Dashboard' }]} colors={{ lista: '#a5b4fc', dashboard: '#a5b4fc' }} />
        <Btn small variant={copied === 'avail' ? 'success' : 'outline'} onPress={() => doCopy(drivers.filter(d => d.status === 'DISPONÍVEL' || d.status === 'URGENTE').map(d => d.phoneNumber), 'avail')}>{copied === 'avail' ? '✓ Copiado' : '📋 Números'}</Btn>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {statCards.map(c => (
          <Pressable key={c.key} onPress={c.onPress} style={{ backgroundColor: `${c.color}14`, borderWidth: 1, borderColor: `${c.color}44`, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, minWidth: 76 }}>
            <T size={18} bold color={c.color}>{c.value}</T>
            <T size={10} color={C.muted}>{c.label}</T>
          </Pressable>
        ))}
      </ScrollView>
      {view === 'lista' && (
        <>
          <Input value={search} onChangeText={setSearch} placeholder="🔍 Motorista ou ID" />
          <Row>
            <T size={12} color={C.muted}>{filtered.length}{filtered.length !== drivers.length ? ` / ${drivers.length}` : ''}</T>
            <Btn small variant="outline" onPress={() => setFiltersOpen(true)}>{`🎛 Filtros${activeCount ? ` (${activeCount})` : ''}`}</Btn>
            {(activeCount > 0 || !!search) && <Btn small variant="ghost" onPress={clear}>✕ Limpar</Btn>}
            <Btn small variant={copied === 'filtered' ? 'success' : 'outline'} onPress={() => doCopy(filtered.map(d => d.phoneNumber), 'filtered')}>{copied === 'filtered' ? '✓ Copiado' : `📋 (${filtered.filter(d => d.phoneNumber).length})`}</Btn>
          </Row>
        </>
      )}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <DayShiftBar />
      {view === 'dashboard' ? <Screen>{header}<Dashboard drivers={drivers} /></Screen> : (
        <FlatList
          data={filtered}
          keyExtractor={d => d.driverId}
          initialNumToRender={20}
          ListHeaderComponent={header}
          ListEmptyComponent={<T color={C.muted} style={{ textAlign: 'center', paddingVertical: 40 }}>Nenhum motorista disponível neste turno.</T>}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: d }) => {
            const sm = STATUS_META[d.status]
            const open = expanded === d.driverId
            return (
              <Card onPress={() => setExpanded(open ? null : d.driverId)} style={open ? { borderColor: 'rgba(139,92,246,.5)' } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Row gap={5}><T bold>{d.nome}</T>{d.novato && <Chip label="Novo" color="#a78bfa" />}</Row>
                    <T size={10} mono color={C.dim}>{d.driverId}{d.slots.length ? `  ·  ${d.slots.join(' / ')}` : ''}</T>
                  </View>
                  <T size={18} bold color={d.priorityScore >= 70 ? '#4ade80' : d.priorityScore >= 40 ? '#fbbf24' : '#f87171'}>{d.priorityScore}</T>
                </Row>
                <Row gap={4}>
                  {d.tipoVeiculo ? <Chip label={d.tipoVeiculo} /> : null}
                  <Chip label={sm.label} color={sm.color} />
                  <Chip label={`Rodízio ${d.rodizio}`} color={ROD_COLOR[d.rodizio]} />
                  <Chip label={`DS ${d.ds === null ? '—' : `${(d.ds * 100).toFixed(1)}%`}`} color={dsColor(d.ds)} />
                  {d.progressaoDs ? <Chip label={d.progressaoDs} color={d.progressaoDs === 'Melhorando' ? '#4ade80' : d.progressaoDs === 'Piorando' ? '#f87171' : C.dim} /> : null}
                </Row>
                <T size={11} color={C.sub}>
                  Última viagem {fmtDay(d.ultimaViagem)}{d.ultimaViagem && d.daysSinceRoute < 9999 ? ` (${d.daysSinceRoute === 0 ? 'hoje' : `${d.daysSinceRoute}d`})` : ''}
                  {' · '}{d.numeroRotas || 0} rotas
                  {d.noshow > 0 ? <T size={11} color={C.red}> · {d.noshow} noshow</T> : null}
                  {d.declines > 0 ? <T size={11} color={d.declineRate >= 50 ? '#f87171' : d.declineRate >= 25 ? '#f97316' : '#fbbf24'}> · {d.declines} recusas ({d.declineRate}%)</T> : null}
                </T>
                <Row gap={3}>
                  {(open ? [...d.clusters].sort() : d.clusters.slice(0, 4)).map(c => <Chip key={c} label={c} color="#a78bfa" active={clusterF.has(c) ? true : undefined} onPress={() => setClusterF(f => toggle(f, c))} />)}
                  {!open && d.clusters.length > 4 && <T size={10} color={C.muted}>+{d.clusters.length - 4}</T>}
                </Row>
                {d.phoneNumber && <Btn small variant="success" onPress={() => Linking.openURL(waLink(d.phoneNumber!))}>💬 WhatsApp</Btn>}
              </Card>
            )
          }}
        />
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtros">
        <T size={11} bold color={C.dim}>STATUS</T>
        <Row gap={6}>{(['DISPONÍVEL', 'DOBRA', 'INDISPONÍVEL', 'BLOQUEADO'] as DriverStatus[]).map(s => <Chip key={s} label={s} color={STATUS_META[s].color} active={statusF.has(s)} onPress={() => setStatusF(toggle(statusF, s))} />)}</Row>
        <T size={11} bold color={C.dim}>VEÍCULO</T>
        <Row gap={6}>{vehicles.map(v => <Chip key={v} label={v} color={VEH_COLOR[v] ?? C.sub} active={vehF.has(v)} onPress={() => setVehF(toggle(vehF, v))} />)}</Row>
        <T size={11} bold color={C.dim}>RODÍZIO</T>
        <Row gap={6}>{(['BAIXA', 'MÉDIA', 'ALTA'] as Rodizio[]).map(r => <Chip key={r} label={r} color={ROD_COLOR[r]} active={rodF.has(r)} onPress={() => setRodF(toggle(rodF, r))} />)}</Row>
        <T size={11} bold color={C.dim}>SCORE</T>
        <Row gap={6}>{([['high', 'Alto ≥70', '#4ade80'], ['mid', 'Médio 40–69', '#fbbf24'], ['low', 'Baixo <40', '#f87171']] as [ScoreBand, string, string][]).map(([v, l, c]) => <Chip key={v} label={l} color={c} active={scoreF.has(v)} onPress={() => setScoreF(toggle(scoreF, v))} />)}</Row>
        <T size={11} bold color={C.dim}>CLUSTER</T>
        <Row gap={6}>
          {[...clusterF].map(c => <Chip key={c} label={`${c} ✕`} color="#a78bfa" active onPress={() => setClusterF(toggle(clusterF, c))} />)}
          <Btn small variant="outline" onPress={() => setClusterPick(true)}>+ Adicionar</Btn>
        </Row>
        <T size={11} bold color={C.dim}>OUTROS</T>
        <Row gap={6}>
          <Chip label="Novatos" color={C.blue} active={newOnly} onPress={() => setNewOnly(v => !v)} />
          <Chip label="Com telefone" color={C.blue} active={withPhone} onPress={() => setWithPhone(v => !v)} />
        </Row>
        <Btn onPress={() => setFiltersOpen(false)}>{`Ver ${filtered.length} motoristas`}</Btn>
      </Sheet>
      <Sheet open={clusterPick} onClose={() => setClusterPick(false)} title="Adicionar cluster">
        {clusters.filter(c => !clusterF.has(c)).map(c => <Card key={c} onPress={() => { setClusterF(toggle(clusterF, c)); setClusterPick(false) }}><T>{c}</T></Card>)}
      </Sheet>
    </View>
  )
}
