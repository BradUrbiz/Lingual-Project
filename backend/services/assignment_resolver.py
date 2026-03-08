from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


SUPPORTED_ASSIGNMENT_STATUSES = {"draft", "published", "archived"}
SUPPORTED_TASK_TYPES = {"information_gap", "opinion_gap", "decision_making"}
SUPPORTED_MODALITY_MODES = {"text_only", "voice_only", "hybrid"}
TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


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


def default_feedback_policy() -> dict[str, Any]:
    return {
        "mode": "balanced",
        "target_only_strict": False,
        "recast_default": True,
        "elicitation_repeat_threshold": 3,
        "end_review_enabled": True,
    }


def default_scaffold_policy() -> dict[str, Any]:
    return {
        "silence_tolerance_ms": 3000,
        "hint_ladder": ["wait", "context_hint", "choice_prompt", "model_and_retry"],
        "max_modeling_steps": 1,
    }


def default_modality_policy() -> dict[str, Any]:
    return {
        "mode": "hybrid",
        "voice_minutes_cap": None,
        "text_fallback_enabled": True,
    }


def normalize_feedback_policy(policy: Any) -> dict[str, Any]:
    normalized = default_feedback_policy()
    if isinstance(policy, dict):
        mode = _normalize_string(policy.get("mode"))
        if mode:
            normalized["mode"] = mode
        target_only_strict = policy.get("target_only_strict", policy.get("targetOnlyStrict"))
        recast_default = policy.get("recast_default", policy.get("recastDefault"))
        elicitation_repeat_threshold = policy.get(
            "elicitation_repeat_threshold",
            policy.get("elicitationRepeatThreshold"),
        )
        end_review_enabled = policy.get("end_review_enabled", policy.get("endReviewEnabled"))
        if isinstance(target_only_strict, bool):
            normalized["target_only_strict"] = target_only_strict
        if isinstance(recast_default, bool):
            normalized["recast_default"] = recast_default
        if isinstance(elicitation_repeat_threshold, int):
            normalized["elicitation_repeat_threshold"] = max(1, elicitation_repeat_threshold)
        if isinstance(end_review_enabled, bool):
            normalized["end_review_enabled"] = end_review_enabled
    return normalized


def normalize_scaffold_policy(policy: Any) -> dict[str, Any]:
    normalized = default_scaffold_policy()
    if isinstance(policy, dict):
        silence_tolerance_ms = policy.get("silence_tolerance_ms", policy.get("silenceToleranceMs"))
        hint_ladder = _normalize_string_list(policy.get("hint_ladder", policy.get("hintLadder")))
        max_modeling_steps = policy.get("max_modeling_steps", policy.get("maxModelingSteps"))
        if isinstance(silence_tolerance_ms, int):
            normalized["silence_tolerance_ms"] = max(0, silence_tolerance_ms)
        if hint_ladder:
            normalized["hint_ladder"] = hint_ladder
        if isinstance(max_modeling_steps, int):
            normalized["max_modeling_steps"] = max(0, max_modeling_steps)
    return normalized


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


def serialize_feedback_policy(policy: Any) -> dict[str, Any]:
    normalized = normalize_feedback_policy(policy)
    return {
        "mode": normalized["mode"],
        "targetOnlyStrict": normalized["target_only_strict"],
        "recastDefault": normalized["recast_default"],
        "elicitationRepeatThreshold": normalized["elicitation_repeat_threshold"],
        "endReviewEnabled": normalized["end_review_enabled"],
    }


def serialize_scaffold_policy(policy: Any) -> dict[str, Any]:
    normalized = normalize_scaffold_policy(policy)
    return {
        "silenceToleranceMs": normalized["silence_tolerance_ms"],
        "hintLadder": normalized["hint_ladder"],
        "maxModelingSteps": normalized["max_modeling_steps"],
    }


def serialize_modality_policy(policy: Any) -> dict[str, Any]:
    normalized = normalize_modality_policy(policy)
    return {
        "mode": normalized["mode"],
        "voiceMinutesCap": normalized["voice_minutes_cap"],
        "textFallbackEnabled": normalized["text_fallback_enabled"],
    }


