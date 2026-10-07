import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { AnalysisResult, ParsedRoute } from './lib/types'
import FileUpload from './components/FileUpload'
import Dashboard from './components/Dashboard'
import DriversApp from './components/Motoristas'
import DriverImport from './components/Motoristas/DriverImport'
import Disponibilidade from './components/Disponibilidade'
import CallUp from './components/CallUp'
import ForwardOrder from './components/ForwardOrder'
import VisaoGeral from './components/VisaoGeral'
import NoShowReversion from './components/NoShowReversion'
import Carregamento from './components/Carregamento'
import Blocklist from './components/Blocklist'
import GlobalHeader from './components/GlobalHeader'
import Configuracoes from './components/Configuracoes'

import { localStore } from './lib/localStore'
import { parseDriverCsv } from './lib/driverParser'
import { reportStore } from './lib/reportStore'
import { routeStore } from './lib/routeStore'
import { parseRoutesTsv } from './lib/noshowRouteParser'
import { parseBrAssignment } from './lib/brAssignmentParser'
import { fetchAllSpxWorkPref, spxDriversToWorkPref } from './lib/spxWorkPrefFetcher'
import { parseCallUpCsv } from './lib/callUpParser'
import { parseForwardOrderCsv } from './lib/forwardOrderParser'
import { parseWorkPreferenceXlsx } from './lib/workPreferenceParser'
import { buildDriverProfiles } from './lib/crossAnalysis'

import type { CallUpAnalysis } from './lib/callUpParser'
import type { ForwardOrderAnalysis } from './lib/forwardOrderParser'
import type { WorkPreferenceData } from './lib/workPreferenceParser'
import { getGlobalConfig, driverMatchesShift } from './lib/globalConfig'
import { findLatestFile, FILE_PATTERNS, base64ToArrayBuffer } from './lib/fileFinder'
import { noShowQueueStore } from './lib/noShowQueueStore'
import type { QueueDriver } from './lib/noShowQueueStore'
import { calculatePriorityScore, daysSinceLastRoute, declineRatePercent } from './lib/priorityScore'
import type { Shift } from './lib/globalConfig'
import { checkForUpdate, type UpdateInfo } from './lib/updateChecker'

