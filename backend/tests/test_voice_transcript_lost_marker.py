import unittest

from backend.services.practice_analytics import (
    SUPPORTED_EVENT_TYPES,
    apply_learning_event_to_session,
    build_derived_learning_events,
)

_MARKER = "metric.voice_transcript_lost"


class VoiceTranscriptLostMarkerTestCase(unittest.TestCase):
    def test_marker_is_a_supported_event_type(self):
        # The write route (curriculum_admin) 400s any type not in this set.
        self.assertIn(_MARKER, SUPPORTED_EVENT_TYPES)

    def test_marker_does_not_accumulate_or_change_counters(self):
        # Idempotent under re-application (no accumulating counter) and existing
        # counters preserved -> the marker is inert to session analytics.
        session_record = {
            "session_summary": {"target_expression_hits": {"la cuenta": 2}},
            "status": "active",
        }
        updates1 = apply_learning_event_to_session(
            session_record, event_type=_MARKER, turn_index=3, payload={"source": "realtime"})
        session_record2 = {"session_summary": updates1["session_summary"], "status": "active"}
        updates2 = apply_learning_event_to_session(
            session_record2, event_type=_MARKER, turn_index=4, payload={"source": "realtime"})
        self.assertEqual(updates1["session_summary"], updates2["session_summary"])
        self.assertEqual(updates1["session_summary"].get("target_expression_hits"), {"la cuenta": 2})

    def test_marker_produces_no_derived_events(self):
        out = build_derived_learning_events(
            {"session_summary": {}}, event_type=_MARKER, turn_index=3,
            payload={"source": "realtime"})
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main()
