from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .models import ArtifactResult, GenerationRequest, PreparationPlan


SUMMARY_PATTERN = re.compile(r"<<<SUMMARY>>>\s*(.*?)\s*<<<END SUMMARY>>>", re.S)
FILE_PATTERN = re.compile(r"<<<FILE:(.+?)>>>\s*(.*?)\s*<<<END FILE>>>", re.S)


@dataclass(slots=True)
class ParsedBundle:
    summary: str
    files: dict[str, str]


def slugify_fragment(text: str, max_length: int = 32) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        return "teaching-prep"
    return slug[:max_length].strip("-") or "teaching-prep"


def create_run_directory(output_root: Path, learning_goal: str) -> Path:
    output_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_root / f"{stamp}_{slugify_fragment(learning_goal)}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def write_text_file(base_dir: Path, relative_path: str, content: str) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")
    return target


def write_json_file(base_dir: Path, relative_path: str, payload: dict) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return target


def append_jsonl_file(
    base_dir: Path,
    relative_path: str,
    payload: dict[str, Any],
) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return target


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def render_langgraph_trace_markdown(events: list[dict[str, Any]]) -> str:
    lines = [
        "# LangGraph Runtime Trace",
        "",
        f"- Event count: {len(events)}",
        "",
        "## Event Timeline",
    ]

    for event in events:
        index = event.get("index", "-")
        mode = event.get("mode") or event.get("event")
        node = event.get("node", "-")
        summary = event.get("summary", "")
        lines.append(f"{index}. [{mode}] {node} {summary}".strip())

    snapshot_events = [event for event in events if event.get("snapshot_path")]
    if snapshot_events:
        lines.append("")
        lines.append("## State Snapshots")
        for event in snapshot_events:
            lines.append(
                f"- {event.get('node', '-')}: {event.get('snapshot_path', '')}"
            )

    return "\n".join(lines).strip()


def parse_tagged_bundle(
    raw_text: str,
    required_files: tuple[str, ...] | list[str] | None = None,
) -> ParsedBundle:
    summary_match = SUMMARY_PATTERN.search(raw_text)
    if not summary_match:
        raise ValueError("Missing <<<SUMMARY>>> block in model output.")

    files: dict[str, str] = {}
    for filename, content in FILE_PATTERN.findall(raw_text):
        clean_name = filename.strip()
        if not clean_name:
            continue
        files[clean_name] = content.strip() + "\n"

    if not files:
        raise ValueError("Missing <<<FILE:...>>> blocks in model output.")

    if required_files:
        missing_files = [name for name in required_files if name not in files]
        if missing_files:
            raise ValueError(
                "Missing required files in model output: " + ", ".join(missing_files)
            )

    return ParsedBundle(summary=summary_match.group(1).strip(), files=files)


def render_plan_markdown(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> str:
    route_lines: list[str] = []
    for route in plan.agent_routes:
        route_lines.append(f"## Agent: {route.agent_name}")
        route_lines.append(f"- 是否启用: {route.selected}")
        route_lines.append(f"- 任务目标: {route.objective}")
        route_lines.append(
            "- 交付文件: "
            + (", ".join(route.deliverables) if route.deliverables else "无")
        )
        route_lines.append(
            "- 关注重点: "
            + (", ".join(route.focus_points) if route.focus_points else "无")
        )
        route_lines.append("")

    return "\n".join(
        [
            "# 教学准备计划",
            "",
            f"- 学习目标: {request.learning_goal}",
            f"- 学科: {request.subject}",
            f"- 学段/年级: {request.grade_level}",
            f"- 学习者画像: {request.learner_profile}",
            f"- 补充说明: {request.notes}",
            "",
            "## 总控摘要",
            plan.plan_summary,
            "",
            "## 需准备材料",
            *[f"- {item}" for item in plan.required_materials],
            "",
            "## 教师准备清单",
            *[f"- {item}" for item in plan.teacher_checklist],
            "",
            "## 教学关注重点",
            *[f"- {item}" for item in plan.teaching_focus],
            "",
            "## 质量要求",
            *[f"- {item}" for item in plan.quality_bar],
            "",
            "## Agent 路由结果",
            *route_lines,
        ]
    ).strip()


def render_fallback_report(
    request: GenerationRequest,
    plan: PreparationPlan,
    artifacts: list[ArtifactResult],
    output_dir: Path,
) -> str:
    lines = [
        "# 教学准备报告",
        "",
        f"- 学习目标: {request.learning_goal}",
        f"- 学科: {request.subject}",
        f"- 学段/年级: {request.grade_level}",
        f"- 输出目录: {output_dir}",
        "",
        "## 总控摘要",
        plan.plan_summary,
        "",
        "## 需准备材料",
    ]
    lines.extend(f"- {item}" for item in plan.required_materials)
    lines.append("")
    lines.append("## Agent 结果")
    for artifact in artifacts:
        lines.append(f"### {artifact.title}")
        lines.append(f"- Agent: {artifact.agent_name}")
        lines.append(f"- 状态: {artifact.status}")
        lines.append(f"- 摘要: {artifact.summary}")
        lines.extend(f"- 文件: {file_path}" for file_path in artifact.files)
        lines.extend(f"- 备注: {note}" for note in artifact.notes)
        lines.append("")
    return "\n".join(lines).strip()
