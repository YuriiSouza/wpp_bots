"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Search,
  Download,
  UserPlus,
  RefreshCw,
  ChevronDown,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  approveRouteRequest as approveRouteRequestApi,
  approveBlockedQueueRequest as approveBlockedQueueRequestApi,
  assignRoute as assignRouteRequest,
  exportBotAssignedRoutesCsv,
  fetchDrivers,
  fetchRouteRequestsBoard,
  fetchRoutes,
  getApiErrorMessage,
  markRouteNoShow,
  rejectRouteRequest as rejectRouteRequestApi,
  rejectBlockedQueueRequest as rejectBlockedQueueRequestApi,
  releaseRouteToBot as releaseRouteToBotRequest,
  releaseRoutesToBotByAt as releaseRoutesToBotByAtRequest,
} from "@/lib/admin-api"
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

  return {
    label: "Pendente",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  }
}

function getBusinessBlockReasonLabel(reason?: string | null) {
  const normalized = String(reason || "").trim().toLowerCase()
  if (normalized.includes("novato") || normalized.includes("sem ds")) {
    return "Acompanhamento das primeiras rotas"
  }
  if (!normalized) {
    return "Nao informado"
  }
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
  if (ds === null) {
    return {
      label: "DS sem dado",
      valueLabel: "-",
      className: "border-slate-400/30 bg-slate-500/10 text-slate-700",
    }
  }

  if (ds < 10) {
    return {
      label: "Ultra critico",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-rose-700/30 bg-rose-700/15 text-rose-800",
    }
  }
  if (ds < 30) {
    return {
      label: "Critico",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-red-600/30 bg-red-600/15 text-red-700",
    }
  }
  if (ds < 50) {
    return {
      label: "Muito ruim",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-orange-600/30 bg-orange-600/15 text-orange-700",
    }
  }
  if (ds < 70) {
    return {
      label: "Ruim",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-amber-600/30 bg-amber-500/15 text-amber-700",
    }
  }
  if (ds < 80) {
    return {
      label: "Mediano",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-yellow-600/30 bg-yellow-500/15 text-yellow-700",
    }
  }
  if (ds < 90) {
    return {
      label: "Bom",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-lime-600/30 bg-lime-500/15 text-lime-700",
    }
  }
  if (ds < 98) {
    return {
      label: "Muito bom",
      valueLabel: `${ds.toFixed(0)}%`,
      className: "border-emerald-600/30 bg-emerald-500/15 text-emerald-700",
    }
  }

  return {
    label: "Excelente",
    valueLabel: `${ds.toFixed(0)}%`,
    className: "border-teal-600/30 bg-teal-500/15 text-teal-700",
  }
}

function getInitialRouteFilters(today: string) {
  if (typeof window === "undefined") {
    return {
      search: "",
      dayFromFilter: today,
      dayToFilter: today,
      shiftFilter: [] as string[],
      statusFilter: [] as RouteStatusFilter[],
      cityFilter: [] as string[],
      vehicleFilter: [] as string[],
    }
  }

  try {
    const raw = window.localStorage.getItem(ROUTES_FILTERS_STORAGE_KEY)
    if (!raw) {
      return {
        search: "",
        dayFromFilter: today,
        dayToFilter: today,
        shiftFilter: [] as string[],
        statusFilter: [] as RouteStatusFilter[],
        cityFilter: [] as string[],
        vehicleFilter: [] as string[],
      }
    }

    const parsed = JSON.parse(raw) as Partial<{
      search: string
      dayFilter: string
      dayFromFilter: string
      dayToFilter: string
      shiftFilter: string | string[]
      statusFilter: string | string[]
      cityFilter: string | string[]
      vehicleFilter: string | string[]
    }>

    const fallbackDay = parsed.dayFilter || today

    return {
      search: parsed.search || "",
      dayFromFilter: parsed.dayFromFilter || fallbackDay,
      dayToFilter: parsed.dayToFilter || fallbackDay,
      shiftFilter: normalizeStoredFilter(parsed.shiftFilter),
      statusFilter: normalizeStoredFilter(parsed.statusFilter) as RouteStatusFilter[],
      cityFilter: normalizeStoredFilter(parsed.cityFilter),
      vehicleFilter: normalizeStoredFilter(parsed.vehicleFilter),
    }
  } catch {
    return {
      search: "",
      dayFromFilter: today,
      dayToFilter: today,
      shiftFilter: [] as string[],
      statusFilter: [] as RouteStatusFilter[],
      cityFilter: [] as string[],
      vehicleFilter: [] as string[],
    }
  }
}

