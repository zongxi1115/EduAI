import { motion, AnimatePresence } from "motion/react"
import { useState, useEffect, useLayoutEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDown, ChevronUp, Sparkles, Send, BookOpen, GraduationCap, User2, Settings2, Lightbulb, Calculator, History, Beaker, Languages, LoaderCircle, Plus, PanelLeftClose, PanelLeft, Clock } from "lucide-react"

import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "@/components/ui/prompt-input"
import { PromptSuggestion } from "@/components/ui/prompt-suggestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ThemeToggle"

const SUGGESTIONS = [
  { text: "帮我总结一下昨天刚学的牛顿三大定律", icon: Lightbulb },
  { text: "如何高效记忆中国历史各个朝代的顺序？", icon: History },
  { text: "用费曼技巧给我讲解一下植物的光合作用", icon: Beaker },
  { text: "这道数列大题我一直没做出来，帮我理清思路", icon: Calculator },
  { text: "下个月就要考四六级了，请给出复习计划", icon: Languages },
  { text: "什么是量子力学？用通俗易懂的话给我解释", icon: Sparkles }
]

const PHRASES = [
  "你的全能AI学习助手",
  "随时答疑，高效提分",
  "攻克难题，轻松拿高分"
]
const INITIAL_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理"]
const INITIAL_GRADES = ["幼教", "小学低段", "小学高段", "初中", "高中", "大学与成人"]
const INITIAL_TEACHER_STYLES = ["幽默风趣", "严谨专业", "鼓励启发", "互动探究", "引经据典", "生活化", "高能硬核"]

interface PrepRun {
  run_id: string;
  status: string;
  created_at: string;
  request?: {
    learning_goal: string;
  };
}

interface CreatePrepRunResponse {
  run_id?: string
}

function CustomEditableTag({ onAdd }: { onAdd: (val: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");

  if (isEditing) {
    return (
      <input
        autoFocus
        className="px-3 py-[2px] text-sm rounded-full border border-zinc-300 dark:border-zinc-700 bg-card text-card-foreground dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 w-24 h-7 text-zinc-900 dark:text-zinc-100"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim()) onAdd(value.trim());
          setIsEditing(false);
          setValue("");
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (value.trim()) onAdd(value.trim());
            setIsEditing(false);
            setValue("");
          } else if (e.key === 'Escape') {
            setIsEditing(false);
            setValue("");
          }
        }}
      />
    );
  }

  return (
    <Badge
      variant="outline"
      className="cursor-pointer px-3 py-1 font-normal border-dashed border-zinc-300 text-zinc-500 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent h-7"
      onClick={() => setIsEditing(true)}
    >
      <Plus className="w-3 h-3 mr-1" /> 自定义
    </Badge>
  );
}

