"use client"

import { useState, useCallback, useEffect } from "react"
import { api } from "@/lib/api"
import type { User, UserRole } from "@/lib/types"

const MOCK_USERS: Record<string, { password: string; user: User }> = {
  "admin@rotabot.com": {
    password: "admin123",
    user: {
      id: "admin-1",
      name: "Aline Costa",
      email: "admin@rotabot.com",
      role: "ADMIN",
      hubId: "hub-sp",
      hubName: "Hub Sao Paulo",
    },
  },
  "analista@rotabot.com": {
    password: "analista123",
    user: {
      id: "analyst-1",
      name: "Ana Analista",
      email: "analista@rotabot.com",
      role: "ANALISTA",
      hubId: "hub-sp",
      hubName: "Hub Sao Paulo",
    },
  },
  "supervisor@rotabot.com": {
    password: "super123",
    user: {
      id: "super-1",
      name: "Sergio Supervisor",
      email: "supervisor@rotabot.com",
      role: "SUPERVISOR",
      hubId: null,
      hubName: null,
    },
  },
}

interface JwtPayload {
  sub?: string
  name?: string
  email?: string
  role?: UserRole
  hubId?: string | null
  hubName?: string | null
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return window.atob(padded)
  }
  return ""
}

function encodeBase64Url(value: string) {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
  }
  return value
}

function parseUserFromToken(token: string): User | null {
  const parts = token.split(".")
  if (parts.length < 2) return null

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtPayload
    if (!payload.sub || !payload.name || !payload.email || !payload.role) return null
    return {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      hubId: payload.hubId ?? null,
      hubName: payload.hubName ?? null,
    }
  } catch {
    return null
  }
}

function createMockJwt(user: User) {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hubId: user.hubId ?? null,
      hubName: user.hubName ?? null,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    })
  )
  return `${header}.${payload}.local-signature`
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null
    if (token) {
      const parsedUser = parseUserFromToken(token)
      if (parsedUser) {
        localStorage.setItem("auth_user", JSON.stringify(parsedUser))
        setUser(parsedUser)
      } else {
        localStorage.removeItem("auth_user")
        localStorage.removeItem("auth_token")
      }
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await api.post<{ accessToken: string; user?: User }>("/auth/login", {
        email,
        password,
      })
      const token = response.data.accessToken
      const resolvedUser = response.data.user || parseUserFromToken(token)

      if (!token || !resolvedUser) {
        throw new Error("Resposta de autenticacao invalida")
      }

      localStorage.setItem("auth_token", token)
      localStorage.setItem("auth_user", JSON.stringify(resolvedUser))
      setUser(resolvedUser)
      return resolvedUser
    } catch {
      const entry = MOCK_USERS[email]
      if (!entry || entry.password !== password) {
        throw new Error("Credenciais invalidas")
      }
      const token = createMockJwt(entry.user)
      localStorage.setItem("auth_token", token)
      localStorage.setItem("auth_user", JSON.stringify(entry.user))
      setUser(entry.user)
      return entry.user
    }
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const response = await api.post<{ accessToken: string; user?: User }>("/auth/register", {
      name,
      email,
      password,
    })
    const token = response.data.accessToken
    const resolvedUser = response.data.user || parseUserFromToken(token)

    if (!token || !resolvedUser) {
      throw new Error("Resposta de cadastro invalida")
    }

    localStorage.setItem("auth_token", token)
    localStorage.setItem("auth_user", JSON.stringify(resolvedUser))
    setUser(resolvedUser)
    return resolvedUser
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token")
    localStorage.removeItem("auth_user")
    setUser(null)
  }, [])

  const hasRole = useCallback(
    (...roles: UserRole[]) => {
      if (!user) return false
      return roles.includes(user.role)
    },
    [user]
  )

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    hasRole,
  }
}
