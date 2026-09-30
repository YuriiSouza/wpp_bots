import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { router } from 'expo-router'
import { Btn, C, Card, Chip, Input, NeedsData, Row, Screen, Segmented, Sheet, Stat, StatRow, T, copy } from '@/components/ui'
import { HBar, Legend, StackBar } from '@/components/HBar'
import { useAppData } from '@/lib/appData'
import type { StoredDriver } from '@/lib/localStore'
import { licenseStatus } from '@/components/driver'

type Tab = 'stats' | 'list' | 'phones'

const STATUS_COLOR: Record<string, string> = {
  Active: '#22c55e', 'Auto-Inactive': '#6b7280', Onboarding: '#3b82f6', 'Pending Driver Acceptance': '#8b5cf6',
  Suspended: '#f59e0b', 'Suspended(KYC)': '#ef4444', 'Suspended(FV)': '#ef4444', 'Pre-Suspended': '#f97316',
  Deactivated: '#dc2626', Terminated: '#374151', 'Inactive Onboarding': '#4b5563',
}
const VEHICLE_COLOR: Record<string, string> = {
  Car: '#3b82f6', PASSEIO: '#3b82f6', Motorcycle: '#f59e0b', MOTO: '#f59e0b', Bicycle: '#22c55e', BICICLETA: '#22c55e',
  Walker: '#8b5cf6', Van: '#06b6d4', VAN: '#06b6d4', FIORINO: '#06b6d4',
}

