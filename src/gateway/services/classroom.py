from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from html import unescape
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from classroom.graph import GraphEventCallback, build_graph
from classroom.parser import ScriptParseError, parse_script
from classroom.state import PageBlueprint

from edu_multi_agent.models import ArtifactResult, GenerationRequest
from edu_multi_agent.llm import LLMClient

from ..schemas.classroom import (
    ClassroomChapterSummariesResponse,
    ClassroomGenerateRequest,
    ClassroomGenerateResponse,
    ClassroomParseScriptResponse,
)
from ..schemas.prep_runs import RunStatus
from .image_assets import (
    build_commons_image_assets_for_request,
    build_image_media_resources,
)

OutlineNode = Callable[[Mapping[str, Any]], Mapping[str, Any]]

TEXTUAL_MATERIAL_SUFFIXES = {".md", ".txt", ".json", ".py", ".html"}
MAX_CLASSROOM_MATERIAL_COUNT = 16
MAX_CLASSROOM_MATERIAL_CHARS = 28_000
MAX_CLASSROOM_FILE_CHARS = 3_600
MAX_STORYBOARD_MATERIAL_FOCUS = 4
MAX_SUMMARY_CHAPTER_SOURCE_CHARS = 3_200
PREFERRED_CLASSROOM_FILE_NAMES = {
    "preparation_plan.md": 0,
    "study_guide.md": 1,
    "teacher_notes.md": 2,
    "practice_blueprint.md": 3,
    "answer_key.md": 4,
    "render_guide.md": 5,
    "usage_notes.md": 6,
    "practice_questions.json": 7,
    "lesson_animation.py": 8,
    "index.html": 9,
    "final_report.md": 10,
}


def run_classroom_workflow(
    payload: ClassroomGenerateRequest,
    llm_client: LLMClient,
    outline_agent: Any | None = None,
    *,
    event_callback: GraphEventCallback | None = None,
) -> ClassroomGenerateResponse:
    """Run the classroom LangGraph workflow and normalize the response for the API."""

    outline_node, outline_source = resolve_outline_node(
        inline_outline=payload.outline,
        outline_agent=outline_agent,
    )

    try:
        graph = build_graph(
            outline_agent=outline_node,
            llm=llm_client.model,
            slide_prompt_file=payload.slide_prompt_file,
            event_callback=event_callback,
        )
        result = graph.invoke(
            {
                "topic": payload.topic,
                "materials": payload.materials,
                "media_resources": payload.media_resources,
            }
        )
    except ScriptParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"生成的课堂讲稿不符合解析规则：{exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_generate_response(
        result,
        topic=payload.topic,
        materials=payload.materials,
        outline_source=outline_source,
    )


def run_question_slide_workflow(
    payload: ClassroomGenerateRequest,
    llm_client: LLMClient,
    outline_agent: Any | None = None,
    *,
    event_callback: GraphEventCallback | None = None,
) -> ClassroomGenerateResponse:
    """Run the classroom workflow with a deterministic one-page question plan."""

    outline_node, outline_source = resolve_outline_node(
        inline_outline=payload.outline,
        outline_agent=outline_agent,
    )

    try:
        graph = build_graph(
            outline_agent=outline_node,
            page_plan_agent=_question_slide_page_plan_node,
            llm=llm_client.model,
            slide_prompt_file=payload.slide_prompt_file,
            event_callback=event_callback,
        )
        result = graph.invoke(
            {
                "topic": payload.topic,
                "materials": payload.materials,
                "media_resources": payload.media_resources,
            }
        )
    except ScriptParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"生成的课堂讲稿不符合解析规则：{exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_generate_response(
        result,
        topic=payload.topic,
        materials=payload.materials,
        outline_source=outline_source,
    )


def generate_classroom_bundle(
    payload: ClassroomGenerateRequest,
    llm_client: LLMClient,
    outline_agent: Any | None = None,
) -> ClassroomGenerateResponse:
    """Backward-compatible synchronous classroom generation helper."""

    return run_classroom_workflow(payload, llm_client, outline_agent)


def parse_classroom_script(script: str) -> ClassroomParseScriptResponse:
    """Parse a tagged classroom script into page specifications."""

    try:
        pages = parse_script(script)
    except ScriptParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ClassroomParseScriptResponse(page_count=len(pages), pages=pages)


