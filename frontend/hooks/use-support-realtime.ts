"use client"

import { useEffect, useRef, useState } from "react"
import type { SupportMessage } from "@/lib/support-types"

interface RealtimeEvent {
  type: string
  ticketId?: string
  message?: SupportMessage
  isTyping?: boolean
}

export function useSupportRealtime(ticketId: string | null, token: string | null) {
  const socketRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [typing, setTyping] = useState(false)
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null)

  useEffect(() => {
    if (!ticketId || typeof window === "undefined") {
      setIsConnected(false)
      setTyping(false)
      return
    }

    const url =
      process.env.NEXT_PUBLIC_SUPPORT_WS_URL ||
      process.env.NEXT_PUBLIC_API_WS_URL ||
      "ws://localhost:3000/support/ws"

    let socket: WebSocket | null = null

    try {
      socket = new WebSocket(url)
      socketRef.current = socket
    } catch {
      setIsConnected(false)
      return
    }

    socket.addEventListener("open", () => {
      setIsConnected(true)
      socket?.send(
        JSON.stringify({
          type: "support.subscribe",
          ticketId,
          token,
        })
      )
    })

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent
        if (payload.ticketId && payload.ticketId !== ticketId) return
        if (payload.type === "support.typing") {
          setTyping(Boolean(payload.isTyping))
        }
        setLastEvent(payload)
      } catch {
        // Ignore malformed realtime frames.
      }
    })

    socket.addEventListener("close", () => {
      setIsConnected(false)
      setTyping(false)
    })

    socket.addEventListener("error", () => {
      setIsConnected(false)
    })

    return () => {
      socket?.close()
      socketRef.current = null
      setTyping(false)
    }
  }, [ticketId, token])

  const sendTyping = (isTyping: boolean) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !ticketId) return
    socketRef.current.send(
      JSON.stringify({
        type: "support.typing",
        ticketId,
        isTyping,
      })
    )
  }

  return {
    isConnected,
    typing,
    lastEvent,
    sendTyping,
  }
}