function groupCount<T>(items: T[], key: (i: T) => string) {
  const m = new Map<string, number>()
  for (const i of items) { const k = key(i) || 'N/A'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

function Stats({ drivers }: { drivers: StoredDriver[] }) {
  const total = drivers.length
  const active = drivers.filter(d => d.status === 'Active').length
  const onboarding = drivers.filter(d => d.status === 'Onboarding').length
  const suspended = drivers.filter(d => d.status?.startsWith('Suspended')).length
  const byStatus = groupCount(drivers, d => d.status)
  const byVehicle = groupCount(drivers, d => d.vehicleType).slice(0, 8)
  const byAgency = groupCount(drivers, d => (d.agency === 'SPXOWNFLEET' ? 'Frota própria (SPX)' : d.agency || 'N/A'))
  const byCity = groupCount(drivers, d => d.city).slice(0, 6)
  const byGender = groupCount(drivers, d => d.gender || 'N/A')
  const [now] = useState(() => Date.now())
  const seniority = [
    { label: '<1m', min: 0, max: 30, color: '#ef4444' }, { label: '1–3m', min: 30, max: 90, color: '#f59e0b' },
    { label: '3–6m', min: 90, max: 180, color: '#eab308' }, { label: '6–12m', min: 180, max: 365, color: '#22c55e' },
    { label: '1–2a', min: 365, max: 730, color: '#3b82f6' }, { label: '>2a', min: 730, max: Infinity, color: '#8b5cf6' },
  ].map(b => ({ ...b, count: drivers.filter(d => { if (!d.joinedDate) return false; const days = (now - new Date(d.joinedDate).getTime()) / 86400000; return days >= b.min && days < b.max }).length }))
  const maxSen = Math.max(1, ...seniority.map(s => s.count))

  return (
    <View style={{ gap: 12 }}>
      <StatRow>
        <Stat label="Total" value={total.toLocaleString('pt-BR')} />
        <Stat label="Ativos" value={active.toLocaleString('pt-BR')} color="#22c55e" sub={`${total ? Math.round((active / total) * 100) : 0}%`} />
        <Stat label="Onboarding" value={onboarding} color="#3b82f6" />
        <Stat label="Suspensos" value={suspended} color="#f59e0b" />
        <Stat label="Inativos" value={total - active - onboarding - suspended} color="#6b7280" />
      </StatRow>
      <Card>
        <T size={10} bold color={C.dim}>STATUS</T>
        <StackBar parts={byStatus.map(s => ({ key: s.name, value: s.count, color: STATUS_COLOR[s.name] ?? '#4a5568' }))} />
        <Legend items={byStatus.map(s => ({ label: s.name, value: s.count, color: STATUS_COLOR[s.name] ?? '#4a5568' }))} />
      </Card>
      <Card>
        <T size={10} bold color={C.dim}>TIPO DE VEÍCULO</T>
        {byVehicle.map(v => <HBar key={v.name} name={v.name} count={v.count} max={byVehicle[0].count} color={VEHICLE_COLOR[v.name] ?? '#8b5cf6'} />)}
      </Card>
      <Card>
        <T size={10} bold color={C.dim}>TEMPO DE CASA</T>
        {seniority.map(s => <HBar key={s.label} name={s.label} count={s.count} max={maxSen} color={s.color} />)}
      </Card>
      <Card>
        <T size={10} bold color={C.dim}>AGÊNCIA</T>
        {byAgency.slice(0, 5).map(a => <HBar key={a.name} name={a.name} count={a.count} max={byAgency[0].count} color={a.name.includes('SPX') || a.name.includes('Frota') ? '#22c55e' : '#8b5cf6'} />)}
      </Card>
      <Card>
        <T size={10} bold color={C.dim}>GÊNERO</T>
        {byGender.map((g, i) => <HBar key={g.name} name={g.name} count={g.count} max={total} suffix={` · ${total ? Math.round((g.count / total) * 100) : 0}%`} color={g.name === 'Male' ? '#3b82f6' : g.name === 'Female' ? '#ec4899' : ['#8b5cf6', '#22c55e', '#f59e0b'][i % 3]} />)}
      </Card>
      <Card>
        <T size={10} bold color={C.dim}>TOP CIDADES</T>
        {byCity.map((c, i) => <HBar key={c.name} name={c.name} count={c.count} max={byCity[0].count} rank={i + 1} color={`hsl(${215 + i * 15}, 65%, 55%)`} />)}
      </Card>
    </View>
  )
}

function Picker({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)?.label ?? label
  return (
    <>
      <Btn small variant="outline" onPress={() => setOpen(true)}>{`${current} ▾`}</Btn>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.map(o => (
          <Card key={o.value} onPress={() => { onChange(o.value); setOpen(false) }} style={{ borderColor: o.value === value ? C.accent : C.border }}>
            <T>{o.label}</T>
          </Card>
        ))}
      </Sheet>
    </>
  )
}

function List({ drivers }: { drivers: StoredDriver[] }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [vehicle, setVehicle] = useState('all')
  const [agency, setAgency] = useState('all')
  const statuses = useMemo(() => ['all', ...new Set(drivers.map(d => d.status).filter(Boolean).sort())], [drivers])
  const vehicles = useMemo(() => ['all', ...new Set(drivers.map(d => d.vehicleType).filter(Boolean).sort())], [drivers])
  const agencies = useMemo(() => ['all', ...new Set(drivers.map(d => d.agency).filter(Boolean))], [drivers])
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => {
      if (q && !d.name.toLowerCase().includes(q) && !d.id.includes(q) && !d.city?.toLowerCase().includes(q)) return false
      if (status !== 'all' && d.status !== status) return false
      if (vehicle !== 'all' && d.vehicleType !== vehicle) return false
      if (agency !== 'all' && d.agency !== agency) return false
      return true
    })
  }, [drivers, search, status, vehicle, agency])

  return (
    <FlatList
      data={filtered}
      keyExtractor={d => d.id}
      initialNumToRender={20}
      contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <Input value={search} onChangeText={setSearch} placeholder="🔍 Nome, ID ou cidade" />
          <Row gap={6}>
            <Picker label="Status" value={status} onChange={setStatus} options={statuses.map(s => ({ value: s, label: s === 'all' ? 'Todos status' : s }))} />
            <Picker label="Veículo" value={vehicle} onChange={setVehicle} options={vehicles.map(v => ({ value: v, label: v === 'all' ? 'Todos veículos' : v }))} />
            <Picker label="Agência" value={agency} onChange={setAgency} options={agencies.map(a => ({ value: a, label: a === 'all' ? 'Todas agências' : a === 'SPXOWNFLEET' ? 'Frota própria' : a }))} />
          </Row>
          <T size={12} color={C.muted}>{filtered.length} motoristas</T>
        </View>
      }
      ListEmptyComponent={<T color={C.muted} style={{ textAlign: 'center', paddingVertical: 30 }}>Nenhum motorista encontrado.</T>}
      renderItem={({ item: d }) => {
        const lic = licenseStatus(d.licenseExpiryDate)
        return (
          <Card onPress={() => router.push({ pathname: '/motorista/[id]', params: { id: d.id } })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T bold style={{ flex: 1 }} numberOfLines={1}>{d.name || '—'}</T>
              <Chip label={d.status || '—'} color={STATUS_COLOR[d.status] ?? C.sub} />
            </Row>
            <T size={11} color={C.dim}><T size={11} mono color={C.dim}>{d.id}</T> · {d.vehicleType || '—'} · {d.agency === 'SPXOWNFLEET' ? 'Frota própria' : d.agency || '—'} · {d.city || '—'}</T>
            {(d.spxBlocklisted || lic) && (
              <Row gap={4}>
                {d.spxBlocklisted && <Chip label="Blocklist" color={C.red} />}
                {lic && <Chip label={lic.label} color={lic.color} />}
              </Row>
            )}
          </Card>
        )
      }}
    />
  )
}

