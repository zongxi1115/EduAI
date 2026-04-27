from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from html import escape
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import (
    append_jsonl_file,
    create_run_directory,
    now_iso,
    write_json_file,
    write_text_file,
)
from edu_multi_agent.llm import LLMClient

from ..schemas.classroom import ClassroomGenerateRequest
from ..schemas.prep_runs import RunStatus
from .classroom import run_classroom_workflow
from .classroom_voice import ClassroomVoiceService


logger = logging.getLogger(__name__)

CLASSROOM_RUNS_DIRNAME = "classroom_runs"
REQUEST_FILENAME = "request.json"
RESULT_FILENAME = "result.json"
EVENTS_FILENAME = "events.jsonl"
HTML_PREVIEW_DIRNAME = "html_preview"
SCRIPT_PREVIEW_FILENAME = "script_preview.txt"


@dataclass(slots=True)
class ClassroomTaskSession:
    run_id: str
    request: ClassroomGenerateRequest
    output_dir: Path
    created_at: str
    status: RunStatus = RunStatus.queued
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    current_node: str | None = None
    latest_summary: str | None = None
    final_result: dict[str, Any] | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    condition: threading.Condition = field(default_factory=threading.Condition, repr=False)

    def wait_for_events(self, after_index: int, timeout: float) -> list[dict[str, Any]]:
        with self.condition:
            self.condition.wait_for(
                lambda: (
                    any(int(event["index"]) > after_index for event in self.events)
                    or self.status in {RunStatus.succeeded, RunStatus.failed}
                ),
                timeout=timeout,
            )
            return [event for event in self.events if int(event["index"]) > after_index]


