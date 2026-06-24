import os
import unittest
from unittest import mock

from backend.services.pedagogy.drift import (
    DIRECTOR_COOLDOWN_TURNS,
    DIRECTOR_MAX_RESTEERS,
    DriftVerdict,
    ResteerDecision,
    build_resteer_prompt,
    decide_resteer,
    detect_target_neglect,
    serialize_resteer,
)
from backend.services.pedagogy.integration import director_enabled


class DetectTargetNeglectTests(unittest.TestCase):
    def test_no_concrete_targets_is_not_drift(self):
        v = detect_target_neglect(["hola", "que tal", "muy bien"], [])
        self.assertFalse(v.drift)
        self.assertEqual(v.kind, "none")

    def test_fewer_turns_than_window_is_not_drift(self):
        v = detect_target_neglect(["hola", "que tal"], ["la cuenta"])
        self.assertFalse(v.drift)

    def test_target_referenced_in_window_is_not_drift(self):
        turns = ["hablemos del tiempo", "que dia tan bonito", "quieres pedir La Cuenta?"]
        v = detect_target_neglect(turns, ["la cuenta", "para llevar"])
        self.assertFalse(v.drift)

    def test_window_all_off_target_is_drift_and_picks_neglected(self):
        turns = ["hola", "que tal el dia", "te gusta el cafe", "cuentame mas"]
        v = detect_target_neglect(turns, ["la cuenta", "para llevar"])
        self.assertTrue(v.drift)
        self.assertEqual(v.kind, "target_neglect")
        self.assertEqual(v.target, "la cuenta")  # first target absent from the window

    def test_match_is_case_and_edge_insensitive(self):
        turns = ["  PARA LLEVAR, por favor  ", "si", "claro"]
        v = detect_target_neglect(turns, ["para llevar"])
        self.assertFalse(v.drift)


class DecideResteerTests(unittest.TestCase):
    def _drift(self):
        return DriftVerdict(drift=True, kind="target_neglect", target="la cuenta", reason="r")

    def test_no_drift_no_resteer_state_unchanged(self):
        decision, state = decide_resteer({"last_resteer_turn": 3, "resteer_count": 1},
                                         DriftVerdict(False, "none", "", "r"), 5)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, {"last_resteer_turn": 3, "resteer_count": 1})

    def test_first_drift_fires_and_advances_state(self):
        decision, state = decide_resteer({}, self._drift(), 6)
        self.assertTrue(decision.resteer)
        self.assertEqual(decision.signature, "target_neglect:la cuenta")
        self.assertEqual(state, {"last_resteer_turn": 6, "resteer_count": 1})

    def test_within_cooldown_is_suppressed(self):
        state_in = {"last_resteer_turn": 6, "resteer_count": 1}
        decision, state = decide_resteer(state_in, self._drift(),
                                         6 + DIRECTOR_COOLDOWN_TURNS - 1)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, state_in)

    def test_cap_reached_is_suppressed(self):
        state_in = {"last_resteer_turn": 0, "resteer_count": DIRECTOR_MAX_RESTEERS}
        decision, state = decide_resteer(state_in, self._drift(), 100)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, state_in)


class BuildAndSerializeTests(unittest.TestCase):
    def test_prompt_contains_target_and_is_terser_on_voice(self):
        v = DriftVerdict(True, "target_neglect", "la cuenta", "r")
        text = build_resteer_prompt(v, surface="text")
        voice = build_resteer_prompt(v, surface="voice")
        self.assertIn("la cuenta", text)
        self.assertIn("la cuenta", voice)
        self.assertNotIn("#", voice)  # no markdown
        self.assertTrue(len(voice) > 0 and len(text) > 0)
        self.assertNotEqual(text, voice)

    def test_serialize_resteer_shape(self):
        d = ResteerDecision(True, "r", "la cuenta", "target_neglect:la cuenta")
        rec = serialize_resteer(d, turn_index=6, surface="text", prompt="P", generated_at="T")
        self.assertEqual(rec, {
            "turn_index": 6, "kind": "target_neglect", "target": "la cuenta",
            "reason": "r", "prompt": "P", "surface": "text", "generated_at": "T",
        })


class DirectorFlagTests(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_DIRECTOR", None)
            self.assertFalse(director_enabled())

    def test_truthy_values_on(self):
        for val in ("1", "true", "YES", "on"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": val}):
                self.assertTrue(director_enabled())


if __name__ == "__main__":
    unittest.main()
