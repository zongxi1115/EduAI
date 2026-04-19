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
    <div className="w-full flex-1 max-w-4xl mx-auto p-6 bg-card text-card-foreground border rounded-xl shadow-sm overflow-y-auto mt-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="prose prose-slate max-w-none flex-1 leading-loose">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              p: ({ node, ...props }) => <p className="text-base text-foreground m-0 mb-4" {...props} />,
            }}
          >
            {questionContent}
          </ReactMarkdown>
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

      <div className="mt-4 mb-6">
        <Textarea
          placeholder="请输入你的答案..."
          className="min-h-[150px] resize-y p-4 text-base leading-relaxed focus-visible:ring-primary/50"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
        />
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button onClick={handleSubmit} className="gap-2 px-8">
          <CheckCircle className="w-4 h-4" />
          提交简答
        </Button>
      </div>
    </div>
  );
}
