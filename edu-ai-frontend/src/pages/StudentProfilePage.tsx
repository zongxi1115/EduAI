import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Target,
  UserRound,
} from "lucide-react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getOrCreateGuestLearnerId } from "@/lib/learner";
import { cn } from "@/lib/utils";

type AbilityBand =
  | "evidence_needed"
  | "needs_support"
  | "developing"
  | "proficient"
  | "advanced";

type RecommendationType =
  | "diagnose"
  | "remediate"
  | "consolidate"
  | "advance"
  | "challenge";

interface LearningRecommendation {
  target_id: string;
  title: string;
  recommendation_type: RecommendationType;
  priority: number;
  score: number;
  reason: string;
  suggested_action: string;
}

interface SkillState {
  skill_id: string;
  display_name: string;
  graph_dataset_id?: string | null;
  graph_node_title?: string | null;
  mastery: number;
  confidence: number;
  freshness: number;
  evidence_count: number;
  rolling_score: number;
  recent_scores: number[];
  misconception_counts: Record<string, number>;
  recent_observations: string[];
  last_updated: string;
}

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
  learning_recommendations?: LearningRecommendation[];
  prompt_profile: string;
  evaluation_summary: string;
  updated_at: string;
}

interface SkillJudgment {
  skill_id: string;
  display_name: string;
  score: number;
  reasoning_quality?: number;
  observation: string;
}

interface LearningEvidenceEvent {
  event_id: string;
  learner_id: string;
  learning_goal?: string | null;
  question_id: string;
  question_type: string;
  correctness: string;
  score: number;
  skill_judgments: SkillJudgment[];
  learner_observations: string[];
  issues?: string[];
  review_advice?: string[];
  timestamp: string;
}

interface LearnerModelRecord {
  learner_id: string;
  updated_at: string;
  total_events: number;
  total_sessions: number;
  recent_observations: string[];
  skills: Record<string, SkillState>;
}

interface LearnerModelData {
  learner: LearnerModelRecord;
  snapshot: LearnerModelSnapshot;
  recent_events: LearningEvidenceEvent[];
}

interface AbilityMetric {
  label: string;
  value: number;
  reference: number;
}

interface TrendPoint {
  label: string;
  value: number;
  reference: number;
}

const BAND_LABELS: Record<AbilityBand, string> = {
  evidence_needed: "待评估",
  needs_support: "需要支持",
  developing: "发展中",
  proficient: "状态良好",
  advanced: "掌握稳固",
};

const BAND_STYLES: Record<AbilityBand, string> = {
  evidence_needed: "bg-slate-50 text-slate-700 border-slate-200",
  needs_support: "bg-orange-50 text-orange-700 border-orange-200",
  developing: "bg-amber-50 text-amber-700 border-amber-200",
  proficient: "bg-emerald-50 text-emerald-700 border-emerald-200",
  advanced: "bg-blue-50 text-blue-700 border-blue-200",
};

const RECOMMENDATION_LABELS: Record<RecommendationType, string> = {
  diagnose: "先确认卡点",
  remediate: "补薄弱点",
  consolidate: "巩固一下",
  advance: "学下一步",
  challenge: "挑战提升",
};

function toPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[], fallback = 0) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return fallback;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "暂无记录";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function correctnessLabel(value: string) {
  if (value === "correct") return "正确";
  if (value === "partially_correct" || value === "partial") return "部分正确";
  if (value === "incorrect") return "错误";
  if (value === "ungradable") return "待评估";
  return value || "未知";
}

function correctnessTone(value: string) {
  if (value === "correct")
    return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (value === "partially_correct" || value === "partial")
    return "bg-amber-50 text-amber-700 border-amber-100";
  if (value === "incorrect") return "bg-rose-50 text-rose-700 border-rose-100";
  return "bg-slate-50 text-slate-600 border-slate-100";
}

