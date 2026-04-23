from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from typing import Any

from .state import PageSpec, Quiz, Reveal

PAGE_BREAK = "<to_next_page/>"
STEP_BREAK = "<to_next/>"
ON_SLIDE_OPEN = "<on_slide>"
ON_SLIDE_CLOSE = "</on_slide>"
QUESTION_OPEN = "<question>"
QUESTION_CLOSE = "</question>"
FALSE_INTRO_OPEN = "<false_intro>"
FALSE_INTRO_CLOSE = "</false_intro>"

CONTROL_TAG_PATTERN = re.compile(
    r"</?(?:on_slide|question|false_intro)>|<to_next\s*/>|<to_next_page\s*/>"
)
QUESTION_BLOCK_PATTERN = re.compile(r"<question>(.*?)</question>", re.DOTALL)
JSON_SYNTAX_TRANSLATION = str.maketrans(
    {
        "｛": "{",
        "｝": "}",
        "［": "[",
        "］": "]",
        "：": ":",
        "，": ",",
        "＂": '"',
        "“": '"',
        "”": '"',
        "‘": '"',
        "’": '"',
        "　": " ",
    }
)


class ScriptParseError(ValueError):
    """Raised when the tagged classroom script violates the contract."""


def parse_script(script: str) -> list[PageSpec]:
    if not isinstance(script, str) or not script.strip():
        raise ScriptParseError("Script is empty.")

    page_chunks = script.split(PAGE_BREAK)
    pages: list[PageSpec] = []
    for idx, page_text in enumerate(page_chunks):
        if not page_text.strip():
            raise ScriptParseError(f"Page {idx} is empty.")
        pages.append(parse_page(page_text, idx))
    return pages


def parse_page(page_text: str, idx: int) -> PageSpec:
    cursor = 0
    current_reveal_parts: list[str] = []
    raw_reveals: list[str] = []
    quizzes: list[Quiz] = []

    while cursor < len(page_text):
        next_tag = _find_next_control_tag(page_text, cursor)
        if next_tag == -1:
            current_reveal_parts.append(page_text[cursor:])
            cursor = len(page_text)
            break

        current_reveal_parts.append(page_text[cursor:next_tag])

        if page_text.startswith(STEP_BREAK, next_tag):
            reveal_text = "".join(current_reveal_parts).strip()
            if not reveal_text:
                raise ScriptParseError(
                    f"Page {idx} contains an empty reveal before step {len(raw_reveals)}."
                )
            raw_reveals.append(reveal_text)
            current_reveal_parts = []
            cursor = next_tag + len(STEP_BREAK)
            continue

        if page_text.startswith(ON_SLIDE_OPEN, next_tag):
            content, cursor = _consume_paired_tag(
                page_text,
                next_tag,
                tag_name="on_slide",
            )
            current_reveal_parts.append(f"{ON_SLIDE_OPEN}{content}{ON_SLIDE_CLOSE}")
            continue

        if page_text.startswith(QUESTION_OPEN, next_tag):
            payload, false_intro, cursor = _consume_question_block(page_text, next_tag)
            quizzes.append(
                {
                    "after_reveal_idx": len(raw_reveals),
                    "payload": payload,
                    "false_intro": false_intro,
                }
            )
            continue

        if page_text.startswith(FALSE_INTRO_OPEN, next_tag):
            raise ScriptParseError(
                f"Page {idx} has <false_intro> without an immediately preceding <question>."
            )

        if page_text.startswith(PAGE_BREAK, next_tag):
            raise ScriptParseError(f"Page {idx} contains an unexpected {PAGE_BREAK}.")

        raise ScriptParseError(
            f"Page {idx} contains an unknown or misplaced tag near: "
            f"{page_text[next_tag:next_tag + 32]!r}"
        )

    reveal_text = "".join(current_reveal_parts).strip()
    if not reveal_text:
        raise ScriptParseError(f"Page {idx} ends with an empty reveal.")
    raw_reveals.append(reveal_text)

    reveals = [_parse_reveal(raw_reveal, idx, reveal_idx) for reveal_idx, raw_reveal in enumerate(raw_reveals)]
    if not reveals:
        raise ScriptParseError(f"Page {idx} must contain at least one reveal.")

    on_slide_summary = _build_on_slide_summary(reveals)
    return {
        "idx": idx,
        "reveals": reveals,
        "quizzes": quizzes,
        "on_slide_summary": on_slide_summary,
    }


