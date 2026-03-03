"use client"

import { useEffect, useRef, useState } from "react"
import Script from "next/script"
import { useRouter } from "next/navigation"
import { Headset } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchHubs } from "@/lib/admin-api"
import type { HubOption } from "@/lib/types"

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: { credential?: string }) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number | boolean>
          ) => void
        }
      }
    }
  }
}

export default function LoginPage() {
  const router = useRouter()
  const { googleLogin } = useAuth()
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const hubIdRef = useRef("")
  const telegramChatIdRef = useRef("")
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""
  const [hubId, setHubId] = useState("")
  const [telegramChatId, setTelegramChatId] = useState("")
  const [hubs, setHubs] = useState<HubOption[]>([])
  const [isGoogleScriptReady, setIsGoogleScriptReady] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetchHubs()
        setHubs(response)
        setHubId((current) => current || response[0]?.id || "")
      } catch {
        setHubs([])
      }
    })()
  }, [])

  useEffect(() => {
    hubIdRef.current = hubId
  }, [hubId])

  useEffect(() => {
    telegramChatIdRef.current = telegramChatId
  }, [telegramChatId])

  useEffect(() => {
    if (!isGoogleScriptReady || !googleClientId || !googleButtonRef.current || !window.google) {
      return
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: ({ credential }) => {
        if (!credential) {
          setError("Nao foi possivel concluir o login com Google")
          return
        }

        setError("")
        setIsLoading(true)
        void googleLogin(credential, hubIdRef.current || null, telegramChatIdRef.current || null)
          .then(() => {
            router.push("/dashboard")
          })
          .catch((responseError: unknown) => {
            const message =
              responseError instanceof Error
                ? responseError.message
                : "Nao foi possivel validar seu acesso com Google"
            setError(message)
          })
          .finally(() => {
            setIsLoading(false)
          })
      },
    })

    googleButtonRef.current.innerHTML = ""
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: 320,
    })
  }, [googleClientId, googleLogin, isGoogleScriptReady, router])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setIsGoogleScriptReady(true)} />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Headset className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Fleet Analysis</h1>
            <p className="text-sm text-muted-foreground">Operacao, atendimento e comunicacao via Telegram</p>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Entrar com Google</CardTitle>
            <CardDescription>
              Use sua conta Google. O primeiro acesso fica pendente ate um admin aprovar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label>Hub</Label>
                <Select value={hubId || "none"} onValueChange={(value) => setHubId(value === "none" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um hub" />
                  </SelectTrigger>
                  <SelectContent>
                    {hubs.length ? (
                      hubs.map((hub) => (
                        <SelectItem key={hub.id} value={hub.id}>{hub.name}</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none">Sem hubs cadastrados</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="telegram-chat-id">Telegram Chat ID (Opcional)</Label>
                <Input
                  id="telegram-chat-id"
                  type="text"
                  placeholder="Ex.: 123456789"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                />
              </div>
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                No primeiro acesso, seu cadastro e criado como pendente. Um admin precisa aprovar antes da entrada.
              </div>
              {!googleClientId ? (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  Defina `NEXT_PUBLIC_GOOGLE_CLIENT_ID` para habilitar o login com Google.
                </div>
              ) : null}
              <div className={isLoading ? "pointer-events-none opacity-60" : ""}>
                <div ref={googleButtonRef} className="flex justify-center" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
