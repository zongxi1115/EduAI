import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  Mic2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LessonPlayerProvider,
  useLessonPlayer,
  type LessonQuiz,
  type LessonResult,
} from "@/components/classroom/LessonPlayerProvider";

type ClassroomRunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

interface ClassroomRunSnapshot {
  status: ClassroomRunStatus;
  latest_summary?: string | null;
  error?: string | null;
}

type PageState =
  | { status: "loading"; message: string }
  | { status: "pending"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; lesson: LessonResult };

function LessonQuizPanel({
  quiz,
  error,
  mode,
  onSubmit,
  onRetry,
  onSkip,
}: {
  quiz: LessonQuiz;
  error: string | null;
  mode: "question" | "feedback";
  onSubmit: (answer: string) => void;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState("");

  useEffect(() => {
    setAnswer("");
    setSelected("");
  }, [quiz, mode]);

  const isChoice = quiz.payload.type === "choice";
  const currentAnswer = isChoice ? selected : answer;

  return (
    <Card className="border-white/10 bg-slate-950/70 text-white shadow-[0_20px_50px_rgba(15,23,42,0.45)] backdrop-blur-xl">
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-sky-200/70">
          <Sparkles className="h-3.5 w-3.5" />
          课堂互动
        </div>
        <CardTitle className="text-xl text-white">请回答当前问题</CardTitle>
        <CardDescription className="text-slate-300">
          先完成这一题，我们再继续推进课堂演示。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <Markdown className="prose prose-invert max-w-none [&_p]:text-base [&_p]:leading-7">
            {quiz.payload.question}
          </Markdown>
        </div>

        {mode === "question" ? (
          <>
            {isChoice ? (
              <div className="space-y-3">
                {(quiz.payload.options ?? []).map((option) => {
                  const checked = selected === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSelected(option)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        checked
                          ? "border-sky-400 bg-sky-500/15 text-white"
                          : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10"
                      }`}
                    >
                      <Markdown className="prose prose-invert max-w-none [&_p]:m-0 [&_p]:text-sm">
                        {option}
                      </Markdown>
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="输入你的答案…"
                className="min-h-32 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-sky-400"
              />
            )}

            {error ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" onClick={onSkip} className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                跳过继续
              </Button>
              <Button
                onClick={() => onSubmit(currentAnswer)}
                disabled={!currentAnswer.trim()}
                className="bg-sky-500 text-white hover:bg-sky-400"
              >
                提交答案
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-50">
              <Markdown className="prose prose-invert max-w-none [&_p]:m-0 [&_p]:text-sm [&_p]:leading-7">
                {quiz.false_intro?.trim() || "我们补充一下这一题的思路，再继续。"}
              </Markdown>
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" onClick={onSkip} className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                继续课堂
              </Button>
              <Button onClick={onRetry} className="bg-sky-500 text-white hover:bg-sky-400">
                再答一次
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LessonPlayerShell() {
  const { id } = useParams<{ id: string }>();
  const {
    lesson,
    pages,
    currentPage,
    currentPageIndex,
    currentRevealIndex,
    currentTheme,
    currentReveal,
    activeMedia,
    activeQuiz,
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
  } = useLessonPlayer();

  const completion = useMemo(() => {
    if (isEnded) {
      return 100;
    }
    if (!totalReveals) {
      return 0;
    }
    return Math.min(100, Math.round((completedReveals / totalReveals) * 100));
  }, [completedReveals, isEnded, totalReveals]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_34%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-4">
          <Link
            to={`/study/${encodeURIComponent(id ?? "")}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-sky-200/70">
              <BookOpen className="h-3.5 w-3.5" />
              Lesson Player
            </div>
            <h1 className="truncate text-xl font-semibold text-white md:text-2xl">{lesson.topic}</h1>
            <p className="truncate text-sm text-slate-300">
              第 {currentPageIndex + 1} / {pages.length} 页 · {currentTheme}
            </p>
          </div>

          <div className="hidden items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 md:flex">
            <Mic2 className="h-4 w-4 text-sky-300" />
            {isEnded ? "课堂播放完成" : isPlaying ? "正在播放旁白" : hasStarted ? "等待下一步" : "待开始"}
          </div>

          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-81px)] max-w-[1600px] grid-cols-1 gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-[720px] flex-col gap-5">
          <Card className="border-white/10 bg-white/5 text-white shadow-[0_20px_60px_rgba(15,23,42,0.28)] backdrop-blur-xl">
            <CardContent className="space-y-4 px-5 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={hasStarted ? replayCurrentStep : startLesson} className="bg-sky-500 text-white hover:bg-sky-400">
                  {hasStarted ? (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      重播当前段
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-4 w-4" />
                      开始课堂
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={advanceManually}
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                  手动下一步
                </Button>
                <Button
                  variant="outline"
                  onClick={restartLesson}
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  从头播放
                </Button>
                <div className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200">
                  {isPlaying ? <Volume2 className="h-4 w-4 text-sky-300" /> : <PauseCircle className="h-4 w-4 text-slate-400" />}
                  {activeMedia?.text?.trim() ? "当前段落已激活" : "等待播放"}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                  <span>课程进度</span>
                  <span>{completion}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 transition-all duration-500"
                    style={{ width: `${completion}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="relative flex-1 overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/55 p-4 shadow-[0_32px_80px_rgba(15,23,42,0.36)] backdrop-blur-xl">
            <div className="absolute inset-x-8 top-5 z-10 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/55 px-4 py-2 text-sm text-slate-200 backdrop-blur-xl">
              <div>
                第 {currentPageIndex + 1} 页 · 第 {currentRevealIndex + 1} 段
              </div>
              <div className="truncate pl-4 text-slate-400">{currentPage.objective || currentPage.onSlideSummary || currentTheme}</div>
            </div>

            <iframe
              key={currentPage.idx}
              ref={bindStageFrame}
              title={`lesson-page-${currentPage.idx}`}
              srcDoc={currentPage.srcDoc}
              onLoad={handleStageReady}
              className="h-full min-h-[680px] w-full rounded-[26px] border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
            />

            <AnimatePresence>
              {activeQuiz ? (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 24 }}
                  transition={{ duration: 0.25 }}
                  className="pointer-events-none absolute inset-x-8 bottom-8 z-20"
                >
                  <div className="pointer-events-auto mx-auto max-w-3xl">
                    <LessonQuizPanel
                      quiz={activeQuiz}
                      error={quizError}
                      mode={phase === "feedback" ? "feedback" : "question"}
                      onSubmit={submitQuizAnswer}
                      onRetry={retryQuiz}
                      onSkip={skipQuiz}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <Card className="border-white/10 bg-white/5 text-white shadow-[0_18px_50px_rgba(15,23,42,0.24)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white">当前讲稿</CardTitle>
              <CardDescription className="text-slate-300">
                页面文字与口播是分开的，这里只显示当前真正会播报的内容。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                <Markdown className="prose prose-invert max-w-none [&_p]:text-sm [&_p]:leading-7">
                  {activeMedia?.text?.trim() || currentReveal?.narration?.trim() || "当前段落暂无可朗读内容。"}
                </Markdown>
              </div>
              {isEnded ? (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  <CheckCircle2 className="h-4 w-4" />
                  全部页面和旁白已经顺序播放完毕。
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5 text-white shadow-[0_18px_50px_rgba(15,23,42,0.24)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white">页面导航</CardTitle>
              <CardDescription className="text-slate-300">先按顺序播放；右侧用来观察当前推进位置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pages.map((page, pageIndex) => {
                const isActive = pageIndex === currentPageIndex;
                const isVisited = pageIndex < currentPageIndex;
                return (
                  <div
                    key={page.idx}
                    className={`rounded-2xl border px-4 py-3 transition ${
                      isActive
                        ? "border-sky-400/40 bg-sky-400/10"
                        : isVisited
                        ? "border-emerald-400/20 bg-emerald-400/8"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          第 {pageIndex + 1} 页 · {page.theme}
                        </p>
                        <p className="truncate text-xs text-slate-400">{page.objective || page.onSlideSummary || "课堂演示页"}</p>
                      </div>
                      <div className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                        {page.reveals.length} 段
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({
    status: "loading",
    message: "正在加载课堂播放数据…",
  });

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "缺少课堂任务 ID，无法打开播放器。" });
      return;
    }

    let disposed = false;
    let retryTimer: number | null = null;

    const loadLesson = async () => {
      try {
        const resultResponse = await fetch(`/api/v1/classroom/${encodeURIComponent(id)}/result`);
        if (resultResponse.ok) {
          const lesson = (await resultResponse.json()) as LessonResult;
          if (!disposed) {
            setState({ status: "ready", lesson });
          }
          return;
        }

        if (resultResponse.status === 409) {
          const statusResponse = await fetch(`/api/v1/classroom/${encodeURIComponent(id)}`);
          if (!statusResponse.ok) {
            throw new Error("课堂任务状态查询失败。");
          }

          const snapshot = (await statusResponse.json()) as ClassroomRunSnapshot;
          if (snapshot.status === "failed") {
            if (!disposed) {
              setState({
                status: "error",
                message: snapshot.error?.trim() || "课堂任务生成失败，请查看后端日志。",
              });
            }
            return;
          }

          if (!disposed) {
            setState({
              status: "pending",
              message: snapshot.latest_summary?.trim() || "课堂内容仍在生成中，稍后会自动重试。",
            });
          }
          retryTimer = window.setTimeout(loadLesson, 3000);
          return;
        }

        const errorText = await resultResponse.text();
        throw new Error(errorText || "课堂任务结果获取失败。");
      } catch (error) {
        if (!disposed) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "课堂播放页加载失败。",
          });
        }
      }
    };

    void loadLesson();

    return () => {
      disposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [id]);

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_34%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] px-6 text-white">
        <Card className="w-full max-w-2xl border-white/10 bg-white/5 text-white shadow-[0_24px_80px_rgba(15,23,42,0.36)] backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-2xl text-white">
              {state.status === "error" ? "课堂播放器暂时打不开" : "课堂播放器准备中"}
            </CardTitle>
            <CardDescription className="text-slate-300">
              {state.status === "pending"
                ? "后端还在生成课堂内容，我会继续自动刷新。"
                : "这里会直接打开生成好的课堂演示与语音播放。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-5 py-4 text-sm leading-7 text-slate-200">
              {state.message}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {state.status !== "error" ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200">
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
                  自动重试中
                </div>
              ) : null}
              <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Link to={`/study/${encodeURIComponent(id ?? "")}`}>回到学习区</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <LessonPlayerProvider lesson={state.lesson} runId={id ?? ""}>
      <LessonPlayerShell />
    </LessonPlayerProvider>
  );
}