def build_classroom_chapter_summaries(
    payload: Mapping[str, Any],
    llm_client: LLMClient,
) -> ClassroomChapterSummariesResponse:
    """Summarize each classroom page from narration and rendered HTML content."""

    page_blueprints = payload.get("page_blueprints")
    pages = payload.get("pages")
    bundle = payload.get("bundle") if isinstance(payload.get("bundle"), Mapping) else {}
    bundle_pages = bundle.get("pages") if isinstance(bundle, Mapping) else None

    if not isinstance(pages, list) or not isinstance(bundle_pages, list):
        raise HTTPException(status_code=422, detail="Classroom result is missing page content.")

    blueprint_by_idx = {
        int(item.get("idx", index)): item
        for index, item in enumerate(page_blueprints)
        if isinstance(item, Mapping)
    } if isinstance(page_blueprints, list) else {}
    bundle_by_idx = {
        int(item.get("idx", index)): item
        for index, item in enumerate(bundle_pages)
        if isinstance(item, Mapping)
    }

    chapters: list[dict[str, Any]] = []
    for index, page in enumerate(pages):
        if not isinstance(page, Mapping):
            continue
        idx = int(page.get("idx", index))
        blueprint = blueprint_by_idx.get(idx, {})
        bundle_page = bundle_by_idx.get(idx, {})
        title = str(blueprint.get("theme") or f"第 {idx + 1} 章").strip()
        narration = "\n".join(
            _clean_transcript_text(str(reveal.get("narration") or ""))
            for reveal in page.get("reveals", [])
            if isinstance(reveal, Mapping)
        )
        html_text = _clean_transcript_text(_html_to_compact_text(str(bundle_page.get("html") or "")))
        source = f"【文稿】\n{narration}\n\n【HTML 页面内容】\n{html_text}".strip()
        chapters.append({
            "idx": idx,
            "title": title,
            "source": source[:MAX_SUMMARY_CHAPTER_SOURCE_CHARS],
        })

    if not chapters:
        raise HTTPException(status_code=422, detail="Classroom result has no summarizable chapters.")

    system_prompt = (
        "你是善于整理课堂笔记的中文助教。请把每个章节的口播文稿和 HTML 页面内容综合成一段前端可直接展示的总结。"
        "要求：每章只写一段，80-140 个中文字符，保留关键概念、推理线索、例题或页面中的重要结论。"
        "不要写 Markdown，不要编造材料中没有的信息。"
    )
    user_prompt = json.dumps(
        {
            "topic": payload.get("topic"),
            "chapters": chapters,
            "output_contract": {
                "chapters": [
                    {"idx": "number", "title": "string", "summary": "string"}
                ]
            },
        },
        ensure_ascii=False,
    )
    return llm_client.invoke_json(
        system_prompt,
        user_prompt,
        ClassroomChapterSummariesResponse,
    )


