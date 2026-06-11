from __future__ import annotations

import json
import re
from html import escape
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..state import MediaResource, PageBlueprint, PageSpec, SlideTaskState, WindowContext
from ._common import flatten_content, invoke_llm_with_retry, is_retryable_llm_exception, load_prompt


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
        prompt_name: str = "slide.md",
        max_attempts: int = 3,
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt or load_prompt(prompt_name)
        self._max_attempts = max_attempts

    def __call__(self, state: SlideTaskState | dict[str, Any]) -> dict[str, dict[int, str]]:
        page = state.get("page")
        if not isinstance(page, dict):
            raise ValueError("SlideHtmlAgent requires a page payload.")

        typed_page = page  # runtime TypedDict compatibility
        idx = typed_page["idx"]
        page_blueprint = state.get("page_blueprint") if isinstance(state.get("page_blueprint"), dict) else None
        window_context = _normalize_window_context(state.get("window_context"))
        media_resources = state.get("media_resources") or []
        feedback = ""
        attempts: list[dict[str, Any]] = []
        last_error: Exception | None = None

        for attempt_no in range(1, self._max_attempts + 1):
            try:
                response = invoke_llm_with_retry(
                    lambda: self._llm.invoke(
                        [
                            SystemMessage(content=self._system_prompt),
                            HumanMessage(
                                content=self._build_user_prompt(
                                    typed_page,
                                    page_blueprint=page_blueprint,
                                    window_context=window_context,
                                    media_resources=media_resources,
                                    feedback=feedback,
                                )
                            ),
                        ]
                    )
                )
            except Exception as exc:
                if is_retryable_llm_exception(exc):
                    return {
                        "htmls": {
                            idx: self._build_fallback_html(
                                typed_page,
                                page_blueprint=page_blueprint,
                            )
                        }
                    }
                raise

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
    def _build_fallback_html(
        page: PageSpec,
        *,
        page_blueprint: PageBlueprint | None,
    ) -> str:
        idx = page["idx"]
        title = escape(page_blueprint["theme"] if page_blueprint else f"第 {idx + 1} 页")
        objective = escape(page_blueprint["objective"] if page_blueprint else page.get("on_slide_summary", ""))
        reveal_blocks = []
        for reveal_idx, reveal in enumerate(page["reveals"]):
            narration = escape(str(reveal.get("narration") or "").strip())
            on_slide = escape(str(reveal.get("on_slide") or "").strip())
            reveal_blocks.append(
                f"""
      <article class="step{' active' if reveal_idx == 0 else ''}">
        <div class="step-index">{reveal_idx + 1:02d}</div>
        <div class="step-body">
          <p>{narration}</p>
          {'<div class="hint">' + on_slide + '</div>' if on_slide else ''}
        </div>
      </article>"""
            )
        steps = "\n".join(reveal_blocks)
        return f"""<section class="card" data-idx="{idx}">
  <style>
    .card {{
      width: 100%;
      height: 100vh;
      box-sizing: border-box;
      padding: 44px;
      overflow: hidden;
      color: #172033;
      background: linear-gradient(135deg, #f8fafc 0%, #e8f4ff 48%, #f5f0ff 100%);
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .fallback-badge {{
      display: inline-flex;
      margin-bottom: 18px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.1);
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 700;
    }}
    h1 {{
      margin: 0;
      font-size: 34px;
      line-height: 1.2;
      letter-spacing: 0;
    }}
    .objective {{
      margin: 12px 0 28px;
      max-width: 920px;
      color: #526071;
      font-size: 16px;
      line-height: 1.7;
    }}
    .steps {{
      display: grid;
      gap: 14px;
      max-height: calc(100vh - 210px);
      overflow: hidden;
    }}
    .step {{
      display: none;
      grid-template-columns: 54px 1fr;
      gap: 18px;
      padding: 20px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.08);
    }}
    .step.active {{
      display: grid;
    }}
    .step-index {{
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: #1d4ed8;
      color: white;
      font-weight: 800;
    }}
    .step-body p {{
      margin: 0;
      font-size: 18px;
      line-height: 1.8;
    }}
    .hint {{
      margin-top: 12px;
      padding: 12px 14px;
      border-left: 4px solid #8b5cf6;
      border-radius: 10px;
      background: rgba(139, 92, 246, 0.1);
      color: #4c1d95;
      font-size: 15px;
      line-height: 1.6;
    }}
  </style>
  <div class="fallback-badge">简版课件页</div>
  <h1>{title}</h1>
  <p class="objective">{objective}</p>
  <div class="steps">{steps}
  </div>
  <script>
    window.to_next = function () {{
      const card = document.querySelector('.card[data-idx="{idx}"]');
      if (!card) return false;
      const steps = Array.from(card.querySelectorAll('.step'));
      const currentIndex = steps.findIndex((step) => step.classList.contains('active'));
      const next = steps[currentIndex + 1];
      if (!next) return false;
      steps[currentIndex]?.classList.remove('active');
      next.classList.add('active');
      return true;
    }};
  </script>
</section>"""

    @staticmethod
    def _build_user_prompt(
        page: PageSpec,
        *,
        page_blueprint: PageBlueprint | None,
        window_context: list[WindowContext],
        media_resources: list[MediaResource] | None = None,
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
            "source_storyboard_block_id": page_blueprint.get("source_storyboard_block_id") if page_blueprint else None,
            "material_focus": page_blueprint.get("material_focus", []) if page_blueprint else [],
            "visual_plan": page_blueprint.get("visual_plan") if page_blueprint else None,
            "layout_style": page_blueprint.get("layout_style") if page_blueprint else None,
            "interaction_plan": page_blueprint.get("interaction_plan") if page_blueprint else None,
            "suggested_media_types": page_blueprint.get("suggested_media_types", []) if page_blueprint else [],
            "steps": step_specs,
            "window_context": window_context,
        }
        media_resources = media_resources or []
        media_section = ""
        if media_resources:
            media_section = (
                "\n\n- 以下是课前生成的媒体资源，你可以在卡片中嵌入它们：\n"
                "  - `resource_type` 为 `video` 的资源用 `<video src=\"{relative_path}\" controls>` 嵌入；\n"
                "  - `resource_type` 为 `interactive_html` 的资源用 `<iframe src=\"{relative_path}\">` 嵌入；\n"
                "  - `resource_type` 为 `image` 的资源用 `<figure><img src=\"{relative_path}\" alt=\"...\"><figcaption>...</figcaption></figure>` 嵌入；\n"
                "  - 图片必须使用资源中的本地 `relative_path`，不要自己编造或引用外部图片 URL；\n"
                "  - 图片需要配简短 figcaption，可包含 attribution 字段中的来源署名；\n"
                "  - 只嵌入与当前页内容相关的资源，不相关的忽略。\n"
                f"{json.dumps(media_resources, ensure_ascii=False, indent=2)}"
            )
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
            "- 必须优先执行 `visual_plan` 和 `layout_style`：不同页要呈现不同形态，如场景地图、概念板、样例演算、媒体实验、诊断题卡、总结路线图。\n"
            "- `material_focus` 是本页素材焦点，页面内容必须围绕这些素材分块生成，避免把整节课材料平均复述。\n"
            "- 如果 `layout_style` 是互动/实验/诊断类，请加入可观察的控件、对比状态、步骤反馈或题目区，而不是静态文字页。\n"
            "- `window_context` 只是附近页面的风格与节奏参考，禁止复述其中的 summary 原文。\n\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
            f"{media_section}"
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
