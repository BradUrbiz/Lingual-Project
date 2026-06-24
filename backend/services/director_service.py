# backend/services/director_service.py
"""Impure orchestration for S5 — the Director (between-turn drift re-steer).

Parallel to coach_chip_service but pure-heuristic (NO LLM): it reads the session
+ transcript, runs the pure detector (backend/services/pedagogy/drift.py), and on
sustained target-neglect returns a re-steer note for the route to deliver via the
proven voice (injectPromoteBack) / text (coachNote) channels. Fail-open: any
failure degrades to None so the live conversation is never blocked.

Independent of the chip's corrective-signal gate — tutor drift happens whether or
not the learner erred — so the Director runs on every between-turn trigger.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

TRANSCRIPT_WINDOW = 6  # last ~3 exchanges; matches coach_chip_service


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def assess_drift(deps: Any, bootstrap: dict, uid: str, session_id: str, turn_index: int) -> dict | None:
    from backend.services.pedagogy.integration import director_enabled

    if not director_enabled():
        return None

    try:
        if not (bootstrap and uid and session_id) or turn_index is None:
            return None

        from backend.services.practice_analytics import normalize_analysis_state
        from backend.services.pedagogy.drift import (
            build_resteer_prompt, decide_resteer, detect_target_neglect, serialize_resteer,
        )

        session = deps.db.get_practice_session(session_id)
        if not isinstance(session, dict):
            return None

        mapping = bootstrap.get("mapping") if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        # Concrete (substring-matchable) targets only — grammar labels excluded.
        concrete_targets = [
            *_string_list(mapping.get("targetExpressions")),
            *_string_list(mapping.get("targetVocabulary")),
        ]
        if not concrete_targets:
            return None

        analysis_state = normalize_analysis_state(session.get("analysis_state"))
        # Dedup: one assessment outcome per learner turn.
        for existing in analysis_state.get("resteers", []):
            if isinstance(existing, dict) and existing.get("turn_index") == turn_index:
                return existing

        # Recent tutor turns from the transcript (the synchronous source of truth;
        # analysis_state['recent_turns'] lags on the async event-rollup path).
        transcript_ref = session.get("transcript_ref")
        chat_id = _s(transcript_ref.get("chat_id")) if isinstance(transcript_ref, dict) else ""
        if not chat_id:
            return None
        chat = deps.db.get_chat_session(uid, chat_id)
        messages = chat.get("messages") if isinstance(chat, dict) else None
        messages = messages if isinstance(messages, list) else []
        recent_tutor_turns = [
            _s(m.get("content")) for m in messages[-TRANSCRIPT_WINDOW:]
            if isinstance(m, dict) and m.get("role") == "assistant"
        ]
        recent_tutor_turns = [t for t in recent_tutor_turns if t]

        verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)
        if not verdict.drift:
            return None

        decision, new_state = decide_resteer(analysis_state.get("director_state"), verdict, turn_index)
        if not decision.resteer:
            return None  # suppressed by cooldown/cap; state unchanged → nothing to persist

        surface = "voice" if "voice" in str(session.get("modality") or "").lower() else "text"

        # Re-read before write (S3.1 lesson): a concurrent analysis_state write
        # during this assessment must not be clobbered.
        fresh = deps.db.get_practice_session(session_id)
        target_state = (
            normalize_analysis_state(fresh.get("analysis_state"))
            if isinstance(fresh, dict) else analysis_state
        )
        for existing in target_state.get("resteers", []):
            if isinstance(existing, dict) and existing.get("turn_index") == turn_index:
                return existing

        generated_at = datetime.now(timezone.utc).isoformat()
        prompt = build_resteer_prompt(verdict, surface=surface)
        record = serialize_resteer(
            decision, turn_index=turn_index, surface=surface, prompt=prompt, generated_at=generated_at,
        )
        resteers = list(target_state.get("resteers", []))
        resteers.append(record)
        target_state["resteers"] = resteers
        target_state["director_state"] = new_state
        deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)

        return {
            "turn_index": turn_index,
            "surface": surface,
            "resteer": True,
            "resteer_prompt": prompt,
            "kind": verdict.kind,
            "target": verdict.target,
            "reason": verdict.reason,
            "generated_at": generated_at,
        }
    except Exception:
        logger.exception("director drift assessment failed; degrading to no re-steer "
                         "(session_id=%s, turn=%s)", session_id, turn_index)
        return None
