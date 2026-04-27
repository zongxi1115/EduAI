from __future__ import annotations

from ..state import ClassState


def assemble_script_node(state: ClassState) -> dict[str, str]:
    page_blueprints = state.get("page_blueprints") or []
    page_scripts = state.get("page_scripts") or {}

    ordered_scripts: list[str] = []
    for blueprint in sorted(page_blueprints, key=lambda item: item["idx"]):
        idx = blueprint["idx"]
        page_script = page_scripts.get(idx)
        if not isinstance(page_script, str) or not page_script.strip():
            raise ValueError(f"Missing page script for page {idx}.")
        ordered_scripts.append(page_script.strip())

    if not ordered_scripts:
        raise ValueError("assemble_script_node requires at least one page script.")

    return {"script": "\n<to_next_page/>\n".join(ordered_scripts)}
