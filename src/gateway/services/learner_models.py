from __future__ import annotations

import json
import math
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher
from hashlib import sha1
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from edu_multi_agent.config import PROJECT_ROOT, Settings
from edu_multi_agent.file_io import now_iso
from edu_multi_agent.models import GenerationRequest, LearningGraphContext

from ..schemas.learner_models import (
    LearningEvidenceEvent,
    LearningRecommendation,
    LearnerEventListResponse,
    LearnerModelRecord,
    LearnerModelResponse,
    LearnerModelSnapshot,
    LearnerOverallAssessment,
    SkillJudgment,
    SkillState,
    build_empty_assessment,
)
from ..schemas.practice_review import (
    PracticeReviewQuestion,
    PracticeReviewRequest,
    PracticeReviewResponse,
)


INITIAL_SUCCESS_PRIOR = 1.5
INITIAL_FAILURE_PRIOR = 1.5
RECENT_SCORE_WINDOW = 12
RECENT_OBSERVATION_WINDOW = 10
KNOWN_SESSION_WINDOW = 100
GRAPH_MATCH_MIN_SCORE = 0.72
GRAPH_SKILL_MATCH_MIN_SCORE = 0.68
GRAPH_MATCH_TIE_MARGIN = 0.04
GRAPH_SCORE_LINE_LIMIT = 4
GRAPH_RELATED_TOPIC_LIMIT = 3
PRIOR_RELATION_KEYWORDS = (
    "prerequisite",
    "precondition",
    "requires",
    "foundation",
    "supports",
    "depends",
    "先修",
    "前置",
    "基础",
    "支撑",
    "支持",
)
DEFAULT_LEARNER_PROFILE = (
    "Mixed-ability class that needs clear guidance, visual explanation, "
    "and structured practice."
)


@dataclass(slots=True)
class GraphNodeIndex:
    node_id: str
    title: str
    difficulty: float | None = None
    summary: str = ""
    parent_id: str | None = None
    parent_title: str | None = None
    child_ids: tuple[str, ...] = ()
    path_titles: tuple[str, ...] = ()
    prerequisite_titles: tuple[str, ...] = ()


@dataclass(slots=True)
class GraphDatasetIndex:
    dataset_id: str
    title: str
    aliases: tuple[str, ...]
    nodes: dict[str, GraphNodeIndex] = field(default_factory=dict)
    leaf_node_ids: tuple[str, ...] = ()
    adjacency: dict[str, set[str]] = field(default_factory=dict)
    outgoing_edges: dict[str, list["GraphEdgeIndex"]] = field(default_factory=dict)
    incoming_edges: dict[str, list["GraphEdgeIndex"]] = field(default_factory=dict)


@dataclass(slots=True)
class GraphEdgeIndex:
    source: str
    target: str
    relation: str


@dataclass(slots=True)
class GraphNodeMatch:
    node_id: str
    score: float


@dataclass(slots=True)
class GraphRequestContext:
    dataset: GraphDatasetIndex
    focus_node_ids: tuple[str, ...]
    focus_leaf_node_ids: tuple[str, ...]
    prerequisite_leaf_node_ids: tuple[str, ...]
    related_leaf_node_ids: tuple[str, ...]
    graph_context: LearningGraphContext | None = None


@dataclass(slots=True)
class GraphEnrichmentSummary:
    summary: str
    recommended_focus: list[str]


@dataclass(slots=True)
class ScopedSkillEvidence:
    judgment: SkillJudgment
    context: GraphRequestContext | None = None
    node: GraphNodeIndex | None = None


