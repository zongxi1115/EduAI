from __future__ import annotations

from pathlib import Path
from typing import Any


PROMPT_ROOT = Path(__file__).resolve().parents[1] / "prompts"


def load_prompt(name: str) -> str:
    return (PROMPT_ROOT / name).read_text(encoding="utf-8").strip()


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
