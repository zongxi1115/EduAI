import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Code2, Copy, Eye, FileCode2, LoaderCircle, SendHorizontal, Sparkles, X } from "lucide-react";
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestContent: string;
  responseMode?: AssistantResponseMode;
  streaming?: boolean;
};

type SelectionQuestionHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type AssistantResponseMode = "markdown" | "html";
type AssistantRenderTarget = "inline" | "artifact";
type HtmlArtifact = {
  title: string;
  html: string;
  complete: boolean;
};
type ArtifactView = "preview" | "code";
type SheetDisplayMode = "half" | "fullscreen" | "collapsed";

const STREAM_ENDPOINT = "/api/v1/assistant/selection-qa/stream";
const SHEET_SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;
const ARTIFACT_OPEN_PATTERN = /<edu-html-artifact\b([^>]*)>/i;
const ARTIFACT_CLOSE_PATTERN = /<\/edu-html-artifact>/i;
const SHEET_DRAG_THRESHOLD = 72;

function withQuotedSelection(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function formatUserMessage(selectionContext: string, question: string) {
  const trimmedQuestion = question.trim();
  const trimmedSelection = selectionContext.trim();

  if (!trimmedSelection) {
    return trimmedQuestion;
  }

  return `${withQuotedSelection(trimmedSelection)}\n\n${trimmedQuestion}`;
}

function updateLastAssistantMessage(
  messages: ChatMessage[],
  updater: (message: ChatMessage) => ChatMessage
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      const nextMessages = [...messages];
      nextMessages[index] = updater(messages[index]);
      return nextMessages;
    }
  }

  return messages;
}

function parseSseBlock(block: string) {
  let eventType = "message";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      eventType,
      payload: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return null;
  }
}

function buildHistoryPayload(messages: ChatMessage[]): SelectionQuestionHistoryItem[] {
  return messages
    .filter((message) => !message.streaming && message.requestContent.trim())
    .map((message) => ({
      role: message.role,
      content: message.requestContent.trim(),
    }));
}

