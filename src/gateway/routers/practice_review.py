from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import now_iso
from edu_multi_agent.llm import LLMClient

from ..dependencies import get_learner_model_service, get_llm_client, get_settings
from ..schemas.practice_review import (
    PaperPracticeReviewRequest,
    PaperPracticeReviewResponse,
    PracticeReviewCapabilitiesResponse,
    PracticeReviewRequest,
    PracticeReviewResponse,
)
from ..services.learner_models import LearnerModelService
from ..services.practice_review import build_paper_practice_review_prompts, build_practice_review_prompts


router = APIRouter(prefix="/api/v1/practice-review", tags=["题目批阅"])

LLMClientDep = Annotated[LLMClient, Depends(get_llm_client)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
LearnerModelServiceDep = Annotated[LearnerModelService, Depends(get_learner_model_service)]


@router.get(
    "/capabilities",
    response_model=PracticeReviewCapabilitiesResponse,
    summary="获取题目批阅能力配置",
    response_description="返回当前后端是否开启视觉批阅能力。",
)
def get_practice_review_capabilities(
    settings: SettingsDep,
) -> PracticeReviewCapabilitiesResponse:
    """Return the current practice-review capabilities."""

    return PracticeReviewCapabilitiesResponse(support_vision=settings.support_vision)


@router.post(
    "/judge",
    response_model=PracticeReviewResponse,
    summary="AI 批阅练习题答案",
    description=(
        "根据题干、参考答案/参考代码、学生作答以及前端提交的补充上下文，"
        "返回结构化的 AI 批阅结果和审阅建议。"
    ),
    response_description="结构化批阅结果，包括判断、分数、问题和建议。",
)
def judge_practice_answer(
    payload: PracticeReviewRequest,
    llm_client: LLMClientDep,
    settings: SettingsDep,
    learner_model_service: LearnerModelServiceDep,
) -> PracticeReviewResponse:
    """Judge a practice-question submission with the shared LLM client."""

    if payload.question.question_type == "Drawing":
        if not settings.support_vision:
            raise HTTPException(
                status_code=409,
                detail="当前模型未开启视觉能力，不支持作图题评析。",
            )
        drawing_image_data_url = payload.submission_context.get("drawing_image_data_url")
        if not isinstance(drawing_image_data_url, str) or not drawing_image_data_url.strip():
            raise HTTPException(
                status_code=400,
                detail="作图题批阅需要同时提交绘图图像。",
            )

    system_prompt, user_prompt = build_practice_review_prompts(payload)
    result = llm_client.invoke_json(system_prompt, user_prompt, PracticeReviewResponse)
    judged_result = result.model_copy(update={"judged_at": now_iso()})
    learner_id = (payload.learner_id or "").strip()
    if learner_id:
        _record, _event = learner_model_service.ingest_review(
            payload,
            judged_result,
            source="practice_review_ai",
        )
        judged_result = judged_result.model_copy(
            update={"learner_snapshot": learner_model_service.get_model_response(learner_id, event_limit=1).snapshot}
        )
    return judged_result


@router.post(
    "/paper/judge",
    response_model=PaperPracticeReviewResponse,
    summary="AI 批阅纸笔答案图片",
    description=(
        "批阅学生上传的一张或多张纸笔作答图片。当前接口需要后端开启视觉能力，"
        "否则会直接返回错误。"
    ),
    response_description="整卷纸笔批阅结果，包括总分、整卷建议和按题号拆分的反馈。",
)
def judge_paper_practice_answer(
    payload: PaperPracticeReviewRequest,
    llm_client: LLMClientDep,
    settings: SettingsDep,
) -> PaperPracticeReviewResponse:
    """Judge uploaded paper-answer images with a vision-capable model."""

    if not settings.support_vision:
        raise HTTPException(
            status_code=409,
            detail="当前模型未开启视觉能力，不支持纸笔答案图片批阅。",
        )

    if any(not image.data_url.strip().startswith("data:image/") for image in payload.answer_images):
        raise HTTPException(
            status_code=400,
            detail="纸笔答案批阅仅支持图片文件。",
        )

    system_prompt, user_prompt = build_paper_practice_review_prompts(payload)
    result = llm_client.invoke_json(system_prompt, user_prompt, PaperPracticeReviewResponse)
    return result.model_copy(
        update={
            "answer_image_count": len(payload.answer_images),
            "judged_at": now_iso(),
        }
    )
