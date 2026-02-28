"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { KpiCards } from "@/components/dashboard/kpi-cards"
import {
  RoutesPerDayChart,
  RouteDistributionChart,
  TopDriversChart,
} from "@/components/dashboard/dashboard-charts"
import { fetchDashboard, getApiErrorMessage, type DashboardPayload } from "@/lib/admin-api"
import { toast } from "sonner"

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadDashboard = async () => {
      try {
        const data = await fetchDashboard()
        if (active) {
          setDashboard(data)
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

  return (
    <div className="flex flex-col">
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard Executivo</h2>
          <p className="text-sm text-muted-foreground">Visao geral operacional em tempo real</p>
        </div>

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
          </>
        )}
      </div>
    </div>
  )
}

function RankingTable({ drivers }: { drivers: DashboardPayload["topDrivers"] }) {
  const sorted = [...drivers].sort((a, b) => b.score - a.score)
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h3 className="text-base font-semibold text-card-foreground">Ranking Priority Score</h3>
        <p className="text-xs text-muted-foreground">Top motoristas ordenados por score</p>
      </div>
      <div className="divide-y">
        {sorted.map((d, i) => (
          <div key={d.name} className="flex items-center gap-3 px-4 py-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground truncate">{d.name}</p>
              <p className="text-xs text-muted-foreground">{d.routes} rotas</p>
            </div>
            <span className="text-sm font-bold text-card-foreground">{d.score}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
