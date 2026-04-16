import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Brain,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Package,
  Target,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/ui/markdown";
import { Separator } from "@/components/ui/separator";
import {
  parsePracticeQuestionsPayload,
  PracticeQuestionWorkspace,
} from "@/components/PracticeQuestionWorkspace";
import type { PracticeQuestionRecord } from "@/components/PracticeQuestionWorkspace";
import { FloatingAIInput } from "@/components/FloatingAIInput";

type PrepRunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";
type MaterialOpenMode = "markdown" | "link" | "download";

interface RunLinks {
  status: string;
  events: string;
  artifacts: string;
  bundle: string;
}

interface GenerationRequestSnapshot {
  learning_goal: string;
  subject: string;
  grade_level: string;
  learner_profile: string;
  notes: string;
  language: string;
}

interface PrepRunStatusResponse {
  run_id: string;
  status: PrepRunStatus;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  output_dir: string;
  request?: GenerationRequestSnapshot | null;
  plan_summary?: string | null;
  required_materials: string[];
  teacher_checklist: string[];
  teaching_focus: string[];
  quality_bar: string[];
  artifact_count: number;
  error?: string | null;
  links: RunLinks;
}

interface FileDescriptor {
  name: string;
  relative_path: string;
  size_bytes?: number | null;
  content_type?: string | null;
  download_url: string;
}

interface ArtifactDescriptor {
  agent_name: string;
  title: string;
  status: string;
  summary: string;
  notes: string[];
  output_dir: string;
  files: FileDescriptor[];
}

interface ArtifactListResponse {
  run_id: string;
  status: PrepRunStatus;
  plan_file?: FileDescriptor | null;
  report_file?: FileDescriptor | null;
  manifest_file?: FileDescriptor | null;
  artifacts: ArtifactDescriptor[];
  bundle_download_url: string;
}

interface StudyMaterialItem {
  id: string;
  name: string;
  label: string;
  description: string;
  downloadUrl: string;
  previewUrl?: string;
  colorClass: string;
  openMode: MaterialOpenMode;
  priority: number;
  previewContent?: string;
}

interface StudyWorkspaceData {
  workspaceTitle: string;
  workspaceSubtitle: string;
  goals: string[];
  requiredMaterials: string[];
  teacherChecklist: string[];
  qualityBar: string[];
  materials: StudyMaterialItem[];
  bundleDownloadUrl?: string | null;
  statusLabel: string;
  statusProgress: number;
  materialsProgress: number;
  goalsProgress: number;
  checklistProgress: number;
  usingMock: boolean;
}

interface WorkspaceTab {
  id: string;
  title: string;
  type: "workspace" | "markdown";
  status: "ready" | "loading" | "error";
  content?: string;
  error?: string;
  sourceUrl?: string;
  downloadUrl?: string;
}

const WORKSPACE_TAB_ID = "workspace";

const DEFAULT_WORKSPACE_TAB: WorkspaceTab = {
  id: WORKSPACE_TAB_ID,
  title: "学习区",
  type: "workspace",
  status: "ready",
};

const MOCK_PRACTICE_QUESTIONS: PracticeQuestionRecord[] = [
  {
    question_type: "MultipleChoice",
    id: "mock_choice_01",
    question: "下面哪一项最能说明学习区已经接入真实题库渲染能力？",
    options: [
      "继续展示固定写死的 5 道示例题",
      "根据 `practice_questions.json` 的真实内容动态渲染题目",
      "只展示题目总数，不展示具体题型",
      "只允许单选题显示",
    ],
    correct_answer: "根据 `practice_questions.json` 的真实内容动态渲染题目",
    analysis: "这道 mock 题用于说明新的学习区会跟随真实题库变化，而不是继续展示固定示例。",
    requires_ai_judgment: false,
  },
  {
    question_type: "Coding",
    id: "mock_coding_01",
    question:
      "实现一个函数 `sumArray(nums)`，返回数组中所有数字之和。你可以先用它体验新的真实题库工作区。",
    reference_code:
      "function sumArray(nums) {\n  return nums.reduce((total, value) => total + value, 0);\n}",
    test_cases: [
      [[[1, 2, 3, 4]], 10],
      [[[5]], 5],
    ],
    analysis: "这道 mock 编程题主要用来验证编程题在学习区中的动态渲染能力。",
    requires_ai_judgment: true,
  },
  {
    question_type: "ShortAnswer",
    id: "mock_short_01",
    question: "请简述为什么题型规划和具体出题最好拆成两个阶段。",
    reference_answer:
      "因为先规划题型和题量，可以让后续生成结果围绕主题能力目标展开，避免固定模板或题型失衡。",
    analysis: "这道 mock 简答题对应当前系统正在进行的架构升级主题。",
    requires_ai_judgment: true,
  },
];

