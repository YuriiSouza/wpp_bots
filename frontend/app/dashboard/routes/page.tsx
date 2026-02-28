"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Search,
  Download,
  MoreHorizontal,
  UserPlus,
  UserMinus,
  Lock,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  assignRoute as assignRouteRequest,
  blockRoute,
  exportBotAssignedRoutesCsv,
  fetchDrivers,
  fetchRoutes,
  getApiErrorMessage,
  markRouteNoShow,
  unassignRoute,
} from "@/lib/admin-api"
import type { Driver, Route } from "@/lib/types"
import { toast } from "sonner"

export default function RoutesPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [search, setSearch] = useState("")
  const [dayFilter, setDayFilter] = useState(today)
  const [statusFilter, setStatusFilter] = useState("all")
  const [cityFilter, setCityFilter] = useState("all")
  const [vehicleFilter, setVehicleFilter] = useState("all")
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [assignRoute, setAssignRoute] = useState<Route | null>(null)
  const [selectedDriver, setSelectedDriver] = useState("")
  const [assignDriverSearch, setAssignDriverSearch] = useState("")
  const [simulateRoute, setSimulateRoute] = useState<Route | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
    }

    try {
      const [routeData, driverData] = await Promise.all([fetchRoutes(), fetchDrivers()])
      setRoutes(routeData)
      setDrivers(driverData)
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
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await loadData(true)
      toast.success("Rotas atualizadas com sucesso.")
    } catch {
      // loadData already handles non-silent errors; silent refresh keeps this fallback toast.
      toast.error("Nao foi possivel atualizar as rotas")
    } finally {
      setIsRefreshing(false)
    }
  }

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
          r.bairro?.toLowerCase().includes(q) ||
          r.driverName?.toLowerCase().includes(q)
      )
    }
    if (dayFilter) result = result.filter((r) => (r.routeDate || "") === dayFilter)
    if (statusFilter !== "all") result = result.filter((r) => r.status === statusFilter)
    if (cityFilter !== "all") result = result.filter((r) => r.cidade === cityFilter)
    if (vehicleFilter !== "all") result = result.filter((r) => r.requiredVehicleType === vehicleFilter)
    return result.sort((a, b) => {
      const aPriority = a.noShow && a.status === "DISPONIVEL" ? 0 : a.noShow ? 1 : 2
      const bPriority = b.noShow && b.status === "DISPONIVEL" ? 0 : b.noShow ? 1 : 2
      if (aPriority !== bPriority) return aPriority - bPriority
      return (b.routeDate || "").localeCompare(a.routeDate || "")
    })
  }, [routes, search, dayFilter, statusFilter, cityFilter, vehicleFilter])

  const statusCounts = useMemo(() => ({
    total: routes.length,
    DISPONIVEL: routes.filter((r) => r.status === "DISPONIVEL").length,
    ATRIBUIDA: routes.filter((r) => r.status === "ATRIBUIDA").length,
    BLOQUEADA: routes.filter((r) => r.status === "BLOQUEADA").length,
  }), [routes])

  const handleAssign = async () => {
    if (!assignRoute || !selectedDriver) return
    const driver = drivers.find((d) => d.id === selectedDriver)
    if (!driver) return
    try {
      const response = await assignRouteRequest(assignRoute.id, selectedDriver)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === assignRoute.id
            ? {
                ...r,
                status: "ATRIBUIDA" as const,
                driverId: driver.id,
                driverName: driver.name,
                driverVehicleType: driver.vehicleType,
                assignedAt: new Date().toISOString(),
              }
            : r
        )
      )
      toast.success(`Rota ${assignRoute.atId || assignRoute.id} atribuida a ${driver.name}`)
      setAssignRoute(null)
      setSelectedDriver("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atribuir a rota"))
    }
  }

  const handleUnassign = async (route: Route) => {
    try {
      const response = await unassignRoute(route.id)
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
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                assignedAt: null,
              }
            : r
        )
      )
      toast.success(`Rota ${route.atId || route.id} desatribuida`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel desatribuir a rota"))
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
      toast.success(makeAvailable ? `Rota ${route.atId || route.id} liberada como no-show` : `Rota ${route.atId || route.id} marcada como no-show`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel marcar a rota como no-show"))
    }
  }

  const handleBlock = async (route: Route) => {
    try {
      const response = await blockRoute(route.id)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === route.id
            ? {
                ...r,
                status: "BLOQUEADA" as const,
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                assignedAt: null,
              }
            : r
        )
      )
      toast.success(`Rota ${route.atId || route.id} bloqueada`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel bloquear a rota"))
    }
  }

  const getSimulatedDriver = (route: Route) => {
    const eligible = drivers
      .filter((d) => d.vehicleType === route.requiredVehicleType || !route.requiredVehicleType)
      .sort((a, b) => b.priorityScore - a.priorityScore)
    return eligible[0] || null
  }

  const assignableDrivers = useMemo(() => {
    const q = assignDriverSearch.trim().toLowerCase()

    return drivers
      .filter((d) => !assignRoute?.requiredVehicleType || d.vehicleType === assignRoute.requiredVehicleType)
      .filter((d) => {
        if (!q) return true
        return d.id.toLowerCase().includes(q) || (d.name || "").toLowerCase().includes(q)
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
  }, [assignDriverSearch, assignRoute, drivers])

  const handleMakeAvailable = async (route: Route) => {
    try {
      const response = await unassignRoute(route.id)
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
                driverId: null,
                driverName: null,
                driverVehicleType: null,
                assignedAt: null,
              }
            : r
        )
      )
      toast.success(`Rota ${route.atId || route.id} liberada para o bot`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel liberar a rota para o bot"))
    }
  }

  const handleExportCsv = async () => {
    try {
      const csvBlob = await exportBotAssignedRoutesCsv(dayFilter || undefined)
      const blob = new Blob([csvBlob], { type: "text/csv;charset=utf-8;" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const suffix = dayFilter ? `-${dayFilter}` : ""

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
            <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="w-full sm:w-auto">
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Atualizar Rotas
            </Button>
            <Button variant="outline" onClick={handleExportCsv} className="w-full sm:w-auto">
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/30">
              {statusCounts.DISPONIVEL} Disponiveis
            </Badge>
            <Badge variant="outline" className="bg-chart-1/10 text-chart-1 border-chart-1/30">
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
                  placeholder="Buscar por ID, bairro ou motorista..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Input
                type="date"
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                className="w-full sm:w-[160px]"
              />
              <Button variant="outline" onClick={() => setDayFilter(today)} className="w-full sm:w-auto">
                Hoje
              </Button>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Status</SelectItem>
                  <SelectItem value="DISPONIVEL">Disponivel</SelectItem>
                  <SelectItem value="ATRIBUIDA">Atribuida</SelectItem>
                  <SelectItem value="BLOQUEADA">Bloqueada</SelectItem>
                </SelectContent>
              </Select>
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Cidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Cidades</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c} value={c!}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="Veiculo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Veiculos</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v} value={v!}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando rotas...
          </div>
        ) : (
        <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-[1180px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">AT</TableHead>
                <TableHead className="w-[95px]">Data</TableHead>
                <TableHead className="w-[90px]">Gaiola</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[90px]">No-Show</TableHead>
                <TableHead className="w-[120px]">Cidade</TableHead>
                <TableHead className="w-[140px]">Bairro</TableHead>
                <TableHead className="w-[110px]">Veiculo</TableHead>
                <TableHead className="w-[100px]">Sug. DS</TableHead>
                <TableHead className="w-[150px]">Motorista</TableHead>
                <TableHead className="w-[80px]">KM</TableHead>
                <TableHead className="w-[80px]">SPR</TableHead>
                <TableHead className="w-[80px]">Volume</TableHead>
                <TableHead className="w-[70px]">GG</TableHead>
                <TableHead className="w-[180px]">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((route) => (
                <TableRow key={route.id}>
                  <TableCell className="truncate font-mono text-xs text-muted-foreground">{route.atId || route.id}</TableCell>
                  <TableCell className="truncate text-xs text-muted-foreground">{route.routeDate || "-"}</TableCell>
                  <TableCell className="truncate text-sm text-card-foreground">{route.gaiola || "-"}</TableCell>
                  <TableCell><StatusBadge status={route.status} /></TableCell>
                  <TableCell>{route.noShow ? <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">No-Show</Badge> : <span className="text-sm text-muted-foreground">-</span>}</TableCell>
                  <TableCell className="truncate text-sm text-card-foreground">{route.cidade}</TableCell>
                  <TableCell className="truncate text-sm text-card-foreground">{route.bairro}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="max-w-full truncate text-xs">{route.requiredVehicleType}</Badge>
                  </TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">{route.suggestionDriverDs || "-"}</TableCell>
                  <TableCell>
                    {route.driverName ? (
                      <span className="block truncate text-sm font-medium text-card-foreground">{route.driverName}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">{route.km} km</TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">{route.spr || "-"}</TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">{route.volume}</TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">{route.gg || "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {route.status !== "DISPONIVEL" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMakeAvailable(route)}
                          className="h-8 px-2 text-xs"
                        >
                          Liberar
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Acoes</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {route.status === "DISPONIVEL" && (
                            <DropdownMenuItem onClick={() => setAssignRoute(route)}>
                              <UserPlus className="mr-2 h-4 w-4" /> Atribuir Manualmente
                            </DropdownMenuItem>
                          )}
                          {route.status === "ATRIBUIDA" && (
                            <DropdownMenuItem onClick={() => handleUnassign(route)}>
                              <UserMinus className="mr-2 h-4 w-4" /> Desatribuir
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleMarkNoShow(route, route.status === "ATRIBUIDA")}>
                            <RefreshCw className="mr-2 h-4 w-4" /> {route.status === "ATRIBUIDA" ? "No-Show e Liberar" : "Marcar No-Show"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSimulateRoute(route)}>
                            <Sparkles className="mr-2 h-4 w-4" /> Simular Atribuicao
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {route.status !== "BLOQUEADA" && (
                            <DropdownMenuItem onClick={() => handleBlock(route)} className="text-destructive">
                              <Lock className="mr-2 h-4 w-4" /> Bloquear Rota
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem>
                            <RefreshCw className="mr-2 h-4 w-4" /> Reprocessar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
            <DialogTitle>Atribuir Rota Manualmente</DialogTitle>
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
            <Button onClick={handleAssign} disabled={!selectedDriver}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simulate Dialog */}
      <Dialog open={!!simulateRoute} onOpenChange={() => setSimulateRoute(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simulacao de Atribuicao</DialogTitle>
            <DialogDescription>
              Rota {simulateRoute?.atId || simulateRoute?.id} - Veiculo: {simulateRoute?.requiredVehicleType}
            </DialogDescription>
          </DialogHeader>
          {simulateRoute && (() => {
            const best = getSimulatedDriver(simulateRoute)
            return best ? (
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground mb-2">O algoritmo escolheria:</p>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-card-foreground">{best.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {best.vehicleType} | DS: {best.ds} | Score: {best.priorityScore} | No-Show: {best.noShowCount}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum motorista elegivel encontrado.</p>
            )
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSimulateRoute(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
