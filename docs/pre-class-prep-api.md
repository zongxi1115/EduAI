# 课前准备 API 文档

## 概览

这套接口把现有 LangGraph 课前准备多智能体编排封装成了可供前端直接调用的 HTTP API。

后端能力包含：

- 创建一次课前准备运行
- 通过 SSE 持续接收多智能体编排进度
- 查询运行状态
- 获取已导出的素材清单
- 下载单个导出文件
- 下载整次运行的 ZIP 打包结果

推荐前端调用顺序：

1. `POST /api/v1/prep-runs` 创建运行，拿到 `run_id`
2. 立刻打开 `GET /api/v1/prep-runs/{run_id}/events` 的 SSE 连接
3. 用 SSE 事件驱动动画、阶段状态、素材列表更新
4. 需要补拉时调用 `GET /api/v1/prep-runs/{run_id}`
5. 需要展示素材时调用 `GET /api/v1/prep-runs/{run_id}/artifacts`

## 运行服务

建议按你当前环境使用：

```bash
conda run -n base python -m pip install -e .
conda run -n base edu-prep-api --host 127.0.0.1 --port 8000
```

交互式文档：

- `http://127.0.0.1:8000/docs`

健康检查：

- `GET /health`

## 1. 创建运行

`POST /api/v1/prep-runs`

请求体：

```json
{
  "learning_goal": "理解二次函数图像与性质",
  "subject": "Mathematics",
  "grade_level": "Grade 8",
  "learner_profile": "Mixed-ability class that needs visual explanation and structured practice.",
  "notes": "Focus on pre-class preparation assets only",
  "language": "zh-CN"
}
```

响应示例：

```json
{
  "run_id": "20260415_153012_quadratic-functions",
  "status": "queued",
  "created_at": "2026-04-15T15:30:12",
  "output_dir": "D:\\vibe_projs\\edu\\outputs\\20260415_153012_quadratic-functions",
  "links": {
    "status": "/api/v1/prep-runs/20260415_153012_quadratic-functions",
    "events": "/api/v1/prep-runs/20260415_153012_quadratic-functions/events",
    "artifacts": "/api/v1/prep-runs/20260415_153012_quadratic-functions/artifacts",
    "bundle": "/api/v1/prep-runs/20260415_153012_quadratic-functions/bundle"
  }
}
```

前端建议：

- 收到响应后立即打开 SSE，不要等轮询
- `run_id` 作为整次运行的唯一主键

## 2. SSE 事件流

`GET /api/v1/prep-runs/{run_id}/events`

查询参数：

- `after_id`
  只回放大于该编号的事件，默认 `-1`
- `heartbeat_seconds`
  心跳间隔，默认 `15`

响应类型：

- `text/event-stream`

### 事件字段

每条 SSE 的 `data` 都是 JSON，对前端最重要的字段如下：

- `index`: 事件序号，可用于断线续传
- `timestamp`: 事件时间
- `event`: 事件类型
- `node`: LangGraph 节点名
- `phase`: 阶段名，常见值有 `planning`、`artifact_generation`、`reporting`
- `agent_name`: 某些 Agent 事件会带上
- `summary`: 给前端可直接展示的短摘要
- `data`: 结构化补充信息
- `run_id`
- `run_status`

### 事件类型约定

- `run_created`
  API 已受理，任务入队
- `workflow_started`
  LangGraph 开始执行
- `node_started`
  某个阶段开始，适合切换步骤动画
- `plan_ready`
  总控规划产出完成
- `artifact_ready`
  某个 Agent 的素材已生成完成
- `artifact_failed`
  某个 Agent 失败
- `artifact_skipped`
  某个 Agent 被总控跳过
- `manifest_ready`
  素材清单文件写入完成
- `report_ready`
  总结报告写入完成
- `node_completed`
  LangGraph 某节点已完成
- `state_snapshot`
  LangGraph 状态快照已落盘
- `workflow_completed`
  全流程完成
- `workflow_failed`
  全流程失败
- `heartbeat`
  空闲心跳，表示连接仍然活着

### SSE 示例

```text
event: node_started
id: 2
data: {"index":2,"timestamp":"2026-04-15T15:30:18","event":"node_started","node":"planner","phase":"planning","summary":"Planner node started.","run_id":"20260415_153012_quadratic-functions","run_status":"running","data":{"title":"总控规划","learning_goal":"理解二次函数图像与性质"}}
```

```text
event: artifact_ready
id: 8
data: {"index":8,"timestamp":"2026-04-15T15:31:02","event":"artifact_ready","node":"practice_agent","phase":"artifact_generation","agent_name":"practice","summary":"练习 Agent generated successfully.","run_id":"20260415_153012_quadratic-functions","run_status":"running","data":{"artifact":{"agent_name":"practice","title":"练习 Agent","status":"completed","summary":"...","output_dir":"...","files":["...practice_questions.json","...answer_key.md"],"notes":[]}}}
```

前端建议：

