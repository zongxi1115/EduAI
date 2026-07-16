from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from edu_multi_agent.models import (
    GenerationRequest,
    KnowledgeBaseContext,
    KnowledgeBaseRetrievalHit,
)


DEFAULT_GRAPH_DATA_ROOT = Path(__file__).resolve().parents[3] / "graph_data"
DEFAULT_RAG_HIT_LIMIT = 6
SCHOOL_COURSE_GROUP_DATASET_ID = "ai_foundation_course_groups"


@dataclass(frozen=True, slots=True)
class _DatasetReference:
    dataset_id: str
    title: str
    file: str


@dataclass(frozen=True, slots=True)
class _KnowledgeNode:
    node_id: str
    title: str
    path: tuple[str, ...]
    summary: str
    content: tuple[str, ...]

    @property
    def search_text(self) -> str:
        return " ".join([self.title, self.summary, *self.path, *self.content])


def attach_school_course_knowledge_base_context(
    request: GenerationRequest,
    *,
    graph_root: Path | None = None,
    hit_limit: int = DEFAULT_RAG_HIT_LIMIT,
) -> GenerationRequest:
    """Attach graph-backed RAG context for school-course selections when available."""

    if request.knowledge_base_context is not None:
        return request

    context = request.graph_context
    if context is None:
        return request

    if not _is_school_course_selection(request):
        return request

    source_graph_id = (context.source_graph_id or "").strip()
    if not source_graph_id:
        return request

    graph_root = (graph_root or DEFAULT_GRAPH_DATA_ROOT).resolve()
    dataset = _load_dataset_reference(graph_root, source_graph_id)
    if dataset is None:
        return request

    graph_payload = _load_json(graph_root / dataset.file)
    nodes = _flatten_nodes(graph_payload.get("nodes", []))
    if not nodes:
        return request

    query = _build_query(request)
    hits = _retrieve_nodes(nodes, query, limit=hit_limit)
    if not hits:
        return request

    knowledge_context = KnowledgeBaseContext(
        source_id=dataset.dataset_id,
        source_title=dataset.title,
        query=query,
        hits=[
            KnowledgeBaseRetrievalHit(
                source_id=dataset.dataset_id,
                node_id=node.node_id,
                title=node.title,
                path=list(node.path),
                summary=node.summary,
                content=list(node.content),
                score=score,
            )
            for node, score in hits
        ],
    )
    return request.model_copy(update={"knowledge_base_context": knowledge_context})


def _is_school_course_selection(request: GenerationRequest) -> bool:
    context = request.graph_context
    if context is None:
        return False
    return (context.dataset_id or "").strip() == SCHOOL_COURSE_GROUP_DATASET_ID


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _load_dataset_reference(graph_root: Path, dataset_id: str) -> _DatasetReference | None:
    index_payload = _load_json(graph_root / "index.json")
    raw_datasets = index_payload.get("datasets", [])
    if not isinstance(raw_datasets, list):
        return None

    for raw_dataset in raw_datasets:
        if not isinstance(raw_dataset, dict):
            continue
        candidate_id = str(raw_dataset.get("id") or "").strip()
        filename = str(raw_dataset.get("file") or "").strip()
        if candidate_id != dataset_id or not filename:
            continue
        return _DatasetReference(
            dataset_id=candidate_id,
            title=str(raw_dataset.get("title") or candidate_id).strip(),
            file=filename,
        )
    return None


def _flatten_nodes(raw_nodes: Any, *, parent_path: tuple[str, ...] = ()) -> list[_KnowledgeNode]:
    if not isinstance(raw_nodes, list):
        return []

    nodes: list[_KnowledgeNode] = []
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue

        node_id = str(raw_node.get("id") or raw_node.get("title") or "").strip()
        title = str(raw_node.get("title") or node_id).strip()
        if not node_id or not title:
            continue

        path = (*parent_path, title)
        node = _KnowledgeNode(
            node_id=node_id,
            title=title,
            path=path,
            summary=_trim_text(str(raw_node.get("summary") or "").strip(), 240),
            content=tuple(_node_content_items(raw_node)),
        )
        nodes.append(node)
        nodes.extend(_flatten_nodes(raw_node.get("sub_nodes", []), parent_path=path))
    return nodes


def _node_content_items(raw_node: dict[str, Any]) -> list[str]:
    items: list[str] = []

    def push(raw_item: Any, *, prefix: str = "") -> None:
        text = str(raw_item or "").strip()
        if not text or text == "无":
            return
        items.append(_trim_text(f"{prefix}{text}", 180))

    for key in ("content", "applications", "prerequisites", "links"):
        value = raw_node.get(key)
        label = {
            "content": "",
            "applications": "应用: ",
            "prerequisites": "先修: ",
            "links": "关联: ",
        }[key]
        if isinstance(value, list):
            for item in value:
                push(item, prefix=label)
        elif isinstance(value, str):
            push(value, prefix=label)

    return _unique(items)[:8]


def _build_query(request: GenerationRequest) -> str:
    graph_context = request.graph_context
    parts = [
        request.learning_goal,
        request.subject,
        request.notes,
        graph_context.focus_node_title if graph_context is not None else "",
        graph_context.focus_node_id if graph_context is not None else "",
    ]
    return "；".join(_unique(str(part).strip() for part in parts if str(part).strip()))


def _retrieve_nodes(
    nodes: list[_KnowledgeNode],
    query: str,
    *,
    limit: int,
) -> list[tuple[_KnowledgeNode, float]]:
    scored = [
        (node, _score_node(query, node))
        for node in nodes
    ]
    scored = [(node, score) for node, score in scored if score > 0.08]
    scored.sort(key=lambda item: (-item[1], len(item[0].path), item[0].title))
    return scored[: max(1, limit)]


def _score_node(query: str, node: _KnowledgeNode) -> float:
    normalized_query = _normalize_text(query)
    normalized_title = _normalize_text(node.title)
    normalized_path = _normalize_text("".join(node.path))
    normalized_search_text = _normalize_text(node.search_text)
    if not normalized_query or not normalized_search_text:
        return 0.0

    title_score = _similarity(normalized_query, normalized_title)
    path_score = _similarity(normalized_query, normalized_path)
    search_score = _similarity(normalized_query, normalized_search_text)
    overlap_score = _char_overlap(normalized_query, normalized_search_text)
    exact_bonus = 0.0
    if normalized_title and normalized_title in normalized_query:
        exact_bonus += 0.35
    if normalized_query in normalized_search_text:
        exact_bonus += 0.2

    score = max(title_score, path_score, search_score, overlap_score) + exact_bonus
    return round(max(0.0, min(score, 1.0)), 4)


def _normalize_text(value: str) -> str:
    return re.sub(
        r"[\s\-_—–:：;；,，。.!！？?、/\\|()\[\]{}<>《》“”\"'`]+",
        "",
        (value or "").strip().lower(),
    )


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    shorter, longer = sorted((left, right), key=len)
    containment = len(shorter) / len(longer) if shorter in longer else 0.0
    return max(containment, SequenceMatcher(None, left, right).ratio())


def _char_overlap(left: str, right: str) -> float:
    left_chars = set(left)
    right_chars = set(right)
    if not left_chars or not right_chars:
        return 0.0
    return len(left_chars & right_chars) / len(left_chars)


def _trim_text(value: str, limit: int) -> str:
    text = " ".join(value.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _unique(items: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        text = str(item).strip()
        if not text or text in seen:
            continue
        result.append(text)
        seen.add(text)
    return result