function uniqueSkills(skills: SkillState[]) {
  const seen = new Set<string>();
  const result: SkillState[] = [];

  for (const skill of skills) {
    const key = skill.display_name.trim() || skill.skill_id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(skill);
  }

  return result;
}

function deriveAbilityMetrics(data: LearnerModelData | null): AbilityMetric[] {
  if (!data) {
    return [
      { label: "理解", value: 0, reference: 70 },
      { label: "应用", value: 0, reference: 70 },
      { label: "记忆", value: 0, reference: 70 },
      { label: "专注", value: 0, reference: 70 },
      { label: "表达", value: 0, reference: 70 },
      { label: "自主学习", value: 0, reference: 70 },
    ];
  }

  const skills = Object.values(data.learner.skills);
  const events = data.recent_events;
  const reasoningScores = events.flatMap((event) =>
    event.skill_judgments
      .map((judgment) => judgment.reasoning_quality)
      .filter((value): value is number => typeof value === "number"),
  );
  const expressionEvents = events.filter((event) =>
    /short|answer|fill|drawing|programming|简答|填空|作图|编程/i.test(
      event.question_type,
    ),
  );
  const memorySkills = skills.filter((skill) =>
    /记忆|术语|概念|辨析|定义|符号/.test(skill.display_name),
  );

  const mastery = toPercent(data.snapshot.overall_mastery);
  const rolling = toPercent(
    average(
      skills.map((skill) => skill.rolling_score),
      data.snapshot.overall_mastery,
    ),
  );
  const memory = toPercent(
    average(
      memorySkills.map((skill) => skill.mastery),
      data.snapshot.overall_mastery,
    ),
  );
  const focus = toPercent(data.snapshot.overall_confidence);
  const expression = clampPercent(
    average(
      expressionEvents.map((event) => event.score),
      mastery,
    ),
  );
  const autonomy = clampPercent(
    38 +
      Math.min(data.snapshot.total_sessions, 8) * 6 +
      Math.min(data.snapshot.total_events, 50) * 0.45,
  );
  const understanding = reasoningScores.length
    ? clampPercent(average(reasoningScores) * 100)
    : mastery;

  return [
    { label: "理解", value: understanding, reference: 72 },
    { label: "应用", value: rolling, reference: 68 },
    { label: "记忆", value: memory, reference: 70 },
    { label: "专注", value: focus, reference: 66 },
    { label: "表达", value: expression, reference: 64 },
    { label: "自主学习", value: autonomy, reference: 70 },
  ];
}

function deriveTrendPoints(events: LearningEvidenceEvent[]): TrendPoint[] {
  const chronological = [...events]
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    )
    .slice(-7);

  if (chronological.length === 0) {
    return [];
  }

  let runningSum = 0;
  return chronological.map((event, index) => {
    runningSum += event.score;
    return {
      label: `第${index + 1}次`,
      value: clampPercent(runningSum / (index + 1)),
      reference: 70,
    };
  });
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-2 text-[18px] font-bold text-blue-700 md:text-[21px]">
      <span>{index}.</span>
      <span>{title}</span>
    </div>
  );
}

function SoftPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-blue-100/80 bg-white/[0.86] shadow-[0_14px_42px_rgba(29,78,216,0.10)] backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}

function RingMetric({
  value,
  label,
  sublabel,
  color,
}: {
  value: number;
  label: string;
  sublabel: string;
  color: string;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampPercent(value) / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke="#e8eef8"
          strokeWidth="8"
        />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 38 38)"
        />
        <text
          x="38"
          y="42"
          textAnchor="middle"
          className="fill-slate-950 text-lg font-bold"
        >
          {clampPercent(value)}%
        </text>
      </svg>
      <div className="text-center">
        <div className="text-xs font-semibold text-slate-900">{label}</div>
        <div className="text-[11px] text-slate-500">{sublabel}</div>
      </div>
    </div>
  );
}

