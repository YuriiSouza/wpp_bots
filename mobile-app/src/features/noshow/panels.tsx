import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Btn, C, Card, Chip, Input, Row, Segmented, SHIFTS, SHIFT_COLOR, Sheet, T, copy } from '@/components/ui'
import { parseRoutesTsv, type LocalRoute } from '@/lib/noshowRouteParser'
import { parseThreePlMessage, normRegion, type ThreePlParseResult } from '@/lib/threePlParser'
import { getGlobalConfig, saveGlobalConfig, type Shift } from '@/lib/globalConfig'
import { routeStore } from '@/lib/routeStore'
import type { WorkPreferenceData } from '@/lib/workPreferenceParser'
import { normCluster, parseCurl, saveSpxCreds, SPX_CREDS_KEY, vehicleAllowed, vehiclePriority, type LocalDriver } from './logic'
import type { BatchAssignRow, ThreePlMap } from './useNoShow'

// ─── Colar rotas ─────────────────────────────────────────────────────────────
export function RoutePaste({ defaultDate, defaultShift, onLoad, onCancel }: {
  defaultDate: string; defaultShift: Shift; onLoad: (r: LocalRoute[], date: string, shift: Shift) => void; onCancel?: () => void
}) {
  const [text, setText] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [shift, setShift] = useState<Shift>(defaultShift)
  const preview = useMemo(() => (text.trim() ? parseRoutesTsv(text) : []), [text])
  return (
    <View style={{ gap: 10 }}>
      <T bold size={14}>Colar rotas do SPX</T>
      <T size={12} color={C.muted}>Abra o planejamento de rotas no SPX, selecione a tabela inteira, copie e cole aqui.</T>
      <Row>
        <View style={{ flex: 1, gap: 4 }}>
          <T size={10} bold color={C.muted}>DATA (AAAA-MM-DD)</T>
          <Input value={date} onChangeText={setDate} />
        </View>
      </Row>
      <Segmented options={SHIFTS.map(s => ({ value: s, label: s }))} value={shift} onChange={setShift} colors={SHIFT_COLOR} />
      <Input multiline mono value={text} onChangeText={setText} placeholder={'Rota\tAT / TO\tGaiola\t...'} style={{ minHeight: 160, fontSize: 11 }} />
      {preview.length > 0 && <T size={12} color={C.green}>✓ {preview.length} rotas reconhecidas — {preview.filter(r => r.status === 'DISPONIVEL').length} disponíveis</T>}
      {text.trim() !== '' && preview.length === 0 && <T size={12} color={C.red}>Nenhuma rota reconhecida. Confira se a coluna “AT / TO” veio junto.</T>}
      <Row>
        <Btn disabled={preview.length === 0} onPress={() => onLoad(preview, date, shift)}>{`Carregar ${preview.length || ''} rotas — ${shift}`}</Btn>
        {onCancel && <Btn variant="ghost" onPress={onCancel}>Cancelar</Btn>}
      </Row>
    </View>
  )
}

