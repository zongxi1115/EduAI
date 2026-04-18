import React, { useRef, useState, useEffect } from "react";
import { getStroke } from "perfect-freehand";
import FlowerMenu from "@/components/animata/flower-menu";
import { Pencil, Eraser, Minus, Settings2, Circle, Square, Undo2, Redo2, Type } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type Point = [number, number, number];
type Tool = "pencil" | "eraser" | "line" | "circle" | "rectangle" | "text";
type EraserType = "pixel" | "stroke";
type Stroke = { points: Point[]; color: string; size: number; tool: Tool; text?: string };

export interface DraftBoardExportApi {
  exportImageDataUrl: () => string | null;
  hasContent: boolean;
}

interface DraftBoardProps {
  questionContent?: string;
  onExportReady?: (api: DraftBoardExportApi | null) => void;
}

export function DraftBoard({ questionContent, onExportReady }: DraftBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [history, setHistory] = useState<Stroke[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [activeText, setActiveText] = useState<{x: number, y: number, text: string} | null>(null);
  
  const [tool, setTool] = useState<Tool>("pencil");
  const [eraserType, setEraserType] = useState<EraserType>("pixel");
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);

  const [menuPos, setMenuPos] = useState({ x: 16, y: 16 });
  const [isDraggingMenu, setIsDraggingMenu] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  const stopCanvasInteraction = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  // Auto-resize canvas to match container
  useEffect(() => {
    let animationFrameId: number;
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const ratio = window.devicePixelRatio || 1;
        canvasRef.current.width = clientWidth * ratio;
        canvasRef.current.height = clientHeight * ratio;
        canvasRef.current.style.width = `${clientWidth}px`;
        canvasRef.current.style.height = `${clientHeight}px`;
        // redraw() depends on fresh states, but here we just call a state trigger or redraw
        setCanvasSizeRenderBust(prev => prev + 1);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      animationFrameId = requestAnimationFrame(handleResize);
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  const [canvasSizeRenderBust, setCanvasSizeRenderBust] = useState(0);

  // Redraw strokes
  useEffect(() => {
    redraw();
  }, [strokes, currentStroke, color, size, tool, activeText, canvasSizeRenderBust]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(ratio, ratio);

    const drawStroke = (s: Stroke) => {
      if (s.points.length === 0) return;

      if (s.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
      } else {
        ctx.globalCompositeOperation = "source-over";
      }

      if (s.tool === "pencil" || s.tool === "eraser") {
        const strokePath = getSvgPathFromStroke(
          getStroke(s.points, { size: s.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        );
        ctx.fillStyle = s.tool === "eraser" ? "#000" : s.color;
        ctx.fill(new Path2D(strokePath));
      } else if (s.tool === "line" || s.tool === "circle" || s.tool === "rectangle") {
        if (s.points.length < 2) return;
        const start = s.points[0];
        const end = s.points[s.points.length - 1];
        
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        if (s.tool === "line") {
          ctx.moveTo(start[0], start[1]);
          ctx.lineTo(end[0], end[1]);
        } else if (s.tool === "rectangle") {
          ctx.rect(start[0], start[1], end[0] - start[0], end[1] - start[1]);
        } else if (s.tool === "circle") {
          const radius = Math.sqrt(Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2));
          ctx.arc(start[0], start[1], radius, 0, 2 * Math.PI);
        }
        
        ctx.stroke();
      } else if (s.tool === "text" && s.text) {
        ctx.font = `${s.size * 2}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillStyle = s.color;
        // Basic multi-line support
        s.text.split('\n').forEach((line, i) => {
           ctx.fillText(line, s.points[0][0], s.points[0][1] + i * (s.size * 2 * 1.5));
        });
      }
    };

    strokes.forEach(drawStroke);

    if (currentStroke.length > 0) {
      drawStroke({ points: currentStroke, color, size, tool });
    }
    
    if (activeText && activeText.text) {
      drawStroke({ points: [[activeText.x, activeText.y, 0]], color, size, tool: "text", text: activeText.text });
    }
    
    ctx.restore();
  };

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement> | PointerEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0, 0];
    return [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0.5];
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getPoint(e);
    
    if (activeText) {
      if (activeText.text.trim()) {
        commitAction([...strokes, { points: [[activeText.x, activeText.y, 0]], color, size, tool: "text", text: activeText.text }]);
      }
      setActiveText(null);
      return;
    }

    if (tool === "text") {
      setActiveText({ x: pt[0], y: pt[1], text: "" });
      return;
    }

    setIsDrawing(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "eraser" && eraserType === "stroke") {
      handleStrokeErase(pt);
    } else {
      setCurrentStroke([pt]);
    }
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const pt = getPoint(e);
    if (tool === "eraser" && eraserType === "stroke") {
      handleStrokeErase(pt);
    } else {
      setCurrentStroke((prev) => [...prev, pt]);
    }
  };

  const handleStrokeErase = (pt: Point) => {
    setStrokes(prev => {
      const remaining = prev.filter(s => {
        // approximate bounding box checking or distance checking
        // Check if any point in stroke is within erasing radius
        return !s.points.some(p => Math.hypot(p[0] - pt[0], p[1] - pt[1]) < (size + s.size));
      });
      return remaining;
    });
  };

  const commitAction = (newStrokes: Stroke[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newStrokes);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setStrokes(newStrokes);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setStrokes(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setStrokes(history[historyIndex + 1]);
    }
  };

  const endDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (tool === "eraser" && eraserType === "stroke") {
      if (strokes.length !== history[historyIndex].length) {
        commitAction(strokes);
      }
    } else if (tool !== "text") {
      if (currentStroke.length > 0) {
        commitAction([...strokes, { points: currentStroke, color, size, tool }]);
      }
      setCurrentStroke([]);
    }
  };

  const onMenuPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingMenu(true);
    dragStartPos.current = {
      x: e.clientX - menuPos.x,
      y: e.clientY - menuPos.y,
    };
    // Do NOT setPointerCapture to allow inner labels to receive click events
  };

  const onMenuPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingMenu) return;
    setMenuPos({
      x: e.clientX - dragStartPos.current.x,
      y: e.clientY - dragStartPos.current.y,
    });
  };

  const onMenuPointerUp = () => {
    setIsDraggingMenu(false);
  };

  // Listen to window mouse up just in case pointer leaves the menu area
  useEffect(() => {
    const handleMouseUp = () => setIsDraggingMenu(false);
    window.addEventListener("pointerup", handleMouseUp);
    return () => window.removeEventListener("pointerup", handleMouseUp);
  }, []);

  // Convert exact stroke points to SVG path
  const getSvgPathFromStroke = (stroke: number[][]) => {
    if (!stroke.length) return "";
    const dStr = stroke.reduce(
      (acc, [x0, y0], i, arr) => {
        const next = arr[(i + 1) % arr.length];
        acc.push(x0, y0, (x0 + next[0]) / 2, (y0 + next[1]) / 2);
        return acc;
      },
      ["M", stroke[0][0], stroke[0][1], "Q"] as any[]
    );
    dStr.push("Z");
    return dStr.join(" ");
  };

  const menuItems = [
    { icon: Pencil, onClick: () => setTool("pencil") },
    { icon: Eraser, onClick: () => setTool("eraser") },
    { icon: Minus, onClick: () => setTool("line") },
    { icon: Type, onClick: () => setTool("text") },
  ];

  useEffect(() => {
    if (!onExportReady) {
      return;
    }

    onExportReady({
      exportImageDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return null;
        }
        return canvas.toDataURL("image/png");
      },
      hasContent:
        strokes.length > 0 ||
        currentStroke.length > 0 ||
        Boolean(activeText?.text.trim()),
    });

    return () => {
      onExportReady(null);
    };
  }, [activeText?.text, currentStroke.length, onExportReady, strokes.length]);

  return (
    <div ref={containerRef} className="relative w-full flex-1 h-full min-h-[400px] border rounded-xl overflow-hidden bg-slate-50 shadow-inner">
      {/* Question content rendered underneath the canvas like a printed worksheet */}
      {questionContent && (
        <div className="absolute top-0 left-0 w-full p-6 pb-24 prose prose-slate max-w-none pointer-events-none select-none z-0">
          <ReactMarkdown
             remarkPlugins={[remarkMath]}
             rehypePlugins={[rehypeKatex]}
             components={{
               p: ({node, ...props}) => <p className="text-base text-slate-800 m-0 mb-4" {...props} />,
             }}
          >
            {questionContent}
          </ReactMarkdown>
        </div>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={endDrawing}
        onPointerCancel={endDrawing}
        className={`block relative z-[1] w-full h-full bg-transparent touch-none ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
      />

      {/* Floating Text Input when active */}
      {activeText && (
        <textarea
          ref={(el) => {
            if (el) {
              setTimeout(() => el.focus(), 50);
            }
          }}
          placeholder="输入文字..."
          className="absolute z-30 bg-white/80 backdrop-blur-sm border-2 border-primary border-dashed rounded-md outline-none resize-none p-1 overflow-hidden break-words whitespace-pre shadow-lg"
          style={{
            left: activeText.x,
            top: activeText.y,
            color: color,
            fontSize: `${size * 2}px`,
            lineHeight: 1.5,
            fontFamily: "sans-serif",
            minWidth: "120px",
            minHeight: "40px",
          }}
          value={activeText.text}
          onPointerDown={stopCanvasInteraction}
          onChange={(e) => {
             setActiveText({ ...activeText, text: e.target.value });
             e.target.style.height = "auto";
             e.target.style.height = e.target.scrollHeight + "px";
             e.target.style.width = "auto";
             e.target.style.width = Math.max(120, e.target.scrollWidth) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              if (activeText.text.trim()) {
                commitAction([...strokes, { points: [[activeText.x, activeText.y, 0]], color, size, tool: "text", text: activeText.text }]);
              }
              setActiveText(null);
            }
          }}
          onBlur={() => {
             if (activeText.text.trim()) {
               commitAction([...strokes, { points: [[activeText.x, activeText.y, 0]], color, size, tool: "text", text: activeText.text }]);
             }
             setActiveText(null);
          }}
        />
      )}

      {/* Toolbox Menu */}
      <div 
        className="absolute z-20 select-none touch-none"
        style={{ left: menuPos.x, top: menuPos.y }}
        onPointerDown={onMenuPointerDown}
        onPointerMove={onMenuPointerMove}
        onPointerUp={onMenuPointerUp}
        onPointerCancel={onMenuPointerUp}
      >
        <FlowerMenu 
          menuItems={menuItems} 
          iconColor="#0f172a" 
          backgroundColor="#e2e8f0"
          togglerSize={40}
        />
      </div>

      {/* Floating Toolbar for Settings */}
      <div
        className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-white/80 p-2 shadow-md backdrop-blur"
        onPointerDown={stopCanvasInteraction}
      >
        
        <div className="px-3 flex gap-2 font-medium text-sm text-muted-foreground items-center">
           {tool === "pencil" && <><Pencil className="w-4 h-4"/> 铅笔</>}
           {tool === "eraser" && <><Eraser className="w-4 h-4"/> 橡皮擦</>}
           {(tool === "line" || tool === "circle" || tool === "rectangle") && <><Minus className="w-4 h-4"/> 形状</>}
           {tool === "text" && <><Type className="w-4 h-4"/> 文字</>}
        </div>

        <div className="h-4 w-px bg-border mx-1"></div>
        <div className="flex items-center gap-1 px-1">
           <Button variant="ghost" size="icon" className="rounded-full" onClick={undo} disabled={historyIndex <= 0}>
             <Undo2 className="w-4 h-4" />
           </Button>
           <Button variant="ghost" size="icon" className="rounded-full" onClick={redo} disabled={historyIndex >= history.length - 1}>
             <Redo2 className="w-4 h-4" />
           </Button>
        </div>

        <div className="h-4 w-px bg-border mx-1"></div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Settings2 className="w-5 h-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" side="top" align="center">
             <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">{tool === "text" ? "字体大小" : "笔迹粗细"}: {size}</label>
                    <Slider min={2} max={32} step={1} value={[size]} onValueChange={(v: number[]) => setSize(v[0])} />
                </div>
                
                {tool === "eraser" && (
                  <div className="space-y-2">
                      <label className="text-sm font-medium">擦除模式</label>
                      <div className="flex gap-2">
                         <Button variant={eraserType === "pixel" ? "default" : "outline"} size="sm" onClick={() => setEraserType("pixel")}>涂抹区域</Button>
                         <Button variant={eraserType === "stroke" ? "default" : "outline"} size="sm" onClick={() => setEraserType("stroke")}>擦除整笔</Button>
                      </div>
                  </div>
                )}

                {tool !== "eraser" && (
                  <div className="space-y-2">
                      <label className="text-sm font-medium">颜色</label>
                      <div className="flex gap-2">
                          {["#000000", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"].map(c => (
                              <button
                                key={c}
                                className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"}`}
                                style={{ backgroundColor: c }}
                                onClick={() => setColor(c)}
                              />
                          ))}
                      </div>
                  </div>
                )}

                {(tool === "line" || tool === "circle" || tool === "rectangle") && (
                  <div className="space-y-2">
                      <label className="text-sm font-medium">形状</label>
                      <div className="flex gap-2">
                         <Button variant={tool === "line" ? "default" : "outline"} size="icon" onClick={() => setTool("line")}><Minus className="w-4 h-4" /></Button>
                         <Button variant={tool === "rectangle" ? "default" : "outline"} size="icon" onClick={() => setTool("rectangle")}><Square className="w-4 h-4" /></Button>
                         <Button variant={tool === "circle" ? "default" : "outline"} size="icon" onClick={() => setTool("circle")}><Circle className="w-4 h-4" /></Button>
                      </div>
                  </div>
                )}
             </div>
          </PopoverContent>
        </Popover>

        <Button variant="destructive" size="sm" className="rounded-full px-4" onClick={() => commitAction([])}>
            清空草稿纸
        </Button>
      </div>

    </div>
  );
}
