from __future__ import annotations

from ..schemas.assistant import (
    AskQuestionRequest,
    AssistantRenderTarget,
    AssistantResponseMode,
    SelectionQuestionRequest,
)


ASK_SYSTEM_PROMPT = """
You are an AI study assistant embedded in an education workspace.
Answer the user's question clearly and helpfully.

Grounding rules:
- If context is provided, treat it as the primary source.
- If conversation history exists, use it to resolve follow-ups and references.
- If the provided material is insufficient, say so directly and explain what is missing.
- Do not invent facts, references, or quotes that are not supported by the provided material.

Style rules:
- Use the same language as the user's question unless the user explicitly asks otherwise.
- Prefer short paragraphs or flat bullets when they improve readability.
""".strip()


SELECTION_QA_SYSTEM_PROMPT = """
You are an inline AI study assistant embedded in an education workspace.
Answer the user's question about the selected content.

Grounding rules:
- If selected text is provided for this turn, treat it as the primary source.
- If selected text is not provided for this turn but conversation history exists, use the conversation history as the primary source.
- If neither selected text nor conversation history is provided, use the optional surrounding context when available.
- If the provided text is insufficient, say so directly and explain what is missing.
- Do not invent facts, references, or quotes that are not supported by the provided text.

Style rules:
- Be clear, concise, and helpful.
- Use the same language as the user's question unless the user explicitly asks otherwise.
- Prefer short paragraphs or flat bullets when they improve readability.
""".strip()


def _format_mode_instructions(
    mode: AssistantResponseMode,
    render_target: AssistantRenderTarget,
) -> str:
    if mode == "html" and render_target == "artifact":
        return """
Output mode: html artifact
- Start with one concise Markdown sentence that can stand alone in the chat.
- Then immediately open exactly one artifact block unless the user explicitly asks for text-only output:
  <edu-html-artifact title="Short descriptive title">
  <!doctype html>
  <html lang="zh-CN">...</html>
  </edu-html-artifact>
- The artifact must be a complete single-file HTML document with inline <style> and, when useful, inline <script>.
- Keep the artifact self-contained: no external CSS, fonts, images, scripts, fetch/XHR/WebSocket, or network-loaded resources.
- The artifact may use JavaScript for local interactions such as sliders, toggles, drawing, animation, canvas, SVG updates, or simple calculators.
- Do not use the reserved <edu-html-artifact> tag anywhere except as the wrapper.
- Keep the chat answer brief; put dense visual or interactive material in the artifact.
""".strip()

    if mode == "html":
        return """
Output mode: html
- You may mix Markdown and raw HTML fragments when HTML materially improves explanation, structure, comparison, spatial reasoning, or visualization.
- Return fragments suitable for embedding inside a chat message. Do not return a full document with <!doctype>, <html>, <head>, or <body>.
- Keep HTML static and safe: no <script>, event handler attributes, iframes, forms, external assets, navigation, or network-loaded resources.
- Prefer semantic HTML such as <section>, <figure>, <figcaption>, <table>, <details>, <summary>, <mark>, and simple inline <svg> diagrams.
- Use inline styles only when they make the visual annotation clearer, and keep them compact.
- Keep ordinary explanation in Markdown where Markdown is enough.
""".strip()

    return """
Output mode: markdown
- Return Markdown text only.
- Do not include raw HTML unless the user explicitly asks for HTML in this turn.
""".strip()


def _format_history(request: AskQuestionRequest | SelectionQuestionRequest) -> str:
    if not request.history:
        return "(No previous conversation.)"

    lines: list[str] = []
    for message in request.history:
        speaker = "User" if message.role == "user" else "Assistant"
        lines.append(f"{speaker}: {message.content.strip()}")
    return "\n".join(lines)


def build_ask_prompts(request: AskQuestionRequest) -> tuple[str, str]:
    """Build the prompts for the generic AI Ask assistant."""
    context = (request.context or "").strip()
    has_context = bool(context)
    has_history = any(message.content.strip() for message in request.history)
    context_block = context if context else "(No additional context provided.)"
    history_block = _format_history(request)
    if has_context:
        turn_guidance = (
            "For this turn, answer primarily from the provided context and use general knowledge only when it is clearly needed."
        )
    elif has_history:
        turn_guidance = (
            "For this turn, answer from the conversation history and the user's current question."
        )
    else:
        turn_guidance = (
            "For this turn, only the user's current question is available."
        )

    user_prompt = f"""
Answer the user's question based on the provided material.

Turn guidance:
{turn_guidance}

Conversation history:
{history_block}

User question:
{request.question}

Optional context:
{context_block}

Response requirements:
- Answer the question directly.
- Explain any reasoning briefly when helpful.
- If the answer depends on an assumption, label it clearly.
- If the information is not sufficient, state that and suggest what extra context would help.
- When the user is asking a follow-up question, resolve references like "it", "this", or "then" using the history.
""".strip()

    system_prompt = "\n\n".join(
        [
            ASK_SYSTEM_PROMPT,
            _format_mode_instructions(request.mode, request.render_target),
        ]
    )
    return system_prompt, user_prompt


def build_selection_qa_prompts(request: SelectionQuestionRequest) -> tuple[str, str]:
    """Build the prompts for the selected-content Q&A assistant."""
    context = (request.context or "").strip()
    selection = (request.selection or "").strip()
    has_selection = bool(selection)
    has_history = any(message.content.strip() for message in request.history)
    has_context = bool(context)
    context_block = context if context else "(No additional context provided.)"
    history_block = _format_history(request)
    selection_block = selection if selection else "(No selected content provided for this turn.)"
    if has_selection:
        turn_guidance = (
            "For this turn, answer primarily from the selected content and use the optional context only as support."
        )
    elif has_history:
        turn_guidance = (
            "For this turn, do not assume you still have direct access to the original selected content. "
            "Answer from the conversation history and the user's current follow-up."
        )
    elif has_context:
        turn_guidance = (
            "For this turn, answer from the optional surrounding context because no selected content or conversation history was provided."
        )
    else:
        turn_guidance = (
            "For this turn, only the user's current question is available. If the question lacks enough information, say so directly."
        )

    user_prompt = f"""
Answer the user's follow-up question based on the provided material.

Turn guidance:
{turn_guidance}

Conversation history:
{history_block}

User question:
{request.question}

Selected content for this turn:
{selection_block}

Optional surrounding context:
{context_block}

Response requirements:
- Answer the question directly.
- Explain any reasoning briefly when helpful.
- If the answer depends on an assumption, label it clearly.
- If the information is not sufficient, state that and suggest what extra context would help.
- When the user is asking a follow-up question, resolve references like "it", "this", or "then" using the history.
- If the user asks what they previously said, what they asked, or what you were asked to remember, answer strictly from the conversation history.
""".strip()

    system_prompt = "\n\n".join(
        [
            SELECTION_QA_SYSTEM_PROMPT,
            _format_mode_instructions(request.mode, request.render_target),
        ]
    )
    return system_prompt, user_prompt
