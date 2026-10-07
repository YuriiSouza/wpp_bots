import { useState } from 'react'
import { coversCluster } from '@/lib/clusterMatch'
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native'
import DayShiftBar from '@/components/DayShiftBar'
import { Btn, C, Card, Chip, Empty, Input, Row, Screen, Segmented, SHIFT_COLOR, Sheet, T, copy } from '@/components/ui'
import type { LocalRoute } from '@/lib/noshowRouteParser'
import { useNoShow } from '@/features/noshow/useNoShow'
import { countByCluster, getDsMeta, INTERIOR_CLUSTERS, normCluster, normalizeVehicle, vehiclePriority, type LocalDriver } from '@/features/noshow/logic'
import { AddRouteSheet, BatchSheet, NovatosPanel, ReportSheet, RoutePaste, SpxCredsSheet, ThreePlPanel } from '@/features/noshow/panels'

type Tab = 'routes' | 'drivers' | 'fc'
const QUICK_REASONS = ['No-show', 'Atraso', 'Documento pendente', 'Redelivery', 'Ocorrência']

function blockLabel(d: LocalDriver) {
  return d.blockType === 'auto' ? '📦 Redelivery' : d.blockType === 'registry' ? '⊘ SPX Blocklist' : '⊘ Bloqueado'
}

