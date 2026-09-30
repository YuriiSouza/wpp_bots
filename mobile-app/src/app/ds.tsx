import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { C, Card, Chip, Input, NeedsData, Row, Screen, Segmented, Stat, StatRow, T } from '@/components/ui'
import { DayBars } from '@/components/DayBars'
import { HBar } from '@/components/HBar'
import { useAppData } from '@/lib/appData'
import type { DriverResult } from '@/lib/types'

type Tab = 'geral' | 'motoristas' | 'cluster' | 'rotatividade' | 'spr'
type SortKey = 'DS_Real' | 'route_count' | 'Media_Performance' | 'Nivel_Entrega_Dia'

const pct = (v: number | null, dec = 2) => (v === null ? '—' : `${(v * 100).toFixed(dec)}%`)
const dsBadge = (v: number | null) => (v === null ? C.dim : v * 100 >= 97 ? C.green : v * 100 >= 93 ? C.blue : v * 100 >= 85 ? C.yellow : C.red)
const perfColor = (p: number) => (p >= 96 ? '#22c55e' : p >= 93 ? '#3b82f6' : p >= 85 ? '#f59e0b' : '#ef4444')
const bucketColor = (l: string) => (l.startsWith('<') ? '#ef4444' : l.startsWith('80') || l.startsWith('85') ? '#f59e0b' : l.startsWith('90') || l.startsWith('93') ? '#3b82f6' : '#22c55e')
const trend = (s: string) => (s === 'Melhorando' ? { icon: '↑', color: C.green } : s === 'Piorando' ? { icon: '↓', color: C.red } : { icon: '→', color: C.sub })

function DriversTab({ drivers }: { drivers: DriverResult[] }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('DS_Real')
  const [desc, setDesc] = useState(true)
  const sorted = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => d.driver_id.toLowerCase().includes(q)).sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return desc ? -cmp : cmp
    })
  }, [drivers, search, sortKey, desc])
  const labels: Record<SortKey, string> = { DS_Real: 'DS_Real', route_count: 'Rotas', Media_Performance: 'Perf.', Nivel_Entrega_Dia: 'Entrega/dia' }
  return (
    <FlatList
      data={sorted}
      keyExtractor={d => d.driver_id}
      initialNumToRender={25}
      contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <Input value={search} onChangeText={setSearch} placeholder="🔍 Buscar motorista (ID)" />
          <Row gap={6}>
            <T size={11} color={C.dim}>Ordenar:</T>
            {(Object.keys(labels) as SortKey[]).map(k => (
              <Chip key={k} label={`${labels[k]}${sortKey === k ? (desc ? ' ↓' : ' ↑') : ''}`} color={C.blue} active={sortKey === k} onPress={() => { if (sortKey === k) setDesc(v => !v); else { setSortKey(k); setDesc(true) } }} />
            ))}
          </Row>
          <T size={12} color={C.muted}>{sorted.length} motoristas</T>
        </View>
      }
      renderItem={({ item: d }) => {
        const t = trend(d.Status)
        return (
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <T mono bold size={12}>{d.driver_id}</T>
              <T size={16} bold color={dsBadge(d.DS_Real)}>{pct(d.DS_Real)}</T>
            </Row>
            <T size={11} color={C.sub}>{d.route_count} rotas · Perf. {pct(d.Media_Performance)} · Entrega/dia {pct(d.Nivel_Entrega_Dia)}</T>
            <T size={11} bold color={t.color}>{t.icon} {d.Status}</T>
          </Card>
        )
      }}
    />
  )
}

