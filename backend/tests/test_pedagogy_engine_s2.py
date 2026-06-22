from __future__ import annotations

import unittest

from backend.services.pedagogy.coverage import (
    CoverageState,
    RepeatedError,
    TargetCoverage,
    compute_coverage_state,
)


class ComputeCoverageStateTestCase(unittest.TestCase):
    def test_tiers_targets_by_hit_count(self):
        state = compute_coverage_state(
            target_surfaces=["quisiera", "la cuenta", "gracias"],
            hit_counts={"quisiera": 0, "la cuenta": 2, "gracias": 4},
            error_counts={},
            prior_session_count=2,
        )
        by_surface = {t.surface: t.tier for t in state.per_target}
        self.assertEqual(by_surface["quisiera"], "not_attempted")
        self.assertEqual(by_surface["la cuenta"], "emerging")
        self.assertEqual(by_surface["gracias"], "solid")
        self.assertEqual(state.uncovered, ["quisiera"])
        self.assertEqual(state.recycle, ["la cuenta"])
        self.assertEqual(state.solid, ["gracias"])
        self.assertFalse(state.is_empty())

    def test_repeated_errors_thresholded(self):
        state = compute_coverage_state(
            target_surfaces=["x"],
            hit_counts={"x": 1},
            error_counts={"ser_vs_estar": 3, "gender_agreement": 1},
            prior_session_count=1,
        )
        labels = {e.label: e.count for e in state.repeated_errors}
        self.assertEqual(labels, {"ser_vs_estar": 3})  # count 1 dropped (< REPEATED_ERROR_MIN)

    def test_no_prior_sessions_is_empty(self):
        state = compute_coverage_state(
            target_surfaces=["x"], hit_counts={}, error_counts={}, prior_session_count=0,
        )
        self.assertTrue(state.is_empty())
        self.assertEqual(state.uncovered, [])
