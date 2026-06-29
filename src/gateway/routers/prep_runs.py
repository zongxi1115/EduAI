from __future__ import annotations

import asyncio
import mimetypes
import zipfile
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path as ApiPath, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import now_iso
from edu_multi_agent.models import GenerationRequest

from ..dependencies import (
    get_classroom_task_registry,
    get_learner_model_service,
    get_optional_current_user,
    get_run_registry,
    get_settings,
)
from ..schemas.auth import AuthUser
from ..schemas.classroom import (
    ClassroomTaskCreatedResponse,
    ClassroomTaskLinks,
)
from ..schemas.prep_runs import (
    ArtifactListResponse,
    RunCreatedResponse,
    RunListResponse,
    RunStatus,
    RunStatusResponse,
)
from ..services.classroom import (
    build_classroom_request_from_prep_view,
    build_question_classroom_request_from_prep_view,
)
from ..services.classroom_tasks import ClassroomTaskRegistry
from ..services.classroom_tasks import (
    find_existing_question_run_for_prep_run,
    find_existing_run_for_prep_run,
)
from ..services.learner_models import LearnerModelService
from ..services.prep_runs import (
    build_artifacts_response,
    build_links,
    build_run_list_response,
    build_status_response,
    encode_sse,
    list_run_views,
    load_run_view,
    load_stored_events,
    safe_path_within,
)
from ..services.run_registry import RunRegistry


router = APIRouter(prefix="/api/v1/prep-runs", tags=["课前准备任务"])

RunRegistryDep = Annotated[RunRegistry, Depends(get_run_registry)]
ClassroomTaskRegistryDep = Annotated[ClassroomTaskRegistry, Depends(get_classroom_task_registry)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
LearnerModelServiceDep = Annotated[LearnerModelService, Depends(get_learner_model_service)]
CurrentUserDep = Annotated[AuthUser | None, Depends(get_optional_current_user)]

RUN_EVENTS_SSE_EXAMPLE = """event: run_created
id: 0
data: {"index":0,"timestamp":"2026-04-16T10:30:00+08:00","event":"run_created","summary":"任务已创建并进入队列。","run_id":"20260416_103000_quadratic-functions","run_status":"queued"}

event: workflow_started
id: 1
data: {"index":1,"timestamp":"2026-04-16T10:30:01+08:00","event":"workflow_started","summary":"工作流开始执行。","run_id":"20260416_103000_quadratic-functions","run_status":"running"}

event: artifact_ready
id: 8
data: {"index":8,"timestamp":"2026-04-16T10:30:15+08:00","event":"artifact_ready","summary":"练习题产物已生成。","run_id":"20260416_103000_quadratic-functions","run_status":"running"}

event: workflow_completed
id: 15
data: {"index":15,"timestamp":"2026-04-16T10:30:22+08:00","event":"workflow_completed","summary":"工作流执行完成。","run_id":"20260416_103000_quadratic-functions","run_status":"succeeded"}
"""


def _parse_optional_run_status(raw_status: str | None) -> RunStatus | None:
    """Parse an optional run status filter, treating blank strings as None."""
    if raw_status is None:
        return None

    normalized = raw_status.strip()
    if not normalized:
        return None

    try:
        return RunStatus(normalized)
    except ValueError as exc:
        expected = ", ".join(f"'{status.value}'" for status in RunStatus)
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "enum",
                    "loc": ["query", "status"],
                    "msg": f"Input should be {expected}",
                    "input": raw_status,
                    "ctx": {"expected": expected},
                }
            ],
        ) from exc


def _build_classroom_links(run_id: str) -> ClassroomTaskLinks:
    base = f"/api/v1/classroom/{run_id}"
    return ClassroomTaskLinks(
        status=base,
        events=f"{base}/events",
        result=f"{base}/result",
    )


def _build_classroom_task_created_response(view: dict[str, Any]) -> ClassroomTaskCreatedResponse:
    return ClassroomTaskCreatedResponse(
        run_id=view["run_id"],
        status=view["status"],
        created_at=str(view.get("created_at") or now_iso()),
        output_dir=view["output_dir"],
        links=_build_classroom_links(view["run_id"]),
    )


