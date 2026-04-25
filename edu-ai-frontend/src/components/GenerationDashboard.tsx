import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, CheckCircle2, Code2, Loader2, Mic, Presentation, Sparkles } from 'lucide-react';

export type ClassroomRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';

export interface ClassroomPageBlueprint {
  idx: number;
  theme: string;
  objective?: string | null;
  key_points?: string[];
  target_reveal_count?: number;
  quiz_goal?: string | null;
}

export interface ClassroomGenerationEvent {
  index: number;
  timestamp: string;
  event: string;
  node?: string | null;
  phase?: string | null;
  summary?: string | null;
  run_id: string;
  run_status: ClassroomRunStatus;
  current_node?: string | null;
  data?: Record<string, unknown>;
}

type SlidePhase =
  | 'idle'
  | 'outline_typing'
  | 'outline_done'
  | 'script_deleting'
  | 'script_typing'
  | 'script_done'
  | 'html_typing'
  | 'html_done'
  | 'preview'
  | 'audio_gen'
  | 'audio_done';

type GlobalPhase = 'outline_seq' | 'grid_transition' | 'parallel_gen' | 'done';

type SlideState = {
  idx: number;
  title: string;
  outlineText: string;
  scriptText: string;
  htmlCode: string;
  phase: SlidePhase;
};

const SLIDE_PHASE_RANK: Record<SlidePhase, number> = {
  idle: 0,
  outline_typing: 1,
  outline_done: 2,
  script_deleting: 3,
  script_typing: 4,
  script_done: 5,
  html_typing: 6,
  html_done: 7,
  preview: 8,
  audio_gen: 9,
  audio_done: 10,
};

const GLOBAL_PHASE_RANK: Record<GlobalPhase, number> = {
  outline_seq: 0,
  grid_transition: 1,
  parallel_gen: 2,
  done: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isBlueprint(value: unknown): value is ClassroomPageBlueprint {
  if (!isRecord(value)) {
    return false;
  }

  return getNumber(value.idx) !== null && getString(value.theme) !== null;
}

function getPageBlueprints(value: unknown): ClassroomPageBlueprint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isBlueprint)
    .map((item) => ({
      idx: item.idx,
      theme: item.theme,
      objective: getString(item.objective) ?? '',
      key_points: Array.isArray(item.key_points)
        ? item.key_points.map((point) => getString(point)).filter((point): point is string => point !== null)
        : [],
      target_reveal_count: getNumber(item.target_reveal_count) ?? undefined,
      quiz_goal: getString(item.quiz_goal),
    }))
    .sort((left, right) => left.idx - right.idx);
}

function getOutlineString(blueprint: ClassroomPageBlueprint) {
  const lines: string[] = [];

  if (getString(blueprint.objective)) {
    lines.push(`教学目标：${blueprint.objective}`);
  }

  if (blueprint.key_points?.length) {
    lines.push(...blueprint.key_points.map((point, index) => `${index + 1}. ${point}`));
  }

  if (getString(blueprint.quiz_goal)) {
    lines.push(`互动检查：${blueprint.quiz_goal}`);
  }

  if (typeof blueprint.target_reveal_count === 'number') {
    lines.push(`预计展开：${blueprint.target_reveal_count} 段`);
  }

  return lines.join('\n');
}

function getPageTitle(data?: Record<string, unknown>) {
  if (!data) {
    return null;
  }

  const directTheme = getString(data.page_theme);
  if (directTheme) {
    return directTheme;
  }

  const blueprint = isRecord(data.page_blueprint) ? data.page_blueprint : null;
  return blueprint ? getString(blueprint.theme) : null;
}

