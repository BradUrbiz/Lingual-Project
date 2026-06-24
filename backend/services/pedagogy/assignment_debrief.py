"""S4.2b — assignment-level teacher debrief roll-up (pure, stdlib-only).

Aggregates the AI tutor's COACHING-PROCESS signals — feedback uptake, S3.3
promote-back corrections, S5 director re-steers, Ask-mode help demand, and S4.1
affect — across all of an assignment's practice sessions. Content coverage /
expression hits / rubric scores are NOT here: the assignment analytics payload
owns those (see design spec §1-2). Calls build_session_debrief per record for
the teacher-safe coaching shapes; reads raw status / student uid / started_at
for the participation denominator.

Total / no-raise: malformed records degrade to empty sections; ``caveats`` is
always present. Import boundary (invariant 7a): stdlib only.
"""

from __future__ import annotations

from typing import Any

from backend.services.pedagogy.debrief import build_session_debrief, _ASK_KINDS, _CAVEATS, _d, _i, _l

MAX_SUGGESTIONS = 4
TOP_N = 10
_STRAINED = "strained"


def _sorted_by_target(counts: dict, session_counts: dict | None = None) -> list[dict]:
    """[{target,count[,sessionCount]}] sorted count desc then target asc, top N."""
    items = []
    for target, count in counts.items():
        entry = {"target": target, "count": count}
        if session_counts is not None:
            entry["sessionCount"] = len(session_counts.get(target, set()))
        items.append(entry)
    items.sort(key=lambda e: (-e["count"], e["target"]))
    return items[:TOP_N]


def _first_last_started(records: list) -> tuple[Any, Any]:
    values = [_d(r).get("started_at") for r in records]
    values = [v for v in values if v is not None]
    if not values:
        return None, None
    try:
        return min(values), max(values)
    except TypeError:
        return None, None


def _suggested_next(participation, promotions, affect, help_usage) -> list[str]:
    out: list[str] = []
    cluster = next((t for t in promotions["byTarget"] if t["sessionCount"] >= 2), None)
    if cluster:
        out.append(
            f"Multiple students needed correction on {cluster['target']} — "
            "consider a focused mini-lesson."
        )
    strained = affect["byReadiness"].get(_STRAINED, 0)
    if strained >= 2:
        out.append(
            f"{strained} sessions showed signs of strain — consider easing pace or difficulty."
        )
    sessions = max(participation["sessionCount"], 1)
    if help_usage["askCount"] >= 2 * sessions:
        out.append(
            "Students leaned on help often — the task may be above their current level."
        )
    if not out and participation["completedSessionCount"] > 0:
        out.append(
            "The class handled this assignment's targets well — consider advancing difficulty."
        )
    return out[:MAX_SUGGESTIONS]


def build_assignment_debrief(session_records: list) -> dict:
    """Aggregate practice_session records into an assignment-level coaching
    roll-up. Pure, stdlib-only, no DB/LLM/store. Total / no-raise. See the
    S4.2b design spec §3 for the full shape."""
    records = _l(session_records)

    assignment_id = None
    completed = 0
    students: set[str] = set()

    uptake = {"selfCorrectionCount": 0,
              "feedbackCounts": {"recast": 0, "elicitation": 0, "reviewItem": 0},
              "taskCompletionCount": 0}
    promo_counts: dict[str, int] = {}
    promo_sessions: dict[str, set] = {}
    promo_total = 0
    resteer_total = 0
    resteer_by_kind: dict[str, int] = {}
    resteer_by_target: dict[str, int] = {}
    ask_total = 0
    ask_by_kind = {k: 0 for k in _ASK_KINDS}
    sessions_with_help = 0
    affect_by_readiness: dict[str, int] = {}
    affect_sessions = 0
    coach_review_sessions = 0

    for idx, raw in enumerate(records):
        rec = _d(raw)
        if assignment_id is None and rec.get("assignment_id"):
            assignment_id = rec.get("assignment_id")
        if rec.get("status") == "completed":
            completed += 1
        # Serialized practice_session records use the Firestore key "student_uid"
        # (analytics_reads._serialize_session renames the PG column
        # student_firebase_uid -> student_uid; the class-analytics route reads the
        # same key). Reading the PG column name here yields no UID -> studentCount 0.
        uid = rec.get("student_uid")
        if isinstance(uid, str) and uid:
            students.add(uid)

        sd = build_session_debrief(rec)  # total/no-raise

        up = sd["uptake"]
        uptake["selfCorrectionCount"] += _i(up["selfCorrectionCount"])
        for k in ("recast", "elicitation", "reviewItem"):
            uptake["feedbackCounts"][k] += _i(up["feedbackCounts"][k])
        uptake["taskCompletionCount"] += _i(up["taskCompletionCount"])

        seen_targets_this_session: set[str] = set()
        for it in _l(sd["promotions"].get("items")):
            target = str(_d(it).get("target") or "")
            if not target:
                continue
            promo_total += 1
            promo_counts[target] = promo_counts.get(target, 0) + 1
            promo_sessions.setdefault(target, set())
            seen_targets_this_session.add(target)
        for t in seen_targets_this_session:
            promo_sessions[t].add(idx)

        for it in _l(sd["directorReSteers"].get("items")):
            resteer_total += 1
            kind = str(_d(it).get("kind") or "")
            if kind:
                resteer_by_kind[kind] = resteer_by_kind.get(kind, 0) + 1
            target = str(_d(it).get("target") or "")
            if target:
                resteer_by_target[target] = resteer_by_target.get(target, 0) + 1

        hu = sd["helpUsage"]
        n_ask = _i(hu.get("askCount"))
        ask_total += n_ask
        if n_ask > 0:
            sessions_with_help += 1
        for k in _ASK_KINDS:
            ask_by_kind[k] += _i(_d(hu.get("byKind")).get(k))

        af = sd["affect"]
        if isinstance(af, dict):
            readiness = af.get("readiness")
            if isinstance(readiness, str) and readiness:
                affect_by_readiness[readiness] = affect_by_readiness.get(readiness, 0) + 1
            affect_sessions += 1

        if isinstance(sd["coachReview"], dict):
            coach_review_sessions += 1

    first_started, last_started = _first_last_started(records)
    participation = {
        "sessionCount": len(records),
        "completedSessionCount": completed,
        "studentCount": len(students),
        "firstStartedAt": first_started,
        "lastStartedAt": last_started,
    }
    promotions = {"count": promo_total, "byTarget": _sorted_by_target(promo_counts, promo_sessions)}
    director_resteers = {
        "count": resteer_total,
        "byKind": dict(resteer_by_kind),
        "byTarget": _sorted_by_target(resteer_by_target),
    }
    help_usage = {"askCount": ask_total, "byKind": ask_by_kind, "sessionsWithHelp": sessions_with_help}
    affect = {"byReadiness": dict(affect_by_readiness), "sessionsWithSignal": affect_sessions}

    caveats = list(_CAVEATS)
    caveats.append(
        f"This roll-up aggregates {participation['sessionCount']} session(s) across "
        f"{participation['studentCount']} student(s); per-student detail is in each session debrief."
    )

    return {
        "assignmentId": assignment_id,
        "participation": participation,
        "uptake": uptake,
        "promotions": promotions,
        "directorReSteers": director_resteers,
        "helpUsage": help_usage,
        "affect": affect,
        "coachReview": {"sessionCount": coach_review_sessions},
        "suggestedNext": _suggested_next(participation, promotions, affect, help_usage),
        "caveats": caveats,
    }
