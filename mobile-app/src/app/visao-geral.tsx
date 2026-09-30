import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import DayShiftBar from '@/components/DayShiftBar'
import { Btn, C, Card, Chip, Empty, Input, PhoneActions, Row, Segmented, SHIFT_COLOR, Stat, StatRow, T, copy } from '@/components/ui'
import { useAppData } from '@/lib/appData'
import { routeStore } from '@/lib/routeStore'
import type { LocalRoute } from '@/lib/noshowRouteParser'

function compareGaiola(a: string | null, b: string | null) {
  const parse = (v: string | null) => { const m = v?.match(/^([A-Za-z]+)-?(\d+)$/); return m ? { l: m[1].toUpperCase(), n: parseInt(m[2], 10) } : null }
  const pa = parse(a), pb = parse(b)
  if (!pa && !pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa.l !== pb.l ? pa.l.localeCompare(pb.l) : pa.n - pb.n
}

function normalizeVehicle(v?: string | null) {
  if (!v?.trim()) return null
  const s = v.trim().toLowerCase()
  if (s.includes('moto')) return 'MOTO'
  if (s.includes('fiorino')) return 'FIORINO'
  if (s.includes('van')) return 'VAN'
  if (s.includes('passeio')) return 'PASSEIO'
  return s.toUpperCase()
}

function vehicleRequired(r: LocalRoute) {
  if ((r.volume ?? 0) > 700 || (r.gg ?? 0) > 1) return 'FIORINO'
  if (normalizeVehicle(r.scheduledVehicle) === 'MOTO') return 'MOTO'
  return 'PASSEIO'
}

const vColor = (v: string) => (v === 'FIORINO' ? C.yellow : v === 'MOTO' ? C.pink : C.sub)

export default function VisaoGeral() {
  const { registry, dsDrivers, day, shift, version } = useAppData()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'DISPONIVEL' | 'ATRIBUIDA'>('all')
  const [copied, setCopied] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => routeStore.get(day, shift) ?? [], [day, shift, version])
  const enriched = useMemo(() => {
    const reg = new Map(registry.map(d => [d.id, d]))
    const ds = new Map(dsDrivers.map(d => [d.driver_id, d]))
    return routes.map(r => {
      const ar = r.assignedDriverId ? reg.get(r.assignedDriverId) : null
      const chosen = normalizeVehicle(ar?.vehicleType ?? null)
      const needed = vehicleRequired(r)
      return { ...r, needed, chosen, acert: chosen ? chosen === needed : null, ds: r.assignedDriverId ? ds.get(r.assignedDriverId)?.DS_Real ?? null : null, phone: ar?.phoneNumber ?? null }
    })
  }, [routes, registry, dsDrivers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return enriched.filter(r => {
      if (status !== 'all' && r.status !== status) return false
      return !q || r.atId.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q) || (r.cidade ?? '').toLowerCase().includes(q) || (r.assignedDriverName ?? '').toLowerCase().includes(q) || (r.assignedDriverId ?? '').includes(q)
    }).sort((a, b) => compareGaiola(a.gaiola, b.gaiola))
  }, [enriched, search, status])

  const atrib = enriched.filter(r => r.status === 'ATRIBUIDA').length
  const withAcert = enriched.filter(r => r.acert !== null)
  const phones = [...new Set(filtered.filter(r => r.status === 'ATRIBUIDA' && r.phone).map(r => r.phone!.replace(/\D/g, '')).filter(p => p.length >= 8))]

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <DayShiftBar />
      {routes.length === 0 ? (
        <Empty title={`Nenhuma rota para ${shift} de ${day.split('-').reverse().join('/')}.`} sub="Cole a roteirização na tela de Atribuição para salvar as rotas deste turno." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          initialNumToRender={20}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 4 }}>
              <T size={11} color={C.muted}>{routes.length} rotas · <T size={11} bold color={SHIFT_COLOR[shift]}>{shift}</T></T>
              <StatRow>
                <Stat label="Total" value={enriched.length} color={C.sub} />
                <Stat label="Atribuídas" value={atrib} color={C.green} sub={`${enriched.length ? Math.round((atrib / enriched.length) * 100) : 0}%`} />
                <Stat label="Disponíveis" value={enriched.length - atrib} color={C.blue} />
                <Stat label="Acertividade" value={withAcert.length ? `${Math.round((withAcert.filter(r => r.acert).length / withAcert.length) * 100)}%` : '—'} color="#a78bfa" />
              </StatRow>
              <Input value={search} onChangeText={setSearch} placeholder="🔍 AT, cluster, cidade, motorista" />
              <Segmented value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todas' }, { value: 'DISPONIVEL', label: 'Disponíveis' }, { value: 'ATRIBUIDA', label: 'Atribuídas' }]} colors={{ all: '#a78bfa', DISPONIVEL: '#a78bfa', ATRIBUIDA: '#a78bfa' }} />
              <Row style={{ justifyContent: 'space-between' }}>
                <T size={11} color={C.dim}>{filtered.length} rota(s)</T>
                <Btn small variant={copied ? 'success' : 'outline'} disabled={phones.length === 0} onPress={async () => { await copy(phones.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? '✓ Copiado!' : `📋 Telefones (${phones.length})`}</Btn>
              </Row>
            </View>
          }
          renderItem={({ item: r }) => (
            <Card style={r.status === 'ATRIBUIDA' ? { backgroundColor: 'rgba(34,197,94,.04)' } : r.isInterior ? { borderColor: 'rgba(245,158,11,.35)' } : undefined}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T mono bold size={12}>{r.atId}</T>
                <Chip label={r.status === 'ATRIBUIDA' ? 'Atribuída' : 'Disponível'} color={r.status === 'ATRIBUIDA' ? C.green : C.blue} />
              </Row>
              <T size={12} color={C.sub}>{r.gaiola ? `Gaiola ${r.gaiola} · ` : ''}{r.isInterior ? '📍 ' : ''}{r.cluster || '—'}{r.cidade ? ` · ${r.cidade}` : ''}</T>
              <T size={11} color={C.dim}>
                {r.paradas ?? '—'} paradas · {r.km !== null ? r.km.toFixed(1) : '—'} km · SPR {r.spr ?? '—'} · Vol <T size={11} color={r.volume !== null && r.volume > 700 ? C.yellow : C.dim}>{r.volume ?? '—'}</T> · GG <T size={11} color={r.gg !== null && r.gg > 1 ? C.yellow : C.dim}>{r.gg ?? '—'}</T>
              </T>
              <Row gap={4}>
                {r.scheduledVehicle ? <Chip label={`Prog. ${r.scheduledVehicle}`} /> : null}
                <Chip label={`Nec. ${r.needed}`} color={vColor(r.needed)} />
                {r.chosen ? <Chip label={`Esc. ${r.chosen}`} /> : null}
                {r.acert !== null && <Chip label={r.acert ? '✓ acerto' : '✗ veículo'} color={r.acert ? C.green : C.red} />}
              </Row>
              {r.assignedDriverId ? (
                <View style={{ gap: 3 }}>
                  <T size={12} bold>{r.assignedDriverName || '—'} <T size={10} mono color={C.dim}>{r.assignedDriverId}</T>{r.ds !== null ? <T size={11} color={r.ds * 100 >= 90 ? C.green : r.ds * 100 >= 70 ? '#a3e635' : r.ds * 100 >= 30 ? C.yellow : C.red}>  DS {(r.ds * 100).toFixed(1)}%</T> : null}</T>
                  <PhoneActions phone={r.phone} />
                </View>
              ) : null}
            </Card>
          )}
        />
      )}
    </View>
  )
}
