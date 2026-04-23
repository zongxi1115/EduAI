from __future__ import annotations

from typing import Any, cast

from fastapi import Request

from edu_multi_agent.config import Settings
from edu_multi_agent.llm import LLMClient

from .services.classroom_tasks import ClassroomTaskRegistry
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


def get_classroom_outline_agent(request: Request) -> Any | None:
    """Return the optional classroom outline agent when the app configured one."""
    return getattr(request.app.state, "classroom_outline_agent", None)


def get_classroom_task_registry(request: Request) -> ClassroomTaskRegistry:
    """Return the classroom task registry stored on FastAPI state."""
    return cast(ClassroomTaskRegistry, request.app.state.classroom_task_registry)
