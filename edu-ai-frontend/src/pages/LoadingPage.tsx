import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  FileVideo,
  Layout,
  Sparkles,
  Terminal,
} from "lucide-react";

type PrepRunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

interface BaseSSEData {
  index: number;
  timestamp: string;
  event: string;
  node: string;
  summary: string;
  run_id: string;
  run_status: PrepRunStatus;
}

interface SSEEvent {
  id: string;
  event: string;
  data: BaseSSEData;
}

export default function LoadingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
        summary: '已连接到AI教学引擎。正在等待数据流...',
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
  }, [events, isExpanded]);

  const getNodeIcon = (nodeName: string) => {
    if (nodeName.includes('planner')) return <Layout className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('resource')) return <Code2 className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('practice')) return <Terminal className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('animation')) return <FileVideo className="w-4 h-4 text-[#09f]" />;
    if (nodeName.includes('system') || nodeName.includes('gateway')) return <Activity className="w-4 h-4 text-[#09f]" />;
    return <Sparkles className="w-4 h-4 text-[#09f]" />;
  };

  const getEventBadgeClass = (eventName: string) => {
    if (eventName.includes('started')) return 'bg-blue-50 text-blue-600 border-blue-200';
    if (eventName.includes('ready') || eventName.includes('completed')) return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    if (eventName.includes('failed')) return 'bg-rose-50 text-rose-600 border-rose-200';
    return 'bg-gray-100 text-gray-500 border-gray-200';
  };

  // Logic to only show last 3 items when not expanded
  const visibleEvents = isExpanded ? events : events.slice(-3);
  const hiddenCount = Math.max(0, events.length - 3);

  // Since we don't know the exact total events in real SSE, we approximate it or use a pseudo-progress based on index
  const expectedTotalEvents = 15;
  const progressPercent = Math.min(100, Math.round((events.length / expectedTotalEvents) * 100));

  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 font-sans selection:bg-[#09f]/20 transition-colors duration-1000">
      
      {/* Top Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50 overflow-hidden">
        <motion.div 
          className="h-full bg-[#09f] shadow-[0_0_15px_#09f]"
          initial={{ width: '0%' }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ ease: "circOut", duration: 0.5 }}
        />
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 md:py-20 flex flex-col items-center justify-center min-h-screen">
        
        {/* Top Header Section with Lottie and Blur Text */}
        <AnimatePresence>
          {!showFocusMode && (
            <motion.div
              exit={{ opacity: 0, height: 0, scale: 0.95, filter: "blur(20px)" }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              className="w-full flex flex-col items-center overflow-hidden"
            >
              {/* Lottie Animation */}
              <motion.div 
                 initial={{ opacity: 0, y: 30 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.8, ease: "easeOut" }}
                 className="relative w-56 h-56 md:w-72 md:h-72 pointer-events-none z-10 mb-6"
              >
                <div className="absolute inset-0 bg-[#09f]/5 blur-[80px] rounded-full mx-auto my-auto animate-pulse" />
                <iframe 
                   src="https://lottie.host/embed/9aa38597-b306-46e0-9153-cc48b8edba2c/y1Nm3ZXwB8.lottie"
                   className="w-full h-full border-none pointer-events-none relative z-10 mix-blend-multiply"
                   title="AI Engine Loading"
                />
              </motion.div>

              {/* Title & Status (blur + fade transition) */}
              <div className="text-center mb-10 h-24">
                <AnimatePresence mode="wait">
                  <motion.h1 
                     key={isComplete ? "complete" : "loading"}
                     initial={{ opacity: 0, filter: "blur(12px)", y: 10 }}
                     animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                     exit={{ opacity: 0, filter: "blur(12px)", y: -10 }}
                     transition={{ duration: 0.6 }}
                     className="text-3xl md:text-3xl font-semibold tracking-tight text-gray-900 mb-3"
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
                       节点执行中 · {progressPercent}%
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
            className="mb-8 w-full flex flex-col items-center"
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

        {/* SSE Event Stream Terminal (Stays visible) */}
        <motion.div 
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.2 }}
          className="w-full bg-white border border-gray-200/80 rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/5 relative"
        >
          {/* Terminal Header */}
          <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/80 flex items-center justify-between">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-400/30 border border-rose-400/80" />
              <div className="w-3 h-3 rounded-full bg-amber-400/30 border border-amber-400/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-400/30 border border-emerald-400/80" />
            </div>
            <div className="font-mono text-[10px] text-gray-400 uppercase tracking-widest flex items-center gap-4 hidden sm:flex">
              <span>Run ID: {id}</span>
              <span className="flex items-center"><Activity className="w-3 h-3 mr-1"/> retry: 3000ms</span>
            </div>
          </div>

          {/* Stream Content */}
          <div 
             ref={containerRef}
             className="relative p-5 h-[340px] overflow-y-auto scroll-smooth custom-scrollbar bg-white"
          >
            {/* Expand History Button */}
            <AnimatePresence>
              {!isExpanded && hiddenCount > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex justify-center mb-4"
                >
                  <button 
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-500 font-medium hover:bg-gray-100 hover:text-gray-800 transition-colors"
                  >
                    <span>{hiddenCount} 条较早的执行日志</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {visibleEvents.map((ev, index) => {
                const isVeryNew = index === visibleEvents.length - 1 && !isComplete;
                // Last item gets shimmer if we are still processing
                const textShimmerClass = (isVeryNew && !isComplete) ? 'animate-text-shimmer font-semibold' : 'text-gray-700';
                
                return (
                  <motion.div
                    key={ev.id}
                    layout="position"
                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, filter: "blur(4px)", scale: 0.95, height: 0, overflow: 'hidden' }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className={`mb-3 last:mb-0 group`}
                  >
                    <div className="flex items-start gap-4 p-3 rounded-xl border border-transparent hover:border-gray-100 hover:bg-gray-50/50 transition-colors bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                      {/* Left: Icon & Line */}
                      <div className="flex flex-col items-center mt-0.5 shrink-0">
                         <div className={`p-1.5 rounded-lg border shadow-sm transition-all ${isVeryNew ? 'bg-blue-50 border-blue-200 shadow-blue-500/20' : 'bg-gray-50 border-gray-200'}`}>
                            {getNodeIcon(ev.data.node)}
                         </div>
                      </div>

                      {/* Right: Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <span className="font-mono text-[11px] font-medium text-[#09f] tracking-wide shrink-0">
                            id:{String(ev.data.index).padStart(2, '0')}
                          </span>
                          <span className="text-gray-300 mx-[-2px]">|</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono uppercase tracking-wider border ${getEventBadgeClass(ev.event)} shrink-0`}>
                            {ev.event}
                          </span>
                          <span className="font-mono text-[10px] font-medium text-gray-400 ml-auto shrink-0 hidden sm:block">
                            {new Date(ev.data.timestamp).toISOString().split('T')[1].replace('Z', '')}
                          </span>
                        </div>
                        
                        <div className={`text-[15px] leading-relaxed mt-1 ${textShimmerClass}`}>
                          {ev.data.summary}
                        </div>

                        {/* Expandable/Extra Info (simulated) */}
                        <div className="mt-2 text-xs font-mono text-gray-400 flex gap-4 hidden group-hover:flex transition-opacity">
                          <span>node: {ev.data.node}</span>
                          <span className="flex items-center gap-1">
                            status: {ev.data.run_status === 'running' ? <span className="w-1.5 h-1.5 bg-[#09f] rounded-full animate-pulse"/> : null} 
                            {ev.data.run_status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {/* Invisible element to auto-scroll to */}
              <div ref={scrollRef} className="h-4" />
            </AnimatePresence>
            
            {/* Pulsing indicator when running */}
            {!isComplete && (
               <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="flex items-center gap-2 pl-[3.25rem] mt-3 font-mono text-xs font-medium text-gray-400"
               >
                 <span className="animate-pulse font-bold text-[#09f]">_</span> 正在接受持续调度数据...
               </motion.div>
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}


