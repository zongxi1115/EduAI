import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { DraftBoard } from "@/components/DraftBoard";
import { X } from "lucide-react";

export interface Option {
  id: string;
  content: string; // Markdown + LaTeX
}

export interface SingleChoiceQuestionProps {
  questionContent: string; // Markdown + LaTeX
  options: Option[];
  onSelect?: (optionId: string) => void;
}

export function SingleChoiceQuestion({ questionContent, options, onSelect }: SingleChoiceQuestionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  return (
    <div className="w-full flex-1 max-w-4xl mx-auto p-6 bg-card text-card-foreground border rounded-xl shadow-sm overflow-y-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="prose prose-slate max-w-none flex-1">
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

            {/* DraftBoard fills entire modal */}
            <div className="flex-1 w-full h-full relative">
              <DraftBoard questionContent={questionContent} />

              {/* Custom Close Button to ensure it renders above the absolutely positioned DraftBoard elements */}
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

      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          return (
            <div
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${isSelected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-border hover:bg-muted/50"
                }`}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 shrink-0 flex items-center justify-center w-6 h-6 rounded-full border text-sm font-medium transition-colors ${isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border text-muted-foreground bg-card text-card-foreground"
                  }`}>
                  {option.id}
                </div>
                <div className={`prose prose-slate max-w-none flex-1 overflow-hidden ${isSelected ? "text-primary" : "text-foreground"}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p: ({ node, ...props }) => <p className="m-0" {...props} />,
                    }}
                  >
                    {option.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          disabled={!selectedId}
          onClick={() => onSelect && onSelect(selectedId!)}
          className="gap-2 px-8"
        >
          提交答案
        </Button>
      </div>
    </div>
  );
}
