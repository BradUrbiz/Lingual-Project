"""Teacher-policy normalization for the Pedagogy Engine.

Relocated verbatim from ``assignment_resolver.py:49-230`` (the
policy-normalization helpers the engine owns; the resolver re-imports them for
back-compat). Pure: imports only the stdlib so ``plan.py`` can depend on it
without pulling Canvas/OpenAI (invariant 7a).

``SUPPORTED_FEEDBACK_MODES`` / ``SUPPORTED_OUTPUT_PRESSURES`` are duplicated
here (the resolver keeps its own copies for its own validation) so this module
is self-contained and the move introduces no cross-import.
"""

from __future__ import annotations

from typing import Any

SUPPORTED_FEEDBACK_MODES = {"fluency_first", "balanced", "accuracy_first"}
SUPPORTED_OUTPUT_PRESSURES = {"light", "balanced", "high"}


def _coerce_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return max(0, int(value.strip()))
    return None


def _feedback_mode(value: Any) -> str:
    mode = value.strip() if isinstance(value, str) else ""
    return mode if mode in SUPPORTED_FEEDBACK_MODES else "balanced"


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


def default_output_policy() -> dict[str, Any]:
    return {
        "min_student_turn_words": 8,
        "follow_up_pressure": "balanced",
        "allow_clarification_requests": True,
    }


def normalize_feedback_policy(policy: Any) -> dict[str, Any]:
    normalized = default_feedback_policy()
    if isinstance(policy, dict):
        normalized["mode"] = _feedback_mode(policy.get("mode"))

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
        hint_ladder = policy.get("hint_ladder", policy.get("hintLadder"))
        max_modeling_steps = policy.get("max_modeling_steps", policy.get("maxModelingSteps"))

        normalized_hint_ladder: list[str] = []
        seen = set()
        if isinstance(hint_ladder, list):
            for item in hint_ladder:
                cleaned = item.strip() if isinstance(item, str) else ""
                if not cleaned or cleaned in seen:
                    continue
                normalized_hint_ladder.append(cleaned)
                seen.add(cleaned)

        if isinstance(silence_tolerance_ms, int):
            normalized["silence_tolerance_ms"] = max(0, silence_tolerance_ms)
        if normalized_hint_ladder:
            normalized["hint_ladder"] = normalized_hint_ladder
        if isinstance(max_modeling_steps, int):
            normalized["max_modeling_steps"] = max(0, max_modeling_steps)
    return normalized


def _derived_output_policy_defaults(
    *,
    task_type: str = "",
    evidence: dict[str, Any] | None = None,
    feedback_mode: str = "balanced",
) -> dict[str, Any]:
    derived = default_output_policy()
    normalized_task_type = task_type.strip() if isinstance(task_type, str) else ""
    normalized_feedback_mode = _feedback_mode(feedback_mode)
    evidence = evidence if isinstance(evidence, dict) else {}

    if normalized_task_type == "information_gap":
        derived["min_student_turn_words"] = 6
        derived["follow_up_pressure"] = "balanced"
    elif normalized_task_type == "opinion_gap":
        derived["min_student_turn_words"] = 10
        derived["follow_up_pressure"] = "high"
    elif normalized_task_type == "decision_making":
        derived["min_student_turn_words"] = 9
        derived["follow_up_pressure"] = "high"

    min_turns = _coerce_nonnegative_int(evidence.get("minTurns"))
    if min_turns is not None and min_turns >= 5:
        derived["min_student_turn_words"] = max(derived["min_student_turn_words"], 9)

    if normalized_feedback_mode == "fluency_first":
        derived["follow_up_pressure"] = "light"
    elif normalized_feedback_mode == "accuracy_first":
        derived["follow_up_pressure"] = "high"
        derived["min_student_turn_words"] = max(derived["min_student_turn_words"], 8)

    return derived


def normalize_output_policy(
    policy: Any,
    *,
    task_type: str = "",
    evidence: dict[str, Any] | None = None,
    feedback_mode: str = "balanced",
) -> dict[str, Any]:
    normalized = _derived_output_policy_defaults(
        task_type=task_type,
        evidence=evidence,
        feedback_mode=feedback_mode,
    )
    if isinstance(policy, dict):
        min_student_turn_words = policy.get(
            "min_student_turn_words",
            policy.get("minStudentTurnWords"),
        )
        follow_up_pressure_raw = policy.get("follow_up_pressure", policy.get("followUpPressure"))
        follow_up_pressure = follow_up_pressure_raw.strip() if isinstance(follow_up_pressure_raw, str) else ""
        allow_clarification_requests = policy.get(
            "allow_clarification_requests",
            policy.get("allowClarificationRequests"),
        )

        coerced_min_words = _coerce_nonnegative_int(min_student_turn_words)
        if coerced_min_words is not None:
            normalized["min_student_turn_words"] = max(1, coerced_min_words)
        if follow_up_pressure in SUPPORTED_OUTPUT_PRESSURES:
            normalized["follow_up_pressure"] = follow_up_pressure
        if isinstance(allow_clarification_requests, bool):
            normalized["allow_clarification_requests"] = allow_clarification_requests
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


def serialize_output_policy(
    policy: Any,
    *,
    task_type: str = "",
    evidence: dict[str, Any] | None = None,
    feedback_mode: str = "balanced",
) -> dict[str, Any]:
    normalized = normalize_output_policy(
        policy,
        task_type=task_type,
        evidence=evidence,
        feedback_mode=feedback_mode,
    )
    return {
        "minStudentTurnWords": normalized["min_student_turn_words"],
        "followUpPressure": normalized["follow_up_pressure"],
        "allowClarificationRequests": normalized["allow_clarification_requests"],
    }
