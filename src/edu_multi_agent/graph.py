from __future__ import annotations

import json
from dataclasses import dataclass
from operator import add
from pathlib import Path
from typing import Annotated, Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from .config import Settings
from .file_io import (
    render_fallback_report,
    render_plan_markdown,
    write_json_file,
    write_text_file,
)
from .llm import LLMClient
from .models import (
    AgentName,
    AgentRoute,
    ArtifactResult,
    GenerationRequest,
    PreparationPlan,
)
from .prompts import (
    build_interactive_web_prompts,
    build_manim_prompts,
    build_planner_prompts,
    build_practice_prompts,
    build_report_prompts,
    build_study_guide_prompts,
)


GraphEventCallback = Callable[[dict[str, Any]], None]


class WorkflowState(TypedDict, total=False):
    request: dict[str, Any]
    output_dir: str
    plan: dict[str, Any]
    artifact_results: Annotated[list[dict[str, Any]], add]
    plan_path: str
    report_path: str
    manifest_path: str


@dataclass(frozen=True, slots=True)
class AgentSpec:
    agent_name: AgentName
    title: str
    folder: str
    required_files: tuple[str, ...]
    prompt_builder: Callable[[GenerationRequest, PreparationPlan], tuple[str, str]]


AGENT_SPECS: tuple[AgentSpec, ...] = (
    AgentSpec(
        agent_name="study_guide",
        title="学案 Agent",
        folder="01_study_guide",
        required_files=("study_guide.md", "teacher_notes.md"),
        prompt_builder=build_study_guide_prompts,
    ),
    AgentSpec(
        agent_name="practice",
        title="练习 Agent",
        folder="02_practice",
        required_files=("practice_questions.json", "answer_key.md"),
        prompt_builder=build_practice_prompts,
    ),
    AgentSpec(
        agent_name="manim",
        title="Manim Agent",
        folder="03_manim",
        required_files=("lesson_animation.py", "render_guide.md"),
        prompt_builder=build_manim_prompts,
    ),
    AgentSpec(
        agent_name="interactive_web",
        title="互动网页 Agent",
        folder="04_interactive_web",
        required_files=("index.html", "usage_notes.md"),
        prompt_builder=build_interactive_web_prompts,
    ),
)


def _default_route(spec: AgentSpec) -> AgentRoute:
    return AgentRoute(
        agent_name=spec.agent_name,
        selected=True,
        objective=f"为当前学习目标准备 {spec.agent_name} 相关产出。",
        deliverables=list(spec.required_files),
        focus_points=[],
    )


def _normalize_plan(plan: PreparationPlan) -> PreparationPlan:
    route_map = {route.agent_name: route for route in plan.agent_routes}
    normalized_routes: list[AgentRoute] = []
    for spec in AGENT_SPECS:
        route = route_map.get(spec.agent_name, _default_route(spec))
        deliverables = route.deliverables or list(spec.required_files)
        normalized_routes.append(route.model_copy(update={"deliverables": deliverables}))

    return plan.model_copy(update={"agent_routes": normalized_routes})


def _get_route(plan: PreparationPlan, agent_name: AgentName) -> AgentRoute:
    for route in plan.agent_routes:
        if route.agent_name == agent_name:
            return route
    raise KeyError(f"Missing route for agent: {agent_name}")


