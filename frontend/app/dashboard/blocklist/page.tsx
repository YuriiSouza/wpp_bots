"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { ShieldBan, ShieldCheck, Search, AlertTriangle } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { Textarea } from "@/components/ui/textarea"
import {
  addBlocklistDriver,
  fetchBlocklist,
  fetchDrivers,
  getApiErrorMessage,
  removeBlocklistDriver,
} from "@/lib/admin-api"
import type { Driver, DriverBlocklist } from "@/lib/types"
import { toast } from "sonner"

type BlocklistRow = DriverBlocklist & {
  displayStatus: "ACTIVE" | "INACTIVE" | "UNLISTED"
}

export default function BlocklistPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [blocklist, setBlocklist] = useState<DriverBlocklist[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [actionItem, setActionItem] = useState<BlocklistRow | null>(null)
  const [justification, setJustification] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadData = async () => {
      try {
        const [blocklistData, driverData] = await Promise.all([fetchBlocklist(), fetchDrivers()])
        if (!active) return

        setBlocklist(blocklistData)
        setDrivers(driverData)
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar a blocklist"))
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
  }, [])

  const driverMap = useMemo(() => {
    const map = new Map<string, string>()
    drivers.forEach((d) => map.set(d.id, d.name || d.id))
    return map
  }, [drivers])

  const filtered = useMemo(() => {
    let result = [...blocklist]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (b) =>
          b.driverId.toLowerCase().includes(q) ||
          driverMap.get(b.driverId)?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") result = result.filter((b) => b.status === statusFilter)
    return result.map((item) => ({ ...item, displayStatus: item.status as "ACTIVE" | "INACTIVE" }))
  }, [blocklist, search, statusFilter, driverMap])

  const rows = useMemo(() => {
    if (!search || statusFilter !== "all") {
      return filtered
    }

    const q = search.toLowerCase()
    const existingIds = new Set(filtered.map((item) => item.driverId))
    const extraRows: BlocklistRow[] = drivers
      .filter(
        (driver) =>
          !existingIds.has(driver.id) &&
          (driver.id.toLowerCase().includes(q) || (driver.name || "").toLowerCase().includes(q))
      )
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "pt-BR"))
      .map((driver) => ({
        driverId: driver.id,
        status: "INACTIVE",
        displayStatus: "UNLISTED",
        timesListed: 0,
        lastActivatedAt: null,
        lastInactivatedAt: null,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
      }))

    return [...filtered, ...extraRows]
  }, [drivers, filtered, search, statusFilter])

  const activeCnt = blocklist.filter((b) => b.status === "ACTIVE").length
  const inactiveCnt = blocklist.filter((b) => b.status === "INACTIVE").length

  const handleToggle = async () => {
    if (!actionItem || !justification.trim()) {
      toast.error("Justificativa obrigatoria")
      return
    }
    const newStatus = actionItem.displayStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE"
    try {
      const response =
        newStatus === "ACTIVE"
          ? await addBlocklistDriver(actionItem.driverId)
          : await removeBlocklistDriver(actionItem.driverId)

      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setBlocklist((prev) => {
        const exists = prev.some((item) => item.driverId === actionItem.driverId)
        if (!exists) {
          return [
            {
              driverId: actionItem.driverId,
              status: newStatus as "ACTIVE" | "INACTIVE",
              timesListed: 1,
              lastActivatedAt: newStatus === "ACTIVE" ? new Date().toISOString() : null,
              lastInactivatedAt: newStatus === "INACTIVE" ? new Date().toISOString() : null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...prev,
          ]
        }

        return prev.map((b) =>
          b.driverId === actionItem.driverId
            ? {
                ...b,
                status: newStatus as "ACTIVE" | "INACTIVE",
                timesListed: newStatus === "ACTIVE" ? b.timesListed + 1 : b.timesListed,
                lastActivatedAt: newStatus === "ACTIVE" ? new Date().toISOString() : b.lastActivatedAt,
                lastInactivatedAt: newStatus === "INACTIVE" ? new Date().toISOString() : b.lastInactivatedAt,
                updatedAt: new Date().toISOString(),
              }
            : b
        )
      })
      toast.success(
        `${driverMap.get(actionItem.driverId) || actionItem.driverId} ${newStatus === "ACTIVE" ? "bloqueado" : "desbloqueado"}`
      )
      setActionItem(null)
      setJustification("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel alterar a blocklist"))
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Blocklist" breadcrumbs={[{ label: "Blocklist" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Gestao de Blocklist</h2>
            <p className="text-sm text-muted-foreground">Controle de bloqueio de motoristas</p>
          </div>
          <div className="flex gap-3">
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <ShieldBan className="h-4 w-4 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">Bloqueados</p>
                  <p className="text-lg font-bold text-card-foreground">{activeCnt}</p>
                </div>
              </div>
            </Card>
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                <div>
                  <p className="text-xs text-muted-foreground">Inativos</p>
                  <p className="text-lg font-bold text-card-foreground">{inactiveCnt}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar motorista..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ACTIVE">Ativo</SelectItem>
                  <SelectItem value="INACTIVE">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando blocklist...
          </div>
        ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motorista</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vezes Listado</TableHead>
                <TableHead>Ultima Ativacao</TableHead>
                <TableHead>Ultima Inativacao</TableHead>
                <TableHead className="w-[120px]">Acao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.driverId}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-card-foreground">
                        {item.driverName || driverMap.get(item.driverId) || item.driverId}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{item.driverId}</p>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={item.displayStatus} /></TableCell>
                  <TableCell className="text-sm text-card-foreground">{item.timesListed}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.lastActivatedAt ? format(new Date(item.lastActivatedAt), "dd/MM/yy HH:mm", { locale: ptBR }) : "-"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.lastInactivatedAt ? format(new Date(item.lastInactivatedAt), "dd/MM/yy HH:mm", { locale: ptBR }) : "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant={item.displayStatus === "ACTIVE" ? "outline" : "destructive"}
                      size="sm"
                      onClick={() => setActionItem(item)}
                    >
                      {item.displayStatus === "ACTIVE" ? "Desbloquear" : "Bloquear"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </div>

      <Dialog open={!!actionItem} onOpenChange={() => { setActionItem(null); setJustification("") }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionItem?.displayStatus === "ACTIVE" ? "Desbloquear" : "Bloquear"} Motorista
            </DialogTitle>
            <DialogDescription>
              {actionItem?.driverName || driverMap.get(actionItem?.driverId ?? "") || actionItem?.driverId} ({actionItem?.driverId})
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-warning/10 p-3">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <p className="text-sm text-warning">Justificativa obrigatoria para esta acao.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Justificativa</Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Descreva o motivo da alteracao..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionItem(null); setJustification("") }}>Cancelar</Button>
            <Button onClick={handleToggle} disabled={!justification.trim()}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
