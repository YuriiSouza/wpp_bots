"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Map, RefreshCw, Send, Sparkles, Wand2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { RoutePlanningMap } from "@/components/route-planning-map"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  assignRoute,
  fetchRoutePlanning,
  fetchRoutePlanningMap,
  getApiErrorMessage,
  runRoutePlanning as runRoutePlanningRequest,
} from "@/lib/admin-api"
import type { RoutePlanningItem, RoutePlanningMapPayload, RoutePlanningPayload } from "@/lib/types"
import { toast } from "sonner"

type ShiftFilter = "all" | "AM" | "PM" | "PM2"
type PlanningFocus = "DS" | "VOLUME"

export default function RoutePlanningPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [shift, setShift] = useState<ShiftFilter>("all")
  const [focus, setFocus] = useState<PlanningFocus>("DS")
  const [atFilter, setAtFilter] = useState("all")
  const [clusterFilter, setClusterFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [brInput, setBrInput] = useState("")
  const [brFilter, setBrFilter] = useState("")
  const [payload, setPayload] = useState<RoutePlanningPayload | null>(null)
  const [mapPayload, setMapPayload] = useState<RoutePlanningMapPayload | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RoutePlanningItem | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState("")
  const [driverSearch, setDriverSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const loadPlanningData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
    }

    const [planning, map] = await Promise.all([
      fetchRoutePlanning({
        date,
        shift: shift === "all" ? undefined : shift,
        atId: atFilter === "all" ? undefined : atFilter,
        focus,
      }),
      fetchRoutePlanningMap({
        atId: atFilter === "all" ? undefined : atFilter,
        cluster: clusterFilter === "all" ? undefined : clusterFilter,
        br: brFilter || undefined,
      }),
    ])

    setPayload(planning)
    setMapPayload(map)
  }

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        await loadPlanningData()
        if (!active) return
      } catch (error) {
        if (active) {
          toast.error(getApiErrorMessage(error, "Nao foi possivel carregar o planejamento"))
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [date, shift, focus, atFilter, clusterFilter, brFilter])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await loadPlanningData(true)
      toast.success("Dados da planilha atualizados com sucesso.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar os dados da planilha"))
    } finally {
      setIsRefreshing(false)
    }
  }

  const filteredRoutes = useMemo(() => {
    const data = payload?.data || []
    const query = search.trim().toLowerCase()
    if (!query) return data

    return data.filter((route) => {
      return [
        route.atId,
        route.bairro,
        route.cidade,
        route.driverId,
        route.driverName,
        route.requestedDriverId,
        route.suggestedDriverId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
  }, [payload, search])

  const clusterOptions = useMemo(() => mapPayload?.clusters || [], [mapPayload])

  const eligibleDrivers = useMemo(() => {
    if (!selectedRoute || !payload) return []

    const query = driverSearch.trim().toLowerCase()
    return payload.drivers
      .filter((driver) => driver.available)
      .filter((driver) => {
        if (!selectedRoute.requiredVehicleTypeNorm || selectedRoute.requiredVehicleTypeNorm !== "MOTO") {
          return true
        }
        return driver.vehicleType === "MOTO"
      })
      .filter((driver) => {
        if (!query) return true
        return (
          driver.id.toLowerCase().includes(query) ||
          driver.vehicleType.toLowerCase().includes(query) ||
          driver.profile.toLowerCase().includes(query)
        )
      })
      .sort((left, right) => right.ds - left.ds)
  }, [driverSearch, payload, selectedRoute])

  const handleRunPlanning = async () => {
    setIsRunning(true)
    try {
      const response = await runRoutePlanningRequest({
        date,
        shift: shift === "all" ? undefined : shift,
        focus,
      })
      toast.success(`${response.message} ${response.totalAssignments} sugestoes geradas.`)

      await loadPlanningData(true)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel rodar o planejamento"))
    } finally {
      setIsRunning(false)
    }
  }

  const handleSendRequest = async () => {
    if (!selectedRoute || !selectedDriverId) return

    setIsSending(true)
    try {
      const response = await assignRoute(selectedRoute.id, selectedDriverId)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      toast.success(`Solicitacao enviada para a rota ${selectedRoute.atId}`)
      setSelectedRoute(null)
      setSelectedDriverId("")
      setDriverSearch("")

      await loadPlanningData(true)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel enviar a solicitacao"))
    } finally {
      setIsSending(false)
    }
  }

  const openRequestDialog = (route: RoutePlanningItem, driverId?: string | null) => {
    setSelectedRoute(route)
    setSelectedDriverId(driverId || "")
    setDriverSearch("")
  }

  const applyAtFilter = (nextAtId: string) => {
    setAtFilter((current) => (current === nextAtId ? "all" : nextAtId))
  }

  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <PageHeader title="Planejamento de Rota" breadcrumbs={[{ label: "Planejamento de Rota" }]} />

      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Distribuicao e solicitacoes</h2>
              <p className="text-sm text-muted-foreground">
                Veja as rotas do dia, destaque no-show disponivel, aplique a regra de cluster/DS e envie solicitacoes sem depender do Google Sheets.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing || isRunning}>
                {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Atualizar Dados
              </Button>
              <Button onClick={handleRunPlanning} disabled={isRunning || isRefreshing}>
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Rodar Planejamento
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data</span>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Turno</span>
              <Select value={shift} onValueChange={(value) => setShift(value as ShiftFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                  <SelectItem value="PM2">PM2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Foco</span>
              <Select value={focus} onValueChange={(value) => setFocus(value as PlanningFocus)}>
                <SelectTrigger>
                  <SelectValue placeholder="DS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DS">DS</SelectItem>
                  <SelectItem value="VOLUME">Volume</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster</span>
              <Select value={clusterFilter} onValueChange={setClusterFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {clusterOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 xl:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Busca</span>
              <Input
                placeholder="AT, motorista, bairro..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rotas</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.routes ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">No-show</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.noShowAvailable ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Telegram</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.telegramRequested ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Manual</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.manualRequested ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendentes</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.pendingRequest ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sugestoes</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.suggestions ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Rotas planejadas</h3>
                <p className="text-xs text-muted-foreground">
                  Solicitacoes do bot, no-show reaberto e sugestoes da regra. Foco atual: {focus}.
                </p>
              </div>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>AT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Sugestao</TableHead>
                    <TableHead>Motorista Atual</TableHead>
                    <TableHead>Bairro</TableHead>
                    <TableHead>Volume</TableHead>
                    <TableHead>Acao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.map((route) => (
                    <TableRow
                      key={route.id}
                      className={`cursor-pointer ${atFilter === route.atId ? "bg-primary/5" : ""}`}
                      onClick={() => applyAtFilter(route.atId || route.id)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{route.atId}</span>
                          <span className="text-xs text-muted-foreground">
                            {route.shift || "Sem turno"}{route.noShow ? " | no-show" : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={route.status} />
                      </TableCell>
                      <TableCell>
                        {route.hasTelegramRequest ? (
                          <Badge variant="secondary">Telegram</Badge>
                        ) : route.hasManualRequest ? (
                          <Badge variant="outline">Manual</Badge>
                        ) : (
                          <Badge variant="outline">Sem solicitacao</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {route.suggestedDriverId ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{route.suggestedDriverId}</span>
                            <span className="text-xs text-muted-foreground">
                              {route.suggestedDriverVehicle} | DS {route.suggestedDriverDs?.toFixed(2)} | {route.suggestedPhase}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem sugestao</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{route.driverName || route.driverId || "-"}</span>
                          <span className="text-xs text-muted-foreground">{route.requestedDriverId || "Sem motorista"}</span>
                        </div>
                      </TableCell>
                      <TableCell>{route.bairro || "-"}</TableCell>
                      <TableCell>{route.volume || "-"}</TableCell>
                      <TableCell>
                        {!route.requestedDriverId ? (
                          <div className="flex flex-wrap gap-2">
                            {route.suggestedDriverId ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openRequestDialog(route, route.suggestedDriverId)
                                }}
                              >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Usar sugestao
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                openRequestDialog(route)
                              }}
                            >
                              <Send className="mr-2 h-4 w-4" />
                              Selecionar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Solicitacao ja enviada</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredRoutes.length ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                        Nenhuma rota encontrada para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Mapa das ATs</h3>
                <p className="text-xs text-muted-foreground">Paradas da guia Calculation Tasks, em sequencia, sobre OpenStreetMap. Zoom baixo oculta pontos individuais.</p>
              </div>
              <Map className="h-4 w-4 text-muted-foreground" />
            </div>
            <RoutePlanningMap routes={mapPayload?.routes || []} />
            <div className="flex flex-wrap gap-2">
              {(mapPayload?.routes || []).slice(0, 8).map((route) => (
                <button
                  key={route.atId}
                  type="button"
                  onClick={() => applyAtFilter(route.atId)}
                  className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted ${
                    atFilter === route.atId ? "border-primary bg-primary/10 text-foreground" : ""
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: route.color }} />
                  {route.atId}
                </button>
              ))}
              {(mapPayload?.routes || []).length > 8 ? (
                <Badge variant="outline">+{(mapPayload?.routes || []).length - 8} rotas</Badge>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border p-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Buscar BR</h4>
                <p className="text-xs text-muted-foreground">
                  Digite o BR da coluna H para localizar o pacote e ver quais rotas passam mais perto dele.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex.: BR12345"
                  value={brInput}
                  onChange={(event) => setBrInput(event.target.value.toUpperCase())}
                />
                <Button
                  variant="outline"
                  onClick={() => setBrFilter(brInput.trim().toUpperCase())}
                  disabled={!brInput.trim()}
                >
                  Buscar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBrInput("")
                    setBrFilter("")
                  }}
                  disabled={!brInput && !brFilter}
                >
                  Limpar
                </Button>
              </div>

              {mapPayload?.searchedBr ? (
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  {mapPayload.searchedBr.latitude !== null ? (
                    <>
                      BR {mapPayload.searchedBr.br} encontrado em AT {mapPayload.searchedBr.atId || "-"}, parada{" "}
                      {mapPayload.searchedBr.stop ?? "-"}, cluster {mapPayload.searchedBr.cluster || "-"}.
                    </>
                  ) : (
                    <>BR {mapPayload.searchedBr.br} nao foi encontrado nos dados carregados.</>
                  )}
                </div>
              ) : null}

              {mapPayload?.nearbyRoutes?.length ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rotas proximas</p>
                  <div className="space-y-2">
                    {mapPayload.nearbyRoutes.map((route) => (
                      <button
                        key={`${route.atId}-${route.nearestStop}`}
                        type="button"
                        onClick={() => applyAtFilter(route.atId)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                          atFilter === route.atId ? "border-primary bg-primary/10" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: route.color }} />
                          <div className="flex flex-col">
                            <span className="font-medium">{route.atId}</span>
                            <span className="text-xs text-muted-foreground">
                              {route.driverName || "Sem motorista"} | {route.vehicleType || "Sem veiculo"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Stop {route.nearestStop} | Cluster {route.cluster || "-"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium">{route.distanceKm.toFixed(2)} km</span>
                          {route.isSameRoute ? (
                            <p className="text-xs text-muted-foreground">mesma rota do BR</p>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : brFilter ? (
                <p className="text-xs text-muted-foreground">Nenhuma rota proxima encontrada para esse BR.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!selectedRoute}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRoute(null)
            setSelectedDriverId("")
            setDriverSearch("")
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Enviar solicitacao</DialogTitle>
            <DialogDescription>
              Selecione um motorista para a rota {selectedRoute?.atId}. Essa acao vai registrar a solicitacao na planilha e no painel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Buscar por ID, veiculo ou perfil"
              value={driverSearch}
              onChange={(event) => setDriverSearch(event.target.value)}
            />

            <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motorista" />
              </SelectTrigger>
              <SelectContent>
                {eligibleDrivers.map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.id} | {driver.vehicleType} | DS {driver.ds.toFixed(2)} | {driver.profile}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedRoute?.suggestedObservation ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                Sugestao atual: {selectedRoute.suggestedObservation}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRoute(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSendRequest} disabled={!selectedDriverId || isSending}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar solicitacao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
