from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path as ApiPath, Query

from ..dependencies import get_learner_model_service
from ..schemas.learner_models import (
    LearnerEventListResponse,
    LearnerModelResponse,
    LearnerReviewIngestRequest,
    LearnerReviewIngestResponse,
)
from ..schemas.practice_review import (
    PracticeReviewQuestion,
    PracticeReviewRequest,
    PracticeReviewResponse,
)
from ..services.learner_models import LearnerModelService


router = APIRouter(prefix="/api/v1/learner-models", tags=["学习者画像"])

LearnerModelServiceDep = Annotated[LearnerModelService, Depends(get_learner_model_service)]


@router.get(
    "/{learner_id}",
    response_model=LearnerModelResponse,
    summary="获取学习者画像",
    description="返回指定学习者的长期技能状态、总体能力评估以及最近学习事件。",
    response_description="完整学习者画像与最近事件。",
)
def get_learner_model(
    learner_model_service: LearnerModelServiceDep,
    learner_id: str = ApiPath(description="学习者唯一标识。"),
    event_limit: int = Query(20, ge=1, le=100, description="附带返回的最近事件数量。"),
) -> LearnerModelResponse:
    try:
        return learner_model_service.get_model_response(learner_id, event_limit=event_limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown learner_id: {learner_id}") from exc


@router.get(
    "/{learner_id}/events",
    response_model=LearnerEventListResponse,
    summary="获取学习者事件时间线",
    description="按时间倒序返回指定学习者最近的学习事件日志。",
    response_description="学习事件列表。",
)
def list_learner_events(
    learner_model_service: LearnerModelServiceDep,
    learner_id: str = ApiPath(description="学习者唯一标识。"),
    limit: int = Query(50, ge=1, le=200, description="最多返回的事件条数。"),
) -> LearnerEventListResponse:
    try:
        return learner_model_service.get_event_list(learner_id, limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown learner_id: {learner_id}") from exc


@router.post(
    "/ingest-review",
    response_model=LearnerReviewIngestResponse,
    summary="写入一次学习反馈事件",
    description=(
        "把已经得到的批阅结果写入学习者画像系统。"
        "适合前端本地自动判题后回传，或其他外部评测链路做统一归档。"
    ),
    response_description="更新后的学习者摘要与本次写入的事件。",
)
def ingest_learner_review(
    payload: LearnerReviewIngestRequest,
    learner_model_service: LearnerModelServiceDep,
) -> LearnerReviewIngestResponse:
    question = PracticeReviewQuestion.model_validate(payload.question)
    review = PracticeReviewResponse.model_validate(payload.review)
    request = PracticeReviewRequest(
        learner_id=payload.learner_id,
        session_id=payload.session_id,
        learning_goal=payload.learning_goal,
        graph_context=payload.graph_context,
        question=question,
        student_answer=payload.student_answer,
        submission_context=payload.submission_context,
    )
    _record, event = learner_model_service.ingest_review(
        request,
        review,
        source=payload.source,
    )
    snapshot = learner_model_service.get_model_response(payload.learner_id, event_limit=1).snapshot
    return LearnerReviewIngestResponse(
        snapshot=snapshot,
        stored_event=event,
    )
