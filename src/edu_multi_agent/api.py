"""Backward-compatible import path for the FastAPI gateway entrypoint."""

from gateway.app import create_app
from gateway.main import app, main

__all__ = ["app", "create_app", "main"]
