import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PenTool, Play, CheckCircle, LoaderCircle, TerminalSquare, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { DraftBoard } from "@/components/DraftBoard";
import { X } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Textarea } from "@/components/ui/textarea";

export interface ProgrammingQuestionProps {
  questionContent: string; // Markdown + LaTeX
  initialCode?: string;
  initialRunnerCode?: string;
  language?: string;
  onSubmit?: (code: string) => void;
}

type OutputLineType = "log" | "warn" | "error" | "result" | "meta";

interface OutputLine {
  type: OutputLineType;
  text: string;
}

interface RunnerSuccessMessage {
  ok: true;
  logs: OutputLine[];
  resultText: string | null;
  durationMs: number;
}

interface RunnerErrorMessage {
  ok: false;
  logs: OutputLine[];
  errorText: string;
  durationMs: number;
}

type RunnerMessage = RunnerSuccessMessage | RunnerErrorMessage;

const RUN_TIMEOUT_MS = 5000;
const SUPPORTED_JS_LANGUAGES = new Set(["javascript", "js", "node", "nodejs"]);
const SUPPORTED_PYTHON_LANGUAGES = new Set(["python", "py", "python3"]);
const RUNNER_PANEL_MIN_HEIGHT = 240;
const RUNNER_PANEL_DEFAULT_HEIGHT = 320;
const RUNNER_PANEL_MAX_HEIGHT = 520;
const PYTHON_RUN_ENDPOINT = "/api/v1/code-execution/execute";

interface RemoteRunnerResponse {
  ok: boolean;
  logs: OutputLine[];
  result_text: string | null;
  error_text: string | null;
  duration_ms: number;
}

function isJavaScriptLanguage(language: string) {
  return SUPPORTED_JS_LANGUAGES.has(language.trim().toLowerCase());
}

function isPythonLanguage(language: string) {
  return SUPPORTED_PYTHON_LANGUAGES.has(language.trim().toLowerCase());
}

function buildRunnerPlaceholder(language: string) {
  if (isPythonLanguage(language)) {
    return "return solve([2, 7, 11, 15], 9)";
  }
  return "return twoSum([2, 7, 11, 15], 9);";
}

function buildRunnerExample(language: string) {
  if (isPythonLanguage(language)) {
    return {
      returnExample: "return solve([2, 7, 11, 15], 9)",
      printExample: "print(solve([2, 7, 11, 15], 9))",
      metaText: "Python 代码会通过后端 API 运行。",
    };
  }

  return {
    returnExample: "return twoSum([2, 7, 11, 15], 9);",
    printExample: "console.log(twoSum([2, 7, 11, 15], 9));",
    metaText: "JavaScript 代码会直接在浏览器中运行。",
  };
}

function buildRunnerWorkerSource() {
  return `
    const formatValue = (value) => {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (typeof value === "bigint") return value.toString() + "n";
      if (typeof value === "symbol") return value.toString();
      if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
      if (value instanceof Error) return value.stack || value.message || String(value);

      const seen = new WeakSet();
      try {
        return JSON.stringify(
          value,
          (_key, currentValue) => {
            if (typeof currentValue === "bigint") return currentValue.toString() + "n";
            if (typeof currentValue === "symbol") return currentValue.toString();
            if (typeof currentValue === "function") {
              return "[Function " + (currentValue.name || "anonymous") + "]";
            }
            if (currentValue instanceof Error) {
              return currentValue.stack || currentValue.message || String(currentValue);
            }
            if (currentValue && typeof currentValue === "object") {
              if (seen.has(currentValue)) return "[Circular]";
              seen.add(currentValue);
            }
            return currentValue;
          },
          2
        );
      } catch (_error) {
        return String(value);
      }
    };

    self.onmessage = async (event) => {
      const payload = event.data || {};
      const code = typeof payload.code === "string" ? payload.code : "";
      const runnerCode = typeof payload.runnerCode === "string" ? payload.runnerCode : "";
      const logs = [];
      const startedAt = Date.now();

      const pushLog = (type, args) => {
        logs.push({
          type,
          text: args.map((item) => formatValue(item)).join(" "),
        });
      };

      const consoleProxy = {
        log: (...args) => pushLog("log", args),
        info: (...args) => pushLog("log", args),
        debug: (...args) => pushLog("log", args),
        warn: (...args) => pushLog("warn", args),
        error: (...args) => pushLog("error", args),
        table: (...args) => pushLog("log", args),
        clear: () => {
          logs.length = 0;
        },
        assert: (condition, ...args) => {
          if (!condition) {
            pushLog("error", args.length > 0 ? args : ["Assertion failed"]);
          }
        },
      };

      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const source = runnerCode.trim()
          ? '"use strict";\\n' +
            code +
            '\\n\\nconst __run__ = async () => {\\n' +
            runnerCode +
            '\\n};\\nreturn await __run__();'
          : '"use strict";\\n' + code;

        const execute = new AsyncFunction("console", source);
        const result = await execute(consoleProxy);

        self.postMessage({
          ok: true,
          logs,
          resultText: result === undefined ? null : formatValue(result),
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        self.postMessage({
          ok: false,
          logs,
          errorText: formatValue(error),
          durationMs: Date.now() - startedAt,
        });
      }
    };
  `;
}

