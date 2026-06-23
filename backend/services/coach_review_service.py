"""Impure orchestration for the S3.1 post-task coach review.

Generate-on-read: the route calls ``generate_coach_review`` when a learner opens
their review. It is gated, cached, and fail-open — any failure degrades to
``None`` so the endpoint never 500s and the session is never blocked.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

COACH_REVIEW_MODEL = "gpt-5.4-mini-2026-03-17"
MIN_LEARNER_TURNS = 1


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def _surface_from_modality(modality: object) -> str:
    return "voice" if "voice" in str(modality or "").lower() else "text"


def generate_coach_review(deps: Any, bootstrap: dict, uid: str, session_id: str) -> dict | None:
    # Lazy imports keep the OpenAI/analytics surface off this module's import line
    # until the flag is on, mirroring the S2 coverage helper.
    from backend.services.pedagogy.integration import coach_review_enabled

    if not coach_review_enabled():
        return None

    try:
        if not (bootstrap and uid and session_id):
            return None

        from backend.services.practice_analytics import normalize_analysis_state
        from backend.services.pedagogy.coach_review import (
            build_coach_review_prompt,
            parse_coach_review,
            serialize_coach_review,
        )

        session = deps.db.get_practice_session(session_id)
        if not isinstance(session, dict):
            return None

        analysis_state = normalize_analysis_state(session.get("analysis_state"))
        cached = analysis_state.get("coach_review")
        if isinstance(cached, dict):
            return cached

        mapping = bootstrap.get("mapping") if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        targets = [
            *_string_list(mapping.get("targetExpressions")),
            *_string_list(mapping.get("targetVocabulary")),
            *_string_list(mapping.get("focusGrammar")),
        ]
        # No engine targets => raw-tutor / free-chat (no pedagogy guarantees). Skip,
        # matching the S2 coverage helper's `if not targets: return None` gate.
        if not targets:
            return None

        transcript_ref = session.get("transcript_ref")
        chat_id = _s(transcript_ref.get("chat_id")) if isinstance(transcript_ref, dict) else ""
        if not chat_id:
            return None

        chat = deps.db.get_chat_session(uid, chat_id)
        messages = chat.get("messages") if isinstance(chat, dict) else None
        messages = messages if isinstance(messages, list) else []
        learner_turns = [
            m for m in messages
            if isinstance(m, dict) and m.get("role") == "user" and _s(m.get("content"))
        ]
        if len(learner_turns) < MIN_LEARNER_TURNS:
            return None

        client = deps.get_openai_client()
        if client is None:
            return None

        feedback_policy = mapping.get("feedbackPolicy") if isinstance(mapping.get("feedbackPolicy"), dict) else {}
        feedback_mode = _s(feedback_policy.get("mode")) or "balanced"
        surface = _surface_from_modality(session.get("modality"))
        ui_language = _s(session.get("ui_language")) or "en"

        prompt_messages = build_coach_review_prompt(messages, targets, feedback_policy, surface, ui_language)
        response = client.chat.completions.create(
            model=COACH_REVIEW_MODEL,
            messages=prompt_messages,
            reasoning_effort="high",
            response_format={"type": "json_object"},
        )
        raw = json.loads(response.choices[0].message.content)
        review = parse_coach_review(raw, feedback_mode=feedback_mode, surface=surface, known_targets=targets)
        if review.is_empty():
            return None

        serialized = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": COACH_REVIEW_MODEL,
            **serialize_coach_review(review),
        }
        # Re-read the session immediately before the write so a concurrent
        # analysis_state write that landed during the (slow, multi-second) LLM call
        # is not clobbered by the stale pre-call snapshot — merge coach_review into
        # the freshest copy. This is not a fully atomic JSONB sub-key merge (that is
        # a documented follow-up), but it collapses the clobber window from the whole
        # LLM call to the microseconds between this re-read and the write, preserving
        # S2 coverage / recent_turns that another path may have updated meanwhile.
        fresh = deps.db.get_practice_session(session_id)
        target_state = (
            normalize_analysis_state(fresh.get("analysis_state"))
            if isinstance(fresh, dict)
            else analysis_state
        )
        target_state["coach_review"] = serialized
        deps.db.update_practice_session(session_id, {"analysis_state": target_state}, sql_engine=deps.sql_engine)
        return serialized
    except Exception:
        logger.exception("coach review generation failed; degrading to no review (session_id=%s)", session_id)
        return None
