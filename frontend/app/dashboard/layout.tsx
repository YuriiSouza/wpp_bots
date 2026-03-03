"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthProvider, useAuthContext } from "@/components/auth-provider"
import { QueryProvider } from "@/components/query-provider"
import { fetchHubs, getApiErrorMessage } from "@/lib/admin-api"
import type { HubOption } from "@/lib/types"
import { toast } from "sonner"

function DashboardGuard({ children }: { children: React.ReactNode }) {
  const { completeOnboarding, isAuthenticated, isLoading, user } = useAuthContext()
  const router = useRouter()
  const [hubs, setHubs] = useState<HubOption[]>([])
  const [selectedHubId, setSelectedHubId] = useState("")
  const [telegramChatId, setTelegramChatId] = useState("")
  const [isSetupLoading, setIsSetupLoading] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login")
    }
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (!isAuthenticated || !user || (user.hubId && user.telegramChatId)) return

    void fetchHubs()
      .then((response) => {
        setHubs(response)
        setSelectedHubId((current) => current || user.hubId || response[0]?.id || "")
      })
      .catch((error) => {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar os hubs"))
      })
  }, [isAuthenticated, user])

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null

  if (user && (!user.hubId || !user.telegramChatId)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Configurar Acesso</CardTitle>
            <CardDescription>
              Antes de usar o painel, defina seu hub e o Telegram Chat ID. Esses dados ficam salvos na sua conta.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Hub</Label>
              <Select value={selectedHubId || "none"} onValueChange={(value) => setSelectedHubId(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um hub" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione</SelectItem>
                  {hubs.map((hub) => (
                    <SelectItem key={hub.id} value={hub.id}>{hub.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="telegram-chat-id">Telegram Chat ID</Label>
              <Input
                id="telegram-chat-id"
                value={telegramChatId}
                onChange={(event) => setTelegramChatId(event.target.value)}
                placeholder="Ex.: 123456789"
              />
            </div>
            <Button
              disabled={isSetupLoading}
              onClick={() => {
                if (!selectedHubId || !telegramChatId.trim()) {
                  toast.error("Preencha hub e Telegram Chat ID")
                  return
                }

                setIsSetupLoading(true)
                void completeOnboarding(selectedHubId, telegramChatId.trim())
                  .catch((error) => {
                    toast.error(getApiErrorMessage(error, "Nao foi possivel concluir a configuracao"))
                  })
                  .finally(() => {
                    setIsSetupLoading(false)
                  })
              }}
            >
              {isSetupLoading ? "Salvando..." : "Salvar e continuar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <DashboardGuard>{children}</DashboardGuard>
      </AuthProvider>
    </QueryProvider>
  )
}