// ─── DS persistence ───────────────────────────────────────────────────────────
const DS_KEY = 'spx_ds_result'
function saveDsResult(result: AnalysisResult, fileName: string) {
  try { localStorage.setItem(DS_KEY, JSON.stringify({ result, fileName })) } catch { /* quota */ }
}
function loadDsResult(): { result: AnalysisResult; fileName: string } | null {
  try { const raw = localStorage.getItem(DS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

// ─── Types ────────────────────────────────────────────────────────────────────
type DSState =
  | { phase: 'idle' }
  | { phase: 'processing'; message: string }
  | { phase: 'done'; result: AnalysisResult; fileName: string }
  | { phase: 'error'; message: string }

type Section = 'uploads' | 'ds' | 'motoristas' | 'disponibilidade' | 'callup' | 'pacotes' | 'perfil' | 'noshow' | 'carregamento' | 'blocklist' | 'config'

interface NavItem { id: Section; icon: string; label: string; group?: string }

const NAV: NavItem[] = [
  { id: 'uploads',       icon: '📤', label: 'Uploads' },
  { id: 'ds',            icon: '📊', label: 'Análise DS',     group: 'Análise' },
  { id: 'motoristas',    icon: '👥', label: 'Motoristas',     group: 'Análise' },
  { id: 'disponibilidade', icon: '📅', label: 'Disponibilidade', group: 'Operação' },
  { id: 'callup',        icon: '📞', label: 'Call Up',        group: 'Operação' },
  { id: 'pacotes',       icon: '📦', label: 'Pacotes',        group: 'Operação' },
  { id: 'perfil',        icon: '🔍', label: 'Visão Geral',    group: 'Operação' },
  { id: 'noshow',        icon: '🔄', label: 'Atribuição', group: 'Operação' },
  { id: 'carregamento',  icon: '⏱', label: 'Carregamento',   group: 'Operação' },
  { id: 'blocklist',    icon: '⊘',  label: 'Bloqueados',      group: 'Operação' },
  { id: 'config',      icon: '⚙',  label: 'Configurações' },
]

function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const TODAY = localDateStr()

// ─── App ──────────────────────────────────────────────────────────────────────
const HEADER_KEY = 'spx:header'
function loadHeader(): { day: string; shift: Shift } {
  try { const r = localStorage.getItem(HEADER_KEY); return r ? JSON.parse(r) : {} } catch { return {} as never }
}

export default function App() {
  const [section, setSection] = useState<Section>('uploads')
  const [dsState, setDsState] = useState<DSState>(() => {
    const saved = loadDsResult()
    return saved ? { phase: 'done', ...saved } : { phase: 'idle' }
  })
  const workerRef = useRef<Worker | null>(null)
  const [parsedRoutes, setParsedRoutes] = useState<ParsedRoute[]>([])

  // Global header state
  const [selectedDay, setSelectedDay] = useState<string>(() => loadHeader().day ?? localDateStr())
  const [selectedShift, setSelectedShift] = useState<Shift>(() => loadHeader().shift ?? 'AM')
  const [spxHeaderOpen, setSpxHeaderOpen] = useState(false)
  const [spxConfigured, setSpxConfigured] = useState(() => !!localStorage.getItem('spx:credentials'))
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    checkForUpdate().then(info => { if (info) setUpdateInfo(info) }).catch(() => {})
  }, [])

  const handleDayChange = (d: string) => {
    setSelectedDay(d)
    try { localStorage.setItem(HEADER_KEY, JSON.stringify({ day: d, shift: selectedShift })) } catch { /* ok */ }
    if (workPref) buildNoShowQueues(workPref, d)
  }
  const handleShiftChange = (s: Shift) => {
    setSelectedShift(s)
    try { localStorage.setItem(HEADER_KEY, JSON.stringify({ day: selectedDay, shift: s })) } catch { /* ok */ }
  }

  // Report data (live in memory, loaded from localStorage)
  const [driversMeta, setDriversMeta] = useState(() => localStore.getMeta())
  const [callUp, setCallUp] = useState<CallUpAnalysis | null>(() => reportStore.getCallUp())
  const [forwardOrder, setForwardOrder] = useState<ForwardOrderAnalysis | null>(() => reportStore.getForwardOrder())
  const [workPref, setWorkPref] = useState<WorkPreferenceData | null>(() => reportStore.getWorkPref())

  // ── DS processing ────────────────────────────────────────────────────────────
  const handleDsFile = useCallback((csv: string, fileName: string) => {
    if (workerRef.current) workerRef.current.terminate()
    setDsState({ phase: 'processing', message: 'Inicializando...' })
    setSection('ds')

    const worker = new Worker(new URL('./workers/processor.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (e) => {
      const { type, message, result, parsedRoutes: pr } = e.data
      if (type === 'progress') setDsState({ phase: 'processing', message })
      else if (type === 'done') {
        saveDsResult(result, fileName)
        setDsState({ phase: 'done', result, fileName })
        if (pr) setParsedRoutes(pr)
        worker.terminate()
      }
      else if (type === 'error') { setDsState({ phase: 'error', message }); worker.terminate() }
    }
    worker.onerror = (err) => {
      setDsState({ phase: 'error', message: err.message || 'Erro desconhecido.' })
      worker.terminate()
    }
    worker.postMessage({ csv })
  }, [])

  const handleResetDS = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    localStorage.removeItem(DS_KEY)
    setDsState({ phase: 'idle' })
  }, [])

  // ── Call Up ──────────────────────────────────────────────────────────────────
  const handleCallUpFile = useCallback((csv: string, fileName: string) => {
    const data = parseCallUpCsv(csv, fileName, getGlobalConfig())
    reportStore.saveCallUp(data)
    setCallUp(data)
  }, [])

  // ── Forward Order ─────────────────────────────────────────────────────────────
  const handleForwardOrderFile = useCallback((csv: string, fileName: string) => {
    const data = parseForwardOrderCsv(csv, fileName)
    reportStore.saveForwardOrder(data)
    setForwardOrder(data)
  }, [])

  // ── Work Preference ───────────────────────────────────────────────────────────
  function buildNoShowQueues(data: WorkPreferenceData, forDay?: string) {
    const cfg = getGlobalConfig()
    const today = forDay ?? selectedDay
    const dsDrivers = dsState.phase === 'done' ? dsState.result.drivers : []
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const callUpMap = new Map((callUp?.byDriver ?? []).map(d => [d.driverId, d]))
    const shifts = ['AM', 'PM1', 'PM2'] as const
    for (const shift of shifts) {
      const queue: QueueDriver[] = data.drivers
        .filter(d => {
          const sched = d.schedule[today]
          if (!sched || sched.status !== 'available') return false
          return driverMatchesShift(sched.slots, shift, cfg)
        })
        .map(d => {
          const ds = dsMap.get(d.driverId)
          const cu = callUpMap.get(d.driverId)
          const dsPercent = ds?.DS_Real != null ? ds.DS_Real * 100 : 50
          const priorityScore = calculatePriorityScore(dsPercent, declineRatePercent(cu), d.noShowTime ?? 0)
          return {
            driverId: d.driverId,
            name: d.driverName || d.driverId,
            vehicleType: d.vehicleType || null,
            clusters: d.clusters,
            priorityScore,
            isBlocked: false,
          }
        })
      noShowQueueStore.set(shift, queue)
    }
  }

  const handleWorkPrefFile = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer()
    const data = parseWorkPreferenceXlsx(buf, file.name)
    reportStore.saveWorkPref(data)
    buildNoShowQueues(data)
    setWorkPref(data)
  }, [])

  const handleWorkPrefData = useCallback((data: WorkPreferenceData) => {
    reportStore.saveWorkPref(data)
    buildNoShowQueues(data)
    setWorkPref(data)
  }, [])

  // ── Drivers imported ──────────────────────────────────────────────────────────
  const onDriversImported = useCallback(() => {
    setDriversMeta(localStore.getMeta())
  }, [])

  // ── Cross-analysis (computed from all loaded sources) ─────────────────────────
  const profiles = (() => {
    const registry = localStore.getDrivers()
    const dsDrivers = dsState.phase === 'done' ? dsState.result.drivers : []
    if (!registry.length && !dsDrivers.length && !callUp && !forwardOrder && !workPref) return null
    return buildDriverProfiles({
      registry,
      dsDrivers,
      callUpDrivers: callUp?.byDriver ?? [],
      forwardDrivers: forwardOrder?.allDrivers ?? [],
      workPrefDrivers: workPref?.drivers ?? [],
      today: TODAY,
    })
  })()

  // ── Nav dot helpers ───────────────────────────────────────────────────────────
  const navDots: Partial<Record<Section, string>> = {
    ds: dsState.phase === 'done' ? '#22c55e' : undefined,
    motoristas: driversMeta ? '#8b5cf6' : undefined,
    disponibilidade: workPref ? '#3b82f6' : undefined,
    callup: callUp ? '#f59e0b' : undefined,
    pacotes: forwardOrder ? '#ef4444' : undefined,
    perfil: profiles ? '#22c55e' : undefined,
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: 200, minWidth: 200, background: '#0a0c14', borderRight: '1px solid #1e2130', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1e2130' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>SPX Analytics</span>
          </div>
        </div>

        <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {(() => {
            const items: React.ReactNode[] = []
            let lastGroup: string | undefined = undefined
            for (const item of NAV) {
              if (item.group && item.group !== lastGroup) {
                items.push(
                  <p key={`g-${item.group}`} style={{ margin: '10px 0 2px', padding: '0 16px', fontSize: 9, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    {item.group}
                  </p>
                )
                lastGroup = item.group
              }
              const dot = navDots[item.id]
              items.push(
                <button key={item.id} onClick={() => setSection(item.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: section === item.id ? 'rgba(59,130,246,.12)' : 'transparent', border: 'none', borderLeft: `3px solid ${section === item.id ? '#3b82f6' : 'transparent'}`, color: section === item.id ? '#e2e8f0' : '#8892a4', fontSize: 13, fontWeight: section === item.id ? 600 : 400, cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'all .1s' }}>
                  <span style={{ fontSize: 15 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
                </button>
              )
            }
            return items
          })()}
        </nav>

        <div style={{ padding: '10px 16px', borderTop: '1px solid #1e2130' }}>
          <p style={{ margin: 0, fontSize: 10, color: '#4a5568' }}>v1.1.0 · 100% local</p>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <GlobalHeader
          day={selectedDay}
          shift={selectedShift}
          onDayChange={handleDayChange}
          onShiftChange={handleShiftChange}
          spxConfigured={spxConfigured}
          onSpxClick={() => setSpxHeaderOpen(true)}
        />
        {spxHeaderOpen && <SpxModal onClose={() => setSpxHeaderOpen(false)} onSaved={() => { setSpxConfigured(true); setSpxHeaderOpen(false) }} onRemoved={() => { setSpxConfigured(false); setSpxHeaderOpen(false) }} />}
        {updateInfo && !updateDismissed && (
          <div style={{ background: '#1a2e1a', borderBottom: '1px solid #22c55e44', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 16 }}>🆕</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>Nova versão disponível: {updateInfo.version}</span>
              <span style={{ fontSize: 12, color: '#86efac', marginLeft: 10 }}>{updateInfo.name}</span>
              <span style={{ fontSize: 11, color: '#64748b', marginLeft: 10 }}>· versão atual: {updateInfo.current}</span>
            </div>
            {(
              <button onClick={() => window.open(updateInfo.url, '_blank')} style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                Baixar
              </button>
            )}
            <button onClick={() => setUpdateDismissed(true)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
          </div>
        )}
        {section === 'uploads' && (
          <UploadsPage
            dsState={dsState}
            driversMeta={driversMeta}
            callUp={callUp}
            forwardOrder={forwardOrder}
            workPref={workPref}
            selectedDay={selectedDay}
            selectedShift={selectedShift}
            onDsFile={handleDsFile}
            onDsReset={handleResetDS}
            onDriversImported={onDriversImported}
            onCallUpFile={handleCallUpFile}
            onForwardOrderFile={handleForwardOrderFile}
            onWorkPrefFile={handleWorkPrefFile}
            onWorkPrefArrayBuffer={(buf, name) => { const data = parseWorkPreferenceXlsx(buf, name); reportStore.saveWorkPref(data); buildNoShowQueues(data); setWorkPref(data) }}
            onWorkPrefData={handleWorkPrefData}
            onClearCallUp={() => { reportStore.clearCallUp(); setCallUp(null) }}
            onClearForwardOrder={() => { reportStore.clearForwardOrder(); setForwardOrder(null) }}
            onClearWorkPref={() => { reportStore.clearWorkPref(); setWorkPref(null) }}
          />
        )}

        {section === 'ds' && (
          <>
            {dsState.phase === 'idle' && <GoToUploads label="Nenhum relatório de rotas carregado." onGo={() => setSection('uploads')} />}
            {dsState.phase === 'processing' && <Spinner message={dsState.message} />}
            {dsState.phase === 'error' && <ErrorView message={dsState.message} onRetry={handleResetDS} />}
            {dsState.phase === 'done' && <Dashboard result={dsState.result} fileName={dsState.fileName} onReset={handleResetDS} parsedRoutes={parsedRoutes} />}
          </>
        )}

        {section === 'motoristas' && <DriversApp onImported={onDriversImported} />}

        {section === 'disponibilidade' && (
          workPref
            ? <Disponibilidade
                data={workPref}
                registry={localStore.getDrivers()}
                dsDrivers={dsState.phase === 'done' ? dsState.result.drivers : []}
                callUp={callUp}
                forwardOrder={forwardOrder}
                selectedDay={selectedDay}
                selectedShift={selectedShift}
              />
            : <GoToUploads label="Importar Work Preference para ver disponibilidade." onGo={() => setSection('uploads')} />
        )}

        {section === 'callup' && (
          callUp
            ? <CallUp data={callUp} workPref={workPref} registry={localStore.getDrivers()} driverMeta={(() => {
                const m = new Map<string, { vehicleType: string; ds: number | null }>()
                for (const d of (workPref?.drivers ?? [])) m.set(d.driverId, { vehicleType: d.vehicleType, ds: null })
                for (const d of (dsState.phase === 'done' ? dsState.result.drivers : [])) {
                  const prev = m.get(d.driver_id) ?? { vehicleType: '', ds: null }
                  m.set(d.driver_id, { ...prev, ds: d.DS_Real })
                }
                return m
              })()} />
            : <GoToUploads label="Importar relatório de Call Up." onGo={() => setSection('uploads')} />
        )}

        {section === 'pacotes' && (
          forwardOrder
            ? <ForwardOrder data={forwardOrder} registry={localStore.getDrivers()} driverMeta={(() => {
                const m = new Map<string, { vehicleType: string; ds: number | null; isNewDriver?: boolean }>()
                for (const d of (workPref?.drivers ?? [])) m.set(d.driverId, { vehicleType: d.vehicleType, ds: null, isNewDriver: d.isNewDriver })
                for (const d of (dsState.phase === 'done' ? dsState.result.drivers : [])) {
                  const prev = m.get(d.driver_id) ?? { vehicleType: '', ds: null }
                  m.set(d.driver_id, { ...prev, ds: d.DS_Real })
                }
                return m
              })()} />
            : <GoToUploads label="Importar relatório de pacotes em aberto." onGo={() => setSection('uploads')} />
        )}

        {section === 'perfil' && (
          <VisaoGeral
            registry={localStore.getDrivers()}
            dsDrivers={dsState.phase === 'done' ? dsState.result.drivers : []}
            selectedDay={selectedDay}
            selectedShift={selectedShift}
          />
        )}

        {section === 'noshow' && (
          <NoShowReversion
            registry={localStore.getDrivers()}
            dsDrivers={dsState.phase === 'done' ? dsState.result.drivers : []}
            forwardOrder={forwardOrder}
            callUp={callUp}
            workPref={workPref}
            selectedDay={selectedDay}
            selectedShift={selectedShift}
          />
        )}

        {section === 'carregamento' && (
          <Carregamento
            registry={localStore.getDrivers()}
            selectedDay={selectedDay}
            selectedShift={selectedShift}
          />
        )}

        {section === 'blocklist' && (
          <Blocklist
            registry={localStore.getDrivers()}
            forwardOrder={forwardOrder}
            workPref={workPref}
          />
        )}

        {section === 'config' && <Configuracoes />}
      </main>
    </div>
  )
}

// ─── SPX Modal (global, shared) ───────────────────────────────────────────────

const SPX_CREDS_KEY = 'spx:credentials'

function parseCurl(curl: string): Record<string, string> {
  const creds: Record<string, string> = {}
  const cookieMatch = curl.match(/-b\s+'([^']+)'/)
  if (cookieMatch) creds['cookie'] = cookieMatch[1]
  const extract = (p: RegExp) => { const m = curl.match(p); return m ? m[1].trim() : undefined }
  const csrf = extract(/x-csrftoken:\s*([^\s'\\]+)/i)
  if (csrf) creds['x-csrftoken'] = csrf
  const sapRi = extract(/x-sap-ri:\s*([^\s'\\]+)/i)
  if (sapRi) creds['x-sap-ri'] = sapRi
  const dev = extract(/device-id:\s*([^\s'\\]+)/i)
  if (dev) creds['device-id'] = dev
  const sapSec = curl.match(/x-sap-sec:\s*([^']+?)'[\s\\]*(?:-H|--data|$)/i)
  if (sapSec) creds['x-sap-sec'] = sapSec[1].trim()
  return creds
}

function SpxModal({ onClose, onSaved, onRemoved }: { onClose: () => void; onSaved: () => void; onRemoved: () => void }) {
  const [curlInput, setCurlInput] = useState('')
  const hasExisting = !!localStorage.getItem(SPX_CREDS_KEY)
  const parsed = curlInput ? parseCurl(curlInput) : null
  const hasMin = !!(parsed?.['cookie'] && parsed?.['x-csrftoken'])
  const hasAll = hasMin && !!(parsed?.['x-sap-ri'] && parsed?.['x-sap-sec'])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, padding: '20px 24px', width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 14 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>🔑 Credenciais SPX</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
          No painel SPX pressione F12 → Network, faça qualquer ação e copie uma requisição como cURL (botão direito → "Copy as cURL"). Cole abaixo.
        </p>
        <textarea
          value={curlInput}
          onChange={e => setCurlInput(e.target.value)}
          placeholder="curl 'https://spx.shopee.com.br/...' -H 'x-csrftoken: ...' -b '...'"
          rows={8}
          autoFocus
          style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
        />
        {curlInput && parsed && (
          <div style={{ background: hasMin ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)', border: `1px solid ${hasMin ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`, borderRadius: 7, padding: '10px 12px', fontSize: 11 }}>
            <p style={{ margin: '0 0 5px', fontWeight: 600, color: hasAll ? '#4ade80' : hasMin ? '#fbbf24' : '#f87171' }}>
              {hasAll ? '✓ Todas as credenciais identificadas' : hasMin ? '⚠ Básicas ok (x-sap-ri/sec não encontrados)' : '✗ Cookie ou csrftoken não encontrados'}
            </p>
            {(['cookie', 'x-csrftoken', 'device-id', 'x-sap-ri', 'x-sap-sec'] as const).map(k => (
              <p key={k} style={{ margin: '2px 0', color: parsed[k] ? '#94a3b8' : '#4a5568' }}>
                <span style={{ color: '#64748b' }}>{k}:</span> {parsed[k] ? (k === 'cookie' ? `${parsed[k].slice(0, 50)}…` : parsed[k]) : <em>não encontrado</em>}
              </p>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
          <button
            disabled={!curlInput.trim() || !hasMin}
            onClick={() => { localStorage.setItem(SPX_CREDS_KEY, JSON.stringify(parseCurl(curlInput))); onSaved() }}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: !curlInput.trim() || !hasMin ? 'default' : 'pointer', opacity: !curlInput.trim() || !hasMin ? .45 : 1 }}>
            Salvar credenciais
          </button>
          {hasExisting && (
            <button onClick={() => { localStorage.removeItem(SPX_CREDS_KEY); onRemoved() }}
              style={{ background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Remover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Uploads Page ─────────────────────────────────────────────────────────────

const SHIFTS_UPLOAD: Shift[] = ['AM', 'PM1', 'PM2']
const SHIFT_COLOR_UP: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#f472b6' }

interface UploadsProps {
  dsState: DSState
  driversMeta: ReturnType<typeof localStore.getMeta>
  callUp: CallUpAnalysis | null
  forwardOrder: ForwardOrderAnalysis | null
  workPref: WorkPreferenceData | null
  selectedDay: string
  selectedShift: Shift
  onDsFile: (csv: string, fileName: string) => void
  onDsReset: () => void
  onDriversImported: () => void
  onCallUpFile: (csv: string, fileName: string) => void
  onForwardOrderFile: (csv: string, fileName: string) => void
  onWorkPrefFile: (file: File) => void
  onWorkPrefArrayBuffer: (buf: ArrayBuffer, name: string) => void
  onWorkPrefData: (data: WorkPreferenceData) => void
  onClearCallUp: () => void
  onClearForwardOrder: () => void
  onClearWorkPref: () => void
}

function RoutePasteCard({ defaultDate, defaultShift }: { defaultDate: string; defaultShift: Shift }) {
  const [pasteDate, setPasteDate] = useState(defaultDate)
  const [pasteShift, setPasteShift] = useState<Shift>(defaultShift)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [routesSaved, setRoutesSaved] = useState<{ date: string; shift: Shift; count: number }[]>(() => routeStore.list())

  const preview = useMemo(() => text.trim() ? parseRoutesTsv(text) : [], [text])

  const handleLoad = () => {
    if (preview.length === 0) return
    routeStore.save(pasteDate, pasteShift, preview)
    setRoutesSaved(routeStore.list())
    setSaved(true)
    setText('')
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Histórico salvo */}
      {routesSaved.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {routesSaved.map(s => (
            <div key={`${s.date}:${s.shift}`} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#0f1117', border: `1px solid ${SHIFT_COLOR_UP[s.shift]}44`, borderRadius: 5, padding: '3px 8px' }}>
              <span style={{ color: SHIFT_COLOR_UP[s.shift], fontWeight: 700, fontSize: 11 }}>{s.shift}</span>
              <span style={{ color: '#64748b', fontSize: 11 }}>·</span>
              <span style={{ color: '#8892a4', fontSize: 11 }}>{s.date}</span>
              <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 11 }}>{s.count} rotas</span>
              <button onClick={() => { routeStore.delete(s.date, s.shift); setRoutesSaved(routeStore.list()) }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={pasteDate} onChange={e => setPasteDate(e.target.value)} style={{ width: 140, background: '#0f1117', border: '1px solid #2d3048', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {SHIFTS_UPLOAD.map(s => (
            <button key={s} onClick={() => setPasteShift(s)} style={{ border: `1px solid ${pasteShift === s ? SHIFT_COLOR_UP[s] : '#2d3048'}`, background: pasteShift === s ? `${SHIFT_COLOR_UP[s]}22` : 'transparent', color: pasteShift === s ? SHIFT_COLOR_UP[s] : '#8892a4', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setSaved(false) }}
        placeholder={'Rota\tAT / TO\tGaiola\t...\nCopie a tabela do SPX e cole aqui'}
        rows={4}
        style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', padding: '8px 10px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {preview.length > 0 && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ {preview.length} rotas</span>}
        {saved && <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✓ Salvo!</span>}
        <button disabled={preview.length === 0} onClick={handleLoad} style={{ marginLeft: 'auto', background: preview.length > 0 ? '#7c3aed' : '#2d3048', color: preview.length > 0 ? '#fff' : '#64748b', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: preview.length > 0 ? 'pointer' : 'default' }}>
          Salvar {pasteShift} · {pasteDate}
        </button>
        {text && <button onClick={() => setText('')} style={{ background: 'transparent', border: '1px solid #2d3048', color: '#8892a4', borderRadius: 7, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>Limpar</button>}
      </div>
    </div>
  )
}

function applyBrAssignmentMap(map: ReturnType<typeof parseBrAssignment>): { matched: number; total: number } | null {
  const allSaved = routeStore.list()
  if (allSaved.length === 0) return null
  let totalMatched = 0, totalRoutes = 0
  // Track which drivers got routes per shift to remove from NoShow queue
  const assignedByShift = new Map<string, Set<string>>()
  for (const { date, shift } of allSaved) {
    const routes = routeStore.get(date, shift)
    if (!routes) continue
    let matched = 0
    const updated = routes.map(r => {
      const entry = map.get(r.atId)
      if (!entry) return r
      matched++
      if (entry.driverId) {
        if (!assignedByShift.has(shift)) assignedByShift.set(shift, new Set())
        assignedByShift.get(shift)!.add(entry.driverId)
      }
      return { ...r, assignedDriverId: entry.driverId || r.assignedDriverId, assignedDriverName: entry.driverName || r.assignedDriverName, status: (entry.driverId ? 'ATRIBUIDA' : r.status) as 'DISPONIVEL' | 'ATRIBUIDA' }
    })
    routeStore.save(date, shift, updated)
    totalMatched += matched
    totalRoutes += routes.length
  }
  // Remove drivers who got routes from the NoShow queues
  for (const [shift, driverIds] of assignedByShift) {
    noShowQueueStore.remove(shift as import('./lib/globalConfig').Shift, [...driverIds])
  }
  return { matched: totalMatched, total: totalRoutes }
}

function BrAssignmentCard() {
  const [status, setStatus] = useState<{ matched: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (csv: string) => {
    setError(null); setStatus(null)
    const map = parseBrAssignment(csv)
    if (map.size === 0) { setError('Nenhum AT encontrado.'); return }
    const allSaved = routeStore.list()
    if (allSaved.length === 0) { setError('Nenhuma roteirização salva. Carregue primeiro.'); return }
    const result = applyBrAssignmentMap(map)
    if (result) setStatus(result)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { const csv = ev.target?.result as string; if (csv) handleFile(csv) }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
        Vincula o motorista a cada AT em todas as roteirizações salvas.
      </p>
      <div
        onClick={() => inputRef.current?.click()}
        style={{ border: '2px dashed #2d3048', borderRadius: 8, padding: '14px 20px', textAlign: 'center', cursor: 'pointer', color: '#8892a4', fontSize: 12 }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const r = new FileReader(); r.onload = ev => { const csv = ev.target?.result as string; if (csv) handleFile(csv) }; r.readAsText(f, 'UTF-8') } }}
      >
        📂 Clique ou arraste o <code>br_assignment_task_*.csv</code>
        <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={onInputChange} />
      </div>
      {status && (
        <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
          ✓ {status.matched} de {status.total} rotas vinculadas com motorista
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: '#f87171' }}>⚠ {error}</div>}
    </div>
  )
}

const SPX_CREDS_KEY_UP = 'spx:credentials'
function getSpxCredsUp(): Record<string, string> | null {
  try { const r = localStorage.getItem(SPX_CREDS_KEY_UP); return r ? JSON.parse(r) : null } catch { return null }
}


function SpxWorkPrefFetchButton({ selectedDay, workPref, onData }: { selectedDay: string; workPref: WorkPreferenceData | null; onData: (d: WorkPreferenceData) => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const creds = getSpxCredsUp()

  const handleFetch = async () => {
    if (!creds) { setError('Configure as credenciais SPX primeiro.'); return }
    setStatus('loading'); setError(null); setProgress(null)
    try {
      const drivers = await fetchAllSpxWorkPref(creds, selectedDay, 2, (loaded, total) => setProgress({ loaded, total }))
      const data = spxDriversToWorkPref(drivers, workPref)
      onData(data)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      setStatus('error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!creds && <p style={{ margin: 0, fontSize: 11, color: '#fbbf24' }}>⚠ Configure as credenciais SPX antes de buscar.</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => void handleFetch()}
          disabled={status === 'loading' || !creds}
          style={{ background: status === 'loading' ? '#2d3048' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: status === 'loading' || !creds ? 'default' : 'pointer', opacity: !creds ? 0.5 : 1 }}
        >
          {status === 'loading' ? `⏳ Buscando… ${progress ? `${progress.loaded}/${progress.total}` : ''}` : '⬇ Buscar do SPX'}
        </button>
        {status === 'done' && <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✓ Carregado do SPX</span>}
      </div>
      {error && <p style={{ margin: 0, fontSize: 11, color: '#f87171' }}>⚠ {error}</p>}
      <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
        Busca todos os motoristas disponíveis direto do painel SPX — {workPref ? 'clusters do XLSX atual são mantidos' : 'clusters ficam vazios sem XLSX'}.
      </p>
    </div>
  )
}

function AutoFindButton({ pattern, onFound, color }: { pattern: string; onFound: (content: string, name: string) => void; color: string }) {
  const [status, setStatus] = useState<'idle' | 'searching' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const folder = getGlobalConfig().downloadsFolder

  if (!folder) return (
    <p style={{ margin: 0, fontSize: 11, color: '#fbbf24' }}>
      ⚠ Configure a pasta de downloads nas <strong>Configurações</strong> para busca automática.
    </p>
  )

  const handleFind = async () => {
    setStatus('searching')
    setMsg('')
    const res = await findLatestFile(folder, pattern)
    if ('error' in res) {
      setStatus('err')
      setMsg(res.error)
    } else {
      setStatus('ok')
      setMsg(res.name)
      onFound(res.content, res.name)
      setTimeout(() => setStatus('idle'), 2000)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button
        onClick={() => void handleFind()}
        disabled={status === 'searching'}
        style={{ background: status === 'searching' ? '#2d3048' : color + '22', color: color, border: `1px solid ${color}44`, borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: status === 'searching' ? 'default' : 'pointer' }}
      >
        {status === 'searching' ? '🔍 Buscando…' : '🔍 Buscar automaticamente'}
      </button>
      {status === 'ok' && <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✓ {msg}</span>}
      {status === 'err' && <span style={{ fontSize: 11, color: '#f87171' }}>✕ {msg}</span>}
      {status === 'idle' && <span style={{ fontSize: 11, color: '#64748b' }}>Busca o mais recente: <code style={{ background: '#1a1d27', padding: '1px 4px', borderRadius: 3 }}>{pattern}</code></span>}
    </div>
  )
}

function UploadsPage(props: UploadsProps) {
  const { dsState, driversMeta, callUp, forwardOrder, workPref, selectedDay, selectedShift } = props
  const [showDriverUpload, setShowDriverUpload] = useState(false)
  const [fetchAll, setFetchAll] = useState<'idle' | 'busy' | 'done'>('idle')
  const [fetchResults, setFetchResults] = useState<{ label: string; ok: boolean; msg: string }[]>([])
  const routesSaved = routeStore.list()

  const dsMeta = dsState.phase === 'done' ? { fileName: dsState.fileName } : null
  const dsProcessing = dsState.phase === 'processing' ? dsState.message : null
  const folder = getGlobalConfig().downloadsFolder

  const handleFetchAll = async () => {
    if (!folder) return
    setFetchAll('busy')
    setFetchResults([])

    const tasks: { label: string; pattern: string; onFound: (c: string, n: string, enc?: string) => void }[] = [
      { label: 'Rotas DS', pattern: FILE_PATTERNS.ds, onFound: (c, n) => props.onDsFile(c, n) },
      { label: 'Motoristas', pattern: FILE_PATTERNS.driver, onFound: (c, n) => {
        const p = parseDriverCsv(c); if (!p.error) { localStore.saveDrivers(p.drivers, { total: p.drivers.length, fileName: n }); props.onDriversImported() }
      }},
      { label: 'Work Preference', pattern: FILE_PATTERNS.workPref, onFound: (c, n, enc) => {
        const buf = enc === 'base64' ? base64ToArrayBuffer(c) : new TextEncoder().encode(c).buffer
        props.onWorkPrefArrayBuffer(buf, n)
      }},
      { label: 'Call Up', pattern: FILE_PATTERNS.callUp, onFound: (c, n) => props.onCallUpFile(c, n) },
      { label: 'Forward Order', pattern: FILE_PATTERNS.forwardOrder, onFound: (c, n) => props.onForwardOrderFile(c, n) },
    ]

    const results: { label: string; ok: boolean; msg: string }[] = []
    for (const t of tasks) {
      const res = await findLatestFile(folder, t.pattern)
      if ('error' in res) {
        results.push({ label: t.label, ok: false, msg: res.error })
      } else {
        t.onFound(res.content, res.name, res.encoding)
        results.push({ label: t.label, ok: true, msg: res.name })
      }
    }
    setFetchResults(results)
    setFetchAll('done')
    setTimeout(() => setFetchAll('idle'), 4000)
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '2rem' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>Uploads</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8892a4' }}>
            Importe os relatórios — dados salvos localmente e persistem entre sessões.
          </p>
        </div>
        {folder ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <button
              onClick={() => void handleFetchAll()}
              disabled={fetchAll === 'busy'}
              style={{ background: fetchAll === 'busy' ? '#2d3048' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: fetchAll === 'busy' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {fetchAll === 'busy' ? '⏳ Buscando…' : '🔍 Atualizar relatórios'}
            </button>
            {fetchAll === 'done' && fetchResults.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {fetchResults.map(r => (
                  <span key={r.label} title={r.msg} style={{ fontSize: 11, fontWeight: 600, color: r.ok ? '#4ade80' : '#f87171', background: r.ok ? 'rgba(74,222,128,.1)' : 'rgba(248,113,113,.1)', border: `1px solid ${r.ok ? 'rgba(74,222,128,.25)' : 'rgba(248,113,113,.25)'}`, borderRadius: 5, padding: '2px 8px' }}>
                    {r.ok ? '✓' : '✕'} {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: '#fbbf24' }}>⚠ Configure a pasta de downloads nas <strong>Configurações</strong> para atualização automática.</p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        {/* DS Routes */}
        <UploadCard
          icon="📊" title="Relatório de Rotas DS" color="#3b82f6"
          description="CSV com histórico de rotas — base para análise de Delivery Success"
          loaded={dsMeta ? `✓ ${dsMeta.fileName}` : null}
          processing={dsProcessing}
          onClear={dsMeta ? props.onDsReset : undefined}
          tutorial={[
            'Conecte-se à VPN com o aplicativo Cisco.',
            'Acesse o link do painel DataSuite: https://us.datasuite.shopee.io/dashboard/dashboard/a9aa24b0-8bd4-4329-9d76-1987ad26afc9/normal?page=1769794562824_1s2r',
            'No filtro de data, selecione o período desejado.',
            'No filtro de HUB, selecione apenas o seu hub.',
            'No canto superior direito do relatório, clique no botão de download.',
            'Renomeie o arquivo para "resultado" e selecione o tipo CSV.',
            'Baixe na pasta configurada neste aplicativo para atualização automática.',
          ]}
        >
          <CompactDrop label="Clique ou arraste o resultado.csv" accept=".csv,.txt" onFile={f => { const r = new FileReader(); r.onload = e => { const csv = e.target?.result as string; if (csv) props.onDsFile(csv, f.name) }; r.readAsText(f, 'UTF-8') }} />
        </UploadCard>

        {/* Driver Registry */}
        <UploadCard
          icon="👥" title="Cadastro de Motoristas SPX" color="#8b5cf6"
          description="Exportado do painel SPX — Gestão de Equipe → Perfil de Motorista"
          loaded={driversMeta ? `✓ ${driversMeta.total} motoristas · ${driversMeta.fileName}` : null}
          onToggle={(open) => setShowDriverUpload(open)}
          tutorial={[
            'Acesse o sistema Shopee Xpress Live.',
            'No menu lateral esquerdo, vá em Gestão de Equipe → Perfil de Motorista.',
            'Na parte superior, selecione a aba Motorista 3PL.',
            'Clique em Exportar.',
            'Acesse o menu de Downloads no canto superior esquerdo do sistema.',
            'Baixe o relatório na pasta configurada neste aplicativo.',
          ]}
        >
          <CompactDrop label="Clique ou arraste o br_driver_*.csv" accept=".csv,.txt" onFile={f => { const r = new FileReader(); r.onload = e => { const csv = e.target?.result as string; if (csv) { const p = parseDriverCsv(csv); if (!p.error) { localStore.saveDrivers(p.drivers, { total: p.drivers.length, fileName: f.name }); setShowDriverUpload(false); props.onDriversImported() } } }; r.readAsText(f, 'UTF-8') }} />
        </UploadCard>

        {/* Work Preference */}
        <UploadCard
          icon="📅" title="Work Preference (Disponibilidade)" color="#06b6d4"
          description="Disponibilidade dos motoristas — via XLSX ou direto do painel SPX"
          loaded={workPref ? `✓ ${workPref.drivers.length} motoristas · ${workPref.fileName}` : null}
          onClear={workPref ? props.onClearWorkPref : undefined}
          tutorial={[
            'Acesse o sistema Shopee Xpress Live.',
            'No menu lateral esquerdo, vá em Gestão de Equipe → Disponibilidade de Motorista.',
            'Clique em Exportar.',
            'Acesse o menu de Downloads no canto superior esquerdo do sistema.',
            'Baixe o relatório na pasta configurada neste aplicativo para atualização automática.',
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SpxWorkPrefFetchButton selectedDay={selectedDay} workPref={workPref} onData={props.onWorkPrefData} />
            <CompactDrop label="Clique ou arraste o work_preference_result_*.xlsx" accept=".xlsx,.xls" onFile={props.onWorkPrefFile} />
          </div>
        </UploadCard>

        {/* Call Up */}
        <UploadCard
          icon="📞" title="Call Up (Chamadas de Motoristas)" color="#f59e0b"
          description="Exportado do painel SPX — Entrega → Driver Call Up"
          loaded={callUp ? `✓ ${callUp.totalCalls.toLocaleString('pt-BR')} chamadas · ${callUp.fileName}` : null}
          onClear={callUp ? props.onClearCallUp : undefined}
          tutorial={[
            'Acesse o sistema Shopee Xpress Live.',
            'No menu lateral esquerdo, vá em Entrega → Driver Call Up.',
            'Clique em Exportar.',
            'Acesse o menu de Downloads no canto superior esquerdo do sistema.',
            'Baixe o relatório na pasta configurada neste aplicativo.',
          ]}
        >
          <CompactDrop label="Clique ou arraste o br_export_call_up_notification_*.csv" accept=".csv,.txt" onFile={f => { const r = new FileReader(); r.onload = e => { const csv = e.target?.result as string; if (csv) props.onCallUpFile(csv, f.name) }; r.readAsText(f, 'UTF-8') }} />
        </UploadCard>

        {/* Forward Order */}
        <UploadCard
          icon="📦" title="Pacotes em Aberto (Forward Order)" color="#ef4444"
          description="Exportado do painel SPX — Pedidos → Rastreio de Pedidos → Exportar Pedidos Avançado"
          loaded={forwardOrder ? `✓ ${forwardOrder.totalPackages} pacotes · ${forwardOrder.fileName}` : null}
          onClear={forwardOrder ? props.onClearForwardOrder : undefined}
          tutorial={[
            'Acesse o sistema Shopee Xpress Live.',
            'No menu lateral esquerdo, vá em Pedidos → Rastreio de Pedidos.',
            'Dentro da tela, clique em Exportar e selecione Exportar Pedidos Avançado.',
            'Nos filtros, em Log de Status selecione OnHold e Delivering.',
            'Em Station, informe o hub onde você trabalha.',
            'Confirme a exportação e baixe o relatório na pasta configurada neste aplicativo.',
          ]}
        >
          <CompactDrop label="Clique ou arraste o export_forward_order_*.csv" accept=".csv,.txt" onFile={f => { const r = new FileReader(); r.onload = e => { const csv = e.target?.result as string; if (csv) props.onForwardOrderFile(csv, f.name) }; r.readAsText(f, 'UTF-8') }} />
        </UploadCard>

        {/* Roteirização por Turno */}
        <UploadCard
          icon="🛣" title="Roteirização por Turno" color="#22c55e"
          description="Cole a tabela de roteirização do SPX — salva separadamente por data e turno (AM / PM1 / PM2)"
          loaded={routesSaved.length > 0 ? `✓ ${routesSaved.length} turno(s) salvo(s)` : null}
          tutorial={[
            'Acesse a planilha de roteirização enviada diariamente para cada turno no grupo de roteirização do seu HUB.',
            'Abra a guia Plano de Expedição.',
            'Selecione toda a tabela (Ctrl+A ou clique e arraste) e copie (Ctrl+C).',
            'Clique em Importar neste card, selecione o turno e a data corretos.',
            'Cole o conteúdo no campo de texto e confirme.',
          ]}
        >
          <RoutePasteCard defaultDate={selectedDay} defaultShift={selectedShift} />
        </UploadCard>

        {/* BR Assignment */}
        <UploadCard
          icon="🔗" title="BR Assignment (Motorista por AT)" color="#f97316"
          description="Importa o arquivo br_assignment_task_*.csv e vincula o motorista a cada rota salva"
          loaded={null}
          tutorial={[
            'Acesse o sistema Shopee Xpress Live.',
            'No menu lateral esquerdo, vá em Entrega → Event Management.',
            'Selecione o hub onde você trabalha.',
            'Clique em Exportar.',
            'Acesse o menu de Downloads no canto superior esquerdo do sistema.',
            'Baixe o relatório na pasta configurada neste aplicativo.',
          ]}
        >
          <BrAssignmentCard />
        </UploadCard>
      </div>
    </div>
  )
}

function CompactDrop({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const handle = (file: File) => { onFile(file); setDone(true); setTimeout(() => setDone(false), 2000) }
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      style={{ border: `2px dashed ${dragging ? '#3b82f6' : done ? '#22c55e' : '#2d3048'}`, borderRadius: 8, padding: '14px 20px', textAlign: 'center', cursor: 'pointer', color: done ? '#4ade80' : '#8892a4', fontSize: 12, background: dragging ? 'rgba(59,130,246,.05)' : 'transparent', transition: 'all .15s' }}
    >
      {done ? '✅ Arquivo carregado' : `📂 ${label}`}
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.currentTarget.value = '' }} />
    </div>
  )
}

function UploadCard({ icon, title, description, color, loaded, processing, onClear, onToggle, tutorial, children }: {
  icon: string; title: string; description: string; color: string
  loaded: string | null; processing?: string | null; onClear?: () => void; onToggle?: (open: boolean) => void
  tutorial?: string[]
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [tutOpen, setTutOpen] = useState(false)
  const wasOpenRef = useRef(false)
  const prevLoaded = useRef<string | null>(loaded)

  useEffect(() => {
    if (wasOpenRef.current && loaded !== prevLoaded.current) {
      setOpen(false)
      wasOpenRef.current = false
      onToggle?.(false)
    }
    prevLoaded.current = loaded
  }, [loaded])

  const toggle = (v: boolean) => {
    wasOpenRef.current = v
    if (v) prevLoaded.current = `__opening_${Date.now()}__`
    setOpen(v)
    onToggle?.(v)
  }

  return (
    <div style={{ background: '#1a1d27', border: `1px solid ${loaded && !open ? color + '44' : '#2d3048'}`, borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s' }}>
      <div style={{ padding: '14px 18px', borderBottom: open || tutOpen ? '1px solid #2d3048' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 48 }}>
          <span style={{ fontSize: 22, flexShrink: 0, width: 32, textAlign: 'center' }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#e2e8f0', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
              {loaded && !open && !tutOpen && (
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: color, background: `${color}18`, border: `1px solid ${color}33`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>✓ atualizado</span>
              )}
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{description}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {tutorial && (
              <button onClick={() => { setTutOpen(v => !v); if (open) toggle(false) }}
                style={{ background: 'transparent', color: tutOpen ? '#fbbf24' : '#64748b', border: `1px solid ${tutOpen ? 'rgba(251,191,36,.4)' : '#2d3048'}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {tutOpen ? '✕ Tutorial' : '? Tutorial'}
              </button>
            )}
            {onClear && !open && (
              <button onClick={onClear} style={{ background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>
                Remover
              </button>
            )}
            <button
              onClick={() => { toggle(!open); if (tutOpen) setTutOpen(false) }}
              disabled={!!processing}
              style={{ background: open ? 'transparent' : color, color: open ? '#8892a4' : '#fff', border: open ? '1px solid #2d3048' : 'none', borderRadius: 6, padding: '5px 14px', cursor: processing ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: processing ? .5 : 1, minWidth: 78, textAlign: 'center', whiteSpace: 'nowrap' }}>
              {processing ?? (open ? 'Cancelar' : loaded ? 'Atualizar' : 'Importar')}
            </button>
          </div>
        </div>
      </div>

      {/* Tutorial panel */}
      {tutOpen && tutorial && (
        <div style={{ padding: '14px 18px', background: '#13151f', borderBottom: '1px solid #2d3048' }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Como atualizar</p>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {tutorial.map((step, i) => (
              <li key={i} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Import panel */}
      {open && <div style={{ padding: '14px 18px' }}>{children}</div>}
    </div>
  )
}

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 1, background: '#2d3048' }} />
      <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>OU SELECIONE MANUALMENTE</span>
      <div style={{ flex: 1, height: 1, background: '#2d3048' }} />
    </div>
  )
}

function XlsxDropZone({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState<'idle' | 'done'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const handle = (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) { alert('Selecione um arquivo Excel (.xlsx)'); return }
    onFile(file)
    setState('done')
    setTimeout(() => setState('idle'), 1500)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      onClick={() => inputRef.current?.click()}
      style={{ border: `2px dashed ${dragging ? '#3b82f6' : state === 'done' ? '#22c55e' : '#2d3048'}`, borderRadius: 10, padding: '1.5rem', textAlign: 'center', cursor: 'pointer', background: dragging ? 'rgba(59,130,246,.05)' : '#15182a', transition: 'all .15s' }}>
      <p style={{ margin: 0, color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
        {state === 'done' ? '✅ Arquivo carregado' : `📂 ${label}`}
      </p>
      <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 11 }}>Formato: .xlsx</p>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = '' }} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function GoToUploads({ label, onGo }: { label: string; onGo: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <p style={{ color: '#8892a4', fontSize: 14 }}>{label}</p>
      <button onClick={onGo} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
        Ir para Uploads
      </button>
    </div>
  )
}

function Spinner({ message }: { message: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ width: 44, height: 44, border: '3px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <p style={{ color: '#94a3b8', fontSize: 14 }}>{message}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '2rem', maxWidth: 480, textAlign: 'center' }}>
        <p style={{ color: '#f87171', fontWeight: 600, marginBottom: 8 }}>Erro ao processar arquivo</p>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>{message}</p>
      </div>
      <button onClick={onRetry} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}>
        Tentar novamente
      </button>
    </div>
  )
}
