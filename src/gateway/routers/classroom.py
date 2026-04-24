from __future__ import annotations

import asyncio
import mimetypes
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path as ApiPath, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from edu_multi_agent.file_io import now_iso

from ..dependencies import get_classroom_task_registry
from ..schemas.classroom import (
    ClassroomGenerateRequest,
    ClassroomGenerateResponse,
    ClassroomParseScriptRequest,
    ClassroomParseScriptResponse,
    ClassroomTaskCreatedResponse,
    ClassroomTaskLinks,
    ClassroomTaskStatusResponse,
)
from ..schemas.prep_runs import RunStatus
from ..services.classroom import parse_classroom_script
from ..services.classroom_tasks import ClassroomTaskRegistry, load_run_view, load_stored_events
from ..services.prep_runs import encode_sse
from ..services.prep_runs import safe_path_within


router = APIRouter(prefix="/api/v1/classroom", tags=["AI 课堂"])

ClassroomTaskRegistryDep = Annotated[ClassroomTaskRegistry, Depends(get_classroom_task_registry)]

CLASSROOM_EVENTS_SSE_EXAMPLE = """event: run_created
id: 0
data: {"index":0,"timestamp":"2026-04-23T10:30:00+08:00","event":"run_created","summary":"AI 课堂任务已创建，等待执行。","run_id":"20260423_103000_newton","run_status":"queued"}

event: workflow_started
id: 1
data: {"index":1,"timestamp":"2026-04-23T10:30:01+08:00","event":"workflow_started","summary":"AI 课堂生成任务开始执行。","run_id":"20260423_103000_newton","run_status":"running"}

event: node_started
id: 2
data: {"index":2,"timestamp":"2026-04-23T10:30:02+08:00","event":"node_started","node":"page_plan","summary":"开始规划课堂页数与每页主题。","run_id":"20260423_103000_newton","run_status":"running"}

event: node_completed
id: 3
data: {"index":3,"timestamp":"2026-04-23T10:30:05+08:00","event":"node_completed","node":"page_plan","summary":"分页规划完成，共 6 页。","run_id":"20260423_103000_newton","run_status":"running"}
"""


def _build_links(run_id: str) -> ClassroomTaskLinks:
    base = f"/api/v1/classroom/{run_id}"
    return ClassroomTaskLinks(
        status=base,
        events=f"{base}/events",
        result=f"{base}/result",
    )


@router.post(
    "/generate",
    response_model=ClassroomTaskCreatedResponse,
    summary="创建 AI 课堂生成任务",
    description=(
        "创建一个新的 AI 课堂生成任务，并在后台执行。"
        "接口立即返回 `run_id`；前端可随后通过状态接口和 SSE 观察各节点进度。"
    ),
    response_description="新创建任务的基础信息与后续访问链接。",
)
def create_classroom_task(
    payload: ClassroomGenerateRequest,
    registry: ClassroomTaskRegistryDep,
) -> ClassroomTaskCreatedResponse:
    session = registry.create_run(payload)
    return ClassroomTaskCreatedResponse(
        run_id=session.run_id,
        status=session.status,
        created_at=session.created_at,
        output_dir=str(session.output_dir),
        links=_build_links(session.run_id),
    )


@router.post(
    "/parse-script",
    response_model=ClassroomParseScriptResponse,
    summary="解析课堂讲稿脚本",
    description="对已生成或手工编辑的课堂讲稿进行契约校验和分页解析。",
    response_description="解析得到的页面结构。",
)
def parse_script_endpoint(
    payload: ClassroomParseScriptRequest,
) -> ClassroomParseScriptResponse:
    return parse_classroom_script(payload.script)


