from __future__ import annotations

from langchain_core.messages import AIMessage

from classroom.agents.page_plan_agent import PagePlanAgent


class FakeChatModel:
    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self.calls: list[list[object]] = []

    def invoke(self, messages: list[object]) -> AIMessage:
        self.calls.append(messages)
        response = self._responses[len(self.calls) - 1]
        return AIMessage(content=response)


def _plan_state() -> dict:
    return {
        "topic": "牛顿第二定律",
        "materials": ["教材", "需要例题"],
        "outline": {"title": "牛顿第二定律", "sections": ["定义", "公式", "应用"]},
    }


def test_page_plan_agent_parses_json_plan() -> None:
    llm = FakeChatModel(
        [
            """
            {
              "page_count": 4,
              "pages": [
                {"idx": 0, "theme": "引入", "objective": "建立问题", "key_points": ["现象"], "target_reveal_count": 3, "quiz_goal": null},
                {"idx": 1, "theme": "概念", "objective": "理解概念", "key_points": ["定义"], "target_reveal_count": 4, "quiz_goal": "检查定义"},
                {"idx": 2, "theme": "公式", "objective": "理解公式", "key_points": ["F=ma"], "target_reveal_count": 4, "quiz_goal": null},
                {"idx": 3, "theme": "应用", "objective": "解决例题", "key_points": ["代入求解"], "target_reveal_count": 3, "quiz_goal": "检查迁移"}
              ]
            }
            """
        ]
    )
    agent = PagePlanAgent(llm)  # type: ignore[arg-type]

    result = agent(_plan_state())

    assert len(llm.calls) == 1
    assert len(result["page_blueprints"]) == 4
    assert result["page_blueprints"][1]["theme"] == "概念"


def test_page_plan_agent_retries_invalid_json_shape() -> None:
    llm = FakeChatModel(
        [
            '{"page_count":2,"pages":[{"idx":0,"theme":"引入","objective":"建立问题","key_points":["现象"],"target_reveal_count":3,"quiz_goal":null}]}',
            """
            {
              "page_count": 4,
              "pages": [
                {"idx": 0, "theme": "引入", "objective": "建立问题", "key_points": ["现象"], "target_reveal_count": 3, "quiz_goal": null},
                {"idx": 1, "theme": "概念", "objective": "理解概念", "key_points": ["定义"], "target_reveal_count": 4, "quiz_goal": "检查定义"},
                {"idx": 2, "theme": "公式", "objective": "理解公式", "key_points": ["F=ma"], "target_reveal_count": 4, "quiz_goal": null},
                {"idx": 3, "theme": "应用", "objective": "解决例题", "key_points": ["代入求解"], "target_reveal_count": 3, "quiz_goal": "检查迁移"}
              ]
            }
            """,
        ]
    )
    agent = PagePlanAgent(llm, max_attempts=2)  # type: ignore[arg-type]

    result = agent(_plan_state())

    assert len(llm.calls) == 2
    assert result["page_blueprints"][3]["theme"] == "应用"
