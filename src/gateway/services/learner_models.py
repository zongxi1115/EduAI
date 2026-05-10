from __future__ import annotations

import json
import math
import re
import threading
from datetime import datetime
from hashlib import sha1
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import now_iso
from edu_multi_agent.models import GenerationRequest

from ..schemas.learner_models import (
    LearningEvidenceEvent,
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
DEFAULT_LEARNER_PROFILE = (
    "Mixed-ability class that needs clear guidance, visual explanation, "
    "and structured practice."
)


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


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

    def __init__(self, repository: LearnerModelRepository) -> None:
        self.repository = repository
        self._lock = threading.Lock()

    def get_model_response(self, learner_id: str, *, event_limit: int = 20) -> LearnerModelResponse:
        record = self.repository.load_model(learner_id)
        if record is None:
            raise FileNotFoundError(learner_id)
        refreshed = _refresh_record_freshness(record, current_timestamp=now_iso())
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

    def enrich_generation_request(self, request: GenerationRequest) -> GenerationRequest:
        learner_id = (request.learner_id or "").strip()
        if not learner_id:
            return request

        record = self.repository.load_model(learner_id)
        if record is None or not record.total_events:
            return request

        refreshed = _refresh_record_freshness(record, current_timestamp=now_iso())
        summary = refreshed.overall.prompt_profile.strip()
        if not summary:
            return request

        learner_profile = request.learner_profile.strip() or DEFAULT_LEARNER_PROFILE
        if summary in learner_profile:
            return request

        if learner_profile == DEFAULT_LEARNER_PROFILE:
            enriched_profile = f"{learner_profile}\n\n[历史学情摘要]\n{summary}"
        else:
            enriched_profile = f"{learner_profile}\n\n[历史学情摘要]\n{summary}"

        notes = request.notes.strip() or "None"
        focus_line = ""
        if refreshed.overall.recommended_focus:
            focus_line = "；".join(refreshed.overall.recommended_focus[:2])
        if focus_line and focus_line not in notes:
            if notes == "None":
                notes = f"结合历史学情优先处理：{focus_line}"
            else:
                notes = f"{notes}；结合历史学情优先处理：{focus_line}"

        return request.model_copy(
            update={
                "learner_profile": enriched_profile,
                "notes": notes,
            }
        )

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

            for judgment in skill_judgments:
                previous = updated_skills.get(judgment.skill_id)
                if previous is None:
                    previous = SkillState(
                        skill_id=judgment.skill_id,
                        display_name=judgment.display_name,
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

            self.repository.save_model(updated_record)
            self.repository.append_event(event)
            return updated_record, event
