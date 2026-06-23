from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from backend.services.compliance import resolve_assignment_launch
from backend.services.suspended_org_guard import enforce_org_active

# Policy normalization helpers now live in backend/services/pedagogy/policies.py
# (the reborn pedagogy engine owns them). Re-imported here for back-compat with
# existing callers (test_pedagogy_prompting, _empty_canvas_mapping_dto, etc.).
from backend.services.pedagogy.policies import (
    _coerce_nonnegative_int,
    _derived_output_policy_defaults,
    _feedback_mode,
    default_feedback_policy,
    default_output_policy,
    default_scaffold_policy,
    normalize_feedback_policy,
    normalize_output_policy,
    normalize_scaffold_policy,
    serialize_feedback_policy,
    serialize_output_policy,
    serialize_scaffold_policy,
)
from backend.services.pedagogy.routing import repair_directive_lines


SUPPORTED_ASSIGNMENT_STATUSES = {"draft", "published", "archived"}
SUPPORTED_TASK_TYPES = {"information_gap", "opinion_gap", "decision_making"}
SUPPORTED_MODALITY_MODES = {"text_only", "voice_only", "hybrid"}
SUPPORTED_FEEDBACK_MODES = {"fluency_first", "balanced", "accuracy_first"}
SUPPORTED_OUTPUT_PRESSURES = {"light", "balanced", "high"}
TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}
HIDDEN_ASSIGNMENT_TIME_LIMIT_SEC = 6000


# ---------------------------------------------------------------------------
# Prompt section builders (feedback mode, correction ladder, scaffold ladder,
# output pressure, task-template directive). These assemble deterministic
# text blocks that ``build_assignment_system_prompt`` overlays on top of the
# scenario prompt for every assignment, Canvas-generated or legacy.
# ---------------------------------------------------------------------------

def build_feedback_mode_prompt(feedback_policy: dict[str, Any] | None) -> str:
    feedback_policy = feedback_policy if isinstance(feedback_policy, dict) else {}
    mode = feedback_policy.get("mode", "balanced")
    target_only_strict = bool(feedback_policy.get("targetOnlyStrict", False))

    if mode == "fluency_first":
        lines = [
            "Prioritize flow and confidence over interruption frequency.",
            "Keep corrections short, embedded, and easy to ignore if the learner is still communicating successfully.",
            "Do not turn every grammar issue into a teaching stop unless it blocks comprehension or the mapped target requires it.",
        ]
    elif mode == "accuracy_first":
        lines = [
            "Prioritize accurate production of the mapped targets over conversational speed.",
            "Notice incorrect target-language forms early and move to guided self-correction sooner.",
            "Use brief explicit cues when needed so the learner understands what form needs repair.",
        ]
    else:
        lines = [
            "Balance fluency support with timely corrective feedback.",
            "Let the learner keep momentum, but do not ignore repeated target-language errors.",
            "Escalate feedback only when the learner keeps missing the same target or the task goal is drifting.",
        ]

    if target_only_strict:
        lines.append(
            "Keep feedback tightly anchored to the mapped targets, focus grammar, and assignment success criteria."
        )
    else:
        lines.append(
            "Favor mapped targets first, but you may briefly support nearby language if it directly helps task completion."
        )

    return "FEEDBACK MODE DIRECTIVE:\n" + "\n".join(f"- {line}" for line in lines)


def build_correction_ladder_prompt(feedback_policy: dict[str, Any] | None) -> str:
    feedback_policy = feedback_policy if isinstance(feedback_policy, dict) else {}
    recast_default = bool(feedback_policy.get("recastDefault", True))
    elicitation_repeat_threshold = max(
        1,
        int(feedback_policy.get("elicitationRepeatThreshold", 3) or 3),
    )
    end_review_enabled = bool(feedback_policy.get("endReviewEnabled", True))

    ladder_lines = []
    if recast_default:
        ladder_lines.append(
            "First target error encounter: use a brief natural recast and continue the task without turning it into a lecture."
        )
    else:
        ladder_lines.append(
            "First target error encounter: move directly to a short elicitation cue instead of a silent recast."
        )

    ladder_lines.extend(
        [
            (
                f"When the same error family repeats {elicitation_repeat_threshold} time(s), "
                "pause briefly and ask the learner to repair it."
            ),
            "If the learner self-corrects, acknowledge briefly and resume the task immediately.",
            "If the learner cannot self-correct after a short attempt, provide the model and ask for one retry before moving on.",
        ]
    )

    if end_review_enabled:
        ladder_lines.append(
            "Near the end of the session, summarize 1-3 recurring issues with short metalinguistic review items tied to the learner's actual errors."
        )
    else:
        ladder_lines.append(
            "Do not add a formal end-of-session review block unless the learner explicitly asks for one."
        )

    return "CORRECTION LADDER:\n" + "\n".join(f"- {line}" for line in ladder_lines)


_SCAFFOLD_STEP_INSTRUCTIONS = {
    "wait": "Hold space first and let the learner try before you help.",
    "context_hint": "Give a situational cue tied to the scenario, role, or communicative goal instead of supplying the answer.",
    "choice_prompt": "Offer a small forced choice or contrast so the learner still has to select and produce language.",
    "model_and_retry": "Model the target form only after earlier steps fail, then ask the learner to try again.",
}


def build_scaffold_ladder_prompt(scaffold_policy: dict[str, Any] | None) -> str:
    scaffold_policy = scaffold_policy if isinstance(scaffold_policy, dict) else {}
    silence_tolerance_ms = max(0, int(scaffold_policy.get("silenceToleranceMs", 3000) or 3000))
    hint_ladder = scaffold_policy.get("hintLadder", [])
    max_modeling_steps = max(0, int(scaffold_policy.get("maxModelingSteps", 1) or 1))

    ordered_steps = [
        step
        for step in hint_ladder
        if isinstance(step, str) and step.strip()
    ] or ["wait", "context_hint", "choice_prompt", "model_and_retry"]

    lines = [
        f"Allow brief productive silence for up to about {silence_tolerance_ms} ms before stepping in.",
        "Use the scaffold ladder in order instead of jumping straight to the full answer.",
    ]

    for index, step in enumerate(ordered_steps, start=1):
        instruction = _SCAFFOLD_STEP_INSTRUCTIONS.get(
            step,
            "Use the configured support move without removing the learner's responsibility.",
        )
        lines.append(f"Step {index} ({step}): {instruction}")

    if max_modeling_steps <= 0:
        lines.append("Avoid full modeling unless task completion would otherwise stall completely.")
    else:
        lines.append(
            f"Limit full model-and-retry support to about {max_modeling_steps} modeling step(s) for the same struggle point before moving on."
        )

    return "SCAFFOLD LADDER:\n" + "\n".join(f"- {line}" for line in lines)


