"use client"

import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { KpiCards } from "@/components/dashboard/kpi-cards"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  BreakdownBarChart,
  BreakdownPieChart,
  NoShowByClusterTrendChart,
  NoShowPerDayChart,
  RoutesPerDayChart,
  RouteDistributionChart,
  TopDriversChart,
} from "@/components/dashboard/dashboard-charts"
import {
  fetchDashboard,
  fetchOperationContext,
  getApiErrorMessage,
  updateOperationContext,
  type DashboardPayload,
} from "@/lib/admin-api"
import { toast } from "sonner"

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [shift, setShift] = useState<"AM" | "PM" | "PM2">("AM")
  const [isSavingShift, setIsSavingShift] = useState(false)
  const [showShiftReminder, setShowShiftReminder] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const hour = new Date().getHours()
  const expectedShift = useMemo<"AM" | "PM" | "PM2">(() => {
    if (hour >= 15) return "PM2"
    if (hour >= 8) return "PM"
    return "AM"
  }, [hour])

  useEffect(() => {
    let active = true

    const loadDashboard = async () => {
      try {
        const [data, context] = await Promise.all([
          fetchDashboard(),
          fetchOperationContext(),
        ])
        if (active) {
          setDashboard(data)
          setShift(context.shift)
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar o dashboard"))
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if ((hour >= 8 && hour < 15 && shift === "AM") || (hour >= 15 && (shift === "AM" || shift === "PM"))) {
      setShowShiftReminder(true)
    } else {
      setShowShiftReminder(false)
    }
  }, [hour, shift])

  const handleShiftChange = async (value: "AM" | "PM" | "PM2") => {
    setShift(value)
    setIsSavingShift(true)
    try {
      const response = await updateOperationContext({
        date: today,
        shift: value,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      setShift(response.context.shift)
      toast.success("Turno vigente atualizado.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o turno vigente"))
    } finally {
      setIsSavingShift(false)
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard Executivo</h2>
          <p className="text-sm text-muted-foreground">Visao geral operacional em tempo real</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Data vigente</Label>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm text-card-foreground">{today}</div>
              </div>
              <div className="space-y-2">
                <Label>Turno vigente</Label>
                <Select value={shift} onValueChange={(value: "AM" | "PM" | "PM2") => void handleShiftChange(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM1</SelectItem>
                    <SelectItem value="PM2">PM2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Janela operacional usada pelo bot para validar rota ativa no dia atual.
              {isSavingShift ? " Salvando..." : ""}
            </p>
          </CardContent>
        </Card>

        {isLoading || !dashboard ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando indicadores do backend...
          </div>
        ) : (
          <>
            <KpiCards stats={dashboard.stats} />

            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
              <RoutesPerDayChart data={dashboard.routesPerDay} />
              <RouteDistributionChart data={dashboard.routeDistribution} />
            </div>

            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
              <TopDriversChart data={dashboard.topDrivers} />
              <RankingTable drivers={dashboard.topDrivers} />
            </div>

            <NoShowAnalyticsSection data={dashboard.noShow} />
          </>
        )}
      </div>

      <Dialog open={showShiftReminder} onOpenChange={setShowShiftReminder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualize o turno vigente</DialogTitle>
            <DialogDescription>
              Agora são {hour}:00 e o turno selecionado ainda é {shift === "PM" ? "PM1" : shift}. O turno esperado para este horário é {expectedShift === "PM" ? "PM1" : expectedShift}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShiftReminder(false)}>
              Lembrar depois
            </Button>
            <Button onClick={() => void handleShiftChange(expectedShift)}>
              Mudar para {expectedShift === "PM" ? "PM1" : expectedShift}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RankingTable({ drivers }: { drivers: DashboardPayload["topDrivers"] }) {
  const sorted = [...drivers].sort((a, b) => b.score - a.score)
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h3 className="text-base font-semibold text-card-foreground">Ranking por DS</h3>
        <p className="text-xs text-muted-foreground">Top motoristas ordenados por DS</p>
      </div>
      <div className="divide-y">
        {sorted.map((d, i) => (
          <div key={`${d.name}-${d.score}-${i}`} className="flex items-center gap-3 px-4 py-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground truncate">{d.name}</p>
              <p className="text-xs text-muted-foreground">{d.routes} rotas</p>
            </div>
            <span className="text-sm font-bold text-card-foreground">{d.score}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NoShowAnalyticsSection({ data }: { data: DashboardPayload["noShow"] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xl font-semibold text-foreground">Analise de No-Show</h3>
        <p className="text-sm text-muted-foreground">Visao dedicada para recorrencia, concentracao e padroes operacionais</p>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="No-Show Total" value={String(data.summary.total)} hint="Historico consolidado" />
        <MetricCard label="Ultimos 30 Dias" value={String(data.summary.last30Days)} hint="Janela recente" />
        <MetricCard label="No-Show Hoje" value={String(data.summary.today)} hint="Referencia do dia atual" />
        <MetricCard label="Taxa de No-Show" value={`${data.summary.rate}%`} hint="Sobre o total de rotas registradas" />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cidades Afetadas" value={String(data.summary.affectedCities)} hint={data.summary.topCity ? `Maior concentracao: ${data.summary.topCity}` : "Sem destaque"} />
        <MetricCard label="Clusters Afetados" value={String(data.summary.affectedClusters)} hint={data.summary.topCluster ? `Maior concentracao: ${data.summary.topCluster}` : "Sem destaque"} />
        <MetricCard label="Turno Mais Critico" value={data.summary.topShift || "-"} hint="Maior volume recente" />
        <MetricCard label="Cidade Mais Critica" value={data.summary.topCity || "-"} hint="Recorrencia mais alta" />
      </div>

      <div className="grid gap-4 grid-cols-1">
        <NoShowPerDayChart data={data.byDay} />
      </div>

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-3">
        <BreakdownPieChart title="No-Show por Turno" description="Onde o problema concentra mais" data={data.byShift} />
        <BreakdownPieChart title="No-Show por Cidade" description="Top cidades com maior incidencia" data={data.byCity} />
        <BreakdownBarChart title="No-Show por Dia da Semana" description="Distribuicao semanal" data={data.byWeekday} />
      </div>

      <div className="grid gap-4 grid-cols-1">
        <NoShowByClusterTrendChart data={data.byClusterTrend} />
      </div>

      <div className="grid gap-4 grid-cols-1">
        <RecentNoShowCard rows={data.recentRoutes} />
      </div>
    </div>
  )
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-card-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: Array<{ label: string; count: number }>
}) {
  const max = Math.max(...items.map((item) => item.count), 1)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={`${title}-${item.label}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-card-foreground">{item.label}</span>
                  <Badge variant="outline">{item.count}</Badge>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.max(6, (item.count / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem no-show suficiente para esta visao.</p>
        )}
      </CardContent>
    </Card>
  )
}

function RecentNoShowCard({ rows }: { rows: DashboardPayload["noShow"]["recentRoutes"] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">No-Show Recentes</CardTitle>
        <CardDescription>Ultimas ocorrencias registradas</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{row.atId}</span>
                    <Badge variant="outline">{row.shift || "Sem turno"}</Badge>
                    <Badge variant="outline">{row.cluster || "Sem cluster"}</Badge>
                  </div>
                  <Badge variant="secondary">{row.assignmentSource}</Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-card-foreground">
                  {row.cidade || "Sem cidade"}{row.bairro ? ` | ${row.bairro}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.driverName || "Sem motorista"}{row.driverId ? ` (${row.driverId})` : ""} {row.driverVehicleType ? `| ${row.driverVehicleType}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.routeDate || row.updatedAt || row.createdAt || "-"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum no-show recente encontrado.</p>
        )}
      </CardContent>
    </Card>
  )
}
