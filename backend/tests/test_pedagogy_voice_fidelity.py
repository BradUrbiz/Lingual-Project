import unittest

from backend.services.pedagogy.voice_fidelity import build_voice_fidelity


def _turn(session_id, turn_index, content, source):
    return {"session_id": session_id, "event_type": "student.turn", "turn_index": turn_index,
            "payload": {"content": content, "source": source}}


def _hit(session_id, turn_index, expression, count=1):
    return {"session_id": session_id, "event_type": "metric.target_expression_hit",
            "turn_index": turn_index, "payload": {"expression": expression, "count": count}}


def _vocab_hit(session_id, turn_index, word, count=1):
    return {"session_id": session_id, "event_type": "metric.target_vocabulary_hit",
            "turn_index": turn_index, "payload": {"word": word, "count": count}}


def _dropout(session_id, turn_index):
    return {"session_id": session_id, "event_type": "metric.voice_transcript_lost",
            "turn_index": turn_index, "payload": {"source": "realtime"}}


class BuildVoiceFidelityTestCase(unittest.TestCase):
    def test_voice_hit_attributed_to_voice(self):
        events = [_turn("s1", 0, "quiero la cuenta", "realtime"), _hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 1, "text": 0, "unknown": 0})

    def test_text_hit_attributed_to_text(self):
        events = [_turn("s1", 0, "quiero la cuenta", "text"), _hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 1, "unknown": 0})

    def test_hit_without_sibling_turn_is_unknown(self):
        # Hit exists but no student.turn at that (session, turn_index) -> unknown.
        events = [_hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 1})

    def test_hybrid_session_attributes_per_turn_not_per_session(self):
        # Same session, one voice turn + one text turn -> split by turn source.
        events = [
            _turn("s1", 0, "la cuenta", "realtime"), _hit("s1", 0, "la cuenta"),
            _turn("s1", 2, "gracias", "text"), _hit("s1", 2, "gracias"),
        ]
        out = build_voice_fidelity(events, ["la cuenta", "gracias"])
        self.assertEqual(out["modalitySplit"], {"voice": 1, "text": 1, "unknown": 0})

    def test_substring_miss_when_fuzzy_catches_but_no_exact_hit(self):
        # ASR drift "grasias" -> exact matcher recorded NO hit, fuzzy catches -> 1 miss.
        events = [_turn("s1", 0, "muchas grasias", "realtime")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 1)
        self.assertEqual(out["perTarget"][0]["substringMiss"], 1)

    def test_no_substring_miss_when_exact_hit_present(self):
        # Exact hit already recorded for this turn -> not a miss even if fuzzy also matches.
        events = [_turn("s1", 0, "gracias", "realtime"), _hit("s1", 0, "gracias")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 0)

    def test_substring_miss_only_on_voice_turns(self):
        # A text turn with drift is NOT probed for substring-miss (typed text is exact).
        events = [_turn("s1", 0, "grasias", "text")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 0)

    def test_dropout_turns_counted(self):
        events = [_dropout("s1", 1), _dropout("s1", 3)]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["dropoutTurns"], 2)

    def test_vocabulary_hit_uses_word_key(self):
        events = [_turn("s1", 0, "las relaciones", "realtime"), _vocab_hit("s1", 0, "relaciones")]
        out = build_voice_fidelity(events, ["relaciones"])
        self.assertEqual(out["modalitySplit"]["voice"], 1)

    def test_count_weighting(self):
        events = [_turn("s1", 0, "la cuenta la cuenta", "realtime"), _hit("s1", 0, "la cuenta", count=2)]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"]["voice"], 2)

    def test_non_target_surface_ignored(self):
        events = [_turn("s1", 0, "hola", "realtime"), _hit("s1", 0, "hola")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 0})
        self.assertEqual(out["perTarget"], [])

    def test_malformed_events_skipped(self):
        events = [
            "not a dict",
            {"event_type": "student.turn"},  # no turn_index
            {"event_type": "metric.target_expression_hit", "turn_index": None,
             "payload": {"expression": "la cuenta"}},
            _turn("s1", 0, "la cuenta", "realtime"), _hit("s1", 0, "la cuenta"),
        ]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"]["voice"], 1)

    def test_voice_turns_counted(self):
        events = [_turn("s1", 0, "hola", "realtime"), _turn("s1", 2, "adios", "realtime"),
                  _turn("s1", 4, "typed", "text")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["voiceTurns"], 2)

    def test_per_target_ordered_by_target_surfaces(self):
        events = [
            _turn("s1", 0, "b", "realtime"), _hit("s1", 0, "b"),
            _turn("s1", 2, "a", "realtime"), _hit("s1", 2, "a"),
        ]
        out = build_voice_fidelity(events, ["a", "b", "c"])  # c never produced
        self.assertEqual([t["surface"] for t in out["perTarget"]], ["a", "b"])

    def test_empty_events(self):
        out = build_voice_fidelity([], ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 0})
        self.assertEqual(out["substringMissEstimate"], 0)
        self.assertEqual(out["dropoutTurns"], 0)
        self.assertEqual(out["voiceTurns"], 0)
        self.assertEqual(out["perTarget"], [])
        self.assertEqual(out["fuzzyThreshold"], 0.85)


if __name__ == "__main__":
    unittest.main()
