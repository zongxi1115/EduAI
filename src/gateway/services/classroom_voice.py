from __future__ import annotations

import base64
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx

from edu_multi_agent.config import Settings

VOICE_RETRY_DELAY_SECONDS = 5.0
VOICE_MAX_ATTEMPTS = 2


class ClassroomVoiceSynthesisError(RuntimeError):
    """Raised when classroom narration cannot be synthesized into audio."""


@dataclass(slots=True)
class VoiceJob:
    description: str
    text: str
    relative_path: str
    field_name: str
    targets: list[dict[str, Any]]


class ClassroomVoiceService:
    def __init__(
        self,
        settings: Settings,
        *,
        http_client: httpx.Client | None = None,
        synthesize_bytes: Callable[[str], bytes] | None = None,
    ) -> None:
        self.settings = settings
        self._http_client = http_client
        self._synthesize_bytes = synthesize_bytes or self._request_audio_bytes

    @property
    def enabled(self) -> bool:
        return not self.settings.debug_disable_voice

    def synthesize_classroom_audio(
        self,
        result_payload: dict[str, Any],
        output_dir: Path,
    ) -> dict[str, int]:
        if not self.enabled:
            return {"generated": 0}

        self._validate_config()
        jobs = _build_voice_jobs(result_payload, self.settings.tts_audio_format)
        if not jobs:
            return {"generated": 0}

        max_workers = min(self.settings.tts_max_workers, len(jobs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(self._synthesize_job_with_retry, job): job
                for job in jobs
            }
            for future in as_completed(future_map):
                job = future_map[future]
                try:
                    audio_bytes = future.result()
                except Exception as exc:  # pragma: no cover - wrapped below
                    raise ClassroomVoiceSynthesisError(
                        f"{job.description} 语音生成失败：{exc}"
                    ) from exc

                target_path = output_dir / job.relative_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(audio_bytes)

                normalized_path = job.relative_path.replace("\\", "/")
                for target in job.targets:
                    target[job.field_name] = normalized_path

        return {"generated": len(jobs)}

    def _synthesize_job_with_retry(self, job: VoiceJob) -> bytes:
        last_error: Exception | None = None
        for attempt in range(1, VOICE_MAX_ATTEMPTS + 1):
            try:
                audio_bytes = self._synthesize_bytes(job.text)
                if not audio_bytes:
                    raise ClassroomVoiceSynthesisError("返回了空音频字节。")
                return audio_bytes
            except Exception as exc:
                last_error = exc
                if attempt >= VOICE_MAX_ATTEMPTS:
                    break
                time.sleep(VOICE_RETRY_DELAY_SECONDS)

        raise ClassroomVoiceSynthesisError(
            f"{job.description} 在 {VOICE_MAX_ATTEMPTS} 次尝试后仍然失败：{last_error}"
        ) from last_error

    def _validate_config(self) -> None:
        missing = [
            name
            for name, value in (
                ("TTS_BASE_URL", self.settings.tts_base_url),
                ("TTS_API_KEY", self.settings.tts_api_key),
                ("TTS_MODEL_NAME", self.settings.tts_model_name),
            )
            if not value
        ]
        if missing:
            raise ClassroomVoiceSynthesisError(
                "语音功能已启用，但缺少环境变量：" + ", ".join(missing)
            )

    def _request_audio_bytes(self, text: str) -> bytes:
        response = self._client.post(
            "chat/completions",
            json=self._build_payload(text),
        )
        response.raise_for_status()

        try:
            payload = response.json()
            audio_data = payload["choices"][0]["message"]["audio"]["data"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ClassroomVoiceSynthesisError(
                "小米 MIMO TTS 返回结果中缺少音频数据。"
            ) from exc

        if not isinstance(audio_data, str) or not audio_data.strip():
            raise ClassroomVoiceSynthesisError("小米 MIMO TTS 返回了空音频数据。")

        try:
            return base64.b64decode(audio_data)
        except ValueError as exc:
            raise ClassroomVoiceSynthesisError("小米 MIMO TTS 音频数据不是合法的 Base64。") from exc

    @property
    def _client(self) -> httpx.Client:
        if self._http_client is None:
            self._http_client = httpx.Client(
                base_url=self.settings.tts_base_url.rstrip("/"),
                headers={
                    "api-key": self.settings.tts_api_key,
                    "Content-Type": "application/json",
                },
                timeout=self.settings.request_timeout_seconds,
            )
        return self._http_client

    def _build_payload(self, text: str) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        style_prompt = self.settings.tts_style_prompt.strip()
        if style_prompt:
            messages.append({"role": "user", "content": style_prompt})
        messages.append({"role": "assistant", "content": text})

        audio_payload: dict[str, Any] = {
            "format": self.settings.tts_audio_format,
        }
        if self.settings.tts_voice.strip():
            audio_payload["voice"] = self.settings.tts_voice.strip()

        return {
            "model": self.settings.tts_model_name,
            "messages": messages,
            "audio": audio_payload,
        }


def _build_voice_jobs(
    result_payload: dict[str, Any],
    audio_format: str,
) -> list[VoiceJob]:
    pages = result_payload.get("pages")
    bundle = result_payload.get("bundle")
    if not isinstance(pages, list) or not isinstance(bundle, dict):
        return []

    bundle_pages_raw = bundle.get("pages")
    bundle_pages: dict[int, dict[str, Any]] = {}
    if isinstance(bundle_pages_raw, list):
        for item in bundle_pages_raw:
            if isinstance(item, dict) and isinstance(item.get("idx"), int):
                bundle_pages[int(item["idx"])] = item

    normalized_ext = (audio_format or "wav").strip().lower() or "wav"
    jobs: list[VoiceJob] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_idx = page.get("idx")
        if not isinstance(page_idx, int):
            continue

        bundle_page = bundle_pages.get(page_idx) or {}
        page_reveals = page.get("reveals")
        bundle_reveals = bundle_page.get("reveals")
        if isinstance(page_reveals, list):
            jobs.extend(
                _build_reveal_jobs(
                    page_idx=page_idx,
                    page_reveals=page_reveals,
                    bundle_reveals=bundle_reveals if isinstance(bundle_reveals, list) else [],
                    extension=normalized_ext,
                )
            )

        page_quizzes = page.get("quizzes")
        bundle_quizzes = bundle_page.get("quizzes")
        if isinstance(page_quizzes, list):
            jobs.extend(
                _build_false_intro_jobs(
                    page_idx=page_idx,
                    page_quizzes=page_quizzes,
                    bundle_quizzes=bundle_quizzes if isinstance(bundle_quizzes, list) else [],
                    extension=normalized_ext,
                )
            )

    return jobs


def _build_reveal_jobs(
    *,
    page_idx: int,
    page_reveals: list[Any],
    bundle_reveals: list[Any],
    extension: str,
) -> list[VoiceJob]:
    jobs: list[VoiceJob] = []
    for reveal_idx, reveal in enumerate(page_reveals):
        if not isinstance(reveal, dict):
            continue
        narration = _normalize_voice_text(reveal.get("narration"))
        if not narration:
            continue

        targets = [reveal]
        if reveal_idx < len(bundle_reveals) and isinstance(bundle_reveals[reveal_idx], dict):
            targets.append(bundle_reveals[reveal_idx])

        jobs.append(
            VoiceJob(
                description=f"第 {page_idx + 1} 页第 {reveal_idx + 1} 段旁白",
                text=narration,
                relative_path=f"voice/page_{page_idx + 1:02d}/reveal_{reveal_idx + 1:02d}.{extension}",
                field_name="audio_src",
                targets=targets,
            )
        )
    return jobs


def _build_false_intro_jobs(
    *,
    page_idx: int,
    page_quizzes: list[Any],
    bundle_quizzes: list[Any],
    extension: str,
) -> list[VoiceJob]:
    jobs: list[VoiceJob] = []
    for quiz_idx, quiz in enumerate(page_quizzes):
        if not isinstance(quiz, dict):
            continue
        false_intro = _normalize_voice_text(quiz.get("false_intro"))
        if not false_intro:
            continue

        targets = [quiz]
        if quiz_idx < len(bundle_quizzes) and isinstance(bundle_quizzes[quiz_idx], dict):
            targets.append(bundle_quizzes[quiz_idx])

        jobs.append(
            VoiceJob(
                description=f"第 {page_idx + 1} 页第 {quiz_idx + 1} 个题目补讲",
                text=false_intro,
                relative_path=f"voice/page_{page_idx + 1:02d}/quiz_{quiz_idx + 1:02d}_false_intro.{extension}",
                field_name="false_intro_audio_src",
                targets=targets,
            )
        )
    return jobs


def _normalize_voice_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()
