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


from backend.services.pedagogy.plan import compile_prompt_plan, serialize_plan_preview
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt


def _assignment_bootstrap():
    return {
        "systemPromptPreview": "BASE",
        "assignment": {"taskType": "information_gap", "title": "Cafe"},
        "class": {"name": "Spanish I"},
        "mapping": {
            "targetExpressions": ["quisiera", "la cuenta"],
            "feedbackPolicy": {"mode": "accuracy_first"},
        },
        "curriculum": {},
    }


class PlanCoverageTestCase(unittest.TestCase):
    def test_empty_coverage_renders_identically_to_none(self):
        bootstrap = _assignment_bootstrap()
        empty = compute_coverage_state(["quisiera", "la cuenta"], {}, {}, 0)
        without = render_assignment_prompt(compile_prompt_plan(bootstrap), "text")
        with_empty = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=empty), "text"
        )
        self.assertEqual(without, with_empty)

    def test_nonempty_coverage_adds_recycling_section(self):
        bootstrap = _assignment_bootstrap()
        cov = compute_coverage_state(
            ["quisiera", "la cuenta"], {"quisiera": 0, "la cuenta": 4}, {}, 2
        )
        prompt = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=cov), "text"
        )
        self.assertIn("RECYCLING (prior sessions)", prompt)
        self.assertIn("quisiera", prompt)

    def test_custom_prompt_ignores_coverage(self):
        bootstrap = {"systemPromptPreview": "RAW", "assignment": {"taskType": "custom_prompt"}}
        cov = compute_coverage_state(["x"], {"x": 0}, {}, 3)
        prompt = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=cov), "text"
        )
        self.assertEqual(prompt, "RAW")

    def test_preview_includes_recycling_summary(self):
        cov = compute_coverage_state(["quisiera"], {"quisiera": 0}, {}, 1)
        plan = compile_prompt_plan(_assignment_bootstrap(), coverage_state=cov)
        preview = serialize_plan_preview(plan)
        self.assertIn("recycling", preview)
        self.assertEqual(preview["recycling"]["uncovered"], ["quisiera"])


from backend.services.practice_analytics import build_assignment_coverage_input


class BuildCoverageInputTestCase(unittest.TestCase):
    def test_sums_hits_across_sessions_and_counts_errors(self):
        sessions = [
            {"session_summary": {"target_expression_hits": {"quisiera": 1}, "target_vocabulary_hits": {}}},
            {"session_summary": {"target_expression_hits": {"quisiera": 2}, "target_vocabulary_hits": {"cafe": 1}}},
        ]
        events = [
            {"event_type": "metric.repeated_error", "payload": {"errorId": "ser_estar", "label": "ser/estar"}},
            {"event_type": "metric.repeated_error", "payload": {"errorId": "ser_estar", "label": "ser/estar"}},
        ]
        out = build_assignment_coverage_input(sessions, events, ["quisiera", "cafe"])
        self.assertEqual(out["hit_counts"], {"quisiera": 3, "cafe": 1})
        self.assertEqual(out["prior_session_count"], 2)
        self.assertGreaterEqual(out["error_counts"].get("ser/estar", 0), 1)


import os
from unittest import mock
from backend.services.pedagogy import integration


class IntegrationRecyclingFlagTestCase(unittest.TestCase):
    def test_recycling_enabled_reads_env(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_RECYCLING": "on"}, clear=False):
            self.assertTrue(integration.recycling_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_RECYCLING": ""}, clear=False):
            self.assertFalse(integration.recycling_enabled())

    def test_coverage_threads_into_render_when_render_flag_on(self):
        bootstrap = _assignment_bootstrap()
        cov = compute_coverage_state(["quisiera", "la cuenta"], {"quisiera": 0, "la cuenta": 4}, {}, 2)
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASSIGNMENT_RENDER": "1"}, clear=False):
            prompt = integration.resolve_assignment_system_prompt(
                bootstrap, surface="text", coverage_state=cov
            )
        self.assertIn("RECYCLING (prior sessions)", prompt)