def serialize_curriculum_mapping(mapping: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(mapping, dict):
        return None
    return {
        "id": mapping.get("id"),
        "orgId": mapping.get("org_id"),
        "classId": mapping.get("class_id"),
        "packageId": mapping.get("package_id"),
        "moduleId": mapping.get("module_id"),
        "objectiveIds": _normalize_string_list(mapping.get("objective_ids")),
        "situationIds": _normalize_string_list(mapping.get("situation_ids")),
        "targetExpressions": _normalize_string_list(mapping.get("target_expressions")),
        "focusGrammar": _normalize_string_list(mapping.get("focus_grammar")),
        "allowedContextTags": _normalize_string_list(mapping.get("allowed_context_tags")),
        "feedbackPolicy": serialize_feedback_policy(mapping.get("feedback_policy")),
        "scaffoldPolicy": serialize_scaffold_policy(mapping.get("scaffold_policy")),
        "modalityPolicy": serialize_modality_policy(mapping.get("modality_policy")),
        "rubricFocus": _normalize_string_list(mapping.get("rubric_focus")),
        "teacherNotes": mapping.get("teacher_notes", ""),
        "createdByUid": mapping.get("created_by_uid", ""),
        "createdAt": _timestamp_to_iso(mapping.get("created_at")),
        "updatedAt": _timestamp_to_iso(mapping.get("updated_at")),
    }


def serialize_assignment(assignment: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(assignment, dict):
        return None
    return {
        "id": assignment.get("id"),
        "orgId": assignment.get("org_id"),
        "classId": assignment.get("class_id"),
        "mappingId": assignment.get("mapping_id"),
        "title": assignment.get("title", ""),
        "description": assignment.get("description", ""),
        "status": assignment.get("status", "draft"),
        "releaseAt": assignment.get("release_at") or None,
        "dueAt": assignment.get("due_at") or None,
        "modalityOverride": serialize_modality_policy(assignment.get("modality_override")),
        "maxAttempts": assignment.get("max_attempts"),
        "taskType": assignment.get("task_type", "decision_making"),
        "successCriteria": _normalize_string_list(assignment.get("success_criteria")),
        "createdByUid": assignment.get("created_by_uid", ""),
        "createdAt": _timestamp_to_iso(assignment.get("created_at")),
        "updatedAt": _timestamp_to_iso(assignment.get("updated_at")),
    }


def build_sample_package_summary(package: dict[str, Any]) -> dict[str, Any]:
    curriculum = package.get("curriculum", {}) if isinstance(package, dict) else {}
    source = curriculum.get("source", {}) if isinstance(curriculum, dict) else {}
    return {
        "id": curriculum.get("id"),
        "title": curriculum.get("title", {}),
        "learningLocale": curriculum.get("learningLocale"),
        "levelBand": curriculum.get("levelBand"),
        "version": curriculum.get("version"),
        "sourceType": source.get("type", "native"),
        "status": "active",
        "ownerScope": "global",
    }


def _package_objective_index(package: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        objective.get("id"): objective
        for objective in package.get("objectives", [])
        if isinstance(objective, dict) and objective.get("id")
    }


def _package_rubric_index(package: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        rubric.get("id"): rubric
        for rubric in package.get("rubrics", [])
        if isinstance(rubric, dict) and rubric.get("id")
    }


def _unique_ordered_strings(values: list[Any]) -> list[str]:
    normalized = []
    seen = set()
    for value in values:
        cleaned = _normalize_string(value)
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _serialize_bootstrap_objective(objective: dict[str, Any]) -> dict[str, Any]:
    mastery = objective.get("mastery", {}) if isinstance(objective, dict) else {}
    evidence_model = objective.get("evidenceModel", {}) if isinstance(objective, dict) else {}
    return {
        "id": objective.get("id"),
        "mode": objective.get("mode"),
        "canDo": objective.get("canDo", {}),
        "contextTags": _normalize_string_list(objective.get("contextTags")),
        "communicativeFunctions": _normalize_string_list(objective.get("communicativeFunctions")),
        "discourseMoves": _normalize_string_list(objective.get("discourseMoves")),
        "foundationDomains": _normalize_string_list(objective.get("foundationDomains")),
        "register": objective.get("register"),
        "mastery": {
            "rubricId": _normalize_string(mastery.get("rubricId")),
            "threshold": mastery.get("threshold"),
        },
        "evidenceModel": {
            "taskModel": _normalize_string(evidence_model.get("taskModel")),
            "timeLimitSec": evidence_model.get("timeLimitSec"),
            "minTurns": evidence_model.get("minTurns"),
            "inputProfile": evidence_model.get("inputProfile", {}),
        },
        "templateRefs": _normalize_string_list(objective.get("templateRefs")),
    }


def _serialize_bootstrap_rubric(rubric: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": rubric.get("id"),
        "title": rubric.get("title", {}),
        "scale": rubric.get("scale", {}),
        "dimensions": [
            {
                "id": dimension.get("id"),
                "title": dimension.get("title", {}),
                "description": dimension.get("description", {}),
            }
            for dimension in rubric.get("dimensions", [])
            if isinstance(dimension, dict) and dimension.get("id")
        ],
        "notes": rubric.get("notes", ""),
    }


def _build_bootstrap_pedagogy_context(
    module: dict[str, Any],
    situation: dict[str, Any],
    objectives: list[dict[str, Any]],
    rubrics: list[dict[str, Any]],
) -> dict[str, Any]:
    module_capstone = module.get("capstone", {}) if isinstance(module, dict) else {}
    situation_seed = situation.get("seed", {}) if isinstance(situation, dict) else {}
    situation_constraints = situation_seed.get("constraints", {}) if isinstance(situation_seed, dict) else {}

    task_model_candidates = [
        module_capstone.get("taskModel"),
        *[
            (objective.get("evidenceModel") or {}).get("taskModel")
            for objective in objectives
            if isinstance(objective, dict)
        ],
    ]
    time_limit_candidates = [
        situation_constraints.get("timeLimitSec"),
        *[
            (objective.get("evidenceModel") or {}).get("timeLimitSec")
            for objective in objectives
            if isinstance(objective, dict)
        ],
    ]
    min_turn_candidates = [
        situation_constraints.get("minTurns"),
        *[
            (objective.get("evidenceModel") or {}).get("minTurns")
            for objective in objectives
            if isinstance(objective, dict)
        ],
    ]

    return {
        "taskModel": next((value for value in task_model_candidates if _normalize_string(value)), ""),
        "evidence": {
            "timeLimitSec": next((value for value in time_limit_candidates if isinstance(value, int)), None),
            "minTurns": next((value for value in min_turn_candidates if isinstance(value, int)), None),
            "maxTurns": situation_constraints.get("maxTurns")
            if isinstance(situation_constraints.get("maxTurns"), int)
            else None,
            "maxReplays": situation_constraints.get("maxReplays")
            if isinstance(situation_constraints.get("maxReplays"), int)
            else None,
        },
        "contextTags": _unique_ordered_strings(
            [
                *(situation_seed.get("contextTags") or []),
                *[
                    tag
                    for objective in objectives
                    if isinstance(objective, dict)
                    for tag in (objective.get("contextTags") or [])
                ],
            ]
        ),
        "communicativeFunctions": _unique_ordered_strings(
            [
                function_id
                for objective in objectives
                if isinstance(objective, dict)
                for function_id in (objective.get("communicativeFunctions") or [])
            ]
        ),
        "discourseMoves": _unique_ordered_strings(
            [
                move_id
                for objective in objectives
                if isinstance(objective, dict)
                for move_id in (objective.get("discourseMoves") or [])
            ]
        ),
        "foundationDomains": _unique_ordered_strings(
            [
                domain_id
                for objective in objectives
                if isinstance(objective, dict)
                for domain_id in (objective.get("foundationDomains") or [])
            ]
        ),
        "templateRefs": _unique_ordered_strings(
            [
                template_id
                for objective in objectives
                if isinstance(objective, dict)
                for template_id in (objective.get("templateRefs") or [])
            ]
        ),
        "objectiveIds": _unique_ordered_strings(
            [objective.get("id") for objective in objectives if isinstance(objective, dict)]
        ),
        "rubricIds": _unique_ordered_strings(
            [
                (objective.get("mastery") or {}).get("rubricId")
                for objective in objectives
                if isinstance(objective, dict)
            ]
        ),
        "rubricDimensionIds": _unique_ordered_strings(
            [
                dimension.get("id")
                for rubric in rubrics
                if isinstance(rubric, dict)
                for dimension in (rubric.get("dimensions") or [])
                if isinstance(dimension, dict)
            ]
        ),
    }


def resolve_assignment_bootstrap(
    deps: Any,
    *,
    assignment: dict[str, Any],
    mapping: dict[str, Any],
    class_record: dict[str, Any],
    ui_language: str = "en",
) -> dict[str, Any]:
    mapping_dto = serialize_curriculum_mapping(mapping)
    assignment_dto = serialize_assignment(assignment)
    if not mapping_dto or not assignment_dto:
        raise ValueError("Assignment bootstrap requires both mapping and assignment records.")

    package = deps.load_sample_curriculum_package()
    package_summary = build_sample_package_summary(package)
    if mapping_dto["packageId"] != package_summary["id"]:
        raise ValueError("Only the sample curriculum package is supported for bootstrap right now.")

    selected_situation_id = (mapping_dto.get("situationIds") or [None])[0]
    if not selected_situation_id:
        raise ValueError("Assignment mapping must define at least one speaking situation.")

    package, unit, module, situation, mode, situation_objectives = deps.get_curriculum_practice_context(
        module_id=mapping_dto["moduleId"],
        situation_id=selected_situation_id,
    )
    objective_index = _package_objective_index(package)
    rubric_index = _package_rubric_index(package)
    mapped_objective_ids = mapping_dto.get("objectiveIds") or []
    resolved_objectives = [
        objective_index[objective_id]
        for objective_id in mapped_objective_ids
        if objective_id in objective_index
    ] or situation_objectives
    resolved_rubrics = [
        rubric_index[rubric_id]
        for rubric_id in _unique_ordered_strings(
            [
                (objective.get("mastery") or {}).get("rubricId")
                for objective in resolved_objectives
                if isinstance(objective, dict)
            ]
        )
        if rubric_id in rubric_index
    ]
    pedagogy_context = _build_bootstrap_pedagogy_context(
        module=module,
        situation=situation,
        objectives=resolved_objectives,
        rubrics=resolved_rubrics,
    )

    system_prompt_preview = deps.build_curriculum_system_prompt(
        package=package,
        unit=unit,
        module=module,
        situation=situation,
        mode=mode,
        objectives=resolved_objectives,
        ui_language=ui_language,
    )

    launch_modality = normalize_modality_policy(
        assignment_dto.get("modalityOverride") or mapping_dto.get("modalityPolicy") or {}
    )

    return {
        "assignment": assignment_dto,
        "mapping": mapping_dto,
        "class": {
            "id": class_record.get("id"),
            "orgId": class_record.get("org_id"),
            "name": class_record.get("name", ""),
            "term": class_record.get("term", ""),
            "subject": class_record.get("subject", ""),
            "learningLocale": class_record.get("learning_locale", "ko-KR"),
            "gradeBand": class_record.get("grade_band", ""),
            "status": class_record.get("status", "active"),
        },
        "curriculum": {
            "package": package_summary,
            "unit": {
                "id": unit.get("id"),
                "title": unit.get("title", {}),
                "unitNumber": (unit.get("ap") or {}).get("unitNumber"),
            },
            "module": {
                "id": module.get("id"),
                "title": module.get("title", {}),
                "goal": module.get("moduleGoal", {}),
                "capstone": {
                    "mode": (module.get("capstone") or {}).get("mode"),
                    "taskModel": (module.get("capstone") or {}).get("taskModel"),
                    "situationId": (module.get("capstone") or {}).get("situationId"),
                } if isinstance(module.get("capstone"), dict) else None,
            },
            "situation": {
                "id": situation.get("id"),
                "kind": situation.get("kind"),
                "seed": situation.get("seed", {}),
                "objectiveIds": _normalize_string_list(situation.get("objectiveIds")),
            },
            "objectives": [
                _serialize_bootstrap_objective(objective)
                for objective in resolved_objectives
                if isinstance(objective, dict)
            ],
            "rubrics": [
                _serialize_bootstrap_rubric(rubric)
                for rubric in resolved_rubrics
                if isinstance(rubric, dict)
            ],
            "pedagogy": pedagogy_context,
        },
        "launch": {
            "modality": serialize_modality_policy(launch_modality),
            "voiceAllowed": True,
            "textAllowed": True,
            "maxAttempts": assignment_dto.get("maxAttempts"),
            "taskType": assignment_dto.get("taskType"),
        },
        "realtimeSessionParams": {
            "uiLanguage": ui_language,
            "practice": {
                "type": "curriculum_module",
                "curriculumId": package_summary["id"],
                "moduleId": mapping_dto["moduleId"],
                "situationId": selected_situation_id,
                "assignmentId": assignment_dto["id"],
                "classId": assignment_dto["classId"],
                "mappingId": mapping_dto["id"],
                "objectiveIds": pedagogy_context["objectiveIds"],
                "taskModel": pedagogy_context["taskModel"],
                "rubricIds": pedagogy_context["rubricIds"],
            },
        },
        "systemPromptPreview": system_prompt_preview,
        "limitations": [
            "Bootstrap currently supports only the bundled sample curriculum package.",
            "Teacher mapping controls are returned in bootstrap data and only partially injected into live prompt assembly.",
            "Compliance gating is not yet enforced here; voiceAllowed is optimistic until Phase 6 lands.",
        ],
    }


def load_assignment_bundle(deps: Any, assignment_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    assignment = deps.db.get_assignment(assignment_id)
    if not assignment:
        raise ValueError("Assignment not found.")

    class_record = deps.db.get_class(assignment.get("class_id"))
    if not class_record:
        raise ValueError("Class not found for assignment.")

    mapping = deps.db.get_curriculum_mapping(assignment.get("mapping_id"))
    if not mapping:
        raise ValueError("Assignment mapping not found.")

    return assignment, mapping, class_record


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

    bootstrap = resolve_assignment_bootstrap(
        deps,
        assignment=assignment,
        mapping=mapping,
        class_record=class_record,
        ui_language=ui_language,
    )
    bootstrap["teacherPreview"] = teacher_preview
    return bootstrap


def build_assignment_system_prompt(bootstrap: dict[str, Any]) -> str:
    base_prompt = bootstrap.get("systemPromptPreview", "").strip()
    assignment = bootstrap.get("assignment", {}) if isinstance(bootstrap, dict) else {}
    mapping = bootstrap.get("mapping", {}) if isinstance(bootstrap, dict) else {}
    classroom = bootstrap.get("class", {}) if isinstance(bootstrap, dict) else {}
    curriculum = bootstrap.get("curriculum", {}) if isinstance(bootstrap, dict) else {}
    launch = bootstrap.get("launch", {}) if isinstance(bootstrap, dict) else {}
    pedagogy = curriculum.get("pedagogy", {}) if isinstance(curriculum, dict) else {}
    rubric_lines = [
        f"- {rubric.get('title', {}).get('en') or rubric.get('id')}"
        for rubric in curriculum.get("rubrics", [])
        if isinstance(rubric, dict)
    ] or ["- No explicit rubrics were resolved for this assignment."]

    objective_lines = [
        f"- {objective.get('canDo', {}).get('en') or objective.get('id')}"
        for objective in curriculum.get("objectives", [])
        if isinstance(objective, dict)
    ] or ["- Stay aligned to the mapped learning objectives."]

    target_expression_lines = [
        f"- {expression}"
        for expression in mapping.get("targetExpressions", [])
        if isinstance(expression, str) and expression.strip()
    ] or ["- No explicit target expressions were configured."]

    focus_grammar_lines = [
        f"- {grammar_point}"
        for grammar_point in mapping.get("focusGrammar", [])
        if isinstance(grammar_point, str) and grammar_point.strip()
    ] or ["- No explicit focus grammar was configured."]
    communicative_function_lines = [
        f"- {function_id}"
        for function_id in pedagogy.get("communicativeFunctions", [])
        if isinstance(function_id, str) and function_id.strip()
    ] or ["- No explicit communicative functions were resolved."]
    discourse_move_lines = [
        f"- {move_id}"
        for move_id in pedagogy.get("discourseMoves", [])
        if isinstance(move_id, str) and move_id.strip()
    ] or ["- No explicit discourse moves were resolved."]
    foundation_domain_lines = [
        f"- {domain_id}"
        for domain_id in pedagogy.get("foundationDomains", [])
        if isinstance(domain_id, str) and domain_id.strip()
    ] or ["- No explicit foundation domains were resolved."]

    success_criteria_lines = [
        f"- {criterion}"
        for criterion in assignment.get("successCriteria", [])
        if isinstance(criterion, str) and criterion.strip()
    ] or ["- Complete the task with sustained, assignment-aligned output."]

    feedback_policy = mapping.get("feedbackPolicy", {})
    scaffold_policy = mapping.get("scaffoldPolicy", {})
    modality_policy = launch.get("modality", {})

    overlay = f"""
ASSIGNMENT ENVELOPE:
- Assignment title: {assignment.get('title', '')}
- Class: {classroom.get('name', '')}
- Task type: {assignment.get('taskType', '')}
- Max attempts: {assignment.get('maxAttempts') if assignment.get('maxAttempts') is not None else 'unlimited'}
- Voice allowed: {launch.get('voiceAllowed')}
- Text allowed: {launch.get('textAllowed')}
- Modality mode: {modality_policy.get('mode', 'hybrid')}
- Task model: {pedagogy.get('taskModel') or 'n/a'}
- Evidence target min turns: {(pedagogy.get('evidence') or {}).get('minTurns') or 'n/a'}
- Evidence target max turns: {(pedagogy.get('evidence') or {}).get('maxTurns') or 'n/a'}
- Evidence time limit sec: {(pedagogy.get('evidence') or {}).get('timeLimitSec') or 'n/a'}

ASSIGNMENT OBJECTIVES:
{chr(10).join(objective_lines)}

TARGET EXPRESSIONS TO ELICIT:
{chr(10).join(target_expression_lines)}

FOCUS GRAMMAR:
{chr(10).join(focus_grammar_lines)}

COMMUNICATIVE FUNCTIONS TO WATCH:
{chr(10).join(communicative_function_lines)}

DISCOURSE MOVES TO WATCH:
{chr(10).join(discourse_move_lines)}

FOUNDATION DOMAINS TO SUPPORT:
{chr(10).join(foundation_domain_lines)}

RUBRICS IN PLAY:
{chr(10).join(rubric_lines)}

SUCCESS CRITERIA:
{chr(10).join(success_criteria_lines)}

TEACHER POLICY:
- Feedback mode: {feedback_policy.get('mode', 'balanced')}
- Target-only strict: {feedback_policy.get('targetOnlyStrict', False)}
- Recast default: {feedback_policy.get('recastDefault', True)}
- Elicitation repeat threshold: {feedback_policy.get('elicitationRepeatThreshold', 3)}
- End review enabled: {feedback_policy.get('endReviewEnabled', True)}
- Silence tolerance ms: {scaffold_policy.get('silenceToleranceMs', 3000)}
- Hint ladder: {', '.join(scaffold_policy.get('hintLadder', [])) or 'default ladder'}
- Max modeling steps: {scaffold_policy.get('maxModelingSteps', 1)}
- Teacher notes: {mapping.get('teacherNotes', '') or 'n/a'}

PRIORITY RULES:
1. Stay inside the assignment's task type and mapped curriculum scope.
2. Prefer eliciting the configured target expressions before introducing new language.
3. Keep corrective feedback aligned to the configured feedback policy.
4. Use the scaffold ladder instead of giving the answer immediately when the learner hesitates.
5. Push for extended output when the learner gives minimal answers.
""".strip()

    if not base_prompt:
        return overlay
    return f"{base_prompt}\n\n{overlay}"