@router.post(
    "",
    response_model=RunCreatedResponse,
    summary="创建课前准备任务",
    description=(
        "创建一个新的课前准备任务，并在后台启动执行。"
        "这个接口负责“创建任务”，返回 `run_id` 以及后续查看状态、连接 SSE、下载结果所需的链接。"
    ),
    response_description="新创建任务的基础信息。",
)
def create_prep_run(
    payload: GenerationRequest,
    registry: RunRegistryDep,
    learner_model_service: LearnerModelServiceDep,
    current_user: CurrentUserDep,
) -> RunCreatedResponse:
    """创建新任务，并立即返回可跟踪该任务的元信息。"""
    scoped_payload = (
        payload.model_copy(update={"learner_id": current_user.learner_id})
        if current_user is not None
        else payload
    )
    session = registry.create_run(learner_model_service.enrich_generation_request(scoped_payload))
    return RunCreatedResponse(
        run_id=session.run_id,
        status=session.status,
        created_at=session.created_at,
        output_dir=str(session.output_dir),
        links=build_links(session.run_id),
    )


@router.get(
    "",
    response_model=RunListResponse,
    summary="获取课前准备任务列表",
    description=(
        "返回当前系统中可见的课前准备任务列表，包含运行中任务和已落盘的历史任务。"
        "可选按状态筛选，并限制返回条数。"
    ),
    response_description="课前准备任务的状态列表。",
)
def list_prep_runs(
    registry: RunRegistryDep,
    settings: SettingsDep,
    status: str | None = Query(
        None,
        description="按任务状态过滤，例如 queued、running、succeeded、failed。留空时表示不过滤。",
    ),
    limit: int = Query(
        100,
        ge=1,
        le=500,
        description="最多返回的任务条数。",
    ),
) -> RunListResponse:
    """列出所有可见的课前准备任务。"""
    parsed_status = _parse_optional_run_status(status)
    views = list_run_views(registry, settings, status=parsed_status)
    return build_run_list_response(views[:limit], total=len(views))


@router.get("/events", include_in_schema=False)
@router.get("//events", include_in_schema=False)
def missing_run_id_events() -> None:
    """Provide a clearer error when the caller forgot to supply run_id."""
    raise HTTPException(
        status_code=400,
        detail="Missing run_id. Use /api/v1/prep-runs/{run_id}/events.",
    )


@router.get(
    "/{run_id}",
    response_model=RunStatusResponse,
    summary="查询任务状态",
    description=(
        "返回指定课前准备任务的当前状态。"
        "正在运行的任务从内存态读取，已完成的历史任务会从输出目录重建视图。"
    ),
    response_description="指定任务的当前状态快照。",
)
def get_prep_run(
    registry: RunRegistryDep,
    settings: SettingsDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
) -> RunStatusResponse:
    """返回指定任务的最新状态视图。"""
    view = load_run_view(registry, settings, run_id)
    return build_status_response(view)


@router.post(
    "/{run_id}/classroom",
    response_model=ClassroomTaskCreatedResponse,
    summary="基于课前任务创建课中任务",
    description=(
        "读取指定课前准备任务的计划与多智能体产物，自动整理成课中生成所需的 "
        "`topic`、`materials` 和 `outline`，然后创建一个新的 AI 课堂任务。"
    ),
    response_description="新创建的课中任务信息与后续访问链接。",
)
def create_classroom_from_prep_run(
    registry: RunRegistryDep,
    classroom_registry: ClassroomTaskRegistryDep,
    settings: SettingsDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
    slide_prompt_file: str = Query(
        "slide.md",
        min_length=1,
        description=(
            "用于生成课堂 HTML 卡片的提示词文件名。"
            "默认 `slide.md`，也可以传 `slide.creative.md` 这类变体。"
        ),
    ),
) -> ClassroomTaskCreatedResponse:
    """Create a classroom task by reusing the outputs of a completed prep run."""
    existing_view = find_existing_run_for_prep_run(classroom_registry, run_id)
    if existing_view is not None:
        return _build_classroom_task_created_response(existing_view)

    prep_view = load_run_view(registry, settings, run_id)
    classroom_request = build_classroom_request_from_prep_view(
        prep_view,
        slide_prompt_file=slide_prompt_file,
    )
    session = classroom_registry.create_run(classroom_request)
    return ClassroomTaskCreatedResponse(
        run_id=session.run_id,
        status=session.status,
        created_at=session.created_at,
        output_dir=str(session.output_dir),
        links=_build_classroom_links(session.run_id),
    )


