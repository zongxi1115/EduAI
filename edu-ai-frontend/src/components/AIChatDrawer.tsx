import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Copy, LoaderCircle, SendHorizontal, Sparkles, X } from "lucide-react";
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/api";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestContent: string;
  streaming?: boolean;
};

type SelectionQuestionHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

const STREAM_ENDPOINT = apiUrl("/api/v1/assistant/selection-qa/stream");
const SHEET_SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;

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

function AssistantBubble({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="w-full relative">
      <MessageContent markdown className={`transition-opacity duration-500 ${!content && streaming ? "opacity-50" : "opacity-100"} ${streaming ? "streaming-mode" : ""}`}>
        {content || (streaming ? "思考中..." : "")}
      </MessageContent>
    </div>
  );
}

export interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectionContext: string;
  contextContent?: string;
  initialQuery: string;
}

export function AIChatDrawer({
  isOpen,
  onClose,
  selectionContext,
  contextContent = "",
  initialQuery,
}: AIChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftQuestion, setDraftQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialRequestKeyRef = useRef("");
  const reduceMotion = useReducedMotion();
  const isStreaming = messages.some((message) => message.role === "assistant" && message.streaming);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const streamQuestion = async (
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
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`请求失败（${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      const handleEventBlock = (block: string) => {
        const parsed = parseSseBlock(block);
        if (!parsed) {
          return;
        }

        if (parsed.eventType === "delta") {
          currentAssistantText += typeof parsed.payload?.delta === "string" ? parsed.payload.delta : "";
          setMessages((prev) =>
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              content: currentAssistantText,
              requestContent: currentAssistantText,
              streaming: true,
            }))
          );
          return;
        }

        if (parsed.eventType === "completed") {
          if (typeof parsed.payload?.answer === "string") {
            currentAssistantText = parsed.payload.answer;
          }

          setMessages((prev) =>
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              content: currentAssistantText,
              requestContent: currentAssistantText,
              streaming: false,
            }))
          );
          return;
        }

        if (parsed.eventType === "error") {
          const errorText =
            typeof parsed.payload?.error === "string"
              ? parsed.payload.error
              : "请求出错，请稍后重试。";

          setMessages((prev) =>
            updateLastAssistantMessage(prev, (message) => ({
              ...message,
              content: currentAssistantText
                ? `${currentAssistantText}\n\n请求出错：${errorText}`
                : `请求出错：${errorText}`,
              requestContent: currentAssistantText,
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
      setMessages((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          requestContent: message.requestContent || message.content,
          streaming: false,
        }))
      );
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setMessages([]);
      messagesRef.current = [];
      setDraftQuestion("");
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
  }, [contextContent, initialQuery, isOpen, selectionContext]);

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

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3 }}
            className="fixed inset-0 z-[240] bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[250] flex max-h-screen pt-12">
            <motion.section
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 100, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.95 }}
              transition={reduceMotion ? { duration: 0 } : SHEET_SPRING}
              className="pointer-events-auto flex h-[min(82vh,48rem)] w-full flex-col overflow-hidden border border-x-0 border-b-0 border-border/40 bg-background/95 shadow-2xl backdrop-blur-2xl"
            >
              {/* Drag Handle (Visual only) */}
              <div className="flex w-full justify-center pt-4 pb-1">
                <div className="h-1.5 w-16 rounded-full bg-foreground/10" />
              </div>

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
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 sm:px-8 scroll-smooth">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 pb-4">
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
                            <AssistantBubble content={message.content} streaming={message.streaming} />
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
            </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