export default function Atribuicao() {
  const ns = useNoShow()
  const [tab, setTab] = useState<Tab>('routes')
  const [fcSection, setFcSection] = useState<'fiorino' | 'novatos' | '3pl'>('fiorino')
  const [routeSearch, setRouteSearch] = useState('')
  const [driverSearch, setDriverSearch] = useState('')
  const [fioSearch, setFioSearch] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [menu, setMenu] = useState(false)
  const [assignRoute, setAssignRoute] = useState<LocalRoute | null>(null)
  const [displaced, setDisplaced] = useState<{ route: LocalRoute; driver: LocalDriver; routes: LocalRoute[] } | null>(null)
  const [blockTarget, setBlockTarget] = useState<{ driverId: string; name: string } | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkIds, setBulkIds] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [spxOpen, setSpxOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [reportSnap, setReportSnap] = useState<ReturnType<typeof ns.reportSnapshot> | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const notify = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2000) }

  if (ns.queue.length === 0 && ns.routes.length === 0 && !showPaste) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <DayShiftBar />
        <Empty
          title={`Sem fila de motoristas para o turno ${ns.selectedShift}.`}
          sub="A fila é criada quando o Work Preference é importado (no PC) e sincronizada pela planilha. Você também pode colar as rotas do turno."
          action={{ label: '☁ Ir para Dados', href: '/dados' }}
        />
        <View style={{ alignItems: 'center' }}><Btn variant="outline" onPress={() => setShowPaste(true)}>📋 Colar rotas</Btn></View>
      </View>
    )
  }

  if (ns.routes.length === 0 || showPaste) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <DayShiftBar />
        <Screen>
          <RoutePaste
            defaultDate={ns.selectedDay}
            defaultShift={ns.selectedShift}
            onLoad={(r, date, shift) => { ns.loadPastedRoutes(r, date, shift); setShowPaste(false) }}
            onCancel={ns.routes.length > 0 ? () => setShowPaste(false) : undefined}
          />
        </Screen>
      </View>
    )
  }

  const q = routeSearch.toLowerCase()
  const filteredRoutes = ns.allRoutes.filter(r => !q || r.atId.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q))
  const phoneById = new Map(ns.registry.map(d => [d.id, d.phoneNumber?.replace(/\D/g, '') ?? '']))
  const assignedPhones = [...new Set(filteredRoutes.filter(r => r.status === 'ATRIBUIDA' && r.assignedDriverId).map(r => phoneById.get(r.assignedDriverId!) ?? '').filter(p => p.length >= 8))]
  const dq = driverSearch.toLowerCase()
  const matchDriver = (d: LocalDriver) => !dq || d.driverId.includes(dq) || d.name.toLowerCase().includes(dq)
  const filteredDrivers = ns.queueDrivers.filter(matchDriver)
  const filteredRouted = ns.alreadyRoutedDrivers.filter(matchDriver)
  const queueCounts = countByCluster(ns.queueDrivers)
  const availableCounts = countByCluster(ns.availableDrivers)
  const clusterCount = (c: string) => queueCounts.get(normCluster(c)) ?? 0

  const menuItems: { icon: string; label: string; color?: string; onPress: () => void }[] = [
    { icon: '📋', label: 'Nova colagem', onPress: () => setShowPaste(true) },
    { icon: '＋', label: 'Reatribuir rota (AT)', color: C.green, onPress: () => setAddOpen(true) },
    { icon: '📥', label: 'Atribuir lote', color: C.blue, onPress: () => setBatchOpen(true) },
    { icon: '⬇', label: 'Copiar relação', onPress: async () => { const t = ns.relationText(); if (t) { await copy(t); notify('Relação copiada') } } },
    { icon: '📱', label: `Copiar telefones (${ns.phonesForAssignments().length})`, color: C.blue, onPress: async () => { const p = ns.phonesForAssignments(); if (p.length) { await copy(p.join('\n')); notify('Telefones copiados') } } },
    { icon: '🔑', label: ns.spxConfigured ? 'SPX configurado' : 'Configurar SPX', color: ns.spxConfigured ? C.green : C.yellow, onPress: () => setSpxOpen(true) },
    { icon: '📊', label: 'Gerar report', color: '#a78bfa', onPress: () => setReportSnap(ns.reportSnapshot()) },
    { icon: '🗑', label: 'Limpar rotas', color: C.red, onPress: () => Alert.alert('Limpar rotas', 'Limpar todas as rotas deste turno? Não pode ser desfeito.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar', style: 'destructive', onPress: ns.clearRoutes }]) },
  ]

  const statItems = [
    { label: '🚫 Recusadas', value: ns.stats.recusadas, color: C.red },
    { label: '🛣 Reverter', value: ns.stats.disponivel, color: C.blue },
    { label: '✅ Revertidas', value: ns.stats.atribuidas, color: C.green },
    { label: '👥 Livres', value: ns.stats.drivers, color: C.green },
    { label: '🔒 Em rota', value: ns.stats.emRota, color: C.sub },
    { label: '⊘ Bloqueados', value: ns.stats.blocked, color: C.red },
    { label: '✦ Previsão', value: ns.stats.preview, color: '#a78bfa' },
  ]

  const header = (
    <View style={{ gap: 10, paddingBottom: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T size={11} color={C.muted} style={{ flex: 1 }}>
          <T size={11} bold color={SHIFT_COLOR[ns.selectedShift]}>{ns.selectedShift}</T>
          {' · '}{ns.callUp ? <T size={11} color={C.red}>{ns.declinedAtIds.size} recusadas no Call Up</T> : <T size={11} color={C.yellow}>sem Call Up</T>}
          {' · '}{ns.routes.length} rotas
        </T>
        <Btn small variant="outline" onPress={() => setMenu(true)}>⋯</Btn>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {statItems.map(s => (
          <View key={s.label} style={{ backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 78 }}>
            <T size={10} color={C.muted}>{s.label}</T>
            <T size={18} bold color={s.color}>{s.value}</T>
          </View>
        ))}
      </ScrollView>
      {tab === 'fc' && fcSection === 'fiorino' ? (
        <Btn loading={ns.fioAssigning} disabled={ns.fiorino.assignments.size === 0} style={{ backgroundColor: '#d97706', borderColor: '#d97706' }} onPress={() => void ns.handleFioAssign()}>
          {`🚐 Atribuir Fiorino (${ns.fiorino.assignments.size})`}
        </Btn>
      ) : (
  <Btn loading={ns.isAssigning} disabled={ns.effectiveAssignments.size === 0} onPress={() => void ns.handleConfirmAssign()}>
        {ns.isAssigning ? 'Atribuindo...' : `✦ Atribuir (${ns.effectiveAssignments.size})${ns.spxConfigured ? ' no SPX' : ''}`}
      </Btn>
      )}
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'routes', label: `Rotas (${ns.noShowRoutes.length})` },
          { value: 'drivers', label: `Fila (${ns.queueDrivers.length})` },
          { value: 'fc', label: `🚐 First Conv. (${ns.fiorino.strictRoutes.length})` },
        ]}
        colors={{ fc: C.yellow }}
      />
      {tab === 'routes' && <Input value={routeSearch} onChangeText={setRouteSearch} placeholder="🔍 AT ID ou cluster" />}
      {tab === 'routes' && (
        <Row>
          <Btn small variant="success" onPress={() => setAddOpen(true)}>＋ AT</Btn>
          <Btn small variant="outline" onPress={async () => { const ats = filteredRoutes.map(r => r.atId); if (ats.length) { await copy(ats.join('\n')); notify('ATs copiadas') } }}>{`📋 ATs (${filteredRoutes.length})`}</Btn>
          <Btn small variant="outline" disabled={assignedPhones.length === 0} onPress={async () => { await copy(assignedPhones.join('\n')); notify('Telefones dos atribuídos copiados') }}>{`📱 Atribuídos (${assignedPhones.length})`}</Btn>
        </Row>
      )}
      {tab === 'drivers' && (
        <Row>
          <Input value={driverSearch} onChangeText={setDriverSearch} placeholder="🔍 Buscar motorista" style={{ flex: 1 }} />
          <Btn small variant="danger" onPress={() => { setBulkIds(''); setBulkReason(''); setBulkOpen(true) }}>⊘ Lista</Btn>
        </Row>
      )}
    </View>
  )

  const renderRoute = ({ item: route, index }: { item: LocalRoute; index: number }) => {
    if (route.status === 'ATRIBUIDA') {
      return (
        <Card style={{ backgroundColor: 'rgba(34,197,94,.04)' }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T mono bold size={12}>{index + 1}. {route.atId}</T>
            <Row gap={4}>{ns.callUp && !ns.declinedAtIds.has(route.atId) && <Chip label="⏳ Sem aceite" color={C.yellow} />}<Chip label="Atribuída" color={C.green} /></Row>
          </Row>
          <T size={12} color={C.sub}>{route.isInterior ? '📍 ' : ''}{route.cluster}{route.gaiola ? ` · Gaiola ${route.gaiola}` : ''}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T bold>{route.assignedDriverName || '—'}</T>
            <Row gap={10}>
              <Btn small variant="ghost" onPress={() => ns.handleReturnRoute(route)}>↩ Devolver</Btn>
              <Pressable hitSlop={8} onPress={() => ns.setIgnoredAtIds(s => new Set([...s, route.atId]))}><T color={C.dim}>✕</T></Pressable>
            </Row>
          </Row>
        </Card>
      )
    }
    const eff = ns.effectiveAssignments.get(route.id)
    const ds = getDsMeta(eff?.dsReal ?? null)
    const count = ns.driverCountForRoute(route)
    const rv = normalizeVehicle(route.requiredVehicleType)
    return (
      <Card onPress={() => setAssignRoute(route)} style={{ borderColor: !eff ? 'rgba(239,68,68,.35)' : route.isInterior ? 'rgba(245,158,11,.35)' : C.border }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T mono bold size={12}>{index + 1}. {route.atId}</T>
          <Row gap={6}>
            <T size={11} bold color={count === 0 ? C.red : count === 1 ? C.yellow : C.green}>👥 {count}</T>
            <Pressable hitSlop={8} onPress={() => ns.setIgnoredAtIds(s => new Set([...s, route.atId]))}><T color={C.dim}>✕</T></Pressable>
          </Row>
        </Row>
        <Row gap={6}>
          <T size={12} color={C.sub}>{route.isInterior ? '📍 ' : ''}{route.cluster}</T>
          {ns.pendingAtIds.has(route.atId) && <Chip label="⏳ Pendente" color={C.yellow} />}
          {route.isInterior && <Chip label="Interior" color={C.yellow} />}
          {route.requiredVehicleType ? <Chip label={route.requiredVehicleType} /> : null}
          {route.gaiola ? <T size={11} color={C.dim}>Gaiola {route.gaiola}</T> : null}
        </Row>
        {eff ? (
          <View style={{ gap: 4 }}>
            <T bold color={eff.isBlocked ? C.red : C.text}>→ {eff.name}</T>
            <Row gap={4}>
              {eff.vehicleType ? <Chip label={eff.vehicleType} /> : null}
              {rv === 'MOTO' && normalizeVehicle(eff.vehicleType) !== 'MOTO' && <Chip label="⚠ Não é moto" color={C.yellow} />}
              {eff.isNewDriver && <Chip label="Novato" color="#a78bfa" />}
              {ns.dobraIds.has(eff.driverId) && <Chip label="Dobra" color="#f97316" />}
              {eff.isBlocked && <Chip label={blockLabel(eff)} color={C.red} />}
              <Chip label={`DS ${ds.label}`} color={ds.color} bg={ds.bg} />
              <Chip label={`Score ${eff.priorityScore}`} />
              {ns.overrides.has(route.id) && <Chip label="Editado" color={C.blue} />}
            </Row>
          </View>
        ) : <T size={11} color="#f59e0b">⚠ Sem motorista disponível</T>}
      </Card>
    )
  }

  const renderDriver = ({ item: d, index }: { item: LocalDriver; index: number }) => {
    const ds = getDsMeta(d.dsReal)
    return (
      <Card style={{ borderColor: d.isBlocked ? 'rgba(239,68,68,.3)' : C.border }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T bold color={d.isBlocked ? C.red : C.text}>{index + 1}. {d.name}</T>
            <T size={10} mono color={C.dim}>{d.driverId}</T>
          </View>
          <T size={18} bold color={d.priorityScore >= 70 ? C.green : d.priorityScore >= 40 ? C.yellow : C.red}>{d.priorityScore.toFixed(0)}</T>
        </Row>
        <Row gap={4}>
          {d.vehicleType ? <Chip label={d.vehicleType} /> : null}
          <Chip label={`DS ${ds.label}`} color={ds.color} bg={ds.bg} />
          {d.isNewDriver && <Chip label="Novato" color="#a78bfa" />}
          {ns.dobraIds.has(d.driverId) && <Chip label="Dobra" color="#f97316" />}
        </Row>
        <Row gap={3}>
          {[...d.clusters].sort((a, b) => clusterCount(a) - clusterCount(b)).map(c => {
            const cnt = clusterCount(c)
            const col = cnt <= 1 ? C.red : cnt === 2 ? C.yellow : INTERIOR_CLUSTERS.has(c) ? C.yellow : C.dim
            return <Chip key={c} label={`${c} (${cnt})`} color={col} bg={`${col}18`} />
          })}
        </Row>
        {d.isBlocked ? (
          <View style={{ gap: 4 }}>
            <Row><Chip label={blockLabel(d)} color={C.red} />{d.blockType === 'auto' && <T size={10} color={C.dim}>(automático)</T>}</Row>
            {d.blockReason ? <T size={11} color={C.red}>{d.blockReason}</T> : null}
            {d.blockType === 'manual' && <Btn small variant="success" onPress={() => ns.removeManualBlock(d.driverId)}>✓ Desbloquear</Btn>}
            {d.blockType === 'auto' && <T size={10} color={C.dim}>Atualize o relatório de pacotes para remover</T>}
          </View>
        ) : (
          <Row style={{ justifyContent: 'space-between' }}>
            <Chip label="Na fila" color={C.blue} />
            <Btn small variant="ghost" onPress={() => { setBlockTarget({ driverId: d.driverId, name: d.name }); setBlockReason('') }}><T size={12} color={C.red}>⊘ Bloquear</T></Btn>
          </Row>
        )}
      </Card>
    )
  }

  const fcRoutes = (ns.fioMode === 'strict' ? ns.fiorino.strictRoutes : ns.fiorino.eligibleRoutes)
    .filter(r => !fioSearch || r.atId.toLowerCase().includes(fioSearch.toLowerCase()) || r.cluster.toLowerCase().includes(fioSearch.toLowerCase()))

  const fcContent = (
    <View style={{ gap: 10 }}>
      <Segmented value={fcSection} onChange={setFcSection} options={[{ value: 'fiorino', label: '🚐 Fiorino' }, { value: 'novatos', label: '🆕 Novatos' }, { value: '3pl', label: '📦 3PL' }]} colors={{ fiorino: '#38bdf8', novatos: '#38bdf8', '3pl': '#38bdf8' }} />
      {fcSection === 'fiorino' && (
        <>
          <Segmented value={ns.fioMode} onChange={ns.setFioMode} options={[{ value: 'strict', label: '🎯 Só obrigatórias' }, { value: 'maximize', label: '🚀 Maximizar' }]} colors={{ strict: '#d97706', maximize: '#d97706' }} />
          <T size={11} color={C.dim}>{ns.fioMode === 'strict' ? 'Fiorino apenas em rotas com GG ≥ 2 e volume ≥ 800' : 'Obrigatórias + qualquer rota disponível para aproveitar a fila'}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[
              { label: 'Obrigatórias', value: ns.fiorino.strictRoutes.length, color: C.yellow },
              ...(ns.fioMode === 'maximize' ? [{ label: 'Extras', value: ns.fiorino.assignments.size - ns.fiorino.strictAssignments.size, color: C.blue }] : []),
              { label: 'Motoristas Fiorino', value: ns.fiorino.fioDrivers.length, color: C.green },
              { label: 'Previstas', value: ns.fiorino.assignments.size, color: '#a78bfa' },
              { label: 'Sem rota', value: ns.fiorino.fioDrivers.length - ns.fiorino.assignments.size, color: C.red },
            ].map(s => (
              <View key={s.label} style={{ backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                <T size={10} color={C.muted}>{s.label}</T><T size={18} bold color={s.color}>{s.value}</T>
              </View>
            ))}
          </ScrollView>
          {ns.fioResults && (
            <Card>
              <T bold size={12}>Resultado Fiorino</T>
              {ns.fioResults.map(r => (
                <T key={r.atId} size={11}><T mono size={11} color={C.sub}>{r.atId}</T> → <T size={11} color={r.spxOk === false ? C.red : C.green}>{r.spxOk === undefined ? '✓ Local' : r.spxOk ? `✓ SPX: ${r.spxMsg}` : `✗ SPX: ${r.spxMsg}`}</T></T>
              ))}
            </Card>
          )}
          <Input value={fioSearch} onChangeText={setFioSearch} placeholder="🔍 AT ID ou cluster" />
          {fcRoutes.length === 0 && <T color={C.muted} style={{ textAlign: 'center', paddingVertical: 20 }}>{ns.fiorino.strictRoutes.length === 0 ? 'Nenhuma rota com GG ≥ 2 e volume ≥ 800.' : 'Nada encontrado.'}</T>}
          {fcRoutes.map(route => {
            const a = ns.fiorino.assignments.get(route.atId)
            const obrig = ns.fiorino.strictRoutes.some(r => r.atId === route.atId)
            const ds = a ? getDsMeta(a.dsReal) : null
            return (
              <Card key={route.id} style={{ borderColor: a ? (obrig ? 'rgba(245,158,11,.35)' : 'rgba(59,130,246,.35)') : 'rgba(239,68,68,.35)' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T mono bold size={12} color={obrig ? C.yellow : C.blue}>{route.atId}{ns.fioMode === 'maximize' && !obrig ? '  extra' : ''}</T>
                  <T size={11} color={C.sub}>GG <T size={11} bold color={C.green}>{route.gg ?? '—'}</T> · Vol <T size={11} bold color={C.blue}>{route.volume?.toLocaleString('pt-BR') ?? '—'}</T></T>
                </Row>
                <T size={12} color={C.sub}>{route.cluster}</T>
                {a ? (
                  <Row gap={4}>
                    <T bold>→ {a.name}</T>
                    {ds && <Chip label={`DS ${ds.label}`} color={ds.color} bg={ds.bg} />}
                    {a.daysSinceRoute < 9999 && <Chip label={`${a.daysSinceRoute}d s/ rota`} />}
                  </Row>
                ) : <T size={11} color={C.red}>⚠ Sem Fiorino disponível</T>}
              </Card>
            )
          })}
          <T size={12} bold color={C.sub}>Pool Fiorino ({ns.fiorino.fioDrivers.length})</T>
          {ns.fiorino.fioDrivers.map((d, i) => {
            const at = [...ns.fiorino.assignments.entries()].find(([, x]) => x.driverId === d.driverId)?.[0]
            return (
              <Card key={d.driverId}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T bold>{i + 1}. {d.name}</T>
                  <T bold>{d.priorityScore.toFixed(0)}</T>
                </Row>
                <Row gap={4}>
                  <Chip label={`DS ${getDsMeta(d.dsReal).label}`} color={getDsMeta(d.dsReal).color} />
                  {d.daysSinceRoute < 9999 && <Chip label={`${d.daysSinceRoute}d s/ rota`} />}
                  {d.clusters.slice(0, 3).map(c => <Chip key={c} label={c} />)}
                  {d.clusters.length > 3 && <Chip label={`+${d.clusters.length - 3}`} />}
                </Row>
                {at ? <Chip label={at} color={C.yellow} /> : <T size={11} color={C.dim}>Sem rota elegível no cluster</T>}
              </Card>
            )
          })}
        </>
      )}
      {fcSection === 'novatos' && <NovatosPanel workPref={ns.workPref} routes={ns.routes} availableDrivers={ns.availableDrivers} onAssign={ns.applyOverrideAssignments} />}
      {fcSection === '3pl' && <ThreePlPanel routes={ns.routes} shift={ns.selectedShift} agencies={ns.agencies} excludedRouteIds={ns.excludedRouteIds} assignments={ns.threePlAssignments} setAssignments={ns.setThreePlAssignments} />}
    </View>
  )

  const candidates = (() => {
    if (!assignRoute) return []
    const rv = normalizeVehicle(assignRoute.requiredVehicleType)
    const base = ns.availableDrivers.filter(d => !ns.alreadyRoutedIds.has(d.driverId) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO'))
    const withCluster = base.filter(d => coversCluster(d.clusters, assignRoute.cluster))
    return (withCluster.length > 0 ? withCluster : base).sort((a, b) => {
      if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
      const pa = vehiclePriority(a.vehicleType, assignRoute.requiredVehicleType)
      const pb = vehiclePriority(b.vehicleType, assignRoute.requiredVehicleType)
      return pa !== pb ? pa - pb : b.priorityScore - a.priorityScore
    })
  })()
  const current = assignRoute ? ns.effectiveAssignments.get(assignRoute.id) : undefined

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <DayShiftBar />
      {tab === 'fc' ? (
        <Screen>{header}{fcContent}</Screen>
      ) : tab === 'routes' ? (
        <FlatList
          data={filteredRoutes}
          keyExtractor={r => r.id}
          renderItem={renderRoute}
          ListHeaderComponent={header}
          ListEmptyComponent={<T color={C.muted} style={{ textAlign: 'center', paddingVertical: 40 }}>Nenhuma rota encontrada.</T>}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={filteredDrivers}
          keyExtractor={d => d.driverId}
          renderItem={renderDriver}
          ListHeaderComponent={header}
          ListEmptyComponent={<T color={C.muted} style={{ textAlign: 'center', paddingVertical: 40 }}>{filteredRouted.length ? 'Todos os motoristas já receberam rota.' : 'Nenhum motorista disponível.'}</T>}
          ListFooterComponent={filteredRouted.length > 0 ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <T size={11} bold color={C.dim}>🔒 Já em rota em {ns.selectedDay} — não elegíveis ({filteredRouted.length})</T>
              {filteredRouted.map(d => (
                <Card key={d.driverId} style={{ opacity: 0.7 }}>
                  <T color={C.sub}>{d.name} <T size={10} mono color={C.dim}>{d.driverId}</T></T>
                  <Chip label={`✓ ${ns.routes.find(r => r.status === 'ATRIBUIDA' && r.assignedDriverId === d.driverId)?.atId ?? 'Atribuída'}`} color={C.green} />
                </Card>
              ))}
            </View>
          ) : null}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {flash && (
        <View style={{ position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: '#1a2e1a', borderColor: 'rgba(34,197,94,.4)', borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
          <T size={12} bold color={C.green}>✓ {flash}</T>
        </View>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Ações">
        {menuItems.map(it => (
          <Card key={it.label} onPress={() => { setMenu(false); it.onPress() }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T size={16}>{it.icon}</T><T bold color={it.color ?? C.text}>{it.label}</T>
          </Card>
        ))}
      </Sheet>

      <Sheet open={!!assignRoute} onClose={() => setAssignRoute(null)} title={`Motorista — ${assignRoute?.atId ?? ''}`}>
        {assignRoute && (
          <Row>
            <T size={12} color={C.muted}>📍 {assignRoute.cluster}</T>
            {assignRoute.isInterior && <Chip label="Interior" color={C.yellow} />}
            {assignRoute.requiredVehicleType ? <Chip label={assignRoute.requiredVehicleType} /> : null}
            {assignRoute.gaiola ? <T size={12} color={C.dim}>Gaiola {assignRoute.gaiola}</T> : null}
          </Row>
        )}
        {candidates.length === 0 && <T color={C.muted} style={{ textAlign: 'center', paddingVertical: 20 }}>Nenhum motorista disponível para este cluster.</T>}
        {candidates.map(d => {
          const ds = getDsMeta(d.dsReal)
          const sel = current?.driverId === d.driverId
          const cc = (c: string) => availableCounts.get(normCluster(c)) ?? 0
          return (
            <Card key={d.driverId} style={{ borderColor: sel ? C.accent : d.isBlocked ? 'rgba(239,68,68,.3)' : C.border }}>
              <Row>
                <T bold color={d.isBlocked ? C.red : C.text}>{d.name}</T>
                {sel && <Chip label="Selecionado" color="#a78bfa" />}
                {d.isNewDriver && <Chip label="Novato" color="#a78bfa" />}
                {ns.dobraIds.has(d.driverId) && <Chip label="Dobra" color="#f97316" />}
                {d.isBlocked && <Chip label={blockLabel(d)} color={C.red} />}
              </Row>
              <T size={10} mono color={C.dim}>{d.driverId}</T>
              {d.isBlocked && d.blockReason ? <T size={10} color={C.red}>{d.blockReason}</T> : null}
              <Row gap={4}>
                {d.vehicleType ? <Chip label={d.vehicleType} /> : null}
                <Chip label={`DS ${ds.label}`} color={ds.color} bg={ds.bg} />
                <Chip label={`Score ${d.priorityScore}`} />
              </Row>
              <Row gap={3}>
                {[...d.clusters].sort((a, b) => cc(a) - cc(b)).map(c => {
                  const n = cc(c)
                  const col = n <= 1 ? C.red : n === 2 ? C.yellow : C.dim
                  return <Chip key={c} label={`${c}(${n})`} color={col} bg={`${col}18`} />
                })}
              </Row>
              <Btn small variant={sel ? 'outline' : 'default'} onPress={() => {
                const disp = ns.selectDriver(assignRoute!, d)
                if (disp) setDisplaced({ route: assignRoute!, driver: d, routes: disp })
                else setAssignRoute(null)
              }}>{sel ? 'Selecionado' : 'Selecionar'}</Btn>
            </Card>
          )
        })}
      </Sheet>

      <Sheet open={!!displaced} onClose={() => setDisplaced(null)} title="⚠ Rota ficará sem motorista">
        <T size={12} color={C.muted}>Ao escolher <T bold size={12}>{displaced?.driver.name}</T> para <T bold size={12}>{displaced?.route.atId}</T>, estas rotas ficam sem motorista:</T>
        {displaced?.routes.map(r => <Card key={r.id} style={{ borderColor: 'rgba(245,158,11,.3)' }}><T mono bold size={12}>{r.atId}</T><T size={12} color={C.sub}>{r.cluster}</T></Card>)}
        <Row>
          <Btn variant="outline" onPress={() => setDisplaced(null)}>Cancelar</Btn>
          <Btn variant="danger" onPress={() => { if (displaced) ns.forceSelectDriver(displaced.route, displaced.driver); setDisplaced(null); setAssignRoute(null) }}>Confirmar mesmo assim</Btn>
        </Row>
      </Sheet>

      <Sheet open={!!blockTarget} onClose={() => setBlockTarget(null)} title="⊘ Bloquear motorista">
        <T bold>{blockTarget?.name} <T size={11} mono color={C.dim}>{blockTarget?.driverId}</T></T>
        <T size={12} color={C.muted}>O motorista fica bloqueado para receber rotas.</T>
        <Input value={blockReason} onChangeText={setBlockReason} placeholder="Motivo" />
        <Row gap={6}>{QUICK_REASONS.map(r => <Chip key={r} label={r} active={blockReason === r} color="#a78bfa" onPress={() => setBlockReason(r)} />)}</Row>
        <Btn variant="danger" disabled={!blockReason.trim()} onPress={() => { if (blockTarget) ns.addManualBlock(blockTarget.driverId, blockTarget.name, blockReason.trim()); setBlockTarget(null) }}>⊘ Bloquear</Btn>
      </Sheet>

      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="⊘ Bloquear lista">
        <T size={12} color={C.muted}>Cole os IDs (um por linha ou separados por vírgula/espaço). Todos recebem o mesmo motivo.</T>
        <Input multiline mono value={bulkIds} onChangeText={setBulkIds} placeholder={'12345678\n87654321'} />
        {bulkIds.trim() !== '' && <T size={11} color={C.blue}>{bulkIds.split(/[\n,;\s]+/).filter(Boolean).length} ID(s) detectado(s)</T>}
        <Input value={bulkReason} onChangeText={setBulkReason} placeholder="Motivo" />
        <Row gap={6}>{QUICK_REASONS.map(r => <Chip key={r} label={r} active={bulkReason === r} color="#a78bfa" onPress={() => setBulkReason(r)} />)}</Row>
        <Btn variant="danger" disabled={!bulkIds.trim() || !bulkReason.trim()} onPress={() => { ns.addBulkBlocks(bulkIds, bulkReason.trim()); setBulkOpen(false) }}>⊘ Bloquear todos</Btn>
      </Sheet>

      <Sheet open={!!ns.assignResults} onClose={() => ns.setAssignResults(null)} title="Resultado da atribuição">
        {ns.assignResults?.map((r, i) => (
          <Card key={i}>
            <T mono size={12}>{ns.spxConfigured ? (r.spxOk ? '✅' : '❌') : '✅'} {r.driverId} → <T mono bold size={12}>{r.atId}</T></T>
            {ns.spxConfigured && <T size={11} color={r.spxOk ? C.green : C.red}>SPX: {r.spxMsg}</T>}
          </Card>
        ))}
        {ns.spxConfigured && ns.assignResults && (
          <T size={12} color={C.muted}>
            <T size={12} color={C.green}>{ns.assignResults.filter(r => r.spxOk).length} enviados</T>
            {ns.assignResults.some(r => r.spxOk === false) ? <T size={12} color={C.red}> · {ns.assignResults.filter(r => r.spxOk === false).length} falhas</T> : null}
          </T>
        )}
        <Row>
          {ns.spxConfigured && ns.assignResults?.some(r => r.spxOk === false) && <Btn variant="outline" loading={ns.isRetrying} onPress={() => void ns.handleRetryFailed()}>↺ Tentar falhas</Btn>}
          <Btn onPress={() => ns.setAssignResults(null)}>Fechar</Btn>
        </Row>
      </Sheet>

      <SpxCredsSheet open={spxOpen} onClose={() => setSpxOpen(false)} configured={ns.spxConfigured} onChange={ns.setSpxConfigured} />
      <BatchSheet open={batchOpen} onClose={() => setBatchOpen(false)} onApply={ns.handleBatchAssign} spxConfigured={ns.spxConfigured} />
      <AddRouteSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        routes={ns.routes}
        visibleAtIds={new Set(ns.noShowRoutes.map(r => r.atId))}
        ignoredAtIds={ns.ignoredAtIds}
        onRestore={ats => ns.setIgnoredAtIds(s => { const n = new Set(s); ats.forEach(a => n.delete(a)); return n })}
        onForce={ns.forceRoutes}
      />
      {reportSnap && <ReportSheet open onClose={() => setReportSnap(null)} snap={reportSnap} day={ns.selectedDay} shift={ns.selectedShift} />}
    </View>
  )
}
