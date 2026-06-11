from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from edu_multi_agent.models import LearningGraphContext


AbilityBand = Literal[
    "evidence_needed",
    "needs_support",
    "developing",
    "proficient",
    "advanced",
]

RecommendationType = Literal[
    "diagnose",
    "remediate",
    "consolidate",
    "advance",
    "challenge",
]


class LearningRecommendation(BaseModel):
    """One model-ranked recommendation for the learner's next step."""

    target_id: str = Field(description="推荐目标的稳定标识。")
    title: str = Field(description="推荐目标的展示名称。")
    recommendation_type: RecommendationType = Field(description="推荐动作类型。")
    priority: int = Field(ge=1, le=5, description="优先级，1 表示最优先。")
    score: float = Field(ge=0.0, le=1.0, description="排序模型给出的推荐分。")
    reason: str = Field(description="推荐理由。")
    suggested_action: str = Field(description="下一步可执行教学动作。")


class SkillJudgment(BaseModel):
    """One question-level judgment for a specific skill."""

    skill_id: str = Field(description="稳定的技能标识符。")
    display_name: str = Field(description="面向教师展示的技能名称。")
    score: float = Field(
        ge=0.0,
        le=1.0,
        description="本次作答对该技能提供的正向证据强度。",
    )
    coverage: float = Field(
        default=1.0,
        ge=0.1,
        le=1.0,
        description="该题对该技能的覆盖度。",
    )
    confidence: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="该技能判断本身的可信度。",
    )
    reasoning_quality: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="学生在该技能上的推理质量估计。",
    )
    misconception_tags: list[str] = Field(
        default_factory=list,
        description="本次暴露出的常见误区标签。",
    )
    observation: str = Field(
        default="",
        description="对该技能的简短观察。",
    )


class SkillState(BaseModel):
    """Persistent state for one tracked skill."""

    skill_id: str = Field(description="技能标识符。")
    display_name: str = Field(description="技能显示名称。")
    graph_dataset_id: str | None = Field(
        default=None,
        description="技能绑定的知识图谱数据集标识。",
    )
    graph_node_id: str | None = Field(
        default=None,
        description="技能绑定的知识图谱节点标识。",
    )
    graph_node_title: str | None = Field(
        default=None,
        description="技能绑定的知识图谱节点名称。",
    )
    course_group_id: str | None = Field(
        default=None,
        description="技能所属课程群标识。",
    )
    course_id: str | None = Field(
        default=None,
        description="技能所属课程标识。",
    )
    source_graph_id: str | None = Field(
        default=None,
        description="课程群节点关联的细分课程图谱标识。",
    )
    mastery: float = Field(ge=0.0, le=1.0, description="当前掌握度估计。")
    confidence: float = Field(ge=0.0, le=1.0, description="当前判断可信度。")
    freshness: float = Field(ge=0.0, le=1.0, description="证据新鲜度估计。")
    evidence_count: float = Field(ge=0.0, description="累计证据量。")
    success_mass: float = Field(ge=0.0, description="正向证据累计值。")
    failure_mass: float = Field(ge=0.0, description="反向证据累计值。")
    rolling_score: float = Field(ge=0.0, le=1.0, description="近期滚动表现。")
    recent_scores: list[float] = Field(
        default_factory=list,
        description="最近若干次证据分数。",
    )
    misconception_counts: dict[str, int] = Field(
        default_factory=dict,
        description="误区标签累计次数。",
    )
    recent_observations: list[str] = Field(
        default_factory=list,
        description="最近的技能观察。",
    )
    last_updated: str = Field(description="最近一次更新时间。")


class LearnerModelSnapshot(BaseModel):
    """Compact summary attached to review responses and list views."""

    learner_id: str = Field(description="学习者标识。")
    overall_mastery: float = Field(ge=0.0, le=1.0, description="整体掌握度估计。")
    overall_confidence: float = Field(ge=0.0, le=1.0, description="整体判断可信度。")
    overall_band: AbilityBand = Field(description="整体能力阶段。")
    total_events: int = Field(ge=0, description="累计学习事件数。")
    total_sessions: int = Field(ge=0, description="累计会话数。")
    strong_skills: list[str] = Field(default_factory=list, description="相对稳固的技能。")
    weak_skills: list[str] = Field(default_factory=list, description="需要优先关注的技能。")
    key_misconceptions: list[str] = Field(
        default_factory=list,
        description="当前最突出的误区。",
    )
    recommended_focus: list[str] = Field(
        default_factory=list,
        description="建议下一轮优先处理的方向。",
    )
    learning_recommendations: list[LearningRecommendation] = Field(
        default_factory=list,
        description="由学情推荐排序模型生成的下一步学习建议。",
    )
    prompt_profile: str = Field(
        default="",
        description="面向后续教学生成链路的学情摘要。",
    )
    evaluation_summary: str = Field(
        default="",
        description="面向教师阅读的一句话整体评价。",
    )
    updated_at: str = Field(description="最近一次更新时间。")


