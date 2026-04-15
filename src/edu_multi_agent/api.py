from __future__ import annotations

import argparse
import asyncio
import json
import logging
import mimetypes
import threading
import zipfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.parse import quote

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import Settings
from .file_io import create_run_directory, now_iso
from .graph import AGENT_SPECS
from .models import ArtifactResult, GenerationRequest
from .runtime import WorkflowRunResult, run_generation


logger = logging.getLogger(__name__)


TERMINAL_EVENTS = {"workflow_completed", "workflow_failed"}
AGENT_ORDER = {spec.agent_name: index for index, spec in enumerate(AGENT_SPECS)}


class RunStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    unknown = "unknown"


class RunLinks(BaseModel):
    status: str
    events: str
    artifacts: str
    bundle: str


class RunCreatedResponse(BaseModel):
    run_id: str
    status: RunStatus
    created_at: str
    output_dir: str
    links: RunLinks


class RunStatusResponse(BaseModel):
    run_id: str
    status: RunStatus
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    output_dir: str
    request: GenerationRequest | None = None
    artifact_count: int = 0
    error: str | None = None
    links: RunLinks


class FileDescriptor(BaseModel):
    name: str
    relative_path: str
    size_bytes: int | None = None
    content_type: str | None = None
    download_url: str


class ArtifactDescriptor(BaseModel):
    agent_name: str
    title: str
    status: str
    summary: str
    notes: list[str] = Field(default_factory=list)
    output_dir: str
    files: list[FileDescriptor] = Field(default_factory=list)


class ArtifactListResponse(BaseModel):
    run_id: str
    status: RunStatus
    plan_file: FileDescriptor | None = None
    report_file: FileDescriptor | None = None
    manifest_file: FileDescriptor | None = None
    artifacts: list[ArtifactDescriptor]
    bundle_download_url: str


@dataclass(slots=True)
class RunSession:
    run_id: str
    request: GenerationRequest
    output_dir: Path
    created_at: str
    status: RunStatus = RunStatus.queued
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    final_state: dict[str, Any] = field(default_factory=dict)
    latest_plan: dict[str, Any] | None = None
    latest_artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    plan_path: str | None = None
    report_path: str | None = None
    manifest_path: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    condition: threading.Condition = field(
        default_factory=threading.Condition,
        repr=False,
    )

    def wait_for_events(self, after_index: int, timeout: float) -> list[dict[str, Any]]:
        with self.condition:
            self.condition.wait_for(
                lambda: (
                    any(event["index"] > after_index for event in self.events)
                    or self.status in {RunStatus.succeeded, RunStatus.failed}
                ),
                timeout=timeout,
            )
            return [event for event in self.events if event["index"] > after_index]


