from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(slots=True)
class Settings:
    base_url: str
    api_key: str
    model_name: str
    output_root: Path
    temperature: float = 0.2
    request_timeout_seconds: int = 180

    @classmethod
    def from_env(cls, env_path: str | None = None) -> "Settings":
        load_dotenv(env_path)

        base_url = os.getenv("BASE_URL", "").strip()
        api_key = os.getenv("API_KEY", "").strip()
        model_name = os.getenv("MODEL_NAME", "").strip()
        output_root_raw = os.getenv("OUTPUT_ROOT", "outputs").strip() or "outputs"
        output_root_path = Path(output_root_raw)
        if output_root_path.is_absolute():
            output_root = output_root_path.resolve()
        else:
            output_root = (PROJECT_ROOT / output_root_path).resolve()
        temperature = float(os.getenv("TEMPERATURE", "0.2"))
        request_timeout_seconds = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "180"))

        missing = [
            name
            for name, value in (
                ("BASE_URL", base_url),
                ("API_KEY", api_key),
                ("MODEL_NAME", model_name),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                "Missing required environment variables: " + ", ".join(missing)
            )

        return cls(
            base_url=base_url,
            api_key=api_key,
            model_name=model_name,
            output_root=output_root,
            temperature=temperature,
            request_timeout_seconds=request_timeout_seconds,
        )
