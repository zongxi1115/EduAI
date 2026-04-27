import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FastForward,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  Sparkles,
  Maximize,
  RectangleHorizontal,
  X,
} from "lucide-react";
import {
  GenerationDashboard,
  type ClassroomGenerationEvent,
  type ClassroomRunStatus,
} from "@/components/GenerationDashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LessonPlayerProvider,
  useLessonPlayer,
  type LessonResult,
} from "@/components/classroom/LessonPlayerProvider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ClassroomRunSnapshot {
  status: ClassroomRunStatus;
  latest_summary?: string | null;
  error?: string | null;
  request?: {
    topic?: string | null;
    source_prep_run_id?: string | null;
  } | null;
}

interface ClassroomRunProgress {
  topic: string | null;
  status: ClassroomRunStatus;
  summary: string | null;
  error: string | null;
  events: ClassroomGenerationEvent[];
}

type PageState =
  | { status: "loading" }
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "ready"; lesson: LessonResult };

const CLASSROOM_STREAM_EVENTS = [
  "run_created",
  "workflow_started",
  "node_started",
  "node_completed",
  "node_failed",
  "question_generated",
  "voice_started",
  "voice_completed",
  "voice_failed",
  "voice_skipped",
  "workflow_completed",
  "workflow_failed",
  "heartbeat",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildInitialProgress(): ClassroomRunProgress {
  return {
    topic: null,
    status: "unknown",
    summary: "正在连接课堂生成任务…",
    error: null,
    events: [],
  };
}

async function readErrorMessage(response: Response, fallback: string) {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawText) as { detail?: unknown };
    return getString(parsed.detail) ?? rawText;
  } catch {
    return rawText;
  }
}

function parseClassroomEvent(rawData: string): ClassroomGenerationEvent | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const index = parsed.index;
    const timestamp = getString(parsed.timestamp);
    const event = getString(parsed.event);
    const runId = getString(parsed.run_id);
    const runStatus = getString(parsed.run_status) as ClassroomRunStatus | null;

    if (
      typeof index !== "number" ||
      timestamp === null ||
      event === null ||
      runId === null ||
      runStatus === null
    ) {
      return null;
    }

    return {
      index,
      timestamp,
      event,
      node: getString(parsed.node),
      phase: getString(parsed.phase),
      summary: getString(parsed.summary),
      run_id: runId,
      run_status: runStatus,
      current_node: getString(parsed.current_node),
      data: isRecord(parsed.data) ? parsed.data : undefined,
    };
  } catch {
    return null;
  }
}

