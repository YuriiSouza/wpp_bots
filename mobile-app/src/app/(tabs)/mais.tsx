import { View } from 'react-native'
import { router } from 'expo-router'
import { Card, C, Screen, T, SectionTitle } from '@/components/ui'
import { useAppData } from '@/lib/appData'
import { useSync } from '@/lib/sync'

export default function Mais() {
  const d = useAppData()
  const sync = useSync()
  const items: { href: string; icon: string; label: string; sub: string; dot?: string; group: string }[] = [
    { group: 'Análise', href: '/ds', icon: '📊', label: 'Análise DS', sub: d.ds ? `${d.ds.result.drivers.length} motoristas · ${d.ds.fileName}` : 'Sem relatório de rotas', dot: d.ds ? '#22c55e' : undefined },
    { group: 'Operação', href: '/pacotes', icon: '📦', label: 'Pacotes', sub: d.forwardOrder ? d.forwardOrder.fileName : 'Sem relatório de pacotes', dot: d.forwardOrder ? '#ef4444' : undefined },
    { group: 'Operação', href: '/visao-geral', icon: '🔍', label: 'Visão Geral', sub: 'Rotas do turno e motoristas atribuídos' },
    { group: 'Operação', href: '/carregamento', icon: '⏱', label: 'Carregamento', sub: 'Chegada dos motoristas (QueueList)' },
    { group: 'Operação', href: '/bloqueados', icon: '⊘', label: 'Bloqueados', sub: 'Motoristas bloqueados' },
    { group: 'App', href: '/dados', icon: '☁', label: 'Dados e sincronização', sub: sync.lastSync ? `Última sincronização: ${new Date(sync.lastSync).toLocaleString('pt-BR')}` : 'Nunca sincronizado' },
    { group: 'App', href: '/config', icon: '⚙', label: 'Configurações', sub: 'Planilha, turnos, score' },
  ]
  let last = ''
  return (
    <Screen>
      {items.map(it => {
        const header = it.group !== last ? <SectionTitle key={`g-${it.group}`}>{it.group}</SectionTitle> : null
        last = it.group
        return (
          <View key={it.href} style={{ gap: 8 }}>
            {header}
            <Card onPress={() => router.push(it.href as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <T size={22}>{it.icon}</T>
              <View style={{ flex: 1, gap: 2 }}>
                <T bold size={14}>{it.label}</T>
                <T size={11} color={C.dim} numberOfLines={1}>{it.sub}</T>
              </View>
              {it.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.dot }} /> : null}
              <T color={C.dim} size={18}>›</T>
            </Card>
          </View>
        )
      })}
    </Screen>
  )
}
