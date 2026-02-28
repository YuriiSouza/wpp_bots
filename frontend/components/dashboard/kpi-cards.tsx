"use client"

import { Users, MapPin, TrendingUp, ShieldBan, RefreshCw, BarChart3 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { DashboardStats } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"

interface KpiCardsProps {
  stats: DashboardStats
}

export function KpiCards({ stats }: KpiCardsProps) {
  const cards = [
    {
      label: "Motoristas Ativos",
      value: stats.totalDrivers,
      icon: Users,
      color: "text-chart-1",
      bg: "bg-chart-1/10",
    },
    {
      label: "Rotas Disponiveis",
      value: stats.routesAvailable,
      icon: MapPin,
      color: "text-chart-2",
      bg: "bg-chart-2/10",
    },
    {
      label: "Rotas Atribuidas",
      value: stats.routesAssigned,
      icon: TrendingUp,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      label: "Taxa Ocupacao",
      value: `${stats.occupationRate}%`,
      icon: BarChart3,
      color: "text-chart-4",
      bg: "bg-chart-4/10",
    },
    {
      label: "Bloqueados",
      value: stats.blockedDrivers,
      icon: ShieldBan,
      color: "text-chart-3",
      bg: "bg-chart-3/10",
    },
    {
      label: "Ultima Sync",
      value: stats.lastSync
        ? formatDistanceToNow(new Date(stats.lastSync.startedAt), { addSuffix: true, locale: ptBR })
        : "N/A",
      icon: RefreshCw,
      color: "text-chart-5",
      bg: "bg-chart-5/10",
      subtitle: stats.lastSync?.status === "SUCCESS" ? "Sucesso" : "Falha",
    },
  ]

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.bg}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-xl font-bold text-card-foreground">{card.value}</p>
                {card.subtitle && (
                  <p className={`text-xs ${card.subtitle === "Sucesso" ? "text-success" : "text-destructive"}`}>
                    {card.subtitle}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
