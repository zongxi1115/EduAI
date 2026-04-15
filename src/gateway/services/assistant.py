from __future__ import annotations

from ..schemas.assistant import SelectionQuestionRequest


SELECTION_QA_SYSTEM_PROMPT = """
You are an inline AI study assistant embedded in an education workspace.
Answer the user's question about the selected content.

Grounding rules:
- Treat the selected text as the primary source.
- Use the optional surrounding context only to clarify or disambiguate.
- If the provided text is insufficient, say so directly and explain what is missing.
- Do not invent facts, references, or quotes that are not supported by the provided text.

Style rules:
- Be clear, concise, and helpful.
- Use the same language as the user's question unless the user explicitly asks otherwise.
- Prefer short paragraphs or flat bullets when they improve readability.
""".strip()


def build_selection_qa_prompts(request: SelectionQuestionRequest) -> tuple[str, str]:
    """Build the prompts for the selected-content Q&A assistant."""
    context = (request.context or "").strip()
    context_block = context if context else "(No additional context provided.)"

    user_prompt = f"""
Answer the user's follow-up question based on the provided material.

User question:
{request.question}

Selected content:
{request.selection}

Optional surrounding context:
{context_block}

Response requirements:
- Answer the question directly.
- Explain any reasoning briefly when helpful.
- If the answer depends on an assumption, label it clearly.
- If the information is not sufficient, state that and suggest what extra context would help.
""".strip()

    return SELECTION_QA_SYSTEM_PROMPT, user_prompt
