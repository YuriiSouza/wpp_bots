"use client"

import { useCallback, useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  RefreshCw,
  Download,
  Wand2,
  Search,
  MapPin,
  Ban,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Users,
  Route as RouteIcon,
  Building2,
  UserCheck,
  RotateCcw,
  KeyRound,
  ClipboardList,
} from "lucide-react"
import { toast } from "sonner"
import {
  assignRoute,
  fetchNoShowReversionBoard,
  syncNoShowRoutes,
  clearNoShowAvailabilities,
  returnRouteToAvailable,
  fetchAvailabilityEnabled,
  saveAvailabilityEnabled,
  removeBlocklistDriver,
  saveSpxCredentials,
  fetchSpxCredentialsStatus,
  spxReassign,
  bulkAssignRoutes,
  getApiErrorMessage,
  type NoShowReversionBoard,
  type NoShowReversionDriver,
  type NoShowReversionRoute,
} from "@/lib/admin-api"

const INTERIOR_CLUSTERS = new Set([
  "Abadiania - z",
  "Campo Limpo",
  "Gameleira de Goias",
  "Goianapolis",
  "Leopoldo de Bulhões",
  "Neropolis",
  "Nova Veneza",
  "Ouro Verde",
  "Silvania",
  "Terezopolis",
  "Vianópolis - z",
])

function parseDsValue(value?: string | null) {
  if (!value) return null
  const normalized = String(value).replace(",", ".").replace("%", "").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getDsMeta(value?: string | null) {
  const ds = parseDsValue(value)
  if (ds === null) return { valueLabel: "-", className: "border-slate-400/30 bg-slate-500/10 text-slate-500" }
  if (ds < 30) return { valueLabel: `${ds.toFixed(0)}%`, className: "border-red-600/30 bg-red-600/15 text-red-700" }
  if (ds < 70) return { valueLabel: `${ds.toFixed(0)}%`, className: "border-amber-600/30 bg-amber-500/15 text-amber-700" }
  if (ds < 90) return { valueLabel: `${ds.toFixed(0)}%`, className: "border-lime-600/30 bg-lime-500/15 text-lime-700" }
  return { valueLabel: `${ds.toFixed(0)}%`, className: "border-emerald-600/30 bg-emerald-500/15 text-emerald-700" }
}

function normalizeVehicle(v?: string | null): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s.includes("moto")) return "MOTO"
  if (s.includes("fiorino")) return "FIORINO"
  if (s.includes("van")) return "VAN"
  if (s.includes("passeio")) return "PASSEIO"
  return s.toUpperCase()
}

function vehiclePriority(vehicleType: string | null | undefined, routeVehicleType: string | null | undefined): number {
  const v = normalizeVehicle(vehicleType)
  const r = normalizeVehicle(routeVehicleType)
  if (r === "MOTO") {
    // MOTO > PASSEIO > FIORINO > VAN
    if (v === "MOTO") return 0
    if (v === "PASSEIO") return 1
    if (v === "FIORINO") return 2
    return 3 // VAN e outros
  }
  // PASSEIO/outros: VAN > FIORINO > PASSEIO, nunca MOTO
  if (v === "VAN") return 0
  if (v === "FIORINO") return 1
  return 2
}

function getBestCandidate(
  route: NoShowReversionRoute,
  drivers: NoShowReversionDriver[],
  assignedIds: Set<string>,
) {
  const reqVehicle = normalizeVehicle(route.requiredVehicleType)
  return drivers
    .filter((d) => {
      if (d.isBlocked) return false
      if (assignedIds.has(d.driverId)) return false
      if (!d.clusters.includes(route.cluster)) return false
      // Rotas de PASSEIO nunca recebem MOTO
      if (reqVehicle !== "MOTO" && normalizeVehicle(d.vehicleType) === "MOTO") return false
      return true
    })
    .sort((a, b) => {
      const pA = vehiclePriority(a.vehicleType, route.requiredVehicleType)
      const pB = vehiclePriority(b.vehicleType, route.requiredVehicleType)
      if (pA !== pB) return pA - pB
      return b.priorityScore - a.priorityScore
    })[0] ?? null
}

function isAssigned(route: NoShowReversionRoute) {
  return route.status === "ATRIBUIDA" || route.status === "APROVADA"
}

function computeEffective(
  board: NoShowReversionBoard,
  overrides: Map<string, NoShowReversionDriver>,
): Map<string, NoShowReversionDriver> {
  const map = new Map<string, NoShowReversionDriver>()

  const usedIds = new Set<string>()
  for (const [routeId, driver] of overrides) {
    map.set(routeId, driver)
    usedIds.add(driver.driverId)
  }

  // Only process DISPONIVEL routes for auto-suggestions
  const disponivel = board.routes.filter((r) => !isAssigned(r))

  const sorted = [...disponivel].sort((a, b) => {
    const count = (route: NoShowReversionRoute) => {
      const rv = normalizeVehicle(route.requiredVehicleType)
      return board.availabilities.filter((d) => {
        if (d.isBlocked) return false
        if (!d.clusters.includes(route.cluster)) return false
        if (rv !== "MOTO" && normalizeVehicle(d.vehicleType) === "MOTO") return false
        return true
      }).length
    }
    return count(a) - count(b)
  })

  for (const route of sorted) {
    if (map.has(route.id)) continue
    const best = getBestCandidate(route, board.availabilities, usedIds)
    if (best) {
      map.set(route.id, best)
      usedIds.add(best.driverId)
    }
  }

  return map
}

