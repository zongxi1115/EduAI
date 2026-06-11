import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpenCheck,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FileText,
  LoaderCircle,
  PlaySquare,
  Route,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

type PrepRunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

interface GenerationRequestSnapshot {
  learning_goal: string;
  subject: string;
  grade_level: string;
  learner_id?: string | null;
}

interface PrepRunStatusResponse {
  run_id: string;
  status: PrepRunStatus;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  request?: GenerationRequestSnapshot | null;
  plan_summary?: string | null;
  teaching_focus: string[];
  artifact_count: number;
  error?: string | null;
}

interface FileDescriptor {
  name: string;
  relative_path: string;
  size_bytes?: number | null;
  download_url: string;
}

interface ArtifactDescriptor {
  agent_name: string;
  title: string;
  status: string;
  summary: string;
  files: FileDescriptor[];
}

interface ArtifactListResponse {
  run_id: string;
  status: PrepRunStatus;
  plan_file?: FileDescriptor | null;
  report_file?: FileDescriptor | null;
  artifacts: ArtifactDescriptor[];
  bundle_download_url: string;
}

type PathStage = "prep" | "video" | "practice";

interface PathRow {
  stage: PathStage;
  order: number;
  title: string;
  owner: string;
  status: "ready" | "running" | "blocked" | "failed";
  score: number;
  duration: string;
  resourceCount: number;
  difficulty: string;
  passRate: string;
  knowledge: string;
  summary: string;
  primaryFiles: string[];
}

const STATUS_LABELS: Record<PrepRunStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "已失败",
  unknown: "未知",
};

const ROW_STATUS_LABELS: Record<PathRow["status"], string> = {
  ready: "已就绪",
  running: "生成中",
  blocked: "待生成",
  failed: "生成失败",
};

const ROW_STATUS_STYLES: Record<PathRow["status"], string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  running: "bg-blue-50 text-blue-700 ring-blue-100",
  blocked: "bg-slate-50 text-slate-600 ring-slate-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-100",
};

function getStatusLabel(status: PrepRunStatus) {
  return STATUS_LABELS[status] ?? status;
}

