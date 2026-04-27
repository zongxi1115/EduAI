from __future__ import annotations

import json
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..state import ClassState, PageBlueprint
from ._common import extract_json_object, flatten_content, load_prompt


class PagePlanItemModel(BaseModel):
    idx: int = Field(ge=0)
    theme: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    key_points: list[str] = Field(min_length=1)
    target_reveal_count: int = Field(ge=3, le=6)
    quiz_goal: str | None = None


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
            response = self._llm.invoke(
                [
                    SystemMessage(content=self._system_prompt),
                    HumanMessage(content=self._build_user_prompt(state, feedback=feedback)),
                ]
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
        payload: dict[str, Any] = {
            "topic": str(state.get("topic", "")).strip(),
            "materials": state.get("materials") or [],
            "outline": state.get("outline") or {},
        }
        return (
            "请先规划这节 AI 课堂总共需要多少页，以及每一页讲什么。\n"
            "- 只返回 JSON。\n"
            "- 每页都要有明确主题、目标和要点。\n"
            "- 页面数不要太少，通常至少 4 页。\n\n"
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
            }
            for item in pages
        ]