function buildPlaceholderSlides(
  topic: string | null | undefined,
  summary: string | null | undefined,
  status: ClassroomRunStatus,
): SlideState[] {
  const normalizedTopic = getString(topic) ?? 'AI 课堂';
  const normalizedSummary =
    getString(summary) ??
    (status === 'queued'
      ? '任务已创建，正在排队进入课堂生成流程。'
      : '正在分析课堂主题并规划页面结构。');

  return [
    {
      idx: 0,
      title: `${normalizedTopic} 课堂`,
      outlineText: [`主题：${normalizedTopic}`, '', normalizedSummary].join('\n'),
      scriptText: '',
      htmlCode: '',
      phase: 'outline_typing',
    },
  ];
}

function estimateDuration(
  text: string,
  {
    intervalMs,
    charactersPerTick,
    minMs,
    maxMs,
  }: { intervalMs: number; charactersPerTick: number; minMs: number; maxMs: number },
) {
  if (!text.trim()) {
    return minMs;
  }

  const ticks = Math.ceil(text.length / Math.max(1, charactersPerTick));
  return Math.min(maxMs, Math.max(minMs, ticks * intervalMs));
}

function getTypingChunk(text: string, targetMs: number, intervalMs: number, minimum = 2) {
  if (!text.length) {
    return minimum;
  }

  const ticks = Math.max(1, Math.round(targetMs / intervalMs));
  return Math.max(minimum, Math.ceil(text.length / ticks));
}

