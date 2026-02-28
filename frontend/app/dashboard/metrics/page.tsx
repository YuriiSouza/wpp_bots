"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, Building2, Timer, TicketCheck } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { useAuthContext } from "@/components/auth-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { fetchSupportMetrics, fetchTicketList } from "@/lib/admin-api"

export default function SupportMetricsPage() {
  const { user } = useAuthContext()
  const [hubFilter, setHubFilter] = useState(user?.role === "ANALISTA" ? user.hubId || "all" : "all")

  const hubsQuery = useQuery({
    queryKey: ["support", "metrics", "hubs", user?.id],
    queryFn: () => fetchTicketList(user),
    enabled: !!user,
  })

  const metricsQuery = useQuery({
    queryKey: ["support", "metrics", user?.id, hubFilter],
    queryFn: () =>
      fetchSupportMetrics(user, {
        hubId: hubFilter === "all" ? undefined : hubFilter,
        status: "ALL",
      }),
    enabled: !!user,
  })

  const metrics = metricsQuery.data

  return (
    <div className="flex flex-col">
      <PageHeader title="Metricas" breadcrumbs={[{ label: "Metricas" }]} />
      <div className="flex flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtro de hub</CardTitle>
          </CardHeader>
          <CardContent className="max-w-sm">
            <Select value={hubFilter} onValueChange={setHubFilter} disabled={user?.role === "ANALISTA"}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um hub" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os hubs</SelectItem>
                {(hubsQuery.data?.hubs || []).map((hub) => (
                  <SelectItem key={hub.id} value={hub.id}>
                    {hub.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {metricsQuery.isLoading || !metrics ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Carregando metricas...
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Tempo medio de resposta" value={`${metrics.avgFirstResponseMinutes} min`} icon={<Timer className="h-4 w-4" />} />
              <MetricCard title="Tempo medio de resolucao" value={`${metrics.avgResolutionMinutes} min`} icon={<TicketCheck className="h-4 w-4" />} />
              <MetricCard title="Taxa de encerramento" value={`${metrics.closureRate}%`} icon={<BarChart3 className="h-4 w-4" />} />
              <MetricCard title="Hubs ativos" value={String(metrics.ticketsByHub.length)} icon={<Building2 className="h-4 w-4" />} />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tickets por hub</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metrics.ticketsByHub.map((item) => (
                    <div key={item.hubId} className="rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.hubName}</p>
                          <p className="text-xs text-muted-foreground">{item.hubId}</p>
                        </div>
                        <Badge variant="secondary">{item.total} tickets</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tickets por analista</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metrics.ticketsByAnalyst.map((item) => (
                    <div key={item.analystId} className="rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{item.analystName}</p>
                        <Badge variant="outline">{item.total}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  icon,
}: {
  title: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">{icon}</div>
      </CardContent>
    </Card>
  )
}
