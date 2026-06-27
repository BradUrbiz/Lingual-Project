import os
import unittest
from unittest import mock

from backend.services.pedagogy.alignment import build_alignment
from backend.services.practice_analytics import build_assignment_realized_input


def _targets():
    return [
        {"surface": "Me siento ___ cuando ___", "kind": "expression", "feedbackRoute": "recast_first"},
        {"surface": "Conozco a gente que ___", "kind": "expression", "feedbackRoute": "recast_first"},
        {"surface": "relaciones", "kind": "vocabulary", "feedbackRoute": "recast_first"},
        {"surface": "subjuntivo adjetival", "kind": "grammar_rule", "feedbackRoute": "prompt_first"},
        {"surface": "defend a preference", "kind": "objective", "feedbackRoute": "recast_first"},
    ]


class BuildAlignmentTestCase(unittest.TestCase):
    def _realized(self):
        return {
            "hit_counts": {"Me siento ___ cuando ___": 5, "Conozco a gente que ___": 0, "relaciones": 2},
            "students_elicited": {"Me siento ___ cuando ___": 4, "Conozco a gente que ___": 0, "relaciones": 3},
            "student_count": 6,
            "session_count": 8,
        }

    def test_lexical_targets_join_hits_tier_students(self):
        out = build_alignment(_targets(), self._realized())
        by = {t["surface"]: t for t in out["perTarget"]}
        solid = by["Me siento ___ cuando ___"]
        self.assertEqual(solid["measurable"], True)
        self.assertEqual(solid["hits"], 5)
        self.assertEqual(solid["tier"], "solid")
        self.assertEqual(solid["studentsElicited"], 4)
        self.assertEqual(by["relaciones"]["tier"], "emerging")  # 2 hits -> emerging

    def test_never_elicited_lists_zero_hit_lexical_targets(self):
        out = build_alignment(_targets(), self._realized())
        self.assertEqual(out["neverElicited"], ["Conozco a gente que ___"])
        self.assertEqual(by_surface(out, "Conozco a gente que ___")["tier"], "not_attempted")

    def test_grammar_and_objective_are_not_measurable(self):
        out = build_alignment(_targets(), self._realized())
        gram = by_surface(out, "subjuntivo adjetival")
        self.assertEqual(gram["measurable"], False)
        self.assertIsNone(gram["hits"])
        self.assertIsNone(gram["tier"])
        self.assertIsNone(gram["studentsElicited"])
        self.assertEqual(by_surface(out, "defend a preference")["measurable"], False)

    def test_alignment_rate_counts_measurable_only(self):
        out = build_alignment(_targets(), self._realized())
        self.assertEqual(out["alignmentRate"]["measurableTargetCount"], 3)
        self.assertEqual(out["alignmentRate"]["elicitedCount"], 2)   # 2 of 3 lexical had >=1 hit
        self.assertEqual(out["alignmentRate"]["solidCount"], 1)
        self.assertEqual(out["studentCount"], 6)
        self.assertEqual(out["sessionCount"], 8)

    def test_empty_realized_input_degrades_without_raising(self):
        out = build_alignment(_targets(), {})
        self.assertEqual(out["studentCount"], 0)
        self.assertEqual(out["sessionCount"], 0)
        # all lexical fall to not_attempted -> never elicited; grammar/obj stay not measurable
        self.assertEqual(set(out["neverElicited"]),
                         {"Me siento ___ cuando ___", "Conozco a gente que ___", "relaciones"})


def by_surface(out, surface):
    return next(t for t in out["perTarget"] if t["surface"] == surface)


class BuildAssignmentRealizedInputTestCase(unittest.TestCase):
    def _sessions(self):
        return [
            {"student_uid": "s1", "session_summary": {
                "target_expression_hits": {"hola": 2}, "target_vocabulary_hits": {"casa": 1}}},
            {"student_uid": "s2", "session_summary": {
                "target_expression_hits": {"hola": 1}, "target_vocabulary_hits": {}}},
            {"student_uid": "s1", "session_summary": {
                "target_expression_hits": {"hola": 0}, "target_vocabulary_hits": {"casa": 3}}},
        ]

    def test_aggregates_hits_distinct_students_and_counts(self):
        out = build_assignment_realized_input(self._sessions(), ["hola", "casa", "adios"])
        self.assertEqual(out["hit_counts"], {"hola": 3, "casa": 4, "adios": 0})
        self.assertEqual(out["students_elicited"], {"hola": 2, "casa": 1, "adios": 0})  # casa only s1
        self.assertEqual(out["student_count"], 2)   # s1, s2 distinct
        self.assertEqual(out["session_count"], 3)

    def test_empty_sessions(self):
        out = build_assignment_realized_input([], ["hola"])
        self.assertEqual(out, {"hit_counts": {"hola": 0}, "students_elicited": {"hola": 0},
                               "student_count": 0, "session_count": 0})


class AlignmentFlagTestCase(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            from backend.services.pedagogy.integration import alignment_view_enabled
            self.assertFalse(alignment_view_enabled())

    def test_on_when_truthy(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ALIGNMENT_VIEW": "1"}):
            from backend.services.pedagogy.integration import alignment_view_enabled
            self.assertTrue(alignment_view_enabled())


class RealizedWiringTestCase(unittest.TestCase):
    """The route composes build_assignment_realized_input -> build_alignment over
    the plan's lexical targets. This pins that composition."""

    def test_route_composition_attaches_realized(self):
        targets = [
            {"surface": "hola", "kind": "expression", "feedbackRoute": "recast_first"},
            {"surface": "subj", "kind": "grammar_rule", "feedbackRoute": "prompt_first"},
        ]
        sessions = [
            {"student_uid": "s1", "session_summary": {"target_expression_hits": {"hola": 4}}},
        ]
        lexical = [t["surface"] for t in targets
                   if t["kind"] in ("expression", "vocabulary")]
        realized = build_alignment(targets, build_assignment_realized_input(sessions, lexical))
        self.assertEqual(realized["studentCount"], 1)
        self.assertEqual(realized["neverElicited"], [])
        hola = next(t for t in realized["perTarget"] if t["surface"] == "hola")
        self.assertEqual(hola["tier"], "solid")
        subj = next(t for t in realized["perTarget"] if t["surface"] == "subj")
        self.assertFalse(subj["measurable"])


if __name__ == "__main__":
    unittest.main()