export default function HomePage() {
  const [query, setQuery] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [historyRuns, setHistoryRuns] = useState<PrepRun[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [runToDelete, setRunToDelete] = useState<string | null>(null)

  // Extra options
  const [subjects, setSubjects] = useState(INITIAL_SUBJECTS)
  const [grades, setGrades] = useState(INITIAL_GRADES)
  const [teacherStyles, setTeacherStyles] = useState(INITIAL_TEACHER_STYLES)

  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [selectedGrades, setSelectedGrades] = useState<string[]>([])
  const [selectedStyles, setSelectedStyles] = useState<string[]>([])
  const [customReq, setCustomReq] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const navigate = useNavigate()

  // Phasing Title setup
  const [phraseIndex, setPhraseIndex] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex(i => (i + 1) % PHRASES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let active = true

    async function fetchHistory() {
      try {
        const res = await fetch("/api/v1/prep-runs")
        if (res.ok && active) {
          const data = await res.json()
          setHistoryRuns(data.items || [])
        }
      } catch (err) {
        console.error("Failed to fetch history:", err)
      } finally {
        if (active) {
          setIsLoadingHistory(false)
        }
      }
    }

    void fetchHistory()

    const histInterval = setInterval(() => {
      if (isSidebarOpen) {
        void fetchHistory()
      }
    }, 5000)

    return () => {
      active = false
      clearInterval(histInterval)
    }
  }, [isSidebarOpen])

  // Fly animation setup
  const [flyingSuggestion, setFlyingSuggestion] = useState<{ text: string, x: number, y: number, w: number, h: number } | null>(null)

  const handleSuggestionClick = (e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setFlyingSuggestion({ text, x: rect.left, y: rect.top, w: rect.width, h: rect.height })
  }

  const toggleSingle = (
    arr: string[],
    setArr: React.Dispatch<React.SetStateAction<string[]>>,
    item: string,
  ) => {
    if (arr[0] === item) setArr([])
    else setArr([item])
  }

  const handleAddCustom = (
    val: string,
    sourceArr: string[],
    setSourceArr: React.Dispatch<React.SetStateAction<string[]>>,
    setSelectedArr: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (!val || sourceArr.includes(val)) return;
    setSourceArr([...sourceArr, val]);
    setSelectedArr([val]);
  };

  const handleSearch = async () => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery || isSubmitting) return

    const subject = selectedSubjects.join("、") || "General"
    const gradeLevel = selectedGrades.join("、") || "Unspecified"
    const styleText = selectedStyles.join("、")

    const learnerProfile =
      [gradeLevel !== "Unspecified" ? `适用学段：${gradeLevel}` : "", styleText ? `希望教学风格：${styleText}` : ""]
        .filter(Boolean)
        .join("；") || "Mixed-ability class that needs clear guidance, visual explanation, and structured practice."

    const notes =
      [selectedSubjects.length > 0 ? `学科偏好：${subject}` : "", customReq.trim() ? `补充要求：${customReq.trim()}` : ""]
        .filter(Boolean)
        .join("；") || "None"

    setSubmitError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/v1/prep-runs", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          learning_goal: trimmedQuery,
          subject,
          grade_level: gradeLevel,
          learner_profile: learnerProfile,
          notes,
          language: "zh-CN",
        }),
      })

      if (!response.ok) {
        let message = `创建任务失败（${response.status}）`
        try {
          const errorPayload = (await response.json()) as {
            detail?: string | Array<{ msg?: string }>
          }
          if (typeof errorPayload.detail === "string" && errorPayload.detail.trim()) {
            message = errorPayload.detail
          } else if (Array.isArray(errorPayload.detail)) {
            const firstMessage = errorPayload.detail[0]?.msg
            if (typeof firstMessage === "string" && firstMessage.trim()) {
              message = firstMessage
            }
          }
        } catch {
          // Keep the fallback message when error payload is not JSON.
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as CreatePrepRunResponse
      if (!payload.run_id) {
        throw new Error("后端未返回 run_id，暂时无法进入加载页。")
      }

      navigate(`/load/${payload.run_id}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "创建任务失败，请稍后重试。")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteClick = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    setRunToDelete(runId)
  }

  const confirmDelete = async () => {
    if (!runToDelete) return
    const runId = runToDelete
    setRunToDelete(null)
    const snapshot = historyRuns
    setHistoryRuns(prev => prev.filter(r => r.run_id !== runId))
    try {
      const response = await fetch(`/api/v1/prep-runs/${runId}`, { method: "DELETE" })
      if (!response.ok) {
        setHistoryRuns(snapshot) // rollback
      }
    } catch {
      setHistoryRuns(snapshot) // rollback
    }
  }

  const handleSearchSubmit = () => {
    void handleSearch()
  }

  return (
    <div className="min-h-screen w-full flex bg-[#fafafa] dark:bg-zinc-950 overflow-hidden">
      <div className="absolute top-6 right-6 z-50">
        <div className="rounded-xl border border-zinc-200/50 bg-white/80 shadow-sm backdrop-blur-md dark:border-zinc-800/50 dark:bg-zinc-950/80">
          <ThemeToggle />
        </div>
      </div>

      {/* Sidebar Toggle Button (Always visible when closed, or inside sidebar when open) */}
      <div className="absolute top-6 left-6 z-50 hidden md:block">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl transition-all duration-300 shadow-sm ${isSidebarOpen ? 'opacity-0 pointer-events-none translate-x-[-10px]' : 'opacity-100 translate-x-0'
            }`}
        >
          <PanelLeft className="w-5 h-5" />
        </Button>
      </div>

      {/* Sidebar panel */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0, marginLeft: 0 }}
            animate={{ width: 320, opacity: 1, marginLeft: 24 }}
            exit={{ width: 0, opacity: 0, marginLeft: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="h-[calc(100vh-48px)] my-6 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-2xl border border-zinc-200/40 dark:border-zinc-800/40 rounded-2xl shadow-lg dark:shadow-none z-40 flex-shrink-0 flex flex-col hidden md:flex overflow-hidden relative"
          >
            {/* Header */}
            <div className="px-5 py-5 flex items-center justify-between border-b border-zinc-100/50 dark:border-zinc-800/50">
              <h2 className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2.5">
                <History className="w-4.5 h-4.5 text-blue-500" />
                历史任务
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(false)}
                className="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </div>

            {/* Content list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center p-8 text-zinc-400 gap-3">
                  <LoaderCircle className="w-5 h-5 animate-spin" />
                  <span className="text-xs font-medium">加载中...</span>
                </div>
              ) : historyRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-zinc-400 gap-3 h-32">
                  <History className="w-8 h-8 opacity-20" />
                  <span className="text-sm">暂无历史任务</span>
                </div>
              ) : (
                historyRuns.map((run) => (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate="rest"
                    whileHover="hover"
                    variants={{
                      rest: { opacity: 1, y: 0 },
                      hover: { opacity: 1, y: 0 }
                    }}
                    key={run.run_id}
                    onClick={() => navigate(`/load/${run.run_id}`)}
                    className="p-3.5 rounded-xl bg-white/70 dark:bg-zinc-950/50 border border-zinc-200/50 dark:border-zinc-800/60 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-md hover:bg-white/90 dark:hover:bg-zinc-900/80 hover:border-blue-300/60 dark:hover:border-blue-900/50 cursor-pointer transition-all duration-300 flex flex-col gap-2.5 group relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/0 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Delete Action Button */}
                    <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(e, run.run_id)}
                        className="w-7 h-7 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="删除记录"
                      >
                        <motion.svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="overflow-visible"
                        >
                          <motion.path
                            d="M3 6h18"
                            variants={{ rest: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 1 } }}
                            transition={{ duration: 0.16 }}
                          />
                          <motion.path
                            d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                            variants={{ rest: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 1 } }}
                            transition={{ duration: 0.22, delay: 0.04 }}
                          />
                          <motion.path
                            d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
                            variants={{ rest: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 1 } }}
                            transition={{ duration: 0.18, delay: 0.08 }}
                          />
                          <motion.line
                            x1="10" y1="11" x2="10" y2="17"
                            variants={{ rest: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 1 } }}
                            transition={{ duration: 0.14, delay: 0.1 }}
                          />
                          <motion.line
                            x1="14" y1="11" x2="14" y2="17"
                            variants={{ rest: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 1 } }}
                            transition={{ duration: 0.14, delay: 0.1 }}
                          />
                        </motion.svg>
                      </Button>
                    </div>

                    <div className="flex items-start justify-between gap-3 relative z-10 pr-8">
                      <span className="text-[13px] leading-relaxed font-medium text-zinc-700 dark:text-zinc-300 line-clamp-2 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                        {run.request?.learning_goal || run.run_id}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1">
                      <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 relative z-10">
                        <Clock className="w-3 h-3" />
                        {new Date(run.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>

                      {run.status === "running" || run.status === "queued" ? (
                        <div className="flex items-center text-[10px] font-medium text-blue-500 bg-blue-50/80 dark:bg-blue-500/10 px-2 py-0.5 rounded-md shrink-0">
                          <LoaderCircle className="w-3 h-3 animate-spin mr-1" />
                          运行中
                        </div>
                      ) : run.status === "succeeded" ? (
                        <div className="flex items-center text-[10px] font-medium text-emerald-500 bg-emerald-50/80 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 mr-1.5" />
                          已完成
                        </div>
                      ) : (
                        <div className="flex items-center text-[10px] font-medium text-red-500 bg-red-50/80 dark:bg-red-500/10 px-2 py-0.5 rounded-md shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500/80 mr-1.5" />
                          出错
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {runToDelete && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setRunToDelete(null)}
              className="fixed inset-0 z-[60] bg-black/10 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-300"
            />
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-40%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-40%" }}
              whileHover="hover"
              className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-32px)] max-w-sm rounded-[24px] border border-zinc-200/50 dark:border-zinc-800/50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-6 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center gap-3">
                <AnimatedTrashIcon />
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">删除历史任务</h3>
                  <p className="text-[13px] text-zinc-500 font-medium leading-relaxed px-2">
                    确定要删除这条学习记录吗？删除后所有相关材料将无法找回。
                  </p>
                </div>
                <div className="flex w-full gap-3 mt-6">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl bg-white/50 border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    onClick={() => setRunToDelete(null)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white"
                    onClick={confirmDelete}
                  >
                    确认删除
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 relative overflow-hidden h-screen overflow-y-auto w-full">

        {/* Background blobs */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none w-full h-full">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 2 }}
            className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/20 dark:bg-blue-600/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-[blob_7s_infinite]"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 2, delay: 0.5 }}
            className="absolute top-[20%] -right-[10%] w-[45%] h-[45%] rounded-full bg-indigo-400/20 dark:bg-indigo-600/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-[blob_7s_infinite_2s]"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 2, delay: 1 }}
            className="absolute -bottom-[20%] left-[20%] w-[60%] h-[60%] rounded-full bg-sky-400/20 dark:bg-sky-600/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-[blob_7s_infinite_4s]"
          />
        </div>

        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] z-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>

        {flyingSuggestion && (
          <FlyingText
            flyingData={flyingSuggestion}
            onComplete={() => {
              setQuery(flyingSuggestion.text)
              setFlyingSuggestion(null)
            }}
          />
        )}

        <motion.div
          className="w-full max-w-5xl flex flex-col items-center relative z-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Title */}
          <motion.div
            className="mb-10 flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: isExpanded ? 0.75 : 1, y: isExpanded ? 20 : 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-6xl sm:text-7xl md:text-8xl xl:text-9xl tracking-tighter text-zinc-900 dark:text-white mb-4 flex items-center justify-center">
              {["A", "I"].map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, filter: "blur(12px)", y: 20 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: "easeOut" }}
                  className="font-black"
                >
                  {char}
                </motion.span>
              ))}
              <motion.span
                initial={{ opacity: 0, filter: "blur(12px)", y: 20 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                className="ml-3 sm:ml-5 font-normal"
              >
                I
              </motion.span>
              <motion.span
                initial={{ opacity: 0, filter: "blur(12px)", y: 20 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                transition={{ duration: 0.8, delay: 0.25, ease: "easeOut" }}
                className="font-normal"
              >
                n
              </motion.span>
              <motion.span
                initial={{ opacity: 0, filter: "blur(12px)", y: 20, scale: 0.85 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0, scale: 1 }}
                transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
                className="relative inline-block ml-3 sm:ml-5"
              >
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-purple-600 to-pink-500 font-bold tracking-tight">
                  Edu
                </span>
                <svg className="absolute -bottom-4 left-0 w-full h-6 pointer-events-none overflow-visible" viewBox="0 0 100 20" preserveAspectRatio="none">
                  <motion.path
                    d="M0,10 Q25,0 50,10 T100,10"
                    fill="none"
                    stroke="url(#gradient2)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.8 }}
                    transition={{ duration: 1.5, delay: 1, ease: 'easeOut' }}
                  />
                  <motion.path
                    d="M0,15 Q25,25 50,15 T100,15"
                    fill="none"
                    stroke="url(#gradient3)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.6 }}
                    transition={{ duration: 1.5, delay: 1.2, ease: 'easeOut' }}
                  />
                  <defs>
                    <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                    <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="50%" stopColor="#c084fc" />
                      <stop offset="100%" stopColor="#f472b6" />
                    </linearGradient>
                  </defs>
                </svg>
              </motion.span>
            </h1>

            <div className="h-6 mt-4 relative w-full flex justify-center items-center">
              <AnimatePresence mode="popLayout">
                <motion.p
                  key={phraseIndex}
                  initial={{ opacity: 0, y: 15, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -15, filter: "blur(4px)" }}
                  transition={{ duration: 0.8, ease: "easeInOut" }}
                  className="text-zinc-500 dark:text-zinc-400 text-center text-xl sm:text-2xl font-medium tracking-wide absolute"
                >
                  {PHRASES[phraseIndex]}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Input Container */}
          <motion.div
            className="w-full w-[95%] sm:w-full relative group"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Animated Glow Border Fix */}
            <div className="absolute -inset-[1px] rounded-[24px] overflow-hidden opacity-50 group-hover:opacity-100 transition-all duration-700 pointer-events-none z-0">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2500px] h-[2500px] animate-[spin_8s_linear_infinite] opacity-40 dark:opacity-80 aspect-square"
                style={{ background: "conic-gradient(from 90deg at 50% 50%, #e2e8f0 0%, #3b82f6 25%, #8b5cf6 50%, #ec4899 75%, #e2e8f0 100%)" }} />
            </div>

            <div id="main-input-box" className="relative flex flex-col bg-card text-card-foreground dark:bg-zinc-950 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)] border border-zinc-100 dark:border-zinc-800 transition-all duration-300 z-10">
              <PromptInput
                value={query}
                onValueChange={setQuery}
                className="bg-transparent border-none shadow-none rounded-[24px] focus-within:ring-0 focus-visible:ring-0 px-4 pt-4 pb-2"
                onSubmit={handleSearchSubmit}
                isLoading={isSubmitting}
                disabled={isSubmitting}
              >
                <PromptInputTextarea
                  id="prompt-main-textarea"
                  placeholder="在此输入你今天想学的内容..."
                  className="text-base sm:text-lg min-h-14 py-2 text-foreground placeholder:text-zinc-400 dark:placeholder:text-zinc-500 leading-relaxed font-medium"
                />

                <div className="flex justify-between items-center w-full px-1 pb-1 pt-3 mt-2">
                  <PromptInputActions>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-full flex items-center gap-1.5 group px-3 h-9 transition-colors"
                    >
                      <span className="text-sm font-normal">展开选项</span>
                      {!isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </Button>
                  </PromptInputActions>

                  <PromptInputActions>
                    <PromptInputAction tooltip={isSubmitting ? "正在创建任务..." : "发送请求"} side="top">
                      <Button
                        size="icon"
                        className="rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 dark:text-zinc-900 text-white transition-all w-10 h-10 shadow-sm"
                        onClick={handleSearchSubmit}
                        disabled={!query.trim() || isSubmitting}
                      >
                        {isSubmitting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </PromptInputAction>
                  </PromptInputActions>
                </div>
              </PromptInput>

              {/* Expandable Options */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 sm:px-7 pb-6 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 w-full">
                      <div className="space-y-6">

                        <div className="space-y-3">
                          <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" />学科领域</h4>
                          <div className="flex flex-wrap gap-2 items-center">
                            {subjects.map(sub => (
                              <Badge
                                key={sub}
                                variant={selectedSubjects.includes(sub) ? "default" : "secondary"}
                                className={"cursor-pointer px-3 py-1 font-normal transition-all duration-200 " + (
                                  selectedSubjects.includes(sub)
                                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700")}
                                onClick={() => toggleSingle(selectedSubjects, setSelectedSubjects, sub)}
                              >
                                {sub}
                              </Badge>
                            ))}
                            <CustomEditableTag
                              onAdd={(val) => handleAddCustom(val, subjects, setSubjects, setSelectedSubjects)}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" />适用年级</h4>
                          <div className="flex flex-wrap gap-2 items-center">
                            {grades.map(grade => (
                              <Badge
                                key={grade}
                                variant={selectedGrades.includes(grade) ? "default" : "secondary"}
                                className={"cursor-pointer px-3 py-1 font-normal transition-all duration-200 " + (
                                  selectedGrades.includes(grade)
                                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700")}
                                onClick={() => toggleSingle(selectedGrades, setSelectedGrades, grade)}
                              >
                                {grade}
                              </Badge>
                            ))}
                            <CustomEditableTag
                              onAdd={(val) => handleAddCustom(val, grades, setGrades, setSelectedGrades)}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><User2 className="w-3.5 h-3.5" />教师风格</h4>
                          <div className="flex flex-wrap gap-2 items-center">
                            {teacherStyles.map(style => (
                              <Badge
                                key={style}
                                variant={selectedStyles.includes(style) ? "default" : "secondary"}
                                className={"cursor-pointer px-3 py-1 font-normal transition-all duration-200 " + (
                                  selectedStyles.includes(style)
                                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700")}
                                onClick={() => toggleSingle(selectedStyles, setSelectedStyles, style)}
                              >
                                {style}
                              </Badge>
                            ))}
                            <CustomEditableTag
                              onAdd={(val) => handleAddCustom(val, teacherStyles, setTeacherStyles, setSelectedStyles)}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" />自定义要求</h4>
                          <textarea
                            rows={2}
                            placeholder="额外说明，例如：用简单的语言解释、注重实际案例..."
                            className="w-full bg-zinc-50/50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-300 dark:focus:border-zinc-700 transition-colors resize-none placeholder:text-zinc-400"
                            value={customReq}
                            onChange={(e) => setCustomReq(e.target.value)}
                          />
                        </div>

                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {submitError && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-sm text-rose-500 text-center"
            >
              {submitError}
            </motion.p>
          )}

          {/* Suggestions */}
          <motion.div
            className="w-full max-w-5xl mt-8 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            <div className="flex flex-wrap items-center justify-center gap-2 relative z-10">
              {SUGGESTIONS.map((suggestion, idx) => (
                <motion.div
                  key={idx}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div onClick={(e) => handleSuggestionClick(e, suggestion.text)} className="cursor-pointer group">
                    <PromptSuggestion
                      className="bg-card text-card-foreground backdrop-blur-sm border border-zinc-300/90 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 px-5 py-2.5 h-auto text-sm rounded-full shadow-[0_2px_10px_rgb(0,0,0,0.02)] transition-all font-medium pointer-events-none flex items-center justify-center gap-2 relative overflow-hidden"
                    >

                      <suggestion.icon className="w-4 h-4 opacity-70 relative z-10" />
                      <span>{suggestion.text}</span>
                    </PromptSuggestion>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

function FlyingText({ flyingData, onComplete }: { flyingData: { text: string, x: number, y: number, w: number, h: number }, onComplete: () => void }) {
  const [targetRect, setTargetRect] = useState<{ x: number, y: number } | null>(null)
  const startCenterX = flyingData.x + flyingData.w / 2
  const startCenterY = flyingData.y + flyingData.h / 2
  const [trailPoint, setTrailPoint] = useState<{ x: number, y: number }>({ x: startCenterX, y: startCenterY })
  const beamDuration = 0.68

  useLayoutEffect(() => {
    const inputArea = document.getElementById('prompt-main-textarea')
    const inputBox = document.getElementById('main-input-box')
    if (!inputArea) {
      setTargetRect({ x: flyingData.x, y: flyingData.y })
      return
    }

    const rect = inputArea.getBoundingClientRect()
    const boxRect = inputBox?.getBoundingClientRect() ?? rect
    const computed = window.getComputedStyle(inputArea)
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0
    const fontSize = Number.parseFloat(computed.fontSize) || 16
    const parsedLineHeight = Number.parseFloat(computed.lineHeight)
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.35

    // Aim at the first input line's visual center, then clamp into input box bounds.
    const anchorX = rect.left + paddingLeft + 10
    const anchorY = rect.top + paddingTop + lineHeight * 0.5
    const rawX = anchorX - flyingData.w / 2
    const rawY = anchorY - flyingData.h / 2
    const insetX = 12
    const insetY = 8
    const minX = boxRect.left + insetX
    const maxX = boxRect.right - insetX - flyingData.w
    const minY = boxRect.top + insetY
    const maxY = boxRect.bottom - insetY - flyingData.h
    const clampedX = Math.min(Math.max(rawX, minX), Math.max(minX, maxX))
    const clampedY = Math.min(Math.max(rawY, minY), Math.max(minY, maxY))

    setTargetRect({
      x: clampedX,
      y: clampedY,
    })
  }, [flyingData.h, flyingData.w, flyingData.x, flyingData.y])

  useEffect(() => {
    setTrailPoint({ x: startCenterX, y: startCenterY })
  }, [startCenterX, startCenterY])

  const deltaX = trailPoint.x - startCenterX
  const lift = Math.max(48, Math.abs(deltaX) * 0.18)
  const controlY = Math.min(startCenterY, trailPoint.y) - lift
  const beamPath = `M ${startCenterX} ${startCenterY} Q ${startCenterX + deltaX * 0.5} ${controlY} ${trailPoint.x} ${trailPoint.y}`

  return (
    <>
      {targetRect && (
        <svg className="fixed inset-0 z-40 pointer-events-none overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="beamGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="rgba(56, 189, 248, 0.4)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path
            d={beamPath}
            fill="none"
            stroke="url(#beamGradient)"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.95}
          />
        </svg>
      )}

      {targetRect && (
        <motion.div
          initial={{ x: flyingData.x, y: flyingData.y, width: flyingData.w, opacity: 1, scale: 1 }}
          animate={{
            x: targetRect.x,
            y: targetRect.y,
            opacity: [1, 1, 0],
            scale: 0.82
          }}
          transition={{ duration: beamDuration, ease: [0.16, 1, 0.3, 1] }}
          onUpdate={(latest) => {
            const nextXRaw = latest.x
            const nextYRaw = latest.y
            const nextX =
              typeof nextXRaw === "number"
                ? nextXRaw
                : Number.parseFloat(nextXRaw ? String(nextXRaw) : `${flyingData.x}`)
            const nextY =
              typeof nextYRaw === "number"
                ? nextYRaw
                : Number.parseFloat(nextYRaw ? String(nextYRaw) : `${flyingData.y}`)

            if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return

            const centerX = nextX + flyingData.w / 2
            const centerY = nextY + flyingData.h / 2
            setTrailPoint((prev) => {
              if (Math.abs(prev.x - centerX) < 0.5 && Math.abs(prev.y - centerY) < 0.5) {
                return prev
              }
              return { x: centerX, y: centerY }
            })
          }}
          onAnimationComplete={onComplete}
          className="fixed top-0 left-0 z-50 pointer-events-none flex items-center justify-center"
        >
          <div className="bg-white dark:bg-white border border-zinc-300 text-black dark:text-black px-5 py-2.5 text-sm rounded-full font-medium whitespace-nowrap truncate relative z-10 overflow-hidden shadow-sm">
            <motion.div
              initial={{ left: "-100%" }}
              animate={{ left: "200%" }}
              transition={{ duration: beamDuration, ease: "linear" }}
              className="absolute top-0 bottom-0 w-[200px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/40 to-transparent skew-x-[-30deg]"
            />
            {flyingData.text}
          </div>
        </motion.div>
      )}
    </>
  )
}

function AnimatedTrashIcon() {
  return (
    <motion.div
      className="relative w-16 h-16 flex items-center justify-center rounded-2xl bg-red-50/50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 shadow-sm mx-auto mb-1 overflow-visible"
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-red-500/80 transition-colors overflow-visible"
      >
        {/* Animated Lid */}
        <motion.g
          variants={{
            rest: { rotate: 0, y: 0, x: 0 },
            hover: { rotate: -16, y: -3, x: -2 }
          }}
          style={{ transformOrigin: "2px 6px" }}
          transition={{ type: "spring", stiffness: 520, damping: 22 }}
        >
          <motion.path
            d="M3 6h18"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.26, delay: 0.02, ease: "easeOut" }}
          />
          <motion.path
            d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.26, delay: 0.06, ease: "easeOut" }}
          />
        </motion.g>

        {/* Bin Body */}
        <motion.path
          d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.34, ease: "easeOut" }}
        />
        <motion.line
          x1="10" y1="11" x2="10" y2="17"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.18, delay: 0.08, ease: "easeOut" }}
        />
        <motion.line
          x1="14" y1="11" x2="14" y2="17"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.18, delay: 0.12, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  )
}
