from __future__ import annotations

import json
from pathlib import Path

from .models import ArtifactResult, GenerationRequest, PreparationPlan


def _plan_json(plan: PreparationPlan) -> str:
    return json.dumps(plan.model_dump(), ensure_ascii=False, indent=2)


def _artifact_json(artifacts: list[ArtifactResult]) -> str:
    return json.dumps(
        [artifact.model_dump() for artifact in artifacts],
        ensure_ascii=False,
        indent=2,
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
      "deliverables": ["practice_questions.json", "answer_key.md"],
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


def build_practice_prompts(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> tuple[str, str]:
    question_type_reference = _load_question_type_reference()
    system_prompt = """
You are the practice-design agent in a teaching-preparation multi-agent system.
You produce a JSON question bank file plus an answer key in Chinese.
Return only the required tags and files.
""".strip()

    user_prompt = f"""
Generate the pre-class practice package.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

Supervisor plan:
{_plan_json(plan)}

Output format:
<<<SUMMARY>>>
One short Chinese paragraph describing what was produced.
<<<END SUMMARY>>>
<<<FILE:practice_questions.json>>>
JSON array only.
<<<END FILE>>>
<<<FILE:answer_key.md>>>
Markdown content in Chinese.
<<<END FILE>>>

File requirements:
- Follow the exact field names and question classes used in this reference file:
```python
{question_type_reference}
```
- practice_questions.json must be a top-level JSON array.
- Each item in the array must represent one question object built from one of these classes:
  FillInTheBlank, MultipleChoice, ShortAnswer, Listening, Coding, Drawing.
- Each item must include a `question_type` field whose value is exactly one of:
  `FillInTheBlank`, `MultipleChoice`, `ShortAnswer`, `Listening`, `Coding`, `Drawing`.
- Besides `question_type`, each item must use the exact field names from the dataclass
  definition of that question type.
- Prefer FillInTheBlank, MultipleChoice, and ShortAnswer unless the learning goal
  clearly requires another type.
- The question bank must include warm-up items, core practice, one challenge task,
  and one applied or discussion-style prompt.
- Every question must have a stable id, Chinese question text, and Chinese analysis.
- The generated JSON must be directly parseable by `json.loads`.
- Do not wrap the array in an object.
- answer_key.md must provide concise answers, solution ideas, and common mistakes.
- answer_key.md must reference each question by id in `practice_questions.json`.
- The difficulty should match the learner profile and stay aligned with the learning goal.
- Do not output anything outside the tags.
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
""".strip()

    user_prompt = f"""
Generate a Manim animation package for the learning goal below.

Context:
- Learning goal: {request.learning_goal}
- Subject: {request.subject}
- Grade level: {request.grade_level}
- Learner profile: {request.learner_profile}
- Notes: {request.notes}

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
