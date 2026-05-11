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
- If `submission_context.language` is provided, treat it as the student's actual coding language and prefer it over any language implied by the reference code.
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
    editor_language = submission_context.get("language")
    editor_language_note = (
        f"学生实际选择的编辑器语言：{editor_language}。"
        if isinstance(editor_language, str) and editor_language.strip()
        else "学生实际选择的编辑器语言：未提供。"
    )
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

{editor_language_note}

请按以下要求输出 JSON：
{{
  "correctness": "correct | partially_correct | incorrect | ungradable",
  "score": 0,
  "summary": "一句中文总结",
  "strengths": ["亮点 1", "亮点 2"],
  "issues": ["问题 1", "问题 2"],
  "review_advice": ["建议 1", "建议 2"],
  "reference_points": ["参考点 1", "参考点 2"],
  "limitations": ["局限说明 1"]
}}

批阅要求：
- `score` 使用 0-100 的整数。
- `summary` 要直接概括当前答案水平，不要空泛表扬。
- `review_advice` 要给学生可执行的修改建议，优先返回 2-4 条。
- `reference_points` 可以提炼标准答案、关键推理、测试覆盖点或作图核对点。
- 如果学生实际选择了 JavaScript 或 Python，请按照该语言的语法与写法风格来判断，不要只根据题面中的参考代码语言下结论。
- 如果是作图题，请结合学生提交的图像，从图形结构、标注、比例/方向、信息完整度等角度进行评价。{drawing_note}
- 如果题目证据不足，`correctness` 设为 `ungradable`，并在 `limitations` 中明确原因。
- 如果学生答案基本方向正确但不完整，使用 `partially_correct`。
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
