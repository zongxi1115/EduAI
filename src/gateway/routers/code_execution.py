from __future__ import annotations

from fastapi import APIRouter

from ..schemas.code_execution import CodeExecutionRequest, CodeExecutionResponse
from ..services.code_execution import execute_code


router = APIRouter(prefix="/api/v1/code-execution", tags=["代码运行"])


@router.post(
    "/execute",
    response_model=CodeExecutionResponse,
    summary="在线运行代码",
    description=(
        "用于前端编程题编辑器触发在线运行。"
        "当前主要支持 Python 代码，通过后端子进程执行并返回日志、返回值与错误信息。"
    ),
    response_description="统一格式的代码执行结果。",
)
def execute_code_endpoint(payload: CodeExecutionRequest) -> CodeExecutionResponse:
    """Run supported code and return a normalized execution payload."""
    return execute_code(payload)
