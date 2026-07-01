import { useEffect, useMemo, useState } from "react"
import { motion } from "motion/react"
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import logoMark from "@/assets/learning-login/logo-mark.svg"

const zxCallbackExchangePromises = new Map<string, Promise<void>>()

function decodeNextFromState(state: string) {
  const payloadPart = state.split(".")[0]
  if (!payloadPart) return "/"
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const payload = JSON.parse(window.atob(padded)) as { next?: string }
    return payload.next?.startsWith("/") ? payload.next : "/"
  } catch {
    return "/"
  }
}

export default function LoginCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { completeZxAuthCallback } = useAuth()
  const [statusText, setStatusText] = useState("正在完成 ZX Auth 登录...")
  const [error, setError] = useState<string | null>(null)

  const code = searchParams.get("code")?.trim() || ""
  const state = searchParams.get("state")?.trim() || ""
  const providerError = searchParams.get("error")?.trim() || ""
  const nextPath = useMemo(() => decodeNextFromState(state), [state])

  useEffect(() => {
    let active = true

    async function finishLogin() {
      if (providerError) {
        setError(`ZX Auth 返回错误：${providerError}`)
        return
      }
      if (!code || !state) {
        setError("ZX Auth 回调缺少 code 或 state。")
        return
      }

      const exchangeKey = `${code}.${state}`
      let exchangePromise = zxCallbackExchangePromises.get(exchangeKey)
      if (!exchangePromise) {
        exchangePromise = completeZxAuthCallback(code, state).catch((callbackError: unknown) => {
          zxCallbackExchangePromises.delete(exchangeKey)
          throw callbackError
        })
        zxCallbackExchangePromises.set(exchangeKey, exchangePromise)
      }

      try {
        await exchangePromise
        if (!active) return
        setStatusText("登录成功，正在进入学习系统...")
        window.setTimeout(() => {
          navigate(nextPath, { replace: true })
        }, 420)
      } catch (callbackError) {
        if (!active) return
        setError(callbackError instanceof Error ? callbackError.message : "ZX Auth 登录失败。")
      }
    }

    void finishLogin()
    return () => {
      active = false
    }
  }, [code, completeZxAuthCallback, navigate, nextPath, providerError, state])

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.96),transparent_31%),linear-gradient(135deg,#f8fbff_0%,#dbe9ff_100%)] px-5 text-[#172033]">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.48, ease: "easeOut" }}
        className="w-full max-w-md rounded-2xl border border-white/80 bg-white/90 p-8 text-center shadow-[0_28px_80px_rgba(50,91,160,0.18)] backdrop-blur-2xl"
      >
        <img className="mx-auto h-12 w-14" src={logoMark} alt="学习系统标识" />
        <h1 className="mt-5 text-3xl font-black tracking-normal">
          ZX Auth
        </h1>
        <div className="mt-6 flex flex-col items-center gap-3 text-[#66758d]">
          {error ? (
            <AlertCircle className="h-8 w-8 text-red-500" />
          ) : statusText.startsWith("登录成功") ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          ) : (
            <LoaderCircle className="h-8 w-8 animate-spin text-[#2468f2]" />
          )}
          <p className="text-base leading-7">{error || statusText}</p>
        </div>
        {error && (
          <Button
            className="mt-7 h-10 rounded-xl px-5"
            onClick={() => navigate("/login", { replace: true })}
          >
            返回登录页
          </Button>
        )}
      </motion.div>
    </div>
  )
}
