from __future__ import annotations

from ..schemas.assistant import SelectionQuestionRequest


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


def _format_history(request: SelectionQuestionRequest) -> str:
    if not request.history:
        return "(No previous conversation.)"

    lines: list[str] = []
    for message in request.history:
        speaker = "User" if message.role == "user" else "Assistant"
        lines.append(f"{speaker}: {message.content.strip()}")
    return "\n".join(lines)


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

    return SELECTION_QA_SYSTEM_PROMPT, user_prompt
