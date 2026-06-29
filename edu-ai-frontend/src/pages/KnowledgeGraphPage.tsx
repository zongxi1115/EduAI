import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  X,
  ArrowLeft,
  Network,
  Play,
  LoaderCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getOrCreateGuestLearnerId } from "@/lib/learner";

/* ───────── Types ───────── */

type GraphPayload = {
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
};

type GraphDataset = {
  id: string;
  title: string;
  file: string;
  entry_points: string[];
  graph: GraphPayload;
};

type GraphIndexResponse = {
  schema_version: string;
  description: string;
  datasets: GraphDataset[];
};

type LearningGraphContext = {
  dataset_id: string | null;
  course_group_id: string | null;
  course_id: string | null;
  focus_node_id: string | null;
  focus_node_title: string | null;
  source_graph_id: string | null;
};

/* ───────── Helpers ───────── */

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDifficultyStars(difficulty: unknown) {
  const numericDifficulty =
    typeof difficulty === "number" && Number.isFinite(difficulty)
      ? Math.max(1, Math.min(6, Math.round(difficulty)))
      : null;

  if (numericDifficulty == null) return null;

  return {
    level: numericDifficulty,
    stars: `${"★".repeat(numericDifficulty)}${"☆".repeat(6 - numericDifficulty)}`,
  };
}

/**
 * Course-group aware color map.
 * When the active dataset is ai_foundation_course_groups, each top-level node
 * (课程群) gets its own colour, and sub-nodes inherit the parent's colour
 * at reduced saturation.  Otherwise fall back to the original two-colour scheme.
 */
const GROUP_PALETTE: Record<string, string> = {
  数学基础课程群: "#6366f1", // indigo
  编程基础课程群: "#10b981", // emerald
  AI核心课程群: "#8b5cf6", // violet
  数据处理课程群: "#f59e0b", // amber
  实践应用课程群: "#f43f5e", // rose
};

const MODULE_COLOR = "#3b82f6";
const SUB_COLOR = "#10b981";

function resolveNodeColor(
  node: Record<string, any>,
  isCourseGroups: boolean,
): string {
  if (!isCourseGroups) {
    return node.isModule ? MODULE_COLOR : SUB_COLOR;
  }
  // For course-groups: top-level nodes use the palette, sub-nodes inherit parent
  if (node.isModule && GROUP_PALETTE[node.id]) return GROUP_PALETTE[node.id];
  if (!node.isModule && node.parentId) {
    const parentKey = String(node.parentId).split("::")[0];
    return GROUP_PALETTE[parentKey] ?? MODULE_COLOR;
  }
  return MODULE_COLOR;
}

const EDGE_RELATION_COLORS: Record<string, string> = {
  prerequisite: "#ef4444",
  supports: "#94a3b8",
};

interface CreatePrepRunResponse {
  run_id?: string;
}

/* ───────── Main Component ───────── */

