import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Check,
  CheckCircle2,
  Code2,
  FileVideo,
  Layout,
  Sparkles,
  Terminal,
  FileText,
  X,
  FileCode2
} from "lucide-react";
import { 
  ChainOfThought, 
  ChainOfThoughtStep, 
  ChainOfThoughtTrigger, 
  ChainOfThoughtContent 
} from "@/components/ui/chain-of-thought";
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';

type PrepRunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

interface BaseSSEData {
  index: number;
  timestamp: string;
  event: string;
  node: string;
  summary: string;
  run_id: string;
  run_status: PrepRunStatus;
  data?: any;
}

interface SSEEvent {
  id: string;
  event: string;
  data: BaseSSEData;
}

interface Artifact {
  agent_name: string;
  title: string;
  summary: string;
  files: string[];
  output_dir: string;
}

export default function LoadingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedFileUrl, setSelectedFileUrl] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showArtifactPanel, setShowArtifactPanel] = useState(false);

  const [isComplete, setIsComplete] = useState(false);
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeGraphRef = useRef<HTMLDivElement>(null);

  // Connect to real SSE Stream
  useEffect(() => {
    if (!id) return;

    // Add initial connection event
    setEvents([{
      id: '0',
      event: 'connected',
      data: {
        index: 0,
        timestamp: new Date().toISOString(),
        event: 'connected',
        node: 'gateway',
        summary: '已连接。老师正在备课...',
        run_id: id,
        run_status: 'running'
      }
    }]);

    const eventSource = new EventSource(`/api/v1/prep-runs/${id}/events`);

    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as BaseSSEData;
        const newEvent: SSEEvent = {
          id: e.lastEventId || String(Date.now()),
          event: e.type || data.event,
          data
        };

        setEvents(prev => [...prev, newEvent]);

        if (data.event === 'artifact_ready' && data.data?.artifact) {
          setArtifacts(prev => {
            const newArtifact = data.data.artifact;
            if (prev.some(a => a.agent_name === newArtifact.agent_name)) {
              return prev;
            }
            const newList = [...prev, newArtifact];
            if (prev.length === 0 && newArtifact.files && newArtifact.files.length > 0) {
              setShowArtifactPanel(true);
              setTimeout(() => handleOpenFile(newArtifact.files[0]), 300);
            }
            return newList;
          });
        }

        if (data.run_status === 'succeeded' || data.run_status === 'failed' || data.event === 'workflow_completed') {
          setTimeout(() => setIsComplete(true), 500);
          setTimeout(() => setShowFocusMode(true), 2400);
          eventSource.close();
        }
      } catch (err) {
        console.error('Failed to parse SSE data', err);
      }
    };

    // Listen to standard message events or custom events
    // Assuming backend sends custom event types matching the document or generic 'message'
    eventSource.onmessage = handleMessage;
    
    // Explicit event listeners if the backend uses specific event names instead of 'message'
    const customEvents = ['run_created', 'workflow_started', 'state_snapshot', 'node_started', 'plan_ready', 'artifact_ready', 'practice_blueprint_ready', 'manifest_ready', 'report_ready', 'workflow_completed'];
    customEvents.forEach(eventType => {
      eventSource.addEventListener(eventType, handleMessage as any);
    });

    eventSource.onerror = (e) => {
      console.error('SSE Error', e);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [id]);

  // Auto-scroll logic inside terminal
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    if (containerRef.current) {
         containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events]);

  const getNodeIcon = (nodeName: string) => {
    if (nodeName.includes('planner')) return <Layout className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('resource')) return <Code2 className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('practice')) return <Terminal className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('animation')) return <FileVideo className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('system') || nodeName.includes('gateway')) return <Activity className="w-4 h-4 text-[#09f]" />;
    return <Sparkles className="w-4 h-4 text-[#09f]" />;
  };

  const visibleEvents = isExpanded ? events : events.slice(-3);
  const hiddenCount = Math.max(0, events.length - 3);

  const nodeHistory = Array.from(new Set(events.map(e => e.data.node).filter(n => n && n !== 'END' && n !== '__start__')));
  const currentNode = isComplete ? null : nodeHistory[nodeHistory.length - 1];

  // Auto-scroll node graph to right
  useEffect(() => {
    if (nodeGraphRef.current) {
      nodeGraphRef.current.scrollLeft = nodeGraphRef.current.scrollWidth;
    }
  }, [nodeHistory.length]);

  const renderPayload = (ev: SSEEvent) => {
    const d = ev.data.data;
    if (!d) return null;

    if (ev.event === 'plan_ready' && d.plan) {
      return (
        <div className="mt-3 space-y-2 border-l-2 border-[#09f]/30 pl-3 py-1">
          <div className="font-semibold text-slate-700">{d.plan.plan_summary}</div>
          {d.plan.required_materials && (
             <div className="text-sm text-slate-600">
               <span className="font-medium">需要材料:</span> {d.plan.required_materials.join(', ')}
             </div>
          )}
        </div>
      );
    }

    if (ev.event === 'practice_blueprint_ready' && d.practice_blueprint) {
      return (
        <div className="mt-3 space-y-2 border-l-2 border-indigo-400/30 pl-3 py-1 text-sm text-slate-600">
          <div className="font-medium text-slate-700">{d.practice_blueprint.planning_summary}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {d.practice_blueprint.question_allocations?.map((qa: any, idx: number) => (
               <span key={idx} className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs">
                 {qa.question_type} ({qa.count}题)
               </span>
            ))}
          </div>
        </div>
      );
    }

    if (ev.event === 'artifact_ready' && d.artifact) {
      return (
        <div className="mt-3 space-y-2 border-l-2 border-emerald-400/30 pl-3 py-1">
          <div className="font-medium text-slate-700">✅ {d.artifact.title} 就绪</div>
          <div className="text-sm text-slate-600 leading-relaxed">{d.artifact.summary}</div>
          <div className="flex flex-col gap-1 mt-1 text-xs font-mono text-slate-400">
             {d.artifact.files?.map((f: string, i: number) => (
                <button
                  key={i} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowArtifactPanel(true);
                    handleOpenFile(f);
                  }}
                  className="text-left w-fit truncate hover:text-[#09f] hover:underline" 
                  title={f}
                >
                  📄 {f.split('\\').pop()?.split('/').pop()}
                </button>
             ))}
          </div>
        </div>
      );
    }

    if (ev.event === 'artifact_failed' && d.artifact) {
      return (
        <div className="mt-3 space-y-2 border-l-2 border-rose-400/30 pl-3 py-1 bg-rose-50/50 rounded-r-md">
          <div className="font-medium text-rose-700">❌ {d.artifact.title} 失败</div>
          <div className="text-xs text-rose-600 max-h-32 overflow-y-auto custom-scrollbar font-mono p-2 bg-white/50 rounded">
            {d.artifact.notes?.[0] || d.error || 'Unknown error'}
          </div>
        </div>
      );
    }

    if (ev.event === 'artifact_repair_tool_requested' && d.tool_call) {
      return (
        <div className="mt-3 space-y-2 border-l-2 border-amber-400/30 pl-3 py-1 text-xs">
          <div className="font-medium text-amber-700">🔧 修理工具调用: {d.tool_call.action}</div>
          <div className="text-slate-600 bg-slate-50 p-2 rounded">
             <div><span className="font-semibold text-slate-500">文件:</span> {d.tool_call.file_name}</div>
             <div className="text-slate-500 italic mt-1">"{d.tool_call.reason}"</div>
          </div>
        </div>
      );
    }

    if (ev.event === 'artifact_validation_failed') {
      return (
         <div className="mt-3 space-y-2 border-l-2 border-rose-400/30 pl-3 py-1 bg-rose-50/50 rounded-r-md">
           <div className="text-xs text-rose-600 font-mono">
              <span className="font-semibold">校验失败 ({d.attempt}次):</span> 正在尝试自我修复...
           </div>
         </div>
      );
    }

    return null; // Don't show raw json for unhandled events
  };

  const handleOpenFile = async (absolutePath: string) => {
    try {
       setIsLoadingFile(true);
       setFileContent('');
       
       const normalizedPath = absolutePath.replace(/\\/g, '/');
       const outputsIndex = normalizedPath.indexOf(`/outputs/${id}/`);
       
       if (outputsIndex === -1) {
         setFileContent(`Error: File path is not within the run outputs folder.\nPath: ${absolutePath}`);
         return;
       }
       
       const relativePath = normalizedPath.slice(outputsIndex + `/outputs/${id}/`.length);
       
       setSelectedFileUrl(relativePath);
       
       const res = await fetch(`/api/v1/prep-runs/${id}/files/${encodeURIComponent(relativePath)}`);
       if (!res.ok) {
          throw new Error(`Failed to fetch file: ${res.statusText}`);
       }
       const text = await res.text();
       setFileContent(text);
       
    } catch (err) {
       console.error("Error opening file", err);
       setFileContent('Error loading file content. Check browser console for details.');
    } finally {
       setIsLoadingFile(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 font-sans selection:bg-[#09f]/20 transition-colors duration-1000 relative">
      

      <div className="max-w-[1600px] w-full mx-auto px-6 py-10 md:py-12 flex gap-6 items-center justify-center min-h-screen">

        
        {/* Left Section - Loading Animation */}
        <AnimatePresence>
          {!showFocusMode && (
            <motion.div

              exit={{ opacity: 0, width: 0, scale: 0.95, filter: "blur(20px)", margin: 0, padding: 0 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              className={`shrink-0 flex flex-col items-center justify-center overflow-hidden transition-all duration-700 ease-in-out ${showArtifactPanel ? 'w-[320px] lg:w-[400px]' : 'w-[440px] lg:w-[560px]'}`}

            >
              {/* Lottie Animation */}
              <motion.div 
                 initial={{ opacity: 0, y: 30 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.8, ease: "easeOut" }}

                 className={`relative pointer-events-none z-10 mb-6 transition-all duration-700 ease-in-out ${showArtifactPanel ? 'w-80 h-80 md:w-96 md:h-96' : 'w-[360px] h-[360px] md:w-[480px] md:h-[480px]'}`}

              >
                <div className="absolute inset-0 bg-[#09f]/5 blur-[80px] rounded-full mx-auto my-auto animate-pulse" />
                <iframe 
                   src="https://lottie.host/embed/9aa38597-b306-46e0-9153-cc48b8edba2c/y1Nm3ZXwB8.lottie"
                   className="w-full h-full border-none pointer-events-none relative z-10 mix-blend-multiply"
                   title="AI Engine Loading"
                />
              </motion.div>

              {/* Title & Status (blur + fade transition) */}
              <div className="text-center h-24">
                <AnimatePresence mode="wait">
                  <motion.h1 
                     key={isComplete ? "complete" : "loading"}
                     initial={{ opacity: 0, filter: "blur(12px)", y: 10 }}
                     animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                     exit={{ opacity: 0, filter: "blur(12px)", y: -10 }}
                     transition={{ duration: 0.6 }}
                     className={`font-semibold tracking-tight text-gray-900 mb-3 transition-all duration-700 ease-in-out ${showArtifactPanel ? 'text-2xl md:text-3xl' : 'text-3xl md:text-4xl'}`}
                  >
                    {isComplete ? '教师备课完成' : '老师正在准备材料...'}
                  </motion.h1>
                </AnimatePresence>

                <motion.div 
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   transition={{ delay: 0.3 }}
                   className="flex items-center justify-center gap-2 text-gray-500 font-mono text-sm"
                >
                   {isComplete ? (
                     <span className="flex items-center text-emerald-500"><CheckCircle2 className="w-5 h-5 mr-2" /> 系统调度已就绪</span>
                   ) : (
                     <span className="flex items-center gap-2">
                       <span className="relative flex h-2.5 w-2.5 mt-[1px]">
                         <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#09f] opacity-75"></span>
                         <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#09f]"></span>
                       </span>
                       节点执行中
                     </span>
                   )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Action Area (Fades in after focus mode starts) */}
        {showFocusMode && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}

            className="w-[320px] lg:w-[400px] shrink-0 flex flex-col items-center justify-center px-4"

          >
            <div className="w-20 h-20 mb-6 bg-emerald-50 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/10 border border-emerald-100/50">
              <Check className="w-10 h-10 text-emerald-500" strokeWidth={2.5} />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
              备课全部完成
            </h2>
            <p className="text-gray-500 mb-8 max-w-sm text-center">
              所有 AI 智能体子任务均已正确执行，讲义、题库及动画材料就绪。
            </p>
            <button
              onClick={() => {
                if (id) {
                  navigate(`/study/${id}`);
                }
              }}
              className="px-8 py-3.5 rounded-full bg-[#09f] hover:bg-[#08e] text-white font-medium flex items-center gap-2 shadow-[0_4px_25px_rgba(0,153,255,0.35)] transition-all hover:-translate-y-0.5"
            >
              <CheckCircle2 className="w-5 h-5" />
              进入课堂
            </button>
          </motion.div>
        )}


        {/* Middle Section - SSE Event Stream */}

        <motion.div 
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.2 }}
          className={`flex-1 bg-white/70 backdrop-blur-xl border border-slate-200/50 rounded-3xl overflow-hidden shadow-2xl shadow-slate-200/50 p-8 h-[calc(100vh-160px)] min-h-[500px] flex flex-col relative`}

        >
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 tracking-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#09f]" />
                教学备课记录
            </h3>
            {artifacts.length > 0 && !showArtifactPanel && (
              <button 
                onClick={() => setShowArtifactPanel(true)}
                className="font-mono text-xs flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-md font-bold transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                查看产物 ({artifacts.reduce((acc, curr) => acc + (curr.files?.length || 0), 0)})
              </button>
            )}
          </div>

          {/* Node Graph Flow */}
          {nodeHistory.length > 0 && (
             <motion.div 
               ref={nodeGraphRef}
               initial={{ opacity: 0, height: 0 }}
               animate={{ opacity: 1, height: 'auto' }}
               className="mb-6 flex items-center gap-2 overflow-x-auto pb-4 custom-scrollbar shrink-0 scroll-smooth"
             >
               {nodeHistory.map((node, i) => {
                 const isActive = node === currentNode;
                 return (
                   <div key={node} className="flex items-center gap-2 shrink-0">
                     <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all duration-300 ${isActive ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm ring-1 ring-indigo-500/10' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        {getNodeIcon(node)}
                        <span>{node}</span>
                        {isActive && (
                           <span className="relative flex h-2 w-2 ml-1">
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                             <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                           </span>
                        )}
                     </div>
                     {i < nodeHistory.length - 1 && (
                       <div className={`w-8 h-px bg-slate-200`} />
                     )}
                   </div>
                 );
               })}
             </motion.div>
          )}
          
          <div 
             ref={containerRef}
             className="relative flex-1 overflow-y-auto scroll-smooth custom-scrollbar pr-4 -mr-4"
          >
            <ChainOfThought>
              <AnimatePresence>
                {!isExpanded && hiddenCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex justify-center mb-6"
                  >
                    <button 
                      onClick={() => setIsExpanded(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs text-slate-500 font-medium hover:bg-slate-100 hover:text-slate-800 transition-colors"
                    >
                      <span>展开 {hiddenCount} 条较早的执行日志</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {visibleEvents.map((ev, index) => {
                const isVeryNew = index === visibleEvents.length - 1 && !isComplete;
                // Last item gets silver-grey shimmer
                const textShimmerClass = (isVeryNew && !isComplete) ? 'animate-silver-shimmer-slow text-slate-500 font-medium' : 'text-gray-700';

                // Automatically keep the latest 3 items open by default
                const isLastThree = index >= visibleEvents.length - 3;

                return (
                  <ChainOfThoughtStep key={ev.id} defaultOpen={isLastThree}>
                    <ChainOfThoughtTrigger leftIcon={getNodeIcon(ev.data.node)}>
                      <span className={textShimmerClass}>{ev.data.summary}</span>
                    </ChainOfThoughtTrigger>
                    <ChainOfThoughtContent>
                       <div className="text-xs text-gray-500 font-mono mt-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <span>事件: <span className="text-[#09f] font-semibold">{ev.event}</span></span>
                            <span>节点: <span className="text-[#09f] font-semibold">{ev.data.node}</span></span>
                            <span>时间: <span className="text-slate-400">{new Date(ev.data.timestamp).toLocaleTimeString()}</span></span>
                          </div>
                          {ev.data.run_status === 'running' && (
                             <div className="mt-2 flex items-center text-rose-400 animate-pulse">
                               <Activity className="w-3 h-3 mr-1" />
                               运行中...
                             </div>
                          )}
                          {/* Render Meaningful Payloads */}
                          {renderPayload(ev)}
                       </div>
                    </ChainOfThoughtContent>
                  </ChainOfThoughtStep>
                )
              })}
            </ChainOfThought>
            
            {!isComplete && (
               <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="flex items-center gap-2 mt-4 font-mono text-xs font-medium text-gray-400"
               >
                 <span className="animate-pulse font-bold text-[#09f]">_</span> 正在接受持续调度数据...
               </motion.div>
            )}
            
            {/* Invisible element to auto-scroll to */}
            <div ref={scrollRef} className="h-4" />
          </div>
        </motion.div>

        {/* Right Section - Artifacts Stream */}
        <AnimatePresence>
          {showArtifactPanel && (
            <motion.div 
              layout
              initial={{ opacity: 0, width: 0, scale: 0.95 }}
              animate={{ opacity: 1, width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? 500 : 360, scale: 1 }}
              exit={{ opacity: 0, width: 0, scale: 0.95 }}
              transition={{ duration: 0.8, type: "spring", bounce: 0.2 }}
              className="shrink-0 h-[calc(100vh-160px)] min-h-[500px] overflow-hidden"
            >
              <div className="w-[360px] lg:w-[500px] shrink-0 bg-white/70 backdrop-blur-xl border border-slate-200/50 rounded-3xl overflow-hidden shadow-2xl shadow-slate-200/50 h-full flex flex-col relative w-full h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white/80 backdrop-blur top-0 z-10 shrink-0">
                  <div className="flex items-center gap-3 w-full pr-12 min-w-0">
                     <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                       <FileCode2 className="w-4 h-4 text-emerald-500" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <h2 className="text-base font-semibold text-slate-800 tracking-tight flex items-center gap-2">
                         备课产物预览
                       </h2>
                     </div>
                  </div>
                  
                  <button
                    onClick={() => setShowArtifactPanel(false)}
                    className="absolute top-4 right-4 shrink-0 p-1.5 rounded-full hover:bg-slate-100 hover:text-slate-700 text-slate-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                {/* Tabs */}
                <div className="flex items-center gap-2 overflow-x-auto p-2 bg-slate-50/50 border-b border-slate-100/80 custom-scrollbar shrink-0 flex-nowrap min-h-[52px]">
                  {artifacts.flatMap((artifact, idx) => 
                    (artifact.files || []).map((file, fileIdx) => {
                      // Extract filename relative path roughly to compare
                      const normalizedPath = file.replace(/\\/g, '/');
                      const relativePathMatch = normalizedPath.split(`/outputs/${id}/`)[1];
                      const computedRelative = relativePathMatch || file;
                      const isSelected = selectedFileUrl === computedRelative;

                      return (
                        <button
                          key={`${idx}-${fileIdx}`}
                          title={file}
                          onClick={() => handleOpenFile(file)}
                          className={`shrink-0 px-4 py-1.5 rounded-xl text-sm font-medium transition-all ${
                            isSelected 
                              ? 'bg-white text-[#09f] shadow-sm ring-1 ring-slate-200/50' 
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                          }`}
                        >
                          {file.split(/[\\/]/).pop()}
                        </button>
                      );
                    })
                  )}
                </div>
                
                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-slate-50/50 relative custom-scrollbar">
                  {isLoadingFile ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10 w-full h-full">
                       <div className="relative flex h-14 w-14 mb-4">
                         <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#09f] opacity-20"></span>
                         <span className="relative flex rounded-full h-14 w-14 bg-[#09f]/10 items-center justify-center">
                           <div className="w-6 h-6 border-2 border-[#09f] border-t-transparent rounded-full animate-spin"></div>
                         </span>
                       </div>
                       <p className="text-slate-500 font-medium">请求文档中...</p>
                    </div>
                  ) : fileContent ? (
                    <div className="p-6 md:p-8 w-full bg-white/30 min-h-full">
                      {/* Render Markdown */}
                      {selectedFileUrl?.endsWith('.md') ? (
                        <div className="prose prose-custom max-w-none mb-4 leading-relaxed">
                          <ReactMarkdown 
                             remarkPlugins={[remarkGfm, remarkMath]} 
                             rehypePlugins={[rehypeKatex]}
                          >
                            {fileContent}
                          </ReactMarkdown>
                        </div>
                      ) : selectedFileUrl?.endsWith('.json') || selectedFileUrl?.endsWith('.py') || selectedFileUrl?.endsWith('.ts') ? (
                        <pre className="text-[13px] leading-relaxed font-mono bg-slate-900 text-slate-50 p-6 rounded-xl overflow-x-auto">
                          <code>{fileContent}</code>
                        </pre>
                      ) : (
                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed font-mono text-slate-700 bg-slate-50 p-6 rounded-xl border border-slate-100">
                          {fileContent}
                        </div>
                      )}
                    </div>
                  ) : (
                     <div className="flex flex-col items-center justify-center h-full text-slate-400">
                       <FileText className="w-10 h-10 mb-3 opacity-20" />
                       <p className="text-sm">选择一个文件预览</p>
                     </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}


