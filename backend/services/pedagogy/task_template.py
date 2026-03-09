from __future__ import annotations

from typing import Any

from .template_catalog import (
    COMMUNICATIVE_FUNCTION_HINTS,
    DISCOURSE_MOVE_HINTS,
    REGISTER_HINTS,
    TASK_MODEL_HINTS,
    TASK_TEMPLATE_RULES,
    TEMPLATE_REF_HINTS,
    humanize_identifier,
)


def _normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _unique_preserving_order(items: list[str]) -> list[str]:
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
        summary = _normalize_string(can_do.get("en")) or _normalize_string(objective.get("id"))
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
            dimension_id = _normalize_string(dimension.get("id"))
            if not dimension_id:
                continue
            title_payload = dimension.get("title", {}) if isinstance(dimension.get("title"), dict) else {}
            description_payload = (
                dimension.get("description", {}) if isinstance(dimension.get("description"), dict) else {}
            )
            title = _normalize_string(title_payload.get("en"))
            description = _normalize_string(description_payload.get("en"))
            lookup[dimension_id] = (title or humanize_identifier(dimension_id), description)
    return lookup


def _resolve_template_ref_hints(template_refs: list[str]) -> list[str]:
    hints: list[str] = []
    for template_ref in template_refs:
        lowered_ref = template_ref.lower()
        for keyword, hint in TEMPLATE_REF_HINTS.items():
            if keyword in lowered_ref:
                hints.append(hint)
    return _unique_preserving_order(hints)


