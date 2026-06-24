import unittest

from backend.services.practice_analytics import default_analysis_state, normalize_analysis_state


class DirectorAnalysisStateTests(unittest.TestCase):
    def test_defaults_present(self):
        d = default_analysis_state()
        self.assertEqual(d["director_state"], {})
        self.assertEqual(d["resteers"], [])

    def test_normalize_keeps_valid_director_keys(self):
        out = normalize_analysis_state({
            "director_state": {"last_resteer_turn": 4, "resteer_count": 1},
            "resteers": [{"turn_index": 4, "kind": "target_neglect"}],
        })
        self.assertEqual(out["director_state"], {"last_resteer_turn": 4, "resteer_count": 1})
        self.assertEqual(out["resteers"], [{"turn_index": 4, "kind": "target_neglect"}])

    def test_normalize_rejects_wrong_types(self):
        out = normalize_analysis_state({"director_state": "nope", "resteers": "nope"})
        self.assertEqual(out["director_state"], {})
        self.assertEqual(out["resteers"], [])


if __name__ == "__main__":
    unittest.main()