def build_classroom_request_from_prep_view(
    view: Mapping[str, Any],
    *,
    slide_prompt_file: str = "slide.md",
) -> ClassroomGenerateRequest:
    """Build a classroom-generation request from a completed prep-run view."""

    run_id = str(view.get("run_id") or "").strip()
    if not run_id:
        raise HTTPException(status_code=422, detail="Prep run view is missing run_id.")

    status = view.get("status")
    if status != RunStatus.succeeded:
        raise HTTPException(
            status_code=409,
            detail="课前任务尚未完成，暂时不能开始准备课中内容。",
        )

    request = _coerce_generation_request(view.get("request"))
    if request is None:
        raise HTTPException(
            status_code=422,
            detail="课前任务缺少原始请求，无法组装课中生成参数。",
        )

    output_dir_raw = view.get("output_dir")
    if not isinstance(output_dir_raw, str) or not output_dir_raw.strip():
        raise HTTPException(status_code=422, detail="Prep run view is missing output_dir.")
    output_dir = Path(output_dir_raw)

    plan = view.get("plan") if isinstance(view.get("plan"), dict) else {}
    artifacts = _coerce_artifacts(view.get("artifacts"))
    materials = _build_classroom_materials(
        request=request,
        plan=plan,
        artifacts=artifacts,
        output_dir=output_dir,
        plan_path=view.get("plan_path"),
        report_path=view.get("report_path"),
    )
    media_resources = _build_classroom_media_resources(
        artifacts=artifacts,
        output_dir=output_dir,
    )
    image_assets = build_commons_image_assets_for_request(request, output_dir)
    media_resources.extend(build_image_media_resources(image_assets))
    outline = _build_classroom_outline(
        prep_run_id=run_id,
        request=request,
        plan=plan,
        artifacts=artifacts,
        output_dir=output_dir,
        media_resources=media_resources,
    )

    try:
        return ClassroomGenerateRequest(
            topic=request.learning_goal,
            materials=materials,
            outline=outline,
            media_resources=media_resources,
            source_prep_run_id=run_id,
            slide_prompt_file=slide_prompt_file,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def build_question_classroom_request_from_prep_view(
    view: Mapping[str, Any],
    *,
    question_id: str,
    slide_prompt_file: str = "slide.md",
) -> ClassroomGenerateRequest:
    """Build a one-slide classroom request for a single generated practice question."""

    run_id = str(view.get("run_id") or "").strip()
    if not run_id:
        raise HTTPException(status_code=422, detail="Prep run view is missing run_id.")

    status = view.get("status")
    if status != RunStatus.succeeded:
        raise HTTPException(
            status_code=409,
            detail="课前任务尚未完成，暂时不能生成单题讲解。",
        )

    request = _coerce_generation_request(view.get("request"))
    if request is None:
        raise HTTPException(
            status_code=422,
            detail="课前任务缺少原始请求，无法组装单题讲解参数。",
        )

    output_dir_raw = view.get("output_dir")
    if not isinstance(output_dir_raw, str) or not output_dir_raw.strip():
        raise HTTPException(status_code=422, detail="Prep run view is missing output_dir.")
    output_dir = Path(output_dir_raw)

    artifacts = _coerce_artifacts(view.get("artifacts"))
    question, question_index = _find_practice_question(
        artifacts=artifacts,
        output_dir=output_dir,
        question_id=question_id,
    )
    question_title = f"第 {question_index} 题讲解"
    question_summary = _summarize_question_for_title(question)
    outline = _build_question_slide_outline(
        prep_run_id=run_id,
        request=request,
        question=question,
        question_index=question_index,
    )
    materials = [
        _format_request_material(request),
        "[单题讲解任务]\n"
        + json.dumps(
            {
                "question_index": question_index,
                "question": question,
                "teaching_goal": "用一页幻灯片完成读题、关键知识点、解题路径、答案解释和常见误区提醒。",
            },
            ensure_ascii=False,
            indent=2,
        ),
    ]

    try:
        return ClassroomGenerateRequest(
            topic=f"{question_title}：{question_summary}",
            materials=materials,
            outline=outline,
            media_resources=[],
            source_prep_run_id=run_id,
            source_mode="practice_question",
            source_question_id=question_id,
            slide_prompt_file=slide_prompt_file,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def _question_slide_page_plan_node(state: Mapping[str, Any]) -> dict[str, list[PageBlueprint]]:
    outline = state.get("outline") if isinstance(state.get("outline"), Mapping) else {}
    question = outline.get("practice_question") if isinstance(outline, Mapping) else {}
    question_index = int(outline.get("question_index") or 1) if isinstance(outline, Mapping) else 1
    skill_tags = _clean_string_list(question.get("skill_tags")) if isinstance(question, Mapping) else []
    question_text = str(question.get("question") or "").strip() if isinstance(question, Mapping) else ""
    key_points = skill_tags[:3] or ["读懂题意", "定位关键知识点", "解释答案与常见误区"]
    material_focus = [question_text[:220]] if question_text else ["当前练习题"]

    return {
        "page_blueprints": [
            {
                "idx": 0,
                "theme": f"第 {question_index} 题讲解",
                "objective": "读懂题意、定位关键知识点、解释正确思路和常见误区",
                "key_points": key_points,
                "target_reveal_count": 4,
                "quiz_goal": None,
                "source_storyboard_block_id": "practice-question",
                "material_focus": material_focus,
                "visual_plan": "题目卡 + 解题路径 + 误区对比 + 答案归纳",
                "layout_style": "quiz-diagnostic",
                "interaction_plan": "先读题圈出条件，再逐步揭示解题路径，最后对照答案和误区。",
                "suggested_media_types": [],
            }
        ]
    }


def _build_question_slide_outline(
    *,
    prep_run_id: str,
    request: GenerationRequest,
    question: dict[str, Any],
    question_index: int,
) -> dict[str, Any]:
    return {
        "source_prep_run_id": prep_run_id,
        "source_mode": "practice_question",
        "learning_goal": request.learning_goal,
        "subject": request.subject,
        "grade_level": request.grade_level,
        "learner_id": request.learner_id,
        "learner_profile": request.learner_profile,
        "notes": request.notes,
        "language": request.language,
        "graph_context": (
            request.graph_context.model_dump(mode="json")
            if request.graph_context is not None
            else None
        ),
        "question_index": question_index,
        "practice_question": question,
        "lesson_storyboard_policy": {
            "role": "单题讲解固定为一页幻灯片",
            "adaptation_required": False,
        },
    }


def _find_practice_question(
    *,
    artifacts: list[ArtifactResult],
    output_dir: Path,
    question_id: str,
) -> tuple[dict[str, Any], int]:
    normalized_question_id = question_id.strip()
    if not normalized_question_id:
        raise HTTPException(status_code=422, detail="question_id is required.")

    for artifact in artifacts:
        if artifact.agent_name != "practice":
            continue
        for raw_path in artifact.files:
            path = Path(str(raw_path))
            if path.name != "practice_questions.json":
                continue
            if not path.is_absolute():
                path = output_dir / path
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                raise HTTPException(status_code=422, detail="练习题 JSON 无法读取。") from exc
            if not isinstance(payload, list):
                raise HTTPException(status_code=422, detail="练习题 JSON 结构无效。")

            for index, item in enumerate(payload, start=1):
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or item.get("question_id") or "").strip()
                if item_id == normalized_question_id:
                    return dict(item), index

    raise HTTPException(status_code=404, detail="未找到指定练习题。")


def _summarize_question_for_title(question: Mapping[str, Any]) -> str:
    text = str(question.get("question") or question.get("prompt") or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:36] or str(question.get("question_type") or "练习题")


def build_generate_response(
    result: Mapping[str, Any],
    *,
    topic: str,
    materials: list[str],
    outline_source: str,
) -> ClassroomGenerateResponse:
    """Build the public classroom-generation response from the graph state."""

    outline = result.get("outline")
    script = result.get("script")
    page_blueprints = result.get("page_blueprints")
    pages = result.get("pages")
    bundle = result.get("assembled")

    if not isinstance(outline, dict) or not outline:
        raise HTTPException(status_code=502, detail="工作流未返回有效课堂大纲。")
    if not isinstance(script, str) or not script.strip():
        raise HTTPException(status_code=502, detail="工作流未返回有效课堂讲稿。")
    if not isinstance(page_blueprints, list) or not page_blueprints:
        raise HTTPException(status_code=502, detail="工作流未返回页面规划。")
    if not isinstance(pages, list) or not pages:
        raise HTTPException(status_code=502, detail="工作流未返回解析后的页面。")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("pages"), list):
        raise HTTPException(status_code=502, detail="工作流未返回有效播放器数据包。")

    return ClassroomGenerateResponse(
        topic=topic,
        materials=materials,
        outline_source=outline_source,
        outline=outline,
        page_blueprints=page_blueprints,
        script=script,
        page_count=len(pages),
        pages=pages,
        bundle=bundle,
    )