def build_output_pressure_prompt(
    output_policy: dict[str, Any] | None,
    *,
    assignment: dict[str, Any] | None,
    pedagogy: dict[str, Any] | None,
) -> str:
    output_policy = output_policy if isinstance(output_policy, dict) else {}
    assignment = assignment if isinstance(assignment, dict) else {}
    pedagogy = pedagogy if isinstance(pedagogy, dict) else {}

    min_student_turn_words = max(1, int(output_policy.get("minStudentTurnWords", 8) or 8))
    follow_up_pressure = output_policy.get("followUpPressure", "balanced")
    allow_clarification_requests = bool(output_policy.get("allowClarificationRequests", True))
    evidence = pedagogy.get("evidence", {}) if isinstance(pedagogy.get("evidence"), dict) else {}

    lines = [
        f"Aim for learner turns of roughly {min_student_turn_words}+ words when the task naturally allows it.",
        "Do not accept one-word or fragment answers as task completion if the learner can reasonably elaborate.",
    ]

    if follow_up_pressure == "light":
        lines.append(
            "Use gentle expansion prompts such as asking for one more detail, reason, or example after short responses."
        )
    elif follow_up_pressure == "high":
        lines.append(
            "Actively press for elaboration with follow-up questions, comparisons, and justification until the learner produces fuller output."
        )
    else:
        lines.append(
            "Use moderate follow-up pressure: ask for clarification, justification, or one extra detail when the learner stays too brief."
        )

    if allow_clarification_requests:
        lines.append(
            "Allow the learner to ask for clarification or repetition, but answer in a way that returns responsibility to the learner."
        )
    else:
        lines.append(
            "Keep clarification support minimal so the learner must stay in productive output mode."
        )

    min_turns = evidence.get("minTurns")
    if isinstance(min_turns, int) and min_turns > 0:
        lines.append(f"Use follow-ups and wait time to help the learner reach the target turn volume of about {min_turns} turns.")

    success_criteria = assignment.get("successCriteria", [])
    if isinstance(success_criteria, list) and success_criteria:
        lines.append("Tie elaboration requests back to the assignment success criteria whenever possible.")

    return "OUTPUT PRESSURE:\n" + "\n".join(f"- {line}" for line in lines)


# --- Task template directive (inlined from pedagogy/task_template.py + template_catalog.py) ---