function getRouteStatusMeta(status: string) {
  switch (status) {
    case "ATRIBUIDA": return { label: "Atribuída", rowClass: "bg-emerald-500/5", badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" }
    case "APROVADA": return { label: "Aprovada", rowClass: "bg-violet-500/5", badgeClass: "border-violet-500/30 bg-violet-500/10 text-violet-700" }
    default: return null
  }
}

export default function NoShowReversionPage() {
  const [board, setBoard] = useState<NoShowReversionBoard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncingRoutes, setIsSyncingRoutes] = useState(false)
  const [clearAvailOpen, setClearAvailOpen] = useState(false)
  const [clearAvailInput, setClearAvailInput] = useState("")
  const [isClearingAvail, setIsClearingAvail] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [driverSearch, setDriverSearch] = useState("")
  const [routeSearch, setRouteSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"routes" | "drivers">("routes")
  const [assignModal, setAssignModal] = useState<NoShowReversionRoute | null>(null)
  const [availabilityEnabled, setAvailabilityEnabled] = useState(false)
  const [isTogglingAvail, setIsTogglingAvail] = useState(false)
  const [returningRouteId, setReturningRouteId] = useState<string | null>(null)
  const [unblockingDriverId, setUnblockingDriverId] = useState<string | null>(null)
  const [spxConfigured, setSpxConfigured] = useState(false)
  const [spxModalOpen, setSpxModalOpen] = useState(false)
  const [spxCurlInput, setSpxCurlInput] = useState("")
  const [spxSending, setSpxSending] = useState(false)
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkInput, setBulkInput] = useState("")
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResults, setBulkResults] = useState<{ atId: string; driverId: string; ok: boolean; message: string; status: "pending" | "done"; spxOk?: boolean; spxMessage?: string }[] | null>(null)

  const todayKey = `noshow-overrides-${new Date().toISOString().slice(0, 10)}`

  const [overrides, setOverridesState] = useState<Map<string, NoShowReversionDriver>>(() => {
    try {
      const raw = localStorage.getItem(todayKey)
      if (!raw) return new Map()
      const entries = JSON.parse(raw) as [string, NoShowReversionDriver][]
      return new Map(entries)
    } catch {
      return new Map()
    }
  })

  const setOverrides = (next: Map<string, NoShowReversionDriver>) => {
    setOverridesState(next)
    try {
      localStorage.setItem(todayKey, JSON.stringify([...next.entries()]))
    } catch { /* quota */ }
  }

  const [displacementConfirm, setDisplacementConfirm] = useState<{
    newOverrides: Map<string, NoShowReversionDriver>
    displaced: NoShowReversionRoute[]
    driverName: string
    targetAtId: string
  } | null>(null)

  const loadBoard = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const data = await fetchNoShowReversionBoard()
      setBoard(data)
    } catch (error) {
      if (!silent) toast.error(getApiErrorMessage(error, "Erro ao carregar painel"))
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBoard()
    void fetchAvailabilityEnabled().then(setAvailabilityEnabled).catch(() => {})
    void fetchSpxCredentialsStatus().then((s) => setSpxConfigured(s.configured)).catch(() => {})
  }, [loadBoard])

  useEffect(() => {
    const interval = setInterval(() => { void loadBoard(true) }, 3000)
    return () => clearInterval(interval)
  }, [loadBoard])

  const effectiveAssignments = board
    ? computeEffective(board, overrides)
    : new Map<string, NoShowReversionDriver>()

  const handleSelectDriver = (route: NoShowReversionRoute, driver: NoShowReversionDriver) => {
    if (!board) return

    const newOverrides = new Map([...overrides, [route.id, driver]])
    const newEffective = computeEffective(board, newOverrides)

    const displaced: NoShowReversionRoute[] = []
    for (const r of board.routes) {
      if (r.id === route.id) continue
      if (isAssigned(r)) continue
      if (effectiveAssignments.has(r.id) && !newEffective.has(r.id)) {
        displaced.push(r)
      }
    }

    if (displaced.length > 0) {
      setDisplacementConfirm({
        newOverrides,
        displaced,
        driverName: driver.name || driver.driverId,
        targetAtId: route.atId,
      })
      return
    }

    setOverrides(newOverrides)
    setAssignModal(null)
  }

  const confirmDisplacement = () => {
    if (!displacementConfirm) return
    setOverrides(displacementConfirm.newOverrides)
    setDisplacementConfirm(null)
    setAssignModal(null)
  }

  const parseBulkInput = (text: string) => {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/[\t\s]+/)
        return parts.length >= 2 ? { driverId: parts[0], atId: parts[1] } : null
      })
      .filter(Boolean) as { driverId: string; atId: string }[]
  }

  const handleBulkAssign = async () => {
    const assignments = parseBulkInput(bulkInput)
    if (assignments.length === 0) { toast.error("Nenhuma atribuição válida encontrada."); return }
    setBulkRunning(true)
    // Inicializa a lista com todos os itens em estado "aguardando"
    setBulkResults(assignments.map(({ driverId, atId }) => ({ driverId, atId, ok: false, message: "", status: "pending" as const })))
    try {
      for (let i = 0; i < assignments.length; i++) {
        const { driverId, atId } = assignments[i]
        let localOk = false
        let localMsg = "Rota não encontrada no sistema local"
        let spxOk: boolean | undefined
        let spxMessage: string | undefined

        try {
          const localRes = await bulkAssignRoutes([{ driverId, atId }])
          const r = localRes.results?.[0]
          if (r) { localOk = r.ok; localMsg = r.message }
        } catch { /* segue */ }

        if (spxConfigured) {
          try {
            const res = await spxReassign(driverId, atId)
            spxOk = res?.ok === true
            spxMessage = res?.message
          } catch (e: any) {
            spxOk = false
            spxMessage = e?.message || "Erro SPX"
          }
        }

        const ok = localOk || spxOk === true
        const message = localOk ? "Sistema ✓" : spxOk ? "SPX ✓" : localMsg

        // Atualiza apenas o item atual na lista
        setBulkResults((prev) => {
          if (!prev) return prev
          const next = [...prev]
          next[i] = { driverId, atId, ok, message, status: "done", spxOk, spxMessage }
          return next
        })
      }

      await loadBoard()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro na atribuição em lote"))
    } finally {
      setBulkRunning(false)
    }
  }

  const parseCurl = (curl: string): Record<string, string> => {
    const creds: Record<string, string> = {}
    const cookieMatch = curl.match(/-b\s+'([^']+)'/)
    if (cookieMatch) creds['cookie'] = cookieMatch[1]
    const extract = (pattern: RegExp) => { const m = curl.match(pattern); return m ? m[1].trim() : undefined }
    const csrftoken = extract(/x-csrftoken:\s*([^\s'\\]+)/i)
    if (csrftoken) creds['x-csrftoken'] = csrftoken
    const sapRi = extract(/x-sap-ri:\s*([^\s'\\]+)/i)
    if (sapRi) creds['x-sap-ri'] = sapRi
    const deviceId = extract(/device-id:\s*([^\s'\\]+)/i)
    if (deviceId) creds['device-id'] = deviceId
    // x-sap-sec: value may be long and multiline — grab until next header or end of string
    const sapSecMatch = curl.match(/x-sap-sec:\s*([^']+?)'[\s\\]*(?:-H|--data|$)/i)
    if (sapSecMatch) creds['x-sap-sec'] = sapSecMatch[1].trim()
    return creds
  }

  const handleSaveSpxCreds = async () => {
    const creds = parseCurl(spxCurlInput)
    if (!creds['cookie'] || !creds['x-csrftoken']) {
      toast.error("Não foi possível extrair as credenciais. Verifique o curl copiado.")
      return
    }
    try {
      await saveSpxCredentials(creds)
      setSpxConfigured(true)
      setSpxModalOpen(false)
      setSpxCurlInput("")
      toast.success("Credenciais SPX salvas com sucesso.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao salvar credenciais"))
    }
  }

  const handleAssign = async () => {
    if (isAssigning || effectiveAssignments.size === 0) return
    setIsAssigning(true)
    let ok = 0
    let fail = 0
    let spxOk = 0
    let spxFail = 0
    try {
      for (const [routeId, driver] of effectiveAssignments) {
        const route = board?.routes.find((r) => r.id === routeId)
        try {
          const result = await assignRoute(routeId, driver.driverId)
          if (result.ok) {
            ok++
            if (spxConfigured && route) {
              try {
                const spxResult = await spxReassign(driver.driverId, route.atId)
                if (spxResult.ok) spxOk++
                else { spxFail++; console.warn(`SPX falhou para ${route.atId}:`, spxResult.message) }
              } catch { spxFail++ }
            }
          } else fail++
        } catch { fail++ }
      }

      const mainMsg = ok > 0
        ? `${ok} rota${ok !== 1 ? "s" : ""} atribuída${ok !== 1 ? "s" : ""}${fail > 0 ? `, ${fail} falha${fail !== 1 ? "s" : ""}` : ""}`
        : "Nenhuma rota foi atribuída"

      if (ok > 0) {
        const spxMsg = spxConfigured
          ? ` | SPX: ${spxOk} ok${spxFail > 0 ? `, ${spxFail} falha${spxFail !== 1 ? "s" : ""}` : ""}`
          : ""
        toast.success(mainMsg + spxMsg)
      } else {
        toast.error(mainMsg)
      }

      if (spxConfigured && spxFail > 0) {
        toast.warning(`${spxFail} rota${spxFail !== 1 ? "s" : ""} não foram atribuídas no SPX — verifique as credenciais.`)
      }

      setOverrides(new Map())
      await loadBoard()
    } finally {
      setIsAssigning(false)
    }
  }

  const handleCopyRelation = async () => {
    if (effectiveAssignments.size === 0) { toast.error("Sem atribuições previstas para copiar"); return }
    const lines: string[] = []
    for (const [routeId, driver] of effectiveAssignments) {
      const route = board?.routes.find((r) => r.id === routeId)
      if (route) lines.push(`${driver.driverId};${route.atId}`)
    }
    await navigator.clipboard.writeText(lines.join("\n"))
    toast.success(`${lines.length} atribuição(ões) copiada(s)`)
  }

  const handleToggleAvailability = async (enabled: boolean) => {
    setIsTogglingAvail(true)
    try {
      await saveAvailabilityEnabled(enabled)
      setAvailabilityEnabled(enabled)
      toast.success(enabled ? "Disponibilidade liberada" : "Disponibilidade fechada")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao alterar disponibilidade"))
    } finally {
      setIsTogglingAvail(false)
    }
  }

  const handleReturnRoute = async (route: NoShowReversionRoute) => {
    setReturningRouteId(route.id)
    try {
      const result = await returnRouteToAvailable(route.id)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
      await loadBoard()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao devolver rota"))
    } finally {
      setReturningRouteId(null)
    }
  }

  const disponivel = board?.routes.filter((r) => !isAssigned(r)) ?? []
  const assigned = board?.routes.filter((r) => isAssigned(r)) ?? []

  // Sorted: no assignment first, then with assignment (only DISPONIVEL routes)
  const sortedDisponivel = [...disponivel].sort((a, b) => {
    const aHas = effectiveAssignments.has(a.id) ? 1 : 0
    const bHas = effectiveAssignments.has(b.id) ? 1 : 0
    return aHas - bHas
  })

  const allRoutes = [...sortedDisponivel, ...assigned]

  const filteredRoutes = allRoutes.filter((r) => {
    const q = routeSearch.toLowerCase()
    return !q || r.atId.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q)
  })

  const filteredDrivers = (board?.availabilities ?? []).filter((d) => {
    const q = driverSearch.toLowerCase()
    return !q || d.driverId.toLowerCase().includes(q) || (d.name ?? "").toLowerCase().includes(q)
  })

  const stats = {
    disponivel: disponivel.length,
    atribuidas: assigned.length,
    interiorRoutes: disponivel.filter((r) => r.isInterior).length,
    totalDrivers: board?.availabilities.length ?? 0,
    blockedDrivers: (board?.availabilities ?? []).filter((d) => d.isBlocked).length,
    previewAssigned: effectiveAssignments.size,
  }

  return (
    <>
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Reversão NoShow" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isSyncingRoutes}
          onClick={async () => {
            setIsSyncingRoutes(true)
            try {
              const result = await syncNoShowRoutes()
              if (result.ok) toast.success(result.message)
              else toast.error(result.message)
              await loadBoard()
            } catch (error) {
              toast.error(getApiErrorMessage(error, "Erro ao sincronizar rotas"))
            } finally {
              setIsSyncingRoutes(false)
            }
          }}
        >
          <RefreshCw className={`mr-1.5 h-4 w-4 ${isSyncingRoutes ? "animate-spin" : ""}`} />
          {isSyncingRoutes ? "Sincronizando..." : "Atualizar rotas"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setClearAvailInput(""); setClearAvailOpen(true) }}
        >
          <Ban className="mr-1.5 h-4 w-4" />
          Zerar disponibilidade
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleCopyRelation()}>
          <Download className="mr-1.5 h-4 w-4" />
          Copiar relação prevista
        </Button>
        <Button
          size="sm"
          className="bg-violet-600 hover:bg-violet-700"
          onClick={() => void handleAssign()}
          disabled={isAssigning || effectiveAssignments.size === 0}
        >
          <Wand2 className={`mr-1.5 h-4 w-4 ${isAssigning ? "animate-spin" : ""}`} />
          {isAssigning ? "Atribuindo..." : "Atribuir"}
        </Button>
        <div className="flex items-center gap-2 ml-2">
          <Switch
            id="availability-toggle"
            checked={availabilityEnabled}
            onCheckedChange={handleToggleAvailability}
            disabled={isTogglingAvail}
          />
          <Label htmlFor="availability-toggle" className="text-sm cursor-pointer">
            {availabilityEnabled ? "Disponibilidade aberta" : "Disponibilidade fechada"}
          </Label>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSpxCurlInput(""); setSpxModalOpen(true) }}
          className={spxConfigured ? "border-emerald-500/40 text-emerald-700" : "border-amber-500/40 text-amber-700"}
        >
          <KeyRound className="mr-1.5 h-4 w-4" />
          {spxConfigured ? "SPX configurado" : "Configurar SPX"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setBulkInput(""); setBulkResults(null); setBulkModalOpen(true) }}
        >
          <ClipboardList className="mr-1.5 h-4 w-4" />
          Atribuição em lote
        </Button>
        {board && (
          <span className="ml-auto text-xs text-muted-foreground">
            Disponibilidades de: {board.date}
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <RouteIcon className="h-4 w-4 text-sky-500" />
            <span className="text-xs text-muted-foreground">Disponíveis</span>
          </div>
          <p className="text-2xl font-bold">{stats.disponivel}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Atribuídas</span>
          </div>
          <p className="text-2xl font-bold">{stats.atribuidas}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Interior</span>
          </div>
          <p className="text-2xl font-bold">{stats.interiorRoutes}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Motoristas</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalDrivers}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Ban className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Bloqueados</span>
          </div>
          <p className="text-2xl font-bold">{stats.blockedDrivers}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wand2 className="h-4 w-4 text-violet-500" />
            <span className="text-xs text-muted-foreground">Previsão</span>
          </div>
          <p className="text-2xl font-bold">{stats.previewAssigned}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("routes")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "routes" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Rotas ({stats.disponivel + stats.atribuidas})
        </button>
        <button
          onClick={() => setActiveTab("drivers")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "drivers" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Motoristas disponíveis ({stats.totalDrivers})
        </button>
      </div>

      {/* Routes tab */}
      {activeTab === "routes" && (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar rota ou cluster..."
              value={routeSearch}
              onChange={(e) => setRouteSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="rounded-xl border bg-card overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/60">
                  <TableHead className="text-xs font-semibold w-[50px]">#</TableHead>
                  <TableHead className="text-xs font-semibold w-[120px]">AT</TableHead>
                  <TableHead className="text-xs font-semibold">Cluster</TableHead>
                  <TableHead className="text-xs font-semibold w-[100px]">Veículo</TableHead>
                  <TableHead className="text-xs font-semibold w-[80px]">Gaiola</TableHead>
                  <TableHead className="text-xs font-semibold w-[70px] text-center">Drivers</TableHead>
                  <TableHead className="text-xs font-semibold">Motorista</TableHead>
                  <TableHead className="text-xs font-semibold w-[90px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : filteredRoutes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Nenhuma rota disponível.</TableCell>
                  </TableRow>
                ) : filteredRoutes.map((route, idx) => {
                  const statusMeta = getRouteStatusMeta(route.status)

                  if (statusMeta) {
                    // ATRIBUIDA / APROVADA row
                    return (
                      <TableRow key={route.id} className={statusMeta.rowClass}>
                        <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                        <TableCell className="py-2.5 font-mono text-xs font-semibold">{route.atId}</TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            {route.isInterior && <MapPin className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            <span className="text-sm">{route.cluster}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          {route.requiredVehicleType
                            ? <Badge variant="outline" className="text-xs">{route.requiredVehicleType}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">{route.gaiola || "—"}</TableCell>
                        <TableCell className="py-2.5 text-center text-xs text-muted-foreground">—</TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-sm font-medium">{route.driverName || route.driverId || "—"}</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`text-xs ${statusMeta.badgeClass}`}>
                              {statusMeta.label}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600"
                              disabled={returningRouteId === route.id}
                              onClick={() => void handleReturnRoute(route)}
                            >
                              <RotateCcw className={`h-3 w-3 mr-1 ${returningRouteId === route.id ? "animate-spin" : ""}`} />
                              Devolver
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  // DISPONIVEL row
                  const effective = effectiveAssignments.get(route.id)
                  const isOverridden = overrides.has(route.id)
                  const dsMeta = getDsMeta(effective?.ds)
                  const reqV = normalizeVehicle(route.requiredVehicleType)
                  const driverCount = (board?.availabilities ?? []).filter((d) => {
                    if (d.isBlocked) return false
                    if (!d.clusters.includes(route.cluster)) return false
                    if (reqV !== "MOTO" && normalizeVehicle(d.vehicleType) === "MOTO") return false
                    return true
                  }).length

                  return (
                    <TableRow
                      key={route.id}
                      className={`cursor-pointer hover:bg-muted/40 transition-colors ${!effective ? "bg-red-500/5" : route.isInterior ? "bg-amber-500/5" : ""}`}
                      onClick={() => setAssignModal(route)}
                    >
                      <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="py-2.5 font-mono text-xs font-semibold">{route.atId}</TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2">
                          {route.isInterior && <MapPin className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                          <span className="text-sm">{route.cluster}</span>
                          {route.isInterior && <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 bg-amber-500/10">Interior</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {route.requiredVehicleType
                          ? <Badge variant="outline" className="text-xs">{route.requiredVehicleType}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5 text-sm text-muted-foreground">{route.gaiola || "—"}</TableCell>
                      <TableCell className="py-2.5 text-center">
                        <span className={`text-sm font-semibold ${driverCount === 0 ? "text-red-600" : driverCount === 1 ? "text-amber-600" : "text-emerald-600"}`}>
                          {driverCount}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {effective ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{effective.name || effective.driverId}</span>
                            {effective.vehicleType && (
                              <Badge variant="outline" className={`text-xs ${normalizeVehicle(effective.vehicleType) === "MOTO" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" : ""}`}>
                                {effective.vehicleType}
                              </Badge>
                            )}
                            {reqV === "MOTO" && normalizeVehicle(effective.vehicleType) !== "MOTO" && (
                              <Badge variant="outline" className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-700 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Não é moto
                              </Badge>
                            )}
                            {(effective.totalRoutesAccepted === 0) && (
                              <Badge variant="outline" className="text-[10px] border-violet-500/30 bg-violet-500/10 text-violet-700">
                                Novato
                              </Badge>
                            )}
                            <Badge variant="outline" className={`text-xs ${dsMeta.className}`}>DS {dsMeta.valueLabel}</Badge>
                            <Badge variant="outline" className="text-xs">Score {effective.priorityScore.toFixed(0)}</Badge>
                            {isOverridden && (
                              <Badge variant="outline" className="text-[10px] border-sky-500/30 bg-sky-500/10 text-sky-700">Editado</Badge>
                            )}
                            {(effective.noShowCount ?? 0) > 0 && (
                              <Badge variant="outline" className="text-xs border-red-500/30 bg-red-500/10 text-red-700">
                                {effective.noShowCount} no-show{effective.noShowCount !== 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            Sem motorista disponível
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className="text-xs border-sky-500/30 bg-sky-500/10 text-sky-700">
                          Disponível
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Drivers tab */}
      {activeTab === "drivers" && (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar motorista..."
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="rounded-xl border bg-card overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/60">
                  <TableHead className="text-xs font-semibold">Motorista</TableHead>
                  <TableHead className="text-xs font-semibold w-[100px]">Veículo</TableHead>
                  <TableHead className="text-xs font-semibold w-[80px]">DS</TableHead>
                  <TableHead className="text-xs font-semibold w-[90px]">Score</TableHead>
                  <TableHead className="text-xs font-semibold w-[90px]">No-Shows</TableHead>
                  <TableHead className="text-xs font-semibold">Clusters selecionados</TableHead>
                  <TableHead className="text-xs font-semibold w-[80px]">Horário</TableHead>
                  <TableHead className="text-xs font-semibold w-[110px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : filteredDrivers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum motorista registrou disponibilidade hoje.
                    </TableCell>
                  </TableRow>
                ) : filteredDrivers.map((driver) => {
                  const dsMeta = getDsMeta(driver.ds)
                  const assignedEntry = [...effectiveAssignments.entries()].find(([, d]) => d.driverId === driver.driverId)
                  const assignedAtId = assignedEntry
                    ? board?.routes.find((r) => r.id === assignedEntry[0])?.atId
                    : null

                  const clusterDriverCount = (cluster: string) =>
                    (board?.availabilities ?? []).filter((d) => !d.isBlocked && d.clusters.includes(cluster)).length

                  const sortedClusters = [...driver.clusters].sort(
                    (a, b) => clusterDriverCount(a) - clusterDriverCount(b)
                  )
                  return (
                    <TableRow key={driver.driverId} className={driver.isBlocked ? "bg-red-500/5" : ""}>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium">{driver.name || driver.driverId}</p>
                          {driver.totalRoutesAccepted === 0 && (
                            <Badge variant="outline" className="text-[10px] border-violet-500/30 bg-violet-500/10 text-violet-700">Novato</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{driver.driverId}</p>
                        <p className="text-xs text-muted-foreground">
                          {driver.lastRouteDate
                            ? (() => {
                                const days = Math.floor((Date.now() - new Date(driver.lastRouteDate).getTime()) / 86400000)
                                if (days === 0) return "Rodou hoje"
                                if (days === 1) return "1 dia sem rota"
                                return `${days} dias sem rota`
                              })()
                            : "Nunca rodou"}
                        </p>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {driver.vehicleType
                          ? <Badge variant="outline" className="text-xs">{driver.vehicleType}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className={`text-xs ${dsMeta.className}`}>{dsMeta.valueLabel}</Badge>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm">{driver.priorityScore.toFixed(0)}</TableCell>
                      <TableCell className="py-2.5">
                        {(driver.noShowCount ?? 0) > 0
                          ? <Badge variant="outline" className="text-xs border-red-500/30 bg-red-500/10 text-red-700">{driver.noShowCount}</Badge>
                          : <span className="text-muted-foreground text-xs">0</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {sortedClusters.map((c) => {
                            const count = clusterDriverCount(c)
                            const scarcityClass = count <= 1 ? "border-red-500/40 bg-red-500/10 text-red-700" : count === 2 ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : INTERIOR_CLUSTERS.has(c) ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : ""
                            return (
                            <Badge
                              key={c}
                              variant="outline"
                              className={`text-xs ${scarcityClass}`}
                            >
                              {c}
                              <span className="ml-1 opacity-60">({count})</span>
                            </Badge>
                            )
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground font-mono tabular-nums">
                        {driver.registeredAt
                          ? new Date(driver.registeredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {driver.isBlocked ? (
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className="text-xs border-red-500/40 bg-red-500/10 text-red-700 w-fit">
                              <Ban className="mr-1 h-3 w-3" />
                              Bloqueado
                            </Badge>
                            {driver.blockReason && (
                              <span className="text-xs text-red-600/80">{driver.blockReason}</span>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs w-fit border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10"
                              disabled={unblockingDriverId === driver.driverId}
                              onClick={async () => {
                                setUnblockingDriverId(driver.driverId)
                                try {
                                  const result = await removeBlocklistDriver(driver.driverId)
                                  if (result.ok) {
                                    toast.success("Motorista desbloqueado")
                                    await loadBoard()
                                  } else {
                                    toast.error(result.message)
                                  }
                                } catch (error) {
                                  toast.error(getApiErrorMessage(error, "Erro ao desbloquear"))
                                } finally {
                                  setUnblockingDriverId(null)
                                }
                              }}
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              {unblockingDriverId === driver.driverId ? "Desbloqueando..." : "Desbloquear"}
                            </Button>
                          </div>
                        ) : assignedAtId ? (
                          <Badge variant="outline" className="text-xs border-violet-500/30 bg-violet-500/10 text-violet-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {assignedAtId}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Disponível
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

    </div>

    {/* Select driver modal */}
    <Dialog open={!!assignModal} onOpenChange={(open) => { if (!open) setAssignModal(null) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            Selecionar motorista — {assignModal?.atId}
          </DialogTitle>
        </DialogHeader>
        {assignModal && (() => {
          const currentDriver = effectiveAssignments.get(assignModal.id)
          const modalReqV = normalizeVehicle(assignModal.requiredVehicleType)
          const candidates = (board?.availabilities ?? [])
            .filter((d) => {
              if (d.isBlocked) return false
              if (!d.clusters.includes(assignModal.cluster)) return false
              if (modalReqV !== "MOTO" && normalizeVehicle(d.vehicleType) === "MOTO") return false
              return true
            })
            .sort((a, b) => {
              const pA = vehiclePriority(a.vehicleType, assignModal.requiredVehicleType)
              const pB = vehiclePriority(b.vehicleType, assignModal.requiredVehicleType)
              if (pA !== pB) return pA - pB
              return b.priorityScore - a.priorityScore
            })

          return (
            <div className="space-y-3 mt-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{assignModal.cluster}</span>
                {assignModal.isInterior && <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 bg-amber-500/10">Interior</Badge>}
                {assignModal.requiredVehicleType && <Badge variant="outline" className="text-xs">{assignModal.requiredVehicleType}</Badge>}
              </div>

              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum motorista disponível para este cluster.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {candidates.map((driver) => {
                    const dsMeta = getDsMeta(driver.ds)
                    const isSelected = currentDriver?.driverId === driver.driverId
                    return (
                      <div
                        key={driver.driverId}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${isSelected ? "border-violet-500/40 bg-violet-500/5" : "border-border/50 hover:bg-muted/30"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{driver.name || driver.driverId}</span>
                            {isSelected && <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-600">Selecionado</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{driver.driverId}</p>
                          <div className="flex gap-1.5 mt-1 flex-wrap">
                            {driver.vehicleType && <Badge variant="outline" className="text-xs">{driver.vehicleType}</Badge>}
                            <Badge variant="outline" className={`text-xs ${dsMeta.className}`}>DS {dsMeta.valueLabel}</Badge>
                            <Badge variant="outline" className="text-xs">Score {driver.priorityScore.toFixed(0)}</Badge>
                            {(driver.noShowCount ?? 0) > 0 && (
                              <Badge variant="outline" className="text-xs border-red-500/30 bg-red-500/10 text-red-700">
                                {driver.noShowCount} no-show{driver.noShowCount !== 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {[...driver.clusters]
                              .sort((a, b) => {
                                const ca = (board?.availabilities ?? []).filter((d) => !d.isBlocked && d.clusters.includes(a)).length
                                const cb = (board?.availabilities ?? []).filter((d) => !d.isBlocked && d.clusters.includes(b)).length
                                return ca - cb
                              })
                              .map((c) => {
                                const count = (board?.availabilities ?? []).filter((d) => !d.isBlocked && d.clusters.includes(c)).length
                                const scarcityClass = count <= 1 ? "border-red-500/40 bg-red-500/10 text-red-700" : count === 2 ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : ""
                                return (
                                  <Badge key={c} variant="outline" className={`text-[10px] ${scarcityClass}`}>
                                    {c}<span className="ml-1 opacity-60">({count})</span>
                                  </Badge>
                                )
                              })}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={isSelected ? "outline" : "default"}
                          className="h-8 px-3 shrink-0"
                          onClick={() => handleSelectDriver(assignModal, driver)}
                        >
                          {isSelected ? "Selecionado" : "Selecionar"}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </DialogContent>
    </Dialog>

    {/* Clear availabilities dialog */}
    <Dialog open={clearAvailOpen} onOpenChange={(open) => { if (!open) setClearAvailOpen(false) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Zerar disponibilidades?</DialogTitle>
          <DialogDescription>
            Todas as disponibilidades do dia serão apagadas. Para confirmar, digite exatamente:
            <br />
            <strong className="text-foreground">apagar disponibilidades</strong>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={clearAvailInput}
          onChange={(e) => setClearAvailInput(e.target.value)}
          placeholder="apagar disponibilidades"
          onKeyDown={(e) => {
            if (e.key === "Enter" && clearAvailInput === "apagar disponibilidades") {
              void (async () => {
                setIsClearingAvail(true)
                try {
                  const result = await clearNoShowAvailabilities()
                  toast.success(result.message)
                  setOverrides(new Map())
                  await loadBoard()
                } catch (error) {
                  toast.error(getApiErrorMessage(error, "Erro ao zerar disponibilidades"))
                } finally {
                  setIsClearingAvail(false)
                  setClearAvailOpen(false)
                }
              })()
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setClearAvailOpen(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={clearAvailInput !== "apagar disponibilidades" || isClearingAvail}
            onClick={async () => {
              setIsClearingAvail(true)
              try {
                const result = await clearNoShowAvailabilities()
                toast.success(result.message)
                setOverrides(new Map())
                await loadBoard()
              } catch (error) {
                toast.error(getApiErrorMessage(error, "Erro ao zerar disponibilidades"))
              } finally {
                setIsClearingAvail(false)
                setClearAvailOpen(false)
              }
            }}
          >
            {isClearingAvail ? "Apagando..." : "Apagar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* SPX credentials modal */}
    <Dialog open={spxModalOpen} onOpenChange={(open) => { if (!open) setSpxModalOpen(false) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Credenciais SPX
          </DialogTitle>
          <DialogDescription>
            Cole o curl copiado do navegador (F12 → Network → botão direito na requisição → "Copy as cURL"). O sistema extrai automaticamente os cookies e headers de autenticação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            className="w-full h-48 rounded-lg border bg-muted/30 p-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Cole o curl aqui..."
            value={spxCurlInput}
            onChange={(e) => setSpxCurlInput(e.target.value)}
          />
          {spxCurlInput && (() => {
            const preview = parseCurl(spxCurlInput)
            const hasAll = preview['cookie'] && preview['x-csrftoken'] && preview['x-sap-ri'] && preview['x-sap-sec']
            return (
              <div className={`rounded-lg border p-3 text-xs space-y-1 ${hasAll ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                <p className="font-semibold mb-2">{hasAll ? "✓ Credenciais identificadas" : "⚠ Algumas credenciais não encontradas"}</p>
                <p><span className="text-muted-foreground">cookie:</span> {preview['cookie'] ? `${preview['cookie'].slice(0, 40)}…` : "não encontrado"}</p>
                <p><span className="text-muted-foreground">x-csrftoken:</span> {preview['x-csrftoken'] ?? "não encontrado"}</p>
                <p><span className="text-muted-foreground">device-id:</span> {preview['device-id'] ?? "não encontrado"}</p>
                <p><span className="text-muted-foreground">x-sap-ri:</span> {preview['x-sap-ri'] ?? "não encontrado"}</p>
                <p><span className="text-muted-foreground">x-sap-sec:</span> {preview['x-sap-sec'] ? `${preview['x-sap-sec'].slice(0, 30)}…` : "não encontrado"}</p>
              </div>
            )
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSpxModalOpen(false)}>Cancelar</Button>
          <Button
            disabled={!spxCurlInput.trim() || spxSending}
            onClick={async () => { setSpxSending(true); try { await handleSaveSpxCreds() } finally { setSpxSending(false) } }}
          >
            {spxSending ? "Salvando..." : "Salvar credenciais"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Displacement confirmation dialog */}
    {/* Bulk assign modal */}
    <Dialog open={bulkModalOpen} onOpenChange={(open) => { if (!open && !bulkRunning) { setBulkModalOpen(false); setBulkResults(null); setBulkInput("") } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Atribuição em lote
          </DialogTitle>
          <DialogDescription>
            Cole os pares abaixo, um por linha — separados por TAB ou espaço.<br />
            Formato: <code className="text-xs bg-muted px-1 rounded">driverId{"\t"}AtId</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Fase de input — some quando está rodando ou já tem resultados */}
          {!bulkResults && (
            <>
              <textarea
                className="w-full min-h-[180px] rounded-md border bg-muted/30 p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder={"464975\tAT2026090196YQX\n2435937\tAT2026090196Z5N"}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                autoFocus
              />
              {bulkInput.trim() && (() => {
                const parsed = parseBulkInput(bulkInput)
                return parsed.length > 0
                  ? <p className="text-xs text-muted-foreground">{parsed.length} par{parsed.length !== 1 ? "es" : ""} reconhecido{parsed.length !== 1 ? "s" : ""}</p>
                  : <p className="text-xs text-red-500">Nenhum par válido. Use TAB ou espaço entre os dois valores.</p>
              })()}
            </>
          )}

          {/* Lista de resultados — aparece assim que começa a processar */}
          {bulkResults && (
            <div className="rounded-lg border divide-y overflow-hidden max-h-[360px] overflow-y-auto">
              {bulkResults.map((r, i) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${
                  r.status === "pending" ? "bg-muted/20" :
                  r.ok ? "bg-emerald-500/8" : "bg-red-500/8"
                }`}>
                  {/* Ícone de status */}
                  <div className="flex-shrink-0 w-5 flex items-center justify-center">
                    {r.status === "pending"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      : r.ok
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <XCircle className="h-4 w-4 text-red-500" />
                    }
                  </div>

                  {/* Dados */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-muted-foreground">{r.driverId}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold text-foreground">{r.atId}</span>
                    </div>
                    {r.status === "done" && (
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-[11px] ${r.ok ? "text-emerald-700" : "text-red-600"}`}>{r.message}</span>
                        {r.spxOk !== undefined && (
                          <span className={`text-[11px] ${r.spxOk ? "text-emerald-600" : "text-amber-600"}`}>
                            · SPX {r.spxOk ? "✓" : `✗${r.spxMessage ? ` — ${r.spxMessage}` : ""}`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resumo após concluir */}
          {bulkResults && !bulkRunning && (() => {
            const done = bulkResults.filter((r) => r.status === "done")
            const ok = done.filter((r) => r.ok).length
            const fail = done.length - ok
            return (
              <p className="text-xs text-muted-foreground text-right">
                {ok > 0 && <span className="text-emerald-600">{ok} ok</span>}
                {ok > 0 && fail > 0 && " · "}
                {fail > 0 && <span className="text-red-500">{fail} falha{fail !== 1 ? "s" : ""}</span>}
              </p>
            )
          })()}
        </div>

        <DialogFooter>
          {bulkResults
            ? <Button variant="outline" onClick={() => { setBulkResults(null); setBulkInput("") }} disabled={bulkRunning}>
                Novo lote
              </Button>
            : <Button variant="outline" onClick={() => setBulkModalOpen(false)}>Cancelar</Button>
          }
          <Button
            disabled={bulkRunning || (!bulkResults && (parseBulkInput(bulkInput).length === 0))}
            onClick={() => void handleBulkAssign()}
          >
            {bulkRunning
              ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Atribuindo...</>
              : bulkResults ? "Repetir" : `Atribuir (${parseBulkInput(bulkInput).length})`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!displacementConfirm} onOpenChange={(open) => { if (!open) setDisplacementConfirm(null) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Rota ficará sem motorista
          </DialogTitle>
          <DialogDescription>
            Ao selecionar <strong>{displacementConfirm?.driverName}</strong> para a rota <strong>{displacementConfirm?.targetAtId}</strong>, a{displacementConfirm && displacementConfirm.displaced.length > 1 ? "s" : ""} rota{displacementConfirm && displacementConfirm.displaced.length > 1 ? "s" : ""} abaixo ficará{displacementConfirm && displacementConfirm.displaced.length > 1 ? "o" : ""} sem motorista disponível:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 my-1">
          {displacementConfirm?.displaced.map((r) => (
            <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">{r.atId}</span>
                {r.isInterior && <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 bg-amber-500/10">Interior</Badge>}
                {r.requiredVehicleType && <Badge variant="outline" className="text-xs">{r.requiredVehicleType}</Badge>}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span>{r.cluster}</span>
                {r.gaiola && <span>· Gaiola {r.gaiola}</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDisplacementConfirm(null)}>Cancelar</Button>
          <Button variant="destructive" onClick={confirmDisplacement}>Confirmar mesmo assim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
