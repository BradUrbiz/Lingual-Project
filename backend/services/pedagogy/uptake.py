"""Target uptake trace (Teacher FDE, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Classifies each lexical target PRODUCTION as after-prompt (the learner
self-repaired after an elicitation), after-recast (the tutor supplied the form
and the learner echoed it), or unprompted (no feedback in the lookback window —
the strongest signal). Derived from already-persisted ``learning_events`` via a
turn-proximity join; the DB read happens in the route layer.
"""

from __future__ import annotations

from typing import Any

_FEEDBACK_TYPES = {"feedback.recast", "feedback.elicitation"}
# Hit events carry the produced surface under different payload keys:
#   metric.target_expression_hit -> payload['expression']
#   metric.target_vocabulary_hit -> payload['word']
_HIT_SURFACE_KEY = {
    "metric.target_expression_hit": "expression",
    "metric.target_vocabulary_hit": "word",
}
_ZERO = {"afterPrompt": 0, "afterRecast": 0, "unprompted": 0}


def build_target_uptake(
    events: list[dict],
    target_surfaces: list[str],
    *,
    window: int = 2,
) -> dict[str, Any]:
    """Classify each lexical target production by the feedback that preceded it.

    Pure, total, no-raise. ``events`` is the assignment's persisted
    ``learning_events`` (feedback + hit events); ``target_surfaces`` are the
    lexical surfaces to score (expression + vocabulary). Malformed events are
    skipped. Productions are weighted by their payload ``count``.
    """
    surfaces = {s for s in (target_surfaces or []) if s}

    # Group by session: feedback moves vs. target hits.
    feedback_by_session: dict[Any, list[tuple[int, str]]] = {}
    hits_by_session: dict[Any, list[tuple[int, str, int]]] = {}

    for event in events or []:
        if not isinstance(event, dict):
            continue
        turn_index = event.get("turn_index")
        if not isinstance(turn_index, int):
            continue
        event_type = event.get("event_type")
        session_id = event.get("session_id")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if event_type in _FEEDBACK_TYPES:
            feedback_by_session.setdefault(session_id, []).append((turn_index, event_type))
        elif event_type in _HIT_SURFACE_KEY:
            surface = payload.get(_HIT_SURFACE_KEY[event_type])
            if surface not in surfaces:
                continue
            count = payload.get("count")
            count = count if isinstance(count, int) and count > 0 else 1
            hits_by_session.setdefault(session_id, []).append((turn_index, surface, count))

    totals = dict(_ZERO)
    per_surface: dict[str, dict[str, int]] = {}

    for session_id, hits in hits_by_session.items():
        feedback = feedback_by_session.get(session_id, [])
        for turn_index, surface, count in hits:
            kind = _classify(turn_index, feedback, window)
            totals[kind] += count
            bucket = per_surface.setdefault(surface, dict(_ZERO))
            bucket[kind] += count

    measured = totals["afterPrompt"] + totals["afterRecast"] + totals["unprompted"]

    # Order perTarget to match the realized table (target_surfaces order),
    # including only surfaces with >=1 production; dedupe defensively.
    seen: set = set()
    per_target: list[dict] = []
    for s in (target_surfaces or []):
        if s in per_surface and s not in seen:
            seen.add(s)
            per_target.append({"surface": s, **per_surface[s]})

    return {
        "window": window,
        "totals": {**totals, "measured": measured},
        "perTarget": per_target,
    }


def _classify(hit_turn: int, feedback: list[tuple[int, str]], window: int) -> str:
    """Nearest preceding feedback in ``[hit_turn - window, hit_turn - 1]`` decides.

    Recast wins a same-turn tie (the form was available -> conservatively NOT a
    self-repair). No feedback in the window -> ``unprompted``.
    """
    best_turn: int | None = None
    best_kind: str | None = None
    for turn_index, event_type in feedback:
        if not (hit_turn - window <= turn_index < hit_turn):
            continue
        if (
            best_turn is None
            or turn_index > best_turn
            or (turn_index == best_turn and event_type == "feedback.recast")
        ):
            best_turn = turn_index
            best_kind = event_type
    if best_kind == "feedback.elicitation":
        return "afterPrompt"
    if best_kind == "feedback.recast":
        return "afterRecast"
    return "unprompted"
