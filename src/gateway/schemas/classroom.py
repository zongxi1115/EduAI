from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from classroom.agents._common import validate_slide_prompt_name

from .prep_runs import RunStatus


class ClassroomGenerateRequest(BaseModel):
    """Request body for generating a playable classroom bundle."""

    topic: str = Field(..., min_length=1, description="课堂主题。")
    materials: list[str] = Field(
        default_factory=list,
        description="辅助该课堂生成的素材列表，例如原文、题目、知识点说明等。",
    )
    media_resources: list[dict[str, str]] = Field(
        default_factory=list,
        description=(
            "课前生成的非文本媒体资源（视频、交互网页等），"
            "每项包含 resource_type、file_path、relative_path、description、source_agent。"
        ),
    )
    source_prep_run_id: str | None = Field(
        default=None,
        description="若该课堂由某个课前准备任务衍生而来，则记录对应的课前 run_id。",
    )
    outline: Any | None = Field(
        default=None,
        description=(
            "可选的大纲输入。调试时既可以传对象，也可以直接传字符串、数组或更浅的 JSON。"
            "服务端会统一归一成 outline 对象；若不提供，则需要服务端已注入 classroom_outline_agent。"
        ),
    )
    slide_prompt_file: str = Field(
        default="slide.md",
        validate_default=True,
        description=(
            "用于生成 HTML 卡片的系统提示词文件名。默认 `slide.md`；"
            "也支持同目录下的 `slide.*.md` 变体，例如 `slide.creative.md`。"
        ),
    )

    @field_validator("slide_prompt_file")
    @classmethod
    def _validate_slide_prompt_file(cls, value: str) -> str:
        return validate_slide_prompt_name(value)


class ClassroomPromptFileOptionResponse(BaseModel):
    filename: str = Field(description="可选的提示词文件名。")
    is_default: bool = Field(description="该文件是否为默认提示词。")


class ClassroomPromptFileListResponse(BaseModel):
    kind: Literal["slide"] = Field(description="提示词类别。")
    default_filename: str = Field(description="默认使用的提示词文件名。")
    files: list[ClassroomPromptFileOptionResponse] = Field(description="当前可选的提示词文件列表。")


class ClassroomRevealResponse(BaseModel):
    narration: str = Field(description="口播旁白。")
    on_slide: str | None = Field(default=None, description="页面显示文字。")
    audio_src: str | None = Field(default=None, description="该段旁白对应的语音文件路径。")


class ClassroomQuizResponse(BaseModel):
    after_reveal_idx: int = Field(ge=0, description="在第几个 reveal 播放后触发。")
    payload: dict[str, Any] = Field(description="题目 JSON 负载。")
    false_intro: str | None = Field(default=None, description="答错补讲旁白。")
    false_intro_audio_src: str | None = Field(
        default=None,
        description="答错补讲旁白对应的语音文件路径。",
    )


class ClassroomPageSpecResponse(BaseModel):
    idx: int = Field(ge=0, description="页索引。")
    reveals: list[ClassroomRevealResponse] = Field(description="本页 reveal 列表。")
    quizzes: list[ClassroomQuizResponse] = Field(description="本页 quiz 列表。")
    on_slide_summary: str = Field(description="本页页面可见文字摘要。")


class ClassroomPageBlueprintResponse(BaseModel):
    idx: int = Field(ge=0, description="页索引。")
    theme: str = Field(description="本页主题。")
    objective: str = Field(description="本页教学目标。")
    key_points: list[str] = Field(description="本页要覆盖的关键点。")
    target_reveal_count: int = Field(ge=3, le=6, description="本页目标 reveal 数。")
    quiz_goal: str | None = Field(default=None, description="本页问答意图。")


class ClassroomBundleRevealResponse(BaseModel):
    narration: str = Field(description="交付给播放器的旁白文本。")
    audio_src: str | None = Field(default=None, description="交付给播放器的旁白语音文件路径。")


class ClassroomBundlePageResponse(BaseModel):
    idx: int = Field(ge=0, description="页索引。")
    html: str = Field(description="该页已渲染完成的 HTML 卡片。")
    reveals: list[ClassroomBundleRevealResponse] = Field(
        description="交付给播放器的旁白列表。"
    )
    quizzes: list[ClassroomQuizResponse] = Field(description="该页问答定义。")


class ClassroomBundleResponse(BaseModel):
    pages: list[ClassroomBundlePageResponse] = Field(
        description="播放器可直接消费的课堂分页数据。"
    )


class ClassroomGenerateResponse(BaseModel):
    topic: str = Field(description="课堂主题。")
    materials: list[str] = Field(description="参与生成的素材列表。")
    outline_source: Literal["request", "server"] = Field(
        description="本次使用的大纲来源。"
    )
    outline: dict[str, Any] = Field(description="参与生成的最终大纲。")
    page_blueprints: list[ClassroomPageBlueprintResponse] = Field(
        description="页面规划阶段得到的分页与主题方案。"
    )
    script: str = Field(description="带控制标签的课堂讲稿。")
    page_count: int = Field(ge=1, description="解析出的页面数。")
    pages: list[ClassroomPageSpecResponse] = Field(description="中间态页结构。")
    bundle: ClassroomBundleResponse = Field(description="最终交付给播放器的数据包。")


class ClassroomChapterSummaryResponse(BaseModel):
    idx: int = Field(ge=0, description="章节索引。")
    title: str = Field(description="章节标题。")
    summary: str = Field(description="结合文稿与页面内容生成的章节总结。")


class ClassroomChapterSummariesResponse(BaseModel):
    chapters: list[ClassroomChapterSummaryResponse] = Field(description="逐章节总结列表。")


class ClassroomTaskLinks(BaseModel):
    status: str = Field(description="用于查询任务状态的接口地址。")
    events: str = Field(description="用于通过 SSE 查看任务节点进度的接口地址。")
    result: str = Field(description="用于在任务完成后获取最终课堂结果的接口地址。")


class ClassroomTaskCreatedResponse(BaseModel):
    run_id: str = Field(description="系统分配给该任务的唯一标识符。")
    status: RunStatus = Field(description="任务初始状态。")
    created_at: str = Field(description="任务创建时间，ISO 8601 格式。")
    output_dir: str = Field(description="该任务对应的输出目录绝对路径。")
    links: ClassroomTaskLinks = Field(description="后续查看状态、SSE 和结果的链接。")


class ClassroomTaskStatusResponse(BaseModel):
    run_id: str = Field(description="任务唯一标识。")
    status: RunStatus = Field(description="任务当前状态。")
    created_at: str | None = Field(default=None, description="任务创建时间。")
    started_at: str | None = Field(default=None, description="任务开始执行时间。")
    finished_at: str | None = Field(default=None, description="任务结束时间。")
    output_dir: str = Field(description="任务输出目录。")
    request: ClassroomGenerateRequest | None = Field(default=None, description="原始请求体。")
    current_node: str | None = Field(default=None, description="当前最近执行到的节点名。")
    latest_summary: str | None = Field(default=None, description="最近一条状态摘要。")
    page_count: int | None = Field(default=None, description="完成后生成的页面数。")
    error: str | None = Field(default=None, description="任务失败时的错误信息。")
    links: ClassroomTaskLinks = Field(description="该任务的相关接口链接。")


class ClassroomParseScriptRequest(BaseModel):
    script: str = Field(..., min_length=1, description="待解析的课堂讲稿。")


class ClassroomParseScriptResponse(BaseModel):
    page_count: int = Field(ge=1, description="解析得到的页面总数。")
    pages: list[ClassroomPageSpecResponse] = Field(description="解析后的页面结构。")
