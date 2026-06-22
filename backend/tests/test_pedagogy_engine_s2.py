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


from backend.services.pedagogy.routing import recycling_directive_lines


class RecyclingDirectiveLinesTestCase(unittest.TestCase):
    def _state(self):
        return compute_coverage_state(
            target_surfaces=["quisiera", "la cuenta", "gracias"],
            hit_counts={"quisiera": 0, "la cuenta": 2, "gracias": 4},
            error_counts={"ser_vs_estar": 3},
            prior_session_count=2,
        )

    def test_empty_state_yields_no_lines(self):
        empty = compute_coverage_state([], {}, {}, 0)
        self.assertEqual(recycling_directive_lines(empty, feedback_mode="balanced", surface="text"), [])

    def test_accuracy_first_is_directed(self):
        lines = recycling_directive_lines(self._state(), feedback_mode="accuracy_first", surface="text")
        joined = " ".join(lines)
        self.assertIn("quisiera", joined)          # uncovered surfaced
        self.assertIn("Make an opening", joined)     # directed wording
        self.assertIn("gracias", joined)             # solid -> push further
        self.assertIn("ser_vs_estar", joined)        # repeated error flagged

    def test_fluency_first_is_low_pressure(self):
        lines = recycling_directive_lines(self._state(), feedback_mode="fluency_first", surface="text")
        joined = " ".join(lines)
        self.assertIn("if it comes up naturally", joined.lower())
        self.assertNotIn("Make an opening", joined)

    def test_voice_surface_is_terser_than_text(self):
        s = self._state()
        text = recycling_directive_lines(s, feedback_mode="accuracy_first", surface="text")
        voice = recycling_directive_lines(s, feedback_mode="accuracy_first", surface="voice")
        self.assertLessEqual(len(" ".join(voice)), len(" ".join(text)))
