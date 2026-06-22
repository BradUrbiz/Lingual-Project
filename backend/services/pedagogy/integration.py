"""Flag-gated bridge between the legacy prompt builder and the S1 engine path.

Lives outside ``pedagogy/__init__`` (it imports the render layer and the legacy
builder, both of which chain to Canvas/compliance) so the plan/routing import
boundary stays clean. The chat routes call ``resolve_assignment_system_prompt``;
flipping ``PEDAGOGY_ENGINE_ASSIGNMENT_RENDER`` switches paths with no code change
— the strangler-fig seam for cutting the assignment prompt over to the engine.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

from backend.services.pedagogy.plan import compile_prompt_plan
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt

if TYPE_CHECKING:  # avoid widening the runtime import surface of this seam
    from backend.services.pedagogy.coverage import CoverageState

_TRUTHY = {"1", "true", "yes", "on"}


def assignment_render_enabled() -> bool:
    """Whether the assignment prompt should render via the Pedagogy Engine (default off)."""
    return os.environ.get("PEDAGOGY_ENGINE_ASSIGNMENT_RENDER", "").strip().lower() in _TRUTHY


def recycling_enabled() -> bool:
    """Whether S2 cross-session recycling is active (default off).

    The route uses this to decide whether to do the extra prior-session/event
    reads + coverage compute. Flag off ⇒ zero extra reads, prompt unchanged.
    """
    return os.environ.get("PEDAGOGY_ENGINE_RECYCLING", "").strip().lower() in _TRUTHY


def resolve_assignment_system_prompt(
    bootstrap: dict[str, Any], *, surface: str, coverage_state: "CoverageState | None" = None
) -> str:
    """Assignment system prompt for ``surface`` ("voice"/"text"), honoring the flag.

    Flag off (default): the legacy ``build_assignment_system_prompt`` output, byte
    for byte. Flag on: the S1 plan->render path — byte-equivalent except grammar
    slips route prompt-first and, for voice, the tutor stance moves last.

    ``coverage_state`` (S2) threads cross-session recycling into the render path.
    It is ignored on the legacy path, and ``None``/empty renders identically to
    today (see ``CoverageState.is_empty``), so callers compute it only when the
    recycling flag is on.
    """
    if not assignment_render_enabled():
        # Imported lazily so the legacy path is the only one that touches the
        # resolver when the flag is off in a fresh process.
        from backend.services.assignment_resolver import build_assignment_system_prompt

        return build_assignment_system_prompt(bootstrap)
    return render_assignment_prompt(
        compile_prompt_plan(bootstrap, coverage_state=coverage_state), surface
    )
