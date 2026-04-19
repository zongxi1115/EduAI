from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import escape as html_escape
from datetime import datetime
from pathlib import Path
from typing import Any

from .models import (
    ArtifactResult,
    GenerationRequest,
    PracticeBlueprint,
    PreparationPlan,
)


SUMMARY_PATTERN = re.compile(r"<<<SUMMARY>>>\s*(.*?)\s*<<<END SUMMARY>>>", re.S)
FILE_PATTERN = re.compile(r"<<<FILE:(.+?)>>>\s*(.*?)\s*<<<END FILE>>>", re.S)


@dataclass(slots=True)
class ParsedBundle:
    summary: str
    files: dict[str, str]


def slugify_fragment(text: str, max_length: int = 32) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        return "teaching-prep"
    return slug[:max_length].strip("-") or "teaching-prep"


def create_run_directory(output_root: Path, learning_goal: str) -> Path:
    output_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_root / f"{stamp}_{slugify_fragment(learning_goal)}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def write_text_file(base_dir: Path, relative_path: str, content: str) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")
    return target


def write_json_file(base_dir: Path, relative_path: str, payload: dict) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return target


def append_jsonl_file(
    base_dir: Path,
    relative_path: str,
    payload: dict[str, Any],
) -> Path:
    target = base_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return target


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def render_langgraph_trace_markdown(events: list[dict[str, Any]]) -> str:
    lines = [
        "# LangGraph Runtime Trace",
        "",
        f"- Event count: {len(events)}",
        "",
        "## Event Timeline",
    ]

    for event in events:
        index = event.get("index", "-")
        mode = event.get("mode") or event.get("event")
        node = event.get("node", "-")
        summary = event.get("summary", "")
        lines.append(f"{index}. [{mode}] {node} {summary}".strip())

    snapshot_events = [event for event in events if event.get("snapshot_path")]
    if snapshot_events:
        lines.append("")
        lines.append("## State Snapshots")
        for event in snapshot_events:
            lines.append(
                f"- {event.get('node', '-')}: {event.get('snapshot_path', '')}"
            )

    return "\n".join(lines).strip()


def parse_tagged_bundle(
    raw_text: str,
    required_files: tuple[str, ...] | list[str] | None = None,
) -> ParsedBundle:
    summary_match = SUMMARY_PATTERN.search(raw_text)
    if not summary_match:
        raise ValueError("Missing <<<SUMMARY>>> block in model output.")

    files: dict[str, str] = {}
    for filename, content in FILE_PATTERN.findall(raw_text):
        clean_name = filename.strip()
        if not clean_name:
            continue
        files[clean_name] = content.strip() + "\n"

    if not files:
        raise ValueError("Missing <<<FILE:...>>> blocks in model output.")

    if required_files:
        missing_files = [name for name in required_files if name not in files]
        if missing_files:
            raise ValueError(
                "Missing required files in model output: " + ", ".join(missing_files)
            )

    return ParsedBundle(summary=summary_match.group(1).strip(), files=files)


def render_plan_markdown(
    request: GenerationRequest,
    plan: PreparationPlan,
) -> str:
    route_lines: list[str] = []
    for route in plan.agent_routes:
        route_lines.append(f"## Agent: {route.agent_name}")
        route_lines.append(f"- 是否启用: {route.selected}")
        route_lines.append(f"- 任务目标: {route.objective}")
        route_lines.append(
            "- 交付文件: "
            + (", ".join(route.deliverables) if route.deliverables else "无")
        )
        route_lines.append(
            "- 关注重点: "
            + (", ".join(route.focus_points) if route.focus_points else "无")
        )
        route_lines.append("")

    return "\n".join(
        [
            "# 教学准备计划",
            "",
            f"- 学习目标: {request.learning_goal}",
            f"- 学科: {request.subject}",
            f"- 学段/年级: {request.grade_level}",
            f"- 学习者画像: {request.learner_profile}",
            f"- 补充说明: {request.notes}",
            "",
            "## 总控摘要",
            plan.plan_summary,
            "",
            "## 需准备材料",
            *[f"- {item}" for item in plan.required_materials],
            "",
            "## 教师准备清单",
            *[f"- {item}" for item in plan.teacher_checklist],
            "",
            "## 教学关注重点",
            *[f"- {item}" for item in plan.teaching_focus],
            "",
            "## 质量要求",
            *[f"- {item}" for item in plan.quality_bar],
            "",
            "## Agent 路由结果",
            *route_lines,
        ]
    ).strip()