class LearnerOverallAssessment(BaseModel):
    """Detailed overall learner assessment."""

    overall_mastery: float = Field(ge=0.0, le=1.0, description="整体掌握度估计。")
    overall_confidence: float = Field(ge=0.0, le=1.0, description="整体判断可信度。")
    overall_band: AbilityBand = Field(description="整体能力阶段。")
    strong_skills: list[str] = Field(default_factory=list, description="相对稳固的技能。")
    weak_skills: list[str] = Field(default_factory=list, description="需要优先关注的技能。")
    key_misconceptions: list[str] = Field(
        default_factory=list,
        description="当前最突出的误区。",
    )
    recommended_focus: list[str] = Field(
        default_factory=list,
        description="建议下一轮优先处理的方向。",
    )
    learning_recommendations: list[LearningRecommendation] = Field(
        default_factory=list,
        description="由学情推荐排序模型生成的下一步学习建议。",
    )
    evaluation_summary: str = Field(
        default="",
        description="面向教师阅读的一句话整体评价。",
    )
    prompt_profile: str = Field(
        default="",
        description="面向后续教学生成链路的学情摘要。",
    )
    updated_at: str = Field(description="最近一次更新时间。")


class LearningEvidenceEvent(BaseModel):
    """Persisted learner event built from one submission and one review."""

    event_id: str = Field(description="学习事件唯一标识。")
    learner_id: str = Field(description="学习者标识。")
    session_id: str | None = Field(default=None, description="可选会话标识。")
    source: Literal["practice_review_ai", "practice_review_local"] = Field(
        description="事件来源。"
    )
    learning_goal: str | None = Field(default=None, description="本次任务对应的学习目标。")
    graph_context: LearningGraphContext | None = Field(
        default=None,
        description="本次学习事件对应的图谱上下文。",
    )
    question_id: str = Field(description="题目唯一标识。")
    question_type: str = Field(description="题型。")
    answer_preview: str = Field(default="", description="截断后的学生答案预览。")
    correctness: str = Field(description="本次判断结果。")
    score: int = Field(ge=0, le=100, description="本次作答分数。")
    skill_judgments: list[SkillJudgment] = Field(
        default_factory=list,
        description="本题对应的技能判断。",
    )
    learner_observations: list[str] = Field(
        default_factory=list,
        description="本次作答暴露出的学习观察。",
    )
    issues: list[str] = Field(default_factory=list, description="本次主要问题。")
    review_advice: list[str] = Field(
        default_factory=list,
        description="本次给出的可执行建议。",
    )
    limitations: list[str] = Field(
        default_factory=list,
        description="本次判断的局限说明。",
    )
    submission_context: dict[str, Any] = Field(
        default_factory=dict,
        description="记录下来的附加上下文。",
    )
    timestamp: str = Field(description="事件时间。")


def build_empty_assessment(timestamp: str) -> LearnerOverallAssessment:
    return LearnerOverallAssessment(
        overall_mastery=0.5,
        overall_confidence=0.0,
        overall_band="evidence_needed",
        strong_skills=[],
        weak_skills=[],
        key_misconceptions=[],
        recommended_focus=["先补充更多带技能标签的学习证据。"],
        learning_recommendations=[],
        evaluation_summary="当前学习证据还不足，暂时无法形成稳定学情判断。",
        prompt_profile="历史学习证据不足，建议先安排1到2个低门槛诊断任务，再决定难度节奏。",
        updated_at=timestamp,
    )


class LearnerModelRecord(BaseModel):
    """Persistent learner model."""

    learner_id: str = Field(description="学习者标识。")
    created_at: str = Field(description="创建时间。")
    updated_at: str = Field(description="更新时间。")
    total_events: int = Field(default=0, ge=0, description="累计学习事件数。")
    total_sessions: int = Field(default=0, ge=0, description="累计会话数。")
    known_session_ids: list[str] = Field(
        default_factory=list,
        description="最近记录过的会话标识。",
    )
    recent_observations: list[str] = Field(
        default_factory=list,
        description="最近的全局学习观察。",
    )
    skills: dict[str, SkillState] = Field(
        default_factory=dict,
        description="按技能组织的长期状态。",
    )
    overall: LearnerOverallAssessment = Field(description="整体能力评估。")


class LearnerModelResponse(BaseModel):
    """Detailed learner-model read response."""

    learner: LearnerModelRecord = Field(description="完整学习者模型。")
    snapshot: LearnerModelSnapshot = Field(description="便于界面使用的摘要。")
    recent_events: list[LearningEvidenceEvent] = Field(
        default_factory=list,
        description="最近若干条学习事件。",
    )


class LearnerEventListResponse(BaseModel):
    """Learner event timeline."""

    learner_id: str = Field(description="学习者标识。")
    total: int = Field(ge=0, description="返回的事件总数。")
    items: list[LearningEvidenceEvent] = Field(description="事件列表。")


class LearnerReviewIngestRequest(BaseModel):
    """Ingest a completed review into the learner-model pipeline."""

    learner_id: str = Field(..., min_length=1, description="学习者标识。")
    session_id: str | None = Field(default=None, description="可选会话标识。")
    source: Literal["practice_review_ai", "practice_review_local"] = Field(
        default="practice_review_local",
        description="本次写入的事件来源。",
    )
    learning_goal: str | None = Field(default=None, description="当前学习目标。")
    graph_context: LearningGraphContext | None = Field(
        default=None,
        description="当前练习题继承的知识图谱上下文。",
    )
    question: dict[str, Any] = Field(description="题目快照。")
    student_answer: Any = Field(default=None, description="学生提交内容。")
    submission_context: dict[str, Any] = Field(
        default_factory=dict,
        description="可选补充上下文。",
    )
    review: dict[str, Any] = Field(description="已经得到的批阅结果。")


class LearnerReviewIngestResponse(BaseModel):
    """Ingest-review response."""

    snapshot: LearnerModelSnapshot = Field(description="更新后的学习者摘要。")
    stored_event: LearningEvidenceEvent = Field(description="本次写入的学习事件。")
