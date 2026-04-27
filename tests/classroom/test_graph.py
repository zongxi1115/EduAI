from __future__ import annotations

from classroom.graph import build_graph, fanout, fanout_page_scripts


def _make_card_html(idx: int, reveal_count: int) -> str:
    reveal_blocks = []
    for reveal_idx in range(reveal_count):
        hidden = "" if reveal_idx == 0 else " hidden"
        reveal_blocks.append(
            f'<div class="reveal"{hidden}>step-{idx}-{reveal_idx}</div>'
        )
    return (
        f'<section class="card" data-idx="{idx}">'
        f"{''.join(reveal_blocks)}"
        "<script>"
        "window.to_next = function () {"
        f"const hidden = document.querySelector('section[data-idx=\"{idx}\"] .reveal[hidden]');"
        "if (!hidden) return false;"
        "hidden.removeAttribute('hidden');"
        "return true;"
        "};"
        "</script>"
        "</section>"
    )


def test_fanout_page_scripts_builds_neighbor_context() -> None:
    state = {
        "topic": "牛顿第二定律",
        "materials": ["教材"],
        "outline": {"title": "牛顿第二定律"},
        "page_blueprints": [
            {
                "idx": 0,
                "theme": "引入",
                "objective": "建立概念",
                "key_points": ["现象"],
                "target_reveal_count": 3,
                "quiz_goal": None,
            },
            {
                "idx": 1,
                "theme": "公式",
                "objective": "理解 F=ma",
                "key_points": ["公式"],
                "target_reveal_count": 4,
                "quiz_goal": "检查公式识别",
            },
        ],
    }

    sends = fanout_page_scripts(state)

    assert len(sends) == 2
    assert sends[0].node == "page_script"
    assert sends[0].arg["total_pages"] == 2
    assert sends[0].arg["prev_theme"] is None
    assert sends[0].arg["next_theme"] == "公式"
    assert sends[1].arg["prev_theme"] == "引入"
    assert sends[1].arg["next_theme"] is None


def test_fanout_builds_sliding_window_context() -> None:
    state = {
        "pages": [
            {"idx": 0, "reveals": [], "quizzes": [], "on_slide_summary": "第一页摘要"},
            {"idx": 1, "reveals": [], "quizzes": [], "on_slide_summary": "第二页摘要"},
            {"idx": 2, "reveals": [], "quizzes": [], "on_slide_summary": "第三页摘要"},
            {"idx": 3, "reveals": [], "quizzes": [], "on_slide_summary": "第四页摘要"},
        ],
        "page_blueprints": [
            {"idx": 0, "theme": "引入", "objective": "", "key_points": [], "target_reveal_count": 3, "quiz_goal": None},
            {"idx": 1, "theme": "概念", "objective": "", "key_points": [], "target_reveal_count": 3, "quiz_goal": None},
            {"idx": 2, "theme": "例题", "objective": "", "key_points": [], "target_reveal_count": 3, "quiz_goal": None},
            {"idx": 3, "theme": "总结", "objective": "", "key_points": [], "target_reveal_count": 3, "quiz_goal": None},
        ],
    }

    sends = fanout(state)

    assert len(sends) == 4
    assert [item["theme"] for item in sends[1].arg["window_context"]] == ["引入", "例题", "总结"]
    assert [item["offset"] for item in sends[1].arg["window_context"]] == [-1, 1, 2]
    assert sends[0].arg["page_blueprint"]["theme"] == "引入"