class RunRegistry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._sessions: dict[str, RunSession] = {}
        self._lock = threading.Lock()

    def create_run(self, request: GenerationRequest) -> RunSession:
        output_dir = create_run_directory(self.settings.output_root, request.learning_goal)
        session = RunSession(
            run_id=output_dir.name,
            request=request,
            output_dir=output_dir,
            created_at=now_iso(),
        )

        with self._lock:
            self._sessions[session.run_id] = session

        self._append_event(
            session,
            {
                "index": 0,
                "timestamp": session.created_at,
                "event": "run_created",
                "node": "api",
                "phase": "orchestration",
                "summary": "Run created and queued.",
                "data": {
                    "request": request.model_dump(),
                    "output_dir": str(output_dir),
                },
            },
        )

        worker = threading.Thread(
            target=self._run_session,
            args=(session,),
            daemon=True,
            name=f"prep-run-{session.run_id}",
        )
        worker.start()
        return session

    def get_session(self, run_id: str) -> RunSession | None:
        with self._lock:
            return self._sessions.get(run_id)

    def resolve_run_dir(self, run_id: str) -> Path:
        session = self.get_session(run_id)
        if session is not None:
            return session.output_dir

        candidate = (self.settings.output_root / run_id).resolve()
        if candidate.is_dir():
            return candidate

        raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")

    def _run_session(self, session: RunSession) -> None:
        try:
            result = run_generation(
                session.request,
                self.settings,
                session.output_dir,
                event_callback=lambda event: self._append_event(session, event),
                starting_index=1,
            )
            self._finalize_result(session, result)
        except Exception as exc:
            logger.exception("Run %s failed.", session.run_id)
            with session.condition:
                if session.status != RunStatus.failed:
                    session.status = RunStatus.failed
                    session.finished_at = now_iso()
                    session.error = str(exc)
                session.condition.notify_all()

    def _append_event(self, session: RunSession, event: dict[str, Any]) -> None:
        with session.condition:
            self._apply_event_to_session(session, event)
            enriched = {**event, "run_id": session.run_id, "run_status": session.status}
            session.events.append(enriched)
            session.condition.notify_all()

    def _apply_event_to_session(self, session: RunSession, event: dict[str, Any]) -> None:
        event_name = event.get("event")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}

        if event_name == "workflow_started":
            session.status = RunStatus.running
            session.started_at = event.get("timestamp", now_iso())
        elif event_name == "workflow_completed":
            session.status = RunStatus.succeeded
            session.finished_at = event.get("timestamp", now_iso())
        elif event_name == "workflow_failed":
            session.status = RunStatus.failed
            session.finished_at = event.get("timestamp", now_iso())
            session.error = str(data.get("error") or event.get("summary") or "Workflow failed.")
        elif event_name == "plan_ready":
            plan_payload = data.get("plan")
            if isinstance(plan_payload, dict):
                session.latest_plan = plan_payload
            session.plan_path = data.get("plan_path") or session.plan_path
        elif event_name in {"artifact_ready", "artifact_skipped", "artifact_failed"}:
            artifact_payload = data.get("artifact")
            if isinstance(artifact_payload, dict):
                agent_name = artifact_payload.get("agent_name")
                if agent_name:
                    session.latest_artifacts[str(agent_name)] = artifact_payload
        elif event_name == "manifest_ready":
            session.manifest_path = data.get("manifest_path") or session.manifest_path
        elif event_name == "report_ready":
            session.report_path = data.get("report_path") or session.report_path

    def _finalize_result(self, session: RunSession, result: WorkflowRunResult) -> None:
        with session.condition:
            session.final_state = result.final_state
            if result.final_state.get("plan") and not session.latest_plan:
                session.latest_plan = result.final_state["plan"]
            for item in result.final_state.get("artifact_results", []):
                if isinstance(item, dict) and item.get("agent_name"):
                    session.latest_artifacts[str(item["agent_name"])] = item
            if result.plan_path is not None:
                session.plan_path = str(result.plan_path)
            if result.report_path is not None:
                session.report_path = str(result.report_path)
            if result.manifest_path is not None:
                session.manifest_path = str(result.manifest_path)
            if session.status not in {RunStatus.succeeded, RunStatus.failed}:
                session.status = RunStatus.succeeded
                session.finished_at = now_iso()
            session.condition.notify_all()


