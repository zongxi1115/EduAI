from __future__ import annotations

import pytest
from gateway.services.assistant import build_selection_qa_prompts
from gateway.schemas.assistant import (
    SelectionQuestionRequest,
    SelectionQuestionMessage,
)


class TestBuildSelectionQaPrompts:
    def test_basic_request(self):
        req = SelectionQuestionRequest(
            context="上下文内容",
            selection="选中内容",
            question="用户问题",
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert system_prompt
        assert user_prompt
        assert "用户问题" in user_prompt

    def test_with_history(self):
        req = SelectionQuestionRequest(
            selection="选中内容",
            question="追问",
            history=[
                SelectionQuestionMessage(role="user", content="第一个问题"),
                SelectionQuestionMessage(role="assistant", content="第一个回答"),
            ],
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert "第一个问题" in user_prompt
        assert "第一个回答" in user_prompt
        assert "追问" in user_prompt

    def test_no_selection_no_history(self):
        req = SelectionQuestionRequest(
            context="上下文内容",
            question="用户问题",
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert user_prompt
        assert "上下文内容" in user_prompt

    def test_question_language_match(self):
        req = SelectionQuestionRequest(
            selection="测试内容",
            question="什么是测试？",
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert "什么是测试" in user_prompt

    def test_turn_guidance_selection(self):
        req = SelectionQuestionRequest(
            selection="选中的内容",
            question="问题",
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert "selected content" in user_prompt.lower() or "选中的内容" in user_prompt

    def test_turn_guidance_history(self):
        req = SelectionQuestionRequest(
            question="追问",
            history=[
                SelectionQuestionMessage(role="user", content="之前的问题"),
                SelectionQuestionMessage(role="assistant", content="之前的回答"),
            ],
        )
        system_prompt, user_prompt = build_selection_qa_prompts(req)
        assert "conversation history" in user_prompt.lower()


class TestSelectionQuestionMessage:
    def test_valid_message(self):
        msg = SelectionQuestionMessage(role="user", content="问题内容")
        assert msg.role == "user"
        assert msg.content == "问题内容"

    def test_invalid_role(self):
        with pytest.raises(Exception):
            SelectionQuestionMessage(role="invalid", content="内容")

    def test_empty_content(self):
        with pytest.raises(Exception):
            SelectionQuestionMessage(role="user", content="")


class TestSelectionQuestionRequest:
    def test_question_required(self):
        with pytest.raises(Exception):
            SelectionQuestionRequest(question="")

    def test_default_fields(self):
        req = SelectionQuestionRequest(question="test question")
        assert req.question == "test question"
        assert req.selection is None
        assert req.context is None
        assert req.history == []

    def test_with_history(self):
        req = SelectionQuestionRequest(
            question="测试",
            history=[
                SelectionQuestionMessage(role="user", content="问题"),
            ],
        )
        assert len(req.history) == 1