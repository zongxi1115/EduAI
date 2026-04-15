import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PenTool, Play, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { DraftBoard } from "@/components/DraftBoard";
import { X } from "lucide-react";
import Editor from "@monaco-editor/react";

export interface ProgrammingQuestionProps {
  questionContent: string; // Markdown + LaTeX
  initialCode?: string;
  language?: string;
  onSubmit?: (code: string) => void;
}

export function ProgrammingQuestion({ questionContent, initialCode = "", language = "javascript", onSubmit }: ProgrammingQuestionProps) {
  const [code, setCode] = useState(initialCode);

  const handleSubmit = () => {
    if (onSubmit) onSubmit(code);
  };

  return (
    <div className="w-full flex-1 max-w-6xl mx-auto bg-white border rounded-xl shadow-sm h-[800px] flex flex-col md:flex-row overflow-hidden">
      {/* Left side: Problem Description */}
      <div className="w-full md:w-1/2 flex flex-col h-full bg-slate-50 border-r relative z-10 shrink-0">
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
      <div className="w-full md:w-1/2 flex flex-col h-full bg-[#1e1e1e] relative z-20">
        <div className="flex items-center justify-between p-3 pl-5 border-b border-white/10 shrink-0 bg-[#252526]">
          <span className="text-xs font-semibold text-slate-400  tracking-widest">{language}</span>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-0 gap-1.5 transition-colors" onClick={() => {}}>
              <Play className="w-3 h-3 fill-current" />
              运行
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1.5 shadow-sm" onClick={handleSubmit}>
              <CheckCircle className="w-3.5 h-3.5" />
              提交代码
            </Button>
          </div>
        </div>
        <div className="flex-1 relative bg-[#1e1e1e]">
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
      </div>
    </div>
  );
}