def _validate_generated_files(files: dict[str, str]) -> None:
    for filename, content in files.items():
        if filename == "practice_questions.json":
            payload = json.loads(content)
            if not isinstance(payload, list):
                raise ValueError("practice_questions.json must be a top-level JSON array.")

            common_fields = {"id", "question", "analysis"}
            type_fields = {
                "FillInTheBlank": {"answer"},
                "MultipleChoice": {"options", "correct_answer"},
                "ShortAnswer": {"reference_answer"},
                "Listening": {"audio_src", "answer"},
                "Coding": {"reference_code", "test_cases"},
                "Drawing": {"reference_image"},
            }
            allowed_types = set(type_fields)

            for index, item in enumerate(payload, start=1):
                if not isinstance(item, dict):
                    raise ValueError(
                        f"practice_questions.json item {index} must be an object."
                    )
                question_type = item.get("question_type")
                if question_type not in allowed_types:
                    raise ValueError(
                        f"practice_questions.json item {index} has invalid "
                        f"question_type: {question_type}"
                    )

                missing_common = sorted(field for field in common_fields if field not in item)
                missing_type_specific = sorted(
                    field for field in type_fields[question_type] if field not in item
                )
                missing_fields = missing_common + missing_type_specific
                if missing_fields:
                    raise ValueError(
                        f"practice_questions.json item {index} is missing fields: "
                        + ", ".join(missing_fields)
                    )

        elif filename.endswith(".py"):
            compile(content, filename, "exec")