const MOCK_WORKSPACE_DATA: StudyWorkspaceData = {
  workspaceTitle: "Edu AI Workspace",
  workspaceSubtitle: "未指定 run_id，先展示示例学习区数据。",
  goals: ["理解核心概念", "掌握实践技能", "完成进阶挑战"],
  requiredMaterials: ["准备一份学习指南草稿", "检查课堂中可用的演示材料"],
  teacherChecklist: ["确认练习题层次清晰", "准备可直接展示的讲义内容"],
  qualityBar: ["结构清晰", "材料可投影展示", "支持学生自主阅读"],
  materials: [
    {
      id: "mock-study-guide",
      name: "study_guide.md",
      label: "学案",
      description: "示例学习指南，可在主工作区预览。",
      downloadUrl: "#",
      previewUrl: "#",
      colorClass: "text-sky-600",
      openMode: "markdown",
      priority: 100,
      previewContent: `# 示例学案

## 本课目标

- 认识课程结构
- 熟悉工作区操作
- 了解素材预览方式

## 预习建议

1. 先浏览课程目标。
2. 再阅读教师备注与学习指南。
3. 需要下载时，可直接使用素材面板中的下载入口。`,
    },
    {
      id: "mock-teacher-notes",
      name: "teacher_notes.md",
      label: "教师备注",
      description: "示例教师备注，可在主工作区预览。",
      downloadUrl: "#",
      previewUrl: "#",
      colorClass: "text-emerald-600",
      openMode: "markdown",
      priority: 94,
      previewContent: `# 教师备注

> 这里是没有 \`run_id\` 时的 mock 内容。

- 保持侧边抽屉结构不变
- 只增强素材的筛选与预览体验
- Markdown 文件会在主工作区以新标签页方式打开`,
    },
    {
      id: "mock-practice",
      name: "practice_questions.json",
      label: "题库数据",
      description: "示例练习题数据文件。",
      downloadUrl: "#",
      colorClass: "text-amber-600",
      openMode: "download",
      priority: 76,
    },
  ],
  bundleDownloadUrl: null,
  statusLabel: "示例数据",
  statusProgress: 56,
  materialsProgress: 72,
  goalsProgress: 72,
  checklistProgress: 60,
  usingMock: true,
};

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getStatusLabel(status: PrepRunStatus) {
  switch (status) {
    case "queued":
      return "队列中";
    case "running":
      return "准备中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "已失败";
    default:
      return "未知状态";
  }
}

function getStatusProgress(status: PrepRunStatus) {
  switch (status) {
    case "queued":
      return 18;
    case "running":
      return 68;
    case "succeeded":
      return 100;
    case "failed":
      return 100;
    default:
      return 32;
  }
}

function toDownloadUrl(url: string) {
  if (url.includes("/files/")) {
    return `${url}${url.includes("?") ? "&" : "?"}download=true`;
  }
  return url;
}

