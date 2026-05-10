from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AgentName = Literal["study_guide", "practice", "manim", "interactive_web"]
QuestionTypeName = Literal[
    "FillInTheBlank",
    "MultipleChoice",
    "ShortAnswer",
    "Listening",
    "Coding",
    "Drawing",
]


class GenerationRequest(BaseModel):
    """用于启动课前准备工作流的请求体。"""

    learning_goal: str = Field(
        ...,
        min_length=1,
        description="本次课前准备要服务的核心学习目标。",
    )
    subject: str = Field(
        default="General",
        description="课程所属学科。",
    )
    grade_level: str = Field(
        default="Unspecified",
        description="年级、学段或适用对象。",
    )
    learner_id: str | None = Field(
        default=None,
        description="可选的学习者唯一标识，用于关联长期学情画像。",
    )
    learner_profile: str = Field(
        default=(
            "Mixed-ability class that needs clear guidance, visual explanation, "
            "and structured practice."
        ),
        description="对学生特点和课堂情境的简要描述。",
    )
    notes: str = Field(
        default="None",
        description="教师补充说明、交付约束或强调重点。",
    )
    language: str = Field(
        default="zh-CN",
        description="期望生成内容使用的语言代码。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "learning_goal": "理解二次函数图像与性质",
                "subject": "Mathematics",
                "grade_level": "Grade 8",
                "learner_id": "stu_demo_001",
                "learner_profile": (
                    "Mixed-ability class that needs visual explanation and structured practice."
                ),
                "notes": "Focus on pre-class preparation assets only",
                "language": "zh-CN",
            }
        }
    )


class AgentRoute(BaseModel):
    """单个专业 Agent 的任务规划。"""

    agent_name: AgentName = Field(description="专业 Agent 的标识符。")
    selected: bool = Field(
        default=True,
        description="总控是否在本次任务中启用该 Agent。",
    )
    objective: str = Field(description="分配给该 Agent 的主要目标。")
    deliverables: list[str] = Field(
        default_factory=list,
        description="预期由该 Agent 生成的交付物。",
    )
    focus_points: list[str] = Field(
        default_factory=list,
        description="该 Agent 需要重点关注的约束或方向。",
    )


class PreparationPlan(BaseModel):
    """总控 Agent 生成的课前准备计划。"""

    stage: str = Field(
        default="pre_teaching_preparation",
        description="该计划所属的工作流阶段。",
    )
    plan_summary: str = Field(description="对整体准备策略的高层总结。")
    required_materials: list[str] = Field(
        default_factory=list,
        description="教师需要提前准备或收集的材料。",
    )
    teacher_checklist: list[str] = Field(
        default_factory=list,
        description="教师可执行的检查清单。",
    )
    teaching_focus: list[str] = Field(
        default_factory=list,
        description="本节课最重要的教学关注点。",
    )
    quality_bar: list[str] = Field(
        default_factory=list,
        description="生成内容需要满足的质量标准。",
    )
    agent_routes: list[AgentRoute] = Field(
        default_factory=list,
        description="各专业 Agent 的规划路线。",
    )


class PracticeQuestionAllocation(BaseModel):
    """单种题型在练习蓝图中的分配结果。"""

    question_type: QuestionTypeName = Field(description="题型名称。")
    count: int = Field(
        ge=0,
        description="该题型建议生成的题目数量。",
    )
    purpose: str = Field(description="该题型在本轮练习中的教学目的。")
    competency_focus: list[str] = Field(
        default_factory=list,
        description="该题型重点覆盖的能力点。",
    )


class PracticeBlueprint(BaseModel):
    """练习题规划 Agent 产出的题型与题量蓝图。"""

    planning_summary: str = Field(description="题型规划的整体摘要。")
    total_questions: int = Field(
        ge=1,
        description="本轮建议生成的题目总数。",
    )
    topic_characteristics: list[str] = Field(
        default_factory=list,
        description="该主题在题型规划时识别出的关键特征。",
    )
    distribution_principles: list[str] = Field(
        default_factory=list,
        description="决定题型配比时遵循的原则。",
    )
    progression_plan: list[str] = Field(
        default_factory=list,
        description="建议的题目推进节奏，如热身、核心、挑战、迁移。",
    )
    must_cover: list[str] = Field(
        default_factory=list,
        description="本轮练习必须覆盖的知识点、能力点或误区。",
    )
    question_allocations: list[PracticeQuestionAllocation] = Field(
        default_factory=list,
        description="各题型的建议数量与用途。",
    )


class ArtifactResult(BaseModel):
    """单个专业 Agent 生成的结构化结果。"""

    agent_name: AgentName = Field(description="生成该结果的 Agent 标识符。")
    title: str = Field(description="该结果的人类可读标题。")
    summary: str = Field(description="对该结果内容的简短说明。")
    output_dir: str = Field(description="该 Agent 产物输出目录的绝对路径。")
    files: list[str] = Field(
        default_factory=list,
        description="与该结果关联的生成文件路径列表。",
    )
    notes: list[str] = Field(
        default_factory=list,
        description="关于该结果的补充说明、警告或注意事项。",
    )
    status: Literal["completed", "skipped", "failed"] = Field(
        default="completed",
        description="该 Agent 结果的最终执行状态。",
    )
