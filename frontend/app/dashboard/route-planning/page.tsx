"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Loader2, RefreshCw, ScanLine, Send, Sparkles, Tag, Trash2, Wand2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { RoutePlanningMap } from "@/components/route-planning-map"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  assignRoute,
  fetchRoutePlanning,
  fetchRoutePlanningMap,
  getApiErrorMessage,
  runSync,
  runRoutePlanning as runRoutePlanningRequest,
  saveRoutePlanningPreferences,
} from "@/lib/admin-api"
import type {
  RoutePlanningItem,
  RoutePlanningMapPayload,
  RoutePlanningPayload,
  RoutePlanningPreference,
} from "@/lib/types"
import { toast } from "sonner"

type ShiftFilter = "all" | "AM" | "PM" | "PM2"
type PlanningFocus = "DS" | "VOLUME"

export default function RoutePlanningPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [shift, setShift] = useState<ShiftFilter>("all")
  const [focus, setFocus] = useState<PlanningFocus>("DS")
  const [atFilter, setAtFilter] = useState("all")
  const [clusterFilter, setClusterFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [brInput, setBrInput] = useState("")
  const [brFilter, setBrFilter] = useState("")
  const [payload, setPayload] = useState<RoutePlanningPayload | null>(null)
  const [mapPayload, setMapPayload] = useState<RoutePlanningMapPayload | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RoutePlanningItem | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState("")
  const [driverSearch, setDriverSearch] = useState("")
  const [preferredCluster, setPreferredCluster] = useState("")
  const [preferredDriverId, setPreferredDriverId] = useState("")
  const [preferredDriverSearch, setPreferredDriverSearch] = useState("")
  const [isFiltersCollapsed, setIsFiltersCollapsed] = useState(false)
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false)
  const [isPreferredCollapsed, setIsPreferredCollapsed] = useState(false)
  const [isMapCollapsed, setIsMapCollapsed] = useState(false)
  const [isRoutesCollapsed, setIsRoutesCollapsed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false)
  const [isQrStarting, setIsQrStarting] = useState(false)
  const [qrMode, setQrMode] = useState<"idle" | "native" | "fallback">("idle")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const qrScannerContainerRef = useRef<HTMLDivElement | null>(null)
  const videoStreamRef = useRef<MediaStream | null>(null)
  const scanFrameRef = useRef<number | null>(null)
  const html5QrScannerRef = useRef<{
    stop: () => Promise<void>
    clear: () => Promise<void>
  } | null>(null)

  const loadPlanningData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
    }

    const [planning, map] = await Promise.all([
      fetchRoutePlanning({
        date,
        shift: shift === "all" ? undefined : shift,
        atId: atFilter === "all" ? undefined : atFilter,
        focus,
      }),
      fetchRoutePlanningMap({
        cluster: clusterFilter === "all" ? undefined : clusterFilter,
        br: brFilter || undefined,
      }),
    ])

    setPayload(planning)
    setMapPayload(map)
  }

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        await loadPlanningData()
        if (!active) return
      } catch (error) {
        if (active) {
          toast.error(getApiErrorMessage(error, "Nao foi possivel carregar o planejamento"))
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [date, shift, focus, atFilter, clusterFilter, brFilter])

  const handleRefresh = async () => {
    const promptedDate = window.prompt(
      "Informe a data para sincronizar as rotas (AAAA-MM-DD).",
      date || today,
    )

    if (!promptedDate) {
      return
    }

    const normalizedDate = promptedDate.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      toast.error("Data invalida. Use o formato AAAA-MM-DD.")
      return
    }

    const promptValue = window.prompt(
      "Informe o turno para sincronizar as rotas (AM, PM ou PM2).",
      shift === "all" ? "AM" : shift,
    )
    if (!promptValue) {
      return
    }

    const normalizedShift = promptValue.trim().toUpperCase()
    if (!["AM", "PM", "PM2"].includes(normalizedShift)) {
      toast.error("Turno invalido. Use AM, PM ou PM2.")
      return
    }

    const selectedShift = normalizedShift as "AM" | "PM" | "PM2"

    setIsRefreshing(true)
    try {
      const syncResponse = await runSync("routes", normalizedDate, selectedShift)
      if (!syncResponse.ok) {
        toast.error(syncResponse.message)
        return
      }

      const [planning, map] = await Promise.all([
        fetchRoutePlanning({
          date: normalizedDate,
          shift: selectedShift,
          atId: atFilter === "all" ? undefined : atFilter,
          focus,
        }),
        fetchRoutePlanningMap({
          cluster: clusterFilter === "all" ? undefined : clusterFilter,
          br: brFilter || undefined,
        }),
      ])

      setDate(normalizedDate)
      setShift(selectedShift)
      setPayload(planning)
      setMapPayload(map)
      toast.success("Rotas sincronizadas com a planilha e atualizadas no banco.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel sincronizar as rotas"))
    } finally {
      setIsRefreshing(false)
    }
  }

  const filteredRoutes = useMemo(() => {
    const data = payload?.data || []
    const query = search.trim().toLowerCase()
    if (!query) return data

    return data.filter((route) => {
      return [
        route.atId,
        route.bairro,
        route.cidade,
        route.driverId,
        route.driverName,
        route.requestedDriverId,
        route.suggestedDriverId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
  }, [payload, search])

  const clusterOptions = useMemo(() => mapPayload?.clusters || [], [mapPayload])

  const routeByAtId = useMemo(() => {
    return new Map((payload?.data || []).map((route) => [route.atId, route]))
  }, [payload])

  const brRouteList = useMemo(() => {
    const allRoutes = (mapPayload?.routes || []).map((route) => {
      const planningRoute = routeByAtId.get(route.atId)
      const firstPoint = route.stops?.[0]
      return {
        atId: route.atId,
        color: route.color,
        nearestStop: firstPoint?.stop ?? null,
        cluster: firstPoint?.cluster || "",
        driverName: planningRoute?.driverName || planningRoute?.driverId || "",
        vehicleType: planningRoute?.requiredVehicleTypeNorm || "",
        distanceKm: null as number | null,
        isSameRoute: false,
        route: planningRoute || null,
      }
    })

    const nearbyByAtId = new Map(
      (mapPayload?.nearbyRoutes || []).map((route) => [
        route.atId,
        {
          atId: route.atId,
          color: route.color,
          nearestStop: route.nearestStop,
          cluster: route.cluster,
          driverName: route.driverName,
          vehicleType: route.vehicleType,
          distanceKm: route.distanceKm,
          isSameRoute: route.isSameRoute,
          route: routeByAtId.get(route.atId) || null,
        },
      ]),
    )

    const merged = allRoutes.map((route) => nearbyByAtId.get(route.atId) || route)

    merged.sort((left, right) => {
      const leftDistance = left.distanceKm ?? Number.POSITIVE_INFINITY
      const rightDistance = right.distanceKm ?? Number.POSITIVE_INFINITY
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance
      }
      return left.atId.localeCompare(right.atId)
    })

    return merged
  }, [mapPayload, routeByAtId])

  const visibleMapRoutes = useMemo(() => {
    const routes = mapPayload?.routes || []
    if (atFilter === "all") return routes
    return routes.filter((route) => route.atId === atFilter)
  }, [atFilter, mapPayload])

  const handleSavePreferences = async (nextPreferences: Array<{ cluster: string; driverId: string }>) => {
    setIsSavingPreferences(true)
    try {
      const response = await saveRoutePlanningPreferences(nextPreferences)
      setPayload((current) =>
        current
          ? {
              ...current,
              preferredAssignments: response.preferences,
            }
          : current,
      )
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel salvar as preferencias"))
    } finally {
      setIsSavingPreferences(false)
    }
  }

  const handleAddPreferredAssignment = async () => {
    if (!preferredCluster || !preferredDriverId || !payload) return

    const nextPreferences = [
      ...payload.preferredAssignments.map((item) => ({
        cluster: item.cluster,
        driverId: item.driverId,
      })),
      {
        cluster: preferredCluster,
        driverId: preferredDriverId,
      },
    ]

    await handleSavePreferences(nextPreferences)
    setPreferredCluster("")
    setPreferredDriverId("")
    setPreferredDriverSearch("")
  }

  const handleRemovePreferredAssignment = async (entry: RoutePlanningPreference) => {
    if (!payload) return

    const nextPreferences = payload.preferredAssignments
      .filter((item) => !(item.cluster === entry.cluster && item.driverId === entry.driverId))
      .map((item) => ({
        cluster: item.cluster,
        driverId: item.driverId,
      }))

    await handleSavePreferences(nextPreferences)
  }

  const filteredPreferredDrivers = useMemo(() => {
    const query = preferredDriverSearch.trim().toLowerCase()
    const selectedPairs = new Set(
      (payload?.preferredAssignments || []).map((item) => `${item.cluster}:${item.driverId}`),
    )

    return (payload?.drivers || [])
      .filter((driver) => !preferredCluster || !selectedPairs.has(`${preferredCluster}:${driver.id}`))
      .filter((driver) => {
        if (!query) return true
        const driverName = String(driver.name || "").toLowerCase()
        return driverName.includes(query)
      })
      .sort((left, right) => {
        if (left.available !== right.available) return left.available ? -1 : 1
        const leftName = String(left.name || left.id)
        const rightName = String(right.name || right.id)
        return leftName.localeCompare(rightName)
      })
      .slice(0, 8)
  }, [payload, preferredCluster, preferredDriverSearch])

  const eligibleDrivers = useMemo(() => {
    if (!selectedRoute || !payload) return []

    const query = driverSearch.trim().toLowerCase()
    return payload.drivers
      .filter((driver) => driver.available)
      .filter((driver) => {
        if (!selectedRoute.requiredVehicleTypeNorm || selectedRoute.requiredVehicleTypeNorm !== "MOTO") {
          return true
        }
        return driver.vehicleType === "MOTO"
      })
      .filter((driver) => {
        if (!query) return true
        return (
          driver.id.toLowerCase().includes(query) ||
          driver.vehicleType.toLowerCase().includes(query) ||
          driver.profile.toLowerCase().includes(query)
        )
      })
      .sort((left, right) => right.ds - left.ds)
  }, [driverSearch, payload, selectedRoute])

  const handleRunPlanning = async () => {
    setIsRunning(true)
    try {
      const response = await runRoutePlanningRequest({
        date,
        shift: shift === "all" ? undefined : shift,
        focus,
      })
      toast.success(`${response.message} ${response.totalAssignments} sugestoes geradas.`)
      if (response.assignments.length) {
        const escapeCsvValue = (value: string) => {
          const normalized = String(value ?? "")
          if (normalized.includes(",") || normalized.includes("\"") || normalized.includes("\n")) {
            return `"${normalized.replace(/"/g, "\"\"")}"`
          }
          return normalized
        }

        const lines = [
          ["AT", "ID_MOTORISTA"],
          ...response.assignments.map((item) => [item.atId, item.suggestedDriverId]),
        ]
        const csvContent = lines.map((line) => line.map(escapeCsvValue).join(",")).join("\n")
        const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        const shiftLabel = shift === "all" ? "todos" : shift.toLowerCase()
        link.href = url
        link.download = `planejamento-${date}-${shiftLabel}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
      }

      await loadPlanningData(true)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel rodar o planejamento"))
    } finally {
      setIsRunning(false)
    }
  }

  const handleSendRequest = async () => {
    if (!selectedRoute || !selectedDriverId) return

    setIsSending(true)
    try {
      const response = await assignRoute(selectedRoute.id, selectedDriverId)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      toast.success(`Solicitacao enviada para a rota ${selectedRoute.atId}`)
      setSelectedRoute(null)
      setSelectedDriverId("")
      setDriverSearch("")

      await loadPlanningData(true)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel enviar a solicitacao"))
    } finally {
      setIsSending(false)
    }
  }

  const openRequestDialog = (route: RoutePlanningItem, driverId?: string | null) => {
    setSelectedRoute(route)
    setSelectedDriverId(driverId || "")
    setDriverSearch("")
  }

  const applyAtFilter = (nextAtId: string) => {
    setAtFilter((current) => (current === nextAtId ? "all" : nextAtId))
  }

  const copyTextToClipboard = async (text: string) => {
    const value = String(text || "").trim()
    if (!value) return false

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return true
      }
    } catch {
      // Fallback below.
    }

    try {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "absolute"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand("copy")
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }

  const handleNearbyRouteClick = async (atId: string) => {
    const copied = await copyTextToClipboard(atId)
    applyAtFilter(atId)

    if (copied) {
      toast.success(`AT ${atId} copiada para a area de transferencia.`)
    } else {
      toast.error("Nao foi possivel copiar a AT automaticamente.")
    }
  }

  const handlePrintLabel = (route: RoutePlanningItem) => {
    const gaiola = String(route.gaiola || "").trim()
    if (!gaiola) {
      toast.error("Essa rota nao possui gaiola para imprimir.")
      return
    }

    const labelWindow = window.open("", "_blank", "width=420,height=260")
    if (!labelWindow) {
      toast.error("Nao foi possivel abrir a janela de impressao.")
      return
    }

    const escapedGaiola = gaiola
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;")

    labelWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Etiqueta ${escapedGaiola}</title>
    <style>
      @page {
        size: 7.3cm 4.3cm;
        margin: 0;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        width: 7.3cm;
        height: 4.3cm;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .label {
        width: 7.3cm;
        height: 4.3cm;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #000;
        font-size: 24pt;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
    </style>
  </head>
  <body>
    <div class="label">${escapedGaiola}</div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.print();
        }, 100);
      });
      window.addEventListener('afterprint', function () {
        window.close();
      });
    </script>
  </body>
</html>`)
    labelWindow.document.close()
  }

  useEffect(() => {
    if (!isQrDialogOpen) {
      setIsQrStarting(false)
      setQrMode("idle")
      if (scanFrameRef.current !== null) {
        window.cancelAnimationFrame(scanFrameRef.current)
        scanFrameRef.current = null
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((track) => track.stop())
        videoStreamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      if (html5QrScannerRef.current) {
        void html5QrScannerRef.current.stop().catch(() => undefined).finally(() => {
          void html5QrScannerRef.current?.clear().catch(() => undefined)
          html5QrScannerRef.current = null
        })
      }
      if (qrScannerContainerRef.current) {
        qrScannerContainerRef.current.innerHTML = ""
      }
      return
    }

    let isCancelled = false

    const stopScanner = () => {
      if (scanFrameRef.current !== null) {
        window.cancelAnimationFrame(scanFrameRef.current)
        scanFrameRef.current = null
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((track) => track.stop())
        videoStreamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      if (html5QrScannerRef.current) {
        void html5QrScannerRef.current.stop().catch(() => undefined).finally(() => {
          void html5QrScannerRef.current?.clear().catch(() => undefined)
          html5QrScannerRef.current = null
        })
      }
      if (qrScannerContainerRef.current) {
        qrScannerContainerRef.current.innerHTML = ""
      }
    }

    const applyQrResult = (rawValue: string) => {
      const normalizedBr = rawValue.trim().toUpperCase()
      setBrInput(normalizedBr)
      setBrFilter(normalizedBr)
      setIsQrDialogOpen(false)
      toast.success(`QR lido com sucesso: ${normalizedBr}`)
    }

    const ensureHtml5QrScript = async () => {
      const html5Window = window as typeof window & {
        Html5Qrcode?: new (
          elementId: string,
          verbose?: boolean,
        ) => {
          start: (
            cameraConfigOrId: string | { facingMode?: string | { exact?: string; ideal?: string } },
            config: Record<string, unknown>,
            onSuccess: (decodedText: string) => void,
            onError?: (errorMessage: string) => void,
          ) => Promise<void>
          stop: () => Promise<void>
          clear: () => Promise<void>
        }
        Html5QrcodeSupportedFormats?: {
          QR_CODE?: number
        }
      }

      if (html5Window.Html5Qrcode) {
        return html5Window
      }

      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>('script[data-qr-lib="html5-qrcode"]')
        if (existingScript) {
          existingScript.addEventListener("load", () => resolve(), { once: true })
          existingScript.addEventListener("error", () => reject(new Error("qr-lib-load-error")), { once: true })
          return
        }

        const script = document.createElement("script")
        script.src = "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js"
        script.async = true
        script.dataset.qrLib = "html5-qrcode"
        script.onload = () => resolve()
        script.onerror = () => reject(new Error("qr-lib-load-error"))
        document.body.appendChild(script)
      })

      return html5Window
    }

    const startFallbackScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("A camera nao esta disponivel neste dispositivo.")
        setIsQrDialogOpen(false)
        return
      }

      setIsQrStarting(true)
      setQrMode("fallback")

      try {
        const html5Window = await ensureHtml5QrScript()
        const Html5QrcodeCtor = html5Window.Html5Qrcode
        if (!Html5QrcodeCtor) {
          throw new Error("qr-lib-unavailable")
        }

        if (isCancelled) return

        const container = qrScannerContainerRef.current
        if (!container) {
          throw new Error("qr-container-missing")
        }

        container.innerHTML = ""
        const scanner = new Html5QrcodeCtor("route-planning-qr-reader", false)
        html5QrScannerRef.current = scanner

        await scanner.start(
          { facingMode: { ideal: "environment" } },
          {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            formatsToSupport: html5Window.Html5QrcodeSupportedFormats?.QR_CODE
              ? [html5Window.Html5QrcodeSupportedFormats.QR_CODE]
              : undefined,
          },
          (decodedText) => {
            applyQrResult(decodedText)
          },
          () => undefined,
        )
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel iniciar a leitura de QR"))
        setIsQrDialogOpen(false)
      } finally {
        if (!isCancelled) {
          setIsQrStarting(false)
        }
      }
    }

    const startScanner = async () => {
      const BarcodeDetectorCtor = (window as typeof window & {
        BarcodeDetector?: new (options?: { formats?: string[] }) => {
          detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
        }
      }).BarcodeDetector

      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("A camera nao esta disponivel neste dispositivo.")
        setIsQrDialogOpen(false)
        return
      }

      if (!BarcodeDetectorCtor) {
        await startFallbackScanner()
        return
      }

      setIsQrStarting(true)
      setQrMode("native")

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
        })

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        videoStreamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }

        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] })

        const scan = async () => {
          if (isCancelled || !isQrDialogOpen) return

          const video = videoRef.current
          if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
              const codes = await detector.detect(video)
              const qrCode = codes.find((code) => code.rawValue)

              if (qrCode?.rawValue) {
                applyQrResult(qrCode.rawValue)
                return
              }
            } catch {
              // Ignore one failed frame and keep scanning.
            }
          }

          scanFrameRef.current = window.requestAnimationFrame(() => {
            void scan()
          })
        }

        void scan()
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel acessar a camera"))
        setIsQrDialogOpen(false)
      } finally {
        if (!isCancelled) {
          setIsQrStarting(false)
        }
      }
    }

    void startScanner()

    return () => {
      isCancelled = true
      stopScanner()
    }
  }, [isQrDialogOpen])

  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <PageHeader title="Planejamento de Rota" breadcrumbs={[{ label: "Planejamento de Rota" }]} />

      <Card className="sticky top-4 z-20 overflow-hidden border bg-background/95 backdrop-blur">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Filtros e execucao</h2>
              <p className="text-sm text-muted-foreground">
                Controle a sincronizacao e os filtros do planejamento sem perder o contexto ao rolar a tela.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() => setIsFiltersCollapsed((current) => !current)}
                aria-label={isFiltersCollapsed ? "Expandir filtros" : "Recolher filtros"}
              >
                {isFiltersCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing || isRunning}>
                {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Atualizar Dados
              </Button>
              <Button onClick={handleRunPlanning} disabled={isRunning || isRefreshing}>
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Rodar Planejamento
              </Button>
            </div>
          </div>

          {!isFiltersCollapsed ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data</span>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Turno</span>
                <Select value={shift} onValueChange={(value) => setShift(value as ShiftFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                    <SelectItem value="PM2">PM2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Foco</span>
                <Select value={focus} onValueChange={(value) => setFocus(value as PlanningFocus)}>
                  <SelectTrigger>
                    <SelectValue placeholder="DS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DS">DS</SelectItem>
                    <SelectItem value="VOLUME">Volume</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster</span>
                <Select value={clusterFilter} onValueChange={setClusterFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {clusterOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 xl:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Busca</span>
                <Input
                  placeholder="AT, motorista, bairro..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Resumo do planejamento</h3>
              <p className="text-xs text-muted-foreground">
                Resultado atual da base filtrada para acompanhamento rapido antes da lista detalhada.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsSummaryCollapsed((current) => !current)}
            >
              {isSummaryCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>

          {!isSummaryCollapsed ? (
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rotas</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.routes ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">No-show</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.noShowAvailable ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Telegram</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.telegramRequested ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Manual</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.manualRequested ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendentes</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.pendingRequest ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sugestoes</p>
                <p className="mt-2 text-2xl font-semibold">{payload?.totals.suggestions ?? 0}</p>
              </CardContent>
            </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Motoristas Preferenciais por Cluster</h3>
              <p className="text-xs text-muted-foreground">
                Esses motoristas sao alocados primeiro nas rotas cujo primeiro cluster coincide com a preferencia. Depois disso, o algoritmo normal continua.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsPreferredCollapsed((current) => !current)}
            >
              {isPreferredCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>

          {!isPreferredCollapsed ? (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster</span>
              <Select value={preferredCluster} onValueChange={setPreferredCluster}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {clusterOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Motorista</span>
              <Input
                placeholder="Pesquisar motorista pelo nome"
                value={preferredDriverSearch}
                onChange={(event) => setPreferredDriverSearch(event.target.value)}
              />
              <div className="max-h-44 space-y-2 overflow-auto rounded-md border p-2">
                {filteredPreferredDrivers.length ? (
                  filteredPreferredDrivers.map((driver) => (
                    <button
                      key={driver.id}
                      type="button"
                      onClick={() => {
                        setPreferredDriverId(driver.id)
                        setPreferredDriverSearch(driver.name || driver.id)
                      }}
                      className={`flex w-full items-start justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        preferredDriverId === driver.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{driver.name || driver.id}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {driver.id} | {driver.vehicleType} | DS {driver.ds.toFixed(2)}
                        </span>
                      </div>
                      <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                        {driver.available ? "Disponivel" : "Indisponivel"}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-1 text-xs text-muted-foreground">Nenhum motorista encontrado.</p>
                )}
              </div>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => void handleAddPreferredAssignment()}
                disabled={!preferredCluster || !preferredDriverId || isSavingPreferences}
              >
                {isSavingPreferences ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Adicionar
              </Button>
            </div>
              </div>

              <div className="space-y-2">
            {(payload?.preferredAssignments || []).length ? (
              payload?.preferredAssignments.map((item) => (
                <div
                  key={`${item.cluster}:${item.driverId}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        Cluster {item.cluster}
                        {item.clusterName ? ` - ${item.clusterName}` : ""}
                      </Badge>
                      <span className="text-sm font-medium">{item.driverName || item.driverId}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {item.driverId} | {item.vehicleType || "Sem veiculo"} | {item.available ? "Disponivel" : "Indisponivel"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRemovePreferredAssignment(item)}
                    disabled={isSavingPreferences}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma preferencia configurada.</p>
            )}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Mapa das entregas</h3>
              <p className="text-xs text-muted-foreground">
                Visualize as paradas da guia Calculation Tasks. Ao clicar em uma rota na lista abaixo, o mapa pode filtrar para aquela AT.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsMapCollapsed((current) => !current)}
            >
              {isMapCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>

          {!isMapCollapsed ? <RoutePlanningMap routes={visibleMapRoutes} /> : null}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Rotas planejadas</h3>
                <p className="text-xs text-muted-foreground">
                  Solicitacoes do bot, no-show reaberto e sugestoes da regra. Foco atual: {focus}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsRoutesCollapsed((current) => !current)}
                >
                  {isRoutesCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {!isRoutesCollapsed ? (
              <div className="max-h-[70vh] w-full overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>AT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Sugestao</TableHead>
                    <TableHead>Motorista Atual</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Bairro</TableHead>
                    <TableHead>Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.map((route) => (
                    <TableRow
                      key={route.id}
                      className={`cursor-pointer ${atFilter === route.atId ? "bg-primary/5" : ""}`}
                      onClick={() => applyAtFilter(route.atId || route.id)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{route.atId}</span>
                          <span className="text-xs text-muted-foreground">
                            {route.shift || "Sem turno"}{route.noShow ? " | no-show" : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={route.status} />
                      </TableCell>
                      <TableCell>
                        {route.hasTelegramRequest ? (
                          <Badge variant="secondary">Telegram</Badge>
                        ) : route.hasManualRequest ? (
                          <Badge variant="outline">Manual</Badge>
                        ) : (
                          <Badge variant="outline">Sem solicitacao</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {route.suggestedDriverId ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {route.suggestedDriverName || route.suggestedDriverId}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {route.suggestedDriverId} | {route.suggestedDriverVehicle} | DS {route.suggestedDriverDs?.toFixed(2)} | {route.suggestedPhase}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem sugestao</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{route.driverName || route.driverId || "-"}</span>
                          <span className="text-xs text-muted-foreground">{route.requestedDriverId || "Sem motorista"}</span>
                        </div>
                      </TableCell>
                      <TableCell>{route.cidade || "-"}</TableCell>
                      <TableCell>{route.bairro || "-"}</TableCell>
                      <TableCell>{route.volume || "-"}</TableCell>
                    </TableRow>
                  ))}
                  {!filteredRoutes.length ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                        Nenhuma rota encontrada para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>

      </div>

      <Dialog
        open={!!selectedRoute}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRoute(null)
            setSelectedDriverId("")
            setDriverSearch("")
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Enviar solicitacao</DialogTitle>
            <DialogDescription>
              Selecione um motorista para a rota {selectedRoute?.atId}. Essa acao vai registrar a solicitacao na planilha e no painel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Buscar por ID, veiculo ou perfil"
              value={driverSearch}
              onChange={(event) => setDriverSearch(event.target.value)}
            />

            <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motorista" />
              </SelectTrigger>
              <SelectContent>
                {eligibleDrivers.map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.id} | {driver.vehicleType} | DS {driver.ds.toFixed(2)} | {driver.profile}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedRoute?.suggestedObservation ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                Sugestao atual: {selectedRoute.suggestedObservation}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRoute(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSendRequest} disabled={!selectedDriverId || isSending}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar solicitacao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ler QR do pacote</DialogTitle>
            <DialogDescription>
              Aponte a camera para o QR code do pacote para preencher automaticamente o BR.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-black">
              <video
                ref={videoRef}
                className={`aspect-video w-full object-cover ${qrMode === "native" ? "block" : "hidden"}`}
                autoPlay
                muted
                playsInline
              />
              <div
                id="route-planning-qr-reader"
                ref={qrScannerContainerRef}
                className={`${qrMode === "fallback" ? "block" : "hidden"} min-h-[18rem] bg-black`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {isQrStarting
                ? "Iniciando camera..."
                : qrMode === "fallback"
                  ? "Usando modo compativel de leitura por camera."
                  : "Assim que o QR for detectado, o BR sera preenchido automaticamente."}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsQrDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
