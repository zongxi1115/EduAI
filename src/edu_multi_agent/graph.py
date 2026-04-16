from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from operator import add
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from typing import Annotated, Any, Callable, Literal, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from .config import PROJECT_ROOT, Settings
from .file_io import (
    append_jsonl_file,
    now_iso,
    render_fallback_report,
    render_plan_markdown,
    render_practice_blueprint_markdown,
    write_json_file,
    write_text_file,
)
from .llm import LLMClient
from .models import (
    AgentName,
    AgentRoute,
    ArtifactResult,
    GenerationRequest,
    PracticeBlueprint,
    PreparationPlan,
    QuestionTypeName,
)
from .prompts import (
    build_interactive_web_prompts,
    build_manim_prompts,
    build_planner_prompts,
    build_practice_planner_prompts,
    build_practice_prompts,
    build_report_prompts,
    build_study_guide_prompts,
)


GraphEventCallback = Callable[[dict[str, Any]], None]


class WorkflowState(TypedDict, total=False):
    request: dict[str, Any]
    output_dir: str
    plan: dict[str, Any]
    practice_blueprint: dict[str, Any]
    practice_blueprint_files: list[str]
    practice_blueprint_notes: list[str]
    artifact_results: Annotated[list[dict[str, Any]], add]
    plan_path: str
    report_path: str
    manifest_path: str


@dataclass(frozen=True, slots=True)
class AgentSpec:
    agent_name: AgentName
    title: str
    folder: str
    required_files: tuple[str, ...]
    prompt_builder: Callable[..., tuple[str, str]]


AGENT_SPECS: tuple[AgentSpec, ...] = (
    AgentSpec(
        agent_name="study_guide",
        title="学案 Agent",
        folder="01_study_guide",
        required_files=("study_guide.md", "teacher_notes.md"),
        prompt_builder=build_study_guide_prompts,
    ),
    AgentSpec(
        agent_name="practice",
        title="练习 Agent",
        folder="02_practice",
        required_files=("practice_questions.json", "answer_key.md"),
        prompt_builder=build_practice_prompts,
    ),
    AgentSpec(
        agent_name="manim",
        title="Manim Agent",
        folder="03_manim",
        required_files=("lesson_animation.py", "render_guide.md"),
        prompt_builder=build_manim_prompts,
    ),
    AgentSpec(
        agent_name="interactive_web",
        title="互动网页 Agent",
        folder="04_interactive_web",
        required_files=("index.html", "usage_notes.md"),
        prompt_builder=build_interactive_web_prompts,
    ),
)

QUESTION_TYPE_ORDER: tuple[QuestionTypeName, ...] = (
    "FillInTheBlank",
    "MultipleChoice",
    "ShortAnswer",
    "Listening",
    "Coding",
    "Drawing",
)
PRACTICE_BLUEPRINT_JSON_PATH = "02_practice/practice_blueprint.json"
PRACTICE_BLUEPRINT_MARKDOWN_PATH = "02_practice/practice_blueprint.md"
MANIM_VALIDATION_MAX_ATTEMPTS = 5
MANIM_VALIDATION_TIMEOUT_SECONDS = 180
MANIM_VALIDATION_OUTPUT_CHAR_LIMIT = 6000
MANIM_ARTIFACT_RENDER_TIMEOUT_SECONDS = 240
MANIM_REPAIR_MEMORY_RELATIVE_PATH = "docs/repair_memory/manim_runtime_lessons.jsonl"
MANIM_REPAIR_MEMORY_MAX_ITEMS = 8
MANIM_TOOL_REPAIR_MAX_STEPS = 12


class ManimRepairToolCall(BaseModel):
    """One tool action requested by the Manim repair agent."""

    action: Literal[
        "read_file",
        "read_lines",
        "grep",
        "replace_lines",
        "replace_file",
        "run_validation",
        "finish",
    ] = Field(description="The next tool to execute.")
    file_name: Literal["lesson_animation.py", "render_guide.md"] | None = Field(
        default=None,
        description="Target file when the tool needs one.",
    )
    start_line: int | None = Field(
        default=None,
        ge=1,
        description="1-based start line for line-based edits/reads.",
    )
    end_line: int | None = Field(
        default=None,
        ge=1,
        description="1-based end line for line-based edits/reads.",
    )
    pattern: str | None = Field(
        default=None,
        description="Search pattern used by grep.",
    )
    replacement: str | None = Field(
        default=None,
        description="Replacement text for line-based edits.",
    )
    content: str | None = Field(
        default=None,
        description="Full file content when replacing a file.",
    )
    reason: str = Field(
        description="Short explanation of why this tool is the best next step.",
    )


def _default_route(spec: AgentSpec) -> AgentRoute:
    deliverables = list(spec.required_files)
    if spec.agent_name == "practice":
        deliverables = ["practice_blueprint.md", *deliverables]
    return AgentRoute(
        agent_name=spec.agent_name,
        selected=True,
        objective=f"为当前学习目标准备 {spec.agent_name} 相关产出。",
        deliverables=deliverables,
        focus_points=[],
    )


def _normalize_plan(plan: PreparationPlan) -> PreparationPlan:
    route_map = {route.agent_name: route for route in plan.agent_routes}
    normalized_routes: list[AgentRoute] = []
    for spec in AGENT_SPECS:
        route = route_map.get(spec.agent_name, _default_route(spec))
        deliverables = route.deliverables or list(spec.required_files)
        if spec.agent_name == "practice" and "practice_blueprint.md" not in deliverables:
            deliverables = ["practice_blueprint.md", *deliverables]
        normalized_routes.append(route.model_copy(update={"deliverables": deliverables}))

    return plan.model_copy(update={"agent_routes": normalized_routes})


def _get_route(plan: PreparationPlan, agent_name: AgentName) -> AgentRoute:
    for route in plan.agent_routes:
        if route.agent_name == agent_name:
            return route
    raise KeyError(f"Missing route for agent: {agent_name}")