export default function DsScreen() {
  const { ds } = useAppData()
  const [tab, setTab] = useState<Tab>('geral')
  if (!ds) return <NeedsData what="rotas (DS)" />
  const r = ds.result
  const s = r.summary
  const sc = s.statusCounts
  const trendTotal = sc.Melhorando + sc.Piorando + sc.Estagnado
  const maxTimeline = Math.max(1, ...r.timeline.map(t => t.routeCount))
  const maxBucket = Math.max(1, ...r.dsBuckets.map(b => b.count))

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 14, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Row>
          <T size={11} mono color={C.muted}>{ds.fileName}</T>
          {r.missingColumns.length > 0 && <Chip label={`⚠ ${r.missingColumns.length} col. indisponíveis`} color={C.yellow} />}
        </Row>
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'geral', label: 'Visão Geral' }, { value: 'motoristas', label: 'Motoristas DS' }, { value: 'cluster', label: 'Por Cluster' },
          { value: 'rotatividade', label: 'Rotatividade' }, { value: 'spr', label: 'Sugestão SPR' },
        ]} />
      </View>

      {tab === 'motoristas' && <DriversTab drivers={r.drivers} />}

      {tab === 'geral' && (
        <Screen>
          <T size={11} color={C.dim}>Os filtros de turno/cluster/data dependem do arquivo bruto e estão disponíveis só no PC.</T>
          <StatRow>
            <Stat label="Total de rotas" value={s.totalRoutes.toLocaleString('pt-BR')} sub={`${s.periodStart} → ${s.periodEnd}`} />
            <Stat label="Motoristas" value={s.totalDrivers} />
            <Stat label="DS médio" value={pct(s.avgDsReal)} />
            <Stat label="DS mediano" value={pct(s.medianDsReal)} />
          </StatRow>
          <Card>
            <T size={10} bold color={C.dim}>TENDÊNCIA DA FROTA</T>
            <Row gap={6}>
              <Chip label={`↑ ${sc.Melhorando} Melhorando (${trendTotal ? Math.round((sc.Melhorando / trendTotal) * 100) : 0}%)`} color={C.green} />
              <Chip label={`↓ ${sc.Piorando} Piorando (${trendTotal ? Math.round((sc.Piorando / trendTotal) * 100) : 0}%)`} color={C.red} />
              <Chip label={`→ ${sc.Estagnado} Estagnado`} />
            </Row>
          </Card>
          <Card>
            <T bold size={12}>Distribuição de DS_Real</T>
            {r.dsBuckets.map(b => <HBar key={b.label} name={b.label} count={b.count} max={maxBucket} color={bucketColor(b.label)} />)}
          </Card>
          <Card>
            <T bold size={12}>Volume de rotas por dia</T>
            <DayBars data={r.timeline.map(t => ({ date: t.date, value: (t.routeCount / maxTimeline) * 100 }))} detail={i => `${r.timeline[i].routeCount} rotas`} />
          </Card>
          <Card>
            <T bold size={12}>Performance por turno</T>
            {r.turnStats.every(t => t.routeCount === 0) ? <T size={12} color={C.muted}>Dados de turno indisponíveis.</T> : r.turnStats.map(t => (
              <Row key={t.turn} style={{ justifyContent: 'space-between' }}>
                <T size={12} bold>{t.turn}</T>
                <T size={12} color={perfColor(t.avgPerformance * 100)}>{(t.avgPerformance * 100).toFixed(2)}% <T size={11} color={C.dim}>· {t.routeCount} rotas</T></T>
              </Row>
            ))}
          </Card>
          <Card>
            <T bold size={12}>Ranking clusters</T>
            {r.clusterStats.length === 0 ? <T size={12} color={C.muted}>Nenhum cluster com 15+ rotas.</T> : r.clusterStats.slice(0, 7).map(c => (
              <HBar key={c.cluster} name={c.cluster} count={Math.round(c.avgPerformance * 10000) / 100} max={100} suffix="%" color={perfColor(c.avgPerformance * 100)} />
            ))}
          </Card>
        </Screen>
      )}

      {tab === 'cluster' && (
        <Screen>
          {r.clusterStats.length === 0 ? <T color={C.muted}>Nenhum cluster com volume mínimo (15+ rotas).</T> : r.clusterStats.map(c => (
            <Card key={c.cluster}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T bold style={{ flex: 1 }}>{c.cluster}</T>
                <T bold color={c.avgPerformance >= 0.96 ? C.green : c.avgPerformance >= 0.93 ? C.blue : C.red}>{(c.avgPerformance * 100).toFixed(2)}%</T>
              </Row>
              <T size={11} color={C.sub}>{c.routeCount} rotas · AM {c.amAvg !== null ? `${(c.amAvg * 100).toFixed(2)}%` : '—'} · PM1 {c.pm1Avg !== null ? `${(c.pm1Avg * 100).toFixed(2)}%` : '—'}</T>
              <T size={11} color={C.dim}>Corr. volume {c.correlationVolume?.toFixed(3) ?? '—'} · Corr. paradas {c.correlationStops?.toFixed(3) ?? '—'}</T>
              {c.isSensitiveToVolume && <Chip label="⚠ Sensível a volume" color={C.yellow} />}
            </Card>
          ))}
        </Screen>
      )}

      {tab === 'rotatividade' && (
        <Screen>
          <T bold>Concentração de rotas por veículo</T>
          {r.vehicleConcentration.map(v => (
            <Card key={v.vehicle}>
              <Row style={{ justifyContent: 'space-between' }}><T bold>{v.vehicle || 'N/A'}</T><T size={12} color={C.sub}>{v.totalDrivers} motoristas</T></Row>
              <Row gap={6}>
                <Chip label={`Top 20%: ${v.top20Pct}% das rotas`} color={v.top20Pct > 60 ? C.yellow : C.green} />
                <Chip label={`Bottom 20%: ${v.bottom20Pct}%`} />
              </Row>
            </Card>
          ))}
          <T bold>Turnover por veículo</T>
          {r.turnoverByVehicle.map(v => (
            <Card key={v.vehicle}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T bold>{v.vehicle}</T>
                <T bold color={v.turnoverRate > 30 ? C.red : v.turnoverRate > 15 ? C.yellow : C.green}>{v.turnoverRate.toFixed(1)}%</T>
              </Row>
              <T size={11} color={C.sub}>{v.retained} retidos · {v.churned} saíram · {v.newDrivers} novos</T>
            </Card>
          ))}
        </Screen>
      )}

      {tab === 'spr' && (
        <Screen>
          {r.sprSuggestions.length === 0 ? <T color={C.muted}>Nenhum cluster PM1 com volume suficiente.</T> : r.sprSuggestions.map(sg => (
            <Card key={sg.cluster}>
              <T bold>{sg.cluster}</T>
              {sg.suggestedSPR !== null ? <Chip label={`SPR sugerido: ${sg.suggestedSPR} pacotes`} color={C.green} /> : <Chip label={sg.note} color={C.yellow} />}
              {sg.bins.length > 0 && <Row gap={4}>{sg.bins.map(b => <Chip key={b.label} label={`${b.label}: ${(b.avgPerformance * 100).toFixed(1)}% (${b.count})`} color={b.avgPerformance >= 0.96 ? C.green : C.red} />)}</Row>}
            </Card>
          ))}
        </Screen>
      )}
    </View>
  )
}
