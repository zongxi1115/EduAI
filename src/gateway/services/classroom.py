from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from classroom.graph import GraphEventCallback, build_graph
from classroom.parser import ScriptParseError, parse_script

from edu_multi_agent.models import ArtifactResult, GenerationRequest
from edu_multi_agent.llm import LLMClient

from ..schemas.classroom import (
    ClassroomGenerateRequest,
    ClassroomGenerateResponse,
    ClassroomParseScriptResponse,
)
from ..schemas.prep_runs import RunStatus

OutlineNode = Callable[[Mapping[str, Any]], Mapping[str, Any]]

TEXTUAL_MATERIAL_SUFFIXES = {".md", ".txt", ".json"}
MAX_CLASSROOM_MATERIAL_COUNT = 16
MAX_CLASSROOM_MATERIAL_CHARS = 28_000
MAX_CLASSROOM_FILE_CHARS = 3_600
PREFERRED_CLASSROOM_FILE_NAMES = {
    "preparation_plan.md": 0,
    "study_guide.md": 1,
    "teacher_notes.md": 2,
    "practice_blueprint.md": 3,
    "answer_key.md": 4,
    "render_guide.md": 5,
    "usage_notes.md": 6,
    "practice_questions.json": 7,
    "final_report.md": 8,
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
            }
        )
    except ScriptParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Generated classroom script violated the parsing contract: {exc}",
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
    outline = _build_classroom_outline(
        prep_run_id=run_id,
        request=request,
        plan=plan,
        artifacts=artifacts,
    )

    try:
        return ClassroomGenerateRequest(
            topic=request.learning_goal,
            materials=materials,
            outline=outline,
            source_prep_run_id=run_id,
            slide_prompt_file=slide_prompt_file,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


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
        raise HTTPException(status_code=502, detail="Workflow did not return a valid outline.")
    if not isinstance(script, str) or not script.strip():
        raise HTTPException(status_code=502, detail="Workflow did not return a valid script.")
    if not isinstance(page_blueprints, list) or not page_blueprints:
        raise HTTPException(status_code=502, detail="Workflow did not return page blueprints.")
    if not isinstance(pages, list) or not pages:
        raise HTTPException(status_code=502, detail="Workflow did not return parsed pages.")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("pages"), list):
        raise HTTPException(status_code=502, detail="Workflow did not return a valid bundle.")

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
                "Missing outline. Provide request.outline or configure "
                "app.state.classroom_outline_agent."
            ),
        )

    if callable(outline_agent):
        return (_wrap_outline_callable(outline_agent), "server")

    invoke = getattr(outline_agent, "invoke", None)
    if callable(invoke):
        return (_wrap_outline_callable(invoke), "server")

    raise HTTPException(
        status_code=500,
        detail="Configured classroom_outline_agent is not callable.",
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
) -> dict[str, Any]:
    return {
        "source_prep_run_id": prep_run_id,
        "learning_goal": request.learning_goal,
        "subject": request.subject,
        "grade_level": request.grade_level,
        "learner_profile": request.learner_profile,
        "notes": request.notes,
        "language": request.language,
        "plan_summary": _optional_str(plan.get("plan_summary")),
        "teaching_focus": _clean_string_list(plan.get("teaching_focus")),
        "required_materials": _clean_string_list(plan.get("required_materials")),
        "teacher_checklist": _clean_string_list(plan.get("teacher_checklist")),
        "quality_bar": _clean_string_list(plan.get("quality_bar")),
        "artifact_summaries": [
            {
                "agent_name": artifact.agent_name,
                "title": artifact.title,
                "summary": artifact.summary,
                "status": artifact.status,
            }
            for artifact in artifacts
        ],
    }


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

    if len(text) > max_chars:
        return f"{text[:max_chars].rstrip()}…"
    return text


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
