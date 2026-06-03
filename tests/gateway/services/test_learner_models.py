from __future__ import annotations

import json
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


def _write_graph_fixture(tmp_path: Path) -> Path:
    graph_root = tmp_path / "graph_data"
    graph_root.mkdir(parents=True, exist_ok=True)
    (graph_root / "index.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "description": "test graphs",
                "datasets": [
                    {
                        "id": "high_math",
                        "title": "高等数学",
                        "file": "high_math.json",
                        "entry_points": ["导数与微分"],
                    },
                    {
                        "id": "university_physics",
                        "title": "大学物理",
                        "file": "physics.json",
                        "entry_points": ["经典力学"],
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (graph_root / "high_math.json").write_text(
        json.dumps(
            {
                "meta": {"subject": "高等数学"},
                "nodes": [
                    {
                        "id": "导数与微分",
                        "title": "导数与微分",
                        "sub_nodes": [
                            {
                                "id": "导数与微分::导数定义",
                                "title": "导数定义",
                                "links": ["导数与微分::求导法则"],
                            },
                            {
                                "id": "导数与微分::求导法则",
                                "title": "求导法则",
                            },
                        ],
                    }
                ],
                "edges": [
                    {
                        "source": "导数与微分::导数定义",
                        "target": "导数与微分::求导法则",
                        "relation": "supports",
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (graph_root / "physics.json").write_text(
        json.dumps(
            {
                "meta": {"subject": "大学物理"},
                "nodes": [
                    {
                        "id": "经典力学",
                        "title": "经典力学",
                        "sub_nodes": [
                            {
                                "id": "经典力学::牛顿运动定律",
                                "title": "牛顿运动定律",
                            }
                        ],
                    }
                ],
                "edges": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return graph_root


def test_enrich_generation_request_uses_graph_related_knowledge_points(tmp_path: Path) -> None:
    service = LearnerModelService(
        LearnerModelRepository(_make_settings(tmp_path)),
        graph_root=_write_graph_fixture(tmp_path),
    )

    request = PracticeReviewRequest(
        learner_id="stu_demo_001",
        session_id="session_alpha",
        learning_goal="学习高等数学中的：导数定义",
        question=PracticeReviewQuestion(
            id="question_demo_001",
            question_type="ShortAnswer",
            question="什么是导数定义？",
            analysis="考查学生是否理解导数的极限定义。",
            need_ai_judge=True,
            reference_answer="导数是函数在一点的瞬时变化率，可由差商极限给出。",
            skill_tags=["导数定义"],
            difficulty=0.45,
        ),
        student_answer="知道导数和变化率有关，但还不会完整写出极限形式。",
    )
    review = PracticeReviewResponse(
        correctness="partially_correct",
        score=68,
        summary="知道导数表示变化率，但极限定义还不完整。",
        strengths=["能说出导数和变化率相关。"],
        issues=["极限表达不完整。"],
        review_advice=["补充差商趋于极限的完整表达。"],
        reference_points=["导数定义来自差商极限。"],
        limitations=[],
    )

    record, event = service.ingest_review(request, review, source="practice_review_ai")

    assert event.learner_id == "stu_demo_001"
    assert record.total_events == 1
    assert record.total_sessions == 1
    assert "导数定义" in "".join(record.overall.weak_skills + record.overall.strong_skills)
    assert record.overall.prompt_profile

    next_request = GenerationRequest(
        learning_goal="学习高等数学中的：求导法则",
        subject="高等数学",
        grade_level="大学与成人",
        learner_id="stu_demo_001",
        learner_profile="Mixed-ability class that needs clear guidance, visual explanation, and structured practice.",
        notes="课程：高等数学；知识点：求导法则",
        language="zh-CN",
    )
    enriched = service.enrich_generation_request(next_request)

    assert enriched.learner_profile != next_request.learner_profile
    assert "[图谱关联学情]" in enriched.learner_profile
    assert "当前目标知识点：求导法则" in enriched.learner_profile
    assert "导数定义" in enriched.learner_profile
    assert "结合图谱关联学情优先处理" in enriched.notes


def test_enrich_generation_request_skips_unrelated_graph_topics(tmp_path: Path) -> None:
    service = LearnerModelService(
        LearnerModelRepository(_make_settings(tmp_path)),
        graph_root=_write_graph_fixture(tmp_path),
    )

    request = PracticeReviewRequest(
        learner_id="stu_demo_001",
        session_id="session_alpha",
        learning_goal="学习高等数学中的：导数定义",
        question=PracticeReviewQuestion(
            id="question_demo_001",
            question_type="ShortAnswer",
            question="什么是导数定义？",
            analysis="考查学生是否理解导数的极限定义。",
            need_ai_judge=True,
            reference_answer="导数是函数在一点的瞬时变化率，可由差商极限给出。",
            skill_tags=["导数定义"],
            difficulty=0.45,
        ),
        student_answer="导数和变化率有关。",
    )
    review = PracticeReviewResponse(
        correctness="partially_correct",
        score=68,
        summary="知道导数表示变化率，但极限定义还不完整。",
        strengths=["能说出导数和变化率相关。"],
        issues=["极限表达不完整。"],
        review_advice=["补充差商趋于极限的完整表达。"],
        reference_points=["导数定义来自差商极限。"],
        limitations=[],
    )
    service.ingest_review(request, review, source="practice_review_ai")

    next_request = GenerationRequest(
        learning_goal="学习大学物理中的：牛顿运动定律",
        subject="大学物理",
        grade_level="大学与成人",
        learner_id="stu_demo_001",
        learner_profile="Mixed-ability class that needs clear guidance, visual explanation, and structured practice.",
        notes="课程：大学物理；知识点：牛顿运动定律",
        language="zh-CN",
    )

    enriched = service.enrich_generation_request(next_request)

    assert enriched == next_request


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
