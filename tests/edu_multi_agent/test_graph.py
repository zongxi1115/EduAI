from __future__ import annotations

import json
import pytest
from edu_multi_agent.graph import (
    _compact_lines,
    _count_question_types,
    _build_global_question_id,
    _build_slideshow_payload,
    _validate_generated_files,
)
from edu_multi_agent.graph import (
    _normalize_practice_blueprint,
    _build_fallback_practice_blueprint,
)
from edu_multi_agent.file_io import render_slide_html
from edu_multi_agent.models import ArtifactResult, GenerationRequest, PreparationPlan


class TestCompactLines:
    def test_empty_list(self):
        result = _compact_lines([])
        assert result == []

    def test_whitespace_filtered(self):
        result = _compact_lines(["", "  ", "text"])
        assert result == ["text"]

    def test_duplicates_removed(self):
        result = _compact_lines(["a", "b", "a", "c"])
        assert result == ["a", "b", "c"]

    def test_strip_whitespace(self):
        result = _compact_lines(["  a  ", "b"])
        assert result == ["a", "b"]


class TestCountQuestionTypes:
    def test_empty_payload(self):
        result = _count_question_types([])
        assert result == {}

    def test_single_type(self):
        payload = [
            {"question_type": "MultipleChoice"},
            {"question_type": "MultipleChoice"},
        ]
        result = _count_question_types(payload)
        assert result["MultipleChoice"] == 2

    def test_multiple_types(self):
        payload = [
            {"question_type": "MultipleChoice"},
            {"question_type": "ShortAnswer"},
        ]
        result = _count_question_types(payload)
        assert result["MultipleChoice"] == 1
        assert result["ShortAnswer"] == 1

    def test_missing_type_handled(self):
        payload = [{}]
        result = _count_question_types(payload)
        assert result.get("None") == 1


class TestBuildGlobalQuestionId:
    def test_format(self):
        result = _build_global_question_id("run123", 1)
        assert result.startswith("question_run123_001_")
        assert len(result) > 20

    def test_index_included(self):
        result1 = _build_global_question_id("run123", 1)
        result2 = _build_global_question_id("run123", 2)
        assert result1 != result2


class TestNormalizePracticeBlueprint:
    def test_single_allocation_valid(self):
        from edu_multi_agent.models import PracticeBlueprint, PracticeQuestionAllocation
        blueprint = PracticeBlueprint(
            planning_summary="test",
            total_questions=5,
            topic_characteristics=["test"],
            distribution_principles=["test"],
            progression_plan=["test"],
            must_cover=["test"],
            question_allocations=[
                PracticeQuestionAllocation(
                    question_type="MultipleChoice",
                    count=5,
                    purpose="test",
                    competency_focus=["test"],
                )
            ],
        )
        result = _normalize_practice_blueprint(blueprint)
        assert len(result.question_allocations) == 1
        assert result.question_allocations[0].question_type == "MultipleChoice"

    def test_merges_same_type(self):
        from edu_multi_agent.models import PracticeBlueprint, PracticeQuestionAllocation
        blueprint = PracticeBlueprint(
            planning_summary="test",
            total_questions=5,
            topic_characteristics=["test"],
            distribution_principles=["test"],
            progression_plan=["test"],
            must_cover=["test"],
            question_allocations=[
                PracticeQuestionAllocation(
                    question_type="MultipleChoice",
                    count=2,
                    purpose="first",
                    competency_focus=["a"],
                ),
                PracticeQuestionAllocation(
                    question_type="MultipleChoice",
                    count=3,
                    purpose="second",
                    competency_focus=["b"],
                ),
            ],
        )
        result = _normalize_practice_blueprint(blueprint)
        assert len(result.question_allocations) == 1
        assert result.question_allocations[0].count == 5

    def test_respects_type_order(self):
        from edu_multi_agent.models import PracticeBlueprint, PracticeQuestionAllocation
        blueprint = PracticeBlueprint(
            planning_summary="test",
            total_questions=5,
            topic_characteristics=["a"],
            distribution_principles=["b"],
            progression_plan=["c"],
            must_cover=["d"],
            question_allocations=[
                PracticeQuestionAllocation(
                    question_type="Drawing",
                    count=1,
                    purpose="test",
                    competency_focus=["test"],
                ),
                PracticeQuestionAllocation(
                    question_type="FillInTheBlank",
                    count=1,
                    purpose="test",
                    competency_focus=["test"],
                ),
            ],
        )
        result = _normalize_practice_blueprint(blueprint)
        types = [a.question_type for a in result.question_allocations]
        assert types[0] == "FillInTheBlank"
        assert types[1] == "Drawing"


