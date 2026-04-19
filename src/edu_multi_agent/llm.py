from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from .config import Settings
from .file_io import ParsedBundle, parse_tagged_bundle


ModelT = TypeVar("ModelT", bound=BaseModel)


def _flatten_content(
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


def _extract_json(raw_text: str) -> str:
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


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self.model = ChatOpenAI(
            model=settings.model_name,
            api_key=settings.api_key,
            base_url=settings.base_url,
            temperature=settings.temperature,
            timeout=settings.request_timeout_seconds,
        )

    def invoke_text(self, system_prompt: str, user_prompt: Any) -> str:
        response = self.model.invoke(
            [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
        )
        return _flatten_content(response.content)

    async def stream_text(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> AsyncIterator[str]:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        async for chunk in self.model.astream(messages):
            text = _flatten_content(chunk.content, strip=False, separator="")
            if text:
                yield text

    def invoke_json(
        self,
        system_prompt: str,
        user_prompt: Any,
        schema: type[ModelT],
        *,
        max_attempts: int = 3,
    ) -> ModelT:
        feedback = ""
        last_error: Exception | None = None
        for _ in range(max_attempts):
            raw_text = self.invoke_text(
                system_prompt,
                self._append_feedback_to_prompt(user_prompt, feedback),
            )
            try:
                payload = json.loads(_extract_json(raw_text))
                return schema.model_validate(payload)
            except Exception as exc:
                last_error = exc
                feedback = (
                    "\n\nYour previous output was invalid. Return only one valid JSON "
                    f"object that matches the requested schema. Error: {exc}"
                )

        raise RuntimeError(f"Failed to parse JSON output: {last_error}") from last_error

    @staticmethod
    def _append_feedback_to_prompt(user_prompt: Any, feedback: str) -> Any:
        if not feedback:
            return user_prompt
        if isinstance(user_prompt, str):
            return user_prompt + feedback
        if isinstance(user_prompt, list):
            return [
                *user_prompt,
                {
                    "type": "text",
                    "text": feedback.strip(),
                },
            ]
        return user_prompt

    def invoke_bundle(
        self,
        system_prompt: str,
        user_prompt: str,
        required_files: tuple[str, ...] | list[str],
        *,
        max_attempts: int = 3,
    ) -> ParsedBundle:
        feedback = ""
        last_error: Exception | None = None
        for _ in range(max_attempts):
            raw_text = self.invoke_text(system_prompt, user_prompt + feedback)
            try:
                return parse_tagged_bundle(raw_text, required_files)
            except Exception as exc:
                last_error = exc
                feedback = (
                    "\n\nYour previous output did not match the required tag format. "
                    "Return the output again using the exact tags and exact filenames. "
                    f"Error: {exc}"
                )

        raise RuntimeError(
            f"Failed to parse tagged bundle output: {last_error}"
        ) from last_error
