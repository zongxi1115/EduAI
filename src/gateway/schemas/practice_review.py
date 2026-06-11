from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from edu_multi_agent.models import LearningGraphContext

from .learner_models import LearnerModelSnapshot, SkillJudgment


PracticeQuestionType = Literal[
    "FillInTheBlank",
    "MultipleChoice",
    "ShortAnswer",
    "Listening",
    "Coding",
    "Drawing",
]

ReviewCorrectness = Literal[
    "correct",
    "partially_correct",
    "incorrect",
    "ungradable",
]


class PracticeReviewQuestion(BaseModel):
    """前端提交给 AI 批阅接口的题目快照。"""

    id: str = Field(description="题目唯一标识。")
    question_type: PracticeQuestionType = Field(description="题型。")
    question: str = Field(description="题干。")
    analysis: str = Field(default="", description="题目解析或出题意图。")
    need_ai_judge: bool = Field(
        default=True,
        description="该题是否标记为需要 AI 批阅。",
    )
    options: list[str] = Field(default_factory=list, description="选择题选项。")
    answer: str | None = Field(default=None, description="客观题标准答案。")
    correct_answer: str | None = Field(default=None, description="单选题正确选项内容。")
    reference_answer: str | None = Field(default=None, description="简答题参考答案。")
    reference_code: str | None = Field(default=None, description="编程题参考代码。")
    test_cases: list[Any] = Field(default_factory=list, description="编程题测试样例。")
    audio_src: str | None = Field(default=None, description="听力题音频地址。")
    reference_image: str | None = Field(default=None, description="作图题参考图描述。")
    skill_tags: list[str] = Field(
        default_factory=list,
        description="题目显式关联的技能标签，供后续学情建模使用。",
    )
    difficulty: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="题目难度估计，0-1。",
    )


class PracticeReviewRequest(BaseModel):
    """AI 批阅请求。"""

    learner_id: str | None = Field(
        default=None,
        description="可选的学习者标识。提供后会自动写入长期学情模型。",
    )
    session_id: str | None = Field(
        default=None,
        description="可选的学习会话标识，用于把多次作答聚合到同一次学习中。",
    )
    learning_goal: str | None = Field(
        default=None,
        description="当前学习目标，帮助 AI 把建议和目标对齐。",
    )
    graph_context: LearningGraphContext | None = Field(
        default=None,
        description="当前练习题继承的知识图谱上下文。",
    )
    question: PracticeReviewQuestion = Field(description="题目快照。")
    student_answer: Any = Field(
        default=None,
        description="学生提交内容，可为字符串、数组或对象。",
    )
    submission_context: dict[str, Any] = Field(
        default_factory=dict,
        description="可选附加上下文，例如代码运行结果、作图说明等。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "learning_goal": "理解二次函数图像与性质",
                "learner_id": "stu_demo_001",
                "session_id": "session_20260510_01",
                "question": {
                    "id": "question_demo_001",
                    "question_type": "ShortAnswer",
                    "question": "为什么二次项系数为负时抛物线开口向下？",
                    "analysis": "考查学生是否理解 a 的符号与开口方向关系。",
                    "need_ai_judge": True,
                    "reference_answer": "因为 a<0 时函数值随 |x| 增大而整体减小，所以图像向下张开。",
                    "skill_tags": ["理解二次项系数与开口方向"],
                    "difficulty": 0.45,
                },
                "student_answer": "因为负号会让抛物线朝下。",
                "submission_context": {},
            }
        }
    )


class PracticeReviewResponse(BaseModel):
    """AI 批阅结果。"""

    correctness: ReviewCorrectness = Field(description="答案整体判断。")
    score: int = Field(ge=0, le=100, description="建议分数，0-100。")
    summary: str = Field(description="一句话总结本次作答表现。")
    strengths: list[str] = Field(default_factory=list, description="作答亮点。")
    issues: list[str] = Field(default_factory=list, description="主要问题。")
    review_advice: list[str] = Field(default_factory=list, description="可直接展示给前端的审阅建议。")
    reference_points: list[str] = Field(default_factory=list, description="参考要点或下一步核对点。")
    limitations: list[str] = Field(default_factory=list, description="批阅局限或证据不足说明。")
    skill_judgments: list[SkillJudgment] = Field(
        default_factory=list,
        description="本次作答映射到具体技能后的证据判断。",
    )
    learner_observations: list[str] = Field(
        default_factory=list,
        description="从本次作答提炼出的学习者观察。",
    )
    learner_snapshot: LearnerModelSnapshot | None = Field(
        default=None,
        description="若提供 learner_id，则返回更新后的长期学情摘要。",
    )
    judged_at: str | None = Field(default=None, description="服务端完成批阅的时间。")


class PracticeReviewCapabilitiesResponse(BaseModel):
    """题目批阅能力返回。"""

    support_vision: bool = Field(description="当前模型是否开启视觉输入能力。")


class PaperAnswerImage(BaseModel):
    """One uploaded photo or scan for paper-answer review."""

    name: str = Field(default="", description="前端上传的图片文件名。")
    data_url: str = Field(..., min_length=1, description="图片 Data URL。")


class PaperPracticeReviewRequest(BaseModel):
    """AI 批阅纸笔作答图片请求。"""

    learner_id: str | None = Field(
        default=None,
        description="可选的学习者标识。",
    )
    session_id: str | None = Field(
        default=None,
        description="可选的学习会话标识。",
    )
    learning_goal: str | None = Field(
        default=None,
        description="当前学习目标。",
    )
    graph_context: LearningGraphContext | None = Field(
        default=None,
        description="当前练习题继承的知识图谱上下文。",
    )
    questions: list[PracticeReviewQuestion] = Field(
        ...,
        min_length=1,
        description="本次纸笔答题对应的题目快照。",
    )
    answer_images: list[PaperAnswerImage] = Field(
        ...,
        min_length=1,
        description="学生纸笔作答图片，支持多张。",
    )


class PaperQuestionReview(BaseModel):
    """纸笔批阅中单题的可展示结果。"""

    question_id: str = Field(description="题目唯一标识。")
    question_index: int = Field(ge=1, description="题目序号，从 1 开始。")
    correctness: ReviewCorrectness = Field(description="单题判断。")
    score: int = Field(ge=0, le=100, description="单题建议分数。")
    summary: str = Field(description="单题一句话反馈。")
    issues: list[str] = Field(default_factory=list, description="单题主要问题。")
    review_advice: list[str] = Field(default_factory=list, description="单题改进建议。")
    reference_points: list[str] = Field(default_factory=list, description="单题参考要点。")


class PaperPracticeReviewResponse(BaseModel):
    """纸笔作答图片的整卷批阅结果。"""

    correctness: ReviewCorrectness = Field(description="整卷整体判断。")
    score: int = Field(ge=0, le=100, description="整卷建议分数。")
    summary: str = Field(description="整卷一句话总结。")
    strengths: list[str] = Field(default_factory=list, description="整卷亮点。")
    issues: list[str] = Field(default_factory=list, description="整卷主要问题。")
    review_advice: list[str] = Field(default_factory=list, description="整卷改进建议。")
    question_reviews: list[PaperQuestionReview] = Field(
        default_factory=list,
        description="按题号返回的批阅结果。",
    )
    limitations: list[str] = Field(default_factory=list, description="批阅局限或证据不足说明。")
    answer_image_count: int = Field(default=0, ge=0, description="参与批阅的答案图片数量。")
    judged_at: str | None = Field(default=None, description="服务端完成批阅的时间。")