function classifyMaterial(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.includes("artifact_manifest")) {
    return null;
  }

  if (lowerName === "study_guide.md") {
    return { label: "学案", colorClass: "text-sky-600", openMode: "markdown" as const, priority: 100 };
  }
  if (lowerName === "teacher_notes.md") {
    return { label: "教师备注", colorClass: "text-emerald-600", openMode: "markdown" as const, priority: 96 };
  }
  if (lowerName === "preparation_plan.md") {
    return { label: "准备计划", colorClass: "text-indigo-600", openMode: "markdown" as const, priority: 95 };
  }
  if (lowerName === "final_report.md") {
    return { label: "总结报告", colorClass: "text-violet-600", openMode: "markdown" as const, priority: 92 };
  }
  if (lowerName === "answer_key.md") {
    return { label: "答案解析", colorClass: "text-amber-600", openMode: "markdown" as const, priority: 90 };
  }
  if (lowerName === "practice_blueprint.md") {
    return { label: "题型蓝图", colorClass: "text-cyan-600", openMode: "markdown" as const, priority: 91 };
  }
  if (lowerName === "practice_blueprint.json") {
    return { label: "题型蓝图", colorClass: "text-cyan-600", openMode: "download" as const, priority: 83 };
  }
  if (lowerName === "usage_notes.md") {
    return { label: "使用说明", colorClass: "text-rose-600", openMode: "markdown" as const, priority: 88 };
  }
  if (lowerName === "render_guide.md") {
    return { label: "渲染说明", colorClass: "text-fuchsia-600", openMode: "markdown" as const, priority: 84 };
  }
  if (lowerName === "practice_questions.json") {
    return { label: "题库数据", colorClass: "text-amber-600", openMode: "download" as const, priority: 82 };
  }
  if (lowerName.endsWith(".html")) {
    return { label: "交互网页", colorClass: "text-rose-600", openMode: "link" as const, priority: 86 };
  }
  if (lowerName.endsWith(".pdf")) {
    return { label: "PDF 资料", colorClass: "text-blue-600", openMode: "download" as const, priority: 80 };
  }
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) {
    return { label: "文档", colorClass: "text-emerald-600", openMode: "download" as const, priority: 78 };
  }
  if (lowerName.endsWith(".md")) {
    return { label: "Markdown", colorClass: "text-slate-600", openMode: "markdown" as const, priority: 74 };
  }
  if (lowerName.endsWith(".json")) {
    return { label: "数据文件", colorClass: "text-amber-600", openMode: "download" as const, priority: 72 };
  }
  if (lowerName.endsWith(".py")) {
    return null;
  }

  return null;
}

function buildMaterialItems(artifactResponse: ArtifactListResponse): StudyMaterialItem[] {
  const items: StudyMaterialItem[] = [];
  const seen = new Set<string>();

  const pushFile = (file: FileDescriptor | null | undefined, description: string) => {
    if (!file || seen.has(file.download_url)) {
      return;
    }

    const meta = classifyMaterial(file.name);
    if (!meta) {
      return;
    }

    seen.add(file.download_url);
    items.push({
      id: file.relative_path,
      name: file.name,
      label: meta.label,
      description,
      downloadUrl: toDownloadUrl(file.download_url),
      previewUrl: file.download_url,
      colorClass: meta.colorClass,
      openMode: meta.openMode,
      priority: meta.priority,
    });
  };

  pushFile(artifactResponse.plan_file, "监督规划产物");
  pushFile(artifactResponse.report_file, "监督总结产物");

  artifactResponse.artifacts.forEach((artifact) => {
    artifact.files.forEach((file) => {
      pushFile(file, artifact.title);
    });
  });

  items.sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  return items;
}

function findArtifactFileByName(
  artifactResponse: ArtifactListResponse,
  fileName: string
): FileDescriptor | null {
  for (const artifact of artifactResponse.artifacts) {
    const matchedFile = artifact.files.find((file) => file.name === fileName);
    if (matchedFile) {
      return matchedFile;
    }
  }

  return null;
}

function buildWorkspaceData(
  statusResponse: PrepRunStatusResponse,
  artifactResponse: ArtifactListResponse
): StudyWorkspaceData {
  const learningGoal = statusResponse.request?.learning_goal?.trim() || "课前准备学习区";
  const teachingFocus = statusResponse.teaching_focus.filter(Boolean);
  const goals = teachingFocus.length > 0 ? teachingFocus : [learningGoal];
  const materials = buildMaterialItems(artifactResponse);
  const checklist = statusResponse.teacher_checklist.filter(Boolean);
  const requiredMaterials = statusResponse.required_materials.filter(Boolean);
  const qualityBar = statusResponse.quality_bar.filter(Boolean);
  const statusLabel = getStatusLabel(statusResponse.status);

  return {
    workspaceTitle: learningGoal,
    workspaceSubtitle:
      statusResponse.plan_summary?.trim() ||
      `${statusLabel} · 当前已识别 ${statusResponse.artifact_count} 份产物`,
    goals,
    requiredMaterials,
    teacherChecklist: checklist,
    qualityBar,
    materials,
    bundleDownloadUrl: artifactResponse.bundle_download_url,
    statusLabel,
    statusProgress: getStatusProgress(statusResponse.status),
    materialsProgress: clampPercentage(materials.length * 14),
    goalsProgress: clampPercentage(goals.length * 28),
    checklistProgress: clampPercentage((checklist.length + requiredMaterials.length) * 20),
    usingMock: false,
  };
}

