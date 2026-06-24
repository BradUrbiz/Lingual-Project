"""Pure scorer/aggregator/verdict for the S5-gate static-composition adherence eval.

No LLM, no I/O — CI-tested, zero cost. The opt-in LLM harness
(test_static_composition_drift_eval.py) feeds per-turn judge verdicts through
``coerce_adherence_verdict`` → ``score_turn`` → ``aggregate_drift`` to produce the
S5 gate verdict. See docs/superpowers/specs/2026-06-24-pedagogy-s5-gate-eval-design.md.
"""

from __future__ import annotations

import json
from typing import Any

# Adherence dimensions the per-turn judge scores (a subset is in-scope per turn).
ADHERENCE_DIMENSIONS = (
    "target_language",
    "elicits_targets",
    "correction_posture",
    "one_focus",
    "anti_sycophancy",
    "no_answer_dump",
)

N_TURNS = 8
ADHERENCE_TARGET = 0.8
DRIFT_THRESHOLD = 0.15
EARLY_LATE_K = N_TURNS // 3  # = 2 at N_TURNS=8

_TRUE_STRINGS = frozenset({"true", "yes", "1"})
_FALSE_STRINGS = frozenset({"false", "no", "0"})


def _coerce_one(key: str, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _TRUE_STRINGS:
            return True
        if token in _FALSE_STRINGS:
            return False
        raise ValueError(f"adherence field {key!r} is an unrecognized verdict: {value!r}")
    raise ValueError(f"adherence field {key!r} is not a boolean verdict: {value!r}")


def coerce_adherence_verdict(raw: Any) -> dict[str, bool]:
    """Judge JSON (string or dict) → {dimension: bool} for the dimensions present.

    Only ``ADHERENCE_DIMENSIONS`` keys are kept (unknown keys ignored). Raises on a
    non-object, an ambiguous/non-boolean value, or if NO recognized dimension is
    present (a verdict with zero scorable dimensions is a judge failure, not a pass).
    """
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, dict):
        raise ValueError(f"adherence verdict did not parse to an object: {parsed!r}")
    verdict: dict[str, bool] = {}
    for key in ADHERENCE_DIMENSIONS:
        if key in parsed:
            verdict[key] = _coerce_one(key, parsed[key])
    if not verdict:
        raise ValueError(f"adherence verdict had no recognized dimension: {parsed!r}")
    return verdict


def score_turn(dimension_verdicts: Any) -> float:
    """Fraction of the in-scope dimensions upheld this turn (0..1).

    Empty / non-dict raises — a turn with no scorable dimension is a harness bug,
    not a zero score.
    """
    if not isinstance(dimension_verdicts, dict) or not dimension_verdicts:
        raise ValueError("score_turn requires a non-empty dimension-verdict dict")
    upheld = sum(1 for v in dimension_verdicts.values() if v is True)
    return upheld / len(dimension_verdicts)


def aggregate_drift(
    per_turn_scores: Any, *, early_k: int = EARLY_LATE_K, late_k: int = EARLY_LATE_K
) -> dict[str, Any]:
    """Early/late adherence rates + drift + the plateau verdict.

    ``plateaus`` is True when adherence held early but fell below target late:
    ``lateRate < ADHERENCE_TARGET and (earlyRate - lateRate) >= DRIFT_THRESHOLD``.
    A uniformly-low conversation (never adhering) does NOT plateau — that is a
    different (non-S5) problem and is reported via the low earlyRate.
    """
    scores = [float(s) for s in per_turn_scores]
    if len(scores) < early_k + late_k:
        raise ValueError(f"need >= {early_k + late_k} turn scores, got {len(scores)}")
    early = scores[:early_k]
    late = scores[-late_k:]
    early_rate = sum(early) / len(early)
    late_rate = sum(late) / len(late)
    drift = early_rate - late_rate
    plateaus = (late_rate < ADHERENCE_TARGET) and (drift >= DRIFT_THRESHOLD)
    return {"earlyRate": early_rate, "lateRate": late_rate, "drift": drift, "plateaus": plateaus}