export default function KnowledgeGraphPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams<{ id: string }>();
  const graphRef = useRef<any>(null);
  const [datasets, setDatasets] = useState<GraphDataset[]>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"module" | "full">("module");
  const [hoverNode, setHoverNode] = useState<any | null>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [learningTaskId, setLearningTaskId] = useState<string | null>(null);
  const [guestLearnerId] = useState(() => getOrCreateGuestLearnerId());
  const { user } = useAuth();
  const learnerId = user?.learner_id ?? guestLearnerId;

  /* ── Data loading ── */

  useEffect(() => {
    let active = true;
    async function loadGraphs() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/knowledge-graphs", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(`读取知识图谱失败（${response.status}）`);
        const data = (await response.json()) as GraphIndexResponse;
        if (!active) return;
        setDatasets(data.datasets || []);
        setDescription(data.description || "");
      } catch (fetchError) {
        if (!active) return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "读取知识图谱失败。",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadGraphs();
    return () => {
      active = false;
    };
  }, []);

  // Sync selected dataset with route param
  useEffect(() => {
    if (routeId && datasets.length > 0) {
      const found = datasets.find((d) => d.id === routeId);
      if (found) setSelectedGraphId(found.id);
      else {
        navigate("/graphs");
      }
    } else if (!routeId && datasets.length > 0 && !selectedGraphId) {
      setSelectedGraphId(datasets[0].id);
    }
  }, [routeId, datasets]);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === selectedGraphId) ?? datasets[0] ?? null,
    [datasets, selectedGraphId],
  );

  const isCourseGroups = activeDataset?.id === "ai_foundation_course_groups";
  const datasetMap = useMemo(() => {
    const m = new Map<string, string>();
    datasets.forEach((d) => m.set(d.id, d.title));
    return m;
  }, [datasets]);
  const simulationVelocityDecay = viewMode === "full" ? 0.32 : 0.24;
  const simulationAlphaDecay = viewMode === "full" ? 0.055 : 0.04;
  const selectedNodeId = selectedNode?.id ?? null;
  const selectedNodeDifficulty = formatDifficultyStars(selectedNode?.difficulty);

  /* ── Build graph data ── */

  const graphData = useMemo(() => {
    if (!activeDataset) return { nodes: [], links: [] };
    const nodes: any[] = [];
    const links: any[] = [];
    const payload = activeDataset.graph;

    payload.nodes.forEach((node) => {
      const color = resolveNodeColor(
        { ...node, isModule: true },
        isCourseGroups,
      );
      nodes.push({
        ...node,
        id: node.id,
        name: node.title,
        val: (node.difficulty || 2) * 4,
        color,
        isModule: true,
      });

      if (viewMode === "full" && node.sub_nodes) {
        node.sub_nodes.forEach((sub: any) => {
          const subColor = resolveNodeColor(
            { ...sub, isModule: false, parentId: node.id },
            isCourseGroups,
          );
          nodes.push({
            ...sub,
            id: sub.id,
            name: sub.title,
            val: (sub.difficulty || 1) * 3,
            color: subColor,
            isModule: false,
            parentId: node.id,
          });
          links.push({
            source: node.id,
            target: sub.id,
            color: "#cbd5e1",
            relation: "contains",
          });
        });
      }
    });

    payload.edges.forEach((edge) => {
      const edgeColor = isCourseGroups
        ? (EDGE_RELATION_COLORS[edge.relation] ?? "#94a3b8")
        : "#94a3b8";
      links.push({
        source: edge.source,
        target: edge.target,
        color: edgeColor,
        relation: edge.relation,
      });
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target),
    );
    return { nodes, links: validLinks };
  }, [activeDataset, viewMode, isCourseGroups]);

  /* ── Highlight logic ── */

  const highlightedNodeIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const related = new Set<string | number>([selectedNodeId]);
    graphData.links.forEach((link: any) => {
      const s = typeof link.source === "object" ? link.source?.id : link.source;
      const t = typeof link.target === "object" ? link.target?.id : link.target;
      if (s === selectedNodeId && t != null) related.add(t);
      if (t === selectedNodeId && s != null) related.add(s);
    });
    return related;
  }, [graphData, selectedNodeId]);

  const highlightedLinkKeys = useMemo(() => {
    if (!selectedNodeId) return null;
    const keys = new Set<string>();
    graphData.links.forEach((link: any) => {
      const s = typeof link.source === "object" ? link.source?.id : link.source;
      const t = typeof link.target === "object" ? link.target?.id : link.target;
      if (s === selectedNodeId || t === selectedNodeId) {
        keys.add(`${String(s)}::${String(t)}`);
      }
    });
    return keys;
  }, [graphData, selectedNodeId]);

  /* ── Effects ── */

  useEffect(() => {
    setHoverNode(null);
    setSelectedNode(null);
  }, [activeDataset, viewMode]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !activeDataset) return;
    const linkDistance = viewMode === "full" ? 96 : 180;
    const chargeStrength = viewMode === "full" ? -180 : -320;
    graph.d3Force("charge")?.strength(chargeStrength);
    graph.d3Force("charge")?.distanceMax(viewMode === "full" ? 320 : 520);
    graph
      .d3Force("link")
      ?.distance((link: any) =>
        String(link.color || "") === "#cbd5e1"
          ? linkDistance * 0.72
          : linkDistance,
      );
    graph
      .d3Force("link")
      ?.strength((link: any) =>
        String(link.color || "") === "#cbd5e1" ? 0.2 : 0.1,
      );
    graph.d3ReheatSimulation();
    const timer = window.setTimeout(() => {
      graph.zoomToFit(450, 80);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [activeDataset, graphData, viewMode]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!selectedNode) {
      graph.zoomToFit(450, 80);
      return;
    }
    const nodeX = typeof selectedNode.x === "number" ? selectedNode.x : 0;
    const nodeY = typeof selectedNode.y === "number" ? selectedNode.y : 0;
    const targetZoom = viewMode === "full" ? 2 : 2.4;
    graph.centerAt(nodeX, nodeY, 500);
    graph.zoom(targetZoom, 500);
  }, [selectedNode, viewMode]);

  /* ── Handlers ── */

  const switchDataset = (id: string) => {
    setSelectedGraphId(id);
    navigate(`/graphs/${id}`, { state: { from: activeDataset?.id } });
  };

  const navigateToGraph = (graphId: string) => {
    setSelectedGraphId(graphId);
    navigate(`/graphs/${graphId}`, { state: { from: activeDataset?.id } });
  };

  const goBack = () => {
    const fromId = (location.state as { from?: string } | null)?.from;
    if (fromId) {
      navigate(`/graphs/${fromId}`);
    } else {
      navigate("/graphs/ai_foundation_course_groups");
    }
  };

  const returnGraphId =
    (location.state as { from?: string } | null)?.from ?? null;
  const showBackButton =
    returnGraphId != null && returnGraphId !== activeDataset?.id;

  const handleStartLearning = async (knowledgePoint: string) => {
    if (learningTaskId) return;

    const courseName = selectedNode?.name ?? activeDataset?.title ?? "";
    const subject = isCourseGroups
      ? selectedNode?.parentId
        ? String(selectedNode.parentId).split("::")[0]
        : courseName
      : (activeDataset?.title ?? courseName);
    const focusNodeId = selectedNode?.id != null ? String(selectedNode.id) : knowledgePoint;
    const courseGroupId = isCourseGroups
      ? selectedNode?.parentId
        ? String(selectedNode.parentId).split("::")[0]
        : selectedNode?.isModule
          ? focusNodeId
          : null
      : null;
    const courseId = isCourseGroups
      ? selectedNode?.isModule
        ? null
        : focusNodeId
      : (activeDataset?.id ?? null);
    const graphContext: LearningGraphContext = {
      dataset_id: activeDataset?.id ?? null,
      course_group_id: courseGroupId,
      course_id: courseId,
      focus_node_id: focusNodeId,
      focus_node_title: knowledgePoint,
      source_graph_id:
        selectedNode?.graph_id != null ? String(selectedNode.graph_id) : null,
    };

    setLearningTaskId(knowledgePoint);
    try {
      const response = await fetch("/api/v1/prep-runs", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          learning_goal: `学习${courseName}中的：${knowledgePoint}`,
          subject,
          grade_level: "大学与成人",
          learner_id: learnerId,
          learner_profile: "适用学段：大学与成人；希望教学风格：鼓励启发",
          notes: `课程：${courseName}；知识点：${knowledgePoint}`,
          graph_context: graphContext,
          language: "zh-CN",
        }),
      });
      if (!response.ok) throw new Error(`创建任务失败（${response.status}）`);
      const payload = (await response.json()) as CreatePrepRunResponse;
      if (!payload.run_id) throw new Error("后端未返回 run_id");
      navigate(`/load/${payload.run_id}`);
    } catch {
      setLearningTaskId(null);
    }
  };

  /* ── Render ── */

  return (
    <div className="h-screen w-screen bg-slate-50 flex overflow-hidden font-sans text-slate-800">
      {/* 侧边栏 */}
      <aside
        className={`shrink-0 border-r border-slate-200 bg-white shadow-sm flex flex-col transition-all duration-300 ease-in-out relative ${
          isSidebarOpen ? "w-80" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="p-6 border-b border-slate-100 min-w-80">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-500 mb-1">
            Knowledge Graphs
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            课程图谱
          </h1>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-[90%]">
            {description || "选择不同的学科，探索知识维度的关联与结构。"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-80 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 space-y-3 text-slate-400">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">加载中...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4 text-sm text-rose-600 flex items-start gap-3">
              <span className="text-rose-500 mt-0.5">⚠</span>
              <p>{error}</p>
            </div>
          ) : datasets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-500">
              暂无图谱数据
            </div>
          ) : (
            datasets.map((dataset) => {
              const isActive = dataset.id === (activeDataset?.id ?? null);
              const isGroup = dataset.id === "ai_foundation_course_groups";
              return (
                <button
                  key={dataset.id}
                  onClick={() => switchDataset(dataset.id)}
                  className={`w-full group rounded-2xl border p-4 text-left transition-all duration-200 ${
                    isGroup && isActive
                      ? "border-violet-300 bg-violet-50/40 shadow-sm ring-1 ring-violet-500/10"
                      : isActive
                        ? "border-indigo-200 bg-indigo-50/40 shadow-sm ring-1 ring-indigo-500/10"
                        : "border-slate-100 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h2
                      className={`font-semibold text-sm ${
                        isGroup && isActive
                          ? "text-violet-900"
                          : isActive
                            ? "text-indigo-900"
                            : "text-slate-700"
                      }`}
                    >
                      {dataset.title}
                    </h2>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isGroup && isActive
                          ? "bg-violet-100 text-violet-700"
                          : isActive
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                      }`}
                    >
                      {dataset.graph.nodes.length} N
                    </span>
                  </div>
                  <p
                    className="text-[11px] font-medium text-slate-400 truncate mb-3"
                    title={dataset.file}
                  >
                    {dataset.file}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {dataset.entry_points.slice(0, 3).map((entry) => (
                      <span
                        key={entry}
                        className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          isGroup && isActive
                            ? "bg-white text-violet-600 border border-violet-100"
                            : isActive
                              ? "bg-white text-indigo-600 border border-indigo-100"
                              : "bg-slate-50 text-slate-500 border border-slate-100 group-hover:bg-white"
                        }`}
                      >
                        {entry}
                      </span>
                    ))}
                    {dataset.entry_points.length > 3 && (
                      <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-slate-50 text-slate-400 border border-slate-100">
                        +{dataset.entry_points.length - 3}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* 展开/折叠按钮 */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-6 h-12 bg-white border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 shadow-sm rounded-r-md transition-all duration-300"
        style={{ left: isSidebarOpen ? "20rem" : "0" }}
        title={isSidebarOpen ? "收起侧边栏" : "展开侧边栏"}
      >
        {isSidebarOpen ? (
          <ChevronLeft size={16} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={16} strokeWidth={2.5} />
        )}
      </button>

      <div className="relative flex-1 flex overflow-hidden bg-slate-50/50">
        {/* Back button + View mode toggle */}
        <div className="absolute top-5 left-5 z-10 flex items-center gap-2">
          {showBackButton && (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回课程群
            </button>
          )}
          <div className="flex p-1 bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm rounded-xl">
            <button
              onClick={() => setViewMode("module")}
              className={`px-4 py-1.5 text-xs font-bold transition-colors rounded-lg ${
                viewMode === "module"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              模块视图
            </button>
            <button
              onClick={() => setViewMode("full")}
              className={`px-4 py-1.5 text-xs font-bold transition-colors rounded-lg ${
                viewMode === "full"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              全量视图
            </button>
          </div>
        </div>

        {/* Info card */}
        <div className="absolute top-5 right-5 z-10 bg-white/80 backdrop-blur-md rounded-xl border border-slate-200 p-4 shadow-sm min-w-[200px]">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              活跃图谱
            </p>
          </div>
          <h2
            className="text-base font-bold text-slate-800 truncate max-w-[200px]"
            title={activeDataset?.title}
          >
            {activeDataset?.title ?? "加载中..."}
          </h2>
          <div className="mt-2 flex gap-4 text-xs font-medium text-slate-500">
            <div>
              <span className="text-slate-900">
                {activeDataset?.graph.nodes.length || 0}
              </span>{" "}
              节点
            </div>
            <div>
              <span className="text-slate-900">
                {activeDataset?.graph.edges.length || 0}
              </span>{" "}
              关系
            </div>
          </div>
          {/* Legend for course groups */}
          {isCourseGroups && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                课程群
              </p>
              {Object.entries(GROUP_PALETTE).map(([name, color]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 text-[11px] text-slate-600"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {name}
                </div>
              ))}
              <div className="flex gap-3 mt-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-4 h-0.5 rounded"
                    style={{
                      backgroundColor: EDGE_RELATION_COLORS.prerequisite,
                    }}
                  />
                  先修
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-4 h-0.5 rounded"
                    style={{ backgroundColor: EDGE_RELATION_COLORS.supports }}
                  />
                  支撑
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Force graph */}
        <div className="flex-1 relative bg-white">
          {activeDataset ? (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel="name"
              nodeColor={(node: any) => {
                if (!highlightedNodeIds) return node.color;
                if (node.id === selectedNodeId) return node.color;
                if (highlightedNodeIds.has(node.id))
                  return hexToRgba(node.color, 0.92);
                return "rgba(148, 163, 184, 0.28)";
              }}
              nodeRelSize={4}
              linkColor={(link: any) => {
                if (!highlightedLinkKeys) return link.color;
                const s =
                  typeof link.source === "object"
                    ? link.source?.id
                    : link.source;
                const t =
                  typeof link.target === "object"
                    ? link.target?.id
                    : link.target;
                return highlightedLinkKeys.has(`${String(s)}::${String(t)}`)
                  ? link.color
                  : "rgba(203, 213, 225, 0.32)";
              }}
              backgroundColor="#f8fafc"
              d3VelocityDecay={simulationVelocityDecay}
              d3AlphaDecay={simulationAlphaDecay}
              cooldownTicks={160}
              warmupTicks={80}
              linkWidth={(link: any) => {
                const s =
                  typeof link.source === "object"
                    ? link.source?.id
                    : link.source;
                const t =
                  typeof link.target === "object"
                    ? link.target?.id
                    : link.target;
                const isHighlighted =
                  highlightedLinkKeys?.has(`${String(s)}::${String(t)}`) ??
                  false;
                const isPrereq = link.relation === "prerequisite";
                const baseWidth =
                  String(link.color || "") === "#cbd5e1"
                    ? 1.2
                    : isPrereq
                      ? 2.4
                      : 1.8;
                if (!highlightedNodeIds) return baseWidth;
                return isHighlighted ? baseWidth + 0.8 : 0.8;
              }}
              linkDirectionalParticles={0}
              onNodeHover={setHoverNode}
              onNodeClick={setSelectedNode}
              onBackgroundClick={() => setSelectedNode(null)}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const label = node.name;
                const isSelected = node.id === selectedNodeId;
                const isNeighbor = highlightedNodeIds?.has(node.id) ?? false;
                const isDimmed =
                  Boolean(highlightedNodeIds) && !isNeighbor && !isSelected;

                const nodeFill = isSelected
                  ? node.color
                  : isNeighbor
                    ? hexToRgba(node.color, 0.92)
                    : isDimmed
                      ? "rgba(148, 163, 184, 0.28)"
                      : node.color;

                const fontSize = Math.max(
                  node.isModule ? 12 : 9,
                  (node.isModule ? 14 : 10) / globalScale,
                );
                ctx.font = `${node.isModule ? "bold " : ""}${fontSize}px Sans-Serif`;
                ctx.fillStyle = nodeFill;
                ctx.beginPath();
                ctx.arc(
                  node.x || 0,
                  node.y || 0,
                  node.val,
                  0,
                  2 * Math.PI,
                  false,
                );
                ctx.fill();

                if (isSelected) {
                  ctx.strokeStyle = "rgba(15, 23, 42, 0.88)";
                  ctx.lineWidth = Math.max(2.8 / globalScale, 1.2);
                  ctx.stroke();
                }

                const safeLabel = typeof label === "string" ? label : "";
                const maxLen = node.isModule ? 14 : 10;
                const truncatedLabel =
                  safeLabel.length > maxLen
                    ? `${safeLabel.slice(0, maxLen)}…`
                    : safeLabel;
                const textY = (node.y || 0) + node.val + fontSize + 4;
                const textWidth = ctx.measureText(truncatedLabel).width;
                const backgroundPaddingX = 6;
                const backgroundHeight = fontSize + 6;
                const labelBackground = isDimmed
                  ? "rgba(241, 245, 249, 0.74)"
                  : "rgba(248, 250, 252, 0.92)";
                const labelText = isDimmed
                  ? "rgba(100, 116, 139, 0.72)"
                  : "#334155";

                ctx.fillStyle = labelBackground;
                ctx.fillRect(
                  (node.x || 0) - textWidth / 2 - backgroundPaddingX,
                  textY - backgroundHeight / 2,
                  textWidth + backgroundPaddingX * 2,
                  backgroundHeight,
                );

                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineWidth = Math.max(1.5 / globalScale, 0.8);
                ctx.strokeStyle = "rgba(248, 250, 252, 0.98)";
                ctx.strokeText(truncatedLabel, node.x || 0, textY);
                ctx.fillStyle = labelText;
                ctx.fillText(truncatedLabel, node.x || 0, textY);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {loading ? "图谱加载中..." : "暂无可展示的图谱。"}
            </div>
          )}

          {/* Hover tooltip */}
          {hoverNode && !selectedNode && (
            <div
              className="absolute bg-white/95 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-slate-200 pointer-events-none z-20 transition-opacity duration-200"
              style={{ left: 24, bottom: 24, maxWidth: 320 }}
            >
              <h3 className="text-sm font-bold text-slate-900 mb-1.5">
                {hoverNode.name}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-[280px] break-words">
                {hoverNode.summary && hoverNode.summary.length > 80
                  ? hoverNode.summary.substring(0, 80) + "..."
                  : hoverNode.summary || "暂无简短描述"}
              </p>
              {formatDifficultyStars(hoverNode.difficulty) && (
                <div className="mt-2 text-[11px] font-medium text-amber-500">
                  难度 {formatDifficultyStars(hoverNode.difficulty)?.stars}
                  <span className="ml-1 text-slate-400">
                    ({formatDifficultyStars(hoverNode.difficulty)?.level}/6)
                  </span>
                </div>
              )}
              {hoverNode.isModule && (
                <div className="mt-2 text-[10px] font-medium text-indigo-500 bg-indigo-50 inline-block px-2 py-0.5 rounded">
                  核心模块
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右侧节点详情面板 */}
      <div
        className={`bg-white border-l border-slate-200 shadow-2xl flex flex-col z-30 transition-all duration-300 ease-in-out absolute right-0 top-0 h-full ${
          selectedNode ? "w-96 translate-x-0" : "w-96 translate-x-full"
        }`}
      >
        {selectedNode && (
          <>
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
              <div className="pr-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: selectedNode.color }}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {selectedNode.isModule ? "模块节点" : "知识点"}
                  </span>
                </div>
                <h2 className="font-bold text-xl text-slate-900 leading-tight">
                  {selectedNode.name}
                </h2>
                {selectedNodeDifficulty && (
                  <div className="mt-2 text-xs font-medium text-amber-500">
                    难度 {selectedNodeDifficulty.stars}
                    <span className="ml-1 text-slate-400">
                      ({selectedNodeDifficulty.level}/6)
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 p-1.5 rounded-lg transition-colors mt-0.5"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto custom-scrollbar bg-white">
              {/* Graph navigation link */}
              {selectedNode.graph_id &&
                datasetMap.has(selectedNode.graph_id) && (
                  <div className="mb-6">
                    <button
                      onClick={() => navigateToGraph(selectedNode.graph_id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/60 hover:border-indigo-300 transition-colors text-left"
                    >
                      <Network className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-indigo-700">
                          查看详细图谱
                        </p>
                        <p className="text-[11px] text-indigo-500/80 truncate">
                          {datasetMap.get(selectedNode.graph_id)}
                        </p>
                      </div>
                      <ArrowLeft className="w-3.5 h-3.5 text-indigo-400 rotate-180 shrink-0" />
                    </button>
                  </div>
                )}

              <div className="mb-8">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-indigo-500" />
                  内容摘要
                </h3>
                <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {selectedNode.summary || "暂无内容摘要提供。"}
                </div>
              </div>

              {/* For course-group module nodes: list sub-courses with graph links */}
              {isCourseGroups &&
                selectedNode.isModule &&
                selectedNode.sub_nodes && (
                  <div className="mb-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-2">
                      <span className="w-1 h-3 rounded-full bg-violet-500" />
                      包含课程
                    </h3>
                    <div className="space-y-2">
                      {selectedNode.sub_nodes.map((sub: any) => {
                        const hasGraph =
                          !!sub.graph_id && datasetMap.has(sub.graph_id);
                        return (
                          <div
                            key={sub.id}
                            className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: selectedNode.color }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-700">
                                {sub.title}
                              </p>
                              {sub.summary && (
                                <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5 line-clamp-2">
                                  {sub.summary}
                                </p>
                              )}
                            </div>
                            {hasGraph ? (
                              <button
                                onClick={() => navigateToGraph(sub.graph_id)}
                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
                              >
                                <Network className="w-3 h-3" />
                                图谱
                              </button>
                            ) : (
                              <span className="shrink-0 text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                暂无
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-emerald-500" />
                  学习要点
                </h3>
                {selectedNode.content && selectedNode.content.length > 0 ? (
                  <ul className="space-y-2">
                    {selectedNode.content.map((c: string, i: number) => {
                      const isSubmitting = learningTaskId === c;
                      const isOtherSubmitting =
                        learningTaskId != null && learningTaskId !== c;
                      return (
                        <li
                          key={i}
                          className="flex items-center gap-3 text-sm text-slate-600 leading-relaxed p-3 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50/50 transition-colors group"
                        >
                          <span className="text-slate-300 font-mono mt-0.5 select-none shrink-0">
                            {String(i + 1).padStart(2, "0")}.
                          </span>
                          <span className="flex-1 min-w-0">{c}</span>
                          {selectedNodeDifficulty && (
                            <span className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-600">
                              {selectedNodeDifficulty.stars}
                            </span>
                          )}
                          <button
                            onClick={() => void handleStartLearning(c)}
                            disabled={isSubmitting || isOtherSubmitting}
                            className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            {isSubmitting ? (
                              <LoaderCircle className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            去学习
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="text-sm text-slate-400 italic p-4 text-center border border-dashed border-slate-200 rounded-xl">
                    未配置具体的学习要点
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
