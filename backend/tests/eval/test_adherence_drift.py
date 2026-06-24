"""CI-gated, cost-free tests for the S5-gate adherence/drift scorer. No LLM."""
import unittest

from backend.tests.eval.adherence_drift import (
    ADHERENCE_TARGET,
    aggregate_drift,
    coerce_adherence_verdict,
    score_turn,
)


class ScoreTurnTestCase(unittest.TestCase):
    def test_all_upheld_is_one(self):
        self.assertEqual(score_turn({"target_language": True, "one_focus": True}), 1.0)

    def test_none_upheld_is_zero(self):
        self.assertEqual(score_turn({"target_language": False, "one_focus": False}), 0.0)

    def test_partial_fraction(self):
        self.assertEqual(score_turn({"target_language": True, "one_focus": False}), 0.5)

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            score_turn({})
        with self.assertRaises(ValueError):
            score_turn("nope")


class AggregateDriftTestCase(unittest.TestCase):
    def test_early_high_late_low_plateaus(self):
        # first 2 high (1.0), last 2 low (0.5): lateRate .5 < .8 AND drift .5 >= .15 → plateaus
        out = aggregate_drift([1.0, 1.0, 0.8, 0.7, 0.6, 0.6, 0.5, 0.5])
        self.assertAlmostEqual(out["earlyRate"], 1.0)
        self.assertAlmostEqual(out["lateRate"], 0.5)
        self.assertGreaterEqual(out["drift"], 0.15)
        self.assertTrue(out["plateaus"])

    def test_flat_high_does_not_plateau(self):
        out = aggregate_drift([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
        self.assertFalse(out["plateaus"])  # lateRate .9 >= target

    def test_never_adhering_does_not_plateau(self):
        # late is low but early was ALSO low → no drift → not an S5 problem
        out = aggregate_drift([0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4])
        self.assertFalse(out["plateaus"])  # drift ~0 < threshold
        self.assertLess(out["earlyRate"], ADHERENCE_TARGET)

    def test_too_few_scores_raises(self):
        with self.assertRaises(ValueError):
            aggregate_drift([1.0, 1.0])  # need >= early_k+late_k = 4 by default... (early_k=late_k=2)

    def test_custom_window(self):
        out = aggregate_drift([1.0, 1.0, 1.0, 0.0], early_k=1, late_k=1)
        self.assertAlmostEqual(out["earlyRate"], 1.0)
        self.assertAlmostEqual(out["lateRate"], 0.0)


class CoerceAdherenceVerdictTestCase(unittest.TestCase):
    def test_real_bools(self):
        self.assertEqual(
            coerce_adherence_verdict({"target_language": True, "one_focus": False}),
            {"target_language": True, "one_focus": False},
        )

    def test_json_string(self):
        self.assertEqual(
            coerce_adherence_verdict('{"target_language": true}'),
            {"target_language": True},
        )

    def test_string_false_maps_false(self):
        self.assertFalse(coerce_adherence_verdict({"one_focus": "false"})["one_focus"])

    def test_ignores_unknown_dimension_keys(self):
        # only ADHERENCE_DIMENSIONS keys are kept
        out = coerce_adherence_verdict({"target_language": True, "bogus": True})
        self.assertEqual(out, {"target_language": True})

    def test_no_recognized_dimension_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict({"bogus": True})

    def test_ambiguous_value_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict({"target_language": "maybe"})

    def test_non_object_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict("[true]")
