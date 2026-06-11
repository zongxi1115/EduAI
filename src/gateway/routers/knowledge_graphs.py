from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from edu_multi_agent.config import PROJECT_ROOT

from ..schemas.knowledge_graphs import (
    KnowledgeGraphDataset,
    KnowledgeGraphIndexResponse,
    KnowledgeGraphPayload,
)


router = APIRouter(prefix="/api/knowledge-graphs", tags=["知识图谱"])

GRAPH_DATA_ROOT = PROJECT_ROOT / "graph_data"
INDEX_PATH = GRAPH_DATA_ROOT / "index.json"


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Graph file not found: {path.name}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON in graph file: {path.name}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail=f"Graph file must contain a JSON object: {path.name}")
    return payload


@router.get(
    "",
    response_model=KnowledgeGraphIndexResponse,
    summary="获取知识图谱列表与内容",
    response_description="返回图谱索引及其对应的完整图谱内容。",
)
def list_knowledge_graphs() -> KnowledgeGraphIndexResponse:
    """Load the graph index and resolve every referenced graph JSON file."""
    index_payload = _load_json(INDEX_PATH)
    raw_datasets = index_payload.get("datasets", [])

    if not isinstance(raw_datasets, list):
        raise HTTPException(status_code=500, detail="graph_data/index.json field 'datasets' must be a JSON array.")

    datasets: list[KnowledgeGraphDataset] = []
    for item in raw_datasets:
        if not isinstance(item, dict):
            raise HTTPException(status_code=500, detail="Each dataset entry in graph_data/index.json must be a JSON object.")

        filename = str(item.get("file", "")).strip()
        if not filename:
            raise HTTPException(status_code=500, detail="Each dataset entry must include a non-empty 'file' field.")

        graph_payload = _load_json(GRAPH_DATA_ROOT / filename)
        datasets.append(
            KnowledgeGraphDataset(
                id=str(item.get("id", "")).strip(),
                title=str(item.get("title", "")).strip(),
                file=filename,
                entry_points=[
                    str(entry)
                    for entry in item.get("entry_points", [])
                    if isinstance(entry, str) and entry.strip()
                ],
                graph=KnowledgeGraphPayload(
                    nodes=[
                        node for node in graph_payload.get("nodes", [])
                        if isinstance(node, dict)
                    ],
                    edges=[
                        edge for edge in graph_payload.get("edges", [])
                        if isinstance(edge, dict)
                    ],
                ),
            )
        )

    return KnowledgeGraphIndexResponse(
        schema_version=str(index_payload.get("schema_version", "1.0")),
        description=str(index_payload.get("description", "")).strip(),
        datasets=datasets,
    )
