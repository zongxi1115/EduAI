import { useState, useMemo, createContext, useContext, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "mathlive";
import { PenTool, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { DraftBoard } from "@/components/DraftBoard";
import { X } from "lucide-react";

const BlankContext = createContext<{
  answers: string[];
  onChange: (index: number, value: string) => void;
}>({ answers: [], onChange: () => {} });

const CodeRenderer = ({ node, inline, className, children, ...props }: any) => {
  const { answers, onChange } = useContext(BlankContext);
  const text = String(children);
  const match = text.match(/^__BLANK__(\d+)$/);
  const mfRef = useRef<any>(null);
  
  const blankIndex = match ? parseInt(match[1], 10) : -1;

  useEffect(() => {
    if (!mfRef.current || blankIndex === -1) return;
    const mf = mfRef.current;
    
    // Prevent cursor resetting unless value actually changed externally
    if (mf.value !== (answers[blankIndex] || "")) {
      mf.value = answers[blankIndex] || "";
    }

    const handleInput = (ev: Event) => {
      onChange(blankIndex, (ev.target as any).value);
    };

    mf.addEventListener('input', handleInput);
    return () => mf.removeEventListener('input', handleInput);
  }, [blankIndex, answers, onChange]);

  if (match) {
    return (
      <math-field
        ref={mfRef}
        style={{
          display: "inline-block",
          minWidth: "12rem",
          padding: "0.25rem 0.5rem",
          margin: "0 0.5rem",
          border: "none",
          borderBottom: "2px solid #cbd5e1",
          background: "transparent",
          fontSize: "1.125rem",
          transform: "translateY(5px)",
          outline: "none"
        }}
      />
    );
  }
  return <code className={className} {...props}>{children}</code>;
};

const markdownComponents = {
  p: ({ node, ...props }: any) => <p className="text-base text-slate-800 m-0 mb-4" {...props} />,
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
    <div className="w-full flex-1 max-w-4xl mx-auto p-6 bg-white border rounded-xl shadow-sm overflow-y-auto">
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

      <div className="mt-8 pt-4 border-t flex justify-end">
        <Button onClick={handleSubmit} className="gap-2 px-8">
          <CheckCircle className="w-4 h-4" />
          提交填空
        </Button>
      </div>
    </div>
  );
}
