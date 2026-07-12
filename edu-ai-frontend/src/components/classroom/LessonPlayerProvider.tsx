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
import katex from "katex";
import katexCssUrl from "katex/dist/katex.min.css?url";
import { apiUrl } from "@/lib/api";

export interface LessonReveal {
  narration: string;
  on_slide?: string | null;
  audio_src?: string | null;
  pause?: boolean;
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
  srcDoc: string;
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
      startAtMs: number;
    }
  | {
      kind: "feedback";
      text: string;
      audioUrl: string | null;
      autoAdvance: false;
      startAtMs: number;
    };

export interface LessonTimelineSegment {
  id: string;
  pageIndex: number;
  revealIndex: number;
  text: string;
  audioUrl: string | null;
  fallbackDurationMs: number;
  durationMs: number;
  startMs: number;
  endMs: number;
}

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
  timelineSegments: LessonTimelineSegment[];
  timelineDurationMs: number;
  timelineElapsedMs: number;
  currentSegmentDurationMs: number;
  currentSegmentElapsedMs: number;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  stageRenderNonce: number;
  seekToTime: (timeMs: number) => void;
  seekBy: (offsetMs: number) => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  togglePlayback: () => void;
}

const LessonPlayerContext = createContext<LessonPlayerContextValue | null>(null);

const PAGE_SWITCH_DELAY_MS = 220;
const REVEAL_SWITCH_DELAY_MS = 320;
const MIN_SEEK_SAFETY_MS = 48;
const INLINE_QUIZZES_ENABLED = true;

function normalizeAnswer(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLessonText(text: string | null | undefined) {
  if (!text) {
    return "";
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function estimateFallbackDuration(text: string) {
  return Math.min(12000, Math.max(1800, text.replace(/\s+/g, "").length * 240));
}

function clampPlaybackRate(rate: number) {
  if (!Number.isFinite(rate)) {
    return 1;
  }

  return Math.min(2, Math.max(0.5, Number(rate.toFixed(2))));
}

type MathSegment =
  | { kind: "text"; content: string }
  | { kind: "math"; content: string; displayMode: boolean };

const INLINE_MATH_PATTERN =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

const SKIP_MATH_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE", "CODE", "NOSCRIPT"]);

function buildClassroomFileUrl(runId: string, relativePath: string | null | undefined) {
  if (!relativePath) {
    return null;
  }
  return apiUrl(`/api/v1/classroom/${encodeURIComponent(runId)}/files/${relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`);
}

function hasMathSyntax(text: string) {
  return /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/.test(text);
}

function splitMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_MATH_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ kind: "text", content: text.slice(lastIndex, matchIndex) });
    }

    const displayBlock = match[1];
    const bracketBlock = match[2];
    const parenInline = match[3];
    const dollarInline = match[4];
    const mathContent = displayBlock ?? bracketBlock ?? parenInline ?? dollarInline ?? "";
    const displayMode = displayBlock !== undefined || bracketBlock !== undefined;
    segments.push({ kind: "math", content: mathContent, displayMode });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", content: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ kind: "text", content: text }];
}

function renderMathInHtml(html: string) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined" || !hasMathSyntax(html)) {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    const parentElement = textNode.parentElement;
    if (
      parentElement &&
      !SKIP_MATH_TAGS.has(parentElement.tagName) &&
      hasMathSyntax(textNode.textContent ?? "")
    ) {
      textNodes.push(textNode);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const rawText = textNode.textContent ?? "";
    const segments = splitMathSegments(rawText);
    if (segments.length === 1 && segments[0]?.kind === "text") {
      continue;
    }

    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (segment.kind === "text") {
        if (segment.content) {
          fragment.appendChild(doc.createTextNode(segment.content));
        }
        continue;
      }

      const wrapper = doc.createElement("span");
      try {
        wrapper.innerHTML = katex.renderToString(segment.content, {
          displayMode: segment.displayMode,
          throwOnError: false,
          strict: "ignore",
        });
      } catch {
        wrapper.textContent = segment.displayMode
          ? `$$${segment.content}$$`
          : `$${segment.content}$`;
      }
      while (wrapper.firstChild) {
        fragment.appendChild(wrapper.firstChild);
      }
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return doc.body.innerHTML;
}

