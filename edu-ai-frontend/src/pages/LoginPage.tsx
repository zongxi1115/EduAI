import { type FormEvent, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  ArrowLeft,
  Eye,
  EyeOff,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import floatingCapCard from "@/assets/learning-login/floating-cap-card.png"
import floatingChartCard from "@/assets/learning-login/floating-chart-card.png"
import heroIllustration from "@/assets/learning-login/hero-illustration.png"
import logoMark from "@/assets/learning-login/logo-mark.svg"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

type AuthMode = "login" | "register"

const motionEase = [0.16, 1, 0.3, 1] as const
const authModes: Array<{ value: AuthMode; label: string }> = [
  { value: "login", label: "登录" },
  { value: "register", label: "注册" },
]

const richShellVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.62,
      ease: motionEase,
      staggerChildren: 0.08,
      when: "beforeChildren",
    },
  },
}

const reducedShellVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18 } },
}

const richItemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: motionEase } },
}

const reducedItemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18 } },
}

const fieldClassName =
  "group/field relative flex h-12 items-center gap-3 rounded-lg border border-input bg-background px-3 text-sm shadow-xs transition-all focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 hover:border-ring/50 sm:h-13 sm:px-4"

const inputClassName =
  "h-full min-w-0 flex-1 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground md:text-sm"

