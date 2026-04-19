# 贡献前必读

请不要直接 merge 到 `main` 分支，先在自己的分支开发，完成后提交 Pull Request 并完成 code review。

## 协作与部署文档

- 贡献指南：[`CONTRIBUTING.md`](./CONTRIBUTING.md)
- PR 模板：[`pull_request_template.md`](./.github/pull_request_template.md)
- 部署教程：[`docs/deployment/README.md`](./docs/deployment/README.md)

# Edu Multi-Agent

Edu Multi-Agent 是一个面向课前备课场景的多智能体系统，核心基于 LangGraph，提供命令行与 API 两种使用方式。

## 功能概览

输入一个教学目标后，系统会由 supervisor agent 统一编排，自动生成：

- 学案与教师提示；
- 练习题与答案；
- Manim 动画脚本；
- 交互式网页素材；
- 最终汇总报告（Markdown）。

## 项目结构

- 后端工作流：[`src/edu_multi_agent`](./src/edu_multi_agent)
- API 网关：[`src/gateway`](./src/gateway)
- 前端页面：[`edu-ai-frontend`](./edu-ai-frontend)
- 测试目录：[`tests`](./tests)

## 环境与依赖

### 运行环境

- Python `>=3.10`
- Node.js `>=20`
- pnpm `>=9`

### 后端 Python 依赖（核心）

项目通过 `pyproject.toml` 管理依赖，核心包括：

- `langgraph`
- `langchain-core`
- `langchain-openai`
- `fastapi`
- `uvicorn`
- `pydantic`
- `python-dotenv`

开发测试建议安装：

```bash
conda run -n base python -m pip install -e ".[dev]"
```

如仅运行服务，可安装基础依赖：

```bash
conda run -n base python -m pip install -e .
```

### 前端依赖安装

```bash
pnpm --dir edu-ai-frontend install --frozen-lockfile
```

## 配置

在项目根目录基于 `.env.example` 创建 `.env`：

```bash
cp .env.example .env
```

必填项：

- `BASE_URL`
- `API_KEY`
- `MODEL_NAME`

可选项：

- `OUTPUT_ROOT`
- `TEMPERATURE`
- `REQUEST_TIMEOUT_SECONDS`
- `SUPPORT_VISION`

## 运行方式

### 1) 命令行运行（工作流）

```bash
conda run -n base python run_edu_multi_agent.py --goal "理解水循环的成因与影响"
```

带可选元数据：

```bash
conda run -n base python run_edu_multi_agent.py \
  --goal "理解二次函数及其图像" \
  --subject "数学" \
  --grade-level "八年级" \
  --learner-profile "基础差异较大的混合班级，偏好图形化讲解" \
  --notes "仅生成课前准备材料"
```

### 2) API 网关

```bash
conda run -n base edu-prep-api --host 127.0.0.1 --port 8000
```

或：

```bash
conda run -n base uvicorn gateway.main:app --host 127.0.0.1 --port 8000 --reload
```

接口文档：

- `http://127.0.0.1:8000/api/docs`

### 3) 前端本地开发

```bash
pnpm --dir edu-ai-frontend dev
```

## 常用校验命令

后端语法检查：

```bash
conda run -n base python -m compileall src
```

后端测试：

```bash
conda run -n base pytest -q
```

前端类型检查与 Lint：

```bash
pnpm --dir edu-ai-frontend typecheck
pnpm --dir edu-ai-frontend lint
```

## 输出目录示例

每次运行会在 `outputs/` 下创建一个时间戳目录，例如：

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
