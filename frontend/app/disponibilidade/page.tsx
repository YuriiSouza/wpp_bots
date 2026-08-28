"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Search, MapPin, Info } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || ""

interface DriverInfo {
  id: string
  name: string | null
  vehicleType: string | null
  priorityScore: number
  ds: string | null
  noShowCount: number
  declineRate: number
  routesDone: number
}

interface ClusterOption {
  cluster: string
  vehicleType: string | null
}

type Step = "identify" | "select" | "done"

type EditMode = "new" | "edit"

const TOOLTIPS: Record<string, { label: string; description: string }> = {
  rotas: {
    label: "Rotas realizadas",
    description: "Quantidade de rotas que você aceitou e concluiu com sucesso (status Aprovada ou Exportada).",
  },
  ds: {
    label: "DS — Desempenho de Serviço",
    description:
      "Percentual de pacotes entregues com sucesso em relação ao total da rota. Calculado pela plataforma Amazon: (entregas realizadas ÷ total de paradas) × 100. Quanto mais alto, melhor.",
  },
  noshow: {
    label: "No-Show",
    description:
      "Quantidade de vezes que você aceitou uma rota mas não foi carregar. Quando isso acontece, a rota fica sem motorista e prejudica a operação.",
  },
  recusas: {
    label: "Recusas",
    description:
      "Percentual de rotas que foram oferecidas para você e você recusou. Calculado como: (rotas recusadas ÷ rotas oferecidas) × 100.",
  },
  score: {
    label: "Score de Prioridade",
    description:
      "Pontuação interna que define sua posição na fila de atribuição. Leva em conta DS, histórico de no-shows, recusas e outros indicadores. Quanto maior o score, maior a prioridade para receber rotas.",
  },
}

function Tooltip({ id }: { id: keyof typeof TOOLTIPS }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const info = TOOLTIPS[id]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    document.addEventListener("touchstart", handler)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("touchstart", handler)
    }
  }, [open])

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
        aria-label={`Info: ${info.label}`}
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-xl border bg-popover p-3 shadow-lg text-left">
          <p className="text-xs font-semibold text-foreground mb-1">{info.label}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{info.description}</p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        </div>
      )}
    </div>
  )
}

