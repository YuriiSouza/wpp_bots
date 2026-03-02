"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { Search, AlertTriangle } from "lucide-react"
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
  fetchDriversPage,
  getApiErrorMessage,
  removeBlocklistDriver,
} from "@/lib/admin-api"
import type { Driver, DriverBlocklist } from "@/lib/types"
import { toast } from "sonner"

type BlocklistRow = DriverBlocklist & {
  displayStatus: "BLOCKED" | "UNBLOCKED" | "UNLISTED"
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
        const [blocklistData, driverData] = await Promise.all([
          fetchBlocklist(),
          fetchDriversPage({
            page: 1,
            pageSize: search ? 50 : 200,
            search: search || undefined,
            sortBy: "name",
            sortDir: "asc",
          }),
        ])
        if (!active) return

        const missingNameIds = Array.from(
          new Set(
            blocklistData
              .filter((item) => !String(item.driverName || "").trim())
              .map((item) => item.driverId)
              .filter(Boolean)
          )
        )

        let resolvedById = new Map<string, string>()
        if (missingNameIds.length) {
          const resolvedRows = await Promise.all(
            missingNameIds.map(async (driverId) => {
              try {
                const result = await fetchDriversPage({
                  page: 1,
                  pageSize: 5,
                  search: driverId,
                  sortBy: "name",
                  sortDir: "asc",
                })
                const match = result.data.find((driver) => driver.id === driverId)
                const name = String(match?.name || "").trim()
                return name ? [driverId, name] as const : null
              } catch {
                return null
              }
            })
          )

          resolvedById = new Map(
            resolvedRows.filter((row): row is readonly [string, string] => Boolean(row))
          )
        }

        const normalizedBlocklist = blocklistData.map((item) => ({
          ...item,
          driverName: item.driverName || resolvedById.get(item.driverId) || null,
        }))

        const extraDrivers = Array.from(resolvedById.entries()).map(([id, name]) => ({
          id,
          name,
          vehicleType: null,
          ds: null,
          noShowCount: 0,
          declineRate: 0,
          priorityScore: 0,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }))

        setBlocklist(normalizedBlocklist)
        setDrivers([...driverData.data, ...extraDrivers])
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
  }, [search])

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
          (b.driverName || "").toLowerCase().includes(q) ||
          driverMap.get(b.driverId)?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") result = result.filter((b) => b.status === statusFilter)
    return result.map((item) => ({ ...item, displayStatus: item.status as "BLOCKED" | "UNBLOCKED" }))
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
        driverName: driver.name || null,
        status: "UNBLOCKED",
        displayStatus: "UNLISTED",
        timesListed: 0,
        lastActivatedAt: null,
        lastInactivatedAt: null,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
      }))

    return [...filtered, ...extraRows]
  }, [drivers, filtered, search, statusFilter])

  const handleToggle = async () => {
    if (!actionItem || !justification.trim()) {
      toast.error("Justificativa obrigatoria")
      return
    }
    const newStatus = actionItem.displayStatus === "BLOCKED" ? "UNBLOCKED" : "BLOCKED"
    try {
      const response =
        newStatus === "BLOCKED"
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
              driverName: actionItem.driverName || driverMap.get(actionItem.driverId) || null,
              status: newStatus as "BLOCKED" | "UNBLOCKED",
              timesListed: 1,
              lastActivatedAt: newStatus === "BLOCKED" ? new Date().toISOString() : null,
              lastInactivatedAt: newStatus === "UNBLOCKED" ? new Date().toISOString() : null,
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
                status: newStatus as "BLOCKED" | "UNBLOCKED",
                timesListed: newStatus === "BLOCKED" ? b.timesListed + 1 : b.timesListed,
                lastActivatedAt: newStatus === "BLOCKED" ? new Date().toISOString() : b.lastActivatedAt,
                lastInactivatedAt: newStatus === "UNBLOCKED" ? new Date().toISOString() : b.lastInactivatedAt,
                updatedAt: new Date().toISOString(),
              }
            : b
        )
      })
      toast.success(
        `${actionItem.driverName || driverMap.get(actionItem.driverId) || actionItem.driverId} ${newStatus === "BLOCKED" ? "bloqueado" : "desbloqueado"}`
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
                  <SelectItem value="BLOCKED">Bloqueado</SelectItem>
                  <SelectItem value="UNBLOCKED">Desbloqueado</SelectItem>
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
                      variant={item.displayStatus === "BLOCKED" ? "outline" : "destructive"}
                      size="sm"
                      onClick={() => setActionItem(item)}
                    >
                      {item.displayStatus === "BLOCKED" ? "Desbloquear" : "Bloquear"}
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
              {actionItem?.displayStatus === "BLOCKED" ? "Desbloquear" : "Bloquear"} Motorista
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