function PhoneLookup({ drivers }: { drivers: StoredDriver[] }) {
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const ids = input.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
  const byId = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])
  const results = ids.map(id => { const d = byId.get(id); return { id, name: d?.name ?? null, phone: d?.phoneNumber?.replace(/\D/g, '') || null } })
  const found = results.filter(r => r.phone)
  const doCopy = async (text: string, key: string) => { await copy(text); setCopied(key); setTimeout(() => setCopied(null), 1500) }
  return (
    <Screen>
      <Input multiline mono value={input} onChangeText={setInput} placeholder={'Cole os IDs (um por linha ou separados por vírgula)\n\n12345678\n87654321'} style={{ minHeight: 120 }} />
      {ids.length > 0 && (
        <Row style={{ justifyContent: 'space-between' }}>
          <T size={12} color={C.muted}>{found.length} de {ids.length} encontrados</T>
          {found.length > 0 && <Btn small variant={copied === 'all' ? 'success' : 'outline'} onPress={() => doCopy(found.map(r => r.phone).join('\n'), 'all')}>{copied === 'all' ? '✓ Copiado' : '📋 Copiar todos'}</Btn>}
        </Row>
      )}
      {results.map(r => (
        <Card key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: r.phone ? C.border : '#3f1515' }}>
          <View style={{ flex: 1 }}>
            <T size={11} mono color={C.dim}>{r.id}</T>
            {r.name ? <T size={13}>{r.name}</T> : null}
            {!r.phone && <T size={11} color={C.red}>não encontrado</T>}
          </View>
          {r.phone && <Btn small variant={copied === r.id ? 'success' : 'outline'} onPress={() => doCopy(r.phone!, r.id)}>{copied === r.id ? '✓' : r.phone}</Btn>}
        </Card>
      ))}
    </Screen>
  )
}

export default function Motoristas() {
  const { registry, driversMeta } = useAppData()
  const [tab, setTab] = useState<Tab>('stats')
  if (registry.length === 0) return <Screen><NeedsData what="motoristas (cadastro)" /></Screen>
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
        {driversMeta && <T size={11} color={C.muted}>{driversMeta.total} motoristas · {driversMeta.fileName} · {new Date(driversMeta.importedAt).toLocaleDateString('pt-BR')}</T>}
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'stats', label: 'Estatísticas' }, { value: 'list', label: `Lista (${registry.length})` }, { value: 'phones', label: '📞 Telefones' }]} />
      </View>
      {tab === 'stats' && <Screen><Stats drivers={registry} /></Screen>}
      {tab === 'list' && <List drivers={registry} />}
      {tab === 'phones' && <PhoneLookup drivers={registry} />}
    </View>
  )
}
