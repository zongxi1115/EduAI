from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from edu_multi_agent.config import Settings

from gateway.app import create_app


class DummyLLMClient:
    def __init__(self) -> None:
        self.model = object()


def _make_settings(tmp_path: Path) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
    )


def test_list_knowledge_graphs_returns_index_and_resolved_graphs(tmp_path: Path, monkeypatch) -> None:
    graph_root = tmp_path / "graph_data"
    graph_root.mkdir(parents=True, exist_ok=True)

    (graph_root / "index.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "description": "测试图谱索引",
                "datasets": [
                    {
                        "id": "algebra",
                        "title": "代数",
                        "file": "algebra.json",
                        "entry_points": ["集合"],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (graph_root / "algebra.json").write_text(
        json.dumps(
            {
                "nodes": [{"id": "n1", "title": "集合"}],
                "edges": [{"source": "n1", "target": "n1"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("gateway.routers.knowledge_graphs.GRAPH_DATA_ROOT", graph_root)
    monkeypatch.setattr("gateway.routers.knowledge_graphs.INDEX_PATH", graph_root / "index.json")

    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    client = TestClient(app)

    response = client.get("/api/knowledge-graphs")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.0"
    assert payload["description"] == "测试图谱索引"
    assert len(payload["datasets"]) == 1
    assert payload["datasets"][0]["id"] == "algebra"
    assert payload["datasets"][0]["graph"]["nodes"][0]["title"] == "集合"
