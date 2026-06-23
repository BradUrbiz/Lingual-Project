"""Pure prompt/parser for S3.4 Ask mode (learner-initiated quick help).

Stdlib only — no OpenAI/Canvas/resolver/compliance imports (import boundary,
invariant 7a). The anti-answer-dump contract lives here (the system message);
the impure orchestration (transcript fetch, OpenAI call, ask_log append) lives
in backend/services/ask_service.py.
"""

from __future__ import annotations

from dataclasses import dataclass

ASK_KINDS = {"hint", "translation", "definition", "clarification", "phrase", "refusal"}
DEFAULT_KIND = "clarification"
MAX_ANSWER_CHARS = 400


@dataclass(frozen=True)
class AskAnswer:
    answer: str
    kind: str


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def build_ask_prompt(question, recent_turns, targets, feedback_policy, scaffold_policy, surface, ui_language):
    """Build [system, user] for a single learner Ask. The system message encodes the
    anti-answer-dump contract; recent_turns are context only (do NOT answer them)."""
    mode = _s((feedback_policy or {}).get("mode")) or "balanced"
    is_voice = surface == "voice"
    rules = [
        "You are a concise language helper for a learner practicing a specific assignment in real time.",
        "Answer the learner's quick question, but NEVER do their work for them: do not produce the full "
        "answer to the assignment task and do not complete the learner's current sentence or turn. If they "
        "ask you to just give the answer, instead offer a hint, a forced choice, or a short model and invite "
        'them to try — and set kind to "refusal" for an explicit answer-dump request you redirect.',
        "Stay inside the assignment/course scope. Briefly redirect off-topic or non-language requests.",
        f"Be terse: at most {'1 sentence' if is_voice else '2 sentences'}. Return responsibility to the learner.",
        f"Write the answer in the learner's UI language (code: {ui_language}); quote any target-language "
        "form verbatim in the target language.",
        f"Feedback mode is {mode}: fluency_first favors a light hint; accuracy_first may be a little more "
        "explicit. Honor the scaffolding posture (prefer the hint ladder over full modeling).",
        'Return STRICT JSON: {"answer": "...", "kind": "hint|translation|definition|clarification|phrase|refusal"}.',
    ]
    system = {"role": "system", "content": "\n".join(rules)}

    lines = [
        "Assignment targets: " + (", ".join(targets) if targets else "(none)"),
        "",
        "Recent conversation (most recent last, for CONTEXT only — do NOT answer it):",
    ]
    for turn in recent_turns or []:
        if not isinstance(turn, dict):
            continue
        content = _s(turn.get("content"))
        if not content:
            continue
        speaker = "Learner" if turn.get("role") == "user" else "Tutor"
        lines.append(f"{speaker}: {content}")
    lines.append("")
    lines.append(f"Learner's question: {_s(question)}")
    user = {"role": "user", "content": "\n".join(lines)}
    return [system, user]


def parse_ask_answer(raw):
    """Validate/coerce a model Ask payload into AskAnswer, or None when unusable.
    Raises ValueError only on a non-dict payload (caught by the orchestrator → null)."""
    if not isinstance(raw, dict):
        raise ValueError("ask answer payload must be a JSON object")
    answer = _s(raw.get("answer"))
    if not answer:
        return None
    if len(answer) > MAX_ANSWER_CHARS:
        answer = answer[:MAX_ANSWER_CHARS].rstrip()
    kind = _s(raw.get("kind")).lower()
    if kind not in ASK_KINDS:
        kind = DEFAULT_KIND
    return AskAnswer(answer=answer, kind=kind)


def serialize_ask_answer(answer: AskAnswer) -> dict:
    return {"answer": answer.answer, "kind": answer.kind}
