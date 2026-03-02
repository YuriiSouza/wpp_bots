"use client"

import { useEffect, useMemo, useState } from "react"
import { formatDistanceToNowStrict } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import {
  BellRing,
  Clock3,
  MessageCircle,
  Send,
  Signal,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/page-header"
import { useAuthContext } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
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
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import {
  assumeTicket,
  closeTicket,
  fetchAssignableAnalysts,
  fetchTicketContext,
  fetchTicketList,
  fetchTicketMessages,
  sendSupportMessage,
  transferTicket,
} from "@/lib/admin-api"
import type { Analyst, SupportMessage, SupportTicketStatus } from "@/lib/support-types"
import { useSupportRealtime } from "@/hooks/use-support-realtime"

const statusOptions: Array<{ value: SupportTicketStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "Todos os status" },
  { value: "WAITING_ANALYST", label: "Aguardando analista" },
  { value: "IN_PROGRESS", label: "Em atendimento" },
  { value: "WAITING_DRIVER", label: "Aguardando motorista" },
  { value: "CLOSED", label: "Encerrado" },
]

const statusLabel: Record<SupportTicketStatus, string> = {
  WAITING_ANALYST: "Aguardando analista",
  IN_PROGRESS: "Em atendimento",
  WAITING_DRIVER: "Aguardando motorista",
  CLOSED: "Encerrado",
}