def _compact_lines(items: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw_item in items:
        item = raw_item.strip()
        if not item or item in seen:
            continue
        cleaned.append(item)
        seen.add(item)
    return cleaned


def _normalize_practice_blueprint(blueprint: PracticeBlueprint) -> PracticeBlueprint:
    merged_allocations: dict[QuestionTypeName, dict[str, Any]] = {}
    for allocation in blueprint.question_allocations:
        if allocation.count <= 0:
            continue

        current = merged_allocations.get(allocation.question_type)
        if current is None:
            merged_allocations[allocation.question_type] = {
                "question_type": allocation.question_type,
                "count": allocation.count,
                "purpose": allocation.purpose.strip() or "覆盖该题型对应能力。",
                "competency_focus": _compact_lines(allocation.competency_focus),
            }
            continue

        current["count"] += allocation.count
        current["purpose"] = current["purpose"] or allocation.purpose.strip()
        current["competency_focus"] = _compact_lines(
            [*current["competency_focus"], *allocation.competency_focus]
        )

    normalized_allocations = [
        merged_allocations[question_type]
        for question_type in QUESTION_TYPE_ORDER
        if question_type in merged_allocations
    ]
    if not normalized_allocations:
        raise ValueError("Practice blueprint must allocate at least one question type.")

    total_questions = sum(int(item["count"]) for item in normalized_allocations)
    return PracticeBlueprint.model_validate(
        {
            "planning_summary": blueprint.planning_summary.strip(),
            "total_questions": total_questions,
            "topic_characteristics": _compact_lines(blueprint.topic_characteristics),
            "distribution_principles": _compact_lines(blueprint.distribution_principles),
            "progression_plan": _compact_lines(blueprint.progression_plan)
            or ["热身诊断", "核心巩固", "挑战提升", "迁移应用"],
            "must_cover": _compact_lines(blueprint.must_cover),
            "question_allocations": normalized_allocations,
        }
    )


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _build_fallback_practice_blueprint(
    request: GenerationRequest,
    plan: PreparationPlan,
    route: AgentRoute,
) -> PracticeBlueprint:
    context_text = " ".join(
        [
            request.learning_goal,
            request.subject,
            request.grade_level,
            request.learner_profile,
            request.notes,
            route.objective,
            *route.focus_points,
            *plan.teaching_focus,
        ]
    ).lower()

    implementation_keywords = (
        "algorithm",
        "coding",
        "code",
        "programming",
        "debug",
        "编程",
        "代码",
        "算法",
        "程序",
        "实现",
        "调试",
        "数据结构",
        "动态规划",
        "递归",
        "sql",
        "python",
        "java",
        "c++",
    )
    visual_keywords = (
        "diagram",
        "graph",
        "geometry",
        "visual",
        "图像",
        "几何",
        "示意图",
        "受力",
        "结构图",
        "流程图",
        "坐标",
        "作图",
    )
    listening_keywords = (
        "listening",
        "audio",
        "pronunciation",
        "听力",
        "音频",
        "发音",
        "口语",
        "音乐",
    )
    reasoning_keywords = (
        "reason",
        "analysis",
        "compare",
        "explain",
        "proof",
        "推导",
        "证明",
        "分析",
        "解释",
        "比较",
        "策略",
        "建模",
    )
    memory_keywords = (
        "definition",
        "term",
        "formula",
        "concept",
        "定义",
        "术语",
        "公式",
        "概念",
        "基础",
        "词汇",
    )

    implementation_heavy = _contains_any(context_text, implementation_keywords)
    visual_heavy = _contains_any(context_text, visual_keywords)
    listening_heavy = _contains_any(context_text, listening_keywords)
    reasoning_heavy = _contains_any(context_text, reasoning_keywords)
    memory_heavy = _contains_any(context_text, memory_keywords)

    counts: dict[QuestionTypeName, int] = {question_type: 0 for question_type in QUESTION_TYPE_ORDER}
    counts["MultipleChoice"] = 1
    counts["ShortAnswer"] = 1

    if implementation_heavy:
        counts["Coding"] = 3
        counts["ShortAnswer"] += 1
    if visual_heavy:
        counts["Drawing"] = 2
        counts["ShortAnswer"] += 1
    if listening_heavy:
        counts["Listening"] = 2
        counts["MultipleChoice"] += 1
    if reasoning_heavy:
        counts["ShortAnswer"] += 1
    if memory_heavy:
        counts["FillInTheBlank"] += 1

    if not any((implementation_heavy, visual_heavy, listening_heavy)):
        counts["MultipleChoice"] += 1
        counts["FillInTheBlank"] += 1
        counts["ShortAnswer"] += 1

    total_questions = sum(counts.values())
    while total_questions < 6:
        if implementation_heavy:
            counts["Coding"] += 1
        elif visual_heavy:
            counts["Drawing"] += 1
        else:
            counts["ShortAnswer"] += 1
        total_questions = sum(counts.values())

    while total_questions > 10:
        for question_type in ("FillInTheBlank", "MultipleChoice", "ShortAnswer"):
            if counts[question_type] > 1:
                counts[question_type] -= 1
                break
        else:
            break
        total_questions = sum(counts.values())

    purpose_map: dict[QuestionTypeName, str] = {
        "FillInTheBlank": "用于快速检查术语、公式和关键细节是否掌握。",
        "MultipleChoice": "用于诊断概念辨析与常见误区。",
        "ShortAnswer": "用于检验思路表达、方法选择与迁移解释。",
        "Listening": "用于检验听辨理解与音频信息提取。",
        "Coding": "用于检验实现能力、算法落地与调试思维。",
        "Drawing": "用于检验图示表达、结构建模与空间理解。",
    }

    focus_map: dict[QuestionTypeName, list[str]] = {
        "FillInTheBlank": ["关键定义", "符号与公式", "基础记忆"],
        "MultipleChoice": ["概念辨析", "误区识别", "快速诊断"],
        "ShortAnswer": ["思路表达", "状态或步骤说明", "迁移解释"],
        "Listening": ["听辨关键信息", "语义理解", "细节提取"],
        "Coding": ["算法实现", "边界处理", "调试与验证"],
        "Drawing": ["结构可视化", "图示表达", "关系建模"],
    }

    allocations = [
        {
            "question_type": question_type,
            "count": count,
            "purpose": purpose_map[question_type],
            "competency_focus": focus_map[question_type],
        }
        for question_type, count in counts.items()
        if count > 0
    ]

    topic_characteristics = _compact_lines(
        [
            "需要循序渐进地完成从识别到迁移的练习设计。",
            "练习题型需要跟随知识本体而变化，而不是固定均分模板。",
            "学习目标与学习者画像共同决定题型配比。",
            "主题包含明显的实现/操作要求。" if implementation_heavy else "",
            "主题依赖可视化表达或图示理解。" if visual_heavy else "",
            "主题需要音频理解能力支撑。" if listening_heavy else "",
        ]
    )
    distribution_principles = _compact_lines(
        [
            "先用低门槛题快速判断基础，再把题量压到真正承载核心能力的题型上。",
            "对需要解释、设计或迁移的内容，提高简答题占比。",
            "当主题本身要求实现时，编程题至少应承担核心训练而不是点缀。",
            "无音频刚需时不引入听力题；无图示刚需时不过度引入作图题。",
        ]
    )

    return _normalize_practice_blueprint(
        PracticeBlueprint(
            planning_summary=(
                f"根据“{request.learning_goal}”的主题特征与学习者画像，"
                "采用回退策略生成了通用练习蓝图。"
            ),
            total_questions=total_questions,
            topic_characteristics=topic_characteristics,
            distribution_principles=distribution_principles,
            progression_plan=["热身诊断", "核心巩固", "挑战提升", "迁移应用"],
            must_cover=_compact_lines(
                [*plan.teaching_focus, *route.focus_points, request.learning_goal]
            ),
            question_allocations=allocations,
        )
    )


def _count_question_types(payload: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in payload:
        question_type = item.get("question_type")
        counts[str(question_type)] = counts.get(str(question_type), 0) + 1
    return counts


def _build_global_question_id(run_id: str, index: int) -> str:
    return f"question_{run_id}_{index:03d}_{uuid4().hex[:12]}"


def _append_question_id_mapping(
    answer_key_markdown: str,
    questions: list[dict[str, Any]],
) -> str:
    mapping_lines = [
        "## 系统分配的题目 ID",
        "",
        "以下全局唯一 ID 由系统在题库生成完成后统一分配，可用于后续提交记录、日志追踪和数据库关联。",
        "",
    ]
    for index, question in enumerate(questions, start=1):
        question_id = str(question.get("id", "")).strip()
        question_type = str(question.get("question_type", "")).strip() or "Unknown"
        mapping_lines.append(f"- 第{index}题（{question_type}）: `{question_id}`")

    return "\n".join([answer_key_markdown.rstrip(), "", *mapping_lines]).strip() + "\n"


def _resolve_manim_validation_command() -> list[str]:
    manim_cli = shutil.which("manim")
    if manim_cli:
        return [manim_cli]
    return [sys.executable, "-m", "manim"]


def _load_manim_repair_memory() -> list[dict[str, Any]]:
    memory_path = PROJECT_ROOT / MANIM_REPAIR_MEMORY_RELATIVE_PATH
    if not memory_path.is_file():
        return []

    records: list[dict[str, Any]] = []
    for line in memory_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            records.append(payload)
    return records[-MANIM_REPAIR_MEMORY_MAX_ITEMS:]


def _format_manim_repair_memory_for_prompt(records: list[dict[str, Any]]) -> str:
    if not records:
        return ""

    lines = [
        "Past successful Manim runtime repair lessons from this project:",
    ]
    for index, record in enumerate(records, start=1):
        lines.append(f"{index}. Error signature: {record.get('error_signature', 'Unknown')}")
        for lesson in record.get("lessons", []):
            lines.append(f"   - {lesson}")
        search_hints = record.get("search_hints", [])
        if search_hints:
            lines.append("   - Useful search hints: " + ", ".join(search_hints))
    return "\n".join(lines).strip()


def _extract_manim_traceback_line_numbers(error_text: str) -> list[int]:
    line_numbers: list[int] = []
    patterns = (
        r"lesson_animation\.py:(\d+)",
        r"py:(\d+)\s+in",
        r"line\s+(\d+)",
    )
    for pattern in patterns:
        for match in re.findall(pattern, error_text):
            try:
                line_number = int(match)
            except ValueError:
                continue
            if line_number > 0 and line_number not in line_numbers:
                line_numbers.append(line_number)
    return line_numbers


def _format_manim_numbered_excerpt(
    script_content: str,
    *,
    focus_lines: list[int],
    context_radius: int = 4,
) -> str:
    lines = script_content.splitlines()
    if not lines:
        return "(empty script)"

    if not focus_lines:
        focus_lines = [1]

    selected_indexes: list[int] = []
    for focus_line in focus_lines:
        start = max(1, focus_line - context_radius)
        end = min(len(lines), focus_line + context_radius)
        for index in range(start, end + 1):
            if index not in selected_indexes:
                selected_indexes.append(index)

    excerpt_lines: list[str] = []
    previous_index = None
    for index in selected_indexes:
        if previous_index is not None and index - previous_index > 1:
            excerpt_lines.append("   ...")
        excerpt_lines.append(f"{index:4}: {lines[index - 1]}")
        previous_index = index

    return "\n".join(excerpt_lines)


def _collect_manim_search_hints(
    script_content: str,
    *,
    focus_lines: list[int],
    error_text: str,
) -> dict[str, list[str]]:
    lines = script_content.splitlines()
    lowered_error = error_text.lower()
    candidate_patterns = ["shift(", "move_to(", "next_to(", "ReplacementTransform(", "Transform(", "VGroup(", "np.", "animate", "Arrow(", "Text("]
    relevant_patterns: list[str] = []

    for focus_line in focus_lines:
        if 1 <= focus_line <= len(lines):
            focus_source = lines[focus_line - 1]
            for pattern in candidate_patterns:
                if pattern in focus_source and pattern not in relevant_patterns:
                    relevant_patterns.append(pattern)

    if "broadcast" in lowered_error or "shape" in lowered_error:
        for pattern in ("np.", "shift(", "move_to("):
            if pattern not in relevant_patterns:
                relevant_patterns.append(pattern)
    if "nameerror" in lowered_error and "np" in lowered_error and "np." not in relevant_patterns:
        relevant_patterns.append("np.")
    if not relevant_patterns:
        relevant_patterns.extend(["shift(", "move_to(", "VGroup("])

    hits: dict[str, list[str]] = {}
    for pattern in relevant_patterns:
        matched_lines = [
            f"{index:4}: {line}"
            for index, line in enumerate(lines, start=1)
            if pattern in line
        ]
        if matched_lines:
            hits[pattern] = matched_lines[:8]
    return hits


def _build_manim_repair_tool_report(files: dict[str, str], error_text: str) -> tuple[str, list[int], list[str]]:
    script_content = files.get("lesson_animation.py", "")
    render_guide = files.get("render_guide.md", "").strip()
    focus_lines = _extract_manim_traceback_line_numbers(error_text)
    excerpt = _format_manim_numbered_excerpt(script_content, focus_lines=focus_lines)
    grep_hits = _collect_manim_search_hints(
        script_content,
        focus_lines=focus_lines,
        error_text=error_text,
    )
    search_hints = list(grep_hits)

    grep_sections = []
    for pattern, hits in grep_hits.items():
        grep_sections.append(f'grep "{pattern}":')
        grep_sections.extend(hits)
        grep_sections.append("")

    grep_section_lines = grep_sections if grep_sections else ["(no grep hits)"]
    report = [
        "Local debugging tools already executed for you:",
        "",
        f"- traceback focus lines: {focus_lines or ['unresolved']}",
        "",
        "Focused source excerpt with line numbers:",
        excerpt,
        "",
        "grep results on the current script:",
        *grep_section_lines,
        "Current render guide:",
        render_guide or "(empty render guide)",
        "",
        "Current full lesson_animation.py:",
        script_content.strip() or "(empty script)",
    ]
    return "\n".join(report).strip(), focus_lines, search_hints


def _format_numbered_file_content(content: str) -> str:
    lines = content.splitlines()
    if not lines:
        return "(empty file)"
    return "\n".join(f"{index:4}: {line}" for index, line in enumerate(lines, start=1))


def _execute_manim_repair_tool_call(
    files: dict[str, str],
    tool_call: ManimRepairToolCall,
) -> tuple[dict[str, str], str, str | None]:
    current_files = dict(files)

    def require_file_name() -> str:
        if not tool_call.file_name:
            raise ValueError(f"Tool `{tool_call.action}` requires `file_name`.")
        if tool_call.file_name not in current_files:
            raise ValueError(f"Unknown file: {tool_call.file_name}")
        return tool_call.file_name

    if tool_call.action == "read_file":
        file_name = require_file_name()
        return current_files, (
            f"Tool result for read_file on {file_name}:\n"
            + _format_numbered_file_content(current_files[file_name])
        ), None

    if tool_call.action == "read_lines":
        file_name = require_file_name()
        start_line = tool_call.start_line or 1
        end_line = tool_call.end_line or start_line
        if end_line < start_line:
            raise ValueError("`end_line` must be greater than or equal to `start_line`.")
        lines = current_files[file_name].splitlines()
        start_index = max(1, start_line)
        end_index = min(len(lines), end_line)
        if not lines:
            excerpt = "(empty file)"
        else:
            excerpt = "\n".join(
                f"{index:4}: {lines[index - 1]}"
                for index in range(start_index, end_index + 1)
            )
        return current_files, (
            f"Tool result for read_lines on {file_name} ({start_line}-{end_line}):\n{excerpt}"
        ), None

    if tool_call.action == "grep":
        file_name = require_file_name()
        pattern = (tool_call.pattern or "").strip()
        if not pattern:
            raise ValueError("Tool `grep` requires a non-empty `pattern`.")
        matched_lines = [
            f"{index:4}: {line}"
            for index, line in enumerate(current_files[file_name].splitlines(), start=1)
            if pattern in line
        ]
        grep_output = "\n".join(matched_lines) if matched_lines else "(no matches)"
        return current_files, (
            f'Tool result for grep on {file_name} with pattern "{pattern}":\n{grep_output}'
        ), None

    if tool_call.action == "replace_lines":
        file_name = require_file_name()
        if tool_call.replacement is None:
            raise ValueError("Tool `replace_lines` requires `replacement`.")
        start_line = tool_call.start_line
        end_line = tool_call.end_line
        if start_line is None or end_line is None:
            raise ValueError("Tool `replace_lines` requires `start_line` and `end_line`.")
        if end_line < start_line:
            raise ValueError("`end_line` must be greater than or equal to `start_line`.")

        original_lines = current_files[file_name].splitlines()
        if start_line < 1 or end_line > len(original_lines):
            raise ValueError(
                f"Invalid replace range {start_line}-{end_line} for file with {len(original_lines)} lines."
            )
        replacement_lines = tool_call.replacement.splitlines()
        updated_lines = [
            *original_lines[: start_line - 1],
            *replacement_lines,
            *original_lines[end_line:],
        ]
        current_files[file_name] = "\n".join(updated_lines).rstrip() + "\n"
        preview_start = max(1, start_line - 2)
        preview_end = min(len(updated_lines), start_line + len(replacement_lines) + 1)
        preview = "\n".join(
            f"{index:4}: {updated_lines[index - 1]}"
            for index in range(preview_start, preview_end + 1)
        )
        return current_files, (
            f"Tool result for replace_lines on {file_name} ({start_line}-{end_line}) succeeded.\n"
            f"Updated excerpt:\n{preview}"
        ), None

    if tool_call.action == "replace_file":
        file_name = require_file_name()
        if tool_call.content is None:
            raise ValueError("Tool `replace_file` requires `content`.")
        current_files[file_name] = tool_call.content.rstrip() + "\n"
        return current_files, (
            f"Tool result for replace_file on {file_name} succeeded.\n"
            + _format_numbered_file_content(current_files[file_name])
        ), None

    if tool_call.action == "run_validation":
        _validate_generated_files(current_files)
        validation_command = _validate_manim_bundle_runtime(current_files)
        return current_files, (
            "Tool result for run_validation:\n"
            f"Validation passed with command: {validation_command}"
        ), validation_command

    raise ValueError(f"Unsupported tool action: {tool_call.action}")


def _build_manim_tool_repair_prompts(
    *,
    request: GenerationRequest,
    current_files: dict[str, str],
    current_error_text: str,
    last_tool_result: str,
    step_index: int,
    repair_memory_text: str,
) -> tuple[str, str]:
    file_summaries = [
        f"- {file_name}: {len(content.splitlines())} lines"
        for file_name, content in current_files.items()
    ]
    system_prompt = """
You are a Manim runtime repair agent.
You must repair the current files incrementally by choosing one tool action at a time.
Do not regenerate the package from scratch unless a full-file replacement is truly necessary.
Return strict JSON only.

Available tools:
- read_file: inspect a full file with line numbers.
- read_lines: inspect a line range in one file.
- grep: search for a literal pattern in one file and get matching line numbers.
- replace_lines: replace a specific inclusive line range with new text.
- replace_file: replace a whole file when surgical edits are impossible.
- run_validation: run `manim -pql lesson_animation.py LessonScene`.
- finish: stop tool use only when you are confident the current files are ready; the system will validate one final time.

Rules:
- Prefer read_lines or grep before editing if the failure is not fully localized.
- Prefer replace_lines over replace_file whenever possible.
- Use the current traceback and previous tool outputs to localize the bug.
- Keep `LessonScene`, `from manim import *`, and the overall teaching intent.
- Make the smallest viable change that resolves the runtime issue.
""".strip()

    user_prompt = f"""
Repair the existing Manim package for this learning goal: {request.learning_goal}

Current files:
{chr(10).join(file_summaries)}

Current validation error:
{current_error_text}

Previous tool result:
{last_tool_result}

Past repair lessons:
{repair_memory_text or "(No previous lessons recorded.)"}

This is tool step {step_index}/{MANIM_TOOL_REPAIR_MAX_STEPS}.

Return one JSON object with this shape:
{{
  "action": "read_lines | grep | replace_lines | replace_file | run_validation | finish",
  "file_name": "lesson_animation.py or render_guide.md when needed, else null",
  "start_line": 1,
  "end_line": 3,
  "pattern": "optional grep pattern",
  "replacement": "optional replacement text",
  "content": "optional full file content",
  "reason": "short explanation"
}}
""".strip()

    return system_prompt, user_prompt


def _extract_manim_error_signature(error_text: str) -> str:
    error_lines = [line.strip() for line in error_text.splitlines() if line.strip()]
    for line in reversed(error_lines):
        if "Error" in line or "Exception" in line:
            return line[:240]
    return (error_lines[-1] if error_lines else "Unknown Manim runtime error")[:240]


def _derive_manim_repair_lessons(
    error_text: str,
    script_content: str,
    *,
    focus_lines: list[int],
) -> list[str]:
    lowered_error = error_text.lower()
    lessons = [
        "收到运行报错后，先根据 traceback 行号定位，再做最小必要修改，不要整份脚本推倒重写。",
    ]

    if "broadcast" in lowered_error or "shape" in lowered_error:
        lessons.append(
            "涉及 RIGHT/LEFT/UP/DOWN 等 Manim 方向向量时，保持 3 维坐标一致；不要把 `np.random.randn(2)` 这类二维数组直接与 3 维向量相加。"
        )
        lessons.append(
            "如果要做随机扰动，优先生成标量后分别乘 `RIGHT`/`UP`，或显式构造成 `[x, y, 0]`。"
        )

    if "nameerror" in lowered_error and "np" in lowered_error:
        lessons.append("脚本里使用 `np` 时必须显式导入 `numpy as np`，不要依赖隐式上下文。")

    if "attributeerror" in lowered_error:
        lessons.append("调用动画方法前先确认对象类型正确，避免把普通值、列表或 None 当成 Mobject/Animation 使用。")

    if "typeerror" in lowered_error:
        lessons.append("优先检查当前行的参数类型和维度是否符合 Manim API 预期，再决定是否改动画结构。")

    lines = script_content.splitlines()
    for focus_line in focus_lines:
        if 1 <= focus_line <= len(lines):
            source = lines[focus_line - 1]
            if "shift(" in source and "np." in source:
                lessons.append("`shift()` 里的表达式如果混入 numpy 偏移，先检查返回值是不是标准 3 维向量。")
                break

    deduped_lessons: list[str] = []
    for lesson in lessons:
        if lesson not in deduped_lessons:
            deduped_lessons.append(lesson)
    return deduped_lessons


def _record_manim_repair_memory(
    *,
    run_id: str,
    learning_goal: str,
    error_text: str,
    script_content: str,
    search_hints: list[str],
    focus_lines: list[int],
) -> None:
    lessons = _derive_manim_repair_lessons(
        error_text,
        script_content,
        focus_lines=focus_lines,
    )
    payload = {
        "timestamp": now_iso(),
        "run_id": run_id,
        "learning_goal": learning_goal,
        "error_signature": _extract_manim_error_signature(error_text),
        "focus_lines": focus_lines,
        "search_hints": search_hints,
        "lessons": lessons,
    }
    append_jsonl_file(PROJECT_ROOT, MANIM_REPAIR_MEMORY_RELATIVE_PATH, payload)


def _truncate_validation_output(text: str, *, max_chars: int = MANIM_VALIDATION_OUTPUT_CHAR_LIMIT) -> str:
    normalized = text.strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[-max_chars:]


def _validate_manim_bundle_runtime(
    files: dict[str, str],
    *,
    timeout_seconds: int = MANIM_VALIDATION_TIMEOUT_SECONDS,
) -> str:
    script_name = "lesson_animation.py"
    scene_name = "LessonScene"
    script_content = files.get(script_name)
    if not script_content:
        raise ValueError(f"Missing {script_name} for Manim runtime validation.")

    command_prefix = _resolve_manim_validation_command()
    display_command = " ".join(
        [*command_prefix, "-pql", script_name, scene_name]
    )

    with TemporaryDirectory(prefix="edu_manim_validation_") as temp_dir:
        temp_path = Path(temp_dir)
        script_path = temp_path / script_name
        script_path.write_text(script_content, encoding="utf-8")

        try:
            completed = subprocess.run(
                [*command_prefix, "-pql", script_name, scene_name],
                cwd=temp_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise ValueError(
                "Manim runtime validation timed out.\n"
                f"Command: {display_command}\n"
                f"Timeout: {timeout_seconds}s"
            ) from exc

    if completed.returncode != 0:
        combined_output = "\n".join(
            part.strip()
            for part in (completed.stdout, completed.stderr)
            if part and part.strip()
        ).strip()
        lowered_output = combined_output.lower()
        if "no module named manim" in lowered_output or "is not recognized as an internal or external command" in lowered_output:
            raise RuntimeError(
                "Manim runtime validation is unavailable in the current environment.\n"
                f"Command: {display_command}\n"
                "Execution output:\n"
                + _truncate_validation_output(combined_output)
            )
        raise ValueError(
            "Manim runtime validation failed.\n"
            f"Command: {display_command}\n"
            "Execution output:\n"
            + _truncate_validation_output(combined_output)
        )

    return display_command


def _render_manim_artifact(
    target_dir: Path,
    *,
    timeout_seconds: int = MANIM_ARTIFACT_RENDER_TIMEOUT_SECONDS,
) -> tuple[str, list[str]]:
    script_name = "lesson_animation.py"
    scene_name = "LessonScene"
    script_path = target_dir / script_name
    if not script_path.is_file():
        raise ValueError(f"Missing {script_name} before final Manim render.")

    command_prefix = _resolve_manim_validation_command()
    display_command = " ".join([*command_prefix, "-ql", script_name, scene_name])

    try:
        completed = subprocess.run(
            [*command_prefix, "-ql", script_name, scene_name],
            cwd=target_dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError(
            "Final Manim artifact render timed out.\n"
            f"Command: {display_command}\n"
            f"Timeout: {timeout_seconds}s"
        ) from exc

    if completed.returncode != 0:
        combined_output = "\n".join(
            part.strip()
            for part in (completed.stdout, completed.stderr)
            if part and part.strip()
        ).strip()
        raise ValueError(
            "Final Manim artifact render failed.\n"
            f"Command: {display_command}\n"
            "Execution output:\n"
            + _truncate_validation_output(combined_output)
        )

    rendered_videos = [
        path
        for path in target_dir.rglob("*.mp4")
        if "partial_movie_files" not in path.parts
    ]
    if not rendered_videos:
        raise ValueError(
            "Final Manim artifact render succeeded but no mp4 output was found.\n"
            f"Command: {display_command}"
        )

    rendered_videos.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return display_command, [str(path) for path in rendered_videos]


def _finalize_practice_files(
    files: dict[str, str],
    *,
    run_id: str,
) -> dict[str, str]:
    if "practice_questions.json" not in files:
        return files

    payload = json.loads(files["practice_questions.json"])
    if not isinstance(payload, list):
        raise ValueError("practice_questions.json must be a top-level JSON array.")

    finalized_questions: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"practice_questions.json item {index} must be an object.")

        normalized_item = {
            key: value
            for key, value in item.items()
            if key not in {"id", "question_id"}
        }
        finalized_questions.append(
            {
                "id": _build_global_question_id(run_id, index),
                **normalized_item,
            }
        )

    finalized_files = dict(files)
    finalized_files["practice_questions.json"] = (
        json.dumps(finalized_questions, ensure_ascii=False, indent=2) + "\n"
    )
    if "answer_key.md" in finalized_files:
        finalized_files["answer_key.md"] = _append_question_id_mapping(
            finalized_files["answer_key.md"],
            finalized_questions,
        )

    return finalized_files


def _validate_generated_files(
    files: dict[str, str],
    *,
    practice_blueprint: PracticeBlueprint | None = None,
    require_generated_ids: bool = True,
) -> None:
    for filename, content in files.items():
        if filename == "practice_questions.json":
            payload = json.loads(content)
            if not isinstance(payload, list):
                raise ValueError("practice_questions.json must be a top-level JSON array.")

            common_fields = {"question", "analysis"}
            type_fields = {
                "FillInTheBlank": {"answer"},
                "MultipleChoice": {"options", "correct_answer"},
                "ShortAnswer": {"reference_answer"},
                "Listening": {"audio_src", "answer"},
                "Coding": {"reference_code", "test_cases"},
                "Drawing": {"reference_image"},
            }
            allowed_types = set(type_fields)

            for index, item in enumerate(payload, start=1):
                if not isinstance(item, dict):
                    raise ValueError(
                        f"practice_questions.json item {index} must be an object."
                    )
                question_type = item.get("question_type")
                if question_type not in allowed_types:
                    raise ValueError(
                        f"practice_questions.json item {index} has invalid "
                        f"question_type: {question_type}"
                    )

                missing_common = sorted(field for field in common_fields if field not in item)
                missing_type_specific = sorted(
                    field for field in type_fields[question_type] if field not in item
                )
                missing_fields = missing_common + missing_type_specific
                if missing_fields:
                    raise ValueError(
                        f"practice_questions.json item {index} is missing fields: "
                        + ", ".join(missing_fields)
                    )

                if require_generated_ids:
                    question_id = item.get("id")
                    if not isinstance(question_id, str) or not question_id.strip():
                        raise ValueError(
                            f"practice_questions.json item {index} is missing generated id."
                        )

            if require_generated_ids:
                question_ids = [str(item.get("id", "")).strip() for item in payload]
                if len(question_ids) != len(set(question_ids)):
                    raise ValueError("practice_questions.json contains duplicate question ids.")

            if practice_blueprint is not None:
                expected_counts = {
                    allocation.question_type: allocation.count
                    for allocation in practice_blueprint.question_allocations
                    if allocation.count > 0
                }
                actual_counts = {
                    question_type: count
                    for question_type, count in _count_question_types(payload).items()
                    if count > 0
                }
                if len(payload) != practice_blueprint.total_questions:
                    raise ValueError(
                        "practice_questions.json total count does not match practice blueprint: "
                        f"expected {practice_blueprint.total_questions}, got {len(payload)}"
                    )
                if actual_counts != expected_counts:
                    raise ValueError(
                        "practice_questions.json question_type distribution does not match "
                        f"practice blueprint. expected={expected_counts}, got={actual_counts}"
                    )

        elif filename.endswith(".py"):
            compile(content, filename, "exec")


def _emit_event(
    event_callback: GraphEventCallback | None,
    *,
    event: str,
    node: str,
    summary: str,
    phase: str,
    agent_name: AgentName | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    if event_callback is None:
        return

    payload: dict[str, Any] = {
        "event": event,
        "node": node,
        "phase": phase,
        "summary": summary,
    }
    if agent_name is not None:
        payload["agent_name"] = agent_name
    if data:
        payload["data"] = data
    event_callback(payload)


def build_workflow(
    settings: Settings,
    event_callback: GraphEventCallback | None = None,
):
    llm = LLMClient(settings)
    agent_order = [spec.agent_name for spec in AGENT_SPECS]

    def generate_manim_bundle_with_repair(
        request: GenerationRequest,
        plan: PreparationPlan,
        *,
        run_id: str,
        required_files: tuple[str, ...],
        node_name: str,
    ):
        repair_memory_records = _load_manim_repair_memory()
        repair_memory_text = _format_manim_repair_memory_for_prompt(repair_memory_records)
        system_prompt, base_user_prompt = build_manim_prompts(
            request,
            plan,
            repair_memory_text,
        )
        initial_bundle = llm.invoke_bundle(
            system_prompt,
            base_user_prompt,
            required_files,
        )
        current_files = dict(initial_bundle.files)
        current_summary = initial_bundle.summary
        last_focus_lines: list[int] = []
        last_search_hints: list[str] = []
        last_error_text = ""
        validation_command = ""

        try:
            _emit_event(
                event_callback,
                event="artifact_validation_started",
                node=node_name,
                phase="artifact_validation",
                agent_name="manim",
                summary="Manim runtime validation attempt 1/1 started.",
                data={"attempt": 1, "max_attempts": 1},
            )
            _validate_generated_files(current_files)
            validation_command = _validate_manim_bundle_runtime(current_files)
            _emit_event(
                event_callback,
                event="artifact_validation_passed",
                node=node_name,
                phase="artifact_validation",
                agent_name="manim",
                summary="Manim runtime validation passed.",
                data={"attempt": 1, "command": validation_command},
            )
            return initial_bundle, [
                f"Manim 运行校验已通过：{validation_command}",
                "Manim 自动修复轮次：0",
            ]
        except RuntimeError:
            raise
        except Exception as exc:
            last_error_text = str(exc)

        tool_report, focus_lines, search_hints = _build_manim_repair_tool_report(
            current_files,
            last_error_text,
        )
        last_focus_lines = focus_lines
        last_search_hints = search_hints
        _emit_event(
            event_callback,
            event="artifact_validation_failed",
            node=node_name,
            phase="artifact_validation",
            agent_name="manim",
            summary="Initial Manim runtime validation failed; entering tool-based repair mode.",
            data={"attempt": 1, "error": last_error_text},
        )

        last_tool_result = tool_report
        for step_index in range(1, MANIM_TOOL_REPAIR_MAX_STEPS + 1):
            repair_system_prompt, repair_user_prompt = _build_manim_tool_repair_prompts(
                request=request,
                current_files=current_files,
                current_error_text=last_error_text,
                last_tool_result=last_tool_result,
                step_index=step_index,
                repair_memory_text=repair_memory_text,
            )
            tool_call = llm.invoke_json(
                repair_system_prompt,
                repair_user_prompt,
                ManimRepairToolCall,
            )
            _emit_event(
                event_callback,
                event="artifact_repair_tool_requested",
                node=node_name,
                phase="artifact_repair",
                agent_name="manim",
                summary=f"Manim repair agent requested tool `{tool_call.action}`.",
                data={
                    "step": step_index,
                    "tool_call": tool_call.model_dump(),
                },
            )

            if tool_call.action == "finish":
                try:
                    _validate_generated_files(current_files)
                    validation_command = _validate_manim_bundle_runtime(current_files)
                    _emit_event(
                        event_callback,
                        event="artifact_validation_passed",
                        node=node_name,
                        phase="artifact_validation",
                        agent_name="manim",
                        summary="Manim runtime validation passed after tool-based repair.",
                        data={
                            "step": step_index,
                            "command": validation_command,
                        },
                    )
                    _record_manim_repair_memory(
                        run_id=run_id,
                        learning_goal=request.learning_goal,
                        error_text=last_error_text,
                        script_content=current_files.get("lesson_animation.py", ""),
                        search_hints=last_search_hints,
                        focus_lines=last_focus_lines,
                    )
                    notes = [
                        f"Manim 运行校验已通过：{validation_command}",
                        f"Manim 自动修复轮次：{step_index}",
                        "本次 Manim 修复经验已写入项目经验库。",
                    ]
                    return initial_bundle.__class__(
                        summary=current_summary,
                        files=current_files,
                    ), notes
                except RuntimeError:
                    raise
                except Exception as exc:
                    last_error_text = str(exc)
                    last_tool_result, last_focus_lines, last_search_hints = _build_manim_repair_tool_report(
                        current_files,
                        last_error_text,
                    )
                    continue

            try:
                current_files, tool_result, tool_validation_command = _execute_manim_repair_tool_call(
                    current_files,
                    tool_call,
                )
                last_tool_result = tool_result
                _emit_event(
                    event_callback,
                    event="artifact_repair_tool_completed",
                    node=node_name,
                    phase="artifact_repair",
                    agent_name="manim",
                    summary=f"Manim repair tool `{tool_call.action}` completed.",
                    data={
                        "step": step_index,
                        "tool_result": tool_result[:2000],
                    },
                )

                if tool_call.action == "run_validation":
                    validation_command = tool_validation_command or ""
                    _record_manim_repair_memory(
                        run_id=run_id,
                        learning_goal=request.learning_goal,
                        error_text=last_error_text,
                        script_content=current_files.get("lesson_animation.py", ""),
                        search_hints=last_search_hints,
                        focus_lines=last_focus_lines,
                    )
                    notes = [
                        f"Manim 运行校验已通过：{validation_command}",
                        f"Manim 自动修复轮次：{step_index}",
                        "本次 Manim 修复经验已写入项目经验库。",
                    ]
                    return initial_bundle.__class__(
                        summary=current_summary,
                        files=current_files,
                    ), notes
            except RuntimeError:
                raise
            except Exception as exc:
                last_error_text = str(exc)
                last_tool_result, last_focus_lines, last_search_hints = _build_manim_repair_tool_report(
                    current_files,
                    last_error_text,
                )
                _emit_event(
                    event_callback,
                    event="artifact_repair_tool_failed",
                    node=node_name,
                    phase="artifact_repair",
                    agent_name="manim",
                    summary=f"Manim repair tool `{tool_call.action}` failed.",
                    data={
                        "step": step_index,
                        "error": last_error_text,
                    },
                )

        _emit_event(
            event_callback,
            event="artifact_validation_failed",
            node=node_name,
            phase="artifact_validation",
            agent_name="manim",
            summary="Manim tool-based repair exhausted all steps without success.",
            data={
                "steps": MANIM_TOOL_REPAIR_MAX_STEPS,
                "error": last_error_text,
            },
        )
        raise RuntimeError(
            "Manim bundle failed runtime validation after tool-based repair steps: "
            f"{last_error_text}"
        )

    def planner_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        output_dir = Path(state["output_dir"])
        node_name = "planner"

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="planning",
            summary="Planner node started.",
            data={
                "title": "总控规划",
                "learning_goal": request.learning_goal,
            },
        )

        system_prompt, user_prompt = build_planner_prompts(request)
        plan = llm.invoke_json(system_prompt, user_prompt, PreparationPlan)
        normalized_plan = _normalize_plan(plan)

        write_json_file(
            output_dir,
            "00_supervisor/preparation_plan.json",
            normalized_plan.model_dump(),
        )
        plan_path = write_text_file(
            output_dir,
            "00_supervisor/preparation_plan.md",
            render_plan_markdown(request, normalized_plan),
        )
        _emit_event(
            event_callback,
            event="plan_ready",
            node=node_name,
            phase="planning",
            summary="Preparation plan generated.",
            data={
                "plan": normalized_plan.model_dump(),
                "plan_path": str(plan_path),
            },
        )
        return {"plan": normalized_plan.model_dump(), "plan_path": str(plan_path)}

    def practice_planner_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        plan = PreparationPlan.model_validate(state["plan"])
        output_dir = Path(state["output_dir"])
        route = _get_route(plan, "practice")
        node_name = "practice_planner_agent"

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="practice_planning",
            agent_name="practice",
            summary="练习题型规划 Agent started.",
            data={
                "title": "练习题型规划 Agent",
                "objective": route.objective,
                "focus_points": route.focus_points,
            },
        )

        if not route.selected:
            _emit_event(
                event_callback,
                event="practice_blueprint_skipped",
                node=node_name,
                phase="practice_planning",
                agent_name="practice",
                summary="Practice blueprint skipped because practice route is disabled.",
            )
            return {}

        practice_blueprint_notes: list[str] = []
        try:
            system_prompt, user_prompt = build_practice_planner_prompts(request, plan)
            practice_blueprint = _normalize_practice_blueprint(
                llm.invoke_json(system_prompt, user_prompt, PracticeBlueprint)
            )
            event_name = "practice_blueprint_ready"
            summary = "Practice blueprint generated."
        except Exception as exc:
            practice_blueprint = _build_fallback_practice_blueprint(request, plan, route)
            practice_blueprint_notes = [f"题型规划 Agent 回退到规则蓝图：{exc}"]
            event_name = "practice_blueprint_fallback"
            summary = "Practice blueprint generated with fallback rules."

        blueprint_json_path = write_json_file(
            output_dir,
            PRACTICE_BLUEPRINT_JSON_PATH,
            practice_blueprint.model_dump(),
        )
        blueprint_markdown_path = write_text_file(
            output_dir,
            PRACTICE_BLUEPRINT_MARKDOWN_PATH,
            render_practice_blueprint_markdown(request, practice_blueprint),
        )
        blueprint_files = [str(blueprint_json_path), str(blueprint_markdown_path)]

        _emit_event(
            event_callback,
            event=event_name,
            node=node_name,
            phase="practice_planning",
            agent_name="practice",
            summary=summary,
            data={
                "practice_blueprint": practice_blueprint.model_dump(),
                "files": blueprint_files,
                "notes": practice_blueprint_notes,
            },
        )
        return {
            "practice_blueprint": practice_blueprint.model_dump(),
            "practice_blueprint_files": blueprint_files,
            "practice_blueprint_notes": practice_blueprint_notes,
        }

    def make_agent_node(spec: AgentSpec) -> Callable[[WorkflowState], dict[str, Any]]:
        def agent_node(state: WorkflowState) -> dict[str, Any]:
            request = GenerationRequest.model_validate(state["request"])
            plan = PreparationPlan.model_validate(state["plan"])
            output_dir = Path(state["output_dir"])
            route = _get_route(plan, spec.agent_name)
            node_name = f"{spec.agent_name}_agent"
            practice_blueprint: PracticeBlueprint | None = None
            manim_validation_notes: list[str] = []
            practice_blueprint_files = (
                list(state.get("practice_blueprint_files", []))
                if spec.agent_name == "practice"
                else []
            )
            practice_notes = (
                list(state.get("practice_blueprint_notes", []))
                if spec.agent_name == "practice"
                else []
            )

            _emit_event(
                event_callback,
                event="node_started",
                node=node_name,
                phase="artifact_generation",
                agent_name=spec.agent_name,
                summary=f"{spec.title} started.",
                data={
                    "title": spec.title,
                    "objective": route.objective,
                    "deliverables": route.deliverables,
                },
            )

            if not route.selected:
                skipped_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/SKIPPED.md",
                    f"# {spec.title}\n\n该 Agent 被总控规划判定为本轮无需执行。\n",
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="该 Agent 被总控规划跳过。",
                    output_dir=str(output_dir / spec.folder),
                    files=[str(skipped_path)],
                    status="skipped",
                )
                _emit_event(
                    event_callback,
                    event="artifact_skipped",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} skipped by planner.",
                    data={"artifact": artifact.model_dump()},
                )
                return {"artifact_results": [artifact.model_dump()]}

            try:
                if spec.agent_name == "practice":
                    practice_blueprint_payload = state.get("practice_blueprint")
                    if not isinstance(practice_blueprint_payload, dict):
                        raise ValueError("Missing practice blueprint for practice agent.")
                    practice_blueprint = PracticeBlueprint.model_validate(
                        practice_blueprint_payload
                    )
                    system_prompt, user_prompt = spec.prompt_builder(
                        request,
                        plan,
                        practice_blueprint,
                    )
                    bundle = llm.invoke_bundle(
                        system_prompt,
                        user_prompt,
                        spec.required_files,
                    )
                else:
                    if spec.agent_name == "manim":
                        bundle, manim_validation_notes = generate_manim_bundle_with_repair(
                            request,
                            plan,
                            run_id=output_dir.name,
                            required_files=spec.required_files,
                            node_name=node_name,
                        )
                    else:
                        system_prompt, user_prompt = spec.prompt_builder(request, plan)
                        bundle = llm.invoke_bundle(
                            system_prompt,
                            user_prompt,
                            spec.required_files,
                        )
                raw_files = bundle.files
                _validate_generated_files(
                    raw_files,
                    practice_blueprint=practice_blueprint,
                    require_generated_ids=spec.agent_name != "practice",
                )
                finalized_files = (
                    _finalize_practice_files(raw_files, run_id=output_dir.name)
                    if spec.agent_name == "practice"
                    else raw_files
                )
                _validate_generated_files(
                    finalized_files,
                    practice_blueprint=practice_blueprint,
                )
                written_files = list(practice_blueprint_files)
                for filename, content in finalized_files.items():
                    target = write_text_file(
                        output_dir,
                        f"{spec.folder}/{filename}",
                        content,
                    )
                    written_files.append(str(target))

                if spec.agent_name == "manim":
                    render_command, rendered_video_files = _render_manim_artifact(
                        output_dir / spec.folder
                    )
                    manim_validation_notes = [
                        *manim_validation_notes,
                        f"Manim 最终视频已渲染：{render_command}",
                    ]
                    written_files.extend(rendered_video_files)

                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary=bundle.summary,
                    output_dir=str(output_dir / spec.folder),
                    files=written_files,
                    notes=(
                        [*practice_notes, *manim_validation_notes]
                        if spec.agent_name == "manim"
                        else practice_notes
                    ),
                )
                _emit_event(
                    event_callback,
                    event="artifact_ready",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} generated successfully.",
                    data={"artifact": artifact.model_dump()},
                )
            except Exception as exc:
                failed_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/FAILED.md",
                    f"# {spec.title}\n\n生成失败。\n\n```\n{exc}\n```\n",
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="该 Agent 生成失败。",
                    output_dir=str(output_dir / spec.folder),
                    files=[*practice_blueprint_files, str(failed_path)],
                    notes=[*practice_notes, str(exc)],
                    status="failed",
                )
                _emit_event(
                    event_callback,
                    event="artifact_failed",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} failed during generation.",
                    data={
                        "artifact": artifact.model_dump(),
                        "error": str(exc),
                    },
                )

            return {"artifact_results": [artifact.model_dump()]}

        return agent_node

    def report_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        plan = PreparationPlan.model_validate(state["plan"])
        output_dir = Path(state["output_dir"])
        node_name = "supervisor_report"
        artifacts = [
            ArtifactResult.model_validate(item)
            for item in state.get("artifact_results", [])
        ]
        artifacts.sort(key=lambda artifact: agent_order.index(artifact.agent_name))

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="reporting",
            summary="Supervisor report node started.",
            data={"artifact_count": len(artifacts)},
        )

        manifest_path = write_json_file(
            output_dir,
            "00_supervisor/artifact_manifest.json",
            {"artifacts": [artifact.model_dump() for artifact in artifacts]},
        )
        _emit_event(
            event_callback,
            event="manifest_ready",
            node=node_name,
            phase="reporting",
            summary="Artifact manifest written.",
            data={"manifest_path": str(manifest_path)},
        )

        try:
            system_prompt, user_prompt = build_report_prompts(
                request,
                plan,
                artifacts,
                str(output_dir),
            )
            report_markdown = llm.invoke_text(system_prompt, user_prompt)
        except Exception:
            report_markdown = render_fallback_report(request, plan, artifacts, output_dir)

        report_path = write_text_file(
            output_dir,
            "00_supervisor/final_report.md",
            report_markdown,
        )
        _emit_event(
            event_callback,
            event="report_ready",
            node=node_name,
            phase="reporting",
            summary="Supervisor report generated.",
            data={"report_path": str(report_path)},
        )
        return {
            "report_path": str(report_path),
            "plan_path": state.get("plan_path", ""),
            "manifest_path": str(manifest_path),
        }

    graph = StateGraph(WorkflowState)
    graph.add_node("planner", planner_node)
    graph.add_node("practice_planner_agent", practice_planner_node)

    artifact_node_names: list[str] = []
    for spec in AGENT_SPECS:
        node_name = f"{spec.agent_name}_agent"
        artifact_node_names.append(node_name)
        graph.add_node(node_name, make_agent_node(spec))

    graph.add_node("supervisor_report", report_node)

    graph.add_edge(START, "planner")
    for spec in AGENT_SPECS:
        node_name = f"{spec.agent_name}_agent"
        if spec.agent_name == "practice":
            continue
        graph.add_edge("planner", node_name)
    graph.add_edge("planner", "practice_planner_agent")
    graph.add_edge("practice_planner_agent", "practice_agent")
    graph.add_edge(artifact_node_names, "supervisor_report")
    graph.add_edge("supervisor_report", END)

    return graph.compile()