@router.get(
    "/{run_id}",
    response_model=ClassroomTaskStatusResponse,
    summary="查询 AI 课堂任务状态",
    description="返回指定 AI 课堂生成任务的当前状态、最近节点和错误信息。",
    response_description="指定任务的当前状态快照。",
)
def get_classroom_task(
    registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="AI 课堂任务唯一标识。"),
) -> ClassroomTaskStatusResponse:
    view = load_run_view(registry, run_id)
    result = view.get("result") if isinstance(view.get("result"), dict) else None
    request_payload = view.get("request") if isinstance(view.get("request"), dict) else None
    return ClassroomTaskStatusResponse(
        run_id=view["run_id"],
        status=view["status"],
        created_at=view.get("created_at"),
        started_at=view.get("started_at"),
        finished_at=view.get("finished_at"),
        output_dir=view["output_dir"],
        request=ClassroomGenerateRequest.model_validate(request_payload) if request_payload else None,
        current_node=view.get("current_node"),
        latest_summary=view.get("latest_summary"),
        page_count=(int(result["page_count"]) if result and result.get("page_count") is not None else None),
        error=view.get("error"),
        links=_build_links(view["run_id"]),
    )


@router.get(
    "/{run_id}/result",
    response_model=ClassroomGenerateResponse,
    summary="获取 AI 课堂任务结果",
    description="当任务成功完成后，返回完整的 AI 课堂结果。",
    response_description="完整的 AI 课堂生成结果。",
)
def get_classroom_task_result(
    registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="AI 课堂任务唯一标识。"),
) -> ClassroomGenerateResponse:
    view = load_run_view(registry, run_id)
    if view["status"] == RunStatus.failed:
        raise HTTPException(status_code=409, detail=view.get("error") or "Task failed.")
    if view["status"] != RunStatus.succeeded:
        raise HTTPException(status_code=409, detail="Task is not finished yet.")

    payload = view.get("result")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=404, detail="Task result not found.")
    return ClassroomGenerateResponse.model_validate(payload)


@router.get(
    "/{run_id}/files/{file_path:path}",
    summary="获取课堂生成文件",
    description="从课堂任务输出目录中获取单个生成文件，例如语音文件。",
    response_description="返回课堂任务目录中的目标文件。",
)
def download_classroom_file(
    registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="AI 课堂任务唯一标识。"),
    file_path: str = ApiPath(description="课堂任务输出目录中的相对文件路径。"),
) -> FileResponse:
    output_dir = registry.resolve_run_dir(run_id)
    target = safe_path_within(output_dir, file_path)
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type)


@router.get(
    "/{run_id}/events",
    summary="实时查看 AI 课堂任务进度（SSE）",
    description=(
        "通过 Server-Sent Events (SSE) 实时查看 AI 课堂生成任务的节点进度。"
        "如果传入 `after_id`，也可以回放断线后的历史事件。"
    ),
    response_description="返回包含任务事件、节点事件和心跳事件的 SSE 流。",
    responses={
        200: {
            "description": "SSE 实时事件流。",
            "content": {"text/event-stream": {"example": CLASSROOM_EVENTS_SSE_EXAMPLE}},
        }
    },
)
async def stream_classroom_task_events(
    request: Request,
    registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="AI 课堂任务唯一标识。"),
    after_id: int = Query(-1, description="只回放编号大于该值的事件。"),
    heartbeat_seconds: float = Query(15.0, ge=5.0, le=60.0, description="等待新事件期间的心跳间隔。"),
) -> StreamingResponse:
    session = registry.get_session(run_id)
    if session is None:
        events = load_stored_events(registry, run_id)

        async def replay_only() -> Any:
            yield "retry: 3000\n\n"
            for event in events:
                event_index = int(event.get("index", -1))
                if event_index <= after_id:
                    continue
                yield encode_sse(str(event.get("event", "message")), event, event_index)

        return StreamingResponse(replay_only(), media_type="text/event-stream")

    async def event_generator() -> Any:
        cursor = after_id
        yield "retry: 3000\n\n"

        while True:
            if await request.is_disconnected():
                break

            events = await asyncio.to_thread(
                session.wait_for_events,
                cursor,
                heartbeat_seconds,
            )

            if events:
                for event in events:
                    cursor = max(cursor, int(event["index"]))
                    yield encode_sse(event["event"], event, int(event["index"]))

                if (
                    session.status in {RunStatus.succeeded, RunStatus.failed}
                    and cursor >= int(session.events[-1]["index"])
                ):
                    break
                continue

            yield encode_sse(
                "heartbeat",
                {
                    "run_id": run_id,
                    "timestamp": now_iso(),
                    "run_status": session.status,
                    "current_node": session.current_node,
                },
            )

    return StreamingResponse(event_generator(), media_type="text/event-stream")
