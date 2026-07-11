"use client"

import { useCallback, useEffect, useState } from "react"
import { MessageCircle, AlertCircle, Users, Activity, Wifi, WifiOff, RefreshCw, Bike, MapPin, Clock } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { fetchBotHealth, getApiErrorMessage, type BotHealthPayload, type QueueEntry } from "@/lib/admin-api"
import { toast } from "sonner"

const STATE_LABEL: Record<string, string> = {
  MENU: "Menu",
  CHOOSING_CITY: "Escolhendo cidade",
  CHOOSING_ROUTE: "Escolhendo rota",
  WAITING_ID: "Aguardando ID",
  HELP_MENU: "Dúvidas",
  SUPPORT_CHAT: "Suporte",
}

function stateLabel(s: string | null) {
  return s ? (STATE_LABEL[s] ?? s) : "-"
}

function DriverRow({ entry, badge }: { entry: QueueEntry; badge: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-2 w-2 rounded-full bg-success shrink-0 animate-pulse" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-card-foreground truncate">
            {entry.driverName || entry.driverId || entry.chatId}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.vehicleType || "-"} · {stateLabel(entry.currentState)}
            {typeof entry.priorityScore === "number" ? ` · Score ${entry.priorityScore}` : ""}
          </p>
        </div>
      </div>
      {badge}
    </div>
  )
}

function WaitingRow({ entry, position }: { entry: QueueEntry; position: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{position}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-card-foreground truncate">
            {entry.driverName || entry.driverId || entry.chatId}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.vehicleType || "-"} · {stateLabel(entry.currentState)}
            {typeof entry.priorityScore === "number" ? ` · Score ${entry.priorityScore}` : ""}
          </p>
        </div>
      </div>
      <Badge variant="outline" className="text-xs shrink-0">
        {entry.chatId}
      </Badge>
    </div>
  )
}

function QueueCard({
  title,
  icon: Icon,
  iconClass,
  active,
  waiting,
}: {
  title: string
  icon: React.ElementType
  iconClass: string
  active: QueueEntry | null
  waiting: QueueEntry[]
}) {
  const total = (active ? 1 : 0) + waiting.length
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconClass}`} />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {total} {total === 1 ? "motorista" : "motoristas"}
          </Badge>
        </div>
        <CardDescription>
          {active ? "1 em atendimento" : "Nenhum em atendimento"}
          {waiting.length > 0 ? ` · ${waiting.length} aguardando` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Fila vazia</p>
        ) : (
          <div className="flex flex-col gap-2">
            {active && (
              <DriverRow
                entry={active}
                badge={
                  <Badge className="text-xs bg-success/15 text-success border-success/30 shrink-0">
                    Em atendimento
                  </Badge>
                }
              />
            )}
            {waiting.map((entry, i) => (
              <WaitingRow key={entry.chatId} entry={entry} position={i + 1} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function BotHealthPage() {
  const [health, setHealth] = useState<BotHealthPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true)
    try {
      const data = await fetchBotHealth()
      setHealth(data)
      setLastUpdatedAt(new Date().toLocaleTimeString("pt-BR"))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel carregar a saude do bot"))
    } finally {
      if (silent) setIsRefreshing(false)
      else setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const safeLoad = async (silent = false) => { if (!active) return; await load(silent) }
    void safeLoad(false)
    const interval = setInterval(() => void safeLoad(true), 5000)
    return () => { active = false; clearInterval(interval) }
  }, [load])

  const healthCards = health
    ? [
        { label: "Msgs/min", value: health.messagesPerMin, icon: MessageCircle, color: "text-chart-1", bg: "bg-chart-1/10" },
        { label: "Erros Recentes", value: health.recentErrors, icon: AlertCircle, color: health.recentErrors > 2 ? "text-destructive" : "text-success", bg: health.recentErrors > 2 ? "bg-destructive/10" : "bg-success/10" },
        { label: "Usuarios Ativos", value: health.totalUsers, icon: Users, color: "text-chart-2", bg: "bg-chart-2/10" },
        { label: "Em Atendimento", value: health.activeConversations, icon: Activity, color: "text-chart-4", bg: "bg-chart-4/10" },
      ]
    : []

  const totalInQueues = health
    ? (health.motoQueue.waiting.length + (health.motoQueue.active ? 1 : 0)) +
      health.cityQueues.reduce((s, c) => s + c.waiting.length + (c.active ? 1 : 0), 0)
    : 0

  return (
    <div className="flex flex-col">
      <PageHeader title="Saude do Bot" breadcrumbs={[{ label: "Saude do Bot" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Painel de Saude do Bot</h2>
            <p className="text-sm text-muted-foreground">Atualiza automaticamente a cada 5 segundos</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ultima atualizacao: {lastUpdatedAt || "-"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`gap-1.5 px-3 py-1.5 ${health?.status === "ONLINE" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}
            >
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
            {/* Métricas */}
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

            {/* Uptime */}
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

            {/* Filas */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-foreground">Filas ao vivo</h3>
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {totalInQueues} total nas filas
                </Badge>
              </div>

              {totalInQueues === 0 ? (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Nenhum motorista nas filas agora.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {/* Fila moto */}
                  {(health.motoQueue.active || health.motoQueue.waiting.length > 0) && (
                    <QueueCard
                      title="Fila Moto"
                      icon={Bike}
                      iconClass="text-chart-3"
                      active={health.motoQueue.active}
                      waiting={health.motoQueue.waiting}
                    />
                  )}

                  {/* Filas por cidade */}
                  {health.cityQueues.map((cq) => (
                    <QueueCard
                      key={cq.group}
                      title={cq.city}
                      icon={MapPin}
                      iconClass="text-chart-1"
                      active={cq.active}
                      waiting={cq.waiting}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Alertas */}
            {health.alerts.length > 0 && (
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
            )}
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
