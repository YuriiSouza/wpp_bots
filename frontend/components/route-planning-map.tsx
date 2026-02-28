"use client"

import { useEffect, useRef, useState } from "react"
import type { RoutePlanningMapRoute } from "@/lib/types"

interface RoutePlanningMapProps {
  routes: RoutePlanningMapRoute[]
}

declare global {
  interface Window {
    L?: any
  }
}

const LEAFLET_CSS_ID = "route-planning-leaflet-css"
const LEAFLET_SCRIPT_ID = "route-planning-leaflet-script"
const LEAFLET_SCRIPT_SRC = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
const LEAFLET_CSS_HREF = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"

function ensureLeafletAssets(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve()
  }

  if (!document.getElementById(LEAFLET_CSS_ID)) {
    const link = document.createElement("link")
    link.id = LEAFLET_CSS_ID
    link.rel = "stylesheet"
    link.href = LEAFLET_CSS_HREF
    document.head.appendChild(link)
  }

  if (window.L) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(LEAFLET_SCRIPT_ID) as HTMLScriptElement | null

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar Leaflet")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = LEAFLET_SCRIPT_ID
    script.src = LEAFLET_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Falha ao carregar Leaflet"))
    document.body.appendChild(script)
  })
}

export function RoutePlanningMap({ routes }: RoutePlanningMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const markerLayerRef = useRef<any>(null)
  const polylineLayerRef = useRef<any>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!routes.length && mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }
  }, [routes])

  useEffect(() => {
    let cancelled = false

    const renderMap = async () => {
      try {
        setHasError(false)
        await ensureLeafletAssets()
        if (cancelled || !mapRef.current || !window.L) return

        const L = window.L

        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove()
          mapInstanceRef.current = null
        }

        const map = L.map(mapRef.current, { zoomControl: true })
        mapInstanceRef.current = map

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map)

        const bounds: [number, number][] = []
        const polylineLayer = L.layerGroup().addTo(map)
        const markerLayer = L.layerGroup().addTo(map)
        polylineLayerRef.current = polylineLayer
        markerLayerRef.current = markerLayer

        routes.forEach((route) => {
          const line: [number, number][] = route.stops.map((stop) => [stop.latitude, stop.longitude])
          if (!line.length) return

          line.forEach((point) => bounds.push(point))

          L.polyline(line, {
            color: route.color,
            weight: 4,
            opacity: 0.9,
          }).addTo(polylineLayer)
        })

        const renderVisibleMarkers = () => {
          if (!markerLayerRef.current) return
          markerLayerRef.current.clearLayers()

          const currentZoom = map.getZoom()
          if (currentZoom < 13) {
            return
          }

          const visibleBounds = map.getBounds()

          routes.forEach((route) => {
            route.stops.forEach((stop) => {
              if (!visibleBounds.contains([stop.latitude, stop.longitude])) {
                return
              }

              const icon = L.divIcon({
                className: "route-planning-stop-icon",
                html: `<div style="
                  background:${route.color};
                  border:2px solid #ffffff;
                  border-radius:999px;
                  color:#ffffff;
                  font-size:11px;
                  font-weight:700;
                  width:22px;
                  height:22px;
                  display:flex;
                  align-items:center;
                  justify-content:center;
                  box-shadow:0 0 0 3px ${route.color}33, 0 2px 8px rgba(0,0,0,0.25);
                ">${String(stop.stop)}</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11],
              })

              L.marker([stop.latitude, stop.longitude], { icon })
                .addTo(markerLayerRef.current)
                .bindPopup(
                  `<strong>AT ${route.atId}</strong><br />Parada: ${String(stop.stop)}<br />Pacotes: ${String(
                    stop.packageCount
                  )}<br />Cluster: ${stop.cluster || "-"}<br />BR: ${stop.brs.join(", ") || "-"}`
                )
            })
          })
        }

        if (bounds.length) {
          map.fitBounds(bounds, { padding: [24, 24] })
        } else {
          map.setView([-23.5505, -46.6333], 10)
        }

        map.on("moveend zoomend", renderVisibleMarkers)
        renderVisibleMarkers()
      } catch {
        if (!cancelled) {
          setHasError(true)
        }
      }
    }

    void renderMap()

    return () => {
      cancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
      markerLayerRef.current = null
      polylineLayerRef.current = null
    }
  }, [routes])

  if (hasError) {
    return (
      <div className="flex h-[520px] w-full items-center justify-center rounded-xl border bg-muted/30 px-6 text-center text-sm text-muted-foreground">
        Nao foi possivel carregar o mapa OpenStreetMap no navegador.
      </div>
    )
  }

  if (!routes.length) {
    return (
      <div className="flex h-[520px] w-full items-center justify-center rounded-xl border bg-muted/30 px-6 text-center text-sm text-muted-foreground">
        Nenhum ponto encontrado na guia Calculation Tasks para o filtro atual.
      </div>
    )
  }

  return <div ref={mapRef} className="h-[520px] w-full rounded-xl border bg-background" />
}