function RadarChart({ metrics }: { metrics: AbilityMetric[] }) {
  const center = 108;
  const radius = 74;
  const angleOffset = -Math.PI / 2;

  const toPoint = (value: number, index: number) => {
    const angle = angleOffset + (index / metrics.length) * Math.PI * 2;
    const scaled = (value / 100) * radius;
    return {
      x: center + Math.cos(angle) * scaled,
      y: center + Math.sin(angle) * scaled,
    };
  };

  const points = metrics
    .map((metric, index) => toPoint(metric.value, index))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const referencePoints = metrics
    .map((metric, index) => toPoint(metric.reference, index))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div className="flex items-center justify-center">
      <svg
        width="250"
        height="228"
        viewBox="0 0 250 228"
        aria-label="能力雷达图"
      >
        {[20, 40, 60, 80, 100].map((ring) => {
          const ringPoints = metrics
            .map((_, index) => toPoint(ring, index))
            .map((point) => `${point.x},${point.y}`)
            .join(" ");
          return (
            <polygon
              key={ring}
              points={ringPoints}
              fill="none"
              stroke="#dbe7f8"
              strokeWidth="1"
            />
          );
        })}
        {metrics.map((metric, index) => {
          const point = toPoint(100, index);
          const labelPoint = toPoint(116, index);
          return (
            <g key={metric.label}>
              <line
                x1={center}
                y1={center}
                x2={point.x}
                y2={point.y}
                stroke="#e1eaf7"
                strokeWidth="1"
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-700 text-[12px] font-semibold"
              >
                {metric.label}
              </text>
            </g>
          );
        })}
        <polygon
          points={referencePoints}
          fill="#93c5fd"
          opacity="0.16"
          stroke="#60a5fa"
          strokeDasharray="3 4"
          strokeWidth="2"
        />
        <polygon
          points={points}
          fill="#2563eb"
          opacity="0.18"
          stroke="#1d4ed8"
          strokeWidth="2.5"
        />
        {metrics.map((metric, index) => {
          const point = toPoint(metric.value, index);
          return (
            <circle
              key={metric.label}
              cx={point.x}
              cy={point.y}
              r="3"
              fill="#1d4ed8"
            />
          );
        })}
      </svg>
    </div>
  );
}

function MiniBarChart({ values, color }: { values: number[]; color: string }) {
  const bars =
    values.length > 0 ? values.slice(-7) : [20, 40, 32, 58, 45, 68, 76];

  return (
    <div className="flex h-16 items-end gap-2">
      {bars.map((value, index) => (
        <div
          key={`${value}-${index}`}
          className={cn("w-3 rounded-t", color)}
          style={{ height: `${Math.max(10, clampPercent(value) * 0.58)}px` }}
        />
      ))}
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-500">
        暂无趋势数据
      </div>
    );
  }

  const width = 460;
  const height = 210;
  const paddingX = 34;
  const paddingY = 24;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;
  const xFor = (index: number) =>
    paddingX +
    (points.length === 1
      ? plotWidth / 2
      : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number) =>
    paddingY + plotHeight - (clampPercent(value) / 100) * plotHeight;
  const userPath = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.value)}`,
    )
    .join(" ");
  const referencePath = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.reference)}`,
    )
    .join(" ");

  return (
    <svg
      className="h-56 w-full"
      viewBox={`0 0 ${width} ${height}`}
      aria-label="成长趋势图"
    >
      {[0, 25, 50, 75, 100].map((value) => (
        <g key={value}>
          <line
            x1={paddingX}
            y1={yFor(value)}
            x2={width - paddingX}
            y2={yFor(value)}
            stroke="#e8eef8"
            strokeWidth="1"
          />
          <text
            x={paddingX - 10}
            y={yFor(value) + 4}
            textAnchor="end"
            className="fill-slate-500 text-[11px]"
          >
            {value}
          </text>
        </g>
      ))}
      <path
        d={referencePath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth="2"
        strokeDasharray="3 5"
      />
      <path
        d={userPath}
        fill="none"
        stroke="#2563eb"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle
            cx={xFor(index)}
            cy={yFor(point.value)}
            r="4"
            fill="#2563eb"
          />
          <text
            x={xFor(index)}
            y={height - 5}
            textAnchor="middle"
            className="fill-slate-500 text-[11px]"
          >
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="relative h-24 w-24">
      <div className="absolute inset-1 rounded-full border-[10px] border-blue-100" />
      <div className="absolute inset-0 rounded-full border border-blue-200 bg-blue-50/60" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-black leading-none text-blue-600">
          {score}
        </div>
        <div className="mt-1 text-[12px] font-semibold text-slate-500">
          /100
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  learnerId,
  onRetry,
}: {
  learnerId: string;
  onRetry: () => void;
}) {
  return (
    <SoftPanel className="p-10">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <UserRound className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-2xl font-bold text-slate-950">
          还没有形成可查看的学生画像
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          当前 learner_id 为{" "}
          <span className="font-mono text-blue-700">{learnerId}</span>
          。完成练习并产生批阅结果后，系统会把学习事件写入长期画像。
        </p>
        <Button className="mt-6 h-9 rounded-xl px-4" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          重新加载
        </Button>
      </div>
    </SoftPanel>
  );
}

