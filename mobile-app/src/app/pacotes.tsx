import { useMemo, useState } from 'react'
import { FlatList, Linking, Platform, ScrollView, Share, View } from 'react-native'
import { Btn, C, Card, Chip, Input, NeedsData, Row, Screen, Segmented, Sheet, Stat, StatRow, T, copy } from '@/components/ui'
import { useAppData } from '@/lib/appData'
import type { ForwardOrderAnalysis, ForwardPackage } from '@/lib/forwardOrderParser'

type Tab = 'criticos' | 'agencias' | 'pivot' | 'mapa' | 'lista'
interface Meta { vehicleType: string; ds: number | null; phoneNumber: string; agency: string; isNewDriver?: boolean }
const DELIVERING = 'Sem resolução (Delivering)'
const DRIVER_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6', '#6366f1', '#eab308', '#10b981', '#f43f5e', '#8b5cf6', '#0ea5e9', '#d946ef', '#fb923c', '#a3e635', '#2dd4bf']

function MetaLine({ id, meta }: { id: string; meta: Map<string, Meta> }) {
  const m = meta.get(id)
  return (
    <T size={10} color={C.faint}>
      <T size={10} mono color={C.dim}>{id}</T>
      {m?.vehicleType ? `  ${m.vehicleType}` : ''}{m?.ds != null ? `  DS ${(m.ds * 100).toFixed(2)}%` : ''}{m?.agency ? `  ${m.agency}` : ''}
    </T>
  )
}

function waOpen(phone: string, text?: string) {
  const d = phone.replace(/\D/g, '')
  Linking.openURL(`https://wa.me/${d.startsWith('55') ? d : `55${d}`}${text ? `?text=${encodeURIComponent(text)}` : ''}`)
}

function openMap(lat: number, lng: number, label: string) {
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}` : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`
  Linking.openURL(url)
}

function Criticos({ data, meta }: { data: ForwardOrderAnalysis; meta: Map<string, Meta> }) {
  const [copied, setCopied] = useState<string | null>(null)
  const phoneOf = (id: string) => meta.get(id)?.phoneNumber || ''
  if (data.criticalDrivers.length === 0) {
    return <View style={{ alignItems: 'center', paddingVertical: 40, gap: 6 }}><T size={28}>✅</T><T bold color={C.green}>Nenhum motorista crítico</T><T size={12} color={C.muted}>Todos têm menos de 10 pacotes em aberto</T></View>
  }
  const doCopy = async (t: string, k: string) => { await copy(t); setCopied(k); setTimeout(() => setCopied(null), 1500) }
  return (
    <View style={{ gap: 8 }}>
      <Btn small variant={copied === 'all' ? 'success' : 'outline'} onPress={() => { const p = data.criticalDrivers.map(d => phoneOf(d.driverId)).filter(Boolean); if (p.length) doCopy(p.join('\n'), 'all') }}>
        {copied === 'all' ? '✓ Copiado!' : '📋 Copiar todos os números'}
      </Btn>
      {data.criticalDrivers.map(d => {
        const phone = phoneOf(d.driverId)
        return (
          <Card key={d.driverId}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T bold style={{ flex: 1 }}>{d.driverName}</T>
              <Chip label={String(d.totalPackages)} color="#a78bfa" />
            </Row>
            <MetaLine id={d.driverId} meta={meta} />
            <T size={11} color={C.sub}><T size={11} color="#f59e0b">{d.delivering} delivering</T> · <T size={11} color="#ef4444">{d.onHold} on hold</T>{d.oldestDays > 0 ? <T size={11} color={d.oldestDays >= 3 ? '#ef4444' : d.oldestDays >= 2 ? '#f59e0b' : C.muted}> · mais antigo {d.oldestDays}d</T> : null}</T>
            {Object.entries(d.byReason).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => <T key={r} size={11} color={C.sub}>{r}: <T size={11} bold>{n}</T></T>)}
            {phone ? (
              <Row gap={6}>
                <Btn small variant={copied === d.driverId ? 'success' : 'outline'} onPress={() => doCopy(phone, d.driverId)}>{copied === d.driverId ? '✓' : `📋 ${phone}`}</Btn>
                <Btn small variant="success" onPress={() => waOpen(phone, `Olá ${d.driverName}, tudo bem? Preciso falar sobre seus pacotes em aberto.`)}>WhatsApp</Btn>
              </Row>
            ) : null}
          </Card>
        )
      })}
    </View>
  )
}

