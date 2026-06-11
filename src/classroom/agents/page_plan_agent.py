from __future__ import annotations

import json
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..state import ClassState, PageBlueprint
from ._common import extract_json_object, flatten_content, invoke_llm_with_retry, load_prompt


class PagePlanItemModel(BaseModel):
    idx: int = Field(ge=0)
    theme: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    key_points: list[str] = Field(min_length=1)
    target_reveal_count: int = Field(ge=3, le=6)
    quiz_goal: str | None = None
    source_storyboard_block_id: str | None = None
    material_focus: list[str] = Field(default_factory=list)
    visual_plan: str | None = None
    layout_style: str | None = None
    interaction_plan: str | None = None
    suggested_media_types: list[str] = Field(default_factory=list)


class PagePlanModel(BaseModel):
    page_count: int = Field(ge=4, le=12)
    pages: list[PagePlanItemModel] = Field(min_length=4)


class PagePlanAgent:
    def __init__(
        self,
        llm: BaseChatModel,
        *,
        system_prompt: str | None = None,
        max_attempts: int = 3,
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt or load_prompt("page_plan.md")
        self._max_attempts = max_attempts

    def __call__(self, state: ClassState) -> dict[str, list[PageBlueprint]]:
        outline = state.get("outline")
        if not isinstance(outline, dict) or not outline:
            raise ValueError("PagePlanAgent requires a non-empty outline.")

        feedback = ""
        last_error: Exception | None = None
        for _ in range(self._max_attempts):
            response = invoke_llm_with_retry(
                lambda: self._llm.invoke(
                    [
                        SystemMessage(content=self._system_prompt),
                        HumanMessage(content=self._build_user_prompt(state, feedback=feedback)),
                    ]
                )
            )
            raw_text = flatten_content(response.content)
            try:
                payload = json.loads(extract_json_object(raw_text))
                plan = PagePlanModel.model_validate(payload)
                normalized = self._normalize_plan(plan)
                return {"page_blueprints": normalized}
            except Exception as exc:
                last_error = exc
                feedback = (
                    "\n\n上一次输出不符合页面规划 JSON 契约，请重写并修复："
                    f"{exc}\n"
                    "只返回一个 JSON 对象，不要输出 markdown 围栏或说明。"
                )

        raise ValueError(
            f"PagePlanAgent failed to produce a valid page plan after {self._max_attempts} attempts: {last_error}"
        )

    @staticmethod
    def _build_user_prompt(state: ClassState, *, feedback: str = "") -> str:
        outline = state.get("outline") or {}
        storyboard = outline.get("lesson_storyboard") if isinstance(outline, dict) else None
        payload: dict[str, Any] = {
            "topic": str(state.get("topic", "")).strip(),
            "materials": state.get("materials") or [],
            "outline": outline,
            "lesson_storyboard": storyboard if isinstance(storyboard, list) else [],
            "media_resources": state.get("media_resources") or [],
        }
        return (
            "请先规划这节 AI 课堂总共需要多少页，以及每一页讲什么。\n"
            "- 只返回 JSON。\n"
            "- 每页都要有明确主题、目标和要点。\n"
            "- 页面数不要太少，通常至少 4 页。\n\n"
            "规划时请先判断课型，再决定页面节奏：\n"
            "- 不要机械套用固定 5 段式；计算训练、阅读讨论、实验探究、项目实践等课型应有不同页面结构。\n"
            "- `lesson_storyboard` 是课前素材候选池，不是必须照抄的页面模板。\n"
            "- 可以根据课型合并、跳过、重排、拆分 storyboard 素材块，也可以创建更适合内容的新页面。\n"
            "- 页面确实主要承接某个素材块时，再绑定一个 `source_storyboard_block_id`；重新组织出的页面可以填 null。\n"
            "- 每页必须给出 `material_focus`，说明这页真正要复用哪些素材/题目/案例。\n"
            "- 每页必须给出 `visual_plan` 和 `layout_style`，让后续 HTML 卡片呈现足够多样。\n"
            "- 如果某页适合嵌入媒体，请在 `suggested_media_types` 写 video、interactive_html 或 image。\n"
            "- 页面之间的 `layout_style` 不要全部相同，应跟随教学任务变化，例如错因诊断、分步演算、立场光谱、证据墙、互动实验、总结路线图等。\n\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
            f"{feedback}"
        )

    @staticmethod
    def _normalize_plan(plan: PagePlanModel) -> list[PageBlueprint]:
        pages = sorted(plan.pages, key=lambda item: item.idx)
        if len(pages) != plan.page_count:
            raise ValueError("page_count does not match the number of page items.")
        expected_indexes = list(range(plan.page_count))
        actual_indexes = [item.idx for item in pages]
        if actual_indexes != expected_indexes:
            raise ValueError("Page indexes must be contiguous and start at 0.")
        return [
            {
                "idx": item.idx,
                "theme": item.theme.strip(),
                "objective": item.objective.strip(),
                "key_points": [point.strip() for point in item.key_points if point.strip()],
                "target_reveal_count": item.target_reveal_count,
                "quiz_goal": item.quiz_goal.strip() if isinstance(item.quiz_goal, str) and item.quiz_goal.strip() else None,
                "source_storyboard_block_id": (
                    item.source_storyboard_block_id.strip()
                    if isinstance(item.source_storyboard_block_id, str) and item.source_storyboard_block_id.strip()
                    else None
                ),
                "material_focus": [point.strip() for point in item.material_focus if point.strip()],
                "visual_plan": item.visual_plan.strip() if isinstance(item.visual_plan, str) and item.visual_plan.strip() else None,
                "layout_style": item.layout_style.strip() if isinstance(item.layout_style, str) and item.layout_style.strip() else None,
                "interaction_plan": (
                    item.interaction_plan.strip()
                    if isinstance(item.interaction_plan, str) and item.interaction_plan.strip()
                    else None
                ),
                "suggested_media_types": [
                    media_type.strip()
                    for media_type in item.suggested_media_types
                    if isinstance(media_type, str) and media_type.strip()
                ],
            }
            for item in pages
        ]
