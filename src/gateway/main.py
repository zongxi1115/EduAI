from __future__ import annotations

import argparse
import logging

from .app import create_app


logger = logging.getLogger(__name__)


def configure_logging() -> None:
    """Configure basic logging for local gateway development."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser for running the API gateway."""
    parser = argparse.ArgumentParser(description="Run the Edu Multi-Agent FastAPI gateway.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host.")
    parser.add_argument("--port", type=int, default=8000, help="Bind port.")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for local development.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the FastAPI gateway with uvicorn."""
    configure_logging()
    parser = build_parser()
    args = parser.parse_args(argv)

    import uvicorn

    uvicorn.run(
        "gateway.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
    return 0


app = create_app()
