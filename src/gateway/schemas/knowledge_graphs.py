from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class KnowledgeGraphPayload(BaseModel):
    """A single knowledge graph document loaded from disk."""

    nodes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Top-level graph nodes.",
    )
    edges: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Top-level graph edges.",
    )


class KnowledgeGraphDataset(BaseModel):
    """A knowledge graph dataset defined in graph_data/index.json."""

    id: str = Field(description="Stable dataset identifier.")
    title: str = Field(description="Human-readable dataset title.")
    file: str = Field(description="Source JSON filename under graph_data/.")
    entry_points: list[str] = Field(
        default_factory=list,
        description="Recommended entry topics for this dataset.",
    )
    graph: KnowledgeGraphPayload = Field(description="The loaded graph payload.")


class KnowledgeGraphIndexResponse(BaseModel):
    """The full index plus resolved datasets returned to the frontend."""

    schema_version: str = Field(description="Index schema version.")
    description: str = Field(description="Short description of the dataset collection.")
    datasets: list[KnowledgeGraphDataset] = Field(
        default_factory=list,
        description="Resolved knowledge graph datasets.",
    )
