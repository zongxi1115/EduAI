from __future__ import annotations

from pathlib import Path

import pytest

from edu_multi_agent.config import Settings

from gateway.services.classroom_voice import ClassroomVoiceService


def _make_settings(tmp_path: Path, *, debug_disable_voice: bool = False) -> Settings:
    return Settings(
        base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
        output_root=tmp_path / "outputs",
        tts_base_url="https://api.xiaomimimo.com/v1",
        tts_api_key="tts-test-key",
        tts_model_name="mimo-v2.5-tts",
        tts_voice="mimo_default",
        tts_audio_format="wav",
        tts_style_prompt="请用自然的课堂讲解语气朗读。",
        debug_disable_voice=debug_disable_voice,
    )


def test_synthesize_classroom_audio_only_generates_readable_content(tmp_path: Path) -> None:
    payload = {
        "pages": [
            {
                "idx": 0,
                "reveals": [
                    {
                        "narration": "先观察这个现象。",
                        "on_slide": "牛顿第二定律",
                    },
                    {
                        "narration": "",
                        "on_slide": "F = ma",
                    },
                ],
                "quizzes": [
                    {
                        "after_reveal_idx": 0,
                        "payload": {"type": "fill", "question": "公式是什么？", "ans": "F=ma"},
                        "false_intro": "别急，我们回到力和加速度的关系再看一遍。",
                    }
                ],
                "on_slide_summary": "牛顿第二定律 F = ma",
            }
        ],
        "bundle": {
            "pages": [
                {
                    "idx": 0,
                    "html": "<section></section>",
                    "reveals": [
                        {"narration": "先观察这个现象。"},
                        {"narration": ""},
                    ],
                    "quizzes": [
                        {
                            "after_reveal_idx": 0,
                            "payload": {"type": "fill", "question": "公式是什么？", "ans": "F=ma"},
                            "false_intro": "别急，我们回到力和加速度的关系再看一遍。",
                        }
                    ],
                }
            ]
        },
    }

    service = ClassroomVoiceService(
        _make_settings(tmp_path),
        synthesize_bytes=lambda text: f"AUDIO::{text}".encode("utf-8"),
    )

    summary = service.synthesize_classroom_audio(payload, tmp_path)

    assert summary == {"generated": 2}
    assert payload["pages"][0]["reveals"][0]["audio_src"] == "voice/page_01/reveal_01.wav"
    assert payload["bundle"]["pages"][0]["reveals"][0]["audio_src"] == "voice/page_01/reveal_01.wav"
    assert payload["pages"][0]["reveals"][1].get("audio_src") is None
    assert payload["bundle"]["pages"][0]["reveals"][1].get("audio_src") is None
    assert payload["pages"][0]["quizzes"][0]["false_intro_audio_src"] == "voice/page_01/quiz_01_false_intro.wav"
    assert payload["bundle"]["pages"][0]["quizzes"][0]["false_intro_audio_src"] == "voice/page_01/quiz_01_false_intro.wav"
    assert (tmp_path / "voice" / "page_01" / "reveal_01.wav").read_bytes() == (
        "AUDIO::先观察这个现象。".encode("utf-8")
    )
    assert (tmp_path / "voice" / "page_01" / "quiz_01_false_intro.wav").read_bytes() == (
        "AUDIO::别急，我们回到力和加速度的关系再看一遍。".encode("utf-8")
    )


def test_synthesize_classroom_audio_retries_once_after_five_seconds(tmp_path: Path, monkeypatch) -> None:
    payload = {
        "pages": [
            {
                "idx": 0,
                "reveals": [{"narration": "这是要重试的旁白。", "on_slide": None}],
                "quizzes": [],
                "on_slide_summary": "",
            }
        ],
        "bundle": {
            "pages": [
                {
                    "idx": 0,
                    "html": "<section></section>",
                    "reveals": [{"narration": "这是要重试的旁白。"}],
                    "quizzes": [],
                }
            ]
        },
    }
    attempts: list[str] = []
    sleeps: list[float] = []

    def flaky_synthesizer(text: str) -> bytes:
        attempts.append(text)
        if len(attempts) == 1:
            raise RuntimeError("missing audio")
        return b"ok"

    monkeypatch.setattr("gateway.services.classroom_voice.time.sleep", lambda seconds: sleeps.append(seconds))

    service = ClassroomVoiceService(
        _make_settings(tmp_path),
        synthesize_bytes=flaky_synthesizer,
    )

    summary = service.synthesize_classroom_audio(payload, tmp_path)

    assert summary == {"generated": 1}
    assert attempts == ["这是要重试的旁白。", "这是要重试的旁白。"]
    assert sleeps == [5.0]
    assert (tmp_path / "voice" / "page_01" / "reveal_01.wav").read_bytes() == b"ok"


def test_synthesize_classroom_audio_skips_whitespace_only_text(tmp_path: Path) -> None:
    payload = {
        "pages": [
            {
                "idx": 0,
                "reveals": [{"narration": "   \n\t  ", "on_slide": "只展示，不朗读"}],
                "quizzes": [{"after_reveal_idx": 0, "payload": {"type": "fill"}, "false_intro": "   "}],
                "on_slide_summary": "只展示，不朗读",
            }
        ],
        "bundle": {
            "pages": [
                {
                    "idx": 0,
                    "html": "<section></section>",
                    "reveals": [{"narration": "   "}],
                    "quizzes": [{"after_reveal_idx": 0, "payload": {"type": "fill"}, "false_intro": " "}],
                }
            ]
        },
    }
    calls: list[str] = []

    service = ClassroomVoiceService(
        _make_settings(tmp_path),
        synthesize_bytes=lambda text: calls.append(text) or b"unused",
    )

    summary = service.synthesize_classroom_audio(payload, tmp_path)

    assert summary == {"generated": 0}
    assert calls == []
    assert not (tmp_path / "voice").exists()
