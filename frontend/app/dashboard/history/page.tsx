"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { useQuery } from "@tanstack/react-query"
import { CalendarRange, Search } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { useAuthContext } from "@/components/auth-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import { Spinner } from "@/components/ui/spinner"
import { fetchSupportHistory, fetchTicketList } from "@/lib/admin-api"
import type { SupportTicketStatus } from "@/lib/support-types"

export default function SupportHistoryPage() {
  const { user } = useAuthContext()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<SupportTicketStatus | "ALL">("ALL")
  const [hubFilter, setHubFilter] = useState(user?.role === "ANALISTA" ? user.hubId || "all" : "all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const hubsQuery = useQuery({
    queryKey: ["support", "history", "hubs", user?.id],
    queryFn: () => fetchTicketList(user),
    enabled: !!user,
  })

  const historyQuery = useQuery({
    queryKey: ["support", "history", user?.id, search, status, hubFilter, from, to],
    queryFn: () =>
      fetchSupportHistory(user, {
        search,
        status,
        hubId: hubFilter === "all" ? undefined : hubFilter,
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: !!user,
  })

  const summary = useMemo(() => {
    const items = historyQuery.data || []
    const avgResolution = items.length
      ? Math.round(items.reduce((sum, item) => sum + item.resolutionMinutes, 0) / items.length)
      : 0
    return { total: items.length, avgResolution }
  }, [historyQuery.data])

  return (
    <div className="flex flex-col">
      <PageHeader title="Historico" breadcrumbs={[{ label: "Historico" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Atendimentos</p>
              <p className="mt-2 text-3xl font-semibold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Resolucao media</p>
              <p className="mt-2 text-3xl font-semibold">{summary.avgResolution} min</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busca historica persistente</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Motorista, ID ou analista"
                className="pl-9"
              />
            </div>
            <Select value={hubFilter} onValueChange={setHubFilter} disabled={user?.role === "ANALISTA"}>
              <SelectTrigger>
                <SelectValue placeholder="Hub" />
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
            <Select value={status} onValueChange={(value) => setStatus(value as SupportTicketStatus | "ALL")}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os status</SelectItem>
                <SelectItem value="WAITING_ANALYST">Aguardando analista</SelectItem>
                <SelectItem value="IN_PROGRESS">Em atendimento</SelectItem>
                <SelectItem value="WAITING_DRIVER">Aguardando motorista</SelectItem>
                <SelectItem value="CLOSED">Encerrado</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversas armazenadas</CardTitle>
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Carregando historico...
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Protocolo</TableHead>
                    <TableHead>Motorista</TableHead>
                    <TableHead>Analista</TableHead>
                    <TableHead>Hub</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Mensagens</TableHead>
                    <TableHead>Resolucao</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historyQuery.data || []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.protocol}</p>
                          <p className="text-xs text-muted-foreground">{item.ticketId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.driverName}</p>
                          <p className="text-xs text-muted-foreground">{item.driverId}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.analystName || "Nao atribuido"}</TableCell>
                      <TableCell>{item.hubName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <CalendarRange className="h-3 w-3" />
                          {format(new Date(item.startedAt), "dd/MM HH:mm", { locale: ptBR })}
                        </div>
                        <div>{format(new Date(item.endedAt), "dd/MM HH:mm", { locale: ptBR })}</div>
                      </TableCell>
                      <TableCell>{item.messageCount}</TableCell>
                      <TableCell>{item.resolutionMinutes} min</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
