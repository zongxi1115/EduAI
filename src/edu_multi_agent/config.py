from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _env_flag(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    base_url: str
    api_key: str
    model_name: str
    output_root: Path
    temperature: float = 0.2
    request_timeout_seconds: int = 180
    support_vision: bool = False
    tts_base_url: str = ""
    tts_api_key: str = ""
    tts_model_name: str = ""
    tts_voice: str = "mimo_default"
    tts_audio_format: str = "wav"
    tts_style_prompt: str = (
        "请用自然、亲切、清晰的中文课堂讲解语气朗读，节奏平稳，重点适度强调。"
    )
    tts_max_workers: int = 4
    debug_disable_voice: bool = True

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
        support_vision = _env_flag("SUPPORT_VISION", False)
        tts_base_url = os.getenv("TTS_BASE_URL", "").strip()
        tts_api_key = os.getenv("TTS_API_KEY", "").strip()
        tts_model_name = os.getenv("TTS_MODEL_NAME", "").strip()
        tts_voice = os.getenv("TTS_VOICE", "mimo_default").strip() or "mimo_default"
        tts_audio_format = os.getenv("TTS_AUDIO_FORMAT", "wav").strip() or "wav"
        tts_style_prompt = (
            os.getenv(
                "TTS_STYLE_PROMPT",
                "请用自然、亲切、清晰的中文课堂讲解语气朗读，节奏平稳，重点适度强调。",
            ).strip()
            or "请用自然、亲切、清晰的中文课堂讲解语气朗读，节奏平稳，重点适度强调。"
        )
        tts_max_workers = max(1, int(os.getenv("TTS_MAX_WORKERS", "4")))
        debug_disable_voice = _env_flag("DEBUG_DISABLE_VOICE", True)

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
            support_vision=support_vision,
            tts_base_url=tts_base_url,
            tts_api_key=tts_api_key,
            tts_model_name=tts_model_name,
            tts_voice=tts_voice,
            tts_audio_format=tts_audio_format,
            tts_style_prompt=tts_style_prompt,
            tts_max_workers=tts_max_workers,
            debug_disable_voice=debug_disable_voice,
        )