def test_build_graph_runs_full_classroom_pipeline() -> None:
    page_script_calls: list[int] = []
    slide_calls: list[int] = []

    def outline_agent(_state: dict) -> dict:
        return {"outline": {"title": "牛顿第二定律", "sections": ["概念", "例题"]}}

    def page_plan_agent(_state: dict) -> dict:
        return {
            "page_blueprints": [
                {
                    "idx": 0,
                    "theme": "概念引入",
                    "objective": "建立问题",
                    "key_points": ["生活现象", "力和运动"],
                    "target_reveal_count": 2,
                    "quiz_goal": None,
                },
                {
                    "idx": 1,
                    "theme": "公式理解",
                    "objective": "理解 F=ma",
                    "key_points": ["公式", "量纲"],
                    "target_reveal_count": 2,
                    "quiz_goal": "检查公式识别",
                },
                {
                    "idx": 2,
                    "theme": "代入例题",
                    "objective": "会代入求解",
                    "key_points": ["代入", "单位"],
                    "target_reveal_count": 2,
                    "quiz_goal": None,
                },
                {
                    "idx": 3,
                    "theme": "总结迁移",
                    "objective": "收束与迁移",
                    "key_points": ["总结", "应用"],
                    "target_reveal_count": 2,
                    "quiz_goal": "检查迁移理解",
                },
            ]
        }

    page_scripts = {
        0: "第一页第一步先引出概念。\n<to_next/>\n第一页第二步继续解释。",
        1: (
            "第二页第一步讲公式含义。\n<to_next/>\n第二页第二步检查理解。"
            '<question>{"type":"fill","question":"公式是什么？","ans":"F=ma"}</question>'
            "<false_intro>注意这里要回忆公式。</false_intro>"
        ),
        2: "第三页第一步进入例题。\n<to_next/>\n第三页第二步继续代入计算。",
        3: (
            "第四页第一步做总结迁移。\n<to_next/>\n第四页第二步做理解检查。"
            '<question>{"type":"choice","question":"哪一步最关键？","options":["列式","猜答案"],"ans":"列式"}</question>'
            "<false_intro>关键是先根据关系列式。</false_intro>"
        ),
    }

    def page_script_agent(state: dict) -> dict:
        blueprint = state["page_blueprint"]
        page_idx = blueprint["idx"]
        page_script_calls.append(page_idx)
        return {"page_scripts": {page_idx: page_scripts[page_idx]}}

    def slide_html_agent(state: dict) -> dict:
        page = state["page"]
        slide_calls.append(page["idx"])
        return {"htmls": {page["idx"]: _make_card_html(page["idx"], len(page["reveals"]))}}

    graph = build_graph(
        outline_agent=outline_agent,
        page_plan_agent=page_plan_agent,
        page_script_agent=page_script_agent,
        slide_html_agent=slide_html_agent,
    )

    result = graph.invoke({"topic": "牛顿第二定律", "materials": ["教材", "练习册"]})

    assert sorted(page_script_calls) == [0, 1, 2, 3]
    assert sorted(slide_calls) == [0, 1, 2, 3]
    assert result["script"].count("<to_next_page/>") == 3
    assert len(result["page_blueprints"]) == 4
    assert result["htmls"].keys() == {0, 1, 2, 3}
    assert len(result["pages"]) == 4
    assert result["assembled"]["pages"][1]["quizzes"] == [
        {
            "after_reveal_idx": 1,
            "payload": {
                "type": "fill",
                "question": "公式是什么？",
                "ans": "F=ma",
            },
            "false_intro": "注意这里要回忆公式。",
        }
    ]


