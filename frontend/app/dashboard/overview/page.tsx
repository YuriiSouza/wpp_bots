"use client"

import { useEffect, useMemo, useState } from "react"
import { MessageSquareText } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fetchOverview, getApiErrorMessage, type OverviewPayload } from "@/lib/admin-api"
import { toast } from "sonner"

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const routeRequestCount = overview?.routeRequests.length || 0
  const chosenCount = useMemo(
    () => (overview?.routeRequests || []).filter((item) => item.choseRoute).length,
    [overview],
  )

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
      <PageHeader title="Overview" breadcrumbs={[{ label: "Solicitacoes de rota" }]} />
      <div className="flex flex-col gap-6 p-6">
        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Carregando overview...</div>
        ) : (
          <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b p-6">
              <div>
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-xl font-semibold text-card-foreground">Solicitacoes de rota no bot</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quais ATs o motorista viu no Telegram e qual rota escolheu.
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="px-3 py-1.5">
                  {routeRequestCount} solicitacao(oes)
                </Badge>
                <Badge variant="outline" className="px-3 py-1.5">
                  {chosenCount} escolha(s)
                </Badge>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Motorista</TableHead>
                    <TableHead>Veiculo</TableHead>
                    <TableHead>Rotas vistas</TableHead>
                    <TableHead>Escolheu</TableHead>
                    <TableHead>Rota escolhida</TableHead>
                    <TableHead>Horario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routeRequestCount ? (
                    (overview?.routeRequests || []).map((request) => (
                      <TableRow key={`${request.driverId}-${request.displayedAt || request.requestedAt || "sem-hora"}`}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium text-card-foreground">
                              {request.driverName || "Motorista sem nome"}
                            </p>
                            <p className="text-xs font-mono text-muted-foreground">{request.driverId}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {request.vehicleType || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          {request.displayedRoutes.length ? (
                            <div className="flex flex-wrap gap-1">
                              {request.displayedRoutes.map((routeId) => (
                                <Badge key={`${request.driverId}-${routeId}`} variant="secondary" className="font-mono text-[11px]">
                                  {routeId}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem registro das rotas exibidas</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={request.choseRoute ? "border-success/30 bg-success/10 text-success" : ""}
                          >
                            {request.choseRoute ? "Sim" : "Nao"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-card-foreground">
                          {request.chosenRoute || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="space-y-1">
                            <p>Solicitou: {request.requestedAt || "-"}</p>
                            <p>Viu: {request.displayedAt || "-"}</p>
                            <p>Escolheu: {request.chosenAt || "-"}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        Nenhuma solicitacao de rota registrada hoje.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
