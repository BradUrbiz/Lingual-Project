"""Target-type-aware feedback routing — the S1 behaviour win.

Pure decision logic, no I/O, no OpenAI/Canvas imports (invariant 7a). The
research is explicit (Lyster; Ammar & Spada): *prompts beat recasts for
rule-based grammar*, while formulaic/lexical targets fit flow-friendly recasts.
Today's builder applies one flat correction ladder to every target type; S1
splits it by target kind.

Scope note: S1 routes on target-type only. Affect-based override (anxiety / low
WTC -> bias toward recast even on grammar) needs the L3 learner signal and is
deferred to S4. ``recast_default`` stays the global base in the feedback policy;
this routing is a refinement layered on top, not a flip.
"""

from __future__ import annotations

from backend.services.pedagogy.coverage import CoverageState

# Kinds that benefit from prompt-first / self-repair-first correction.
_PROMPT_FIRST_KINDS = frozenset({"grammar_rule"})


def feedback_route_for(kind: str) -> str:
    """Map a :class:`~backend.services.pedagogy.plan.Target` kind to its route.

    Returns ``"prompt_first"`` for rule-based grammar (elicit self-repair before
    modeling) and ``"recast_first"`` for everything else (lexical/formulaic
    targets, objectives, and any unknown kind — the flow-friendly default).
    """
    return "prompt_first" if kind in _PROMPT_FIRST_KINDS else "recast_first"


def grammar_elicitation_timing(feedback_mode: str) -> str:
    """When grammar self-repair fires, modulated by the teacher's feedback mode.

    * ``fluency_first`` -> ``"second_slip"``: protect flow; elicit only on the
      second slip and never mid-breakdown.
    * ``balanced`` / ``accuracy_first`` (and any unknown mode) -> ``"first_slip"``:
      elicit on the first slip; ``accuracy_first`` reinforces this posture.
    """
    return "second_slip" if feedback_mode == "fluency_first" else "first_slip"


def repair_directive_lines(
    *,
    has_grammar_target: bool,
    feedback_mode: str,
    recast_default: bool,
    elicitation_repeat_threshold: int,
) -> list[str]:
    """The TUTOR STANCE correction directive(s), routed by target type.

    Takes a primitive ``has_grammar_target`` (not a ``Target`` — ``plan.py``
    imports this module, so importing ``Target`` here would cycle).

    * ``has_grammar_target=False`` -> a single line *byte-identical* to the
      legacy flat correction line, so no-grammar assignments render unchanged.
    * ``has_grammar_target=True`` -> two lines: grammar slips route prompt-first
      (self-repair, timing modulated by ``feedback_mode``), expression/vocabulary
      slips keep the flow-friendly recast default.
    """
    threshold = elicitation_repeat_threshold
    first_repair = "recast briefly" if recast_default else "cue elicitation"

    if not has_grammar_target:
        return [
            f"On a target slip, {first_repair} the first time; if the same error "
            f"repeats {threshold}+ times, pause to repair and prompt self-correction."
        ]

    if grammar_elicitation_timing(feedback_mode) == "second_slip":
        grammar_line = (
            "On a grammar-target slip, hold off if flow is strong; on the second "
            "slip prompt the learner to self-correct rather than recasting, and "
            "never interrupt mid-breakdown."
        )
    else:
        grammar_line = (
            "On a grammar-target slip, prompt the learner to self-correct on the "
            f"first slip rather than recasting; if the same error repeats {threshold}+ "
            "times, pause to repair explicitly."
        )

    lexical_line = (
        f"On an expression or vocabulary slip, {first_repair} the first time; if the "
        f"same error repeats {threshold}+ times, pause to repair and prompt self-correction."
    )
    return [grammar_line, lexical_line]


def _join_surfaces(surfaces: list[str], limit: int) -> str:
    shown = surfaces[:limit]
    return ", ".join(f"“{s}”" for s in shown)


def recycling_directive_lines(
    coverage_state: CoverageState,
    *,
    feedback_mode: str,
    surface: str,
) -> list[str]:
    """Prior-coverage recycling directives, modulated by feedback mode + surface.

    Empty when there is nothing to recycle (first session / no signal). Voice is
    terser than text (adherence is fragile); accuracy_first is directed,
    fluency_first is low-pressure.
    """
    if coverage_state.is_empty():
        return []

    limit = 2 if surface == "voice" else 4
    directed = feedback_mode == "accuracy_first"
    lines: list[str] = []

    if coverage_state.uncovered:
        targets = _join_surfaces(coverage_state.uncovered, limit)
        if directed:
            lines.append(f"Make an opening to practice {targets} — they haven't used these yet.")
        else:
            lines.append(f"If it comes up naturally, give them a chance to use {targets}.")
    if coverage_state.solid and surface != "voice":
        lines.append(
            f"They've handled {_join_surfaces(coverage_state.solid, limit)} well — vary or extend; don't re-drill."
        )
    if coverage_state.repeated_errors:
        label = coverage_state.repeated_errors[0].label
        lines.append(f"Earlier they slipped on {label}; watch for it and prompt self-repair if it recurs.")
    return lines
