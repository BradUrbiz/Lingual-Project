"""S4.1 — affect / readiness heuristic (pure, stdlib-only).

Derives a coarse readiness tier from a student's RECENT prior-session signals
(turn-length trend, repair density, recent abandonment) and produces the
gentler tutor-stance lines used when the learner is strained. Heuristic, NOT
model-verified affect (mirrors the S2 coverage-tier caveat).

Import boundary (invariant 7a): stdlib + dataclasses only — no OpenAI/Canvas/
resolver/compliance. Verified by test_pedagogy_engine_s1.ImportBoundaryTestCase.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Heuristic constants (tunable; frozen in tests).
AFFECT_WINDOW_SESSIONS = 3
MIN_SESSIONS_FOR_AFFECT = 2
REPAIR_DENSITY_HIGH = 0.6
ABANDONMENT_STRAIN_MIN = 2
TURN_TREND_FALL_RATIO = 0.7

READINESS_SETTLED = "settled"
READINESS_NEUTRAL = "neutral"
READINESS_STRAINED = "strained"


@dataclass(frozen=True)
class AffectState:
    """Coarse readiness read. ``readiness`` drives the L5 stance modulation."""

    readiness: str  # settled | neutral | strained
    signals: dict[str, Any]
    reason: str


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _i(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _turn_length_trend(signals: list[dict]) -> str:
    """'falling' | 'rising' | 'flat' | 'unknown' from avg_words, most-recent-first."""
    avgs = [_f(s.get("avg_words")) for s in signals]
    if len(avgs) < 2 or any(a <= 0 for a in avgs):
        return "unknown"
    latest = avgs[0]
    earlier = avgs[1:]
    earlier_mean = sum(earlier) / len(earlier)
    if earlier_mean <= 0:
        return "unknown"
    if latest < TURN_TREND_FALL_RATIO * earlier_mean:
        return "falling"
    if latest > earlier_mean:
        return "rising"
    return "flat"


def _repair_density(signals: list[dict]) -> str:
    """'low' | 'moderate' | 'high' | 'unknown' — window-mean repairs per turn."""
    if not signals:
        return "unknown"
    densities = [_f(s.get("repair_count")) / max(_i(s.get("turn_count")), 1) for s in signals]
    mean = sum(densities) / len(densities)
    if mean > REPAIR_DENSITY_HIGH:
        return "high"
    if mean <= REPAIR_DENSITY_HIGH / 2:  # <= 0.3
        return "low"
    return "moderate"


def compute_affect_state(session_signals: list[dict]) -> AffectState:
    """Deterministic readiness read over the most-recent prior-session signals.

    ``session_signals`` is MOST-RECENT-FIRST; each item =
    ``{"avg_words": float, "repair_count": int, "turn_count": int, "abandoned": bool}``.
    Neutral on insufficient (< MIN_SESSIONS_FOR_AFFECT) or mixed signal.
    """
    window = [s for s in (session_signals or []) if isinstance(s, dict)][:AFFECT_WINDOW_SESSIONS]
    seen = len(window)
    if seen < MIN_SESSIONS_FOR_AFFECT:
        return AffectState(
            readiness=READINESS_NEUTRAL,
            signals={
                "turn_length_trend": "unknown",
                "repair_density": "unknown",
                "abandonment_recent": 0,
                "prior_sessions_seen": seen,
            },
            reason="insufficient prior sessions",
        )

    trend = _turn_length_trend(window)
    repair = _repair_density(window)
    abandonment = sum(1 for s in window if bool(s.get("abandoned")))
    signals = {
        "turn_length_trend": trend,
        "repair_density": repair,
        "abandonment_recent": abandonment,
        "prior_sessions_seen": seen,
    }

    strain_reasons: list[str] = []
    if trend == "falling":
        strain_reasons.append("falling turn length")
    if repair == "high":
        strain_reasons.append("high repair density")
    if abandonment >= ABANDONMENT_STRAIN_MIN:
        strain_reasons.append(f"{abandonment} recent abandonments")
    if strain_reasons:
        return AffectState(READINESS_STRAINED, signals, "; ".join(strain_reasons))

    if trend in {"flat", "rising"} and repair == "low" and abandonment == 0:
        return AffectState(READINESS_SETTLED, signals, "stable engagement, low repair")

    return AffectState(READINESS_NEUTRAL, signals, "mixed signals")


def affect_stance_lines(affect: AffectState, *, correction_light: bool = False) -> list[str]:
    """Gentler tutor-stance lines for a strained learner; [] otherwise.

    A bounded nudge: it never silences correction the teacher asked for. When
    ``correction_light`` is on a separate coach already owns correction, so the
    correction-softening line is dropped to avoid contradicting it.
    """
    if affect is None or getattr(affect, "readiness", None) != READINESS_STRAINED:
        return []
    lines = [
        "The learner has shown signs of strain recently (low readiness): be warm and "
        "patient, lead with brief encouragement, and allow extra silence before stepping in.",
        "Accept shorter learner turns right now; do not press for long production.",
    ]
    if not correction_light:
        lines.append(
            "Soften correction while readiness is low: prefer a gentle recast even on grammar "
            "targets and wait longer before escalating to explicit prompting "
            "(still address errors that block meaning)."
        )
    return lines


def serialize_affect_state(affect: AffectState) -> dict[str, Any]:
    """JSON-able snapshot for ``analysis_state['affect_state']``."""
    return {"readiness": affect.readiness, "signals": dict(affect.signals), "reason": affect.reason}