function decodeHtmlAttribute(value: string) {
  if (typeof document === "undefined") {
    return value;
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function extractArtifactTitle(openTagAttributes: string) {
  const titleMatch = openTagAttributes.match(/title\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const rawTitle = titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3] ?? "";
  return decodeHtmlAttribute(rawTitle).trim() || "HTML 展示层";
}

function extractHtmlArtifact(rawText: string): {
  visibleText: string;
  artifact?: HtmlArtifact;
  artifactStarted: boolean;
} {
  const openMatch = rawText.match(ARTIFACT_OPEN_PATTERN);

  if (!openMatch || openMatch.index === undefined) {
    return {
      visibleText: rawText,
      artifactStarted: false,
    };
  }

  const openStart = openMatch.index;
  const openEnd = openStart + openMatch[0].length;
  const afterOpen = rawText.slice(openEnd);
  const closeMatch = afterOpen.match(ARTIFACT_CLOSE_PATTERN);
  const visibleText = rawText.slice(0, openStart).trimEnd();
  const title = extractArtifactTitle(openMatch[1] ?? "");

  if (!closeMatch || closeMatch.index === undefined) {
    return {
      visibleText,
      artifact: {
        title,
        html: afterOpen,
        complete: false,
      },
      artifactStarted: true,
    };
  }

  return {
    visibleText,
    artifactStarted: true,
    artifact: {
      title,
      html: afterOpen.slice(0, closeMatch.index).trim(),
      complete: true,
    },
  };
}

function buildStreamingSrcDoc(html: string) {
  const trimmedHtml = html.trim();

  if (!trimmedHtml) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #334155;
      background: #f8fafc;
    }
  </style>
</head>
<body>正在接收 HTML...</body>
</html>`;
  }

  if (/<html[\s>]/i.test(trimmedHtml) || /<!doctype/i.test(trimmedHtml)) {
    return trimmedHtml;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
${trimmedHtml}
</body>
</html>`;
}

const ARTIFACT_PREVIEW_SHELL = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style id="edu-artifact-stream-style">
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2937;
      background: #ffffff;
    }
    #edu-artifact-stream-root:empty::before {
      content: "正在接收 HTML...";
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #64748b;
      background: #f8fafc;
    }
    .edu-artifact-script-note {
      margin: 12px;
      padding: 10px 12px;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      color: #64748b;
      background: #f8fafc;
      font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>
  <main id="edu-artifact-stream-root"></main>
  <script>
    const root = document.getElementById("edu-artifact-stream-root");
    const styleEl = document.getElementById("edu-artifact-stream-style");
    const baseStyle = styleEl.textContent;
    const stylePattern = new RegExp("<style[^>]*>([\\\\s\\\\S]*?)<\\\\/style>", "gi");
    const bodyPattern = new RegExp("<body[^>]*>([\\\\s\\\\S]*?)(?:<\\\\/body>|$)", "i");
    const headPattern = new RegExp("<head[^>]*>[\\\\s\\\\S]*?(?:<\\\\/head>|$)", "i");
    const scriptPattern = new RegExp("<script[\\\\s\\\\S]*?(?:<\\\\/script>|$)", "gi");
    const htmlOpenPattern = new RegExp("<html[^>]*>", "i");
    const htmlClosePattern = new RegExp("<\\\\/html>", "i");

    function renderPartial(html) {
      const source = String(html || "");
      const styles = [];
      let match;
      while ((match = stylePattern.exec(source))) {
        styles.push(match[1]);
      }

      let body = source;
      const bodyMatch = source.match(bodyPattern);
      if (bodyMatch) {
        body = bodyMatch[1];
      } else {
        body = body
          .replace(/<!doctype[^>]*>/i, "")
          .replace(htmlOpenPattern, "")
          .replace(htmlClosePattern, "")
          .replace(headPattern, "");
      }

      body = body.replace(stylePattern, "");
      body = body.replace(scriptPattern, '<div class="edu-artifact-script-note">脚本会在 HTML 完成后执行。</div>');
      styleEl.textContent = baseStyle + "\\n" + styles.join("\\n");
      root.innerHTML = body.trim();
    }

    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "edu-artifact-preview") {
        return;
      }
      renderPartial(event.data.html);
    });
  </script>
