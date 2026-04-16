from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CodeExecutionLogLine(BaseModel):
    """单行运行输出。"""

    type: Literal["log", "warn", "error", "result", "meta"] = Field(
        description="输出行的类别。"
    )
    text: str = Field(description="输出文本。")


class CodeExecutionRequest(BaseModel):
    """代码在线运行请求。"""

    language: Literal["python"] = Field(description="当前仅支持 python。")
    code: str = Field(
        ...,
        min_length=1,
        description="用户在编辑器中的主代码。",
    )
    runner_code: str = Field(
        default="",
        description="附加测试代码，会被包装进运行函数中执行。",
    )
    timeout_ms: int = Field(
        default=5000,
        ge=1000,
        le=15000,
        description="单次执行超时时间，单位毫秒。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "language": "python",
                "code": "def add(a, b):\n    return a + b",
                "runner_code": "return add(2, 3)",
                "timeout_ms": 5000,
            }
        }
    )


class CodeExecutionResponse(BaseModel):
    """代码在线运行响应。"""

    ok: bool = Field(description="是否执行成功。")
    logs: list[CodeExecutionLogLine] = Field(
        default_factory=list,
        description="运行过程中产生的输出日志。",
    )
    result_text: str | None = Field(
        default=None,
        description="运行成功时的返回值文本。",
    )
    error_text: str | None = Field(
        default=None,
        description="运行失败时的错误文本。",
    )
    duration_ms: int = Field(description="本次执行耗时，单位毫秒。")
