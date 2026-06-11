import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Package,
  Play,
  Target,
  User,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import {
  parsePracticeQuestionsPayload,
  PracticeQuestionWorkspace,
} from "@/components/PracticeQuestionWorkspace";
import type { PracticeQuestionRecord } from "@/components/PracticeQuestionWorkspace";
import { FloatingAIInput } from "@/components/FloatingAIInput";
import { Battery as CircularProgressWidget } from "@/components/ui/battery";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  learner_id?: string | null;
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
  learnerId?: string | null;
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

type AbilityBand = "evidence_needed" | "needs_support" | "developing" | "proficient" | "advanced";

interface LearnerModelSnapshot {
  learner_id: string;
  overall_mastery: number;
  overall_confidence: number;
  overall_band: AbilityBand;
  total_events: number;
  total_sessions: number;
  strong_skills: string[];
  weak_skills: string[];
  key_misconceptions: string[];
  recommended_focus: string[];
  prompt_profile: string;
  evaluation_summary: string;
  updated_at: string;
}

interface SkillJudgment {
  skill_id: string;
  display_name: string;
  score: number;
  observation: string;
}

interface LearningEvidenceEvent {
  event_id: string;
  learner_id: string;
  question_id: string;
  question_type: string;
  correctness: string;
  score: number;
  skill_judgments: SkillJudgment[];
  learner_observations: string[];
  timestamp: string;
}

interface LearnerModelData {
  snapshot: LearnerModelSnapshot;
  recent_events: LearningEvidenceEvent[];
}

interface WorkspaceTab {
  id: string;
  title: string;
  type: "workspace" | "prep" | "markdown" | "html" | "video";
  status: "ready" | "loading" | "error";
  content?: string;
  error?: string;
  sourceUrl?: string;
  downloadUrl?: string;
}

const WORKSPACE_TAB_ID = "workspace";
const PREP_CLASSROOM_TAB_ID = "prep-classroom";
const PREP_CLASSROOM_QUERY_VALUE = "prep-classroom";

const DEFAULT_WORKSPACE_TAB: WorkspaceTab = {
  id: WORKSPACE_TAB_ID,
  title: "学习区",
  type: "workspace",
  status: "ready",
};

const DEFAULT_PREP_CLASSROOM_TAB: WorkspaceTab = {
  id: PREP_CLASSROOM_TAB_ID,
  title: "准备课中",
  type: "prep",
  status: "ready",
};

const DEFAULT_STICKY_TABS: WorkspaceTab[] = [
  DEFAULT_WORKSPACE_TAB,
  DEFAULT_PREP_CLASSROOM_TAB,
];

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
  learnerId: null,
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
    return { label: "Markdown", colorClass: "text-muted-foreground", openMode: "markdown" as const, priority: 74 };
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
    learnerId: statusResponse.request?.learner_id ?? null,
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

function MainWorkspaceQuestions({
  learningGoal,
  learnerId,
  sessionId,
  questions,
  isLoading,
  error,
  emptyHint,
}: {
  learningGoal: string;
  learnerId?: string | null;
  sessionId?: string | null;
  questions: PracticeQuestionRecord[];
  isLoading: boolean;
  error?: string | null;
  emptyHint?: string;
}) {
  return (
    <PracticeQuestionWorkspace
      learningGoal={learningGoal}
      learnerId={learnerId}
      sessionId={sessionId}
      questions={questions}
      isLoading={isLoading}
      error={error}
      emptyHint={emptyHint}
    />
  );
}

