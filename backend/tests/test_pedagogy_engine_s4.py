"""Pedagogy Engine S4.1 — affect-aware tutoring (pure layer)."""
import unittest

from backend.services.pedagogy.affect import (
    AffectState,
    affect_stance_lines,
    compute_affect_state,
    serialize_affect_state,
)


def _sig(avg_words, repair_count, turn_count, abandoned=False):
    return {
        "avg_words": avg_words,
        "repair_count": repair_count,
        "turn_count": turn_count,
        "abandoned": abandoned,
    }


class ComputeAffectStateTestCase(unittest.TestCase):
    def test_insufficient_sessions_is_neutral(self):
        # Fewer than MIN_SESSIONS_FOR_AFFECT (2) prior sessions => neutral (byte-identity default).
        state = compute_affect_state([_sig(8.0, 1, 5)])
        self.assertEqual(state.readiness, "neutral")
        self.assertEqual(state.signals["prior_sessions_seen"], 1)

    def test_empty_is_neutral(self):
        self.assertEqual(compute_affect_state([]).readiness, "neutral")

    def test_falling_turn_length_is_strained(self):
        # Most-recent-first: latest 3.0 < 0.7 * mean(10,10)=7.0 => falling => strained.
        state = compute_affect_state([_sig(3.0, 0, 5), _sig(10.0, 0, 5), _sig(10.0, 0, 5)])
        self.assertEqual(state.readiness, "strained")
        self.assertEqual(state.signals["turn_length_trend"], "falling")

    def test_high_repair_density_is_strained(self):
        # density mean = 5/5 = 1.0 > 0.6 => high => strained (trend flat).
        state = compute_affect_state([_sig(8.0, 5, 5), _sig(8.0, 5, 5)])
        self.assertEqual(state.readiness, "strained")
        self.assertEqual(state.signals["repair_density"], "high")

    def test_two_abandonments_is_strained(self):
        state = compute_affect_state([_sig(8.0, 0, 5, abandoned=True), _sig(8.0, 0, 5, abandoned=True)])
        self.assertEqual(state.readiness, "strained")
        self.assertEqual(state.signals["abandonment_recent"], 2)

    def test_one_abandonment_not_enough(self):
        # 1 abandonment < ABANDONMENT_STRAIN_MIN (2); clean otherwise => not strained on that signal.
        state = compute_affect_state([_sig(8.0, 0, 5, abandoned=True), _sig(8.0, 0, 5)])
        self.assertNotEqual(state.signals["abandonment_recent"], 2)
        self.assertIn(state.readiness, {"neutral", "settled"})

    def test_clean_engagement_is_settled(self):
        # flat trend, low repair (0), zero abandonment, >= 2 sessions => settled.
        state = compute_affect_state([_sig(9.0, 0, 6), _sig(9.0, 0, 6)])
        self.assertEqual(state.readiness, "settled")

    def test_mixed_is_neutral(self):
        # moderate repair (density 0.5: between 0.3 and 0.6), flat trend, no abandonment => neutral.
        state = compute_affect_state([_sig(8.0, 3, 6), _sig(8.0, 3, 6)])
        self.assertEqual(state.signals["repair_density"], "moderate")
        self.assertEqual(state.readiness, "neutral")

    def test_window_caps_at_three(self):
        # 5 sessions provided; only the most-recent 3 inform the read.
        state = compute_affect_state([_sig(9.0, 0, 6)] * 5)
        self.assertEqual(state.signals["prior_sessions_seen"], 3)

    def test_zero_avg_words_trend_unknown(self):
        state = compute_affect_state([_sig(0.0, 0, 0), _sig(0.0, 0, 0)])
        self.assertEqual(state.signals["turn_length_trend"], "unknown")


class AffectStanceLinesTestCase(unittest.TestCase):
    def test_neutral_and_settled_emit_nothing(self):
        for readiness in ("neutral", "settled"):
            state = AffectState(readiness=readiness, signals={}, reason="")
            self.assertEqual(affect_stance_lines(state), [])

    def test_none_emits_nothing(self):
        self.assertEqual(affect_stance_lines(None), [])

    def test_strained_emits_warmth_and_correction_softening(self):
        state = AffectState(readiness="strained", signals={}, reason="x")
        lines = affect_stance_lines(state, correction_light=False)
        self.assertTrue(lines)
        joined = " ".join(lines).lower()
        self.assertIn("recast", joined)            # correction-softening line present
        self.assertIn("meaning", joined)           # still correct meaning-blocking errors

    def test_strained_with_correction_light_omits_correction_line(self):
        state = AffectState(readiness="strained", signals={}, reason="x")
        lines = affect_stance_lines(state, correction_light=True)
        self.assertTrue(lines)                      # warmth/patience lines still present
        self.assertNotIn("recast", " ".join(lines).lower())  # correction line dropped (coach owns it)


class SerializeAffectStateTestCase(unittest.TestCase):
    def test_round_trip_shape(self):
        state = AffectState(readiness="strained", signals={"a": 1}, reason="r")
        self.assertEqual(
            serialize_affect_state(state),
            {"readiness": "strained", "signals": {"a": 1}, "reason": "r"},
        )
