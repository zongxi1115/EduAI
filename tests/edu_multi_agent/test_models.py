from __future__ import annotations

import pytest
from edu_multi_agent.models import (
    GenerationRequest,
    PreparationPlan,
    AgentRoute,
    PracticeBlueprint,
    PracticeQuestionAllocation,
    AgentName,
    QuestionTypeName,
)


class TestGenerationRequest:
    def test_required_fields(self):
        req = GenerationRequest(learning_goal="测试学习目标")
        assert req.learning_goal == "测试学习目标"

    def test_default_fields(self):
        req = GenerationRequest(learning_goal="测试")
        assert req.subject == "General"
        assert req.grade_level == "Unspecified"
        assert req.notes == "None"
        assert req.language == "zh-CN"

    def test_custom_fields(self):
        req = GenerationRequest(
            learning_goal="测试",
            subject="数学",
            grade_level="初中",
            learner_profile="初学者",
            notes="额外说明",
        )
        assert req.subject == "数学"
        assert req.grade_level == "初中"

    def test_empty_learning_goal(self):
        with pytest.raises(Exception):
            GenerationRequest(learning_goal="")


class TestAgentRoute:
    def test_required_fields(self):
        route = AgentRoute(agent_name="study_guide", objective="生成学案")
        assert route.agent_name == "study_guide"
        assert route.objective == "生成学案"

    def test_default_fields(self):
        route = AgentRoute(agent_name="practice", objective="生成练习")
        assert route.selected is True
        assert route.deliverables == []
        assert route.focus_points == []

    def test_custom_deliverables(self):
        route = AgentRoute(
            agent_name="practice",
            objective="生成练习",
            deliverables=["practice_questions.json"],
            focus_points=["重点1"],
        )
        assert "practice_questions.json" in route.deliverables


class TestPreparationPlan:
    def test_required_fields(self):
        plan = PreparationPlan(plan_summary="测试计划")
        assert plan.plan_summary == "测试计划"

    def test_default_fields(self):
        plan = PreparationPlan(plan_summary="测试")
        assert plan.stage == "pre_teaching_preparation"
        assert plan.required_materials == []
        assert plan.teacher_checklist == []
        assert plan.teaching_focus == []
        assert plan.quality_bar == []
        assert plan.agent_routes == []

    def test_with_routes(self):
        routes = [
            AgentRoute(agent_name="study_guide", objective="生成学案"),
            AgentRoute(agent_name="practice", objective="生成练习"),
        ]
        plan = PreparationPlan(plan_summary="测试", agent_routes=routes)
        assert len(plan.agent_routes) == 2


class TestPracticeQuestionAllocation:
    def test_required_fields(self):
        alloc = PracticeQuestionAllocation(
            question_type="MultipleChoice",
            count=5,
            purpose="测试目的",
        )
        assert alloc.question_type == "MultipleChoice"
        assert alloc.count == 5

    def test_default_competency_focus(self):
        alloc = PracticeQuestionAllocation(
            question_type="ShortAnswer",
            count=3,
            purpose="目的",
        )
        assert alloc.competency_focus == []

    def test_custom_competency_focus(self):
        alloc = PracticeQuestionAllocation(
            question_type="Coding",
            count=2,
            purpose="目的",
            competency_focus=["算法", "实现"],
        )
        assert "算法" in alloc.competency_focus


class TestPracticeBlueprint:
    def test_required_fields(self):
        blueprint = PracticeBlueprint(
            planning_summary="测试摘要",
            total_questions=10,
        )
        assert blueprint.planning_summary == "测试摘要"
        assert blueprint.total_questions == 10

    def test_default_fields(self):
        blueprint = PracticeBlueprint(
            planning_summary="摘要",
            total_questions=5,
        )
        assert blueprint.topic_characteristics == []
        assert blueprint.distribution_principles == []
        assert blueprint.progression_plan == []
        assert blueprint.must_cover == []
        assert blueprint.question_allocations == []

    def test_with_allocations(self):
        allocations = [
            PracticeQuestionAllocation(
                question_type="MultipleChoice",
                count=3,
                purpose="诊断",
            ),
            PracticeQuestionAllocation(
                question_type="ShortAnswer",
                count=2,
                purpose="巩固",
            ),
        ]
        blueprint = PracticeBlueprint(
            planning_summary="摘要",
            total_questions=5,
            question_allocations=allocations,
        )
        assert len(blueprint.question_allocations) == 2


class TestAgentName:
    def test_valid_names(self):
        assert "study_guide" in [name for name in AgentName.__args__]
        assert "practice" in [name for name in AgentName.__args__]
        assert "manim" in [name for name in AgentName.__args__]
        assert "interactive_web" in [name for name in AgentName.__args__]
        assert "slideshow" in [name for name in AgentName.__args__]


class TestQuestionTypeName:
    def test_all_types(self):
        types = list(QuestionTypeName.__args__)
        assert "FillInTheBlank" in types
        assert "MultipleChoice" in types
        assert "ShortAnswer" in types
        assert "Listening" in types
        assert "Coding" in types
        assert "Drawing" in types
