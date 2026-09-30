import { Text } from 'react-native'
import { Tabs } from 'expo-router'
import { C } from '@/components/ui'
import { SyncButton } from '@/lib/sync'

function icon(glyph: string) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>
  }
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: C.panel },
      headerTintColor: C.text,
      headerTitleStyle: { fontWeight: '700' },
      headerRight: () => <SyncButton />,
      tabBarStyle: { backgroundColor: C.panel, borderTopColor: C.line },
      tabBarActiveTintColor: C.text,
      tabBarInactiveTintColor: C.dim,
      sceneStyle: { backgroundColor: C.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Atribuição', tabBarIcon: icon('🔄') }} />
      <Tabs.Screen name="motoristas" options={{ title: 'Motoristas', tabBarIcon: icon('👥') }} />
      <Tabs.Screen name="callup" options={{ title: 'Call Up', tabBarIcon: icon('📞') }} />
      <Tabs.Screen name="disponibilidade" options={{ title: 'Disponibilidade', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('☰') }} />
    </Tabs>
  )
}
