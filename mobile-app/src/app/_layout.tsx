// Must stay the first import: installs the localStorage shim used by the shared lib code.
import { hydrateStorage } from '@/lib/storage'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AppDataProvider } from '@/lib/appData'
import { SyncProvider } from '@/lib/sync'
import { C } from '@/components/ui'

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  useEffect(() => { hydrateStorage().finally(() => setReady(true)) }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    )
  }

  return (
    <AppDataProvider>
      <SyncProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{
          headerStyle: { backgroundColor: C.panel },
          headerTintColor: C.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="ds" options={{ title: 'Análise DS' }} />
          <Stack.Screen name="pacotes" options={{ title: 'Pacotes' }} />
          <Stack.Screen name="visao-geral" options={{ title: 'Visão Geral' }} />
          <Stack.Screen name="carregamento" options={{ title: 'Carregamento' }} />
          <Stack.Screen name="bloqueados" options={{ title: 'Bloqueados' }} />
          <Stack.Screen name="dados" options={{ title: 'Dados e sincronização' }} />
          <Stack.Screen name="config" options={{ title: 'Configurações' }} />
          <Stack.Screen name="motorista/[id]" options={{ title: 'Motorista' }} />
        </Stack>
      </SyncProvider>
    </AppDataProvider>
  )
}
