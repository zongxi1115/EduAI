from __future__ import annotations

import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar


PROMPT_ROOT = Path(__file__).resolve().parents[1] / "prompts"
SLIDE_PROMPT_NAME_RE = re.compile(r"^slide(?:[._-].+)?\.md$", re.IGNORECASE)
RetryResultT = TypeVar("RetryResultT")
RETRYABLE_LLM_ERROR_MARKERS = (
    "apiconnectionerror",
    "connection error",
    "request timed out",
    "timed out",
    "timeout",
    "502",
    "bad gateway",
    "upstream_error",
    "temporarily unavailable",
    "connection reset",
)


def normalize_prompt_name(name: str) -> str:
    if not isinstance(name, str):
        raise ValueError("Prompt file name must be a string.")

    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Prompt file name cannot be empty.")

    prompt_path = Path(cleaned)
    if prompt_path.is_absolute() or prompt_path.name != cleaned or len(prompt_path.parts) != 1:
        raise ValueError("Prompt file name must be a single file name inside src/classroom/prompts.")
    if prompt_path.suffix.lower() != ".md":
        raise ValueError("Prompt file name must end with .md.")

    return cleaned


def resolve_prompt_path(name: str) -> Path:
    return PROMPT_ROOT / normalize_prompt_name(name)


def prompt_exists(name: str) -> bool:
    return resolve_prompt_path(name).is_file()


def is_slide_prompt_name(name: str) -> bool:
    try:
        normalized = normalize_prompt_name(name)
    except ValueError:
        return False
    return bool(SLIDE_PROMPT_NAME_RE.fullmatch(normalized))


def validate_slide_prompt_name(name: str) -> str:
    normalized = normalize_prompt_name(name)
    if not SLIDE_PROMPT_NAME_RE.fullmatch(normalized):
        raise ValueError(
            "slide_prompt_file must be `slide.md` or a slide variant such as `slide.creative.md`."
        )
    if not resolve_prompt_path(normalized).is_file():
        raise ValueError(f"Slide prompt file '{normalized}' was not found in src/classroom/prompts.")
    return normalized


def list_slide_prompt_names() -> list[str]:
    names = [
        path.name
        for path in PROMPT_ROOT.glob("slide*.md")
        if path.is_file() and is_slide_prompt_name(path.name)
    ]
    return sorted(set(names), key=lambda item: (0 if item == "slide.md" else 1, item.lower()))


def load_prompt(name: str) -> str:
    return resolve_prompt_path(name).read_text(encoding="utf-8").strip()


def is_retryable_llm_exception(exc: Exception) -> bool:
    message = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in message for marker in RETRYABLE_LLM_ERROR_MARKERS)


def invoke_llm_with_retry(
    invoke: Callable[[], RetryResultT],
    *,
    max_retries: int = 3,
    delay_seconds: float = 1.5,
) -> RetryResultT:
    for attempt_no in range(max_retries + 1):
        try:
            return invoke()
        except Exception as exc:
            if attempt_no >= max_retries or not is_retryable_llm_exception(exc):
                raise
            time.sleep(delay_seconds * (2**attempt_no))

    raise RuntimeError("LLM retry loop exited unexpectedly.")


def flatten_content(
    content: Any,
    *,
    strip: bool = True,
    separator: str = "\n",
) -> str:
    if isinstance(content, str):
        return content.strip() if strip else content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or ""
                if text:
                    parts.append(str(text))
        if strip:
            return separator.join(part.strip() for part in parts if part).strip()
        return separator.join(part for part in parts if part)
    text = str(content)
    return text.strip() if strip else text


def extract_json_object(raw_text: str) -> str:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Could not find a JSON object in model output.")
    return text[start : end + 1]