// ─── Rota avulsa ─────────────────────────────────────────────────────────────
export function AddRouteSheet({ open, onClose, routes, visibleAtIds, ignoredAtIds, onRestore, onForce }: {
  open: boolean; onClose: () => void; routes: LocalRoute[]; visibleAtIds: Set<string>; ignoredAtIds: Set<string>
  onRestore: (atIds: string[]) => void; onForce: (toAdd: LocalRoute[], forceAtIds: string[]) => void
}) {
  const [text, setText] = useState('')
  const raw = text.trim()
  const lines = [...new Set(raw.split(/[\s,;]+/).map(l => l.trim().toUpperCase()).filter(Boolean))]
  const isAtIdMode = lines.length > 0 && lines.every(l => /^AT\w+$/i.test(l))
  let parsed: LocalRoute[] = []
  const notFound: string[] = []
  if (raw && isAtIdMode) {
    const all: LocalRoute[] = []
    for (const { date, shift } of routeStore.list()) all.push(...(routeStore.get(date, shift) ?? []))
    for (const atId of lines) {
      const f = all.find(r => r.atId.toLowerCase() === atId.toLowerCase())
      if (f) parsed.push(f); else notFound.push(atId)
    }
  } else if (raw) parsed = parseRoutesTsv(raw)
  const toRestore = parsed.filter(r => ignoredAtIds.has(r.atId))
  const existing = parsed.filter(r => routes.some(e => e.atId === r.atId) && !ignoredAtIds.has(r.atId))
  const toForce = existing.filter(r => !visibleAtIds.has(r.atId) || routes.find(e => e.atId === r.atId)!.status === 'ATRIBUIDA')
  const dupes = existing.filter(r => !toForce.includes(r))
  const toAdd = parsed.filter(r => !routes.some(e => e.atId === r.atId))
  const canConfirm = toAdd.length > 0 || toRestore.length > 0 || toForce.length > 0
  return (
    <Sheet open={open} onClose={onClose} title="＋ Reatribuir rota (AT)">
      <T size={12} color={C.muted}>Cole um ou vários códigos AT (ex: AT202609099HRB7), um por linha ou separados por vírgula/espaço. Cada rota volta para a reatribuição mesmo que não esteja recusada no Call Up. Também aceita a linha inteira da tabela do SPX.</T>
      <Input multiline mono value={text} onChangeText={setText} placeholder={'AT202609099HRB7\nAT202609099HRB8'} style={{ minHeight: 140 }} />
      {toAdd.length > 0 && <T size={11} color={C.green}>✓ {toAdd.length} nova(s): {toAdd.map(r => `${r.atId} (${r.cluster})`).join(' · ')}</T>}
      {toRestore.length > 0 && <T size={11} color={C.blue}>↩ {toRestore.length} oculta(s) será(ão) restaurada(s)</T>}
      {toForce.length > 0 && <T size={11} color="#a78bfa">↺ {toForce.length} volta(m) para a reatribuição: {toForce.map(r => r.atId).join(' · ')}</T>}
      {dupes.length > 0 && <T size={11} color={C.yellow}>{dupes.length} já está(ão) na lista de reatribuição</T>}
      {notFound.length > 0 && <T size={11} color={C.red}>⚠ Não encontrada(s): {notFound.join(', ')}</T>}
      <Btn disabled={!canConfirm} onPress={() => {
        if (toRestore.length) onRestore(toRestore.map(r => r.atId))
        if (toAdd.length || toForce.length) onForce(toAdd, toForce.map(r => r.atId))
        setText(''); onClose()
      }}>{toRestore.length > 0 && toAdd.length === 0 && toForce.length === 0 ? `↩ Restaurar (${toRestore.length})` : `Adicionar ${canConfirm ? toAdd.length + toRestore.length + toForce.length : ''}`}</Btn>
    </Sheet>
  )
}

