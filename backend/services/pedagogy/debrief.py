"""S4.2 — teacher debrief presenter (pure, stdlib-only).

Projects an already-fetched practice_session record into a teacher-facing,
read-only debrief. It assembles EXISTING evidence (analysis_state +
session_summary) — it never mints new claims, calls no model, and writes
nothing. Total / no-raise: malformed sub-objects degrade to empty sections;
the honesty ``caveats`` list is always present.

Import boundary (invariant 7a): stdlib only. Verified by
test_pedagogy_engine_s1.ImportBoundaryTestCase.
"""

from __future__ import annotations

from typing import Any

MAX_SUGGESTIONS = 4
_ASK_KINDS = ("hint", "translation", "definition", "clarification", "phrase", "refusal")

_CAVEATS = [
    "This debrief summarizes the practice transcript. Target and error detection is "
    "heuristic, not graded scoring.",
    "Pronunciation and listening accuracy were not separately assessed.",
    "Help requests are shown as usage counts, not as evidence the learner produced the form.",
]


def _d(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _l(value: Any) -> list:
    return value if isinstance(value, list) else []


def _i(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _coverage(analysis_state: dict, summary: dict) -> dict:
    cov = _d(analysis_state.get("coverage"))
    return {
        "expressionHits": _d(summary.get("target_expression_hits")),
        "vocabularyHits": _d(summary.get("target_vocabulary_hits")),
        "uncovered": [s for s in _l(cov.get("uncovered")) if isinstance(s, str)],
        "recycle": [s for s in _l(cov.get("recycle")) if isinstance(s, str)],
    }


def _uptake(summary: dict) -> dict:
    fc = _d(summary.get("feedback_counts"))
    return {
        "selfCorrectionCount": _i(summary.get("self_correction_count")),
        "feedbackCounts": {
            "recast": _i(fc.get("recast")),
            "elicitation": _i(fc.get("elicitation")),
            "reviewItem": _i(fc.get("review_item")),
        },
        "taskCompletionCount": _i(summary.get("task_completion_count")),
    }


def _repeated_errors(summary: dict) -> list[dict]:
    counts = _d(summary.get("repeated_error_counts"))
    items = [{"label": str(k), "count": _i(v)} for k, v in counts.items() if _i(v) > 0]
    items.sort(key=lambda e: e["count"], reverse=True)
    return items


def _help_usage(analysis_state: dict) -> dict:
    log = _l(analysis_state.get("ask_log"))
    by_kind = {k: 0 for k in _ASK_KINDS}
    for entry in log:
        kind = _d(entry).get("kind")
        if kind in by_kind:
            by_kind[kind] += 1
    return {"askCount": len(log), "byKind": by_kind}


def _affect(analysis_state: dict) -> dict | None:
    affect = analysis_state.get("affect_state")
    if not isinstance(affect, dict):
        return None
    return {"readiness": affect.get("readiness"), "reason": affect.get("reason")}


def _coach_review(analysis_state: dict) -> dict | None:
    review = analysis_state.get("coach_review")
    return review if isinstance(review, dict) else None


def _suggested_next(coverage: dict, repeated_errors: list[dict], coach_review: dict | None) -> list[str]:
    out: list[str] = []
    if coverage["uncovered"]:
        out.append("Revisit targets not yet used: " + ", ".join(coverage["uncovered"][:3]) + ".")
    for err in repeated_errors[:2]:
        out.append(f"Focus on a recurring issue: {err['label']}.")
    if coach_review:
        for item in _l(coach_review.get("work_on"))[:2]:
            target = _d(item).get("target") or _d(item).get("why")
            if isinstance(target, str) and target.strip():
                out.append(f"Practice: {target}.")
    if coverage["recycle"]:
        out.append("Reinforce emerging targets: " + ", ".join(coverage["recycle"][:3]) + ".")
    # de-dup, stable order, cap
    seen: set[str] = set()
    deduped = []
    for s in out:
        if s not in seen:
            seen.add(s)
            deduped.append(s)
    return deduped[:MAX_SUGGESTIONS]


def build_session_debrief(session_record: Any) -> dict:
    """Project a practice_session record into a read-only teacher debrief dict.

    Total / no-raise: any malformed input degrades to empty sections; ``caveats``
    is always present. See the S4.2 design doc §3 for the full shape.
    """
    record = _d(session_record)
    analysis_state = _d(record.get("analysis_state"))
    summary = _d(record.get("session_summary"))

    coverage = _coverage(analysis_state, summary)
    repeated_errors = _repeated_errors(summary)
    coach_review = _coach_review(analysis_state)

    return {
        "sessionId": record.get("id"),
        "status": record.get("status"),
        "startedAt": record.get("started_at"),
        "endedAt": record.get("ended_at"),
        "coverage": coverage,
        "uptake": _uptake(summary),
        "repeatedErrors": repeated_errors,
        "coachReview": coach_review,
        "promotions": _l(analysis_state.get("promotions")),
        "helpUsage": _help_usage(analysis_state),
        "affect": _affect(analysis_state),
        "suggestedNext": _suggested_next(coverage, repeated_errors, coach_review),
        "caveats": list(_CAVEATS),
    }
