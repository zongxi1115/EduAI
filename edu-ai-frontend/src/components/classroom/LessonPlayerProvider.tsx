import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface LessonReveal {
  narration: string;
  on_slide?: string | null;
  audio_src?: string | null;
}

export interface LessonQuizPayload {
  type: "fill" | "choice";
  question: string;
  ans: string;
  options?: string[];
}

export interface LessonQuiz {
  after_reveal_idx: number;
  payload: LessonQuizPayload;
  false_intro?: string | null;
  false_intro_audio_src?: string | null;
}

export interface LessonPageSpec {
  idx: number;
  reveals: LessonReveal[];
  quizzes: LessonQuiz[];
  on_slide_summary: string;
}

export interface LessonBundlePage {
  idx: number;
  html: string;
  reveals: Array<{
    narration: string;
    audio_src?: string | null;
  }>;
  quizzes: LessonQuiz[];
}

export interface LessonBlueprint {
  idx: number;
  theme: string;
  objective: string;
  key_points: string[];
  target_reveal_count: number;
  quiz_goal?: string | null;
}

export interface LessonResult {
  topic: string;
  script: string;
  page_count: number;
  pages: LessonPageSpec[];
  page_blueprints: LessonBlueprint[];
  bundle: {
    pages: LessonBundlePage[];
  };
}

export interface ResolvedLessonPage {
  idx: number;
  theme: string;
  objective: string;
  html: string;
  reveals: LessonReveal[];
  quizzes: LessonQuiz[];
  onSlideSummary: string;
}

type PlayerPhase = "idle" | "narrating" | "question" | "feedback" | "ended";

type ActiveMedia =
  | {
      kind: "reveal";
      text: string;
      audioUrl: string | null;
      autoAdvance: true;
    }
  | {
      kind: "feedback";
      text: string;
      audioUrl: string | null;
      autoAdvance: false;
    };

interface LessonPlayerContextValue {
  lesson: LessonResult;
  pages: ResolvedLessonPage[];
  currentPage: ResolvedLessonPage;
  currentPageIndex: number;
  currentRevealIndex: number;
  currentReveal: LessonReveal | null;
  currentTheme: string;
  activeQuiz: LessonQuiz | null;
  activeMedia: ActiveMedia | null;
  phase: PlayerPhase;
  hasStarted: boolean;
  isPlaying: boolean;
  isEnded: boolean;
  quizError: string | null;
  bindStageFrame: (node: HTMLIFrameElement | null) => void;
  handleStageReady: () => void;
  startLesson: () => void;
  replayCurrentStep: () => void;
  advanceManually: () => void;
  restartLesson: () => void;
  submitQuizAnswer: (answer: string) => void;
  retryQuiz: () => void;
  skipQuiz: () => void;
  totalReveals: number;
  completedReveals: number;
}

const LessonPlayerContext = createContext<LessonPlayerContextValue | null>(null);

const PAGE_SWITCH_DELAY_MS = 220;
const REVEAL_SWITCH_DELAY_MS = 320;

