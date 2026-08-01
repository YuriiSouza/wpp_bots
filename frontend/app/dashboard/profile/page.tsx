"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  LogOut,
  Mail,
  Shield,
  User as UserIcon,
  Building2,
  KeyRound,
  Pencil,
  Plus,
  Check,
  X,
} from "lucide-react"
import { useAuthContext } from "@/components/auth-provider"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import {
  updateSelfProfile,
  changePassword,
  fetchHubs,
  createHub,
  getApiErrorMessage,
} from "@/lib/admin-api"
import type { HubOption } from "@/lib/types"
import type { User } from "@/lib/types"

export default function ProfilePage() {
  const router = useRouter()
  const { user, logout, updateUser } = useAuthContext()

  const [hubs, setHubs] = useState<HubOption[]>([])

  // Edit profile state
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editHubId, setEditHubId] = useState<string>("__none__")
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Change password state
  const [pwOpen, setPwOpen] = useState(false)
  const [oldPw, setOldPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [isSavingPw, setIsSavingPw] = useState(false)

  // Create hub state
  const [hubOpen, setHubOpen] = useState(false)
  const [newHubName, setNewHubName] = useState("")
  const [newHubTimezone, setNewHubTimezone] = useState("America/Sao_Paulo")
  const [isCreatingHub, setIsCreatingHub] = useState(false)

  useEffect(() => {
    fetchHubs().then(setHubs).catch(() => {})
  }, [])

  const handleLogout = () => {
    logout()
    router.replace("/login")
  }

  const openEdit = () => {
    setEditName(user?.name ?? "")
    setEditHubId(user?.hubId ?? "__none__")
    setEditOpen(true)
  }

  const handleSaveProfile = async () => {
    if (!editName.trim() || editName.trim().length < 2) {
      toast.error("Nome muito curto")
      return
    }
    setIsSavingProfile(true)
    try {
      const result = await updateSelfProfile({
        name: editName.trim(),
        hubId: editHubId === "__none__" ? null : editHubId,
      })
      if (!result.ok) { toast.error(result.message); return }
      const newUser: User = {
        ...(user as User),
        ...(result.user as Partial<User>),
      }
      updateUser(result.accessToken as string, newUser)
      toast.success("Perfil atualizado")
      setEditOpen(false)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao salvar perfil"))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!oldPw) { toast.error("Informe a senha atual"); return }
    if (newPw.length < 6) { toast.error("Nova senha deve ter pelo menos 6 caracteres"); return }
    if (newPw !== confirmPw) { toast.error("As senhas não coincidem"); return }
    setIsSavingPw(true)
    try {
      const result = await changePassword({ oldPassword: oldPw, newPassword: newPw })
      if (!result.ok) { toast.error(result.message); return }
      toast.success("Senha alterada com sucesso")
      setPwOpen(false)
      setOldPw(""); setNewPw(""); setConfirmPw("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao alterar senha"))
    } finally {
      setIsSavingPw(false)
    }
  }

  const handleCreateHub = async () => {
    if (!newHubName.trim() || newHubName.trim().length < 2) {
      toast.error("Nome do hub muito curto")
      return
    }
    setIsCreatingHub(true)
    try {
      const result = await createHub({ name: newHubName.trim(), timezone: newHubTimezone })
      if (!result.ok) { toast.error(result.message); return }
      toast.success(`Hub "${result.hub.name}" criado`)
      setHubs((prev) => [...prev, result.hub].sort((a, b) => a.name.localeCompare(b.name)))
      setHubOpen(false)
      setNewHubName("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Erro ao criar hub"))
    } finally {
      setIsCreatingHub(false)
    }
  }

  const canCreateHub = user?.role === "ADMIN" || user?.role === "SUPERVISOR"

  return (
    <>
    <div className="flex flex-col">
      <PageHeader title="Perfil" breadcrumbs={[{ label: "Perfil" }]} />
      <div className="flex flex-col gap-6 p-6 max-w-2xl">

        {/* Account card */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Conta</CardTitle>
              <CardDescription>Dados do usuário autenticado</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <InfoRow icon={UserIcon} label="Nome" value={user?.name || "-"} />
            <InfoRow icon={Mail} label="E-mail" value={user?.email || "-"} />
            <InfoRow icon={Shield} label="Papel" value={user?.role || "-"} />
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Hub</p>
                  <p className="text-sm font-medium text-card-foreground">{user?.hubName || "Não definido"}</p>
                </div>
              </div>
              {user?.hubId
                ? <Badge variant="outline">{user.hubId}</Badge>
                : <Badge variant="outline">Sem hub</Badge>}
            </div>
          </CardContent>
        </Card>

        {/* Security card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Segurança</CardTitle>
            <CardDescription>Gerencie sua senha de acesso</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setPwOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Alterar senha
            </Button>
          </CardContent>
        </Card>

        {/* Hubs card (admin/supervisor only) */}
        {canCreateHub && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Hubs</CardTitle>
                <CardDescription>Hubs cadastrados no sistema ({hubs.length})</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setHubOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Criar hub
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {hubs.map((h) => (
                  <Badge key={h.id} variant="outline" className="text-xs">
                    <Building2 className="mr-1 h-3 w-3 text-muted-foreground" />
                    {h.name}
                    <span className="ml-1 text-muted-foreground font-mono">{h.id}</span>
                  </Badge>
                ))}
                {hubs.length === 0 && <p className="text-sm text-muted-foreground">Nenhum hub cadastrado.</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Logout */}
        <Button variant="destructive" className="w-full sm:w-auto self-start" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair da conta
        </Button>
      </div>
    </div>

    {/* Edit profile dialog */}
    <Dialog open={editOpen} onOpenChange={setEditOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-hub">Hub</Label>
            <Select value={editHubId} onValueChange={setEditHubId}>
              <SelectTrigger id="edit-hub">
                <SelectValue placeholder="Selecionar hub" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem hub</SelectItem>
                {hubs.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveProfile()} disabled={isSavingProfile}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {isSavingProfile ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Change password dialog */}
    <Dialog open={pwOpen} onOpenChange={(open) => { if (!open) { setOldPw(""); setNewPw(""); setConfirmPw("") } setPwOpen(open) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="old-pw">Senha atual</Label>
            <Input id="old-pw" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">Nova senha</Label>
            <Input id="new-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirmar nova senha</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleChangePassword()}
              placeholder="Repita a nova senha"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setPwOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleChangePassword()} disabled={isSavingPw}>
              {isSavingPw ? "Salvando..." : "Alterar senha"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Create hub dialog */}
    <Dialog open={hubOpen} onOpenChange={setHubOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar hub</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="hub-name">Nome do hub</Label>
            <Input
              id="hub-name"
              value={newHubName}
              onChange={(e) => setNewHubName(e.target.value)}
              placeholder="Ex: Hub Goiânia"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-tz">Fuso horário</Label>
            <Select value={newHubTimezone} onValueChange={setNewHubTimezone}>
              <SelectTrigger id="hub-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">America/Sao_Paulo (BRT)</SelectItem>
                <SelectItem value="America/Manaus">America/Manaus (AMT)</SelectItem>
                <SelectItem value="America/Belem">America/Belem (BRT)</SelectItem>
                <SelectItem value="America/Fortaleza">America/Fortaleza (BRT)</SelectItem>
                <SelectItem value="America/Recife">America/Recife (BRT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setHubOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleCreateHub()} disabled={isCreatingHub}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {isCreatingHub ? "Criando..." : "Criar hub"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-card-foreground">{value}</p>
      </div>
    </div>
  )
}
