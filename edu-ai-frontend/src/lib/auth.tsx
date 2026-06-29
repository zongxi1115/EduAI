import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

export type AuthUser = {
  id: string
  username: string
  display_name: string
  learner_id: string
  created_at: string
}

type AuthSessionResponse = {
  user: AuthUser
  expires_at: string
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  isAuthLoading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, displayName?: string) => Promise<void>
  completeZxAuthCallback: (code: string, state: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function readAuthError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { detail?: string }
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail
    }
  } catch {
    // Keep the fallback when the response body is not JSON.
  }
  return fallback
}

async function submitAuth(
  endpoint: "/api/v1/auth/login" | "/api/v1/auth/register",
  body: Record<string, string>,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await readAuthError(response, "登录失败，请稍后重试。"))
  }

  return (await response.json()) as AuthSessionResponse
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/v1/auth/me", {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        })
        if (!active) return
        if (response.ok) {
          const payload = (await response.json()) as { user: AuthUser }
          setUser(payload.user)
        } else {
          setUser(null)
        }
      } catch {
        if (active) {
          setUser(null)
        }
      } finally {
        if (active) {
          setIsAuthLoading(false)
        }
      }
    }

    void loadCurrentUser()
    return () => {
      active = false
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isAuthLoading,
      login: async (username, password) => {
        const payload = await submitAuth("/api/v1/auth/login", { username, password })
        setUser(payload.user)
      },
      register: async (username, password, displayName) => {
        const body: Record<string, string> = { username, password }
        if (displayName?.trim()) {
          body.display_name = displayName.trim()
        }
        const payload = await submitAuth("/api/v1/auth/register", body)
        setUser(payload.user)
      },
      completeZxAuthCallback: async (code, state) => {
        const response = await fetch("/api/v1/auth/zx/callback", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ code, state }),
        })
        if (!response.ok) {
          throw new Error(await readAuthError(response, "ZX Auth 登录失败，请稍后重试。"))
        }
        const payload = (await response.json()) as AuthSessionResponse
        setUser(payload.user)
      },
      logout: async () => {
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        })
        setUser(null)
      },
    }),
    [isAuthLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error("useAuth must be used inside AuthProvider.")
  }
  return value
}
