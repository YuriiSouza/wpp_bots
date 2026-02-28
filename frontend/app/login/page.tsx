"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Headset, Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"

export default function LoginPage() {
  const router = useRouter()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      if (mode === "register") {
        await register(name, email, password)
      } else {
        await login(email, password)
      }
      router.push("/dashboard")
    } catch {
      setError(mode === "register" ? "Nao foi possivel criar a conta" : "E-mail ou senha invalidos")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Headset className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">RotaBot Admin</h1>
            <p className="text-sm text-muted-foreground">Operacao, atendimento e comunicacao via Telegram</p>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{mode === "register" ? "Criar conta" : "Entrar"}</CardTitle>
            <CardDescription>
              {mode === "register"
                ? "Cadastre nome, e-mail e senha para acessar o painel"
                : "Acesse sua conta para operar o painel e atender tickets em tempo real"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              {mode === "register" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Seu nome"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@rotabot.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="********"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-10 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (mode === "register" ? "Criando conta..." : "Entrando...") : mode === "register" ? "Criar conta" : "Entrar"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setMode((current) => (current === "login" ? "register" : "login"))
                  setError("")
                }}
              >
                {mode === "register" ? "Ja tenho conta" : "Criar nova conta"}
              </Button>
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p className="font-medium mb-1">Contas de teste:</p>
                <p>admin@rotabot.com / admin123 (ADMIN)</p>
                <p>analista@rotabot.com / analista123 (ANALISTA - Hub SP)</p>
                <p>supervisor@rotabot.com / super123 (SUPERVISOR)</p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