function parseDsValue(value?: string | null) {
  if (!value) return null
  const normalized = String(value).replace(",", ".").replace("%", "").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatDs(value?: string | null) {
  const ds = parseDsValue(value)
  if (ds === null) return "—"
  return `${ds.toFixed(0)}%`
}

function StatCard({
  label,
  value,
  tooltipId,
  accent,
}: {
  label: string
  value: string
  tooltipId: keyof typeof TOOLTIPS
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Tooltip id={tooltipId} />
      </div>
      <span className={`text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</span>
    </div>
  )
}

export default function DisponibilidadePage() {
  const [step, setStep] = useState<Step>("identify")
  const [editMode, setEditMode] = useState<EditMode>("new")
  const [driverId, setDriverId] = useState("")
  const [driver, setDriver] = useState<DriverInfo | null>(null)
  const [clusters, setClusters] = useState<ClusterOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const handleIdentify = async () => {
    const id = driverId.trim()
    if (!id) return
    setLoading(true)
    try {
      const driverRes = await fetch(`${API_URL}/api/public/driver/${encodeURIComponent(id)}`)
      const driverData = await driverRes.json()
      if (!driverData.ok) {
        toast.error(driverData.message || "Motorista não encontrado.")
        return
      }
      const clustersRes = await fetch(`${API_URL}/api/public/clusters`)
      const clustersData = await clustersRes.json()
      setDriver(driverData.driver)
      setClusters(clustersData.clusters || [])
      if (driverData.existingClusters) {
        setEditMode("edit")
        setSelected(new Set(driverData.existingClusters as string[]))
      } else {
        setEditMode("new")
        setSelected(new Set())
      }
      setStep("select")
    } catch {
      toast.error("Erro ao buscar dados. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  const toggleCluster = (cluster: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(cluster)) next.delete(cluster)
      else next.add(cluster)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!driver || selected.size === 0) {
      toast.error("Selecione pelo menos um cluster.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/public/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: driver.id, clusters: Array.from(selected) }),
      })
      const data = await res.json()
      if (!data.ok) {
        toast.error(data.message || "Erro ao registrar disponibilidade.")
        return
      }
      setStep("done")
    } catch {
      toast.error("Erro ao registrar. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <MapPin className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Disponibilidade de Rota</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe seu ID e selecione os clusters que você pode pegar hoje
          </p>
        </div>

        {/* Step: identify */}
        {step === "identify" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Seu ID de motorista</label>
              <Input
                placeholder="Ex: AMZ123456"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleIdentify()}
                className="text-base h-11"
                autoFocus
              />
            </div>
            <Button
              className="w-full h-11"
              onClick={() => void handleIdentify()}
              disabled={loading || !driverId.trim()}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar
            </Button>
          </div>
        )}

        {/* Step: select clusters */}
        {step === "select" && driver && (
          <div className="space-y-4">
            {/* Driver card */}
            <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-4">
              {/* Nome e veículo */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground text-lg">{driver.name || driver.id}</p>
                  <p className="text-xs text-muted-foreground font-mono">{driver.id}</p>
                </div>
                {driver.vehicleType && (
                  <Badge variant="outline" className="text-sm">{driver.vehicleType}</Badge>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="Rotas realizadas"
                  tooltipId="rotas"
                  value={String(driver.routesDone)}
                />
                <StatCard
                  label="DS"
                  tooltipId="ds"
                  value={formatDs(driver.ds)}
                  accent={
                    (() => {
                      const ds = parseDsValue(driver.ds)
                      if (ds === null) return undefined
                      if (ds >= 90) return "text-emerald-600"
                      if (ds >= 70) return "text-lime-600"
                      if (ds >= 30) return "text-amber-600"
                      return "text-red-600"
                    })()
                  }
                />
                <StatCard
                  label="No-Show"
                  tooltipId="noshow"
                  value={String(driver.noShowCount)}
                  accent={driver.noShowCount > 0 ? "text-red-600" : "text-emerald-600"}
                />
                <StatCard
                  label="Recusas"
                  tooltipId="recusas"
                  value={driver.declineRate > 0 ? `${(driver.declineRate * 100).toFixed(0)}%` : "0%"}
                  accent={driver.declineRate > 0.2 ? "text-amber-600" : undefined}
                />
              </div>

              {/* Score — linha inteira */}
              <div className="flex items-center justify-between rounded-xl border bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">Score de Prioridade</span>
                  <Tooltip id="score" />
                </div>
                <span className="text-2xl font-bold text-primary">{driver.priorityScore.toFixed(0)}</span>
              </div>
            </div>

            {/* Edit mode banner */}
            {editMode === "edit" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                <span className="text-base">✏️</span>
                <span>Você já registrou disponibilidade hoje. Edite as regiões e confirme para atualizar.</span>
              </div>
            )}

            {/* Clusters */}
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-foreground">
                  Selecione as regiões que você pode atender hoje
                  <span className="ml-2 text-muted-foreground font-normal text-xs">({clusters.length} disponíveis)</span>
                </p>
                {clusters.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline shrink-0"
                    onClick={() => {
                      if (selected.size === clusters.length) {
                        setSelected(new Set())
                      } else {
                        setSelected(new Set(clusters.map((c) => c.cluster)))
                      }
                    }}
                  >
                    {selected.size === clusters.length ? "Desmarcar tudo" : "Selecionar tudo"}
                  </button>
                )}
              </div>
              {clusters.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma região disponível no momento.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {clusters.map((c) => (
                    <label
                      key={c.cluster}
                      className="flex items-center gap-3 rounded-lg border border-border/50 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <Checkbox
                        checked={selected.has(c.cluster)}
                        onCheckedChange={() => toggleCluster(c.cluster)}
                      />
                      <span className="text-sm font-medium text-foreground flex-1">{c.cluster}</span>
                    </label>
                  ))}
                </div>
              )}
              {selected.size > 0 && (
                <p className="text-xs text-muted-foreground mt-2 text-right">
                  {selected.size} região{selected.size !== 1 ? "ões" : ""} selecionada{selected.size !== 1 ? "s" : ""}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={() => { setStep("identify"); setDriver(null); setSelected(new Set()) }}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 h-11"
                onClick={() => void handleSubmit()}
                disabled={loading || selected.size === 0}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editMode === "edit" ? `Atualizar (${selected.size})` : `Confirmar (${selected.size})`}
              </Button>
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="rounded-2xl border bg-card p-8 shadow-sm text-center space-y-4">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 mx-auto">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">
                {editMode === "edit" ? "Disponibilidade atualizada!" : "Disponibilidade registrada!"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Você marcou {selected.size} região{selected.size !== 1 ? "ões" : ""}. O analista vai atribuir a melhor rota para você.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => { setStep("identify"); setDriverId(""); setDriver(null); setSelected(new Set()) }}
            >
              Registrar outra disponibilidade
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
