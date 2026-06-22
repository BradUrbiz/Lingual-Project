"""Cross-session coverage state — the S2 closed loop (pedagogical decision only).

Import boundary (invariant 7a): stdlib only. The DB read + aggregation happens
in the analytics layer; this module receives plain counts and decides tiers.
"""

from __future__ import annotations

from dataclasses import dataclass

EMERGING_MAX_HITS = 2
SOLID_MIN_HITS = 3
REPEATED_ERROR_MIN = 2


@dataclass(frozen=True)
class TargetCoverage:
    surface: str
    hits: int
    tier: str  # not_attempted | emerging | solid


@dataclass(frozen=True)
class RepeatedError:
    label: str
    count: int


@dataclass(frozen=True)
class CoverageState:
    per_target: list[TargetCoverage]
    uncovered: list[str]
    recycle: list[str]
    solid: list[str]
    repeated_errors: list[RepeatedError]
    prior_session_count: int

    def is_empty(self) -> bool:
        return self.prior_session_count == 0 or not (
            self.uncovered or self.recycle or self.solid or self.repeated_errors
        )


def _tier(hits: int) -> str:
    if hits <= 0:
        return "not_attempted"
    if hits <= EMERGING_MAX_HITS:
        return "emerging"
    return "solid"


def compute_coverage_state(
    target_surfaces: list[str],
    hit_counts: dict[str, int],
    error_counts: dict[str, int],
    prior_session_count: int,
) -> CoverageState:
    prior_session_count = max(0, int(prior_session_count))
    if prior_session_count == 0:
        # First session: no history to recycle from, so the render is a no-op.
        # All recycling buckets stay empty (see CoverageState.is_empty()).
        return CoverageState(
            per_target=[],
            uncovered=[],
            recycle=[],
            solid=[],
            repeated_errors=[],
            prior_session_count=0,
        )
    per_target: list[TargetCoverage] = []
    uncovered: list[str] = []
    recycle: list[str] = []
    solid: list[str] = []
    for surface in target_surfaces:
        hits = max(0, int(hit_counts.get(surface, 0)))
        tier = _tier(hits)
        per_target.append(TargetCoverage(surface=surface, hits=hits, tier=tier))
        if tier == "not_attempted":
            uncovered.append(surface)
        elif tier == "emerging":
            recycle.append(surface)
        else:
            solid.append(surface)
    repeated_errors = [
        RepeatedError(label=label, count=int(count))
        for label, count in error_counts.items()
        if int(count) >= REPEATED_ERROR_MIN
    ]
    repeated_errors.sort(key=lambda e: (-e.count, e.label))
    return CoverageState(
        per_target=per_target,
        uncovered=uncovered,
        recycle=recycle,
        solid=solid,
        repeated_errors=repeated_errors,
        prior_session_count=prior_session_count,
    )
