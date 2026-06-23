"""Impure orchestration for S3.4 Ask mode (learner-initiated quick help).

Flag-gated, fail-open. The route calls answer_ask with a learner question; any
failure degrades to None so the endpoint never 500s and the session is never
blocked. Ask exchanges are logged to analysis_state['ask_log'] ONLY — never
learning_events (help != student production).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

ASK_MODEL = "gpt-5.4-mini-2026-03-17"
TRANSCRIPT_WINDOW = 4  # last ~2 exchanges of context for the learner's question
MAX_QUESTION_CHARS = 500


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def answer_ask(deps: Any, bootstrap: dict, uid: str, session_id: str, question: str,
               turn_index: int | None = None) -> dict | None:
    from backend.services.pedagogy.integration import ask_mode_enabled

    if not ask_mode_enabled():
        return None

    try:
        question = _s(question)[:MAX_QUESTION_CHARS]
        if not question or not (bootstrap and uid and session_id):
            return None

        from backend.services.practice_analytics import normalize_analysis_state
        from backend.services.pedagogy.ask import build_ask_prompt, parse_ask_answer, serialize_ask_answer

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

        transcript_ref = session.get("transcript_ref")
        chat_id = _s(transcript_ref.get("chat_id")) if isinstance(transcript_ref, dict) else ""
        window: list = []
        if chat_id:
            chat = deps.db.get_chat_session(uid, chat_id)
            messages = chat.get("messages") if isinstance(chat, dict) else None
            window = (messages if isinstance(messages, list) else [])[-TRANSCRIPT_WINDOW:]

        client = deps.get_openai_client()
        if client is None:
            return None

        feedback_policy = mapping.get("feedbackPolicy") if isinstance(mapping.get("feedbackPolicy"), dict) else {}
        scaffold_policy = mapping.get("scaffoldPolicy") if isinstance(mapping.get("scaffoldPolicy"), dict) else {}
        surface = "voice" if "voice" in str(session.get("modality") or "").lower() else "text"
        ui_language = _s(session.get("ui_language")) or "en"

        prompt_messages = build_ask_prompt(question, window, targets, feedback_policy,
                                           scaffold_policy, surface, ui_language)
        response = client.chat.completions.create(
            model=ASK_MODEL,
            messages=prompt_messages,
            reasoning_effort="high",
            response_format={"type": "json_object"},
        )
        answer = parse_ask_answer(json.loads(response.choices[0].message.content))
        if answer is None:
            return None

        serialized = serialize_ask_answer(answer)
        entry = {
            "question": question,
            **serialized,
            "turn_index": turn_index,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": ASK_MODEL,
        }
        # Re-read before write (S3.1 lesson) so a concurrent analysis_state write
        # that landed during the (slow) LLM call is not clobbered.
        fresh = deps.db.get_practice_session(session_id)
        target_state = (
            normalize_analysis_state(fresh.get("analysis_state"))
            if isinstance(fresh, dict) else normalize_analysis_state(session.get("analysis_state"))
        )
        ask_log = list(target_state.get("ask_log", []))
        ask_log.append(entry)
        target_state["ask_log"] = ask_log
        deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)
        return serialized
    except Exception:
        logger.exception("ask answer failed; degrading to no answer (session_id=%s)", session_id)
        return None
