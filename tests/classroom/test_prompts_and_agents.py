from __future__ import annotations

import re
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage

from classroom.agents._common import list_slide_prompt_names, validate_slide_prompt_name
from classroom.agents.slide_agent import SlideHtmlAgent, SlideHtmlGenerationError


PROMPT_ROOT = Path(__file__).resolve().parents[2] / "src" / "classroom" / "prompts"


def test_page_script_prompt_contains_tag_contract() -> None:
    prompt = (PROMPT_ROOT / "script_page.md").read_text(encoding="utf-8")

    for token in (
        "<to_next/>",
        "<question>",
        "<false_intro>",
    ):
        assert token in prompt
    assert "<to_next_page/>" in prompt
    assert "讲解内容请尽可能的多且充分" in prompt
    assert "同一节课" in prompt
    assert "<fill>" in prompt
    assert "<choice>" in prompt
    assert "合法 XML" in prompt


def test_card_prompt_contains_required_contract() -> None:
    prompt = (PROMPT_ROOT / "slide.md").read_text(encoding="utf-8")
    assert re.search(r"window\.to_next\s*=\s*function\s*\(\)\s*\{", prompt)
    assert '<section class="card" data-idx="{idx}">' in prompt
    assert "MathJax" in prompt
    assert "display_hint" in prompt
    assert "默认且完全处于可见状态" in prompt


def test_slide_prompt_variants_are_discoverable() -> None:
    prompt_names = list_slide_prompt_names()

    assert "slide.md" in prompt_names
    assert "slide.creative.md" in prompt_names
    assert validate_slide_prompt_name("slide.creative.md") == "slide.creative.md"


def test_slide_html_validation_rejects_leaked_summary() -> None:
    page = {
        "idx": 0,
        "reveals": [
            {"narration": "第一步", "on_slide": "标题"},
            {"narration": "第二步", "on_slide": None},
        ],
        "quizzes": [],
        "on_slide_summary": "标题",
    }
    html = (
        '<section class="card" data-idx="0">'
        '<div class="reveal">上一页摘要原文</div>'
        '<div class="reveal" hidden></div>'
        "<script>window.to_next = function () { return false; };</script>"
        "</section>"
    )

    with pytest.raises(ValueError, match="neighboring summaries"):
        SlideHtmlAgent._validate_html_output(
            html,
            page=page,
            window_context=[
                {
                    "idx": 1,
                    "offset": -1,
                    "theme": "前页主题",
                    "summary": "上一页摘要原文",
                }
            ],
        )


def test_slide_html_normalizes_markdown_fences() -> None:
    raw_html = """```html
<section class="card" data-idx="0">
  <div>content</div>
  <script>window.to_next = function () { return false; };</script>
</section>
```"""

    normalized = SlideHtmlAgent._normalize_html_output(raw_html)

    assert normalized.startswith('<section class="card" data-idx="0">')
    assert "```" not in normalized


class FakeChatModel:
    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self.calls: list[list[object]] = []

    def invoke(self, messages: list[object]) -> AIMessage:
        self.calls.append(messages)
        response = self._responses[len(self.calls) - 1]
        return AIMessage(content=response)


def _slide_state() -> dict:
    return {
        "page": {
            "idx": 0,
            "reveals": [
                {"narration": "第一步讲稿", "on_slide": None},
                {"narration": "第二步讲稿", "on_slide": None},
            ],
            "quizzes": [],
            "on_slide_summary": "",
        },
        "page_blueprint": {
            "idx": 0,
            "theme": "概念引入",
            "objective": "建立问题",
            "key_points": ["现象", "问题"],
            "target_reveal_count": 3,
            "quiz_goal": None,
        },
        "window_context": [],
    }


def test_slide_html_agent_retries_when_to_next_missing() -> None:
    llm = FakeChatModel(
        [
            '<section class="card" data-idx="0"><div>bad</div></section>',
            '<section class="card" data-idx="0"><div>good</div><script>window.to_next = function () { return false; };</script></section>',
        ]
    )
    agent = SlideHtmlAgent(llm, max_attempts=2)  # type: ignore[arg-type]

    result = agent(_slide_state())

    assert len(llm.calls) == 2
    assert "window.to_next" in result["htmls"][0]


def test_slide_html_agent_failure_carries_attempt_html() -> None:
    llm = FakeChatModel(
        [
            '<section class="card" data-idx="0"><div>bad-1</div></section>',
            '<section class="card" data-idx="0"><div>bad-2</div></section>',
        ]
    )
    agent = SlideHtmlAgent(llm, max_attempts=2)  # type: ignore[arg-type]

    try:
        agent(_slide_state())
    except SlideHtmlGenerationError as exc:
        payload = exc.to_event_data()
        assert payload["page_idx"] == 0
        assert payload["attempt_count"] == 2
        assert "bad-2" in payload["last_html"]
        assert payload["attempts"][0]["error"] == "HTML output must define window.to_next."
    else:
        raise AssertionError("Expected SlideHtmlGenerationError to be raised.")
