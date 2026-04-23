from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from fastapi import HTTPException

from classroom.graph import GraphEventCallback, build_graph
from classroom.parser import ScriptParseError, parse_script

from edu_multi_agent.llm import LLMClient

from ..schemas.classroom import (
    ClassroomGenerateRequest,
    ClassroomGenerateResponse,
    ClassroomParseScriptResponse,
)

OutlineNode = Callable[[Mapping[str, Any]], Mapping[str, Any]]


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
