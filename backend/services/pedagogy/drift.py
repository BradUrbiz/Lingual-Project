"""Pure detection + decision layer for S5 — the Director (between-turn re-steer).

Stdlib only — no OpenAI/Canvas/resolver/compliance imports (import boundary,
invariant 7a). Detects tutor instruction-adherence drift from the recent tutor
turns and decides whether to act, from deterministic signals only. v1 covers one
robust, locale-agnostic signal: TARGET-NEGLECT (the tutor spending a window of
consecutive turns without working toward any concrete assignment target). The
impure orchestration (session/transcript reads, persistence) lives in
backend/services/director_service.py.

INDEPENDENT of the offline S5-gate eval scorer (backend/tests/eval/adherence_drift.py):
the live detector is a heuristic; the offline scorer is an LLM-judge aggregator.
They share no code.
"""

from __future__ import annotations

from dataclasses import dataclass
import re

from backend.services.pedagogy.language_signal import (
    ENGLISH_FUNCTION_WORDS as _ENGLISH_FUNCTION_WORDS,
    is_target_script_char as _is_target_script_char,
    language_locale_key as _drift_locale_key,
)

# A target is "neglected" when this many consecutive recent tutor turns reference
# no concrete target. A window (not a single turn) so a brief on-task digression
# (rapport, a clarifying question) is not mistaken for drift.
DRIFT_WINDOW = 3
# Over-nagging guards (mirror promote_back's cooldown + per-session cap).
DIRECTOR_COOLDOWN_TURNS = 4
DIRECTOR_MAX_RESTEERS = 3

# Language-drift: the tutor should speak the target language but slipped into the L1
# (English). Non-Latin targets are judged by target-script ratio (robust); Latin-script
# targets by distinctly-English function-word density (conservative heuristic).
LANGUAGE_DRIFT_MIN_CHARS = 12   # ignore very short turns (greetings, names) — too little signal
TARGET_SCRIPT_MIN_RATIO = 0.5   # non-Latin: < this fraction of letters in target script → drift
ENGLISH_MARKER_MIN_HITS = 3     # Latin: >= this many distinct English function words → drift

# Target-language display names (used in the language-drift re-steer copy).
_LANGUAGE_NAMES = {"ko": "Korean", "ru": "Russian", "he": "Hebrew",
                   "es": "Spanish", "fr": "French", "tl": "Tagalog"}
_NON_LATIN_DRIFT_KEYS = frozenset({"ko", "ru", "he"})
# Latin-script targets (es/fr/tl) take the English-function-word tier — reached as the
# `else` branch in detect_language_drift after en/unknown are filtered by the no-lang guard.


@dataclass(frozen=True)
class DriftVerdict:
    drift: bool
    kind: str  # "target_neglect" | "language_drift" | "none"
    target: str  # the target to steer back toward ("" when no drift)
    reason: str


@dataclass(frozen=True)
class ResteerDecision:
    resteer: bool
    reason: str
    target: str
    signature: str


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def detect_target_neglect(
    recent_tutor_turns: list[str],
    concrete_targets: list[str],
    *,
    window: int = DRIFT_WINDOW,
) -> DriftVerdict:
    """Pure. Drift when the last `window` tutor turns reference no concrete target.

    Concrete targets are expression/vocabulary surfaces (substring-matchable);
    grammar labels must NOT be passed here. Matching is case-insensitive.
    """
    targets = _string_list(concrete_targets)
    turns = [t for t in (_s(x) for x in recent_tutor_turns) if t]
    if not targets or len(turns) < window:
        return DriftVerdict(drift=False, kind="none", target="", reason="insufficient evidence")

    recent_lc = [t.lower() for t in turns[-window:]]
    targets_lc = [(t, t.lower()) for t in targets]

    def referenced(target_lc: str) -> bool:
        return any(target_lc in turn for turn in recent_lc)

    if any(referenced(t_lc) for _, t_lc in targets_lc):
        return DriftVerdict(drift=False, kind="none", target="", reason="a target is live in the window")

    neglected = next((orig for orig, t_lc in targets_lc if not referenced(t_lc)), targets[0])
    return DriftVerdict(
        drift=True,
        kind="target_neglect",
        target=neglected,
        reason=f"no target referenced in the last {window} tutor turns",
    )