function MainPreparationWorkspace({
  workspaceData,
  canPrepareClassroom,
  isPreparingClassroom,
  prepareClassroomError,
  onPrepareClassroom,
  onOpenMaterial,
}: {
  workspaceData: StudyWorkspaceData;
  canPrepareClassroom: boolean;
  isPreparingClassroom: boolean;
  prepareClassroomError: string | null;
  onPrepareClassroom: () => void;
  onOpenMaterial: (material: StudyMaterialItem) => void;
}) {
  const featuredMaterials = workspaceData.materials.slice(0, 6);

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1">
      <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-[linear-gradient(135deg,rgba(246,248,252,0.96),rgba(255,255,255,0.98))] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] md:p-8">
        <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-sky-100/70 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-emerald-100/70 blur-3xl" />

        <div className="relative flex flex-col gap-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                课前准备
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[2rem]">
                  先把课前多智能体产物收拢好，再一键带入课中生成
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-[15px]">
                  这里会统一检查学案、题型蓝图、讲解备注和辅助素材。点击“准备课中”后，后端会把这些课前
                  material 自动整理并透传给课中工作流，用同一个主题继续生成课堂播放内容。
                </p>
              </div>
            </div>

            <div className="w-full max-w-sm rounded-[24px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">当前状态</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{workspaceData.statusLabel}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{workspaceData.workspaceSubtitle}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 px-3 py-2 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">素材数</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{workspaceData.materials.length}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={onPrepareClassroom}
                disabled={!canPrepareClassroom || isPreparingClassroom}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isPreparingClassroom ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在准备课中
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    准备课中
                  </>
                )}
              </button>

              {!canPrepareClassroom && (
                <p className="mt-3 text-xs leading-6 text-slate-500">
                  {workspaceData.usingMock
                    ? "当前是示例数据，创建真实课前任务后才能进入课中生成。"
                    : "请等待课前任务完成后，再继续准备课中播放。"}
                </p>
              )}

              {prepareClassroomError && (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-600">
                  {prepareClassroomError}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1fr]">
            <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">课中将沿用</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">核心教学目标</h3>
                </div>
                <Target className="h-5 w-5 text-sky-500" />
              </div>
              <div className="mt-4 space-y-2">
                {workspaceData.goals.map((goal, index) => (
                  <div
                    key={`${goal}-${index}`}
                    className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700"
                  >
                    {goal}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">进入课中前</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">教师检查项</h3>
                </div>
                <Brain className="h-5 w-5 text-emerald-500" />
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {workspaceData.teacherChecklist.length > 0 ? (
                  workspaceData.teacherChecklist.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="leading-6">{item}</span>
                    </div>
                  ))
                ) : (
                  <p className="leading-6 text-slate-500">当前还没有额外的教师检查项。</p>
                )}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">透传到课中</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">重点素材</h3>
                </div>
                <Package className="h-5 w-5 text-amber-500" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {featuredMaterials.length > 0 ? (
                  featuredMaterials.map((material) => (
                    <button
                      key={material.id}
                      type="button"
                      onClick={() => onOpenMaterial(material)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50/80 px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <span>{material.label}</span>
                      <span className="max-w-28 truncate text-slate-400">{material.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-slate-500">当前还没有可透传的素材文件。</p>
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr]">
            <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">准备说明</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">课中生成会继承什么</h3>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">1</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">保留课前主题</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">继续沿用当前学习目标、学段、学情和总控规划重点。</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">2</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">透传多智能体材料</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">学案、题型蓝图、教师备注等文本素材会作为 materials 输入给课中工作流。</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">3</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">生成可播放课堂</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">课中生成完成后会自动进入播放器，随后再进入独立练习区。</p>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">质量基线</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">当前备课标准</h3>
              <div className="mt-4 space-y-3">
                {workspaceData.qualityBar.length > 0 ? (
                  workspaceData.qualityBar.map((item, index) => (
                    <div
                      key={`${item}-${index}`}
                      className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700"
                    >
                      {item}
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-slate-500">当前还没有额外的质量要求。</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function isPreviewableMaterial(mode: MaterialOpenMode) {
  return mode === "markdown" || mode === "link";
}

function MaterialFileTree({ materials, handleMaterialAction }: { materials: StudyMaterialItem[], handleMaterialAction: (m: StudyMaterialItem) => void }) {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const groupedMaterials = useMemo(() => {
    const groups: Record<string, StudyMaterialItem[]> = {};
    materials.forEach(m => {
      const folderName = m.description || "其他文件";
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(m);
    });
    return groups;
  }, [materials]);

  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => ({
      ...prev,
      [folderName]: prev[folderName] === undefined ? false : !prev[folderName]
    }));
  };

  return (
    <div className="flex flex-col gap-1 w-full text-sm">
      {Object.entries(groupedMaterials).map(([folderName, files]) => {
        const isOpen = openFolders[folderName] !== false;

        return (
          <div key={folderName} className="flex flex-col">
            <div
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md hover:bg-muted/60 transition-colors text-foreground font-medium"
              onClick={() => toggleFolder(folderName)}
            >
              {isOpen ? <FolderOpen className="w-4 h-4 text-sky-500 fill-sky-200" /> : <Folder className="w-4 h-4 text-sky-500 fill-sky-200" />}
              <span className="truncate">{folderName}</span>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-50" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />}
            </div>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex flex-col overflow-hidden"
                >
                  <div className="flex flex-col gap-0.5 mt-0.5 mb-2 ml-3 pl-3 border-l border-border/60">
                    {files.map((material, i) => (
                      <motion.div
                        key={material.id}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.04, ease: "easeOut" }}
                        className={`flex items-center justify-between gap-3 px-2 py-1.5 rounded-md transition-colors border border-transparent hover:border-border hover:bg-muted/60 group/file ${isPreviewableMaterial(material.openMode) ? "cursor-pointer" : ""
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
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className={`w-4 h-4 shrink-0 opacity-80 ${material.colorClass}`} />
                          <span className="truncate text-muted-foreground group-hover/file:text-foreground transition-colors">{material.name}</span>
                        </div>

                        <div className="shrink-0 transition-opacity">
                          {material.openMode === "markdown" ? (
                            <FileText className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          ) : material.openMode === "link" ? (
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function StudyArea() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<StudyWorkspaceData>(MOCK_WORKSPACE_DATA);
  const [practiceQuestions, setPracticeQuestions] =
    useState<PracticeQuestionRecord[]>(MOCK_PRACTICE_QUESTIONS);
  const [practiceQuestionsError, setPracticeQuestionsError] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isPreparingClassroom, setIsPreparingClassroom] = useState(false);
  const [prepareClassroomError, setPrepareClassroomError] = useState<string | null>(null);
  const [learnerModel, setLearnerModel] = useState<LearnerModelData | null>(null);
  const [isLoadingLearnerModel, setIsLoadingLearnerModel] = useState(false);
  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>(DEFAULT_STICKY_TABS);
  const [activeTabId, setActiveTabId] = useState<string>(WORKSPACE_TAB_ID);

  const activeTab =
    openTabs.find((tab) => tab.id === activeTabId) ?? DEFAULT_WORKSPACE_TAB;

  const togglePanel = (panel: string) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const resolveBuiltInTabId = (requestedTab: string | null) =>
    requestedTab === PREP_CLASSROOM_QUERY_VALUE ? PREP_CLASSROOM_TAB_ID : WORKSPACE_TAB_ID;

  const setBuiltInTab = (tabId: typeof WORKSPACE_TAB_ID | typeof PREP_CLASSROOM_TAB_ID) => {
    setActiveTabId(tabId);
    const nextSearchParams = new URLSearchParams(searchParams);
    if (tabId === PREP_CLASSROOM_TAB_ID) {
      nextSearchParams.set("tab", PREP_CLASSROOM_QUERY_VALUE);
    } else {
      nextSearchParams.delete("tab");
    }
    setSearchParams(nextSearchParams, { replace: true });
  };

  useEffect(() => {
    setOpenTabs(DEFAULT_STICKY_TABS);
    setActiveTabId(resolveBuiltInTabId(searchParams.get("tab")));
    setPrepareClassroomError(null);
    setIsPreparingClassroom(false);
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

  useEffect(() => {
    if (!workspaceData.learnerId || workspaceData.usingMock) {
      setLearnerModel(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setIsLoadingLearnerModel(true);
    fetch(`/api/v1/learner-models/${encodeURIComponent(workspaceData.learnerId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: LearnerModelData) => {
        if (!cancelled) setLearnerModel(data);
      })
      .catch(() => {
        if (!cancelled) setLearnerModel(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLearnerModel(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceData.learnerId, workspaceData.usingMock]);

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
    if (tabId === WORKSPACE_TAB_ID || tabId === PREP_CLASSROOM_TAB_ID) {
      return;
    }
    setOpenTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(resolveBuiltInTabId(searchParams.get("tab")));
    }
  };

  const openPreviewTab = async (material: StudyMaterialItem) => {
    const existingTab = openTabs.find((tab) => tab.id === material.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const previewType =
      material.openMode === "markdown"
        ? "markdown"
        : material.openMode === "link"
          ? "html"
          : "video";

    const nextTab: WorkspaceTab = {
      id: material.id,
      title: material.name,
      type: previewType as any,
      status: previewType === "markdown" && !material.previewContent ? "loading" : "ready",
      content: previewType === "markdown" ? material.previewContent : undefined,
      sourceUrl: material.previewUrl,
      downloadUrl: material.downloadUrl,
    };

    setOpenTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTabId(material.id);

    if (
      previewType !== "markdown" ||
      material.previewContent ||
      !material.previewUrl ||
      material.previewUrl === "#"
    ) {
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
    if (material.openMode === "markdown" || material.openMode === "link") {
      void openPreviewTab(material);
      return;
    }

    const targetUrl = material.previewUrl ?? material.downloadUrl;
    if (!targetUrl || targetUrl === "#") {
      return;
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  const handlePrepareClassroom = async () => {
    if (!runId || workspaceData.usingMock || isPreparingClassroom) {
      return;
    }

    setPrepareClassroomError(null);
    setIsPreparingClassroom(true);

    try {
      const classroomLookupResponse = await fetch(
        `/api/v1/prep-runs/${encodeURIComponent(runId)}/classroom`,
        {
          headers: { Accept: "application/json" },
        }
      );

      if (classroomLookupResponse.ok) {
        const existingPayload = (await classroomLookupResponse.json()) as { run_id?: string };
        if (existingPayload.run_id) {
          navigate(`/lesson/${encodeURIComponent(existingPayload.run_id)}`, {
            state: { classroomLaunchMode: "existing" },
          });
          return;
        }
      } else if (classroomLookupResponse.status !== 404) {
        let message = `检查已有课中任务失败（${classroomLookupResponse.status}）`;
        try {
          const payload = (await classroomLookupResponse.json()) as {
            detail?: string | Array<{ msg?: string }>;
          };
          if (typeof payload.detail === "string" && payload.detail.trim()) {
            message = payload.detail;
          } else if (Array.isArray(payload.detail)) {
            const firstMessage = payload.detail[0]?.msg;
            if (typeof firstMessage === "string" && firstMessage.trim()) {
              message = firstMessage;
            }
          }
        } catch {
          // Keep fallback message.
        }
        throw new Error(message);
      }

      const response = await fetch(`/api/v1/prep-runs/${encodeURIComponent(runId)}/classroom`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        let message = `准备课中失败（${response.status}）`;
        try {
          const payload = (await response.json()) as { detail?: string | Array<{ msg?: string }> };
          if (typeof payload.detail === "string" && payload.detail.trim()) {
            message = payload.detail;
          } else if (Array.isArray(payload.detail)) {
            const firstMessage = payload.detail[0]?.msg;
            if (typeof firstMessage === "string" && firstMessage.trim()) {
              message = firstMessage;
            }
          }
        } catch {
          // Keep fallback message.
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as { run_id?: string };
      if (!payload.run_id) {
        throw new Error("后端未返回课中任务 ID，暂时无法进入课中播放页。");
      }

      navigate(`/lesson/${encodeURIComponent(payload.run_id)}`, {
        state: { classroomLaunchMode: "new" },
      });
    } catch (error) {
      setPrepareClassroomError(
        error instanceof Error ? error.message : "准备课中失败，请稍后重试。"
      );
    } finally {
      setIsPreparingClassroom(false);
    }
  };

  const renderWorkspaceContent = () => {
    if (activeTab.type === "workspace") {
      return (
        <MainWorkspaceQuestions
          learningGoal={workspaceData.workspaceTitle}
          learnerId={workspaceData.learnerId}
          sessionId={runId ?? null}
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

    if (activeTab.type === "prep") {
      return (
        <MainPreparationWorkspace
          workspaceData={workspaceData}
          canPrepareClassroom={
            Boolean(runId) && !workspaceData.usingMock && workspaceData.statusLabel === "已完成"
          }
          isPreparingClassroom={isPreparingClassroom}
          prepareClassroomError={prepareClassroomError}
          onPrepareClassroom={handlePrepareClassroom}
          onOpenMaterial={handleMaterialAction}
        />
      );
    }

    return (
      <div className="h-full min-h-0 overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{activeTab.title}</p>
            <p className="text-xs text-muted-foreground">在线预览</p>
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

        {activeTab.type === "html" || activeTab.type === "video" ? (
          <div className="h-[calc(100%-61px)]">
            {activeTab.type === "html" ? (
              activeTab.sourceUrl ? (
                <iframe
                  title={activeTab.title}
                  src={activeTab.sourceUrl}
                  className="h-full w-full border-0 bg-card text-card-foreground"
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div className="px-6 py-5 text-sm text-muted-foreground">当前网页素材没有可用的预览地址。</div>
              )
            ) : activeTab.sourceUrl ? (
              <div className="flex h-full items-center justify-center bg-black p-4 md:p-6">
                <video controls className="max-h-full w-full rounded-xl bg-black shadow-2xl" src={activeTab.sourceUrl}>
                  当前浏览器不支持视频播放。
                </video>
              </div>
            ) : (
              <div className="px-6 py-5 text-sm text-muted-foreground">当前视频素材没有可用的播放地址。</div>
            )}
          </div>
        ) : (
          <ScrollArea className="h-[calc(100%-61px)] px-6 py-5">
            {activeTab.status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="w-4 h-4 animate-spin" />
                正在加载内容...
              </div>
            )}

            {activeTab.status === "error" && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {activeTab.error || "文档加载失败。"}
              </div>
            )}

            {activeTab.status === "ready" && (
              <Markdown className="prose prose-slate max-w-none [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_pre]:overflow-x-auto">
                {activeTab.content || "# 空文档\n\n当前文档没有可展示的内容。"}
              </Markdown>
            )}
          </ScrollArea>
        )}
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
          <div className="ml-auto flex items-center pr-2">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 overflow-hidden relative">
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            <div className="flex items-center px-4 h-11 border-b shrink-0 bg-muted/10 gap-2 overflow-x-auto">
              <button
                className={`flex items-center gap-2 h-full px-2 border-b-2 font-medium text-sm transition-colors ${activeTabId === WORKSPACE_TAB_ID
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                onClick={() => setBuiltInTab(WORKSPACE_TAB_ID)}
              >
                <LayoutDashboard className="w-4 h-4" />
                学习区
              </button>

              <button
                className={`flex items-center gap-2 h-full px-2 border-b-2 font-medium text-sm transition-colors ${activeTabId === PREP_CLASSROOM_TAB_ID
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                onClick={() => setBuiltInTab(PREP_CLASSROOM_TAB_ID)}
              >
                <Play className="w-4 h-4" />
                准备课中
              </button>

              {openTabs
                .filter((tab) => tab.id !== WORKSPACE_TAB_ID && tab.id !== PREP_CLASSROOM_TAB_ID)
                .map((tab) => (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${activeTabId === tab.id ? "bg-primary/8 text-primary" : "text-muted-foreground"
                      }`}
                  >
                    <button
                      className="flex items-center gap-2 text-sm min-w-0"
                      onClick={() => setActiveTabId(tab.id)}
                    >
                      {tab.type === "html" ? (
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      ) : tab.type === "video" ? (
                        <Play className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                      )}
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
            className={`shrink-0 overflow-hidden relative shadow-sm z-10 ${isDragging ? "transition-none" : "transition-all duration-300 ease-in-out"
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
                  {activePanel === "profile" && (
                    <>
                      <User className="w-4 h-4 text-primary" /> 学生画像
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
                        <div className="flex justify-end">
                          {workspaceData.bundleDownloadUrl && workspaceData.bundleDownloadUrl !== "#" && (
                            <Button variant="outline" size="sm" asChild>
                              <a href={workspaceData.bundleDownloadUrl} target="_blank" rel="noreferrer">
                                <Download className="w-3.5 h-3.5" />
                                下载全部打包文件
                              </a>
                            </Button>
                          )}
                        </div>

                        {workspaceData.materials.length > 0 ? (
                          <MaterialFileTree materials={workspaceData.materials} handleMaterialAction={handleMaterialAction} />
                        ) : (
                          <div className="text-sm text-muted-foreground p-3">当前还没有可下载素材。</div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activePanel === "profile" && (
                  <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200 pb-4">
                    {isLoadingLearnerModel && (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <LoaderCircle className="w-5 h-5 animate-spin mr-2" /> 加载学生画像...
                      </div>
                    )}
                    {!isLoadingLearnerModel && !learnerModel && (
                      <div className="text-sm text-muted-foreground p-4 text-center">
                        {workspaceData.learnerId
                          ? "暂无学情数据，完成练习后画像将自动更新。"
                          : "当前未关联学习者，无法显示画像。"}
                      </div>
                    )}
                    {learnerModel && (
                      <>
                        {/* Overall Band */}
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0",
                            learnerModel.snapshot.overall_band === "advanced" && "bg-violet-500",
                            learnerModel.snapshot.overall_band === "proficient" && "bg-emerald-500",
                            learnerModel.snapshot.overall_band === "developing" && "bg-amber-500",
                            learnerModel.snapshot.overall_band === "needs_support" && "bg-orange-500",
                            learnerModel.snapshot.overall_band === "evidence_needed" && "bg-slate-400",
                          )}>
                            {learnerModel.snapshot.overall_mastery != null
                              ? Math.round(learnerModel.snapshot.overall_mastery * 100)
                              : "?"}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">
                              {({ advanced: "优秀", proficient: "良好", developing: "发展中", needs_support: "需支持", evidence_needed: "待评估" } as Record<string, string>)[learnerModel.snapshot.overall_band] ?? learnerModel.snapshot.overall_band}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              掌握度 {Math.round(learnerModel.snapshot.overall_mastery * 100)}% · 可信度 {Math.round(learnerModel.snapshot.overall_confidence * 100)}%
                            </div>
                          </div>
                        </div>

                        {/* Mastery Bar */}
                        <div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                            <span>整体掌握度</span>
                            <span>{Math.round(learnerModel.snapshot.overall_mastery * 100)}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${Math.round(learnerModel.snapshot.overall_mastery * 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Evaluation Summary */}
                        {learnerModel.snapshot.evaluation_summary && (
                          <div className="rounded-lg bg-muted/50 border border-border p-3">
                            <p className="text-xs text-muted-foreground mb-1 font-medium">整体评价</p>
                            <p className="text-sm text-foreground leading-relaxed">{learnerModel.snapshot.evaluation_summary}</p>
                          </div>
                        )}

                        {/* Strong / Weak Skills */}
                        {learnerModel.snapshot.strong_skills.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">优势技能</p>
                            <div className="flex flex-wrap gap-1.5">
                              {learnerModel.snapshot.strong_skills.map((s, i) => (
                                <span key={i} className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs border border-emerald-100">{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {learnerModel.snapshot.weak_skills.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">薄弱技能</p>
                            <div className="flex flex-wrap gap-1.5">
                              {learnerModel.snapshot.weak_skills.map((s, i) => (
                                <span key={i} className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs border border-amber-100">{s}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Misconceptions */}
                        {learnerModel.snapshot.key_misconceptions.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">常见误区</p>
                            <ul className="space-y-1">
                              {learnerModel.snapshot.key_misconceptions.map((m, i) => (
                                <li key={i} className="text-xs text-rose-600 flex items-start gap-1.5">
                                  <span className="shrink-0 mt-0.5">•</span>
                                  <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Recommended Focus */}
                        {learnerModel.snapshot.recommended_focus.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">建议关注</p>
                            <ul className="space-y-1">
                              {learnerModel.snapshot.recommended_focus.map((f, i) => (
                                <li key={i} className="text-xs text-indigo-600 flex items-start gap-1.5">
                                  <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Stats */}
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>累计事件 <strong className="text-foreground">{learnerModel.snapshot.total_events}</strong></span>
                          <span>会话数 <strong className="text-foreground">{learnerModel.snapshot.total_sessions}</strong></span>
                        </div>

                        {/* Recent Events Timeline */}
                        {learnerModel.recent_events.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2 font-medium">近期学习记录</p>
                            <div className="space-y-2">
                              {learnerModel.recent_events.slice(0, 8).map((evt) => (
                                <div key={evt.event_id} className="rounded-lg border border-border bg-card p-2.5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={cn(
                                      "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                      evt.correctness === "correct" && "bg-emerald-50 text-emerald-700",
                                      evt.correctness === "partial" && "bg-amber-50 text-amber-700",
                                      evt.correctness === "incorrect" && "bg-rose-50 text-rose-700",
                                      !["correct", "partial", "incorrect"].includes(evt.correctness) && "bg-muted text-muted-foreground",
                                    )}>
                                      {evt.correctness === "correct" ? "正确" : evt.correctness === "partial" ? "部分正确" : evt.correctness === "incorrect" ? "错误" : evt.correctness}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">{evt.score}分</span>
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {evt.question_type} · {new Date(evt.timestamp).toLocaleDateString()}
                                  </div>
                                  {evt.learner_observations.length > 0 && (
                                    <p className="text-[11px] text-foreground mt-1 leading-relaxed line-clamp-2">
                                      {evt.learner_observations[0]}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
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
                  className={`w-10 h-10 rounded-xl ${activePanel === "goals"
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
                  className={`w-10 h-10 rounded-xl ${activePanel === "materials"
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
                  variant={activePanel === "profile" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-10 h-10 rounded-xl ${activePanel === "profile"
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "text-muted-foreground"
                    }`}
                  onClick={() => togglePanel("profile")}
                >
                  <User className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">
                学生画像
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activePanel === "progress" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-10 h-10 rounded-xl ${activePanel === "progress"
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
