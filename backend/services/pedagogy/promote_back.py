"""Pure decision layer for S3.3 promote-back.

Stdlib only — no OpenAI/Canvas/resolver/compliance imports (import boundary,
invariant 7a). Decides whether a coach chip's error should be promoted into the
main conversation, from deterministic signals: a per-error-signature recurrence
counter, mode-modulated thresholds, and three over-promotion guards (cooldown,
per-session cap, reset-on-promote). The impure orchestration (persistence,
timing) lives in backend/services/coach_chip_service.py.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

DEFAULT_REPEAT_THRESHOLD = 2
PROMOTE_COOLDOWN_TURNS = 2
MAX_PROMOTIONS_BY_MODE = {"fluency_first": 2, "balanced": 3, "accuracy_first": 5}
DEFAULT_MAX_PROMOTIONS = 3
# (regular_delta, hard_target_delta) applied to the base threshold, by mode.
_THRESHOLD_DELTAS = {
    "accuracy_first": (-1, -2),
    "balanced": (0, -1),
    "fluency_first": (1, 0),
}


@dataclass(frozen=True)
class PromoteDecision:
    promote: bool
    signature: str
    reason: str  # "repeat" | "hard_target"


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def error_signature(chip: dict) -> str:
    """Stable per-error key. Prefer the assignment target surface; otherwise the
    normalized corrected form (accent-stripped, lowercased, whitespace-collapsed)."""
    target = _s(chip.get("target"))
    if target:
        return target
    folded = unicodedata.normalize("NFKD", _s(chip.get("better"))).encode("ascii", "ignore").decode("ascii")
    return " ".join(folded.lower().split())


def mode_threshold(feedback_policy: dict) -> tuple[int, int]:
    """(regular_threshold, hard_target_threshold) from the teacher knob + mode."""
    policy = feedback_policy if isinstance(feedback_policy, dict) else {}
    base = policy.get("elicitation_repeat_threshold")
    base = base if isinstance(base, int) and base >= 1 else DEFAULT_REPEAT_THRESHOLD
    mode = _s(policy.get("mode")) or "balanced"
    d_reg, d_hard = _THRESHOLD_DELTAS.get(mode, _THRESHOLD_DELTAS["balanced"])
    return max(1, base + d_reg), max(1, base + d_hard)


def _max_promotions(feedback_policy: dict) -> int:
    mode = _s((feedback_policy or {}).get("mode")) or "balanced"
    return MAX_PROMOTIONS_BY_MODE.get(mode, DEFAULT_MAX_PROMOTIONS)


def _normalize_state(state: object) -> dict:
    src = state if isinstance(state, dict) else {}
    raw_counts = src.get("counts")
    counts = (
        {str(k): int(v) for k, v in raw_counts.items() if isinstance(v, int)}
        if isinstance(raw_counts, dict) else {}
    )
    last = src.get("last_promoted_turn")
    promoted = src.get("promoted_count")
    return {
        "counts": counts,
        "last_promoted_turn": last if isinstance(last, int) else None,
        "promoted_count": promoted if isinstance(promoted, int) and promoted >= 0 else 0,
    }


def decide_promote_back(
    promote_state: object,
    chip: dict,
    feedback_policy: dict,
    turn_index: int,
) -> tuple[PromoteDecision, dict]:
    """Pure. Returns (decision, new_state); never mutates the input.

    Always counts the candidate. Promotes only when the recurrence count crosses
    the mode-modulated threshold AND the cooldown and per-session cap allow it.
    On promote: reset that signature's count, stamp the turn, bump the session
    count (the three orthogonal over-promotion guards)."""
    state = _normalize_state(promote_state)
    counts = dict(state["counts"])
    sig = error_signature(chip)
    counts[sig] = counts.get(sig, 0) + 1

    reason = "hard_target" if sig.startswith("focus_grammar:") else "repeat"
    reg_threshold, hard_threshold = mode_threshold(feedback_policy)
    threshold = hard_threshold if reason == "hard_target" else reg_threshold

    last = state["last_promoted_turn"]
    cooldown_ok = last is None or (turn_index - last) >= PROMOTE_COOLDOWN_TURNS
    cap_ok = state["promoted_count"] < _max_promotions(feedback_policy)

    if counts[sig] >= threshold and cooldown_ok and cap_ok:
        counts[sig] = 0  # reset-on-promote: must re-accumulate before promoting again
        return (
            PromoteDecision(promote=True, signature=sig, reason=reason),
            {"counts": counts, "last_promoted_turn": turn_index,
             "promoted_count": state["promoted_count"] + 1},
        )

    return (
        PromoteDecision(promote=False, signature=sig, reason=reason),
        {"counts": counts, "last_promoted_turn": last, "promoted_count": state["promoted_count"]},
    )


def build_promote_prompt(chip: dict, surface: str) -> str:
    """The in-character coach note handed to the main tutor (it phrases the
    self-repair in its own words). Hard-target (grammar) -> elicitation;
    lexical/expression -> brief recast. Terser on voice."""
    utterance = _s(chip.get("utterance"))
    better = _s(chip.get("better"))
    is_grammar = _s(chip.get("target")).startswith("focus_grammar:")

    lead = (
        f'COACH NOTE (deliver in your own words, in character, then continue the conversation): '
        f'The learner has repeatedly said "{utterance}". '
    )
    if is_grammar:
        body = f'Briefly invite them to self-correct toward "{better}" — elicit it, do not just give the answer.'
    else:
        body = f'Briefly model "{better}" for them and move on.'
    tail = " Keep it to one short sentence." if surface == "voice" else ""
    return lead + body + tail
