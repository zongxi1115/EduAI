from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from .agents import PagePlanAgent, PageScriptAgent, SlideHtmlAgent
from .nodes.assemble import assemble_node
from .nodes.script import assemble_script_node
from .nodes.split import split_node
from .parser import parse_page
from .state import ClassState, PageScriptTaskState, SlideTaskState

StateNode = Callable[[Mapping[str, Any]], Mapping[str, Any]]
GraphEventCallback = Callable[[dict[str, Any]], None]


def fanout_page_scripts(state: ClassState) -> list[Send]:
    page_blueprints = state.get("page_blueprints") or []
    return [
        Send(
            "page_script",
            {
                "topic": state.get("topic"),
                "materials": state.get("materials"),
                "outline": state.get("outline"),
                "page_blueprint": page_blueprints[idx],
                "total_pages": len(page_blueprints),
                "prev_theme": page_blueprints[idx - 1]["theme"] if idx > 0 else None,
                "next_theme": page_blueprints[idx + 1]["theme"] if idx < len(page_blueprints) - 1 else None,
            },
        )
        for idx in range(len(page_blueprints))
    ]


def fanout(state: ClassState) -> list[Send]:
    pages = state.get("pages") or []
    page_blueprints = state.get("page_blueprints") or []
    return [
        Send(
            "slide",
            {
                "page": pages[idx],
                "page_blueprint": page_blueprints[idx] if idx < len(page_blueprints) else None,
                "window_context": _build_window_context(state, idx),
            },
        )
        for idx in range(len(pages))
    ]


def build_graph(
    *,
    outline_agent: StateNode,
    llm: BaseChatModel | None = None,
    page_plan_agent: StateNode | None = None,
    page_script_agent: Callable[[PageScriptTaskState | dict[str, Any]], Mapping[str, Any]] | None = None,
    slide_html_agent: Callable[[SlideTaskState | dict[str, Any]], Mapping[str, Any]] | None = None,
    slide_prompt_file: str = "slide.md",
    event_callback: GraphEventCallback | None = None,
):
    if page_plan_agent is None:
        if llm is None:
            raise ValueError("build_graph requires llm when page_plan_agent is not provided.")
        page_plan_agent = PagePlanAgent(llm)
    if page_script_agent is None:
        if llm is None:
            raise ValueError(
                "build_graph requires llm when page_script_agent is not provided."
            )
        page_script_agent = PageScriptAgent(llm)
    if slide_html_agent is None:
        if llm is None:
            raise ValueError(
                "build_graph requires llm when slide_html_agent is not provided."
            )
        slide_html_agent = SlideHtmlAgent(llm, prompt_name=slide_prompt_file)

    graph = StateGraph(ClassState)
    graph.add_node("outline", _instrument_node("outline", outline_agent, event_callback))
    graph.add_node("page_plan", _instrument_node("page_plan", page_plan_agent, event_callback))
    graph.add_node("page_script", _instrument_node("page_script", page_script_agent, event_callback))
    graph.add_node("assemble_script", _instrument_node("assemble_script", assemble_script_node, event_callback))
    graph.add_node("split", _instrument_node("split", split_node, event_callback))
    graph.add_node("slide", _instrument_node("slide", slide_html_agent, event_callback))
    graph.add_node("assemble", _instrument_node("assemble", assemble_node, event_callback))

    graph.add_edge(START, "outline")
    graph.add_edge("outline", "page_plan")
    graph.add_conditional_edges("page_plan", fanout_page_scripts, ["page_script"])
    graph.add_edge("page_script", "assemble_script")
    graph.add_edge("assemble_script", "split")
    graph.add_conditional_edges("split", fanout, ["slide"])
    graph.add_edge("slide", "assemble")
    graph.add_edge("assemble", END)
    return graph.compile()


def _build_window_context(state: ClassState, current_idx: int, *, radius: int = 2) -> list[dict[str, Any]]:
    pages = state.get("pages") or []
    page_blueprints = state.get("page_blueprints") or []
    context: list[dict[str, Any]] = []
    start = max(0, current_idx - radius)
    end = min(len(pages), current_idx + radius + 1)
    for idx in range(start, end):
        if idx == current_idx:
            continue
        blueprint = page_blueprints[idx] if idx < len(page_blueprints) else None
        context.append(
            {
                "idx": idx,
                "offset": idx - current_idx,
                "theme": blueprint["theme"] if blueprint else None,
                "summary": pages[idx]["on_slide_summary"],
            }
        )
    return context


def _instrument_node(
    node_name: str,
    node: Callable[[Mapping[str, Any]], Mapping[str, Any]],
    event_callback: GraphEventCallback | None,
) -> Callable[[Mapping[str, Any]], Mapping[str, Any]]:
    if event_callback is None:
        return node

    def wrapped(state: Mapping[str, Any]) -> Mapping[str, Any]:
        node_context = _extract_node_context(state)
        event_callback(
            {
                "event": "node_started",
                "node": node_name,
                "phase": _node_phase(node_name),
                "summary": _node_summary(node_name, "started", node_context),
                "data": node_context,
            }
        )
        try:
            result = node(state)
        except Exception as exc:
            event_callback(
                {
                    "event": "node_failed",
                    "node": node_name,
                    "phase": _node_phase(node_name),
                    "summary": _node_summary(node_name, "failed", node_context),
                    "data": {**node_context, **_extract_error_context(exc), "error": str(exc)},
                }
            )
            raise

        completion_data = {**node_context, **_extract_completion_context(result)}
        event_callback(
            {
                "event": "node_completed",
                "node": node_name,
                "phase": _node_phase(node_name),
                "summary": _node_summary(node_name, "completed", completion_data),
                "data": completion_data,
            }
        )
        _emit_question_events(node_name, completion_data, event_callback)
        return result

    return wrapped


