from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from operator import add
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from typing import Annotated, Any, Callable, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import TypeAdapter

from .config import Settings
from .file_io import (
    render_fallback_report,
    render_plan_markdown,
    render_practice_blueprint_markdown,
    write_json_file,
    write_text_file,
)
from .llm import BundleParseError, LLMClient
from .models import (
    AgentName,
    AgentRoute,
    ArtifactResult,
    GenerationRequest,
    PracticeBlueprint,
    PracticePackage,
    PracticeQuestion,
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
MANIM_VALIDATION_TIMEOUT_SECONDS = 180
MANIM_VALIDATION_OUTPUT_CHAR_LIMIT = 6000
MANIM_ARTIFACT_RENDER_TIMEOUT_SECONDS = 240
MARKDOWN_MATH_SPAN_PATTERN = re.compile(r"\$\$.*?\$\$|\$[^$\n]+\$", re.S)
LATEX_COMMAND_PATTERN = re.compile(r"\\[A-Za-z]+")
PRACTICE_MATH_TEXT_FIELDS = {
    "question",
    "analysis",
    "answer",
    "options",
    "correct_answer",
    "reference_answer",
    "answer_key_markdown",
}


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


def _remove_markdown_math_spans(text: str) -> str:
    return MARKDOWN_MATH_SPAN_PATTERN.sub("", text)


def _validate_practice_math_markup(package: PracticePackage) -> None:
    def check_text(label: str, value: str) -> None:
        outside_math = _remove_markdown_math_spans(value)
        match = LATEX_COMMAND_PATTERN.search(outside_math)
        if match:
            raise ValueError(
                "Practice formula markup invalid: "
                f"{label} contains bare LaTeX command `{match.group(0)}`. "
                "Wrap formulas with `$...$` for inline math or `$$...$$` for display math."
            )

    for index, question in enumerate(package.questions, start=1):
        payload = question.model_dump()
        for field_name in PRACTICE_MATH_TEXT_FIELDS:
            value = payload.get(field_name)
            if isinstance(value, str):
                check_text(f"questions[{index}].{field_name}", value)
            elif isinstance(value, list):
                for item_index, item in enumerate(value, start=1):
                    if isinstance(item, str):
                        check_text(
                            f"questions[{index}].{field_name}[{item_index}]",
                            item,
                        )

    check_text("answer_key_markdown", package.answer_key_markdown)


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


AI_JUDGE_DEFAULTS: dict[str, bool] = {
    "FillInTheBlank": False,
    "MultipleChoice": False,
    "ShortAnswer": True,
    "Listening": False,
    "Coding": True,
    "Drawing": True,
}


def _resolve_need_ai_judge(item: dict[str, Any]) -> bool:
    if isinstance(item.get("need_ai_judge"), bool):
        return bool(item["need_ai_judge"])
    if isinstance(item.get("requires_ai_judgment"), bool):
        return bool(item["requires_ai_judgment"])
    question_type = str(item.get("question_type", "")).strip()
    return AI_JUDGE_DEFAULTS.get(question_type, False)


def _strip_choice_answer_prefix(value: str) -> str:
    return re.sub(r"^(?:正确答案|答案)\s*[:：]?\s*", "", value.strip()).strip()


def _extract_choice_label(value: str) -> str | None:
    text = _strip_choice_answer_prefix(value)
    standalone_match = re.fullmatch(
        r"[（(]?\s*(?:选项?|选择)?\s*([A-Za-z])\s*[）)]?",
        text,
    )
    if standalone_match:
        return standalone_match.group(1).upper()

    prefixed_match = re.match(
        r"^[（(]?\s*(?:选项?|选择)?\s*([A-Za-z])\s*[）)]?\s*[.．、:：\-\s]",
        text,
    )
    return prefixed_match.group(1).upper() if prefixed_match else None


def _normalize_choice_text(value: str) -> str:
    text = _strip_choice_answer_prefix(value)
    text = re.sub(
        r"^[（(]?\s*(?:选项?|选择)?\s*[A-Za-z]\s*[）)]?\s*[.．、:：\-\s]\s*",
        "",
        text,
        count=1,
    )
    return " ".join(text.lower().split())


def _normalize_multiple_choice_answer(item: dict[str, Any]) -> None:
    if item.get("question_type") != "MultipleChoice":
        return
    options = item.get("options")
    correct_answer = item.get("correct_answer")
    if not isinstance(options, list) or not isinstance(correct_answer, str):
        return

    string_options = [option for option in options if isinstance(option, str)]
    answer_label = _extract_choice_label(correct_answer)
    if answer_label is not None:
        option_index = ord(answer_label) - ord("A")
        if 0 <= option_index < len(string_options):
            item["correct_answer"] = string_options[option_index]
            return

    normalized_answer = _normalize_choice_text(correct_answer)
    for option in string_options:
        if _normalize_choice_text(option) == normalized_answer:
            item["correct_answer"] = option
            return


def _normalize_practice_question(item: dict[str, Any]) -> dict[str, Any]:
    normalized_item = {
        key: value
        for key, value in item.items()
        if key not in {"id", "question_id", "requires_ai_judgment"}
    }
    _normalize_multiple_choice_answer(normalized_item)
    normalized_item["need_ai_judge"] = _resolve_need_ai_judge(item)
    if isinstance(normalized_item.get("skill_tags"), list):
        normalized_item["skill_tags"] = [
            str(tag).strip()
            for tag in normalized_item["skill_tags"]
            if str(tag).strip()
        ]
    if isinstance(normalized_item.get("difficulty"), (int, float)):
        normalized_item["difficulty"] = round(
            max(0.0, min(1.0, float(normalized_item["difficulty"]))),
            4,
        )
    return normalized_item


def _find_manim_validation_command() -> list[str] | None:
    manim_cli = shutil.which("manim")
    if manim_cli:
        return [manim_cli]
    if importlib.util.find_spec("manim") is not None:
        return [sys.executable, "-m", "manim"]
    return None


def _has_manim_dependency() -> bool:
    return _find_manim_validation_command() is not None


def _resolve_manim_validation_command() -> list[str]:
    command = _find_manim_validation_command()
    if command is not None:
        return command
    raise RuntimeError(
        "Manim dependency is unavailable in the current environment. "
        "Install the `manim` package before enabling the Manim agent."
    )


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

        normalized_item = _normalize_practice_question(item)
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
                if "need_ai_judge" in item and not isinstance(
                    item.get("need_ai_judge"), bool
                ):
                    raise ValueError(
                        f"practice_questions.json item {index} has invalid "
                        "need_ai_judge; expected boolean."
                    )
                if "requires_ai_judgment" in item and not isinstance(
                    item.get("requires_ai_judgment"), bool
                ):
                    raise ValueError(
                        f"practice_questions.json item {index} has invalid "
                        "requires_ai_judgment; expected boolean."
                    )
                if "skill_tags" in item:
                    skill_tags = item.get("skill_tags")
                    if not isinstance(skill_tags, list) or not all(
                        isinstance(tag, str) for tag in skill_tags
                    ):
                        raise ValueError(
                            f"practice_questions.json item {index} has invalid "
                            "skill_tags; expected list[str]."
                        )
                if "difficulty" in item:
                    difficulty = item.get("difficulty")
                    if difficulty is not None and not isinstance(difficulty, (int, float)):
                        raise ValueError(
                            f"practice_questions.json item {index} has invalid "
                            "difficulty; expected number."
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

    def generate_manim_bundle_once(
        request: GenerationRequest,
        plan: PreparationPlan,
        *,
        required_files: tuple[str, ...],
        node_name: str,
    ):
        system_prompt, user_prompt = build_manim_prompts(request, plan)
        bundle = llm.invoke_bundle(
            system_prompt,
            user_prompt,
            required_files,
            max_attempts=1,
        )
        _emit_event(
            event_callback,
            event="artifact_validation_started",
            node=node_name,
            phase="artifact_validation",
            agent_name="manim",
            summary="开始校验 Manim 动画脚本。",
            data={"attempt": 1, "max_attempts": 1},
        )

        try:
            _validate_generated_files(bundle.files)
            validation_command = _validate_manim_bundle_runtime(bundle.files)
        except Exception as exc:
            _emit_event(
                event_callback,
                event="artifact_validation_failed",
                node=node_name,
                phase="artifact_validation",
                agent_name="manim",
                summary="Manim 动画脚本校验失败。",
                data={"attempt": 1, "error": str(exc)},
            )
            raise

        _emit_event(
            event_callback,
            event="artifact_validation_passed",
            node=node_name,
            phase="artifact_validation",
            agent_name="manim",
            summary="Manim 动画脚本校验通过。",
            data={"attempt": 1, "command": validation_command},
        )
        return bundle, [f"Manim 运行校验已通过：{validation_command}"]

    def planner_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        output_dir = Path(state["output_dir"])
        node_name = "planner"

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="planning",
            summary="开始生成课前准备总控规划。",
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
            summary="课前准备总控规划已生成。",
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
            summary="开始规划练习题型与题量。",
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
                summary="练习题型规划已跳过：本轮未启用练习 Agent。",
            )
            return {}

        practice_blueprint_notes: list[str] = []
        try:
            system_prompt, user_prompt = build_practice_planner_prompts(request, plan)
            practice_blueprint = _normalize_practice_blueprint(
                llm.invoke_json(system_prompt, user_prompt, PracticeBlueprint)
            )
            event_name = "practice_blueprint_ready"
            summary = "练习题型蓝图已生成。"
        except Exception as exc:
            practice_blueprint = _build_fallback_practice_blueprint(request, plan, route)
            practice_blueprint_notes = [f"题型规划 Agent 回退到规则蓝图：{exc}"]
            event_name = "practice_blueprint_fallback"
            summary = "练习题型蓝图已由规则回退生成。"

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

            if spec.agent_name == "manim" and route.selected and not _has_manim_dependency():
                skipped_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/SKIPPED.md",
                    (
                        f"# {spec.title}\n\n"
                        "未检测到 Manim 依赖包，本轮未启动 Manim 智能体。\n\n"
                        "请先安装 `manim` 后再重新发起任务。\n"
                    ),
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="未检测到 Manim 依赖包，未启动该 Agent。",
                    output_dir=str(output_dir / spec.folder),
                    files=[str(skipped_path)],
                    notes=["当前环境缺少 Manim 依赖包。"],
                    status="skipped",
                )
                _emit_event(
                    event_callback,
                    event="artifact_skipped",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary="Manim Agent 已跳过：当前环境缺少 Manim 依赖。",
                    data={"artifact": artifact.model_dump()},
                )
                return {"artifact_results": [artifact.model_dump()]}

            _emit_event(
                event_callback,
                event="node_started",
                node=node_name,
                phase="artifact_generation",
                agent_name=spec.agent_name,
                summary=f"{spec.title} 开始生成。",
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
                    summary=f"{spec.title} 已按总控规划跳过。",
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
                    feedback = ""
                    last_practice_error: Exception | None = None
                    for attempt_index in range(1, 4):
                        try:
                            package = llm.invoke_json(
                                system_prompt,
                                user_prompt + feedback,
                                PracticePackage,
                            )
                            _validate_practice_math_markup(package)
                            questions_json = TypeAdapter(
                                list[PracticeQuestion]
                            ).dump_json(
                                package.questions,
                                exclude_none=True,
                                indent=2,
                            ).decode("utf-8")
                            raw_files = {
                                "practice_questions.json": questions_json + "\n",
                                "answer_key.md": package.answer_key_markdown,
                            }
                            _validate_generated_files(
                                raw_files,
                                practice_blueprint=practice_blueprint,
                                require_generated_ids=False,
                            )
                            bundle_summary = package.summary
                            break
                        except Exception as exc:
                            last_practice_error = exc
                            feedback = (
                                "\n\nYour previous structured practice package failed "
                                f"validation on attempt {attempt_index}. Error: {exc}\n"
                                "Return the full JSON object again. Keep the exact "
                                "question count and question_type distribution required "
                                "by the practice blueprint. Wrap every formula with "
                                "`$...$` for inline math or `$$...$$` for display math."
                            )
                    else:
                        raise RuntimeError(
                            f"Failed to generate valid structured practice package: {last_practice_error}"
                        ) from last_practice_error
                else:
                    if spec.agent_name == "manim":
                        bundle, manim_validation_notes = generate_manim_bundle_once(
                            request,
                            plan,
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
                    bundle_summary = bundle.summary
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
                    summary=bundle_summary,
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
                    summary=f"{spec.title} 已生成。",
                    data={"artifact": artifact.model_dump()},
                )
            except Exception as exc:
                debug_files: list[str] = []
                if isinstance(exc, BundleParseError):
                    for attempt_index, raw_output in enumerate(exc.raw_outputs, start=1):
                        debug_path = write_text_file(
                            output_dir,
                            f"{spec.folder}/raw_model_output_attempt_{attempt_index}.txt",
                            raw_output,
                        )
                        debug_files.append(str(debug_path))

                failed_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/FAILED.md",
                    "\n\n".join(
                        [
                            f"# {spec.title}",
                            "生成失败。",
                            "```",
                            str(exc),
                            "```",
                            *(
                                [
                                    "已保存模型原始输出，便于排查格式问题。",
                                    *[
                                        f"- {debug_file}"
                                        for debug_file in debug_files
                                    ],
                                ]
                                if debug_files
                                else []
                            ),
                        ]
                    )
                    + "\n",
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="该 Agent 生成失败。",
                    output_dir=str(output_dir / spec.folder),
                    files=[*practice_blueprint_files, str(failed_path), *debug_files],
                    notes=[*practice_notes, str(exc)],
                    status="failed",
                )
                _emit_event(
                    event_callback,
                    event="artifact_failed",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} 生成失败。",
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
            summary="开始生成课前准备总结报告。",
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
            summary="产物清单已写入。",
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
            summary="课前准备总结报告已生成。",
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