@router.get(
    "/{run_id}/classroom",
    response_model=ClassroomTaskCreatedResponse,
    summary="查询课前任务是否已有对应课中任务",
    description=(
        "如果该课前准备任务已经创建过对应的 AI 课堂任务，则返回已有任务的基础信息；"
        "否则返回 404，前端可据此决定是否继续创建。"
    ),
    response_description="已存在的课中任务基础信息。",
)
def get_existing_classroom_for_prep_run(
    classroom_registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
) -> ClassroomTaskCreatedResponse:
    existing_view = find_existing_run_for_prep_run(classroom_registry, run_id)
    if existing_view is None:
        raise HTTPException(
            status_code=404,
            detail="No classroom task is linked to this prep run yet.",
        )
    return _build_classroom_task_created_response(existing_view)


@router.post(
    "/{run_id}/practice-questions/{question_id}/classroom",
    response_model=ClassroomTaskCreatedResponse,
    summary="基于单道练习题创建一页幻灯讲解",
    description=(
        "读取指定课前准备任务中的 practice_questions.json，定位单道练习题，"
        "并创建只包含一页幻灯片的 AI 课堂任务。"
    ),
    response_description="新创建或已存在的单题讲解任务信息与后续访问链接。",
)
def create_question_classroom_from_prep_run(
    registry: RunRegistryDep,
    classroom_registry: ClassroomTaskRegistryDep,
    settings: SettingsDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
    question_id: str = ApiPath(description="练习题唯一标识符。"),
    slide_prompt_file: str = Query(
        "slide.md",
        min_length=1,
        description="用于生成课堂 HTML 卡片的提示词文件名。",
    ),
) -> ClassroomTaskCreatedResponse:
    existing_view = find_existing_question_run_for_prep_run(
        classroom_registry,
        run_id,
        question_id,
    )
    if existing_view is not None:
        return _build_classroom_task_created_response(existing_view)

    prep_view = load_run_view(registry, settings, run_id)
    classroom_request = build_question_classroom_request_from_prep_view(
        prep_view,
        question_id=question_id,
        slide_prompt_file=slide_prompt_file,
    )
    session = classroom_registry.create_run(classroom_request)
    return ClassroomTaskCreatedResponse(
        run_id=session.run_id,
        status=session.status,
        created_at=session.created_at,
        output_dir=str(session.output_dir),
        links=_build_classroom_links(session.run_id),
    )


@router.get(
    "/{run_id}/practice-questions/{question_id}/classroom",
    response_model=ClassroomTaskCreatedResponse,
    summary="查询单道练习题是否已有一页幻灯讲解",
    description="如果该练习题已经创建过对应的一页 AI 课堂任务，则返回已有任务基础信息。",
    response_description="已存在的单题讲解任务基础信息。",
)
def get_existing_question_classroom_for_prep_run(
    classroom_registry: ClassroomTaskRegistryDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
    question_id: str = ApiPath(description="练习题唯一标识符。"),
) -> ClassroomTaskCreatedResponse:
    existing_view = find_existing_question_run_for_prep_run(
        classroom_registry,
        run_id,
        question_id,
    )
    if existing_view is None:
        raise HTTPException(
            status_code=404,
            detail="No question classroom task is linked to this practice question yet.",
        )
    return _build_classroom_task_created_response(existing_view)


@router.delete(
    "/{run_id}",
    summary="删除课前准备任务",
    description="删除指定任务的输出目录及所有关联文件。如果是正在运行的任务，会从内存注册表中移除并忽略其后续输出。",
    response_description="成功删除后返回状态消息。",
)
def delete_prep_run(
    registry: RunRegistryDep,
    settings: SettingsDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
) -> dict[str, str]:
    """删除指定的课前准备任务及其文件。"""
    output_dir = settings.output_root / run_id
    session = registry.get_session(run_id)
    if not session and not output_dir.is_dir():
        raise HTTPException(status_code=404, detail="Run not found.")

    try:
        registry.remove_run(run_id)
    except KeyError:
        pass  # not in registry, OK

    if output_dir.is_dir():
        import shutil
        try:
            shutil.rmtree(output_dir)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete directory: {e}")

    return {"status": "success", "message": f"Run {run_id} deleted."}


