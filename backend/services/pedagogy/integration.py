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
    from backend.services.pedagogy.affect import AffectState

_TRUTHY = {"1", "true", "yes", "on"}


def recycling_enabled() -> bool:
    """Whether S2 cross-session recycling is active (default off).

    The route uses this to decide whether to do the extra prior-session/event
    reads + coverage compute. Flag off ⇒ zero extra reads, prompt unchanged.
    """
    return os.environ.get("PEDAGOGY_ENGINE_RECYCLING", "").strip().lower() in _TRUTHY


def coach_review_enabled() -> bool:
    """Whether the S3.1 post-task coach review is active (default off).

    Gates the route's transcript read + correction-model call. Flag off ⇒ the
    coach-review endpoint returns a null review doing zero reads/LLM calls.
    """
    return os.environ.get("PEDAGOGY_ENGINE_COACH_REVIEW", "").strip().lower() in _TRUTHY


def coach_chips_enabled() -> bool:
    """Whether S3.2 live between-turn coach chips are on (independent of the
    coach-review and recycling flags). Reads PEDAGOGY_ENGINE_COACH_CHIPS."""
    return os.environ.get("PEDAGOGY_ENGINE_COACH_CHIPS", "").strip().lower() in _TRUTHY


def promote_back_enabled() -> bool:
    """Whether S3.3 promote-back is on (independent flag). Reads PEDAGOGY_ENGINE_PROMOTE_BACK.

    Promote-back rides the S3.2 chip path, so it is effective only with coach chips
    also on; correction-light is additionally gated on coach_chips_enabled() at the
    render seam (resolve_assignment_system_prompt)."""
    return os.environ.get("PEDAGOGY_ENGINE_PROMOTE_BACK", "").strip().lower() in _TRUTHY


def ask_mode_enabled() -> bool:
    """Whether S3.4 Ask mode is on (independent flag). Reads PEDAGOGY_ENGINE_ASK_MODE."""
    return os.environ.get("PEDAGOGY_ENGINE_ASK_MODE", "").strip().lower() in _TRUTHY


def affect_enabled() -> bool:
    """Whether S4.1 affect-aware tutoring is on (independent flag, default off).

    Reads PEDAGOGY_ENGINE_AFFECT. The route uses this to decide whether to do the
    extra prior-session reads + affect compute; flag off ⇒ zero extra reads,
    prompt byte-identical."""
    return os.environ.get("PEDAGOGY_ENGINE_AFFECT", "").strip().lower() in _TRUTHY


def debrief_enabled() -> bool:
    """Whether the S4.2 teacher debrief is on (independent flag, default off).

    Reads PEDAGOGY_ENGINE_DEBRIEF. Gates the read-only debrief endpoint + the
    teacher-side click-through. Flag off ⇒ endpoint returns {success: false}
    doing minimal work, and the frontend hides the debrief link."""
    return os.environ.get("PEDAGOGY_ENGINE_DEBRIEF", "").strip().lower() in _TRUTHY


def debrief_rollup_enabled() -> bool:
    """S4.2b assignment-level debrief roll-up (independent flag, default off).

    Reads PEDAGOGY_ENGINE_DEBRIEF_ROLLUP. The route requires this AND
    debrief_enabled() — the roll-up reuses the session-debrief shapes and is
    meaningless without the per-session debrief. Off ⇒ route returns
    {success: false} doing minimal work; the analytics link is hidden."""
    return os.environ.get("PEDAGOGY_ENGINE_DEBRIEF_ROLLUP", "").strip().lower() in _TRUTHY


def director_enabled() -> bool:
    """S5 — the Director (between-turn drift re-steer). Default off; cutover gated
    on the S5-gate eval verdict (PEDAGOGY_ENGINE.md §14 S5 row)."""
    return os.environ.get("PEDAGOGY_ENGINE_DIRECTOR", "").strip().lower() in _TRUTHY


def chip_fast_gate_enabled() -> bool:
    """Whether the S3.2 chip fast gate is on (default off).

    When on, the chip service also fires on L1-fallback (learner-side shortfall)
    and on a bounded periodic floor, making turn-1 chips locale-agnostic.
    Reads PEDAGOGY_ENGINE_CHIP_FAST_GATE."""
    return os.environ.get("PEDAGOGY_ENGINE_CHIP_FAST_GATE", "").strip().lower() in _TRUTHY


def teacher_preview_enabled() -> bool:
    """L8 Teacher Preview — read-only teacher view of the compiled prompt plan.
    Default off; read-only/additive (no live-path effect)."""
    return os.environ.get("PEDAGOGY_ENGINE_TEACHER_PREVIEW", "").strip().lower() in _TRUTHY


def alignment_view_enabled() -> bool:
    """Teacher FDE Phase 1 — the task–target alignment view (a realized overlay on
    the plan-preview). Default off; read-only/additive (no live-path effect).
    Reads PEDAGOGY_ENGINE_ALIGNMENT_VIEW."""
    return os.environ.get("PEDAGOGY_ENGINE_ALIGNMENT_VIEW", "").strip().lower() in _TRUTHY


def uptake_trace_enabled() -> bool:
    """Teacher FDE — uptake trace (elicitation-vs-recast overlay on the realized
    signal). Default off; read-only/additive (no live-path effect). Rides the
    realized block, so it is effective only with the alignment view also on.
    Reads PEDAGOGY_ENGINE_UPTAKE_TRACE."""
    return os.environ.get("PEDAGOGY_ENGINE_UPTAKE_TRACE", "").strip().lower() in _TRUTHY


def resolve_assignment_system_prompt(
    bootstrap: dict[str, Any],
    *,
    surface: str,
    coverage_state: "CoverageState | None" = None,
    affect_state: "AffectState | None" = None,
) -> str:
    """Render the assignment system prompt for ``surface`` ("voice"/"text").

    Always goes through the engine: ``compile_prompt_plan`` -> ``render_assignment_prompt``
    (grammar slips route prompt-first; for voice the tutor stance moves last).

    S3.3: the main tutor goes correction-light only when promote-back AND coach chips
    are both on, so the coach can actually own correction (no under-correction gap).

    ``coverage_state`` (S2) threads cross-session recycling into the render. It is
    ``None``/empty unless the recycling flag is on, and an empty state renders
    identically to no coverage (see ``CoverageState.is_empty``), so callers compute
    it only when ``recycling_enabled()``.

    ``affect_state`` (S4.1) threads affect-aware stance lines into the render. It is
    ``None`` unless the affect flag is on, and None renders byte-identically to today.
    """
    correction_light = promote_back_enabled() and coach_chips_enabled()
    return render_assignment_prompt(
        compile_prompt_plan(bootstrap, coverage_state=coverage_state, affect_state=affect_state),
        surface,
        correction_light=correction_light,
    )
