from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """网关健康检查返回体。"""

    status: str = Field(description="服务健康状态标记。", examples=["ok"])
    timestamp: str = Field(
        description="当前服务端时间，ISO 8601 格式。",
        examples=["2026-04-16T09:30:00+08:00"],
    )
