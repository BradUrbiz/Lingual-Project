"""Pedagogy Engine S1 (thin spine) — harness + behaviour-win tests.

Two safety nets, two distinct failure modes:

  * **Characterization** (:class:`CharacterizationTestCase`): the live
    ``build_assignment_system_prompt`` still matches the frozen goldens
    captured before any code moved. Catches drift introduced while relocating
    the writers into ``backend/services/pedagogy/``.

  * **Equivalence** (:class:`EquivalenceTestCase`): the new
    ``compile_prompt_plan`` -> ``render_assignment_prompt`` path is byte-equal
    to the old builder EXCEPT the intended grammar-routing delta (and, for the
    voice surface, the tutor-stance-last reordering). Catches a delta that
    leaks beyond its intended scope.

Plus focused unit suites for routing, plan compilation, and import boundaries.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

from backend.services.assignment_resolver import build_assignment_system_prompt
from backend.services.pedagogy.plan import (
    PromptPlan,
    Target,
    compile_prompt_plan,
    serialize_plan_preview,
)
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
from backend.services.pedagogy.routing import (
    feedback_route_for,
    grammar_elicitation_timing,
    repair_directive_lines,
)
from backend.tests._pedagogy_s1_corpus import CORPUS

# Stable prefixes for the only lines the S1 behaviour-win may change.
_REPAIR_PREFIXES = (
    "- On a target slip,",
    "- On a grammar-target slip",
    "- On an expression or vocabulary slip",
)


def _strip_repair_lines(prompt: str) -> str:
    return "\n".join(
        line
        for line in prompt.splitlines()
        if not line.startswith(_REPAIR_PREFIXES)
    )


def _section_block(prompt: str, header: str) -> str:
    """Return the section starting at ``header`` up to the next blank-line break."""
    start = prompt.index(header)
    rest = prompt[start:]
    end = rest.find("\n\n")
    return rest if end == -1 else rest[:end]

GOLDEN_DIR = pathlib.Path(__file__).parent / "fixtures" / "pedagogy_s1_goldens"

# The exact repair line the legacy builder emits in TUTOR STANCE. The S1 win
# replaces this single flat line with target-type-aware routing lines.
LEGACY_REPAIR_PREFIX = "- On a target slip,"


def load_golden(name: str) -> str:
    return (GOLDEN_DIR / f"{name}.txt").read_text(encoding="utf-8")


class CharacterizationTestCase(unittest.TestCase):
    """The live legacy builder must still reproduce every frozen golden."""

    def test_every_fixture_matches_its_golden(self):
        for fixture in CORPUS:
            with self.subTest(fixture=fixture.name):
                self.assertEqual(
                    build_assignment_system_prompt(fixture.bootstrap),
                    load_golden(fixture.name),
                    f"Legacy builder drifted from golden for {fixture.name!r}. "
                    "If this change is intentional, regenerate via "
                    "`python3 -m backend.tests.fixtures.gen_pedagogy_s1_goldens` "
                    "and review the diff.",
                )


class EquivalenceTestCase(unittest.TestCase):
    """New plan->render path == legacy builder, except the grammar-routing delta."""

    def _render_new(self, fixture, surface="text"):
        return render_assignment_prompt(compile_prompt_plan(fixture.bootstrap), surface)

    def test_no_grammar_fixtures_are_byte_identical(self):
        for fixture in CORPUS:
            if fixture.is_custom_prompt or fixture.has_grammar:
                continue
            with self.subTest(fixture=fixture.name):
                self.assertEqual(
                    self._render_new(fixture, "text"),
                    build_assignment_system_prompt(fixture.bootstrap),
                )

    def test_grammar_fixtures_differ_only_in_repair_lines(self):
        for fixture in CORPUS:
            if not fixture.has_grammar:
                continue
            with self.subTest(fixture=fixture.name):
                old = build_assignment_system_prompt(fixture.bootstrap)
                new = self._render_new(fixture, "text")
                self.assertNotEqual(new, old, "grammar fixture should carry the win")
                # Everything outside the correction lines is unchanged.
                self.assertEqual(_strip_repair_lines(new), _strip_repair_lines(old))
                # The win is present, the flat line is gone.
                self.assertIn("On a grammar-target slip", new)
                self.assertNotIn("- On a target slip,", new)

    def test_custom_prompt_passes_base_through(self):
        for fixture in CORPUS:
            if not fixture.is_custom_prompt:
                continue
            with self.subTest(fixture=fixture.name):
                new = self._render_new(fixture, "text")
                self.assertEqual(new, build_assignment_system_prompt(fixture.bootstrap))
                self.assertEqual(new, fixture.bootstrap["systemPromptPreview"].strip())


class SurfaceOrderingTestCase(unittest.TestCase):
    """Voice surface puts the (most adherence-sensitive) tutor stance last."""

    def _grammar_fixture(self):
        for fixture in CORPUS:
            if fixture.has_grammar and not fixture.is_custom_prompt:
                return fixture
        raise AssertionError("corpus needs a grammar fixture")

    def test_text_keeps_legacy_order_voice_moves_stance_last(self):
        plan = compile_prompt_plan(self._grammar_fixture().bootstrap)
        text = render_assignment_prompt(plan, "text")
        voice = render_assignment_prompt(plan, "voice")

        # Both surfaces carry the same sections.
        for header in ("TUTOR STANCE:", "TASK TEMPLATE DIRECTIVE:"):
            self.assertIn(header, text)
            self.assertIn(header, voice)

        # Text: stance before task template (legacy order). Voice: stance last.
        self.assertLess(text.index("TUTOR STANCE:"), text.index("TASK TEMPLATE DIRECTIVE:"))
        self.assertGreater(voice.index("TUTOR STANCE:"), voice.index("TASK TEMPLATE DIRECTIVE:"))

        # Reordering only — the stance block content is identical across surfaces.
        self.assertEqual(
            _section_block(text, "TUTOR STANCE:"),
            _section_block(voice, "TUTOR STANCE:"),
        )

    def test_no_grammar_voice_still_relocates_stance_without_other_changes(self):
        # Pick a no-grammar, non-custom fixture; voice == text with stance moved.
        fixture = next(f for f in CORPUS if not f.has_grammar and not f.is_custom_prompt)
        plan = compile_prompt_plan(fixture.bootstrap)
        text = render_assignment_prompt(plan, "text")
        voice = render_assignment_prompt(plan, "voice")
        self.assertNotEqual(text, voice)
        self.assertEqual(_section_block(text, "TUTOR STANCE:"), _section_block(voice, "TUTOR STANCE:"))


class IntegrationFlagTestCase(unittest.TestCase):
    """The PEDAGOGY_ENGINE_ASSIGNMENT_RENDER flag selects legacy vs engine path."""

    def setUp(self):
        self.fixture = next(
            f for f in CORPUS if f.has_grammar and not f.is_custom_prompt
        )

    def test_flag_off_returns_the_legacy_builder_output(self):
        from backend.services.pedagogy.integration import (
            assignment_render_enabled,
            resolve_assignment_system_prompt,
        )

        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASSIGNMENT_RENDER": ""}, clear=False):
            self.assertFalse(assignment_render_enabled())
            out = resolve_assignment_system_prompt(self.fixture.bootstrap, surface="voice")
            self.assertEqual(out, build_assignment_system_prompt(self.fixture.bootstrap))
            # Legacy path => flat correction line, no win.
            self.assertIn("- On a target slip,", out)

    def test_flag_on_returns_the_engine_render_with_the_win(self):
        from backend.services.pedagogy.integration import (
            assignment_render_enabled,
            resolve_assignment_system_prompt,
        )

        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASSIGNMENT_RENDER": "1"}, clear=False):
            self.assertTrue(assignment_render_enabled())
            out = resolve_assignment_system_prompt(self.fixture.bootstrap, surface="voice")
            self.assertEqual(
                out,
                render_assignment_prompt(
                    compile_prompt_plan(self.fixture.bootstrap), "voice"
                ),
            )
            self.assertIn("On a grammar-target slip", out)
            self.assertNotIn("- On a target slip,", out)


class ImportBoundaryTestCase(unittest.TestCase):
    """Invariant 7a: the compiler/plan layer stays content-source/surface agnostic."""

    def test_plan_and_routing_import_no_openai_or_canvas(self):
        # Run in a fresh interpreter so resolver imports from sibling tests
        # (which legitimately pull Canvas) cannot pollute sys.modules here.
        probe = (
            "import sys\n"
            "import backend.services.pedagogy.plan\n"
            "import backend.services.pedagogy.routing\n"
            "import backend.services.pedagogy.coverage\n"
            "forbidden = sorted(\n"
            "    m for m in sys.modules\n"
            "    if 'openai' in m.lower()\n"
            "    or 'canvas' in m.lower()\n"
            "    or m == 'backend.services.assignment_resolver'\n"
            "    or m.endswith('.compliance')\n"
            ")\n"
            "print(';'.join(forbidden))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            "",
            f"plan.py/routing.py/coverage.py pulled forbidden modules: {result.stdout.strip()}",
        )

    def test_compiling_a_plan_does_not_require_the_renderer_or_canvas(self):
        # Compiling a plan (the engine's pure step) must not drag in the render
        # layer or Canvas — only rendering does.
        probe = (
            "import sys\n"
            "from backend.services.pedagogy import compile_prompt_plan\n"
            "compile_prompt_plan({'assignment': {'taskType': 'information_gap'}, "
            "'mapping': {'focusGrammar': ['x']}, 'curriculum': {'pedagogy': {}}})\n"
            "loaded_render = 'backend.services.pedagogy.render.assignment_prompt' in sys.modules\n"
            "loaded_resolver = 'backend.services.assignment_resolver' in sys.modules\n"
            "print(f'{loaded_render};{loaded_resolver}')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "False;False", result.stdout.strip())


class PlanTestCase(unittest.TestCase):
    """compile_prompt_plan turns a bootstrap into a typed PromptPlan."""

    def _restaurant_bootstrap(self):
        return {
            "systemPromptPreview": "Base prompt",
            "assignment": {"title": "Restaurant", "taskType": "information_gap"},
            "mapping": {
                "targetExpressions": ["Could I have"],
                "targetVocabulary": ["receipt"],
                "focusGrammar": ["polite requests"],
                "feedbackPolicy": {"mode": "accuracy_first"},
                "scaffoldPolicy": {"silenceToleranceMs": 2000},
            },
            "class": {"name": "French 2"},
            "curriculum": {
                "objectives": [{"id": "OBJ1", "canDo": {"en": "Order politely."}}],
                "pedagogy": {"evidence": {"minTurns": 4}},
            },
        }

    def test_targets_are_typed_with_routes(self):
        plan = compile_prompt_plan(self._restaurant_bootstrap())
        self.assertIsInstance(plan, PromptPlan)
        self.assertIn(Target("Could I have", "expression", "recast_first"), plan.targets)
        self.assertIn(Target("receipt", "vocabulary", "recast_first"), plan.targets)
        self.assertIn(Target("polite requests", "grammar_rule", "prompt_first"), plan.targets)
        self.assertIn(Target("Order politely.", "objective", "recast_first"), plan.targets)

    def test_custom_prompt_yields_a_bypass_plan(self):
        plan = compile_prompt_plan(
            {
                "systemPromptPreview": "Raw teacher prompt",
                "assignment": {"taskType": "custom_prompt"},
                "mapping": {"focusGrammar": ["ignored"]},
            }
        )
        self.assertTrue(plan.is_custom_prompt)
        self.assertEqual(plan.targets, [])
        self.assertEqual(plan.base_prompt, "Raw teacher prompt")

    def test_output_policy_is_prenormalized_with_evidence(self):
        # evidence.minTurns >= 5 bumps min_student_turn_words to >= 9; the plan
        # must capture that (the resolver normalizes with evidence before render).
        bootstrap = self._restaurant_bootstrap()
        bootstrap["curriculum"]["pedagogy"]["evidence"]["minTurns"] = 6
        plan = compile_prompt_plan(bootstrap)
        self.assertGreaterEqual(plan.output_policy["min_student_turn_words"], 9)

    def test_raw_policies_and_task_context_carried(self):
        plan = compile_prompt_plan(self._restaurant_bootstrap())
        self.assertEqual(plan.feedback_policy, {"mode": "accuracy_first"})
        self.assertEqual(plan.scaffold_policy, {"silenceToleranceMs": 2000})
        self.assertEqual(plan.task_context["classroom"], {"name": "French 2"})
        self.assertIn("assignment", plan.task_context)
        self.assertIn("pedagogy", plan.task_context)


class PlanPreviewTestCase(unittest.TestCase):
    """L8 hook: the compiled plan is inspectable for the teacher preview."""

    def test_engine_plan_preview_lists_targets_routes_and_posture(self):
        plan = compile_prompt_plan(
            {
                "assignment": {"taskType": "opinion_gap"},
                "mapping": {
                    "focusGrammar": ["present perfect"],
                    "targetExpressions": ["In my opinion"],
                    "feedbackPolicy": {"mode": "accuracy_first"},
                },
                "curriculum": {"pedagogy": {}},
            }
        )
        preview = serialize_plan_preview(plan)
        self.assertTrue(preview["engineEnabled"])
        self.assertEqual(preview["taskType"], "opinion_gap")
        self.assertEqual(preview["correctionPosture"]["mode"], "accuracy_first")
        self.assertIn(
            {"surface": "present perfect", "kind": "grammar_rule", "feedbackRoute": "prompt_first"},
            preview["targets"],
        )
        self.assertIn(
            {"surface": "In my opinion", "kind": "expression", "feedbackRoute": "recast_first"},
            preview["targets"],
        )

    def test_custom_prompt_preview_flags_disabled_guarantees(self):
        plan = compile_prompt_plan(
            {"assignment": {"taskType": "custom_prompt"}, "systemPromptPreview": "raw"}
        )
        preview = serialize_plan_preview(plan)
        self.assertFalse(preview["engineEnabled"])
        self.assertTrue(preview["rawTutorMode"])
        self.assertTrue(preview["guaranteesDisabled"])  # non-empty list


class RoutingTestCase(unittest.TestCase):
    """The S1 behaviour-win: target-type-aware feedback routing."""

    def test_grammar_rule_routes_prompt_first(self):
        self.assertEqual(feedback_route_for("grammar_rule"), "prompt_first")

    def test_lexical_kinds_route_recast_first(self):
        self.assertEqual(feedback_route_for("expression"), "recast_first")
        self.assertEqual(feedback_route_for("vocabulary"), "recast_first")
        self.assertEqual(feedback_route_for("objective"), "recast_first")

    def test_unknown_kind_defaults_to_flow_friendly_recast(self):
        self.assertEqual(feedback_route_for("something_else"), "recast_first")

    def test_grammar_elicitation_timing_first_slip_by_default(self):
        self.assertEqual(grammar_elicitation_timing("balanced"), "first_slip")
        self.assertEqual(grammar_elicitation_timing("accuracy_first"), "first_slip")

    def test_grammar_elicitation_timing_softens_under_fluency_first(self):
        self.assertEqual(grammar_elicitation_timing("fluency_first"), "second_slip")

    def test_grammar_elicitation_timing_defaults_for_unknown_mode(self):
        self.assertEqual(grammar_elicitation_timing("garbage"), "first_slip")

    def test_repair_lines_without_grammar_reproduce_the_legacy_flat_line(self):
        # No grammar target -> exactly today's single flat repair line, so
        # no-grammar assignments stay byte-identical across the old/new paths.
        lines = repair_directive_lines(
            has_grammar_target=False,
            feedback_mode="balanced",
            recast_default=True,
            elicitation_repeat_threshold=3,
        )
        self.assertEqual(
            lines,
            [
                "On a target slip, recast briefly the first time; if the same error "
                "repeats 3+ times, pause to repair and prompt self-correction."
            ],
        )

    def test_repair_lines_flat_line_honors_recast_default_false(self):
        lines = repair_directive_lines(
            has_grammar_target=False,
            feedback_mode="balanced",
            recast_default=False,
            elicitation_repeat_threshold=2,
        )
        self.assertEqual(len(lines), 1)
        self.assertIn("cue elicitation the first time", lines[0])
        self.assertIn("repeats 2+ times", lines[0])

    def test_repair_lines_with_grammar_split_into_prompt_first_and_recast(self):
        lines = repair_directive_lines(
            has_grammar_target=True,
            feedback_mode="balanced",
            recast_default=True,
            elicitation_repeat_threshold=3,
        )
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("On a grammar-target slip"))
        self.assertIn("self-correct on the first slip", lines[0])
        self.assertTrue(lines[1].startswith("On an expression or vocabulary slip"))
        self.assertIn("recast briefly the first time", lines[1])

    def test_repair_lines_grammar_softens_under_fluency_first(self):
        lines = repair_directive_lines(
            has_grammar_target=True,
            feedback_mode="fluency_first",
            recast_default=True,
            elicitation_repeat_threshold=3,
        )
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("On a grammar-target slip"))
        self.assertIn("second slip", lines[0])
        self.assertIn("never interrupt mid-breakdown", lines[0])


if __name__ == "__main__":
    unittest.main()
