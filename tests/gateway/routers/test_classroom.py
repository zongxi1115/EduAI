from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from edu_multi_agent.config import Settings

from gateway.app import create_app
from gateway.schemas.prep_runs import RunStatus


class DummyLLMClient:
    def __init__(self) -> None:
        self.model = object()


@dataclass
class FakeSession:
    run_id: str = "run_123"
    output_dir: Path | None = None
    created_at: str = "2026-04-23T10:00:00+08:00"
    status: RunStatus = RunStatus.queued
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    current_node: str | None = None
    latest_summary: str | None = None
    final_result: dict[str, Any] | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    condition: threading.Condition = field(default_factory=threading.Condition)

    def wait_for_events(self, after_index: int, timeout: float) -> list[dict[str, Any]]:
        return [event for event in self.events if int(event["index"]) > after_index]


class FakeRegistry:
    def __init__(self, tmp_path: Path) -> None:
        self.output_root = tmp_path / "classroom_runs"
        self.output_root.mkdir(parents=True, exist_ok=True)
        self.session = FakeSession(output_dir=self.output_root / "run_123")
        self.session.output_dir.mkdir(parents=True, exist_ok=True)
        self.created_payload: dict[str, Any] | None = None

    def create_run(self, request) -> FakeSession:
        self.created_payload = request.model_dump(mode="json")
        return self.session

    def get_session(self, run_id: str) -> FakeSession | None:
        if run_id == self.session.run_id:
            return self.session
        return None

    def resolve_run_dir(self, run_id: str) -> Path:
        if run_id == self.session.run_id:
            return self.session.output_dir
        raise FileNotFoundError(run_id)


def _make_settings(tmp_path: Path) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
    )


def _make_result_payload() -> dict[str, Any]:
    return {
        "topic": "牛顿第二定律",
        "materials": ["教材"],
        "outline_source": "request",
        "outline": {"title": "牛顿第二定律"},
        "page_blueprints": [
            {
                "idx": 0,
                "theme": "概念引入",
                "objective": "建立问题",
                "key_points": ["现象", "问题"],
                "target_reveal_count": 3,
                "quiz_goal": None,
            }
        ],
        "script": "第一页。<on_slide>F = ma</on_slide>",
        "page_count": 1,
        "pages": [
            {
                "idx": 0,
                "reveals": [{"narration": "第一页。", "on_slide": "F = ma"}],
                "quizzes": [],
                "on_slide_summary": "F = ma",
            }
        ],
        "bundle": {
            "pages": [
                {
                    "idx": 0,
                    "html": '<section class="card" data-idx="0"></section>',
                    "reveals": [{"narration": "第一页。"}],
                    "quizzes": [],
                }
            ]
        },
    }


def test_generate_classroom_endpoint_creates_task(tmp_path: Path) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    registry = FakeRegistry(tmp_path)
    app.state.classroom_task_registry = registry

    client = TestClient(app)
    response = client.post(
        "/api/v1/classroom/generate",
        json={
            "topic": "牛顿第二定律",
            "materials": ["教材"],
            "outline": "定义 -> 公式 -> 例题",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["run_id"] == "run_123"
    assert payload["links"]["events"] == "/api/v1/classroom/run_123/events"
    assert registry.created_payload is not None
    assert registry.created_payload["outline"] == "定义 -> 公式 -> 例题"


def test_get_classroom_task_status_returns_snapshot(tmp_path: Path, monkeypatch) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    registry = FakeRegistry(tmp_path)
    app.state.classroom_task_registry = registry

    monkeypatch.setattr(
        "gateway.routers.classroom.load_run_view",
        lambda _registry, _run_id: {
            "run_id": "run_123",
            "status": RunStatus.running,
            "created_at": "2026-04-23T10:00:00+08:00",
            "started_at": "2026-04-23T10:00:01+08:00",
            "finished_at": None,
            "output_dir": str(registry.session.output_dir),
            "request": {
                "topic": "牛顿第二定律",
                "materials": ["教材"],
                "outline": "定义 -> 公式 -> 例题",
            },
            "current_node": "page_script",
            "latest_summary": "开始生成第 2 页讲稿。",
            "error": None,
            "result": None,
        },
    )

    client = TestClient(app)
    response = client.get("/api/v1/classroom/run_123")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "running"
    assert payload["current_node"] == "page_script"
    assert payload["links"]["result"] == "/api/v1/classroom/run_123/result"


def test_get_classroom_task_result_returns_completed_payload(tmp_path: Path, monkeypatch) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    registry = FakeRegistry(tmp_path)
    app.state.classroom_task_registry = registry

    monkeypatch.setattr(
        "gateway.routers.classroom.load_run_view",
        lambda _registry, _run_id: {
            "run_id": "run_123",
            "status": RunStatus.succeeded,
            "created_at": "2026-04-23T10:00:00+08:00",
            "started_at": "2026-04-23T10:00:01+08:00",
            "finished_at": "2026-04-23T10:00:20+08:00",
            "output_dir": str(registry.session.output_dir),
            "request": {
                "topic": "牛顿第二定律",
                "materials": ["教材"],
                "outline": "定义 -> 公式 -> 例题",
            },
            "current_node": "assemble",
            "latest_summary": "播放器数据包已组装完成。",
            "error": None,
            "result": _make_result_payload(),
        },
    )

    client = TestClient(app)
    response = client.get("/api/v1/classroom/run_123/result")

    assert response.status_code == 200
    payload = response.json()
    assert payload["page_blueprints"][0]["theme"] == "概念引入"
    assert payload["bundle"]["pages"][0]["idx"] == 0


def test_classroom_events_replay_returns_sse_payload(tmp_path: Path, monkeypatch) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    registry = FakeRegistry(tmp_path)
    app.state.classroom_task_registry = registry
    registry.session.events = []

    monkeypatch.setattr(
        "gateway.routers.classroom.load_stored_events",
        lambda _registry, _run_id: [
            {
                "index": 0,
                "timestamp": "2026-04-23T10:00:00+08:00",
                "event": "run_created",
                "node": "api",
                "summary": "AI 课堂任务已创建，等待执行。",
                "run_id": "run_123",
                "run_status": "queued",
            }
        ],
    )
    registry.get_session = lambda _run_id: None  # type: ignore[method-assign]

    client = TestClient(app)
    with client.stream("GET", "/api/v1/classroom/run_123/events") as response:
        body = b"".join(response.iter_bytes()).decode("utf-8")

    assert response.status_code == 200
    assert "event: run_created" in body
    assert '"run_id": "run_123"' in body


def test_parse_script_endpoint_returns_422_for_invalid_script(tmp_path: Path) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    client = TestClient(app)

    response = client.post(
        "/api/v1/classroom/parse-script",
        json={"script": "第一页内容。<to_next_page/>   "},
    )

    assert response.status_code == 422
    assert "Page 1 is empty" in response.json()["detail"]