function formatPlaybackTime(milliseconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPlaybackRate(rate: number) {
  return `${rate.toFixed(rate % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}x`;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

interface LessonChapterEntry {
  pageIndex: number;
  pageStartMs: number;
  revealCount: number;
  title: string;
}

const LESSON_PREVIEW_SCALE = 0.34;
const LESSON_PREVIEW_COMPACT_SCALE = 0.28;
const LESSON_PREVIEW_WIDTH = 208;
const LESSON_PREVIEW_HORIZONTAL_PADDING = 10;
const PAGE_SWITCH_DISTANCE_PX = 96;

function getPageTransitionVariants(shouldReduceMotion: boolean) {
  return {
    enter: (direction: number) => ({
      x: shouldReduceMotion
        ? 0
        : direction > 0
          ? PAGE_SWITCH_DISTANCE_PX
          : direction < 0
            ? -PAGE_SWITCH_DISTANCE_PX
            : 0,
      opacity: shouldReduceMotion ? 1 : direction === 0 ? 1 : 0.92,
      scale: shouldReduceMotion ? 1 : direction === 0 ? 1 : 0.985,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: shouldReduceMotion
        ? { duration: 0.01 }
        : {
            duration: 0.42,
            ease: [0.22, 1, 0.36, 1] as const,
          },
    },
    exit: (direction: number) => ({
      x: shouldReduceMotion
        ? 0
        : direction > 0
          ? -PAGE_SWITCH_DISTANCE_PX
          : direction < 0
            ? PAGE_SWITCH_DISTANCE_PX
            : 0,
      opacity: shouldReduceMotion ? 1 : direction === 0 ? 1 : 0.88,
      scale: shouldReduceMotion ? 1 : direction === 0 ? 1 : 0.992,
      transition: shouldReduceMotion
        ? { duration: 0.01 }
        : {
            duration: 0.3,
            ease: [0.25, 1, 0.5, 1] as const,
          },
    }),
  };
}

function LessonPagePreview({
  srcDoc,
  title,
  subtitle,
  timeLabel,
  compact = false,
}: {
  srcDoc?: string;
  title: string;
  subtitle: string;
  timeLabel?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-black/10 bg-white",
        compact ? "w-[132px] shadow-sm" : "w-[208px] shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
      )}
    >
      <div className="aspect-video w-full overflow-hidden bg-slate-100">
        <iframe
          srcDoc={srcDoc}
          title={title}
          scrolling="no"
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
          className="h-full w-full origin-top-left pointer-events-none"
          style={{
            transform: `scale(${compact ? LESSON_PREVIEW_COMPACT_SCALE : LESSON_PREVIEW_SCALE})`,
            width: `${100 / (compact ? LESSON_PREVIEW_COMPACT_SCALE : LESSON_PREVIEW_SCALE)}%`,
            height: `${100 / (compact ? LESSON_PREVIEW_COMPACT_SCALE : LESSON_PREVIEW_SCALE)}%`,
          }}
        />
      </div>
      {!compact ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-slate-800">{title}</div>
            <div className="truncate text-[10px] text-slate-500">{subtitle}</div>
          </div>
          {timeLabel ? (
            <div className="shrink-0 text-[11px] font-semibold text-slate-700 tabular-nums">
              {timeLabel}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LessonCatalogList({
  chapters,
  currentPageIndex,
  horizontal = false,
  previewSrcDocs,
  onSelectChapter,
}: {
  chapters: LessonChapterEntry[];
  currentPageIndex: number;
  horizontal?: boolean;
  previewSrcDocs: string[];
  onSelectChapter: (chapter: LessonChapterEntry) => void;
}) {
  return (
    <div className={cn("flex gap-1.5", horizontal ? "flex-row pb-4 min-w-max" : "flex-col")}>
      {chapters.map((chapter) => {
        const isActive = chapter.pageIndex === currentPageIndex;
        const isPast = chapter.pageIndex < currentPageIndex;

        return (
          <button
            key={chapter.pageIndex}
            type="button"
            onClick={() => onSelectChapter(chapter)}
            className={cn(
              "text-left group flex gap-3.5 rounded-xl p-3.5 transition-all duration-200",
              horizontal ? "w-[348px] items-start" : "w-full items-center",
              isActive ? "bg-indigo-50/80 ring-1 ring-indigo-100 shadow-sm" : "hover:bg-slate-50"
            )}
          >
            <div className="mt-[3px] flex flex-col items-center">
              {isActive ? (
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-indigo-100/80 text-indigo-600 ring-4 ring-white shadow-sm">
                  <Play className="h-3 w-3 fill-current" />
                </div>
              ) : isPast ? (
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-4 ring-white">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              ) : (
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
                  {chapter.pageIndex + 1}
                </div>
              )}
            </div>

            <div className="shrink-0">
              <LessonPagePreview
                srcDoc={previewSrcDocs[chapter.pageIndex]}
                title={chapter.title}
                subtitle={`第 ${chapter.pageIndex + 1} 章`}
                compact
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 self-center">
              <span
                className={cn(
                  "line-clamp-2 text-[14px] font-semibold leading-[1.4]",
                  isActive ? "text-indigo-950" : isPast ? "text-slate-600" : "text-slate-800",
                  !isActive && "transition-colors group-hover:text-indigo-600"
                )}
              >
                {chapter.title}
              </span>
              <span className="flex items-center gap-2 text-[12px] font-medium text-slate-500 line-clamp-1">
                <span>{chapter.revealCount} 个知识点</span>
                <span className="h-[3px] w-[3px] rounded-full bg-slate-300" />
                <span>P.{chapter.pageIndex + 1}</span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function LessonPlayerShell({ sourcePrepRunId }: { sourcePrepRunId: string | null }) {
  const {
    lesson,
    currentPage,
    pages,
    currentPageIndex,
    currentTheme,
    hasStarted,
    isPlaying,
    isEnded,
    activeQuiz,
    phase,
    submitQuizAnswer,
    retryQuiz,
    skipQuiz,
    quizError,
    bindStageFrame,
    handleStageReady,
    restartLesson,
    totalReveals,
    timelineSegments,
    timelineDurationMs,
    timelineElapsedMs,
    playbackRate,
    setPlaybackRate,
    stageRenderNonce,
    seekToTime,
    seekBy,
    togglePlayback,
  } = useLessonPlayer();
  const shouldReduceMotion = useReducedMotion();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{
    leftPx: number;
    pageIndex: number;
    timeMs: number;
  } | null>(null);
  const [osdMessage, setOsdMessage] = useState<{ icon: React.ReactNode; text: string } | null>(null);
  const [showSectionBanner, setShowSectionBanner] = useState(false);

  const playerContainerRef = useRef<HTMLDivElement>(null);
  const progressRailRef = useRef<HTMLDivElement>(null);
  const osdTimerRef = useRef<number | null>(null);
  const bannerTimerRef = useRef<number | null>(null);
  const hoverPreviewTimerRef = useRef<number | null>(null);
  const hoverPreviewCandidateRef = useRef<{
    leftPx: number;
    pageIndex: number;
    timeMs: number;
  } | null>(null);

  const triggerOsd = (icon: React.ReactNode, text: string) => {
    setOsdMessage({ icon, text });
    if (osdTimerRef.current !== null) {
      clearTimeout(osdTimerRef.current);
    }
    osdTimerRef.current = window.setTimeout(() => setOsdMessage(null), 800);
  };

  // Section banner trigger
  useEffect(() => {
    setShowSectionBanner(true);
    if (bannerTimerRef.current !== null) {
      clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => setShowSectionBanner(false), 3000);
  }, [currentPageIndex]);

  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await playerContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const syncFullscreenState = () => {
    setIsFullscreen(!!document.fullscreenElement);
  };

  useEffect(() => {
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverPreviewTimerRef.current !== null) {
        window.clearTimeout(hoverPreviewTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleStageMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (
        !payload ||
        typeof payload !== "object" ||
        payload.source !== "edu-lesson-stage" ||
        payload.type !== "lesson-stage-dblclick"
      ) {
        return;
      }

      togglePlayback();
      triggerOsd(
        isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />,
        isPlaying ? "暂停" : "播放"
      );
    };

    window.addEventListener("message", handleStageMessage);
    return () => window.removeEventListener("message", handleStageMessage);
  }, [isPlaying, togglePlayback]);

  useEffect(() => {
    if (!isFullscreen) {
      setIsCatalogOpen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isCatalogOpen) {
        setIsCatalogOpen(false);
        return;
      }

      // Avoid triggering when user is typing in an input (like a quiz)
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;

      if (e.key === "ArrowLeft") {
        seekBy(-10000);
        triggerOsd(<Rewind className="w-8 h-8" />, "后退 10 秒");
      } else if (e.key === "ArrowRight") {
        seekBy(10000);
        triggerOsd(<FastForward className="w-8 h-8" />, "前进 10 秒");
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlayback();
        triggerOsd(
          isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />,
          isPlaying ? "暂停" : "播放"
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCatalogOpen, seekBy, togglePlayback, isPlaying]);

  const playbackStatus = isEnded
    ? "播放完成"
    : isPlaying
    ? "正在播放"
    : hasStarted
    ? "已暂停"
    : "准备播放";
  const visibleTimelineMs = isScrubbing ? scrubValue : timelineElapsedMs;
  const visibleTimelineCompletion = useMemo(() => {
    if (!timelineDurationMs) {
      return 0;
    }
    return Math.min(100, Math.max(0, (visibleTimelineMs / timelineDurationMs) * 100));
  }, [timelineDurationMs, visibleTimelineMs]);
  const chapterEntries = useMemo<LessonChapterEntry[]>(
    () =>
      pages.map((page, index) => {
        const pageStartSegment =
          timelineSegments.find((segment) => segment.pageIndex === index && segment.revealIndex === 0) ??
          timelineSegments.at(0);

        return {
          pageIndex: index,
          pageStartMs: pageStartSegment?.startMs ?? 0,
          revealCount: page.reveals.length,
          title: page.theme || `第 ${index + 1} 模块`,
        };
      }),
    [pages, timelineSegments]
  );
  const currentChapter = chapterEntries[currentPageIndex] ?? null;
  const nextChapter = chapterEntries[currentPageIndex + 1] ?? null;
  const playerSummary = currentPage.objective?.trim() || currentPage.onSlideSummary || currentTheme;
  const playbackRateOptions = [0.75, 1, 1.25, 1.5, 2];
  const hoveredChapter = hoverPreview ? chapterEntries[hoverPreview.pageIndex] ?? null : null;

  useEffect(() => {
    if (!isScrubbing) {
      setScrubValue(timelineElapsedMs);
    }
  }, [isScrubbing, timelineElapsedMs]);

  const commitSeek = (nextValue: number) => {
    if (!timelineDurationMs) {
      return;
    }

    const clampedValue = Math.max(0, Math.min(nextValue, timelineDurationMs));
    setIsScrubbing(false);
    setScrubValue(clampedValue);
    seekToTime(clampedValue);
  };

  const updateHoverPreview = (clientX: number) => {
    const rail = progressRailRef.current;
    if (!rail || !timelineDurationMs || !timelineSegments.length) {
      hoverPreviewCandidateRef.current = null;
      setHoverPreview(null);
      return;
    }

    const rect = rail.getBoundingClientRect();
    if (rect.width <= 0) {
      hoverPreviewCandidateRef.current = null;
      setHoverPreview(null);
      return;
    }

    const ratio = clampPercent(((clientX - rect.left) / rect.width) * 100) / 100;
    const hoverTimeMs = ratio * timelineDurationMs;
    const targetSegment =
      timelineSegments.find((segment) => hoverTimeMs < segment.endMs) ?? timelineSegments.at(-1);

    if (!targetSegment) {
      hoverPreviewCandidateRef.current = null;
      setHoverPreview(null);
      return;
    }

    const rawLeftPx = ratio * rect.width;
    const clampedLeftPx = Math.min(
      rect.width - LESSON_PREVIEW_WIDTH / 2 - LESSON_PREVIEW_HORIZONTAL_PADDING,
      Math.max(LESSON_PREVIEW_WIDTH / 2 + LESSON_PREVIEW_HORIZONTAL_PADDING, rawLeftPx)
    );
    const nextPreview = {
      leftPx: clampedLeftPx,
      pageIndex: targetSegment.pageIndex,
      timeMs: hoverTimeMs,
    };

    hoverPreviewCandidateRef.current = nextPreview;

    if (hoverPreview) {
      setHoverPreview(nextPreview);
      return;
    }

    if (hoverPreviewTimerRef.current === null) {
      hoverPreviewTimerRef.current = window.setTimeout(() => {
        hoverPreviewTimerRef.current = null;
        setHoverPreview(hoverPreviewCandidateRef.current);
      }, 300);
    }
  };

  const clearHoverPreview = () => {
    hoverPreviewCandidateRef.current = null;
    if (hoverPreviewTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewTimerRef.current);
      hoverPreviewTimerRef.current = null;
    }
    setHoverPreview(null);
  };

  const shouldShowTimelineChrome = isFullscreen || isScrubbing;
  const hoverPreviewTitle =
    hoveredChapter?.title ||
    (hoverPreview ? pages[hoverPreview.pageIndex]?.theme || `第 ${hoverPreview.pageIndex + 1} 模块` : "");
  const currentStageSceneKey = `${currentPage.idx}-${stageRenderNonce}`;
  const previousPageIndexRef = useRef(currentPageIndex);
  const previousStageSceneKeyRef = useRef(currentStageSceneKey);
  const pageTransitionDirectionRef = useRef(0);

  if (previousPageIndexRef.current !== currentPageIndex) {
    pageTransitionDirectionRef.current =
      currentPageIndex > previousPageIndexRef.current ? 1 : -1;
  } else if (previousStageSceneKeyRef.current !== currentStageSceneKey) {
    pageTransitionDirectionRef.current = 0;
  }
  previousPageIndexRef.current = currentPageIndex;
  previousStageSceneKeyRef.current = currentStageSceneKey;

  const pageTransitionDirection = pageTransitionDirectionRef.current;
  const pageTransitionVariants = useMemo(
    () => getPageTransitionVariants(Boolean(shouldReduceMotion)),
    [shouldReduceMotion]
  );

  return (
    <div className="min-h-screen bg-[#f9fafb] text-slate-900 pb-16 font-sans">
      {/* 头部导航区域 */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[4.25rem] max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              to={
                sourcePrepRunId
                  ? `/study/${encodeURIComponent(sourcePrepRunId)}?tab=prep-classroom`
                  : "/"
              }
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            
            <div className="flex items-center gap-2.5 font-semibold text-slate-800">
              <BookOpen className="h-5 w-5 text-indigo-500" />
              <span className="line-clamp-1 max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg">{lesson.topic}</span>
            </div>
            
            <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 sm:block ml-2">
              {playbackStatus}
            </div>
          </div>

          {sourcePrepRunId ? (
            <Button
              asChild
              className="rounded-full bg-slate-900 px-4 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)] hover:bg-slate-800"
            >
              <Link to={`/study/${encodeURIComponent(sourcePrepRunId)}`}>
                前去练习
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {/* 主体大网格 */}
      <main 
        className={cn(
          "mx-auto flex flex-col items-start gap-8 px-4 sm:px-6 lg:px-8",
          isTheater ? "mt-4 max-w-none w-full" : "max-w-[1600px] mt-6 lg:mt-8 lg:flex-row"
        )}
      >
        
        {/* 左侧：播放器和详细信息 */}
        <div className={cn("flex-1 min-w-0 w-full flex flex-col gap-6", isTheater ? "mx-auto lg:max-w-[85%]" : "")}>
          
          {/* 播放器容器（类似视频播放器形态） */}
          <div 
            ref={playerContainerRef}
            className={cn(
              "group/player relative overflow-hidden bg-black shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-200/60 flex flex-col",
              isFullscreen ? "h-screen w-screen rounded-none" : "rounded-2xl"
            )}
          >
            
            {/* OSD 中心提示动画 */}
            <div className={cn(
              "pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 z-50 flex flex-col items-center justify-center gap-2",
              "transition-all duration-300",
              osdMessage ? "opacity-100 scale-100" : "opacity-0 scale-90"
            )}>
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
                {osdMessage?.icon}
              </div>
            </div>

            {/* 新章节点：滑动横幅动画 */}
            <div className={cn(
              "pointer-events-none absolute top-12 right-0 z-40 transition-all duration-700 ease-out-expo max-w-[280px]",
              showSectionBanner ? "translate-x-0 opacity-100" : "translate-x-12 opacity-0"
            )}>
              <div className="rounded-l-2xl border-y border-l border-white/20 bg-black/75 px-5 py-3 text-white backdrop-blur-xl shadow-2xl">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-400">目前知识点</div>
                <div className="mt-1 text-[15px] font-medium leading-normal line-clamp-2">
                  {currentTheme}
                </div>
              </div>
            </div>

            {/* 互动答题弹层（层级介于画面和控件之间） */}
            {activeQuiz && phase === "question" && (
              <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
                <div className="w-full max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl bg-white p-6 md:p-8 shadow-2xl scale-100 animate-in fade-in zoom-in-95 duration-300 pointer-events-auto">
                  <div className="mb-6 flex items-center gap-2 text-indigo-600 font-semibold text-sm">
                    <Sparkles className="w-5 h-5" /> 随堂互动
                  </div>
                  
                  <div className="text-lg md:text-xl font-bold text-slate-900 mb-8 whitespace-pre-wrap leading-relaxed">
                    {activeQuiz.payload.question}
                  </div>

                  {activeQuiz.payload.type === "choice" && activeQuiz.payload.options && (
                    <div className="flex flex-col gap-3">
                      {activeQuiz.payload.options.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => submitQuizAnswer(option)}
                          className="group/option w-full rounded-xl border-2 border-slate-100 bg-slate-50 relative overflow-hidden transition-all hover:border-indigo-500 hover:bg-white text-left shadow-sm active:scale-[0.99]"
                        >
                          <div className="absolute inset-0 bg-indigo-50/0 group-hover/option:bg-indigo-50/50 transition-colors" />
                          <div className="relative z-10 flex items-start px-5 py-4">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-500 group-hover/option:bg-indigo-500 group-hover/option:text-white transition-colors mr-4">
                              {String.fromCharCode(65 + idx)}
                            </div>
                            <div className="flex-1 text-slate-700 font-medium text-[15px] self-center">
                              {option}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {activeQuiz.payload.type === "fill" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const answer = formData.get("answer") as string;
                        if (answer.trim()) {
                          submitQuizAnswer(answer);
                        }
                      }}
                      className="flex flex-col gap-4"
                    >
                      <input
                        name="answer"
                        type="text"
                        placeholder="请输入你的答案..."
                        autoComplete="off"
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                      />
                      <button
                        type="submit"
                        className="self-end rounded-xl bg-indigo-600 px-8 py-3.5 text-sm font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500 hover:-translate-y-0.5 active:translate-y-0 transition-all"
                      >
                        提交答案
                      </button>
                    </form>
                  )}

                  {quizError && (
                    <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-600 border border-red-100 flex justify-between items-center animate-in fade-in slide-in-from-bottom-2">
                       <span>{quizError}</span>
                       <div className="flex items-center gap-4">
                         <button onClick={retryQuiz} className="text-slate-600 hover:text-slate-900 underline underline-offset-2">重新作答</button>
                         <button onClick={skipQuiz} className="text-red-500 hover:text-red-700 underline underline-offset-2">跳过此题</button>
                       </div>
                    </div>
                  )}
                  
                </div>
              </div>
            )}

            {/* 回馈结果层 */}
            {activeQuiz && phase === "feedback" && quizError && (
              <div className="absolute inset-x-0 bottom-24 z-[90] mx-auto w-11/12 max-w-lg rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/10 animate-in slide-in-from-bottom flex flex-col sm:flex-row items-center gap-4 sm:justify-between pointer-events-auto backdrop-blur-md bg-white/95">
                <div className="flex-1 text-slate-800 text-sm font-medium leading-relaxed">
                  <strong className="text-red-600 mb-1 block">提示:</strong>
                  {quizError}
                </div>
                <div className="flex shrink-0 gap-3">
                  <button onClick={retryQuiz} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">
                    重新答题
                  </button>
                  <button onClick={skipQuiz} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">
                    跳过
                  </button>
                </div>
              </div>
            )}

            {/* 顶部的 IFrame 画布 */}
            <div
              className="relative aspect-[16/9] w-full bg-slate-950 flex-1 isolate overflow-hidden min-h-0"
              onDoubleClick={() => {
                togglePlayback();
                triggerOsd(
                  isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />,
                  isPlaying ? "暂停" : "播放"
                );
              }}
            >
              <AnimatePresence initial={false} custom={pageTransitionDirection} mode="sync">
                <motion.div
                  key={currentStageSceneKey}
                  custom={pageTransitionDirection}
                  variants={pageTransitionVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="absolute inset-0 will-change-transform"
                >
                  <iframe
                    ref={bindStageFrame}
                    title={`lesson-page-${currentPage.idx}`}
                    srcDoc={currentPage.srcDoc}
                    onLoad={handleStageReady}
                    className="absolute inset-0 h-full w-full border-0 bg-transparent"
                    sandbox="allow-scripts allow-same-origin"
                  />
                </motion.div>
              </AnimatePresence>

              {isFullscreen && (
                <>
                  <div
                    className={cn(
                      "absolute inset-0 z-[60] bg-black/45 transition-opacity duration-300",
                      isCatalogOpen ? "opacity-100" : "pointer-events-none opacity-0"
                    )}
                    onClick={() => setIsCatalogOpen(false)}
                  />
                  <aside
                    className={cn(
                      "absolute inset-y-0 right-0 z-[70] flex w-full max-w-sm flex-col border-l border-slate-200/70 bg-white/96 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out",
                      isCatalogOpen ? "translate-x-0" : "translate-x-full"
                    )}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-500">
                          课程目录
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-slate-500">
                          共 {pages.length} 个学习模块
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsCatalogOpen(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="关闭目录"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300">
                      <LessonCatalogList
                        chapters={chapterEntries}
                        currentPageIndex={currentPageIndex}
                        previewSrcDocs={pages.map((page) => page.srcDoc)}
                        onSelectChapter={(chapter) => {
                          setIsCatalogOpen(false);
                          seekToTime(chapter.pageStartMs);
                        }}
                      />
                    </div>
                  </aside>
                </>
              )}
            </div>

            {/* 视频控制器区域 */}
            <div className={cn(
              "px-5 py-4 text-slate-300 flex-shrink-0 transition-opacity",
              isFullscreen
                ? "absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pb-6 pt-12 opacity-0 group-hover/player:opacity-100 z-50"
                : "border-t border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.82)_50%,rgba(248,250,252,0.95)_100%)] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_-10px_30px_rgba(15,23,42,0.04)]"
            )}>

              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  shouldShowTimelineChrome
                    ? "mb-3 max-h-48 opacity-100"
                    : "mb-0 max-h-0 opacity-0 group-hover/player:mb-3 group-hover/player:max-h-48 group-hover/player:opacity-100"
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-4 text-[11px] leading-4">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
                    <span className={cn(
                      "shrink-0 font-medium uppercase tracking-[0.16em]",
                      isFullscreen ? "text-slate-500" : "text-slate-400"
                    )}>当前章节</span>
                    <span className={cn(
                      "truncate font-medium",
                      isFullscreen ? "text-slate-100" : "text-slate-800"
                    )}>
                      {currentChapter?.title || currentTheme}
                    </span>
                  </div>

                  <div className="flex min-w-0 max-w-[45%] items-baseline justify-end gap-2 text-right">
                    <span className={cn(
                      "shrink-0 font-medium uppercase tracking-[0.16em]",
                      isFullscreen ? "text-slate-500" : "text-slate-400"
                    )}>下一章</span>
                    <span className={cn(
                      "truncate font-medium",
                      isFullscreen ? "text-slate-300" : "text-slate-600"
                    )}>
                      {nextChapter?.title || "已是最后一章"}
                    </span>
                  </div>

                  {isFullscreen ? (
                    <button
                      type="button"
                      onClick={() => setIsCatalogOpen((value) => !value)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:text-white"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      {isCatalogOpen ? "收起目录" : "查看目录"}
                    </button>
                  ) : null}
                </div>

                <TooltipProvider delayDuration={120}>
                  {/* 带标记点的进度条 */}
                  <div
                    ref={progressRailRef}
                    className="relative flex items-center group/progress h-[1.375rem] w-full touch-none select-none z-50"
                    onPointerMove={(event) => updateHoverPreview(event.clientX)}
                    onPointerLeave={clearHoverPreview}
                  >
                    <div className={cn(
                      "absolute inset-x-0 inset-y-1/2 -mt-[3px] h-1.5 rounded-full transition-transform origin-center group-hover/progress:scale-y-150",
                      isFullscreen ? "bg-white/20" : "bg-slate-200"
                    )}>
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out",
                          isFullscreen
                            ? "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"
                            : "bg-[#00a1d6] shadow-[0_0_0_1px_rgba(0,161,214,0.08)]"
                        )}
                        style={{ width: `${visibleTimelineCompletion}%` }}
                      />
                    </div>

                    {chapterEntries.map((chapter) => {
                      if (!timelineDurationMs) {
                        return null;
                      }

                      const pct = (chapter.pageStartMs / timelineDurationMs) * 100;
                      if (isNaN(pct) || pct <= 0) {
                        return null;
                      }

                      const isCurrent = chapter.pageIndex === currentPageIndex;
                      return (
                        <Tooltip key={`marker-${chapter.pageIndex}`}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => commitSeek(chapter.pageStartMs)}
                              className="absolute top-1/2 z-30 flex h-5 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-transparent"
                              style={{ left: `${pct}%` }}
                              aria-label={`跳转到章节：${chapter.title}`}
                            >
                              <span
                                className={cn(
                                  "h-3.5 w-[3px] rounded-full transition-all duration-150",
                                  isFullscreen
                                    ? "border border-black/10 bg-white"
                                    : "border border-white/80 bg-slate-300 shadow-[0_1px_2px_rgba(15,23,42,0.08)]",
                                  isCurrent &&
                                    (isFullscreen
                                      ? "h-4 bg-indigo-200 shadow-[0_0_0_2px_rgba(129,140,248,0.28)]"
                                      : "h-4 bg-[#00a1d6] shadow-[0_0_0_2px_rgba(0,161,214,0.18)]")
                                )}
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            portalContainer={playerContainerRef.current ?? undefined}
                            side="top"
                            sideOffset={10}
                            className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 shadow-lg ring-1 ring-slate-900/10"
                          >
                            {chapter.title}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}

                    <input
                      type="range"
                      min={0}
                      max={Math.max(timelineDurationMs, 1)}
                      step={50}
                      value={visibleTimelineMs}
                      disabled={!timelineDurationMs}
                      onPointerDown={() => setIsScrubbing(true)}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        setScrubValue(nextValue);
                        if (!isScrubbing) {
                          commitSeek(nextValue);
                        }
                      }}
                      onPointerUp={() => { if (isScrubbing) commitSeek(scrubValue); }}
                      onBlur={() => { if (isScrubbing) commitSeek(scrubValue); }}
                      className="absolute inset-0 z-20 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
                    />

                    {/* 自定义滑块原点 */}
                    <div
                      className={cn(
                        "pointer-events-none absolute z-20 h-4 w-4 -ml-2 rounded-full border shadow-md ring-[3.5px] scale-0 transition-transform duration-100 group-hover/progress:scale-100",
                        isFullscreen
                          ? "border-black/10 bg-white ring-indigo-500"
                          : "border-white/80 bg-white ring-[#00a1d6]"
                      )}
                      style={{ left: `${visibleTimelineCompletion}%` }}
                    />
                  </div>
                </TooltipProvider>
              </div>

              {/* 控制栏按钮组 */}
              <div className="flex items-center justify-between mt-3 z-50 relative">
                {hoverPreview ? (
                  <div
                    className="pointer-events-none absolute bottom-full z-[70] mb-5 -translate-x-1/2 "
                    style={{ left: `${hoverPreview.leftPx}px`,bottom:"calc(100% + 16px)" }}
                  >
                    <LessonPagePreview
                      srcDoc={pages[hoverPreview.pageIndex]?.srcDoc}
                      title={hoverPreviewTitle}
                      subtitle={`第 ${hoverPreview.pageIndex + 1} 章`}
                      timeLabel={formatPlaybackTime(hoverPreview.timeMs)}
                    />
                    <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-[6px] rotate-45 border-b border-r border-black/10 bg-white" />
                  </div>
                ) : null}
                <div className={cn(
                  "flex items-center gap-5",
                  isFullscreen ? "text-slate-200" : "text-slate-700"
                )}>
                  <button onClick={togglePlayback} className="hover:text-indigo-400 transition-colors hover:scale-110 active:scale-95 duration-200" title="空格键 播放/暂停">
                    {isPlaying ? <Pause className="h-[22px] w-[22px] fill-current" /> : <Play className="h-[22px] w-[22px] fill-current" />}
                  </button>
                  <button onClick={() => seekBy(-10000)} className="hover:text-indigo-400 transition-colors" title="左方向键 后退10秒">
                     <Rewind className="h-5 w-5 stroke-[1.5]" />
                  </button>
                  <button onClick={() => seekBy(10000)} className="hover:text-indigo-400 transition-colors" title="右方向键 前进10秒">
                     <FastForward className="h-5 w-5 stroke-[1.5]" />
                  </button>
                  <button onClick={restartLesson} className="hover:text-indigo-400 transition-colors" title="重新开始">
                     <RotateCcw className="h-[18px] w-[18px] stroke-[1.5]" />
                  </button>
                  <div className={cn(
                    "relative top-[1px] flex items-center gap-1.5 border-l pl-5 text-[13px] font-medium tabular-nums tracking-wider opacity-90",
                    isFullscreen
                      ? "border-white/10 text-slate-300"
                      : "border-slate-200/90 text-slate-500"
                  )}>
                    <span className={cn(isFullscreen ? "text-white" : "text-slate-800")}>{formatPlaybackTime(visibleTimelineMs)}</span>
                    <span className={cn(isFullscreen ? "text-slate-500" : "text-slate-400")}>/</span>
                    <span>{formatPlaybackTime(timelineDurationMs)}</span>
                  </div>
                </div>

                <div className={cn(
                  "flex items-center gap-5",
                  isFullscreen ? "text-slate-400" : "text-slate-500"
                )}>
                  <Popover open={isSpeedMenuOpen} onOpenChange={setIsSpeedMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold transition-colors",
                          isFullscreen
                            ? "border border-white/10 bg-white/5 text-slate-200 hover:text-indigo-300"
                            : "border border-slate-200/90 bg-white/75 text-slate-700 shadow-sm hover:text-indigo-600"
                        )}
                        title="播放倍速"
                      >
                        {formatPlaybackRate(playbackRate)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      portalContainer={playerContainerRef.current ?? undefined}
                      align="end"
                      side="top"
                      sideOffset={10}
                      className="w-40 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl"
                    >
                      <div className="px-2 py-1 text-[11px] font-medium text-slate-500">播放倍速</div>
                      <div className="flex flex-col gap-1">
                        {playbackRateOptions.map((option) => {
                          const selected = playbackRate === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setPlaybackRate(option);
                                setIsSpeedMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                                selected
                                  ? "bg-indigo-50 font-semibold text-indigo-700"
                                  : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              <span>{formatPlaybackRate(option)}</span>
                              <span className={cn("text-[10px]", selected ? "text-indigo-500" : "text-transparent")}>
                                当前
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button onClick={() => setIsTheater(!isTheater)} className="hover:text-indigo-400 transition-colors group flex items-center gap-1.5" title="宽屏模式">
                      <RectangleHorizontal className={cn("h-[18px] w-[18px] stroke-[1.5]", isTheater && "text-indigo-400 fill-indigo-400/20")} />
                  </button>
                  <button onClick={toggleFullscreen} className="hover:text-indigo-400 transition-colors" title="全屏模式">
                      <Maximize className="h-[18px] w-[18px] stroke-[1.5]" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 视频详情/信息区 (全屏时隐藏) */}
          {!isFullscreen && (
            <div className="rounded-2xl bg-white p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-200/60 flex flex-col gap-2">
              <h1 className="text-2xl md:text-[1.75rem] font-bold text-slate-900 tracking-tight">{lesson.topic}</h1>
              <div className="flex items-center text-[13px] text-slate-500 gap-3 font-medium mt-1.5 mb-2">
                <span className="inline-flex items-center bg-slate-100 rounded-md px-2 py-0.5">{pages.length} 内容章节</span>
                <span className="inline-flex items-center bg-slate-100 rounded-md px-2 py-0.5">{totalReveals} 讲解段落</span>
              </div>
              
              <div className="w-10 h-[3px] bg-indigo-500/20 rounded-full my-3" />
              
              <p className="text-[15px] leading-relaxed text-slate-600">
                 {playerSummary}
              </p>
            </div>
          )}
          
        </div>

        {/* 右侧：课程目录 (Playlist) (全屏时隐藏) */}
        {!isFullscreen && (
          <div className={cn("w-full flex-shrink-0", isTheater ? "lg:w-full mt-4" : "lg:w-[380px] xl:w-[420px]")}>
            <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-200/60 overflow-hidden flex flex-col max-h-none lg:max-h-[calc(100vh-8rem)] lg:sticky lg:top-24">
              
              {/* 播放列表 Header */}
              <div className="px-5 py-5 border-b border-slate-100/80 bg-slate-50/50 flex flex-col gap-1.5">
                 <h2 className="text-lg font-bold text-slate-900 tracking-tight">课程内容</h2>
                 <p className="text-sm font-medium text-slate-500">共 {pages.length} 个学习模块</p>
              </div>

              {/* 播放列表项 */}
              <div className={cn("flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300", isTheater ? "flex flex-row overflow-x-auto" : "")}>
                <LessonCatalogList
                  chapters={chapterEntries}
                  currentPageIndex={currentPageIndex}
                  horizontal={isTheater}
                  previewSrcDocs={pages.map((page) => page.srcDoc)}
                  onSelectChapter={(chapter) => seekToTime(chapter.pageStartMs)}
                />
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [progress, setProgress] = useState<ClassroomRunProgress>(() => buildInitialProgress());
  const [sourcePrepRunId, setSourcePrepRunId] = useState<string | null>(null);
  const loadedResultRef = useRef(false);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "缺少课堂任务 ID，无法打开播放器。" });
      setProgress(buildInitialProgress());
      setSourcePrepRunId(null);
      return;
    }

    let disposed = false;
    let eventSource: EventSource | null = null;
    const seenEventIndexes = new Set<number>();

    loadedResultRef.current = false;
    setState({ status: "loading" });
    setProgress(buildInitialProgress());
    setSourcePrepRunId(null);

    const updateProgress = (patch: Partial<ClassroomRunProgress>) => {
      if (disposed) {
        return;
      }

      setProgress((current) => ({
        ...current,
        ...patch,
        events: patch.events ?? current.events,
      }));
    };

    const failLesson = (message: string, errorText?: string | null) => {
      if (eventSource) {
        eventSource.close();
      }
      updateProgress({
        status: "failed",
        summary: errorText?.trim() || message,
        error: errorText?.trim() || message,
      });
      if (!disposed) {
        setState({ status: "error", message });
      }
    };

    const loadResult = async () => {
      if (loadedResultRef.current) {
        return;
      }
      loadedResultRef.current = true;

      try {
        const resultResponse = await fetch(`/api/v1/classroom/${encodeURIComponent(id)}/result`);
        if (!resultResponse.ok) {
          loadedResultRef.current = false;

          if (resultResponse.status === 409) {
            updateProgress({
              status: "running",
              summary: progressRef.current.summary || "课堂内容仍在生成中…",
            });
            if (!disposed) {
              setState({ status: "pending" });
            }
            return;
          }

          throw new Error(await readErrorMessage(resultResponse, "课堂任务结果获取失败。"));
        }

        const lesson = (await resultResponse.json()) as LessonResult;
        if (eventSource) {
          eventSource.close();
        }
        if (!disposed) {
          setState({ status: "ready", lesson });
        }
      } catch (error) {
        loadedResultRef.current = false;
        if (!disposed) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "课堂播放页加载失败。",
          });
        }
      }
    };

    const handleProgressEvent = (event: ClassroomGenerationEvent) => {
      if (seenEventIndexes.has(event.index)) {
        return;
      }
      seenEventIndexes.add(event.index);

      const nextSummary = event.summary?.trim() || null;
      const topicFromEvent = getString(event.data?.topic);
      const errorFromEvent = getString(event.data?.error);

      setProgress((current) => ({
        ...current,
        topic: topicFromEvent ?? current.topic,
        status: event.run_status,
        summary: nextSummary ?? current.summary,
        error: errorFromEvent ?? current.error,
        events: [...current.events, event],
      }));

      setState((current) => (current.status === "ready" || current.status === "error" ? current : { status: "pending" }));

      if (
        event.event === "workflow_failed" ||
        event.event === "voice_failed" ||
        event.event === "node_failed" ||
        event.run_status === "failed"
      ) {
        failLesson(errorFromEvent || nextSummary || "课堂任务生成失败。", errorFromEvent || nextSummary);
        return;
      }

      if (event.event === "workflow_completed" || event.run_status === "succeeded") {
        void loadResult();
      }
    };

    const connectEvents = () => {
      eventSource = new EventSource(
        `/api/v1/classroom/${encodeURIComponent(id)}/events?after_id=-1&heartbeat_seconds=5`,
      );

      const handleStreamMessage = (messageEvent: MessageEvent<string>) => {
        const parsedEvent = parseClassroomEvent(messageEvent.data);
        if (parsedEvent) {
          handleProgressEvent(parsedEvent);
          return;
        }

        try {
          const payload = JSON.parse(messageEvent.data) as unknown;
          if (!isRecord(payload)) {
            return;
          }

          updateProgress({
            status: (getString(payload.run_status) as ClassroomRunStatus | null) ?? progressRef.current.status,
            summary: progressRef.current.summary,
          });
        } catch {
          return;
        }
      };

      CLASSROOM_STREAM_EVENTS.forEach((eventType) => {
        eventSource?.addEventListener(eventType, handleStreamMessage as EventListener);
      });

      eventSource.onerror = () => {
        if (disposed) {
          return;
        }

        setState((current) => (current.status === "ready" || current.status === "error" ? current : { status: "pending" }));
        setProgress((current) => ({
          ...current,
          summary: current.summary || "连接课堂进度流时发生波动，正在自动重连…",
        }));
      };
    };

    const loadSnapshot = async () => {
      try {
        const statusResponse = await fetch(`/api/v1/classroom/${encodeURIComponent(id)}`);
        if (!statusResponse.ok) {
          throw new Error(await readErrorMessage(statusResponse, "课堂任务状态查询失败。"));
        }

        const snapshot = (await statusResponse.json()) as ClassroomRunSnapshot;
        setSourcePrepRunId(snapshot.request?.source_prep_run_id?.trim() || null);
        updateProgress({
          topic: snapshot.request?.topic?.trim() || null,
          status: snapshot.status,
          summary: snapshot.latest_summary?.trim() || "课堂内容仍在生成中…",
          error: snapshot.error?.trim() || null,
        });

        if (snapshot.status === "failed") {
          failLesson(snapshot.error?.trim() || "课堂任务生成失败，请查看后端日志。", snapshot.error);
          return;
        }

        if (snapshot.status === "succeeded") {
          await loadResult();
          return;
        }

        if (!disposed) {
          setState({ status: "pending" });
        }
        connectEvents();
      } catch (error) {
        if (!disposed) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "课堂播放页加载失败。",
          });
        }
      }
    };

    void loadSnapshot();

    return () => {
      disposed = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [id]);

  if (state.status !== "ready") {
    if (state.status !== "error") {
      return (
        <GenerationDashboard
          topic={progress.topic}
          status={progress.status}
          summary={progress.summary}
          events={progress.events}
        />
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
        <Card className="w-full max-w-2xl border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/50">
          <CardHeader>
            <CardTitle className="text-2xl text-slate-900 tracking-tight">
              {state.status === "error" ? "课堂播放器暂时打不开" : "课堂播放器准备中"}
            </CardTitle>
            <CardDescription className="text-slate-500">
              这里会直接打开生成好的课堂演示与语音播放。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700">
              {state.message || progress.error || progress.summary || "课堂播放页加载失败。"}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-50">
                <Link
                  to={
                    sourcePrepRunId
                      ? `/study/${encodeURIComponent(sourcePrepRunId)}?tab=prep-classroom`
                      : "/"
                  }
                >
                  回到课前准备
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <LessonPlayerProvider lesson={state.lesson} runId={id ?? ""}>
      <LessonPlayerShell sourcePrepRunId={sourcePrepRunId} />
    </LessonPlayerProvider>
  );
}
