import { useCallback, useEffect, useMemo, useState } from 'react'
import { coversCluster } from '@/lib/clusterMatch'
import type { LocalRoute } from '@/lib/noshowRouteParser'
import { firstCallDay, isAcceptedInCallUp } from '@/lib/callUpParser'
import type { Shift } from '@/lib/globalConfig'
import { routeStore, migrateOldRoutes } from '@/lib/routeStore'
import { noShowQueueStore } from '@/lib/noShowQueueStore'
import { calculatePriorityScore, daysSinceLastRoute, declineRatePercent } from '@/lib/priorityScore'
import { useAppData } from '@/lib/appData'
import {
  computeEffective, getManualBlocks, getSpxCreds, normalizeVehicle, saveManualBlocks, spxReassign,
  type LocalDriver, type ManualBlock,
} from './logic'

export type AssignResult = { atId: string; driverId: string; local: boolean; spxOk?: boolean; spxMsg?: string }
export type FioResult = { atId: string; driverId: string; spxOk?: boolean; spxMsg?: string }
export interface BatchAssignRow { atId: string; driverId: string; status: 'ok' | 'fail' | 'no-driver'; driverName?: string; foundDriver?: boolean; spxMsg?: string }
export type ThreePlMap = Map<string, { agency: string; region: string; shift: Shift }>

function readForced(day: string, shift: Shift) {
  try { return new Set(JSON.parse(localStorage.getItem(`spx:noshow-forced:${day}:${shift}`) ?? '[]') as string[]) } catch { return new Set<string>() }
}

function readIgnored(day: string, shift: Shift) {
  try { return new Set(JSON.parse(localStorage.getItem(`spx:noshow-ignored:${day}:${shift}`) ?? '[]') as string[]) } catch { return new Set<string>() }
}

