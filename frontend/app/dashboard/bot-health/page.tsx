"use client"

import { useCallback, useEffect, useState } from "react"
import { MessageCircle, AlertCircle, Users, Activity, Wifi, WifiOff, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { fetchBotHealth, getApiErrorMessage, type BotHealthPayload } from "@/lib/admin-api"
import { toast } from "sonner"

export default function BotHealthPage() {
  const [health, setHealth] = useState<BotHealthPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) {
      setIsRefreshing(true)
    }
    try {
      const data = await fetchBotHealth()
      setHealth(data)
      setLastUpdatedAt(new Date().toLocaleTimeString("pt-BR"))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel carregar a saude do bot"))
    } finally {
      if (silent) {
        setIsRefreshing(false)
      } else {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    const safeLoad = async (silent = false) => {
      if (!active) return
      await load(silent)
    }

    void safeLoad(false)
    const interval = setInterval(() => void safeLoad(true), 5000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [load])

  const healthCards = health
    ? [
        { label: "Msgs/min", value: health.messagesPerMin, icon: MessageCircle, color: "text-chart-1", bg: "bg-chart-1/10" },
        { label: "Erros Recentes", value: health.recentErrors, icon: AlertCircle, color: health.recentErrors > 2 ? "text-destructive" : "text-success", bg: health.recentErrors > 2 ? "bg-destructive/10" : "bg-success/10" },
        { label: "Usuarios Ativos", value: health.totalUsers, icon: Users, color: "text-chart-2", bg: "bg-chart-2/10" },
        { label: "Conversas em Andamento", value: health.activeConversations, icon: Activity, color: "text-chart-4", bg: "bg-chart-4/10" },
      ]
    : []

  return (
    <div className="flex flex-col">
      <PageHeader title="Saude do Bot" breadcrumbs={[{ label: "Saude do Bot" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Painel de Saude do Bot</h2>
            <p className="text-sm text-muted-foreground">Monitoramento em tempo real do bot Telegram</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ultima atualizacao: {lastUpdatedAt || "-"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`gap-1.5 px-3 py-1.5 ${health?.status === "ONLINE" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}>
              {health?.status === "ONLINE" ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {health?.status === "ONLINE" ? "Online" : "Degradado"}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {isLoading || !health ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Carregando saude do bot...</div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              {healthCards.map((card) => (
                <Card key={card.label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.bg}`}>
                        <card.icon className={`h-5 w-5 ${card.color}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{card.label}</p>
                        <p className="text-2xl font-bold text-card-foreground">{card.value}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Uptime do Bot</CardTitle>
                  <CardDescription>Disponibilidade nas ultimas 24h</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <Progress value={health.uptime} className="h-3" />
                    </div>
                    <span className="text-2xl font-bold text-success">{health.uptime}%</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Conversas Ativas</CardTitle>
                  <CardDescription>Sessoes em andamento no bot</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    {health.conversations.map((conv) => (
                      <div key={conv.phone} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full ${conv.step === "DONE" ? "bg-muted-foreground" : "bg-success animate-pulse"}`} />
                          <div>
                            <p className="text-sm font-medium text-card-foreground font-mono">{conv.phone}</p>
                            <p className="text-xs text-muted-foreground">Step: {conv.step}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-xs ${conv.step === "DONE" ? "bg-muted text-muted-foreground" : "bg-chart-1/15 text-chart-1"}`}>
                          {conv.step === "DONE" ? "Concluido" : "Em andamento"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Alertas Automaticos</CardTitle>
                <CardDescription>Notificacoes do sistema</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {health.alerts.map((alert, index) => (
                    <AlertItem key={`${alert.type}-${index}`} type={alert.type} message={alert.message} time={alert.time} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function AlertItem({ type, message, time }: { type: "warning" | "error" | "info"; message: string; time: string }) {
  const config = {
    warning: { icon: AlertCircle, bg: "bg-warning/10", border: "border-warning/20", text: "text-warning" },
    error: { icon: AlertCircle, bg: "bg-destructive/10", border: "border-destructive/20", text: "text-destructive" },
    info: { icon: Activity, bg: "bg-chart-1/10", border: "border-chart-1/20", text: "text-chart-1" },
  }[type]

  const Icon = config.icon
  return (
    <div className={`flex items-start gap-3 rounded-lg border ${config.border} ${config.bg} p-3`}>
      <Icon className={`h-4 w-4 mt-0.5 ${config.text}`} />
      <div className="flex-1">
        <p className="text-sm text-foreground">{message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
      </div>
    </div>
  )
}