def _emit_event(
    event_callback: GraphEventCallback | None,
    *,
    event: str,
    node: str,
    summary: str,
    phase: str,
    agent_name: AgentName | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    if event_callback is None:
        return

    payload: dict[str, Any] = {
        "event": event,
        "node": node,
        "phase": phase,
        "summary": summary,
    }
    if agent_name is not None:
        payload["agent_name"] = agent_name
    if data:
        payload["data"] = data
    event_callback(payload)


def build_workflow(
    settings: Settings,
    event_callback: GraphEventCallback | None = None,
):
    llm = LLMClient(settings)
    agent_order = [spec.agent_name for spec in AGENT_SPECS]

    def planner_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        output_dir = Path(state["output_dir"])
        node_name = "planner"

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="planning",
            summary="Planner node started.",
            data={
                "title": "总控规划",
                "learning_goal": request.learning_goal,
            },
        )

        system_prompt, user_prompt = build_planner_prompts(request)
        plan = llm.invoke_json(system_prompt, user_prompt, PreparationPlan)
        normalized_plan = _normalize_plan(plan)

        write_json_file(
            output_dir,
            "00_supervisor/preparation_plan.json",
            normalized_plan.model_dump(),
        )
        plan_path = write_text_file(
            output_dir,
            "00_supervisor/preparation_plan.md",
            render_plan_markdown(request, normalized_plan),
        )
        _emit_event(
            event_callback,
            event="plan_ready",
            node=node_name,
            phase="planning",
            summary="Preparation plan generated.",
            data={
                "plan": normalized_plan.model_dump(),
                "plan_path": str(plan_path),
            },
        )
        return {"plan": normalized_plan.model_dump(), "plan_path": str(plan_path)}

    def make_agent_node(spec: AgentSpec) -> Callable[[WorkflowState], dict[str, Any]]:
        def agent_node(state: WorkflowState) -> dict[str, Any]:
            request = GenerationRequest.model_validate(state["request"])
            plan = PreparationPlan.model_validate(state["plan"])
            output_dir = Path(state["output_dir"])
            route = _get_route(plan, spec.agent_name)
            node_name = f"{spec.agent_name}_agent"

            _emit_event(
                event_callback,
                event="node_started",
                node=node_name,
                phase="artifact_generation",
                agent_name=spec.agent_name,
                summary=f"{spec.title} started.",
                data={
                    "title": spec.title,
                    "objective": route.objective,
                    "deliverables": route.deliverables,
                },
            )

            if not route.selected:
                skipped_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/SKIPPED.md",
                    f"# {spec.title}\n\n该 Agent 被总控规划判定为本轮无需执行。\n",
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="该 Agent 被总控规划跳过。",
                    output_dir=str(output_dir / spec.folder),
                    files=[str(skipped_path)],
                    status="skipped",
                )
                _emit_event(
                    event_callback,
                    event="artifact_skipped",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} skipped by planner.",
                    data={"artifact": artifact.model_dump()},
                )
                return {"artifact_results": [artifact.model_dump()]}

            try:
                system_prompt, user_prompt = spec.prompt_builder(request, plan)
                bundle = llm.invoke_bundle(
                    system_prompt,
                    user_prompt,
                    spec.required_files,
                )
                _validate_generated_files(bundle.files)
                written_files: list[str] = []
                for filename, content in bundle.files.items():
                    target = write_text_file(
                        output_dir,
                        f"{spec.folder}/{filename}",
                        content,
                    )
                    written_files.append(str(target))

                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary=bundle.summary,
                    output_dir=str(output_dir / spec.folder),
                    files=written_files,
                )
                _emit_event(
                    event_callback,
                    event="artifact_ready",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} generated successfully.",
                    data={"artifact": artifact.model_dump()},
                )
            except Exception as exc:
                failed_path = write_text_file(
                    output_dir,
                    f"{spec.folder}/FAILED.md",
                    f"# {spec.title}\n\n生成失败。\n\n```\n{exc}\n```\n",
                )
                artifact = ArtifactResult(
                    agent_name=spec.agent_name,
                    title=spec.title,
                    summary="该 Agent 生成失败。",
                    output_dir=str(output_dir / spec.folder),
                    files=[str(failed_path)],
                    notes=[str(exc)],
                    status="failed",
                )
                _emit_event(
                    event_callback,
                    event="artifact_failed",
                    node=node_name,
                    phase="artifact_generation",
                    agent_name=spec.agent_name,
                    summary=f"{spec.title} failed during generation.",
                    data={
                        "artifact": artifact.model_dump(),
                        "error": str(exc),
                    },
                )

            return {"artifact_results": [artifact.model_dump()]}

        return agent_node

    def report_node(state: WorkflowState) -> dict[str, Any]:
        request = GenerationRequest.model_validate(state["request"])
        plan = PreparationPlan.model_validate(state["plan"])
        output_dir = Path(state["output_dir"])
        node_name = "supervisor_report"
        artifacts = [
            ArtifactResult.model_validate(item)
            for item in state.get("artifact_results", [])
        ]
        artifacts.sort(key=lambda artifact: agent_order.index(artifact.agent_name))

        _emit_event(
            event_callback,
            event="node_started",
            node=node_name,
            phase="reporting",
            summary="Supervisor report node started.",
            data={"artifact_count": len(artifacts)},
        )

        manifest_path = write_json_file(
            output_dir,
            "00_supervisor/artifact_manifest.json",
            {"artifacts": [artifact.model_dump() for artifact in artifacts]},
        )
        _emit_event(
            event_callback,
            event="manifest_ready",
            node=node_name,
            phase="reporting",
            summary="Artifact manifest written.",
            data={"manifest_path": str(manifest_path)},
        )

        try:
            system_prompt, user_prompt = build_report_prompts(
                request,
                plan,
                artifacts,
                str(output_dir),
            )
            report_markdown = llm.invoke_text(system_prompt, user_prompt)
        except Exception:
            report_markdown = render_fallback_report(request, plan, artifacts, output_dir)

        report_path = write_text_file(
            output_dir,
            "00_supervisor/final_report.md",
            report_markdown,
        )
        _emit_event(
            event_callback,
            event="report_ready",
            node=node_name,
            phase="reporting",
            summary="Supervisor report generated.",
            data={"report_path": str(report_path)},
        )
        return {
            "report_path": str(report_path),
            "plan_path": state.get("plan_path", ""),
            "manifest_path": str(manifest_path),
        }

    graph = StateGraph(WorkflowState)
    graph.add_node("planner", planner_node)

    node_names: list[str] = []
    for spec in AGENT_SPECS:
        node_name = f"{spec.agent_name}_agent"
        node_names.append(node_name)
        graph.add_node(node_name, make_agent_node(spec))

    graph.add_node("supervisor_report", report_node)

    graph.add_edge(START, "planner")
    for node_name in node_names:
        graph.add_edge("planner", node_name)
    graph.add_edge(node_names, "supervisor_report")
    graph.add_edge("supervisor_report", END)

    return graph.compile()
