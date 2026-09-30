import { useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native'
import { Btn, C, Card, Chip, Input, Row, Sheet, T } from '@/components/ui'
import { useAppData } from '@/lib/appData'
import { getManualBlocks, saveManualBlocks, type ManualBlock } from '@/features/noshow/logic'

type BlockType = 'auto' | 'manual' | 'registry'
interface BlockedDriver { driverId: string; name: string; vehicleType: string | null; blockType: BlockType; blockReason: string; blockedAt: string | null }

const META: Record<BlockType, { label: string; color: string; desc: string }> = {
  auto: { label: '📦 Redelivery', color: '#f97316', desc: 'Forward Order > 5 pacotes' },
  manual: { label: '⊘ Manual', color: '#f87171', desc: 'Bloqueado manualmente' },
  registry: { label: '⊘ SPX Blocklist', color: '#a78bfa', desc: 'Marcado na planilha de registro' },
}
const QUICK_REASONS = ['No-show', 'Atraso', 'Documento pendente', 'Redelivery', 'Ocorrência']

export default function Bloqueados() {
  const { registry, forwardOrder, workPref, version } = useAppData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => getManualBlocks(), [version])
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'all' | BlockType>('all')
  const [single, setSingle] = useState<{ id: string } | null>(null)
  const [reason, setReason] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkIds, setBulkIds] = useState('')

  const setBlocks = (b: ManualBlock[]) => saveManualBlocks(b)
  const nameMap = useMemo(() => new Map(workPref?.drivers.map(d => [d.driverId, d.driverName]) ?? []), [workPref])

  const all = useMemo((): BlockedDriver[] => {
    const out: BlockedDriver[] = []
    const seen = new Set<string>()
    const vehMap = new Map(workPref?.drivers.map(d => [d.driverId, d.vehicleType]) ?? [])
    const reg = new Map(registry.map(d => [d.id, d]))
    for (const d of forwardOrder?.allDrivers ?? []) {
      if (d.totalPackages <= 5) continue
      seen.add(d.driverId)
      out.push({ driverId: d.driverId, name: nameMap.get(d.driverId) ?? reg.get(d.driverId)?.name ?? d.driverId, vehicleType: vehMap.get(d.driverId) ?? reg.get(d.driverId)?.vehicleType ?? null, blockType: 'auto', blockReason: `${d.totalPackages} pacotes pendentes`, blockedAt: null })
    }
    for (const b of blocks) {
      if (seen.has(b.driverId)) continue
      seen.add(b.driverId)
      out.push({ driverId: b.driverId, name: b.driverName !== b.driverId ? b.driverName : (nameMap.get(b.driverId) ?? reg.get(b.driverId)?.name ?? b.driverId), vehicleType: vehMap.get(b.driverId) ?? reg.get(b.driverId)?.vehicleType ?? null, blockType: 'manual', blockReason: b.reason, blockedAt: b.blockedAt })
    }
    for (const d of registry) {
      if (!d.spxBlocklisted || seen.has(d.id)) continue
      seen.add(d.id)
      out.push({ driverId: d.id, name: d.name, vehicleType: d.vehicleType ?? null, blockType: 'registry', blockReason: 'SPX Blocklist (planilha de registro)', blockedAt: null })
    }
    const order: Record<BlockType, number> = { auto: 0, manual: 1, registry: 2 }
    return out.sort((a, b) => order[a.blockType] - order[b.blockType])
  }, [blocks, forwardOrder, registry, workPref, nameMap])

  const q = search.toLowerCase()
  const filtered = all.filter(d => (type === 'all' || d.blockType === type) && (!q || d.driverId.includes(q) || d.name.toLowerCase().includes(q) || d.blockReason.toLowerCase().includes(q)))
  const count = (t: BlockType) => all.filter(d => d.blockType === t).length
  const bulkParsed = bulkIds.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)

  const addManual = (id: string, r: string) => setBlocks([...blocks.filter(b => b.driverId !== id), { driverId: id, driverName: nameMap.get(id) ?? id, reason: r, blockedAt: new Date().toISOString() }])
  const addBulk = () => {
    const m = new Map(blocks.map(b => [b.driverId, b]))
    for (const id of bulkParsed) m.set(id, { driverId: id, driverName: nameMap.get(id) ?? id, reason: reason.trim(), blockedAt: new Date().toISOString() })
    setBlocks([...m.values()])
  }

  const cards: { key: 'all' | BlockType; label: string; color: string; value: number }[] = [
    { key: 'all', label: 'Total', color: '#f87171', value: all.length },
    { key: 'auto', label: 'Redelivery', color: '#f97316', value: count('auto') },
    { key: 'manual', label: 'Manual', color: '#f87171', value: count('manual') },
    { key: 'registry', label: 'SPX Blocklist', color: '#a78bfa', value: count('registry') },
  ]

  const reasonPicker = (
    <>
      <Input value={reason} onChangeText={setReason} placeholder="Motivo" />
      <Row gap={6}>{QUICK_REASONS.map(r => <Chip key={r} label={r} color="#a78bfa" active={reason === r} onPress={() => setReason(r)} />)}</Row>
    </>
  )

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={filtered}
        keyExtractor={d => `${d.driverId}-${d.blockType}`}
        contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 4 }}>
            <Row>
              <Btn small variant="danger" onPress={() => { setReason(''); setSingle({ id: '' }) }}>⊘ Bloquear motorista</Btn>
              <Btn small variant="danger" onPress={() => { setReason(''); setBulkIds(''); setBulkOpen(true) }}>⊘ Lista de IDs</Btn>
              {count('manual') > 0 && <Btn small variant="ghost" onPress={() => Alert.alert('Limpar bloqueios manuais', `Remover os ${count('manual')} bloqueios manuais?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar', style: 'destructive', onPress: () => setBlocks([]) }])}>{`Limpar manuais (${count('manual')})`}</Btn>}
            </Row>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {cards.map(c => (
                <Pressable key={c.key} onPress={() => setType(p => (p === c.key ? 'all' : c.key))} style={{ backgroundColor: `${c.color}14`, borderWidth: 1, borderColor: `${c.color}44`, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, minWidth: 80, opacity: type !== 'all' && type !== c.key ? 0.45 : 1 }}>
                  <T size={20} bold color={c.color}>{c.value}</T>
                  <T size={10} color={C.muted}>{c.label}</T>
                </Pressable>
              ))}
            </ScrollView>
            {(Object.entries(META) as [BlockType, (typeof META)[BlockType]][]).map(([k, m]) => <Row key={k} gap={6}><Chip label={m.label} color={m.color} /><T size={11} color={C.dim}>{m.desc}</T></Row>)}
            <Input value={search} onChangeText={setSearch} placeholder="🔍 ID, nome ou motivo" />
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
            <T size={32}>✅</T>
            <T color={C.green}>Nenhum motorista bloqueado{type !== 'all' ? ' nesta categoria' : ''}.</T>
            {all.length === 0 && <T size={12} color={C.dim}>Sincronize o relatório de pacotes para detectar bloqueios automáticos.</T>}
          </View>
        }
        renderItem={({ item: d }) => {
          const m = META[d.blockType]
          return (
            <Card style={{ borderColor: `${m.color}44` }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T bold style={{ flex: 1 }}>{d.name}</T>
                <Chip label={m.label} color={m.color} />
              </Row>
              <T size={10} mono color={C.dim}>{d.driverId}{d.vehicleType ? `  ·  ${d.vehicleType}` : ''}</T>
              <T size={12} color={d.blockType === 'auto' ? '#f97316' : C.sub}>{d.blockType === 'auto' ? '📦 ' : ''}{d.blockReason}</T>
              {d.blockedAt && <T size={11} color={C.dim}>{new Date(d.blockedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</T>}
              {d.blockType === 'manual' && <Btn small variant="success" onPress={() => setBlocks(blocks.filter(b => b.driverId !== d.driverId))}>✓ Desbloquear</Btn>}
              {d.blockType === 'auto' && <T size={10} color={C.dim}>Reimporte o Forward Order para remover</T>}
              {d.blockType === 'registry' && <T size={10} color={C.dim}>Edite a planilha de registro para remover</T>}
            </Card>
          )
        }}
      />

      <Sheet open={!!single} onClose={() => setSingle(null)} title="⊘ Bloquear motorista">
        <T size={11} color={C.muted}>ID do motorista</T>
        <Input mono value={single?.id ?? ''} onChangeText={v => setSingle({ id: v })} placeholder="12345678" keyboardType="number-pad" />
        {single?.id && nameMap.get(single.id.trim()) ? <T size={12} color={C.sub}>{nameMap.get(single.id.trim())}</T> : null}
        {reasonPicker}
        <Btn variant="danger" disabled={!single?.id.trim() || !reason.trim()} onPress={() => { if (single) addManual(single.id.trim(), reason.trim()); setSingle(null) }}>⊘ Bloquear</Btn>
      </Sheet>

      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="⊘ Bloquear lista de motoristas">
        <T size={12} color={C.muted}>Um ID por linha, ou separados por vírgula/espaço. Todos recebem o mesmo motivo.</T>
        <Input multiline mono value={bulkIds} onChangeText={setBulkIds} placeholder={'12345678\n87654321'} style={{ minHeight: 140 }} />
        {bulkParsed.length > 0 && <T size={11} color={C.blue}>{bulkParsed.length} ID(s) detectado(s)</T>}
        {reasonPicker}
        <Btn variant="danger" disabled={!bulkParsed.length || !reason.trim()} onPress={() => { addBulk(); setBulkOpen(false) }}>{`⊘ Bloquear ${bulkParsed.length || ''} motorista(s)`}</Btn>
      </Sheet>
    </View>
  )
}
