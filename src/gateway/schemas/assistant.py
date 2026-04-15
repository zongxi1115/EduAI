from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SelectionQuestionMessage(BaseModel):
    """单轮追问上下文中的一条历史消息。"""

    role: Literal["user", "assistant"] = Field(
        ...,
        description="消息发送方角色。",
    )
    content: str = Field(
        ...,
        min_length=1,
        description="该轮消息的文本内容。",
    )


class SelectionQuestionRequest(BaseModel):
    """针对一段选中文本发起 AI 问答的请求体。"""

    context: str | None = Field(
        default=None,
        description=(
            "可选的上下文原文，例如包含选区的整段、整节或整页内容。"
        ),
    )
    selection: str | None = Field(
        default=None,
        description="前端当前精确选中的文本内容。首轮提问通常会提供，追问时可为空。",
    )
    question: str = Field(
        ...,
        min_length=1,
        description="用户针对该选区提出的问题。",
    )
    history: list[SelectionQuestionMessage] = Field(
        default_factory=list,
        description="同一选区问答抽屉中之前的历史消息，按时间顺序排列。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "context": (
                    "二次函数 y = ax^2 + bx + c 的图像是一条抛物线，其开口方向由 a 的正负决定。"
                ),
                "selection": "开口方向由 a 的正负决定",
                "question": "为什么 a 为负数时抛物线开口向下？",
                "history": [
                    {
                        "role": "user",
                        "content": "为什么 a 为负数时抛物线开口向下？",
                    },
                    {
                        "role": "assistant",
                        "content": "因为 a 决定抛物线的开口方向，当 a < 0 时图像向下张开。",
                    },
                ],
            }
        }
    )
