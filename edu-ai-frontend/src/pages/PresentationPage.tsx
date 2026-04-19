import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MonitorPlay,
  NotebookText,
  PanelsTopLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/markdown";

interface FileDescriptor {
  name: string;
  relative_path: string;
  download_url: string;
}

interface ArtifactDescriptor {
  agent_name: string;
  title: string;
  files: FileDescriptor[];
}

interface ArtifactListResponse {
  artifacts: ArtifactDescriptor[];
}

interface SlideInterrupt {
  type: string;
  prompt: string;
}

interface SlideManifestEntry {
  slide_id: string;
  sequence: number;
  title: string;
  teaching_goal: string;
  visual_type: string;
  script_context_before: string;
  script_context_current: string;
  script_context_after: string;
  animation_steps: string[];
  speaker_notes: string;
  interrupts: SlideInterrupt[];
  html_file: string;
}

interface SlideManifestResponse {
  deck_title: string;
  slides: SlideManifestEntry[];
}

interface SlideRuntimeState {
  step?: number;
  totalSteps?: number;
  completed?: boolean;
  hasMore?: boolean;
  advanced?: boolean;
}

interface EduSlideRuntime {
  to_next: () => SlideRuntimeState;
  reset: () => SlideRuntimeState;
  get_state: () => SlideRuntimeState;
}

function flattenFiles(artifacts: ArtifactListResponse | null): FileDescriptor[] {
  if (!artifacts) {
    return [];
  }
  return artifacts.artifacts.flatMap((artifact) => artifact.files);
}

function findFileByName(files: FileDescriptor[], name: string) {
  return files.find((file) => file.name === name) ?? null;
}

function findFileByRelativePath(files: FileDescriptor[], relativePath: string) {
  return files.find((file) => file.relative_path === relativePath) ?? null;
}

