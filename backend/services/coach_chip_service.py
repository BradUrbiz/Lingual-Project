"""Impure orchestration for the S3.2 live between-turn coach chip.

Per-turn analog of coach_review_service: heuristic-gated, persisted, fail-open.
The route calls generate_coach_chip after a learner exchange; any failure degrades
to None so the endpoint never 500s and the live conversation is never blocked.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

COACH_CHIP_MODEL = "gpt-5.4-mini-2026-03-17"
TRANSCRIPT_WINDOW = 6  # last ~3 exchanges of context for the latest learner turn
CORRECTIVE_EVENT_TYPES = {
    "feedback.recast", "feedback.elicitation", "feedback.review_item",
    # metric.error_detected fires on the FIRST learner slip (marker-independent),
    # so the chip can surface on turn 1 instead of waiting for the error to recur
    # (metric.repeated_error needs >=2) or for the tutor's recast to match a marker
    # phrase. metric.repeated_error stays in the set so a repeat still opens the
    # gate even when the per-turn error detector misses the first occurrence.
    "metric.error_detected", "metric.repeated_error",
}


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def _turn_had_corrective_signal(events: object, turn_index: int) -> bool:
    """A corrective signal at the learner turn N (metric.error_detected on the
    first slip, or metric.repeated_error on a recurrence) or at the tutor's
    response at N+1 (feedback.recast/elicitation/review_item) opens the gate."""
    if not isinstance(events, list):
        return False
    window = {turn_index, turn_index + 1}
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("turn_index") in window and e.get("event_type") in CORRECTIVE_EVENT_TYPES:
            return True
    return False


def generate_coach_chip(deps: Any, bootstrap: dict, uid: str, session_id: str, turn_index: int) -> dict | None:
    from backend.services.pedagogy.integration import coach_chips_enabled

    if not coach_chips_enabled():
        return None

    try:
        if not (bootstrap and uid and session_id) or turn_index is None:
            return None

        from backend.services.practice_analytics import normalize_analysis_state
        from backend.services.pedagogy.coach_review import (
            build_coach_chip_prompt, parse_coach_chip, serialize_coach_chip,
        )

        session = deps.db.get_practice_session(session_id)
        if not isinstance(session, dict):
            return None

        mapping = bootstrap.get("mapping") if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        targets = [
            *_string_list(mapping.get("targetExpressions")),
            *_string_list(mapping.get("targetVocabulary")),
            *_string_list(mapping.get("focusGrammar")),
        ]
        if not targets:
            return None

        # Dedup: one chip per learner turn.
        analysis_state = normalize_analysis_state(session.get("analysis_state"))
        for existing in analysis_state.get("coach_chips", []):
            if isinstance(existing, dict) and existing.get("turn_index") == turn_index:
                return existing

        # Heuristic gate: spend an LLM call only when this exchange flagged something.
        events = deps.db.list_session_learning_events(session_id)
        if not _turn_had_corrective_signal(events, turn_index):
            return None

        transcript_ref = session.get("transcript_ref")
        chat_id = _s(transcript_ref.get("chat_id")) if isinstance(transcript_ref, dict) else ""
        if not chat_id:
            return None
        chat = deps.db.get_chat_session(uid, chat_id)
        messages = chat.get("messages") if isinstance(chat, dict) else None
        messages = messages if isinstance(messages, list) else []
        window = messages[-TRANSCRIPT_WINDOW:]
        if not window:
            return None

        client = deps.get_openai_client()
        if client is None:
            return None

        feedback_policy = mapping.get("feedbackPolicy") if isinstance(mapping.get("feedbackPolicy"), dict) else {}
        surface = "voice" if "voice" in str(session.get("modality") or "").lower() else "text"
        ui_language = _s(session.get("ui_language")) or "en"

        prompt_messages = build_coach_chip_prompt(window, targets, feedback_policy, surface, ui_language)
        response = client.chat.completions.create(
            model=COACH_CHIP_MODEL,
            messages=prompt_messages,
            reasoning_effort="high",
            response_format={"type": "json_object"},
        )
        item = parse_coach_chip(json.loads(response.choices[0].message.content),
                                surface=surface, known_targets=targets)
        if item is None:
            return None

        serialized = {
            "turn_index": turn_index,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": COACH_CHIP_MODEL,
            "surface": surface,
            **serialize_coach_chip(item),
        }
        # Re-read before write (S3.1 lesson) so a concurrent analysis_state write
        # that landed during the (slow, multi-second) LLM call is not clobbered.
        fresh = deps.db.get_practice_session(session_id)
        target_state = (
            normalize_analysis_state(fresh.get("analysis_state"))
            if isinstance(fresh, dict) else analysis_state
        )
        chips = list(target_state.get("coach_chips", []))
        if any(isinstance(c, dict) and c.get("turn_index") == turn_index for c in chips):
            return next(c for c in chips if isinstance(c, dict) and c.get("turn_index") == turn_index)

        # S3.3 promote-back: deterministic decision rides this same analysis_state write.
        # Fail-open: a decision failure keeps the chip, just without promotion.
        from backend.services.pedagogy.integration import promote_back_enabled
        if promote_back_enabled():
            try:
                from backend.services.pedagogy.promote_back import decide_promote_back, build_promote_prompt
                decision, new_promote_state = decide_promote_back(
                    target_state.get("promote_back_state"), serialized, feedback_policy, turn_index,
                )
                target_state["promote_back_state"] = new_promote_state
                if decision.promote:
                    promote_prompt = build_promote_prompt(serialized, surface)
                    serialized["promote"] = True
                    serialized["promote_prompt"] = promote_prompt
                    serialized["promote_reason"] = decision.reason
                    promotions = list(target_state.get("promotions", []))
                    promotions.append({
                        "turn_index": turn_index,
                        "signature": decision.signature,
                        "reason": decision.reason,
                        "prompt": promote_prompt,
                        "generated_at": serialized["generated_at"],
                    })
                    target_state["promotions"] = promotions
            except Exception:
                logger.exception("promote-back decision failed; chip kept without promotion "
                                 "(session_id=%s, turn=%s)", session_id, turn_index)

        chips.append(serialized)
        target_state["coach_chips"] = chips
        deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)
        return serialized
    except Exception:
        logger.exception("coach chip generation failed; degrading to no chip (session_id=%s, turn=%s)",
                         session_id, turn_index)
        return None