def render_practice_blueprint_markdown(
    request: GenerationRequest,
    blueprint: PracticeBlueprint,
) -> str:
    allocation_lines: list[str] = []
    for allocation in blueprint.question_allocations:
        allocation_lines.append(f"### {allocation.question_type}")
        allocation_lines.append(f"- 建议题量: {allocation.count}")
        allocation_lines.append(f"- 作用: {allocation.purpose}")
        allocation_lines.append(
            "- 能力覆盖: "
            + (", ".join(allocation.competency_focus) if allocation.competency_focus else "无")
        )
        allocation_lines.append("")

    return "\n".join(
        [
            "# 练习题型规划蓝图",
            "",
            f"- 学习目标: {request.learning_goal}",
            f"- 学科: {request.subject}",
            f"- 学段/年级: {request.grade_level}",
            f"- 建议总题量: {blueprint.total_questions}",
            "",
            "## 规划摘要",
            blueprint.planning_summary,
            "",
            "## 主题特征",
            *[f"- {item}" for item in blueprint.topic_characteristics],
            "",
            "## 配比原则",
            *[f"- {item}" for item in blueprint.distribution_principles],
            "",
            "## 题目推进节奏",
            *[f"- {item}" for item in blueprint.progression_plan],
            "",
            "## 必须覆盖",
            *[f"- {item}" for item in blueprint.must_cover],
            "",
            "## 题型分配",
            *allocation_lines,
        ]
    ).strip()


def render_fallback_report(
    request: GenerationRequest,
    plan: PreparationPlan,
    artifacts: list[ArtifactResult],
    output_dir: Path,
) -> str:
    lines = [
        "# 教学准备报告",
        "",
        f"- 学习目标: {request.learning_goal}",
        f"- 学科: {request.subject}",
        f"- 学段/年级: {request.grade_level}",
        f"- 输出目录: {output_dir}",
        "",
        "## 总控摘要",
        plan.plan_summary,
        "",
        "## 需准备材料",
    ]
    lines.extend(f"- {item}" for item in plan.required_materials)
    lines.append("")
    lines.append("## Agent 结果")
    for artifact in artifacts:
        lines.append(f"### {artifact.title}")
        lines.append(f"- Agent: {artifact.agent_name}")
        lines.append(f"- 状态: {artifact.status}")
        lines.append(f"- 摘要: {artifact.summary}")
        lines.extend(f"- 文件: {file_path}" for file_path in artifact.files)
        lines.extend(f"- 备注: {note}" for note in artifact.notes)
        lines.append("")
    return "\n".join(lines).strip()


def render_lecture_script_markdown(
    request: GenerationRequest,
    deck_title: str,
    slides: list[dict[str, Any]],
) -> str:
    """Render a teacher-facing lecture script derived from slide metadata."""
    lines = [
        "# 课堂讲稿",
        "",
        f"- 课程主题: {deck_title}",
        f"- 学习目标: {request.learning_goal}",
        f"- 学科: {request.subject}",
        f"- 学段/年级: {request.grade_level}",
        "",
    ]

    for slide in slides:
        lines.extend(
            [
                f"## 第{slide.get('sequence', 0)}页：{slide.get('title', '未命名页面')}",
                "",
                f"- 教学目标: {slide.get('teaching_goal', '围绕当前课程目标展开讲解。')}",
                f"- 页面类型: {slide.get('visual_type', 'concept')}",
                "",
                "### 讲解主线",
                slide.get("script_context_current", ""),
                "",
                "### 页内动画步骤",
                *[
                    f"{index}. {item}"
                    for index, item in enumerate(slide.get("animation_steps", []), start=1)
                ],
                "",
                "### 教师备注",
                slide.get("speaker_notes", ""),
                "",
            ]
        )
        interrupts = slide.get("interrupts", [])
        if interrupts:
            lines.append("### 课堂中断点")
            lines.extend(
                f"- {item.get('type', 'pause')}: {item.get('prompt', '')}" for item in interrupts
            )
            lines.append("")

    return "\n".join(lines).strip()