def detect_language_drift(latest_tutor_turn: str, learning_locale: str) -> DriftVerdict:
    """Pure. The tutor should speak the target language but drifted into English.

    Non-Latin targets (ko/ru/he): target-script ratio. Latin targets (es/fr/tl):
    distinctly-English function-word density. Returns kind 'language_drift' with
    target = the target-language display name. Conservative (min-length + ratio /
    distinct-marker thresholds) so a brief code-switch is not flagged.
    """
    turn = _s(latest_tutor_turn)
    key = _drift_locale_key(learning_locale)
    lang = _LANGUAGE_NAMES.get(key, "")
    if not turn or not lang:
        return DriftVerdict(drift=False, kind="none", target="", reason="no language signal")

    letters = [c for c in turn if c.isalpha()]
    if len(letters) < LANGUAGE_DRIFT_MIN_CHARS:
        return DriftVerdict(drift=False, kind="none", target="", reason="turn too short to judge language")

    if key in _NON_LATIN_DRIFT_KEYS:
        target_chars = sum(1 for c in letters if _is_target_script_char(c, key))
        ratio = target_chars / len(letters)
        if ratio < TARGET_SCRIPT_MIN_RATIO:
            return DriftVerdict(drift=True, kind="language_drift", target=lang,
                                reason=f"only {round(ratio * 100)}% of letters were {lang} script")
        return DriftVerdict(drift=False, kind="none", target="", reason="predominantly target script")

    # Latin target (es/fr/tl): distinctly-English function-word density.
    words = set(re.findall(r"[a-z']+", turn.lower()))
    hits = words & _ENGLISH_FUNCTION_WORDS
    if len(hits) >= ENGLISH_MARKER_MIN_HITS:
        return DriftVerdict(drift=True, kind="language_drift", target=lang,
                            reason=f"{len(hits)} English function words in a {lang} turn")
    return DriftVerdict(drift=False, kind="none", target="", reason="no English-drift markers")


def _normalize_state(state: object) -> dict:
    src = state if isinstance(state, dict) else {}
    last = src.get("last_resteer_turn")
    count = src.get("resteer_count")
    return {
        "last_resteer_turn": last if isinstance(last, int) else None,
        "resteer_count": count if isinstance(count, int) and count >= 0 else 0,
    }


def decide_resteer(
    director_state: object,
    verdict: DriftVerdict,
    turn_index: int,
) -> tuple[ResteerDecision, dict]:
    """Pure. Returns (decision, new_state); never mutates the input.

    Acts only when the verdict shows drift AND the cooldown and per-session cap
    allow it. On a re-steer: stamp the turn and bump the session count.
    """
    state = _normalize_state(director_state)
    if not verdict.drift:
        return ResteerDecision(resteer=False, reason="no drift", target="", signature=""), state

    signature = f"{verdict.kind}:{verdict.target}"
    last = state["last_resteer_turn"]
    cooldown_ok = last is None or (turn_index - last) >= DIRECTOR_COOLDOWN_TURNS
    cap_ok = state["resteer_count"] < DIRECTOR_MAX_RESTEERS

    if cooldown_ok and cap_ok:
        return (
            ResteerDecision(resteer=True, reason=verdict.reason, target=verdict.target, signature=signature),
            {"last_resteer_turn": turn_index, "resteer_count": state["resteer_count"] + 1},
        )

    return (
        ResteerDecision(resteer=False, reason="suppressed (cooldown/cap)",
                        target=verdict.target, signature=signature),
        state,
    )


def build_resteer_prompt(verdict: DriftVerdict, *, surface: str) -> str:
    """In-character coach note handed to the main tutor so it weaves the correction
    into its next turn in its own words. Terser on voice."""
    target = _s(verdict.target)
    lead = "COACH NOTE (act in your own words, in character — do not read this aloud): "
    if verdict.kind == "language_drift":
        body = (
            f"your last turn drifted into English. Respond in {target} from here — "
            f"continue the scene in {target} so the learner stays immersed."
        )
    else:
        body = (
            "the last few exchanges drifted off the lesson. "
            f'In your next turn, naturally create a reason for the learner to use "{target}" — '
            "weave it into the scene; don't announce it or lecture."
        )
    tail = " Keep it to one short sentence." if surface == "voice" else ""
    return lead + body + tail


def serialize_resteer(
    decision: ResteerDecision,
    *,
    turn_index: int,
    surface: str,
    prompt: str,
    generated_at: str,
) -> dict:
    """The durable audit record appended to analysis_state['resteers']."""
    kind = decision.signature.split(":", 1)[0] if decision.signature else "target_neglect"
    return {
        "turn_index": turn_index,
        "kind": kind,
        "target": decision.target,
        "reason": decision.reason,
        "prompt": prompt,
        "surface": surface,
        "generated_at": generated_at,
    }
