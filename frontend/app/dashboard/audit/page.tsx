"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { Search, FileText, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fetchAuditLogs, getApiErrorMessage } from "@/lib/admin-api"
import type { AuditLog } from "@/lib/types"
import { toast } from "sonner"

const actionColors: Record<string, string> = {
  UPDATE_PRIORITY: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  MANUAL_ASSIGN: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  BLOCK: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  UNBLOCK: "bg-success/15 text-success border-success/30",
  UPDATE: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  RESET_NOSHOW: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  UNASSIGN: "bg-muted text-muted-foreground border-border",
}

export default function AuditPage() {
  const [search, setSearch] = useState("")
  const [entityFilter, setEntityFilter] = useState("all")
  const [logs, setLogs] = useState<AuditLog[]>([])

  useEffect(() => {
    void (async () => {
      try {
        setLogs(await fetchAuditLogs())
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar a auditoria"))
      }
    })()
  }, [])

  const entityTypes = useMemo(() => [...new Set(logs.map((l) => l.entityType))], [logs])

  const filtered = useMemo(() => {
    let result = [...logs]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.entityId.toLowerCase().includes(q) ||
          l.userName.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q)
      )
    }
    if (entityFilter !== "all") result = result.filter((l) => l.entityType === entityFilter)
    return result
  }, [search, entityFilter, logs])

  return (
    <div className="flex flex-col">
      <PageHeader title="Auditoria" breadcrumbs={[{ label: "Auditoria" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Modulo de Auditoria</h2>
          <p className="text-sm text-muted-foreground">Registro de todas as alteracoes manuais do sistema</p>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar por ID, usuario ou acao..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Entidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Entidades</SelectItem>
                  {entityTypes.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {filtered.map((log) => (
            <Card key={log.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-xs ${actionColors[log.action] || "bg-muted text-muted-foreground"}`}>
                        {log.action}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{log.entityType}</Badge>
                      <span className="text-xs font-mono text-muted-foreground">{log.entityId}</span>
                    </div>
                    <p className="text-sm text-card-foreground">
                      <span className="font-medium">{log.userName}</span> realizou{" "}
                      <span className="font-medium">{log.action}</span> em{" "}
                      <span className="font-mono text-xs">{log.entityId}</span>
                    </p>
                    {(log.before || log.after) && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        {log.before && (
                          <code className="rounded bg-destructive/10 px-2 py-0.5 text-destructive">
                            {JSON.stringify(log.before)}
                          </code>
                        )}
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        {log.after && (
                          <code className="rounded bg-success/10 px-2 py-0.5 text-success">
                            {JSON.stringify(log.after)}
                          </code>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(log.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
