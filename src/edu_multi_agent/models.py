from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AgentName = Literal["study_guide", "practice", "manim", "interactive_web"]


class GenerationRequest(BaseModel):
    learning_goal: str = Field(..., min_length=1)
    subject: str = "General"
    grade_level: str = "Unspecified"
    learner_profile: str = (
        "Mixed-ability class that needs clear guidance, visual explanation, "
        "and structured practice."
    )
    notes: str = "None"
    language: str = "zh-CN"


class AgentRoute(BaseModel):
    agent_name: AgentName
    selected: bool = True
    objective: str
    deliverables: list[str] = Field(default_factory=list)
    focus_points: list[str] = Field(default_factory=list)


class PreparationPlan(BaseModel):
    stage: str = "pre_teaching_preparation"
    plan_summary: str
    required_materials: list[str] = Field(default_factory=list)
    teacher_checklist: list[str] = Field(default_factory=list)
    teaching_focus: list[str] = Field(default_factory=list)
    quality_bar: list[str] = Field(default_factory=list)
    agent_routes: list[AgentRoute] = Field(default_factory=list)


class ArtifactResult(BaseModel):
    agent_name: AgentName
    title: str
    summary: str
    output_dir: str
    files: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    status: Literal["completed", "skipped", "failed"] = "completed"
