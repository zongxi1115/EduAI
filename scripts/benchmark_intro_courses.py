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
from edu_multi_agent.models import GenerationRequest
from edu_multi_agent.runtime import run_generation


COURSES: list[dict[str, str]] = [
    {"goal": "理解计算机硬件与软件的基本分工", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "认识 CPU、内存、硬盘在计算机中的作用", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解操作系统负责什么以及常见桌面操作", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "学会文件、文件夹与路径的基本概念", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "掌握键盘、鼠标与常见快捷键的基础使用", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解二进制、十进制与计算机表示信息的方式", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解程序、指令与算法的基本含义", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "认识 Python 程序由输入、处理、输出构成", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "学会变量、数据类型与简单表达式", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解条件判断如何让程序作出选择", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解循环如何重复执行任务并解决简单问题", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "认识函数的作用以及参数与返回值的概念", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解网络、浏览器与服务器之间的基本关系", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "认识常见网络安全风险与密码安全习惯", "subject": "信息技术", "grade_level": "计算机入门"},
    {"goal": "理解调试、报错信息与逐步排查问题的方法", "subject": "信息技术", "grade_level": "计算机入门"},
]

LEARNER_PROFILE = (
    "零基础学习者，需要从生活化例子切入，强调术语解释、可视化理解、"
    "循序渐进练习与上手信心。"
)
NOTES = "这是系统内置的计算机入门 benchmark 批任务，请保持教学语言清晰、稳定、易上手。"


@dataclass(slots=True)
class CaseResult:
    index: int
    goal: str
    subject: str
    grade_level: str
    output_dir: str
    status: str
    wall_seconds: float
    workflow_seconds: float | None
    event_count: int
    artifact_count: int
    node_durations: dict[str, list[float]]
    error: str | None = None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the built-in computer-intro benchmark batch and collect timing stats."
    )
    parser.add_argument("--limit", type=int, default=len(COURSES), help="Number of built-in courses to run.")
    parser.add_argument(
        "--output-root",
        default="outputs/benchmarks",
        help="Directory used to store benchmark runs and reports.",
    )
    return parser


def _utc_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _safe_slug(text: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in text)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")[:48] or "benchmark"


def _flatten(values: dict[str, list[float]]) -> dict[str, float]:
    return {
        key: round(sum(items) / len(items), 3)
        for key, items in values.items()
        if items
    }


