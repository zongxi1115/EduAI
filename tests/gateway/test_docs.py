from __future__ import annotations

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


def test_scalar_docs_page_uses_namespaced_openapi_url(tmp_path: Path) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    client = TestClient(app)

    response = client.get("/api/scalar")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert 'id="api-reference"' in response.text
    assert 'data-url="/api/openapi.json"' in response.text
    assert "@scalar/api-reference" in response.text


def test_scalar_legacy_path_redirects_to_namespaced_route(tmp_path: Path) -> None:
    app = create_app(settings=_make_settings(tmp_path), llm_client=DummyLLMClient())
    client = TestClient(app)

    response = client.get("/scalar", follow_redirects=False)

    assert response.status_code in {302, 307}
    assert response.headers["location"] == "/api/scalar"
