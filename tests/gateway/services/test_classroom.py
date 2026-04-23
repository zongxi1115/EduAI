from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from edu_multi_agent.config import Settings

from gateway.schemas.classroom import ClassroomGenerateRequest
from gateway.services import classroom as classroom_service


class DummyLLMClient:
    def __init__(self) -> None:
        self.model = object()


def test_resolve_outline_node_prefers_inline_outline() -> None:
    outline = {"title": "牛顿第二定律"}

    outline_node, source = classroom_service.resolve_outline_node(
        inline_outline=outline,
        outline_agent=lambda _state: {"outline": {"title": "不会被调用"}},
    )

    assert source == "request"
    assert outline_node({}) == {"outline": outline}


def test_resolve_outline_node_accepts_string_outline() -> None:
    outline_node, source = classroom_service.resolve_outline_node(
        inline_outline="第一部分：定义\n第二部分：例题",
        outline_agent=None,
    )

    assert source == "request"
    assert outline_node({}) == {
        "outline": {"raw_outline_text": "第一部分：定义\n第二部分：例题"}
    }


def test_resolve_outline_node_accepts_array_outline() -> None:
    outline_node, source = classroom_service.resolve_outline_node(
        inline_outline=["定义", "公式", "例题"],
        outline_agent=None,
    )

    assert source == "request"
    assert outline_node({}) == {
        "outline": {"raw_outline_items": ["定义", "公式", "例题"]}
    }


def test_resolve_outline_node_wraps_server_callable() -> None:
    outline_node, source = classroom_service.resolve_outline_node(
        inline_outline=None,
        outline_agent=lambda _state: {"title": "服务端大纲"},
    )

    assert source == "server"
    assert outline_node({"topic": "test"}) == {"outline": {"title": "服务端大纲"}}


def test_resolve_outline_node_wraps_server_string_result() -> None:
    outline_node, source = classroom_service.resolve_outline_node(
        inline_outline=None,
        outline_agent=lambda _state: "服务端简易大纲",
    )

    assert source == "server"
    assert outline_node({"topic": "test"}) == {
        "outline": {"raw_outline_text": "服务端简易大纲"}
    }


def test_resolve_outline_node_requires_outline_when_server_agent_missing() -> None:
    with pytest.raises(HTTPException, match="Missing outline"):
        classroom_service.resolve_outline_node(
            inline_outline=None,
            outline_agent=None,
        )


def test_parse_classroom_script_returns_structured_pages() -> None:
    response = classroom_service.parse_classroom_script(
        "Intro narration.<on_slide>F = ma</on_slide>\n<to_next/>\nSecond reveal."
    )

    assert response.page_count == 1
    assert response.pages[0].reveals[0].on_slide == "F = ma"
    assert response.pages[0].reveals[1].narration == "Second reveal."


def test_generate_classroom_bundle_builds_response(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeGraph:
        def invoke(self, state: dict[str, object]) -> dict[str, object]:
            captured["invoke_state"] = state
            return {
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
                "pages": [
                    {
                        "idx": 0,
                        "reveals": [{"narration": "第一页。", "on_slide": "F = ma"}],
                        "quizzes": [],
                        "on_slide_summary": "F = ma",
                    }
                ],
                "assembled": {
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

    def fake_build_graph(*, outline_agent, llm, event_callback=None):
        captured["outline_result"] = outline_agent({"topic": "牛顿第二定律", "materials": ["教材"]})
        captured["llm"] = llm
        captured["has_event_callback"] = callable(event_callback) if event_callback is not None else False
        return FakeGraph()

    monkeypatch.setattr(classroom_service, "build_graph", fake_build_graph)

    payload = ClassroomGenerateRequest(
        topic="牛顿第二定律",
        materials=["教材"],
        outline={"title": "牛顿第二定律"},
    )
    response = classroom_service.generate_classroom_bundle(
        payload,
        DummyLLMClient(),
    )

    assert captured["outline_result"] == {"outline": {"title": "牛顿第二定律"}}
    assert captured["invoke_state"] == {"topic": "牛顿第二定律", "materials": ["教材"]}
    assert captured["has_event_callback"] is False
    assert response.outline_source == "request"
    assert response.page_blueprints[0].theme == "概念引入"
    assert response.page_count == 1
    assert response.bundle.pages[0].reveals[0].narration == "第一页。"
