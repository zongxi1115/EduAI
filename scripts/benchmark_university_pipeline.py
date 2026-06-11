from __future__ import annotations

import argparse
import json
import statistics
import sys
import traceback
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import create_run_directory
from edu_multi_agent.llm import LLMClient
from edu_multi_agent.models import GenerationRequest
from edu_multi_agent.runtime import run_generation
from gateway.schemas.prep_runs import RunStatus
from gateway.services.classroom import (
    build_classroom_request_from_prep_view,
    run_classroom_workflow,
)


CASES: list[dict[str, str]] = [
    {
        "goal": "理解 Python 闭包的形成条件、变量捕获机制与 nonlocal 的作用",
        "subject": "Python 程序设计",
        "grade_level": "大学一年级",
    },
    {
        "goal": "理解线性代数中特征值、特征向量与矩阵对角化的关系",
        "subject": "线性代数",
        "grade_level": "大学一年级",
    },
    {
        "goal": "理解概率论中的条件期望及其作为随机变量的含义",
        "subject": "概率论与数理统计",
        "grade_level": "大学二年级",
    },
    {
        "goal": "理解数据结构中哈希表冲突处理、负载因子与扩容策略",
        "subject": "数据结构",
        "grade_level": "大学二年级",
    },
]

LEARNER_PROFILE = (
    "大学低年级学习者，已有基础概念但容易把符号或代码执行过程机械记忆，"
    "需要通过可视化、例题推演和诊断练习建立稳定理解。"
)
NOTES = "用于统计课前准备与课中生成两个环节的运行效率，请保持内容结构稳定。"


@dataclass(slots=True)
class StageTiming:
    status: str
    wall_seconds: float
    event_count: int
    node_durations: dict[str, list[float]]
    error: str | None = None


@dataclass(slots=True)
class CaseResult:
    index: int
    goal: str
    subject: str
    grade_level: str
    prep_output_dir: str
    prep: StageTiming
    classroom: StageTiming | None
    total_wall_seconds: float
    prep_artifact_count: int
    classroom_page_count: int | None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Benchmark the university-topic prep + classroom pipeline."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=3,
        help="Number of built-in university cases to run.",
    )
    parser.add_argument(
        "--output-root",
        default="outputs/benchmarks",
        help="Directory used to store benchmark runs and reports.",
    )
    parser.add_argument(
        "--slide-prompt-file",
        default="slide.md",
        help="Classroom slide prompt variant.",
    )
    parser.add_argument(
        "--skip-classroom",
        action="store_true",
        help="Only run the pre-class preparation workflow.",
    )
    return parser


def _utc_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _safe_slug(text: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in text)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")[:48] or "benchmark"


def _record_timeline(timeline: list[tuple[float, dict[str, Any]]]):
    def on_event(event: dict[str, Any]) -> None:
        timeline.append((perf_counter(), dict(event)))

    return on_event


def _node_durations(timeline: list[tuple[float, dict[str, Any]]]) -> dict[str, list[float]]:
    pending_starts: dict[str, list[float]] = {}
    durations: dict[str, list[float]] = {}
    for moment, event in timeline:
        node = str(event.get("node") or "")
        if not node:
            continue
        event_name = event.get("event")
        if event_name == "node_started":
            pending_starts.setdefault(node, []).append(moment)
        elif event_name == "node_completed":
            starts = pending_starts.get(node)
            if not starts:
                continue
            started_at = starts.pop(0)
            durations.setdefault(node, []).append(moment - started_at)
    return durations


def _stage_timing(
    *,
    status: str,
    start: float,
    end: float,
    timeline: list[tuple[float, dict[str, Any]]],
    error: str | None = None,
) -> StageTiming:
    return StageTiming(
        status=status,
        wall_seconds=end - start,
        event_count=len(timeline),
        node_durations=_node_durations(timeline),
        error=error,
    )


