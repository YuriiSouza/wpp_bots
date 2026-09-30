import { router } from 'expo-router'
import { Btn, C, Card, Row, Screen, T } from '@/components/ui'
import { useAppData } from '@/lib/appData'
import { useSync } from '@/lib/sync'
import { routeStore } from '@/lib/routeStore'
import { noShowQueueStore } from '@/lib/noShowQueueStore'

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null)

export default function Dados() {
  const d = useAppData()
  const sync = useSync()
  const routeSets = routeStore.list()

  const reports: { label: string; ok: boolean; detail: string }[] = [
    { label: '📊 Rotas (DS)', ok: !!d.ds, detail: d.ds ? `${d.ds.result.drivers.length} motoristas · ${d.ds.fileName}` : 'não carregado' },
    { label: '👥 Motoristas (cadastro)', ok: d.registry.length > 0, detail: d.driversMeta ? `${d.driversMeta.total} · ${d.driversMeta.fileName} · ${when(d.driversMeta.importedAt)}` : 'não carregado' },
    { label: '📅 Work Preference', ok: !!d.workPref, detail: d.workPref ? `${d.workPref.drivers.length} motoristas · ${d.workPref.fileName}` : 'não carregado' },
    { label: '📞 Call Up', ok: !!d.callUp, detail: d.callUp ? `${d.callUp.totalCalls} chamadas · ${d.callUp.fileName} · ${when(d.callUp.importedAt)}` : 'não carregado' },
    { label: '📦 Pacotes (Forward Order)', ok: !!d.forwardOrder, detail: d.forwardOrder ? `${d.forwardOrder.totalPackages} pacotes · ${d.forwardOrder.fileName} · ${when(d.forwardOrder.importedAt)}` : 'não carregado' },
  ]

  return (
    <Screen>
      <Card style={{ borderColor: !sync.configured ? 'rgba(251,191,36,.4)' : sync.error ? 'rgba(248,113,113,.4)' : 'rgba(74,222,128,.3)' }}>
        <T bold size={14}>☁ Planilha compartilhada</T>
        {!sync.configured ? (
          <>
            <T size={12} color={C.yellow}>A planilha ainda não foi configurada neste aparelho.</T>
            <Btn onPress={() => router.push('/config')}>Configurar</Btn>
          </>
        ) : (
          <>
            <T size={12} color={C.sub}>Última sincronização: {when(sync.lastSync) ?? 'nunca'}</T>
            {sync.error && <T size={12} color={C.red}>✕ {sync.error}</T>}
            <T size={11} color={C.dim}>O app sincroniza ao abrir, ao voltar para o app e alguns segundos depois de cada alteração feita aqui (atribuições, bloqueios, janelas). Alterações deste aparelho são mescladas com as do PC.</T>
            <Btn loading={sync.syncing} onPress={() => void sync.sync()}>⟳ Sincronizar agora</Btn>
          </>
        )}
      </Card>

      <T size={11} bold color={C.muted}>RELATÓRIOS</T>
      <T size={11} color={C.dim}>Os relatórios são importados no app do PC (tela Uploads) e enviados para a planilha. Aqui eles chegam prontos.</T>
      {reports.map(r => (
        <Card key={r.label}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T bold>{r.label}</T>
            <T size={12} bold color={r.ok ? C.green : C.faint}>{r.ok ? '✓' : '—'}</T>
          </Row>
          <T size={11} color={C.dim}>{r.detail}</T>
        </Card>
      ))}

      <T size={11} bold color={C.muted}>ROTAS E FILAS</T>
      <Card>
        <T bold>🛣 Rotas salvas</T>
        {routeSets.length === 0 ? <T size={11} color={C.dim}>Nenhuma. Cole a roteirização na tela Atribuição.</T> : routeSets.slice(0, 9).map(s => (
          <T key={`${s.date}-${s.shift}`} size={12} color={C.sub}>{s.date.split('-').reverse().join('/')} · {s.shift} — {s.count} rotas</T>
        ))}
        <Btn small variant="outline" onPress={() => router.push('/')}>Ir para Atribuição</Btn>
      </Card>
      <Card>
        <T bold>👥 Fila de motoristas por turno</T>
        <T size={12} color={C.sub}>AM {noShowQueueStore.size('AM')} · PM1 {noShowQueueStore.size('PM1')} · PM2 {noShowQueueStore.size('PM2')}</T>
        <T size={11} color={C.dim}>A fila é montada a partir do Work Preference para o dia selecionado.</T>
        <Btn small variant="outline" disabled={!d.workPref} onPress={() => d.rebuildQueues()}>{`↺ Recriar fila para ${d.day.split('-').reverse().join('/')}`}</Btn>
      </Card>
    </Screen>
  )
}
