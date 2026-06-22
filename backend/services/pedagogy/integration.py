"""The assignment-prompt render seam (Pedagogy Engine).

Lives outside ``pedagogy/__init__`` (it imports the render layer, which chains to
the resolver's section writers and thus Canvas/compliance) so the plan/routing
import boundary stays clean. The chat routes call ``resolve_assignment_system_prompt``,
which always renders the assignment prompt via ``compile_prompt_plan`` ->
``render_assignment_prompt`` (the legacy ``build_assignment_system_prompt`` builder
was retired once the engine was cut over). ``recycling_enabled`` still gates the S2
cross-session coverage reads the route performs before calling in.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

from backend.services.pedagogy.plan import compile_prompt_plan
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt

if TYPE_CHECKING:  # avoid widening the runtime import surface of this seam
    from backend.services.pedagogy.coverage import CoverageState

_TRUTHY = {"1", "true", "yes", "on"}


def recycling_enabled() -> bool:
    """Whether S2 cross-session recycling is active (default off).

    The route uses this to decide whether to do the extra prior-session/event
    reads + coverage compute. Flag off ⇒ zero extra reads, prompt unchanged.
    """
    return os.environ.get("PEDAGOGY_ENGINE_RECYCLING", "").strip().lower() in _TRUTHY


def resolve_assignment_system_prompt(
    bootstrap: dict[str, Any], *, surface: str, coverage_state: "CoverageState | None" = None
) -> str:
    """Render the assignment system prompt for ``surface`` ("voice"/"text").

    Always goes through the engine: ``compile_prompt_plan`` -> ``render_assignment_prompt``
    (grammar slips route prompt-first; for voice the tutor stance moves last).

    ``coverage_state`` (S2) threads cross-session recycling into the render. It is
    ``None``/empty unless the recycling flag is on, and an empty state renders
    identically to no coverage (see ``CoverageState.is_empty``), so callers compute
    it only when ``recycling_enabled()``.
    """
    return render_assignment_prompt(
        compile_prompt_plan(bootstrap, coverage_state=coverage_state), surface
    )