function Agencias({ data, meta }: { data: ForwardOrderAnalysis; meta: Map<string, Meta> }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const stats = useMemo(() => {
    const UNKNOWN = '(sem agência)'
    const map = new Map<string, { agency: string; total: number; delivering: number; onHold: number; byReason: Record<string, number>; drivers: Map<string, { driverId: string; driverName: string; total: number; delivering: number; onHold: number; vehicleType: string; isNewDriver: boolean }> }>()
    for (const p of data.packages) {
      const agency = meta.get(p.driverId)?.agency?.trim() || UNKNOWN
      const s = map.get(agency) ?? { agency, total: 0, delivering: 0, onHold: 0, byReason: {} as Record<string, number>, drivers: new Map() }
      s.total++
      if (p.status === 'Delivering') s.delivering++; else s.onHold++
      if (p.displayReason) s.byReason[p.displayReason] = (s.byReason[p.displayReason] ?? 0) + 1
      const d = s.drivers.get(p.driverId) ?? { driverId: p.driverId, driverName: p.driverName, total: 0, delivering: 0, onHold: 0, vehicleType: meta.get(p.driverId)?.vehicleType ?? '', isNewDriver: meta.get(p.driverId)?.isNewDriver ?? false }
      d.total++
      if (p.status === 'Delivering') d.delivering++; else d.onHold++
      s.drivers.set(p.driverId, d)
      map.set(agency, s)
    }
    const critical = new Set(data.criticalDrivers.map(d => d.driverId))
    return [...map.values()].map(s => {
      const driverList = [...s.drivers.values()].map(d => ({ ...d, isCritical: critical.has(d.driverId) })).sort((a, b) => b.total - a.total)
      return { ...s, driverList, criticalDrivers: driverList.filter(d => d.isCritical).length }
    }).sort((a, b) => b.total - a.total)
  }, [data, meta])
  const grand = stats.reduce((s, a) => s + a.total, 0)

  const share = (s: (typeof stats)[number]) => {
    const lines = [
      `📦 ${s.agency} — pacotes em aberto (${new Date(data.importedAt).toLocaleDateString('pt-BR')})`,
      `Total: ${s.total} · Delivering: ${s.delivering} · On Hold: ${s.onHold} · Motoristas: ${s.driverList.length}${s.criticalDrivers ? ` · Críticos: ${s.criticalDrivers}` : ''}`,
      '', 'Motivos:',
      ...Object.entries(s.byReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => `• ${r}: ${n}`),
      '', 'Motoristas:',
      ...s.driverList.map(d => `• ${d.driverName} (${d.driverId})${d.isCritical ? ' CRÍTICO' : ''}${d.isNewDriver ? ' NOVATO' : ''} — ${d.total} (${d.delivering} deliv. / ${d.onHold} hold)`),
    ]
    Share.share({ message: lines.join('\n') })
  }

  return (
    <View style={{ gap: 8 }}>
      <T size={12} color={C.dim}>{stats.length} agências · {grand} pacotes{stats.some(s => s.agency === '(sem agência)') ? <T size={12} color={C.yellow}>  ⚠ sem agência no cadastro contam como “(sem agência)”</T> : null}</T>
      {stats.map(s => {
        const open = expanded === s.agency
        const top = Object.entries(s.byReason).sort((a, b) => b[1] - a[1])[0]
        const pct = grand ? (s.total / grand) * 100 : 0
        return (
          <Card key={s.agency} onPress={() => setExpanded(open ? null : s.agency)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T bold style={{ flex: 1 }}>{open ? '▾' : '▸'} {s.agency}</T>
              <Chip label={String(s.total)} color="#a78bfa" />
            </Row>
            <T size={11} color={C.sub}><T size={11} color="#f59e0b">{s.delivering} deliv.</T> · <T size={11} color="#ef4444">{s.onHold} hold</T> · {s.driverList.length} motoristas{s.criticalDrivers ? <T size={11} color={C.red}> · {s.criticalDrivers} críticos</T> : null} · {pct.toFixed(1)}%</T>
            {top && <T size={11} color={C.dim}>Top: <T size={11} bold>{top[1]}</T> {top[0]}</T>}
            {open && (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Row gap={4}>{Object.entries(s.byReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => <Chip key={r} label={`${r}: ${n}`} />)}</Row>
                <Btn small variant="outline" onPress={() => share(s)}>📤 Compartilhar resumo</Btn>
                {s.driverList.map(d => (
                  <View key={d.driverId} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 5 }}>
                    <T size={12} bold={d.isCritical} color={d.isCritical ? C.red : C.text}>{d.driverName}{d.isNewDriver ? '  · NOVATO' : ''}{d.isCritical ? '  · CRÍTICO' : ''}</T>
                    <T size={11} color={C.dim}>{d.driverId} · {d.vehicleType || '—'} · <T size={11} color="#a78bfa">{d.total}</T> ({d.delivering || 0} / {d.onHold || 0})</T>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )
      })}
    </View>
  )
}

function Pivot({ data }: { data: ForwardOrderAnalysis }) {
  const reasons = [...(data.reasons.includes(DELIVERING) ? [DELIVERING] : []), ...data.reasons.filter(r => r !== DELIVERING)]
  const dates = data.pivot.map(r => r.date)
  const rowMax = Object.fromEntries(reasons.map(r => [r, Math.max(1, ...data.pivot.map(p => p.byReason[r] ?? 0))]))
  const total = (r: string) => data.pivot.reduce((s, p) => s + (p.byReason[r] ?? 0), 0)
  const cellBg = (r: string, v?: number) => (!v ? 'transparent' : r === DELIVERING ? `rgba(245,158,11,${0.07 + (v / rowMax[r]) * 0.38})` : `rgba(239,68,68,${0.05 + (v / rowMax[r]) * 0.38})`)
  const W = 44
  return (
    <View style={{ gap: 8 }}>
      <T size={11} color={C.dim}>Vermelho = On Hold, amarelo = Delivering. Intensidade relativa por motivo. Arraste para o lado para ver as datas.</T>
      <View style={{ flexDirection: 'row' }}>
        <View>
          <View style={{ height: 26, justifyContent: 'center' }}><T size={10} bold color={C.muted}>MOTIVO</T></View>
          {reasons.map(r => <View key={r} style={{ height: 30, justifyContent: 'center', width: 150 }}><T size={11} numberOfLines={2} color={r === DELIVERING ? C.yellow : C.red}>{r}</T></View>)}
          <View style={{ height: 30, justifyContent: 'center' }}><T size={10} bold color={C.muted}>TOTAL/DATA</T></View>
        </View>
        <ScrollView horizontal>
          <View>
            <View style={{ flexDirection: 'row', height: 26 }}>
              {dates.map(d => <View key={d} style={{ width: W, alignItems: 'center', justifyContent: 'center' }}><T size={10} color={C.muted}>{d.slice(5)}</T></View>)}
              <View style={{ width: W, alignItems: 'center', justifyContent: 'center' }}><T size={10} bold color={C.sub}>Total</T></View>
            </View>
            {reasons.map(r => (
              <View key={r} style={{ flexDirection: 'row', height: 30, borderTopWidth: 1, borderTopColor: C.line }}>
                {dates.map(d => {
                  const v = data.pivot.find(p => p.date === d)?.byReason[r]
                  return <View key={d} style={{ width: W, alignItems: 'center', justifyContent: 'center', backgroundColor: cellBg(r, v) }}><T size={12} bold={!!v} color={!v ? '#374151' : r === DELIVERING ? C.yellow : C.red}>{v ?? '—'}</T></View>
                })}
                <View style={{ width: W, alignItems: 'center', justifyContent: 'center' }}><T size={12} bold color={r === DELIVERING ? C.yellow : C.red}>{total(r) || '—'}</T></View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', height: 30, borderTopWidth: 2, borderTopColor: C.border }}>
              {dates.map(d => <View key={d} style={{ width: W, alignItems: 'center', justifyContent: 'center' }}><T size={12} bold>{data.pivot.find(p => p.date === d)?.total ?? '—'}</T></View>)}
              <View style={{ width: W, alignItems: 'center', justifyContent: 'center' }}><T size={12} bold>{data.totalPackages}</T></View>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  )
}

function Mapa({ data }: { data: ForwardOrderAnalysis }) {
  const [selected, setSelected] = useState('all')
  const [pick, setPick] = useState(false)
  const withCoords = useMemo(() => data.packages.filter(p => p.latitude != null && p.longitude != null), [data.packages])
  const drivers = useMemo(() => {
    const ids = [...new Set(withCoords.map(p => p.driverId))]
    return ids.map((id, i) => ({ id, name: withCoords.find(p => p.driverId === id)?.driverName ?? id, color: DRIVER_COLORS[i % DRIVER_COLORS.length], count: withCoords.filter(p => p.driverId === id).length }))
  }, [withCoords])
  if (withCoords.length === 0) return <View style={{ alignItems: 'center', paddingVertical: 40, gap: 6 }}><T size={28}>🗺️</T><T size={13} color={C.dim}>Nenhum pacote com coordenadas</T></View>
  const shown = selected === 'all' ? withCoords : withCoords.filter(p => p.driverId === selected)
  const color = (id: string) => drivers.find(d => d.id === id)?.color ?? C.sub
  return (
    <View style={{ gap: 8 }}>
      <T size={11} color={C.dim}>Toque num pacote para abrir a localização no app de mapas.</T>
      <Btn small variant="outline" onPress={() => setPick(true)}>{selected === 'all' ? `Todos os motoristas (${withCoords.length} pacotes) ▾` : `${drivers.find(d => d.id === selected)?.name} ▾`}</Btn>
      {shown.map((p, i) => {
        const office = (p.locationType || '').toLowerCase().includes('office')
        return (
          <Card key={p.orderId + i} onPress={() => openMap(p.latitude!, p.longitude!, p.trackingNumber || p.orderId)} style={{ borderLeftWidth: 4, borderLeftColor: color(p.driverId) }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T mono size={12} color={C.blue}>{p.trackingNumber || p.orderId}</T>
              <T size={11}>{office ? '🏢' : '🏠'} 📍</T>
            </Row>
            <T size={12}>{p.driverName} <T size={10} mono color={C.dim}>{p.driverId}</T></T>
            <T size={11} color={p.status === 'Delivering' ? '#f59e0b' : '#ef4444'}>{p.status}{p.displayReason ? <T size={11} color={C.sub}> — {p.displayReason}</T> : null}</T>
          </Card>
        )
      })}
      <Sheet open={pick} onClose={() => setPick(false)} title="Motorista">
        <Card onPress={() => { setSelected('all'); setPick(false) }}><T>Todos ({withCoords.length})</T></Card>
        {drivers.map(d => (
          <Card key={d.id} onPress={() => { setSelected(d.id); setPick(false) }} style={{ borderLeftWidth: 4, borderLeftColor: d.color }}>
            <T>{d.name} — {d.count} pacotes</T>
          </Card>
        ))}
      </Sheet>
    </View>
  )
}

function Lista({ data, meta }: { data: ForwardOrderAnalysis; meta: Map<string, Meta> }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'Delivering' | 'OnHold'>('all')
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return data.packages.filter(p => (!q || p.driverName.toLowerCase().includes(q) || p.driverId.includes(q) || p.trackingNumber.toLowerCase().includes(q)) && (status === 'all' || p.status === status))
  }, [data.packages, search, status])
  return (
    <FlatList
      data={filtered}
      keyExtractor={(p: ForwardPackage, i) => p.orderId + i}
      initialNumToRender={25}
      contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <Input value={search} onChangeText={setSearch} placeholder="🔍 Motorista ou rastreio" />
          <Segmented value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todos' }, { value: 'Delivering', label: 'Delivering' }, { value: 'OnHold', label: 'On Hold' }]} colors={{ Delivering: C.yellow, OnHold: C.red }} />
          <T size={12} color={C.muted}>{filtered.length} pacotes</T>
        </View>
      }
      renderItem={({ item: p }) => (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T mono size={12} color={C.blue}>{p.trackingNumber || p.orderId}</T>
            <Chip label={p.status} color={p.status === 'Delivering' ? C.yellow : C.red} />
          </Row>
          <T size={12}>{p.driverName}</T>
          <MetaLine id={p.driverId} meta={meta} />
          <T size={11} color={C.sub}>{p.displayReason}</T>
          <T size={11} color={C.dim}>
            Saída {p.deliveringTime || p.onHoldTime || '—'}
            {p.daysOpen > 0 ? <T size={11} bold={p.daysOpen >= 2} color={p.daysOpen >= 3 ? '#ef4444' : p.daysOpen >= 2 ? '#f59e0b' : C.muted}> · {p.daysOpen}d</T> : null}
            {p.deliveryAttempts ? ` · ${p.deliveryAttempts} tentativas` : ''}
          </T>
        </Card>
      )}
    />
  )
}

export default function Pacotes() {
  const { forwardOrder: data, registry, driverMeta } = useAppData()
  const [tab, setTab] = useState<Tab>('criticos')
  const meta = useMemo(() => {
    const m = new Map<string, Meta>()
    for (const d of registry) m.set(d.id, { vehicleType: d.vehicleType, ds: null, phoneNumber: d.phoneNumber, agency: d.agency })
    for (const [id, dm] of driverMeta) {
      const prev = m.get(id) ?? { vehicleType: '', ds: null, phoneNumber: '', agency: '' }
      m.set(id, { ...prev, vehicleType: dm.vehicleType || prev.vehicleType, ds: dm.ds, isNewDriver: dm.isNewDriver ?? prev.isNewDriver })
    }
    return m
  }, [registry, driverMeta])
  if (!data) return <NeedsData what="pacotes em aberto" />

  const header = (
    <View style={{ padding: 14, paddingBottom: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <T size={11} color={C.muted}>{data.fileName} · {new Date(data.importedAt).toLocaleDateString('pt-BR')}</T>
      <StatRow>
        <Stat label="Em aberto" value={data.totalPackages} />
        <Stat label="Delivering" value={data.totalDelivering} color="#f59e0b" />
        <Stat label="On Hold" value={data.totalOnHold} color="#ef4444" />
        <Stat label="Críticos (10+)" value={data.criticalDrivers.length} color="#a78bfa" />
      </StatRow>
      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: 'criticos', label: `Críticos (${data.criticalDrivers.length})` }, { value: 'agencias', label: 'Por Agência' },
        { value: 'pivot', label: 'Data × Motivo' }, { value: 'mapa', label: 'Mapa' }, { value: 'lista', label: `Todos (${data.totalPackages})` },
      ]} />
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      {tab === 'lista' ? <Lista data={data} meta={meta} /> : (
        <Screen>
          {tab === 'criticos' && <Criticos data={data} meta={meta} />}
          {tab === 'agencias' && <Agencias data={data} meta={meta} />}
          {tab === 'pivot' && <Pivot data={data} />}
          {tab === 'mapa' && <Mapa data={data} />}
        </Screen>
      )}
    </View>
  )
}
