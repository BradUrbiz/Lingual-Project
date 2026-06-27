"""Task–Target Alignment join (Teacher FDE Phase 1, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Joins the plan's INTENDED targets with class-aggregate REALIZED hit-counts and
emits the teacher-facing ``realized`` block. The DB read + per-session aggregation
happens in the analytics/route layer; this module receives plain counts.
"""

from __future__ import annotations

from typing import Any

from backend.services.pedagogy.coverage import compute_coverage_state

_MEASURABLE_KINDS = {"expression", "vocabulary"}


def build_alignment(plan_targets: list[dict], realized_input: dict) -> dict[str, Any]:
    """Join intended ``plan_targets`` with ``realized_input``. Total / no-raise."""
    plan_targets = plan_targets or []
    realized_input = realized_input or {}
    hit_counts = realized_input.get("hit_counts") or {}
    students_elicited = realized_input.get("students_elicited") or {}
    student_count = int(realized_input.get("student_count") or 0)
    session_count = int(realized_input.get("session_count") or 0)

    lexical_surfaces = [
        t.get("surface") for t in plan_targets if t.get("kind") in _MEASURABLE_KINDS
    ]
    coverage = compute_coverage_state(lexical_surfaces, hit_counts, {}, max(session_count, 1))
    tier_by_surface = {tc.surface: tc.tier for tc in coverage.per_target}
    hits_by_surface = {tc.surface: tc.hits for tc in coverage.per_target}

    per_target: list[dict] = []
    never: list[str] = []
    measurable_count = elicited_count = solid_count = 0
    for t in plan_targets:
        surface = t.get("surface")
        kind = t.get("kind")
        if kind in _MEASURABLE_KINDS:
            measurable_count += 1
            hits = int(hits_by_surface.get(surface, 0))
            tier = tier_by_surface.get(surface, "not_attempted")
            if hits > 0:
                elicited_count += 1
            else:
                never.append(surface)
            if tier == "solid":
                solid_count += 1
            per_target.append({
                "surface": surface, "kind": kind, "measurable": True,
                "hits": hits, "tier": tier,
                "studentsElicited": int((students_elicited or {}).get(surface, 0)),
            })
        else:
            per_target.append({
                "surface": surface, "kind": kind, "measurable": False,
                "hits": None, "tier": None, "studentsElicited": None,
            })

    return {
        "studentCount": student_count,
        "sessionCount": session_count,
        "perTarget": per_target,
        "neverElicited": never,
        "alignmentRate": {
            "measurableTargetCount": measurable_count,
            "elicitedCount": elicited_count,
            "solidCount": solid_count,
        },
    }
