from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .config import Settings
from .file_io import (
    create_run_directory,
)
from .models import GenerationRequest
from .runtime import run_generation


logger = logging.getLogger(__name__)


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the LangGraph teaching-preparation multi-agent workflow."
    )
    parser.add_argument("goal", nargs="?", help="Learning goal for the workflow.")
    parser.add_argument(
        "--goal", dest="goal_option", help="Learning goal for the workflow."
    )
    parser.add_argument("--subject", default="General", help="Subject name.")
    parser.add_argument(
        "--grade-level", default="Unspecified", help="Grade level or phase."
    )
    parser.add_argument(
        "--learner-profile",
        default=(
            "Mixed-ability class that needs clear scaffolding, visual support, "
            "and structured practice."
        ),
        help="Short learner profile.",
    )
    parser.add_argument("--notes", default="None", help="Extra teacher notes.")
    parser.add_argument(
        "--output-root",
        default="",
        help="Optional output root. Defaults to OUTPUT_ROOT in .env or ./outputs.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = build_parser()
    args = parser.parse_args(argv)

    goal = (args.goal_option or args.goal or "").strip()
    if not goal:
        parser.error("A learning goal is required. Use --goal or a positional goal.")

    settings = Settings.from_env()
    output_root = Path(args.output_root).resolve() if args.output_root else settings.output_root
    output_dir = create_run_directory(output_root, goal)

    request = GenerationRequest(
        learning_goal=goal,
        subject=args.subject,
        grade_level=args.grade_level,
        learner_profile=args.learner_profile,
        notes=args.notes,
    )

    result = run_generation(request, settings, output_dir)
    report_path = result.report_path or (output_dir / "00_supervisor" / "final_report.md")
    print(f"Output directory: {output_dir}")
    print(f"Supervisor report: {report_path}")
    print(f"LangGraph log: {output_dir / '00_supervisor' / 'langgraph_events.jsonl'}")
    return 0
