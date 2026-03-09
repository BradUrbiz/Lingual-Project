from __future__ import annotations

import re


TASK_TEMPLATE_RULES = {
    "information_gap": {
        "headline": (
            "Treat the exchange as an information-gap task where the learner must uncover missing details "
            "through targeted questions and confirmations."
        ),
        "phases": [
            "Open by establishing what concrete information the learner still needs in order to complete the scenario.",
            "Release missing details gradually across turns so the learner has to ask, confirm, and narrow down specifics.",
            "Close by having the learner confirm the completed information, next action, or shared understanding.",
        ],
        "completion": (
            "Do not treat the task as complete until the learner has actively filled the missing information "
            "rather than passively receiving it."
        ),
    },
    "opinion_gap": {
        "headline": (
            "Treat the exchange as an opinion-gap task where the learner must state a view, justify it, "
            "respond to another perspective, and refine the position."
        ),
        "phases": [
            "Open by inviting a clear preference, stance, or claim instead of a vague reaction.",
            "Press for reasons, examples, comparisons, and follow-up defense when the learner stays superficial.",
            "Close by making the learner restate or refine the final position after considering alternatives.",
        ],
        "completion": (
            "Do not treat the task as complete until the learner has supported a viewpoint with reasons or "
            "examples and responded to at least one alternate perspective."
        ),
    },
    "decision_making": {
        "headline": (
            "Treat the exchange as a decision-making task where the learner must compare options, negotiate "
            "trade-offs, and reach a justified choice."
        ),
        "phases": [
            "Open by framing a concrete decision that cannot be resolved with a single isolated answer.",
            "Surface trade-offs across at least two options so the learner has to compare, reject, or revise proposals.",
            "Close by requiring a final recommendation, agreement, or explicit reason for rejecting the available options.",
        ],
        "completion": (
            "Do not treat the task as complete until the learner has weighed options and reached, or explicitly "
            "declined, a clear decision with justification."
        ),
    },
}

TASK_MODEL_HINTS = {
    "ap.conversation": (
        "Use an interpersonal conversation shape: stay spontaneous, react to the learner's last turn, "
        "and avoid turning the task into a scripted drill or quiz."
    ),
}

REGISTER_HINTS = {
    "formal": "Keep the exchange in a formal or polite register unless the scenario explicitly requires quoting informal speech.",
    "informal": "Keep the exchange natural and informal, like peers speaking casually inside the scenario.",
    "mixed": "Allow natural shifts between polite and casual language when the roles or task require it, but stay school-appropriate.",
}

COMMUNICATIVE_FUNCTION_HINTS = {
    "ask_follow_up": "Create moments where the learner must ask a targeted follow-up question to move the task forward.",
    "ask_for_clarification": "Leave enough ambiguity that the learner may need to ask for clarification or repetition before continuing.",
    "summarize": "Before closing, require the learner to summarize the agreed information, opinion, or decision in their own words.",
}

DISCOURSE_MOVE_HINTS = {
    "turn_taking": "Keep turns responsive and balanced so the learner has to react to the previous turn rather than deliver an isolated monologue.",
    "self_correction": "Leave space for brief self-repair when the learner notices a problem instead of instantly supplying the corrected form.",
}

TEMPLATE_REF_HINTS = {
    "roleplay": "Stay in character for the resolved roles instead of slipping into teacher explanation mode.",
    "conversation": "Keep the exchange natural and collaborative rather than turning it into a checklist interview.",
    "interview": "Use interviewer and interviewee turn logic with targeted follow-up questions and concrete answers.",
    "debate": "Challenge reasons and require rebuttal or concession instead of accepting the learner's first opinion at face value.",
    "negotiation": "Keep surfacing trade-offs until the learner responds to constraints and works toward an agreement.",
    "problem_solving": "Introduce constraints that require the learner to propose, evaluate, and refine a solution.",
}

_VERSION_SEGMENT = re.compile(r"^v\d+$", re.IGNORECASE)
_WORD_BOUNDARY_PATTERN = re.compile(r"[\s._-]+")


def humanize_identifier(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""

    segments = [segment for segment in _WORD_BOUNDARY_PATTERN.split(normalized) if segment]
    if segments and segments[0].lower() in {"tpl", "template"}:
        segments = segments[1:]
    if segments and _VERSION_SEGMENT.match(segments[-1]):
        segments = segments[:-1]

    return " ".join(segments)
