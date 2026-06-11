from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from edu_multi_agent.config import Settings
from edu_multi_agent.models import ArtifactResult

from gateway.schemas.classroom import ClassroomGenerateRequest
from gateway.schemas.prep_runs import RunStatus
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

    def fake_build_graph(*, outline_agent, llm, slide_prompt_file="slide.md", event_callback=None):
        captured["outline_result"] = outline_agent({"topic": "牛顿第二定律", "materials": ["教材"]})
        captured["llm"] = llm
        captured["slide_prompt_file"] = slide_prompt_file
        captured["has_event_callback"] = callable(event_callback) if event_callback is not None else False
        return FakeGraph()

    monkeypatch.setattr(classroom_service, "build_graph", fake_build_graph)

    payload = ClassroomGenerateRequest(
        topic="牛顿第二定律",
        materials=["教材"],
        outline={"title": "牛顿第二定律"},
        slide_prompt_file="slide.creative.md",
    )
    response = classroom_service.generate_classroom_bundle(
        payload,
        DummyLLMClient(),
    )

    assert captured["outline_result"] == {"outline": {"title": "牛顿第二定律"}}
    assert captured["invoke_state"] == {
        "topic": "牛顿第二定律",
        "materials": ["教材"],
        "media_resources": [],
    }
    assert captured["slide_prompt_file"] == "slide.creative.md"
    assert captured["has_event_callback"] is False
    assert response.outline_source == "request"
    assert response.page_blueprints[0].theme == "概念引入"
    assert response.page_count == 1
    assert response.bundle.pages[0].reveals[0].narration == "第一页。"


def test_build_classroom_request_from_prep_view_uses_prep_materials(tmp_path: Path) -> None:
    output_dir = tmp_path / "outputs" / "prep_run_001"
    output_dir.mkdir(parents=True)

    plan_path = output_dir / "00_supervisor" / "preparation_plan.md"
    plan_path.parent.mkdir(parents=True)
    plan_path.write_text("# 备课计划\n\n聚焦牛顿第二定律。", encoding="utf-8")

    study_guide_path = output_dir / "01_study_guide" / "study_guide.md"
    study_guide_path.parent.mkdir(parents=True)
    study_guide_path.write_text("# 学案\n\n解释力、质量与加速度的关系。", encoding="utf-8")

    practice_path = output_dir / "02_practice" / "practice_questions.json"
    practice_path.parent.mkdir(parents=True)
    practice_path.write_text(
        '[{"id":"q1","question_type":"MultipleChoice","question":"哪一个公式表示牛顿第二定律？","options":["F=ma","E=mc^2"],"correct_answer":"F=ma","analysis":"公式辨析"}]',
        encoding="utf-8",
    )

    view = {
        "run_id": "prep_run_001",
        "status": RunStatus.succeeded,
        "output_dir": str(output_dir),
        "request": {
            "learning_goal": "理解牛顿第二定律",
            "subject": "Physics",
            "grade_level": "初中",
            "learner_profile": "需要生活化讲解的混合能力班级",
            "notes": "强调公式与受力分析",
            "language": "zh-CN",
        },
        "plan": {
            "plan_summary": "先建立力与加速度的对应关系，再进入例题。",
            "teaching_focus": ["理解 F=ma", "区分质量与重量"],
            "required_materials": ["小车实验示意图"],
            "teacher_checklist": ["确认例题难度递进"],
            "quality_bar": ["语言准确", "例子贴近生活"],
        },
        "artifacts": [
            ArtifactResult(
                agent_name="study_guide",
                title="学案 Agent",
                summary="产出了面向学生的学习指南。",
                output_dir=str(study_guide_path.parent),
                files=[str(study_guide_path)],
                notes=[],
                status="completed",
            ),
            ArtifactResult(
                agent_name="practice",
                title="练习 Agent",
                summary="产出了可直接练习的题库。",
                output_dir=str(practice_path.parent),
                files=[str(practice_path)],
                notes=[],
                status="completed",
            ),
        ],
        "plan_path": str(plan_path),
        "report_path": None,
    }

    payload = classroom_service.build_classroom_request_from_prep_view(view)

    assert payload.topic == "理解牛顿第二定律"
    assert payload.source_prep_run_id == "prep_run_001"
    assert payload.outline["source_prep_run_id"] == "prep_run_001"
    assert payload.slide_prompt_file == "slide.md"
    assert any("学案 Agent" in material for material in payload.materials)
    assert any("study_guide.md" in material for material in payload.materials)
    assert any("practice_questions.json" in material for material in payload.materials)


def test_build_classroom_request_from_prep_view_accepts_custom_slide_prompt_file(tmp_path: Path) -> None:
    output_dir = tmp_path / "outputs" / "prep_run_001"
    output_dir.mkdir(parents=True)

    view = {
        "run_id": "prep_run_001",
        "status": RunStatus.succeeded,
        "output_dir": str(output_dir),
        "request": {
            "learning_goal": "理解牛顿第二定律",
            "subject": "Physics",
            "grade_level": "初中",
            "learner_profile": "混合能力班级",
            "notes": "强调公式与受力分析",
            "language": "zh-CN",
        },
        "plan": {},
        "artifacts": [],
        "plan_path": None,
        "report_path": None,
    }

    payload = classroom_service.build_classroom_request_from_prep_view(
        view,
        slide_prompt_file="slide.creative.md",
    )

    assert payload.slide_prompt_file == "slide.creative.md"


def test_build_classroom_request_from_prep_view_requires_completed_run() -> None:
    with pytest.raises(HTTPException, match="课前任务尚未完成"):
        classroom_service.build_classroom_request_from_prep_view(
            {
                "run_id": "prep_run_002",
                "status": RunStatus.running,
                "output_dir": "D:/tmp/prep_run_002",
                "request": {
                    "learning_goal": "理解牛顿第二定律",
                    "subject": "Physics",
                    "grade_level": "初中",
                    "learner_profile": "混合能力班级",
                    "notes": "None",
                    "language": "zh-CN",
                },
                "artifacts": [],
            }
        )
