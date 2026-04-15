from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from edu_multi_agent.file_io import now_iso
from edu_multi_agent.llm import LLMClient

from ..dependencies import get_llm_client
from ..schemas.assistant import SelectionQuestionRequest
from ..services.assistant import build_selection_qa_prompts
from ..services.prep_runs import encode_sse


router = APIRouter(prefix="/api/v1/assistant", tags=["选区问答"])

LLMClientDep = Annotated[LLMClient, Depends(get_llm_client)]

SELECTION_QA_SSE_EXAMPLE = """event: started
data: {"timestamp":"2026-04-16T10:30:00+08:00","question":"为什么 a 为负数时抛物线开口向下？","selection_length":13,"has_context":true,"history_length":0}

event: delta
data: {"delta":"因为二次项系数 a 决定了抛物线的开口方向。"}

event: delta
data: {"delta":"当 a 为负数时，函数值会随着 |x| 增大而整体减小，所以图像向下张开。"}

event: completed
data: {"timestamp":"2026-04-16T10:30:02+08:00","answer":"因为二次项系数 a 决定了抛物线的开口方向。当 a 为负数时，函数值会随着 |x| 增大而整体减小，所以图像向下张开。"}
"""


@router.post(
    "/selection-qa/stream",
    summary="针对选中内容发起 AI 流式问答",
    description=(
        "针对前端当前选中的文本发起 AI 问答，并以 Server-Sent Events (SSE) 流式返回答案。"
        "这个接口不会创建后台任务，只会直接调用大模型并返回增量文本。"
        "请求体包含可选上下文 `context`、选区 `selection`、用户问题 `question`，"
        "以及可选的历史消息 `history`，用于支持追问。"
    ),
    response_description=(
        "返回包含 `started`、`delta`、`completed`、`error` 的 SSE 事件流。"
    ),
    responses={
        200: {
            "description": (
                "SSE 实时事件流。`started` 返回请求元信息，`delta` 逐段返回回答文本，"
                "`completed` 返回完整答案，`error` 表示调用失败。"
            ),
            "content": {
                "text/event-stream": {
                    "example": SELECTION_QA_SSE_EXAMPLE,
                }
            },
        }
    },
)
async def stream_selection_qa(
    payload: SelectionQuestionRequest,
    llm_client: LLMClientDep,
) -> StreamingResponse:
    """针对用户选中的文本与提问，流式返回尽量基于上下文的回答。"""
    system_prompt, user_prompt = build_selection_qa_prompts(payload)

    async def event_generator() -> Any:
        """按 SSE 格式生成问答事件。"""
        full_answer_parts: list[str] = []
        yield "retry: 3000\n\n"
        yield encode_sse(
            "started",
            {
                "timestamp": now_iso(),
                "question": payload.question,
                "selection_length": len((payload.selection or "").strip()),
                "has_context": bool((payload.context or "").strip()),
                "history_length": len(payload.history),
            },
        )

        try:
            async for chunk in llm_client.stream_text(system_prompt, user_prompt):
                if not chunk:
                    continue
                full_answer_parts.append(chunk)
                yield encode_sse("delta", {"delta": chunk})

            full_answer = "".join(full_answer_parts)
            yield encode_sse(
                "completed",
                {
                    "timestamp": now_iso(),
                    "answer": full_answer,
                },
            )
        except Exception as exc:
            yield encode_sse(
                "error",
                {
                    "timestamp": now_iso(),
                    "error": str(exc),
                },
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