export default function RoutesPage() {
  const today = new Date().toISOString().slice(0, 10)
  const initialFilters = getInitialRouteFilters(today)
  const [search, setSearch] = useState(initialFilters.search)
  const [dayFromFilter, setDayFromFilter] = useState(initialFilters.dayFromFilter)
  const [dayToFilter, setDayToFilter] = useState(initialFilters.dayToFilter)
  const [shiftFilter, setShiftFilter] = useState<string[]>(initialFilters.shiftFilter)
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
  const isTelegramRequested = (route: Route) =>
    route.assignmentSource === "TELEGRAM_BOT" && !!route.requestedDriverId && !route.driverId
  const isReleasedToBot = (route: Route) =>
    Boolean(route.botAvailable) || isTelegramRequested(route)
  const isTelegramApproved = (route: Route) =>
    route.assignmentSource === "TELEGRAM_BOT" && !!route.requestedDriverId && !!route.driverId && route.status === "APROVADA"

  const loadData = async (
    silent = false,
    filters?: {
      dateFrom?: string
      dateTo?: string
      shift?: "AM" | "PM" | "PM2"
    }
  ) => {
    if (!silent) {
      setIsLoading(true)
    }

    try {
      const [routeData, driverData, requestBoard] = await Promise.all([
        fetchRoutes({
          dateFrom: (filters?.dateFrom ?? dayFromFilter) || undefined,
          dateTo: (filters?.dateTo ?? dayToFilter) || undefined,
          shift:
            filters?.shift ??
            (shiftFilter.length === 1 ? (shiftFilter[0] as "AM" | "PM" | "PM2") : undefined),
        }),
        fetchDrivers(),
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
      if (!silent) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar as rotas"))
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadData()
    const interval = window.setInterval(() => {
      void loadData(true)
    }, 5000)

    return () => {
      window.clearInterval(interval)
    }
  }, [dayFromFilter, dayToFilter, shiftFilter])

  useEffect(() => {
    window.localStorage.setItem(
      ROUTES_FILTERS_STORAGE_KEY,
      JSON.stringify({
        search,
        dayFromFilter,
        dayToFilter,
        shiftFilter,
        statusFilter,
        cityFilter,
        vehicleFilter,
      })
    )
  }, [search, dayFromFilter, dayToFilter, shiftFilter, statusFilter, cityFilter, vehicleFilter])

  const cities = useMemo(() => [...new Set(routes.map((r) => r.cidade).filter(Boolean))], [routes])
  const shifts = useMemo(() => [...new Set(routes.map((r) => r.shift).filter(Boolean))], [routes])
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
    if (shiftFilter.length) result = result.filter((r) => shiftFilter.includes(r.shift || ""))
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
  }, [routes, search, shiftFilter, statusFilter, cityFilter, vehicleFilter])

  const statusCounts = useMemo(() => ({
    total: routes.length,
    SOLICITADA: routes.filter((r) => isTelegramRequested(r)).length,
    DISPONIVEL: routes.filter((r) => r.status === "DISPONIVEL" && !isTelegramRequested(r)).length,
    APROVADA: routes.filter((r) => r.status === "APROVADA").length,
    ATRIBUIDA: routes.filter((r) => r.status === "ATRIBUIDA").length,
    BLOQUEADA: routes.filter((r) => r.status === "BLOQUEADA").length,
  }), [routes])

  const visibleRouteRequests = useMemo(() => {
    const visibleRouteIds = new Set(filtered.map((route) => route.id))
    return routeRequests.filter((request) => visibleRouteIds.has(request.routeId))
  }, [filtered, routeRequests])

  const handleApproveRouteRequest = async (request: PendingRouteRequest) => {
    const route = routes.find((item) => item.id === request.routeId)
    if (!route) {
      toast.error("A rota solicitada nao esta carregada na lista atual")
      return
    }

    setApprovingRouteRequestId(request.routeId)
    try {
      const response = await approveRouteRequestApi(request.routeId)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((item) =>
          item.id === request.routeId
            ? {
                ...item,
                requestedDriverId: request.requestedDriverId,
                requestedDriverName: request.requestedDriverName,
                assignmentSource: "TELEGRAM_BOT" as const,
                botAvailable: false,
                status: "APROVADA" as const,
                driverId: request.requestedDriverId,
                driverName: request.requestedDriverName,
                driverVehicleType: request.requestedDriverVehicleType,
                driverAccuracy: null,
                driverPlate: null,
                assignedAt: new Date().toISOString(),
              }
            : item
        )
      )
      setSelectedRoute((current) =>
        current?.id === request.routeId
          ? {
              ...current,
              requestedDriverId: request.requestedDriverId,
              requestedDriverName: request.requestedDriverName,
              assignmentSource: "TELEGRAM_BOT",
              botAvailable: false,
              status: "APROVADA",
              driverId: request.requestedDriverId,
              driverName: request.requestedDriverName,
              driverVehicleType: request.requestedDriverVehicleType,
              driverAccuracy: null,
              driverPlate: null,
              assignedAt: new Date().toISOString(),
            }
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
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setBlockedQueueRequests((current) =>
        current.filter((item) => item.driverId !== request.driverId)
      )
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
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setBlockedQueueRequests((current) =>
        current.filter((item) => item.driverId !== request.driverId)
      )
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
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRouteRequests((current) => current.filter((item) => item.routeId !== request.routeId))
      setRoutes((current) =>
        current.map((route) =>
          route.id === request.routeId
            ? {
                ...route,
                requestedDriverId: null,
                requestedDriverName: null,
                assignmentSource: "SYNC" as const,
                botAvailable: true,
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                driverAccuracy: null,
                driverPlate: null,
                status: "DISPONIVEL" as const,
                assignedAt: null,
              }
            : route
        )
      )
      setSelectedRoute((current) =>
        current?.id === request.routeId
          ? {
              ...current,
              requestedDriverId: null,
              requestedDriverName: null,
              assignmentSource: "SYNC",
              botAvailable: true,
              driverId: null,
              driverName: null,
              driverVehicleType: null,
              driverAccuracy: null,
              driverPlate: null,
              status: "DISPONIVEL",
              assignedAt: null,
            }
          : current
      )
      setAssignRoute((current) => (current?.id === request.routeId ? null : current))
      setSelectedDriver((current) =>
        assignRoute?.id === request.routeId ? "" : current
      )
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
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === assignRoute.id
            ? {
                ...r,
                requestedDriverId: assignRoute.requestedDriverId ? driver.id : null,
                requestedDriverName: assignRoute.requestedDriverId ? driver.name : null,
                assignmentSource: assignRoute.requestedDriverId ? "TELEGRAM_BOT" as const : "MANUAL" as const,
                botAvailable: false,
                status: assignRoute.requestedDriverId ? ("APROVADA" as const) : ("ATRIBUIDA" as const),
                driverId: driver.id,
                driverName: driver.name,
                driverVehicleType: driver.vehicleType,
                driverAccuracy: null,
                driverPlate: null,
                assignedAt: new Date().toISOString(),
              }
            : r
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === assignRoute.id
          ? {
              ...prev,
              requestedDriverId: assignRoute.requestedDriverId ? driver.id : null,
              requestedDriverName: assignRoute.requestedDriverId ? driver.name : null,
              assignmentSource: assignRoute.requestedDriverId ? "TELEGRAM_BOT" : "MANUAL",
              botAvailable: false,
              status: assignRoute.requestedDriverId ? "APROVADA" : "ATRIBUIDA",
              driverId: driver.id,
              driverName: driver.name,
              driverVehicleType: driver.vehicleType,
              driverAccuracy: null,
              driverPlate: null,
              assignedAt: new Date().toISOString(),
            }
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
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === route.id
            ? {
                ...r,
                noShow: true,
                status: makeAvailable ? ("DISPONIVEL" as const) : r.status,
                requestedDriverId: makeAvailable ? null : r.requestedDriverId,
                driverId: makeAvailable ? null : r.driverId,
                driverName: makeAvailable ? null : r.driverName,
                driverVehicleType: makeAvailable ? null : r.driverVehicleType,
                assignedAt: makeAvailable ? null : r.assignedAt,
              }
            : r
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === route.id
          ? {
              ...prev,
              noShow: true,
              status: makeAvailable ? "DISPONIVEL" : prev.status,
              requestedDriverId: makeAvailable ? null : prev.requestedDriverId,
              driverId: makeAvailable ? null : prev.driverId,
              driverName: makeAvailable ? null : prev.driverName,
              driverVehicleType: makeAvailable ? null : prev.driverVehicleType,
              assignedAt: makeAvailable ? null : prev.assignedAt,
            }
          : prev
      )
      toast.success(makeAvailable ? `Rota ${route.atId || route.id} liberada como no-show` : `Rota ${route.atId || route.id} marcada como no-show`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel marcar a rota como no-show"))
    }
  }

  const handleReleaseToBot = async (route: Route) => {
    if (route.status !== "DISPONIVEL" || (isReleasedToBot(route) && !isTelegramRequested(route))) {
      return
    }

    setReleasingRouteId(route.id)
    try {
      const response = await releaseRouteToBotRequest(route.id)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((item) =>
          item.id === route.id
            ? {
                ...item,
                requestedDriverId: null,
                requestedDriverName: null,
                assignmentSource: "SYNC" as const,
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                driverAccuracy: null,
                driverPlate: null,
                assignedAt: null,
                status: "DISPONIVEL" as const,
                botAvailable: true,
              }
            : item
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === route.id
          ? {
              ...prev,
              requestedDriverId: null,
              requestedDriverName: null,
              assignmentSource: "SYNC",
              driverId: null,
              driverName: null,
              driverVehicleType: null,
              driverAccuracy: null,
              driverPlate: null,
              assignedAt: null,
              status: "DISPONIVEL",
              botAvailable: true,
            }
          : prev
      )
      setRouteRequests((prev) => prev.filter((item) => item.routeId !== route.id))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel liberar a rota no bot"))
    } finally {
      setReleasingRouteId(null)
    }
  }

  const handleBulkReleaseToBot = async () => {
    const atIds = Array.from(
      new Set(
        bulkAtInput
          .split(/[\s,;\n\r\t]+/g)
          .map((value) => value.trim())
          .filter(Boolean)
      )
    )

    if (!atIds.length) {
      toast.error("Informe ao menos um AT para liberar no bot")
      return
    }

    setIsBulkReleasing(true)
    try {
      const singleDayForActions =
        dayFromFilter && dayToFilter && dayFromFilter === dayToFilter ? dayFromFilter : undefined
      const response = await releaseRoutesToBotByAtRequest(atIds, {
        date: singleDayForActions,
        shift: shiftFilter.length === 1 ? (shiftFilter[0] as "AM" | "PM" | "PM2") : undefined,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

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
      .filter((d) => {
        if (!q) return true
        return d.id.toLowerCase().includes(q) || (d.name || "").toLowerCase().includes(q)
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
  }, [assignDriverSearch, assignRoute, drivers])

  const handleMakeAvailable = async (route: Route) => {
    const wasRequested = isTelegramRequested(route)

    try {
      const response = await releaseRouteToBotRequest(route.id)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === route.id
            ? {
                ...r,
                status: "DISPONIVEL" as const,
                requestedDriverId: null,
                requestedDriverName: null,
                assignmentSource: "SYNC" as const,
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                driverAccuracy: null,
                driverPlate: null,
                assignedAt: null,
                botAvailable: true,
              }
            : r
        )
      )
      setSelectedRoute((prev) =>
        prev?.id === route.id
          ? {
              ...prev,
              status: "DISPONIVEL",
              requestedDriverId: null,
              requestedDriverName: null,
              assignmentSource: "SYNC",
              driverId: null,
              driverName: null,
              driverVehicleType: null,
              driverAccuracy: null,
              driverPlate: null,
              assignedAt: null,
              botAvailable: true,
            }
          : prev
      )
      setRouteRequests((prev) => prev.filter((item) => item.routeId !== route.id))
      toast.success(
        wasRequested
          ? `Solicitacao da rota ${route.atId || route.id} removida`
          : `Rota ${route.atId || route.id} liberada para o bot`
      )
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel liberar a rota para o bot"))
    }
  }

  const handleExportCsv = async () => {
    try {
      const singleDayForActions =
        dayFromFilter && dayToFilter && dayFromFilter === dayToFilter ? dayFromFilter : undefined
      const csvBlob = await exportBotAssignedRoutesCsv(singleDayForActions)
      const blob = new Blob([csvBlob], { type: "text/csv;charset=utf-8;" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const suffix = singleDayForActions ? `-${singleDayForActions}` : ""

      link.href = url
      link.download = `rotas-atribuidas${suffix}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel exportar o CSV"))
    }
  }

  const toggleRouteSelection = (route: Route) => {
    setSelectedRoute((current) => (current?.id === route.id ? null : route))
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <PageHeader title="Rotas" breadcrumbs={[{ label: "Rotas" }]} />
      <div className="flex min-w-0 max-w-full flex-col gap-6 overflow-hidden p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Gestao de Rotas</h2>
            <p className="text-sm text-muted-foreground">{filtered.length} rotas encontradas</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportCsv} className="w-full sm:w-auto">
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button variant="outline" onClick={() => setBulkReleaseOpen(true)} className="w-full sm:w-auto">
              <UserPlus className="mr-2 h-4 w-4" />
              Liberar ATs no Bot
            </Button>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
              {statusCounts.SOLICITADA} Solicitadas
            </Badge>
            <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/30">
              {statusCounts.DISPONIVEL} Disponiveis
            </Badge>
            <Badge variant="outline" className="bg-chart-1/10 text-chart-1 border-chart-1/30">
              {statusCounts.APROVADA} Aprovadas
            </Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
              {statusCounts.ATRIBUIDA} Atribuidas
            </Badge>
            <Badge variant="outline" className="bg-chart-3/10 text-chart-3 border-chart-3/30">
              {statusCounts.BLOQUEADA} Bloqueadas
            </Badge>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 basis-full lg:basis-[280px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ID, AT, gaiola, bairro ou motorista..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Input
                type="date"
                value={dayFromFilter}
                onChange={(e) => setDayFromFilter(e.target.value)}
                className="w-full sm:w-[160px]"
              />
              <Input
                type="date"
                value={dayToFilter}
                onChange={(e) => setDayToFilter(e.target.value)}
                className="w-full sm:w-[160px]"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setDayFromFilter(today)
                  setDayToFilter(today)
                }}
                className="w-full sm:w-auto"
              >
                Hoje
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between sm:w-[140px]">
                    {buildFilterLabel("Turnos", shiftFilter)}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Turnos</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {shifts.map((shift) => (
                    <DropdownMenuCheckboxItem
                      key={shift}
                      checked={shiftFilter.includes(shift || "")}
                      onCheckedChange={() => setShiftFilter((current) => toggleFilterValue(current, shift || ""))}
                    >
                      {shift}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between sm:w-[150px]">
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
                  <Button variant="outline" className="w-full justify-between sm:w-[150px]">
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
                  <Button variant="outline" className="w-full justify-between sm:w-[140px]">
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
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="flex h-[420px] flex-col p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Solicitacoes de bloqueados</h3>
                  <p className="text-xs text-muted-foreground">
                    Motoristas bloqueados aguardando aprovacao para entrar na fila
                  </p>
                </div>
                <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                  {blockedQueueRequests.length}
                </Badge>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {blockedQueueRequests.length ? (
                  blockedQueueRequests.map((request) => {
                    const dsMeta = getDsMeta(request.ds)
                    const statusMeta = getBlockedQueueStatusMeta(request.status, request.cooldownUntil)
                    return (
                    <div
                      key={request.driverId}
                      className="rounded-lg border border-border/70 bg-muted/20 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="space-y-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {request.driverName || request.driverId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              ID {request.driverId} {request.vehicleType ? `| ${request.vehicleType}` : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className={statusMeta.className}>
                              {statusMeta.label}
                            </Badge>
                            <Badge variant="outline">Score {request.priorityScore.toFixed(0)}</Badge>
                            <Badge variant="outline" className={dsMeta.className}>
                              DS {dsMeta.valueLabel} | {dsMeta.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Solicitado em {formatRequestTimestamp(request.requestedAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Motivo: {getBusinessBlockReasonLabel(request.blockReason)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleApproveBlockedQueue(request)}
                            disabled={
                              request.status === "REJECTED" ||
                              approvingBlockedDriverId === request.driverId ||
                              rejectingBlockedDriverId === request.driverId
                            }
                          >
                            {approvingBlockedDriverId === request.driverId ? "Aprovando..." : "Aprovar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRejectBlockedQueue(request)}
                            disabled={
                              request.status === "REJECTED" ||
                              approvingBlockedDriverId === request.driverId ||
                              rejectingBlockedDriverId === request.driverId
                            }
                          >
                            {rejectingBlockedDriverId === request.driverId ? "Reprovando..." : "Reprovar"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )})
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhuma solicitacao pendente de motorista bloqueado.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-[420px] flex-col p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Solicitacoes de rotas</h3>
                  <p className="text-xs text-muted-foreground">
                    Pedidos recebidos pelo bot aguardando atribuicao da analista
                  </p>
                </div>
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
                  {visibleRouteRequests.length}
                </Badge>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {visibleRouteRequests.length ? (
                  visibleRouteRequests.map((request) => {
                    const dsMeta = getDsMeta(request.requestedDriverDs)
                    return (
                    <div
                      key={`${request.routeId}-${request.requestedDriverId || "sem-motorista"}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="space-y-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            AT {request.atId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ID {request.requestedDriverId || "-"} | {request.requestedDriverName || "Sem motorista"}
                            {request.requestedDriverVehicleType
                              ? ` | ${request.requestedDriverVehicleType}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">
                            Score {request.requestedDriverPriorityScore.toFixed(0)}
                          </Badge>
                          <Badge variant="outline" className={dsMeta.className}>
                            DS {dsMeta.valueLabel} | {dsMeta.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {request.routeDate || "-"} {request.shift ? `| ${request.shift}` : ""}
                          {request.cidade ? ` | ${request.cidade}` : ""}
                          {request.bairro ? ` | ${request.bairro}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Motivo: {getBusinessBlockReasonLabel(request.blockReason)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Solicitado em {formatRequestTimestamp(request.requestedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleApproveRouteRequest(request)}
                          disabled={
                            approvingRouteRequestId === request.routeId ||
                            rejectingRouteRequestId === request.routeId
                          }
                        >
                          {approvingRouteRequestId === request.routeId ? "Aprovando..." : "Aprovar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRejectRouteRequest(request)}
                          disabled={
                            approvingRouteRequestId === request.routeId ||
                            rejectingRouteRequestId === request.routeId
                          }
                        >
                          {rejectingRouteRequestId === request.routeId ? "Recusando..." : "Recusar"}
                        </Button>
                      </div>
                    </div>
                  )})
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhuma solicitacao de rota pendente para os filtros atuais.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando rotas...
          </div>
        ) : (
          <div className={`grid min-w-0 gap-6 ${selectedRoute ? "lg:grid-cols-[minmax(0,1.2fr)_360px]" : ""}`}>
            <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-lg border bg-card">
              <Table className="min-w-[760px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">AT</TableHead>
                    <TableHead className="w-[110px]">Gaiola</TableHead>
                    <TableHead className="w-[130px]">Cluster</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[150px]">Cidade</TableHead>
                    <TableHead className="w-[180px]">Bairro</TableHead>
                    <TableHead className="w-[180px]">Solicitante</TableHead>
                    <TableHead className="w-[420px]">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((route) => {
                    const isSelected = selectedRoute?.id === route.id
                    return (
                      <TableRow
                        key={route.id}
                        onClick={() => toggleRouteSelection(route)}
                        className={`cursor-pointer ${
                          route.noShow
                            ? "border-l-4 border-destructive bg-destructive/5 hover:bg-destructive/10 dark:bg-destructive/10 dark:hover:bg-destructive/15"
                            : ""
                        } ${isSelected ? "ring-1 ring-inset ring-primary" : ""}`}
                      >
                        <TableCell className="truncate font-mono text-xs text-muted-foreground">{route.atId || route.id}</TableCell>
                        <TableCell className="truncate text-sm text-card-foreground">{route.gaiola || "-"}</TableCell>
                        <TableCell className="truncate text-sm text-card-foreground">{route.cluster || "-"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              route.noShow
                                ? "border-destructive/30 bg-destructive/15 text-destructive"
                                : isTelegramRequested(route)
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                                : route.status === "APROVADA"
                                  ? "border-chart-1/30 bg-chart-1/10 text-chart-1"
                                : route.status === "ATRIBUIDA"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                                  : route.status === "BLOQUEADA"
                                    ? "border-chart-3/30 bg-chart-3/10 text-chart-3"
                                    : "border-chart-2/30 bg-chart-2/10 text-chart-2"
                            }
                          >
                            {route.noShow
                              ? "No-Show"
                              : isTelegramRequested(route)
                                ? "SOLICITADA"
                                : route.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="truncate text-sm text-card-foreground">{route.cidade}</TableCell>
                        <TableCell className="truncate text-sm text-card-foreground">{route.bairro}</TableCell>
                        <TableCell className="truncate text-sm text-card-foreground">
                          {route.requestedDriverName || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleMarkNoShow(route, false)
                              }}
                              disabled={route.noShow}
                              className="h-8 px-2 text-xs"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              No-Show
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                setAssignRoute(route)
                                setSelectedDriver(isTelegramRequested(route) ? route.requestedDriverId || "" : "")
                                setAssignDriverSearch("")
                              }}
                              className="h-8 px-2 text-xs"
                            >
                              <UserPlus className="mr-2 h-4 w-4" />
                              {isTelegramRequested(route) ? "Aprovar" : "Atribuir"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleReleaseToBot(route)
                              }}
                              disabled={
                                route.status !== "DISPONIVEL" ||
                                (isReleasedToBot(route) && !isTelegramRequested(route)) ||
                                releasingRouteId === route.id
                              }
                              className="h-8 px-2 text-xs"
                            >
                              {releasingRouteId === route.id
                                ? "Liberando..."
                                : isTelegramRequested(route)
                                  ? "Limpar Solicit."
                                  : isReleasedToBot(route)
                                    ? "No Bot"
                                    : "Liberar Bot"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleMakeAvailable(route)
                              }}
                              disabled={route.status === "DISPONIVEL" && !isTelegramRequested(route)}
                              className="h-8 px-2 text-xs"
                            >
                              Liberar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {selectedRoute ? (
              <Card className="h-fit">
                <CardContent className="space-y-4 p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Detalhes da Rota</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedRoute.atId || selectedRoute.id}
                    </p>
                  </div>

                  <div className="grid gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                      <p className="font-medium text-card-foreground">
                        {isTelegramRequested(selectedRoute) ? "SOLICITADA" : selectedRoute.status}
                        {selectedRoute.noShow ? " | No-Show" : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Origem</p>
                      <p className="font-medium text-card-foreground">
                        {selectedRoute.assignmentSource || "-"}
                        {isTelegramApproved(selectedRoute) ? " | Solicitação aprovada" : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Disponivel no Bot</p>
                      <p className="font-medium text-card-foreground">
                        {isReleasedToBot(selectedRoute) ? "Sim" : "Nao"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Motorista solicitado</p>
                      <p className="font-medium text-card-foreground">
                        {selectedRoute.requestedDriverName || selectedRoute.requestedDriverId || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Data e Turno</p>
                      <p className="font-medium text-card-foreground">
                        {selectedRoute.routeDate || "-"} | {selectedRoute.shift || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Local</p>
                      <p className="font-medium text-card-foreground">
                        {selectedRoute.cidade || "-"} | {selectedRoute.bairro || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Gaiola</p>
                      <p className="font-medium text-card-foreground">{selectedRoute.gaiola || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Veiculo</p>
                      <p className="font-medium text-card-foreground">{selectedRoute.requiredVehicleType || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Sugestao DS</p>
                      <p className="font-medium text-card-foreground">{selectedRoute.suggestionDriverDs || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Operacao</p>
                      <p className="font-medium text-card-foreground">
                        KM {selectedRoute.km || "-"} | SPR {selectedRoute.spr || "-"} | Volume {selectedRoute.volume || "-"} | GG {selectedRoute.gg || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold text-foreground">Motorista Atual</h4>
                    <div className="mt-3 grid gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Nome</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.driverName || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">ID</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.driverId || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Veiculo</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.driverVehicleType || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Placa</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.driverPlate || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Acuracia</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.driverAccuracy || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Atribuida em</p>
                        <p className="font-medium text-card-foreground">{selectedRoute.assignedAt || "-"}</p>
                      </div>
                    </div>
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
              {assignRoute && isTelegramRequested(assignRoute) ? "Aprovar Solicitacao" : "Atribuir Rota Manualmente"}
            </DialogTitle>
            <DialogDescription>
              Rota {assignRoute?.atId || assignRoute?.id} - {assignRoute?.cidade}, {assignRoute?.bairro}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Pesquisar motorista por ID ou nome..."
              value={assignDriverSearch}
              onChange={(e) => setAssignDriverSearch(e.target.value)}
              className="mb-3"
            />
            <Select value={selectedDriver} onValueChange={setSelectedDriver}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motorista encontrado..." />
              </SelectTrigger>
              <SelectContent>
                {assignableDrivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} - {d.id} - {d.vehicleType} (Score: {d.priorityScore})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
          if (!open) {
            setBulkAtInput("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar Lista de ATs no Bot</DialogTitle>
            <DialogDescription>
              Cole uma lista de ATs separados por quebra de linha, espaco ou virgula. A liberacao usa o filtro atual de data e turno.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={"AT12345\nAT67890\nAT24680"}
              value={bulkAtInput}
              onChange={(event) => setBulkAtInput(event.target.value)}
              className="min-h-40"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkReleaseOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleBulkReleaseToBot} disabled={isBulkReleasing}>
              {isBulkReleasing ? "Liberando..." : "Liberar no Bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
