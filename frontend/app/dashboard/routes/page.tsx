"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Search,
  Download,
  UserPlus,
  RefreshCw,
  ChevronDown,
  Route as RouteIcon,
  CheckCircle2,
  Clock,
  Bot,
  Ban,
  AlertTriangle,
  X,
  Package,
  User,
  Truck,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  approveRouteRequest as approveRouteRequestApi,
  approveBlockedQueueRequest as approveBlockedQueueRequestApi,
  assignRoute as assignRouteRequest,
  fetchDrivers,
  fetchRouteRequestsBoard,
  fetchRoutes,
  fetchBotEnabled,
  saveBotEnabled,
  getApiErrorMessage,
  runSync,
  markRouteNoShow,
  rejectRouteRequest as rejectRouteRequestApi,
  rejectBlockedQueueRequest as rejectBlockedQueueRequestApi,
  releaseRouteToBot as releaseRouteToBotRequest,
  releaseRoutesToBotByAt as releaseRoutesToBotByAtRequest,
} from "@/lib/admin-api"
import { getCurrentRouteWindow } from "@/lib/route-window"
import type { BlockedQueueRequest, Driver, PendingRouteRequest, Route } from "@/lib/types"
import { toast } from "sonner"

const ROUTES_FILTERS_STORAGE_KEY = "routes-page-filters"
type RouteStatusFilter = Route["status"] | "SOLICITADA" | "NO_BOT"

function normalizeStoredFilter(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      )
    )
  }
  const single = String(value || "").trim()
  if (!single || single === "all") return []
  return [single]
}

function toggleFilterValue<T extends string>(current: T[], value: T) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

function buildFilterLabel(label: string, selected: string[]) {
  if (!selected.length) return label
  if (selected.length === 1) return selected[0]
  return `${label} (${selected.length})`
}

function normalizeVehicleType(value?: string | null) {
  const raw = String(value || "").trim().toLowerCase()
  if (!raw) return null
  if (raw.includes("moto")) return "MOTO"
  if (raw.includes("fiorino")) return "FIORINO"
  if (raw.includes("passeio")) return "PASSEIO"
  return raw.toUpperCase()
}