function getRowStatus(runStatus: PrepRunStatus, artifacts: ArtifactDescriptor[]) {
  if (runStatus === "failed" || artifacts.some((artifact) => artifact.status === "failed")) {
    return "failed" as const;
  }
  if (runStatus === "queued" || runStatus === "running") {
    return "running" as const;
  }
  if (runStatus === "succeeded") {
    return "ready" as const;
  }
  return "blocked" as const;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt || !finishedAt) {
    return "-";
  }
  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
    return "-";
  }

  const totalSeconds = Math.max(1, Math.round((finished - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
}

function findArtifacts(artifacts: ArtifactDescriptor[], names: string[]) {
  return artifacts.filter((artifact) => names.includes(artifact.agent_name));
}

function collectFileNames(artifacts: ArtifactDescriptor[], limit = 3) {
  return artifacts
    .flatMap((artifact) => artifact.files.map((file) => file.name))
    .filter(Boolean)
    .slice(0, limit);
}

function buildPathRows(
  status: PrepRunStatusResponse,
  artifactList: ArtifactListResponse | null
): PathRow[] {
  const artifacts = artifactList?.artifacts ?? [];
  const prepArtifacts = findArtifacts(artifacts, ["study_guide", "interactive_web"]);
  const videoArtifacts = findArtifacts(artifacts, ["manim"]);
  const practiceArtifacts = findArtifacts(artifacts, ["practice"]);
  const duration = formatDuration(status.started_at, status.finished_at);

  return [
    {
      stage: "prep",
      order: 1,
      title: "课前准备",
      owner: "学案 / 素材",
      status: getRowStatus(status.status, prepArtifacts),
      score: prepArtifacts.length * 25 + (artifactList?.plan_file ? 25 : 0),
      duration,
      resourceCount: prepArtifacts.reduce((total, artifact) => total + artifact.files.length, 0) + (artifactList?.plan_file ? 1 : 0),
      difficulty: "基础",
      passRate: status.status === "succeeded" ? "100%" : "-",
      knowledge: status.teaching_focus[0] || "学习目标",
      summary: status.plan_summary || "课前资料、教师提示与互动素材。",
      primaryFiles: [
        ...(artifactList?.plan_file ? [artifactList.plan_file.name] : []),
        ...collectFileNames(prepArtifacts),
      ].slice(0, 3),
    },
    {
      stage: "video",
      order: 2,
      title: "视频学习",
      owner: "课中播放",
      status: status.status === "succeeded" ? "ready" : getRowStatus(status.status, videoArtifacts),
      score: videoArtifacts.length > 0 ? 100 : 0,
      duration,
      resourceCount: videoArtifacts.reduce((total, artifact) => total + artifact.files.length, 0),
      difficulty: "中等",
      passRate: status.status === "succeeded" ? "可进入" : "-",
      knowledge: status.teaching_focus[1] || "课堂讲解",
      summary: "从课前产物生成课中讲稿与播放页。",
      primaryFiles: collectFileNames(videoArtifacts),
    },
    {
      stage: "practice",
      order: 3,
      title: "练习环节",
      owner: "题库 / 批改",
      status: getRowStatus(status.status, practiceArtifacts),
      score: practiceArtifacts.length > 0 ? 100 : 0,
      duration,
      resourceCount: practiceArtifacts.reduce((total, artifact) => total + artifact.files.length, 0),
      difficulty: "分层",
      passRate: status.status === "succeeded" ? "待作答" : "-",
      knowledge: status.teaching_focus[2] || "巩固训练",
      summary: practiceArtifacts[0]?.summary || "练习题、答案解析与学情更新。",
      primaryFiles: collectFileNames(practiceArtifacts),
    },
  ];
}

export default function LearningPathPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PrepRunStatusResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isOpeningVideo, setIsOpeningVideo] = useState(false);

  useEffect(() => {
    if (!runId) {
      setError("缺少任务 ID。");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadPath() {
      setIsLoading(true);
      setError(null);
      try {
        const [statusResponse, artifactsResponse] = await Promise.all([
          fetch(`/api/v1/prep-runs/${encodeURIComponent(runId)}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          fetch(`/api/v1/prep-runs/${encodeURIComponent(runId)}/artifacts`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
        ]);

        if (!statusResponse.ok) {
          throw new Error(`任务状态加载失败（${statusResponse.status}）`);
        }

        const statusPayload = (await statusResponse.json()) as PrepRunStatusResponse;
        const artifactsPayload = artifactsResponse.ok
          ? ((await artifactsResponse.json()) as ArtifactListResponse)
          : null;

        setStatus(statusPayload);
        setArtifacts(artifactsPayload);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "学习路径加载失败。");
      } finally {
        setIsLoading(false);
      }
    }

    void loadPath();

    return () => controller.abort();
  }, [runId]);

  const rows = useMemo(
    () => (status ? buildPathRows(status, artifacts) : []),
    [artifacts, status]
  );

  const completedRows = rows.filter((row) => row.status === "ready").length;
  const totalFiles = rows.reduce((total, row) => total + row.resourceCount, 0);
  const learningGoal = status?.request?.learning_goal?.trim() || "学习路径";

  const openVideoPath = async () => {
    if (!runId || isOpeningVideo) {
      return;
    }

    setVideoError(null);
    setIsOpeningVideo(true);

    try {
      const existingResponse = await fetch(
        `/api/v1/prep-runs/${encodeURIComponent(runId)}/classroom`,
        { headers: { Accept: "application/json" } }
      );

      if (existingResponse.ok) {
        const payload = (await existingResponse.json()) as { run_id?: string };
        if (payload.run_id) {
          navigate(`/lesson/${encodeURIComponent(payload.run_id)}`, {
            state: { classroomLaunchMode: "existing" },
          });
          return;
        }
      } else if (existingResponse.status !== 404) {
        throw new Error(`课中任务查询失败（${existingResponse.status}）`);
      }

      const createResponse = await fetch(
        `/api/v1/prep-runs/${encodeURIComponent(runId)}/classroom`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        }
      );

      if (!createResponse.ok) {
        throw new Error(`课中任务创建失败（${createResponse.status}）`);
      }

      const payload = (await createResponse.json()) as { run_id?: string };
      if (!payload.run_id) {
        throw new Error("后端未返回课中任务 ID。");
      }

      navigate(`/lesson/${encodeURIComponent(payload.run_id)}`, {
        state: { classroomLaunchMode: "new" },
      });
    } catch (openError) {
      setVideoError(openError instanceof Error ? openError.message : "视频学习入口打开失败。");
    } finally {
      setIsOpeningVideo(false);
    }
  };

  const openStage = (stage: PathStage) => {
    if (!runId) {
      return;
    }

    if (stage === "video") {
      void openVideoPath();
      return;
    }

    navigate(`/study/${encodeURIComponent(runId)}?stage=${stage}`);
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-md">
              <Link to="/">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal text-slate-950">
                {learningGoal}
              </h1>
              <p className="text-xs text-slate-500">
                {runId} · {status ? getStatusLabel(status.status) : "加载中"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {runId && (
              <Button variant="outline" size="sm" asChild className="rounded-md">
                <Link to={`/load/${encodeURIComponent(runId)}`}>生成记录</Link>
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="flex h-[420px] items-center justify-center border border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在加载学习路径
            </div>
          </div>
        ) : error ? (
          <div className="flex h-[420px] items-center justify-center border border-rose-100 bg-white text-rose-600">
            <CircleAlert className="mr-2 h-5 w-5" />
            {error}
          </div>
        ) : status ? (
          <div className="space-y-6">
            <section className="bg-white p-4 sm:p-6">
              <div className="flex flex-col gap-5 rounded-md bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-600">
                    <Route className="h-8 w-8" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-slate-950">{learningGoal}</p>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {status.request?.subject || "General"} · {status.request?.grade_level || "Unspecified"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5 sm:gap-8">
                  <Metric value={String(completedRows)} label="已就绪环节" tone="green" />
                  <Metric value={String(rows.length)} label="路径总数" />
                  <Metric value={formatTime(status.created_at)} label="创建时间" />
                  <Metric value={String(totalFiles)} label="关联产物" tone="blue" />
                  <Metric value={getStatusLabel(status.status)} label="任务状态" tone={status.status === "failed" ? "red" : "orange"} />
                </div>
              </div>
            </section>

            {videoError && (
              <div className="border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {videoError}
              </div>
            )}

            <section className="bg-white p-4 sm:p-6">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="hover:bg-slate-50">
                    <TableHead className="w-16 px-4 text-slate-500">序号</TableHead>
                    <TableHead className="min-w-44 px-4 text-slate-500">路径名称</TableHead>
                    <TableHead className="px-4 text-slate-500">路径分值</TableHead>
                    <TableHead className="px-4 text-slate-500">当前状态</TableHead>
                    <TableHead className="px-4 text-slate-500">耗时</TableHead>
                    <TableHead className="px-4 text-slate-500">产物数</TableHead>
                    <TableHead className="px-4 text-slate-500">难度</TableHead>
                    <TableHead className="px-4 text-slate-500">进入状态</TableHead>
                    <TableHead className="min-w-40 px-4 text-slate-500">知识点</TableHead>
                    <TableHead className="min-w-56 px-4 text-slate-500">关联内容</TableHead>
                    <TableHead className="w-32 px-4 text-slate-500">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.stage}
                      className="group cursor-pointer border-slate-100 hover:bg-blue-50/40"
                      onClick={() => openStage(row.stage)}
                    >
                      <TableCell className="px-4 font-medium text-slate-700">{row.order}</TableCell>
                      <TableCell className="px-4">
                        <div className="flex items-center gap-3">
                          <StageIcon stage={row.stage} />
                          <div>
                            <div className="font-semibold text-slate-950">{row.title}</div>
                            <div className="text-xs text-slate-500">{row.owner}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 font-medium text-slate-900">{row.score}</TableCell>
                      <TableCell className="px-4">
                        <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1", ROW_STATUS_STYLES[row.status])}>
                          {ROW_STATUS_LABELS[row.status]}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 text-slate-700">{row.duration}</TableCell>
                      <TableCell className="px-4 text-slate-700">{row.resourceCount}</TableCell>
                      <TableCell className="px-4 text-slate-700">{row.difficulty}</TableCell>
                      <TableCell className="px-4 text-slate-700">{row.passRate}</TableCell>
                      <TableCell className="px-4">
                        <span className="inline-flex rounded-sm bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          {row.knowledge}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[260px] px-4">
                        <div className="truncate text-sm text-slate-700">{row.summary}</div>
                        {row.primaryFiles.length > 0 && (
                          <div className="mt-1 truncate text-xs text-slate-400">
                            {row.primaryFiles.join(" / ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-md border-blue-200 text-blue-700 group-hover:bg-blue-600 group-hover:text-white"
                          disabled={row.stage === "video" && isOpeningVideo}
                          onClick={(event) => {
                            event.stopPropagation();
                            openStage(row.stage);
                          }}
                        >
                          {row.stage === "video" && isOpeningVideo ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Metric({
  value,
  label,
  tone = "slate",
}: {
  value: string;
  label: string;
  tone?: "slate" | "green" | "blue" | "orange" | "red";
}) {
  const toneClass = {
    slate: "text-slate-950",
    green: "text-emerald-600",
    blue: "text-blue-600",
    orange: "text-orange-600",
    red: "text-rose-600",
  }[tone];

  return (
    <div className="min-w-0">
      <div className={cn("truncate text-base font-bold", toneClass)}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function StageIcon({ stage }: { stage: PathStage }) {
  const Icon =
    stage === "prep" ? FileText : stage === "video" ? PlaySquare : ClipboardList;
  const style =
    stage === "prep"
      ? "bg-sky-50 text-sky-700"
      : stage === "video"
        ? "bg-violet-50 text-violet-700"
        : "bg-amber-50 text-amber-700";

  return (
    <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", style)}>
      {stage === "practice" ? <BookOpenCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
    </span>
  );
}
