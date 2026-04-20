import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CheckCircle, Maximize2, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraftBoard, type DraftBoardExportApi } from "@/components/DraftBoard";

export interface DrawingSubmission {
  imageDataUrl: string | null;
  hasDrawingContent: boolean;
}

export interface DrawingQuestionProps {
  questionContent: string;
  onSubmit?: (submission: DrawingSubmission) => void;
}

export function DrawingQuestion({ questionContent, onSubmit }: DrawingQuestionProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draftBoardExportApi, setDraftBoardExportApi] = useState<DraftBoardExportApi | null>(null);

  const handleSubmit = () => {
    const submission: DrawingSubmission = {
      imageDataUrl: draftBoardExportApi?.exportImageDataUrl() ?? null,
      hasDrawingContent: draftBoardExportApi?.hasContent ?? false,
    };

    if (onSubmit) {
      onSubmit(submission);
    } else {
      console.log("提交的作图题", submission);
      alert("作图题提交成功！");
    }
  };

  return (
    <div className="custom-scrollbar w-full flex-1 max-w-4xl mx-auto p-6 bg-card text-card-foreground border rounded-xl shadow-sm overflow-y-auto mt-6">
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

        <Button onClick={() => setIsFullscreen(true)} variant="outline" size="sm" className="shrink-0 gap-2 text-primary border-primary/20 hover:bg-primary/10 transition-colors">
          <Maximize2 className="w-4 h-4" />
          全屏编辑
        </Button>
      </div>

      <div className={
        isFullscreen
          ? "fixed inset-0 z-[9999] bg-card text-card-foreground flex flex-col m-0 p-0 overflow-hidden"
          : "w-full h-[600px] border-2 border-border rounded-xl overflow-hidden relative shadow-sm mb-6 bg-muted/50"
      }>
        <div className="absolute top-4 left-4 z-[50] text-sm text-muted-foreground bg-background/80 px-3 py-1 rounded-full shadow-sm select-none pointer-events-none hidden sm:block">
          {isFullscreen ? "全屏作图区" : "绘图区"}
        </div>

        {isFullscreen && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-[9999] rounded-full shadow-lg border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors bg-background/80 backdrop-blur-sm"
          >
            <Shrink className="w-5 h-5" />
            <span className="sr-only">退出全屏</span>
          </Button>
        )}

        {/* Instead of redefining DraftBoard and unmounting, we just re-render within the same container. 
            Because its parent div changed CSS, it automatically resizes. */}
        <DraftBoard
          questionContent={isFullscreen ? questionContent : undefined}
          onExportReady={setDraftBoardExportApi}
        />
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button onClick={handleSubmit} className="gap-2 px-8">
          <CheckCircle className="w-4 h-4" />
          提交作图
        </Button>
      </div>
    </div>
  );
}
