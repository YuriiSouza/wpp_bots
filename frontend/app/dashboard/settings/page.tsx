"use client"

import { useEffect, useState } from "react"
import { Settings, Save, RotateCcw, Shield, Sliders, Users } from "lucide-react"
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
import { fetchSettings, getApiErrorMessage, saveSettings, type SettingsPayload } from "@/lib/admin-api"
import { toast } from "sonner"

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await fetchSettings())
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar as configuracoes"))
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const handleSave = async () => {
    if (!settings) return
    try {
      const response = await saveSettings(settings)
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      toast.success(response.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel salvar as configuracoes"))
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

        <Tabs defaultValue="algorithm" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="algorithm" className="gap-2"><Sliders className="h-4 w-4" /> Algoritmo</TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2"><Shield className="h-4 w-4" /> Permissoes</TabsTrigger>
            <TabsTrigger value="system" className="gap-2"><Settings className="h-4 w-4" /> Sistema</TabsTrigger>
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
                  <CardTitle className="text-base">API Backend</CardTitle>
                  <CardDescription>Configuracao da conexao com o backend NestJS</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>URL da API</Label>
                    <Input value={settings.system.apiUrl} onChange={(e) => setSettings({ ...settings, system: { ...settings.system, apiUrl: e.target.value } })} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Nome do Bot</Label>
                    <Input value={settings.system.telegramBotName} onChange={(e) => setSettings({ ...settings, system: { ...settings.system, telegramBotName: e.target.value } })} />
                  </div>
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