def _run_case(
    *,
    settings: Settings,
    llm_client: LLMClient,
    benchmark_runs_root: Path,
    index: int,
    case: dict[str, str],
    slide_prompt_file: str,
    skip_classroom: bool,
) -> CaseResult:
    request = GenerationRequest(
        learning_goal=case["goal"],
        subject=case["subject"],
        grade_level=case["grade_level"],
        learner_profile=LEARNER_PROFILE,
        notes=NOTES,
    )

    output_dir = create_run_directory(
        benchmark_runs_root,
        f"{index:02d}-{_safe_slug(request.learning_goal)}",
    )
    total_start = perf_counter()

    prep_timeline: list[tuple[float, dict[str, Any]]] = []
    prep_start = perf_counter()
    prep_error = None
    prep_artifact_count = 0
    prep_result = None
    try:
        prep_result = run_generation(
            request,
            settings,
            output_dir,
            event_callback=_record_timeline(prep_timeline),
        )
        prep_status = "succeeded"
        prep_artifact_count = len(prep_result.final_state.get("artifact_results", []))
    except Exception as exc:
        prep_status = "failed"
        prep_error = "".join(traceback.format_exception(exc)).strip()
    prep_end = perf_counter()
    prep = _stage_timing(
        status=prep_status,
        start=prep_start,
        end=prep_end,
        timeline=prep_timeline,
        error=prep_error,
    )

    classroom: StageTiming | None = None
    classroom_page_count: int | None = None
    if prep_result is not None and not skip_classroom:
        classroom_timeline: list[tuple[float, dict[str, Any]]] = []
        classroom_start = perf_counter()
        classroom_error = None
        try:
            view = {
                "run_id": output_dir.name,
                "status": RunStatus.succeeded,
                "request": request.model_dump(),
                "output_dir": str(output_dir),
                "plan": prep_result.final_state.get("plan"),
                "artifacts": prep_result.final_state.get("artifact_results", []),
                "plan_path": str(prep_result.plan_path) if prep_result.plan_path else None,
                "report_path": str(prep_result.report_path) if prep_result.report_path else None,
            }
            classroom_request = build_classroom_request_from_prep_view(
                view,
                slide_prompt_file=slide_prompt_file,
            )
            classroom_result = run_classroom_workflow(
                classroom_request,
                llm_client,
                event_callback=_record_timeline(classroom_timeline),
            )
            classroom_status = "succeeded"
            classroom_page_count = classroom_result.page_count
        except Exception as exc:
            classroom_status = "failed"
            classroom_error = "".join(traceback.format_exception(exc)).strip()
        classroom_end = perf_counter()
        classroom = _stage_timing(
            status=classroom_status,
            start=classroom_start,
            end=classroom_end,
            timeline=classroom_timeline,
            error=classroom_error,
        )

    total_end = perf_counter()
    return CaseResult(
        index=index,
        goal=request.learning_goal,
        subject=request.subject,
        grade_level=request.grade_level,
        prep_output_dir=str(output_dir),
        prep=prep,
        classroom=classroom,
        total_wall_seconds=total_end - total_start,
        prep_artifact_count=prep_artifact_count,
        classroom_page_count=classroom_page_count,
    )


def _flatten_stage_node_stats(cases: list[CaseResult], stage: str) -> dict[str, dict[str, float]]:
    values: dict[str, list[float]] = {}
    for case in cases:
        timing = case.prep if stage == "prep" else case.classroom
        if timing is None:
            continue
        for node, durations in timing.node_durations.items():
            values.setdefault(node, []).extend(durations)

    stats: dict[str, dict[str, float]] = {}
    for node, durations in values.items():
        sorted_values = sorted(durations)
        stats[node] = {
            "count": float(len(sorted_values)),
            "avg": round(statistics.mean(sorted_values), 3),
            "min": round(min(sorted_values), 3),
            "max": round(max(sorted_values), 3),
        }
    return stats


def _stage_summary(cases: list[CaseResult], stage: str) -> dict[str, Any]:
    timings = [
        case.prep if stage == "prep" else case.classroom
        for case in cases
    ]
    valid_timings = [timing for timing in timings if timing is not None]
    wall_values = [timing.wall_seconds for timing in valid_timings]
    succeeded = sum(1 for timing in valid_timings if timing.status == "succeeded")
    failed = sum(1 for timing in valid_timings if timing.status == "failed")
    return {
        "runs": len(valid_timings),
        "succeeded": succeeded,
        "failed": failed,
        "avg_wall_seconds": round(statistics.mean(wall_values), 3) if wall_values else 0.0,
        "median_wall_seconds": round(statistics.median(wall_values), 3) if wall_values else 0.0,
        "min_wall_seconds": round(min(wall_values), 3) if wall_values else 0.0,
        "max_wall_seconds": round(max(wall_values), 3) if wall_values else 0.0,
        "avg_event_count": round(
            statistics.mean(timing.event_count for timing in valid_timings),
            3,
        )
        if valid_timings
        else 0.0,
        "node_stats": _flatten_stage_node_stats(cases, stage),
    }