function CircularProgressWidget({
  icon: Icon,
  title,
  subtitle,
  progress,
  color,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  progress: number;
  color: string;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3 bg-gradient-to-b from-card to-card/80 border rounded-3xl p-4 shadow-sm w-full relative overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="absolute top-0 right-0 p-3 opacity-20 pointer-events-none">
        <Icon className="w-16 h-16" style={{ color }} />
      </div>

      <div className="relative flex items-center justify-center z-10 w-20 h-20">
        <svg width="80" height="80" className="transform -rotate-90 drop-shadow-sm">
          <circle
            cx="40"
            cy="40"
            r={radius}
            strokeWidth="7"
            stroke="currentColor"
            fill="transparent"
            className="text-muted/40"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            strokeWidth="7"
            stroke={color}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out drop-shadow-md"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
      </div>
      <div className="text-center z-10 space-y-0.5 w-full">
        <div className="font-semibold text-[0.95rem] text-foreground tracking-tight">{title}</div>
        <div className="text-[11px] font-medium tracking-wide" style={{ color }}>
          {subtitle} ({progress}%)
        </div>
      </div>
    </div>
  );
}

function MainWorkspaceQuestions({
  learningGoal,
  questions,
  isLoading,
  error,
  emptyHint,
}: {
  learningGoal: string;
  questions: PracticeQuestionRecord[];
  isLoading: boolean;
  error?: string | null;
  emptyHint?: string;
}) {
  return (
    <PracticeQuestionWorkspace
      learningGoal={learningGoal}
      questions={questions}
      isLoading={isLoading}
      error={error}
      emptyHint={emptyHint}
    />
  );
}

function isPreviewableMaterial(mode: MaterialOpenMode) {
  return mode === "markdown" || mode === "link";
}

