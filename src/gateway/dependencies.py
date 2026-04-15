from __future__ import annotations

from typing import cast

from fastapi import Request

from edu_multi_agent.config import Settings
from edu_multi_agent.llm import LLMClient

from .services.run_registry import RunRegistry


def get_settings(request: Request) -> Settings:
    """Return the application settings stored on FastAPI state."""
    return cast(Settings, request.app.state.settings)


def get_run_registry(request: Request) -> RunRegistry:
    """Return the in-memory registry that tracks active workflow runs."""
    return cast(RunRegistry, request.app.state.run_registry)


def get_llm_client(request: Request) -> LLMClient:
    """Return the shared LLM client stored on FastAPI application state."""
    return cast(LLMClient, request.app.state.llm_client)
