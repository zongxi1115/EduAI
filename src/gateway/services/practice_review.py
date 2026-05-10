from __future__ import annotations

import json
from typing import Any

from ..schemas.practice_review import PracticeReviewRequest


PRACTICE_REVIEW_SYSTEM_PROMPT = """
You are an experienced Chinese-speaking teacher reviewing student answers in an education platform.
You must evaluate the submission fairly, explain your judgment clearly, and provide actionable feedback.

Grounding rules:
- Judge only from the provided question, reference material, student answer, and submission context.
- If the evidence is insufficient, say so clearly and use `ungradable` instead of guessing.
- For coding questions, consider correctness, completeness, readability, edge cases, and any supplied run output.
- For drawing questions, if only a text description is provided, review based on that description and explain the limitation.
- Keep the feedback encouraging, specific, and easy for a student to act on.

Output rules:
- Return exactly one JSON object.
- All explanation strings should be in Chinese.
""".strip()


def _json_block(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _sanitize_submission_context(
    request: PracticeReviewRequest,
) -> tuple[dict[str, Any], str | None]:
    submission_context = dict(request.submission_context or {})
    drawing_image_data_url = submission_context.pop("drawing_image_data_url", None)
    if isinstance(drawing_image_data_url, str) and drawing_image_data_url.strip():
        submission_context["drawing_image_attached"] = True
        return submission_context, drawing_image_data_url.strip()
    return submission_context, None


def build_practice_review_prompts(
    request: PracticeReviewRequest,
) -> tuple[str, str | list[dict[str, Any]]]:
    """Build the prompts for AI practice review."""

    question = request.question.model_dump(mode="json")
    submission_context, drawing_image_data_url = _sanitize_submission_context(request)
    learning_goal = (request.learning_goal or "").strip() or "（未提供学习目标）"
    drawing_note = (
        "\n- 系统还会附带一张学生的作图图片，请务必结合图片内容判断结构、标注、线条与作图完整度。"
        if request.question.question_type == "Drawing" and drawing_image_data_url
        else ""
    )

    user_prompt = f"""
请批阅下面这道练习题的学生作答。

学习目标：
{learning_goal}

题目快照：
{_json_block(question)}

学生提交：
{_json_block(request.student_answer)}

附加上下文：
{_json_block(submission_context)}

请按以下要求输出 JSON：
{{
  "correctness": "correct | partially_correct | incorrect | ungradable",
  "score": 0,
  "summary": "一句中文总结",
  "strengths": ["亮点 1", "亮点 2"],
  "issues": ["问题 1", "问题 2"],
  "review_advice": ["建议 1", "建议 2"],
  "reference_points": ["参考点 1", "参考点 2"],
  "limitations": ["局限说明 1"],
  "skill_judgments": [
    {{
      "skill_id": "skill_id_1",
      "display_name": "技能名称 1",
      "score": 0.68,
      "coverage": 0.9,
      "confidence": 0.8,
      "reasoning_quality": 0.62,
      "misconception_tags": ["误区标签 1"],
      "observation": "一句简短观察"
    }}
  ],
  "learner_observations": ["观察 1", "观察 2"]
}}

批阅要求：
- `score` 使用 0-100 的整数。
- `summary` 要直接概括当前答案水平，不要空泛表扬。
- `review_advice` 要给学生可执行的修改建议，优先返回 2-4 条。
- `reference_points` 可以提炼标准答案、关键推理、测试覆盖点或作图核对点。
- 如果是作图题，请结合学生提交的图像，从图形结构、标注、比例/方向、信息完整度等角度进行评价。{drawing_note}
- 如果题目证据不足，`correctness` 设为 `ungradable`，并在 `limitations` 中明确原因。
- 如果学生答案基本方向正确但不完整，使用 `partially_correct`。
- `skill_judgments` 返回 1 到 3 个最关键的技能判断。
- 若题目快照中已提供 `skill_tags`，优先沿用这些标签语义，不要随意偏离。
- `skill_id` 应尽量稳定、简洁，适合作为长期画像中的技能键；可用英文蛇形命名，也可对中文技能点做稳定缩写。
- `score` 表示这次作答对该技能提供的正向证据强度，范围 0-1。
- `coverage` 表示该题对该技能覆盖度，范围 0-1。
- `confidence` 表示你对该技能判断的把握，范围 0-1。
- `reasoning_quality` 表示学生在该技能上的推理质量，范围 0-1。
- `learner_observations` 提炼本次作答反映出的学习特点、错误倾向或支架需求，优先给 1 到 3 条。
- 不要输出 Markdown 代码块，不要输出 JSON 以外的任何文字。
""".strip()

    if request.question.question_type == "Drawing" and drawing_image_data_url:
        return (
            PRACTICE_REVIEW_SYSTEM_PROMPT,
            [
                {
                    "type": "text",
                    "text": user_prompt,
                },
                {
                    "type": "image_url",
                    "image_url": {"url": drawing_image_data_url},
                },
            ],
        )

    return PRACTICE_REVIEW_SYSTEM_PROMPT, user_prompt
