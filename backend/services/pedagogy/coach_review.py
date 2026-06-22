"""Pure schema, prompt builder, and parser for the S3.1 post-task coach review.

Stdlib only — no OpenAI/Canvas/resolver/compliance imports (import boundary,
invariant 7a). The impure orchestration (transcript fetch, OpenAI call, snapshot)
lives in ``backend/services/coach_review_service.py``.
"""

from __future__ import annotations

from dataclasses import dataclass

WORK_ON_CAPS = {"fluency_first": 2, "balanced": 3, "accuracy_first": 4}
DEFAULT_WORK_ON_CAP = 3
MAX_WINS = 2
VALID_COVERAGE_STATUS = {"used", "attempted", "not_attempted"}


@dataclass(frozen=True)
class ReviewWin:
    text: str


@dataclass(frozen=True)
class ReviewItem:
    utterance: str
    better: str
    why: str
    target: str | None = None
    confidence_caveat: bool = False


@dataclass(frozen=True)
class TargetCoverageItem:
    surface: str
    status: str


@dataclass(frozen=True)
class CoachReview:
    wins: tuple[ReviewWin, ...] = ()
    work_on: tuple[ReviewItem, ...] = ()
    target_coverage: tuple[TargetCoverageItem, ...] = ()
    surface: str = "text"

    def is_empty(self) -> bool:
        return not self.wins and not self.work_on


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def parse_coach_review(
    raw: object,
    *,
    feedback_mode: str,
    surface: str,
    known_targets: list[str] | None = None,
) -> CoachReview:
    """Validate/coerce/cap the model's JSON into a CoachReview.

    Raises ValueError if ``raw`` is not a dict (structurally unusable). Missing
    keys yield an empty review (the orchestrator treats empty as "no review").
    """
    if not isinstance(raw, dict):
        raise ValueError("coach review payload must be a JSON object")

    known = set(known_targets or [])
    is_voice = surface == "voice"
    cap = WORK_ON_CAPS.get(feedback_mode, DEFAULT_WORK_ON_CAP)

    wins: list[ReviewWin] = []
    for item in raw.get("wins") or []:
        if isinstance(item, dict) and _s(item.get("text")):
            wins.append(ReviewWin(text=_s(item.get("text"))))
        if len(wins) >= MAX_WINS:
            break

    work_on: list[ReviewItem] = []
    for item in raw.get("work_on") or []:
        if not isinstance(item, dict):
            continue
        utterance, better = _s(item.get("utterance")), _s(item.get("better"))
        if not utterance or not better:
            continue
        target = _s(item.get("target")) or None
        if target and known and target not in known:
            target = None
        caveat = bool(item.get("confidence_caveat")) if is_voice else False
        work_on.append(
            ReviewItem(utterance=utterance, better=better, why=_s(item.get("why")),
                       target=target, confidence_caveat=caveat)
        )
        if len(work_on) >= cap:
            break

    coverage: list[TargetCoverageItem] = []
    for item in raw.get("target_coverage") or []:
        if not isinstance(item, dict):
            continue
        s_surface, status = _s(item.get("surface")), _s(item.get("status"))
        if s_surface and status in VALID_COVERAGE_STATUS:
            coverage.append(TargetCoverageItem(surface=s_surface, status=status))

    return CoachReview(
        wins=tuple(wins),
        work_on=tuple(work_on),
        target_coverage=tuple(coverage),
        surface="voice" if is_voice else "text",
    )


def serialize_coach_review(review: CoachReview) -> dict:
    return {
        "surface": review.surface,
        "wins": [{"text": w.text} for w in review.wins],
        "work_on": [
            {
                "utterance": i.utterance,
                "better": i.better,
                "why": i.why,
                "target": i.target,
                "confidence_caveat": i.confidence_caveat,
            }
            for i in review.work_on
        ],
        "target_coverage": [{"surface": c.surface, "status": c.status} for c in review.target_coverage],
    }


def build_coach_review_prompt(
    transcript: list[dict],
    targets: list[str],
    feedback_policy: dict,
    surface: str,
    ui_language: str,
) -> list[dict]:
    """Build the [system, user] messages for the post-task correction pass."""
    mode = _s((feedback_policy or {}).get("mode")) or "balanced"
    is_voice = surface == "voice"

    rules = [
        "You are a post-task language coach reviewing a finished practice session.",
        f"Write any explanations in the learner's UI language (code: {ui_language}); "
        "quote the learner's own words and the corrected form verbatim in the target language.",
        "Give 1-2 SPECIFIC wins (concrete, not effusive praise).",
        "Prioritize only the most impactful corrections; quote the learner's actual utterance for each.",
        "Tie a correction to one of the assignment targets when it matches; otherwise leave target null.",
    ]
    if is_voice:
        rules.append(
            "This was a SPOKEN session: keep it terse, and set confidence_caveat=true on any "
            "correction that depends on possibly-misheard (low ASR-confidence) audio."
        )
    rules.append(
        'Return STRICT JSON: {"wins":[{"text":...}],'
        '"work_on":[{"utterance":...,"better":...,"why":...,"target":...,"confidence_caveat":...}],'
        '"target_coverage":[{"surface":...,"status":"used|attempted|not_attempted"}]}'
    )
    system = {"role": "system", "content": "\n".join(rules)}

    lines = [
        f"Feedback mode: {mode}",
        "Assignment targets: " + (", ".join(targets) if targets else "(none)"),
        "",
        "Transcript:",
    ]
    for turn in transcript or []:
        if not isinstance(turn, dict):
            continue
        content = _s(turn.get("content"))
        if not content:
            continue
        speaker = "Learner" if turn.get("role") == "user" else "Tutor"
        lines.append(f"{speaker}: {content}")
    user = {"role": "user", "content": "\n".join(lines)}

    return [system, user]
