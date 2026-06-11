import { useState, useMemo, createContext, useContext, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import "katex/dist/katex.min.css";
import "mathlive";
import { PenTool, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DraftBoard } from "@/components/DraftBoard";
import { X } from "lucide-react";

const BlankContext = createContext<{
  answers: string[];
  onChange: (index: number, value: string) => void;
}>({ answers: [], onChange: () => { } });

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CodeRenderer = ({ node, inline, className, children, ...props }: any) => {
  const { answers, onChange } = useContext(BlankContext);
  const text = String(children);
  const match = text.match(/^__BLANK__(\d+)$/);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const mfRef = useRef<any>(null);

  const blankIndex = match ? parseInt(match[1], 10) : -1;
  const currentValue = blankIndex === -1 ? "" : answers[blankIndex] || "";
  const renderedAnswerHtml = useMemo(() => {
    if (!currentValue.trim()) {
      return "";
    }

    try {
      return katex.renderToString(currentValue, {
        throwOnError: false,
        displayMode: false,
        strict: "ignore",
      });
    } catch {
      return escapeHtml(currentValue);
    }
  }, [currentValue]);
  const handleConfirm = () => {
    if (blankIndex === -1) return;
    const nextValue = String(mfRef.current?.value ?? draftValue ?? "");
    setDraftValue(nextValue);
    onChange(blankIndex, nextValue);
    setIsEditorOpen(false);
  };

  useEffect(() => {
    if (blankIndex === -1 || isEditorOpen) return;
    setDraftValue(currentValue);
  }, [blankIndex, currentValue, isEditorOpen]);

  useEffect(() => {
    if (!isEditorOpen || !mfRef.current || blankIndex === -1) return;
    const mf = mfRef.current;

    if (mf.value !== draftValue) {
      mf.value = draftValue;
    }

    queueMicrotask(() => {
      if (mfRef.current && mfRef.current.value !== draftValue) {
        mfRef.current.value = draftValue;
      }
    });

    const handleInput = (ev: Event) => {
      setDraftValue((ev.target as any).value || "");
    };

    mf.addEventListener("input", handleInput);
    return () => mf.removeEventListener("input", handleInput);
  }, [blankIndex, draftValue, isEditorOpen]);

  if (match) {
    return (
      <Popover
        open={isEditorOpen}
        onOpenChange={(open) => {
          if (open) {
            setDraftValue(currentValue);
          }
          setIsEditorOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`编辑第 ${blankIndex + 1} 空`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              width: currentValue.trim() ? "fit-content" : "12rem",
              minWidth: "12rem",
              maxWidth: "100%",
              margin: "0 0.5rem",
              padding: "0.25rem 0.25rem 0.3rem",
              border: "none",
              borderBottom: "2px solid var(--border)",
              boxShadow: "inset 0 -1px 0 0 color-mix(in oklab, var(--foreground) 14%, transparent)",
              color: "var(--foreground)",
              background: "transparent",
              fontSize: "1.125rem",
              lineHeight: "1.6",
              verticalAlign: "baseline",
              outline: "none",
              boxSizing: "border-box",
              borderRadius: "0",
              cursor: "text",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                opacity: currentValue ? 1 : 0.5,
                overflow: "hidden",
              }}
            >
              {currentValue.trim() ? (
                <span
                  dangerouslySetInnerHTML={{ __html: renderedAnswerHtml }}
                  style={{ display: "inline-flex", alignItems: "center", fontSize: "0.95rem" }}
                />
              ) : (
                "点击输入答案"
              )}
            </span>
            <PenTool className="h-4 w-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>

        <PopoverContent side="bottom" align="start" sideOffset={10} className="w-[min(28rem,calc(100vw-2rem))] p-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">编辑第 {blankIndex + 1} 空</div>
              <div className="text-xs text-muted-foreground">支持公式输入，不会影响正文排版。</div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
              <math-field
                ref={mfRef}
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: "3rem",
                  padding: "0.5rem 0",
                  border: "none",
                  color: "var(--foreground)",
                  background: "transparent",
                  fontSize: "1.125rem",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              当前内容：{draftValue || "（空）"}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditorOpen(false)}>取消</Button>
              <Button onClick={handleConfirm}>
                完成
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }
  return <code className={className} {...props}>{children}</code>;
};

const markdownComponents = {
  p: ({ node, ...props }: any) => <p className="text-base text-foreground m-0 mb-4" {...props} />,
  code: CodeRenderer,
};

export interface FillInTheBlanksQuestionProps {
  questionContent: string; // Markdown + LaTeX (with '___' or '\\_\\_\\_' indicating blanks)
  onSubmit?: (answers: string[]) => void;
}

export function FillInTheBlanksQuestion({ questionContent, onSubmit }: FillInTheBlanksQuestionProps) {
  // Pre-process underscores into code blocks so that react-markdown parses them correctly
  const { processedContent, blankCount } = useMemo(() => {
    let count = 0;
    // Match 3 or more underscores, or 3 or more backslash-escaped underscores
    const processed = questionContent.replace(/(?:\\?_){3,}/g, () => {
      const currentId = count++;
      return `\`__BLANK__${currentId}\``;
    });
    return { processedContent: processed, blankCount: count };
  }, [questionContent]);

  const [answers, setAnswers] = useState<string[]>(Array(blankCount || 0).fill(""));

  const handleInputChange = (index: number, value: string) => {
    setAnswers(prev => {
      const next = [...prev];
      if (next.length < blankCount) {
        next.length = blankCount;
        for (let i = 0; i < next.length; i++) if (next[i] === undefined) next[i] = "";
      }
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(answers);
    } else {
      console.log("提交的填空结果 (LaTeX):", answers);
      alert(`提交的LaTeX结果: \n${answers.join("\n")}`);
    }
  };

  return (
    <div className="custom-scrollbar w-full flex-1 max-w-4xl mx-auto p-6 bg-card text-card-foreground border rounded-xl shadow-sm overflow-y-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="prose prose-slate max-w-none flex-1 leading-loose">
          <BlankContext.Provider value={{ answers, onChange: handleInputChange }}>
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents}
            >
              {processedContent}
            </ReactMarkdown>
          </BlankContext.Provider>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 gap-2 text-primary border-primary/20 hover:bg-primary/10 transition-colors">
              <PenTool className="w-4 h-4" />
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
                  className="absolute top-4 right-4 z-[9999] rounded-full shadow-lg border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors bg-background/80 backdrop-blur-sm"
                >
                  <X className="w-5 h-5" />
                  <span className="sr-only">关闭全屏草稿纸</span>
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-8 pt-4 border-t flex justify-end">
        <Button onClick={handleSubmit} className="gap-2 px-8">
          <CheckCircle className="w-4 h-4" />
          提交填空
        </Button>
      </div>
    </div>
  );
}
