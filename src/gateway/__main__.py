"""Command-line entrypoint for ``python -m gateway``."""

from .main import main


if __name__ == "__main__":
    raise SystemExit(main())
