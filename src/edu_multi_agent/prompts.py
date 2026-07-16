from __future__ import annotations

import json
from pathlib import Path

from .models import (
    ArtifactResult,
    GenerationRequest,
    KnowledgeBaseContext,
    PracticeBlueprint,
    PreparationPlan,
)


def _plan_json(plan: PreparationPlan) -> str:
    return json.dumps(plan.model_dump(), ensure_ascii=False, indent=2)


def _artifact_json(artifacts: list[ArtifactResult]) -> str:
    return json.dumps(
        [artifact.model_dump() for artifact in artifacts],
        ensure_ascii=False,
        indent=2,
    )


def _practice_blueprint_json(blueprint: PracticeBlueprint) -> str:
    return json.dumps(blueprint.model_dump(), ensure_ascii=False, indent=2)


def _knowledge_base_prompt(context: KnowledgeBaseContext | None) -> str:
    if context is None or not context.hits:
        return "Knowledge base RAG tool: not available for this request."

    return "\n".join(
        [
            "Knowledge base RAG tool:",
            f"- Tool name: {context.tool_name}",
            f"- Source: {context.source_title} ({context.source_id})",
            f"- Query: {context.query}",
            "- Usage policy:",
            *[f"  - {item}" for item in context.usage_policy],
            "- Retrieved snippets:",
            *[
                "\n".join(
                    [
                        f"  {index}. {hit.title} (score={hit.score:.2f})",
                        f"     Path: {' > '.join(hit.path) if hit.path else hit.title}",
                        f"     Summary: {hit.summary or '无'}",
                        "     Content: "
                        + ("；".join(hit.content[:5]) if hit.content else "无"),
                    ]
                )
                for index, hit in enumerate(context.hits, start=1)
            ],
        ]
    )


def _load_question_type_reference() -> str:
    question_type_path = Path(__file__).resolve().parents[1] / "types" / "question_type.py"
    try:
        return question_type_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return (
            "BaseQuestion, FillInTheBlank, MultipleChoice, ShortAnswer, "
            "Listening, Coding, Drawing"
        )


def build_planner_prompts(request: GenerationRequest) -> tuple[str, str]:
    system_prompt = """
You are the supervisor agent in a LangGraph teaching-preparation workflow.
Your job is to decide what needs to be prepared before teaching begins.
Return strict JSON only. Do not include Markdown fences.
""".strip()

    user_prompt = f"""
Create a preparation plan for the pre-teaching stage.

Requirements:
- All pedagogical content should be suitable for Chinese output.
- Focus only on the preparation stage before class delivery.
- The supervisor must identify required materials and route tasks to parallel agents.
- The four routed agents are fixed and must all appear exactly once:
  1. study_guide
  2. practice
  3. manim
  4. interactive_web
- Use concise but actionable items.

Request context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}
- Output language: {request.language}

{_knowledge_base_prompt(request.knowledge_base_context)}

Return one JSON object with exactly this shape:
{{
  "stage": "pre_teaching_preparation",
  "plan_summary": "short Chinese summary",
  "required_materials": ["item 1", "item 2"],
  "teacher_checklist": ["item 1", "item 2"],
  "teaching_focus": ["item 1", "item 2"],
  "quality_bar": ["item 1", "item 2"],
  "agent_routes": [
    {{
      "agent_name": "study_guide",
      "selected": true,
      "objective": "goal for this agent",
      "deliverables": ["study_guide.md", "teacher_notes.md"],
      "focus_points": ["item 1", "item 2"]
    }},
    {{
      "agent_name": "practice",
      "selected": true,
      "objective": "goal for this agent",
      "deliverables": ["practice_blueprint.md", "practice_questions.json", "answer_key.md"],
      "focus_points": ["item 1", "item 2"]
    }},
    {{
      "agent_name": "manim",
      "selected": true,
      "objective": "goal for this agent",
      "deliverables": ["lesson_animation.py", "render_guide.md"],
      "focus_points": ["item 1", "item 2"]
    }},
    {{
      "agent_name": "interactive_web",
      "selected": true,
      "objective": "goal for this agent",
      "deliverables": ["index.html", "usage_notes.md"],
      "focus_points": ["item 1", "item 2"]
    }}
  ]
}}
""".strip()

    return system_prompt, user_prompt