class TestBuildFallbackPracticeBlueprint:
    def test_implementation_keyword(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="实现排序算法",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=["算法"],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        assert any(a.question_type == "Coding" for a in result.question_allocations)

    def test_visual_keyword(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="几何作图",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=[],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        assert any(a.question_type == "Drawing" for a in result.question_allocations)

    def test_listening_keyword(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="听力练习",
            subject="英语",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=[],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        assert any(a.question_type == "Listening" for a in result.question_allocations)

    def test_default_min_questions(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="test",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=[],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        total = sum(a.count for a in result.question_allocations)
        assert total >= 6

    def test_default_max_questions(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="test",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=[],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        total = sum(a.count for a in result.question_allocations)
        assert total <= 10

    def test_default_includes_basic_types(self):
        from edu_multi_agent.models import GenerationRequest, PreparationPlan, AgentRoute
        request = GenerationRequest(
            learning_goal="test",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
        )
        plan = PreparationPlan(
            plan_summary="test",
            agent_routes=[],
            teaching_focus=[],
        )
        route = AgentRoute(
            agent_name="practice",
            selected=True,
            objective="生成练习",
            deliverables=[],
            focus_points=[],
        )
        result = _build_fallback_practice_blueprint(request, plan, route)
        types = {a.question_type for a in result.question_allocations}
        assert "MultipleChoice" in types
        assert "ShortAnswer" in types


class TestValidateGeneratedFiles:
    def test_valid_practice_questions(self):
        files = {
            "practice_questions.json": json.dumps([
                {
                    "question": "test",
                    "analysis": "test",
                    "question_type": "MultipleChoice",
                    "options": ["a", "b", "c", "d"],
                    "correct_answer": "a",
                    "id": "q1"
                }
            ])
        }
        _validate_generated_files(files)

    def test_invalid_json_raises(self):
        files = {
            "practice_questions.json": "not json"
        }
        with pytest.raises(json.JSONDecodeError):
            _validate_generated_files(files)

    def test_missing_required_fields(self):
        files = {
            "practice_questions.json": json.dumps([
                {
                    "question": "test",
                    "question_type": "MultipleChoice"
                }
            ])
        }
        with pytest.raises(ValueError, match="missing fields"):
            _validate_generated_files(files)

    def test_invalid_question_type(self):
        files = {
            "practice_questions.json": json.dumps([
                {
                    "question": "test",
                    "analysis": "test",
                    "question_type": "InvalidType",
                    "id": "q1"
                }
            ])
        }
        with pytest.raises(ValueError, match="invalid"):
            _validate_generated_files(files)

    def test_python_syntax_check(self):
        files = {
            "lesson_animation.py": "print('hello')"
        }
        _validate_generated_files(files)

    def test_python_syntax_error(self):
        files = {
            "lesson_animation.py": "print('hello"
        }
        with pytest.raises(SyntaxError):
            _validate_generated_files(files)


class TestBuildSlideshowPayload:
    def test_generates_slide_manifest_with_context(self):
        request = GenerationRequest(learning_goal="理解一次函数", subject="数学", grade_level="初中")
        plan = PreparationPlan(
            plan_summary="围绕一次函数图像、斜率和实际情境组织课堂。",
            teaching_focus=["理解斜率含义", "能读图判断变化趋势"],
            teacher_checklist=["先用情境导入", "再过渡到图像表示"],
            quality_bar=["内容连贯", "讲练结合"],
        )
        artifacts = [
            ArtifactResult(
                agent_name="study_guide",
                title="学案 Agent",
                summary="学案整理了预习重点和阅读顺序。",
                output_dir="/tmp/01_study_guide",
                files=[],
            ),
            ArtifactResult(
                agent_name="practice",
                title="练习 Agent",
                summary="题库按热身、巩固和迁移三个层次组织。",
                output_dir="/tmp/02_practice",
                files=[],
            ),
        ]

        payload = _build_slideshow_payload(request, plan, artifacts, run_id="run_123")

        assert payload["deck_title"].startswith("理解一次函数")
        assert payload["run_id"] == "run_123"
        assert len(payload["slides"]) >= 4
        assert payload["slides"][0]["script_context_before"] == "从课程开场进入本页。"
        assert payload["slides"][0]["html_file"].startswith("slides/")
        assert payload["slides"][-1]["interrupts"][0]["type"] == "reflection_prompt"

    def test_slide_html_runtime_contract_present(self):
        html = render_slide_html(
            "测试课堂演示稿",
            {
                "title": "核心概念",
                "teaching_goal": "讲清概念",
                "visual_type": "concept",
                "script_context_before": "上一页导入",
                "script_context_current": "本页解释概念与例子。",
                "script_context_after": "下一页进入练习。",
                "animation_steps": ["先讲定义", "再讲例子"],
                "speaker_notes": "强调易错点。",
                "interrupts": [{"type": "quiz_pause", "prompt": "让学生先判断一个例子。"}],
            },
        )

        assert "window.EduSlide" in html
        assert "to_next()" in html
        assert "先讲定义" in html
        assert "quiz_pause" in html
