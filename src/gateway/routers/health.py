from __future__ import annotations

from fastapi import APIRouter

from edu_multi_agent.file_io import now_iso

from ..schemas.system import HealthResponse


router = APIRouter(tags=["系统"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="健康检查",
    response_description="返回网关存活状态和当前服务端时间。",
)
def healthcheck() -> HealthResponse:
    """返回轻量级健康状态，用于监控与本地调试。"""
    return HealthResponse(status="ok", timestamp=now_iso())
