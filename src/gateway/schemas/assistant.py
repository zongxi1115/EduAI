from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SelectionQuestionRequest(BaseModel):
    """针对一段选中文本发起 AI 问答的请求体。"""

    context: str | None = Field(
        default=None,
        description=(
            "可选的上下文原文，例如包含选区的整段、整节或整页内容。"
        ),
    )
    selection: str = Field(
        ...,
        min_length=1,
        description="前端当前精确选中的文本内容。",
    )
    question: str = Field(
        ...,
        min_length=1,
        description="用户针对该选区提出的问题。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "context": (
                    "二次函数 y = ax^2 + bx + c 的图像是一条抛物线，其开口方向由 a 的正负决定。"
                ),
                "selection": "开口方向由 a 的正负决定",
                "question": "为什么 a 为负数时抛物线开口向下？",
            }
        }
    )
