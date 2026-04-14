from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .config import Settings
from .file_io import (
    append_jsonl_file,
    create_run_directory,
    now_iso,
    render_langgraph_trace_markdown,
    slugify_fragment,
    write_json_file,
    write_text_file,
)
from .graph import build_workflow
from .models import GenerationRequest


logger = logging.getLogger(__name__)


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the LangGraph teaching-preparation multi-agent workflow."
    )
    parser.add_argument("goal", nargs="?", help="Learning goal for the workflow.")
    parser.add_argument(
        "--goal", dest="goal_option", help="Learning goal for the workflow."
    )
    parser.add_argument("--subject", default="General", help="Subject name.")
    parser.add_argument(
        "--grade-level", default="Unspecified", help="Grade level or phase."
    )
    parser.add_argument(
        "--learner-profile",
        default=(
            "Mixed-ability class that needs clear scaffolding, visual support, "
            "and structured practice."
        ),
        help="Short learner profile.",
    )
    parser.add_argument("--notes", default="None", help="Extra teacher notes.")
    parser.add_argument(
        "--output-root",
        default="",
        help="Optional output root. Defaults to OUTPUT_ROOT in .env or ./outputs.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = build_parser()
    args = parser.parse_args(argv)

    goal = (args.goal_option or args.goal or "").strip()
    if not goal:
        parser.error("A learning goal is required. Use --goal or a positional goal.")

    settings = Settings.from_env()
    output_root = Path(args.output_root).resolve() if args.output_root else settings.output_root
    output_dir = create_run_directory(output_root, goal)

    request = GenerationRequest(
        learning_goal=goal,
        subject=args.subject,
        grade_level=args.grade_level,
        learner_profile=args.learner_profile,
        notes=args.notes,
    )

    workflow = build_workflow(settings)
    initial_state = {
        "request": request.model_dump(),
        "output_dir": str(output_dir),
    }
    events_path = "00_supervisor/langgraph_events.jsonl"
    trace_events: list[dict[str, object]] = []
    final_state: dict[str, object] = dict(initial_state)
    last_node_name = "input"
    snapshot_index = 0

    append_jsonl_file(
        output_dir,
        events_path,
        {
            "index": 0,
            "timestamp": now_iso(),
            "event": "workflow_started",
            "node": "input",
            "summary": "LangGraph workflow started.",
            "input": initial_state,
        },
    )

    try:
        for event_index, event in enumerate(
            workflow.stream(initial_state, stream_mode=["updates", "values"]),
            start=1,
        ):
            mode, payload = event
            event_record: dict[str, object] = {
                "index": event_index,
                "timestamp": now_iso(),
                "mode": mode,
            }

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
                event_record.update(
                    {
                        "node": node_name,
                        "updated_keys": sorted(update_payload.keys()),
                        "summary": (
                            f"Node finished with updates: "
                            f"{', '.join(sorted(update_payload.keys())) or 'none'}"
                        ),
                        "payload": update_payload,
                    }
                )
            elif mode == "values":
                final_state = payload
                snapshot_index += 1
                snapshot_name = slugify_fragment(last_node_name, max_length=48)
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
                        f"{snapshot_index:02d}_{snapshot_name}.json"
                    ),
                    payload,
                )
                artifact_results = payload.get("artifact_results", [])
                event_record.update(
                    {
                        "node": last_node_name,
                        "state_keys": sorted(payload.keys()),
                        "artifact_result_count": len(artifact_results),
                        "summary": (
                            f"State snapshot saved after {last_node_name}; "
                            f"keys={', '.join(sorted(payload.keys()))}"
                        ),
                        "snapshot_path": str(snapshot_path),
                    }
                )
            else:
                event_record.update(
                    {
                        "node": last_node_name,
                        "summary": "Received unhandled stream mode event.",
                        "payload": payload,
                    }
                )

            append_jsonl_file(output_dir, events_path, event_record)
            trace_events.append(event_record)
    except Exception as exc:
        logger.exception("Workflow failed at node=%s", last_node_name)
        failure_event = {
            "index": len(trace_events) + 1,
            "timestamp": now_iso(),
            "event": "workflow_failed",
            "node": last_node_name,
            "summary": f"Workflow failed at node {last_node_name}: {exc}",
            "error": str(exc),
        }
        append_jsonl_file(output_dir, events_path, failure_event)
        trace_events.append(failure_event)
        write_text_file(
            output_dir,
            "00_supervisor/langgraph_trace.md",
            render_langgraph_trace_markdown(trace_events),
        )
        raise

    completion_event = {
        "index": len(trace_events) + 1,
        "timestamp": now_iso(),
        "event": "workflow_completed",
        "node": "END",
        "summary": "LangGraph workflow completed successfully.",
    }
    logger.info("Workflow completed successfully. output_dir=%s", output_dir)
    append_jsonl_file(output_dir, events_path, completion_event)
    trace_events.append(completion_event)
    write_json_file(output_dir, "00_supervisor/final_state.json", final_state)
    write_text_file(
        output_dir,
        "00_supervisor/langgraph_trace.md",
        render_langgraph_trace_markdown(trace_events),
    )

    report_path = final_state.get(
        "report_path",
        str(output_dir / "00_supervisor" / "final_report.md"),
    )
    print(f"Output directory: {output_dir}")
    print(f"Supervisor report: {report_path}")
    print(f"LangGraph log: {output_dir / '00_supervisor' / 'langgraph_events.jsonl'}")
    return 0
