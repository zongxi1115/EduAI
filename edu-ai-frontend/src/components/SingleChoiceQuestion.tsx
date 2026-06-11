import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { DraftBoard } from "@/components/DraftBoard";
import { KATEX_RENDER_OPTIONS } from "@/lib/math";
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
  const draftQuestionContent = [
    questionContent,
    options.length > 0
      ? options.map((option) => `**${option.id}.** ${option.content}`).join("\n\n")
      : "",
  ].filter(Boolean).join("\n\n");

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="prose prose-slate max-w-none flex-1">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[[rehypeKatex, KATEX_RENDER_OPTIONS]]}
            components={{
              p: ({ ...props }) => <p className="text-base text-gray-900 m-0 mb-3 leading-relaxed" {...props} />,
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
          {/* @ts-expect-error shadcn DialogContent wrapper accepts showCloseButton at runtime. */}
          <DialogContent className="fixed inset-0 m-0 max-w-none max-h-none h-[100dvh] w-[100dvw] p-0 flex flex-col rounded-none overflow-hidden border-none top-0 left-0 translate-x-0 translate-y-0 sm:max-w-none" showCloseButton={false}>
            <DialogTitle className="sr-only">在线草稿纸</DialogTitle>

            <div className="flex-1 w-full h-full relative">
              <DraftBoard questionContent={draftQuestionContent} />

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

      <div className="space-y-2.5">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          return (
            <div
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={`group relative p-3.5 border rounded-lg cursor-pointer transition-all ${
                isSelected
                  ? "border-blue-400 bg-blue-50/50"
                  : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* 圆形单选框 */}
                <div className="relative mt-0.5 shrink-0">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-500"
                        : "border-gray-300 bg-white group-hover:border-blue-400"
                    }`}
                  >
                    {isSelected && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>

                {/* 选项标识 */}
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold transition-colors ${
                    isSelected
                      ? "text-blue-600"
                      : "text-gray-600 group-hover:text-blue-500"
                  }`}
                >
                  {option.id}
                </div>

                {/* 选项内容 */}
                <div className={`prose prose-slate max-w-none flex-1 overflow-hidden transition-colors ${isSelected ? "text-gray-900" : "text-gray-700"}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[[rehypeKatex, KATEX_RENDER_OPTIONS]]}
                    components={{
                      p: ({ ...props }) => <p className="m-0 leading-relaxed" {...props} />,
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

      <div className="flex justify-end pt-2">
        <Button
          disabled={!selectedId}
          onClick={() => onSelect && onSelect(selectedId!)}
          className="gap-2 px-6 bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          提交答案
        </Button>
      </div>
    </div>
  );
}
