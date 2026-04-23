from __future__ import annotations

from ..parser import parse_script
from ..state import ClassState, PageSpec


def split_node(state: ClassState) -> dict[str, list[PageSpec]]:
    script = state.get("script")
    if not isinstance(script, str) or not script.strip():
        raise ValueError("SplitNode requires a non-empty script.")
    return {"pages": parse_script(script)}
