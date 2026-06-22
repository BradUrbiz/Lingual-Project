"""``PromptPlan`` — the thin S1 spine the assignment prompt is re-expressed over.

``compile_prompt_plan(bootstrap)`` reads the already-resolved bootstrap that
``build_assignment_system_prompt`` receives today and produces a typed plan:
loose teacher fields become :class:`Target` objects with a feedback route, the
teacher policies ride along, and the rich content sub-dicts sit in
``task_context`` so the renderer can reproduce the current sections.

Import boundary (invariant 7a): this module imports only the stdlib plus
``pedagogy.policies`` and ``pedagogy.routing`` — never an OpenAI client and
never Canvas/resolver content code.

This is deliberately a *thin* intermediate, not the six-bucket
``CompiledConstraints`` target model (rubric / evidence_plan / allowances /
coverage quotas / phases / task_family derivation are S2+). It grows a bucket
only when a downstream layer actually consumes it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.services.pedagogy.policies import (
    normalize_feedback_policy,
    normalize_output_policy,
)
from backend.services.pedagogy.routing import feedback_route_for

# Pedagogy guarantees a teacher turns OFF by choosing raw tutor mode
# (custom_prompt). Surfaced in the preview so the choice is informed.
_RAW_MODE_DISABLED_GUARANTEES = [
    "target elicitation + coverage",
    "target-type-aware correction routing",
    "one-focus-per-turn correction",
    "anti-sycophancy / confirmative acknowledgment",
    "scaffold + output-pressure stance",
]


@dataclass(frozen=True)
class Target:
    """A single teacher target the tutor should elicit, with its feedback route."""

    surface: str  # the expression / word / grammar form
    kind: str  # expression | vocabulary | grammar_rule | objective
    feedback_route: str  # prompt_first | recast_first (derived in routing.py)


@dataclass
class PromptPlan:
    """What the assignment renderer consumes. See module docstring for scope."""

    base_prompt: str  # systemPromptPreview, already locale-baked upstream
    task_type: str  # persisted enum (information_gap/...); NOT yet a task_family
    is_custom_prompt: bool  # raw-tutor-mode bypass (engine off, base passes through)
    targets: list[Target]
    feedback_policy: dict[str, Any]  # raw mapping.feedbackPolicy (or {})
    scaffold_policy: dict[str, Any]  # raw mapping.scaffoldPolicy (or {})
    output_policy: dict[str, Any]  # normalized WITH evidence (mirrors the resolver)
    task_context: dict[str, Any]  # raw assignment/classroom/mapping/curriculum/pedagogy
    render_notes: dict[str, Any] = field(default_factory=dict)  # reserved (S3 surface hints)


def _clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _objective_surfaces(curriculum: dict[str, Any]) -> list[str]:
    """Mirror ``_build_assignment_targets``: canDo.en (or id) per objective."""
    objectives = curriculum.get("objectives")
    surfaces: list[str] = []
    for objective in objectives if isinstance(objectives, list) else []:
        if not isinstance(objective, dict):
            continue
        can_do = _as_dict(objective.get("canDo"))
        surface = can_do.get("en") or objective.get("id")
        if isinstance(surface, str) and surface.strip():
            surfaces.append(surface)
    return surfaces


def _typed(surfaces: list[str], kind: str) -> list[Target]:
    route = feedback_route_for(kind)
    return [Target(surface=surface, kind=kind, feedback_route=route) for surface in surfaces]


def compile_prompt_plan(bootstrap: dict[str, Any]) -> PromptPlan:
    """Compile a resolved assignment ``bootstrap`` into a :class:`PromptPlan`.

    For ``task_type == "custom_prompt"`` (raw tutor mode) the engine is off: the
    returned plan carries ``is_custom_prompt=True`` and no targets, and the
    renderer passes the base prompt through unchanged.
    """
    bootstrap = _as_dict(bootstrap)
    base_prompt = (bootstrap.get("systemPromptPreview") or "").strip()
    assignment = _as_dict(bootstrap.get("assignment"))
    task_type = assignment.get("taskType") or ""

    if task_type == "custom_prompt":
        return PromptPlan(
            base_prompt=base_prompt,
            task_type=task_type,
            is_custom_prompt=True,
            targets=[],
            feedback_policy={},
            scaffold_policy={},
            output_policy={},
            task_context={},
            render_notes={},
        )

    mapping = _as_dict(bootstrap.get("mapping"))
    classroom = _as_dict(bootstrap.get("class"))
    curriculum = _as_dict(bootstrap.get("curriculum"))
    pedagogy = _as_dict(curriculum.get("pedagogy"))

    feedback_policy = mapping.get("feedbackPolicy") or {}
    scaffold_policy = mapping.get("scaffoldPolicy") or {}
    # Pre-normalize output policy WITH evidence, exactly as the resolver does at
    # the top of build_assignment_system_prompt — required for byte-equivalence.
    output_policy = normalize_output_policy(
        mapping.get("outputPolicy"),
        task_type="",
        evidence=pedagogy.get("evidence"),
        feedback_mode=feedback_policy.get("mode", "balanced"),
    )

    targets = (
        _typed(_objective_surfaces(curriculum), "objective")
        + _typed(_clean_string_list(mapping.get("targetExpressions")), "expression")
        + _typed(_clean_string_list(mapping.get("targetVocabulary")), "vocabulary")
        + _typed(_clean_string_list(mapping.get("focusGrammar")), "grammar_rule")
    )

    task_context = {
        "assignment": assignment,
        "classroom": classroom,
        "mapping": mapping,
        "curriculum": curriculum,
        "pedagogy": pedagogy,
    }

    return PromptPlan(
        base_prompt=base_prompt,
        task_type=task_type,
        is_custom_prompt=False,
        targets=targets,
        feedback_policy=feedback_policy,
        scaffold_policy=scaffold_policy,
        output_policy=output_policy,
        task_context=task_context,
        render_notes={},
    )


def serialize_plan_preview(plan: PromptPlan) -> dict[str, Any]:
    """A teacher-facing summary of what the engine inferred (L8 minimal hook).

    Pure and JSON-able, so it can be persisted into the existing
    ``systemPromptPreview`` / ``practice_sessions.system_prompt_preview`` surface
    and bound by the S4 teacher-override UI. For raw tutor mode it instead lists
    the pedagogy guarantees the teacher turned off.
    """
    if plan.is_custom_prompt:
        return {
            "engineEnabled": False,
            "rawTutorMode": True,
            "guaranteesDisabled": list(_RAW_MODE_DISABLED_GUARANTEES),
        }

    feedback = normalize_feedback_policy(plan.feedback_policy)
    return {
        "engineEnabled": True,
        "rawTutorMode": False,
        "taskType": plan.task_type,
        "correctionPosture": {
            "mode": feedback["mode"],
            "recastDefault": feedback["recast_default"],
            "elicitationRepeatThreshold": feedback["elicitation_repeat_threshold"],
        },
        "targets": [
            {"surface": t.surface, "kind": t.kind, "feedbackRoute": t.feedback_route}
            for t in plan.targets
        ],
    }