export default function StudentProfilePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [guestLearnerId] = useState(() => getOrCreateGuestLearnerId());
  const queryLearnerId = searchParams.get("learner_id")?.trim();
  const queryScope = searchParams.get("scope")?.trim() || "recent";
  const queryDatasetId = searchParams.get("dataset_id")?.trim() || "";
  const queryCourseId = searchParams.get("course_id")?.trim() || "";
  const queryGraphNodeId = searchParams.get("graph_node_id")?.trim() || "";
  const querySessionId = searchParams.get("session_id")?.trim() || "";
  const defaultLearnerId = user?.learner_id ?? guestLearnerId;
  const initialLearnerId = queryLearnerId || defaultLearnerId;
  const [submittedLearnerId, setSubmittedLearnerId] =
    useState(initialLearnerId);
  const [inputLearnerId, setInputLearnerId] = useState(initialLearnerId);
  const activeLearnerId = (queryLearnerId || submittedLearnerId || defaultLearnerId).trim();
  const [data, setData] = useState<LearnerModelData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const nextLearnerId = queryLearnerId || defaultLearnerId;
    setSubmittedLearnerId(nextLearnerId);
    setInputLearnerId(nextLearnerId);
  }, [defaultLearnerId, queryLearnerId]);

  useEffect(() => {
    if (!activeLearnerId) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
    });

    const profileParams = new URLSearchParams({
      event_limit: "30",
      scope: queryScope,
    });
    if (queryDatasetId) profileParams.set("dataset_id", queryDatasetId);
    if (queryCourseId) profileParams.set("course_id", queryCourseId);
    if (queryGraphNodeId) profileParams.set("graph_node_id", queryGraphNodeId);
    if (querySessionId) profileParams.set("session_id", querySessionId);

    fetch(`/api/v1/learner-models/${encodeURIComponent(activeLearnerId)}?${profileParams.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "没有找到该学生画像"
              : `加载失败：${response.status}`,
          );
        }
        return response.json();
      })
      .then((payload: LearnerModelData) => {
        if (!cancelled) {
          setData(payload);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setData(null);
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "加载学生画像失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeLearnerId,
    queryCourseId,
    queryDatasetId,
    queryGraphNodeId,
    queryScope,
    querySessionId,
    reloadToken,
  ]);

  const skills = useMemo(() => {
    return uniqueSkills(Object.values(data?.learner.skills ?? {}));
  }, [data]);
  const abilityMetrics = useMemo(() => deriveAbilityMetrics(data), [data]);
  const trendPoints = useMemo(
    () => deriveTrendPoints(data?.recent_events ?? []),
    [data],
  );
  const masteryScore = toPercent(data?.snapshot.overall_mastery);
  const confidenceScore = toPercent(data?.snapshot.overall_confidence);
  const band = data?.snapshot.overall_band ?? "evidence_needed";
  const topSkills = useMemo(() => {
    return [...skills]
      .sort((left, right) => right.evidence_count - left.evidence_count)
      .slice(0, 4);
  }, [skills]);
  const weakSkills = useMemo(() => {
    return [...skills]
      .sort(
        (left, right) =>
          left.mastery - right.mastery ||
          right.evidence_count - left.evidence_count,
      )
      .slice(0, 4);
  }, [skills]);
  const recentEvents = data?.recent_events ?? [];
  const recentScores = recentEvents.map((event) => event.score);
  const completedEvents = recentEvents.filter(
    (event) => event.correctness !== "ungradable",
  );
  const completionRate = recentEvents.length
    ? clampPercent((completedEvents.length / recentEvents.length) * 100)
    : 0;
  const correctRate = completedEvents.length
    ? clampPercent(
        (completedEvents.filter((event) => event.correctness === "correct")
          .length /
          completedEvents.length) *
          100,
      )
    : 0;
  const issueRate = recentEvents.length
    ? clampPercent(
        (recentEvents.filter(
          (event) =>
            event.correctness === "incorrect" ||
            event.correctness === "partially_correct",
        ).length /
          recentEvents.length) *
          100,
      )
    : 0;
  const latestObservation =
    data?.learner.recent_observations?.[0] ||
    data?.snapshot.evaluation_summary ||
    "完成更多练习后将形成更稳定的观察。";
  const latestLearningGoal = recentEvents[0]?.learning_goal?.trim();
  const scopeLabel =
    queryScope === "recent"
      ? latestLearningGoal || "最近学习主题"
      : queryScope === "global"
        ? "全局画像"
        : "筛选画像";

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextLearnerId = inputLearnerId.trim();
    if (!nextLearnerId) {
      return;
    }
    setSubmittedLearnerId(nextLearnerId);
    setSearchParams({ learner_id: nextLearnerId });
  }

  return (
    <div className="min-h-screen bg-[#f6faff] text-slate-950">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_30%),radial-gradient(circle_at_75%_0,rgba(20,184,166,0.10),transparent_28%)]" />
      <div className="relative mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 rounded-xl border-blue-100 bg-white/80 text-slate-700 shadow-sm"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </div>
          <h1 className="text-center text-4xl font-black tracking-normal text-[#071a58] md:text-5xl">
            学情分析
          </h1>
          <div className="flex items-center justify-end gap-2">
            <form
              className="hidden items-center gap-2 rounded-xl border border-blue-100 bg-white/85 p-1 shadow-sm md:flex"
              onSubmit={handleLookup}
            >
              <input
                className="h-8 w-64 rounded-lg bg-transparent px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                value={inputLearnerId}
                onChange={(event) => setInputLearnerId(event.target.value)}
                placeholder="输入 learner_id"
              />
              <Button size="sm" className="h-8 rounded-lg px-3">
                查看
              </Button>
            </form>
            <div className="rounded-xl border border-blue-100 bg-white/85 shadow-sm">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="space-y-4">
          <SectionTitle index="2" title="学生画像查看" />
          {isLoading && (
            <SoftPanel className="flex h-[720px] items-center justify-center">
              <div className="flex items-center gap-3 text-blue-700">
                <LoaderCircle className="h-6 w-6 animate-spin" />
                <span className="font-semibold">正在加载学生画像...</span>
              </div>
            </SoftPanel>
          )}

          {!isLoading && !data && (
            <EmptyState
              learnerId={activeLearnerId || "未指定"}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          )}

          {!isLoading && data && (
            <>
              <SoftPanel className="grid items-center gap-5 p-5 md:grid-cols-[1.3fr_0.8fr]">
                <div className="flex items-center gap-5">
                  <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-gradient-to-br from-blue-100 via-white to-emerald-100">
                    <UserRound className="h-12 w-12 text-blue-700" />
                    <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-3xl font-black text-slate-950">
                        学习者画像
                      </h2>
                      <span className="text-sm font-semibold text-slate-500">
                        {scopeLabel}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm font-semibold",
                        BAND_STYLES[band],
                      )}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      {BAND_LABELS[band]}
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <span>学号：{data.snapshot.learner_id.slice(0, 18)}</span>
                      <span>
                        更新：{formatDateTime(data.snapshot.updated_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-5 border-t border-blue-100 pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                  <ScoreBadge score={masteryScore} />
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                      综合画像分{" "}
                      <CircleDot className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      掌握度{" "}
                      <span className="font-bold text-blue-600">
                        {masteryScore}%
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      可信度{" "}
                      <span className="font-bold text-blue-600">
                        {confidenceScore}%
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${masteryScore}%` }}
                      />
                    </div>
                  </div>
                </div>
              </SoftPanel>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <SoftPanel className="p-5">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-slate-950">
                      知识掌握程度
                    </h2>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      {skills.length} 个技能点
                    </span>
                  </div>
                  <div className="mb-5 flex flex-wrap gap-2">
                    {(topSkills.length ? topSkills : weakSkills)
                      .slice(0, 4)
                      .map((skill, index) => (
                        <span
                          key={skill.skill_id}
                          className={cn(
                            "rounded-lg px-4 py-2 text-sm font-bold",
                            index === 0
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-50 text-slate-700",
                          )}
                        >
                          {skill.display_name}
                        </span>
                      ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {(topSkills.length ? topSkills : weakSkills)
                      .slice(0, 4)
                      .map((skill, index) => (
                        <RingMetric
                          key={skill.skill_id}
                          value={toPercent(skill.mastery)}
                          label={skill.display_name}
                          sublabel={
                            toPercent(skill.mastery) >= 85
                              ? "优秀"
                              : toPercent(skill.mastery) >= 70
                                ? "良好"
                                : "待巩固"
                          }
                          color={
                            ["#2563eb", "#f59e0b", "#14b8a6", "#f97316"][
                              index
                            ] ?? "#2563eb"
                          }
                        />
                      ))}
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    注：掌握度基于作答得分、推理质量、题目覆盖度和证据可信度综合计算。
                  </p>
                </SoftPanel>

                <SoftPanel className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-950">
                      能力分析
                    </h2>
                    <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-4 rounded-full bg-blue-600" />
                        我的水平
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-4 rounded-full border border-blue-400" />
                        目标参考
                      </span>
                    </div>
                  </div>
                  <RadarChart metrics={abilityMetrics} />
                </SoftPanel>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.82fr_1.52fr]">
                <SoftPanel className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-950">
                      薄弱知识点
                    </h2>
                    <span className="text-xs font-semibold text-slate-400">
                      查看更多
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {weakSkills.map((skill) => (
                      <div
                        key={skill.skill_id}
                        className="rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-3 text-center text-sm font-bold text-rose-600"
                      >
                        {skill.display_name}
                      </div>
                    ))}
                  </div>
                </SoftPanel>

                <SoftPanel className="p-5">
                  <h2 className="mb-4 text-lg font-bold text-slate-950">
                    学习行为
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="border-r border-blue-100 pr-3">
                      <div className="text-xs font-semibold text-slate-500">
                        近期学习事件
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {recentEvents.length}
                        <span className="text-xs font-semibold text-slate-500">
                          {" "}
                          次
                        </span>
                      </div>
                      <MiniBarChart values={recentScores} color="bg-blue-400" />
                      <div className="text-[11px] text-slate-500">
                        累计 {data.snapshot.total_events} 次
                      </div>
                    </div>
                    <div className="border-r border-blue-100 pr-3">
                      <div className="text-xs font-semibold text-slate-500">
                        作业完成率
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {completionRate}%
                      </div>
                      <RingMetric
                        value={completionRate}
                        label=""
                        sublabel=""
                        color="#14b8a6"
                      />
                      <div className="text-[11px] text-slate-500">
                        正确率 {correctRate}%
                      </div>
                    </div>
                    <div className="border-r border-blue-100 pr-3">
                      <div className="text-xs font-semibold text-slate-500">
                        课堂互动
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {data.snapshot.total_sessions}
                        <span className="text-xs font-semibold text-slate-500">
                          {" "}
                          次
                        </span>
                      </div>
                      <MiniBarChart
                        values={recentScores.map((score) =>
                          Math.max(20, score * 0.8),
                        )}
                        color="bg-violet-400"
                      />
                      <div className="text-[11px] text-slate-500">
                        会话记录数
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500">
                        待回看率
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {issueRate}%
                      </div>
                      <RingMetric
                        value={issueRate}
                        label=""
                        sublabel=""
                        color="#f97316"
                      />
                      <div className="text-[11px] text-slate-500">
                        错题/部分正确占比
                      </div>
                    </div>
                  </div>
                </SoftPanel>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
                <SoftPanel className="p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-950">
                      成长趋势
                    </h2>
                    <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-4 rounded-full bg-blue-600" />
                        我的分数
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-4 rounded-full border border-blue-400" />
                        目标线
                      </span>
                    </div>
                  </div>
                  <TrendChart points={trendPoints} />
                </SoftPanel>

                <SoftPanel className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-950">
                      个性化建议
                    </h2>
                    <span className="text-xs font-semibold text-slate-400">
                      查看更多
                    </span>
                  </div>
                  <div className="space-y-3">
                    {(data.snapshot.learning_recommendations?.length
                      ? data.snapshot.learning_recommendations
                      : data.snapshot.recommended_focus.map((item, index) => ({
                          target_id: `${item}-${index}`,
                          title: item,
                          recommendation_type:
                            "remediate" as RecommendationType,
                          priority: index + 1,
                          score: 0.8,
                          reason: item,
                          suggested_action: item,
                        }))
                    )
                      .slice(0, 3)
                      .map((item) => (
                        <div
                          key={item.target_id}
                          className="flex items-start gap-3 rounded-lg bg-blue-50/70 px-3 py-3"
                        >
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-xs font-black text-white">
                            {item.priority}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                {
                                  RECOMMENDATION_LABELS[
                                    item.recommendation_type
                                  ]
                                }
                              </span>
                              <span className="truncate text-sm font-bold text-slate-900">
                                {item.title}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              {item.suggested_action}
                            </p>
                            {item.reason && item.reason !== item.suggested_action && (
                              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                为什么推荐：{item.reason}
                              </p>
                            )}
                          </div>
                          <Target className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                        </div>
                      ))}
                  </div>
                </SoftPanel>
              </div>

              <SoftPanel className="grid gap-4 border-rose-100 bg-rose-50/70 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white shadow-sm">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-bold text-rose-950">预警信息</h2>
                    <p className="mt-1 text-sm leading-6 text-rose-800">
                      {latestObservation}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="h-9 justify-self-start rounded-xl border-rose-200 bg-white text-rose-600 md:justify-self-end"
                  onClick={() => setReloadToken((value) => value + 1)}
                >
                  查看详情
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </SoftPanel>

              <SoftPanel className="p-5">
                <h2 className="mb-4 text-lg font-bold text-slate-950">
                  近期学习记录
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {recentEvents.slice(0, 4).map((event) => (
                    <div
                      key={event.event_id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-bold",
                            correctnessTone(event.correctness),
                          )}
                        >
                          {correctnessLabel(event.correctness)}
                        </span>
                        <span className="text-sm font-black text-slate-900">
                          {event.score} 分
                        </span>
                      </div>
                      <div className="mt-3 truncate text-sm font-semibold text-slate-800">
                        {event.learning_goal || event.question_type}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(event.timestamp)}
                      </div>
                      {event.learner_observations[0] && (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                          {event.learner_observations[0]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </SoftPanel>
            </>
          )}

          {error && !isLoading && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
