"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CarFront,
  Pencil,
  RotateCcw,
  Search,
  ShieldBan,
  Trophy,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  addBlocklistDriver,
  fetchBlocklist,
  fetchDriversAnalytics,
  fetchDriversPage,
  getApiErrorMessage,
  removeBlocklistDriver,
  resetDriverNoShow,
  updateDriverPriorityScore,
} from "@/lib/admin-api"
import type { Driver } from "@/lib/types"
import type { DriversAnalyticsPayload } from "@/lib/admin-api"
import { toast } from "sonner"

type SortKey = "name" | "priorityScore" | "noShowCount" | "declineRate"

export default function DriversPage() {
  const PAGE_SIZE = 20
  const [search, setSearch] = useState("")
  const [vehicleFilter, setVehicleFilter] = useState("all")
  const [dsFilter, setDsFilter] = useState("all")
  const [sortBy, setSortBy] = useState<SortKey>("priorityScore")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [editDriver, setEditDriver] = useState<Driver | null>(null)
  const [editScore, setEditScore] = useState("")
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [analyticsPayload, setAnalyticsPayload] = useState<DriversAnalyticsPayload | null>(null)
  const [page, setPage] = useState(1)
  const [totalDrivers, setTotalDrivers] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string; updated?: number; total?: number } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true

    const loadData = async () => {
      try {
        const [driverData, analyticsData, blocklistData] = await Promise.all([
          fetchDriversPage({
            page,
            pageSize: PAGE_SIZE,
            search: search || undefined,
            vehicleType: vehicleFilter !== "all" ? vehicleFilter : undefined,
            ds: dsFilter !== "all" ? dsFilter : undefined,
            sortBy,
            sortDir,
          }),
          fetchDriversAnalytics(),
          fetchBlocklist(),
        ])
        if (!active) return

        setDrivers(driverData.data)
        setTotalDrivers(driverData.total)
        setTotalPages(driverData.totalPages)
        setAnalyticsPayload(analyticsData)
        setBlockedIds(new Set(blocklistData.filter((item) => item.status === "BLOCKED").map((item) => item.driverId)))
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar os motoristas"))
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      active = false
    }
  }, [page, search, vehicleFilter, dsFilter, sortBy, sortDir, refreshKey])

  const vehicleTypes = useMemo(
    () => analyticsPayload?.filterOptions.vehicleTypes || [],
    [analyticsPayload]
  )
  const dsValues = useMemo(
    () => analyticsPayload?.filterOptions.dsValues || [],
    [analyticsPayload]
  )

  const getRiskLevel = (d: Driver) => {
    const risk = d.noShowCount * 10 + d.declineRate
    if (risk > 60) return { level: "Alto", color: "text-destructive", bg: "bg-destructive/15" }
    if (risk > 30) return { level: "Medio", color: "text-warning", bg: "bg-warning/15" }
    return { level: "Baixo", color: "text-success", bg: "bg-success/15" }
  }

  const analytics = useMemo(() => {
    return {
      sampleSize: analyticsPayload?.summary.totalActiveDrivers || 0,
      blockedCount: analyticsPayload?.summary.blockedCount || 0,
      highRiskCount: analyticsPayload?.summary.highRiskCount || 0,
      totalNoShow: analyticsPayload?.summary.totalNoShow || 0,
      avgScore: analyticsPayload?.summary.avgScore || 0,
      avgDs: analyticsPayload?.summary.avgDs || 0,
      byVehicle: analyticsPayload?.byVehicle || [],
      byStatus: analyticsPayload?.byStatus || [],
      topRisk: analyticsPayload?.topRisk || [],
      topScore: analyticsPayload?.topScore || [],
    }
  }, [analyticsPayload])

  const handleSaveScore = async () => {
    if (!editDriver) return
    const newScore = parseFloat(editScore)
    if (isNaN(newScore) || newScore < 0 || newScore > 100) {
      toast.error("Score deve ser entre 0 e 100")
      return
    }
    try {
      const response = await updateDriverPriorityScore(editDriver.id, newScore)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setDrivers((prev) =>
        prev.map((d) => (d.id === editDriver.id ? { ...d, priorityScore: newScore } : d))
      )
      void fetchDriversAnalytics().then(setAnalyticsPayload).catch(() => {})
      toast.success(`Priority score de ${editDriver.name} atualizado para ${newScore}`)
      setEditDriver(null)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o priority score"))
    }
  }

  const handleResetNoShow = async (driver: Driver) => {
    try {
      const response = await resetDriverNoShow(driver.id)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setDrivers((prev) =>
        prev.map((d) => (d.id === driver.id ? { ...d, noShowCount: 0 } : d))
      )
      void fetchDriversAnalytics().then(setAnalyticsPayload).catch(() => {})
      toast.success(`noShowCount de ${driver.name} resetado`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel resetar o no-show"))
    }
  }

  const handleToggleBlock = async (driver: Driver, isBlocked: boolean) => {
    try {
      const reason =
        !isBlocked
          ? window.prompt(`Informe a justificativa do bloqueio para ${driver.name || driver.id}:`, "")?.trim() || ""
          : ""

      if (!isBlocked && !reason) {
        toast.error("Justificativa obrigatoria para bloqueio manual")
        return
      }

      const response = isBlocked
        ? await removeBlocklistDriver(driver.id)
        : await addBlocklistDriver(driver.id, reason)

      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setBlockedIds((prev) => {
        const next = new Set(prev)
        if (isBlocked) {
          next.delete(driver.id)
        } else {
          next.add(driver.id)
        }
        return next
      })
      toast.success(`${driver.name} ${isBlocked ? "desbloqueado" : "bloqueado"}`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel alterar o status do motorista"))
    }
  }

  const handleImportCsv = async (file: File) => {
    setImportLoading(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const res = await fetch("/api/drivers/import-spx-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      })
      const data = await res.json() as { ok: boolean; message: string; updated?: number; total?: number }
      setImportResult(data)
      if (data.ok) {
        toast.success(data.message)
        setRefreshKey(k => k + 1)
      } else {
        toast.error(data.message)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao importar CSV"
      setImportResult({ ok: false, message: msg })
      toast.error(msg)
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Motoristas" breadcrumbs={[{ label: "Motoristas" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Dashboard de Motoristas</h2>
            <p className="text-sm text-muted-foreground">
              Analise operacional dos motoristas e busca individual logo abaixo
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => { setImportResult(null); setImportOpen(true) }}>
            <Upload className="h-4 w-4" />
            Importar cadastro SPX
          </Button>
        </div>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando motoristas...
          </div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-6">
              <MetricCard
                icon={Users}
                label="Motoristas"
                value={String(totalDrivers)}
                hint={`Base analisada: ${analytics.sampleSize}`}
              />
              <MetricCard
                icon={Trophy}
                label="Score Medio"
                value={String(analytics.avgScore)}
                hint="Media do priority score"
              />
              <MetricCard
                icon={TrendingUp}
                label="DS Medio"
                value={String(analytics.avgDs)}
                hint="Media de DS"
              />
              <MetricCard
                icon={AlertTriangle}
                label="Risco Alto"
                value={String(analytics.highRiskCount)}
                hint="Motoristas com maior exposicao"
              />
              <MetricCard
                icon={ShieldBan}
                label="Bloqueados"
                value={String(analytics.blockedCount)}
                hint="Atualmente na blocklist"
              />
              <MetricCard
                icon={TrendingDown}
                label="No-Show"
                value={String(analytics.totalNoShow)}
                hint="Soma no recorte analisado"
              />
            </div>

            <div className="grid gap-4 grid-cols-1 xl:grid-cols-3">
              <InsightListCard
                title="Veiculos Mais Presentes"
                description="Distribuicao da frota no recorte"
                items={analytics.byVehicle.map((item) => ({
                  label: item.label,
                  value: `${item.count} motoristas`,
                  progress: analytics.sampleSize ? (item.count / analytics.sampleSize) * 100 : 0,
                }))}
              />
              <InsightListCard
                title="Status dos Motoristas"
                description="Distribuicao da coluna AZ"
                items={analytics.byStatus.map((item) => ({
                  label: item.label,
                  value: `${item.count} motoristas`,
                  progress: analytics.sampleSize ? (item.count / analytics.sampleSize) * 100 : 0,
                }))}
              />
              <InsightListCard
                title="Top Score"
                description="Melhores priority scores"
                items={analytics.topScore.map((driver) => ({
                  label: driver.name || driver.id,
                  value: `${driver.priorityScore} pts`,
                  progress: driver.priorityScore,
                }))}
              />
              <InsightListCard
                title="Maior Risco"
                description="Quem exige mais atencao"
                items={analytics.topRisk.map((driver) => ({
                  label: driver.name || driver.id,
                  value: `${driver.noShowCount} no-show | ${driver.declineRate.toFixed(0)}% decline`,
                  progress: Math.min(100, driver.noShowCount * 10 + driver.declineRate),
                }))}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Buscar Motoristas</CardTitle>
                <CardDescription>
                  Pesquise por nome ou ID e ajuste filtros para encontrar o motorista certo
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por ID ou nome..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value)
                        setPage(1)
                      }}
                      className="pl-9"
                    />
                  </div>
                  <Select
                    value={vehicleFilter}
                    onValueChange={(value) => {
                      setVehicleFilter(value)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <SelectValue placeholder="Veiculo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos Veiculos</SelectItem>
                      {vehicleTypes.map((value) => (
                        <SelectItem key={value} value={value!}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={dsFilter}
                    onValueChange={(value) => {
                      setDsFilter(value)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <SelectValue placeholder="DS" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos DS</SelectItem>
                      {dsValues.map((value) => (
                        <SelectItem key={value} value={value!}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={`${sortBy}:${sortDir}`}
                    onValueChange={(value) => {
                      const [nextSortBy, nextSortDir] = value.split(":") as [SortKey, "asc" | "desc"]
                      setSortBy(nextSortBy)
                      setSortDir(nextSortDir)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[220px]">
                      <SelectValue placeholder="Ordenacao" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="priorityScore:desc">Maior score</SelectItem>
                      <SelectItem value="priorityScore:asc">Menor score</SelectItem>
                      <SelectItem value="noShowCount:desc">Maior no-show</SelectItem>
                      <SelectItem value="declineRate:desc">Maior decline</SelectItem>
                      <SelectItem value="name:asc">Nome A-Z</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {drivers.length ? (
                  <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
                    {drivers.map((driver) => {
                      const risk = getRiskLevel(driver)
                      const isBlocked = blockedIds.has(driver.id)
                      return (
                        <Card key={driver.id} className="border-border/70">
                          <CardContent className="space-y-4 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-card-foreground">
                                  {driver.name || driver.id}
                                </p>
                                <p className="font-mono text-xs text-muted-foreground">{driver.id}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{driver.vehicleType || "Sem veiculo"}</Badge>
                                <Badge variant="outline">{driver.status || "Sem status"}</Badge>
                                <Badge
                                  variant="outline"
                                  className={`border-transparent ${risk.bg} ${risk.color}`}
                                >
                                  {risk.level === "Alto" ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}
                                  {risk.level}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={
                                    isBlocked
                                      ? "border-destructive/30 bg-destructive/15 text-destructive"
                                      : "border-success/30 bg-success/15 text-success"
                                  }
                                >
                                  {isBlocked ? "Bloqueado" : "Ativo"}
                                </Badge>
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              <DriverMetric label="DS" value={driver.ds || "-"} />
                              <DriverMetric label="Score" value={String(driver.priorityScore)} />
                              <DriverMetric label="No-Show" value={String(driver.noShowCount)} />
                              <DriverMetric label="Decline" value={`${driver.declineRate.toFixed(0)}%`} />
                              <DriverMetric label="Rotas aceitas" value={String(driver.totalRoutesAccepted ?? 0)} />
                              <DriverMetric
                                label="Última rota"
                                value={(() => {
                                  if (!driver.lastRouteDate) return "Nunca"
                                  const days = Math.floor((Date.now() - new Date(driver.lastRouteDate).getTime()) / 86400000)
                                  if (days === 0) return "Hoje"
                                  if (days === 1) return "Ontem"
                                  return `${days} dias atrás`
                                })()}
                              />
                            </div>

                            {/* Dados cadastrais enriquecidos (quando importados via CSV da SPX) */}
                            {(driver.agency || driver.city || driver.joinedDate || driver.licenseExpiryDate || driver.contractType) && (
                              <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Cadastro SPX</p>
                                <div className="grid gap-2 grid-cols-2 xl:grid-cols-3 text-xs">
                                  {driver.agency && <div><span className="text-muted-foreground">Agência: </span><span className="font-medium">{driver.agency === "SPXOWNFLEET" ? "Frota própria" : driver.agency}</span></div>}
                                  {driver.contractType && <div><span className="text-muted-foreground">Contrato: </span><span className="font-medium">{driver.contractType}</span></div>}
                                  {driver.city && <div><span className="text-muted-foreground">Cidade: </span><span className="font-medium">{driver.city}</span></div>}
                                  {driver.joinedDate && <div><span className="text-muted-foreground">Entrada: </span><span className="font-medium">{driver.joinedDate}</span></div>}
                                  {driver.licensePlate && <div><span className="text-muted-foreground">Placa: </span><span className="font-medium">{driver.licensePlate}</span></div>}
                                  {driver.vehicleManufacturer && <div><span className="text-muted-foreground">Veículo: </span><span className="font-medium">{driver.vehicleManufacturer} {driver.vehicleManufacturingYear || ""}</span></div>}
                                  {driver.licenseExpiryDate && (
                                    <div>
                                      <span className="text-muted-foreground">Val. CNH: </span>
                                      <span className={`font-medium ${new Date(driver.licenseExpiryDate) < new Date() ? "text-red-500" : new Date(driver.licenseExpiryDate) < new Date(Date.now() + 90 * 86400000) ? "text-amber-500" : ""}`}>
                                        {driver.licenseExpiryDate}
                                        {new Date(driver.licenseExpiryDate) < new Date() ? " ⚠ vencida" : ""}
                                      </span>
                                    </div>
                                  )}
                                  {driver.lastKycDate && <div><span className="text-muted-foreground">Último KYC: </span><span className="font-medium">{driver.lastKycDate}</span></div>}
                                  {driver.spxBlocklisted && <div className="col-span-2"><Badge variant="outline" className="text-[10px] border-red-500/30 bg-red-500/10 text-red-700">Blocklist SPX</Badge></div>}
                                </div>
                              </div>
                            )}

                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Priority score</span>
                                <span>{driver.priorityScore}%</span>
                              </div>
                              <Progress value={driver.priorityScore} className="h-2" />
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditDriver(driver)
                                  setEditScore(String(driver.priorityScore))
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Ajustar Score
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => void handleResetNoShow(driver)}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Resetar No-Show
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleToggleBlock(driver, isBlocked)}
                              >
                                <ShieldBan className="mr-2 h-4 w-4" />
                                {isBlocked ? "Desbloquear" : "Bloquear"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Nenhum motorista encontrado com os filtros atuais.
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Pagina {page} de {totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={page <= 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                      disabled={page >= totalPages}
                    >
                      Proxima
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={!!editDriver} onOpenChange={() => setEditDriver(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar Priority Score</DialogTitle>
            <DialogDescription>
              Motorista: {editDriver?.name} ({editDriver?.id})
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label>Score atual: {editDriver?.priorityScore}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={editScore}
                onChange={(e) => setEditScore(e.target.value)}
                placeholder="Novo score (0-100)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDriver(null)}>Cancelar</Button>
            <Button onClick={handleSaveScore}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import SPX CSV modal */}
      <Dialog open={importOpen} onOpenChange={open => { if (!importLoading) setImportOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importar cadastro SPX</DialogTitle>
            <DialogDescription>
              Selecione o relatório de motoristas exportado da SPX (CSV). Os dados cadastrais serão
              vinculados pelo Driver ID e enriquecerão o banco sem sobrescrever métricas operacionais.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <label
              htmlFor="spx-csv-input"
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${importLoading ? "opacity-50 pointer-events-none" : "hover:border-primary/50 hover:bg-muted/30"}`}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">{importLoading ? "Processando..." : "Clique ou arraste o CSV aqui"}</span>
              <span className="text-xs text-muted-foreground">br_driver_*.csv</span>
              <input
                id="spx-csv-input"
                type="file"
                accept=".csv,.txt"
                className="hidden"
                disabled={importLoading}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleImportCsv(file)
                  e.target.value = ""
                }}
              />
            </label>

            {importResult && (
              <div className={`rounded-md border px-4 py-3 text-sm ${importResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-red-500/30 bg-red-500/10 text-red-700"}`}>
                <p className="font-medium">{importResult.ok ? "✓ Importação concluída" : "✗ Erro na importação"}</p>
                <p className="text-xs mt-1 opacity-80">{importResult.message}</p>
                {importResult.ok && importResult.total && (
                  <p className="text-xs mt-1 opacity-60">{importResult.total} linhas lidas · {importResult.updated} atualizadas</p>
                )}
              </div>
            )}

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Campos importados:</p>
              <p>Gênero · Telefone · Placa · Validade CNH · Tipo contrato · Data entrada · Cidade · Agência · Data nascimento · Fabricante/ano veículo · Datas KYC · Motivo suspensão</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importLoading}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users
  label: string
  value: string
  hint: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-card-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InsightListCard({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: Array<{ label: string; value: string; progress: number }>
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={`${title}-${item.label}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-card-foreground">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.value}</span>
                </div>
                <Progress value={Math.max(0, Math.min(100, item.progress))} className="h-2" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem dados suficientes para analise.</p>
        )}
      </CardContent>
    </Card>
  )
}

function DriverMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-card-foreground">{value}</p>
    </div>
  )
}
