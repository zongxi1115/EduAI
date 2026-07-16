from __future__ import annotations

import json
from pathlib import Path

from edu_multi_agent.models import GenerationRequest, LearningGraphContext, PreparationPlan
from edu_multi_agent.prompts import build_study_guide_prompts
from gateway.services.knowledge_base import attach_school_course_knowledge_base_context


def _write_school_course_graph_fixture(tmp_path: Path) -> Path:
    graph_root = tmp_path / "graph_data"
    graph_root.mkdir(parents=True, exist_ok=True)
    (graph_root / "index.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "datasets": [
                    {
                        "id": "ai_foundation_course_groups",
                        "title": "人工智能基础课程群",
                        "file": "course_groups.json",
                    },
                    {
                        "id": "high_math",
                        "title": "高等数学",
                        "file": "high_math.json",
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (graph_root / "course_groups.json").write_text(
        json.dumps({"nodes": [], "edges": []}, ensure_ascii=False),
        encoding="utf-8",
    )
    (graph_root / "high_math.json").write_text(
        json.dumps(
            {
                "nodes": [
                    {
                        "id": "函数、极限与连续",
                        "title": "函数、极限与连续",
                        "summary": "高等数学连续分析的入口模块。",
                        "sub_nodes": [
                            {
                                "id": "函数、极限与连续::导数定义",
                                "title": "导数定义",
                                "summary": "用差商极限刻画函数在一点的瞬时变化率。",
                                "content": [
                                    "差商极限",
                                    "瞬时变化率",
                                    "几何意义是切线斜率",
                                ],
                                "prerequisites": ["函数极限", "连续性"],
                            },
                            {
                                "id": "函数、极限与连续::积分概念",
                                "title": "积分概念",
                                "summary": "从累积量理解定积分。",
                            },
                        ],
                    }
                ],
                "edges": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return graph_root


def test_attaches_rag_context_for_school_course_with_source_graph(tmp_path: Path) -> None:
    graph_root = _write_school_course_graph_fixture(tmp_path)
    request = GenerationRequest(
        learning_goal="学习高等数学中的：导数定义",
        subject="数学基础课程群",
        grade_level="大学与成人",
        notes="课程：高等数学；知识点：导数定义",
        graph_context=LearningGraphContext(
            dataset_id="ai_foundation_course_groups",
            course_group_id="数学基础课程群",
            course_id="数学基础课程群::高等数学",
            focus_node_id="数学基础课程群::高等数学",
            focus_node_title="导数定义",
            source_graph_id="high_math",
        ),
    )

    enriched = attach_school_course_knowledge_base_context(request, graph_root=graph_root)

    assert enriched.knowledge_base_context is not None
    assert enriched.knowledge_base_context.tool_name == "knowledge_base_rag_search"
    assert enriched.knowledge_base_context.source_id == "high_math"
    assert enriched.knowledge_base_context.hits
    assert enriched.knowledge_base_context.hits[0].title == "导数定义"
    assert "差商极限" in " ".join(enriched.knowledge_base_context.hits[0].content)


def test_skips_rag_context_when_school_course_has_no_source_graph(tmp_path: Path) -> None:
    graph_root = _write_school_course_graph_fixture(tmp_path)
    request = GenerationRequest(
        learning_goal="学习高等数学中的：导数定义",
        subject="数学基础课程群",
        graph_context=LearningGraphContext(
            dataset_id="ai_foundation_course_groups",
            focus_node_title="导数定义",
        ),
    )

    enriched = attach_school_course_knowledge_base_context(request, graph_root=graph_root)

    assert enriched.knowledge_base_context is None


def test_prompt_exposes_knowledge_base_rag_tool(tmp_path: Path) -> None:
    graph_root = _write_school_course_graph_fixture(tmp_path)
    request = GenerationRequest(
        learning_goal="学习高等数学中的：导数定义",
        subject="数学基础课程群",
        graph_context=LearningGraphContext(
            dataset_id="ai_foundation_course_groups",
            focus_node_title="导数定义",
            source_graph_id="high_math",
        ),
    )
    enriched = attach_school_course_knowledge_base_context(request, graph_root=graph_root)

    _system_prompt, user_prompt = build_study_guide_prompts(
        enriched,
        plan=PreparationPlan(plan_summary="测试计划", agent_routes=[]),
    )

    assert "Knowledge base RAG tool:" in user_prompt
    assert "knowledge_base_rag_search" in user_prompt
    assert "差商极限" in user_prompt
