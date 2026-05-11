from __future__ import annotations

import json
import pytest
from pathlib import Path
from gateway.services.prep_runs import (
    encode_sse,
    safe_path_within,
    build_links,
    relative_path,
    load_json_file,
    load_jsonl_file,
    list_run_views,
    _RUN_ID_RE,
)
from gateway.schemas.prep_runs import (
    RunLinks,
    RunStatus,
)
from fastapi import HTTPException


class TestEncodeSse:
    def test_basic_event(self):
        result = encode_sse("test", {"key": "value"}, event_id=1)
        assert "event: test" in result
        assert "id: 1" in result
        assert '"key"' in result

    def test_no_event_id(self):
        result = encode_sse("test", {"key": "value"})
        assert "event: test" in result
        assert "id:" not in result

    def test_complex_payload(self):
        payload = {"run_id": "test123", "status": "running"}
        result = encode_sse("status", payload, event_id=5)
        assert "test123" in result
        assert "running" in result
        assert "id: 5" in result


class TestSafePathWithin:
    def test_valid_path(self, tmp_path):
        test_file = tmp_path / "test.txt"
        test_file.write_text("content")
        result = safe_path_within(tmp_path, "test.txt")
        assert result == test_file

    def test_subdirectory(self, tmp_path):
        sub = tmp_path / "sub"
        sub.mkdir()
        test_file = sub / "test.txt"
        test_file.write_text("content")
        result = safe_path_within(tmp_path, "sub/test.txt")
        assert result == test_file

    def test_escape_attempt(self, tmp_path):
        with pytest.raises(HTTPException):
            safe_path_within(tmp_path, "../outside.txt")

    def test_absolute_path(self, tmp_path):
        with pytest.raises(HTTPException):
            safe_path_within(tmp_path, "/etc/passwd")

    def test_nonexistent_file(self, tmp_path):
        with pytest.raises(HTTPException):
            safe_path_within(tmp_path, "nonexistent.txt")


class TestBuildLinks:
    def test_basic_links(self):
        links = build_links("test_run_123")
        assert "/api/v1/prep-runs/test_run_123" in links.status
        assert "/api/v1/prep-runs/test_run_123/events" in links.events
        assert "/api/v1/prep-runs/test_run_123/artifacts" in links.artifacts
        assert "/api/v1/prep-runs/test_run_123/bundle" in links.bundle

    def test_run_id_in_all_links(self):
        links = build_links("run_abc")
        for link in [links.status, links.events, links.artifacts, links.bundle]:
            assert "run_abc" in link


class TestRelativePath:
    def test_simple_relative(self, tmp_path):
        sub_path = tmp_path / "subdir" / "file.txt"
        sub_path.parent.mkdir(parents=True)
        sub_path.write_text("test")
        result = relative_path(tmp_path, sub_path)
        assert "subdir" in result
        assert "file.txt" in result


class TestLoadJsonFile:
    def test_load_existing(self, tmp_path):
        test_file = tmp_path / "test.json"
        test_file.write_text('{"key": "value"}')
        result = load_json_file(test_file)
        assert result is not None
        assert result["key"] == "value"

    def test_nonexistent(self, tmp_path):
        result = load_json_file(tmp_path / "nonexistent.json")
        assert result is None


class TestLoadJsonlFile:
    def test_valid_jsonl(self, tmp_path):
        test_file = tmp_path / "test.jsonl"
        test_file.write_text('{"a": 1}\n{"b": 2}\n')
        result = load_jsonl_file(test_file)
        assert len(result) == 2

    def test_with_blank_lines(self, tmp_path):
        test_file = tmp_path / "test.jsonl"
        test_file.write_text('{"a": 1}\n\n{"b": 2}\n\n')
        result = load_jsonl_file(test_file)
        assert len(result) == 2

    def test_empty_file(self, tmp_path):
        test_file = tmp_path / "empty.jsonl"
        test_file.write_text("")
        result = load_jsonl_file(test_file)
        assert result == []


class TestRunStatus:
    def test_all_statuses(self):
        assert RunStatus.queued.value == "queued"
        assert RunStatus.running.value == "running"
        assert RunStatus.succeeded.value == "succeeded"
        assert RunStatus.failed.value == "failed"
        assert RunStatus.unknown.value == "unknown"


class TestRunIdPattern:
    """Verify the regex that guards which disk directories are treated as run directories."""

    def test_valid_run_id(self):
        assert _RUN_ID_RE.match("20260416_103000_quadratic-functions")

    def test_valid_run_id_minimal_slug(self):
        assert _RUN_ID_RE.match("20260101_000000_a")

    def test_invalid_no_timestamp(self):
        assert not _RUN_ID_RE.match("quadratic-functions")

    def test_invalid_partial_timestamp(self):
        assert not _RUN_ID_RE.match("20260416_quadratic")

    def test_invalid_only_timestamp(self):
        # Missing slug part after second underscore
        assert not _RUN_ID_RE.match("20260416_103000")

    def test_invalid_non_numeric_date(self):
        assert not _RUN_ID_RE.match("2026AB16_103000_slug")

    def test_invalid_random_folder(self):
        assert not _RUN_ID_RE.match("some-random-folder")

    def test_invalid_dotgit(self):
        assert not _RUN_ID_RE.match(".git")


class TestListRunViewsFiltersIrrelevantDirs:
    """list_run_views must ignore directories that do not match the run-ID naming pattern."""

    def test_irrelevant_directories_are_excluded(self, tmp_path):
        from unittest.mock import MagicMock
        from edu_multi_agent.config import Settings

        # Create directories: one valid run dir and two irrelevant dirs
        valid_run = tmp_path / "20260416_103000_quadratic-functions"
        valid_run.mkdir()
        irrelevant1 = tmp_path / "some-random-folder"
        irrelevant1.mkdir()
        irrelevant2 = tmp_path / "classroom_outputs"
        irrelevant2.mkdir()

        settings = MagicMock(spec=Settings)
        settings.output_root = tmp_path

        registry = MagicMock()
        registry.list_session_ids.return_value = []
        registry.get_session.return_value = None

        views = list_run_views(registry, settings)

        # The valid run dir is loaded (with status=unknown because it has no files).
        # The two irrelevant dirs must NOT appear in the results.
        returned_ids = [v["run_id"] for v in views]
        assert "some-random-folder" not in returned_ids
        assert "classroom_outputs" not in returned_ids
        # The valid run directory is the only one attempted
        assert "20260416_103000_quadratic-functions" in returned_ids

        # Confirm the irrelevant directory names were never sent to get_session
        called_ids = [call.args[0] for call in registry.get_session.call_args_list]
        assert "some-random-folder" not in called_ids
        assert "classroom_outputs" not in called_ids