export function ProgrammingQuestion({
  questionContent,
  initialCode = "",
  initialRunnerCode = "",
  language = "javascript",
  onSubmit,
}: ProgrammingQuestionProps) {
  const [code, setCode] = useState(initialCode);
  const [runnerCode, setRunnerCode] = useState(initialRunnerCode);
  const [isRunning, setIsRunning] = useState(false);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [isRunnerPanelVisible, setIsRunnerPanelVisible] = useState(false);
  const [isResizingRunnerPanel, setIsResizingRunnerPanel] = useState(false);
  const [runnerPanelHeight, setRunnerPanelHeight] = useState(RUNNER_PANEL_DEFAULT_HEIGHT);
  const workerRef = useRef<Worker | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const remoteAbortControllerRef = useRef<AbortController | null>(null);
  const runnerPanelResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const canRunOnline = isJavaScriptLanguage(language) || isPythonLanguage(language);
  const runnerExamples = buildRunnerExample(language);

  const cleanupRunner = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    if (workerUrlRef.current) {
      URL.revokeObjectURL(workerUrlRef.current);
      workerUrlRef.current = null;
    }

    if (remoteAbortControllerRef.current) {
      remoteAbortControllerRef.current.abort();
      remoteAbortControllerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupRunner();
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!runnerPanelResizeStateRef.current) {
        return;
      }

      const deltaY = event.clientY - runnerPanelResizeStateRef.current.startY;
      const nextHeight = Math.max(
        RUNNER_PANEL_MIN_HEIGHT,
        Math.min(runnerPanelResizeStateRef.current.startHeight - deltaY, RUNNER_PANEL_MAX_HEIGHT),
      );
      setRunnerPanelHeight(nextHeight);
    };

    const handleMouseUp = () => {
      runnerPanelResizeStateRef.current = null;
      setIsResizingRunnerPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleSubmit = () => {
    if (onSubmit) onSubmit(code);
  };

  const runPythonRemotely = async () => {
    const controller = new AbortController();
    remoteAbortControllerRef.current = controller;
    setIsRunning(true);
    setRunDurationMs(null);
    setOutputLines([{ type: "meta", text: "正在通过后端运行 Python 代码..." }]);

    try {
      const response = await fetch(PYTHON_RUN_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          language: "python",
          code,
          runner_code: runnerCode,
          timeout_ms: RUN_TIMEOUT_MS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`运行请求失败（${response.status}）`);
      }

      const payload = (await response.json()) as RemoteRunnerResponse;
      if (remoteAbortControllerRef.current !== controller) {
        return;
      }

      remoteAbortControllerRef.current = null;
      setIsRunning(false);
      setRunDurationMs(payload.duration_ms);

      const nextLines = [...payload.logs];
      if (payload.ok) {
        if (payload.result_text !== null) {
          nextLines.push({ type: "result", text: `返回值: ${payload.result_text}` });
        }
        if (nextLines.length === 0) {
          nextLines.push({ type: "meta", text: "运行完成，没有输出。" });
        }
      } else {
        nextLines.push({
          type: "error",
          text: payload.error_text || "Python 运行失败，请稍后再试。",
        });
      }

      setOutputLines(nextLines);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      remoteAbortControllerRef.current = null;
      setIsRunning(false);
      setRunDurationMs(null);
      setOutputLines([
        {
          type: "error",
          text: error instanceof Error ? error.message : "Python 运行失败，请稍后再试。",
        },
      ]);
    }
  };

  const handleRun = () => {
    if (!isRunnerPanelVisible) {
      setIsRunnerPanelVisible(true);
    }

    if (!canRunOnline) {
      setRunDurationMs(null);
      setOutputLines([{ type: "error", text: `暂不支持 ${language} 在线运行，目前先支持 JavaScript 和 Python。` }]);
      return;
    }

    cleanupRunner();

    if (isPythonLanguage(language)) {
      void runPythonRemotely();
      return;
    }

    setIsRunning(true);
    setRunDurationMs(null);
    setOutputLines([{ type: "meta", text: "正在运行 JavaScript 代码..." }]);

    const workerSource = buildRunnerWorkerSource();
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
    const worker = new Worker(workerUrl);

    workerRef.current = worker;
    workerUrlRef.current = workerUrl;

    worker.onmessage = (event: MessageEvent<RunnerMessage>) => {
      cleanupRunner();
      setIsRunning(false);
      setRunDurationMs(event.data.durationMs);

      const nextLines = [...event.data.logs];
      if (event.data.ok) {
        if (event.data.resultText !== null) {
          nextLines.push({ type: "result", text: `返回值: ${event.data.resultText}` });
        }
        if (nextLines.length === 0) {
          nextLines.push({ type: "meta", text: "运行完成，没有输出。" });
        }
      } else {
        nextLines.push({ type: "error", text: event.data.errorText });
      }

      setOutputLines(nextLines);
    };

    worker.onerror = (event) => {
      cleanupRunner();
      setIsRunning(false);
      setRunDurationMs(null);
      setOutputLines([{ type: "error", text: event.message || "运行器启动失败，请稍后再试。" }]);
    };

    timeoutRef.current = window.setTimeout(() => {
      cleanupRunner();
      setIsRunning(false);
      setRunDurationMs(RUN_TIMEOUT_MS);
      setOutputLines([
        {
          type: "error",
          text: `执行超时，已在 ${RUN_TIMEOUT_MS / 1000} 秒后停止运行。请检查是否有死循环或长时间阻塞。`,
        },
      ]);
    }, RUN_TIMEOUT_MS);

    worker.postMessage({
      code,
      runnerCode,
    });
  };

  const handleRunnerPanelResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizingRunnerPanel(true);
    runnerPanelResizeStateRef.current = {
      startY: event.clientY,
      startHeight: runnerPanelHeight,
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="w-full flex-1 max-w-6xl mx-auto bg-white border rounded-xl shadow-sm h-[800px] flex flex-col md:flex-row overflow-hidden">
      {/* Left side: Problem Description */}
      <div className="w-full md:w-1/2 flex flex-col h-full min-h-0 bg-slate-50 border-r relative z-10 shrink-0">
        <div className="flex items-center justify-between p-4 border-b bg-white shrink-0 shadow-sm z-20">
          <h3 className="font-semibold text-slate-800">题目描述</h3>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 text-primary border-primary/20 hover:bg-primary/10 transition-colors">
                <PenTool className="w-3.5 h-3.5" />
                草稿纸
              </Button>
            </DialogTrigger>
            {/* @ts-ignore */}
            <DialogContent className="fixed inset-0 m-0 max-w-none max-h-none h-[100dvh] w-[100dvw] p-0 flex flex-col rounded-none overflow-hidden border-none top-0 left-0 translate-x-0 translate-y-0 sm:max-w-none" showCloseButton={false}>
               <DialogTitle className="sr-only">在线草稿纸</DialogTitle>
               <div className="flex-1 w-full h-full relative">
                 <DraftBoard questionContent={questionContent} />
                 <DialogClose asChild>
                   <Button 
                     variant="secondary" 
                     size="icon" 
                     className="absolute top-4 right-4 z-[9999] rounded-full shadow-lg border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors bg-white/80 backdrop-blur-sm"
                   >
                     <X className="w-5 h-5" />
                     <span className="sr-only">关闭全屏草稿纸</span>
                   </Button>
                 </DialogClose>
               </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="p-6 overflow-y-auto flex-1 prose prose-slate max-w-none">
          <ReactMarkdown
             remarkPlugins={[remarkMath]}
             rehypePlugins={[rehypeKatex]}
          >
             {questionContent}
          </ReactMarkdown>
        </div>
      </div>

      {/* Right side: Code Editor */}
      <div className="w-full md:w-1/2 flex flex-col h-full min-h-0 bg-[#1e1e1e] relative z-20">
        <div className="flex items-center justify-between p-3 pl-5 border-b border-white/10 shrink-0 bg-[#252526]">
          <span className="text-xs font-semibold text-slate-400  tracking-widest">{language}</span>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-0 gap-1.5 transition-colors disabled:bg-white/10 disabled:text-slate-400"
              onClick={handleRun}
              disabled={isRunning}
            >
              {isRunning ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
              {isRunning ? "运行中" : "运行"}
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1.5 shadow-sm" onClick={handleSubmit}>
              <CheckCircle className="w-3.5 h-3.5" />
              提交代码
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val || "")}
            options={{
              minimap: { enabled: true, scale: 0.75 },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16 }
            }}
          />
        </div>
        <div
          className={`shrink-0 overflow-hidden ${
            isResizingRunnerPanel ? "transition-none" : "transition-[height,opacity] duration-300 ease-out"
          }`}
          style={{
            height: isRunnerPanelVisible ? `${runnerPanelHeight + 14}px` : "0px",
            opacity: isRunnerPanelVisible ? 1 : 0,
          }}
        >
          <div
            className="group shrink-0 border-t border-white/10 bg-white/[0.03] py-1.5 cursor-ns-resize"
            onMouseDown={handleRunnerPanelResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整在线运行区域高度"
          >
            <div className="mx-auto h-1.5 w-16 rounded-full bg-white/10 transition-colors group-hover:bg-white/20" />
          </div>
          <div
            className="min-h-0 bg-[#181818]"
            style={{ height: `${runnerPanelHeight}px`, minHeight: `${RUNNER_PANEL_MIN_HEIGHT}px`, maxHeight: `${RUNNER_PANEL_MAX_HEIGHT}px` }}
          >
            <div className="flex h-full min-h-0 flex-col p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-100">在线运行</p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-0 gap-1.5"
                  onClick={() => {
                    setRunDurationMs(null);
                    setOutputLines([]);
                  }}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  清空输出
                </Button>
              </div>

              <div className="mt-4 flex-1 min-h-0 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium tracking-wide text-slate-400">测试代码</label>
                  <Textarea
                    value={runnerCode}
                    onChange={(event) => setRunnerCode(event.target.value)}
                    placeholder={buildRunnerPlaceholder(language)}
                    className="min-h-24 resize-y border-white/10 bg-white/5 text-sm text-slate-100 placeholder:text-slate-500 font-mono focus-visible:border-primary/60 focus-visible:ring-primary/20"
                    spellCheck={false}
                  />
                  <p className="text-xs text-slate-500">
                    示例：<code>{runnerExamples.returnExample}</code> 或 <code>{runnerExamples.printExample}</code>
                    <span className="ml-2">{runnerExamples.metaText}</span>
                  </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium tracking-wide text-slate-400">运行结果</label>
                    {runDurationMs !== null ? (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{runDurationMs} ms</span>
                    ) : null}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-sm">
                    {outputLines.length > 0 ? (
                      <div className="space-y-2 whitespace-pre-wrap break-words">
                        {outputLines.map((line, index) => (
                          <div
                            key={`${line.type}-${index}`}
                            className={
                              line.type === "error"
                                ? "text-red-300"
                                : line.type === "warn"
                                  ? "text-amber-300"
                                  : line.type === "result"
                                    ? "text-emerald-300"
                                    : line.type === "meta"
                                      ? "text-slate-500"
                                      : "text-slate-200"
                            }
                          >
                            {line.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-slate-500">点击“运行”后，这里会显示 console 输出、返回值或报错信息。</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