def resolve_outline_node(
    *,
    inline_outline: Any | None,
    outline_agent: Any | None,
) -> tuple[OutlineNode, str]:
    """Resolve the outline node used by the classroom workflow."""

    if inline_outline is not None:
        normalized_outline = normalize_outline_payload(inline_outline)
        return (lambda _state: {"outline": normalized_outline}), "request"

    if outline_agent is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "缺少课堂大纲。请提供 request.outline，或配置 "
                "app.state.classroom_outline_agent。"
            ),
        )

    if callable(outline_agent):
        return (_wrap_outline_callable(outline_agent), "server")

    invoke = getattr(outline_agent, "invoke", None)
    if callable(invoke):
        return (_wrap_outline_callable(invoke), "server")

    raise HTTPException(
        status_code=500,
        detail="已配置的 classroom_outline_agent 不可调用。",
    )


def _wrap_outline_callable(callable_outline: Callable[[Mapping[str, Any]], Any]) -> OutlineNode:
    def runner(state: Mapping[str, Any]) -> Mapping[str, Any]:
        result = callable_outline(state)
        result = _coerce_outline_agent_result(result)
        if isinstance(result, dict) and "outline" in result:
            return {
                **result,
                "outline": normalize_outline_payload(result.get("outline")),
            }
        return {"outline": normalize_outline_payload(result)}

    return runner


def normalize_outline_payload(outline: Any) -> dict[str, Any]:
    """Normalize permissive outline input into a dict for the classroom graph."""

    normalized = _normalize_outline_value(outline)
    if isinstance(normalized, dict):
        return normalized or {"raw_outline": {}}
    if isinstance(normalized, list):
        return {"raw_outline_items": normalized}
    if isinstance(normalized, str):
        return {"raw_outline_text": normalized}
    if isinstance(normalized, (int, float, bool)) or normalized is None:
        return {"raw_outline_value": normalized}
    raise HTTPException(
        status_code=422,
        detail="outline must be valid JSON-like content such as an object, string, array, or scalar.",
    )


def _coerce_outline_agent_result(result: Any) -> Any:
    if hasattr(result, "model_dump") and callable(result.model_dump):
        return result.model_dump()
    if hasattr(result, "dict") and callable(result.dict):
        return result.dict()
    return result


def _normalize_outline_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _normalize_outline_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_normalize_outline_value(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_outline_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "model_dump") and callable(value.model_dump):
        return _normalize_outline_value(value.model_dump())
    if hasattr(value, "dict") and callable(value.dict):
        return _normalize_outline_value(value.dict())
    return str(value)


