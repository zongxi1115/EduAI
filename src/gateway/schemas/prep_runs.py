from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from edu_multi_agent.models import GenerationRequest


class RunStatus(str, Enum):
    """课前准备任务的生命周期状态。"""

    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    unknown = "unknown"


class RunLinks(BaseModel):
    """创建任务后可直接使用的相关接口链接。"""

    status: str = Field(description="用于轮询任务状态的接口地址。")
    events: str = Field(description="用于通过 SSE 查看任务进度的接口地址。")
    artifacts: str = Field(description="用于获取生成产物列表的接口地址。")
    bundle: str = Field(description="用于下载整包 ZIP 的接口地址。")


class RunCreatedResponse(BaseModel):
    """创建课前准备任务后的返回结果。"""

    run_id: str = Field(description="系统分配给该任务的唯一标识符。")
    status: RunStatus = Field(description="任务初始状态。")
    created_at: str = Field(description="任务创建时间，ISO 8601 格式。")
    output_dir: str = Field(description="该任务对应的输出目录绝对路径。")
    links: RunLinks = Field(description="后续查看状态、SSE、下载产物所需的快捷链接。")


class RunStatusResponse(BaseModel):
    """课前准备任务的当前状态快照。"""

    run_id: str = Field(description="任务的唯一标识符。")
    status: RunStatus = Field(description="任务当前状态。")
    created_at: str | None = Field(
        default=None,
        description="任务创建时间，ISO 8601 格式。",
    )
    started_at: str | None = Field(
        default=None,
        description="工作流开始时间，ISO 8601 格式。",
    )
    finished_at: str | None = Field(
        default=None,
        description="工作流结束时间，ISO 8601 格式。",
    )
    output_dir: str = Field(description="任务输出目录的绝对路径。")
    request: GenerationRequest | None = Field(
        default=None,
        description="创建任务时提交的原始请求体。",
    )
    artifact_count: int = Field(description="当前已知的生成产物数量。")
    error: str | None = Field(
        default=None,
        description="任务失败时的错误信息。",
    )
    links: RunLinks = Field(description="该任务相关接口的快捷链接。")


class FileDescriptor(BaseModel):
    """描述可下载生成文件的元数据。"""

    name: str = Field(description="文件名。")
    relative_path: str = Field(description="相对于任务输出目录的路径。")
    size_bytes: int | None = Field(
        default=None,
        description="文件大小，单位字节。",
    )
    content_type: str | None = Field(
        default=None,
        description="检测到的 MIME 类型。",
    )
    download_url: str = Field(description="下载该文件的 API 地址。")


class ArtifactDescriptor(BaseModel):
    """单个 Agent 输出产物的元数据。"""

    agent_name: str = Field(description="生成该产物的 Agent 名称。")
    title: str = Field(description="该产物组的人类可读标题。")
    status: str = Field(description="该产物组的生成结果状态。")
    summary: str = Field(description="对该产物输出的简短说明。")
    notes: list[str] = Field(
        default_factory=list,
        description="关于该产物结果的补充说明。",
    )
    output_dir: str = Field(description="该产物组输出目录的绝对路径。")
    files: list[FileDescriptor] = Field(
        default_factory=list,
        description="该 Agent 生成的可下载文件列表。",
    )


class ArtifactListResponse(BaseModel):
    """课前准备任务的完整产物列表。"""

    run_id: str = Field(description="任务的唯一标识符。")
    status: RunStatus = Field(description="任务当前状态。")
    plan_file: FileDescriptor | None = Field(
        default=None,
        description="已生成的准备计划文件。",
    )
    report_file: FileDescriptor | None = Field(
        default=None,
        description="已生成的总结报告文件。",
    )
    manifest_file: FileDescriptor | None = Field(
        default=None,
        description="已生成的产物清单文件。",
    )
    artifacts: list[ArtifactDescriptor] = Field(
        description="该任务当前可用的各 Agent 产物输出。",
    )
    bundle_download_url: str = Field(
        description="下载该任务完整 ZIP 包的 API 地址。",
    )
