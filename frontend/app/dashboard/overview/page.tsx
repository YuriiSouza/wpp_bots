"use client"

import { useEffect, useState } from "react"
import { Eye, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchOverview, getApiErrorMessage, type OverviewPayload } from "@/lib/admin-api"
import { toast } from "sonner"

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null)
  const [viewPayload, setViewPayload] = useState<Record<string, unknown> | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await fetchOverview()
        if (active) setOverview(data)
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar o overview"))
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex flex-col">
      <PageHeader title="Overview" breadcrumbs={[{ label: "Assignment Overview" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Assignment Overview</h2>
            <p className="text-sm text-muted-foreground">Tabela visual de atribuicoes por linha</p>
          </div>
          <div className="flex gap-3">
            {(overview?.inconsistentCount || 0) > 0 ? (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 gap-1 px-3 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {overview?.inconsistentCount} inconsistencia(s)
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 gap-1 px-3 py-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sem divergencias
              </Badge>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Carregando overview...</div>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Linha</TableHead>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Rota</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Veiculo</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Inconsistencia</TableHead>
                  <TableHead className="w-[100px]">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(overview?.data || []).map((ov) => {
                  const payload = ov.payload as Record<string, string | number>
                  return (
                    <TableRow key={ov.id} className={ov.inconsistency ? "bg-warning/5" : ""}>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{ov.rowNumber}</Badge></TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium text-card-foreground">{payload.driverName as string}</p>
                          <p className="text-xs text-muted-foreground font-mono">{ov.driverId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{payload.routeId as string}</TableCell>
                      <TableCell className="text-sm text-card-foreground">{payload.cidade as string}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{payload.vehicleType as string}</Badge></TableCell>
                      <TableCell className="text-sm font-semibold text-card-foreground">{payload.score as number}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{payload.status as string}</Badge></TableCell>
                      <TableCell>
                        {ov.inconsistency ? (
                          <span className="text-xs text-warning flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {ov.inconsistency}
                          </span>
                        ) : (
                          <span className="text-xs text-success">OK</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewPayload(ov.payload)} aria-label="Ver payload">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.info(`Reprocessando linha ${ov.rowNumber}`)} aria-label="Reprocessar">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!viewPayload} onOpenChange={() => setViewPayload(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payload JSON</DialogTitle>
            <DialogDescription>Dados completos da linha de atribuicao</DialogDescription>
          </DialogHeader>
          <pre className="rounded-lg bg-muted p-4 text-xs text-foreground overflow-auto max-h-[400px] font-mono">
            {JSON.stringify(viewPayload, null, 2)}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPayload(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
