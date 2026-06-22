"""Pedagogy Engine — content-source-agnostic AND surface-agnostic.

The reborn ``backend/services/pedagogy/`` (the original was deleted in
``ede4b25`` for content-source coupling). S1 ships the *thin spine*:

    compile_prompt_plan(bootstrap) -> PromptPlan        # plan.py
    render_assignment_prompt(plan, surface) -> str       # render/assignment_prompt.py

with target-type-aware feedback routing (routing.py) as the one behaviour win.

Enforced import boundaries (invariant 7a — see PEDAGOGY_ENGINE.md §2):
  * ``plan.py`` / ``routing.py`` import NO OpenAI client and NO Canvas/resolver
    content code — inputs arrive as already-neutral fields.
  * Only ``render/`` knows about surface/model quirks, and even it emits a
    plain string, never an API payload.

Public API (``compile_prompt_plan`` / ``render_assignment_prompt`` / ``PromptPlan``
/ ``Target``) is re-exported at the bottom of this module, so callers use
``from backend.services.pedagogy import ...``.

See ``docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE_S1.md``.
"""

from __future__ import annotations

# Plan-layer symbols import eagerly — plan.py pulls only policies + routing, so
# `import backend.services.pedagogy.plan` stays Canvas/OpenAI-free (invariant 7a).
from backend.services.pedagogy.plan import (
    PromptPlan,
    Target,
    compile_prompt_plan,
)

__all__ = [
    "PromptPlan",
    "Target",
    "compile_prompt_plan",
    "render_assignment_prompt",
]


def __getattr__(name: str):
    # render_assignment_prompt is exposed lazily: the render layer imports the
    # section writers from assignment_resolver (-> Canvas/compliance), so eager
    # import here would taint a plain `import pedagogy.plan` and break the
    # boundary. PEP 562 defers that chain until the symbol is actually used.
    if name == "render_assignment_prompt":
        from backend.services.pedagogy.render.assignment_prompt import (
            render_assignment_prompt,
        )

        return render_assignment_prompt
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