@router.get(
    "/{run_id}/artifacts",
    response_model=ArtifactListResponse,
    summary="获取生成产物列表",
    description=(
        "返回任务当前已生成的计划文件、报告文件、产物清单，以及各个 Agent 的输出文件。"
    ),
    response_description="指定任务的产物元数据与下载链接。",
)
def get_prep_run_artifacts(
    registry: RunRegistryDep,
    settings: SettingsDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
) -> ArtifactListResponse:
    """返回指定任务可下载的产物元数据。"""
    view = load_run_view(registry, settings, run_id)
    return build_artifacts_response(view)


@router.get(
    "/{run_id}/events",
    summary="实时查看任务进度（SSE）",
    description=(
        "通过 Server-Sent Events (SSE) 实时查看任务执行进度。"
        "这个接口不负责创建任务，只负责在你拿到 `run_id` 之后持续推送进度事件。"
        "如果传入上次收到的事件编号，也可以回放之后的历史事件。"
    ),
    response_description="返回包含任务事件、心跳事件和结束事件的 SSE 流。",
    responses={
        200: {
            "description": "SSE 实时事件流。",
            "content": {"text/event-stream": {"example": RUN_EVENTS_SSE_EXAMPLE}},
        }
    },
)
async def stream_prep_run_events(
    request: Request,
    registry: RunRegistryDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
    after_id: int = Query(
        -1,
        description="只回放编号大于该值的事件，适合断线续传。",
    ),
    heartbeat_seconds: float = Query(
        15.0,
        ge=5.0,
        le=60.0,
        description="等待新事件期间，心跳事件的发送间隔（秒）。",
    ),
) -> StreamingResponse:
    """以 SSE 方式推送任务的历史事件和实时事件。"""
    session = registry.get_session(run_id)
    if session is None:
        events = load_stored_events(registry, run_id)

        async def replay_only() -> Any:
            """对已结束任务回放历史事件，不再等待新的实时事件。"""
            yield "retry: 3000\n\n"
            for event in events:
                event_index = int(event.get("index", -1))
                if event_index <= after_id:
                    continue
                payload = {**event, "run_id": run_id}
                yield encode_sse(str(event.get("event", "message")), payload, event_index)

        return StreamingResponse(replay_only(), media_type="text/event-stream")

    async def event_generator() -> Any:
        """持续推送实时事件和心跳，直到任务进入结束状态。"""
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

            heartbeat_payload = {
                "run_id": run_id,
                "timestamp": now_iso(),
                "run_status": session.status,
            }
            yield encode_sse("heartbeat", heartbeat_payload)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get(
    "/{run_id}/files/{file_path:path}",
    summary="下载单个生成文件",
    description=(
        "从指定任务的输出目录中下载单个文件。"
        "后端会校验路径，确保只能访问该任务目录内的文件。"
    ),
    response_description="返回请求的生成文件。",
)
def download_generated_file(
    registry: RunRegistryDep,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
    file_path: str = ApiPath(description="任务输出目录中的相对文件路径。"),
    download: bool = Query(
        False,
        description="为 true 时强制浏览器下载，而不是尝试直接预览。",
    ),
) -> FileResponse:
    """返回单个生成文件，并阻止越权访问任务目录外的路径。"""
    output_dir = registry.resolve_run_dir(run_id)
    target = safe_path_within(output_dir, file_path)
    filename = target.name if download else None
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, filename=filename)


@router.get(
    "/{run_id}/bundle",
    summary="下载任务整包 ZIP",
    description=(
        "临时打包指定任务目录中的全部生成文件，并以 ZIP 形式返回。"
    ),
    response_description="指定任务的 ZIP 打包文件。",
)
def download_generated_bundle(
    registry: RunRegistryDep,
    background_tasks: BackgroundTasks,
    run_id: str = ApiPath(description="课前准备任务的唯一标识符。"),
) -> FileResponse:
    """将整个任务目录临时打包成 ZIP 并返回下载。"""
    output_dir = registry.resolve_run_dir(run_id)
    temp_file = NamedTemporaryFile(prefix=f"{run_id}_", suffix=".zip", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(output_dir.rglob("*")):
            if file.is_file():
                archive.write(file, arcname=file.relative_to(output_dir))

    background_tasks.add_task(temp_path.unlink, missing_ok=True)
    return FileResponse(
        temp_path,
        media_type="application/zip",
        filename=f"{run_id}.zip",
    )
