from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from ..schemas.code_execution import (
    CodeExecutionLogLine,
    CodeExecutionRequest,
    CodeExecutionResponse,
)


RESULT_MARKER = "__EDU_CODE_RESULT__:"


def _indent_block(source: str, *, fallback: str = "pass") -> str:
    normalized = source.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if not normalized.strip():
        normalized = fallback
    return textwrap.indent(normalized, "    ")


def _build_python_script(code: str, runner_code: str) -> str:
    normalized_code = code.rstrip()
    if normalized_code:
        normalized_code += "\n\n"

    return (
        normalized_code
        + "import json\n\n"
        + f'__EDU_RESULT_MARKER = "{RESULT_MARKER}"\n\n'
        + "def __edu_emit_result(value):\n"
        + "    print(__EDU_RESULT_MARKER + json.dumps(value, ensure_ascii=False, default=repr))\n\n"
        + "def __edu_run():\n"
        + _indent_block(runner_code)
        + "\n\n"
        + 'if __name__ == "__main__":\n'
        + "    __edu_result = __edu_run()\n"
        + "    if __edu_result is not None:\n"
        + "        __edu_emit_result(__edu_result)\n"
    )


def _format_result_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, indent=2, default=repr)


def _parse_stdout(stdout: str) -> tuple[list[CodeExecutionLogLine], str | None]:
    logs: list[CodeExecutionLogLine] = []
    result_text: str | None = None

    for line in stdout.splitlines():
        if line.startswith(RESULT_MARKER):
            payload = line[len(RESULT_MARKER) :]
            try:
                result_text = _format_result_value(json.loads(payload))
            except json.JSONDecodeError:
                result_text = payload
            continue

        logs.append(CodeExecutionLogLine(type="log", text=line))

    return logs, result_text


def _stderr_to_logs(stderr: str, *, line_type: str) -> list[CodeExecutionLogLine]:
    return [
        CodeExecutionLogLine(type=line_type, text=line)
        for line in stderr.splitlines()
        if line.strip()
    ]


def execute_code(request: CodeExecutionRequest) -> CodeExecutionResponse:
    """Execute user code for supported languages and normalize the result."""
    started_at = perf_counter()

    if request.language != "python":
        duration_ms = max(1, round((perf_counter() - started_at) * 1000))
        return CodeExecutionResponse(
            ok=False,
            logs=[],
            error_text=f"暂不支持 {request.language} 在线运行。",
            duration_ms=duration_ms,
        )

    script_content = _build_python_script(request.code, request.runner_code)

    with TemporaryDirectory(prefix="edu_code_run_") as temp_dir:
        temp_path = Path(temp_dir)
        script_path = temp_path / "submission.py"
        script_path.write_text(script_content, encoding="utf-8")

        try:
            completed = subprocess.run(
                [sys.executable, "-X", "utf8", "-I", "-B", str(script_path)],
                cwd=temp_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=request.timeout_ms / 1000,
            )
        except subprocess.TimeoutExpired:
            return CodeExecutionResponse(
                ok=False,
                logs=[],
                error_text=(
                    f"Python 执行超时，已在 {request.timeout_ms / 1000:.1f} 秒后停止。"
                ),
                duration_ms=request.timeout_ms,
            )

    duration_ms = max(1, round((perf_counter() - started_at) * 1000))
    stdout_logs, result_text = _parse_stdout(completed.stdout)

    if completed.returncode == 0:
        logs = [*stdout_logs, *_stderr_to_logs(completed.stderr, line_type="warn")]
        return CodeExecutionResponse(
            ok=True,
            logs=logs,
            result_text=result_text,
            duration_ms=duration_ms,
        )

    error_text = completed.stderr.strip() or (
        f"Python 进程异常退出，退出码 {completed.returncode}。"
    )
    return CodeExecutionResponse(
        ok=False,
        logs=stdout_logs,
        error_text=error_text,
        duration_ms=duration_ms,
    )
