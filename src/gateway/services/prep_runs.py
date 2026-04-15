from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from edu_multi_agent.config import Settings
from edu_multi_agent.graph import AGENT_SPECS
from edu_multi_agent.models import ArtifactResult, GenerationRequest

from ..schemas.prep_runs import (
    ArtifactDescriptor,
    ArtifactListResponse,
    FileDescriptor,
    RunLinks,
    RunStatus,
    RunStatusResponse,
)
from .run_registry import RunRegistry, RunSession


TERMINAL_EVENTS = {"workflow_completed", "workflow_failed"}
AGENT_ORDER = {spec.agent_name: index for index, spec in enumerate(AGENT_SPECS)}


def load_json_file(path: Path) -> dict[str, Any] | None:
    """Load a JSON object from disk when the file exists."""
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl_file(path: Path) -> list[dict[str, Any]]:
    """Load JSONL records from disk while skipping blank lines."""
    if not path.is_file():
        return []

    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def sort_artifacts(artifacts: list[ArtifactResult]) -> list[ArtifactResult]:
    """Sort artifacts according to the configured agent display order."""
    return sorted(
        artifacts,
        key=lambda artifact: AGENT_ORDER.get(artifact.agent_name, 999),
    )


def relative_path(output_dir: Path, file_path: Path) -> str:
    """Return a POSIX-style path relative to the run output directory."""
    return file_path.resolve().relative_to(output_dir.resolve()).as_posix()


def build_links(run_id: str) -> RunLinks:
    """Build convenience links for all follow-up run endpoints."""
    base = f"/api/v1/prep-runs/{run_id}"
    return RunLinks(
        status=base,
        events=f"{base}/events",
        artifacts=f"{base}/artifacts",
        bundle=f"{base}/bundle",
    )


def build_file_descriptor(
    run_id: str,
    output_dir: Path,
    file_path: str | Path | None,
) -> FileDescriptor | None:
    """Build a downloadable file descriptor when the target file exists."""
    if not file_path:
        return None

    path = Path(file_path)
    if not path.is_absolute():
        path = output_dir / path
    if not path.is_file():
        return None

    artifact_relative_path = relative_path(output_dir, path)
    return FileDescriptor(
        name=path.name,
        relative_path=artifact_relative_path,
        size_bytes=path.stat().st_size,
        content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        download_url=f"/api/v1/prep-runs/{run_id}/files/{quote(artifact_relative_path, safe='/')}",
    )


def build_artifact_descriptor(
    run_id: str,
    output_dir: Path,
    artifact: ArtifactResult,
) -> ArtifactDescriptor:
    """Convert an artifact result into an API response descriptor."""
    files = [
        descriptor
        for descriptor in (
            build_file_descriptor(run_id, output_dir, file_path)
            for file_path in artifact.files
        )
        if descriptor is not None
    ]
    return ArtifactDescriptor(
        agent_name=artifact.agent_name,
        title=artifact.title,
        status=artifact.status,
        summary=artifact.summary,
        notes=artifact.notes,
        output_dir=artifact.output_dir,
        files=files,
    )


def run_view_from_session(session: RunSession) -> dict[str, Any]:
    """Build a run view from an active in-memory session."""
    artifacts = [
        ArtifactResult.model_validate(payload)
        for payload in session.latest_artifacts.values()
    ]
    artifacts = sort_artifacts(artifacts)

    return {
        "run_id": session.run_id,
        "status": session.status,
        "created_at": session.created_at,
        "started_at": session.started_at,
        "finished_at": session.finished_at,
        "output_dir": str(session.output_dir),
        "request": session.request,
        "artifacts": artifacts,
        "plan_path": session.plan_path,
        "report_path": session.report_path,
        "manifest_path": session.manifest_path,
        "error": session.error,
    }


