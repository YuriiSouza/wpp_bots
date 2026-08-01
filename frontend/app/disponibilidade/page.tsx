"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Search, MapPin } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || ""

interface DriverInfo {
  id: string
  name: string | null
  vehicleType: string | null
  priorityScore: number
  ds: string | null
}

interface ClusterOption {
  cluster: string
  vehicleType: string | null
}

type Step = "identify" | "select" | "done"

export default function DisponibilidadePage() {
  const [step, setStep] = useState<Step>("identify")
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
      const vt = encodeURIComponent(driverData.driver.vehicleType || '')
      const clustersRes = await fetch(`${API_URL}/api/public/clusters?vehicleType=${vt}`)
      const clustersData = await clustersRes.json()
      setDriver(driverData.driver)
      setClusters(clustersData.clusters || [])
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
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{driver.name || driver.id}</p>
                  <p className="text-xs text-muted-foreground font-mono">{driver.id}</p>
                </div>
                <div className="flex gap-2">
                  {driver.vehicleType && (
                    <Badge variant="outline" className="text-xs">{driver.vehicleType}</Badge>
                  )}
                  {driver.ds && (
                    <Badge variant="outline" className="text-xs">DS {driver.ds}</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Clusters */}
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <p className="text-sm font-semibold text-foreground mb-3">
                Clusters disponíveis hoje
                <span className="ml-2 text-muted-foreground font-normal">({clusters.length})</span>
              </p>
              {clusters.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma rota disponível no momento.
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {clusters.map((c) => (
                    <label
                      key={c.cluster}
                      className="flex items-center gap-3 rounded-lg border border-border/50 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <Checkbox
                        checked={selected.has(c.cluster)}
                        onCheckedChange={() => toggleCluster(c.cluster)}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{c.cluster}</span>
                      </div>
                      {c.vehicleType && (
                        <Badge variant="secondary" className="text-xs shrink-0">{c.vehicleType}</Badge>
                      )}
                    </label>
                  ))}
                </div>
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
                Confirmar ({selected.size})
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
              <p className="text-lg font-semibold text-foreground">Disponibilidade registrada!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Você marcou {selected.size} cluster{selected.size !== 1 ? "s" : ""}. O analista vai atribuir a melhor rota para você.
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