// ─── Lote AT + motorista ────────────────────────────────────────────────────
export function BatchSheet({ open, onClose, onApply, spxConfigured }: {
  open: boolean; onClose: () => void; onApply: (t: string) => Promise<BatchAssignRow[]>; spxConfigured: boolean
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<BatchAssignRow[] | null>(null)
  const [running, setRunning] = useState(false)
  const close = () => { setInput(''); setResult(null); onClose() }
  const ok = result?.filter(r => r.status === 'ok') ?? []
  const fail = result?.filter(r => r.status === 'fail') ?? []
  const noDriver = result?.filter(r => r.status === 'no-driver') ?? []
  return (
    <Sheet open={open} onClose={close} title="📥 Atribuir lote (AT + motorista)">
      {!result ? (
        <>
          <T size={12} color={C.muted}>Uma rota por linha: AT ID e ID do motorista separados por espaço. Cada linha é gravada direto no SPX.</T>
          {!spxConfigured && <T size={11} color={C.red}>⚠ SPX não configurado. Configure em ⋯ → Configurar SPX.</T>}
          <Input multiline mono value={input} onChangeText={setInput} placeholder={'AT202609129NT0P 3599407\nAT202609129O9P0 568742'} style={{ minHeight: 160 }} />
          <Btn loading={running} disabled={!input.trim() || !spxConfigured} onPress={async () => { setRunning(true); try { setResult(await onApply(input)) } finally { setRunning(false) } }}>
            Atribuir no SPX
          </Btn>
        </>
      ) : (
        <>
          <Row>
            <Chip label={`✅ ${ok.length} atribuída(s)`} color={C.green} />
            {fail.length > 0 && <Chip label={`✗ ${fail.length} falha(s)`} color={C.red} />}
            {noDriver.length > 0 && <Chip label={`⏭ ${noDriver.length} sem motorista`} />}
          </Row>
          {result.map((r, i) => (
            <Card key={`${r.atId}-${i}`} style={{ opacity: r.status === 'no-driver' ? 0.5 : 1 }}>
              <T mono bold size={12}>{r.atId}</T>
              {r.driverId ? <T size={12}>{r.driverName ?? r.driverId} <T size={10} mono color={C.dim}>{r.driverId}</T></T> : null}
              <T size={11} color={r.status === 'ok' ? (r.foundDriver === false ? C.yellow : C.green) : r.status === 'fail' ? C.red : C.sub}>
                {r.status === 'ok' ? (r.foundDriver === false ? '✅ SPX (motorista fora do cadastro)' : '✅ Atribuída no SPX') : r.status === 'fail' ? `✗ ${r.spxMsg ?? 'Falha no SPX'}` : '⏭ Ignorada (sem motorista)'}
              </T>
            </Card>
          ))}
          <Row><Btn onPress={close}>Fechar</Btn><Btn variant="ghost" onPress={() => { setResult(null); setInput('') }}>Colar outro lote</Btn></Row>
        </>
      )}
    </Sheet>
  )
}

// ─── Credenciais SPX ─────────────────────────────────────────────────────────
export function SpxCredsSheet({ open, onClose, configured, onChange }: { open: boolean; onClose: () => void; configured: boolean; onChange: (v: boolean) => void }) {
  const [curl, setCurl] = useState('')
  const p = curl ? parseCurl(curl) : null
  const hasMin = !!(p?.cookie && p?.['x-csrftoken'])
  const hasAll = hasMin && !!(p?.['x-sap-ri'] && p?.['x-sap-sec'])
  return (
    <Sheet open={open} onClose={onClose} title="🔑 Credenciais SPX">
      <T size={12} color={C.muted}>No PC, abra o SPX → F12 → Network, clique com o botão direito numa requisição → “Copy as cURL” e envie para o celular. Cole abaixo. As credenciais ficam só neste aparelho.</T>
      <Input multiline mono value={curl} onChangeText={setCurl} placeholder="curl 'https://spx.shopee.com.br/...'" style={{ minHeight: 140, fontSize: 11 }} />
      {p && (
        <Card style={{ borderColor: hasMin ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)' }}>
          <T size={12} bold color={hasAll ? C.green : hasMin ? C.yellow : C.red}>
            {hasAll ? '✓ Todas as credenciais identificadas' : hasMin ? '⚠ Básicas ok (x-sap-ri/sec não encontrados)' : '✗ Cookie ou csrftoken não encontrados'}
          </T>
          {(['cookie', 'x-csrftoken', 'device-id', 'x-sap-ri', 'x-sap-sec'] as const).map(k => (
            <T key={k} size={11} color={p[k] ? C.sub : C.faint}>{k}: {p[k] ? (p[k].length > 40 ? `${p[k].slice(0, 40)}…` : p[k]) : 'não encontrado'}</T>
          ))}
        </Card>
      )}
      <Row>
        <Btn disabled={!hasMin} onPress={() => { saveSpxCreds(parseCurl(curl)); onChange(true); setCurl(''); onClose() }}>Salvar credenciais</Btn>
        {configured && <Btn variant="danger" onPress={() => { localStorage.removeItem(SPX_CREDS_KEY); onChange(false); onClose() }}>Remover</Btn>}
      </Row>
    </Sheet>
  )
}

// ─── Report ─────────────────────────────────────────────────────────────────
type Snap = { total: number; auto: number; manual: number; threepl: number; novatos: number }
export function ReportSheet({ open, onClose, snap, day, shift }: { open: boolean; onClose: () => void; snap: Snap; day: string; shift: Shift }) {
  const [hub, setHub] = useState(() => getGlobalConfig().hubName || '')
  const [vals, setVals] = useState(snap)
  const [copied, setCopied] = useState(false)
  const { total, auto: manual, threepl, novatos } = vals
  const automatico = Math.max(0, total - manual - threepl - novatos)
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(0) : '0')
  const text = [
    `📊 Resumo Alocação – ${day.split('-').reverse().join('/')}`, '',
    `🏢 Hub: ${hub || '—'}`, `📍 Turno: ${shift}`, '',
    '🚚 Distribuição de Rotas:',
    `* Total de rotas: ${total}`,
    `* Rotas alocadas Manualmente: ${manual}`,
    `* Percentual alocado Manualmente: ${pct(manual)}%`,
    `* Rotas alocadas 3PL: ${threepl}`,
    `* Percentual alocado 3PL: ${pct(threepl)}%`,
    `* Novatos adicionados: ${novatos}`,
    `* Rotas alocadas automaticamente: ${automatico}`,
    `* Percentual alocado automaticamente: ${pct(automatico)}%`,
  ].join('\n')
  const field = (label: string, key: keyof Snap) => (
    <Row key={key} style={{ justifyContent: 'space-between' }}>
      <T size={12} color={C.sub}>{label}</T>
      <Input keyboardType="number-pad" value={String(vals[key])} onChangeText={v => setVals({ ...vals, [key]: parseInt(v) || 0 })} style={{ width: 80, textAlign: 'center' }} />
    </Row>
  )
  return (
    <Sheet open={open} onClose={onClose} title="📊 Report de Alocação">
      <T size={11} color={C.muted}>Hub</T>
      <Input value={hub} onChangeText={h => { setHub(h); saveGlobalConfig({ ...getGlobalConfig(), hubName: h }) }} placeholder="Ex: LGO 03" />
      <Card>
        <T size={10} bold color={C.dim}>AJUSTE OS VALORES SE NECESSÁRIO</T>
        {field('Total de rotas', 'total')}
        {field('Rotas manuais (app)', 'auto')}
        {field('Rotas 3PL', 'threepl')}
        {field('Novatos adicionados', 'novatos')}
        <Row style={{ justifyContent: 'space-between' }}><T size={12} color={C.dim}>Automaticamente (calculado)</T><T bold color={C.green}>{automatico}</T></Row>
      </Card>
      <Card><T size={12} mono>{text}</T></Card>
      <Btn onPress={async () => { await copy(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? '✓ Copiado!' : '📋 Copiar report'}</Btn>
    </Sheet>
  )
}

// ─── Novatos ────────────────────────────────────────────────────────────────
interface NovatoSuggestion { driverId: string; name: string; clusters: string[]; vehicleType: string | null; suggestedRoute: LocalRoute | null; availableToday: boolean; resolvable: boolean }
interface NovatoResult { driverId: string; name: string; status: 'ok' | 'no-route' | 'not-found'; atId?: string; cluster?: string; availableToday?: boolean }

export function NovatosPanel({ workPref, routes, availableDrivers, onAssign }: {
  workPref: WorkPreferenceData | null; routes: LocalRoute[]; availableDrivers: LocalDriver[]; onAssign: (a: { route: LocalRoute; driver: LocalDriver }[]) => void
}) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<NovatoSuggestion[] | null>(null)
  const [override, setOverride] = useState<Record<string, string>>({})
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [result, setResult] = useState<NovatoResult[] | null>(null)
  const disponivel = routes.filter(r => r.status === 'DISPONIVEL')
  const wpMap = useMemo(() => new Map((workPref?.drivers ?? []).map(d => [d.driverId, d])), [workPref])

  const resolve = (driverId: string): { driver: LocalDriver; availableToday: boolean } | null => {
    const av = availableDrivers.find(d => d.driverId === driverId)
    if (av) return { driver: av, availableToday: true }
    const wp = wpMap.get(driverId)
    if (!wp) return null
    return {
      driver: { driverId, name: wp.driverName || driverId, vehicleType: wp.vehicleType || null, clusters: wp.clusters ?? [], isNewDriver: true, isBlocked: false, blockReason: null, blockType: null, pendingPackages: 0, dsReal: null, dsStatus: null, priorityScore: 0, daysSinceRoute: 9999 },
      availableToday: false,
    }
  }

  const analyze = () => {
    const used = new Set<string>()
    setSuggestions(input.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean).map(driverId => {
      const r = resolve(driverId)
      const clusters = r?.driver.clusters ?? []
      const hasAll = clusters.some(c => c.toUpperCase() === 'ALL')
      const vehicle = r?.driver.vehicleType ?? null
      const best = disponivel
        .filter(rt => !used.has(rt.id) && vehicleAllowed(vehicle, rt.requiredVehicleType) && (hasAll || clusters.some(c => normCluster(c) === normCluster(rt.cluster))))
        .sort((a, b) => vehiclePriority(vehicle, a.requiredVehicleType) - vehiclePriority(vehicle, b.requiredVehicleType))[0] ?? null
      if (best) used.add(best.id)
      return { driverId, name: r?.driver.name ?? driverId, clusters, vehicleType: vehicle, suggestedRoute: best, availableToday: r?.availableToday ?? false, resolvable: r != null }
    }))
    setOverride({})
  }

  const routeOf = (s: NovatoSuggestion) => (override[s.driverId] ? routes.find(r => r.id === override[s.driverId]) ?? s.suggestedRoute : s.suggestedRoute)

  const confirm = () => {
    const list: { route: LocalRoute; driver: LocalDriver }[] = []
    const res: NovatoResult[] = []
    for (const s of suggestions ?? []) {
      const r = resolve(s.driverId)
      if (!r) { res.push({ driverId: s.driverId, name: s.name, status: 'not-found' }); continue }
      const route = routeOf(s)
      if (!route) { res.push({ driverId: s.driverId, name: s.name, status: 'no-route', availableToday: r.availableToday }); continue }
      list.push({ route, driver: { ...r.driver, isNewDriver: true } })
      res.push({ driverId: s.driverId, name: s.name, status: 'ok', atId: route.atId, cluster: route.cluster, availableToday: r.availableToday })
    }
    onAssign(list)
    setResult(res)
  }

  if (result) {
    return (
      <View style={{ gap: 10 }}>
        <Row>
          <Chip label={`✅ ${result.filter(r => r.status === 'ok').length} alocado(s)`} color={C.green} />
          {result.some(r => r.status === 'no-route') && <Chip label={`⚠️ ${result.filter(r => r.status === 'no-route').length} sem rota`} color={C.yellow} />}
          {result.some(r => r.status === 'not-found') && <Chip label={`⛔ ${result.filter(r => r.status === 'not-found').length} não encontrado(s)`} color={C.red} />}
        </Row>
        {result.map(r => (
          <Card key={r.driverId}>
            <Row><T bold>{r.name}</T>{r.availableToday === false && r.status !== 'not-found' && <Chip label="via WP" color={C.blue} />}</Row>
            <T size={11} color={r.status === 'ok' ? C.green : r.status === 'no-route' ? C.yellow : C.red}>
              {r.status === 'ok' ? `✅ ${r.atId} · ${r.cluster}` : r.status === 'no-route' ? '⚠️ Sem rota disponível' : '⛔ ID não encontrado'}
            </T>
          </Card>
        ))}
        <T size={11} color={C.muted}>As atribuições ficaram na pré-visualização da aba Rotas (chip Novato). Toque em ✦ Atribuir para gravar no SPX.</T>
        <Btn onPress={() => { setResult(null); setSuggestions(null); setInput('') }}>Alocar mais</Btn>
      </View>
    )
  }

  if (!suggestions) {
    return (
      <View style={{ gap: 10 }}>
        <T size={12} color={C.muted}>Cole os IDs dos novatos, um por linha. Quem não está na disponibilidade de hoje é buscado no Work Preference.</T>
        <Input multiline mono value={input} onChangeText={setInput} placeholder={'3173241\n2811188'} style={{ minHeight: 140 }} />
        <Btn disabled={!input.trim()} onPress={analyze}>Analisar</Btn>
      </View>
    )
  }

  const picking = suggestions.find(s => s.driverId === pickFor)
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T size={12} color={C.muted}>{suggestions.length} novato(s)</T>
        <Btn small variant="ghost" onPress={() => setSuggestions(null)}>← Editar IDs</Btn>
      </Row>
      {suggestions.map(s => {
        const route = routeOf(s)
        return (
          <Card key={s.driverId} style={{ opacity: s.resolvable ? 1 : 0.5 }}>
            <Row><T bold>{s.name}</T>{s.resolvable && !s.availableToday && <Chip label="via WP" color={C.blue} />}</Row>
            <T size={10} mono color={C.dim}>{s.driverId}{s.vehicleType ? ` · ${s.vehicleType}` : ''}</T>
            {!s.resolvable && <T size={11} color={C.red}>ID não encontrado (disp./WP)</T>}
            <T size={11} color={C.dim}>{s.clusters.length ? s.clusters.join(', ') : 'sem dados WP'}</T>
            <Row>
              <T size={12} color={route ? C.text : C.red}>{route ? `${route.atId} · ${route.cluster}${route.requiredVehicleType ? ` · ${route.requiredVehicleType}` : ''}` : '— sem rota —'}</T>
              {s.resolvable && <Btn small variant="outline" onPress={() => setPickFor(s.driverId)}>Trocar rota</Btn>}
            </Row>
          </Card>
        )
      })}
      <Btn disabled={suggestions.every(s => !routeOf(s) || !s.resolvable)} onPress={confirm}>Confirmar atribuições</Btn>
      <Sheet open={!!picking} onClose={() => setPickFor(null)} title={`Rota para ${picking?.name ?? ''}`}>
        {disponivel.filter(r => vehicleAllowed(picking?.vehicleType, r.requiredVehicleType)).map(r => (
          <Card key={r.id} onPress={() => { setOverride(o => ({ ...o, [pickFor!]: r.id })); setPickFor(null) }}>
            <T mono bold size={12}>{r.atId}</T>
            <T size={11} color={C.sub}>{r.cluster}{r.requiredVehicleType ? ` · ${r.requiredVehicleType}` : ''}</T>
          </Card>
        ))}
      </Sheet>
    </View>
  )
}