def validate_script(script: str) -> None:
    parse_script(script)


def normalize_script_question_payload(script: str) -> str:
    """Repair legacy JSON-style question payloads without touching XML payloads."""

    def _replace(match: re.Match[str]) -> str:
        raw_payload = match.group(1)
        if raw_payload.lstrip().startswith("<"):
            return f"{QUESTION_OPEN}{raw_payload}{QUESTION_CLOSE}"
        normalized = normalize_question_json_syntax(raw_payload)
        return f"{QUESTION_OPEN}{normalized}{QUESTION_CLOSE}"

    return QUESTION_BLOCK_PATTERN.sub(_replace, script)


def _consume_question_block(page_text: str, start_idx: int) -> tuple[dict[str, Any], str | None, int]:
    raw_payload, cursor = _consume_paired_tag(
        page_text,
        start_idx,
        tag_name="question",
    )
    payload = _parse_question_payload(raw_payload)

    false_intro: str | None = None
    false_intro_start = _skip_whitespace(page_text, cursor)
    if page_text.startswith(FALSE_INTRO_OPEN, false_intro_start):
        false_intro, cursor = _consume_paired_tag(
            page_text,
            false_intro_start,
            tag_name="false_intro",
        )
        false_intro = false_intro.strip() or None

    return payload, false_intro, cursor


def _consume_paired_tag(text: str, start_idx: int, *, tag_name: str) -> tuple[str, int]:
    open_tag = f"<{tag_name}>"
    close_tag = f"</{tag_name}>"

    if not text.startswith(open_tag, start_idx):
        raise ScriptParseError(f"Expected {open_tag} at index {start_idx}.")

    content_start = start_idx + len(open_tag)
    content_end = text.find(close_tag, content_start)
    if content_end == -1:
        raise ScriptParseError(f"Missing closing tag {close_tag}.")

    content = text[content_start:content_end]
    if CONTROL_TAG_PATTERN.search(content):
        raise ScriptParseError(
            f"Nested control tags are not allowed inside {open_tag}."
        )

    return content, content_end + len(close_tag)


def _parse_reveal(raw_reveal: str, page_idx: int, reveal_idx: int) -> Reveal:
    cursor = 0
    narration_parts: list[str] = []
    on_slide_parts: list[str] = []

    while cursor < len(raw_reveal):
        next_tag = _find_next_control_tag(raw_reveal, cursor)
        if next_tag == -1:
            narration_parts.append(raw_reveal[cursor:])
            break

        narration_parts.append(raw_reveal[cursor:next_tag])
        if raw_reveal.startswith(ON_SLIDE_OPEN, next_tag):
            content, cursor = _consume_paired_tag(
                raw_reveal,
                next_tag,
                tag_name="on_slide",
            )
            cleaned = content.strip()
            if cleaned:
                on_slide_parts.append(cleaned)
            continue

        raise ScriptParseError(
            f"Page {page_idx} reveal {reveal_idx} contains an unsupported tag."
        )

    narration = "".join(narration_parts).strip()
    on_slide = "\n".join(on_slide_parts).strip() or None
    if not narration and on_slide is None:
        raise ScriptParseError(
            f"Page {page_idx} reveal {reveal_idx} is empty after parsing."
        )
    return {
        "narration": narration,
        "on_slide": on_slide,
    }


def _parse_question_payload(raw_payload: str) -> dict[str, Any]:
    stripped = raw_payload.strip()
    if stripped.startswith("<"):
        return _parse_question_xml_payload(stripped)

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        normalized_payload = normalize_question_json_syntax(raw_payload)
        try:
            payload = json.loads(normalized_payload)
        except json.JSONDecodeError as normalized_exc:
            raise ScriptParseError(
                f"Invalid <question> JSON: {normalized_exc.msg}."
            ) from normalized_exc

    if not isinstance(payload, dict):
        raise ScriptParseError("<question> JSON must be an object.")

    question_type = payload.get("type")
    question_text = payload.get("question")
    if question_type not in {"fill", "choice"}:
        raise ScriptParseError("<question>.type must be 'fill' or 'choice'.")
    if not isinstance(question_text, str) or not question_text.strip():
        raise ScriptParseError("<question>.question must be a non-empty string.")

    if question_type == "fill":
        if set(payload.keys()) != {"type", "question", "ans"}:
            raise ScriptParseError(
                "Fill questions must contain exactly type, question, and ans."
            )
        if not isinstance(payload.get("ans"), str) or not payload["ans"].strip():
            raise ScriptParseError("Fill questions must provide a non-empty ans string.")
        return payload

    if set(payload.keys()) != {"type", "question", "options", "ans"}:
        raise ScriptParseError(
            "Choice questions must contain exactly type, question, options, and ans."
        )
    options = payload.get("options")
    answer = payload.get("ans")
    if not isinstance(options, list) or len(options) < 2:
        raise ScriptParseError("Choice questions must provide at least two options.")
    if any(not isinstance(option, str) or not option.strip() for option in options):
        raise ScriptParseError("Choice question options must all be non-empty strings.")
    if not isinstance(answer, str) or answer not in options:
        raise ScriptParseError("Choice question ans must match one full option string.")
    return payload