def _resolve_activity_template_lines(activity_templates: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for template in activity_templates:
        if not isinstance(template, dict):
            continue
        title = _normalize_string((template.get("title") or {}).get("en")) if isinstance(template.get("title"), dict) else ""
        template_id = _normalize_string(template.get("id"))
        assistant_role = _normalize_string(template.get("assistantRole"))
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

        for move in _normalize_string_list(interaction.get("openingMoves")):
            lines.append(f"Template opening move: {move}")
        for move in _normalize_string_list(interaction.get("sustainMoves")):
            lines.append(f"Template sustain move: {move}")
        for move in _normalize_string_list(interaction.get("closingMoves")):
            lines.append(f"Template closing move: {move}")

        completion_rule = _normalize_string(interaction.get("completionRule"))
        if completion_rule:
            lines.append(f"Template completion rule: {completion_rule}")

        for cue in _normalize_string_list(template.get("promptCues")):
            lines.append(f"Template cue: {cue}")

    return _unique_preserving_order(lines)


def _resolve_function_lines(function_ids: list[str]) -> list[str]:
    lines: list[str] = []
    for function_id in function_ids:
        lines.append(
            COMMUNICATIVE_FUNCTION_HINTS.get(
                function_id,
                f"Create a visible moment where the learner must perform {humanize_identifier(function_id)}.",
            )
        )
    return _unique_preserving_order(lines)


def _resolve_discourse_move_lines(move_ids: list[str]) -> list[str]:
    lines: list[str] = []
    for move_id in move_ids:
        lines.append(
            DISCOURSE_MOVE_HINTS.get(
                move_id,
                f"Let the exchange visibly surface the discourse move {humanize_identifier(move_id)}.",
            )
        )
    return _unique_preserving_order(lines)


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

    template_rule = TASK_TEMPLATE_RULES.get(task_type, TASK_TEMPLATE_RULES["decision_making"])
    lines = [
        template_rule["headline"],
        *[
            f"Phase {index}: {phase}"
            for index, phase in enumerate(template_rule["phases"], start=1)
        ],
        f"Completion gate: {template_rule['completion']}",
    ]

    task_model = _normalize_string(pedagogy.get("taskModel"))
    if task_model:
        task_model_hint = TASK_MODEL_HINTS.get(
            task_model,
            f"Keep the interaction consistent with the resolved task model {humanize_identifier(task_model)}.",
        )
        lines.append(task_model_hint)

    scenario_parts: list[str] = []
    setting = _normalize_string(situation_seed.get("setting"))
    roles = _normalize_string_list(situation_seed.get("roles"))
    register = _normalize_string(situation_seed.get("register"))

    if setting:
        scenario_parts.append(f"setting={setting}")
    if roles:
        scenario_parts.append(f"roles={', '.join(roles)}")
    if register:
        scenario_parts.append(f"register={register}")
        register_hint = REGISTER_HINTS.get(register)
        if register_hint:
            lines.append(register_hint)

    if scenario_parts:
        lines.append(f"Resolved scenario anchor: {'; '.join(scenario_parts)}.")

    context_tags = _normalize_string_list(pedagogy.get("contextTags"))
    if context_tags:
        lines.append(
            f"Keep the exchange grounded in these curriculum context tags when possible: {', '.join(context_tags)}."
        )

    allowed_context_tags = _normalize_string_list(mapping.get("allowedContextTags"))
    if allowed_context_tags:
        lines.append(f"Teacher-approved context bounds: {', '.join(allowed_context_tags)}.")

    template_refs = _normalize_string_list(pedagogy.get("templateRefs"))
    activity_templates = pedagogy.get("activityTemplates", []) if isinstance(pedagogy.get("activityTemplates"), list) else []
    if activity_templates:
        lines.extend(_resolve_activity_template_lines(activity_templates))
    if template_refs:
        lines.append(f"Resolved curriculum template references: {', '.join(template_refs)}.")
        if not activity_templates:
            lines.extend(_resolve_template_ref_hints(template_refs))

    communicative_functions = _normalize_string_list(pedagogy.get("communicativeFunctions"))
    if communicative_functions:
        lines.append(
            "Make the learner visibly perform these communicative functions when possible: "
            + ", ".join(communicative_functions)
            + "."
        )
        lines.extend(_resolve_function_lines(communicative_functions))

    discourse_moves = _normalize_string_list(pedagogy.get("discourseMoves"))
    if discourse_moves:
        lines.append(
            "Surface these discourse moves in the interaction when possible: "
            + ", ".join(discourse_moves)
            + "."
        )
        lines.extend(_resolve_discourse_move_lines(discourse_moves))

    rubric_focus = _normalize_string_list(mapping.get("rubricFocus"))
    if rubric_focus:
        rubric_lookup = _resolve_rubric_dimension_lookup(curriculum)
        lines.extend(
            [
                f"Bias the exchange toward rubric evidence for {rubric_lookup.get(dimension_id, (humanize_identifier(dimension_id), ''))[0]}."
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
    time_limit_sec = evidence.get("timeLimitSec")
    max_replays = evidence.get("maxReplays")
    if isinstance(min_turns, int) and min_turns > 0:
        evidence_targets.append(f"about {min_turns} learner turns")
    if isinstance(max_turns, int) and max_turns > 0:
        evidence_targets.append(f"no more than about {max_turns} total turns")
    if isinstance(time_limit_sec, int) and time_limit_sec > 0:
        evidence_targets.append(f"finish within about {time_limit_sec} seconds")
    if evidence_targets:
        lines.append(
            "Plan the interaction to support "
            + ", ".join(evidence_targets)
            + " when the scenario naturally allows it."
        )
    if isinstance(max_replays, int) and max_replays >= 0:
        lines.append(f"Avoid replaying the same prompt more than about {max_replays} time(s) before moving the task forward.")

    success_criteria = _normalize_string_list(assignment.get("successCriteria"))
    if success_criteria:
        lines.append(
            "Do not close the task until the learner has materially demonstrated: "
            + "; ".join(success_criteria)
            + "."
        )

    description = _normalize_string(assignment.get("description"))
    if description:
        lines.append(f"Assignment framing to preserve: {description}")

    return "TASK TEMPLATE DIRECTIVE:\n" + "\n".join(f"- {line}" for line in _unique_preserving_order(lines))