def build_study_guide_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> tuple[str, str]:
    system_prompt = """
You are the study guide agent in a teaching-preparation multi-agent system.
You produce direct-to-save Markdown files in Chinese.
Return only the required tags and files.
""".strip()

    user_prompt = f"""
Generate the study-guide package for the pre-teaching stage.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

{_knowledge_base_prompt(request.knowledge_base_context)}

Supervisor plan:
{_plan_json(plan)}

Output format:
<<<SUMMARY>>>
One short Chinese paragraph describing what was produced.
<<<END SUMMARY>>>
<<<FILE:study_guide.md>>>
Markdown content in Chinese.
<<<END FILE>>>
<<<FILE:teacher_notes.md>>>
Markdown content in Chinese.
<<<END FILE>>>

File requirements:
- study_guide.md must include: title, learning objectives, prerequisite knowledge,
  key concepts, pre-class study tasks, source-material reading guide, and reflection prompts.
- teacher_notes.md must include: preparation checklist, teaching hints, pacing suggestions,
  likely misconceptions, and recommended materials to prepare in advance.
- Keep the content practical and teacher-ready.
- Do not output anything outside the tags.
""".strip()

    return system_prompt, user_prompt


def build_practice_planner_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> tuple[str, str]:
    system_prompt = """
You are the practice-planning agent in a teaching-preparation multi-agent system.
Your job is to decide how many questions of each question type should be generated
before the practice-design agent writes any concrete questions.
Return strict JSON only. Do not include Markdown fences.
""".strip()

    user_prompt = f"""
Create a practice blueprint for the pre-class question bank.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

{_knowledge_base_prompt(request.knowledge_base_context)}

Supervisor plan:
{_plan_json(plan)}

Available question types and their typical strengths:
- FillInTheBlank: terminology recall, formula completion, symbolic details, short factual checks.
- MultipleChoice: concept discrimination, misconception checks, fast diagnosis of understanding.
- ShortAnswer: explanation, strategy choice, reasoning, method comparison, reflective transfer.
- Listening: audio comprehension, pronunciation, music, or any skill where listening is essential.
- Coding: algorithm design, debugging, implementation, computational procedures, programmatic problem solving.
- Drawing: geometry, forces, structure diagrams, process maps, coordinate graphs, or visual-spatial reasoning.

Planning requirements:
- Output all explanatory strings in Chinese.
- Decide the distribution from the topic nature, learner profile, transfer goals, and the practice route.
- Do not use a fixed template. Not every question type must appear.
- If the topic requires implementation, algorithmic thinking, computational procedures, or step-by-step problem solving,
  allocate multiple Coding and/or ShortAnswer questions instead of leaving Coding as a token single item.
- If the topic is mainly conceptual recall, MultipleChoice and FillInTheBlank can take a larger share.
- Use Listening only when audio is inherently required by the learning goal.
- Use Drawing only when visual-spatial representation is important to mastering the topic.
- The full bank should cover warm-up, core consolidation, challenge, and transfer/application.
- Prefer 6-12 total questions unless the context strongly justifies another size.
- Only include question types with a positive count in `question_allocations`.

Return one JSON object with exactly this shape:
{{
  "planning_summary": "short Chinese summary",
  "total_questions": 8,
  "topic_characteristics": ["item 1", "item 2"],
  "distribution_principles": ["item 1", "item 2"],
  "progression_plan": ["warm-up", "core practice", "challenge", "transfer"],
  "must_cover": ["item 1", "item 2"],
  "question_allocations": [
    {{
      "question_type": "MultipleChoice",
      "count": 2,
      "purpose": "why this type matters here",
      "competency_focus": ["item 1", "item 2"]
    }},
    {{
      "question_type": "ShortAnswer",
      "count": 3,
      "purpose": "why this type matters here",
      "competency_focus": ["item 1", "item 2"]
    }}
  ]
}}
""".strip()

    return system_prompt, user_prompt