def _parse_question_xml_payload(raw_payload: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(raw_payload)
    except ET.ParseError as exc:
        raise ScriptParseError(f"Invalid <question> XML: {exc}.") from exc

    tag_name = _strip_xml_namespace(root.tag)
    if tag_name == "fill":
        return _parse_fill_xml(root)
    if tag_name == "choice":
        return _parse_choice_xml(root)
    raise ScriptParseError("<question> XML root must be <fill> or <choice>.")


def _parse_fill_xml(root: ET.Element) -> dict[str, Any]:
    prompt = _xml_text(root, "prompt")
    answer = _xml_text(root, "answer")
    _assert_no_extra_xml_children(root, {"prompt", "answer"})
    return {
        "type": "fill",
        "question": prompt,
        "ans": answer,
    }


def _parse_choice_xml(root: ET.Element) -> dict[str, Any]:
    prompt = _xml_text(root, "prompt")
    options = [
        _normalized_xml_node_text(child)
        for child in root
        if _strip_xml_namespace(child.tag) == "option"
    ]
    answer = _xml_text(root, "answer")
    _assert_no_extra_xml_children(root, {"prompt", "option", "answer"})
    if len(options) < 2:
        raise ScriptParseError("Choice question XML must provide at least two <option> values.")
    if any(not option for option in options):
        raise ScriptParseError("Choice question XML options must all be non-empty.")
    if answer not in options:
        raise ScriptParseError("Choice question XML <answer> must match one full <option> text.")
    return {
        "type": "choice",
        "question": prompt,
        "options": options,
        "ans": answer,
    }


def _xml_text(root: ET.Element, child_tag: str) -> str:
    matches = [child for child in root if _strip_xml_namespace(child.tag) == child_tag]
    if len(matches) != 1:
        raise ScriptParseError(f"<question> XML must contain exactly one <{child_tag}> tag.")
    text = _normalized_xml_node_text(matches[0])
    if not text:
        raise ScriptParseError(f"<question> XML <{child_tag}> must be non-empty.")
    return text


def _normalized_xml_node_text(node: ET.Element) -> str:
    return "".join(node.itertext()).strip()


def _assert_no_extra_xml_children(root: ET.Element, allowed_tags: set[str]) -> None:
    for child in root:
        tag_name = _strip_xml_namespace(child.tag)
        if tag_name not in allowed_tags:
            raise ScriptParseError(
                f"<question> XML contains unsupported tag <{tag_name}>."
            )


def _strip_xml_namespace(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def normalize_question_json_syntax(raw_payload: str) -> str:
    """Normalize common non-ASCII JSON syntax while preserving string content."""

    quote_normalized = raw_payload.translate(
        str.maketrans(
            {
                "＂": '"',
                "“": '"',
                "”": '"',
                "‘": '"',
                "’": '"',
            }
        )
    )

    result: list[str] = []
    in_string = False
    escape = False
    for char in quote_normalized:
        if in_string:
            result.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            result.append(char)
            continue

        result.append(JSON_SYNTAX_TRANSLATION.get(ord(char), char))

    return "".join(result)


def _build_on_slide_summary(reveals: list[Reveal]) -> str:
    visible_text = " ".join(
        _collapse_summary_whitespace(reveal["on_slide"])
        for reveal in reveals
        if reveal["on_slide"]
    ).strip()
    return visible_text[:80]


def _collapse_summary_whitespace(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _skip_whitespace(text: str, idx: int) -> int:
    while idx < len(text) and text[idx].isspace():
        idx += 1
    return idx


def _find_next_control_tag(text: str, start_idx: int) -> int:
    match = CONTROL_TAG_PATTERN.search(text, start_idx)
    if match is None:
        return -1
    return match.start()