class ClassroomTaskRegistry:
    def __init__(
        self,
        settings: Settings,
        llm_client: LLMClient,
        outline_agent: Any | None = None,
    ) -> None:
        self.settings = settings
        self.llm_client = llm_client
        self.outline_agent = outline_agent
        self.output_root = (settings.output_root / CLASSROOM_RUNS_DIRNAME).resolve()
        self.voice_service = ClassroomVoiceService(settings)
        self._sessions: dict[str, ClassroomTaskSession] = {}
        self._lock = threading.Lock()

    def create_run(self, request: ClassroomGenerateRequest) -> ClassroomTaskSession:
        output_dir = create_run_directory(self.output_root, request.topic)
        session = ClassroomTaskSession(
            run_id=output_dir.name,
            request=request,
            output_dir=output_dir,
            created_at=now_iso(),
        )
        write_json_file(output_dir, REQUEST_FILENAME, request.model_dump(mode="json"))

        with self._lock:
            self._sessions[session.run_id] = session

        self._append_event(
            session,
            {
                "event": "run_created",
                "node": "api",
                "phase": "orchestration",
                "summary": "AI 课堂任务已创建，等待执行。",
                "data": {
                    "request": request.model_dump(mode="json"),
                    "output_dir": str(output_dir),
                },
            },
        )

        worker = threading.Thread(
            target=self._run_session,
            args=(session,),
            daemon=True,
            name=f"classroom-run-{session.run_id}",
        )
        worker.start()
        return session

    def get_session(self, run_id: str) -> ClassroomTaskSession | None:
        with self._lock:
            return self._sessions.get(run_id)

    def list_session_ids(self) -> list[str]:
        with self._lock:
            return list(self._sessions.keys())

    def resolve_run_dir(self, run_id: str) -> Path:
        session = self.get_session(run_id)
        if session is not None:
            return session.output_dir

        candidate = (self.output_root / run_id).resolve()
        if not candidate.is_relative_to(self.output_root.resolve()):
            raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")
        if candidate.is_dir():
            return candidate
        raise HTTPException(status_code=404, detail=f"Unknown run_id: {run_id}")

    def _run_session(self, session: ClassroomTaskSession) -> None:
        try:
            self._append_event(
                session,
                {
                    "event": "workflow_started",
                    "node": "workflow",
                    "phase": "workflow",
                    "summary": "AI 课堂生成任务开始执行。",
                },
            )
            result = run_classroom_workflow(
                session.request,
                self.llm_client,
                self.outline_agent,
                event_callback=lambda event: self._append_event(session, event),
            )
            payload = result.model_dump(mode="json")
            if self.voice_service.enabled:
                self._append_event(
                    session,
                    {
                        "event": "voice_started",
                        "node": "voice",
                        "phase": "voice_generation",
                        "summary": "开始生成课堂语音。",
                    },
                )
                try:
                    voice_summary = self.voice_service.synthesize_classroom_audio(
                        payload,
                        session.output_dir,
                    )
                except Exception as exc:
                    self._append_event(
                        session,
                        {
                            "event": "voice_failed",
                            "node": "voice",
                            "phase": "voice_generation",
                            "summary": "课堂语音生成失败。",
                            "data": {"error": str(exc)},
                        },
                    )
                    logger.warning("Voice synthesis failed for run %s: %s; continuing to save slides.", session.run_id, exc)
                else:
                    self._append_event(
                        session,
                        {
                            "event": "voice_completed",
                            "node": "voice",
                            "phase": "voice_generation",
                            "summary": f"课堂语音已生成，共 {voice_summary['generated']} 段。",
                            "data": voice_summary,
                        },
                    )
            else:
                self._append_event(
                    session,
                    {
                        "event": "voice_skipped",
                        "node": "voice",
                        "phase": "voice_generation",
                        "summary": "已跳过课堂语音生成（DEBUG_DISABLE_VOICE=true）。",
                        "data": {"debug_disable_voice": True},
                    },
                )
            write_json_file(session.output_dir, RESULT_FILENAME, payload)
            write_classroom_preview_files(session.output_dir, payload)
            with session.condition:
                session.final_result = payload
            self._append_event(
                session,
                {
                    "event": "workflow_completed",
                    "node": "workflow",
                    "phase": "workflow",
                    "summary": "AI 课堂生成任务已完成。",
                    "data": {
                        "page_count": payload.get("page_count"),
                    },
                },
            )
        except Exception as exc:
            logger.exception("Classroom run %s failed.", session.run_id)
            self._append_event(
                session,
                {
                    "event": "workflow_failed",
                    "node": "workflow",
                    "phase": "workflow",
                    "summary": "AI 课堂生成任务失败。",
                    "data": {"error": str(exc)},
                },
            )

    def _append_event(self, session: ClassroomTaskSession, event: dict[str, Any]) -> None:
        with session.condition:
            index = len(session.events)
            enriched = {
                "index": index,
                "timestamp": event.get("timestamp") or now_iso(),
                **event,
            }
            self._apply_event_to_session(session, enriched)
            _write_incremental_preview_files(session.output_dir, enriched)
            enriched["run_id"] = session.run_id
            enriched["run_status"] = session.status
            session.events.append(enriched)
            append_jsonl_file(session.output_dir, EVENTS_FILENAME, enriched)
            session.condition.notify_all()

    @staticmethod
    def _apply_event_to_session(session: ClassroomTaskSession, event: dict[str, Any]) -> None:
        event_name = event.get("event")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}

        session.current_node = str(event.get("node") or "") or session.current_node
        session.latest_summary = str(event.get("summary") or "") or session.latest_summary

        if event_name == "workflow_started":
            session.status = RunStatus.running
            session.started_at = str(event.get("timestamp") or now_iso())
        elif event_name == "workflow_completed":
            session.status = RunStatus.succeeded
            session.finished_at = str(event.get("timestamp") or now_iso())
        elif event_name == "workflow_failed":
            session.status = RunStatus.failed
            session.finished_at = str(event.get("timestamp") or now_iso())
            session.error = str(data.get("error") or event.get("summary") or "Workflow failed.")


