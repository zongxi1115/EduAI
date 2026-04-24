from __future__ import annotations

from gateway.services.classroom_tasks import (
    ClassroomTaskRegistry,
    ClassroomTaskSession,
    _write_incremental_preview_files,
    write_classroom_preview_files,
)
from gateway.schemas.classroom import ClassroomGenerateRequest, ClassroomGenerateResponse
from gateway.schemas.prep_runs import RunStatus
from edu_multi_agent.config import Settings


def test_write_classroom_preview_files_outputs_html_pages(tmp_path) -> None:
    result_payload = {
        "topic": "牛顿第二定律",
        "script": "第一页讲稿<to_next_page/>第二页讲稿",
        "page_blueprints": [
            {
                "idx": 0,
                "theme": "概念引入",
                "objective": "建立问题",
                "key_points": ["现象", "问题"],
                "target_reveal_count": 3,
                "quiz_goal": None,
            },
            {
                "idx": 1,
                "theme": "公式理解",
                "objective": "理解公式",
                "key_points": ["F=ma"],
                "target_reveal_count": 4,
                "quiz_goal": "检查公式",
            },
        ],
        "bundle": {
            "pages": [
                {
                    "idx": 0,
                    "html": '<section class="card" data-idx="0"><div class="reveal">第一页</div><script>window.to_next=function(){return false;};</script></section>',
                    "reveals": [{"narration": "第一页讲稿"}],
                    "quizzes": [],
                },
                {
                    "idx": 1,
                    "html": '<section class="card" data-idx="1"><div class="reveal">第二页</div><script>window.to_next=function(){return false;};</script></section>',
                    "reveals": [{"narration": "第二页讲稿"}],
                    "quizzes": [],
                },
            ]
        },
    }

    write_classroom_preview_files(tmp_path, result_payload)

    index_path = tmp_path / "html_preview" / "index.html"
    page_1_path = tmp_path / "html_preview" / "page_01.html"
    page_2_path = tmp_path / "html_preview" / "page_02.html"
    script_path = tmp_path / "script_preview.txt"

    assert index_path.is_file()
    assert page_1_path.is_file()
    assert page_2_path.is_file()
    assert script_path.is_file()

    index_content = index_path.read_text(encoding="utf-8")
    page_content = page_1_path.read_text(encoding="utf-8")
    script_content = script_path.read_text(encoding="utf-8")

    assert "概念引入" in index_content
    assert 'event.key !== "ArrowRight"' in page_content
    assert '<section class="card" data-idx="0">' in page_content
    assert "第一页讲稿<to_next_page/>第二页讲稿" in script_content


def test_incremental_preview_writes_html_when_slide_node_completes(tmp_path) -> None:
    event = {
        "event": "node_completed",
        "node": "slide",
        "data": {
            "page_idx": 0,
            "page_blueprint": {
                "idx": 0,
                "theme": "概念引入",
            },
            "html": '<section class="card" data-idx="0"><script>window.to_next=function(){return false;};</script></section>',
        },
    }

    _write_incremental_preview_files(tmp_path, event)

    page_path = tmp_path / "html_preview" / "page_01.html"
    assert page_path.is_file()
    content = page_path.read_text(encoding="utf-8")
    assert "概念引入" in content
    assert '<section class="card" data-idx="0">' in content


def test_incremental_preview_writes_script_when_assemble_script_completes(tmp_path) -> None:
    event = {
        "event": "node_completed",
        "node": "assemble_script",
        "data": {
            "script": "第一页讲稿<to_next_page/>第二页讲稿",
        },
    }

    _write_incremental_preview_files(tmp_path, event)

    script_path = tmp_path / "script_preview.txt"
    assert script_path.is_file()
    assert "第一页讲稿<to_next_page/>第二页讲稿" in script_path.read_text(encoding="utf-8")


class DummyLLMClient:
    def __init__(self) -> None:
        self.model = object()


def _make_settings(tmp_path, *, debug_disable_voice: bool = True) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
        debug_disable_voice=debug_disable_voice,
    )


def _make_result_payload() -> dict:
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


def test_run_session_skips_voice_when_debug_flag_enabled(tmp_path, monkeypatch) -> None:
    registry = ClassroomTaskRegistry(_make_settings(tmp_path, debug_disable_voice=True), DummyLLMClient())
    session = ClassroomTaskSession(
        run_id="run_123",
        request=ClassroomGenerateRequest(topic="牛顿第二定律", materials=["教材"]),
        output_dir=tmp_path,
        created_at="2026-04-23T10:00:00+08:00",
    )

    monkeypatch.setattr(
        "gateway.services.classroom_tasks.run_classroom_workflow",
        lambda *args, **kwargs: ClassroomGenerateResponse.model_validate(_make_result_payload()),
    )

    voice_calls: list[str] = []
    registry.voice_service.synthesize_classroom_audio = lambda *_args, **_kwargs: voice_calls.append("called")  # type: ignore[method-assign]

    registry._run_session(session)

    assert voice_calls == []
    assert session.status == RunStatus.succeeded
    assert any(event["event"] == "voice_skipped" for event in session.events)
