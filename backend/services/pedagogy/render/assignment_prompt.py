"""Render a :class:`PromptPlan` into the assignment system prompt.

This reproduces ``assignment_resolver.build_assignment_system_prompt`` exactly,
with two intended deltas:

  1. the tutor stance is built with ``plan.targets`` so grammar slips route
     prompt-first (the S1 behaviour win); and
  2. on the voice surface the (most adherence-sensitive) TUTOR STANCE block is
     moved last — "critical-rules-last" for the realtime model, whose
     instruction adherence is fragile. Text keeps the legacy order.

For S1 the section writers (spine / targets / guidance / task template) still
live in ``assignment_resolver`` and are imported here as pure functions; their
physical relocation into this package is a documented fast-follow. That import
is why ``render`` is NOT pulled into ``pedagogy/__init__`` eagerly (it would
chain to Canvas/compliance and taint the plan/routing import boundary); the
package exposes ``render_assignment_prompt`` lazily instead.
"""

from __future__ import annotations

from backend.services.assignment_resolver import (
    _build_assignment_spine,
    _build_assignment_targets,
    _build_teacher_guidance,
    _build_tutor_stance,
    build_task_template_prompt,
)
from backend.services.pedagogy.plan import PromptPlan
from backend.services.pedagogy.routing import recycling_directive_lines


def render_assignment_prompt(plan: PromptPlan, surface: str = "text") -> str:
    """Render ``plan`` to a system-prompt string for ``surface`` ("voice"/"text")."""
    base_prompt = plan.base_prompt

    # Raw tutor mode: engine off, teacher's instructions pass through untouched.
    if plan.is_custom_prompt:
        return base_prompt

    assignment = plan.task_context.get("assignment", {})
    classroom = plan.task_context.get("classroom", {})
    mapping = plan.task_context.get("mapping", {})
    curriculum = plan.task_context.get("curriculum", {})
    pedagogy = plan.task_context.get("pedagogy", {})

    pre_stance: list[str] = [_build_assignment_spine(assignment, classroom)]
    targets = _build_assignment_targets(mapping, curriculum)
    if targets:
        pre_stance.append(targets)
    teacher_guidance = _build_teacher_guidance(mapping)
    if teacher_guidance:
        pre_stance.append(teacher_guidance)

    # The one behaviour win: target-type-aware correction routing.
    stance = _build_tutor_stance(
        plan.feedback_policy,
        plan.scaffold_policy,
        plan.output_policy,
        targets=plan.targets,
    )

    task_directive = build_task_template_prompt(
        task_type="",
        assignment=assignment,
        curriculum=curriculum,
        pedagogy=pedagogy,
        mapping=mapping,
    ).strip()

    recycling_block = ""
    coverage_state = plan.coverage_state
    if coverage_state is not None and not coverage_state.is_empty():
        feedback_mode = (plan.feedback_policy or {}).get("mode", "balanced")
        lines = recycling_directive_lines(coverage_state, feedback_mode=feedback_mode, surface=surface)
        if lines:
            body = "".join(f"- {line}\n" for line in lines)
            recycling_block = f"RECYCLING (prior sessions)\n{body}".strip()

    post_stance: list[str] = [task_directive] if task_directive else []
    if recycling_block:
        post_stance.append(recycling_block)

    if surface == "voice":
        # Critical-rules-last: stance after the task template for the voice model.
        sections = [*pre_stance, *post_stance, stance]
    else:
        # Legacy order: stance immediately after teacher guidance.
        sections = [*pre_stance, stance, *post_stance]

    overlay = "\n\n".join(section for section in sections if section.strip())
    if not base_prompt:
        return overlay
    return f"{base_prompt}\n\n{overlay}".strip()