def render_presenter_notes_markdown(
    deck_title: str,
    slides: list[dict[str, Any]],
) -> str:
    """Render concise presenter notes for the presentation shell."""
    lines = [
        "# Presenter Notes",
        "",
        f"- Deck: {deck_title}",
        f"- Slide count: {len(slides)}",
        "",
    ]

    for slide in slides:
        lines.extend(
            [
                f"## Slide {slide.get('sequence', 0)} · {slide.get('title', 'Untitled')}",
                "",
                f"- Teaching goal: {slide.get('teaching_goal', '')}",
                f"- Notes: {slide.get('speaker_notes', '')}",
                "",
            ]
        )
        interrupts = slide.get("interrupts", [])
        if interrupts:
            lines.append("- Interrupts:")
            lines.extend(
                f"  - {item.get('type', 'pause')}: {item.get('prompt', '')}" for item in interrupts
            )
            lines.append("")

    return "\n".join(lines).strip()


def render_slide_html(deck_title: str, slide: dict[str, Any]) -> str:
    """Render one standalone HTML slide with a common EduSlide runtime contract."""
    title = html_escape(str(slide.get("title", "Untitled Slide")))
    deck = html_escape(deck_title)
    teaching_goal = html_escape(str(slide.get("teaching_goal", "")))
    context = html_escape(str(slide.get("script_context_current", "")))
    visual_type = html_escape(str(slide.get("visual_type", "concept")))
    before_context = html_escape(str(slide.get("script_context_before", "")))
    after_context = html_escape(str(slide.get("script_context_after", "")))

    animation_steps = [
        str(item).strip()
        for item in slide.get("animation_steps", [])
        if str(item).strip()
    ]
    if not animation_steps:
        animation_steps = [str(slide.get("script_context_current", "讲解当前核心内容。")).strip()]

    interrupts = [
        item
        for item in slide.get("interrupts", [])
        if isinstance(item, dict) and str(item.get("prompt", "")).strip()
    ]

    reveal_items_html = "\n".join(
        f'<li class="reveal-item" data-step="{index}">{html_escape(step)}</li>'
        for index, step in enumerate(animation_steps, start=1)
    )
    interrupt_cards_html = "\n".join(
        (
            '<div class="interrupt-card">'
            f'<span class="interrupt-type">{html_escape(str(item.get("type", "pause")))}</span>'
            f'<p>{html_escape(str(item.get("prompt", "")))}</p>'
            "</div>"
        )
        for item in interrupts
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <style>
      :root {{
        color-scheme: light;
        --bg: linear-gradient(135deg, #eff6ff 0%, #ffffff 35%, #f8fafc 100%);
        --panel: rgba(255, 255, 255, 0.82);
        --border: rgba(148, 163, 184, 0.22);
        --primary: #2563eb;
        --text: #0f172a;
        --muted: #475569;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
        background: var(--bg);
        color: var(--text);
      }}
      .stage {{
        min-height: 100vh;
        padding: 48px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 28px;
      }}
      .meta {{
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        color: var(--muted);
        font-size: 14px;
      }}
      .badge {{
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.12);
        color: var(--primary);
        font-weight: 600;
      }}
      .hero {{
        display: grid;
        gap: 24px;
        align-content: start;
      }}
      .headline {{
        display: grid;
        gap: 12px;
      }}
      h1 {{
        margin: 0;
        font-size: clamp(38px, 5vw, 64px);
        line-height: 1.08;
        letter-spacing: -0.03em;
      }}
      .goal {{
        font-size: 20px;
        color: var(--primary);
        font-weight: 600;
      }}
      .context {{
        max-width: 980px;
        padding: 22px 24px;
        border-radius: 28px;
        background: var(--panel);
        border: 1px solid var(--border);
        font-size: 20px;
        line-height: 1.7;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.07);
        white-space: pre-wrap;
      }}
      .grid {{
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
        gap: 24px;
      }}
      .card {{
        padding: 24px;
        border-radius: 28px;
        background: var(--panel);
        border: 1px solid var(--border);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.07);
      }}
      .card h2 {{
        margin: 0 0 16px;
        font-size: 18px;
        color: var(--muted);
      }}
      .reveal-list {{
        margin: 0;
        padding-left: 24px;
        display: grid;
        gap: 14px;
        font-size: 24px;
        line-height: 1.55;
      }}
      .reveal-item {{
        opacity: 0;
        transform: translateY(14px);
        transition: opacity 220ms ease, transform 220ms ease;
      }}
      .reveal-item.visible {{
        opacity: 1;
        transform: translateY(0);
      }}
      .interrupt-stack {{
        display: grid;
        gap: 12px;
      }}
      .interrupt-card {{
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(37, 99, 235, 0.08);
        border: 1px solid rgba(37, 99, 235, 0.12);
      }}
      .interrupt-type {{
        display: inline-flex;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--primary);
      }}
      .interrupt-card p {{
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }}
      .footer {{
        display: flex;
        justify-content: space-between;
        gap: 16px;
        color: var(--muted);
        font-size: 14px;
      }}
      .footer strong {{
        color: var(--text);
      }}
      @media (max-width: 960px) {{
        .stage {{ padding: 24px; }}
        .grid {{ grid-template-columns: 1fr; }}
        .context, .reveal-list {{ font-size: 18px; }}
      }}
    </style>
  </head>
  <body>
    <main class="stage">
      <header class="meta">
        <span>{deck}</span>
        <span class="badge">{visual_type}</span>
      </header>

      <section class="hero">
        <div class="headline">
          <div class="goal">{teaching_goal}</div>
          <h1>{title}</h1>
        </div>
        <div class="context">{context}</div>
        <div class="grid">
          <section class="card">
            <h2>页内动画步骤</h2>
            <ol class="reveal-list">{reveal_items_html}</ol>
          </section>
          <aside class="card">
            <h2>课堂互动提示</h2>
            <div class="interrupt-stack">
              {interrupt_cards_html or '<p style="margin:0;color:var(--muted);line-height:1.55;">当前页没有额外 interrupt，可直接继续讲解。</p>'}
            </div>
          </aside>
        </div>
      </section>

      <footer class="footer">
        <div><strong>前文：</strong>{before_context or '本页承接上一页导入。'}</div>
        <div><strong>后文：</strong>{after_context or '本页之后进入课堂收束或下一知识点。'}</div>
      </footer>
    </main>

    <script>
      (() => {{
        const items = Array.from(document.querySelectorAll(".reveal-item"));
        let step = 0;

        const sync = () => {{
          items.forEach((item, index) => {{
            if (index < step) {{
              item.classList.add("visible");
            }} else {{
              item.classList.remove("visible");
            }}
          }});
        }};

        const buildState = (advanced) => ({{
          step,
          totalSteps: items.length,
          hasMore: step < items.length,
          completed: step >= items.length,
          advanced,
        }});

        window.EduSlide = {{
          to_next() {{
            if (step < items.length) {{
              step += 1;
              sync();
              return buildState(true);
            }}
            return buildState(false);
          }},
          reset() {{
            step = 0;
            sync();
            return buildState(true);
          }},
          get_state() {{
            return buildState(false);
          }},
        }};

        sync();
      }})();
    </script>
  </body>
</html>
""".strip()
