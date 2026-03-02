"use client"

import { useRouter } from "next/navigation"
import { LogOut, Mail, Shield, User as UserIcon, Building2 } from "lucide-react"
import { useAuthContext } from "@/components/auth-provider"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default function ProfilePage() {
  const router = useRouter()
  const { user, logout } = useAuthContext()

  const handleLogout = () => {
    logout()
    router.replace("/login")
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Perfil" breadcrumbs={[{ label: "Perfil" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Perfil do usuario</h2>
          <p className="text-sm text-muted-foreground">Informacoes da sua conta e sessao atual</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conta</CardTitle>
            <CardDescription>Dados do usuario autenticado</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
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
                  <p className="text-sm font-medium text-card-foreground">{user?.hubName || "Nao definido"}</p>
                </div>
              </div>
              {user?.hubId ? <Badge variant="outline">{user.hubId}</Badge> : <Badge variant="outline">Sem hub</Badge>}
            </div>
            <Button variant="destructive" onClick={handleLogout} className="w-full sm:w-auto">
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
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