def run_view_from_disk(settings: Settings, run_id: str) -> dict[str, Any]:
    """Reconstruct a run view from files on disk for completed historical runs."""
    output_dir = (settings.output_root / run_id).resolve()
    if not output_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")

    final_state = load_json_file(output_dir / "00_supervisor" / "final_state.json") or {}
    manifest = load_json_file(output_dir / "00_supervisor" / "artifact_manifest.json") or {}
    events = load_jsonl_file(output_dir / "00_supervisor" / "langgraph_events.jsonl")

    request_payload = final_state.get("request")
    if not request_payload and events:
        first_event = events[0]
        request_payload = (
            (first_event.get("data") or {}).get("input", {}).get("request")
            or (first_event.get("input") or {}).get("request")
        )
    request = (
        GenerationRequest.model_validate(request_payload)
        if isinstance(request_payload, dict)
        else None
    )

    artifacts_payload = final_state.get("artifact_results") or manifest.get("artifacts") or []
    artifacts = [
        ArtifactResult.model_validate(payload)
        for payload in artifacts_payload
        if isinstance(payload, dict)
    ]
    artifacts = sort_artifacts(artifacts)

    completed_event = next(
        (event for event in reversed(events) if event.get("event") in TERMINAL_EVENTS),
        None,
    )
    if completed_event is None:
        status = RunStatus.unknown
    elif completed_event.get("event") == "workflow_completed":
        status = RunStatus.succeeded
    else:
        status = RunStatus.failed

    return {
        "run_id": run_id,
        "status": status,
        "created_at": events[0].get("timestamp") if events else None,
        "started_at": next(
            (event.get("timestamp") for event in events if event.get("event") == "workflow_started"),
            None,
        ),
        "finished_at": completed_event.get("timestamp") if completed_event else None,
        "output_dir": str(output_dir),
        "request": request,
        "artifacts": artifacts,
        "plan_path": final_state.get("plan_path") or (
            str(output_dir / "00_supervisor" / "preparation_plan.md")
            if (output_dir / "00_supervisor" / "preparation_plan.md").is_file()
            else None
        ),
        "report_path": final_state.get("report_path") or (
            str(output_dir / "00_supervisor" / "final_report.md")
            if (output_dir / "00_supervisor" / "final_report.md").is_file()
            else None
        ),
        "manifest_path": final_state.get("manifest_path") or (
            str(output_dir / "00_supervisor" / "artifact_manifest.json")
            if (output_dir / "00_supervisor" / "artifact_manifest.json").is_file()
            else None
        ),
        "error": (
            ((completed_event or {}).get("data") or {}).get("error")
            if completed_event
            else None
        ),
    }


def load_run_view(registry: RunRegistry, settings: Settings, run_id: str) -> dict[str, Any]:
    """Load a run view from memory when active or from disk when historical."""
    session = registry.get_session(run_id)
    if session is not None:
        return run_view_from_session(session)
    return run_view_from_disk(settings, run_id)


def build_status_response(view: dict[str, Any]) -> RunStatusResponse:
    """Convert an internal run view into the status response schema."""
    return RunStatusResponse(
        run_id=view["run_id"],
        status=view["status"],
        created_at=view.get("created_at"),
        started_at=view.get("started_at"),
        finished_at=view.get("finished_at"),
        output_dir=view["output_dir"],
        request=view.get("request"),
        artifact_count=len(view.get("artifacts", [])),
        error=view.get("error"),
        links=build_links(view["run_id"]),
    )


def build_artifacts_response(view: dict[str, Any]) -> ArtifactListResponse:
    """Convert an internal run view into the artifact listing response."""
    run_id = view["run_id"]
    output_dir = Path(view["output_dir"])
    artifacts = [
        build_artifact_descriptor(run_id, output_dir, artifact)
        for artifact in view.get("artifacts", [])
    ]
    return ArtifactListResponse(
        run_id=run_id,
        status=view["status"],
        plan_file=build_file_descriptor(run_id, output_dir, view.get("plan_path")),
        report_file=build_file_descriptor(run_id, output_dir, view.get("report_path")),
        manifest_file=build_file_descriptor(run_id, output_dir, view.get("manifest_path")),
        artifacts=artifacts,
        bundle_download_url=f"/api/v1/prep-runs/{run_id}/bundle",
    )


def encode_sse(event_name: str, payload: dict[str, Any], event_id: int | None = None) -> str:
    """Encode one payload as a Server-Sent Events frame."""
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    serialized = json.dumps(payload, ensure_ascii=False)
    for line in serialized.splitlines():
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines) + "\n"


def safe_path_within(base_dir: Path, requested_relative_path: str) -> Path:
    """Resolve a file path and reject attempts to escape the run directory."""
    candidate = (base_dir / requested_relative_path).resolve()
    resolved_base = base_dir.resolve()
    if candidate != resolved_base and resolved_base not in candidate.parents:
        raise HTTPException(status_code=400, detail="Invalid file path.")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return candidate


def load_stored_events(registry: RunRegistry, run_id: str) -> list[dict[str, Any]]:
    """Load persisted events for a run that is no longer tracked in memory."""
    run_dir = registry.resolve_run_dir(run_id)
    return load_jsonl_file(run_dir / "00_supervisor" / "langgraph_events.jsonl")