class KnowledgeGraphIndex:
    """In-memory knowledge-graph index used for graph-scoped learner profiling."""

    def __init__(self, graph_root: Path | None = None) -> None:
        self.graph_root = (graph_root or (PROJECT_ROOT / "graph_data")).resolve()
        self.datasets: dict[str, GraphDatasetIndex] = {}
        self._load()

    def _load(self) -> None:
        index_path = self.graph_root / "index.json"
        index_payload = self._load_json(index_path)
        raw_datasets = index_payload.get("datasets", [])
        if not isinstance(raw_datasets, list):
            return

        for raw_dataset in raw_datasets:
            if not isinstance(raw_dataset, dict):
                continue
            dataset_id = str(raw_dataset.get("id", "")).strip()
            title = str(raw_dataset.get("title", "")).strip()
            filename = str(raw_dataset.get("file", "")).strip()
            if not dataset_id or not title or not filename:
                continue

            payload = self._load_json(self.graph_root / filename)
            aliases = [dataset_id, title]
            meta = payload.get("meta")
            if isinstance(meta, dict):
                aliases.extend(
                    str(meta.get(key, "")).strip()
                    for key in ("subject", "scope")
                    if str(meta.get(key, "")).strip()
                )

            dataset = GraphDatasetIndex(
                dataset_id=dataset_id,
                title=title,
                aliases=tuple(_trim_recent_items(aliases, limit=6)),
            )
            for raw_node in payload.get("nodes", []):
                if isinstance(raw_node, dict):
                    self._register_node(dataset, raw_node, parent=None, path_titles=())

            for raw_edge in payload.get("edges", []):
                if not isinstance(raw_edge, dict):
                    continue
                source = str(raw_edge.get("source", "")).strip()
                target = str(raw_edge.get("target", "")).strip()
                relation = str(raw_edge.get("relation") or "related").strip()
                self._connect(dataset, source, target, relation=relation)

            dataset.leaf_node_ids = tuple(
                node_id
                for node_id, node in dataset.nodes.items()
                if not node.child_ids
            )
            self.datasets[dataset_id] = dataset

    def _load_json(self, path: Path) -> dict[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return {}
        if isinstance(payload, dict):
            return payload
        return {}

    def _register_node(
        self,
        dataset: GraphDatasetIndex,
        raw_node: dict[str, Any],
        *,
        parent: GraphNodeIndex | None,
        path_titles: tuple[str, ...],
    ) -> None:
        node_id = str(raw_node.get("id") or raw_node.get("title") or "").strip()
        title = str(raw_node.get("title") or node_id).strip()
        if not node_id or not title:
            return

        raw_children = raw_node.get("sub_nodes", [])
        child_ids = [
            str(child.get("id") or child.get("title") or "").strip()
            for child in raw_children
            if isinstance(child, dict)
        ]
        node = GraphNodeIndex(
            node_id=node_id,
            title=title,
            difficulty=_normalize_graph_difficulty(raw_node.get("difficulty")),
            summary=str(raw_node.get("summary") or "").strip(),
            parent_id=parent.node_id if parent else None,
            parent_title=parent.title if parent else None,
            child_ids=tuple(child_id for child_id in child_ids if child_id),
            path_titles=(*path_titles, title),
            prerequisite_titles=tuple(
                str(item).strip()
                for item in raw_node.get("prerequisites", [])
                if str(item).strip()
            ),
        )
        dataset.nodes[node_id] = node
        dataset.adjacency.setdefault(node_id, set())

        if parent is not None:
            self._connect(dataset, parent.node_id, node_id, relation="contains")

        for raw_link in raw_node.get("links", []):
            link = str(raw_link).strip()
            self._connect(dataset, node_id, link, relation="links")

        for raw_child in raw_children:
            if isinstance(raw_child, dict):
                self._register_node(
                    dataset,
                    raw_child,
                    parent=node,
                    path_titles=node.path_titles,
                )

    def _connect(
        self,
        dataset: GraphDatasetIndex,
        source: str,
        target: str,
        *,
        relation: str = "related",
    ) -> None:
        source_id = str(source).strip()
        target_id = str(target).strip()
        if not source_id or not target_id:
            return
        dataset.adjacency.setdefault(source_id, set()).add(target_id)
        dataset.adjacency.setdefault(target_id, set()).add(source_id)
        edge = GraphEdgeIndex(
            source=source_id,
            target=target_id,
            relation=(relation or "related").strip(),
        )
        dataset.outgoing_edges.setdefault(source_id, []).append(edge)
        dataset.incoming_edges.setdefault(target_id, []).append(edge)

    def resolve_request_context(self, request: GenerationRequest) -> GraphRequestContext | None:
        if not self.datasets:
            return None

        explicit_context = self._resolve_explicit_request_context(request)
        if explicit_context is not None:
            return explicit_context

        explicit_terms = _extract_focus_terms_from_request(request)
        search_terms = explicit_terms or _trim_recent_items(
            [request.learning_goal, request.notes],
            limit=3,
        )
        if not search_terms:
            search_terms = [request.learning_goal]

        request_subject = request.subject.strip()
        best_dataset: GraphDatasetIndex | None = None
        best_matches: list[GraphNodeMatch] = []
        best_score = 0.0

        for dataset in self.datasets.values():
            subject_score = self._dataset_subject_score(dataset, request_subject, request.notes)
            candidate_matches = self._candidate_node_matches(dataset, search_terms)
            if not candidate_matches:
                continue
            dataset_score = candidate_matches[0].score + min(0.12, subject_score * 0.12)
            if dataset_score > best_score:
                best_dataset = dataset
                best_matches = candidate_matches
                best_score = dataset_score

        if best_dataset is None or not best_matches:
            return None

        top_score = best_matches[0].score
        if top_score < GRAPH_MATCH_MIN_SCORE:
            return None

        focus_node_ids = tuple(
            match.node_id
            for match in best_matches
            if match.score >= top_score - GRAPH_MATCH_TIE_MARGIN
        )
        focus_leaf_ids = self._unique_titles(
            node_id
            for focus_node_id in focus_node_ids
            for node_id in self._expand_to_leaf_nodes(best_dataset, focus_node_id)
        )
        prerequisite_leaf_ids = self._build_prerequisite_leaf_scope(
            best_dataset,
            focus_node_ids,
            focus_leaf_ids,
        )
        related_leaf_ids = self._unique_titles([*focus_leaf_ids, *prerequisite_leaf_ids])
        return GraphRequestContext(
            dataset=best_dataset,
            focus_node_ids=focus_node_ids,
            focus_leaf_node_ids=focus_leaf_ids,
            prerequisite_leaf_node_ids=prerequisite_leaf_ids,
            related_leaf_node_ids=related_leaf_ids,
            graph_context=request.graph_context,
        )

    def _resolve_explicit_request_context(
        self,
        request: GenerationRequest,
    ) -> GraphRequestContext | None:
        graph_context = request.graph_context
        if graph_context is None or not graph_context.dataset_id:
            return None

        dataset = self.datasets.get(graph_context.dataset_id)
        if dataset is None:
            return None

        focus_node_ids: list[str] = []
        for candidate in (
            graph_context.focus_node_id,
            graph_context.focus_node_title,
        ):
            node_id = self._resolve_node_reference(dataset, candidate or "")
            if node_id:
                focus_node_ids.append(node_id)

        if not focus_node_ids:
            search_terms = _extract_focus_terms_from_request(request) or _trim_recent_items(
                [request.learning_goal, request.notes],
                limit=3,
            )
            matches = self._candidate_node_matches(dataset, search_terms)
            if matches:
                top_score = matches[0].score
                focus_node_ids.extend(
                    match.node_id
                    for match in matches
                    if match.score >= top_score - GRAPH_MATCH_TIE_MARGIN
                )

        focus_node_ids_tuple = self._unique_titles(focus_node_ids)
        if not focus_node_ids_tuple:
            return None

        focus_leaf_ids = self._unique_titles(
            node_id
            for focus_node_id in focus_node_ids_tuple
            for node_id in self._expand_to_leaf_nodes(dataset, focus_node_id)
        )
        prerequisite_leaf_ids = self._build_prerequisite_leaf_scope(
            dataset,
            focus_node_ids_tuple,
            focus_leaf_ids,
        )
        related_leaf_ids = self._unique_titles([*focus_leaf_ids, *prerequisite_leaf_ids])
        return GraphRequestContext(
            dataset=dataset,
            focus_node_ids=focus_node_ids_tuple,
            focus_leaf_node_ids=focus_leaf_ids,
            prerequisite_leaf_node_ids=prerequisite_leaf_ids,
            related_leaf_node_ids=related_leaf_ids,
            graph_context=graph_context,
        )

    def match_skill_to_node(self, dataset: GraphDatasetIndex, state: SkillState) -> GraphNodeMatch | None:
        if state.graph_dataset_id == dataset.dataset_id and state.graph_node_id in dataset.nodes:
            return GraphNodeMatch(node_id=state.graph_node_id, score=1.0)

        candidate = self._best_node_match(
            dataset,
            [state.display_name, state.skill_id],
            minimum_score=GRAPH_SKILL_MATCH_MIN_SCORE,
        )
        return candidate

    def node_overlaps_leaf_scope(
        self,
        dataset: GraphDatasetIndex,
        node_id: str,
        leaf_scope: tuple[str, ...],
    ) -> bool:
        leaf_ids = set(self._expand_to_leaf_nodes(dataset, node_id))
        return bool(leaf_ids.intersection(leaf_scope))

    def node_overlaps_focus_scope(self, context: GraphRequestContext, node_id: str) -> bool:
        return self.node_overlaps_leaf_scope(
            context.dataset,
            node_id,
            context.focus_leaf_node_ids,
        )

    def _dataset_subject_score(
        self,
        dataset: GraphDatasetIndex,
        request_subject: str,
        request_notes: str,
    ) -> float:
        candidates = [request_subject.strip()]
        note_course_match = re.search(r"课程[:：]\s*([^；;\n]+)", request_notes or "")
        if note_course_match:
            candidates.append(note_course_match.group(1).strip())

        best_score = 0.0
        for candidate in candidates:
            if not candidate:
                continue
            for alias in dataset.aliases:
                best_score = max(best_score, _text_similarity(candidate, alias))
        return best_score

    def _candidate_node_matches(
        self,
        dataset: GraphDatasetIndex,
        search_terms: list[str],
    ) -> list[GraphNodeMatch]:
        best_by_node: dict[str, float] = {}
        for term in search_terms:
            match = self._best_node_match(dataset, [term], minimum_score=GRAPH_MATCH_MIN_SCORE)
            if match is None:
                continue
            previous = best_by_node.get(match.node_id, 0.0)
            best_by_node[match.node_id] = max(previous, match.score)

        matches = [
            GraphNodeMatch(node_id=node_id, score=score)
            for node_id, score in best_by_node.items()
        ]
        matches.sort(
            key=lambda item: (
                -item.score,
                0 if dataset.nodes.get(item.node_id, GraphNodeIndex("", "")).child_ids else -1,
                dataset.nodes[item.node_id].title,
            )
        )
        return matches

    def _best_node_match(
        self,
        dataset: GraphDatasetIndex,
        texts: list[str],
        *,
        minimum_score: float,
    ) -> GraphNodeMatch | None:
        best_node_id = ""
        best_score = 0.0
        for node_id, node in dataset.nodes.items():
            node_score = 0.0
            for raw_text in texts:
                text = raw_text.strip()
                if not text:
                    continue
                node_score = max(node_score, _text_similarity(text, node.title))
            if node_score > best_score:
                best_node_id = node_id
                best_score = node_score

        if not best_node_id or best_score < minimum_score:
            return None
        return GraphNodeMatch(node_id=best_node_id, score=round(best_score, 4))

    def _expand_to_leaf_nodes(self, dataset: GraphDatasetIndex, node_id: str) -> tuple[str, ...]:
        node = dataset.nodes.get(node_id)
        if node is None:
            return ()
        if not node.child_ids:
            return (node_id,)

        collected: list[str] = []
        queue = list(node.child_ids)
        while queue:
            current_id = queue.pop(0)
            current_node = dataset.nodes.get(current_id)
            if current_node is None:
                continue
            if not current_node.child_ids:
                collected.append(current_id)
                continue
            queue.extend(current_node.child_ids)
        return self._unique_titles(collected)

    def _resolve_node_reference(self, dataset: GraphDatasetIndex, reference: str) -> str | None:
        cleaned = str(reference or "").strip()
        if not cleaned:
            return None
        if cleaned in dataset.nodes:
            return cleaned

        normalized = _normalize_text(cleaned)
        for node_id, node in dataset.nodes.items():
            if normalized in {_normalize_text(node_id), _normalize_text(node.title)}:
                return node_id
        return None

    def _relation_is_prior(self, relation: str) -> bool:
        normalized = _normalize_text(relation)
        return any(keyword in normalized for keyword in PRIOR_RELATION_KEYWORDS)

    def _build_prerequisite_leaf_scope(
        self,
        dataset: GraphDatasetIndex,
        focus_node_ids: tuple[str, ...],
        focus_leaf_ids: tuple[str, ...],
    ) -> tuple[str, ...]:
        seed_ids: set[str] = set()
        for node_id in (*focus_node_ids, *focus_leaf_ids):
            node = dataset.nodes.get(node_id)
            if node is None:
                continue

            for prerequisite in node.prerequisite_titles:
                prerequisite_id = self._resolve_node_reference(dataset, prerequisite)
                if prerequisite_id:
                    seed_ids.add(prerequisite_id)

            for edge in dataset.incoming_edges.get(node_id, []):
                if self._relation_is_prior(edge.relation):
                    seed_ids.add(edge.source)

        related_leaf_ids: list[str] = []
        for node_id in seed_ids:
            related_leaf_ids.extend(self._expand_to_leaf_nodes(dataset, node_id))
        return self._unique_titles(related_leaf_ids)

    def _unique_titles(self, node_ids: Any) -> tuple[str, ...]:
        seen: set[str] = set()
        ordered: list[str] = []
        for node_id in node_ids:
            cleaned = str(node_id).strip()
            if not cleaned or cleaned in seen:
                continue
            ordered.append(cleaned)
            seen.add(cleaned)
        return tuple(ordered)


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _normalize_graph_difficulty(value: Any) -> float | None:
    try:
        raw_difficulty = float(value)
    except (TypeError, ValueError):
        return None
    if raw_difficulty > 1.0:
        return round(_clamp(raw_difficulty / 5.0), 4)
    return round(_clamp(raw_difficulty), 4)


def _parse_iso_timestamp(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.now()


def _safe_model_dir(root: Path, learner_id: str) -> Path:
    safe_fragment = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", learner_id).strip("_")
    safe_fragment = safe_fragment[:32] or "learner"
    digest = sha1(learner_id.encode("utf-8")).hexdigest()[:10]
    return root / f"{safe_fragment}_{digest}"


def _normalize_text(value: str) -> str:
    return re.sub(
        r"[\s\-_—–:：;；,，。.!！？?、/\\|()\[\]{}<>《》“”\"'`]+",
        "",
        (value or "").strip().lower(),
    )


def _text_similarity(left: str, right: str) -> float:
    normalized_left = _normalize_text(left)
    normalized_right = _normalize_text(right)
    if not normalized_left or not normalized_right:
        return 0.0
    if normalized_left == normalized_right:
        return 1.0

    shorter, longer = sorted(
        (normalized_left, normalized_right),
        key=len,
    )
    if len(shorter) >= 2 and shorter in longer:
        return round(min(0.98, 0.84 + 0.14 * (len(shorter) / len(longer))), 4)

    ratio = SequenceMatcher(None, normalized_left, normalized_right).ratio()
    shared_chars = set(normalized_left) & set(normalized_right)
    shared_ratio = len(shared_chars) / max(1, len(set(shorter)))
    return round(max(ratio, 0.55 * ratio + 0.45 * shared_ratio), 4)


def _extract_focus_terms_from_request(request: GenerationRequest) -> list[str]:
    extracted: list[str] = []
    patterns = (
        r"知识点[:：]\s*([^；;，,\n]+)",
        r"中的[:：]\s*([^；;，,\n]+)",
    )
    for source in (request.notes, request.learning_goal):
        text = (source or "").strip()
        if not text:
            continue
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                term = match.group(1).strip()
                if term:
                    extracted.append(term)
    return _trim_recent_items(extracted, limit=4)


def _normalize_skill_id(raw_value: str) -> str:
    normalized = re.sub(r"[^\w\u4e00-\u9fff]+", "_", raw_value.strip().lower()).strip("_")
    if normalized:
        return normalized
    return f"skill_{sha1(raw_value.encode('utf-8')).hexdigest()[:12]}"


def _skill_display_name(skill_id: str) -> str:
    return skill_id.replace("_", " ").strip() or skill_id


def _truncate_answer_preview(value: Any, *, max_length: int = 200) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except TypeError:
            text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"


def _default_difficulty(question_type: str) -> float:
    return {
        "FillInTheBlank": 0.35,
        "MultipleChoice": 0.4,
        "Listening": 0.45,
        "ShortAnswer": 0.55,
        "Coding": 0.7,
        "Drawing": 0.6,
    }.get(question_type, 0.5)


def _compute_freshness(last_updated: str, current_timestamp: str) -> float:
    current_dt = _parse_iso_timestamp(current_timestamp)
    updated_dt = _parse_iso_timestamp(last_updated)
    delta_days = max(0.0, (current_dt - updated_dt).total_seconds() / 86_400)
    return round(_clamp(math.exp(-delta_days / 30.0), 0.18, 1.0), 4)


def _correctness_score(review: PracticeReviewResponse) -> float:
    base_score = _clamp(review.score / 100.0)
    if review.correctness == "correct":
        return max(0.85, base_score)
    if review.correctness == "partially_correct":
        return max(0.45, base_score)
    if review.correctness == "incorrect":
        return min(0.35, base_score)
    return base_score


def _build_fallback_skill_judgments(
    request: PracticeReviewRequest,
    review: PracticeReviewResponse,
) -> list[SkillJudgment]:
    provided_tags = [tag.strip() for tag in request.question.skill_tags if tag.strip()]
    score = _correctness_score(review)
    misconception_tags = [item.strip() for item in review.issues if item.strip()][:2]

    if provided_tags:
        coverage = round(1.0 / len(provided_tags), 4)
        return [
            SkillJudgment(
                skill_id=_normalize_skill_id(tag),
                display_name=tag,
                score=score,
                coverage=coverage,
                confidence=0.58,
                reasoning_quality=score,
                misconception_tags=misconception_tags,
                observation=review.summary,
            )
            for tag in provided_tags[:3]
        ]

    derived_name = (
        request.learning_goal
        or request.question.analysis
        or request.question.question
        or request.question.question_type
    ).strip()
    display_name = derived_name[:32] or request.question.question_type
    return [
        SkillJudgment(
            skill_id=_normalize_skill_id(f"{request.question.question_type}_{display_name}"),
            display_name=display_name,
            score=score,
            coverage=1.0,
            confidence=0.52,
            reasoning_quality=score,
            misconception_tags=misconception_tags,
            observation=review.summary,
        )
    ]


def _sanitize_skill_judgments(
    request: PracticeReviewRequest,
    review: PracticeReviewResponse,
) -> list[SkillJudgment]:
    raw_items = review.skill_judgments or _build_fallback_skill_judgments(request, review)
    sanitized: list[SkillJudgment] = []
    default_score = _correctness_score(review)
    for item in raw_items[:3]:
        skill_id = _normalize_skill_id(item.skill_id or item.display_name or request.question.question_type)
        display_name = item.display_name.strip() or _skill_display_name(skill_id)
        misconception_tags = [
            tag.strip()
            for tag in item.misconception_tags
            if isinstance(tag, str) and tag.strip()
        ]
        sanitized.append(
            item.model_copy(
                update={
                    "skill_id": skill_id,
                    "display_name": display_name,
                    "score": round(_clamp(item.score if item.score is not None else default_score), 4),
                    "coverage": round(_clamp(item.coverage, 0.1, 1.0), 4),
                    "confidence": round(_clamp(item.confidence), 4),
                    "reasoning_quality": round(_clamp(item.reasoning_quality), 4),
                    "misconception_tags": misconception_tags,
                    "observation": item.observation.strip(),
                }
            )
        )
    return sanitized or _build_fallback_skill_judgments(request, review)


def _refresh_record_freshness(record: LearnerModelRecord, *, current_timestamp: str) -> LearnerModelRecord:
    refreshed_skills = {
        skill_id: skill.model_copy(
            update={"freshness": _compute_freshness(skill.last_updated, current_timestamp)}
        )
        for skill_id, skill in record.skills.items()
    }
    return record.model_copy(update={"skills": refreshed_skills})


def _trim_recent_items(items: list[str], *, limit: int) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for item in reversed(items):
        cleaned = item.strip()
        if not cleaned or cleaned in seen:
            continue
        deduped.append(cleaned)
        seen.add(cleaned)
        if len(deduped) >= limit:
            break
    deduped.reverse()
    return deduped


def _overall_band(mastery: float, confidence: float) -> str:
    if confidence < 0.2:
        return "evidence_needed"
    if mastery < 0.45:
        return "needs_support"
    if mastery < 0.65:
        return "developing"
    if mastery < 0.82:
        return "proficient"
    return "advanced"


def _build_recommendations(
    weak_states: list[SkillState],
    misconception_pairs: list[tuple[str, int]],
    *,
    overall_confidence: float,
) -> list[str]:
    recommendations: list[str] = []
    if overall_confidence < 0.35:
        recommendations.append("当前高质量证据还不够，建议先补1到2组低门槛诊断题再决定整体难度。")
    for state in weak_states[:2]:
        recommendations.append(
            f"围绕“{state.display_name}”先做分步诊断与小步巩固，避免直接跳到综合迁移。"
        )
    if misconception_pairs:
        tag, _count = misconception_pairs[0]
        recommendations.append(f"下一轮讲解里显式对比并纠正“{tag}”这一类误区。")
    return _trim_recent_items(recommendations, limit=4)


def _recommendation_signal_score(state: SkillState) -> float:
    mastery_gap = _clamp((0.72 - state.mastery) / 0.72)
    uncertainty = 1.0 - state.confidence
    recent_gap = _clamp((0.72 - state.rolling_score) / 0.72)
    stale_signal = 1.0 - state.freshness
    misconception_signal = min(0.16, 0.04 * sum(state.misconception_counts.values()))
    if state.mastery >= 0.82 and state.confidence >= 0.45:
        return round(_clamp(0.44 + 0.3 * state.mastery + 0.16 * state.confidence), 4)
    return round(
        _clamp(
            0.38 * mastery_gap
            + 0.22 * uncertainty
            + 0.18 * recent_gap
            + 0.06 * stale_signal
            + misconception_signal
        ),
        4,
    )


def _skill_recommendation_type(state: SkillState) -> str:
    if state.confidence < 0.22:
        return "diagnose"
    if state.mastery < 0.5:
        return "remediate"
    if state.mastery < 0.72:
        return "consolidate"
    if state.mastery >= 0.82 and state.confidence >= 0.45:
        return "challenge"
    return "advance"


def _skill_recommendation_action(state: SkillState, recommendation_type: str) -> str:
    if recommendation_type == "diagnose":
        return f"先给“{state.display_name}”安排1组低门槛诊断题，补足判断证据。"
    if recommendation_type == "remediate":
        return f"用例题拆解和即时反馈重讲“{state.display_name}”，每步只引入一个变化。"
    if recommendation_type == "consolidate":
        return f"围绕“{state.display_name}”做2到3题同型变式，确认能稳定迁移。"
    if recommendation_type == "challenge":
        return f"给“{state.display_name}”增加综合题或开放题，验证高阶应用能力。"
    return f"把“{state.display_name}”接到下一知识点，边学边穿插快速复盘。"


def _build_skill_recommendation(state: SkillState) -> LearningRecommendation | None:
    score = _recommendation_signal_score(state)
    recommendation_type = _skill_recommendation_type(state)
    if score < 0.28 and recommendation_type != "challenge":
        return None
    reason = (
        f"掌握度 {state.mastery:.0%}，可信度 {state.confidence:.0%}，"
        f"近期表现 {state.rolling_score:.0%}。"
    )
    if state.misconception_counts:
        top_misconception = max(
            state.misconception_counts.items(),
            key=lambda item: (item[1], item[0]),
        )[0]
        reason += f" 高频误区：{top_misconception}。"
    return LearningRecommendation(
        target_id=f"skill:{state.skill_id}",
        title=state.display_name,
        recommendation_type=recommendation_type,
        priority=5,
        score=score,
        reason=reason,
        suggested_action=_skill_recommendation_action(state, recommendation_type),
    )


def _build_graph_learning_recommendations(
    skill_states: list[SkillState],
    graph_index: KnowledgeGraphIndex,
) -> list[LearningRecommendation]:
    matched_items: list[tuple[SkillState, GraphDatasetIndex, GraphNodeIndex]] = []
    for state in skill_states:
        best_match: tuple[GraphDatasetIndex, GraphNodeMatch] | None = None
        candidate_datasets = (
            [graph_index.datasets[state.graph_dataset_id]]
            if state.graph_dataset_id in graph_index.datasets
            else list(graph_index.datasets.values())
        )
        for dataset in candidate_datasets:
            match = graph_index.match_skill_to_node(dataset, state)
            if match is None:
                continue
            if best_match is None or match.score > best_match[1].score:
                best_match = (dataset, match)
        if best_match is None:
            continue
        dataset, match = best_match
        node = dataset.nodes.get(match.node_id)
        if node is not None:
            matched_items.append((state, dataset, node))

    tracked_leaf_ids = {
        leaf_id
        for _state, dataset, node in matched_items
        for leaf_id in graph_index._expand_to_leaf_nodes(dataset, node.node_id)
    }
    recommendations: list[LearningRecommendation] = []
    for state, dataset, node in matched_items:
        if state.mastery < 0.66 or state.confidence < 0.3:
            continue
        for neighbor_id in sorted(dataset.adjacency.get(node.node_id, set())):
            for leaf_id in graph_index._expand_to_leaf_nodes(dataset, neighbor_id):
                if leaf_id in tracked_leaf_ids:
                    continue
                leaf = dataset.nodes.get(leaf_id)
                if leaf is None:
                    continue
                target_difficulty = _clamp(state.mastery + 0.12)
                difficulty_fit = 0.04
                if leaf.difficulty is not None:
                    difficulty_fit = 0.12 * (1.0 - abs(leaf.difficulty - target_difficulty))
                score = round(
                    _clamp(0.46 + 0.2 * state.mastery + 0.12 * state.confidence + difficulty_fit),
                    4,
                )
                recommendations.append(
                    LearningRecommendation(
                        target_id=f"graph:{dataset.dataset_id}:{leaf.node_id}",
                        title=leaf.title,
                        recommendation_type="advance",
                        priority=5,
                        score=score,
                        reason=(
                            f"已在“{state.display_name}”形成 {state.mastery:.0%} 掌握度，"
                            f"“{leaf.title}”是图谱中的相邻知识点。"
                        ),
                        suggested_action=f"下一轮可以学习“{leaf.title}”，开头先用“{state.display_name}”做2分钟连接复盘。",
                    )
                )
    return recommendations


def _build_learning_recommendations(
    record: LearnerModelRecord,
    graph_index: KnowledgeGraphIndex,
    *,
    limit: int = 5,
) -> list[LearningRecommendation]:
    skill_states = list(record.skills.values())
    candidates = [
        recommendation
        for state in skill_states
        if (recommendation := _build_skill_recommendation(state)) is not None
    ]
    candidates.extend(_build_graph_learning_recommendations(skill_states, graph_index))

    best_by_target: dict[str, LearningRecommendation] = {}
    for candidate in candidates:
        previous = best_by_target.get(candidate.target_id)
        if previous is None or candidate.score > previous.score:
            best_by_target[candidate.target_id] = candidate

    ranked = sorted(
        best_by_target.values(),
        key=lambda item: (
            -item.score,
            item.recommendation_type != "remediate",
            item.title,
        ),
    )[:limit]
    return [
        item.model_copy(update={"priority": index + 1})
        for index, item in enumerate(ranked)
    ]


def _recompute_overall(record: LearnerModelRecord, *, current_timestamp: str) -> LearnerOverallAssessment:
    skill_states = list(record.skills.values())
    if not skill_states:
        return build_empty_assessment(current_timestamp)

    weighted_items = []
    for state in skill_states:
        weight = max(0.25, state.confidence) * max(0.5, state.evidence_count) * max(0.3, state.freshness)
        weighted_items.append((state, weight))

    total_weight = sum(weight for _state, weight in weighted_items)
    if total_weight <= 0:
        return build_empty_assessment(current_timestamp)

    overall_mastery = sum(state.mastery * weight for state, weight in weighted_items) / total_weight
    overall_confidence = sum(state.confidence * weight for state, weight in weighted_items) / total_weight
    sorted_by_mastery = sorted(
        skill_states,
        key=lambda item: (item.mastery, item.confidence, item.evidence_count),
        reverse=True,
    )
    sorted_by_weakness = sorted(
        skill_states,
        key=lambda item: (item.mastery, item.confidence, -item.evidence_count),
    )
    strong_states = [
        state
        for state in sorted_by_mastery
        if state.mastery >= 0.68 and state.confidence >= 0.3
    ][:3]
    weak_states = [
        state
        for state in sorted_by_weakness
        if state.mastery < 0.62 or state.confidence < 0.35
    ][:3]

    misconception_counts: dict[str, int] = {}
    for state in skill_states:
        for tag, count in state.misconception_counts.items():
            misconception_counts[tag] = misconception_counts.get(tag, 0) + count
    sorted_misconceptions = sorted(
        misconception_counts.items(),
        key=lambda item: (-item[1], item[0]),
    )
    key_misconceptions = [tag for tag, _count in sorted_misconceptions[:3]]
    recommendations = _build_recommendations(
        weak_states,
        sorted_misconceptions,
        overall_confidence=overall_confidence,
    )
    overall_band = _overall_band(overall_mastery, overall_confidence)
    strong_skill_names = [state.display_name for state in strong_states]
    weak_skill_names = [state.display_name for state in weak_states]

    band_text = {
        "evidence_needed": "证据不足",
        "needs_support": "需要重点支持",
        "developing": "处于发展中",
        "proficient": "基本掌握",
        "advanced": "掌握较稳",
    }[overall_band]
    evaluation_summary_parts = [f"整体学情判断：{band_text}。"]
    if strong_skill_names:
        evaluation_summary_parts.append("相对稳固：" + "、".join(strong_skill_names) + "。")
    if weak_skill_names:
        evaluation_summary_parts.append("优先关注：" + "、".join(weak_skill_names) + "。")
    if key_misconceptions:
        evaluation_summary_parts.append("反复误区：" + "、".join(key_misconceptions) + "。")
    evaluation_summary = "".join(evaluation_summary_parts)

    prompt_lines = [f"整体学情：{band_text}。"]
    if strong_skill_names:
        prompt_lines.append("相对稳固的能力：" + "、".join(strong_skill_names) + "。")
    if weak_skill_names:
        prompt_lines.append("需重点关注的能力：" + "、".join(weak_skill_names) + "。")
    if key_misconceptions:
        prompt_lines.append("近期反复出现的误区：" + "、".join(key_misconceptions) + "。")
    if recommendations:
        prompt_lines.append("下一轮建议：" + "；".join(recommendations))

    return LearnerOverallAssessment(
        overall_mastery=round(_clamp(overall_mastery), 4),
        overall_confidence=round(_clamp(overall_confidence), 4),
        overall_band=overall_band,
        strong_skills=strong_skill_names,
        weak_skills=weak_skill_names,
        key_misconceptions=key_misconceptions,
        recommended_focus=recommendations,
        learning_recommendations=record.overall.learning_recommendations,
        evaluation_summary=evaluation_summary,
        prompt_profile="".join(prompt_lines).strip(),
        updated_at=current_timestamp,
    )


def _build_snapshot(record: LearnerModelRecord) -> LearnerModelSnapshot:
    return LearnerModelSnapshot(
        learner_id=record.learner_id,
        overall_mastery=record.overall.overall_mastery,
        overall_confidence=record.overall.overall_confidence,
        overall_band=record.overall.overall_band,
        total_events=record.total_events,
        total_sessions=record.total_sessions,
        strong_skills=record.overall.strong_skills,
        weak_skills=record.overall.weak_skills,
        key_misconceptions=record.overall.key_misconceptions,
        recommended_focus=record.overall.recommended_focus,
        learning_recommendations=record.overall.learning_recommendations,
        prompt_profile=record.overall.prompt_profile,
        evaluation_summary=record.overall.evaluation_summary,
        updated_at=record.updated_at,
    )


class LearnerModelRepository:
    """JSON-based persistence for learner models and their event logs."""

    def __init__(self, settings: Settings) -> None:
        self.root = (settings.output_root / "_learner_models").resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _model_dir(self, learner_id: str) -> Path:
        return _safe_model_dir(self.root, learner_id)

    def load_model(self, learner_id: str) -> LearnerModelRecord | None:
        path = self._model_dir(learner_id) / "profile.json"
        if not path.is_file():
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        return LearnerModelRecord.model_validate(payload)

    def has_learner(self, learner_id: str) -> bool:
        target_dir = self._model_dir(learner_id)
        return (target_dir / "profile.json").is_file() or (target_dir / "events.jsonl").is_file()

    def save_model(self, record: LearnerModelRecord) -> Path:
        target_dir = self._model_dir(record.learner_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "profile.json"
        target.write_text(
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return target

    def append_event(self, event: LearningEvidenceEvent) -> Path:
        target_dir = self._model_dir(event.learner_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "events.jsonl"
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
        return target

    def list_events(self, learner_id: str, *, limit: int = 50) -> list[LearningEvidenceEvent]:
        path = self._model_dir(learner_id) / "events.jsonl"
        if not path.is_file():
            return []
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        items = [LearningEvidenceEvent.model_validate(json.loads(line)) for line in lines[-limit:]]
        items.sort(key=lambda item: item.timestamp, reverse=True)
        return items


class LearnerModelService:
    """Learner-model update loop built on top of practice-review data."""

    def __init__(
        self,
        repository: LearnerModelRepository,
        *,
        graph_root: Path | None = None,
    ) -> None:
        self.repository = repository
        self.graph_index = KnowledgeGraphIndex(graph_root=graph_root)
        self._lock = threading.Lock()

    def get_model_response(self, learner_id: str, *, event_limit: int = 20) -> LearnerModelResponse:
        record = self.repository.load_model(learner_id)
        if record is None:
            raise FileNotFoundError(learner_id)
        refreshed = _refresh_record_freshness(record, current_timestamp=now_iso())
        refreshed = self._attach_learning_recommendations(refreshed)
        snapshot = _build_snapshot(refreshed)
        recent_events = self.repository.list_events(learner_id, limit=event_limit)
        return LearnerModelResponse(
            learner=refreshed,
            snapshot=snapshot,
            recent_events=recent_events,
        )

    def get_event_list(self, learner_id: str, *, limit: int = 50) -> LearnerEventListResponse:
        if not self.repository.has_learner(learner_id):
            raise FileNotFoundError(learner_id)
        items = self.repository.list_events(learner_id, limit=limit)
        return LearnerEventListResponse(
            learner_id=learner_id,
            total=len(items),
            items=items,
        )

    def _attach_learning_recommendations(self, record: LearnerModelRecord) -> LearnerModelRecord:
        recommendations = _build_learning_recommendations(record, self.graph_index)
        prompt_profile = record.overall.prompt_profile
        if recommendations:
            recommendation_line = "智能推荐：" + "；".join(
                f"{item.title}（{item.suggested_action}）"
                for item in recommendations[:2]
            )
            if recommendation_line not in prompt_profile:
                separator = "\n" if prompt_profile else ""
                prompt_profile = f"{prompt_profile}{separator}{recommendation_line}"
        overall = record.overall.model_copy(
            update={
                "learning_recommendations": recommendations,
                "prompt_profile": prompt_profile,
            }
        )
        return record.model_copy(update={"overall": overall})

    def enrich_generation_request(self, request: GenerationRequest) -> GenerationRequest:
        learner_id = (request.learner_id or "").strip()
        if not learner_id:
            return request

        record = self.repository.load_model(learner_id)
        if record is None or not record.total_events:
            return request

        current_timestamp = now_iso()
        refreshed = _refresh_record_freshness(record, current_timestamp=current_timestamp)
        enrichment = self._build_graph_enrichment_summary(
            refreshed,
            request,
            current_timestamp=current_timestamp,
        )
        if enrichment is None or not enrichment.summary:
            return request

        learner_profile = request.learner_profile.strip() or DEFAULT_LEARNER_PROFILE
        if enrichment.summary in learner_profile:
            return request

        enriched_profile = f"{learner_profile}\n\n[图谱关联学情]\n{enrichment.summary}"

        notes = request.notes.strip() or "None"
        focus_line = ""
        if enrichment.recommended_focus:
            focus_line = "；".join(enrichment.recommended_focus[:2])
        if focus_line and focus_line not in notes:
            if notes == "None":
                notes = f"结合图谱关联学情优先处理：{focus_line}"
            else:
                notes = f"{notes}；结合图谱关联学情优先处理：{focus_line}"

        return request.model_copy(
            update={
                "learner_profile": enriched_profile,
                "notes": notes,
            }
        )

    def _build_graph_enrichment_summary(
        self,
        record: LearnerModelRecord,
        request: GenerationRequest,
        *,
        current_timestamp: str,
    ) -> GraphEnrichmentSummary | None:
        context = self.graph_index.resolve_request_context(request)
        if context is None:
            return None

        relevant_pairs: list[tuple[SkillState, GraphNodeIndex]] = []
        requested_course_group = (
            context.graph_context.course_group_id
            if context.graph_context is not None
            else None
        )
        for state in record.skills.values():
            if state.graph_dataset_id and state.graph_dataset_id != context.dataset.dataset_id:
                continue
            if (
                requested_course_group
                and state.course_group_id
                and state.course_group_id != requested_course_group
                and not state.graph_node_id
            ):
                continue
            match = self.graph_index.match_skill_to_node(context.dataset, state)
            if match is None:
                continue
            if not self.graph_index.node_overlaps_leaf_scope(
                context.dataset,
                match.node_id,
                context.related_leaf_node_ids,
            ):
                continue
            node = context.dataset.nodes.get(match.node_id)
            if node is None:
                continue
            relevant_pairs.append((state, node))

        if not relevant_pairs:
            return None

        scoped_record = record.model_copy(
            update={
                "skills": {
                    state.skill_id: state
                    for state, _node in relevant_pairs
                }
            }
        )
        scoped_assessment = _recompute_overall(
            scoped_record,
            current_timestamp=current_timestamp,
        )

        def sort_key(item: tuple[SkillState, GraphNodeIndex]) -> tuple[int, float, str]:
            state, node = item
            is_focus = self.graph_index.node_overlaps_focus_scope(context, node.node_id)
            return (0 if is_focus else 1, state.mastery, state.display_name)

        score_lines = [
            f"{state.display_name} {state.mastery:.2f}"
            for state, _node in sorted(relevant_pairs, key=sort_key)[:GRAPH_SCORE_LINE_LIMIT]
        ]
        focus_titles = [
            context.dataset.nodes[node_id].title
            for node_id in context.focus_node_ids
            if node_id in context.dataset.nodes
        ]
        related_titles = [
            context.dataset.nodes[node_id].title
            for node_id in context.prerequisite_leaf_node_ids
            if node_id in context.dataset.nodes
            and node_id not in context.focus_leaf_node_ids
        ]
        related_titles = _trim_recent_items(related_titles, limit=GRAPH_RELATED_TOPIC_LIMIT)

        lines = [
            f"图谱课程：{context.dataset.title}。",
            "当前目标知识点：" + "、".join(focus_titles) + "。",
        ]
        if related_titles:
            lines.append("前置/支撑知识点：" + "、".join(related_titles) + "。")
        if score_lines:
            lines.append("相关知识点得分：" + "；".join(score_lines) + "。")
        lines.append("相关学情：" + scoped_assessment.prompt_profile)
        return GraphEnrichmentSummary(
            summary="\n".join(lines).strip(),
            recommended_focus=scoped_assessment.recommended_focus,
        )

    def _resolve_review_graph_context(
        self,
        request: PracticeReviewRequest,
    ) -> GraphRequestContext | None:
        graph_context = request.graph_context
        if graph_context is None:
            return None

        learning_goal = (
            request.learning_goal
            or graph_context.focus_node_title
            or request.question.analysis
            or request.question.question
            or "学习任务"
        )
        notes = ""
        if graph_context.focus_node_title:
            notes = f"知识点：{graph_context.focus_node_title}"

        generation_request = GenerationRequest(
            learning_goal=learning_goal,
            subject=graph_context.course_group_id or graph_context.course_id or "General",
            grade_level="Unspecified",
            learner_id=request.learner_id,
            learner_profile=DEFAULT_LEARNER_PROFILE,
            notes=notes or "None",
            graph_context=graph_context,
        )
        return self.graph_index.resolve_request_context(generation_request)

    def _scope_skill_evidence(
        self,
        request: PracticeReviewRequest,
        skill_judgments: list[SkillJudgment],
    ) -> list[ScopedSkillEvidence]:
        context = self._resolve_review_graph_context(request)
        if context is None:
            return [
                ScopedSkillEvidence(judgment=judgment)
                for judgment in skill_judgments
            ]

        scoped_items: list[ScopedSkillEvidence] = []
        for judgment in skill_judgments:
            match = self.graph_index._best_node_match(
                context.dataset,
                [judgment.display_name, judgment.skill_id],
                minimum_score=GRAPH_SKILL_MATCH_MIN_SCORE,
            )
            node_id = match.node_id if match is not None else ""
            if node_id and not self.graph_index.node_overlaps_leaf_scope(
                context.dataset,
                node_id,
                context.related_leaf_node_ids,
            ):
                node_id = ""

            if not node_id and len(context.focus_leaf_node_ids) == 1:
                node_id = context.focus_leaf_node_ids[0]

            node = context.dataset.nodes.get(node_id)
            if node is None:
                scoped_items.append(ScopedSkillEvidence(judgment=judgment, context=context))
                continue

            scoped_skill_id = f"graph:{context.dataset.dataset_id}:{node.node_id}"
            scoped_items.append(
                ScopedSkillEvidence(
                    judgment=judgment.model_copy(update={"skill_id": scoped_skill_id}),
                    context=context,
                    node=node,
                )
            )
        return scoped_items

    def _skill_state_graph_metadata(self, item: ScopedSkillEvidence) -> dict[str, str | None]:
        graph_context = item.context.graph_context if item.context is not None else None
        dataset_id = (
            item.context.dataset.dataset_id
            if item.context is not None and item.node is not None
            else None
        )
        return {
            "graph_dataset_id": dataset_id,
            "graph_node_id": item.node.node_id if item.node is not None else None,
            "graph_node_title": item.node.title if item.node is not None else None,
            "course_group_id": graph_context.course_group_id if graph_context is not None else None,
            "course_id": graph_context.course_id if graph_context is not None else None,
            "source_graph_id": graph_context.source_graph_id if graph_context is not None else None,
        }

    def ingest_review(
        self,
        request: PracticeReviewRequest,
        review: PracticeReviewResponse,
        *,
        source: Literal["practice_review_ai", "practice_review_local"],
    ) -> tuple[LearnerModelRecord, LearningEvidenceEvent]:
        learner_id = (request.learner_id or "").strip()
        if not learner_id:
            raise ValueError("Missing learner_id for learner-model ingestion.")

        timestamp = now_iso()
        skill_judgments = _sanitize_skill_judgments(request, review)
        scoped_skill_evidence = self._scope_skill_evidence(request, skill_judgments)
        skill_judgments = [item.judgment for item in scoped_skill_evidence]
        observations = _trim_recent_items(
            [
                *[item for item in review.learner_observations if item.strip()],
                review.summary,
                *review.issues,
            ],
            limit=4,
        )
        event = LearningEvidenceEvent(
            event_id=f"evt_{uuid4().hex}",
            learner_id=learner_id,
            session_id=(request.session_id or "").strip() or None,
            source=source,
            learning_goal=(request.learning_goal or "").strip() or None,
            graph_context=request.graph_context,
            question_id=request.question.id,
            question_type=request.question.question_type,
            answer_preview=_truncate_answer_preview(request.student_answer),
            correctness=review.correctness,
            score=review.score,
            skill_judgments=skill_judgments,
            learner_observations=observations,
            issues=review.issues,
            review_advice=review.review_advice,
            limitations=review.limitations,
            submission_context=dict(request.submission_context or {}),
            timestamp=timestamp,
        )

        with self._lock:
            record = self.repository.load_model(learner_id)
            if record is None:
                record = LearnerModelRecord(
                    learner_id=learner_id,
                    created_at=timestamp,
                    updated_at=timestamp,
                    total_events=0,
                    total_sessions=0,
                    known_session_ids=[],
                    recent_observations=[],
                    skills={},
                    overall=build_empty_assessment(timestamp),
                )

            record = _refresh_record_freshness(record, current_timestamp=timestamp)
            updated_skills = dict(record.skills)
            difficulty = _clamp(
                request.question.difficulty
                if request.question.difficulty is not None
                else _default_difficulty(request.question.question_type)
            )
            correctness_score = _correctness_score(review)

            for item in scoped_skill_evidence:
                judgment = item.judgment
                graph_metadata = self._skill_state_graph_metadata(item)
                previous = updated_skills.get(judgment.skill_id)
                if previous is None:
                    previous = SkillState(
                        skill_id=judgment.skill_id,
                        display_name=judgment.display_name,
                        **graph_metadata,
                        mastery=0.5,
                        confidence=0.0,
                        freshness=1.0,
                        evidence_count=0.0,
                        success_mass=0.0,
                        failure_mass=0.0,
                        rolling_score=0.5,
                        recent_scores=[],
                        misconception_counts={},
                        recent_observations=[],
                        last_updated=timestamp,
                    )

                evidence_score = _clamp(
                    0.65 * judgment.score
                    + 0.2 * judgment.reasoning_quality
                    + 0.15 * correctness_score
                )
                weight = (
                    judgment.coverage
                    * (0.55 + 0.45 * judgment.confidence)
                    * (0.8 + 0.2 * difficulty)
                )
                if review.correctness == "ungradable":
                    weight *= 0.2
                weight = max(0.05, weight)
                success_mass = previous.success_mass + evidence_score * weight
                failure_mass = previous.failure_mass + (1.0 - evidence_score) * weight
                evidence_count = previous.evidence_count + weight
                mastery = (INITIAL_SUCCESS_PRIOR + success_mass) / (
                    INITIAL_SUCCESS_PRIOR
                    + INITIAL_FAILURE_PRIOR
                    + success_mass
                    + failure_mass
                )
                confidence = 1.0 - math.exp(-evidence_count / 4.0)
                recent_scores = [*previous.recent_scores, round(evidence_score, 4)][-RECENT_SCORE_WINDOW:]
                misconception_counts = dict(previous.misconception_counts)
                for tag in judgment.misconception_tags:
                    misconception_counts[tag] = misconception_counts.get(tag, 0) + 1
                recent_observations = _trim_recent_items(
                    [*previous.recent_observations, judgment.observation or review.summary],
                    limit=RECENT_OBSERVATION_WINDOW,
                )
                updated_skills[judgment.skill_id] = previous.model_copy(
                    update={
                        "display_name": judgment.display_name,
                        **{
                            key: value if value is not None else getattr(previous, key)
                            for key, value in graph_metadata.items()
                        },
                        "mastery": round(_clamp(mastery), 4),
                        "confidence": round(_clamp(confidence), 4),
                        "freshness": 1.0,
                        "evidence_count": round(evidence_count, 4),
                        "success_mass": round(success_mass, 4),
                        "failure_mass": round(failure_mass, 4),
                        "rolling_score": round(sum(recent_scores) / len(recent_scores), 4),
                        "recent_scores": recent_scores,
                        "misconception_counts": misconception_counts,
                        "recent_observations": recent_observations,
                        "last_updated": timestamp,
                    }
                )

            known_session_ids = list(record.known_session_ids)
            session_id = event.session_id
            total_sessions = record.total_sessions
            if session_id and session_id not in known_session_ids:
                known_session_ids.append(session_id)
                known_session_ids = known_session_ids[-KNOWN_SESSION_WINDOW:]
                total_sessions += 1

            recent_observations = _trim_recent_items(
                [*record.recent_observations, *observations],
                limit=RECENT_OBSERVATION_WINDOW,
            )
            updated_record = record.model_copy(
                update={
                    "updated_at": timestamp,
                    "total_events": record.total_events + 1,
                    "total_sessions": total_sessions,
                    "known_session_ids": known_session_ids,
                    "recent_observations": recent_observations,
                    "skills": updated_skills,
                }
            )
            updated_record = updated_record.model_copy(
                update={"overall": _recompute_overall(updated_record, current_timestamp=timestamp)}
            )
            updated_record = self._attach_learning_recommendations(updated_record)

            self.repository.save_model(updated_record)
            self.repository.append_event(event)
            return updated_record, event