export function GenerationDashboard({
  topic,
  status,
  summary,
  events,
}: {
  topic?: string | null;
  status: ClassroomRunStatus;
  summary?: string | null;
  events: ClassroomGenerationEvent[];
}) {
  const timersRef = useRef<number[]>([]);
  const processedEventIdsRef = useRef<Set<number>>(new Set());

  const [hasBlueprints, setHasBlueprints] = useState(false);
  const [slides, setSlides] = useState<SlideState[]>(() => buildPlaceholderSlides(topic, summary, status));
  const [globalPhase, setGlobalPhase] = useState<GlobalPhase>('outline_seq');

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  const queueTask = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
  };

  const advanceGlobalPhase = (nextPhase: GlobalPhase) => {
    setGlobalPhase((currentPhase) =>
      GLOBAL_PHASE_RANK[nextPhase] > GLOBAL_PHASE_RANK[currentPhase] ? nextPhase : currentPhase,
    );
  };

  const updateSlide = (idx: number, patch: Partial<SlideState>, nextPhase?: SlidePhase) => {
    setSlides((currentSlides) =>
      currentSlides.map((slide) => {
        if (slide.idx !== idx) {
          return slide;
        }

        const mergedSlide = {
          ...slide,
          ...patch,
        };

        if (!nextPhase) {
          return mergedSlide;
        }

        return SLIDE_PHASE_RANK[nextPhase] >= SLIDE_PHASE_RANK[slide.phase]
          ? { ...mergedSlide, phase: nextPhase }
          : mergedSlide;
      }),
    );
  };

  const updateAllSlidesPhase = (nextPhase: SlidePhase) => {
    setSlides((currentSlides) =>
      currentSlides.map((slide) =>
        SLIDE_PHASE_RANK[nextPhase] >= SLIDE_PHASE_RANK[slide.phase]
          ? { ...slide, phase: nextPhase }
          : slide,
      ),
    );
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    const initializeBlueprintSlides = (blueprints: ClassroomPageBlueprint[]) => {
      if (!blueprints.length) {
        return;
      }

      setHasBlueprints(true);
      setSlides(
        blueprints.map((blueprint) => ({
          idx: blueprint.idx,
          title: blueprint.theme,
          outlineText: getOutlineString(blueprint),
          scriptText: '',
          htmlCode: '',
          phase: 'idle',
        })),
      );
      setGlobalPhase('outline_seq');

      blueprints.forEach((blueprint, index) => {
        const startDelay = 180 + index * 320;
        queueTask(() => updateSlide(blueprint.idx, {}, 'outline_typing'), startDelay);
        queueTask(() => updateSlide(blueprint.idx, {}, 'outline_done'), startDelay + 650);
      });

      const gridDelay = 420 + blueprints.length * 320;
      queueTask(() => advanceGlobalPhase('grid_transition'), gridDelay);
      queueTask(() => advanceGlobalPhase('parallel_gen'), gridDelay + 900);
    };

    events.forEach((event) => {
      if (processedEventIdsRef.current.has(event.index)) {
        return;
      }
      processedEventIdsRef.current.add(event.index);

      const data = isRecord(event.data) ? event.data : undefined;
      const pageIdx = data ? getNumber(data.page_idx) : null;
      const pageTitle = getPageTitle(data);

      if (event.event === 'node_completed' && event.node === 'page_plan') {
        const blueprints = getPageBlueprints(data?.page_blueprints);
        initializeBlueprintSlides(blueprints);
        return;
      }

      if (event.event === 'node_started' && event.node === 'page_script' && pageIdx !== null) {
        updateSlide(pageIdx, pageTitle ? { title: pageTitle } : {}, 'script_deleting');
        return;
      }

      if (event.event === 'node_completed' && event.node === 'page_script' && pageIdx !== null) {
        const scriptText = getString(data?.page_script) ?? getString(event.summary) ?? '';
        updateSlide(
          pageIdx,
          {
            scriptText,
            ...(pageTitle ? { title: pageTitle } : {}),
          },
          'script_typing',
        );

        const typingDuration = estimateDuration(scriptText, {
          intervalMs: 25,
          charactersPerTick: getTypingChunk(scriptText, 2000, 25, 3),
          minMs: 600,
          maxMs: 2400,
        });

        queueTask(() => updateSlide(pageIdx, {}, 'script_done'), typingDuration);
        return;
      }

      if (event.event === 'node_started' && event.node === 'slide' && pageIdx !== null) {
        updateSlide(pageIdx, pageTitle ? { title: pageTitle } : {}, 'html_typing');
        return;
      }

      if (event.event === 'node_completed' && event.node === 'slide' && pageIdx !== null) {
        const htmlCode = getString(data?.html) ?? '';
        updateSlide(
          pageIdx,
          {
            htmlCode,
            ...(pageTitle ? { title: pageTitle } : {}),
          },
          'html_typing',
        );

        const typingDuration = estimateDuration(htmlCode, {
          intervalMs: 20,
          charactersPerTick: getTypingChunk(htmlCode, 1800, 20, 20),
          minMs: 500,
          maxMs: 2200,
        });

        queueTask(() => updateSlide(pageIdx, {}, 'html_done'), typingDuration);
        queueTask(() => updateSlide(pageIdx, {}, 'preview'), typingDuration + 500);
        return;
      }

      if (event.event === 'node_completed' && event.node === 'assemble') {
        queueTask(() => updateAllSlidesPhase('preview'), 150);
        return;
      }

      if (event.event === 'voice_started') {
        advanceGlobalPhase('parallel_gen');
        updateAllSlidesPhase('audio_gen');
        return;
      }

      if (event.event === 'voice_completed' || event.event === 'voice_skipped') {
        updateAllSlidesPhase('audio_done');
        advanceGlobalPhase('done');
        return;
      }

      if (event.event === 'workflow_completed') {
        updateAllSlidesPhase('audio_done');
        advanceGlobalPhase('done');
      }
    });
  }, [events]);

  useEffect(() => {
    if (globalPhase === 'outline_seq') {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [globalPhase, slides]);

  const effectiveGlobalPhase = status === 'succeeded' ? 'done' : globalPhase;
  const isGrid =
    effectiveGlobalPhase === 'grid_transition' ||
    effectiveGlobalPhase === 'parallel_gen' ||
    effectiveGlobalPhase === 'done';
  const renderedSlides = hasBlueprints ? slides : buildPlaceholderSlides(topic, summary, status);
  const headline =
    getString(summary) ??
    (status === 'queued'
      ? 'AI 课堂任务已创建，等待执行。'
      : topic
      ? `${topic} 正在生成课堂`
      : 'AI 课堂正在生成');

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans text-zinc-900 pb-32 relative overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none flex justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.08),transparent_50%)]" />
        <div className="w-[800px] h-[500px] bg-blue-400/20 rounded-full blur-[120px] opacity-20 absolute -top-48 mix-blend-multiply" />
        <div className="w-[600px] h-[400px] bg-purple-400/20 rounded-full blur-[120px] opacity-20 absolute top-24 right-0 mix-blend-multiply" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMCwwLDAsMC4wMikiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white_10%,transparent_90%)] opacity-60" />
      </div>

      <nav className="fixed top-0 inset-x-0 h-16 bg-white/60 backdrop-blur-xl border-b border-zinc-200/50 z-50 flex items-center px-8 relative">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center bg-zinc-950 text-white rounded-[8px] shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-bold tracking-tight text-sm text-zinc-900 truncate">{headline}</span>
        </div>
      </nav>

      <div className="pt-32 pb-16 px-8 mx-auto transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] max-w-[1200px]">
        <main className="relative z-0">
          <AnimatePresence mode="wait">
            {!isGrid ? (
              <motion.div
                key="timeline"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -30, filter: 'blur(8px)' }}
                transition={{ duration: 0.6 }}
                className="flex flex-col gap-6 max-w-3xl mx-auto w-full"
              >
                {renderedSlides.map((slide, index) => {
                  if (slide.phase === 'idle') {
                    return null;
                  }

                  return (
                    <motion.div
                      key={slide.idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                      className="bg-white rounded-[24px] p-8 shadow-sm ring-1 ring-zinc-900/5 relative"
                    >
                      {index !== renderedSlides.length - 1 ? (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: '100%' }}
                          transition={{ duration: 0.8, delay: 0.2 }}
                          className="absolute left-[3.25rem] top-20 bottom-[-3rem] w-0.5 bg-gradient-to-b from-blue-400/50 to-purple-400/50 -z-10 origin-top"
                        />
                      ) : null}
                      <OutlineBlock slide={slide} title={slide.title} />
                    </motion.div>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, staggerChildren: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full"
              >
                {renderedSlides.map((slide) => (
                  <div
                    key={slide.idx}
                    className="bg-white rounded-[24px] overflow-hidden flex flex-col aspect-[4/3] shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 transition-all hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]"
                  >
                    <SlideBlock slide={slide} title={slide.title} />
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function OutlineBlock({ slide, title }: { slide: SlideState; title: string }) {
  const isTyping = slide.phase === 'outline_typing';

  return (
    <div className="flex gap-6 group relative">
      <div className="relative flex flex-col items-center">
        <div
          className={`w-12 h-12 rounded-2xl bg-white border ${
            isTyping
              ? 'border-blue-200 shadow-[0_0_20px_rgba(59,130,246,0.15)] text-blue-600'
              : 'border-zinc-100 shadow-[0_2px_10px_rgb(0,0,0,0.02)] text-zinc-400'
          } flex items-center justify-center font-mono text-sm font-semibold z-10 shrink-0 transition-all duration-500 ring-4 ring-white`}
        >
          {String(slide.idx + 1).padStart(2, '0')}
        </div>
        {isTyping ? <div className="absolute inset-0 rounded-2xl border border-blue-400 animate-ping opacity-20" /> : null}
      </div>
      <div className="pt-2 pb-6">
        <h3 className="text-xl font-bold tracking-tight text-zinc-800 mb-3 flex items-center gap-3">
          {title}
          {isTyping ? (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="px-2.5 py-1 rounded bg-blue-50 text-blue-500 text-[10px] font-bold tracking-widest uppercase shadow-sm"
            >
              规划中
            </motion.span>
          ) : null}
        </h3>
        <TypewriterEffect text={slide.outlineText} phase={isTyping ? 'typing' : 'done'} />
      </div>
    </div>
  );
}

function SlideBlock({ slide, title }: { slide: SlideState; title: string }) {
  return (
    <div className="flex flex-col h-full relative group bg-white">
      <div className="h-14 border-b border-zinc-100/80 flex items-center justify-between px-5 bg-white/50 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-3 truncate">
          <span className="text-[10px] tracking-wider font-mono bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-md font-bold uppercase shadow-sm">
            第 {String(slide.idx + 1).padStart(2, '0')} 页
          </span>
          <h4 className="font-semibold text-sm truncate text-zinc-800 tracking-tight pr-2">{title}</h4>
        </div>
        <StatusIcon phase={slide.phase} />
      </div>

      <div className="flex-1 relative bg-zinc-50/50 overflow-hidden text-sm">
        <AnimatePresence mode="popLayout">
          {(slide.phase === 'outline_done' ||
            slide.phase === 'script_deleting' ||
            slide.phase === 'script_typing' ||
            slide.phase === 'script_done') && (
            <motion.div
              key="text-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 p-6 overflow-hidden"
            >
              <TypewriterTransition oldText={slide.outlineText} newText={slide.scriptText} phase={slide.phase} />
            </motion.div>
          )}

          {(slide.phase === 'html_typing' || slide.phase === 'html_done') && (
            <motion.div
              key="code-layer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="absolute inset-0 bg-[#0A0A0B] text-zinc-300 font-mono p-5 text-[11px] leading-[1.6] overflow-hidden"
            >
              <CodeStreamer code={slide.htmlCode} isGenerating={slide.phase === 'html_typing'} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(slide.phase === 'preview' || slide.phase === 'audio_gen' || slide.phase === 'audio_done') && slide.htmlCode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 z-20 bg-white"
            >
              <iframe srcDoc={slide.htmlCode} className="w-full h-full border-none pointer-events-none" title="preview" />

              <AnimatePresence>
                {(slide.phase === 'audio_gen' || slide.phase === 'audio_done') && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-md rounded-2xl p-3 shadow-lg border border-zinc-200/50 flex items-center justify-between z-30"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          slide.phase === 'audio_gen' ? 'bg-rose-100 text-rose-500' : 'bg-green-100 text-green-500'
                        }`}
                      >
                        {slide.phase === 'audio_gen' ? <Mic className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-800">
                          {slide.phase === 'audio_gen' ? '正在生成课堂语音...' : '课堂语音已就绪'}
                        </span>
                        {slide.phase === 'audio_gen' ? (
                          <div className="flex gap-0.5 items-center h-2 mt-1">
                            {[1, 2, 3, 4, 5].map((bar) => (
                              <motion.div
                                key={bar}
                                animate={{ height: ['4px', '12px', '4px'] }}
                                transition={{ repeat: Infinity, duration: 0.5, delay: bar * 0.1 }}
                                className="w-1 bg-rose-400 rounded-full"
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-zinc-500">已可以进入正式课堂播放</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatusIcon({ phase }: { phase: SlidePhase }) {
  if (phase === 'audio_done') {
    return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  }

  if (phase === 'audio_gen') {
    return (
      <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
        <Mic className="w-4 h-4 text-rose-500" />
      </motion.div>
    );
  }

  if (phase === 'preview') {
    return <Presentation className="w-4 h-4 text-zinc-400" />;
  }

  if (phase === 'html_typing' || phase === 'html_done') {
    return <Code2 className="w-4 h-4 text-blue-500" />;
  }

  if (phase.includes('script') && !phase.includes('done')) {
    return (
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
        <Loader2 className="w-4 h-4 text-purple-500" />
      </motion.div>
    );
  }

  if (phase === 'script_done') {
    return <BookOpen className="w-4 h-4 text-zinc-400" />;
  }

  if (phase === 'outline_typing') {
    return (
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
        <Loader2 className="w-4 h-4 text-zinc-400" />
      </motion.div>
    );
  }

  return <div className="w-1.5 h-1.5 rounded-full bg-zinc-300" />;
}

function TypewriterEffect({ text, phase }: { text: string; phase: 'idle' | 'typing' | 'done' }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (phase === 'idle') {
      const timer = window.setTimeout(() => setDisplay(''), 0);
      return () => window.clearTimeout(timer);
    }

    if (phase === 'done') {
      const timer = window.setTimeout(() => setDisplay(text), 0);
      return () => window.clearTimeout(timer);
    }

    let i = 0;
    const chunk = getTypingChunk(text, 1200, 16, 3);
    const timer = window.setInterval(() => {
      i += chunk;
      setDisplay(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(timer);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [phase, text]);

  return <div className="whitespace-pre-wrap text-zinc-500 leading-relaxed text-sm">{display}</div>;
}

function TypewriterTransition({ oldText, newText, phase }: { oldText: string; newText: string; phase: SlidePhase }) {
  const [display, setDisplay] = useState(oldText);

  const maskStyle = {
    maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
  };

  useEffect(() => {
    if (phase === 'script_deleting') {
      let current = oldText;
      const chunk = getTypingChunk(oldText, 500, 18, 4);
      const timer = window.setInterval(() => {
        current = current.slice(0, Math.max(0, current.length - chunk));
        setDisplay(current);
        if (current.length === 0) {
          window.clearInterval(timer);
        }
      }, 18);
      return () => window.clearInterval(timer);
    }

    if (phase === 'script_typing') {
      let index = 0;
      const chunk = getTypingChunk(newText, 2000, 22, 4);
      const timer = window.setInterval(() => {
        index += chunk;
        setDisplay(newText.slice(0, index));
        if (index >= newText.length) {
          window.clearInterval(timer);
        }
      }, 22);
      return () => window.clearInterval(timer);
    }

    if (phase === 'script_done') {
      const timer = window.setTimeout(() => setDisplay(newText), 0);
      return () => window.clearTimeout(timer);
    }

    if (phase === 'outline_done') {
      const timer = window.setTimeout(() => setDisplay(oldText), 0);
      return () => window.clearTimeout(timer);
    }
  }, [newText, oldText, phase]);

  const isOutline = phase === 'outline_done' || phase === 'script_deleting';

  return (
    <div
      className={`whitespace-pre-wrap ${
        isOutline
          ? 'text-zinc-500 font-medium leading-[1.6]'
          : 'text-zinc-700 font-serif text-[15px] leading-[1.8] tracking-[0.01em]'
      } h-full transition-colors duration-500`}
      style={maskStyle}
    >
      {display}
      {(phase === 'script_deleting' || phase === 'script_typing') && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ repeat: Infinity, duration: 0.7 }}
          className="inline-block w-1.5 h-[1.1em] bg-purple-500 ml-1 translate-y-1 rounded-sm"
        />
      )}
    </div>
  );
}

function CodeStreamer({ code, isGenerating }: { code: string; isGenerating: boolean }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (!isGenerating) {
      const timer = window.setTimeout(() => setDisplay(code), 0);
      return () => window.clearTimeout(timer);
    }

    let index = 0;
    const chunk = getTypingChunk(code, 1800, 12, 24);
    const timer = window.setInterval(() => {
      index += chunk;
      setDisplay(code.slice(0, index));
      if (index >= code.length) {
        window.clearInterval(timer);
      }
    }, 12);

    return () => window.clearInterval(timer);
  }, [code, isGenerating]);

  return (
    <div className="h-full overflow-hidden relative flex flex-col">
      <div className="flex items-center gap-1.5 mb-4 opacity-40 shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
      </div>
      <div
        className="flex-1 overflow-hidden relative"
        style={{
          maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none z-10" />
        <pre className="whitespace-pre-wrap break-all pb-12 opacity-80">{display}</pre>
      </div>

      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute bottom-4 right-0 px-4 py-2 rounded-l-full bg-indigo-500/10 border border-r-0 border-indigo-500/20 text-indigo-400 flex items-center gap-2.5 backdrop-blur-md shadow-[0_4px_16px_rgba(99,102,241,0.1)]"
          >
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
              <Loader2 className="w-3.5 h-3.5" />
            </motion.div>
            <span className="text-[11px] font-bold tracking-widest uppercase text-indigo-300">渲染中</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