function normalizeAnswer(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function estimateFallbackDuration(text: string) {
  return Math.min(12000, Math.max(1800, text.replace(/\s+/g, "").length * 240));
}

function buildClassroomFileUrl(runId: string, relativePath: string | null | undefined) {
  if (!relativePath) {
    return null;
  }
  return `/api/v1/classroom/${encodeURIComponent(runId)}/files/${relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function mergeLessonPages(lesson: LessonResult): ResolvedLessonPage[] {
  const htmlByIdx = new Map<number, LessonBundlePage>();
  lesson.bundle.pages.forEach((page) => {
    htmlByIdx.set(page.idx, page);
  });

  const blueprintByIdx = new Map<number, LessonBlueprint>();
  lesson.page_blueprints.forEach((page) => {
    blueprintByIdx.set(page.idx, page);
  });

  const mergedPages = lesson.pages.map<ResolvedLessonPage | null>((page) => {
      const bundlePage = htmlByIdx.get(page.idx);
      if (!bundlePage) {
        return null;
      }

      const reveals = page.reveals.map((reveal, revealIdx) => ({
        ...reveal,
        audio_src: reveal.audio_src ?? bundlePage.reveals[revealIdx]?.audio_src ?? null,
      }));
      const blueprint = blueprintByIdx.get(page.idx);

      return {
        idx: page.idx,
        theme: blueprint?.theme?.trim() || `第 ${page.idx + 1} 页`,
        objective: blueprint?.objective?.trim() || "",
        html: bundlePage.html,
        reveals,
        quizzes: page.quizzes,
        onSlideSummary: page.on_slide_summary,
      };
    });

  return mergedPages.filter(
    (page): page is ResolvedLessonPage => page !== null
  );
}

export function LessonPlayerProvider({
  lesson,
  runId,
  children,
}: {
  lesson: LessonResult;
  runId: string;
  children: ReactNode;
}) {
  const pages = useMemo(() => mergeLessonPages(lesson), [lesson]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [phase, setPhase] = useState<PlayerPhase>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);
  const [activeQuizQueue, setActiveQuizQueue] = useState<LessonQuiz[]>([]);
  const [activeQuizIndex, setActiveQuizIndex] = useState(0);
  const [quizError, setQuizError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const awaitingStageLoadRef = useRef(false);

  const currentPage = pages[currentPageIndex] ?? pages[0];
  const currentReveal = currentPage?.reveals[currentRevealIndex] ?? null;
  const activeQuiz = activeQuizQueue[activeQuizIndex] ?? null;
  const isEnded = phase === "ended";
  const totalReveals = useMemo(
    () => pages.reduce((sum, page) => sum + page.reveals.length, 0),
    [pages]
  );
  const completedReveals = useMemo(
    () =>
      pages
        .slice(0, currentPageIndex)
        .reduce((sum, page) => sum + page.reveals.length, 0) + currentRevealIndex,
    [currentPageIndex, currentRevealIndex, pages]
  );

  const clearPlayback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setIsPlaying(false);
  }, []);

  const advanceAfterReveal = useCallback((options?: { skipQuizCheck?: boolean }) => {
    const skipQuizCheck = options?.skipQuizCheck ?? false;
    const page = pages[currentPageIndex];
    if (!page) {
      setPhase("ended");
      return;
    }

    if (!skipQuizCheck) {
      const queuedQuizzes = page.quizzes.filter(
        (quiz) => quiz.after_reveal_idx === currentRevealIndex
      );
      if (queuedQuizzes.length > 0) {
        setActiveQuizQueue(queuedQuizzes);
        setActiveQuizIndex(0);
        setQuizError(null);
        setPhase("question");
        setIsPlaying(false);
        return;
      }
    }

    if (currentRevealIndex < page.reveals.length - 1) {
      try {
        (
          frameRef.current?.contentWindow as (Window & {
            to_next?: () => boolean;
          }) | null
        )?.to_next?.();
      } catch (error) {
        console.warn("Failed to advance embedded lesson card.", error);
      }

      const nextRevealIndex = currentRevealIndex + 1;
      setCurrentRevealIndex(nextRevealIndex);
      setActiveMedia(null);
      setPhase("narrating");
      window.setTimeout(() => {
        const nextReveal = pages[currentPageIndex]?.reveals[nextRevealIndex];
        if (!nextReveal) {
          return;
        }
        setActiveMedia({
          kind: "reveal",
          text: nextReveal.narration,
          audioUrl: buildClassroomFileUrl(runId, nextReveal.audio_src),
          autoAdvance: true,
        });
      }, REVEAL_SWITCH_DELAY_MS);
      return;
    }

    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex((value) => value + 1);
      setCurrentRevealIndex(0);
      setActiveMedia(null);
      setActiveQuizQueue([]);
      setActiveQuizIndex(0);
      setQuizError(null);
      setIsPlaying(false);
      setPhase("narrating");
      awaitingStageLoadRef.current = true;
      return;
    }

    setActiveMedia(null);
    setActiveQuizQueue([]);
    setActiveQuizIndex(0);
    setQuizError(null);
    setIsPlaying(false);
    setPhase("ended");
  }, [currentPageIndex, currentRevealIndex, pages, runId]);

  const playReveal = useCallback(
    (pageIndex: number, revealIndex: number) => {
      const reveal = pages[pageIndex]?.reveals[revealIndex];
      if (!reveal) {
        return;
      }

      setActiveQuizQueue([]);
      setActiveQuizIndex(0);
      setQuizError(null);
      setPhase("narrating");
      setActiveMedia({
        kind: "reveal",
        text: reveal.narration,
        audioUrl: buildClassroomFileUrl(runId, reveal.audio_src),
        autoAdvance: true,
      });
    },
    [pages, runId]
  );

  const startLesson = useCallback(() => {
    if (!pages.length) {
      return;
    }

    setHasStarted(true);
    setQuizError(null);

    const isFrameReady =
      frameRef.current?.contentDocument?.readyState === "complete" ||
      frameRef.current?.contentWindow?.document?.readyState === "complete";

    if (!isFrameReady) {
      awaitingStageLoadRef.current = true;
      setPhase("narrating");
      return;
    }

    playReveal(currentPageIndex, currentRevealIndex);
  }, [currentPageIndex, currentRevealIndex, pages.length, playReveal]);

  const replayCurrentStep = useCallback(() => {
    if (!hasStarted) {
      startLesson();
      return;
    }

    if (phase === "feedback" && activeQuiz?.false_intro) {
      setActiveMedia({
        kind: "feedback",
        text: activeQuiz.false_intro,
        audioUrl: buildClassroomFileUrl(runId, activeQuiz.false_intro_audio_src),
        autoAdvance: false,
      });
      return;
    }

    playReveal(currentPageIndex, currentRevealIndex);
  }, [
    activeQuiz,
    currentPageIndex,
    currentRevealIndex,
    hasStarted,
    phase,
    playReveal,
    runId,
    startLesson,
  ]);

  const handleStageReady = useCallback(() => {
    if (!awaitingStageLoadRef.current || !hasStarted) {
      return;
    }

    awaitingStageLoadRef.current = false;
    window.setTimeout(() => {
      playReveal(currentPageIndex, currentRevealIndex);
    }, PAGE_SWITCH_DELAY_MS);
  }, [currentPageIndex, currentRevealIndex, hasStarted, playReveal]);

  const restartLesson = useCallback(() => {
    clearPlayback();
    awaitingStageLoadRef.current = true;
    setHasStarted(false);
    setCurrentPageIndex(0);
    setCurrentRevealIndex(0);
    setActiveMedia(null);
    setActiveQuizQueue([]);
    setActiveQuizIndex(0);
    setQuizError(null);
    setPhase("idle");
  }, [clearPlayback]);

  const moveToNextQuizOrContinue = useCallback(() => {
    if (activeQuizIndex < activeQuizQueue.length - 1) {
      setActiveQuizIndex((value) => value + 1);
      setQuizError(null);
      setPhase("question");
      return;
    }

    setActiveQuizQueue([]);
    setActiveQuizIndex(0);
    setQuizError(null);
    advanceAfterReveal({ skipQuizCheck: true });
  }, [activeQuizIndex, activeQuizQueue.length, advanceAfterReveal]);

  const submitQuizAnswer = useCallback(
    (answer: string) => {
      if (!activeQuiz) {
        return;
      }

      const expected = activeQuiz.payload.ans ?? "";
      const isCorrect = normalizeAnswer(answer) === normalizeAnswer(expected);
      if (isCorrect) {
        clearPlayback();
        moveToNextQuizOrContinue();
        return;
      }

      if (activeQuiz.false_intro?.trim()) {
        setQuizError("这次还不对，我们先补充一下思路。");
        setPhase("feedback");
        setActiveMedia({
          kind: "feedback",
          text: activeQuiz.false_intro,
          audioUrl: buildClassroomFileUrl(runId, activeQuiz.false_intro_audio_src),
          autoAdvance: false,
        });
        return;
      }

      setQuizError("答案还不对，再想一想。");
      setPhase("question");
    },
    [activeQuiz, clearPlayback, moveToNextQuizOrContinue, runId]
  );

  const retryQuiz = useCallback(() => {
    setQuizError(null);
    setPhase("question");
  }, []);

  const skipQuiz = useCallback(() => {
    clearPlayback();
    moveToNextQuizOrContinue();
  }, [clearPlayback, moveToNextQuizOrContinue]);

  const advanceManually = useCallback(() => {
    clearPlayback();

    if (!hasStarted) {
      startLesson();
      return;
    }

    if (phase === "question" || phase === "feedback") {
      skipQuiz();
      return;
    }

    advanceAfterReveal();
  }, [advanceAfterReveal, clearPlayback, hasStarted, phase, skipQuiz, startLesson]);

  const bindStageFrame = useCallback((node: HTMLIFrameElement | null) => {
    frameRef.current = node;
  }, []);

  useEffect(() => {
    return () => {
      clearPlayback();
    };
  }, [clearPlayback]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    clearPlayback();

    if (!activeMedia) {
      return;
    }

    const finishPlayback = () => {
      setIsPlaying(false);
      if (activeMedia.autoAdvance) {
        advanceAfterReveal();
      }
    };

    const scheduleFallback = () => {
      fallbackTimerRef.current = window.setTimeout(
        finishPlayback,
        estimateFallbackDuration(activeMedia.text)
      );
      setIsPlaying(true);
    };

    const handleEnded = () => {
      finishPlayback();
    };

    const handleError = () => {
      audio.pause();
      scheduleFallback();
    };

    audio.onended = handleEnded;
    audio.onerror = handleError;

    if (!activeMedia.audioUrl) {
      scheduleFallback();
      return;
    }

    audio.src = activeMedia.audioUrl;
    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch(() => {
        scheduleFallback();
      });

    return () => {
      audio.onended = null;
      audio.onerror = null;
    };
  }, [activeMedia, advanceAfterReveal, clearPlayback]);

  const contextValue = useMemo<LessonPlayerContextValue>(() => {
    return {
      lesson,
      pages,
      currentPage,
      currentPageIndex,
      currentRevealIndex,
      currentReveal,
      currentTheme: currentPage?.theme || lesson.topic,
      activeQuiz,
      activeMedia,
      phase,
      hasStarted,
      isPlaying,
      isEnded,
      quizError,
      bindStageFrame,
      handleStageReady,
      startLesson,
      replayCurrentStep,
      advanceManually,
      restartLesson,
      submitQuizAnswer,
      retryQuiz,
      skipQuiz,
      totalReveals,
      completedReveals,
    };
  }, [
    activeMedia,
    activeQuiz,
    bindStageFrame,
    currentPage,
    currentPageIndex,
    currentReveal,
    currentRevealIndex,
    handleStageReady,
    hasStarted,
    isEnded,
    isPlaying,
    lesson,
    pages,
    phase,
    quizError,
    replayCurrentStep,
    restartLesson,
    startLesson,
    submitQuizAnswer,
    retryQuiz,
    skipQuiz,
    advanceManually,
    totalReveals,
    completedReveals,
  ]);

  return (
    <LessonPlayerContext.Provider value={contextValue}>
      {children}
      <audio ref={audioRef} preload="auto" hidden />
    </LessonPlayerContext.Provider>
  );
}

export function useLessonPlayer() {
  const context = useContext(LessonPlayerContext);
  if (!context) {
    throw new Error("useLessonPlayer must be used within LessonPlayerProvider.");
  }
  return context;
}