export default function SupportCenterPage() {
  const { user, hasRole } = useAuthContext()
  const queryClient = useQueryClient()
  const [hubFilter, setHubFilter] = useState(user?.role === "ANALISTA" ? user.hubId || "all" : "all")
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "ALL">("ALL")
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [selectedAnalystId, setSelectedAnalystId] = useState("")
  const [liveMessages, setLiveMessages] = useState<SupportMessage[]>([])

  useEffect(() => {
    if (user?.role === "ANALISTA" && user.hubId) {
      setHubFilter(user.hubId)
    }
  }, [user])

  const ticketsQuery = useQuery({
    queryKey: ["support", "tickets", user?.id, hubFilter, statusFilter],
    queryFn: () =>
      fetchTicketList(user, {
        hubId: hubFilter === "all" ? undefined : hubFilter,
        status: statusFilter,
      }),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })

  const tickets = ticketsQuery.data?.tickets || []
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || tickets[0] || null,
    [selectedTicketId, tickets]
  )

  useEffect(() => {
    if (selectedTicket && selectedTicket.id !== selectedTicketId) {
      setSelectedTicketId(selectedTicket.id)
    }
    if (!selectedTicket && selectedTicketId) {
      setSelectedTicketId(null)
    }
  }, [selectedTicket, selectedTicketId])

  const messagesQuery = useQuery({
    queryKey: ["support", "messages", selectedTicket?.id],
    queryFn: () => fetchTicketMessages(selectedTicket!.id),
    enabled: !!selectedTicket,
    refetchInterval: selectedTicket ? 3000 : false,
    refetchIntervalInBackground: true,
  })

  const contextQuery = useQuery({
    queryKey: ["support", "context", selectedTicket?.id],
    queryFn: () => fetchTicketContext(selectedTicket!.id),
    enabled: !!selectedTicket,
    refetchInterval: selectedTicket ? 5000 : false,
    refetchIntervalInBackground: true,
  })

  const analystsQuery = useQuery({
    queryKey: ["support", "analysts", selectedTicket?.id, user?.id],
    queryFn: () => fetchAssignableAnalysts(user!, selectedTicket!.id),
    enabled: !!user && !!selectedTicket && isTransferOpen,
  })

  useEffect(() => {
    setLiveMessages(messagesQuery.data || [])
  }, [messagesQuery.data, selectedTicket?.id])

  const { isConnected, typing, lastEvent, sendTyping } = useSupportRealtime(
    selectedTicket?.id || null,
    typeof window !== "undefined" ? localStorage.getItem("auth_token") : null
  )

  useEffect(() => {
    if (lastEvent?.message) {
      setLiveMessages((current) =>
        current.some((message) => message.id === lastEvent.message!.id)
          ? current
          : [...current, lastEvent.message!]
      )
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] })
    }
  }, [lastEvent, queryClient])

  const assumeMutation = useMutation({
    mutationFn: (ticketId: string) => assumeTicket(user!, ticketId),
    onSuccess: (ticket) => {
      toast.success(`Ticket ${ticket.protocol} assumido por ${user?.name}`)
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] })
    },
    onError: () => toast.error("Nao foi possivel assumir o ticket"),
  })

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      sendSupportMessage({
        ticketId: selectedTicket!.id,
        body,
        analyst: { id: user!.id, name: user!.name },
      }),
    onMutate: async (body: string) => {
      if (!selectedTicket || !user || !body.trim()) return
      const tempMessage: SupportMessage = {
        id: `temp-${Date.now()}`,
        ticketId: selectedTicket.id,
        authorType: "ANALYST",
        authorId: user.id,
        authorName: user.name,
        body,
        telegramText: `${user.name}: ${body}`,
        createdAt: new Date().toISOString(),
        pending: true,
      }
      setLiveMessages((current) => [...current, tempMessage])
      setDraft("")
    },
    onSuccess: (message) => {
      setLiveMessages((current) => current.filter((item) => !item.pending).concat(message))
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] })
      void queryClient.invalidateQueries({ queryKey: ["support", "messages", selectedTicket?.id] })
    },
    onError: () => toast.error("Nao foi possivel enviar a mensagem"),
  })

  const closeMutation = useMutation({
    mutationFn: () => closeTicket(selectedTicket!.id),
    onSuccess: (ticket) => {
      toast.success(`Atendimento ${ticket.protocol} encerrado`)
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] })
    },
    onError: () => toast.error("Nao foi possivel encerrar o atendimento"),
  })

  const transferMutation = useMutation({
    mutationFn: () => transferTicket({ ticketId: selectedTicket!.id, analystId: selectedAnalystId }),
    onSuccess: (ticket) => {
      toast.success(`Ticket transferido para ${ticket.analystName}`)
      setIsTransferOpen(false)
      setSelectedAnalystId("")
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] })
    },
    onError: () => toast.error("Nao foi possivel transferir o atendimento"),
  })

  const ticketSummary = useMemo(() => {
    const waiting = tickets.filter((ticket) => ticket.status === "WAITING_ANALYST").length
    const inProgress = tickets.filter((ticket) => ticket.status === "IN_PROGRESS").length
    const waitingDriver = tickets.filter((ticket) => ticket.status === "WAITING_DRIVER").length
    const unread = tickets.reduce((total, ticket) => total + ticket.unreadCount, 0)
    return { waiting, inProgress, waitingDriver, unread }
  }, [tickets])

  const canTransfer = hasRole("ADMIN", "SUPERVISOR") || (user?.role === "ANALISTA" && selectedTicket?.hubId === user.hubId)

  return (
    <div className="flex flex-col">
      <PageHeader title="Central de Atendimento" breadcrumbs={[{ label: "Atendimento" }]} />
      <div className="flex flex-col gap-6 p-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Na fila" value={ticketSummary.waiting} icon={<Clock3 className="h-4 w-4" />} tone="amber" />
          <SummaryCard title="Em atendimento" value={ticketSummary.inProgress} icon={<UserCheck className="h-4 w-4" />} tone="emerald" />
          <SummaryCard title="Aguardando motorista" value={ticketSummary.waitingDriver} icon={<BellRing className="h-4 w-4" />} tone="blue" />
          <SummaryCard title="Nao lidas" value={ticketSummary.unread} icon={<MessageCircle className="h-4 w-4" />} tone="rose" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <Card className="min-h-[72vh]">
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Fila de atendimento</CardTitle>
                <Badge variant="outline" className="gap-1">
                  <Signal className="h-3 w-3" />
                  {ticketsQuery.data?.onlineAnalysts.length || 0} analistas online
                </Badge>
              </div>
              <div className="grid gap-3">
                <Select value={hubFilter} onValueChange={setHubFilter} disabled={user?.role === "ANALISTA"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filtrar hub" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os hubs</SelectItem>
                    {(ticketsQuery.data?.hubs || []).map((hub) => (
                      <SelectItem key={hub.id} value={hub.id}>
                        {hub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SupportTicketStatus | "ALL")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filtrar status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="h-[calc(72vh-76px)] overflow-y-auto space-y-3">
              {ticketsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Carregando fila...
                </div>
              ) : (
                tickets.map((ticket) => {
                  const isSelected = selectedTicket?.id === ticket.id
                  return (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{ticket.driverName}</p>
                          <p className="text-xs text-muted-foreground">{ticket.protocol}</p>
                        </div>
                        {ticket.unreadCount > 0 && (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
                            {ticket.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{statusLabel[ticket.status]}</Badge>
                        <Badge variant="secondary">{ticket.hubName}</Badge>
                        {ticket.queuePosition ? <Badge variant="outline">Fila #{ticket.queuePosition}</Badge> : null}
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{ticket.lastMessagePreview}</p>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          Espera{" "}
                          {formatDistanceToNowStrict(new Date(ticket.waitingSince), {
                            addSuffix: false,
                            locale: ptBR,
                          })}
                        </span>
                        <span>
                          Atualizado{" "}
                          {formatDistanceToNowStrict(new Date(ticket.lastMessageAt), {
                            addSuffix: false,
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card className="min-h-[72vh]">
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Chat em tempo real</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {selectedTicket
                      ? `${selectedTicket.driverName} • ${statusLabel[selectedTicket.status]}`
                      : "Selecione um ticket para iniciar"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    {isConnected ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
                    {isConnected ? "WebSocket online" : "Fallback HTTP"}
                  </Badge>
                  {selectedTicket?.status === "WAITING_ANALYST" ? (
                    <Button
                      size="sm"
                      onClick={() => assumeMutation.mutate(selectedTicket.id)}
                      disabled={assumeMutation.isPending || !user}
                    >
                      Assumir ticket
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex h-[calc(72vh-76px)] flex-col gap-4 p-0">
              <div className="flex-1 space-y-4 overflow-y-auto p-6">
                {messagesQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    Carregando mensagens...
                  </div>
                ) : liveMessages.length ? (
                  liveMessages.map((message) => {
                    const isAnalyst = message.authorType === "ANALYST"
                    return (
                      <div key={message.id} className={`flex ${isAnalyst ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                            isAnalyst ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                          }`}
                        >
                          <p className="mb-1 text-[11px] font-semibold opacity-80">{message.authorName}</p>
                          <p>{message.body}</p>
                          <p className="mt-2 text-[10px] opacity-70">
                            {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {message.pending ? " • enviando" : ""}
                          </p>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                    Ainda nao existem mensagens para este ticket.
                  </div>
                )}
                {typing ? <div className="text-xs text-muted-foreground">Motorista digitando...</div> : null}
              </div>

              <div className="border-t p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => closeMutation.mutate()}
                    disabled={!selectedTicket || closeMutation.isPending || selectedTicket.status === "CLOSED"}
                  >
                    Encerrar atendimento
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsTransferOpen(true)}
                    disabled={!selectedTicket || !canTransfer || selectedTicket.status === "CLOSED"}
                  >
                    Transferir atendimento
                  </Button>
                </div>
                <div className="flex gap-3">
                  <Textarea
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      sendTyping(Boolean(event.target.value.trim()))
                    }}
                    placeholder="Escreva a resposta. O Telegram recebera no formato: NomeDoAnalista: mensagem"
                    rows={3}
                    disabled={!selectedTicket || selectedTicket.status === "CLOSED"}
                  />
                  <Button
                    className="shrink-0 self-end"
                    onClick={() => sendMutation.mutate(draft.trim())}
                    disabled={!selectedTicket || !draft.trim() || sendMutation.isPending || !user}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-[72vh]">
            <CardHeader>
              <CardTitle className="text-base">Contexto operacional</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {contextQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Carregando contexto do motorista...
                </div>
              ) : contextQuery.data ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-4">
                    <p className="text-lg font-semibold text-foreground">{contextQuery.data.driverName}</p>
                    <p className="text-sm text-muted-foreground">{contextQuery.data.driverId}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary">{contextQuery.data.hubName}</Badge>
                      <Badge variant="outline">{contextQuery.data.vehicleType || "Sem veiculo"}</Badge>
                      <Badge variant="outline">{contextQuery.data.ds || "Sem DS"}</Badge>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <MetricCell label="NoShowCount" value={String(contextQuery.data.noShowCount)} />
                    <MetricCell label="DeclineRate" value={`${Math.round(contextQuery.data.declineRate * 100)}%`} />
                    <MetricCell label="PriorityScore" value={contextQuery.data.priorityScore.toFixed(1)} />
                    <MetricCell label="Bloqueado" value={contextQuery.data.isBlocked ? "Sim" : "Nao"} />
                    <MetricCell label="Rota ativa" value={contextQuery.data.hasActiveRoute ? "Sim" : "Nao"} />
                    <MetricCell label="Status da rota" value={contextQuery.data.activeRouteStatus || "Sem rota"} />
                  </dl>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Ultimas rotas atribuidas</h3>
                    <div className="space-y-3">
                      {contextQuery.data.lastRoutes.map((route) => (
                        <div key={route.id} className="rounded-xl border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{route.id}</span>
                            <Badge variant="outline">{route.status}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{route.city}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formatDistanceToNowStrict(new Date(route.assignedAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  Selecione um ticket para exibir o painel do motorista.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir atendimento</DialogTitle>
            <DialogDescription>
              Encaminhe o ticket para outro analista do mesmo hub.
            </DialogDescription>
          </DialogHeader>
          <Select value={selectedAnalystId} onValueChange={setSelectedAnalystId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o analista" />
            </SelectTrigger>
            <SelectContent>
              {(analystsQuery.data || []).map((analyst: Analyst) => (
                <SelectItem key={analyst.id} value={analyst.id}>
                  {analyst.name} • {analyst.hubName || "Multihub"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransferOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => transferMutation.mutate()}
              disabled={!selectedAnalystId || transferMutation.isPending}
            >
              Confirmar transferencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: number
  icon: React.ReactNode
  tone: "amber" | "emerald" | "blue" | "rose"
}) {
  const tones = {
    amber: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    blue: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    rose: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  }

  return (
    <Card className={`border ${tones[tone]}`}>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em]">{title}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
        <div className="rounded-2xl bg-background/70 p-3">{icon}</div>
      </CardContent>
    </Card>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  )
}