function formatRequestTimestamp(value?: string | null) {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getBlockedQueueStatusMeta(status?: string, cooldownUntil?: string | null) {
  if (status === "REJECTED") {
    return {
      label: cooldownUntil ? `Cooldown ate ${formatRequestTimestamp(cooldownUntil)}` : "Reprovada",
      className: "border-red-500/30 bg-red-500/10 text-red-700",
    }
  }
  return { label: "Pendente", className: "border-amber-500/30 bg-amber-500/10 text-amber-700" }
}

function getBusinessBlockReasonLabel(reason?: string | null) {
  const normalized = String(reason || "").trim().toLowerCase()
  if (normalized.includes("novato") || normalized.includes("sem ds")) return "Acompanhamento das primeiras rotas"
  if (!normalized) return "Nao informado"
  return "Acompanhamento de performance"
}

function parseDsValue(value?: string | null) {
  if (!value) return null
  const normalized = String(value).replace(",", ".").replace("%", "").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getDsMeta(value?: string | null) {
  const ds = parseDsValue(value)
  if (ds === null) return { label: "DS sem dado", valueLabel: "-", className: "border-slate-400/30 bg-slate-500/10 text-slate-700" }
  if (ds < 10) return { label: "Ultra critico", valueLabel: `${ds.toFixed(0)}%`, className: "border-rose-700/30 bg-rose-700/15 text-rose-800" }
  if (ds < 30) return { label: "Critico", valueLabel: `${ds.toFixed(0)}%`, className: "border-red-600/30 bg-red-600/15 text-red-700" }
  if (ds < 50) return { label: "Muito ruim", valueLabel: `${ds.toFixed(0)}%`, className: "border-orange-600/30 bg-orange-600/15 text-orange-700" }
  if (ds < 70) return { label: "Ruim", valueLabel: `${ds.toFixed(0)}%`, className: "border-amber-600/30 bg-amber-500/15 text-amber-700" }
  if (ds < 80) return { label: "Mediano", valueLabel: `${ds.toFixed(0)}%`, className: "border-yellow-600/30 bg-yellow-500/15 text-yellow-700" }
  if (ds < 90) return { label: "Bom", valueLabel: `${ds.toFixed(0)}%`, className: "border-lime-600/30 bg-lime-500/15 text-lime-700" }
  if (ds < 98) return { label: "Muito bom", valueLabel: `${ds.toFixed(0)}%`, className: "border-emerald-600/30 bg-emerald-500/15 text-emerald-700" }
  return { label: "Excelente", valueLabel: `${ds.toFixed(0)}%`, className: "border-teal-600/30 bg-teal-500/15 text-teal-700" }
}

type StatusMeta = { label: string; badgeClass: string; rowAccent: string; dotColor: string }

function getStatusMeta(route: Route, isTelegramReq: boolean): StatusMeta {
  if (route.noShow) return {
    label: "No-Show",
    badgeClass: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-400",
    rowAccent: "border-l-4 border-l-red-500 bg-red-500/5",
    dotColor: "bg-red-500",
  }
  if (isTelegramReq) return {
    label: "Solicitada",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
    rowAccent: "border-l-4 border-l-amber-400 bg-amber-500/5",
    dotColor: "bg-amber-400",
  }
  switch (route.status) {
    case "DISPONIVEL": return { label: "Disponivel", badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-400", rowAccent: "", dotColor: "bg-sky-400" }
    case "APROVADA": return { label: "Aprovada", badgeClass: "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-400", rowAccent: "border-l-4 border-l-violet-400 bg-violet-500/5", dotColor: "bg-violet-500" }
    case "ATRIBUIDA": return { label: "Atribuida", badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", rowAccent: "border-l-4 border-l-emerald-500 bg-emerald-500/5", dotColor: "bg-emerald-500" }
    case "BLOQUEADA": return { label: "Bloqueada", badgeClass: "border-slate-400/40 bg-slate-400/15 text-slate-600 dark:text-slate-400", rowAccent: "border-l-4 border-l-slate-400 bg-slate-400/5", dotColor: "bg-slate-400" }
    case "EXPORTADA": return { label: "Exportada", badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-400", rowAccent: "", dotColor: "bg-indigo-400" }
    default: return { label: route.status, badgeClass: "border-muted-foreground/30 bg-muted/30 text-muted-foreground", rowAccent: "", dotColor: "bg-muted-foreground" }
  }
}

function getInitialRouteFilters() {
  if (typeof window === "undefined") {
    return { search: "", statusFilter: [] as RouteStatusFilter[], cityFilter: [] as string[], vehicleFilter: [] as string[] }
  }
  try {
    const raw = window.localStorage.getItem(ROUTES_FILTERS_STORAGE_KEY)
    if (!raw) return { search: "", statusFilter: [] as RouteStatusFilter[], cityFilter: [] as string[], vehicleFilter: [] as string[] }
    const parsed = JSON.parse(raw) as Partial<{ search: string; statusFilter: string | string[]; cityFilter: string | string[]; vehicleFilter: string | string[] }>
    return {
      search: parsed.search || "",
      statusFilter: normalizeStoredFilter(parsed.statusFilter) as RouteStatusFilter[],
      cityFilter: normalizeStoredFilter(parsed.cityFilter),
      vehicleFilter: normalizeStoredFilter(parsed.vehicleFilter),
    }
  } catch {
    return { search: "", statusFilter: [] as RouteStatusFilter[], cityFilter: [] as string[], vehicleFilter: [] as string[] }
  }
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className="text-sm font-medium text-card-foreground">{value || "-"}</p>
    </div>
  )
}

export default function RoutesPage() {
  const initialFilters = getInitialRouteFilters()
  const [search, setSearch] = useState(initialFilters.search)
  const [statusFilter, setStatusFilter] = useState<RouteStatusFilter[]>(initialFilters.statusFilter)
  const [cityFilter, setCityFilter] = useState<string[]>(initialFilters.cityFilter)
  const [vehicleFilter, setVehicleFilter] = useState<string[]>(initialFilters.vehicleFilter)
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [routeRequests, setRouteRequests] = useState<PendingRouteRequest[]>([])
  const [blockedQueueRequests, setBlockedQueueRequests] = useState<BlockedQueueRequest[]>([])
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
  const [assignRoute, setAssignRoute] = useState<Route | null>(null)
  const [selectedDriver, setSelectedDriver] = useState("")
  const [assignDriverSearch, setAssignDriverSearch] = useState("")
  const [bulkReleaseOpen, setBulkReleaseOpen] = useState(false)
  const [bulkAtInput, setBulkAtInput] = useState("")
  const [isBulkReleasing, setIsBulkReleasing] = useState(false)
  const [releasingRouteId, setReleasingRouteId] = useState<string | null>(null)
  const [approvingBlockedDriverId, setApprovingBlockedDriverId] = useState<string | null>(null)
  const [rejectingBlockedDriverId, setRejectingBlockedDriverId] = useState<string | null>(null)
  const [approvingRouteRequestId, setApprovingRouteRequestId] = useState<string | null>(null)
  const [rejectingRouteRequestId, setRejectingRouteRequestId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [botEnabled, setBotEnabledState] = useState(true)
  const [isTogglingBot, setIsTogglingBot] = useState(false)
  const [isRefreshingRoutes, setIsRefreshingRoutes] = useState(false)

  const isTelegramRequested = (route: Route) =>
    route.assignmentSource === "TELEGRAM_BOT" && !!route.requestedDriverId && !route.driverId
  const isReleasedToBot = (route: Route) =>
    Boolean(route.botAvailable) || isTelegramRequested(route)
  const isTelegramApproved = (route: Route) =>
    route.assignmentSource === "TELEGRAM_BOT" && !!route.requestedDriverId && !!route.driverId && route.status === "APROVADA"

  const loadData = async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const [routeData, driverData, requestBoard] = await Promise.all([
        fetchRoutes(),
        fetchDrivers({ pageSize: 10000 }),
        fetchRouteRequestsBoard(),
      ])
      setRoutes(routeData)
      setDrivers(driverData)
      setRouteRequests(requestBoard.routeRequests)
      setBlockedQueueRequests(requestBoard.blockedQueueRequests)
      setSelectedRoute((current) =>
        current ? routeData.find((route) => route.id === current.id) || null : null
      )
    } catch (error) {
      if (!silent) toast.error(getApiErrorMessage(error, "Nao foi possivel carregar as rotas"))
    } finally {
      if (!silent) setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    void fetchBotEnabled().then(setBotEnabledState).catch(() => undefined)
    const interval = window.setInterval(() => void loadData(true), 5000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(ROUTES_FILTERS_STORAGE_KEY, JSON.stringify({ search, statusFilter, cityFilter, vehicleFilter }))
  }, [search, statusFilter, cityFilter, vehicleFilter])

  const cities = useMemo(() => [...new Set(routes.map((r) => r.cidade).filter(Boolean))], [routes])
  const vehicles = useMemo(() => [...new Set(routes.map((r) => r.requiredVehicleType).filter(Boolean))], [routes])

  const filtered = useMemo(() => {
    let result = [...routes]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.atId?.toLowerCase().includes(q) ||
          r.gaiola?.toLowerCase().includes(q) ||
          r.bairro?.toLowerCase().includes(q) ||
          r.driverName?.toLowerCase().includes(q) ||
          r.requestedDriverName?.toLowerCase().includes(q)
      )
    }
    if (statusFilter.length) {
      result = result.filter((r) =>
        statusFilter.some((status) => {
          if (status === "NO_BOT") return isReleasedToBot(r)
          if (status === "SOLICITADA") return isTelegramRequested(r)
          if (status === "DISPONIVEL") return r.status === "DISPONIVEL" && !isTelegramRequested(r)
          return r.status === status
        })
      )
    }
    if (cityFilter.length) result = result.filter((r) => cityFilter.includes(r.cidade || ""))
    if (vehicleFilter.length) result = result.filter((r) => vehicleFilter.includes(r.requiredVehicleType || ""))
    return result.sort((a, b) => {
      const aPriority = a.noShow && a.status === "DISPONIVEL" ? 0 : a.noShow ? 1 : 2
      const bPriority = b.noShow && b.status === "DISPONIVEL" ? 0 : b.noShow ? 1 : 2
      if (aPriority !== bPriority) return aPriority - bPriority
      return (b.routeDate || "").localeCompare(a.routeDate || "")
    })
  }, [routes, search, statusFilter, cityFilter, vehicleFilter])

  const statusCounts = useMemo(() => ({
    total: routes.length,
    SOLICITADA: routes.filter((r) => isTelegramRequested(r)).length,
    DISPONIVEL: routes.filter((r) => r.status === "DISPONIVEL" && !isTelegramRequested(r)).length,
    APROVADA: routes.filter((r) => r.status === "APROVADA").length,
    ATRIBUIDA: routes.filter((r) => r.status === "ATRIBUIDA").length,
    BLOQUEADA: routes.filter((r) => r.status === "BLOQUEADA").length,
    NO_SHOW: routes.filter((r) => r.noShow).length,
  }), [routes])

  const visibleRouteRequests = useMemo(() => {
    const visibleRouteIds = new Set(filtered.map((route) => route.id))
    return routeRequests.filter((request) => visibleRouteIds.has(request.routeId))
  }, [filtered, routeRequests])

  const handleApproveRouteRequest = async (request: PendingRouteRequest) => {
    const route = routes.find((item) => item.id === request.routeId)
    if (!route) { toast.error("A rota solicitada nao esta carregada na lista atual"); return }
    setApprovingRouteRequestId(request.routeId)
    try {
      const response = await approveRouteRequestApi(request.routeId)
      if (!response.ok) { toast.error(response.message); return }
      setRoutes((prev) =>
        prev.map((item) =>
          item.id === request.routeId
            ? { ...item, requestedDriverId: request.requestedDriverId, requestedDriverName: request.requestedDriverName, assignmentSource: "TELEGRAM_BOT" as const, botAvailable: false, status: "APROVADA" as const, driverId: request.requestedDriverId, driverName: request.requestedDriverName, driverVehicleType: request.requestedDriverVehicleType, driverAccuracy: null, driverPlate: null, assignedAt: new Date().toISOString() }
            : item
        )
      )
      setSelectedRoute((current) =>
        current?.id === request.routeId
          ? { ...current, requestedDriverId: request.requestedDriverId, requestedDriverName: request.requestedDriverName, assignmentSource: "TELEGRAM_BOT", botAvailable: false, status: "APROVADA", driverId: request.requestedDriverId, driverName: request.requestedDriverName, driverVehicleType: request.requestedDriverVehicleType, driverAccuracy: null, driverPlate: null, assignedAt: new Date().toISOString() }
          : current
      )
      setRouteRequests((prev) => prev.filter((item) => item.routeId !== request.routeId))
      setAssignRoute((current) => (current?.id === request.routeId ? null : current))
      setSelectedDriver((current) => (assignRoute?.id === request.routeId ? "" : current))
      toast.success(`Solicitacao da rota ${request.atId || request.routeId} aprovada`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel aprovar a solicitacao da rota"))
    } finally {
      setApprovingRouteRequestId(null)
    }
  }

  const handleApproveBlockedQueue = async (request: BlockedQueueRequest) => {
    setApprovingBlockedDriverId(request.driverId)
    try {
      const response = await approveBlockedQueueRequestApi(request.driverId)
      if (!response.ok) { toast.error(response.message); return }
      setBlockedQueueRequests((current) => current.filter((item) => item.driverId !== request.driverId))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel aprovar a entrada na fila"))
    } finally {
      setApprovingBlockedDriverId(null)
    }
  }

  const handleRejectBlockedQueue = async (request: BlockedQueueRequest) => {
    setRejectingBlockedDriverId(request.driverId)
    try {
      const response = await rejectBlockedQueueRequestApi(request.driverId)
      if (!response.ok) { toast.error(response.message); return }
      setBlockedQueueRequests((current) => current.filter((item) => item.driverId !== request.driverId))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel reprovar a entrada na fila"))
    } finally {
      setRejectingBlockedDriverId(null)
    }
  }

  const handleRejectRouteRequest = async (request: PendingRouteRequest) => {
    setRejectingRouteRequestId(request.routeId)
    try {
      const response = await rejectRouteRequestApi(request.routeId)
      if (!response.ok) { toast.error(response.message); return }
      setRouteRequests((current) => current.filter((item) => item.routeId !== request.routeId))
      setRoutes((current) =>
        current.map((route) =>
          route.id === request.routeId
            ? { ...route, requestedDriverId: null, requestedDriverName: null, assignmentSource: "SYNC" as const, botAvailable: true, driverId: null, driverName: null, driverVehicleType: null, driverAccuracy: null, driverPlate: null, status: "DISPONIVEL" as const, assignedAt: null }
            : route
        )
      )
      setSelectedRoute((current) =>
        current?.id === request.routeId
          ? { ...current, requestedDriverId: null, requestedDriverName: null, assignmentSource: "SYNC", botAvailable: true, driverId: null, driverName: null, driverVehicleType: null, driverAccuracy: null, driverPlate: null, status: "DISPONIVEL", assignedAt: null }
          : current
      )
      setAssignRoute((current) => (current?.id === request.routeId ? null : current))
      setSelectedDriver((current) => (assignRoute?.id === request.routeId ? "" : current))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel recusar a solicitacao da rota"))
    } finally {
      setRejectingRouteRequestId(null)
    }
  }

  const handleAssign = async () => {
    if (!assignRoute) return
    const resolvedDriverId = selectedDriver || (isTelegramRequested(assignRoute) ? assignRoute.requestedDriverId || "" : "")
    if (!resolvedDriverId) return
    const driver = drivers.find((d) => d.id === resolvedDriverId)
    if (!driver) return
    try {
      const response = await assignRouteRequest(assignRoute.id, resolvedDriverId)
      if (!response.ok) { toast.error(response.message); return }
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === assignRoute.id
            ? { ...r, requestedDriverId: assignRoute.requestedDriverId ? driver.id : null, requestedDriverName: assignRoute.requestedDriverId ? driver.name : null, assignmentSource: assignRoute.requestedDriverId ? "TELEGRAM_BOT" as const : "MANUAL" as const, botAvailable: false, status: assignRoute.requestedDriverId ? "APROVADA" as const : "ATRIBUIDA" as const, driverId: driver.id, driverName: driver.name, driverVehicleType: driver.vehicleType, driverAccuracy: null, driverPlate: null, assignedAt: new Date().toISOString() }
            : r
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === assignRoute.id
          ? { ...prev, requestedDriverId: assignRoute.requestedDriverId ? driver.id : null, requestedDriverName: assignRoute.requestedDriverId ? driver.name : null, assignmentSource: assignRoute.requestedDriverId ? "TELEGRAM_BOT" : "MANUAL", botAvailable: false, status: assignRoute.requestedDriverId ? "APROVADA" : "ATRIBUIDA", driverId: driver.id, driverName: driver.name, driverVehicleType: driver.vehicleType, driverAccuracy: null, driverPlate: null, assignedAt: new Date().toISOString() }
          : prev
      )
      setRouteRequests((prev) => prev.filter((item) => item.routeId !== assignRoute.id))
      toast.success(
        isTelegramRequested(assignRoute)
          ? `Solicitacao da rota ${assignRoute.atId || assignRoute.id} aprovada para ${driver.name}`
          : `Rota ${assignRoute.atId || assignRoute.id} atribuida a ${driver.name}`
      )
      setAssignRoute(null)
      setSelectedDriver("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atribuir a rota"))
    }
  }

  const handleMarkNoShow = async (route: Route, makeAvailable = false) => {
    try {
      const response = await markRouteNoShow(route.id, makeAvailable)
      if (!response.ok) { toast.error(response.message); return }
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === route.id
            ? { ...r, noShow: true, status: makeAvailable ? "DISPONIVEL" as const : r.status, requestedDriverId: makeAvailable ? null : r.requestedDriverId, driverId: makeAvailable ? null : r.driverId, driverName: makeAvailable ? null : r.driverName, driverVehicleType: makeAvailable ? null : r.driverVehicleType, assignedAt: makeAvailable ? null : r.assignedAt }
            : r
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === route.id
          ? { ...prev, noShow: true, status: makeAvailable ? "DISPONIVEL" : prev.status, requestedDriverId: makeAvailable ? null : prev.requestedDriverId, driverId: makeAvailable ? null : prev.driverId, driverName: makeAvailable ? null : prev.driverName, driverVehicleType: makeAvailable ? null : prev.driverVehicleType, assignedAt: makeAvailable ? null : prev.assignedAt }
          : prev
      )
      toast.success(makeAvailable ? `Rota ${route.atId || route.id} liberada como no-show` : `Rota ${route.atId || route.id} marcada como no-show`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel marcar a rota como no-show"))
    }
  }

  const handleMakeAvailable = async (route: Route) => {
    const wasRequested = isTelegramRequested(route)
    try {
      const response = await releaseRouteToBotRequest(route.id)
      if (!response.ok) { toast.error(response.message); return }
      const released = { status: "DISPONIVEL" as const, requestedDriverId: null, requestedDriverName: null, assignmentSource: "SYNC" as const, driverId: null, driverName: null, driverVehicleType: null, driverAccuracy: null, driverPlate: null, assignedAt: null, botAvailable: true }
      setRoutes((prev) => prev.map((r) => r.id === route.id ? { ...r, ...released } : r))
      setSelectedRoute((prev) => prev?.id === route.id ? { ...prev, ...released } : prev)
      setRouteRequests((prev) => prev.filter((item) => item.routeId !== route.id))
      toast.success(wasRequested ? `Solicitacao da rota ${route.atId || route.id} removida` : `Rota ${route.atId || route.id} liberada para o bot`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel liberar a rota para o bot"))
    }
  }

  const handleBulkReleaseToBot = async () => {
    const atIds = Array.from(new Set(bulkAtInput.split(/[\s,;\n\r\t]+/g).map((v) => v.trim()).filter(Boolean)))
    if (!atIds.length) { toast.error("Informe ao menos um AT para liberar no bot"); return }
    setIsBulkReleasing(true)
    try {
      const response = await releaseRoutesToBotByAtRequest(atIds, {})
      if (!response.ok) { toast.error(response.message); return }
      await loadData(true)
      setBulkReleaseOpen(false)
      setBulkAtInput("")
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel liberar a lista de ATs no bot"))
    } finally {
      setIsBulkReleasing(false)
    }
  }

  const assignableDrivers = useMemo(() => {
    const q = assignDriverSearch.trim().toLowerCase()
    return drivers
      .filter((d) => {
        const required = normalizeVehicleType(assignRoute?.requiredVehicleType)
        if (required !== "MOTO") return true
        return normalizeVehicleType(d.vehicleType) === "MOTO"
      })
      .filter((d) => !q || d.id.toLowerCase().includes(q) || (d.name || "").toLowerCase().includes(q))
      .sort((a, b) => b.priorityScore - a.priorityScore)
  }, [assignDriverSearch, assignRoute, drivers])

  const handleCopyRelation = async () => {
    try {
      const lines = filtered
        .filter((route) => route.driverId && (route.atId || route.id))
        .map((route) => `${route.driverId};${route.atId || route.id}`)
      if (!lines.length) { toast.error("Nenhuma rota com motorista atribuído na lista atual"); return }
      await navigator.clipboard.writeText(lines.join("\n"))
      toast.success(`${lines.length} rota(s) copiadas para a área de transferência`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel copiar a relação"))
    }
  }

  const toggleRouteSelection = (route: Route) => {
    setSelectedRoute((current) => (current?.id === route.id ? null : route))
  }

  const handleToggleBot = async (enabled: boolean) => {
    setIsTogglingBot(true)
    try {
      await saveBotEnabled(enabled)
      setBotEnabledState(enabled)
      toast.success(enabled ? "Bot ativado com sucesso" : "Bot desativado com sucesso")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel alterar o estado do bot"))
    } finally {
      setIsTogglingBot(false)
    }
  }

  const handleRefreshRoutes = async () => {
    if (isRefreshingRoutes) return
    setIsRefreshingRoutes(true)
    try {
      const { date, shift } = getCurrentRouteWindow()
      await runSync("routes", date, shift)
      toast.success(`Rotas sincronizadas (${shift} ${date})`)
      await loadData(true)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar as rotas"))
    } finally {
      setIsRefreshingRoutes(false)
    }
  }

  const statCards = [
    { label: "Disponiveis", filterKey: "DISPONIVEL" as RouteStatusFilter, count: statusCounts.DISPONIVEL, icon: RouteIcon, bg: "bg-sky-500/10", iconColor: "text-sky-600" },
    { label: "Solicitadas", filterKey: "SOLICITADA" as RouteStatusFilter, count: statusCounts.SOLICITADA, icon: Clock, bg: "bg-amber-500/10", iconColor: "text-amber-600" },
    { label: "Aprovadas", filterKey: "APROVADA" as RouteStatusFilter, count: statusCounts.APROVADA, icon: CheckCircle2, bg: "bg-violet-500/10", iconColor: "text-violet-600" },
    { label: "Atribuidas", filterKey: "ATRIBUIDA" as RouteStatusFilter, count: statusCounts.ATRIBUIDA, icon: Truck, bg: "bg-emerald-500/10", iconColor: "text-emerald-600" },
    { label: "Bloqueadas", filterKey: "BLOQUEADA" as RouteStatusFilter, count: statusCounts.BLOQUEADA, icon: Ban, bg: "bg-slate-500/10", iconColor: "text-slate-500" },
    { label: "No-Show", filterKey: null, count: statusCounts.NO_SHOW, icon: AlertTriangle, bg: "bg-red-500/10", iconColor: "text-red-600" },
  ]

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <PageHeader title="Rotas" breadcrumbs={[{ label: "Rotas" }]} />
      <div className="flex min-w-0 max-w-full flex-col gap-5 overflow-hidden p-4 md:p-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Gestao de Rotas</h2>
            <p className="text-sm text-muted-foreground">{statusCounts.total} rotas totais · {filtered.length} exibidas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${botEnabled ? "border-emerald-500/30 bg-emerald-500/10" : "border-destructive/30 bg-destructive/10"}`}>
              <Switch id="bot-enabled" checked={botEnabled} onCheckedChange={handleToggleBot} disabled={isTogglingBot} />
              <Label htmlFor="bot-enabled" className={`text-sm font-semibold cursor-pointer flex items-center gap-1 ${botEnabled ? "text-emerald-700" : "text-destructive"}`}>
                <Bot className="h-3.5 w-3.5" />
                Bot {botEnabled ? "Ativo" : "Inativo"}
              </Label>
            </div>
            <Button variant="default" onClick={handleRefreshRoutes} disabled={isRefreshingRoutes} size="sm">
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshingRoutes ? "animate-spin" : ""}`} />
              {isRefreshingRoutes ? "Atualizando..." : "Atualizar rotas"}
            </Button>
            <Button variant="outline" onClick={handleCopyRelation} size="sm">
              <Download className="mr-1.5 h-4 w-4" />
              Copiar relacao
            </Button>
            <Button variant="outline" onClick={() => setBulkReleaseOpen(true)} size="sm">
              <UserPlus className="mr-1.5 h-4 w-4" />
              Liberar ATs no Bot
            </Button>
          </div>
        </div>

        {/* Status summary cards */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {statCards.map((card) => {
            const isActive = card.filterKey ? statusFilter.includes(card.filterKey) : false
            return (
              <button
                key={card.label}
                type="button"
                onClick={() => {
                  if (!card.filterKey) return
                  setStatusFilter((current) => toggleFilterValue(current, card.filterKey!))
                }}
                className={`rounded-xl border p-3 text-left transition-all hover:shadow-sm ${
                  isActive
                    ? "ring-2 ring-primary/40 border-primary/30 bg-primary/5"
                    : card.filterKey
                    ? "border-border bg-card hover:border-border/80 cursor-pointer"
                    : "border-border bg-card cursor-default"
                }`}
              >
                <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${card.bg}`}>
                  <card.icon className={`h-4 w-4 ${card.iconColor}`} />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">{card.count}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <Card className="border-border/60">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-full lg:basis-[260px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ID, AT, gaiola, bairro ou motorista..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 justify-between sm:w-[140px]">
                    {buildFilterLabel("Status", statusFilter)}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(["NO_BOT", "SOLICITADA", "DISPONIVEL", "APROVADA", "ATRIBUIDA", "BLOQUEADA", "EXPORTADA"] as RouteStatusFilter[]).map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={statusFilter.includes(status)}
                      onCheckedChange={() => setStatusFilter((current) => toggleFilterValue(current, status))}
                    >
                      {status === "NO_BOT" ? "NO BOT" : status}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 justify-between sm:w-[140px]">
                    {buildFilterLabel("Cidades", cityFilter)}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Cidades</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {cities.map((city) => (
                    <DropdownMenuCheckboxItem
                      key={city}
                      checked={cityFilter.includes(city || "")}
                      onCheckedChange={() => setCityFilter((current) => toggleFilterValue(current, city || ""))}
                    >
                      {city}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 justify-between sm:w-[130px]">
                    {buildFilterLabel("Veiculos", vehicleFilter)}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Veiculos</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {vehicles.map((vehicle) => (
                    <DropdownMenuCheckboxItem
                      key={vehicle}
                      checked={vehicleFilter.includes(vehicle || "")}
                      onCheckedChange={() => setVehicleFilter((current) => toggleFilterValue(current, vehicle || ""))}
                    >
                      {vehicle}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {(statusFilter.length > 0 || cityFilter.length > 0 || vehicleFilter.length > 0 || search) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearch(""); setStatusFilter([]); setCityFilter([]); setVehicleFilter([]) }}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Limpar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pending requests panels - only show when there are items */}
        {(blockedQueueRequests.length > 0 || visibleRouteRequests.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="flex h-[340px] flex-col p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Solicitacoes de bloqueados</h3>
                    <p className="text-xs text-muted-foreground">Aguardando aprovacao para entrar na fila</p>
                  </div>
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700">{blockedQueueRequests.length}</Badge>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {blockedQueueRequests.length ? (
                    blockedQueueRequests.map((request) => {
                      const dsMeta = getDsMeta(request.ds)
                      const statusMeta = getBlockedQueueStatusMeta(request.status, request.cooldownUntil)
                      return (
                        <div key={request.driverId} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              <p className="truncate text-sm font-semibold text-foreground">{request.driverName || request.driverId}</p>
                              <p className="text-xs text-muted-foreground">ID {request.driverId}{request.vehicleType ? ` · ${request.vehicleType}` : ""}</p>
                              <div className="flex flex-wrap gap-1.5">
                                <Badge variant="outline" className={`text-xs ${statusMeta.className}`}>{statusMeta.label}</Badge>
                                <Badge variant="outline" className="text-xs">Score {request.priorityScore.toFixed(0)}</Badge>
                                <Badge variant="outline" className={`text-xs ${dsMeta.className}`}>DS {dsMeta.valueLabel}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{formatRequestTimestamp(request.requestedAt)} · {getBusinessBlockReasonLabel(request.blockReason)}</p>
                            </div>
                            <div className="flex shrink-0 flex-col gap-1.5">
                              <Button size="sm" className="h-7 px-3 text-xs" onClick={() => void handleApproveBlockedQueue(request)} disabled={request.status === "REJECTED" || approvingBlockedDriverId === request.driverId || rejectingBlockedDriverId === request.driverId}>
                                {approvingBlockedDriverId === request.driverId ? "..." : "Aprovar"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => void handleRejectBlockedQueue(request)} disabled={request.status === "REJECTED" || approvingBlockedDriverId === request.driverId || rejectingBlockedDriverId === request.driverId}>
                                {rejectingBlockedDriverId === request.driverId ? "..." : "Reprovar"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma solicitacao pendente.</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex h-[340px] flex-col p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Disponibilidades pendentes</h3>
                    <p className="text-xs text-muted-foreground">Aguardando analise e atribuicao</p>
                  </div>
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">{visibleRouteRequests.length}</Badge>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {visibleRouteRequests.length ? (
                    visibleRouteRequests.map((request) => {
                      const dsMeta = getDsMeta(request.requestedDriverDs)
                      return (
                        <div key={`${request.routeId}-${request.requestedDriverId || "sem-motorista"}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="min-w-0 space-y-1.5">
                            <p className="truncate text-sm font-semibold text-foreground">AT {request.atId}</p>
                            <p className="text-xs text-muted-foreground">{request.requestedDriverId || "-"} · {request.requestedDriverName || "Sem motorista"}{request.requestedDriverVehicleType ? ` · ${request.requestedDriverVehicleType}` : ""}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="outline" className="text-xs">Score {request.requestedDriverPriorityScore.toFixed(0)}</Badge>
                              <Badge variant="outline" className={`text-xs ${dsMeta.className}`}>DS {dsMeta.valueLabel}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{[request.routeDate, request.shift, request.cidade, request.bairro].filter(Boolean).join(" · ")}</p>
                            <p className="text-xs text-muted-foreground">{formatRequestTimestamp(request.requestedAt)}</p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1.5">
                            <Button size="sm" className="h-7 px-3 text-xs" onClick={() => void handleApproveRouteRequest(request)} disabled={approvingRouteRequestId === request.routeId || rejectingRouteRequestId === request.routeId}>
                              {approvingRouteRequestId === request.routeId ? "..." : "Aprovar"}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => void handleRejectRouteRequest(request)} disabled={approvingRouteRequestId === request.routeId || rejectingRouteRequestId === request.routeId}>
                              {rejectingRouteRequestId === request.routeId ? "..." : "Recusar"}
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma disponibilidade pendente para os filtros atuais.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Table + Detail panel */}
        {isLoading ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Carregando rotas...</div>
        ) : (
          <div className={`grid min-w-0 gap-4 ${selectedRoute ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
            <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-xl border bg-card">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/60">
                    <TableHead className="w-[150px] text-xs font-semibold">Motorista</TableHead>
                    <TableHead className="w-[130px] text-xs font-semibold">AT</TableHead>
                    <TableHead className="w-[110px] text-xs font-semibold">Gaiola</TableHead>
                    <TableHead className="w-[120px] text-xs font-semibold">Cluster</TableHead>
                    <TableHead className="w-[120px] text-xs font-semibold">Status</TableHead>
                    <TableHead className="w-[130px] text-xs font-semibold">Cidade</TableHead>
                    <TableHead className="w-[160px] text-xs font-semibold">Solicitante</TableHead>
                    <TableHead className="w-[160px] text-xs font-semibold">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        Nenhuma rota encontrada para os filtros aplicados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((route) => {
                      const isSelected = selectedRoute?.id === route.id
                      const isTgReq = isTelegramRequested(route)
                      const meta = getStatusMeta(route, isTgReq)
                      return (
                        <TableRow
                          key={route.id}
                          onClick={() => toggleRouteSelection(route)}
                          className={`cursor-pointer transition-colors ${meta.rowAccent} ${isSelected ? "ring-1 ring-inset ring-primary/40 bg-primary/5" : "hover:bg-muted/40"}`}
                        >
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-2 shrink-0 rounded-full ${meta.dotColor}`} />
                              <span className="truncate font-mono text-xs text-card-foreground">{route.driverId || <span className="text-muted-foreground">—</span>}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">{route.atId || route.id}</TableCell>
                          <TableCell className="py-2.5 text-sm text-card-foreground">{route.gaiola || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="py-2.5 text-sm text-card-foreground">{route.cluster || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="py-2.5">
                            <Badge variant="outline" className={`text-xs font-medium ${meta.badgeClass}`}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-sm text-card-foreground">{route.cidade || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="py-2.5 text-sm text-card-foreground truncate">{route.requestedDriverName || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex gap-1.5">
                              <Button
                                variant={isTgReq ? "default" : "outline"}
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setAssignRoute(route)
                                  setSelectedDriver(isTgReq ? route.requestedDriverId || "" : "")
                                  setAssignDriverSearch("")
                                }}
                                className="h-7 px-2.5 text-xs"
                              >
                                <UserPlus className="mr-1 h-3.5 w-3.5" />
                                {isTgReq ? "Aprovar" : "Atribuir"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); void handleMakeAvailable(route) }}
                                disabled={route.status === "DISPONIVEL" && !isTgReq}
                                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Liberar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {selectedRoute ? (
              <Card className="h-fit">
                <CardContent className="p-4">
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Detalhes da Rota</h3>
                      <p className="font-mono text-xs text-muted-foreground">{selectedRoute.atId || selectedRoute.id}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedRoute(null)} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {(() => {
                    const isTgReq = isTelegramRequested(selectedRoute)
                    const meta = getStatusMeta(selectedRoute, isTgReq)
                    return (
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`${meta.badgeClass} px-2.5 py-1`}>{meta.label}</Badge>
                        {selectedRoute.noShow && (
                          <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-700 px-2.5 py-1">No-Show</Badge>
                        )}
                        {isReleasedToBot(selectedRoute) && (
                          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-700 text-xs">
                            <Bot className="mr-1 h-3 w-3" />Bot
                          </Badge>
                        )}
                        {isTelegramApproved(selectedRoute) && (
                          <Badge variant="outline" className="border-violet-500/40 bg-violet-500/15 text-violet-700 text-xs">Aprovado</Badge>
                        )}
                      </div>
                    )
                  })()}

                  <div className="space-y-3">
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        <RouteIcon className="h-3 w-3" /> Rota
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <DetailField label="Data" value={selectedRoute.routeDate} />
                        <DetailField label="Turno" value={selectedRoute.shift} />
                        <DetailField label="Cidade" value={selectedRoute.cidade} />
                        <DetailField label="Bairro" value={selectedRoute.bairro} />
                        <DetailField label="Gaiola" value={selectedRoute.gaiola} />
                        <DetailField label="Veiculo" value={selectedRoute.requiredVehicleType} />
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        <Package className="h-3 w-3" /> Operacao
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <DetailField label="KM" value={selectedRoute.km} />
                        <DetailField label="SPR" value={selectedRoute.spr} />
                        <DetailField label="Volume" value={selectedRoute.volume} />
                        <DetailField label="GG" value={selectedRoute.gg} />
                        <DetailField label="Cluster" value={selectedRoute.cluster} />
                        <DetailField label="DS Sugerido" value={selectedRoute.suggestionDriverDs} />
                      </div>
                    </div>

                    {selectedRoute.driverId && (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          <User className="h-3 w-3" /> Motorista Atual
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <DetailField label="Nome" value={selectedRoute.driverName} />
                          <DetailField label="ID" value={selectedRoute.driverId} />
                          <DetailField label="Veiculo" value={selectedRoute.driverVehicleType} />
                          <DetailField label="Placa" value={selectedRoute.driverPlate} />
                          <DetailField label="Acuracia" value={selectedRoute.driverAccuracy} />
                          <DetailField label="Atribuido em" value={formatRequestTimestamp(selectedRoute.assignedAt)} />
                        </div>
                      </div>
                    )}

                    {selectedRoute.requestedDriverId && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700/70">
                          <Clock className="h-3 w-3" /> Motorista Solicitante
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <DetailField label="Nome" value={selectedRoute.requestedDriverName} />
                          <DetailField label="ID" value={selectedRoute.requestedDriverId} />
                          <DetailField label="Origem" value={isTelegramApproved(selectedRoute) ? "Bot (Aprovado)" : selectedRoute.assignmentSource} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2 border-t pt-4">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setAssignRoute(selectedRoute)
                        setSelectedDriver(isTelegramRequested(selectedRoute) ? selectedRoute.requestedDriverId || "" : "")
                        setAssignDriverSearch("")
                      }}
                    >
                      <UserPlus className="mr-1.5 h-4 w-4" />
                      {isTelegramRequested(selectedRoute) ? "Aprovar" : "Atribuir"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={selectedRoute.status === "DISPONIVEL" && !isTelegramRequested(selectedRoute)}
                      onClick={() => void handleMakeAvailable(selectedRoute)}
                    >
                      Liberar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>

      {/* Assign Dialog */}
      <Dialog
        open={!!assignRoute}
        onOpenChange={() => {
          setAssignRoute(null)
          setSelectedDriver("")
          setAssignDriverSearch("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {assignRoute && isTelegramRequested(assignRoute) ? "Aprovar Disponibilidade" : "Atribuir Rota Manualmente"}
            </DialogTitle>
            <DialogDescription>
              Rota {assignRoute?.atId || assignRoute?.id} — {assignRoute?.cidade}, {assignRoute?.bairro}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Input
              placeholder="Pesquisar motorista por ID ou nome..."
              value={assignDriverSearch}
              onChange={(e) => setAssignDriverSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-72 space-y-1 overflow-auto rounded-lg border p-2">
              {assignableDrivers.length ? (
                assignableDrivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => { setSelectedDriver(d.id); setAssignDriverSearch(d.name || d.id) }}
                    className={`flex w-full items-start justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${selectedDriver === d.id ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{d.name || d.id}</span>
                      <span className="truncate text-xs text-muted-foreground">{d.id} · {d.vehicleType || "-"} · Score {d.priorityScore ?? 0}</span>
                    </div>
                    {selectedDriver === d.id && <span className="ml-3 shrink-0 text-xs font-semibold text-primary">Selecionado</span>}
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {assignDriverSearch.trim() ? "Nenhum motorista encontrado." : "Digite para pesquisar um motorista."}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignRoute(null)}>Cancelar</Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedDriver && !(assignRoute && isTelegramRequested(assignRoute) && assignRoute.requestedDriverId)}
            >
              {assignRoute && isTelegramRequested(assignRoute) ? "Aprovar" : "Concluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkReleaseOpen}
        onOpenChange={(open) => {
          setBulkReleaseOpen(open)
          if (!open) setBulkAtInput("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar Lista de ATs no Bot</DialogTitle>
            <DialogDescription>
              Cole uma lista de ATs separados por quebra de linha, espaco ou virgula.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={"AT12345\nAT67890\nAT24680"}
              value={bulkAtInput}
              onChange={(e) => setBulkAtInput(e.target.value)}
              className="min-h-40"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkReleaseOpen(false)}>Cancelar</Button>
            <Button onClick={handleBulkReleaseToBot} disabled={isBulkReleasing}>
              {isBulkReleasing ? "Liberando..." : "Liberar no Bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