def build_practice_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
    blueprint: PracticeBlueprint,
) -> tuple[str, str]:
    question_type_reference = _load_question_type_reference()
    system_prompt = """
You are the practice-design agent in a teaching-preparation multi-agent system.
You produce a structured Chinese practice package.
Return strict JSON only. Do not include Markdown fences.
""".strip()

    user_prompt = f"""
Generate the pre-class practice package.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

{_knowledge_base_prompt(request.knowledge_base_context)}

Supervisor plan:
{_plan_json(plan)}

Practice blueprint:
{_practice_blueprint_json(blueprint)}

Return one JSON object with exactly this shape:
{{
  "summary": "一句中文摘要",
  "questions": [
    {{
      "question_type": "FillInTheBlank | MultipleChoice | ShortAnswer | Listening | Coding | Drawing",
      "question": "中文题干",
      "analysis": "中文解析",
      "need_ai_judge": false,
      "skill_tags": ["中文技能标签"],
      "difficulty": 0.4
    }}
  ],
  "answer_key_markdown": "Markdown content in Chinese"
}}

File requirements:
- Follow the exact field names and question classes used in this reference file:
```python
{question_type_reference}
```
- `questions` must be a top-level array under the returned object.
- Each item in `questions` must represent one question object built from one of these classes:
  FillInTheBlank, MultipleChoice, ShortAnswer, Listening, Coding, Drawing.
- Each item must include a `question_type` field whose value is exactly one of:
  `FillInTheBlank`, `MultipleChoice`, `ShortAnswer`, `Listening`, `Coding`, `Drawing`.
- Do not generate `id` or `question_id` yourself. The system will assign a global unique id
  after generation is complete.
- Besides `question_type`, each item must use the exact field names from the dataclass
  definition of that question type.
- For MultipleChoice questions, `correct_answer` must be the exact full option content
  from the `options` array, not the option label such as A, B, C, D, `A.`, or `选项A`.
- Use `need_ai_judge` to mark whether the frontend should hand the submission to AI review.
  Set it to `true` for subjective/open-ended responses such as most ShortAnswer, Coding,
  and Drawing items, and set it to `false` for questions that can be judged directly.
- Every question should also include:
  - `skill_tags`: 1-3 个中文技能标签，表示这道题主要诊断或训练的能力点。
  - `difficulty`: 0-1 之间的小数，表示该题对当前学习目标的相对难度。
- Do not output the legacy field name `requires_ai_judgment`.
- You must generate exactly {blueprint.total_questions} questions in total.
- The count of each `question_type` must exactly match the practice blueprint.
- Follow the blueprint's progression plan and must-cover points instead of reverting
  to a generic balanced mix.
- If one question type receives multiple slots in the blueprint, each instance must
  target a distinct sub-skill, misconception, or level of transfer.
- The question bank must include warm-up items, core practice, one challenge task,
  and one applied, transfer, or discussion-style prompt.
- Every question must have clear Chinese question text and Chinese analysis.
- The generated JSON object must be directly parseable by `json.loads`.
- In JSON strings, every literal backslash must be escaped as `\\\\`.
  For LaTeX commands, write `\\\\theta`, `\\\\frac`, `\\\\Delta`,
  not `\\theta`, `\\frac`, or `\\Delta`.
- Any mathematical formula in `question`, `options`, answers, `analysis`, or
  `answer_key_markdown` must use Markdown math delimiters:
  use `$...$` for inline formulas and `$$...$$` for standalone display formulas.
- Do not write bare LaTeX commands such as `\\Delta`, `\\theta`, `\\frac`, `\\sin`,
  or `\\sqrt` outside `$...$` or `$$...$$`.
- Do not use `\\(...\\)` or `\\[...\\]`; the practice frontend and PDF export expect
  dollar-delimited Markdown math.
- `answer_key_markdown` must provide concise answers, solution ideas, and common mistakes.
- `answer_key_markdown` must follow the same order as `questions`, and reference each item
  as `第1题`、`第2题`、`第3题` ... instead of inventing ids.
- The difficulty should match the learner profile and stay aligned with the learning goal.
- For Coding questions, `reference_code` must be a complete reference implementation,
  and `test_cases` must be JSON-serializable.
- Do not output anything outside the JSON object.
""".strip()

    return system_prompt, user_prompt