// ─── 3PL ────────────────────────────────────────────────────────────────────
export function ThreePlPanel({ routes, shift, agencies, excludedRouteIds, assignments, setAssignments }: {
  routes: LocalRoute[]; shift: Shift; agencies: string[]; excludedRouteIds: Set<string>; assignments: ThreePlMap; setAssignments: (m: ThreePlMap) => void
}) {
  const [agency, setAgency] = useState('')
  const [pickAgency, setPickAgency] = useState(false)
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ThreePlParseResult | null>(null)
  const [copied, setCopied] = useState(false)
  const allClusters = useMemo(() => [...new Set(routes.map(r => (r.cluster ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [routes])
  const availableRoutes = useMemo(() => routes.filter(r => r.status === 'DISPONIVEL' && !excludedRouteIds.has(r.id) && !assignments.has(r.id)), [routes, excludedRouteIds, assignments])

  const preview = useMemo(() => {
    if (!parsed) return null
    const used = new Set<string>()
    const rows: { region: string; route: LocalRoute }[] = []
    const shortfalls: { region: string; requested: number; assigned: number }[] = []
    for (const d of parsed.demands.filter(x => x.shift === shift).sort((a, b) => Number(a.anyRegion) - Number(b.anyRegion))) {
      const take = availableRoutes.filter(r => !used.has(r.id) && (d.anyRegion || normRegion(r.cluster) === normRegion(d.region))).slice(0, d.quantity)
      take.forEach(r => { used.add(r.id); rows.push({ region: d.anyRegion ? `${r.cluster} (ALL)` : d.region, route: r }) })
      if (take.length < d.quantity) shortfalls.push({ region: d.region, requested: d.quantity, assigned: take.length })
    }
    return { rows, shortfalls, otherShift: parsed.demands.filter(d => d.shift !== shift).length }
  }, [parsed, availableRoutes, shift])

  const byAgency = useMemo(() => {
    const m = new Map<string, { region: string; atId: string }[]>()
    for (const [id, v] of assignments) {
      const r = routes.find(rt => rt.id === id)
      if (!r) continue
      m.set(v.agency, [...(m.get(v.agency) ?? []), { region: v.region, atId: r.atId }])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [assignments, routes])

  return (
    <View style={{ gap: 10 }}>
      <T size={12} color={C.muted}>Escolha a transportadora, cole a mensagem dela (“quantidade região” por linha) e confira a pré-visualização.</T>
      <Row>
        <Btn variant="outline" onPress={() => setPickAgency(true)}>{agency || '— Transportadora —'}</Btn>
        <Btn small variant="outline" onPress={async () => { await copy(allClusters.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? '✓ Copiado!' : '📋 Regiões'}</Btn>
        <T size={11} color={C.dim}>Turno: <T size={11} bold>{shift}</T></T>
      </Row>
      {agencies.length === 0 && <T size={11} color={C.yellow}>⚠ Nenhuma agência. Sincronize o relatório de motoristas.</T>}
      <Input multiline mono value={input} onChangeText={setInput} placeholder={'AM\n1 Abadiânia - z\n2 Munir Calixto'} />
      <Btn disabled={!agency || !input.trim()} onPress={() => setParsed(parseThreePlMessage(input, { defaultShift: shift, knownClusters: allClusters }))}>Analisar</Btn>
      {parsed && preview && (
        <Card>
          {parsed.noAvailability ? <T color={C.yellow}>Transportadora informou SEM DISPONIBILIDADE HOJE.</T> : (
            <>
              <Row>
                <Chip label={`✅ ${preview.rows.length} rota(s)`} color={C.green} />
                {preview.shortfalls.length > 0 && <Chip label={`⚠️ ${preview.shortfalls.length} sem rota suficiente`} color={C.yellow} />}
                {parsed.unknownRegions.length > 0 && <Chip label={`❓ ${parsed.unknownRegions.length} desconhecida(s)`} color={C.red} />}
                {preview.otherShift > 0 && <Chip label={`↪ ${preview.otherShift} de outros turnos`} color={C.blue} />}
              </Row>
              {preview.rows.map(({ region, route }) => <T key={route.id} size={12}><T mono size={12}>{route.atId}</T> · {region}</T>)}
              {preview.shortfalls.map(s => <T key={s.region} size={11} color={C.yellow}>⚠️ {s.region}: pediu {s.requested}, só há {s.assigned}.</T>)}
              {parsed.unknownRegions.length > 0 && <T size={11} color={C.red}>❓ Não reconhecidas: {parsed.unknownRegions.join(', ')}</T>}
              {parsed.ignoredLines.length > 0 && <T size={11} color={C.dim}>{parsed.ignoredLines.length} linha(s) ignorada(s): {parsed.ignoredLines.join(' · ')}</T>}
              <Btn disabled={preview.rows.length === 0} onPress={() => {
                const next = new Map(assignments)
                for (const { region, route } of preview.rows) next.set(route.id, { agency, region, shift })
                setAssignments(next); setInput(''); setParsed(null)
              }}>{`Confirmar (${preview.rows.length}) para ${agency}`}</Btn>
            </>
          )}
        </Card>
      )}
      {byAgency.length > 0 && <T size={12} bold color={C.sub}>Pré-visualização 3PL ({assignments.size} rotas)</T>}
      {byAgency.map(([a, list]) => (
        <Card key={a}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T bold color="#38bdf8">{a} · {list.length} rota(s)</T>
            <Btn small variant="danger" onPress={() => { const next = new Map(assignments); for (const [id, v] of assignments) if (v.agency === a) next.delete(id); setAssignments(next) }}>✕ Remover</Btn>
          </Row>
          <Row gap={4}>{list.map(i => <Chip key={i.atId} label={`${i.atId} · ${i.region}`} />)}</Row>
        </Card>
      ))}
      <Sheet open={pickAgency} onClose={() => setPickAgency(false)} title="Transportadora">
        {agencies.map(a => <Card key={a} onPress={() => { setAgency(a); setPickAgency(false) }}><T>{a}</T></Card>)}
      </Sheet>
    </View>
  )
}
