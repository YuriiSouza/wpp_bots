"use client"

import { useCallback, useEffect, useState } from "react"
import { Settings, Save, RotateCcw, Shield, Sliders, Users, RefreshCw } from "lucide-react"
import { useAuthContext } from "@/components/auth-provider"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createHub,
  createManagedUser,
  fetchManagedUsers,
  fetchOperationContext,
  fetchSettings,
  getApiErrorMessage,
  saveSettings,
  updateOperationContext,
  updateManagedUser,
  type OperationContextPayload,
  type SettingsPayload,
  type UserManagementPayload,
} from "@/lib/admin-api"
import { toast } from "sonner"

export default function SettingsPage() {
  const { hasRole } = useAuthContext()
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [userManagement, setUserManagement] = useState<UserManagementPayload | null>(null)
  const [isUsersLoading, setIsUsersLoading] = useState(false)
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [isCreatingHub, setIsCreatingHub] = useState(false)
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "ANALISTA" as "ADMIN" | "ANALISTA" | "SUPERVISOR",
    hubId: "hub-sp",
    telegramChatId: "",
  })
  const [userTelegramChatDrafts, setUserTelegramChatDrafts] = useState<Record<string, string>>({})
  const [newHub, setNewHub] = useState({
    name: "",
    timezone: "America/Sao_Paulo",
  })
  const [operationContext, setOperationContext] = useState<OperationContextPayload>({
    date: new Date().toISOString().slice(0, 10),
    shift: "AM",
  })
  const [isSavingOperationContext, setIsSavingOperationContext] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const isAdmin = hasRole("ADMIN")

  const loadSettings = useCallback(async () => {
    try {
      const [settingsResponse, operationContextResponse] = await Promise.all([
        fetchSettings(),
        fetchOperationContext(),
      ])
      setSettings(settingsResponse)
      setOperationContext(operationContextResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel carregar as configuracoes"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (!isAdmin) return

    void loadUsers()
  }, [isAdmin])

  const loadUsers = async () => {
    setIsUsersLoading(true)
    try {
      const response = await fetchManagedUsers()
      setUserManagement(response)
      setUserTelegramChatDrafts(
        Object.fromEntries(
          response.users.map((user) => [user.id, user.telegramChatId || ""])
        )
      )
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel carregar os usuarios"))
    } finally {
      setIsUsersLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings) return
    setIsSaving(true)
    try {
      const response = await saveSettings(settings)
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel salvar as configuracoes"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetAlgorithm = () => {
    if (!settings) return
    setSettings({
      ...settings,
      algorithm: {
        noShowWeight: 30,
        declineWeight: 25,
        dsWeight: 20,
        blockThreshold: 70,
        autoBlock: true,
      },
    })
    toast.info("Configuracoes resetadas para padrao")
  }

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast.error("Preencha nome, e-mail e senha")
      return
    }

    setIsCreatingUser(true)
    try {
      const response = await createManagedUser({
        ...newUser,
        hubId: newUser.role === "ADMIN" ? null : newUser.hubId,
        telegramChatId: newUser.telegramChatId || null,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              users: [response.user, ...current.users],
            }
          : current
      )
      setUserTelegramChatDrafts((current) => ({
        ...current,
        [response.user.id]: response.user.telegramChatId || "",
      }))
      setNewUser({
        name: "",
        email: "",
        password: "",
        role: "ANALISTA",
        hubId: userManagement?.hubs[0]?.id || "hub-sp",
        telegramChatId: "",
      })
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel criar o usuario"))
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleCreateHub = async () => {
    if (!newHub.name.trim()) {
      toast.error("Preencha o nome do hub")
      return
    }

    setIsCreatingHub(true)
    try {
      const response = await createHub(newHub)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              hubs: [...current.hubs, response.hub].sort((left, right) => left.name.localeCompare(right.name)),
            }
          : current
      )
      setNewHub({
        name: "",
        timezone: "America/Sao_Paulo",
      })
      setNewUser((current) => ({
        ...current,
        hubId: current.hubId || response.hub.id,
      }))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel criar o hub"))
    } finally {
      setIsCreatingHub(false)
    }
  }

  const handleSaveOperationContext = async () => {
    setIsSavingOperationContext(true)
    try {
      const response = await updateOperationContext(operationContext)
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      setOperationContext(response.context)
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o turno vigente"))
    } finally {
      setIsSavingOperationContext(false)
    }
  }

  const handleToggleUser = async (userId: string, isActive: boolean) => {
    try {
      const response = await updateManagedUser(userId, { isActive: !isActive })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === userId ? response.user : user
              ),
            }
          : current
      )
      setUserTelegramChatDrafts((current) => ({
        ...current,
        [userId]: response.user.telegramChatId || "",
      }))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o usuario"))
    }
  }

  const handleRoleChange = async (
    userId: string,
    role: "ADMIN" | "ANALISTA" | "SUPERVISOR"
  ) => {
    try {
      const response = await updateManagedUser(userId, { role })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === userId ? response.user : user
              ),
            }
          : current
      )
      setUserTelegramChatDrafts((current) => ({
        ...current,
        [userId]: response.user.telegramChatId || "",
      }))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o papel"))
    }
  }

  const handleHubChange = async (userId: string, hubId: string) => {
    try {
      const response = await updateManagedUser(userId, { hubId })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === userId ? response.user : user
              ),
            }
          : current
      )
      setUserTelegramChatDrafts((current) => ({
        ...current,
        [userId]: response.user.telegramChatId || "",
      }))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o hub"))
    }
  }

  const handleTelegramChatSave = async (userId: string) => {
    try {
      const response = await updateManagedUser(userId, {
        telegramChatId: userTelegramChatDrafts[userId] || null,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setUserManagement((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) => (user.id === userId ? response.user : user)),
            }
          : current
      )
      setUserTelegramChatDrafts((current) => ({
        ...current,
        [userId]: response.user.telegramChatId || "",
      }))
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel salvar o Telegram Chat ID"))
    }
  }

  if (isLoading || !settings) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Configuracoes" breadcrumbs={[{ label: "Configuracoes" }]} />
        <div className="p-6 text-sm text-muted-foreground">Carregando configuracoes...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Configuracoes" breadcrumbs={[{ label: "Configuracoes" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Configuracoes</h2>
          <p className="text-sm text-muted-foreground">Ajustes do algoritmo, permissoes e sistema</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadSettings()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Recarregar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Salvando..." : "Salvar configuracoes"}
          </Button>
        </div>

        <Tabs defaultValue="algorithm" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="algorithm" className="gap-2"><Sliders className="h-4 w-4" /> Algoritmo</TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2"><Shield className="h-4 w-4" /> Permissoes</TabsTrigger>
            <TabsTrigger value="system" className="gap-2"><Settings className="h-4 w-4" /> Sistema</TabsTrigger>
            {isAdmin ? (
              <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" /> Usuarios</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="algorithm" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pesos do Algoritmo</CardTitle>
                  <CardDescription>Configure a importancia de cada metrica no calculo de prioridade</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  <WeightSlider label="Peso noShowCount" value={settings.algorithm.noShowWeight} onChange={(value) => setSettings({ ...settings, algorithm: { ...settings.algorithm, noShowWeight: value } })} />
                  <WeightSlider label="Peso declineRate" value={settings.algorithm.declineWeight} onChange={(value) => setSettings({ ...settings, algorithm: { ...settings.algorithm, declineWeight: value } })} />
                  <WeightSlider label="Peso DS" value={settings.algorithm.dsWeight} onChange={(value) => setSettings({ ...settings, algorithm: { ...settings.algorithm, dsWeight: value } })} />
                  <Separator />
                  <div className="flex gap-2">
                    <Button onClick={handleSave} className="flex-1"><Save className="mr-2 h-4 w-4" /> Salvar</Button>
                    <Button variant="outline" onClick={handleResetAlgorithm}><RotateCcw className="mr-2 h-4 w-4" /> Resetar</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bloqueio Automatico</CardTitle>
                  <CardDescription>Configure regras de bloqueio automatico baseado em metricas</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Bloqueio automatico ativo</Label>
                      <p className="text-xs text-muted-foreground">Bloquear motoristas automaticamente quando atingirem o threshold</p>
                    </div>
                    <Switch checked={settings.algorithm.autoBlock} onCheckedChange={(value) => setSettings({ ...settings, algorithm: { ...settings.algorithm, autoBlock: value } })} />
                  </div>
                  <WeightSlider label="Threshold de bloqueio" value={settings.algorithm.blockThreshold} onChange={(value) => setSettings({ ...settings, algorithm: { ...settings.algorithm, blockThreshold: value } })} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="permissions" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sistema de Permissoes</CardTitle>
                <CardDescription>Controle de acesso por papel</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4">
                  {settings.permissions.map((r) => (
                    <div key={r.role} className="rounded-lg border p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-card-foreground">{r.role}</p>
                          <p className="text-xs text-muted-foreground">{r.desc}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {r.perms.map((p) => (
                          <Badge key={p} variant="outline" className="text-xs bg-primary/5">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Turno Vigente</CardTitle>
                  <CardDescription>Controla a janela operacional usada pelo bot e pelo sync automatico</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label>Data vigente</Label>
                      <Input
                        type="date"
                        value={operationContext.date}
                        onChange={(e) =>
                          setOperationContext((current) => ({ ...current, date: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Turno vigente</Label>
                      <Select
                        value={operationContext.shift}
                        onValueChange={(value: "AM" | "PM" | "PM2") =>
                          setOperationContext((current) => ({ ...current, shift: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM">AM</SelectItem>
                          <SelectItem value="PM">PM</SelectItem>
                          <SelectItem value="PM2">PM2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button variant="outline" onClick={handleSaveOperationContext} disabled={isSavingOperationContext}>
                    {isSavingOperationContext ? "Salvando..." : "Salvar turno vigente"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">API Backend</CardTitle>
                  <CardDescription>Metadados de integracao exibidos no painel</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>URL de referencia da API</Label>
                    <Input value={settings.system.apiUrl} onChange={(e) => setSettings({ ...settings, system: { ...settings.system, apiUrl: e.target.value } })} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Nome exibido do Bot</Label>
                    <Input value={settings.system.telegramBotName} onChange={(e) => setSettings({ ...settings, system: { ...settings.system, telegramBotName: e.target.value } })} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Esses campos sao informativos no estado atual e nao alteram a logica operacional do bot.
                  </p>
                  <Button variant="outline" onClick={handleSave}>Salvar Sistema</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Informacoes do Sistema</CardTitle>
                  <CardDescription>Versao e metadados</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {[
                    ["Versao", settings.meta.version],
                    ["Stack", settings.meta.stack],
                    ["Banco", settings.meta.database],
                    ["Bot", settings.meta.bot],
                    ["Ambiente", settings.meta.environment],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-1">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium text-card-foreground">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {isAdmin ? (
            <TabsContent value="users" className="mt-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Criar Usuario</CardTitle>
                    <CardDescription>O admin pode criar novos acessos para o painel</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label>Nome</Label>
                      <Input
                        value={newUser.name}
                        onChange={(e) => setNewUser((current) => ({ ...current, name: e.target.value }))}
                        placeholder="Nome completo"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>E-mail</Label>
                      <Input
                        value={newUser.email}
                        onChange={(e) => setNewUser((current) => ({ ...current, email: e.target.value }))}
                        placeholder="usuario@rotabot.com"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Senha</Label>
                      <Input
                        type="password"
                        value={newUser.password}
                        onChange={(e) => setNewUser((current) => ({ ...current, password: e.target.value }))}
                        placeholder="Minimo 4 caracteres"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Telegram Chat ID</Label>
                      <Input
                        value={newUser.telegramChatId}
                        onChange={(e) => setNewUser((current) => ({ ...current, telegramChatId: e.target.value }))}
                        placeholder="Ex.: 123456789"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label>Papel</Label>
                        <Select
                          value={newUser.role}
                          onValueChange={(value: "ADMIN" | "ANALISTA" | "SUPERVISOR") =>
                            setNewUser((current) => ({
                              ...current,
                              role: value,
                              hubId: value === "ADMIN" ? "" : current.hubId || userManagement?.hubs[0]?.id || "hub-sp",
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADMIN">ADMIN</SelectItem>
                            <SelectItem value="ANALISTA">ANALISTA</SelectItem>
                            <SelectItem value="SUPERVISOR">SUPERVISOR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Hub</Label>
                        <Select
                          value={newUser.role === "ADMIN" ? "none" : newUser.hubId || "none"}
                          onValueChange={(value) =>
                            setNewUser((current) => ({ ...current, hubId: value === "none" ? "" : value }))
                          }
                          disabled={newUser.role === "ADMIN"}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem hub</SelectItem>
                            {(userManagement?.hubs || []).map((hub) => (
                              <SelectItem key={hub.id} value={hub.id}>{hub.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button onClick={handleCreateUser} disabled={isCreatingUser}>
                      <Users className="mr-2 h-4 w-4" />
                      {isCreatingUser ? "Criando..." : "Criar usuario"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Hubs</CardTitle>
                    <CardDescription>Cadastre hubs para usar nos acessos e no atendimento</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label>Nome do hub</Label>
                        <Input
                          value={newHub.name}
                          onChange={(e) => setNewHub((current) => ({ ...current, name: e.target.value }))}
                          placeholder="Hub Guarulhos"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Timezone</Label>
                        <Input
                          value={newHub.timezone}
                          onChange={(e) => setNewHub((current) => ({ ...current, timezone: e.target.value }))}
                          placeholder="America/Sao_Paulo"
                        />
                      </div>
                    </div>
                    <Button onClick={handleCreateHub} disabled={isCreatingHub}>
                      <Users className="mr-2 h-4 w-4" />
                      {isCreatingHub ? "Criando..." : "Criar hub"}
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      {(userManagement?.hubs || []).map((hub) => (
                        <Badge key={hub.id} variant="outline">{hub.name}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Usuarios Cadastrados</CardTitle>
                        <CardDescription>Ative, desative e ajuste o papel dos acessos existentes</CardDescription>
                      </div>
                      <Button variant="outline" onClick={() => void loadUsers()} disabled={isUsersLoading}>
                        {isUsersLoading ? "Atualizando..." : "Atualizar"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isUsersLoading && !userManagement ? (
                      <p className="text-sm text-muted-foreground">Carregando usuarios...</p>
                    ) : (
                      <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto pr-1">
                        {(userManagement?.users || []).map((user) => (
                          <div key={user.id} className="rounded-lg border p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-card-foreground">{user.name}</p>
                                <p className="text-xs text-muted-foreground">{user.email}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Badge variant="outline">{user.role}</Badge>
                                  <Badge variant={user.isActive ? "outline" : "secondary"}>
                                    {user.isActive ? "Ativo" : "Inativo"}
                                  </Badge>
                                  <Badge variant="outline">{user.hubName || "Sem hub"}</Badge>
                                </div>
                              </div>
                              <Button
                                variant={user.isActive ? "outline" : "default"}
                                onClick={() => void handleToggleUser(user.id, user.isActive)}
                              >
                                {user.isActive ? "Desativar" : "Ativar"}
                              </Button>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">Papel</Label>
                                <Select
                                  value={user.role}
                                  onValueChange={(value: "ADMIN" | "ANALISTA" | "SUPERVISOR") =>
                                    void handleRoleChange(user.id, value)
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                                    <SelectItem value="ANALISTA">ANALISTA</SelectItem>
                                    <SelectItem value="SUPERVISOR">SUPERVISOR</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">Hub</Label>
                                <Select
                                  value={user.hubId || "none"}
                                  onValueChange={(value) => void handleHubChange(user.id, value === "none" ? "" : value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sem hub</SelectItem>
                                    {(userManagement?.hubs || []).map((hub) => (
                                      <SelectItem key={hub.id} value={hub.id}>{hub.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex flex-col gap-2 sm:col-span-2">
                                <Label className="text-xs">Telegram Chat ID</Label>
                                <div className="flex gap-2">
                                  <Input
                                    value={userTelegramChatDrafts[user.id] || ""}
                                    onChange={(e) =>
                                      setUserTelegramChatDrafts((current) => ({
                                        ...current,
                                        [user.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Ex.: 123456789"
                                  />
                                  <Button
                                    variant="outline"
                                    onClick={() => void handleTelegramChatSave(user.id)}
                                  >
                                    Salvar
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </div>
  )
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Badge variant="outline">{value}%</Badge>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} max={100} step={5} />
    </div>
  )
}