def _load_json_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _load_jsonl_file(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []

    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def _sort_artifacts(artifacts: list[ArtifactResult]) -> list[ArtifactResult]:
    return sorted(
        artifacts,
        key=lambda artifact: AGENT_ORDER.get(artifact.agent_name, 999),
    )


def _relative_path(output_dir: Path, file_path: Path) -> str:
    return file_path.resolve().relative_to(output_dir.resolve()).as_posix()


def _build_links(run_id: str) -> RunLinks:
    base = f"/api/v1/prep-runs/{run_id}"
    return RunLinks(
        status=base,
        events=f"{base}/events",
        artifacts=f"{base}/artifacts",
        bundle=f"{base}/bundle",
    )


def _build_file_descriptor(run_id: str, output_dir: Path, file_path: str | Path | None) -> FileDescriptor | None:
    if not file_path:
        return None

    path = Path(file_path)
    if not path.is_absolute():
        path = output_dir / path
    if not path.is_file():
        return None

    relative_path = _relative_path(output_dir, path)
    return FileDescriptor(
        name=path.name,
        relative_path=relative_path,
        size_bytes=path.stat().st_size,
        content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        download_url=f"/api/v1/prep-runs/{run_id}/files/{quote(relative_path, safe='/')}",
    )


def _build_artifact_descriptor(
    run_id: str,
    output_dir: Path,
    artifact: ArtifactResult,
) -> ArtifactDescriptor:
    files = [
        descriptor
        for descriptor in (
            _build_file_descriptor(run_id, output_dir, file_path)
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


def _run_view_from_session(session: RunSession) -> dict[str, Any]:
    artifacts = [
        ArtifactResult.model_validate(payload)
        for payload in session.latest_artifacts.values()
    ]
    artifacts = _sort_artifacts(artifacts)

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


def _run_view_from_disk(settings: Settings, run_id: str) -> dict[str, Any]:
    output_dir = (settings.output_root / run_id).resolve()
    if not output_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")

    final_state = _load_json_file(output_dir / "00_supervisor" / "final_state.json") or {}
    manifest = _load_json_file(output_dir / "00_supervisor" / "artifact_manifest.json") or {}
    events = _load_jsonl_file(output_dir / "00_supervisor" / "langgraph_events.jsonl")

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
    artifacts = _sort_artifacts(artifacts)

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


def _build_status_response(view: dict[str, Any]) -> RunStatusResponse:
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
        links=_build_links(view["run_id"]),
    )


def _build_artifacts_response(view: dict[str, Any]) -> ArtifactListResponse:
    run_id = view["run_id"]
    output_dir = Path(view["output_dir"])
    artifacts = [
        _build_artifact_descriptor(run_id, output_dir, artifact)
        for artifact in view.get("artifacts", [])
    ]
    return ArtifactListResponse(
        run_id=run_id,
        status=view["status"],
        plan_file=_build_file_descriptor(run_id, output_dir, view.get("plan_path")),
        report_file=_build_file_descriptor(run_id, output_dir, view.get("report_path")),
        manifest_file=_build_file_descriptor(run_id, output_dir, view.get("manifest_path")),
        artifacts=artifacts,
        bundle_download_url=f"/api/v1/prep-runs/{run_id}/bundle",
    )


def _encode_sse(event_name: str, payload: dict[str, Any], event_id: int | None = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    serialized = json.dumps(payload, ensure_ascii=False)
    for line in serialized.splitlines():
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines)


def _safe_path_within(base_dir: Path, relative_path: str) -> Path:
    candidate = (base_dir / relative_path).resolve()
    resolved_base = base_dir.resolve()
    if candidate != resolved_base and resolved_base not in candidate.parents:
        raise HTTPException(status_code=400, detail="Invalid file path.")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return candidate


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    registry = RunRegistry(resolved_settings)

    app = FastAPI(
        title="Edu Multi-Agent API",
        version="0.1.0",
        summary="Pre-class preparation orchestration API with SSE progress streaming.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.run_registry = registry
    app.state.settings = resolved_settings

    @app.get("/health")
    def healthcheck() -> JSONResponse:
        return JSONResponse({"status": "ok", "timestamp": now_iso()})

    @app.post("/api/v1/prep-runs", response_model=RunCreatedResponse)
    def create_prep_run(payload: GenerationRequest) -> RunCreatedResponse:
        session = registry.create_run(payload)
        return RunCreatedResponse(
            run_id=session.run_id,
            status=session.status,
            created_at=session.created_at,
            output_dir=str(session.output_dir),
            links=_build_links(session.run_id),
        )

    @app.get("/api/v1/prep-runs/{run_id}", response_model=RunStatusResponse)
    def get_prep_run(run_id: str) -> RunStatusResponse:
        session = registry.get_session(run_id)
        view = _run_view_from_session(session) if session is not None else _run_view_from_disk(resolved_settings, run_id)
        return _build_status_response(view)

    @app.get("/api/v1/prep-runs/{run_id}/artifacts", response_model=ArtifactListResponse)
    def get_prep_run_artifacts(run_id: str) -> ArtifactListResponse:
        session = registry.get_session(run_id)
        view = _run_view_from_session(session) if session is not None else _run_view_from_disk(resolved_settings, run_id)
        return _build_artifacts_response(view)

    @app.get("/api/v1/prep-runs/{run_id}/events")
    async def stream_prep_run_events(
        run_id: str,
        request: Request,
        after_id: int = Query(-1, description="Replay events strictly after this index."),
        heartbeat_seconds: float = Query(
            15.0,
            ge=5.0,
            le=60.0,
            description="Heartbeat interval in seconds while waiting for new events.",
        ),
    ) -> StreamingResponse:
        session = registry.get_session(run_id)
        if session is None:
            run_dir = registry.resolve_run_dir(run_id)
            events = _load_jsonl_file(run_dir / "00_supervisor" / "langgraph_events.jsonl")

            async def replay_only() -> Any:
                yield "retry: 3000\n\n"
                for event in events:
                    event_index = int(event.get("index", -1))
                    if event_index <= after_id:
                        continue
                    payload = {**event, "run_id": run_id}
                    yield _encode_sse(str(event.get("event", "message")), payload, event_index)

            return StreamingResponse(replay_only(), media_type="text/event-stream")

        async def event_generator() -> Any:
            yield "retry: 3000\n\n"
            cursor = after_id

            while True:
                if await request.is_disconnected():
                    break

                events = await asyncio.to_thread(
                    session.wait_for_events,
                    cursor,
                    heartbeat_seconds,
                )

                if events:
                    for event in events:
                        cursor = max(cursor, int(event["index"]))
                        yield _encode_sse(event["event"], event, int(event["index"]))

                    if (
                        session.status in {RunStatus.succeeded, RunStatus.failed}
                        and cursor >= int(session.events[-1]["index"])
                    ):
                        break
                    continue

                heartbeat_payload = {
                    "run_id": run_id,
                    "timestamp": now_iso(),
                    "run_status": session.status,
                }
                yield _encode_sse("heartbeat", heartbeat_payload)

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    @app.get("/api/v1/prep-runs/{run_id}/files/{file_path:path}")
    def download_generated_file(
        run_id: str,
        file_path: str,
        download: bool = Query(
            False,
            description="When true, force the browser to download the file.",
        ),
    ) -> FileResponse:
        output_dir = registry.resolve_run_dir(run_id)
        target = _safe_path_within(output_dir, file_path)
        filename = target.name if download else None
        media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return FileResponse(target, media_type=media_type, filename=filename)

    @app.get("/api/v1/prep-runs/{run_id}/bundle")
    def download_generated_bundle(run_id: str, background_tasks: BackgroundTasks) -> FileResponse:
        output_dir = registry.resolve_run_dir(run_id)
        temp_file = NamedTemporaryFile(prefix=f"{run_id}_", suffix=".zip", delete=False)
        temp_path = Path(temp_file.name)
        temp_file.close()

        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(output_dir.rglob("*")):
                if file.is_file():
                    archive.write(file, arcname=file.relative_to(output_dir))

        background_tasks.add_task(temp_path.unlink, missing_ok=True)
        return FileResponse(
            temp_path,
            media_type="application/zip",
            filename=f"{run_id}.zip",
        )

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Edu Multi-Agent FastAPI server.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host.")
    parser.add_argument("--port", type=int, default=8000, help="Bind port.")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for local development.",
    )
    args = parser.parse_args(argv)

    import uvicorn

    uvicorn.run(
        "edu_multi_agent.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
    return 0


app = create_app()
