import os
import unittest
from unittest import mock

from backend.services.pedagogy.uptake import build_target_uptake


def _ev(session_id, event_type, turn_index, **payload):
    return {
        "session_id": session_id,
        "event_type": event_type,
        "turn_index": turn_index,
        "payload": payload,
    }


class BuildTargetUptakeTestCase(unittest.TestCase):
    def test_hit_after_elicitation_is_after_prompt(self):
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation", count=1),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["totals"]["afterRecast"], 0)
        self.assertEqual(out["totals"]["unprompted"], 0)
        self.assertEqual(out["totals"]["measured"], 1)

    def test_hit_after_recast_is_after_recast(self):
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast", count=1),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_hit_with_no_preceding_feedback_is_unprompted(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["unprompted"], 1)

    def test_feedback_outside_window_is_unprompted(self):
        # Feedback at turn 1, hit at turn 5, window=2 -> 1 not in [3,4] -> unprompted.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_expression_hit", 5, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"], window=2)
        self.assertEqual(out["totals"]["unprompted"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_vocabulary_hit_uses_word_payload_key(self):
        # metric.target_vocabulary_hit carries the surface under payload['word'].
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_vocabulary_hit", 2, word="relaciones", count=1),
        ]
        out = build_target_uptake(events, ["relaciones"])
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["perTarget"][0]["surface"], "relaciones")

    def test_sessions_are_isolated(self):
        # Feedback in s1 must not classify a hit in s2.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s2", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["unprompted"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_count_weighting(self):
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=3),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 3)
        self.assertEqual(out["totals"]["measured"], 3)

    def test_non_target_surface_ignored(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="hola", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["measured"], 0)
        self.assertEqual(out["perTarget"], [])

    def test_malformed_events_skipped(self):
        events = [
            "not a dict",
            {"event_type": "metric.target_expression_hit"},  # no turn_index
            _ev("s1", "metric.target_expression_hit", None, expression="la cuenta"),  # turn_index None
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        # only the well-formed hit counts; no raise
        self.assertEqual(out["totals"]["measured"], 1)
        self.assertEqual(out["totals"]["unprompted"], 1)

    def test_same_turn_recast_and_elicitation_tie_is_after_recast(self):
        # A single assistant turn detected as BOTH -> form was available -> conservative afterRecast.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_nearest_preceding_feedback_wins(self):
        # recast at turn 1, elicitation at turn 3, hit at turn 4, window=3 -> nearest (3) -> afterPrompt.
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "feedback.elicitation", 3, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_expression_hit", 4, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"], window=3)
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["totals"]["afterRecast"], 0)

    def test_per_target_ordered_by_target_surfaces_and_only_produced(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="b", count=1),
            _ev("s1", "metric.target_expression_hit", 4, expression="a", count=1),
        ]
        out = build_target_uptake(events, ["a", "b", "c"])  # c never produced
        self.assertEqual([t["surface"] for t in out["perTarget"]], ["a", "b"])

    def test_empty_events(self):
        out = build_target_uptake([], ["la cuenta"])
        self.assertEqual(out["totals"], {"afterPrompt": 0, "afterRecast": 0, "unprompted": 0, "measured": 0})
        self.assertEqual(out["perTarget"], [])
        self.assertEqual(out["window"], 2)


if __name__ == "__main__":
    unittest.main()