function resolveZxAuthUrl(nextPath: string) {
  const configured = import.meta.env.VITE_ZX_AUTH_LOGIN_URL?.trim()
  const encodedNext = encodeURIComponent(nextPath)
  if (!configured) {
    return `/api/v1/auth/zx/login?next=${encodedNext}`
  }
  if (configured.includes("{next}")) {
    return configured.replace("{next}", encodedNext)
  }
  const separator = configured.includes("?") ? "&" : "?"
  return `${configured}${separator}next=${encodedNext}`
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shouldReduceMotion = useReducedMotion()
  const { user, isAuthLoading, login, register } = useAuth()
  const [mode, setMode] = useState<AuthMode>("login")
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextPath = useMemo(() => {
    const rawNext = searchParams.get("next")?.trim()
    return rawNext?.startsWith("/") ? rawNext : "/"
  }, [searchParams])

  useEffect(() => {
    if (!isAuthLoading && user) {
      navigate(nextPath, { replace: true })
    }
  }, [isAuthLoading, navigate, nextPath, user])

  const isRegister = mode === "register"
  const shellVariants = shouldReduceMotion ? reducedShellVariants : richShellVariants
  const itemVariants = shouldReduceMotion ? reducedItemVariants : richItemVariants

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError(null)
    setIsSubmitting(true)
    try {
      if (isRegister) {
        await register(username, password, displayName)
      } else {
        await login(username, password)
      }
      navigate(nextPath, { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败，请稍后重试。")
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError(null)
  }

  function startZxAuthLogin() {
    window.location.assign(resolveZxAuthUrl(nextPath))
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#fbfdff_0%,#edf7ff_48%,#f7fbff_100%)] px-3 py-3 text-foreground sm:px-8 sm:py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,153,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.82),transparent_86%)]"
      />

      <Button
        variant="outline"
        size="lg"
        className="fixed left-4 top-4 z-20 h-9 rounded-lg border-border/70 bg-background/85 px-3 text-muted-foreground shadow-sm backdrop-blur-md hover:bg-background hover:text-foreground sm:left-6 sm:top-6"
        onClick={() => navigate("/")}
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </Button>

      <motion.main
        initial="hidden"
        animate="show"
        variants={shellVariants}
        className="relative mx-auto grid min-h-[calc(100vh-24px)] w-full max-w-[1360px] overflow-hidden rounded-2xl border border-white/80 bg-card/95 shadow-[0_26px_80px_rgba(15,23,42,0.14)] backdrop-blur-2xl sm:min-h-[calc(100vh-64px)] lg:grid-cols-[1.04fr_0.96fr]"
      >
        <section className="relative min-h-[430px] overflow-hidden border-b border-border/70 bg-[linear-gradient(128deg,#ffffff_0%,#eef7ff_50%,#dcecff_100%)] px-6 py-8 sm:min-h-[560px] sm:px-10 sm:py-10 lg:min-h-full lg:border-b-0 lg:border-r lg:px-14 lg:py-12 xl:px-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,transparent_0_52%,rgba(255,255,255,0.52)_52%_62%,transparent_62%_100%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.72))]"
          />

          <motion.div variants={itemVariants} className="relative z-10 flex items-center gap-3">
            <img className="h-10 w-11 shrink-0 sm:h-11 sm:w-[50px]" src={logoMark} alt="学习系统标识" />
            <div>
              <p className="m-0 text-xl font-semibold leading-none tracking-normal text-foreground sm:text-2xl">
                学习系统
              </p>
              <p className="mt-1.5 text-xs font-medium tracking-normal text-muted-foreground sm:text-[13px]">
                Learning System
              </p>
            </div>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="relative z-10 mt-14 max-w-[520px] sm:mt-16 lg:mt-[118px]"
          >
            <h1 className="m-0 text-[34px] font-semibold leading-[1.22] tracking-normal text-foreground sm:text-[44px] xl:text-[54px]">
              让学习更高效
              <br />
              让成长看得见
            </h1>
            <p className="mt-5 max-w-[470px] text-[15px] leading-7 tracking-normal text-muted-foreground sm:text-lg sm:leading-8">
              丰富的学习资源，科学的学习路径，助你开启知识探索之旅。
            </p>
          </motion.div>

          <motion.img
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 34, scale: 0.98 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.66, delay: 0.24, ease: motionEase }}
            className="pointer-events-none absolute bottom-2 left-[-12px] z-[1] w-[470px] select-none drop-shadow-[0_28px_30px_rgba(33,88,180,0.14)] sm:bottom-5 sm:left-8 sm:w-[585px] lg:bottom-10 lg:left-[64px] lg:w-[min(660px,82%)]"
            src={heroIllustration}
            alt="学习场景插画"
          />

          <motion.div
            aria-hidden
            animate={shouldReduceMotion ? undefined : { y: [-6, 8, -6], rotate: [-2, 2, -2] }}
            transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-[310px] right-[156px] z-10 hidden sm:block lg:bottom-[510px] lg:right-[168px]"
          >
            <img className="h-[60px] w-16" src={floatingChartCard} alt="" />
          </motion.div>

          <motion.div
            aria-hidden
            animate={shouldReduceMotion ? undefined : { y: [7, -9, 7], rotate: [2, -2, 2] }}
            transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-[236px] right-[66px] z-10 hidden sm:block lg:bottom-[420px] lg:right-[76px]"
          >
            <img className="h-[78px] w-[88px]" src={floatingCapCard} alt="" />
          </motion.div>
        </section>

        <section className="relative flex items-center justify-center bg-background px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
          <motion.form
            variants={itemVariants}
            className="w-full max-w-[420px]"
            onSubmit={handleSubmit}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: motionEase }}
              >
                <h2 className="m-0 text-3xl font-semibold leading-tight tracking-normal text-foreground sm:text-4xl">
                  {isRegister ? "创建账号" : "欢迎回来"}
                </h2>
                <p className="mb-7 mt-3 text-sm leading-6 tracking-normal text-muted-foreground sm:mb-8 sm:text-base">
                  {isRegister ? "注册学习系统，建立你的学习档案。" : "登录学习系统，继续你的学习进度。"}
                </p>
              </motion.div>
            </AnimatePresence>

            <motion.div
              variants={itemVariants}
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label="账号模式"
            >
              {authModes.map((authMode) => {
                const isActive = mode === authMode.value
                return (
                  <Button
                    key={authMode.value}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "relative isolate h-10 overflow-hidden rounded-md bg-transparent text-sm font-medium hover:bg-transparent",
                      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                    aria-pressed={isActive}
                    onClick={() => switchMode(authMode.value)}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="auth-mode-pill"
                        className="absolute inset-0 z-0 rounded-md bg-background shadow-sm ring-1 ring-border/60"
                        transition={{ duration: 0.24, ease: motionEase }}
                      />
                    )}
                    <span className="relative z-10">{authMode.label}</span>
                  </Button>
                )
              })}
            </motion.div>

            <motion.div
              layout={!shouldReduceMotion}
              variants={itemVariants}
              className="mt-6 space-y-3.5"
            >
              <motion.label
                layout={!shouldReduceMotion}
                whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                transition={{ duration: 0.18, ease: motionEase }}
                className={fieldClassName}
              >
                <UserRound className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-focus-within/field:text-primary" />
                <input
                  className={inputClassName}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="请输入用户名/手机号"
                  autoComplete="username"
                  required
                />
              </motion.label>

              <AnimatePresence initial={false}>
                {isRegister && (
                  <motion.label
                    key="display-name"
                    layout={!shouldReduceMotion}
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
                    transition={{ duration: 0.22, ease: motionEase }}
                    className={fieldClassName}
                  >
                    <GraduationCap className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-focus-within/field:text-primary" />
                    <input
                      className={inputClassName}
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="请输入展示名称"
                      autoComplete="name"
                    />
                  </motion.label>
                )}
              </AnimatePresence>

              <motion.label
                layout={!shouldReduceMotion}
                whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                transition={{ duration: 0.18, ease: motionEase }}
                className={fieldClassName}
              >
                <LockKeyhole className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-focus-within/field:text-primary" />
                <input
                  className={inputClassName}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入密码"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  minLength={6}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={showPassword ? "hide" : "show"}
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: -8, scale: 0.9 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 8, scale: 0.9 }}
                      transition={{ duration: 0.14, ease: motionEase }}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </motion.span>
                  </AnimatePresence>
                </Button>
              </motion.label>
            </motion.div>

            <motion.div
              layout={!shouldReduceMotion}
              variants={itemVariants}
              className="my-5 flex items-center justify-between gap-3 text-sm text-muted-foreground"
            >
              <label className="inline-flex cursor-pointer select-none items-center gap-2.5">
                <input
                  className="h-4 w-4 rounded border-input accent-primary"
                  type="checkbox"
                />
                记住我
              </label>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm font-medium text-primary"
              >
                忘记密码?
              </Button>
            </motion.div>

            <AnimatePresence initial={false}>
              {error && (
                <motion.p
                  role="alert"
                  aria-live="polite"
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  transition={{ duration: 0.18, ease: motionEase }}
                  className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div
              variants={itemVariants}
              whileHover={shouldReduceMotion || isSubmitting || isAuthLoading ? undefined : { y: -1 }}
              whileTap={shouldReduceMotion || isSubmitting || isAuthLoading ? undefined : { scale: 0.985 }}
              transition={{ duration: 0.16, ease: motionEase }}
            >
              <Button
                type="submit"
                size="lg"
                className="h-11 w-full rounded-lg bg-primary text-base font-semibold tracking-normal text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90 disabled:shadow-none sm:h-12"
                disabled={isSubmitting || isAuthLoading}
              >
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {isRegister ? "注册并登录" : "登录"}
              </Button>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="mx-2 my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-xs text-muted-foreground sm:mx-8 sm:gap-5"
            >
              <span className="h-px bg-border" />
              <span>统一身份登录</span>
              <span className="h-px bg-border" />
            </motion.div>

            <motion.div
              variants={itemVariants}
              whileHover={shouldReduceMotion ? undefined : { y: -1 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
              transition={{ duration: 0.16, ease: motionEase }}
            >
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={startZxAuthLogin}
                className="h-11 w-full rounded-lg border-border bg-background text-base font-medium text-foreground shadow-xs hover:bg-muted sm:h-12"
              >
                <ShieldCheck className="h-4 w-4 text-primary" />
                ZX Auth 登录
              </Button>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="mt-6 flex items-center justify-center text-sm text-muted-foreground"
            >
              <span>{isRegister ? "已有账号?" : "还没有账号?"}</span>
              <Button
                type="button"
                variant="link"
                className="h-auto px-1 py-0 text-sm font-semibold text-primary"
                onClick={() => switchMode(isRegister ? "login" : "register")}
              >
                {isRegister ? "立即登录" : "立即注册"}
              </Button>
            </motion.div>
          </motion.form>
        </section>
      </motion.main>
    </div>
  )
}