_TASK_TEMPLATE_RULES = {
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

_DEFAULT_TASK_TEMPLATE_RULE = {
    "headline": (
        "Treat the exchange as an assignment-guided conversation where the learner must stay inside the scenario, "
        "respond naturally, and build toward the assignment goals."
    ),
    "phases": [
        "Open by establishing the scenario, roles, or immediate communicative need from the assignment.",
        "Sustain the exchange with natural follow-ups that keep the learner using the target language and assignment materials.",
        "Close only after the learner has clearly demonstrated the assignment success criteria or completed the assigned communicative task.",
    ],
    "completion": (
        "Do not treat the task as complete until the learner has produced enough assignment-aligned language to show meaningful progress."
    ),
}

_TASK_MODEL_HINTS = {
    "ap.conversation": (
        "Use an interpersonal conversation shape: stay spontaneous, react to the learner's last turn, "
        "and avoid turning the task into a scripted drill or quiz."
    ),
    "assignment_conversation": (
        "Keep the interaction natural, scenario-bound, and clearly anchored to the teacher-authored assignment guidance."
    ),
}

_REGISTER_HINTS = {
    "formal": "Keep the exchange in a formal or polite register unless the scenario explicitly requires quoting informal speech.",
    "informal": "Keep the exchange natural and informal, like peers speaking casually inside the scenario.",
    "mixed": "Allow natural shifts between polite and casual language when the roles or task require it, but stay school-appropriate.",
}

_COMMUNICATIVE_FUNCTION_HINTS = {
    "ask_follow_up": "Create moments where the learner must ask a targeted follow-up question to move the task forward.",
    "ask_for_clarification": "Leave enough ambiguity that the learner may need to ask for clarification or repetition before continuing.",
    "summarize": "Before closing, require the learner to summarize the agreed information, opinion, or decision in their own words.",
}

_DISCOURSE_MOVE_HINTS = {
    "turn_taking": "Keep turns responsive and balanced so the learner has to react to the previous turn rather than deliver an isolated monologue.",
    "self_correction": "Leave space for brief self-repair when the learner notices a problem instead of instantly supplying the corrected form.",
}

_TEMPLATE_REF_HINTS = {
    "roleplay": "Stay in character for the resolved roles instead of slipping into teacher explanation mode.",
    "conversation": "Keep the exchange natural and collaborative rather than turning it into a checklist interview.",
    "interview": "Use interviewer and interviewee turn logic with targeted follow-up questions and concrete answers.",
    "debate": "Challenge reasons and require rebuttal or concession instead of accepting the learner's first opinion at face value.",
    "negotiation": "Keep surfacing trade-offs until the learner responds to constraints and works toward an agreement.",
    "problem_solving": "Introduce constraints that require the learner to propose, evaluate, and refine a solution.",
}

_VERSION_SEGMENT = re.compile(r"^v\d+$", re.IGNORECASE)
_WORD_BOUNDARY_PATTERN = re.compile(r"[\s._-]+")


def _humanize_identifier(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""

    segments = [segment for segment in _WORD_BOUNDARY_PATTERN.split(normalized) if segment]
    if segments and segments[0].lower() in {"tpl", "template"}:
        segments = segments[1:]
    if segments and _VERSION_SEGMENT.match(segments[-1]):
        segments = segments[:-1]

    return " ".join(segments)


def _tt_normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _tt_normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _tt_unique_preserving_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _resolve_situation_seed(curriculum: dict[str, Any]) -> dict[str, Any]:
    situation = curriculum.get("situation", {}) if isinstance(curriculum.get("situation"), dict) else {}
    return situation.get("seed", {}) if isinstance(situation.get("seed"), dict) else {}


def _resolve_can_do_summaries(curriculum: dict[str, Any]) -> list[str]:
    summaries: list[str] = []
    for objective in curriculum.get("objectives", []):
        if not isinstance(objective, dict):
            continue
        can_do = objective.get("canDo", {}) if isinstance(objective.get("canDo"), dict) else {}
        summary = _tt_normalize_string(can_do.get("en")) or _tt_normalize_string(objective.get("id"))
        if summary:
            summaries.append(summary)
    return summaries


def _resolve_rubric_dimension_lookup(curriculum: dict[str, Any]) -> dict[str, tuple[str, str]]:
    lookup: dict[str, tuple[str, str]] = {}
    for rubric in curriculum.get("rubrics", []):
        if not isinstance(rubric, dict):
            continue
        for dimension in rubric.get("dimensions", []):
            if not isinstance(dimension, dict):
                continue
            dimension_id = _tt_normalize_string(dimension.get("id"))
            if not dimension_id:
                continue
            title_payload = dimension.get("title", {}) if isinstance(dimension.get("title"), dict) else {}
            description_payload = (
                dimension.get("description", {}) if isinstance(dimension.get("description"), dict) else {}
            )
            title = _tt_normalize_string(title_payload.get("en"))
            description = _tt_normalize_string(description_payload.get("en"))
            lookup[dimension_id] = (title or _humanize_identifier(dimension_id), description)
    return lookup


def _resolve_template_ref_hints(template_refs: list[str]) -> list[str]:
    hints: list[str] = []
    for template_ref in template_refs:
        lowered_ref = template_ref.lower()
        for keyword, hint in _TEMPLATE_REF_HINTS.items():
            if keyword in lowered_ref:
                hints.append(hint)
    return _tt_unique_preserving_order(hints)


def _resolve_activity_template_lines(activity_templates: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for template in activity_templates:
        if not isinstance(template, dict):
            continue
        title = _tt_normalize_string((template.get("title") or {}).get("en")) if isinstance(template.get("title"), dict) else ""
        template_id = _tt_normalize_string(template.get("id"))
        assistant_role = _tt_normalize_string(template.get("assistantRole"))
        interaction = (
            template.get("interactionPattern", {})
            if isinstance(template.get("interactionPattern"), dict)
            else {}
        )

        label = title or template_id
        if label:
            lines.append(f"Resolved structured activity template: {label}.")
        if assistant_role:
            lines.append(f"Template assistant role: {assistant_role}")

        for move in _tt_normalize_string_list(interaction.get("openingMoves")):
            lines.append(f"Template opening move: {move}")
        for move in _tt_normalize_string_list(interaction.get("sustainMoves")):
            lines.append(f"Template sustain move: {move}")
        for move in _tt_normalize_string_list(interaction.get("closingMoves")):
            lines.append(f"Template closing move: {move}")

        completion_rule = _tt_normalize_string(interaction.get("completionRule"))
        if completion_rule:
            lines.append(f"Template completion rule: {completion_rule}")

        for cue in _tt_normalize_string_list(template.get("promptCues")):
            lines.append(f"Template cue: {cue}")

    return _tt_unique_preserving_order(lines)


def _resolve_function_lines(function_ids: list[str]) -> list[str]:
    lines: list[str] = []
    for function_id in function_ids:
        lines.append(
            _COMMUNICATIVE_FUNCTION_HINTS.get(
                function_id,
                f"Create a visible moment where the learner must perform {_humanize_identifier(function_id)}.",
            )
        )
    return _tt_unique_preserving_order(lines)


def _resolve_discourse_move_lines(move_ids: list[str]) -> list[str]:
    lines: list[str] = []
    for move_id in move_ids:
        lines.append(
            _DISCOURSE_MOVE_HINTS.get(
                move_id,
                f"Let the exchange visibly surface the discourse move {_humanize_identifier(move_id)}.",
            )
        )
    return _tt_unique_preserving_order(lines)


def build_task_template_prompt(
    *,
    task_type: str,
    assignment: dict[str, Any] | None,
    curriculum: dict[str, Any] | None,
    pedagogy: dict[str, Any] | None,
    mapping: dict[str, Any] | None = None,
) -> str:
    assignment = assignment if isinstance(assignment, dict) else {}
    curriculum = curriculum if isinstance(curriculum, dict) else {}
    pedagogy = pedagogy if isinstance(pedagogy, dict) else {}
    mapping = mapping if isinstance(mapping, dict) else {}

    evidence = pedagogy.get("evidence", {}) if isinstance(pedagogy.get("evidence"), dict) else {}
    situation_seed = _resolve_situation_seed(curriculum)

    template_rule = _TASK_TEMPLATE_RULES.get(task_type, _DEFAULT_TASK_TEMPLATE_RULE)
    lines = [
        template_rule["headline"],
        *[
            f"Phase {index}: {phase}"
            for index, phase in enumerate(template_rule["phases"], start=1)
        ],
        f"Completion gate: {template_rule['completion']}",
    ]

    task_model = _tt_normalize_string(pedagogy.get("taskModel"))
    if task_model:
        task_model_hint = _TASK_MODEL_HINTS.get(
            task_model,
            f"Keep the interaction consistent with the resolved task model {_humanize_identifier(task_model)}.",
        )
        lines.append(task_model_hint)

    scenario_parts: list[str] = []
    setting = _tt_normalize_string(situation_seed.get("setting"))
    roles = _tt_normalize_string_list(situation_seed.get("roles"))
    register = _tt_normalize_string(situation_seed.get("register"))

    if setting:
        scenario_parts.append(f"setting={setting}")
    if roles:
        scenario_parts.append(f"roles={', '.join(roles)}")
    if register:
        scenario_parts.append(f"register={register}")
        register_hint = _REGISTER_HINTS.get(register)
        if register_hint:
            lines.append(register_hint)

    if scenario_parts:
        lines.append(f"Resolved scenario anchor: {'; '.join(scenario_parts)}.")

    context_tags = _tt_normalize_string_list(pedagogy.get("contextTags"))
    if context_tags:
        lines.append(
            f"Keep the exchange grounded in these curriculum context tags when possible: {', '.join(context_tags)}."
        )

    allowed_context_tags = _tt_normalize_string_list(mapping.get("allowedContextTags"))
    if allowed_context_tags:
        lines.append(f"Teacher-approved context bounds: {', '.join(allowed_context_tags)}.")

    template_refs = _tt_normalize_string_list(pedagogy.get("templateRefs"))
    activity_templates = pedagogy.get("activityTemplates", []) if isinstance(pedagogy.get("activityTemplates"), list) else []
    if activity_templates:
        lines.extend(_resolve_activity_template_lines(activity_templates))
    if template_refs:
        lines.append(f"Resolved curriculum template references: {', '.join(template_refs)}.")
        if not activity_templates:
            lines.extend(_resolve_template_ref_hints(template_refs))

    communicative_functions = _tt_normalize_string_list(pedagogy.get("communicativeFunctions"))
    if communicative_functions:
        lines.append(
            "Make the learner visibly perform these communicative functions when possible: "
            + ", ".join(communicative_functions)
            + "."
        )
        lines.extend(_resolve_function_lines(communicative_functions))

    discourse_moves = _tt_normalize_string_list(pedagogy.get("discourseMoves"))
    if discourse_moves:
        lines.append(
            "Surface these discourse moves in the interaction when possible: "
            + ", ".join(discourse_moves)
            + "."
        )
        lines.extend(_resolve_discourse_move_lines(discourse_moves))

    rubric_focus = _tt_normalize_string_list(mapping.get("rubricFocus"))
    if rubric_focus:
        rubric_lookup = _resolve_rubric_dimension_lookup(curriculum)
        lines.extend(
            [
                f"Bias the exchange toward rubric evidence for {rubric_lookup.get(dimension_id, (_humanize_identifier(dimension_id), ''))[0]}."
                + (
                    f" {rubric_lookup[dimension_id][1]}"
                    if dimension_id in rubric_lookup and rubric_lookup[dimension_id][1]
                    else ""
                )
                for dimension_id in rubric_focus
            ]
        )

    can_do_summaries = _resolve_can_do_summaries(curriculum)
    if can_do_summaries:
        lines.append(
            "Create visible evidence for these mapped curriculum outcomes: "
            + "; ".join(can_do_summaries[:3])
            + ("." if len(can_do_summaries) <= 3 else "; and the remaining mapped objectives.")
        )

    evidence_targets: list[str] = []
    min_turns = evidence.get("minTurns")
    max_turns = evidence.get("maxTurns")
    max_replays = evidence.get("maxReplays")
    if isinstance(min_turns, int) and min_turns > 0:
        evidence_targets.append(f"about {min_turns} learner turns")
    if isinstance(max_turns, int) and max_turns > 0:
        evidence_targets.append(f"no more than about {max_turns} total turns")
    if evidence_targets:
        lines.append(
            "Plan the interaction to support "
            + ", ".join(evidence_targets)
            + " when the scenario naturally allows it."
        )
    if isinstance(max_replays, int) and max_replays >= 0:
        lines.append(f"Avoid replaying the same prompt more than about {max_replays} time(s) before moving the task forward.")

    success_criteria = _tt_normalize_string_list(assignment.get("successCriteria"))
    if success_criteria:
        lines.append(
            "Do not close the task until the learner has materially demonstrated: "
            + "; ".join(success_criteria)
            + "."
        )

    description = _tt_normalize_string(assignment.get("description"))
    if description:
        lines.append(f"Assignment framing to preserve: {description}")

    return "TASK TEMPLATE DIRECTIVE:\n" + "\n".join(f"- {line}" for line in _tt_unique_preserving_order(lines))


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


_LANGUAGE_INTENSITY_VALUES = {
    "english_first",
    "english_led",
    "balanced",
    "target_led",
    "target_only",
}

_LANGUAGE_INTENSITY_LEGACY_MAP = {
    # Pre-widening enum. `mostly_target` was the old default and sat closest
    # to `target_led`; `bilingual_scaffold` glossed English alongside the
    # target language and maps best to `english_led`.
    "mostly_target": "target_led",
    "bilingual_scaffold": "english_led",
}


def _normalize_language_intensity(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped in _LANGUAGE_INTENSITY_VALUES:
            return stripped
        if stripped in _LANGUAGE_INTENSITY_LEGACY_MAP:
            return _LANGUAGE_INTENSITY_LEGACY_MAP[stripped]
    return "balanced"


def _normalize_string_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "seconds"):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def default_modality_policy() -> dict[str, Any]:
    return {
        "mode": "hybrid",
        "voice_minutes_cap": None,
        "text_fallback_enabled": True,
    }


def normalize_modality_policy(policy: Any) -> dict[str, Any]:
    normalized = default_modality_policy()
    if isinstance(policy, dict):
        mode = _normalize_string(policy.get("mode"))
        voice_minutes_cap = policy.get("voice_minutes_cap", policy.get("voiceMinutesCap"))
        text_fallback_enabled = policy.get(
            "text_fallback_enabled",
            policy.get("textFallbackEnabled"),
        )
        if mode in SUPPORTED_MODALITY_MODES:
            normalized["mode"] = mode
        if isinstance(voice_minutes_cap, int):
            normalized["voice_minutes_cap"] = max(0, voice_minutes_cap)
        if isinstance(text_fallback_enabled, bool):
            normalized["text_fallback_enabled"] = text_fallback_enabled
    return normalized


def serialize_modality_policy(policy: Any) -> dict[str, Any]:
    normalized = normalize_modality_policy(policy)
    return {
        "mode": normalized["mode"],
        "voiceMinutesCap": normalized["voice_minutes_cap"],
        "textFallbackEnabled": normalized["text_fallback_enabled"],
    }


def serialize_assignment(assignment: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(assignment, dict):
        return None
    serialized: dict[str, Any] = {
        "id": assignment.get("id"),
        "orgId": assignment.get("org_id"),
        "classId": assignment.get("class_id"),
        "title": assignment.get("title", ""),
        "description": assignment.get("description", ""),
        "status": assignment.get("status", "draft"),
        "releaseAt": assignment.get("release_at") or None,
        "dueAt": assignment.get("due_at") or None,
        "modalityOverride": serialize_modality_policy(assignment.get("modality_override")),
        "maxAttempts": assignment.get("max_attempts"),
        "successCriteria": _normalize_string_list(assignment.get("success_criteria")),
        "createdByUid": assignment.get("created_by_uid", ""),
        "createdAt": _timestamp_to_iso(assignment.get("created_at")),
        "updatedAt": _timestamp_to_iso(assignment.get("updated_at")),
        "canvasModuleItemId": assignment.get("canvas_module_item_id", ""),
    }
    # New direct-scenario fields — preferred over curriculum_mappings path (C2).
    instructions = assignment.get("instructions")
    if isinstance(instructions, str) and instructions:
        serialized["instructions"] = instructions
    generated_scenario = assignment.get("generated_scenario")
    if isinstance(generated_scenario, str) and generated_scenario:
        serialized["generatedScenario"] = generated_scenario
    objectives = assignment.get("objectives")
    if isinstance(objectives, list) and objectives:
        serialized["objectives"] = _normalize_string_list(objectives)
    target_expressions = assignment.get("target_expressions")
    if isinstance(target_expressions, list) and target_expressions:
        serialized["targetExpressions"] = _normalize_string_list(target_expressions)
    target_vocabulary = assignment.get("target_vocabulary")
    if isinstance(target_vocabulary, list) and target_vocabulary:
        serialized["targetVocabulary"] = _normalize_string_list(target_vocabulary)
    focus_grammar = assignment.get("focus_grammar")
    if isinstance(focus_grammar, list) and focus_grammar:
        serialized["focusGrammar"] = _normalize_string_list(focus_grammar)
    teacher_notes = assignment.get("teacher_notes")
    if isinstance(teacher_notes, str) and teacher_notes:
        serialized["teacherNotes"] = teacher_notes
    student_instructions = assignment.get("student_instructions")
    if isinstance(student_instructions, str) and student_instructions:
        serialized["studentInstructions"] = student_instructions
    task_type = assignment.get("task_type")
    if isinstance(task_type, str) and task_type:
        serialized["taskType"] = task_type
    serialized["targetLanguageIntensity"] = _normalize_language_intensity(
        assignment.get("target_language_intensity")
    )
    canvas_module_item_ref = assignment.get("canvas_module_item_ref")
    if isinstance(canvas_module_item_ref, dict) and canvas_module_item_ref:
        serialized["canvasModuleItemRef"] = canvas_module_item_ref
    return serialized
def resolve_assignment_bootstrap(
    deps: Any,
    *,
    assignment: dict[str, Any],
    mapping: dict[str, Any] | None = None,
    class_record: dict[str, Any],
    ui_language: str = "en",
) -> dict[str, Any]:
    """Build the bootstrap payload for an assignment.

    After C2 (Canvas content migration), all assignments store scenario fields
    directly on the assignment document. Curriculum mappings are gone, so the
    ``mapping`` kwarg is kept only for backwards compatibility with the
    pre-C2 call sites and is always ignored. Every assignment now flows
    through the Canvas-generated resolver.

    Raises ``SuspendedOrgError`` (from
    ``backend.services.suspended_org_guard``) when the assignment's owning
    org is suspended. Callers that are Flask routes translate this to a
    403 with the stable ``org_suspended`` payload.
    """
    enforce_org_active(
        (class_record or {}).get("org_id"),
        db=getattr(deps, "db", None),
    )
    assignment_dto = serialize_assignment(assignment)
    if not assignment_dto:
        raise ValueError("Assignment bootstrap requires a valid assignment record.")

    mapping_dto = _empty_canvas_mapping_dto()
    return _resolve_canvas_generated_bootstrap(
        deps,
        mapping_dto=mapping_dto,
        assignment=assignment,
        assignment_dto=assignment_dto,
        class_record=class_record,
        ui_language=ui_language,
    )


def _empty_canvas_mapping_dto() -> dict[str, Any]:
    """Return a default mapping-shaped DTO for the bootstrap response.

    After C2, no ``curriculum_mappings`` row is ever loaded. The bootstrap
    payload still exposes a ``mapping`` key for backwards compatibility with
    existing frontend consumers; the Canvas-generated resolver populates the
    scenario-bearing fields (``generatedScenario``, ``targetExpressions``,
    ``focusGrammar``, ``teacherNotes``, ``outputPolicy``) from the assignment
    document directly.
    """
    return {
        "id": None,
        "orgId": None,
        "classId": None,
        "packageId": "canvas-generated",
        "moduleId": None,
        "objectiveIds": [],
        "situationIds": [],
        "targetExpressions": [],
        "targetVocabulary": [],
        "focusGrammar": [],
        "allowedContextTags": [],
        "feedbackPolicy": serialize_feedback_policy(None),
        "scaffoldPolicy": serialize_scaffold_policy(None),
        "modalityPolicy": serialize_modality_policy(None),
        "rubricFocus": [],
        "teacherNotes": "",
        "createdByUid": "",
        "createdAt": None,
        "updatedAt": None,
    }


def _build_canvas_objective_dtos(objectives: list[str]) -> list[dict[str, Any]]:
    """Adapt teacher-authored objective strings into bootstrap objective DTOs."""
    objective_dtos: list[dict[str, Any]] = []
    for index, objective in enumerate(objectives, start=1):
        objective_id = f"canvas-objective-{index}"
        objective_dtos.append({
            "id": objective_id,
            "mode": "interpersonal_speaking",
            "canDo": {"en": objective},
            "contextTags": [],
            "communicativeFunctions": [],
            "discourseMoves": [],
            "foundationDomains": [],
            "register": None,
            "mastery": {"rubricId": None, "threshold": None},
            "evidenceModel": {
                "taskModel": "assignment_conversation",
                "timeLimitSec": HIDDEN_ASSIGNMENT_TIME_LIMIT_SEC,
                "minTurns": 4,
                "inputProfile": {},
            },
            "templateRefs": [],
        })
    return objective_dtos


def _resolve_canvas_generated_bootstrap(
    deps: Any,
    *,
    mapping_dto: dict[str, Any],
    assignment: dict[str, Any],
    assignment_dto: dict[str, Any],
    class_record: dict[str, Any],
    ui_language: str = "en",
) -> dict[str, Any]:
    """Build a bootstrap payload from scenario fields on the assignment document.

    After C2, all scenario content lives on the assignment itself; there is
    no ``curriculum_mappings`` lookup. The assignment provides the scenario,
    target expressions, focus grammar, teacher notes, and Canvas source
    metadata that power the system prompt and realtime session parameters.
    """
    del deps  # resolver no longer needs deps for this path
    # Function-local import avoids the circular-import cycle:
    # assignment_resolver → integration → render.assignment_prompt → assignment_resolver
    from backend.services.pedagogy.integration import ask_mode_enabled  # noqa: PLC0415

    scenario = assignment.get("generated_scenario") or ""
    objectives = _normalize_string_list(assignment.get("objectives"))
    target_expressions = _normalize_string_list(assignment.get("target_expressions"))
    target_vocabulary = _normalize_string_list(assignment.get("target_vocabulary"))
    focus_grammar = _normalize_string_list(assignment.get("focus_grammar"))
    teacher_notes = assignment.get("teacher_notes") or ""
    success_criteria = _normalize_string_list(assignment.get("success_criteria"))
    task_model = "assignment_conversation"
    assignment_task_type = assignment.get("task_type") or ""
    is_custom_prompt_mode = assignment_task_type == "custom_prompt"

    if is_custom_prompt_mode:
        # Scaffold-free assignment: the teacher's instructions are the
        # complete system prompt. Zero out scaffold inputs so pedagogy and
        # mapping DTOs downstream reflect the intentional absence of
        # scenario, targets, grammar, and language-mix scaffolding.
        objectives = []
        target_expressions = []
        target_vocabulary = []
        focus_grammar = []
        teacher_notes = ""
        success_criteria = []

    # Build a system prompt from the assignment's scenario fields.
    locale_label = class_record.get("learning_locale", "ko-KR")
    class_name = class_record.get("name", "")
    subject = class_record.get("subject", "")
    canvas_ref = assignment.get("canvas_module_item_ref") if isinstance(assignment.get("canvas_module_item_ref"), dict) else {}
    source_title = canvas_ref.get("item_title") or ""
    source_module_name = canvas_ref.get("canvas_module_name") or ""
    objective_dtos = _build_canvas_objective_dtos(objectives)
    objective_ids = [objective["id"] for objective in objective_dtos]

    prompt_parts = [
        f"You are an AI language tutor helping a student practice spoken {locale_label} in a {subject} class ({class_name}).",
        "",
        f"## Scenario\n{scenario}",
    ]
    if source_title:
        prompt_parts.append(f"\nThis practice is based on the course material: \"{source_title}\".")
    if source_module_name:
        prompt_parts.append(f"\nCanvas module: \"{source_module_name}\".")
    if objectives:
        prompt_parts.append(f"\n## Objectives\n" + "\n".join(f"- {objective}" for objective in objectives))
    if target_expressions:
        prompt_parts.append(f"\n## Target Expressions\nThe student should practice using: {', '.join(target_expressions)}")
    if target_vocabulary:
        prompt_parts.append(f"\n## Target Vocabulary\nThe student should work in these words naturally: {', '.join(target_vocabulary)}")
    if focus_grammar:
        prompt_parts.append(f"\n## Focus Grammar\nPay attention to: {', '.join(focus_grammar)}")
    if success_criteria:
        prompt_parts.append(f"\n## Success Criteria\n" + "\n".join(f"- {c}" for c in success_criteria))

    intensity = _normalize_language_intensity(assignment.get("target_language_intensity"))
    language_name = subject or locale_label
    if intensity == "target_only":
        language_policy = (
            f"Respond ONLY in {language_name}. Stay in {language_name} for every turn, including "
            f"clarifications and corrections. Use English only if the learner explicitly asks for a "
            f"translation, then return to {language_name} immediately."
        )
    elif intensity == "target_led":
        language_policy = (
            f"Speak primarily in {language_name}. Brief English scaffolding (a single word or short clause) "
            f"is fine when the learner clearly stalls, asks for a translation, or otherwise can't move forward — "
            f"then return to {language_name} immediately. Never switch to a different target language."
        )
    elif intensity == "balanced":
        language_policy = (
            f"Alternate naturally between English and {language_name}. Run scenario openers and the "
            f"assignment's target-expression practice in {language_name}; use English for clarifications, "
            f"metalinguistic hints, or when the learner asks for a translation. Match the learner's language "
            f"when they reply, then nudge them back into {language_name} before the next target expression."
        )
    elif intensity == "english_led":
        language_policy = (
            f"English leads the conversation, but {language_name} carries the assignment's target expressions, "
            f"target vocabulary, and key scenario moves. When the learner replies in English, recast their "
            f"meaning into {language_name} as a brief model before continuing. The learner should hear "
            f"{language_name} on every turn but feel safe to reply mostly in English."
        )
    else:  # english_first
        language_policy = (
            f"Lead each turn in English and keep the scenario accessible for a novice. Introduce any "
            f"{language_name} phrase or vocabulary with its English meaning first, then model the "
            f"{language_name} form. Accept learner replies in English as valid understanding; invite them "
            f"to try the {language_name} version before moving on, but don't block progress if they can't."
        )
    prompt_parts.append(f"\n## Language Mix\n{language_policy}")
    prompt_parts.append(
        "\nGuide the conversation naturally. Provide gentle corrections and scaffolding when needed."
    )

    if is_custom_prompt_mode:
        # Scaffold-free mode: teacher-authored prompt is the content; the
        # language-mix policy is still honored so teachers keep that knob
        # even without scenario scaffolding.
        raw_instructions = assignment.get("instructions") or ""
        system_prompt_preview = f"{raw_instructions}\n\n## Language Mix\n{language_policy}"
    else:
        system_prompt_preview = "\n".join(prompt_parts)

    # Pedagogy context (minimal defaults)
    pedagogy_context = {
        "taskModel": task_model,
        "evidence": {
            "minTurns": 4,
            "maxTurns": 12,
            "timeLimitSec": HIDDEN_ASSIGNMENT_TIME_LIMIT_SEC,
        },
        "objectiveIds": objective_ids,
        "rubricIds": [],
        "activityTemplates": [],
        "templateRefs": [],
    }

    launch_modality = normalize_modality_policy(
        assignment_dto.get("modalityOverride") or mapping_dto.get("modalityPolicy") or {}
    )

    mapping_dto["outputPolicy"] = serialize_output_policy(
        None,
        task_type="",
        evidence=pedagogy_context.get("evidence"),
        feedback_mode=(mapping_dto.get("feedbackPolicy") or {}).get("mode", "balanced"),
    )
    mapping_dto["objectiveIds"] = objective_ids
    mapping_dto["generatedScenario"] = scenario
    mapping_dto["targetExpressions"] = target_expressions
    mapping_dto["targetVocabulary"] = target_vocabulary
    mapping_dto["focusGrammar"] = focus_grammar
    mapping_dto["teacherNotes"] = teacher_notes

    return {
        "assignment": assignment_dto,
        "mapping": mapping_dto,
        "class": {
            "id": class_record.get("id"),
            "orgId": class_record.get("org_id"),
            "name": class_name,
            "term": class_record.get("term", ""),
            "subject": subject,
            "learningLocale": locale_label,
            "gradeBand": class_record.get("grade_band", ""),
            "status": class_record.get("status", "active"),
        },
        "curriculum": {
            "package": {
                "id": "canvas-generated",
                "title": {"en": "Canvas-Generated Practice"},
                "learningLocale": locale_label,
                "levelBand": "adaptive",
            },
            "unit": None,
            "module": None,
            "situation": {
                "id": "canvas-generated",
                "kind": "interpersonal_speaking",
                "seed": {"setting": scenario[:200], "register": "informal"},
                "objectiveIds": objective_ids,
            },
            "objectives": objective_dtos,
            "rubrics": [],
            "pedagogy": pedagogy_context,
        },
        "launch": {
            "configuredMode": launch_modality.get("mode", "hybrid"),
            "modality": serialize_modality_policy(launch_modality),
            "voiceAllowed": launch_modality.get("mode") in {"voice_only", "hybrid"},
            "textAllowed": launch_modality.get("mode") in {"text_only", "hybrid"},
            "askModeEnabled": ask_mode_enabled(),
            "fallbackApplied": False,
            "blockedReasons": [],
            "retentionPolicy": None,
            "maxAttempts": assignment_dto.get("maxAttempts"),
        },
        "realtimeSessionParams": {
            "uiLanguage": ui_language,
            "practice": {
                "type": "canvas_generated",
                "assignmentId": assignment_dto["id"],
                "classId": assignment_dto["classId"],
                "mappingId": mapping_dto["id"],
                "taskModel": task_model,
                "objectiveIds": objective_ids,
                "rubricIds": [],
            },
        },
        "systemPromptPreview": system_prompt_preview,
        "limitations": [],
    }


def load_assignment_bundle(deps: Any, assignment_id: str) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any]]:
    """Load an assignment and its class record.

    After C2, curriculum_mappings are gone. The middle slot of the returned
    tuple is always ``None`` and is preserved only to keep the existing
    call-site signature stable.
    """
    assignment = deps.db.get_assignment(assignment_id)
    if not assignment:
        raise ValueError("Assignment not found.")

    class_record = deps.db.get_class(assignment.get("class_id"))
    if not class_record:
        raise ValueError("Class not found for assignment.")

    return assignment, None, class_record


def is_teacher_preview_allowed(
    context: Any | None,
    class_record: dict[str, Any],
) -> bool:
    if not context:
        return False
    return (
        class_record.get("org_id") == getattr(context, "active_organization_id", None)
        and (
            context.has_role("school_admin")
            or getattr(context, "active_membership_id", None) in (class_record.get("teacher_membership_ids") or [])
        )
    )


def user_can_access_assignment(
    deps: Any,
    *,
    uid: str,
    context: Any | None,
    assignment: dict[str, Any],
    class_record: dict[str, Any],
) -> tuple[bool, bool]:
    teacher_preview = is_teacher_preview_allowed(context, class_record)
    if teacher_preview:
        return True, True

    enrollment = deps.db.get_student_class_enrollment(assignment.get("class_id"), uid)
    if not enrollment or enrollment.get("status") != "active":
        return False, False

    if assignment.get("status") != "published":
        return False, False

    return True, False


def resolve_assignment_bootstrap_for_user(
    deps: Any,
    *,
    uid: str,
    context: Any | None,
    assignment_id: str,
    ui_language: str = "en",
) -> dict[str, Any]:
    assignment, mapping, class_record = load_assignment_bundle(deps, assignment_id)
    allowed, teacher_preview = user_can_access_assignment(
        deps,
        uid=uid,
        context=context,
        assignment=assignment,
        class_record=class_record,
    )
    if not allowed:
        raise PermissionError("Assignment is not available for the current user.")

    del mapping  # C2: mappings are gone; load_assignment_bundle returns None here.
    bootstrap = resolve_assignment_bootstrap(
        deps,
        assignment=assignment,
        class_record=class_record,
        ui_language=ui_language,
    )
    launch_policy, _compliance_record = resolve_assignment_launch(
        deps,
        org_id=class_record.get("org_id", ""),
        student_uid=uid,
        modality_policy=(bootstrap.get("launch") or {}).get("modality"),
        teacher_preview=teacher_preview,
    )
    bootstrap["launch"] = {
        **(bootstrap.get("launch") or {}),
        **launch_policy,
    }
    bootstrap["teacherPreview"] = teacher_preview
    if not bootstrap["launch"].get("voiceAllowed") and not bootstrap["launch"].get("textAllowed"):
        bootstrap.setdefault("limitations", []).append(
            "This assignment is currently blocked because neither voice nor text launch is permitted under the active consent and modality policy.",
        )
    return bootstrap


def build_assignment_prompt_bootstrap_from_practice_session(
    session_record: dict[str, Any] | None,
    *,
    class_record: dict[str, Any],
    launch_policy: dict[str, Any],
    teacher_preview: bool = False,
) -> dict[str, Any] | None:
    if not isinstance(session_record, dict):
        return None

    system_prompt_preview = _normalize_string(session_record.get("system_prompt_preview"))
    assignment_snapshot = session_record.get("assignment_snapshot")
    mapping_snapshot = session_record.get("mapping_snapshot")
    curriculum_snapshot = session_record.get("curriculum_snapshot")
    class_snapshot = session_record.get("class_snapshot")

    if not (
        system_prompt_preview
        and isinstance(assignment_snapshot, dict)
        and isinstance(mapping_snapshot, dict)
        and isinstance(curriculum_snapshot, dict)
        and isinstance(class_snapshot, dict)
    ):
        return None

    merged_class_snapshot = {
        **class_snapshot,
        "id": class_record.get("id", class_snapshot.get("id")),
        "orgId": class_record.get("org_id", class_snapshot.get("orgId")),
        "name": class_record.get("name", class_snapshot.get("name", "")),
        "term": class_record.get("term", class_snapshot.get("term", "")),
        "subject": class_record.get("subject", class_snapshot.get("subject", "")),
        "learningLocale": class_record.get("learning_locale", class_snapshot.get("learningLocale", "")),
        "gradeBand": class_record.get("grade_band", class_snapshot.get("gradeBand", "")),
        "status": class_record.get("status", class_snapshot.get("status", "active")),
    }

    return {
        "assignment": assignment_snapshot,
        "mapping": mapping_snapshot,
        "class": merged_class_snapshot,
        "curriculum": curriculum_snapshot,
        "launch": launch_policy,
        "teacherPreview": teacher_preview,
        "systemPromptPreview": system_prompt_preview,
        "limitations": [],
    }


def _build_assignment_spine(assignment: dict[str, Any], classroom: dict[str, Any]) -> str:
    title = (assignment.get("title") or "").strip() or "Untitled assignment"
    class_name = (classroom.get("name") or "").strip()
    header = f"- {title}" + (f" — {class_name}" if class_name else "")

    success = [
        c
        for c in assignment.get("successCriteria", [])
        if isinstance(c, str) and c.strip()
    ]

    lines = ["ASSIGNMENT:", header]
    if success:
        lines.append("- Success: " + "; ".join(success))
    lines.extend(
        [
            "",
            "CONVERSATION STYLE:",
            "- Stay inside the assignment scenario unless the learner is genuinely lost.",
            "- Hold a natural conversation in role — one forward-moving question per turn.",
            "- Accept usable answers and move the scene forward; do not loop on the same beat.",
        ]
    )
    return "\n".join(lines)


def _build_assignment_targets(
    mapping: dict[str, Any], curriculum: dict[str, Any]
) -> str:
    expressions = [
        e
        for e in mapping.get("targetExpressions", [])
        if isinstance(e, str) and e.strip()
    ]
    vocabulary = [
        w
        for w in mapping.get("targetVocabulary", [])
        if isinstance(w, str) and w.strip()
    ]
    grammar = [
        g
        for g in mapping.get("focusGrammar", [])
        if isinstance(g, str) and g.strip()
    ]
    objectives = [
        (o.get("canDo", {}).get("en") or o.get("id"))
        for o in curriculum.get("objectives", [])
        if isinstance(o, dict)
    ]
    objectives = [o for o in objectives if o]

    if not (objectives or expressions or vocabulary or grammar):
        return ""

    lines = ["TARGETS to elicit naturally inside the conversation:"]
    if objectives:
        lines.append("- Objectives: " + "; ".join(objectives))
    if expressions:
        lines.append("- Expressions: " + "; ".join(expressions))
    if vocabulary:
        lines.append("- Vocabulary: " + ", ".join(vocabulary))
    if grammar:
        lines.append("- Grammar: " + ", ".join(grammar))
    return "\n".join(lines)


def _build_teacher_guidance(mapping: dict[str, Any]) -> str:
    teacher_notes = mapping.get("teacherNotes")
    if not isinstance(teacher_notes, str) or not teacher_notes.strip():
        return ""

    return "TEACHER GUIDANCE:\n- Teacher guidance: " + teacher_notes.strip()


def _format_hint_ladder(steps: list[str]) -> str:
    labels = {
        "wait": "wait",
        "context_hint": "context cue",
        "choice_prompt": "forced choice",
        "model_and_retry": "model",
    }
    rendered = [labels.get(step, _humanize_identifier(step) or step) for step in steps]
    return " \u2192 ".join(rendered)


def _build_tutor_stance(
    feedback_policy: dict[str, Any],
    scaffold_policy: dict[str, Any],
    output_policy: dict[str, Any],
    targets: list[Any] | None = None,
    correction_light: bool = False,
) -> str:
    normalized_feedback = normalize_feedback_policy(feedback_policy)
    normalized_scaffold = normalize_scaffold_policy(scaffold_policy)
    normalized_output = normalize_output_policy(
        output_policy,
        feedback_mode=normalized_feedback["mode"],
    )

    mode = normalized_feedback["mode"]
    target_only_strict = normalized_feedback["target_only_strict"]
    recast_default = normalized_feedback["recast_default"]
    threshold = normalized_feedback["elicitation_repeat_threshold"]
    end_review_enabled = normalized_feedback["end_review_enabled"]
    silence_ms = normalized_scaffold["silence_tolerance_ms"]
    hint_ladder = normalized_scaffold["hint_ladder"]
    max_modeling = normalized_scaffold["max_modeling_steps"]
    min_words = normalized_output["min_student_turn_words"]
    pressure = normalized_output["follow_up_pressure"]
    allow_clarification_requests = normalized_output["allow_clarification_requests"]

    if correction_light:
        feedback_line = (
            "A separate coach handles error correction. Your job is to hold a natural, "
            "flowing conversation; do not interrupt to correct grammar or vocabulary slips."
        )
        repair_block = (
            "- Still clarify when meaning breaks down or you do not understand the learner.\n"
            "- Give a brief, specific acknowledgment when the learner succeeds (no effusive praise).\n"
            "- When you receive a COACH NOTE between turns, deliver it naturally in your own words, then continue.\n"
        )
    else:
        feedback_line = {
            "fluency_first": "Prioritize flow; keep corrections short and embedded.",
            "accuracy_first": "Prioritize accurate target production; cue self-correction sooner.",
        }.get(
            mode,
            "Balance flow with timely correction; escalate when the same target keeps slipping.",
        )

        # Correction directive(s), routed by target type (Pedagogy Engine S1). When
        # no grammar target is present (incl. the legacy call with targets=None),
        # this is byte-identical to the historical flat line.
        repair_block = "".join(
            f"- {line}\n"
            for line in repair_directive_lines(
                has_grammar_target=any(
                    getattr(target, "kind", None) == "grammar_rule"
                    for target in (targets or [])
                ),
                feedback_mode=mode,
                recast_default=recast_default,
                elicitation_repeat_threshold=threshold,
            )
        )

    scaffold_line = (
        f"Allow about {silence_ms}ms of productive silence before stepping in, "
        f"then use the hint ladder ({_format_hint_ladder(hint_ladder)}) "
        "instead of jumping to the answer."
    )
    modeling_line = (
        "Avoid full modeling unless task completion would otherwise stall completely."
        if max_modeling <= 0
        else f"If self-repair stalls, allow up to {max_modeling} modeling step(s) before accepting and moving on."
    )

    pressure_phrase = {
        "light": "nudge for one more detail when answers are too short.",
        "high": "actively press for elaboration, comparison, and justification.",
    }.get(
        pressure,
        "ask for one more detail or reason when answers stay too brief.",
    )
    output_line = (
        f"Aim for ~{min_words}+ word learner turns; do not accept fragments as "
        f"completion; {pressure_phrase}"
    )
    clarification_line = (
        "Allow the learner to ask for clarification or repetition, but answer in a way that returns responsibility to the learner."
        if allow_clarification_requests
        else "Keep clarification support minimal so the learner must stay in productive output mode."
    )
    review_line = (
        "Near the end, summarize 1-3 recurring issues tied to the learner's actual errors."
        if end_review_enabled
        else "Do not add a formal end-of-session review block unless the learner explicitly asks for one."
    )

    scope_line = (
        "Keep all coaching tied to the mapped targets and success criteria."
        if target_only_strict
        else "Favor mapped targets; briefly support adjacent language only if it helps task completion."
    )

    return (
        "TUTOR STANCE:\n"
        f"- {feedback_line}\n"
        f"{repair_block}"
        f"- {scaffold_line}\n"
        f"- {modeling_line}\n"
        f"- {output_line}\n"
        f"- {clarification_line}\n"
        f"- {review_line}\n"
        f"- {scope_line}"
    )