export default function StudyArea() {
  const { runId } = useParams();
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<StudyWorkspaceData>(MOCK_WORKSPACE_DATA);
  const [practiceQuestions, setPracticeQuestions] =
    useState<PracticeQuestionRecord[]>(MOCK_PRACTICE_QUESTIONS);
  const [practiceQuestionsError, setPracticeQuestionsError] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>([DEFAULT_WORKSPACE_TAB]);
  const [activeTabId, setActiveTabId] = useState(WORKSPACE_TAB_ID);

  const activeTab = openTabs.find((tab) => tab.id === activeTabId) ?? DEFAULT_WORKSPACE_TAB;

  const togglePanel = (panel: string) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  useEffect(() => {
    setOpenTabs([DEFAULT_WORKSPACE_TAB]);
    setActiveTabId(WORKSPACE_TAB_ID);
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setWorkspaceData(MOCK_WORKSPACE_DATA);
      setPracticeQuestions(MOCK_PRACTICE_QUESTIONS);
      setPracticeQuestionsError(null);
      setIsLoadingWorkspace(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadWorkspaceData() {
      setIsLoadingWorkspace(true);
      setPracticeQuestions([]);
      setPracticeQuestionsError(null);

      try {
        const [statusResponse, artifactsResponse] = await Promise.all([
          fetch(`/api/v1/prep-runs/${runId}`, { signal: controller.signal }),
          fetch(`/api/v1/prep-runs/${runId}/artifacts`, { signal: controller.signal }),
        ]);

        if (!statusResponse.ok) {
          throw new Error(`status request failed: ${statusResponse.status}`);
        }

        const statusData = (await statusResponse.json()) as PrepRunStatusResponse;
        const artifactData = artifactsResponse.ok
          ? ((await artifactsResponse.json()) as ArtifactListResponse)
          : {
              run_id: statusData.run_id,
              status: statusData.status,
              plan_file: null,
              report_file: null,
              manifest_file: null,
              artifacts: [],
              bundle_download_url: statusData.links.bundle,
            };

        let nextPracticeQuestions: PracticeQuestionRecord[] = [];
        let nextPracticeQuestionsError: string | null = null;
        const practiceQuestionsFile = findArtifactFileByName(artifactData, "practice_questions.json");

        if (practiceQuestionsFile) {
          try {
            const practiceResponse = await fetch(practiceQuestionsFile.download_url, {
              signal: controller.signal,
              headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
            });

            if (!practiceResponse.ok) {
              throw new Error(`practice questions request failed: ${practiceResponse.status}`);
            }

            const practicePayload = (await practiceResponse.json()) as unknown;
            nextPracticeQuestions = parsePracticeQuestionsPayload(practicePayload);

            if (nextPracticeQuestions.length === 0) {
              nextPracticeQuestionsError = "题库文件已生成，但当前内容为空或格式暂不支持展示。";
            }
          } catch (error) {
            const fallbackMessage =
              error instanceof Error ? error.message : "practice questions request failed";
            nextPracticeQuestionsError = `真实题库加载失败：${fallbackMessage}`;
          }
        } else if (statusData.status === "succeeded") {
          nextPracticeQuestionsError = "当前任务已完成，但未找到 `practice_questions.json`。";
        }

        if (!cancelled) {
          setWorkspaceData(buildWorkspaceData(statusData, artifactData));
          setPracticeQuestions(nextPracticeQuestions);
          setPracticeQuestionsError(nextPracticeQuestionsError);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceData({
            ...MOCK_WORKSPACE_DATA,
            workspaceSubtitle: `未获取到 run_id=${runId} 的真实任务数据，当前展示示例内容。`,
            usingMock: true,
          });
          setPracticeQuestions(MOCK_PRACTICE_QUESTIONS);
          setPracticeQuestionsError(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWorkspace(false);
        }
      }
    }

    void loadWorkspaceData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  const progressWidgets = useMemo(
    () => [
      {
        icon: Target,
        title: "课程目标",
        subtitle: workspaceData.usingMock ? "Mock" : "Live",
        progress: workspaceData.goalsProgress,
        color: "hsl(var(--chart-1, 215 100% 64%))",
      },
      {
        icon: FileText,
        title: "关键素材",
        subtitle: workspaceData.statusLabel,
        progress: workspaceData.materialsProgress,
        color: "hsl(var(--chart-2, 142 71% 45%))",
      },
      {
        icon: Brain,
        title: "教师检查",
        subtitle: workspaceData.teacherChecklist.length > 0 ? "Checklist" : "Pending",
        progress: workspaceData.checklistProgress,
        color: "hsl(var(--chart-3, 34 100% 50%))",
      },
      {
        icon: Package,
        title: "任务状态",
        subtitle: workspaceData.statusLabel,
        progress: workspaceData.statusProgress,
        color: "hsl(var(--primary))",
      },
    ],
    [workspaceData]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(200, Math.min(startWidth + deltaX, 800));
      setDrawerWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const closeTab = (tabId: string) => {
    setOpenTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(WORKSPACE_TAB_ID);
    }
  };

  const openMarkdownTab = async (material: StudyMaterialItem) => {
    const existingTab = openTabs.find((tab) => tab.id === material.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const nextTab: WorkspaceTab = {
      id: material.id,
      title: material.name,
      type: "markdown",
      status: material.previewContent ? "ready" : "loading",
      content: material.previewContent,
      sourceUrl: material.previewUrl,
      downloadUrl: material.downloadUrl,
    };

    setOpenTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTabId(material.id);

    if (material.previewContent || !material.previewUrl || material.previewUrl === "#") {
      return;
    }

    try {
      const response = await fetch(material.previewUrl, {
        headers: { Accept: "text/markdown, text/plain;q=0.9, */*;q=0.8" },
      });

      if (!response.ok) {
        throw new Error(`无法加载文档（${response.status}）`);
      }

      const content = await response.text();
      setOpenTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === material.id ? { ...tab, status: "ready", content } : tab
        )
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "文档加载失败";
      setOpenTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === material.id ? { ...tab, status: "error", error: errorMessage } : tab
        )
      );
    }
  };

  const handleMaterialAction = (material: StudyMaterialItem) => {
    if (material.openMode === "markdown") {
      void openMarkdownTab(material);
      return;
    }

    const targetUrl = material.previewUrl ?? material.downloadUrl;
    if (!targetUrl || targetUrl === "#") {
      return;
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  const renderWorkspaceContent = () => {
    if (activeTab.type === "workspace") {
      return (
        <MainWorkspaceQuestions
          learningGoal={workspaceData.workspaceTitle}
          questions={practiceQuestions}
          isLoading={isLoadingWorkspace && !workspaceData.usingMock}
          error={practiceQuestionsError}
          emptyHint={
            workspaceData.usingMock
              ? "当前展示的是示例题库。创建真实任务后，这里会自动切换为生成产物里的练习题。"
              : "当前还没有真实题库，请等待练习 Agent 完成生成。"
          }
        />
      );
    }

    return (
      <div className="h-full min-h-0 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{activeTab.title}</p>
            <p className="text-xs text-slate-500">在线预览</p>
          </div>

          {activeTab.downloadUrl && activeTab.downloadUrl !== "#" && (
            <Button variant="outline" size="sm" asChild>
              <a href={activeTab.downloadUrl} target="_blank" rel="noreferrer">
                <Download className="w-3.5 h-3.5" />
                下载原文件
              </a>
            </Button>
          )}
        </div>

        <ScrollArea className="h-[calc(100%-61px)] px-6 py-5">
          {activeTab.status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="w-4 h-4 animate-spin" />
              正在加载 Markdown 内容...
            </div>
          )}

          {activeTab.status === "error" && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {activeTab.error || "文档加载失败。"}
            </div>
          )}

          {activeTab.status === "ready" && (
            <Markdown className="max-w-none text-slate-800 dark:text-slate-200">
              {activeTab.content || "# 空文档\n\n当前文档没有可展示的内容。"}
            </Markdown>
          )}
        </ScrollArea>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-background">
        <FloatingAIInput />
        <header className="h-14 border-b bg-card flex items-center px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-2 font-semibold text-lg min-w-0">
            <BookOpen className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="truncate">{workspaceData.workspaceTitle}</div>
              <div className="text-[11px] font-medium text-muted-foreground truncate">
                {isLoadingWorkspace ? "正在加载任务数据..." : workspaceData.workspaceSubtitle}
              </div>
            </div>
          </div>
        </header>

        <main className="flex flex-1 overflow-hidden relative">
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            <div className="flex items-center px-4 h-11 border-b shrink-0 bg-muted/10 gap-2 overflow-x-auto">
              <button
                className={`flex items-center gap-2 h-full px-2 border-b-2 font-medium text-sm transition-colors ${
                  activeTabId === WORKSPACE_TAB_ID
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTabId(WORKSPACE_TAB_ID)}
              >
                <LayoutDashboard className="w-4 h-4" />
                学习区
              </button>

              {openTabs
                .filter((tab) => tab.type === "markdown")
                .map((tab) => (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                      activeTabId === tab.id ? "bg-primary/8 text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <button
                      className="flex items-center gap-2 text-sm min-w-0"
                      onClick={() => setActiveTabId(tab.id)}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-40">{tab.title}</span>
                    </button>
                    <button
                      className="rounded-md p-1 hover:bg-black/5"
                      onClick={() => closeTab(tab.id)}
                      aria-label={`关闭 ${tab.title}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col pt-4 px-6 md:pt-6 md:px-8 pb-8">
              {renderWorkspaceContent()}
            </div>
          </div>

          <div
            className={`shrink-0 overflow-hidden relative shadow-sm z-10 ${
              isDragging ? "transition-none" : "transition-all duration-300 ease-in-out"
            }`}
            style={{ width: activePanel ? drawerWidth : 0 }}
          >
            <div
              className="flex flex-col bg-card h-full absolute top-0 left-0 border-l"
              style={{ width: drawerWidth }}
            >
              <div
                className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 focus:bg-primary/50 group z-20"
                onMouseDown={handleMouseDown}
              >
                <div className="w-[1px] h-full bg-border mx-auto group-hover:bg-primary/50 transition-colors" />
              </div>

              <div className="p-4 font-semibold border-b flex items-center justify-between shrink-0 bg-muted/10 h-11">
                <span className="flex items-center gap-2 text-sm">
                  {activePanel === "goals" && (
                    <>
                      <Target className="w-4 h-4 text-primary" /> 知识目标
                    </>
                  )}
                  {activePanel === "materials" && (
                    <>
                      <FileText className="w-4 h-4 text-primary" /> 课程素材
                    </>
                  )}
                  {activePanel === "progress" && (
                    <>
                      <Activity className="w-4 h-4 text-primary" /> 学习进度
                    </>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActivePanel(null)}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <ScrollArea className="flex-1 p-4">
                {activePanel === "progress" && (
                  <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200 pb-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest pl-1">
                      掌握度速览
                    </p>
                    <div className="grid grid-cols-2 gap-3 min-w-[240px]">
                      {progressWidgets.map((widget) => (
                        <CircularProgressWidget
                          key={widget.title}
                          icon={widget.icon}
                          title={widget.title}
                          subtitle={widget.subtitle}
                          progress={widget.progress}
                          color={widget.color}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activePanel === "goals" && (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                    <Card className="shadow-none border-dashed bg-muted/30">
                      <CardContent className="p-4">
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">课程目标</p>
                            <ul className="list-disc pl-4 space-y-1 text-sm">
                              {workspaceData.goals.map((goal, index) => (
                                <li key={`${goal}-${index}`}>{goal}</li>
                              ))}
                            </ul>
                          </div>

                          {workspaceData.requiredMaterials.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">课前准备</p>
                              <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
                                {workspaceData.requiredMaterials.map((item, index) => (
                                  <li key={`${item}-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {workspaceData.teacherChecklist.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">教师检查项</p>
                              <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
                                {workspaceData.teacherChecklist.map((item, index) => (
                                  <li key={`${item}-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activePanel === "materials" && (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                    <Card className="shadow-none border-dashed bg-muted/30">
                      <CardContent className="p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">关键文件</p>
                            <p className="text-sm font-medium text-foreground">
                              已筛选 {workspaceData.materials.length} 个可直接使用的重要文件
                            </p>
                          </div>

                          {workspaceData.bundleDownloadUrl && workspaceData.bundleDownloadUrl !== "#" && (
                            <Button variant="outline" size="sm" asChild>
                              <a href={workspaceData.bundleDownloadUrl} target="_blank" rel="noreferrer">
                                <Download className="w-3.5 h-3.5" />
                                整包
                              </a>
                            </Button>
                          )}
                        </div>

                        <Separator />

                        {workspaceData.materials.length > 0 ? (
                          workspaceData.materials.map((material) => (
                            <div
                              key={material.id}
                              className={`flex items-center gap-3 text-sm p-3 rounded-md transition-colors border border-transparent hover:border-border hover:bg-muted/60 ${
                                isPreviewableMaterial(material.openMode) ? "cursor-pointer" : ""
                              }`}
                              onClick={() => handleMaterialAction(material)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  handleMaterialAction(material);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <FileText className={`w-5 h-5 shrink-0 ${material.colorClass}`} />

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate font-medium text-foreground">{material.name}</span>
                                  <Badge
                                    variant="outline"
                                    className={`shrink-0 ${material.colorClass} border-current/25`}
                                  >
                                    {material.label}
                                  </Badge>
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {material.description}
                                </div>
                              </div>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleMaterialAction(material);
                                }}
                              >
                                {material.openMode === "markdown" ? (
                                  <>
                                    <FileText className="w-3.5 h-3.5" />
                                    预览
                                  </>
                                ) : material.openMode === "link" ? (
                                  <>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    打开
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-3.5 h-3.5" />
                                    下载
                                  </>
                                )}
                              </Button>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground p-3">当前还没有可下载素材。</div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <aside className="w-14 shrink-0 flex flex-col items-center py-4 gap-3 bg-card border-l z-20 shadow-sm relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activePanel === "goals" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-10 h-10 rounded-xl ${
                    activePanel === "goals"
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => togglePanel("goals")}
                >
                  <Target className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">
                知识目标
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activePanel === "materials" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-10 h-10 rounded-xl ${
                    activePanel === "materials"
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => togglePanel("materials")}
                >
                  <FileText className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">
                课程素材
              </TooltipContent>
            </Tooltip>

            <div className="w-8 h-[1px] bg-border my-1 rounded-full" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activePanel === "progress" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-10 h-10 rounded-xl ${
                    activePanel === "progress"
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => togglePanel("progress")}
                >
                  <Activity className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">
                进度与评估
              </TooltipContent>
            </Tooltip>
          </aside>
        </main>
      </div>
    </TooltipProvider>
  );
}