def _percentile(sorted_values: list[float], ratio: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    idx = round((len(sorted_values) - 1) * ratio)
    return sorted_values[idx]


def _render_markdown(summary: dict[str, Any], cases: list[CaseResult]) -> str:
    lines = [
        "# 计算机入门内置课程 Benchmark",
        "",
        f"- 课程数: {summary['total_courses']}",
        f"- 成功数: {summary['succeeded']}",
        f"- 失败数: {summary['failed']}",
        f"- 成功率: {summary['success_rate']:.2%}",
        f"- 总耗时: {summary['total_wall_seconds']:.3f}s",
        f"- 平均单课耗时: {summary['avg_wall_seconds']:.3f}s",
        f"- 中位数单课耗时: {summary['median_wall_seconds']:.3f}s",
        f"- P95 单课耗时: {summary['p95_wall_seconds']:.3f}s",
        "",
        "## 单课程结果",
        "",
        "| # | 状态 | 课程目标 | 总耗时(s) | 工作流耗时(s) | 事件数 | 产物数 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: |",
    ]

    for case in cases:
        workflow_seconds = f"{case.workflow_seconds:.3f}" if case.workflow_seconds is not None else "-"
        lines.append(
            f"| {case.index} | {case.status} | {case.goal} | {case.wall_seconds:.3f} | "
            f"{workflow_seconds} | {case.event_count} | {case.artifact_count} |"
        )

    lines.extend(
        [
            "",
            "## 节点平均耗时",
            "",
            "| 节点 | 平均耗时(s) |",
            "| --- | ---: |",
        ]
    )
    for node, avg_seconds in sorted(summary["avg_node_seconds"].items(), key=lambda item: item[1], reverse=True):
        lines.append(f"| {node} | {avg_seconds:.3f} |")

    failed_cases = [case for case in cases if case.error]
    if failed_cases:
        lines.extend(["", "## 失败详情", ""])
        for case in failed_cases:
            lines.append(f"### Case {case.index}: {case.goal}")
            lines.append("")
            lines.append("```text")
            lines.append(case.error or "")
            lines.append("```")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _run_case(
    settings: Settings,
    benchmark_runs_root: Path,
    index: int,
    course: dict[str, str],
) -> CaseResult:
    request = GenerationRequest(
        learning_goal=course["goal"],
        subject=course["subject"],
        grade_level=course["grade_level"],
        learner_profile=LEARNER_PROFILE,
        notes=NOTES,
    )

    output_dir = create_run_directory(benchmark_runs_root, request.learning_goal)
    timeline: list[tuple[float, dict[str, Any]]] = []

    def on_event(event: dict[str, Any]) -> None:
        timeline.append((perf_counter(), dict(event)))

    start = perf_counter()
    try:
        result = run_generation(request, settings, output_dir, event_callback=on_event)
        status = "succeeded"
        error = None
        artifact_count = len(result.final_state.get("artifact_results", []))
    except Exception as exc:
        status = "failed"
        error = "".join(traceback.format_exception(exc)).strip()
        artifact_count = 0
    end = perf_counter()

    event_count = len(timeline)
    workflow_started = next((moment for moment, event in timeline if event.get("event") == "workflow_started"), None)
    workflow_completed = next(
        (moment for moment, event in reversed(timeline) if event.get("event") == "workflow_completed"),
        None,
    )
    workflow_seconds = None
    if workflow_started is not None and workflow_completed is not None:
        workflow_seconds = workflow_completed - workflow_started

    pending_starts: dict[str, list[float]] = {}
    node_durations: dict[str, list[float]] = {}
    for moment, event in timeline:
        node = str(event.get("node") or "")
        if not node:
            continue
        if event.get("event") == "node_started":
            pending_starts.setdefault(node, []).append(moment)
            continue
        if event.get("event") == "node_completed":
            starts = pending_starts.get(node)
            if not starts:
                continue
            started_at = starts.pop(0)
            node_durations.setdefault(node, []).append(moment - started_at)

    return CaseResult(
        index=index,
        goal=request.learning_goal,
        subject=request.subject,
        grade_level=request.grade_level,
        output_dir=str(output_dir),
        status=status,
        wall_seconds=end - start,
        workflow_seconds=workflow_seconds,
        event_count=event_count,
        artifact_count=artifact_count,
        node_durations=node_durations,
        error=error,
    )


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    limit = max(1, min(args.limit, len(COURSES)))

    settings = Settings.from_env()

    benchmark_root = (ROOT / args.output_root / f"{_utc_stamp()}_computer_intro_batch").resolve()
    benchmark_runs_root = benchmark_root / "runs"
    benchmark_root.mkdir(parents=True, exist_ok=True)
    benchmark_runs_root.mkdir(parents=True, exist_ok=True)

    cases: list[CaseResult] = []
    for index, course in enumerate(COURSES[:limit], start=1):
        print(f"[{index}/{limit}] Running: {course['goal']}", flush=True)
        case = _run_case(settings, benchmark_runs_root, index, course)
        cases.append(case)
        print(
            f"  -> {case.status} in {case.wall_seconds:.3f}s"
            + (f" (workflow {case.workflow_seconds:.3f}s)" if case.workflow_seconds is not None else ""),
            flush=True,
        )

    wall_values = sorted(case.wall_seconds for case in cases)
    succeeded = sum(1 for case in cases if case.status == "succeeded")
    failed = len(cases) - succeeded
    all_node_durations: dict[str, list[float]] = {}
    for case in cases:
        for node, durations in case.node_durations.items():
            all_node_durations.setdefault(node, []).extend(durations)

    summary = {
        "dataset_name": "computer_intro_builtin_courses",
        "benchmark_root": str(benchmark_root),
        "total_courses": len(cases),
        "succeeded": succeeded,
        "failed": failed,
        "success_rate": succeeded / len(cases) if cases else 0.0,
        "total_wall_seconds": round(sum(wall_values), 3),
        "avg_wall_seconds": round(statistics.mean(wall_values), 3) if wall_values else 0.0,
        "median_wall_seconds": round(statistics.median(wall_values), 3) if wall_values else 0.0,
        "min_wall_seconds": round(min(wall_values), 3) if wall_values else 0.0,
        "max_wall_seconds": round(max(wall_values), 3) if wall_values else 0.0,
        "p95_wall_seconds": round(_percentile(wall_values, 0.95), 3) if wall_values else 0.0,
        "avg_node_seconds": _flatten(all_node_durations),
    }

    json_payload = {
        "summary": summary,
        "courses": COURSES[:limit],
        "cases": [asdict(case) for case in cases],
    }

    json_path = benchmark_root / "benchmark_summary.json"
    md_path = benchmark_root / "benchmark_summary.md"
    json_path.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(_render_markdown(summary, cases), encoding="utf-8")

    print(f"Benchmark root: {benchmark_root}")
    print(f"JSON summary: {json_path}")
    print(f"Markdown summary: {md_path}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