def _coerce_generation_request(value: Any) -> GenerationRequest | None:
    if isinstance(value, GenerationRequest):
        return value
    if isinstance(value, Mapping):
        return GenerationRequest.model_validate(dict(value))
    return None


def _coerce_artifacts(value: Any) -> list[ArtifactResult]:
    if not isinstance(value, list):
        return []
    normalized: list[ArtifactResult] = []
    for item in value:
        if isinstance(item, ArtifactResult):
            normalized.append(item)
            continue
        if isinstance(item, Mapping):
            normalized.append(ArtifactResult.model_validate(dict(item)))
    return normalized


def _build_classroom_outline(
    *,
    prep_run_id: str,
    request: GenerationRequest,
    plan: Mapping[str, Any],
    artifacts: list[ArtifactResult],
    output_dir: Path | None = None,
    media_resources: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    practice_summary = _extract_practice_questions_summary(artifacts, output_dir)
    artifact_summaries = _build_artifact_summaries(artifacts)
    lesson_storyboard = _build_lesson_storyboard(
        request=request,
        plan=plan,
        artifacts=artifacts,
        practice_summary=practice_summary,
        media_resources=media_resources or [],
    )
    return {
        "source_prep_run_id": prep_run_id,
        "learning_goal": request.learning_goal,
        "subject": request.subject,
        "grade_level": request.grade_level,
        "learner_id": request.learner_id,
        "learner_profile": request.learner_profile,
        "notes": request.notes,
        "language": request.language,
        "plan_summary": _optional_str(plan.get("plan_summary")),
        "teaching_focus": _clean_string_list(plan.get("teaching_focus")),
        "required_materials": _clean_string_list(plan.get("required_materials")),
        "teacher_checklist": _clean_string_list(plan.get("teacher_checklist")),
        "quality_bar": _clean_string_list(plan.get("quality_bar")),
        "practice_questions_summary": practice_summary,
        "artifact_summaries": artifact_summaries,
        "lesson_storyboard_policy": {
            "role": "素材候选池，不是固定分页模板",
            "adaptation_required": True,
            "instructions": [
                "页面规划前先判断课型，再决定节奏。",
                "可以合并、跳过、重排、拆分 storyboard 素材块。",
                "计算训练、阅读讨论、实验观察、项目实践等课型应生成不同页面结构。",
            ],
        },
        "lesson_storyboard": lesson_storyboard,
    }


def _build_artifact_summaries(artifacts: list[ArtifactResult]) -> list[dict[str, Any]]:
    return [
        {
            "agent_name": artifact.agent_name,
            "title": artifact.title,
            "summary": artifact.summary,
            "status": artifact.status,
            "file_types": sorted(
                {Path(f).suffix for f in artifact.files if isinstance(f, (str, Path))}
            ),
            "has_video": any(
                Path(f).suffix.lower() == ".mp4"
                for f in artifact.files
                if isinstance(f, (str, Path))
            ),
            "has_interactive_html": any(
                Path(f).suffix.lower() == ".html"
                for f in artifact.files
                if isinstance(f, (str, Path))
            ),
        }
        for artifact in artifacts
    ]


def _build_lesson_storyboard(
    *,
    request: GenerationRequest,
    plan: Mapping[str, Any],
    artifacts: list[ArtifactResult],
    practice_summary: list[dict[str, str]] | None,
    media_resources: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Create deterministic seed blocks from prep assets.

    These blocks are a material bridge between raw prep outputs and page planning.
    They are not a fixed teaching sequence; the page planner can merge, skip,
    reorder, or reshape them to match the actual lesson type.
    """
    teaching_focus = _clean_string_list(plan.get("teaching_focus"))
    required_materials = _clean_string_list(plan.get("required_materials"))
    completed_agents = {artifact.agent_name for artifact in artifacts if artifact.status == "completed"}
    has_media = bool(media_resources)
    has_practice = bool(practice_summary)

    blocks: list[dict[str, Any]] = [
        {
            "block_id": "hook-context",
            "title": "情境引入与目标对齐",
            "teaching_purpose": f"用真实问题引出“{request.learning_goal}”，让学生知道本节课要解决什么。",
            "material_focus": _compact_storyboard_items([
                request.learning_goal,
                *teaching_focus[:2],
                *required_materials[:1],
            ]),
            "visual_plan": "用问题场景、目标地图或情境路径图建立第一屏吸引力。",
            "layout_style": "scene-map",
            "interaction_plan": "用一个低门槛观察问题让学生先预测。",
            "suggested_media_types": ["image", "diagram"],
            "source_agents": ["planner", "study_guide"] if "study_guide" in completed_agents else ["planner"],
        },
        {
            "block_id": "concept-model",
            "title": "核心概念与模型拆解",
            "teaching_purpose": "把抽象概念拆成可见结构，明确公式、条件、变量和适用边界。",
            "material_focus": _compact_storyboard_items([
                *teaching_focus,
                *required_materials[:2],
            ]),
            "visual_plan": "优先使用结构图、公式卡、对比表或流程图，而不是纯段落。",
            "layout_style": "concept-board",
            "interaction_plan": "逐步揭示概念部件，并在关键部件处暂停观察。",
            "suggested_media_types": ["diagram", "table"],
            "source_agents": ["study_guide"] if "study_guide" in completed_agents else ["planner"],
        },
        {
            "block_id": "worked-example",
            "title": "样例演示与方法迁移",
            "teaching_purpose": "选一个代表性任务完整演示从读题、建模、推理到验证的过程。",
            "material_focus": _compact_storyboard_items([
                request.learning_goal,
                *(teaching_focus[1:4] or teaching_focus[:2]),
            ]),
            "visual_plan": "用左右分栏呈现题目情境与求解步骤，必要时加入几何图或状态图。",
            "layout_style": "worked-example",
            "interaction_plan": "每揭示一步都让学生判断下一步应该选择什么工具。",
            "suggested_media_types": ["diagram", "video"] if has_media else ["diagram"],
            "source_agents": ["study_guide", "manim"] if "manim" in completed_agents else ["study_guide"],
        },
        {
            "block_id": "practice-check",
            "title": "即时检查与误区修正",
            "teaching_purpose": "复用课前练习或题型蓝图，检查学生是否真正会迁移。",
            "material_focus": _compact_storyboard_items(
                [
                    item.get("question", "")
                    for item in (practice_summary or [])[:MAX_STORYBOARD_MATERIAL_FOCUS]
                ]
            ),
            "visual_plan": "用题目卡、选项对比、错误路径提示或诊断表呈现。",
            "layout_style": "quiz-diagnostic",
            "interaction_plan": "至少安排一次课堂提问，答错后给出针对性补讲。",
            "suggested_media_types": ["question", "table"],
            "source_agents": ["practice"] if has_practice else ["planner"],
        },
        {
            "block_id": "summary-transfer",
            "title": "总结收束与迁移任务",
            "teaching_purpose": "把本节课的方法压缩成可带走的策略，并给出迁移应用方向。",
            "material_focus": _compact_storyboard_items([
                *teaching_focus[-2:],
                request.notes,
            ]),
            "visual_plan": "用路线图、清单或三栏总结收束全课。",
            "layout_style": "takeaway-roadmap",
            "interaction_plan": "让学生说出一个能迁移到新情境的判断标准。",
            "suggested_media_types": ["diagram", "checklist"],
            "source_agents": ["planner", "practice"] if has_practice else ["planner"],
        },
    ]

    if has_media:
        blocks.insert(
            3,
            {
                "block_id": "media-exploration",
                "title": "素材观察与互动探究",
                "teaching_purpose": "把课前生成的视频、交互网页或图像嵌入到最适合观察和操作的页面。",
                "material_focus": _compact_storyboard_items(
                    [resource.get("description", "") for resource in media_resources]
                ),
                "visual_plan": "把本地媒体作为主视觉，再配一组观察问题和结论栏。",
                "layout_style": "media-lab",
                "interaction_plan": "播放、拖动或观察素材后，再推进到解释和规律总结。",
                "suggested_media_types": sorted(
                    {
                        resource.get("resource_type", "")
                        for resource in media_resources
                        if resource.get("resource_type")
                    }
                ),
                "source_agents": sorted(
                    {
                        resource.get("source_agent", "")
                        for resource in media_resources
                        if resource.get("source_agent")
                    }
                ),
            },
        )

    return blocks


def _compact_storyboard_items(items: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw_item in items:
        item = str(raw_item or "").strip()
        if not item or item == "None" or item in seen:
            continue
        cleaned.append(item[:220])
        seen.add(item)
        if len(cleaned) >= MAX_STORYBOARD_MATERIAL_FOCUS:
            break
    return cleaned


def _html_to_compact_text(html: str) -> str:
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_transcript_text(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"</?(?:on_slide|question|false_intro)>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*(?:to_next|to_next_page|pause)\s*/?\s*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\[\s*(?:to_next|to_next_page|pause|to\s+next|next)\s*\]",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b(?:to_next|to_next_page|to\s+next)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~]{1,3}", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _build_classroom_materials(
    *,
    request: GenerationRequest,
    plan: Mapping[str, Any],
    artifacts: list[ArtifactResult],
    output_dir: Path,
    plan_path: Any = None,
    report_path: Any = None,
) -> list[str]:
    materials: list[str] = []
    total_chars = 0

    def push(entry: str | None) -> None:
        nonlocal total_chars
        if not entry:
            return
        cleaned = entry.strip()
        if not cleaned:
            return
        if cleaned in materials:
            return
        if len(materials) >= MAX_CLASSROOM_MATERIAL_COUNT:
            return
        remaining = MAX_CLASSROOM_MATERIAL_CHARS - total_chars
        if remaining <= 120:
            return
        if len(cleaned) > remaining:
            cleaned = f"{cleaned[: max(0, remaining - 1)].rstrip()}…"
        materials.append(cleaned)
        total_chars += len(cleaned)

    push(_format_request_material(request))
    push(_format_plan_material(plan))
    for artifact in artifacts:
        push(_format_artifact_material(artifact))

    for file_path, label in _iter_preferred_material_files(
        output_dir=output_dir,
        artifacts=artifacts,
        plan_path=plan_path,
        report_path=report_path,
    ):
        if len(materials) >= MAX_CLASSROOM_MATERIAL_COUNT:
            break

        remaining = MAX_CLASSROOM_MATERIAL_CHARS - total_chars
        if remaining <= 400:
            break

        snippet = _read_material_file_snippet(
            file_path,
            max_chars=min(MAX_CLASSROOM_FILE_CHARS, remaining - 80),
        )
        if not snippet:
            continue

        relative_label = file_path.name
        try:
            relative_label = file_path.resolve().relative_to(output_dir.resolve()).as_posix()
        except Exception:
            pass
        push(f"[{label} | {relative_label}]\n{snippet}")

    return materials


def _format_request_material(request: GenerationRequest) -> str:
    return "\n".join(
        [
            "[课前任务请求]",
            f"学习目标：{request.learning_goal}",
            f"学科：{request.subject}",
            f"学段：{request.grade_level}",
            f"学习者：{request.learner_id or '（未提供 learner_id）'}",
            f"学情：{request.learner_profile}",
            f"备注：{request.notes}",
        ]
    )


def _format_plan_material(plan: Mapping[str, Any]) -> str | None:
    parts: list[str] = ["[课前总控规划]"]
    summary = _optional_str(plan.get("plan_summary"))
    if summary:
        parts.append(f"计划摘要：{summary}")

    sections = [
        ("教学重点", _clean_string_list(plan.get("teaching_focus"))),
        ("必备材料", _clean_string_list(plan.get("required_materials"))),
        ("教师检查项", _clean_string_list(plan.get("teacher_checklist"))),
        ("质量要求", _clean_string_list(plan.get("quality_bar"))),
    ]
    for title, items in sections:
        if not items:
            continue
        parts.append(f"{title}：")
        parts.extend(f"- {item}" for item in items)

    return "\n".join(parts) if len(parts) > 1 else None


def _format_artifact_material(artifact: ArtifactResult) -> str:
    lines = [
        f"[{artifact.title}]",
        f"摘要：{artifact.summary}",
    ]
    notes = [note.strip() for note in artifact.notes if isinstance(note, str) and note.strip()]
    if notes:
        lines.append("补充说明：")
        lines.extend(f"- {note}" for note in notes[:3])
    return "\n".join(lines)


def _iter_preferred_material_files(
    *,
    output_dir: Path,
    artifacts: list[ArtifactResult],
    plan_path: Any,
    report_path: Any,
) -> list[tuple[Path, str]]:
    candidates: list[tuple[Path, str]] = []
    seen: set[Path] = set()

    def add_candidate(raw_path: Any, label: str) -> None:
        if not raw_path:
            return
        path = Path(str(raw_path))
        if not path.is_absolute():
            path = output_dir / path
        try:
            resolved = path.resolve()
        except Exception:
            return
        if resolved in seen or not resolved.is_file():
            return
        if resolved.suffix.lower() not in TEXTUAL_MATERIAL_SUFFIXES:
            return
        seen.add(resolved)
        candidates.append((resolved, label))

    add_candidate(plan_path, "总控规划")
    add_candidate(report_path, "总结报告")

    for artifact in artifacts:
        for raw_path in artifact.files:
            add_candidate(raw_path, artifact.title)

    candidates.sort(
        key=lambda item: (
            PREFERRED_CLASSROOM_FILE_NAMES.get(item[0].name.lower(), 99),
            item[1],
            item[0].name.lower(),
        )
    )
    return candidates


def _read_material_file_snippet(path: Path, *, max_chars: int) -> str | None:
    if max_chars <= 0:
        return None
    try:
        raw_text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw_text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None

    text = raw_text.strip()
    if not text:
        return None

    if path.suffix.lower() == ".json":
        try:
            parsed = json.loads(text)
            text = json.dumps(parsed, ensure_ascii=False, indent=2)
        except Exception:
            pass

    if len(text) <= max_chars:
        return text

    if path.suffix.lower() == ".md":
        smart = _smart_truncate_markdown(text, max_chars)
        if smart:
            return smart

    return f"{text[:max_chars].rstrip()}…"


def _smart_truncate_markdown(text: str, max_chars: int) -> str | None:
    """Extract headings and their following paragraphs, prioritizing key sections."""
    import re

    lines = text.split("\n")
    sections: list[tuple[str, str]] = []
    current_heading = ""
    current_body: list[str] = []

    for line in lines:
        if re.match(r"^#{1,3}\s", line):
            if current_heading or current_body:
                sections.append((current_heading, "\n".join(current_body).strip()))
            current_heading = line.strip()
            current_body = []
        else:
            current_body.append(line)

    if current_heading or current_body:
        sections.append((current_heading, "\n".join(current_body).strip()))

    priority_keywords = ["目标", "重点", "概念", "核心", "关键", "总结", "要点", "objective", "key", "summary"]

    def section_priority(heading: str) -> int:
        lower = heading.lower()
        for idx, kw in enumerate(priority_keywords):
            if kw in lower:
                return idx
        return len(priority_keywords)

    sections.sort(key=lambda s: section_priority(s[0]))

    result: list[str] = []
    total = 0
    for heading, body in sections:
        entry = f"{heading}\n{body}" if heading else body
        entry_len = len(entry) + 1
        if total + entry_len > max_chars:
            remaining = max_chars - total
            if remaining > 60:
                result.append(entry[:remaining - 1].rstrip() + "…")
            break
        result.append(entry)
        total += entry_len

    return "\n".join(result) if result else None


def _optional_str(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        cleaned.append(normalized)
        seen.add(normalized)
    return cleaned


MEDIA_RESOURCE_SUFFIX_MAP: dict[str, str] = {
    ".mp4": "video",
    ".html": "interactive_html",
    ".svg": "image",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
}


def _build_classroom_media_resources(
    *,
    artifacts: list[ArtifactResult],
    output_dir: Path,
) -> list[dict[str, str]]:
    """Extract non-textual media resources from prep artifacts for classroom use."""
    resources: list[dict[str, str]] = []
    seen_paths: set[str] = set()

    for artifact in artifacts:
        for raw_path in artifact.files:
            if not isinstance(raw_path, (str, Path)):
                continue
            path = Path(str(raw_path))
            suffix = path.suffix.lower()
            resource_type = MEDIA_RESOURCE_SUFFIX_MAP.get(suffix)
            if not resource_type:
                continue
            if not path.is_absolute():
                path = output_dir / path
            try:
                resolved = path.resolve()
            except Exception:
                continue
            if not resolved.is_file():
                continue
            str_path = str(resolved)
            if str_path in seen_paths:
                continue
            seen_paths.add(str_path)
            try:
                relative = resolved.relative_to(output_dir.resolve()).as_posix()
            except Exception:
                relative = resolved.name
            resources.append({
                "resource_type": resource_type,
                "file_path": str_path,
                "relative_path": relative,
                "description": f"{artifact.title} - {artifact.summary}",
                "source_agent": artifact.agent_name,
            })

    return resources


def _extract_practice_questions_summary(
    artifacts: list[ArtifactResult],
    output_dir: Path | None,
) -> list[dict[str, str]] | None:
    """Extract a lightweight summary of practice questions for classroom reuse."""
    if not output_dir:
        return None

    for artifact in artifacts:
        if artifact.agent_name != "practice":
            continue
        for raw_path in artifact.files:
            path = Path(str(raw_path))
            if path.name != "practice_questions.json":
                continue
            if not path.is_absolute():
                path = output_dir / path
            if not path.is_file():
                continue
            try:
                raw_text = path.read_text(encoding="utf-8")
                questions = json.loads(raw_text)
            except Exception:
                continue
            if not isinstance(questions, list) or not questions:
                continue
            summary: list[dict[str, str]] = []
            for q in questions[:10]:
                if not isinstance(q, dict):
                    continue
                q_type = str(q.get("question_type", q.get("type", "unknown")))
                question_text = str(q.get("question", q.get("prompt", "")))[:200]
                entry: dict[str, str] = {
                    "question_type": q_type,
                    "question": question_text,
                }
                correct = q.get("correct_answer", q.get("answer"))
                if correct is not None:
                    entry["correct_answer"] = str(correct)[:100]
                summary.append(entry)
            return summary if summary else None

    return None