def build_manim_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> tuple[str, str]:
    system_prompt = """
You are the Manim animation agent in a teaching-preparation multi-agent system.
You produce a self-contained Manim Python script plus a short render guide.
Return only the required tags and files.


编写高质量 Manim 教学动画，注意：

生命周期：play() 后的临时对象必须 FadeOut()

视觉引导：

重点用 Indicate()、Circumscribe() 强调
重要内容用 YELLOW/RED 高亮
复杂内容分步展示，每步 wait(1)
教学辅助：

用 Arrow/Brace 添加说明
用 ReplacementTransform 展示演变
对比用不同颜色区分
动画选择：

出现：Write(文字)、Create(图形)、FadeIn(通用)
强调：Indicate、Flash、Wiggle
变换：Transform、ReplacementTransform
质量标准：
✅ 关键内容有视觉强调
✅ 节奏适中有停顿
✅ 颜色运用一致
✅ 场景整洁无堆积
""".strip()

    user_prompt = f"""
Generate a Manim animation package for the learning goal below.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

{_knowledge_base_prompt(request.knowledge_base_context)}

Supervisor plan:
{_plan_json(plan)}

Output format:
<<<SUMMARY>>>
One short Chinese paragraph describing what was produced.
<<<END SUMMARY>>>
<<<FILE:lesson_animation.py>>>
Python code only.
<<<END FILE>>>
<<<FILE:render_guide.md>>>
Markdown content in Chinese.
<<<END FILE>>>

File requirements:
- lesson_animation.py must be valid Manim code.
- Use `from manim import *`.
- Define one main scene class named `LessonScene`.
- Keep it self-contained. Do not rely on external assets.
- The animation should explain the concept visually and match the learning goal.
- The script will be executed with `manim -pql lesson_animation.py LessonScene`, so it must
  run without runtime errors under that command.
- render_guide.md must include the render command and a short explanation of the scene.
- Do not output anything outside the tags.
""".strip()

    return system_prompt, user_prompt


def build_interactive_web_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> tuple[str, str]:
    system_prompt = """
You are the interactive-web agent in a teaching-preparation multi-agent system.
You produce a single self-contained HTML page with embedded CSS and JavaScript.
The page must be intentional, distinctive, responsive, and interactive.
Return only the required tags and files.
""".strip()

    user_prompt = f"""
Generate the interactive web package for the pre-teaching stage.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

{_knowledge_base_prompt(request.knowledge_base_context)}

Supervisor plan:
{_plan_json(plan)}

Output format:
<<<SUMMARY>>>
One short Chinese paragraph describing what was produced.
<<<END SUMMARY>>>
<<<FILE:index.html>>>
Full HTML document only.
<<<END FILE>>>
<<<FILE:usage_notes.md>>>
Markdown content in Chinese.
<<<END FILE>>>

File requirements:
- index.html must be a complete HTML document with inline CSS and inline JavaScript.
- No external CDN, no framework dependency, no build step.
- It must work on desktop and mobile.
- Include at least three interactive teaching elements such as:
  explorable concept cards, a mini quiz, parameter controls, reveal steps, or instant feedback.
- The visual style should feel deliberate rather than generic.
- usage_notes.md must explain how a teacher can use the page before or during class.
- Do not output anything outside the tags.
""".strip()

    return system_prompt, user_prompt


def build_report_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
    artifacts: list[ArtifactResult],
    output_dir: str,
) -> tuple[str, str]:
    system_prompt = """
You are the supervisor agent that summarizes a completed teaching-preparation run.
Return Markdown only, with no code fences around the entire answer.
""".strip()

    user_prompt = f"""
Write the final supervisor report in Chinese Markdown.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Output directory: {output_dir}

{_knowledge_base_prompt(request.knowledge_base_context)}

Preparation plan:
{_plan_json(plan)}

Agent outputs:
{_artifact_json(artifacts)}

Report requirements:
- Use a clear Markdown title.
- Summarize what materials should be prepared before teaching.
- Summarize each agent's output and status.
- Include a short risk or follow-up section.
- Include a file inventory section with generated files.
- Keep it practical and concise.
""".strip()

    return system_prompt, user_prompt
