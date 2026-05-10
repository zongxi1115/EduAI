from __future__ import annotations

from pathlib import Path

from edu_multi_agent.config import Settings
from edu_multi_agent.models import GenerationRequest

from gateway.schemas.practice_review import (
    PracticeReviewQuestion,
    PracticeReviewRequest,
    PracticeReviewResponse,
)
from gateway.services.learner_models import LearnerModelRepository, LearnerModelService


def _make_settings(tmp_path: Path) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
    )


def test_ingest_review_updates_skill_state_and_enriches_generation_request(tmp_path: Path) -> None:
    service = LearnerModelService(LearnerModelRepository(_make_settings(tmp_path)))

    request = PracticeReviewRequest(
        learner_id="stu_demo_001",
        session_id="session_alpha",
        learning_goal="理解二次项系数与开口方向的关系",
        question=PracticeReviewQuestion(
            id="question_demo_001",
            question_type="ShortAnswer",
            question="为什么二次项系数为负时抛物线开口向下？",
            analysis="考查学生是否理解 a 的符号与开口方向关系。",
            need_ai_judge=True,
            reference_answer="因为 a<0 时，图像向下张开。",
            skill_tags=["理解二次项系数与开口方向"],
            difficulty=0.45,
        ),
        student_answer="因为负号会让抛物线朝下。",
    )
    review = PracticeReviewResponse(
        correctness="partially_correct",
        score=68,
        summary="知道结论，但解释机制还不完整。",
        strengths=["能先说出开口方向。"],
        issues=["把符号与图像方向的因果解释得过于简化。"],
        review_advice=["补充说明 a<0 时函数值变化趋势。"],
        reference_points=["a 的符号决定开口方向。"],
        limitations=[],
    )

    record, event = service.ingest_review(request, review, source="practice_review_ai")

    assert event.learner_id == "stu_demo_001"
    assert record.total_events == 1
    assert record.total_sessions == 1
    assert "理解二次项系数与开口方向" in "".join(record.overall.weak_skills + record.overall.strong_skills)
    assert record.overall.prompt_profile

    next_request = GenerationRequest(
        learning_goal="继续学习二次函数图像性质",
        subject="Mathematics",
        grade_level="初中",
        learner_id="stu_demo_001",
        learner_profile="Mixed-ability class that needs clear guidance, visual explanation, and structured practice.",
        notes="None",
        language="zh-CN",
    )
    enriched = service.enrich_generation_request(next_request)

    assert enriched.learner_profile != next_request.learner_profile
    assert "[历史学情摘要]" in enriched.learner_profile
    assert "下一轮建议" in enriched.learner_profile


def test_new_session_increments_session_count(tmp_path: Path) -> None:
    service = LearnerModelService(LearnerModelRepository(_make_settings(tmp_path)))

    base_question = PracticeReviewQuestion(
        id="question_demo_002",
        question_type="MultipleChoice",
        question="哪个选项能说明 a<0 时抛物线向下开口？",
        analysis="考查概念辨析。",
        need_ai_judge=False,
        options=["A", "B", "C", "D"],
        correct_answer="B",
        skill_tags=["理解二次项系数与开口方向"],
        difficulty=0.3,
    )
    base_review = PracticeReviewResponse(
        correctness="correct",
        score=100,
        summary="概念判断正确。",
        strengths=["选中了正确选项。"],
        issues=[],
        review_advice=["可以继续尝试解释原因。"],
        reference_points=["a<0 时开口向下。"],
        limitations=[],
    )

    for session_id in ("session_one", "session_two"):
        request = PracticeReviewRequest(
            learner_id="stu_demo_002",
            session_id=session_id,
            learning_goal="理解二次项系数与开口方向的关系",
            question=base_question,
            student_answer="B",
        )
        record, _event = service.ingest_review(request, base_review, source="practice_review_local")

    assert record.total_events == 2
    assert record.total_sessions == 2
