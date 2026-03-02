"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Map as MapIcon, RefreshCw, Tag } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { RoutePlanningMap } from "@/components/route-planning-map"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchRoutePlanning, fetchRoutePlanningMap, getApiErrorMessage, runSync } from "@/lib/admin-api"
import type { RoutePlanningItem, RoutePlanningMapPayload, RoutePlanningPayload } from "@/lib/types"
import { getCurrentRouteWindow } from "@/lib/route-window"
import { toast } from "sonner"

type ShiftFilter = "all" | "AM" | "PM" | "PM2"

type BrSearchResult = {
  br: string
  searchedBr: RoutePlanningMapPayload["searchedBr"]
  nearbyRoutes: RoutePlanningMapPayload["nearbyRoutes"]
}

export default function RouteConsultPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [shift, setShift] = useState<ShiftFilter>("all")
  const [clusterFilter, setClusterFilter] = useState("all")
  const [atFilter, setAtFilter] = useState("all")
  const [brInput, setBrInput] = useState("")
  const [planningPayload, setPlanningPayload] = useState<RoutePlanningPayload | null>(null)
  const [mapPayload, setMapPayload] = useState<RoutePlanningMapPayload | null>(null)
  const [brResults, setBrResults] = useState<BrSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const searchedBr = useMemo(() => brInput.trim().toUpperCase(), [brInput])

  const loadData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
    }

    const planningPromise = fetchRoutePlanning({
      date,
      shift: shift === "all" ? undefined : shift,
      focus: "DS",
    })

    const mapResponse = await fetchRoutePlanningMap({
      cluster: clusterFilter === "all" ? undefined : clusterFilter,
      br: searchedBr || undefined,
    })
    const planning = await planningPromise

    setPlanningPayload(planning)
    setMapPayload(mapResponse)
    setBrResults(
      searchedBr
        ? [
            {
              br: searchedBr,
              searchedBr: mapResponse.searchedBr,
              nearbyRoutes: mapResponse.nearbyRoutes,
            },
          ]
        : [],
    )
  }

  useEffect(() => {
    let active = true

    const run = async () => {
      try {
        await loadData()
      } catch (error) {
        if (active) {
          toast.error(getApiErrorMessage(error, "Nao foi possivel carregar a consulta de BR"))
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [date, shift, clusterFilter, searchedBr])

  const routeByAtId = useMemo(() => {
    return new Map((planningPayload?.data || []).map((route) => [route.atId, route]))
  }, [planningPayload])

  const allRoutes = useMemo(() => {
    return (mapPayload?.routes || [])
      .map((route) => {
        const planningRoute = routeByAtId.get(route.atId)
        const firstPoint = route.stops?.[0]
        return {
          atId: route.atId,
          color: route.color,
          route: planningRoute || null,
          driverName: planningRoute?.driverName || planningRoute?.driverId || "",
          vehicleType: planningRoute?.requiredVehicleTypeNorm || "",
          nearestStop: firstPoint?.stop ?? null,
          cluster: firstPoint?.cluster || "",
        }
      })
      .sort((left, right) => left.atId.localeCompare(right.atId))
  }, [mapPayload, routeByAtId])

  const listedRoutes = useMemo(() => {
    if (!searchedBr) {
      return []
    }

    const routeById = new Map(allRoutes.map((route) => [route.atId, route]))
    const uniqueRoutes = new Map<
      string,
      (typeof allRoutes)[number] & { distanceKm: number | null; isSameRoute: boolean }
    >()

    brResults.forEach((result) => {
      result.nearbyRoutes.forEach((route) => {
        const mergedRoute = routeById.get(route.atId)
        if (mergedRoute && !uniqueRoutes.has(route.atId)) {
          uniqueRoutes.set(route.atId, {
            ...mergedRoute,
            distanceKm: route.distanceKm ?? null,
            isSameRoute: route.isSameRoute,
          })
        }
      })
    })

    return Array.from(uniqueRoutes.values()).sort((left, right) => {
      const leftDistance = left.distanceKm ?? Number.POSITIVE_INFINITY
      const rightDistance = right.distanceKm ?? Number.POSITIVE_INFINITY
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance
      }
      return left.atId.localeCompare(right.atId)
    })
  }, [allRoutes, brResults, searchedBr])

  const visibleMapRoutes = useMemo(() => {
    const routes = mapPayload?.routes || []
    if (atFilter === "all") return routes
    return routes.filter((route) => route.atId === atFilter)
  }, [atFilter, mapPayload])

  const clusterOptions = useMemo(() => mapPayload?.clusters || [], [mapPayload])

  const applyAtFilter = (nextAtId: string) => {
    setAtFilter((current) => (current === nextAtId ? "all" : nextAtId))
  }

  const copyTextToClipboard = async (text: string) => {
    const value = String(text || "").trim()
    if (!value) return false

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return true
      }
    } catch {
      // Fallback below.
    }

    try {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "absolute"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand("copy")
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }

  const handleRouteClick = async (atId: string) => {
    const copied = await copyTextToClipboard(atId)
    applyAtFilter(atId)

    if (copied) {
      toast.success(`AT ${atId} copiada para a area de transferencia.`)
    } else {
      toast.error("Nao foi possivel copiar a AT automaticamente.")
    }
  }

  const handlePrintLabel = (route: RoutePlanningItem, br?: string | null) => {
    const gaiola = String(route.gaiola || "").trim()
    if (!gaiola) {
      toast.error("Essa rota nao possui gaiola para imprimir.")
      return
    }
    const normalizedBr = String(br || "").trim()

    const labelWindow = window.open("", "_blank", "width=420,height=260")
    if (!labelWindow) {
      toast.error("Nao foi possivel abrir a janela de impressao.")
      return
    }

    const escapedGaiola = gaiola
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;")
    const escapedBr = normalizedBr
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;")

    labelWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Etiqueta ${escapedGaiola}</title>
    <style>
      @page {
        size: 7.3cm 4.3cm;
        margin: 0;
      }
      * { box-sizing: border-box; }
      html, body {
        width: 7.3cm;
        height: 4.3cm;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .label {
        width: 7.3cm;
        height: 4.3cm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1px solid #000;
        gap: 0.2cm;
      }
      .gaiola {
        font-size: 22pt;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .br {
        font-size: 12pt;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
    </style>
  </head>
  <body>
    <div class="label">
      <div class="gaiola">${escapedGaiola}</div>
      ${escapedBr ? `<div class="br">BR ${escapedBr}</div>` : ""}
    </div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.print();
        }, 100);
      });
      window.addEventListener('afterprint', function () {
        window.close();
      });
    </script>
  </body>
</html>`)
    labelWindow.document.close()
  }

  const handleRefresh = async () => {
    const currentWindow = getCurrentRouteWindow()

    setIsRefreshing(true)
    try {
      const syncResponse = await runSync("routes")
      if (!syncResponse.ok) {
        toast.error(syncResponse.message)
        return
      }

      const planningPromise = fetchRoutePlanning({
        date: currentWindow.date,
        shift: currentWindow.shift,
        focus: "DS",
      })

      const mapResponse = await fetchRoutePlanningMap({
        cluster: clusterFilter === "all" ? undefined : clusterFilter,
        br: searchedBr || undefined,
      })
      const planning = await planningPromise

      setDate(currentWindow.date)
      setShift(currentWindow.shift)
      setPlanningPayload(planning)
      setMapPayload(mapResponse)
      setBrResults(
        searchedBr
          ? [
              {
                br: searchedBr,
                searchedBr: mapResponse.searchedBr,
                nearbyRoutes: mapResponse.nearbyRoutes,
              },
            ]
          : [],
      )
      toast.success("Rotas sincronizadas com a planilha e consulta atualizada.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar a consulta"))
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <PageHeader title="Realocacao de volumoso" breadcrumbs={[{ label: "Realocacao de volumoso" }]} />

      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Realocacao de volumoso</h2>
              <p className="text-sm text-muted-foreground">
                Consulte um BR por vez, veja as ATs mais proximas e filtre visualmente a rota no mapa.
              </p>
            </div>
            <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Atualizar
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rotas no mapa</p>
                <p className="mt-2 text-2xl font-semibold">{mapPayload?.routes.length ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">BR</span>
            <Input
              className="w-full"
              placeholder="Digite o codigo do BR."
              value={brInput}
              onChange={(event) => setBrInput(event.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">
              {searchedBr
                ? `Consultando o BR ${searchedBr}.`
                : "Digite um BR para listar apenas as ATs relacionadas."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Mapa das ATs</h3>
                <p className="text-xs text-muted-foreground">Paradas da guia Calculation Tasks em OpenStreetMap.</p>
              </div>
              <MapIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <RoutePlanningMap routes={visibleMapRoutes} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">ATs encontradas</h3>
              <p className="text-xs text-muted-foreground">
                Mostra apenas as ATs relacionadas aos BRs colados. Clique para copiar a AT e filtrar o mapa.
              </p>
            </div>

            <div className="space-y-2">
              {listedRoutes.length ? (
                listedRoutes.map((route) => (
                  <div
                    key={route.atId}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      atFilter === route.atId ? "border-primary bg-primary/10" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleRouteClick(route.atId)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: route.color }} />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{route.atId}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {route.driverName || "Sem motorista"} | {route.vehicleType || "Sem veiculo"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Stop {route.nearestStop ?? "-"} | Cluster {route.cluster || "-"}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-sm font-medium">
                          {route.distanceKm !== null ? `${route.distanceKm.toFixed(2)} km` : "-"}
                        </span>
                        {route.isSameRoute ? (
                          <p className="text-xs text-muted-foreground">mesma rota do BR</p>
                        ) : null}
                      </div>
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => route.route && handlePrintLabel(route.route, searchedBr)}
                      disabled={!route.route}
                    >
                      <Tag className="mr-2 h-4 w-4" />
                      Etiqueta
                    </Button>
                  </div>
                ))
              ) : searchedBr ? (
                <p className="text-xs text-muted-foreground">Nenhuma AT relacionada ao BR informado.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Digite um BR para montar a lista de ATs.</p>
              )}
            </div>

          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando consulta...
        </div>
      ) : null}
    </div>
  )
}
