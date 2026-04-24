from __future__ import annotations

import pytest

from classroom.parser import ScriptParseError, parse_script


VALID_SCRIPT = """
今天我们讲牛顿第二定律。<on_slide>牛顿第二定律：F = ma</on_slide>
<to_next/>
它说的是合外力等于质量乘加速度。
<question><choice><prompt>下面哪个是牛二的数学形式？</prompt><option>F=mv</option><option>F=ma</option><option>F=mg</option><option>p=mv</option><answer>F=ma</answer></choice></question>
<false_intro>注意 a 是加速度而不是速度，再看一遍公式。</false_intro>
<to_next_page/>
接下来看一个例题。<on_slide>例题：已知 m 和 a，求 F</on_slide>
<to_next/>
先把数据代入公式。
""".strip()


def test_parse_script_extracts_reveals_and_quizzes() -> None:
    pages = parse_script(VALID_SCRIPT)

    assert len(pages) == 2
    assert pages[0]["idx"] == 0
    assert len(pages[0]["reveals"]) == 2
    assert pages[0]["reveals"][0] == {
        "narration": "今天我们讲牛顿第二定律。",
        "on_slide": "牛顿第二定律：F = ma",
    }
    assert pages[0]["reveals"][1] == {
        "narration": "它说的是合外力等于质量乘加速度。",
        "on_slide": None,
    }
    assert pages[0]["quizzes"] == [
        {
            "after_reveal_idx": 1,
            "payload": {
                "type": "choice",
                "question": "下面哪个是牛二的数学形式？",
                "options": ["F=mv", "F=ma", "F=mg", "p=mv"],
                "ans": "F=ma",
            },
            "false_intro": "注意 a 是加速度而不是速度，再看一遍公式。",
        }
    ]
    assert pages[0]["on_slide_summary"] == "牛顿第二定律：F = ma"
    assert pages[1]["on_slide_summary"].startswith("例题：已知 m 和 a，求 F")


def test_parse_script_rejects_nested_tags() -> None:
    bad_script = (
        "讲解开始。<on_slide>先看这里"
        '<question><fill><prompt>x</prompt><answer>y</answer></fill></question>'
        "</on_slide>"
    )

    with pytest.raises(ScriptParseError, match="Nested control tags"):
        parse_script(bad_script)


def test_parse_script_rejects_invalid_question_xml() -> None:
    bad_script = (
        "先看公式。"
        "<question><choice><prompt>哪一个对？</prompt><option>A</option><option>B</option><answer>C</answer></choice></question>"
    )

    with pytest.raises(ScriptParseError, match="must match one full <option> text"):
        parse_script(bad_script)


def test_parse_script_rejects_missing_false_intro_close() -> None:
    bad_script = (
        "先看公式。"
        "<question><fill><prompt>答案是什么？</prompt><answer>F=ma</answer></fill></question>"
        "<false_intro>再想想质量和加速度的关系"
    )

    with pytest.raises(ScriptParseError, match="Missing closing tag </false_intro>"):
        parse_script(bad_script)


def test_parse_script_rejects_empty_page() -> None:
    bad_script = "第一页内容。<to_next_page/>   "

    with pytest.raises(ScriptParseError, match="Page 1 is empty"):
        parse_script(bad_script)


def test_parse_script_accepts_xml_question_payload() -> None:
    script = (
        "先看题目。"
        "<question><fill><prompt>公式是什么？</prompt><answer>F=ma</answer></fill></question>"
    )

    pages = parse_script(script)

    assert pages[0]["quizzes"][0]["payload"] == {
        "type": "fill",
        "question": "公式是什么？",
        "ans": "F=ma",
    }


def test_parse_script_allows_chinese_punctuation_inside_xml_question_text() -> None:
    script = (
        "先看题目。"
        "<question><fill><prompt>牛顿第二定律里，F 和 a 分别表示什么？</prompt><answer>力和加速度</answer></fill></question>"
    )

    pages = parse_script(script)

    assert pages[0]["quizzes"][0]["payload"]["question"] == "牛顿第二定律里，F 和 a 分别表示什么？"


def test_parse_script_keeps_legacy_json_question_payload_compatible() -> None:
    script = (
        "兼容旧格式。"
        '<question>{"type":"fill","question":"公式是什么？","ans":"F=ma"}</question>'
    )

    pages = parse_script(script)

    assert pages[0]["quizzes"][0]["payload"]["ans"] == "F=ma"


def test_parse_script_allows_literal_less_than_in_narration() -> None:
    script = (
        r"考虑分段函数：f(x)=\begin{cases}x, & x < 1\\x^2, & x \ge 1\end{cases}"
        r"<to_next/>继续分析它在 x=1 处的左右极限。"
    )

    pages = parse_script(script)

    assert pages[0]["reveals"][0]["narration"].startswith(r"考虑分段函数：f(x)=\begin{cases}")
    assert "< 1" in pages[0]["reveals"][0]["narration"]
    assert pages[0]["reveals"][1]["narration"] == "继续分析它在 x=1 处的左右极限。"


def test_parse_script_repairs_math_symbols_inside_question_xml_text() -> None:
    script = (
        "先做一道题。"
        "<question><choice><prompt>考虑分段函数：$$"
        "f(x)=\\begin{cases} x^2, & x < 2 \\\\ 4, & x = 2 \\\\ 2x, & x > 2 \\end{cases}"
        "$$ 则极限是否存在？</prompt>"
        "<option>A. 存在，且等于4</option>"
        "<option>B. 存在，且等于2</option>"
        "<option>C. 不存在，因为左极限不等于右极限</option>"
        "<option>D. 不存在，因为函数在x=2处无定义</option>"
        "<answer>A. 存在，且等于4</answer>"
        "</choice></question>"
    )

    pages = parse_script(script)

    payload = pages[0]["quizzes"][0]["payload"]
    assert payload["type"] == "choice"
    assert "x < 2" in payload["question"]
    assert "x > 2" in payload["question"]
    assert payload["ans"] == "A. 存在，且等于4"
