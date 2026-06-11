from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze historical prep/classroom event logs under outputs/."
    )
    parser.add_argument(
        "--outputs-root",
        default="outputs",
        help="Root directory that contains prep runs and classroom_runs.",
    )
    parser.add_argument(
        "--report-root",
        default="outputs/benchmarks/historical_timing_analysis",
        help="Directory to write JSON and Markdown timing reports.",
    )
    return parser


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except Exception:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(value)
    except Exception:
        try:
            return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
        except Exception:
            return None


def _seconds_between(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    return max(0.0, (end - start).total_seconds())


def _event_time_range(
    events: list[dict[str, Any]],
    start_names: set[str],
    end_names: set[str],
) -> float | None:
    start = None
    end = None
    for event in events:
        if event.get("event") in start_names:
            start = _parse_ts(event.get("timestamp"))
            if start is not None:
                break
    for event in reversed(events):
        if event.get("event") in end_names:
            end = _parse_ts(event.get("timestamp"))
            if end is not None:
                break
    return _seconds_between(start, end)


def _node_durations(events: list[dict[str, Any]]) -> dict[str, list[float]]:
    pending: dict[str, list[datetime]] = defaultdict(list)
    durations: dict[str, list[float]] = defaultdict(list)
    for event in events:
        node = str(event.get("node") or "")
        if not node:
            continue
        ts = _parse_ts(event.get("timestamp"))
        if ts is None:
            continue
        if event.get("event") == "node_started":
            pending[node].append(ts)
        elif event.get("event") == "node_completed" and pending[node]:
            started_at = pending[node].pop(0)
            durations[node].append(max(0.0, (ts - started_at).total_seconds()))
    return dict(durations)


def _request_from_prep(events: list[dict[str, Any]]) -> dict[str, Any]:
    for event in events:
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        input_payload = data.get("input") if isinstance(data.get("input"), dict) else {}
        request = input_payload.get("request") if isinstance(input_payload, dict) else None
        if isinstance(request, dict):
            return request
    return {}


def _prep_artifacts(run_dir: Path) -> list[dict[str, Any]]:
    manifest = run_dir / "00_supervisor" / "artifact_manifest.json"
    if not manifest.is_file():
        return []
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception:
        return []
    artifacts = data.get("artifacts")
    return [item for item in artifacts if isinstance(item, dict)] if isinstance(artifacts, list) else []


def _classroom_request(run_dir: Path) -> dict[str, Any]:
    request_path = run_dir / "request.json"
    if not request_path.is_file():
        return {}
    try:
        data = json.loads(request_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _numeric_summary(values: list[float | None]) -> dict[str, float | int]:
    cleaned = [value for value in values if isinstance(value, (int, float))]
    if not cleaned:
        return {"count": 0, "avg": 0.0, "median": 0.0, "min": 0.0, "max": 0.0}
    return {
        "count": len(cleaned),
        "avg": round(statistics.mean(cleaned), 3),
        "median": round(statistics.median(cleaned), 3),
        "min": round(min(cleaned), 3),
        "max": round(max(cleaned), 3),
    }


def _flatten_node_stats(
    items: list[dict[str, Any]],
    key: str,
) -> dict[str, dict[str, float | int]]:
    values: dict[str, list[float]] = defaultdict(list)
    for item in items:
        durations = item.get(key)
        if not isinstance(durations, dict):
            continue
        for node, node_values in durations.items():
            if isinstance(node_values, list):
                values[str(node)].extend(
                    value for value in node_values if isinstance(value, (int, float))
                )

    stats: dict[str, dict[str, float | int]] = {}
    for node, durations in values.items():
        if not durations:
            continue
        stats[node] = {
            "count": len(durations),
            "avg": round(statistics.mean(durations), 3),
            "median": round(statistics.median(durations), 3),
            "min": round(min(durations), 3),
            "max": round(max(durations), 3),
            "sum": round(sum(durations), 3),
        }
    return dict(sorted(stats.items(), key=lambda item: item[1]["avg"], reverse=True))


def _is_university_like(item: dict[str, Any]) -> bool:
    text = " ".join(
        str(item.get(key) or "")
        for key in ("goal", "subject", "grade_level", "run_id", "prep_run_id")
    ).lower()
    return any(
        token in text
        for token in ("大学", "成人", "python", "nonlocal", "线性", "概率", "f-ma")
    )


def _collect_prep_runs(outputs_root: Path) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for events_path in outputs_root.rglob("langgraph_events.jsonl"):
        if "university_pipeline" in str(events_path):
            continue
        events = _load_jsonl(events_path)
        if not events:
            continue
        run_dir = events_path.parents[1]
        request = _request_from_prep(events)
        artifacts = _prep_artifacts(run_dir)
        runs.append(
            {
                "run_id": run_dir.name,
                "run_dir": str(run_dir),
                "goal": request.get("learning_goal") or run_dir.name,
                "subject": request.get("subject"),
                "grade_level": request.get("grade_level"),
                "status": (
                    "succeeded"
                    if any(event.get("event") == "workflow_completed" for event in events)
                    else "failed"
                ),
                "total_seconds": _event_time_range(
                    events,
                    {"workflow_started"},
                    {"workflow_completed", "workflow_failed"},
                ),
                "event_count": len(events),
                "node_durations": _node_durations(events),
                "artifact_count": len(artifacts),
                "failed_artifacts": [
                    artifact.get("agent_name")
                    for artifact in artifacts
                    if artifact.get("status") == "failed"
                ],
                "manim_repair_steps": sum(
                    1
                    for event in events
                    if event.get("event") == "artifact_repair_tool_requested"
                ),
                "manim_validation_failures": sum(
                    1
                    for event in events
                    if event.get("event") == "artifact_validation_failed"
                ),
            }
        )
    return runs


def _collect_classroom_runs(outputs_root: Path) -> list[dict[str, Any]]:
    classroom_root = outputs_root / "classroom_runs"
    runs: list[dict[str, Any]] = []
    for events_path in classroom_root.rglob("events.jsonl"):
        events = _load_jsonl(events_path)
        if not events:
            continue
        run_dir = events_path.parent
        request = _classroom_request(run_dir)
        outline_start = next(
            (
                _parse_ts(event.get("timestamp"))
                for event in events
                if event.get("event") == "node_started" and event.get("node") == "outline"
            ),
            None,
        )
        assemble_end = next(
            (
                _parse_ts(event.get("timestamp"))
                for event in reversed(events)
                if event.get("event") == "node_completed" and event.get("node") == "assemble"
            ),
            None,
        )
        page_count = None
        for event in reversed(events):
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            if isinstance(data.get("page_count"), int):
                page_count = data.get("page_count")
                break
        runs.append(
            {
                "run_id": run_dir.name,
                "run_dir": str(run_dir),
                "source_prep_run_id": request.get("source_prep_run_id"),
                "topic": request.get("topic") or run_dir.name,
                "status": (
                    "succeeded"
                    if any(event.get("event") == "workflow_completed" for event in events)
                    else "failed"
                ),
                "full_total_seconds": _event_time_range(
                    events,
                    {"workflow_started"},
                    {"workflow_completed", "workflow_failed"},
                ),
                "graph_seconds": _seconds_between(outline_start, assemble_end),
                "voice_seconds": _event_time_range(
                    events,
                    {"voice_started"},
                    {"voice_completed", "voice_failed", "voice_skipped"},
                ),
                "event_count": len(events),
                "page_count": page_count,
                "node_durations": _node_durations(events),
            }
        )
    return runs


def _pair_runs(
    prep_runs: list[dict[str, Any]],
    classroom_runs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    prep_by_id = {run["run_id"]: run for run in prep_runs}
    paired: list[dict[str, Any]] = []
    for classroom_run in classroom_runs:
        source_prep_id = classroom_run.get("source_prep_run_id")
        if not source_prep_id or source_prep_id not in prep_by_id:
            continue
        prep_run = prep_by_id[str(source_prep_id)]
        prep_seconds = prep_run.get("total_seconds") or 0.0
        classroom_graph_seconds = classroom_run.get("graph_seconds") or 0.0
        classroom_full_seconds = classroom_run.get("full_total_seconds") or 0.0
        paired.append(
            {
                "prep_run_id": source_prep_id,
                "classroom_run_id": classroom_run["run_id"],
                "goal": prep_run["goal"],
                "subject": prep_run.get("subject"),
                "grade_level": prep_run.get("grade_level"),
                "prep_seconds": prep_run.get("total_seconds"),
                "classroom_graph_seconds": classroom_run.get("graph_seconds"),
                "classroom_full_seconds": classroom_run.get("full_total_seconds"),
                "voice_seconds": classroom_run.get("voice_seconds"),
                "total_graph_pipeline_seconds": prep_seconds + classroom_graph_seconds,
                "total_full_pipeline_seconds": prep_seconds + classroom_full_seconds,
                "page_count": classroom_run.get("page_count"),
                "failed_artifacts": prep_run.get("failed_artifacts") or [],
                "manim_repair_steps": prep_run.get("manim_repair_steps"),
            }
        )
    return paired


def _render_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = [
        "# 历史课前/课中运行效率统计",
        "",
        "> 新实测被模型接口 401 余额不足阻断；以下为本地历史日志统计。",
        "",
        "## 总览",
    ]
    paired_summary = report["paired_summary"]
    lines.extend(
        [
            f"- 可配对课前→课中样本: {paired_summary['count']} 个",
            f"- 配对样本课前平均: {paired_summary['prep']['avg']}s，中位数: {paired_summary['prep']['median']}s",
            f"- 配对样本课中 graph 平均: {paired_summary['classroom_graph']['avg']}s，中位数: {paired_summary['classroom_graph']['median']}s",
            f"- 配对样本完整课中平均: {paired_summary['classroom_full']['avg']}s，中位数: {paired_summary['classroom_full']['median']}s",
            f"- 端到端 graph 平均: {paired_summary['total_graph_pipeline']['avg']}s",
            f"- 端到端完整平均: {paired_summary['total_full_pipeline']['avg']}s",
            "",
            "## 大学/编程相关样本",
        ]
    )
    university_summary = report["university_like_summary"]
    lines.extend(
        [
            f"- 课前样本: {university_summary['prep_count']} 个，平均 {university_summary['prep']['avg']}s，中位数 {university_summary['prep']['median']}s",
            f"- 可配对样本: {university_summary['paired_count']} 个，课中 graph 平均 {university_summary['classroom_graph']['avg']}s，端到端 graph 平均 {university_summary['total_graph_pipeline']['avg']}s",
            "",
            "| 课前 run | 课中 run | 主题 | 课前(s) | 课中 graph(s) | 完整课中(s) | 总计 graph(s) | 页数 | 失败产物 |",
            "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
    )
    for item in report["paired_runs"]:
        failed_artifacts = ",".join(item["failed_artifacts"]) if item["failed_artifacts"] else "-"
        goal = str(item["goal"])[:42]
        lines.append(
            f"| {item['prep_run_id']} | {item['classroom_run_id']} | {goal} | "
            f"{item['prep_seconds']} | {item['classroom_graph_seconds']} | "
            f"{item['classroom_full_seconds']} | "
            f"{round(item['total_graph_pipeline_seconds'], 3)} | "
            f"{item['page_count']} | {failed_artifacts} |"
        )

    lines.extend(
        [
            "",
            "## 课前节点平均耗时",
            "| 节点 | 次数 | 平均(s) | 最大(s) |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for node, stats in list(report["prep_node_stats_all"].items())[:12]:
        lines.append(f"| {node} | {stats['count']} | {stats['avg']} | {stats['max']} |")

    lines.extend(
        [
            "",
            "## 课中节点平均耗时",
            "| 节点 | 次数 | 平均(s) | 最大(s) |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for node, stats in list(report["classroom_node_stats_all"].items())[:12]:
        lines.append(f"| {node} | {stats['count']} | {stats['avg']} | {stats['max']} |")

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    outputs_root = (ROOT / args.outputs_root).resolve()
    report_root = (ROOT / args.report_root).resolve()
    report_root.mkdir(parents=True, exist_ok=True)

    prep_runs = _collect_prep_runs(outputs_root)
    classroom_runs = _collect_classroom_runs(outputs_root)
    paired_runs = _pair_runs(prep_runs, classroom_runs)
    university_prep_runs = [run for run in prep_runs if _is_university_like(run)]
    university_pairs = [run for run in paired_runs if _is_university_like(run)]

    report: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "notes": [
            "Fresh benchmark could not run because the configured model endpoint returned 401 insufficient balance.",
            "Historical timings are computed from local event logs under outputs/. Timestamps have second-level precision.",
            "classroom_graph_seconds measures outline/page_plan/page_script/split/slide/assemble; full classroom also includes task wrapper and voice events when present.",
        ],
        "fresh_benchmark_script": str(ROOT / "scripts" / "benchmark_university_pipeline.py"),
        "prep_summary_all": _numeric_summary(
            [run["total_seconds"] for run in prep_runs]
        ),
        "classroom_graph_summary_all": _numeric_summary(
            [run["graph_seconds"] for run in classroom_runs]
        ),
        "classroom_full_summary_all": _numeric_summary(
            [run["full_total_seconds"] for run in classroom_runs]
        ),
        "paired_summary": {
            "count": len(paired_runs),
            "prep": _numeric_summary([run["prep_seconds"] for run in paired_runs]),
            "classroom_graph": _numeric_summary(
                [run["classroom_graph_seconds"] for run in paired_runs]
            ),
            "classroom_full": _numeric_summary(
                [run["classroom_full_seconds"] for run in paired_runs]
            ),
            "total_graph_pipeline": _numeric_summary(
                [run["total_graph_pipeline_seconds"] for run in paired_runs]
            ),
            "total_full_pipeline": _numeric_summary(
                [run["total_full_pipeline_seconds"] for run in paired_runs]
            ),
        },
        "university_like_summary": {
            "prep_count": len(university_prep_runs),
            "paired_count": len(university_pairs),
            "prep": _numeric_summary(
                [run["total_seconds"] for run in university_prep_runs]
            ),
            "classroom_graph": _numeric_summary(
                [run["classroom_graph_seconds"] for run in university_pairs]
            ),
            "total_graph_pipeline": _numeric_summary(
                [run["total_graph_pipeline_seconds"] for run in university_pairs]
            ),
        },
        "prep_node_stats_all": _flatten_node_stats(prep_runs, "node_durations"),
        "classroom_node_stats_all": _flatten_node_stats(
            classroom_runs,
            "node_durations",
        ),
        "paired_runs": paired_runs,
        "university_like_paired_runs": university_pairs,
        "fresh_run_failure": {
            "script": str(ROOT / "scripts" / "benchmark_university_pipeline.py"),
            "attempted_command": (
                "conda run -n base python "
                "scripts\\benchmark_university_pipeline.py --limit 1"
            ),
            "error": "openai.AuthenticationError 401 CreditsError: Insufficient balance",
        },
    }

    json_path = report_root / "historical_timing_summary.json"
    md_path = report_root / "historical_timing_summary.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(_render_markdown(report), encoding="utf-8")

    print(f"JSON summary: {json_path}")
    print(f"Markdown summary: {md_path}")
    print(
        json.dumps(
            {
                "prep_runs": len(prep_runs),
                "classroom_runs": len(classroom_runs),
                "paired_runs": len(paired_runs),
                "paired_summary": report["paired_summary"],
                "university_like_summary": report["university_like_summary"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
