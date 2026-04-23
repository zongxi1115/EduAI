from __future__ import annotations

from ..state import ClassState, ClassroomBundle, ClassroomPageBundle


def assemble_node(state: ClassState) -> dict[str, ClassroomBundle]:
    pages = state.get("pages") or []
    htmls = state.get("htmls") or {}

    bundle_pages: list[ClassroomPageBundle] = []
    for page in sorted(pages, key=lambda item: item["idx"]):
        idx = page["idx"]
        if idx not in htmls:
            raise ValueError(f"Missing HTML for page {idx}.")
        bundle_pages.append(
            {
                "idx": idx,
                "html": htmls[idx],
                "reveals": [{"narration": reveal["narration"]} for reveal in page["reveals"]],
                "quizzes": page["quizzes"],
            }
        )

    return {"assembled": {"pages": bundle_pages}}
