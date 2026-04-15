from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import create_run_directory, now_iso
from edu_multi_agent.models import GenerationRequest
from edu_multi_agent.runtime import WorkflowRunResult, run_generation

from ..schemas.prep_runs import RunStatus


logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RunSession:
    """In-memory state for one active or recently completed workflow run."""

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
        """Block until newer events are available or the run reaches a terminal state."""
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
    """Thread-safe registry that tracks active FastAPI workflow runs."""

    def __init__(self, settings: Settings) -> None:
        """Initialize the registry with application settings."""
        self.settings = settings
        self._sessions: dict[str, RunSession] = {}
        self._lock = threading.Lock()

    def create_run(self, request: GenerationRequest) -> RunSession:
        """Create a run session, persist it in memory, and start background execution."""
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
        """Return the in-memory session for a run when it is still tracked."""
        with self._lock:
            return self._sessions.get(run_id)

    def resolve_run_dir(self, run_id: str) -> Path:
        """Resolve the output directory for a run from memory or persisted outputs."""
        session = self.get_session(run_id)
        if session is not None:
            return session.output_dir

        candidate = (self.settings.output_root / run_id).resolve()
        if candidate.is_dir():
            return candidate

        raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")

    def _run_session(self, session: RunSession) -> None:
        """Execute the workflow and capture terminal state for the given session."""
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
        """Append an event, update derived session state, and notify listeners."""
        with session.condition:
            self._apply_event_to_session(session, event)
            enriched = {**event, "run_id": session.run_id, "run_status": session.status}
            session.events.append(enriched)
            session.condition.notify_all()

    def _apply_event_to_session(self, session: RunSession, event: dict[str, Any]) -> None:
        """Project event payloads into the session snapshot used by the API."""
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
        """Merge final runtime results back into the session after workflow completion."""
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