def test_build_graph_emits_node_events() -> None:
    events: list[dict] = []

    def outline_agent(_state: dict) -> dict:
        return {"outline": {"title": "牛顿第二定律"}}

    def page_plan_agent(_state: dict) -> dict:
        return {
            "page_blueprints": [
                {
                    "idx": 0,
                    "theme": "引入",
                    "objective": "建立问题",
                    "key_points": ["现象"],
                    "target_reveal_count": 3,
                    "quiz_goal": "检查理解",
                },
                {
                    "idx": 1,
                    "theme": "总结",
                    "objective": "收束理解",
                    "key_points": ["总结"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
                {
                    "idx": 2,
                    "theme": "应用",
                    "objective": "迁移应用",
                    "key_points": ["应用"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
                {
                    "idx": 3,
                    "theme": "回顾",
                    "objective": "回顾重点",
                    "key_points": ["回顾"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
            ]
        }

    def page_script_agent(state: dict) -> dict:
        idx = state["page_blueprint"]["idx"]
        if idx == 0:
            return {
                "page_scripts": {
                    idx: (
                        f"第{idx+1}页讲稿第一步。<to_next/>第{idx+1}页讲稿第二步。"
                        '<question>{"type":"fill","question":"核心公式是什么？","ans":"F=ma"}</question>'
                        "<false_intro>回忆一下力和加速度的关系。</false_intro>"
                    )
                }
            }
        return {"page_scripts": {idx: f"第{idx+1}页讲稿第一步。<to_next/>第{idx+1}页讲稿第二步。"}}

    def slide_html_agent(state: dict) -> dict:
        page = state["page"]
        return {"htmls": {page["idx"]: _make_card_html(page["idx"], len(page["reveals"]))}}

    graph = build_graph(
        outline_agent=outline_agent,
        page_plan_agent=page_plan_agent,
        page_script_agent=page_script_agent,
        slide_html_agent=slide_html_agent,
        event_callback=events.append,
    )

    graph.invoke({"topic": "牛顿第二定律", "materials": ["教材"]})

    assert any(event["event"] == "node_started" and event["node"] == "page_plan" for event in events)
    assert any(event["event"] == "node_completed" and event["node"] == "page_plan" for event in events)
    assert any(
        event["event"] == "node_completed"
        and event["node"] == "page_script"
        and event["data"].get("page_idx") == 0
        and "page_script" in event["data"]
        for event in events
    )
    assert any(
        event["event"] == "question_generated"
        and event["node"] == "page_script"
        and event["data"].get("page_idx") == 0
        and event["data"].get("payload", {}).get("question") == "核心公式是什么？"
        for event in events
    )
    assert any(event["event"] == "node_completed" and event["node"] == "slide" and event["data"].get("page_idx") == 0 for event in events)


def test_build_graph_emits_page_script_attempts_on_failure() -> None:
    events: list[dict] = []

    def outline_agent(_state: dict) -> dict:
        return {"outline": {"title": "牛顿第二定律"}}

    def page_plan_agent(_state: dict) -> dict:
        return {
            "page_blueprints": [
                {
                    "idx": 0,
                    "theme": "引入",
                    "objective": "建立问题",
                    "key_points": ["现象"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
                {
                    "idx": 1,
                    "theme": "公式",
                    "objective": "理解公式",
                    "key_points": ["公式"],
                    "target_reveal_count": 3,
                    "quiz_goal": "检查公式",
                },
                {
                    "idx": 2,
                    "theme": "例题",
                    "objective": "理解例题",
                    "key_points": ["代入"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
                {
                    "idx": 3,
                    "theme": "总结",
                    "objective": "回顾重点",
                    "key_points": ["总结"],
                    "target_reveal_count": 3,
                    "quiz_goal": None,
                },
            ]
        }

    def page_script_agent(state: dict) -> dict:
        if state["page_blueprint"]["idx"] == 1:
            from classroom.agents.script_agent import PageScriptGenerationError

            raise PageScriptGenerationError(
                page_idx=1,
                page_theme="公式",
                attempts=[
                    {
                        "attempt": 1,
                        "page_script": "错误脚本。<to_next_page/>",
                        "error": "Page 1 ends with an empty reveal.",
                    }
                ],
                message="PageScriptAgent failed to produce a valid page script after 1 attempts: Page 1 ends with an empty reveal.",
            )
        idx = state["page_blueprint"]["idx"]
        return {"page_scripts": {idx: f"第{idx+1}页。<on_slide>第{idx+1}页标题</on_slide>"}}

    def slide_html_agent(state: dict) -> dict:
        page = state["page"]
        return {"htmls": {page["idx"]: _make_card_html(page["idx"], len(page["reveals"]))}}

    graph = build_graph(
        outline_agent=outline_agent,
        page_plan_agent=page_plan_agent,
        page_script_agent=page_script_agent,
        slide_html_agent=slide_html_agent,
        event_callback=events.append,
    )

    try:
        graph.invoke({"topic": "牛顿第二定律", "materials": ["教材"]})
    except Exception:
        pass

    failed_event = next(
        event for event in events if event["event"] == "node_failed" and event["node"] == "page_script"
    )
    assert failed_event["data"]["page_idx"] == 1
    assert failed_event["data"]["page_theme"] == "公式"
    assert failed_event["data"]["last_page_script"] == "错误脚本。<to_next_page/>"
    assert failed_event["data"]["attempts"][0]["error"] == "Page 1 ends with an empty reveal."
