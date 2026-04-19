from __future__ import annotations

import pytest
from gateway.services.code_execution import (
    _build_python_script,
    _format_result_value,
    _parse_stdout,
    _indent_block,
)
from gateway.schemas.code_execution import (
    CodeExecutionRequest,
)


class TestIndentBlock:
    def test_empty_returns_fallback(self):
        result = _indent_block("")
        assert result == "    pass"

    def test_whitespace_only_returns_fallback(self):
        result = _indent_block("   \n\t  ")
        assert result == "    pass"

    def test_simple_code_indented(self):
        result = _indent_block("x = 1")
        assert result == "    x = 1"

    def test_multiline_code_indented(self):
        code = "x = 1\ny = 2"
        result = _indent_block(code)
        assert result == "    x = 1\n    y = 2"

    def test_existing_indent_preserved(self):
        code = "def foo():\n    return 1"
        result = _indent_block(code)
        assert result == "    def foo():\n        return 1"


class TestBuildPythonScript:
    def test_empty_code_uses_fallback(self):
        result = _build_python_script("", "result = 1")
        assert "__EDU_RESULT_MARKER" in result
        assert "__edu_run" in result

    def test_code_appended(self):
        result = _build_python_script("x = 1", "result = x")
        assert "x = 1" in result
        assert "result = x" in result

    def test_result_emission(self):
        result = _build_python_script("x = 1", "result = x")
        assert '__edu_emit_result' in result
        assert '__EDU_RESULT_MARKER' in result


class TestFormatResultValue:
    def test_none_returns_none(self):
        assert _format_result_value(None) is None

    def test_string_returns_unchanged(self):
        assert _format_result_value("hello") == "hello"

    def test_int_converts_to_string(self):
        assert _format_result_value(42) == "42"

    def test_float_converts_to_string(self):
        assert _format_result_value(3.14) == "3.14"

    def test_bool_true(self):
        assert _format_result_value(True) == "True"

    def test_bool_false(self):
        assert _format_result_value(False) == "False"

    def test_list_json_dumped(self):
        result = _format_result_value([1, 2, 3])
        assert "1" in result and "2" in result and "3" in result

    def test_dict_json_dumped(self):
        result = _format_result_value({"a": 1})
        assert '"a"' in result


class TestParseStdout:
    def test_no_result_marker_returns_all_logs(self):
        stdout = "hello\nworld"
        logs, result = _parse_stdout(stdout)
        assert result is None
        assert len(logs) == 2
        assert logs[0].text == "hello"
        assert logs[1].text == "world"

    def test_result_marker_extracted(self):
        stdout = 'print("hello")\n__EDU_CODE_RESULT__:"test"'
        logs, result = _parse_stdout(stdout)
        assert result == "test"
        assert len(logs) == 1

    def test_result_marker_with_json(self):
        stdout = '__EDU_CODE_RESULT__:{"ok":true}'
        logs, result = _parse_stdout(stdout)
        assert result is not None
        assert "ok" in result

    def test_invalid_json_after_marker(self):
        stdout = "__EDU_CODE_RESULT__:not json"
        logs, result = _parse_stdout(stdout)
        assert result == "not json"

    def test_empty_stdout(self):
        logs, result = _parse_stdout("")
        assert result is None
        assert len(logs) == 0


class TestCodeExecutionRequest:
    def test_default_timeout(self):
        req = CodeExecutionRequest(language="python", code="print(1)")
        assert req.timeout_ms == 5000

    def test_custom_timeout(self):
        req = CodeExecutionRequest(language="python", code="print(1)", timeout_ms=1000)
        assert req.timeout_ms == 1000

    def test_language_required(self):
        with pytest.raises(Exception):
            CodeExecutionRequest(code="print(1)")

    def test_runner_code_default(self):
        req = CodeExecutionRequest(language="python", code="print(1)")
        assert req.runner_code == ""

    def test_runner_code_used(self):
        req = CodeExecutionRequest(language="python", code="x = 1", runner_code="result = x + 1")
        assert req.runner_code == "result = x + 1"