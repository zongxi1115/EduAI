from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from edu_multi_agent.config import Settings

from gateway.app import create_app
from gateway.schemas.practice_review import PracticeReviewResponse


class DummyLLMClient:
    def __init__(self, response: PracticeReviewResponse | None = None) -> None:
        self.model = object()
        self._response = response

    def invoke_json(self, _system_prompt, _user_prompt, _schema):
        if self._response is None:
            raise AssertionError("invoke_json was called without a prepared response.")
        return self._response


def _make_settings(tmp_path: Path) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
    )


def test_ingest_review_endpoint_persists_and_reads_back_model(tmp_path: Path) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    client = TestClient(app)

    ingest_response = client.post(
        "/api/v1/learner-models/ingest-review",
        json={
            "learner_id": "stu_router_001",
            "session_id": "session_router_001",
            "source": "practice_review_local",
            "learning_goal": "理解二次项系数与开口方向的关系",
            "question": {
                "id": "question_router_001",
                "question_type": "MultipleChoice",
                "question": "哪个选项说明 a<0 时向下开口？",
                "analysis": "概念辨析。",
                "need_ai_judge": False,
                "options": ["A", "B", "C", "D"],
                "correct_answer": "B",
                "skill_tags": ["理解二次项系数与开口方向"],
                "difficulty": 0.3,
            },
            "student_answer": "B",
            "submission_context": {},
            "review": {
                "correctness": "correct",
                "score": 100,
                "summary": "概念判断正确。",
                "strengths": ["选中了正确答案。"],
                "issues": [],
                "review_advice": ["可以继续解释原因。"],
                "reference_points": ["a<0 时向下开口。"],
                "limitations": [],
            },
        },
    )

    assert ingest_response.status_code == 200
    ingest_payload = ingest_response.json()
    assert ingest_payload["snapshot"]["learner_id"] == "stu_router_001"
    assert ingest_payload["snapshot"]["total_events"] == 1

    model_response = client.get("/api/v1/learner-models/stu_router_001")
    assert model_response.status_code == 200
    model_payload = model_response.json()
    assert model_payload["learner"]["total_events"] == 1
    assert model_payload["snapshot"]["prompt_profile"]
    assert len(model_payload["recent_events"]) == 1


def test_practice_review_judge_updates_learner_model_snapshot(tmp_path: Path) -> None:
    prepared_review = PracticeReviewResponse(
        correctness="partially_correct",
        score=72,
        summary="知道结论，但解释还不够完整。",
        strengths=["能说出开口方向。"],
        issues=["对符号和函数值变化趋势的联系解释不够完整。"],
        review_advice=["补充说明 a<0 时函数值整体变化趋势。"],
        reference_points=["a 的符号决定开口方向。"],
        limitations=[],
        skill_judgments=[
            {
                "skill_id": "math_quadratic_opening",
                "display_name": "理解二次项系数与开口方向",
                "score": 0.72,
                "coverage": 0.95,
                "confidence": 0.82,
                "reasoning_quality": 0.6,
                "misconception_tags": ["符号与图像方向关系解释不完整"],
                "observation": "能给结论，但机制解释不完整。",
            }
        ],
        learner_observations=["结论记住了，但机制解释仍需支架。"],
    )
    app = create_app(
        settings=_make_settings(tmp_path),
        llm_client=DummyLLMClient(prepared_review),
    )
    client = TestClient(app)

    response = client.post(
        "/api/v1/practice-review/judge",
        json={
            "learner_id": "stu_router_002",
            "session_id": "session_router_002",
            "learning_goal": "理解二次项系数与开口方向的关系",
            "question": {
                "id": "question_router_002",
                "question_type": "ShortAnswer",
                "question": "为什么 a<0 时抛物线向下开口？",
                "analysis": "考查符号与图像关系。",
                "need_ai_judge": True,
                "reference_answer": "因为 a 的符号决定开口方向。",
                "skill_tags": ["理解二次项系数与开口方向"],
                "difficulty": 0.45,
            },
            "student_answer": "因为负号会让图像朝下。",
            "submission_context": {},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["learner_snapshot"]["learner_id"] == "stu_router_002"
    assert payload["learner_snapshot"]["total_events"] == 1

    model_response = client.get("/api/v1/learner-models/stu_router_002/events")
    assert model_response.status_code == 200
    events_payload = model_response.json()
    assert events_payload["total"] == 1
    assert events_payload["items"][0]["question_id"] == "question_router_002"
