"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldBan,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  fetchDriversPage,
  getApiErrorMessage,
  removeBlocklistDriver,
  resetDriverNoShow,
  updateDriverPriorityScore,
} from "@/lib/admin-api"
import type { Driver } from "@/lib/types"
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
  const [page, setPage] = useState(1)
  const [totalDrivers, setTotalDrivers] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadData = async () => {
      try {
        const [driverData, blocklistData] = await Promise.all([
          fetchDriversPage({
            page,
            pageSize: PAGE_SIZE,
            search: search || undefined,
            vehicleType: vehicleFilter !== "all" ? vehicleFilter : undefined,
            ds: dsFilter !== "all" ? dsFilter : undefined,
            sortBy,
            sortDir,
          }),
          fetchBlocklist(),
        ])
        if (!active) return

        setDrivers(driverData.data)
        setTotalDrivers(driverData.total)
        setTotalPages(driverData.totalPages)
        setBlockedIds(new Set(blocklistData.filter((item) => item.status === "ACTIVE").map((item) => item.driverId)))
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
  }, [page, search, vehicleFilter, dsFilter, sortBy, sortDir])

  const vehicleTypes = useMemo(
    () => [...new Set(drivers.map((d) => d.vehicleType).filter(Boolean))],
    [drivers]
  )
  const dsValues = useMemo(
    () => [...new Set(drivers.map((d) => d.ds).filter(Boolean))],
    [drivers]
  )

  const toggleSort = (key: SortKey) => {
    setPage(1)
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(key)
      setSortDir("desc")
    }
  }

  const getRiskLevel = (d: Driver) => {
    const risk = d.noShowCount * 10 + d.declineRate * 100
    if (risk > 60) return { level: "Alto", color: "text-destructive", bg: "bg-destructive/15" }
    if (risk > 30) return { level: "Medio", color: "text-warning", bg: "bg-warning/15" }
    return { level: "Baixo", color: "text-success", bg: "bg-success/15" }
  }

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
        prev.map((d) =>
          d.id === editDriver.id ? { ...d, priorityScore: newScore } : d
        )
      )
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
      toast.success(`noShowCount de ${driver.name} resetado`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel resetar o no-show"))
    }
  }

  const handleToggleBlock = async (driver: Driver, isBlocked: boolean) => {
    try {
      const response = isBlocked
        ? await removeBlocklistDriver(driver.id)
        : await addBlocklistDriver(driver.id)

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

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Motoristas"
        breadcrumbs={[{ label: "Motoristas" }]}
      />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Gestao de Motoristas</h2>
          <p className="text-sm text-muted-foreground">
            {totalDrivers} motoristas encontrados
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
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
              <Select value={vehicleFilter} onValueChange={(value) => {
                setVehicleFilter(value)
                setPage(1)
              }}>
                <SelectTrigger className="w-[140px]">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Veiculo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Veiculos</SelectItem>
                  {vehicleTypes.map((v) => (
                    <SelectItem key={v} value={v!}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={dsFilter} onValueChange={(value) => {
                setDsFilter(value)
                setPage(1)
              }}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="DS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos DS</SelectItem>
                  {dsValues.map((ds) => (
                    <SelectItem key={ds} value={ds!}>{ds}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando motoristas...
          </div>
        ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort("name")} className="-ml-3 h-8 text-xs">
                    Nome <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Veiculo</TableHead>
                <TableHead>DS</TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort("priorityScore")} className="-ml-3 h-8 text-xs">
                    Score <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort("noShowCount")} className="-ml-3 h-8 text-xs">
                    No-Show <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => toggleSort("declineRate")} className="-ml-3 h-8 text-xs">
                    Decline Rate <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Risco</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((driver) => {
                const risk = getRiskLevel(driver)
                const isBlocked = blockedIds.has(driver.id)
                return (
                  <TableRow key={driver.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{driver.id}</TableCell>
                    <TableCell className="font-medium text-card-foreground">{driver.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{driver.vehicleType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{driver.ds}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-card-foreground">{driver.priorityScore}</span>
                        <Progress value={driver.priorityScore} className="h-1.5 w-12" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {driver.noShowCount > 3 && <TrendingUp className="h-3 w-3 text-destructive" />}
                        <span className="text-sm text-card-foreground">{driver.noShowCount}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {driver.declineRate > 0.25 ? (
                          <TrendingDown className="h-3 w-3 text-destructive" />
                        ) : null}
                        <span className="text-sm text-card-foreground">{(driver.declineRate * 100).toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${risk.color} ${risk.bg} border-transparent`}>
                        {risk.level === "Alto" && <AlertTriangle className="mr-1 h-3 w-3" />}
                        {risk.level}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isBlocked ? (
                        <Badge variant="outline" className="text-xs bg-destructive/15 text-destructive border-destructive/30">Bloqueado</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-success/15 text-success border-success/30">Ativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Acoes</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditDriver(driver); setEditScore(String(driver.priorityScore)) }}>
                            <Pencil className="mr-2 h-4 w-4" /> Ajustar Score
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetNoShow(driver)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Resetar No-Show
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleToggleBlock(driver, isBlocked)}>
                            <ShieldBan className="mr-2 h-4 w-4" /> {isBlocked ? "Desbloquear" : "Bloquear"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        )}
        {!isLoading ? (
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
        ) : null}
      </div>

      {/* Edit Score Dialog */}
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
    </div>
  )
}
