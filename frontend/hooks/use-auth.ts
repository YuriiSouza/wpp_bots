"use client"

import { useState, useCallback, useEffect } from "react"
import { api } from "@/lib/api"
import type { User, UserRole } from "@/lib/types"

interface JwtPayload {
  sub?: string
  name?: string
  email?: string
  role?: UserRole
  hubId?: string | null
  hubName?: string | null
  telegramChatId?: string | null
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return window.atob(padded)
  }
  return ""
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
      telegramChatId: payload.telegramChatId ?? null,
    }
  } catch {
    return null
  }
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

  const persistAuthenticatedUser = useCallback((token: string, resolvedUser: User) => {
    localStorage.setItem("auth_token", token)
    localStorage.setItem("auth_user", JSON.stringify(resolvedUser))
    setUser(resolvedUser)
  }, [])

  const googleLogin = useCallback(
    async (credential: string) => {
      const response = await api.post<{
        accessToken?: string
        user?: User
        requiresApproval?: boolean
        message?: string
      }>("/auth/google", {
        credential,
      })
      if (response.data.requiresApproval) {
        throw new Error(response.data.message || "Seu acesso ainda nao foi aprovado")
      }

      const token = response.data.accessToken
      const resolvedUser = response.data.user || (token ? parseUserFromToken(token) : null)

      if (!token || !resolvedUser) {
        throw new Error("Resposta de autenticacao invalida")
      }

      persistAuthenticatedUser(token, resolvedUser)
      return resolvedUser
    },
    [persistAuthenticatedUser]
  )

  const completeOnboarding = useCallback(
    async (hubId: string, telegramChatId: string) => {
      const response = await api.patch<{ accessToken?: string; user?: User }>("/api/auth/onboarding", {
        hubId,
        telegramChatId,
      })
      const token = response.data.accessToken
      const resolvedUser = response.data.user || (token ? parseUserFromToken(token) : null)

      if (!token || !resolvedUser) {
        throw new Error("Resposta de onboarding invalida")
      }

      persistAuthenticatedUser(token, resolvedUser)
      return resolvedUser
    },
    [persistAuthenticatedUser]
  )

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
    googleLogin,
    completeOnboarding,
    logout,
    hasRole,
  }
}
