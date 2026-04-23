from __future__ import annotations

from langchain_core.messages import AIMessage

from classroom.agents.script_agent import PageScriptAgent, PageScriptGenerationError


class FakeChatModel:
    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self.calls: list[list[object]] = []

    def invoke(self, messages: list[object]) -> AIMessage:
        self.calls.append(messages)
        response = self._responses[len(self.calls) - 1]
        return AIMessage(content=response)


def _page_state() -> dict:
    return {
        "topic": "牛顿第二定律",
        "materials": ["教材"],
        "outline": {"title": "牛顿第二定律"},
        "page_blueprint": {
            "idx": 1,
            "theme": "公式理解",
            "objective": "理解 F=ma",
            "key_points": ["公式", "物理量含义"],
            "target_reveal_count": 3,
            "quiz_goal": "检查公式识别",
        },
        "prev_theme": "现象引入",
        "next_theme": "代入例题",
    }


def test_page_script_agent_normalizes_fullwidth_question_json_without_retry() -> None:
    llm = FakeChatModel(
        [
            (
                "我们先看公式 F = ma。<to_next/>"
                "再做检查。"
                "<question><fill><prompt>公式是什么？</prompt><answer>F=ma</answer></fill></question>"
                "<false_intro>注意这里要回忆公式。</false_intro>"
            )
        ]
    )
    agent = PageScriptAgent(llm)  # type: ignore[arg-type]

    result = agent(_page_state())

    assert len(llm.calls) == 1
    assert 1 in result["page_scripts"]
    assert "<question><fill><prompt>公式是什么？</prompt><answer>F=ma</answer></fill></question>" in result["page_scripts"][1]


def test_page_script_agent_retries_when_first_attempt_breaks_contract() -> None:
    llm = FakeChatModel(
        [
            "第一页。<to_next_page/>   ",
            "第一页先引出公式。<to_next/>第二步检查理解。<question><fill><prompt>公式是什么？</prompt><answer>F=ma</answer></fill></question><false_intro>回忆公式。</false_intro>",
        ]
    )
    agent = PageScriptAgent(llm, max_attempts=2)  # type: ignore[arg-type]

    result = agent(_page_state())

    assert len(llm.calls) == 2
    assert "<to_next_page/>" not in result["page_scripts"][1]


def test_page_script_agent_failure_carries_attempt_scripts() -> None:
    llm = FakeChatModel(
        [
            "第一页。<to_next_page/>   ",
            "第二次也错了。<to_next_page/>   ",
        ]
    )
    agent = PageScriptAgent(llm, max_attempts=2)  # type: ignore[arg-type]

    try:
        agent(_page_state())
    except PageScriptGenerationError as exc:
        payload = exc.to_event_data()
        assert payload["page_idx"] == 1
        assert payload["attempt_count"] == 2
        assert "to_next_page" in payload["last_page_script"]
        assert len(payload["attempts"]) == 2
    else:
        raise AssertionError("Expected PageScriptGenerationError to be raised.")
