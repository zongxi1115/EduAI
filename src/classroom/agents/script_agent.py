from __future__ import annotations

import json
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..parser import normalize_script_question_payload, parse_page
from ..state import PageScriptTaskState
from ._common import flatten_content, invoke_llm_with_retry, load_prompt


class PageScriptGenerationError(ValueError):
    def __init__(
        self,
        *,
        page_idx: int,
        page_theme: str | None,
        attempts: list[dict[str, Any]],
        message: str,
    ) -> None:
        super().__init__(message)
        self.page_idx = page_idx
        self.page_theme = page_theme
        self.attempts = attempts

    def to_event_data(self) -> dict[str, Any]:
        last_attempt = self.attempts[-1] if self.attempts else {}
        return {
            "page_idx": self.page_idx,
            "page_theme": self.page_theme,
            "attempt_count": len(self.attempts),
            "last_page_script": last_attempt.get("page_script"),
            "attempts": self.attempts,
        }


class PageScriptAgent:
    def __init__(
        self,
        llm: BaseChatModel,
        *,
        system_prompt: str | None = None,
        max_attempts: int = 5,
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt or load_prompt("script_page.md")
        self._max_attempts = max_attempts

    def __call__(self, state: PageScriptTaskState | dict[str, Any]) -> dict[str, dict[int, str]]:
        page_blueprint = state.get("page_blueprint")
        if not isinstance(page_blueprint, dict):
            raise ValueError("PageScriptAgent requires a page_blueprint payload.")

        feedback = ""
        last_error: Exception | None = None
        page_idx = int(page_blueprint["idx"])
        attempts: list[dict[str, Any]] = []
        for attempt_no in range(1, self._max_attempts + 1):
            response = invoke_llm_with_retry(
                lambda: self._llm.invoke(
                    [
                        SystemMessage(content=self._system_prompt),
                        HumanMessage(
                            content=self._build_user_prompt(state, feedback=feedback)
                        ),
                    ]
                )
            )
            page_script = normalize_script_question_payload(flatten_content(response.content))
            try:
                parse_page(page_script, page_idx)
                return {"page_scripts": {page_idx: page_script}}
            except Exception as exc:
                last_error = exc
                attempts.append(
                    {
                        "attempt": attempt_no,
                        "page_script": page_script,
                        "error": str(exc),
                    }
                )
                feedback = (
                    "\n\n上一次输出没有通过单页课堂脚本契约校验，请完整重写当前这一页并修复："
                    f"{exc}\n"
                    "注意：这一页禁止出现 <to_next_page/>；"
                    "只输出当前页脚本文本；"
                    "<question> 内必须是合法 XML。"
                )

        raise PageScriptGenerationError(
            page_idx=page_idx,
            page_theme=str(page_blueprint.get("theme") or "").strip() or None,
            attempts=attempts,
            message=(
                f"PageScriptAgent failed to produce a valid page script after {self._max_attempts} attempts: "
                f"{last_error}"
            ),
        )

    @staticmethod
    def _build_user_prompt(
        state: PageScriptTaskState | dict[str, Any],
        *,
        feedback: str = "",
    ) -> str:
        payload: dict[str, Any] = {
            "topic": str(state.get("topic", "")).strip(),
            "materials": state.get("materials") or [],
            "outline": state.get("outline") or {},
            "page_blueprint": state.get("page_blueprint") or {},
            "page_position": {
                "idx": (state.get("page_blueprint") or {}).get("idx"),
                "total_pages": state.get("total_pages"),
            },
            "neighbor_themes": {
                "previous": state.get("prev_theme"),
                "next": state.get("next_theme"),
            },
        }
        return (
            "请根据下面的页面规划，只写当前这一页的课堂讲稿。\n"
            "- 只输出当前页脚本，不要输出整节课脚本。\n"
            "- 这是同一节课中的连续一页，不是另一节课，也不是上节课复习。\n"
            "- 这一页必须承接上文并自然过渡到下文，绝对不要写成“上节课我们讲了……”或“下节课再讲……”之类的断裂表述，除非输入明确要求回顾。\n"
            "- 当前页内部用 <to_next/> 分步。\n"
            "- 当前页禁止输出 <to_next_page/>。\n"
            "- 按照 target_reveal_count 生成 3 到 6 个 reveal。\n"
            "- 如果提供了 quiz_goal，请在本页安排 1 个 <question> 和紧随其后的 <false_intro>。\n"
            "- 每个 reveal 都尽量写一个 <on_slide>，放这一屏应展示的结构化内容、公式、图解说明、表格要点或代码片段。\n"
            "- <on_slide> 不是旁白复读，应服务于画面设计；旁白在标签外，页面显示内容在标签内。\n"
            "- 优先复用 page_blueprint.material_focus 中的素材块，不要把整份材料平均摊开。\n"
            "- 不要输出 markdown 围栏或解释。\n\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
            f"{feedback}"
        )


ScriptAgent = PageScriptAgent