// Port of the state and handlers from the desktop NoShowReversion component.
export function useNoShow() {
  const { registry, dsDrivers, forwardOrder, callUp, workPref, day: selectedDay, shift: selectedShift, version } = useAppData()

  // Storage is the source of truth; `version` bumps on every write (local or from a Sheets sync).
  /* eslint-disable react-hooks/exhaustive-deps */
  const routes = useMemo(() => routeStore.get(selectedDay, selectedShift) ?? [], [selectedDay, selectedShift, version])
  const overrides = useMemo(() => new Map((routeStore.getOverrides(selectedDay, selectedShift) ?? []) as [string, LocalDriver][]), [selectedDay, selectedShift, version])
  const ignoredAtIds = useMemo(() => readIgnored(selectedDay, selectedShift), [selectedDay, selectedShift, version])
  const forcedAtIds = useMemo(() => readForced(selectedDay, selectedShift), [selectedDay, selectedShift, version])
  const queue = useMemo(() => noShowQueueStore.get(selectedShift), [selectedShift, version])
  const manualBlocks = useMemo(() => getManualBlocks(), [version])
  const spxConfigured = useMemo(() => !!getSpxCreds(), [version])
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => { migrateOldRoutes(selectedDay, selectedShift) }, [selectedDay, selectedShift])
  const [sessionAssignedOrder, setSessionAssignedOrder] = useState<Map<string, number>>(new Map())

  const setRoutes = (r: LocalRoute[]) => routeStore.save(selectedDay, selectedShift, r)
  const setOverrides = (m: Map<string, LocalDriver>) => routeStore.saveOverrides(selectedDay, selectedShift, [...m.entries()])
  const setIgnoredAtIds = (fn: (prev: Set<string>) => Set<string>) =>
    localStorage.setItem(`spx:noshow-ignored:${selectedDay}:${selectedShift}`, JSON.stringify([...fn(ignoredAtIds)]))
  const setManualBlocks = (b: ManualBlock[]) => saveManualBlocks(b)
  const setSpxConfigured = () => {}

  const addManualBlock = (driverId: string, name: string, reason: string) =>
    setManualBlocks([...manualBlocks.filter(b => b.driverId !== driverId), { driverId, driverName: name, reason, blockedAt: new Date().toISOString() }])
  const removeManualBlock = (driverId: string) => setManualBlocks(manualBlocks.filter(b => b.driverId !== driverId))

  const removeFromQueue = useCallback((driverIds: string[]) => noShowQueueStore.remove(selectedShift, driverIds), [selectedShift])

  const availableDrivers = useMemo((): LocalDriver[] => {
    const registryMap = new Map(registry.map(d => [d.id, d]))
    const dsMap = new Map(dsDrivers.map(d => [d.driver_id, d]))
    const manualBlockMap = new Map(manualBlocks.map(b => [b.driverId, b]))
    const autoBlockMap = new Map<string, number>((forwardOrder?.allDrivers ?? []).filter(d => d.totalPackages > 5).map(d => [d.driverId, d.totalPackages]))
    const callUpDriverMap = new Map((callUp?.byDriver ?? []).map(d => [d.driverId, d]))
    const workPrefClusters = new Map((workPref?.drivers ?? []).map(d => [d.driverId, d.clusters]))
    const workPrefNoShow = new Map((workPref?.drivers ?? []).map(d => [d.driverId, d.noShowTime ?? 0]))
    const pendingMap = new Map((forwardOrder?.allDrivers ?? []).map(x => [x.driverId, x.totalPackages]))

    return queue.map(q => {
      const reg = registryMap.get(q.driverId)
      const ds = dsMap.get(q.driverId)
      const cu = callUpDriverMap.get(q.driverId)
      const dsReal = ds?.DS_Real ?? null
      const isRegistryBlocked = reg?.spxBlocklisted ?? false
      const isAutoBlocked = autoBlockMap.has(q.driverId)
      const isManualBlocked = manualBlockMap.has(q.driverId)
      const blockType: LocalDriver['blockType'] = isAutoBlocked ? 'auto' : isManualBlocked ? 'manual' : isRegistryBlocked ? 'registry' : null
      return {
        driverId: q.driverId,
        name: q.name || reg?.name || q.driverId,
        vehicleType: q.vehicleType || reg?.vehicleType || null,
        clusters: workPrefClusters.get(q.driverId) ?? q.clusters,
        isNewDriver: false,
        isBlocked: isRegistryBlocked || isAutoBlocked || isManualBlocked || q.isBlocked,
        blockReason: isAutoBlocked ? `Redelivery — ${autoBlockMap.get(q.driverId)} pacotes pendentes`
          : isManualBlocked ? manualBlockMap.get(q.driverId)!.reason
          : isRegistryBlocked ? 'SPX Blocklist' : null,
        blockType,
        pendingPackages: pendingMap.get(q.driverId) ?? 0,
        dsReal,
        dsStatus: ds?.Status ?? null,
        priorityScore: calculatePriorityScore(dsReal !== null ? dsReal * 100 : 50, declineRatePercent(cu), workPrefNoShow.get(q.driverId) ?? 0),
        daysSinceRoute: daysSinceLastRoute(cu?.lastAcceptedDate ?? null),
      }
    }).sort((a, b) => (a.isBlocked !== b.isBlocked ? (a.isBlocked ? 1 : -1) : b.priorityScore - a.priorityScore))
  }, [queue, registry, dsDrivers, forwardOrder, manualBlocks, callUp, workPref])

  const declinedAtIds = useMemo(() => {
    const s = new Set<string>()
    for (const fc of callUp?.firstCallAnalysis.routes ?? []) if (!isAcceptedInCallUp(fc) && fc.shift === selectedShift && firstCallDay(fc) === selectedDay) s.add(fc.atId)
    return s
  }, [callUp, selectedShift, selectedDay])

  const acceptedAtIds = useMemo(() => {
    const s = new Set<string>()
    for (const fc of callUp?.firstCallAnalysis.routes ?? []) if (isAcceptedInCallUp(fc)) s.add(fc.atId)
    return s
  }, [callUp])

  const pendingAtIds = useMemo(() => {
    const s = new Set<string>()
    for (const fc of callUp?.firstCallAnalysis.routes ?? []) if ((fc.finalStatus ?? fc.status) === 'Pending') s.add(fc.atId)
    return s
  }, [callUp])

  const alreadyRoutedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of routes) if (r.assignedDriverId) ids.add(r.assignedDriverId)
    return ids
  }, [routes])

  const dobraIds = useMemo(() => {
    const ids = new Set<string>()
    for (const { date, shift } of routeStore.list()) {
      if (date !== selectedDay || shift === selectedShift) continue
      for (const r of routeStore.get(date, shift) ?? []) if (r.assignedDriverId && !alreadyRoutedIds.has(r.assignedDriverId)) ids.add(r.assignedDriverId)
    }
    return ids
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, selectedShift, alreadyRoutedIds, version])

  // Rotas atribuídas que foram recusadas no Call Up voltam a ficar disponíveis (mantendo o motorista original para excluí-lo).
  useEffect(() => {
    if (declinedAtIds.size === 0) return
    if (!routes.some(r => declinedAtIds.has(r.atId) && r.status === 'ATRIBUIDA')) return
    setRoutes(routes.map(r => (declinedAtIds.has(r.atId) && r.status === 'ATRIBUIDA' ? { ...r, status: 'DISPONIVEL' as const } : r)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declinedAtIds, routes])

  const noShowRoutes = useMemo(() => {
    // Com Call Up: entra tudo o que não está aceito (recusada, cancelada ou ainda sem resposta). Sem Call Up: só as disponíveis.
    const base = !callUp ? routes.filter(r => r.status === 'DISPONIVEL') : routes.filter(r => !acceptedAtIds.has(r.atId) || forcedAtIds.has(r.atId))
    return base.filter(r => !ignoredAtIds.has(r.atId))
  }, [routes, callUp, acceptedAtIds, ignoredAtIds, forcedAtIds])

  const orderedDrivers = useMemo(() => [...availableDrivers].sort((a, b) => {
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
    const aOrder = sessionAssignedOrder.get(a.driverId) ?? -1
    const bOrder = sessionAssignedOrder.get(b.driverId) ?? -1
    const aIn = aOrder >= 0 ? 1 : 0
    const bIn = bOrder >= 0 ? 1 : 0
    if (aIn !== bIn) return aIn - bIn
    if (aIn && bIn) return aOrder - bOrder
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore
    return b.daysSinceRoute - a.daysSinceRoute
  }), [availableDrivers, sessionAssignedOrder])

  const effectiveAssignments = useMemo(
    () => computeEffective(noShowRoutes.filter(r => r.status === 'DISPONIVEL'), orderedDrivers.filter(d => !alreadyRoutedIds.has(d.driverId)), overrides),
    [noShowRoutes, orderedDrivers, overrides, alreadyRoutedIds],
  )

  const disponivel = noShowRoutes.filter(r => r.status === 'DISPONIVEL')
  const atribuidas = noShowRoutes.filter(r => r.status === 'ATRIBUIDA')
  const allRoutes = [...[...disponivel].sort((a, b) => (effectiveAssignments.has(a.id) ? 1 : 0) - (effectiveAssignments.has(b.id) ? 1 : 0)), ...atribuidas]
  const queueDrivers = orderedDrivers.filter(d => !alreadyRoutedIds.has(d.driverId))
  const alreadyRoutedDrivers = orderedDrivers.filter(d => alreadyRoutedIds.has(d.driverId))

  // ── Fiorino ──
  const [fioMode, setFioMode] = useState<'strict' | 'maximize'>('strict')
  const fiorino = useMemo(() => {
    const fioDrivers = orderedDrivers
      .filter(d => normalizeVehicle(d.vehicleType) === 'FIORINO' && !d.isBlocked && !alreadyRoutedIds.has(d.driverId))
      .sort((a, b) => (b.priorityScore !== a.priorityScore ? b.priorityScore - a.priorityScore : b.daysSinceRoute - a.daysSinceRoute))
    const strictRoutes = routes.filter(r => r.status === 'DISPONIVEL' && !ignoredAtIds.has(r.atId) && (r.gg ?? 0) >= 2 && (r.volume ?? 0) >= 800)
    const allAvailableRoutes = routes.filter(r => r.status === 'DISPONIVEL' && !ignoredAtIds.has(r.atId))
    const build = (targets: LocalRoute[], pool: LocalDriver[]) => {
      const result = new Map<string, LocalDriver>()
      const used = new Set<string>()
      const cnt = (r: LocalRoute) => pool.filter(d => coversCluster(d.clusters, r.cluster)).length
      for (const route of [...targets].sort((a, b) => cnt(a) - cnt(b))) {
        const cand = pool.find(d => !used.has(d.driverId) && coversCluster(d.clusters, route.cluster))
        if (cand) { result.set(route.atId, cand); used.add(cand.driverId) }
      }
      return result
    }
    const strictAssignments = build(strictRoutes, fioDrivers)
    const maximizeAssignments = new Map(strictAssignments)
    const usedIds = new Set([...strictAssignments.values()].map(d => d.driverId))
    for (const [atId, d] of build(allAvailableRoutes.filter(r => !strictAssignments.has(r.atId)), fioDrivers.filter(d => !usedIds.has(d.driverId)))) maximizeAssignments.set(atId, d)
    const assignments = fioMode === 'strict' ? strictAssignments : maximizeAssignments
    return { eligibleRoutes: fioMode === 'strict' ? strictRoutes : allAvailableRoutes, strictRoutes, fioDrivers, assignments, strictAssignments }
  }, [routes, orderedDrivers, alreadyRoutedIds, ignoredAtIds, fioMode])

  const [fioAssigning, setFioAssigning] = useState(false)
  const [fioResults, setFioResults] = useState<FioResult[] | null>(null)
  const handleFioAssign = async () => {
    if (fioAssigning || fiorino.assignments.size === 0) return
    setFioAssigning(true)
    setFioResults(null)
    const results: FioResult[] = []
    for (const [atId, driver] of fiorino.assignments) {
      const res = spxConfigured ? await spxReassign(driver.driverId, atId) : null
      results.push({ atId, driverId: driver.driverId, spxOk: res?.ok, spxMsg: res?.message })
    }
    setRoutes(routes.map(r => {
      const d = fiorino.assignments.get(r.atId)
      return d ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: d.driverId, assignedDriverName: d.name } : r
    }))
    removeFromQueue([...fiorino.assignments.values()].map(d => d.driverId))
    setFioResults(results)
    setFioAssigning(false)
  }

  // ── 3PL ──
  // 3PL preview is specific to the day/shift it was made for.
  const threePlKey = `${selectedDay}|${selectedShift}`
  const [threePl, setThreePl] = useState<{ key: string; map: ThreePlMap }>({ key: threePlKey, map: new Map() })
  const threePlAssignments = threePl.key === threePlKey ? threePl.map : new Map() as ThreePlMap
  const setThreePlAssignments = (m: ThreePlMap) => setThreePl({ key: threePlKey, map: m })
  const agencies = useMemo(() => {
    const set = new Set<string>()
    for (const d of registry) { const a = (d.agency ?? '').trim(); if (a && a.toUpperCase() !== 'SPXOWNFLEET') set.add(a) }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [registry])
  const excludedRouteIds = useMemo(() => {
    const s = new Set<string>(overrides.keys())
    const atIdToId = new Map(routes.map(r => [r.atId, r.id]))
    for (const atId of fiorino.assignments.keys()) { const id = atIdToId.get(atId); if (id) s.add(id) }
    return s
  }, [overrides, fiorino.assignments, routes])

  const applyOverrideAssignments = (list: { route: LocalRoute; driver: LocalDriver }[]) => {
    const next = new Map(overrides)
    for (const { route, driver } of list) next.set(route.id, driver)
    setOverrides(next)
  }

  const resolveDriverById = (driverId: string): { driver: LocalDriver; found: boolean } => {
    const av = availableDrivers.find(d => d.driverId === driverId)
    if (av) return { driver: av, found: true }
    const reg = registry.find(d => d.id === driverId)
    const wp = workPref?.drivers.find(d => d.driverId === driverId)
    return {
      driver: {
        driverId, name: reg?.name || wp?.driverName || driverId, vehicleType: reg?.vehicleType || wp?.vehicleType || null, clusters: wp?.clusters ?? [],
        isNewDriver: false, isBlocked: false, blockReason: null, blockType: null, pendingPackages: 0, dsReal: null, dsStatus: null, priorityScore: 0, daysSinceRoute: 9999,
      },
      found: Boolean(reg || wp),
    }
  }

  const handleBatchAssign = async (text: string): Promise<BatchAssignRow[]> => {
    const routeByAt = new Map(routes.map(r => [r.atId.trim().toUpperCase(), r]))
    const rows: BatchAssignRow[] = []
    const updates: { rid: string; driver: LocalDriver }[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const [atId, driverIdRaw] = line.split(/\s+/)
      const driverId = (driverIdRaw ?? '').trim()
      if (!driverId) { rows.push({ atId, driverId: '', status: 'no-driver' }); continue }
      const { driver, found } = resolveDriverById(driverId)
      if (!spxConfigured) { rows.push({ atId, driverId, status: 'fail', driverName: driver.name, foundDriver: found, spxMsg: 'SPX não configurado' }); continue }
      const res = await spxReassign(driverId, atId)
      rows.push({ atId, driverId, status: res.ok ? 'ok' : 'fail', driverName: driver.name, foundDriver: found, spxMsg: res.message })
      const route = routeByAt.get(atId.trim().toUpperCase())
      if (res.ok && route) updates.push({ rid: route.id, driver })
    }
    if (updates.length) {
      setRoutes(routes.map(r => {
        const u = updates.find(x => x.rid === r.id)
        return u ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: u.driver.driverId, assignedDriverName: u.driver.name } : r
      }))
    }
    return rows
  }

  // ── Atribuição principal ──
  const [assignResults, setAssignResults] = useState<AssignResult[] | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

  const selectDriver = (route: LocalRoute, driver: LocalDriver): LocalRoute[] | null => {
    const next = new Map([...overrides, [route.id, driver]])
    const nextEff = computeEffective(routes, availableDrivers, next)
    const displaced = routes.filter(r => r.id !== route.id && r.status === 'DISPONIVEL' && effectiveAssignments.has(r.id) && !nextEff.has(r.id))
    if (displaced.length > 0) return displaced
    setOverrides(next)
    return null
  }
  const forceSelectDriver = (route: LocalRoute, driver: LocalDriver) => setOverrides(new Map([...overrides, [route.id, driver]]))

  const handleConfirmAssign = async () => {
    if (isAssigning || effectiveAssignments.size === 0) return
    setIsAssigning(true)
    setAssignResults(null)
    const results: AssignResult[] = []
    for (const [rid, driver] of effectiveAssignments) {
      const route = routes.find(r => r.id === rid)!
      const res = spxConfigured ? await spxReassign(driver.driverId, route.atId) : null
      results.push({ atId: route.atId, driverId: driver.driverId, local: true, spxOk: res?.ok, spxMsg: res?.message })
    }
    setRoutes(routes.map(r => {
      const d = effectiveAssignments.get(r.id)
      return d ? { ...r, status: 'ATRIBUIDA' as const, assignedDriverId: d.driverId, assignedDriverName: d.name } : r
    }))
    removeFromQueue([...effectiveAssignments.values()].map(d => d.driverId))
    setSessionAssignedOrder(new Map())
    setOverrides(new Map())
    setAssignResults(results)
    setIsAssigning(false)
  }

  const handleRetryFailed = async () => {
    if (!assignResults || isRetrying) return
    setIsRetrying(true)
    const updated = [...assignResults]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].spxOk !== false) continue
      const res = await spxReassign(updated[i].driverId, updated[i].atId)
      updated[i] = { ...updated[i], spxOk: res.ok, spxMsg: res.message }
    }
    setAssignResults(updated)
    setIsRetrying(false)
  }

  const handleReturnRoute = (route: LocalRoute) => {
    setRoutes(routes.map(r => (r.id === route.id ? { ...r, status: 'DISPONIVEL' as const, assignedDriverId: null, assignedDriverName: null } : r)))
    const next = new Map(overrides)
    next.delete(route.id)
    setOverrides(next)
  }

  const addBulkBlocks = (idsText: string, reason: string) => {
    const ids = idsText.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
    const existing = new Map(manualBlocks.map(b => [b.driverId, b]))
    for (const id of ids) existing.set(id, { driverId: id, driverName: availableDrivers.find(d => d.driverId === id)?.name ?? id, reason, blockedAt: new Date().toISOString() })
    setManualBlocks([...existing.values()])
    return ids.length
  }

  const driverCountForRoute = (route: LocalRoute) => {
    const rv = normalizeVehicle(route.requiredVehicleType)
    return availableDrivers.filter(d => coversCluster(d.clusters, route.cluster) && (rv === 'MOTO' || normalizeVehicle(d.vehicleType) !== 'MOTO')).length
  }

  const phonesForAssignments = () => {
    const registryMap = new Map(registry.map(d => [d.id, d]))
    return [...new Set([...effectiveAssignments.values()].map(d => registryMap.get(d.driverId)?.phoneNumber?.replace(/\D/g, '') ?? '').filter(p => p.length >= 8))]
  }

  const relationText = () => [...effectiveAssignments]
    .map(([rid, d]) => { const r = routes.find(x => x.id === rid); return r ? `${d.driverId};${r.atId}` : null })
    .filter(Boolean).join('\n')

  const reportSnapshot = () => {
    const novatos = [...overrides.values()].filter(d => d.isNewDriver).length
    const threepl = threePlAssignments.size
    const manual = overrides.size
    const atrib = routes.filter(r => r.status === 'ATRIBUIDA').length
    return { total: routes.length, auto: Math.max(0, atrib - manual - threepl - novatos), manual, threepl, novatos }
  }

  const loadPastedRoutes = (r: LocalRoute[], date: string, shift: Shift) => {
    routeStore.save(date, shift, r)
    if (date === selectedDay && shift === selectedShift) setOverrides(new Map())
  }

  // Pasted ATs go (back) into reassignment even when not declined in Call Up; the original driver stays on the route so they aren't suggested again.
  const forceRoutes = (toAdd: LocalRoute[], forceAtIds: string[]) => {
    const force = new Set(forceAtIds)
    setRoutes([
      ...routes.map(r => (force.has(r.atId) ? { ...r, status: 'DISPONIVEL' as const } : r)),
      ...toAdd.map(r => ({ ...r, status: 'DISPONIVEL' as const })),
    ])
    localStorage.setItem(`spx:noshow-forced:${selectedDay}:${selectedShift}`, JSON.stringify([...new Set([...forcedAtIds, ...forceAtIds, ...toAdd.map(r => r.atId)])]))
  }

  const clearRoutes = () => { setRoutes([]); setOverrides(new Map()); setAssignResults(null) }

  const stats = {
    recusadas: declinedAtIds.size,
    disponivel: disponivel.length,
    atribuidas: atribuidas.length,
    drivers: queueDrivers.filter(d => !d.isBlocked).length,
    emRota: alreadyRoutedDrivers.length,
    blocked: queueDrivers.filter(d => d.isBlocked).length,
    preview: effectiveAssignments.size,
  }

  return {
    selectedDay, selectedShift, registry, workPref, callUp,
    routes, setRoutes, overrides, ignoredAtIds, setIgnoredAtIds, queue,
    availableDrivers, declinedAtIds, pendingAtIds, alreadyRoutedIds, dobraIds, noShowRoutes, allRoutes, queueDrivers, alreadyRoutedDrivers,
    effectiveAssignments, sessionAssignedOrder, spxConfigured, setSpxConfigured,
    fioMode, setFioMode, fiorino, fioAssigning, fioResults, handleFioAssign,
    threePlAssignments, setThreePlAssignments, agencies, excludedRouteIds, applyOverrideAssignments,
    handleBatchAssign, selectDriver, forceSelectDriver, handleConfirmAssign, handleRetryFailed, handleReturnRoute,
    assignResults, setAssignResults, isAssigning, isRetrying,
    addManualBlock, removeManualBlock, addBulkBlocks,
    driverCountForRoute, phonesForAssignments, relationText, reportSnapshot, loadPastedRoutes, clearRoutes, forceRoutes, stats,
  }
}

export type NoShowState = ReturnType<typeof useNoShow>
