"use client"

import { Fragment, useEffect, useState } from "react"
import { format, differenceInSeconds } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { RefreshCw, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fetchSyncLogs, getApiErrorMessage, resetQueue, runSync } from "@/lib/admin-api"
import type { SyncLog } from "@/lib/types"
import { toast } from "sonner"
import { getCurrentRouteWindow } from "@/lib/route-window"

export default function SyncPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [syncs, setSyncs] = useState<SyncLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<"drivers" | "routes" | "queue" | null>(null)

  const load = async () => {
    try {
      const data = await fetchSyncLogs()
      setSyncs(data)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel carregar os logs de sync"))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const successCount = syncs.filter((s) => s.status === "SUCCESS").length
  const failCount = syncs.filter((s) => s.status === "FAILED").length

  const handleRun = async (action: "drivers" | "routes") => {
    let syncDate: string | undefined
    let syncShift: "AM" | "PM" | "PM2" | undefined
    if (action === "routes") {
      const currentWindow = getCurrentRouteWindow()
      syncDate = currentWindow.date
      syncShift = currentWindow.shift
    }

    setRunningAction(action)
    try {
      const response = await runSync(action, syncDate, syncShift)
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      toast.success(response.message)
      await load()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel executar a sincronizacao"))
    } finally {
      setRunningAction(null)
    }
  }

  const handleResetQueue = async () => {
    setRunningAction("queue")
    try {
      const response = await resetQueue()
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      toast.success(response.message)
      await load()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel resetar a fila"))
    } finally {
      setRunningAction(null)
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Sync Monitor" breadcrumbs={[{ label: "Sync Monitor" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Sync Monitor</h2>
            <p className="text-sm text-muted-foreground">Historico de sincronizacoes</p>
          </div>
          <div className="flex gap-3">
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="text-xs text-muted-foreground">Sucesso</p>
                  <p className="text-lg font-bold text-card-foreground">{successCount}</p>
                </div>
              </div>
            </Card>
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">Falhas</p>
                  <p className="text-lg font-bold text-card-foreground">{failCount}</p>
                </div>
              </div>
            </Card>
            <Button onClick={() => handleRun("drivers")} variant="outline" disabled={!!runningAction}>
              <RefreshCw className="mr-2 h-4 w-4" /> {runningAction === "drivers" ? "Atualizando..." : "Atualizar Motoristas"}
            </Button>
            <Button onClick={() => handleRun("routes")} variant="outline" disabled={!!runningAction}>
              <RefreshCw className="mr-2 h-4 w-4" /> {runningAction === "routes" ? "Atualizando..." : "Atualizar Rotas"}
            </Button>
            <Button onClick={handleResetQueue} variant="outline" disabled={!!runningAction}>
              <RefreshCw className="mr-2 h-4 w-4" /> {runningAction === "queue" ? "Resetando..." : "Resetar Fila"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Carregando logs de sync...</div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]" />
                  <TableHead>Status</TableHead>
                  <TableHead>Iniciado em</TableHead>
                  <TableHead>Duracao</TableHead>
                  <TableHead>Motoristas</TableHead>
                  <TableHead>Rotas Disp.</TableHead>
                  <TableHead>Rotas Atr.</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncs.map((sync) => {
                  const isExpanded = expanded.has(sync.id)
                  const duration = sync.finishedAt
                    ? differenceInSeconds(new Date(sync.finishedAt), new Date(sync.startedAt))
                    : null
                  return (
                    <Fragment key={sync.id}>
                      <TableRow key={sync.id} className={sync.status === "FAILED" ? "bg-destructive/5" : ""}>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpand(sync.id)}>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell><StatusBadge status={sync.status} /></TableCell>
                        <TableCell className="text-sm text-card-foreground">
                          {format(new Date(sync.startedAt), "dd/MM/yy HH:mm:ss", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm text-card-foreground">{duration ?? "-"}s</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-card-foreground">{sync.driversCount}</TableCell>
                        <TableCell className="text-sm text-card-foreground">{sync.routesAvailable}</TableCell>
                        <TableCell className="text-sm text-card-foreground">{sync.routesAssigned}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {sync.message || "-"}
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow key={`${sync.id}-details`}>
                          <TableCell colSpan={8} className="bg-muted/50 p-4">
                            <div className="rounded-lg bg-card p-4 border">
                              <h4 className="text-sm font-semibold text-card-foreground mb-2">Log Detalhado</h4>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
{`ID: ${sync.id}
Status: ${sync.status}
Inicio: ${sync.startedAt}
Fim: ${sync.finishedAt || "Em andamento"}
Motoristas processados: ${sync.driversCount}
Rotas disponiveis: ${sync.routesAvailable}
Rotas atribuidas: ${sync.routesAssigned}
${sync.message ? `Erro: ${sync.message}` : "Sem erros"}`}
                              </pre>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