def _render_markdown(summary: dict[str, Any], cases: list[CaseResult]) -> str:
    lines = [
        "# 大学知识点课前/课中 Pipeline Benchmark",
        "",
        f"- 任务数: {summary['case_count']}",
        f"- 总耗时: {summary['total_wall_seconds']:.3f}s",
        f"- 平均总耗时: {summary['avg_total_wall_seconds']:.3f}s",
        f"- 课前平均耗时: {summary['prep']['avg_wall_seconds']:.3f}s",
        f"- 课中平均耗时: {summary['classroom']['avg_wall_seconds']:.3f}s",
        "",
        "## 单任务结果",
        "",
        "| # | 知识点 | 课前状态 | 课前(s) | 课中状态 | 课中(s) | 总耗时(s) | 产物数 | 页数 |",
        "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |",
    ]
    for case in cases:
        classroom_status = case.classroom.status if case.classroom else "-"
        classroom_seconds = (
            f"{case.classroom.wall_seconds:.3f}" if case.classroom else "-"
        )
        page_count = case.classroom_page_count if case.classroom_page_count is not None else "-"
        lines.append(
            f"| {case.index} | {case.goal} | {case.prep.status} | {case.prep.wall_seconds:.3f} | "
            f"{classroom_status} | {classroom_seconds} | {case.total_wall_seconds:.3f} | "
            f"{case.prep_artifact_count} | {page_count} |"
        )

    for stage_key, title in (("prep", "课前节点耗时"), ("classroom", "课中节点耗时")):
        lines.extend(["", f"## {title}", "", "| 节点 | 次数 | 平均(s) | 最小(s) | 最大(s) |", "| --- | ---: | ---: | ---: | ---: |"])
        node_stats = summary[stage_key]["node_stats"]
        for node, stats in sorted(
            node_stats.items(),
            key=lambda item: item[1]["avg"],
            reverse=True,
        ):
            lines.append(
                f"| {node} | {int(stats['count'])} | {stats['avg']:.3f} | "
                f"{stats['min']:.3f} | {stats['max']:.3f} |"
            )

    failed = [
        (case, "prep", case.prep.error)
        for case in cases
        if case.prep.error
    ]
    failed.extend(
        (case, "classroom", case.classroom.error)
        for case in cases
        if case.classroom is not None and case.classroom.error
    )
    if failed:
        lines.extend(["", "## 失败详情", ""])
        for case, stage, error in failed:
            lines.extend(
                [
                    f"### Case {case.index} / {stage}: {case.goal}",
                    "",
                    "```text",
                    error or "",
                    "```",
                    "",
                ]
            )

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    limit = max(1, min(args.limit, len(CASES)))

    settings = Settings.from_env()
    llm_client = LLMClient(settings)

    benchmark_root = (
        ROOT
        / args.output_root
        / f"{_utc_stamp()}_university_pipeline"
    ).resolve()
    benchmark_runs_root = benchmark_root / "runs"
    benchmark_runs_root.mkdir(parents=True, exist_ok=True)

    cases: list[CaseResult] = []
    for index, case in enumerate(CASES[:limit], start=1):
        print(f"[{index}/{limit}] Running: {case['goal']}", flush=True)
        result = _run_case(
            settings=settings,
            llm_client=llm_client,
            benchmark_runs_root=benchmark_runs_root,
            index=index,
            case=case,
            slide_prompt_file=args.slide_prompt_file,
            skip_classroom=args.skip_classroom,
        )
        cases.append(result)
        classroom_msg = (
            f", classroom {result.classroom.wall_seconds:.3f}s ({result.classroom.status})"
            if result.classroom
            else ""
        )
        print(
            f"  -> prep {result.prep.wall_seconds:.3f}s ({result.prep.status})"
            f"{classroom_msg}, total {result.total_wall_seconds:.3f}s",
            flush=True,
        )

    total_values = [case.total_wall_seconds for case in cases]
    summary = {
        "benchmark_root": str(benchmark_root),
        "case_count": len(cases),
        "total_wall_seconds": round(sum(total_values), 3),
        "avg_total_wall_seconds": round(statistics.mean(total_values), 3)
        if total_values
        else 0.0,
        "median_total_wall_seconds": round(statistics.median(total_values), 3)
        if total_values
        else 0.0,
        "prep": _stage_summary(cases, "prep"),
        "classroom": _stage_summary(cases, "classroom"),
    }

    payload = {
        "summary": summary,
        "cases": [asdict(case) for case in cases],
    }
    json_path = benchmark_root / "benchmark_summary.json"
    md_path = benchmark_root / "benchmark_summary.md"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(_render_markdown(summary, cases), encoding="utf-8")

    print(f"Benchmark root: {benchmark_root}")
    print(f"JSON summary: {json_path}")
    print(f"Markdown summary: {md_path}")

    any_failed = any(case.prep.status == "failed" for case in cases) or any(
        case.classroom is not None and case.classroom.status == "failed"
        for case in cases
    )
    return 1 if any_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
