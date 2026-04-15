from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .config import Settings
from .file_io import (
    append_jsonl_file,
    now_iso,
    render_langgraph_trace_markdown,
    write_json_file,
    write_text_file,
)
from .graph import build_workflow
from .models import GenerationRequest


logger = logging.getLogger(__name__)

RuntimeEventCallback = Callable[[dict[str, Any]], None]


@dataclass(slots=True)
class WorkflowRunResult:
    request: GenerationRequest
    output_dir: Path
    final_state: dict[str, Any]
    trace_events: list[dict[str, Any]]
    plan_path: Path | None
    report_path: Path | None
    manifest_path: Path | None


def _safe_emit(
    event_callback: RuntimeEventCallback | None,
    event_record: dict[str, Any],
) -> None:
    if event_callback is None:
        return

    try:
        event_callback(event_record)
    except Exception:
        logger.warning("Runtime event callback failed.", exc_info=True)


def run_generation(
    request: GenerationRequest,
    settings: Settings,
    output_dir: Path,
    *,
    event_callback: RuntimeEventCallback | None = None,
    starting_index: int = 0,
) -> WorkflowRunResult:
    initial_state = {
        "request": request.model_dump(),
        "output_dir": str(output_dir),
    }
    events_path = "00_supervisor/langgraph_events.jsonl"
    trace_events: list[dict[str, Any]] = []
    final_state: dict[str, Any] = dict(initial_state)
    last_node_name = "input"
    snapshot_index = 0
    next_index = starting_index

    def record_event(payload: dict[str, Any]) -> dict[str, Any]:
        nonlocal next_index

        event_record = {
            "index": next_index,
            "timestamp": now_iso(),
            **payload,
        }
        next_index += 1
        append_jsonl_file(output_dir, events_path, event_record)
        trace_events.append(event_record)
        _safe_emit(event_callback, event_record)
        return event_record

    workflow = build_workflow(settings, event_callback=record_event)

    record_event(
        {
            "event": "workflow_started",
            "node": "input",
            "summary": "LangGraph workflow started.",
            "data": {"input": initial_state},
        }
    )

    try:
        for mode, payload in workflow.stream(initial_state, stream_mode=["updates", "values"]):
            if mode == "updates":
                node_name = next(iter(payload.keys()), "unknown")
                update_payload = payload.get(node_name, {})
                last_node_name = node_name
                logger.info(
                    "Graph update node=%s updated_keys=%s payload=%s",
                    node_name,
                    sorted(update_payload.keys()),
                    update_payload,
                )
                record_event(
                    {
                        "event": "node_completed",
                        "mode": mode,
                        "node": node_name,
                        "summary": (
                            "Node finished with updates: "
                            f"{', '.join(sorted(update_payload.keys())) or 'none'}"
                        ),
                        "data": {
                            "updated_keys": sorted(update_payload.keys()),
                            "payload": update_payload,
                        },
                    }
                )
            elif mode == "values":
                final_state = payload
                snapshot_index += 1
                logger.info(
                    "Graph state snapshot after node=%s state_keys=%s artifact_result_count=%s",
                    last_node_name,
                    sorted(payload.keys()),
                    len(payload.get("artifact_results", [])),
                )
                snapshot_path = write_json_file(
                    output_dir,
                    (
                        "00_supervisor/langgraph_state_snapshots/"
                        f"{snapshot_index:02d}_{last_node_name.replace('_', '-')}.json"
                    ),
                    payload,
                )
                artifact_results = payload.get("artifact_results", [])
                record_event(
                    {
                        "event": "state_snapshot",
                        "mode": mode,
                        "node": last_node_name,
                        "summary": (
                            f"State snapshot saved after {last_node_name}; "
                            f"keys={', '.join(sorted(payload.keys()))}"
                        ),
                        "data": {
                            "state_keys": sorted(payload.keys()),
                            "artifact_result_count": len(artifact_results),
                            "snapshot_path": str(snapshot_path),
                        },
                    }
                )
            else:
                record_event(
                    {
                        "event": "workflow_event",
                        "mode": mode,
                        "node": last_node_name,
                        "summary": "Received unhandled stream mode event.",
                        "data": {"payload": payload},
                    }
                )
    except Exception as exc:
        logger.exception("Workflow failed at node=%s", last_node_name)
        record_event(
            {
                "event": "workflow_failed",
                "node": last_node_name,
                "summary": f"Workflow failed at node {last_node_name}: {exc}",
                "data": {"error": str(exc)},
            }
        )
        write_text_file(
            output_dir,
            "00_supervisor/langgraph_trace.md",
            render_langgraph_trace_markdown(trace_events),
        )
        raise

    logger.info("Workflow completed successfully. output_dir=%s", output_dir)
    record_event(
        {
            "event": "workflow_completed",
            "node": "END",
            "summary": "LangGraph workflow completed successfully.",
        }
    )

    write_json_file(output_dir, "00_supervisor/final_state.json", final_state)
    write_text_file(
        output_dir,
        "00_supervisor/langgraph_trace.md",
        render_langgraph_trace_markdown(trace_events),
    )

    plan_path_value = final_state.get("plan_path")
    report_path_value = final_state.get("report_path")
    manifest_path_value = final_state.get("manifest_path")

    return WorkflowRunResult(
        request=request,
        output_dir=output_dir,
        final_state=final_state,
        trace_events=trace_events,
        plan_path=Path(plan_path_value) if plan_path_value else None,
        report_path=Path(report_path_value) if report_path_value else None,
        manifest_path=Path(manifest_path_value) if manifest_path_value else None,
    )