function rewritePrepMediaPaths(html: string, runId: string): string {
  const prefix = apiUrl(`/api/v1/classroom/${encodeURIComponent(runId)}/files/`);
  return html.replace(
    /((?:src|href)\s*=\s*["'])prep_media\//g,
    `$1${prefix}prep_media/`
  );
}

function buildLessonStageDocument(sectionHtml: string, runId?: string) {
  let renderedSection = renderMathInHtml(sectionHtml);
  if (runId) {
    renderedSection = rewritePrepMediaPaths(renderedSection, runId);
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${katexCssUrl}" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        min-height: 100%;
        background: transparent;
      }
      html {
        height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
      }
      body {
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      body > section.card {
        width: 100%;
        min-height: 100%;
      }
    </style>
    <script>
      const eduLessonNormalizeText = (text) => String(text || "").replace(/\\s+/g, " ").trim();
      const eduLessonIgnoredTags = new Set(["BUTTON", "INPUT", "MATH-FIELD", "SELECT", "TEXTAREA"]);

      function eduLessonClosestContext(node) {
        let element = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        while (element) {
          if (["ARTICLE", "BLOCKQUOTE", "DIV", "LI", "MAIN", "P", "SECTION", "TD", "TH"].includes(element.tagName)) {
            const text = eduLessonNormalizeText(element.textContent);
            if (text) {
              return text.slice(0, 900);
            }
          }
          element = element.parentElement;
        }
        return "";
      }

      function eduLessonPostSelection() {
        try {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) {
            window.parent.postMessage({ source: "edu-lesson-stage", type: "lesson-stage-selection-clear" }, "*");
            return;
          }

          const anchorElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection.anchorNode?.parentElement;
          if (anchorElement?.closest(Array.from(eduLessonIgnoredTags).join(","))) {
            return;
          }

          const text = eduLessonNormalizeText(selection.toString());
          if (!text) {
            window.parent.postMessage({ source: "edu-lesson-stage", type: "lesson-stage-selection-clear" }, "*");
            return;
          }

          const range = selection.getRangeAt(0);
          const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0) || range.getBoundingClientRect();
          if (!rect || (rect.width <= 0 && rect.height <= 0)) {
            return;
          }

          window.parent.postMessage({
            source: "edu-lesson-stage",
            type: "lesson-stage-selection",
            selection: text,
            context: eduLessonClosestContext(range.commonAncestorContainer) || text,
            rect: {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            },
          }, "*");
        } catch {}
      }

      document.addEventListener("selectionchange", () => window.setTimeout(eduLessonPostSelection, 80));
      window.addEventListener("pointerup", () => window.setTimeout(eduLessonPostSelection, 40), true);
      window.addEventListener("dblclick", () => {
        try {
          window.parent.postMessage({ source: "edu-lesson-stage", type: "lesson-stage-dblclick" }, "*");
        } catch {}
      });
    </script>
  </head>
  <body>
    ${renderedSection}
  </body>
</html>`;
}

function mergeLessonPages(lesson: LessonResult, runId?: string): ResolvedLessonPage[] {
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
        narration: normalizeLessonText(reveal.narration),
        on_slide: normalizeLessonText(reveal.on_slide),
        audio_src: reveal.audio_src ?? bundlePage.reveals[revealIdx]?.audio_src ?? null,
      }));
      const quizzes = page.quizzes.map((quiz) => ({
        ...quiz,
        payload: {
          ...quiz.payload,
          question: normalizeLessonText(quiz.payload.question),
          ans: normalizeLessonText(quiz.payload.ans),
          options: quiz.payload.options?.map((option) => normalizeLessonText(option)),
        },
        false_intro: normalizeLessonText(quiz.false_intro),
      }));
      const blueprint = blueprintByIdx.get(page.idx);

      return {
        idx: page.idx,
        theme: normalizeLessonText(blueprint?.theme) || `第 ${page.idx + 1} 页`,
        objective: normalizeLessonText(blueprint?.objective),
        html: bundlePage.html,
        srcDoc: buildLessonStageDocument(bundlePage.html, runId),
        reveals,
        quizzes,
        onSlideSummary: normalizeLessonText(page.on_slide_summary),
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
  const pages = useMemo(() => mergeLessonPages(lesson, runId), [lesson, runId]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [phase, setPhase] = useState<PlayerPhase>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);
  const [activeQuizQueue, setActiveQuizQueue] = useState<LessonQuiz[]>([]);
  const [activeQuizIndex, setActiveQuizIndex] = useState(0);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [stageRenderNonce, setStageRenderNonce] = useState(0);
  const [durationBySegmentId, setDurationBySegmentId] = useState<Record<string, number>>({});
  const [currentSegmentElapsedMs, setCurrentSegmentElapsedMs] = useState(0);
  const [activePlaybackDurationMs, setActivePlaybackDurationMs] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const playbackStartedAtRef = useRef<number | null>(null);
  const playbackRateRef = useRef(1);
  const pendingSeekRef = useRef<{
    pageIndex: number;
    revealIndex: number;
    offsetMs: number;
  } | null>(null);
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
  const timelineSegments = useMemo(() => {
    const baseSegments = pages.flatMap<LessonTimelineSegment>((page, pageIndex) =>
      page.reveals.map((reveal, revealIndex) => {
        const text = normalizeLessonText(reveal.narration);
        const audioUrl = buildClassroomFileUrl(runId, reveal.audio_src);
        const fallbackDurationMs = estimateFallbackDuration(text);

        return {
          id: `${page.idx}:${revealIndex}`,
          pageIndex,
          revealIndex,
          text,
          audioUrl,
          fallbackDurationMs,
          durationMs: fallbackDurationMs,
          startMs: 0,
          endMs: 0,
        };
      })
    );

    let elapsedMs = 0;
    return baseSegments.map((segment) => {
      const durationMs = durationBySegmentId[segment.id] ?? segment.fallbackDurationMs;
      const nextSegment = {
        ...segment,
        durationMs,
        startMs: elapsedMs,
        endMs: elapsedMs + durationMs,
      };
      elapsedMs += durationMs;
      return nextSegment;
    });
  }, [durationBySegmentId, pages, runId]);
  const timelineDurationMs = timelineSegments.at(-1)?.endMs ?? 0;
  const currentTimelineSegment = useMemo(
    () =>
      timelineSegments.find(
        (segment) =>
          segment.pageIndex === currentPageIndex && segment.revealIndex === currentRevealIndex
      ) ?? null,
    [currentPageIndex, currentRevealIndex, timelineSegments]
  );
  const currentSegmentDurationMs = currentTimelineSegment?.durationMs ?? activePlaybackDurationMs;
  const timelineElapsedMs = useMemo(() => {
    if (isEnded) {
      return timelineDurationMs;
    }

    if (!currentTimelineSegment) {
      return 0;
    }

    if (phase === "question" || phase === "feedback") {
      return currentTimelineSegment.endMs;
    }

    if (phase === "narrating" && activeMedia?.kind === "reveal") {
      return Math.min(
        currentTimelineSegment.endMs,
        currentTimelineSegment.startMs + currentSegmentElapsedMs
      );
    }

    return currentTimelineSegment.startMs;
  }, [activeMedia, currentSegmentElapsedMs, currentTimelineSegment, isEnded, phase, timelineDurationMs]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.defaultPlaybackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    timelineSegments.forEach((segment) => {
      if (durationBySegmentId[segment.id]) {
        return;
      }

      if (!segment.audioUrl) {
        setDurationBySegmentId((current) => {
          if (current[segment.id]) {
            return current;
          }
          return {
            ...current,
            [segment.id]: segment.fallbackDurationMs,
          };
        });
        return;
      }

      const metadataAudio = new Audio();
      metadataAudio.preload = "metadata";

      const finalize = (nextDurationMs: number) => {
        if (disposed) {
          return;
        }

        setDurationBySegmentId((current) => {
          if (current[segment.id] === nextDurationMs) {
            return current;
          }
          return {
            ...current,
            [segment.id]: nextDurationMs,
          };
        });
      };

      const handleLoadedMetadata = () => {
        const durationMs = Number.isFinite(metadataAudio.duration) && metadataAudio.duration > 0
          ? Math.round(metadataAudio.duration * 1000)
          : segment.fallbackDurationMs;
        finalize(durationMs);
      };

      const handleError = () => {
        finalize(segment.fallbackDurationMs);
      };

      metadataAudio.addEventListener("loadedmetadata", handleLoadedMetadata);
      metadataAudio.addEventListener("error", handleError);
      metadataAudio.src = segment.audioUrl;

      cleanups.push(() => {
        metadataAudio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        metadataAudio.removeEventListener("error", handleError);
        metadataAudio.src = "";
      });
    });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [durationBySegmentId, timelineSegments]);

  const clearPlayback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    playbackStartedAtRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    setCurrentSegmentElapsedMs(0);
    setActivePlaybackDurationMs(0);
    setIsPlaying(false);
  }, []);

  const syncStageToReveal = useCallback((revealIndex: number) => {
    if (revealIndex <= 0) {
      return;
    }

    try {
      const stageWindow = frameRef.current?.contentWindow as (Window & {
        to_next?: () => boolean;
      }) | null;

      for (let step = 0; step < revealIndex; step += 1) {
        const advanced = stageWindow?.to_next?.();
        if (advanced === false) {
          break;
        }
      }
    } catch (error) {
      console.warn("Failed to sync embedded lesson card.", error);
    }
  }, []);

  const isStageReady = useCallback(() => {
    try {
      return (
        frameRef.current?.contentDocument?.readyState === "complete" ||
        frameRef.current?.contentWindow?.document?.readyState === "complete"
      );
    } catch {
      return false;
    }
  }, []);

  const queueSeek = useCallback((targetSegment: LessonTimelineSegment, offsetMs: number) => {
    pendingSeekRef.current = {
      pageIndex: targetSegment.pageIndex,
      revealIndex: targetSegment.revealIndex,
      offsetMs,
    };
    awaitingStageLoadRef.current = true;
    setHasStarted(true);
    setCurrentPageIndex(targetSegment.pageIndex);
    setCurrentRevealIndex(targetSegment.revealIndex);
    setActiveMedia(null);
    setActiveQuizQueue([]);
    setActiveQuizIndex(0);
    setQuizError(null);
    setPhase("narrating");
  }, []);

  const advanceAfterReveal = useCallback((options?: { skipQuizCheck?: boolean }) => {
    const skipQuizCheck = options?.skipQuizCheck ?? false;
    const page = pages[currentPageIndex];
    if (!page) {
      setPhase("ended");
      return;
    }

    if (INLINE_QUIZZES_ENABLED && !skipQuizCheck) {
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

    // Pause point: if the current reveal has pause=true, stop and let the student
    // observe the slide content manually until they choose to continue.
    const currentReveal = page.reveals[currentRevealIndex];
    if (currentReveal?.pause) {
      setIsPlaying(false);
      return;
    }

    if (currentRevealIndex < page.reveals.length - 1) {
      syncStageToReveal(1);

      const nextRevealIndex = currentRevealIndex + 1;
      setCurrentRevealIndex(nextRevealIndex);
      setActiveMedia(null);
      setPhase("narrating");
      window.setTimeout(() => {
        const nextReveal = pages[currentPageIndex]?.reveals[nextRevealIndex];
        if (!nextReveal) {
          return;
        }

        const nextSegment = timelineSegments.find(
          (segment) =>
            segment.pageIndex === currentPageIndex && segment.revealIndex === nextRevealIndex
        );
        const startAtMs = 0;

        setCurrentSegmentElapsedMs(startAtMs);
        setActivePlaybackDurationMs(
          nextSegment?.durationMs ?? estimateFallbackDuration(nextReveal.narration)
        );
        setActiveMedia({
          kind: "reveal",
          text: normalizeLessonText(nextReveal.narration),
          audioUrl: buildClassroomFileUrl(runId, nextReveal.audio_src),
          autoAdvance: true,
          startAtMs,
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
  }, [currentPageIndex, currentRevealIndex, pages, syncStageToReveal, timelineSegments, runId]);

  const playReveal = useCallback(
    (pageIndex: number, revealIndex: number, options?: { startAtMs?: number }) => {
      const reveal = pages[pageIndex]?.reveals[revealIndex];
      if (!reveal) {
        return;
      }

      const startAtMs = Math.max(0, options?.startAtMs ?? 0);
      const revealTimelineSegment =
        timelineSegments.find(
          (segment) => segment.pageIndex === pageIndex && segment.revealIndex === revealIndex
        ) ?? null;

      setActiveQuizQueue([]);
      setActiveQuizIndex(0);
      setQuizError(null);
      setPhase("narrating");
      setCurrentSegmentElapsedMs(startAtMs);
      setActivePlaybackDurationMs(
        revealTimelineSegment?.durationMs ?? estimateFallbackDuration(reveal.narration)
      );
      setActiveMedia({
        kind: "reveal",
        text: normalizeLessonText(reveal.narration),
        audioUrl: buildClassroomFileUrl(runId, reveal.audio_src),
        autoAdvance: true,
        startAtMs,
      });
    },
    [pages, runId, timelineSegments]
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
      const feedbackText = normalizeLessonText(activeQuiz.false_intro);
      setCurrentSegmentElapsedMs(0);
      setActivePlaybackDurationMs(estimateFallbackDuration(feedbackText));
      setActiveMedia({
        kind: "feedback",
        text: feedbackText,
        audioUrl: buildClassroomFileUrl(runId, activeQuiz.false_intro_audio_src),
        autoAdvance: false,
        startAtMs: 0,
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
      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek && pendingSeek.pageIndex === currentPageIndex) {
        syncStageToReveal(pendingSeek.revealIndex);
        playReveal(currentPageIndex, pendingSeek.revealIndex, {
          startAtMs: pendingSeek.offsetMs,
        });
        pendingSeekRef.current = null;
        return;
      }

      playReveal(currentPageIndex, currentRevealIndex);
    }, PAGE_SWITCH_DELAY_MS);
  }, [currentPageIndex, currentRevealIndex, hasStarted, playReveal, syncStageToReveal]);

  const restartLesson = useCallback(() => {
    clearPlayback();
    awaitingStageLoadRef.current = true;
    pendingSeekRef.current = null;
    setHasStarted(false);
    setCurrentPageIndex(0);
    setCurrentRevealIndex(0);
    setActiveMedia(null);
    setActiveQuizQueue([]);
    setActiveQuizIndex(0);
    setQuizError(null);
    setPhase("idle");
    setStageRenderNonce((value) => value + 1);
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
        const feedbackText = normalizeLessonText(activeQuiz.false_intro);
        setQuizError("这次还不对，我们先补充一下思路。");
        setPhase("feedback");
        setCurrentSegmentElapsedMs(0);
        setActivePlaybackDurationMs(estimateFallbackDuration(feedbackText));
        setActiveMedia({
          kind: "feedback",
          text: feedbackText,
          audioUrl: buildClassroomFileUrl(runId, activeQuiz.false_intro_audio_src),
          autoAdvance: false,
          startAtMs: 0,
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

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const clampedRate = clampPlaybackRate(rate);
      setPlaybackRateState((currentRate) => (currentRate === clampedRate ? currentRate : clampedRate));

      const audio = audioRef.current;
      if (audio) {
        audio.playbackRate = clampedRate;
        audio.defaultPlaybackRate = clampedRate;
      }

      if (!activeMedia || !isPlaying) {
        return;
      }

      const nextElapsedMs =
        activeMedia.audioUrl && audio && audio.readyState > 0
          ? Math.round(audio.currentTime * 1000)
          : playbackStartedAtRef.current !== null
          ? Math.round((performance.now() - playbackStartedAtRef.current) * playbackRateRef.current)
          : currentSegmentElapsedMs;

      setActiveMedia({
        ...activeMedia,
        startAtMs: Math.max(0, nextElapsedMs),
      });
    },
    [activeMedia, currentSegmentElapsedMs, isPlaying]
  );

  const pausePlayback = useCallback(() => {
    if (!hasStarted || !activeMedia || !isPlaying) {
      return;
    }

    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    const audio = audioRef.current;
    let nextElapsedMs = currentSegmentElapsedMs;

    if (activeMedia.audioUrl && audio && audio.readyState > 0) {
      audio.pause();
      nextElapsedMs = Math.round(audio.currentTime * 1000);
    } else if (playbackStartedAtRef.current !== null) {
      nextElapsedMs = Math.round(
        (performance.now() - playbackStartedAtRef.current) * playbackRateRef.current
      );
    }

    playbackStartedAtRef.current = null;

    const durationMs = Math.max(
      currentSegmentDurationMs,
      activePlaybackDurationMs,
      estimateFallbackDuration(activeMedia.text)
    );
    setCurrentSegmentElapsedMs(Math.min(durationMs, Math.max(0, nextElapsedMs)));
    setIsPlaying(false);
  }, [
    activeMedia,
    activePlaybackDurationMs,
    currentSegmentDurationMs,
    currentSegmentElapsedMs,
    hasStarted,
    isPlaying,
  ]);

  const seekToTime = useCallback(
    (timeMs: number) => {
      if (!timelineSegments.length) {
        return;
      }

      const safeMaxTimeMs = Math.max(0, timelineDurationMs - MIN_SEEK_SAFETY_MS);
      const clampedTimeMs = Math.max(0, Math.min(timeMs, safeMaxTimeMs));
      const targetSegment =
        timelineSegments.find((segment) => clampedTimeMs < segment.endMs) ??
        timelineSegments.at(-1);

      if (!targetSegment) {
        return;
      }

      const targetOffsetMs = Math.max(0, clampedTimeMs - targetSegment.startMs);
      const isSamePage = targetSegment.pageIndex === currentPageIndex;
      const stageReady = isStageReady();

      clearPlayback();
      if (isSamePage && stageReady) {
        pendingSeekRef.current = null;
        awaitingStageLoadRef.current = false;
        setHasStarted(true);
        setCurrentPageIndex(targetSegment.pageIndex);

        if (targetSegment.revealIndex < currentRevealIndex) {
          // The embedded card only exposes `to_next`, so rewinding within a page
          // still needs a single reload back to the base slide state.
          queueSeek(targetSegment, targetOffsetMs);
          setStageRenderNonce((value) => value + 1);
          return;
        }

        setCurrentRevealIndex(targetSegment.revealIndex);
        if (targetSegment.revealIndex > currentRevealIndex) {
          syncStageToReveal(targetSegment.revealIndex - currentRevealIndex);
        }

        playReveal(targetSegment.pageIndex, targetSegment.revealIndex, {
          startAtMs: targetOffsetMs,
        });
        return;
      }

      queueSeek(targetSegment, targetOffsetMs);
    },
    [
      clearPlayback,
      currentPageIndex,
      currentRevealIndex,
      isStageReady,
      playReveal,
      queueSeek,
      syncStageToReveal,
      timelineDurationMs,
      timelineSegments,
    ]
  );

  const resumePlayback = useCallback(() => {
    if (isEnded) {
      seekToTime(0);
      return;
    }

    if (!hasStarted) {
      startLesson();
      return;
    }

    if (phase === "question" || phase === "feedback") {
      skipQuiz();
      return;
    }

    // If we are paused at a pause point, skip the current reveal and advance
    if (phase === "narrating" && !activeMedia && currentReveal?.pause) {
      advanceAfterReveal({ skipQuizCheck: false });
      return;
    }

    if (activeMedia) {
      setActiveMedia({
        ...activeMedia,
        startAtMs: currentSegmentElapsedMs,
      });
      return;
    }

    playReveal(currentPageIndex, currentRevealIndex, {
      startAtMs: currentSegmentElapsedMs,
    });
  }, [
    activeMedia,
    advanceAfterReveal,
    currentPageIndex,
    currentReveal,
    currentRevealIndex,
    currentSegmentElapsedMs,
    hasStarted,
    isEnded,
    phase,
    playReveal,
    seekToTime,
    skipQuiz,
    startLesson,
  ]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pausePlayback();
      return;
    }

    resumePlayback();
  }, [isPlaying, pausePlayback, resumePlayback]);

  const seekBy = useCallback(
    (offsetMs: number) => {
      const baseTimeMs = isEnded ? timelineDurationMs : timelineElapsedMs;
      seekToTime(baseTimeMs + offsetMs);
    },
    [isEnded, seekToTime, timelineDurationMs, timelineElapsedMs]
  );

  const bindStageFrame = useCallback((node: HTMLIFrameElement | null) => {
    if (node) {
      frameRef.current = node;
      return;
    }

    if (frameRef.current && !frameRef.current.isConnected) {
      frameRef.current = null;
    }
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

    let playbackDurationMs =
      activeMedia.kind === "reveal"
        ? currentTimelineSegment?.durationMs ?? estimateFallbackDuration(activeMedia.text)
        : estimateFallbackDuration(activeMedia.text);
    const startAtMs = Math.max(0, activeMedia.startAtMs);
    const rate = playbackRateRef.current;

    const updatePlaybackDuration = (nextDurationMs: number) => {
      playbackDurationMs = nextDurationMs;
      setActivePlaybackDurationMs(nextDurationMs);
    };

    const finishPlayback = () => {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      if (playbackFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }

      playbackStartedAtRef.current = null;
      setCurrentSegmentElapsedMs(playbackDurationMs);
      setIsPlaying(false);
      if (activeMedia.autoAdvance) {
        advanceAfterReveal();
      }
    };

    const startProgressLoop = () => {
      if (playbackFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }

      const updateProgress = () => {
        if (playbackStartedAtRef.current === null) {
          return;
        }

        const nextElapsedMs =
          activeMedia.audioUrl && !audio.paused && !audio.ended && audio.readyState > 0
            ? Math.round(audio.currentTime * 1000)
            : Math.round((performance.now() - playbackStartedAtRef.current) * rate);

        setCurrentSegmentElapsedMs(Math.min(playbackDurationMs, Math.max(0, nextElapsedMs)));
        playbackFrameRef.current = window.requestAnimationFrame(updateProgress);
      };

      playbackFrameRef.current = window.requestAnimationFrame(updateProgress);
    };

    const scheduleFallback = (resumeAtMs: number) => {
      playbackStartedAtRef.current = performance.now() - resumeAtMs / rate;
      setCurrentSegmentElapsedMs(resumeAtMs);
      updatePlaybackDuration(Math.max(playbackDurationMs, resumeAtMs));

      fallbackTimerRef.current = window.setTimeout(
        finishPlayback,
        Math.max(0, (playbackDurationMs - resumeAtMs) / rate)
      );
      setIsPlaying(true);
      startProgressLoop();
    };

    const handleEnded = () => {
      finishPlayback();
    };

    const handleLoadedMetadata = () => {
      const durationMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : playbackDurationMs;

      updatePlaybackDuration(durationMs);

      if (startAtMs <= 0) {
        return;
      }

      try {
        audio.currentTime = Math.min(startAtMs, durationMs) / 1000;
      } catch {
        return;
      }
    };

    const handleError = () => {
      audio.pause();
      scheduleFallback(Math.max(startAtMs, Math.round(audio.currentTime * 1000)));
    };

    audio.onended = handleEnded;
    audio.onloadedmetadata = handleLoadedMetadata;
    audio.onerror = handleError;
    audio.playbackRate = rate;
    audio.defaultPlaybackRate = rate;
    updatePlaybackDuration(playbackDurationMs);
    setCurrentSegmentElapsedMs(startAtMs);

    if (!activeMedia.audioUrl) {
      scheduleFallback(startAtMs);
      return () => {
        audio.onended = null;
        audio.onloadedmetadata = null;
        audio.onerror = null;
      };
    }

    audio.src = activeMedia.audioUrl;
    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        playbackStartedAtRef.current = performance.now() - startAtMs / rate;
        if (startAtMs > 0) {
          try {
            audio.currentTime = startAtMs / 1000;
          } catch {
            scheduleFallback(startAtMs);
            return;
          }
        }
        setIsPlaying(true);
        startProgressLoop();
      })
      .catch(() => {
        scheduleFallback(startAtMs);
      });

    return () => {
      audio.onended = null;
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
  }, [activeMedia, advanceAfterReveal, clearPlayback, currentTimelineSegment]);

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
      timelineSegments,
      timelineDurationMs,
      timelineElapsedMs,
      currentSegmentDurationMs,
      currentSegmentElapsedMs,
      playbackRate,
      setPlaybackRate,
      stageRenderNonce,
      seekToTime,
      seekBy,
      pausePlayback,
      resumePlayback,
      togglePlayback,
    };
  }, [
    activeMedia,
    activeQuiz,
    bindStageFrame,
    completedReveals,
    currentSegmentDurationMs,
    currentSegmentElapsedMs,
    playbackRate,
    setPlaybackRate,
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
    seekToTime,
    seekBy,
    pausePlayback,
    resumePlayback,
    startLesson,
    stageRenderNonce,
    submitQuizAnswer,
    retryQuiz,
    skipQuiz,
    togglePlayback,
    advanceManually,
    totalReveals,
    timelineSegments,
    timelineDurationMs,
    timelineElapsedMs,
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