def _emit_question_events(
    node_name: str,
    completion_data: Mapping[str, Any],
    event_callback: GraphEventCallback,
) -> None:
    if node_name != "page_script":
        return

    page_idx = completion_data.get("page_idx")
    page_script = completion_data.get("page_script")
    if not isinstance(page_idx, int) or not isinstance(page_script, str) or not page_script.strip():
        return

    try:
        page = parse_page(page_script, page_idx)
    except Exception:
        return

    for question_idx, quiz in enumerate(page.get("quizzes") or [], start=1):
        payload = quiz.get("payload") if isinstance(quiz, dict) else None
        prompt = payload.get("question") if isinstance(payload, dict) else None
        question_text = str(prompt).strip() if isinstance(prompt, str) else ""
        page_theme = completion_data.get("page_theme")
        summary = (
            f"第 {page_idx + 1} 页教师提问已生成：{question_text}"
            if question_text
            else f"第 {page_idx + 1} 页教师提问已生成。"
        )

        event_callback(
            {
                "event": "question_generated",
                "node": node_name,
                "phase": _node_phase(node_name),
                "summary": summary,
                "data": {
                    "page_idx": page_idx,
                    "page_theme": page_theme,
                    "question_idx": question_idx - 1,
                    "after_reveal_idx": quiz.get("after_reveal_idx"),
                    "payload": payload,
                    "false_intro": quiz.get("false_intro"),
                },
            }
        )


def _extract_node_context(state: Mapping[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    page_blueprint = state.get("page_blueprint")
    if isinstance(page_blueprint, dict):
        context["page_idx"] = page_blueprint.get("idx")
        context["page_theme"] = page_blueprint.get("theme")
        context["page_blueprint"] = page_blueprint
    page = state.get("page")
    if isinstance(page, dict):
        context["page_idx"] = page.get("idx")
    topic = state.get("topic")
    if isinstance(topic, str) and topic.strip():
        context["topic"] = topic.strip()
    return context


def _extract_completion_context(result: Mapping[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    if "page_blueprints" in result and isinstance(result.get("page_blueprints"), list):
        context["page_count"] = len(result["page_blueprints"])
        context["page_blueprints"] = result["page_blueprints"]
    elif "pages" in result and isinstance(result.get("pages"), list):
        context["page_count"] = len(result["pages"])
    elif "page_scripts" in result and isinstance(result.get("page_scripts"), dict):
        keys = list(result["page_scripts"].keys())
        if len(keys) == 1:
            context["page_idx"] = keys[0]
            context["page_script"] = result["page_scripts"][keys[0]]
    elif "htmls" in result and isinstance(result.get("htmls"), dict):
        keys = list(result["htmls"].keys())
        if len(keys) == 1:
            context["page_idx"] = keys[0]
            context["html"] = result["htmls"][keys[0]]
    if "script" in result and isinstance(result.get("script"), str):
        context["script"] = result["script"]
    return context


def _extract_error_context(exc: Exception) -> dict[str, Any]:
    to_event_data = getattr(exc, "to_event_data", None)
    if callable(to_event_data):
        payload = to_event_data()
        if isinstance(payload, dict):
            return payload
    return {}


def _node_phase(node_name: str) -> str:
    return {
        "outline": "outline",
        "page_plan": "page_planning",
        "page_script": "script_generation",
        "assemble_script": "script_assembly",
        "split": "script_parsing",
        "slide": "html_generation",
        "assemble": "bundle_assembly",
    }.get(node_name, "workflow")


def _node_summary(node_name: str, status: str, context: Mapping[str, Any]) -> str:
    page_idx = context.get("page_idx")
    if node_name == "outline":
        return {
            "started": "开始获取课堂大纲。",
            "completed": "课堂大纲已就绪。",
            "failed": "课堂大纲生成失败。",
        }[status]
    if node_name == "page_plan":
        if status == "completed" and isinstance(context.get("page_count"), int):
            return f"分页规划完成，共 {context['page_count']} 页。"
        return {
            "started": "开始规划课堂页数与每页主题。",
            "completed": "分页规划完成。",
            "failed": "分页规划失败。",
        }[status]
    if node_name == "page_script":
        if page_idx is not None:
            return {
                "started": f"开始生成第 {int(page_idx) + 1} 页讲稿。",
                "completed": f"第 {int(page_idx) + 1} 页讲稿已生成。",
                "failed": f"第 {int(page_idx) + 1} 页讲稿生成失败。",
            }[status]
    if node_name == "assemble_script":
        return {
            "started": "开始汇总分页讲稿。",
            "completed": "整篇课堂讲稿已汇总。",
            "failed": "整篇课堂讲稿汇总失败。",
        }[status]
    if node_name == "split":
        return {
            "started": "开始解析课堂讲稿。",
            "completed": "课堂讲稿解析完成。",
            "failed": "课堂讲稿解析失败。",
        }[status]
    if node_name == "slide":
        if page_idx is not None:
            return {
                "started": f"开始生成第 {int(page_idx) + 1} 页 HTML 卡片。",
                "completed": f"第 {int(page_idx) + 1} 页 HTML 卡片已生成。",
                "failed": f"第 {int(page_idx) + 1} 页 HTML 卡片生成失败。",
            }[status]
    if node_name == "assemble":
        return {
            "started": "开始组装播放器数据包。",
            "completed": "播放器数据包已组装完成。",
            "failed": "播放器数据包组装失败。",
        }[status]
    return {
        "started": f"{node_name} started",
        "completed": f"{node_name} completed",
        "failed": f"{node_name} failed",
    }[status]
