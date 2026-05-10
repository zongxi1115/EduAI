from __future__ import annotations

from operator import or_
from typing import Annotated, Any, Literal, TypedDict


class MediaResource(TypedDict):
    resource_type: Literal["video", "interactive_html", "image"]
    file_path: str
    relative_path: str
    description: str
    source_agent: str


class PageBlueprint(TypedDict):
    idx: int
    theme: str
    objective: str
    key_points: list[str]
    target_reveal_count: int
    quiz_goal: str | None


class Reveal(TypedDict):
    narration: str
    on_slide: str | None


class Quiz(TypedDict):
    after_reveal_idx: int
    payload: dict[str, Any]
    false_intro: str | None


class PageSpec(TypedDict):
    idx: int
    reveals: list[Reveal]
    quizzes: list[Quiz]
    on_slide_summary: str


class ClassroomPageBundle(TypedDict):
    idx: int
    html: str
    reveals: list[dict[str, str]]
    quizzes: list[Quiz]


class ClassroomBundle(TypedDict):
    pages: list[ClassroomPageBundle]


class ClassState(TypedDict, total=False):
    topic: str
    materials: list[str]
    outline: dict[str, Any]
    media_resources: list[MediaResource]
    page_blueprints: list[PageBlueprint]
    page_scripts: Annotated[dict[int, str], or_]
    script: str
    pages: list[PageSpec]
    htmls: Annotated[dict[int, str], or_]
    assembled: ClassroomBundle


class PageScriptTaskState(TypedDict, total=False):
    topic: str
    materials: list[str]
    outline: dict[str, Any]
    media_resources: list[MediaResource]
    page_blueprint: PageBlueprint
    total_pages: int
    prev_theme: str | None
    next_theme: str | None
    page_scripts: Annotated[dict[int, str], or_]


class WindowContext(TypedDict):
    idx: int
    offset: int
    theme: str | None
    summary: str


class SlideTaskState(TypedDict, total=False):
    page: PageSpec
    page_blueprint: PageBlueprint | None
    window_context: list[WindowContext]
    media_resources: list[MediaResource]
    htmls: Annotated[dict[int, str], or_]
