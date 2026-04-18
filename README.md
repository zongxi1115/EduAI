# 贡献前必读

请不要直接merge到main分支，先**务必且只在** 对应自己的分支开发，完成后提交**pull request**，并@相关人员进行code review后才能merge到main分支。

## 协作与部署文档

- 贡献指南：[`CONTRIBUTING.md`](./CONTRIBUTING.md)
- PR 模板：[`pull_request_template.md`](./.github/pull_request_template.md)
- 部署教程：[`docs/deployment/README.md`](./docs/deployment/README.md)

# Edu Multi-Agent

This module builds a LangGraph-based teaching preparation workflow for the pre-class stage.

## What it does

Input a learning goal, then let a supervisor agent:

- decide what teaching materials should be prepared,
- route work in parallel to specialized agents,
- collect actual file outputs,
- write a final Markdown report.

The specialized agents generate:

- study guide documents,
- practice exercises with an answer key,
- a Manim animation script,
- an interactive web page.

## Environment

Create a `.env` file in the project root based on `.env.example`.

Required keys:

- `BASE_URL`
- `API_KEY`
- `MODEL_NAME`

Optional keys:

- `OUTPUT_ROOT`
- `TEMPERATURE`
- `REQUEST_TIMEOUT_SECONDS`

## Install

```bash
conda run -n base python -m pip install -e .
```

## Run

Directly from the repo root:

```bash
conda run -n base python run_edu_multi_agent.py --goal "Understand the causes and impacts of the water cycle"
```

You can also add optional metadata:

```bash
conda run -n base python run_edu_multi_agent.py ^
  --goal "Understand quadratic functions and their graphs" ^
  --subject "Mathematics" ^
  --grade-level "Grade 8" ^
  --learner-profile "Mixed-ability class that needs visual explanation and structured practice" ^
  --notes "Focus on pre-class preparation assets only"
```

## API Gateway

The FastAPI backend now lives in [`src/gateway`](./src/gateway) and is separated from the
LangGraph workflow package in [`src/edu_multi_agent`](./src/edu_multi_agent).

Run the API locally with either command:

```bash
conda run -n base edu-prep-api --host 127.0.0.1 --port 8000
```

```bash
conda run -n base uvicorn gateway.main:app --host 127.0.0.1 --port 8000 --reload
```

Interactive API docs:

- `http://127.0.0.1:8000/api/docs`

## Output

Each run creates a timestamped folder under `outputs/`, for example:

```text
outputs/
  20260414_021500_teaching_prep/
    00_supervisor/
      preparation_plan.json
      preparation_plan.md
      final_report.md
      artifact_manifest.json
      langgraph_events.jsonl
      langgraph_trace.md
      final_state.json
      langgraph_state_snapshots/
        01_planner.json
        02_study-guide-agent.json
        ...
    01_study_guide/
      study_guide.md
      teacher_notes.md
    02_practice/
      practice_questions.json
      answer_key.md
    03_manim/
      lesson_animation.py
      render_guide.md
    04_interactive_web/
      index.html
      usage_notes.md
```