def load_json_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl_file(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def build_run_view_from_session(session: ClassroomTaskSession) -> dict[str, Any]:
    with session.condition:
        return {
            "run_id": session.run_id,
            "status": session.status,
            "created_at": session.created_at,
            "started_at": session.started_at,
            "finished_at": session.finished_at,
            "output_dir": str(session.output_dir),
            "request": session.request.model_dump(mode="json"),
            "current_node": session.current_node,
            "latest_summary": session.latest_summary,
            "error": session.error,
            "result": session.final_result,
        }


def build_run_view_from_disk(registry: ClassroomTaskRegistry, run_id: str) -> dict[str, Any]:
    output_dir = registry.resolve_run_dir(run_id)
    request_payload = load_json_file(output_dir / REQUEST_FILENAME)
    result_payload = load_json_file(output_dir / RESULT_FILENAME)
    events = load_jsonl_file(output_dir / EVENTS_FILENAME)

    terminal_event = next(
        (event for event in reversed(events) if event.get("event") in {"workflow_completed", "workflow_failed"}),
        None,
    )
    if terminal_event is None:
        status = RunStatus.unknown
    elif terminal_event.get("event") == "workflow_completed":
        status = RunStatus.succeeded
    else:
        status = RunStatus.failed

    latest_event = events[-1] if events else {}
    return {
        "run_id": run_id,
        "status": status,
        "created_at": events[0].get("timestamp") if events else None,
        "started_at": next((event.get("timestamp") for event in events if event.get("event") == "workflow_started"), None),
        "finished_at": terminal_event.get("timestamp") if terminal_event else None,
        "output_dir": str(output_dir),
        "request": request_payload,
        "current_node": latest_event.get("node"),
        "latest_summary": latest_event.get("summary"),
        "error": ((terminal_event or {}).get("data") or {}).get("error") if terminal_event else None,
        "result": result_payload,
    }


def load_run_view(registry: ClassroomTaskRegistry, run_id: str) -> dict[str, Any]:
    session = registry.get_session(run_id)
    if session is not None:
        return build_run_view_from_session(session)
    return build_run_view_from_disk(registry, run_id)


def load_stored_events(registry: ClassroomTaskRegistry, run_id: str) -> list[dict[str, Any]]:
    run_dir = registry.resolve_run_dir(run_id)
    return load_jsonl_file(run_dir / EVENTS_FILENAME)


def write_classroom_preview_files(output_dir: Path, result_payload: dict[str, Any]) -> None:
    bundle = result_payload.get("bundle")
    script = result_payload.get("script")
    if isinstance(script, str) and script.strip():
        write_text_file(output_dir, SCRIPT_PREVIEW_FILENAME, script)

    if not isinstance(bundle, dict):
        return
    pages = bundle.get("pages")
    if not isinstance(pages, list) or not pages:
        return

    blueprint_by_idx: dict[int, dict[str, Any]] = {}
    for item in result_payload.get("page_blueprints") or []:
        if isinstance(item, dict) and isinstance(item.get("idx"), int):
            blueprint_by_idx[int(item["idx"])] = item

    links: list[str] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        idx = page.get("idx")
        html = page.get("html")
        if not isinstance(idx, int) or not isinstance(html, str):
            continue

        page_title = _resolve_page_title(idx, blueprint_by_idx)
        filename = f"page_{idx + 1:02d}.html"
        relative_path = f"{HTML_PREVIEW_DIRNAME}/{filename}"
        write_text_file(
            output_dir,
            relative_path,
            _render_preview_html(
                idx=idx,
                page_title=page_title,
                section_html=html,
            ),
        )
        links.append(
            f'<li><a href="./{escape(filename)}">第 {idx + 1} 页：{escape(page_title)}</a></li>'
        )

    if links:
        write_text_file(
            output_dir,
            f"{HTML_PREVIEW_DIRNAME}/index.html",
            _render_preview_index(result_payload.get("topic"), links),
        )


def _write_incremental_preview_files(output_dir: Path, event: dict[str, Any]) -> None:
    if event.get("event") != "node_completed":
        return

    data = event.get("data")
    if not isinstance(data, dict):
        return

    if event.get("node") == "assemble_script":
        script = data.get("script")
        if isinstance(script, str) and script.strip():
            write_text_file(output_dir, SCRIPT_PREVIEW_FILENAME, script)
        return

    if event.get("node") != "slide":
        return

    idx = data.get("page_idx")
    html = data.get("html")
    if not isinstance(idx, int) or not isinstance(html, str) or not html.strip():
        return

    page_blueprint = data.get("page_blueprint") if isinstance(data.get("page_blueprint"), dict) else {}
    page_title = _resolve_page_title(idx, {idx: page_blueprint} if page_blueprint else {})
    filename = f"page_{idx + 1:02d}.html"
    write_text_file(
        output_dir,
        f"{HTML_PREVIEW_DIRNAME}/{filename}",
        _render_preview_html(
            idx=idx,
            page_title=page_title,
            section_html=html,
        ),
    )


def _resolve_page_title(idx: int, blueprint_by_idx: dict[int, dict[str, Any]]) -> str:
    blueprint = blueprint_by_idx.get(idx) or {}
    theme = blueprint.get("theme")
    if isinstance(theme, str) and theme.strip():
        return theme.strip()
    return f"Page {idx + 1}"


def _render_preview_html(*, idx: int, page_title: str, section_html: str) -> str:
    safe_title = escape(page_title)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>课堂预览 - 第 {idx + 1} 页 - {safe_title}</title>
    <script>
      window.MathJax = {{
        tex: {{
          inlineMath: {{ '[+]': [['$', '$']] }},
          displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
        }},
        options: {{
          skipHtmlTags: {{ '[-]': ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }}
        }}
      }};
    </script>
    <script defer src="https://cdn.jsdelivr.net/npm/mathjax@4/tex-chtml.js"></script>
    <style>
      :root {{
        color-scheme: light;
        --bg: #e8edf4;
        --fg: #13202f;
        --panel: rgba(255, 255, 255, 0.8);
        --line: rgba(19, 32, 47, 0.14);
      }}

      * {{
        box-sizing: border-box;
      }}

      body {{
        margin: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(23, 71, 181, 0.12), transparent 38%),
          linear-gradient(180deg, #f6f8fb 0%, var(--bg) 100%);
        color: var(--fg);
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }}

      .preview-stage {{
        position: relative;
        width: 100vw;
        height: 100vh;
      }}

      .preview-stage > section.card {{
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        aspect-ratio: auto !important;
      }}

      .preview-chip {{
        position: fixed;
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        backdrop-filter: blur(14px);
        box-shadow: 0 12px 28px rgba(18, 40, 73, 0.08);
      }}

      .preview-chip.top {{
        top: 16px;
        left: 16px;
      }}

      .preview-chip.bottom {{
        right: 16px;
        bottom: 16px;
      }}

      .preview-chip strong {{
        font-size: 0.9rem;
      }}

      .preview-chip span {{
        font-size: 0.8rem;
        opacity: 0.72;
      }}
    </style>
  </head>
  <body>
    <div class="preview-chip top">
      <strong>第 {idx + 1} 页</strong>
      <span>{safe_title}</span>
    </div>
    <div class="preview-chip bottom">
      <strong>→</strong>
      <span>按右方向键继续</span>
    </div>
    <div class="preview-stage">
{section_html}
    </div>
    <script>
      document.addEventListener("keydown", function (event) {{
        if (event.key !== "ArrowRight") return;
        if (typeof window.to_next !== "function") return;
        event.preventDefault();
        const advanced = window.to_next();
        if (advanced && window.MathJax && typeof window.MathJax.typesetPromise === "function") {{
          window.MathJax.typesetPromise().catch(function () {{}});
        }}
      }});
    </script>
  </body>
</html>
"""


def _render_preview_index(topic: Any, links: list[str]) -> str:
    safe_topic = escape(str(topic or "课堂预览"))
    link_markup = "\n".join(links)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{safe_topic} - HTML Preview</title>
    <style>
      body {{
        margin: 0;
        min-height: 100vh;
        padding: 40px 24px;
        background: #f4f7fb;
        color: #142032;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }}

      .wrap {{
        width: min(100%, 860px);
        margin: 0 auto;
        padding: 28px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 18px 48px rgba(18, 40, 73, 0.08);
      }}

      h1 {{
        margin: 0 0 8px;
        font-size: 1.6rem;
      }}

      p {{
        margin: 0 0 20px;
        color: rgba(20, 32, 50, 0.72);
      }}

      ul {{
        margin: 0;
        padding-left: 20px;
      }}

      li + li {{
        margin-top: 10px;
      }}

      a {{
        color: #1747b5;
        text-decoration: none;
      }}

      a:hover {{
        text-decoration: underline;
      }}
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>{safe_topic}</h1>
      <p>下面是本次 AI 课堂任务输出的可直接打开的 HTML 预览页面。</p>
      <ul>
{link_markup}
      </ul>
    </main>
  </body>
</html>
"""