export default function PresentationPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [artifacts, setArtifacts] = useState<ArtifactListResponse | null>(null);
  const [manifest, setManifest] = useState<SlideManifestResponse | null>(null);
  const [presenterNotes, setPresenterNotes] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runtimeState, setRuntimeState] = useState<SlideRuntimeState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allFiles = useMemo(() => flattenFiles(artifacts), [artifacts]);
  const slides = manifest?.slides ?? [];
  const currentSlide = slides[currentIndex] ?? null;
  const currentSlideFile = currentSlide ? findFileByRelativePath(allFiles, `05_slides/${currentSlide.html_file}`) : null;

  useEffect(() => {
    if (!runId) {
      setError("缺少 runId，无法进入演示模式。");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadPresentation() {
      setIsLoading(true);
      setError(null);

      try {
        const artifactsResponse = await fetch(`/api/v1/prep-runs/${runId}/artifacts`, {
          signal: controller.signal,
        });
        if (!artifactsResponse.ok) {
          throw new Error(`artifacts request failed: ${artifactsResponse.status}`);
        }

        const artifactPayload = (await artifactsResponse.json()) as ArtifactListResponse;
        const files = flattenFiles(artifactPayload);
        const manifestFile = findFileByName(files, "slide_manifest.json");
        if (!manifestFile) {
          throw new Error("当前任务尚未生成 slide_manifest.json。");
        }

        const manifestResponse = await fetch(manifestFile.download_url, {
          signal: controller.signal,
          headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
        });
        if (!manifestResponse.ok) {
          throw new Error(`slide manifest request failed: ${manifestResponse.status}`);
        }

        const manifestPayload = (await manifestResponse.json()) as SlideManifestResponse;
        const presenterNotesFile = findFileByName(files, "presenter_notes.md");
        const presenterNotesText = presenterNotesFile
          ? await fetch(presenterNotesFile.download_url, {
              signal: controller.signal,
              headers: { Accept: "text/markdown, text/plain;q=0.9, */*;q=0.8" },
            }).then(async (response) => (response.ok ? response.text() : ""))
          : "";

        if (!cancelled) {
          setArtifacts(artifactPayload);
          setManifest(manifestPayload);
          setPresenterNotes(await presenterNotesText);
          setCurrentIndex(0);
          setRuntimeState({});
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "演示稿加载失败。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPresentation();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        handleNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const getSlideRuntime = (): EduSlideRuntime | null => {
    const iframeWindow = iframeRef.current?.contentWindow as (Window & {
      EduSlide?: EduSlideRuntime;
    }) | null;
    return iframeWindow?.EduSlide ?? null;
  };

  const handleIframeLoad = () => {
    const runtime = getSlideRuntime();
    if (!runtime) {
      setRuntimeState({});
      return;
    }
    try {
      setRuntimeState(runtime.reset());
    } catch {
      setRuntimeState({});
    }
  };

  const handleNext = () => {
    const runtime = getSlideRuntime();
    if (runtime) {
      try {
        const nextState = runtime.to_next();
        setRuntimeState(nextState);
        if (nextState.advanced !== false) {
          return;
        }
      } catch {
        // ignore iframe runtime errors and fall back to page switching
      }
    }

    setCurrentIndex((index) => Math.min(index + 1, Math.max(slides.length - 1, 0)));
  };

  const handlePrev = () => {
    setCurrentIndex((index) => Math.max(index - 1, 0));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 text-sm text-slate-200">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在加载 HTML 演示稿...
        </div>
      </div>
    );
  }

  if (error || !manifest || !currentSlide || !currentSlideFile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <div className="mb-4 flex items-center gap-3">
            <PanelsTopLeft className="h-6 w-6 text-sky-300" />
            <h1 className="text-xl font-semibold">演示模式暂不可用</h1>
          </div>
          <p className="text-sm leading-6 text-slate-300">
            {error || "未找到可播放的 slide manifest 或 HTML 页面。"}
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={() => navigate(runId ? `/study/${runId}` : "/study")}>
              返回学习区
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/90 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white" onClick={() => navigate(runId ? `/study/${runId}` : "/study")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{manifest.deck_title}</div>
              <div className="truncate text-xs text-slate-400">
                第 {currentSlide.sequence} / {slides.length} 页 · {currentSlide.title}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={handlePrev} disabled={currentIndex === 0}>
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button variant="outline" size="sm" className="border-sky-400/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20" onClick={handleNext}>
              下一步
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
          <section className="relative min-h-0 bg-slate-900">
            <div className="absolute left-0 right-0 top-0 z-10 px-5 pt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all"
                  style={{ width: `${((currentIndex + 1) / slides.length) * 100}%` }}
                />
              </div>
            </div>
            <iframe
              ref={iframeRef}
              title={currentSlide.title}
              src={currentSlideFile.download_url}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin"
              onLoad={handleIframeLoad}
            />
          </section>

          <aside className="flex min-h-0 flex-col border-l border-white/10 bg-slate-900/80">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
                <MonitorPlay className="h-4 w-4 text-sky-300" />
                播放骨架
              </div>
              <div className="space-y-2 text-sm text-slate-300">
                <p>教学目标：{currentSlide.teaching_goal}</p>
                <p>
                  页内动画：{runtimeState.step ?? 0} / {runtimeState.totalSteps ?? currentSlide.animation_steps.length}
                </p>
                <p>视觉类型：{currentSlide.visual_type}</p>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-5 py-4">
              <div className="space-y-6">
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <NotebookText className="h-4 w-4 text-sky-300" />
                    当前页备注
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                    <p>{currentSlide.speaker_notes}</p>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="text-sm font-semibold text-slate-100">页内步骤</div>
                  <ol className="space-y-2 text-sm text-slate-300">
                    {currentSlide.animation_steps.map((step, index) => (
                      <li
                        key={`${currentSlide.slide_id}-${index}`}
                        className={`rounded-xl border px-3 py-2 ${
                          index < (runtimeState.step ?? 0)
                            ? "border-sky-400/30 bg-sky-500/10 text-sky-100"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        {index + 1}. {step}
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="space-y-3">
                  <div className="text-sm font-semibold text-slate-100">Interrupt Overlay</div>
                  {currentSlide.interrupts.length > 0 ? (
                    <div className="space-y-2">
                      {currentSlide.interrupts.map((interrupt, index) => (
                        <div
                          key={`${currentSlide.slide_id}-interrupt-${index}`}
                          className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-50"
                        >
                          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                            {interrupt.type}
                          </div>
                          <p className="leading-6">{interrupt.prompt}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                      当前页没有额外 interrupt。
                    </div>
                  )}
                </section>

                {presenterNotes && (
                  <section className="space-y-3">
                    <div className="text-sm font-semibold text-slate-100">完整 presenter notes</div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <Markdown className="prose prose-invert max-w-none text-sm">
                        {presenterNotes}
                      </Markdown>
                    </div>
                  </section>
                )}
              </div>
            </ScrollArea>
          </aside>
        </main>
      </div>
    </div>
  );
}
