"""Voice fidelity gap measurement (Teacher FDE, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Estimates how much the realized/uptake signal UNDER-COUNTS voice production, so
we can decide whether a voice-fidelity fix is worth building before the
teacher-facing modality split. Derived from already-persisted ``learning_events``;
the DB read happens in the route layer.

Two loss mechanisms:
  - substring-miss: the exact matcher misses a target on ASR text. Estimated by a
    fuzzy pass over voice turns vs. production's OWN exact-hit events (so we never
    re-implement the exact matcher). A ceiling (fuzzy admits false positives).
  - ASR dropout: spoken turns with no transcript, counted from
    ``metric.voice_transcript_lost`` markers. A forward-looking floor.
Also attributes each production to voice/text via a per-turn ``payload.source``
self-join (the data core the eventual split reuses).
"""

from __future__ import annotations

import difflib
import re
from typing import Any

_HIT_SURFACE_KEY = {
    "metric.target_expression_hit": "expression",
    "metric.target_vocabulary_hit": "word",
}
_DROPOUT_TYPE = "metric.voice_transcript_lost"
_STUDENT_TURN = "student.turn"
_VOICE_SOURCE = "realtime"
_TEXT_SOURCE = "text"

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _fuzzy_hit(target_tokens: list[str], turn_tokens: list[str], threshold: float) -> bool:
    """True if some N-token window of the turn ~matches the target (N = len target).

    difflib ratio over joined token windows: tolerant of ASR spelling/boundary drift
    while still requiring the right span. Pure, stdlib-only.
    """
    n = len(target_tokens)
    if n == 0 or len(turn_tokens) < n:
        return False
    target_join = " ".join(target_tokens)
    for i in range(len(turn_tokens) - n + 1):
        window = " ".join(turn_tokens[i:i + n])
        if difflib.SequenceMatcher(None, target_join, window).ratio() >= threshold:
            return True
    return False


def build_voice_fidelity(
    events: list[dict],
    target_surfaces: list[str],
    *,
    fuzzy_threshold: float = 0.85,
) -> dict[str, Any]:
    """Estimate the voice under-count from persisted events. Pure, total, no-raise."""
    surfaces = [s for s in (target_surfaces or []) if s]
    surface_set = set(surfaces)

    voice_turns: dict[tuple, str] = {}          # (session_id, turn_index) -> voice content
    source_by_turn: dict[tuple, str] = {}       # (session_id, turn_index) -> 'realtime'/'text'
    exact_by_turn: dict[tuple, set] = {}        # (session_id, turn_index) -> {surface}
    hits: list[tuple] = []                       # (session_id, turn_index, surface, count)
    dropout_turns = 0

    for event in events or []:
        if not isinstance(event, dict):
            continue
        event_type = event.get("event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if event_type == _DROPOUT_TYPE:
            dropout_turns += 1
            continue

        turn_index = event.get("turn_index")
        if not isinstance(turn_index, int):
            continue
        key = (event.get("session_id"), turn_index)

        if event_type == _STUDENT_TURN:
            source = payload.get("source")
            if isinstance(source, str):
                source_by_turn[key] = source
            if source == _VOICE_SOURCE:
                content = payload.get("content")
                voice_turns[key] = content if isinstance(content, str) else ""
        elif event_type in _HIT_SURFACE_KEY:
            surface = payload.get(_HIT_SURFACE_KEY[event_type])
            if surface not in surface_set:
                continue
            count = payload.get("count")
            count = count if isinstance(count, int) and count > 0 else 1
            hits.append((key[0], turn_index, surface, count))
            exact_by_turn.setdefault(key, set()).add(surface)

    # Modality attribution over productions (count-weighted).
    modality = {"voice": 0, "text": 0, "unknown": 0}
    per_surface: dict[str, dict[str, int]] = {}
    for session_id, turn_index, surface, count in hits:
        src = source_by_turn.get((session_id, turn_index))
        bucket = "voice" if src == _VOICE_SOURCE else "text" if src == _TEXT_SOURCE else "unknown"
        modality[bucket] += count
        ps = per_surface.setdefault(surface, {"voice": 0, "text": 0, "substringMiss": 0})
        if bucket in ps:
            ps[bucket] += count

    # Substring-miss: fuzzy catch on a voice turn where the exact matcher recorded no hit.
    substring_miss = 0
    tokenized = {s: _tokens(s) for s in surface_set}
    for key, content in voice_turns.items():
        turn_tokens = _tokens(content)
        exact_here = exact_by_turn.get(key, set())
        for surface in surface_set:
            if surface in exact_here:
                continue
            if _fuzzy_hit(tokenized[surface], turn_tokens, fuzzy_threshold):
                substring_miss += 1
                ps = per_surface.setdefault(surface, {"voice": 0, "text": 0, "substringMiss": 0})
                ps["substringMiss"] += 1

    seen: set = set()
    per_target: list[dict] = []
    for s in surfaces:
        if s in seen or s not in per_surface:
            continue
        ps = per_surface[s]
        if ps["voice"] or ps["text"] or ps["substringMiss"]:
            seen.add(s)
            per_target.append({"surface": s, **ps})

    return {
        "fuzzyThreshold": fuzzy_threshold,
        "voiceTurns": len(voice_turns),
        "modalitySplit": modality,
        "substringMissEstimate": substring_miss,
        "dropoutTurns": dropout_turns,
        "perTarget": per_target,
    }
