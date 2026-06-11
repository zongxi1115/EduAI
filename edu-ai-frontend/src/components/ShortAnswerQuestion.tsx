import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PenTool, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DraftBoard } from "@/components/DraftBoard";
import { KATEX_RENDER_OPTIONS } from "@/lib/math";
import { X } from "lucide-react";

export interface ShortAnswerQuestionProps {
  questionContent: string;
  onSubmit?: (answer: string) => void;
}

export function ShortAnswerQuestion({ questionContent, onSubmit }: ShortAnswerQuestionProps) {
  const [answer, setAnswer] = useState("");

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(answer);
    } else {
      console.log("提交的简答题答案:", answer);
      alert(`提交的答案: \n${answer}`);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="prose prose-slate max-w-none flex-1 leading-loose">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[[rehypeKatex, KATEX_RENDER_OPTIONS]]}
            components={{
              p: ({ node, ...props }) => <p className="text-base text-gray-900 m-0 mb-3 leading-relaxed" {...props} />,
            }}
          >
            {questionContent}
          </ReactMarkdown>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5 border-blue-200 bg-white text-blue-600 hover:bg-blue-50">
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

      <div>
        <Textarea
          placeholder="请输入你的答案..."
          className="min-h-[160px] resize-y p-3.5 text-base leading-relaxed border-gray-200 focus-visible:ring-blue-500 focus-visible:border-blue-500"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
        />
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSubmit} className="gap-2 px-6 bg-blue-500 hover:bg-blue-600 text-white">
          <CheckCircle className="w-4 h-4" />
          提交答案
        </Button>
      </div>
    </div>
  );
}
