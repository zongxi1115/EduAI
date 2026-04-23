from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..state import PageBlueprint, PageSpec, SlideTaskState, WindowContext
from ._common import flatten_content, load_prompt


class SlideHtmlGenerationError(ValueError):
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
            "last_html": last_attempt.get("html"),
            "attempts": self.attempts,
        }


class SlideHtmlAgent:
    def __init__(
        self,
        llm: BaseChatModel,
        *,
        system_prompt: str | None = None,
        max_attempts: int = 3,
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt or load_prompt("slide.md")
        self._max_attempts = max_attempts

    def __call__(self, state: SlideTaskState | dict[str, Any]) -> dict[str, dict[int, str]]:
        page = state.get("page")
        if not isinstance(page, dict):
            raise ValueError("SlideHtmlAgent requires a page payload.")

        typed_page = page  # runtime TypedDict compatibility
        idx = typed_page["idx"]
        page_blueprint = state.get("page_blueprint") if isinstance(state.get("page_blueprint"), dict) else None
        window_context = _normalize_window_context(state.get("window_context"))
        feedback = ""
        attempts: list[dict[str, Any]] = []
        last_error: Exception | None = None

        for attempt_no in range(1, self._max_attempts + 1):
            response = self._llm.invoke(
                [
                    SystemMessage(content=self._system_prompt),
                    HumanMessage(
                        content=self._build_user_prompt(
                            typed_page,
                            page_blueprint=page_blueprint,
                            window_context=window_context,
                            feedback=feedback,
                        )
                    ),
                ]
            )
            html = self._normalize_html_output(flatten_content(response.content, separator="\n"))
            try:
                self._validate_html_output(
                    html,
                    page=typed_page,
                    window_context=window_context,
                )
                return {"htmls": {idx: html}}
            except Exception as exc:
                last_error = exc
                attempts.append(
                    {
                        "attempt": attempt_no,
                        "html": html,
                        "error": str(exc),
                    }
                )
                feedback = (
                    "\n\n上一次输出没有通过 HTML 卡片契约校验，请完整重写当前这一页并修复："
                    f"{exc}\n"
                    "注意：必须输出 `<section class=\"card\" data-idx=\"{idx}\">` 根元素；"
                    "必须定义 `window.to_next()`；"
                    "不要输出 markdown 围栏或解释。"
                )

        raise SlideHtmlGenerationError(
            page_idx=idx,
            page_theme=page_blueprint["theme"] if page_blueprint else None,
            attempts=attempts,
            message=(
                f"SlideHtmlAgent failed to produce a valid HTML card after {self._max_attempts} attempts: "
                f"{last_error}"
            ),
        )

    @staticmethod
    def _normalize_html_output(raw_html: str) -> str:
        stripped = raw_html.strip()
        fence_match = re.search(
            r"```(?:html|HTML)?\s*(.*?)```",
            stripped,
            re.DOTALL,
        )
        if fence_match:
            stripped = fence_match.group(1).strip()

        section_start = stripped.find("<section")
        section_end = stripped.rfind("</section>")
        if section_start != -1 and section_end != -1 and section_end > section_start:
            stripped = stripped[section_start : section_end + len("</section>")].strip()

        return stripped

    @staticmethod
    def _build_user_prompt(
        page: PageSpec,
        *,
        page_blueprint: PageBlueprint | None,
        window_context: list[WindowContext],
        feedback: str = "",
    ) -> str:
        step_specs = [
            {
                "idx": step_idx,
                "narration": reveal["narration"],
                "display_hint": reveal["on_slide"],
            }
            for step_idx, reveal in enumerate(page["reveals"])
        ]
        payload = {
            "idx": page["idx"],
            "aspect_ratio": "16:9",
            "page_theme": page_blueprint["theme"] if page_blueprint else None,
            "page_objective": page_blueprint["objective"] if page_blueprint else None,
            "page_key_points": page_blueprint["key_points"] if page_blueprint else [],
            "steps": step_specs,
            "window_context": window_context,
        }
        return (
            "请根据下面的卡片规格输出一段 HTML。\n"
            "- 只输出 HTML 文本。\n"
            "- `steps[*].narration` 是这一页真正的讲稿内容，你需要根据它来决定页面如何表达。\n"
            "- `steps[*].display_hint` 只是可选提示；没有它时也要根据 narration 自己完成页面设计。\n"
            "- 你可以自由决定内部 DOM 结构，不要求使用固定的 `.reveal` 容器数量。\n"
            "- 唯一硬约束是：页面必须围绕这页讲稿内容生成，并正确提供 `window.to_next()` 步进方法。\n"
            "- 把 `page_theme`、`page_objective` 和 `page_key_points` 当成软参考，而不是硬模板。\n"
            "- 页面可以提炼、概括、图解、重组讲稿内容，不要求逐字照抄 narration。\n"
            "- 重点是让这一页内容丰满、层次清晰、过渡顺滑，而不是拘泥于固定文本槽位。\n"
            "- `window_context` 只是附近页面的风格与节奏参考，禁止复述其中的 summary 原文。\n\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
            f"{feedback}"
        )

    @staticmethod
    def _validate_html_output(
        html: str,
        *,
        page: PageSpec,
        window_context: list[WindowContext],
    ) -> None:
        stripped = html.strip()
        idx = page["idx"]

        if "<question>" in stripped or "<false_intro>" in stripped:
            raise ValueError("HTML output must not contain question control tags.")
        if any(tag in stripped.lower() for tag in ("<html", "<head", "<body")):
            raise ValueError("HTML output must not include html/head/body wrappers.")
        for entry in window_context:
            summary = entry["summary"]
            if summary and summary in stripped:
                raise ValueError("HTML output must not copy neighboring summaries verbatim.")

        if not stripped.startswith("<section"):
            raise ValueError("HTML output must start with a <section> root element.")
        if "window.to_next" not in stripped:
            raise ValueError("HTML output must define window.to_next.")


def _optional_text(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _normalize_window_context(value: Any) -> list[WindowContext]:
    if not isinstance(value, list):
        return []
    normalized: list[WindowContext] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        summary = _optional_text(item.get("summary")) or ""
        normalized.append(
            {
                "idx": int(item.get("idx", 0)),
                "offset": int(item.get("offset", 0)),
                "theme": _optional_text(item.get("theme")),
                "summary": summary,
            }
        )
    return normalized