</body>
</html>`;

function StreamingArtifactPreview({ artifact }: { artifact: HtmlArtifact | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = artifact?.html ?? "";
  const srcDoc = artifact?.complete ? buildStreamingSrcDoc(html) : ARTIFACT_PREVIEW_SHELL;

  const sendPreviewHtml = useCallback(() => {
    if (!artifact || artifact.complete) {
      return;
    }

    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "edu-artifact-preview",
        html: artifact.html,
      },
      "*"
    );
  }, [artifact]);

  useEffect(() => {
    sendPreviewHtml();
  }, [sendPreviewHtml]);

  return (
    <iframe
      ref={iframeRef}
      title={artifact?.title ?? "HTML 展示层"}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      onLoad={sendPreviewHtml}
      className="h-full min-h-[22rem] w-full border-0 bg-white"
    />
  );
}

function AssistantBubble({
  content,
  responseMode = "markdown",
  streaming = false,
}: {
  content: string;
  responseMode?: AssistantResponseMode;
  streaming?: boolean;
}) {
  return (
    <div className="w-full relative">
      <MessageContent
        html={responseMode === "html"}
        markdown={responseMode !== "html"}
        className={`transition-opacity duration-500 ${!content && streaming ? "opacity-50" : "opacity-100"} ${streaming ? "streaming-mode" : ""}`}
      >
        {content || (streaming ? "思考中..." : "")}
      </MessageContent>
    </div>
  );
}

function ArtifactPanel({
  artifact,
  generating,
  onClose,
  onCopy,
}: {
  artifact: HtmlArtifact | null;
  generating: boolean;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const [view, setView] = useState<ArtifactView>("preview");
  const codeScrollRef = useRef<HTMLPreElement>(null);
  const reduceMotion = useReducedMotion();
  const isPreview = view === "preview";

  useEffect(() => {
    if (codeScrollRef.current && view === "code") {
      codeScrollRef.current.scrollTop = codeScrollRef.current.scrollHeight;
    }
  }, [artifact?.html, view]);

  return (
    <motion.aside
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 72 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 72 }}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30, mass: 0.9 }}
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm"
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/50 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {artifact?.title || "正在生成展示层"}
            </p>
            <p className="text-xs text-muted-foreground">
              {artifact?.complete ? "已完成" : "流式生成中"} · Sandbox HTML / CSS / JS
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => artifact && onCopy(artifact.html)}
            disabled={!artifact}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="复制展示层 HTML"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="关闭展示层"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
        <div className="inline-flex rounded-lg border border-border/50 bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setView("preview")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              isPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            type="button"
            onClick={() => setView("code")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              !isPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            代码
          </button>
        </div>
        {generating && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            接收中
          </span>
        )}
      </div>

      <div className="relative min-h-[22rem] flex-1 bg-muted/30">
        {artifact || generating ? (
          isPreview ? (
            <StreamingArtifactPreview artifact={artifact} />
          ) : (
            <pre
              ref={codeScrollRef}
              className="h-full min-h-[22rem] overflow-auto bg-zinc-950 p-4 text-xs leading-5 text-zinc-100"
            >
              <code>{artifact?.html || "正在等待 HTML 代码..."}</code>
            </pre>
          )
        ) : (
          <div className="flex h-full min-h-[22rem] flex-col items-center justify-center gap-3 px-6 text-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {generating ? "正在搭建展示层" : "等待 HTML 展示层"}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                完整 HTML 会在这里运行，聊天区只保留简短解释。
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

export interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectionContext: string;
  contextContent?: string;
  initialQuery: string;
  responseMode?: AssistantResponseMode;
  renderTarget?: AssistantRenderTarget;
}

export function AIChatDrawer({
  isOpen,
  onClose,
  selectionContext,
  contextContent = "",
  initialQuery,
  responseMode = "markdown",
  renderTarget = "inline",
}: AIChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [activeArtifact, setActiveArtifact] = useState<HtmlArtifact | null>(null);
  const [artifactGenerating, setArtifactGenerating] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetDisplayMode>("half");
  const [sheetDragY, setSheetDragY] = useState(0);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialRequestKeyRef = useRef("");
  const sheetDragStartYRef = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const isStreaming = messages.some((message) => message.role === "assistant" && message.streaming);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSheetDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    sheetDragStartYRef.current = event.clientY;
    setIsSheetDragging(true);
    setSheetDragY(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSheetDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (sheetDragStartYRef.current === null) {
      return;
    }

    const nextDragY = event.clientY - sheetDragStartYRef.current;
    setSheetDragY(Math.max(-96, Math.min(144, nextDragY)));
  };

  const handleSheetDragEnd = () => {
    const finalDragY = sheetDragY;
    sheetDragStartYRef.current = null;
    setIsSheetDragging(false);
    setSheetDragY(0);

    if (finalDragY <= -SHEET_DRAG_THRESHOLD) {
      setSheetMode("fullscreen");
      return;
    }

    if (finalDragY >= SHEET_DRAG_THRESHOLD) {
      setSheetMode(sheetMode === "fullscreen" ? "half" : "collapsed");
    }
  };

  const handleCollapsedSheetClick = () => {
    if (isSheetDragging || Math.abs(sheetDragY) > 8) {
      return;
    }

    setSheetMode("half");
  };

  const streamQuestion = useCallback(async (
    questionText: string,
    options?: {
      replaceMessages?: boolean;
      historyOverride?: SelectionQuestionHistoryItem[];
      includeSelection?: boolean;
    }
  ) => {
    const question = questionText.trim();
    const selectedText = selectionContext.trim();
    const includeSelection = options?.includeSelection ?? false;

    if (!question || (includeSelection && !selectedText)) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const expectsArtifact = responseMode === "html" && renderTarget === "artifact";

    if (expectsArtifact) {
      setActiveArtifact(null);
      setArtifactGenerating(false);
    } else {
      setArtifactGenerating(false);
    }

    const startedAt = Date.now();
    const userMessage: ChatMessage = {
      id: `user-${startedAt}`,
      role: "user",
      content: includeSelection ? formatUserMessage(selectedText, question) : question,
      requestContent: question,
    };
    const assistantMessage: ChatMessage = {
      id: `assistant-${startedAt}`,
      role: "assistant",
      content: "",
      requestContent: "",
      responseMode,
      streaming: true,
    };

    const existingMessages = options?.replaceMessages ? [] : messagesRef.current;
    const nextMessages = [...existingMessages, userMessage, assistantMessage];
    const historyPayload = options?.historyOverride ?? buildHistoryPayload(existingMessages);

    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setDraftQuestion("");

    let currentAssistantText = "";
    let buffer = "";

    try {
      const response = await fetch(STREAM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: includeSelection ? contextContent.trim() || null : null,
          question,
          selection: includeSelection ? selectedText : null,
          history: historyPayload,
          mode: responseMode,
          render_target: renderTarget,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`请求失败（${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      const applyAssistantText = (rawText: string, streaming: boolean) => {
        const parsedArtifact = expectsArtifact
          ? extractHtmlArtifact(rawText)
          : { visibleText: rawText, artifactStarted: false };

        if (expectsArtifact) {
          if (parsedArtifact.artifact) {
            setActiveArtifact(parsedArtifact.artifact);
            setArtifactGenerating(streaming && !parsedArtifact.artifact.complete);
          } else {
            setArtifactGenerating(streaming && parsedArtifact.artifactStarted);
          }
        }

        setMessages((prev) =>
          updateLastAssistantMessage(prev, (message) => ({
            ...message,
            content: parsedArtifact.visibleText,
            requestContent: parsedArtifact.visibleText,
            streaming,
          }))
        );
      };

      const handleEventBlock = (block: string) => {
        const parsed = parseSseBlock(block);
        if (!parsed) {
          return;
        }

        if (parsed.eventType === "delta") {
          currentAssistantText += typeof parsed.payload?.delta === "string" ? parsed.payload.delta : "";
          applyAssistantText(currentAssistantText, true);
          return;
        }

        if (parsed.eventType === "completed") {
          if (typeof parsed.payload?.answer === "string") {
            currentAssistantText = parsed.payload.answer;
          }

          applyAssistantText(currentAssistantText, false);
          return;
        }

        if (parsed.eventType === "error") {
          const errorText =
            typeof parsed.payload?.error === "string"
              ? parsed.payload.error
              : "请求出错，请稍后重试。";
          const visibleErrorBase = expectsArtifact
            ? extractHtmlArtifact(currentAssistantText).visibleText
            : currentAssistantText;

          setMessages((prev) =>
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              content: visibleErrorBase
                ? `${visibleErrorBase}\n\n请求出错：${errorText}`
                : `请求出错：${errorText}`,
              requestContent: visibleErrorBase,
              streaming: false,
            }))
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        blocks.forEach(handleEventBlock);

        if (done) {
          break;
        }
      }

      if (buffer.trim()) {
        handleEventBlock(buffer);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "请求出错，请稍后重试。";

      setMessages((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          content: message.content
            ? `${message.content}\n\n请求出错：${errorMessage}`
            : `请求出错：${errorMessage}`,
          requestContent: message.requestContent,
          streaming: false,
        }))
      );
    } finally {
      setArtifactGenerating(false);
      setMessages((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          requestContent: message.requestContent || message.content,
          streaming: false,
        }))
      );
    }
  }, [contextContent, renderTarget, responseMode, selectionContext]);

  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setMessages([]);
      messagesRef.current = [];
      setDraftQuestion("");
      setActiveArtifact(null);
      setArtifactGenerating(false);
      setSheetMode("half");
      setSheetDragY(0);
      setIsSheetDragging(false);
      sheetDragStartYRef.current = null;
      initialRequestKeyRef.current = "";
      return;
    }

    const question = initialQuery.trim();
    const selectedText = selectionContext.trim();
    const initialRequestKey = `${selectedText}::${question}`;

    if (initialRequestKeyRef.current === initialRequestKey) {
      return;
    }

    if (!question || !selectedText) {
      const validationMessages = question
        ? [
            {
              id: `assistant-validation-${Date.now()}`,
              role: "assistant" as const,
              content: "没有获取到有效的选中文本，请重新选中内容后再问 AI。",
              requestContent: "没有获取到有效的选中文本，请重新选中内容后再问 AI。",
            },
          ]
        : [];
      setMessages(validationMessages);
      messagesRef.current = validationMessages;
      return;
    }

    initialRequestKeyRef.current = initialRequestKey;
    void streamQuestion(question, {
      replaceMessages: true,
      historyOverride: [],
      includeSelection: true,
    });
  }, [initialQuery, isOpen, selectionContext, streamQuestion]);

  const handleFollowUpSubmit = () => {
    if (isStreaming || !draftQuestion.trim()) {
      return;
    }

    void streamQuestion(draftQuestion, { includeSelection: false });
  };

  const handleFollowUpKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    handleFollowUpSubmit();
  };

  useEffect(() => {
    if (scrollRef.current) {
      const lastMessage = messages[messages.length - 1];
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: lastMessage?.streaming ? "auto" : "smooth",
      });
    }
  }, [messages]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard failures in browsers that block programmatic copy.
    }
  };
  const showArtifactPanel = Boolean(activeArtifact) || artifactGenerating;
  const sheetHeightClass =
    sheetMode === "fullscreen"
      ? "h-[calc(100vh-0.75rem)]"
      : sheetMode === "collapsed"
        ? "h-20"
        : "h-[min(58vh,34rem)]";
  const sheetTopPaddingClass = sheetMode === "fullscreen" ? "pt-3" : "pt-12";
  const sheetMotionTransition = isSheetDragging
    ? { duration: 0 }
    : reduceMotion
      ? { duration: 0 }
      : SHEET_SPRING;
  const collapsedStatus = isStreaming
    ? "回答中"
    : activeArtifact
      ? "展示层已生成"
      : "已收起";

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {sheetMode !== "collapsed" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.3 }}
              className="fixed inset-0 z-[240] bg-black/20 backdrop-blur-sm"
              onClick={onClose}
            />
          )}
          <div className={`pointer-events-none fixed inset-x-0 bottom-0 z-[250] flex max-h-screen ${sheetTopPaddingClass}`}>
            <motion.section
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 100, scale: 0.95 }}
              animate={{ opacity: 1, y: isSheetDragging ? sheetDragY : 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.95 }}
              transition={sheetMotionTransition}
              className={`pointer-events-auto flex ${sheetHeightClass} w-full flex-col overflow-hidden border border-x-0 border-b-0 border-border/40 bg-background/95 shadow-2xl backdrop-blur-2xl`}
            >
              <div className="flex w-full justify-center pt-3 pb-1">
                <button
                  type="button"
                  onPointerDown={handleSheetDragStart}
                  onPointerMove={handleSheetDragMove}
                  onPointerUp={handleSheetDragEnd}
                  onPointerCancel={handleSheetDragEnd}
                  className="group inline-flex h-7 w-28 touch-none items-center justify-center rounded-full"
                  aria-label="拖动调整智能讲解面板"
                >
                  <span className="h-1.5 w-16 rounded-full bg-foreground/15 transition-colors group-hover:bg-foreground/30" />
                </button>
              </div>

              {sheetMode === "collapsed" ? (
                <button
                  type="button"
                  onClick={handleCollapsedSheetClick}
                  className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-between gap-4 px-6 pb-4 text-left sm:px-8"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">AI 智能伴学</span>
                      <span className="block truncate text-xs text-muted-foreground">点击恢复半屏，上拉全屏</span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground">
                    {collapsedStatus}
                  </span>
                </button>
              ) : (
                <>
              {/* Header */}
              <div className="px-6 pb-5 pt-2 sm:px-8 border-b border-border/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-primary">
                      <Sparkles className="h-4 w-4" />
                      AI 智能伴学
                    </div>

                    <div className="space-y-1.5">
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">为你详细解答</h2>
                      <p className="text-sm text-muted-foreground/80">
                        AI 正结合你选中的内容，为你提供专属的知识讲解。
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/50 text-muted-foreground transition-all hover:scale-105 hover:bg-secondary hover:text-foreground active:scale-95"
                    aria-label="关闭智能讲解"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Chat Area */}
              <div className="min-h-0 flex-1 px-6 py-6 sm:px-8">
                <div
                  className={
                    showArtifactPanel
                      ? "grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(24rem,0.9fr)]"
                      : "h-full min-h-0"
                  }
                >
                  <div ref={scrollRef} className="min-h-0 overflow-y-auto scroll-smooth">
                    <div className={`mx-auto flex w-full flex-col gap-8 pb-4 ${showArtifactPanel ? "max-w-none" : "max-w-3xl"}`}>
                      {messages.map((message) => (
                        <Message key={message.id} className={message.role === "user" ? "justify-end" : ""}>
                          {message.role === "assistant" && (
                            <MessageAvatar src="" alt="AI" fallback="AI" />
                          )}

                          <div className="flex max-w-[88%] sm:max-w-[82%] flex-col gap-2">
                            {message.role === "user" ? (
                              <MessageContent
                                className="bg-primary/20 text-foreground [&_blockquote]:my-0 [&_blockquote]:rounded-2xl [&_blockquote]:border [&_blockquote]:border-primary/20 [&_blockquote]:bg-background/80 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-foreground/70 [&_blockquote]:shadow-sm [&_blockquote_p]:m-0"
                                markdown
                              >
                                {message.content}
                              </MessageContent>
                            ) : (
                              <motion.div
                                initial={{ opacity: 0, filter: "blur(5px)" }}
                                animate={{ opacity: 1, filter: "blur(0px)" }}
                                transition={{ duration: 0.35, ease: "easeOut" }}
                              >
                                <AssistantBubble
                                  content={message.content}
                                  responseMode={message.responseMode}
                                  streaming={message.streaming}
                                />
                              </motion.div>
                            )}

                            {message.role === "assistant" && !message.streaming && message.content.trim() && (
                              <MessageActions className="opacity-0 transition-opacity duration-200 group-hover/message:opacity-100 mt-0.5">
                                <MessageAction tooltip="复制回答">
                                  <button
                                    type="button"
                                    onClick={() => void copyMessage(message.content)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                </MessageAction>
                              </MessageActions>
                            )}
                          </div>

                          {message.role === "user" && (
                            <MessageAvatar src="" alt="我" fallback="我" />
                          )}
                        </Message>
                      ))}
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {showArtifactPanel && (
                      <ArtifactPanel
                        key="html-artifact"
                        artifact={activeArtifact}
                        generating={artifactGenerating}
                        onClose={() => {
                          setActiveArtifact(null);
                          setArtifactGenerating(false);
                        }}
                        onCopy={(html) => void copyMessage(html)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="border-t border-border/30 px-6 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  <Textarea
                    value={draftQuestion}
                    onChange={(event) => setDraftQuestion(event.target.value)}
                    onKeyDown={handleFollowUpKeyDown}
                    placeholder="继续追问这段内容，按 Enter 发送，Shift + Enter 换行"
                    disabled={isStreaming}
                    spellCheck={false}
                    className="min-h-24 resize-none bg-background/70 px-4 py-3 text-sm"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      追问会继续基于当前选中内容和已完成的对话历史。
                    </p>

                    <Button
                      type="button"
                      onClick={handleFollowUpSubmit}
                      disabled={isStreaming || !draftQuestion.trim()}
                      className="gap-2"
                    >
                      {isStreaming ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          回答中
                        </>
                      ) : (
                        <>
                          <SendHorizontal className="h-4 w-4" />
                          发送追问
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
                </>
              )}
            </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
