import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, AppState, Pressable, Text } from 'react-native'
import { router } from 'expo-router'
import { storage } from './storage'
import { getLastSync, getSheetsConfig, syncWithSheets } from './sheetsSync'
import { leaveDemo } from './demoData'

interface SyncState {
  syncing: boolean
  lastSync: string | null
  error: string | null
  configured: boolean
  sync: () => Promise<void>
}

const Ctx = createContext<SyncState | null>(null)
const AUTO_PUSH_DELAY = 4000

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(() => getLastSync())
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(() => !!getSheetsConfig().serviceAccountKeyJson)
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sync = useCallback(async () => {
    if (running.current) return
    if (!getSheetsConfig().serviceAccountKeyJson) { setError('Planilha não configurada.'); return }
    running.current = true
    setSyncing(true)
    setError(null)
    try {
      await syncWithSheets()
      setLastSync(getLastSync())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      running.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    // O modo demonstração não tem mais botão: se ficou ativo, limpa os dados fictícios e busca os reais.
    if (leaveDemo()) storage.clearDirty()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the external Sheets sync on launch
    sync()
    const sub = AppState.addEventListener('change', st => { if (st === 'active') sync() })
    return () => sub.remove()
  }, [sync])

  useEffect(() => storage.subscribe(() => {
    setConfigured(!!getSheetsConfig().serviceAccountKeyJson)
    if (running.current) return
    const pending = storage.dirtyKeys().some(k => k.startsWith('spx:') && k !== 'spx:header' && k !== 'spx:sheets-config' && k !== 'spx:credentials')
    if (!pending) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { sync() }, AUTO_PUSH_DELAY)
  }), [sync])

  return <Ctx.Provider value={{ syncing, lastSync, error, configured, sync }}>{children}</Ctx.Provider>
}

export function useSync() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSync fora do SyncProvider')
  return v
}

export function SyncButton() {
  const { syncing, error, configured, sync } = useSync()
  if (syncing) return <ActivityIndicator style={{ marginRight: 14 }} color="#a78bfa" />
  const color = !configured ? '#fbbf24' : error ? '#f87171' : '#4ade80'
  return (
    <Pressable hitSlop={10} onPress={() => (configured ? sync() : router.push('/config'))} style={{ marginRight: 14 }}>
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{!configured ? '⚠ Configurar' : error ? '⟳ Erro' : '⟳ Sync'}</Text>
    </Pressable>
  )
}
