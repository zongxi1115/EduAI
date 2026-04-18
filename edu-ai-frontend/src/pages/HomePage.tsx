import { motion, AnimatePresence } from "motion/react"
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDown, ChevronUp, Sparkles, Send, BookOpen, GraduationCap, User2, Settings2, Lightbulb, Calculator, History, Beaker, Languages, LoaderCircle } from "lucide-react"

import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "@/components/ui/prompt-input"
import { PromptSuggestion } from "@/components/ui/prompt-suggestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

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
const SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理", "其他"]
const GRADES = ["幼教", "小学低段", "小学高段", "初中", "高中", "大学与成人"]
const TEACHER_STYLES = ["幽默风趣", "严谨专业", "鼓励启发", "互动探究", "引经据典", "生活化", "高能硬核"]

interface CreatePrepRunResponse {
  run_id?: string
}

export default function HomePage() {
  const [query, setQuery] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Extra options
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

  // Fly animation setup
  const [flyingSuggestion, setFlyingSuggestion] = useState<{ text: string, x: number, y: number, w: number } | null>(null)
  
  const handleSuggestionClick = (e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setFlyingSuggestion({ text, x: rect.left, y: rect.top, w: rect.width })
  }

  const toggleArray = (arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>, item: string) => {
    if (arr.includes(item)) setArr(arr.filter(i => i !== item))
    else setArr([...arr, item])
  }

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

  const handleSearchSubmit = () => {
    void handleSearch()
  }

  return (
          <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-8 bg-[#fafafa] dark:bg-zinc-950 relative overflow-hidden">
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

          <div id="main-input-box" className="relative flex flex-col bg-white dark:bg-zinc-950 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)] border border-zinc-100 dark:border-zinc-800 transition-all duration-300 z-10">
            <PromptInput
              value={query}
              onValueChange={setQuery}
              className="bg-transparent border-none shadow-none rounded-[24px] focus-within:ring-0 focus-visible:ring-0 px-4 pt-4 pb-2"
              onSubmit={handleSearchSubmit}
              isLoading={isSubmitting}
              disabled={isSubmitting}
            >
              <PromptInputTextarea
                placeholder="在此输入您的教学目标或授课需求..."
                className="text-base sm:text-lg min-h-14 py-2 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 leading-relaxed font-medium"
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
                      className="rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900 text-white transition-all w-10 h-10 shadow-sm"
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
                        <div className="flex flex-wrap gap-2">
                          {SUBJECTS.map(sub => (
                            <Badge 
                              key={sub}
                              variant={selectedSubjects.includes(sub) ? "default" : "secondary"}
                              className={`cursor-pointer px-3 py-1 font-normal transition-all duration-200 ${
                                selectedSubjects.includes(sub) 
                                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" 
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              }`}
                              onClick={() => toggleArray(selectedSubjects, setSelectedSubjects, sub)}
                            >
                              {sub}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" />适用年级</h4>
                        <div className="flex flex-wrap gap-2">
                          {GRADES.map(grade => (
                            <Badge 
                              key={grade}
                              variant={selectedGrades.includes(grade) ? "default" : "secondary"}
                              className={`cursor-pointer px-3 py-1 font-normal transition-all duration-200 ${
                                selectedGrades.includes(grade) 
                                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" 
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              }`}
                              onClick={() => toggleArray(selectedGrades, setSelectedGrades, grade)}
                            >
                              {grade}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><User2 className="w-3.5 h-3.5" />教师风格</h4>
                        <div className="flex flex-wrap gap-2">
                          {TEACHER_STYLES.map(style => (
                            <Badge 
                              key={style}
                              variant={selectedStyles.includes(style) ? "default" : "secondary"}
                              className={`cursor-pointer px-3 py-1 font-normal transition-all duration-200 ${
                                selectedStyles.includes(style) 
                                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" 
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              }`}
                              onClick={() => toggleArray(selectedStyles, setSelectedStyles, style)}
                            >
                              {style}
                            </Badge>
                          ))}
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
                    className="bg-white dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white px-5 py-2.5 h-auto text-sm rounded-full shadow-[0_2px_10px_rgb(0,0,0,0.02)] transition-all font-medium pointer-events-none flex items-center justify-center gap-2 relative overflow-hidden"
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
  )
}

function FlyingText({ flyingData, onComplete }: { flyingData: { text: string, x: number, y: number, w: number }, onComplete: () => void }) {
  const [targetRect, setTargetRect] = useState<{ x: number, y: number } | null>(null)

  useEffect(() => {
    // Attempt to locate input box to fly words to
    const inputArea = document.getElementById('main-input-box')
    if (inputArea) {
      const rect = inputArea.getBoundingClientRect()
      // approximate target position into the textarea
      setTargetRect({ x: rect.left + 24, y: rect.top + 24 })
    }
  }, [])

  return (
    <motion.div
      initial={{ x: flyingData.x, y: flyingData.y, width: flyingData.w, opacity: 1, scale: 1 }}
      animate={targetRect ? { 
        x: targetRect.x, 
        y: targetRect.y, 
        opacity: [1, 1, 0],
        scale: 0.8
      } : {}}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={onComplete}
      className="fixed top-0 left-0 z-50 pointer-events-none flex items-center justify-center"
    >
      {/* Light beam / glow trail effect behind the flying text */}
      <motion.div
         initial={{ opacity: 0, scaleY: 0.5 }}
         animate={{ opacity: [0, 0.8, 0], scaleY: [0.5, 1.5, 0.5], scaleX: [1, 2, 1] }}
         transition={{ duration: 0.6, ease: "easeInOut" }}
         className="absolute inset-[-20px] bg-blue-500/30 blur-2xl rounded-full z-0"
      />
      <div className="bg-white dark:bg-zinc-900 shadow-[0_0_30px_rgba(59,130,246,0.5)] border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-5 py-2.5 text-sm rounded-full font-medium whitespace-nowrap truncate w-full h-full relative z-10 overflow-hidden">
        {/* Inner passing beam */}
        <motion.div 
          initial={{ left: "-100%" }}
          animate={{ left: "200%" }}
          transition={{ duration: 0.6, ease: "linear" }}
          className="absolute top-0 bottom-0 w-[200px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/40 to-transparent skew-x-[-30deg]"
        />
        {flyingData.text}
      </div>
    </motion.div>
  )
}

