- 用 `node_started` 驱动“当前阶段”
- 用 `artifact_ready` 直接把右侧素材列表增量更新
- 用 `workflow_completed` 或 `workflow_failed` 结束加载态
- 断线重连时带上上次收到的 `index` 作为 `after_id`

## 3. 查询运行状态

`GET /api/v1/prep-runs/{run_id}`

响应示例：

```json
{
  "run_id": "20260415_153012_quadratic-functions",
  "status": "running",
  "created_at": "2026-04-15T15:30:12",
  "started_at": "2026-04-15T15:30:13",
  "finished_at": null,
  "output_dir": "D:\\vibe_projs\\edu\\outputs\\20260415_153012_quadratic-functions",
  "request": {
    "learning_goal": "理解二次函数图像与性质",
    "subject": "Mathematics",
    "grade_level": "Grade 8",
    "learner_profile": "Mixed-ability class that needs visual explanation and structured practice.",
    "notes": "Focus on pre-class preparation assets only",
    "language": "zh-CN"
  },
  "artifact_count": 2,
  "error": null,
  "links": {
    "status": "/api/v1/prep-runs/20260415_153012_quadratic-functions",
    "events": "/api/v1/prep-runs/20260415_153012_quadratic-functions/events",
    "artifacts": "/api/v1/prep-runs/20260415_153012_quadratic-functions/artifacts",
    "bundle": "/api/v1/prep-runs/20260415_153012_quadratic-functions/bundle"
  }
}
```

## 4. 获取素材清单

`GET /api/v1/prep-runs/{run_id}/artifacts`

响应示例：

```json
{
  "run_id": "20260415_153012_quadratic-functions",
  "status": "succeeded",
  "plan_file": {
    "name": "preparation_plan.md",
    "relative_path": "00_supervisor/preparation_plan.md",
    "size_bytes": 3240,
    "content_type": "text/markdown",
    "download_url": "/api/v1/prep-runs/20260415_153012_quadratic-functions/files/00_supervisor/preparation_plan.md"
  },
  "report_file": {
    "name": "final_report.md",
    "relative_path": "00_supervisor/final_report.md",
    "size_bytes": 2860,
    "content_type": "text/markdown",
    "download_url": "/api/v1/prep-runs/20260415_153012_quadratic-functions/files/00_supervisor/final_report.md"
  },
  "manifest_file": {
    "name": "artifact_manifest.json",
    "relative_path": "00_supervisor/artifact_manifest.json",
    "size_bytes": 2180,
    "content_type": "application/json",
    "download_url": "/api/v1/prep-runs/20260415_153012_quadratic-functions/files/00_supervisor/artifact_manifest.json"
  },
  "artifacts": [
    {
      "agent_name": "study_guide",
      "title": "学案 Agent",
      "status": "completed",
      "summary": "...",
      "notes": [],
      "output_dir": "D:\\vibe_projs\\edu\\outputs\\20260415_153012_quadratic-functions\\01_study_guide",
      "files": [
        {
          "name": "study_guide.md",
          "relative_path": "01_study_guide/study_guide.md",
          "size_bytes": 1820,
          "content_type": "text/markdown",
          "download_url": "/api/v1/prep-runs/20260415_153012_quadratic-functions/files/01_study_guide/study_guide.md"
        }
      ]
    }
  ],
  "bundle_download_url": "/api/v1/prep-runs/20260415_153012_quadratic-functions/bundle"
}
```

前端建议：

- 用这个接口做“结果页”或“素材抽屉”
- `artifact_ready` 到达后可以立即重新请求一次，拿最新清单

## 5. 下载单个文件

`GET /api/v1/prep-runs/{run_id}/files/{file_path}`

查询参数：

- `download=false`
  默认不强制下载，浏览器可直接预览
- `download=true`
  强制作为附件下载

示例：

- `/api/v1/prep-runs/{run_id}/files/01_study_guide/study_guide.md`
- `/api/v1/prep-runs/{run_id}/files/04_interactive_web/index.html`
- `/api/v1/prep-runs/{run_id}/files/02_practice/practice_questions.json?download=true`

## 6. 下载整包 ZIP

`GET /api/v1/prep-runs/{run_id}/bundle`

返回整次运行输出目录的 ZIP 包，方便教师一次性下载所有素材。

## 前端接入建议

### 最小可用方案

1. 创建运行
2. 打开 SSE
3. 根据 `event` 更新步骤条与动画
4. 收到 `artifact_ready` 后刷新素材列表
5. 收到 `workflow_completed` 后切到结果态

### 状态映射建议

- `queued`
  等待中
- `running`
  生成中
- `succeeded`
  完成
- `failed`
  失败

### 阶段映射建议

- `planning`
  总控规划
- `artifact_generation`
  多智能体生成素材
- `reporting`
  汇总与导出

## 备注

- 事件流当前基于 SSE，前端推荐 `EventSource` 或 `fetch + ReadableStream`
- 下载接口会校验路径，只允许访问该次运行输出目录内的文件
- 如果服务进程未重启，SSE 可以持续收到实时事件
- 若运行已经完成，也可以再次访问 SSE 接口回放历史事件
