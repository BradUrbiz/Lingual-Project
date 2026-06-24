"""Pedagogy Engine S4.1 — affect-aware tutoring (pure layer)."""
import os
import unittest
from unittest import mock

from backend.services.pedagogy.affect import (
    AffectState,
    affect_stance_lines,
    compute_affect_state,
    serialize_affect_state,
)
from backend.services.pedagogy.assignment_debrief import build_assignment_debrief


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


class AffectEnabledTestCase(unittest.TestCase):
    def test_default_off(self):
        from backend.services.pedagogy.integration import affect_enabled
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_AFFECT", None)
            self.assertFalse(affect_enabled())

    def test_on_when_truthy(self):
        from backend.services.pedagogy.integration import affect_enabled
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "1"}):
            self.assertTrue(affect_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "on"}):
            self.assertTrue(affect_enabled())


class CompilePlanAffectTestCase(unittest.TestCase):
    def _bootstrap(self):
        return {
            "systemPromptPreview": "BASE",
            "assignment": {"title": "Restaurant", "taskType": "information_gap"},
            "mapping": {"targetExpressions": ["la cuenta"], "feedbackPolicy": {"mode": "balanced"}},
            "curriculum": {},
            "class": {},
        }

    def test_plan_defaults_affect_none(self):
        from backend.services.pedagogy.plan import compile_prompt_plan
        self.assertIsNone(compile_prompt_plan(self._bootstrap()).affect)

    def test_plan_carries_affect_state(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        affect = AffectState(readiness="strained", signals={}, reason="r")
        plan = compile_prompt_plan(self._bootstrap(), affect_state=affect)
        self.assertIs(plan.affect, affect)

    def test_custom_prompt_plan_has_no_affect(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        affect = AffectState(readiness="strained", signals={}, reason="r")
        boot = {"systemPromptPreview": "B", "assignment": {"taskType": "custom_prompt"}}
        # Raw tutor mode ignores affect (engine off).
        self.assertIsNone(compile_prompt_plan(boot, affect_state=affect).affect)


class RenderAffectOverrideTestCase(unittest.TestCase):
    def _bootstrap(self, mode="balanced"):
        return {
            "systemPromptPreview": "BASE",
            "assignment": {"title": "Restaurant", "taskType": "information_gap"},
            "mapping": {
                "targetExpressions": ["la cuenta"],
                "focusGrammar": ["ser vs estar"],
                "feedbackPolicy": {"mode": mode},
            },
            "curriculum": {},
            "class": {},
        }

    def test_render_byte_identical_when_affect_none(self):
        from backend.services.pedagogy.plan import compile_prompt_plan
        from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
        boot = self._bootstrap()
        baseline = render_assignment_prompt(compile_prompt_plan(boot), "text")
        with_none = render_assignment_prompt(compile_prompt_plan(boot, affect_state=None), "text")
        self.assertEqual(baseline, with_none)

    def test_render_byte_identical_when_neutral(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
        boot = self._bootstrap()
        baseline = render_assignment_prompt(compile_prompt_plan(boot), "text")
        neutral = AffectState(readiness="neutral", signals={}, reason="")
        with_neutral = render_assignment_prompt(compile_prompt_plan(boot, affect_state=neutral), "text")
        self.assertEqual(baseline, with_neutral)

    def test_render_byte_identical_when_settled(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
        boot = self._bootstrap()
        baseline = render_assignment_prompt(compile_prompt_plan(boot), "text")
        settled = AffectState(readiness="settled", signals={}, reason="")
        with_settled = render_assignment_prompt(compile_prompt_plan(boot, affect_state=settled), "text")
        self.assertEqual(baseline, with_settled)

    def test_render_adds_affect_lines_when_strained(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
        boot = self._bootstrap()
        strained = AffectState(readiness="strained", signals={}, reason="r")
        out = render_assignment_prompt(compile_prompt_plan(boot, affect_state=strained), "text")
        self.assertIn("low readiness", out.lower())

    def test_accuracy_first_still_corrects_when_strained(self):
        # Bounded nudge: an accuracy_first teacher's tutor still gets a correction directive
        # (the repair block is independent of affect); affect only softens delivery.
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.plan import compile_prompt_plan
        from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
        boot = self._bootstrap(mode="accuracy_first")
        strained = AffectState(readiness="strained", signals={}, reason="r")
        out = render_assignment_prompt(compile_prompt_plan(boot, affect_state=strained), "text").lower()
        self.assertIn("self-correct", out)  # accuracy_first feedback_line still present


class ResolveSeamAffectTestCase(unittest.TestCase):
    def test_resolve_threads_affect_state(self):
        from backend.services.pedagogy.affect import AffectState
        from backend.services.pedagogy.integration import resolve_assignment_system_prompt
        boot = {
            "systemPromptPreview": "BASE",
            "assignment": {"title": "R", "taskType": "information_gap"},
            "mapping": {"targetExpressions": ["la cuenta"], "feedbackPolicy": {"mode": "balanced"}},
            "curriculum": {},
            "class": {},
        }
        strained = AffectState(readiness="strained", signals={}, reason="r")
        out = resolve_assignment_system_prompt(boot, surface="text", affect_state=strained)
        self.assertIn("low readiness", out.lower())

    def test_resolve_default_affect_none_is_byte_identical(self):
        from backend.services.pedagogy.integration import resolve_assignment_system_prompt
        boot = {
            "systemPromptPreview": "BASE",
            "assignment": {"title": "R", "taskType": "information_gap"},
            "mapping": {"targetExpressions": ["la cuenta"], "feedbackPolicy": {"mode": "balanced"}},
            "curriculum": {},
            "class": {},
        }
        self.assertEqual(
            resolve_assignment_system_prompt(boot, surface="text"),
            resolve_assignment_system_prompt(boot, surface="text", affect_state=None),
        )


class ComputeAssignmentAffectStateTestCase(unittest.TestCase):
    class _DB:
        def __init__(self, sessions):
            self._sessions = sessions
            self.calls = 0

        def list_student_assignment_practice_sessions(self, assignment_id, uid):
            self.calls += 1
            return self._sessions

    class _RaiseDB:
        def list_student_assignment_practice_sessions(self, assignment_id, uid):
            raise RuntimeError("boom")

    def _boot(self):
        return {"mapping": {"targetExpressions": ["x"]}}

    def _session(self, sid, avg, recast, turns, status="completed"):
        return {
            "id": sid,
            "status": status,
            "session_summary": {
                "average_student_words_per_turn": avg,
                "student_turn_count": turns,
                "feedback_counts": {"recast": recast, "elicitation": 0, "review_item": 0},
                "repeated_error_counts": {},
            },
        }

    def test_flag_off_returns_none_zero_reads(self):
        from backend.services.practice_analytics import compute_assignment_affect_state
        db = self._DB([self._session("s1", 8, 1, 5)])
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_AFFECT", None)
            self.assertIsNone(compute_assignment_affect_state(db, self._boot(), "u", "a"))
        self.assertEqual(db.calls, 0)  # flag-off does ZERO reads

    def test_strained_from_prior_sessions(self):
        from backend.services.practice_analytics import compute_assignment_affect_state
        # most-recent-first: latest 3.0 << 10/10 => falling => strained
        db = self._DB([
            self._session("s3", 3.0, 0, 5),
            self._session("s2", 10.0, 0, 5),
            self._session("s1", 10.0, 0, 5),
        ])
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "1"}):
            state = compute_assignment_affect_state(db, self._boot(), "u", "a")
        self.assertIsNotNone(state)
        self.assertEqual(state.readiness, "strained")

    def test_excludes_current_session(self):
        from backend.services.practice_analytics import compute_assignment_affect_state
        # If the in-flight session were counted, we'd have 2 sessions; excluding it leaves 1 => neutral.
        db = self._DB([self._session("cur", 3.0, 0, 5), self._session("s1", 10.0, 0, 5)])
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "1"}):
            state = compute_assignment_affect_state(db, self._boot(), "u", "a", current_session_id="cur")
        self.assertEqual(state.readiness, "neutral")  # only 1 prior session after exclusion

    def test_fail_open_on_reader_error(self):
        from backend.services.practice_analytics import compute_assignment_affect_state
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "1"}):
            self.assertIsNone(compute_assignment_affect_state(self._RaiseDB(), self._boot(), "u", "a"))


class AssignmentAffectSnapshotTestCase(unittest.TestCase):
    class _Deps:
        def __init__(self, db):
            self.db = db

    class _DB:
        def __init__(self, sessions):
            self._sessions = sessions

        def list_student_assignment_practice_sessions(self, assignment_id, uid):
            return self._sessions

    def _session(self, sid, avg, recast, turns):
        return {
            "id": sid,
            "status": "completed",
            "session_summary": {
                "average_student_words_per_turn": avg,
                "student_turn_count": turns,
                "feedback_counts": {"recast": recast, "elicitation": 0, "review_item": 0},
                "repeated_error_counts": {},
            },
        }

    def test_snapshot_returns_serialized_strained(self):
        from backend.routes.curriculum_admin import _assignment_affect_snapshot
        db = self._DB([self._session("s3", 3.0, 0, 5), self._session("s2", 10.0, 0, 5), self._session("s1", 10.0, 0, 5)])
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_AFFECT": "1"}):
            snap = _assignment_affect_snapshot(self._Deps(db), {"mapping": {"targetExpressions": ["x"]}}, "u", "a")
        self.assertEqual(snap["readiness"], "strained")

    def test_snapshot_none_when_flag_off(self):
        from backend.routes.curriculum_admin import _assignment_affect_snapshot
        db = self._DB([self._session("s1", 8, 1, 5)])
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_AFFECT", None)
            self.assertIsNone(_assignment_affect_snapshot(self._Deps(db), {"mapping": {}}, "u", "a"))


class BuildSessionDebriefTestCase(unittest.TestCase):
    def _full_record(self):
        return {
            "id": "s1",
            "status": "completed",
            "started_at": "2026-06-24T10:00:00Z",
            "ended_at": "2026-06-24T10:12:00Z",
            "session_summary": {
                "target_expression_hits": {"la cuenta": 2},
                "target_vocabulary_hits": {"mesa": 1},
                "self_correction_count": 3,
                "task_completion_count": 1,
                "feedback_counts": {"recast": 4, "elicitation": 1, "review_item": 2},
                "repeated_error_counts": {"ser vs estar": 3, "gender agreement": 1},
            },
            "analysis_state": {
                "coverage": {"uncovered": ["pedir la cuenta"], "recycle": ["mesa"],
                             "solid": ["hola"], "repeatedErrors": [{"label": "ser vs estar", "count": 3}],
                             "priorSessionCount": 2},
                "coach_review": {"surface": "text", "wins": [{"text": "Good greeting"}],
                                 "work_on": [{"utterance": "yo es", "better": "yo soy", "why": "ser",
                                              "target": "ser vs estar", "confidence_caveat": ""}],
                                 "target_coverage": [{"surface": "la cuenta", "status": "covered"}]},
                "promotions": [{"signature": "ser vs estar", "turn_index": 4}],
                "ask_log": [
                    {"question": "how do I say table?", "answer": "Think of a hint...", "kind": "hint",
                     "turn_index": 2, "generated_at": "x", "model": "m"},
                    {"question": "what is la cuenta?", "answer": "...", "kind": "translation",
                     "turn_index": 5, "generated_at": "x", "model": "m"},
                ],
                "affect_state": {"readiness": "strained", "signals": {}, "reason": "falling turn length"},
            },
        }

    def test_full_record_populates_all_sections(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        d = build_session_debrief(self._full_record())
        self.assertEqual(d["sessionId"], "s1")
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["coverage"]["expressionHits"], {"la cuenta": 2})
        self.assertEqual(d["coverage"]["uncovered"], ["pedir la cuenta"])
        self.assertEqual(d["uptake"]["selfCorrectionCount"], 3)
        self.assertEqual(d["uptake"]["feedbackCounts"]["reviewItem"], 2)
        self.assertEqual(d["repeatedErrors"][0]["label"], "ser vs estar")
        self.assertIsNotNone(d["coachReview"])
        self.assertEqual(d["affect"]["readiness"], "strained")

    def test_help_usage_counts_only_no_content(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        d = build_session_debrief(self._full_record())
        self.assertEqual(d["helpUsage"]["askCount"], 2)
        self.assertEqual(d["helpUsage"]["byKind"]["hint"], 1)
        self.assertEqual(d["helpUsage"]["byKind"]["translation"], 1)
        # help != evidence: NO question/answer text anywhere in the debrief
        blob = repr(d)
        self.assertNotIn("how do I say table?", blob)
        self.assertNotIn("Think of a hint", blob)

    def test_caveats_always_present(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        self.assertTrue(build_session_debrief({}).get("caveats"))
        self.assertTrue(build_session_debrief(self._full_record())["caveats"])

    def test_missing_analysis_state_degrades_to_empty_sections(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        d = build_session_debrief({"id": "s2", "status": "active", "session_summary": {}})
        self.assertIsNone(d["coachReview"])
        self.assertEqual(d["helpUsage"]["askCount"], 0)
        self.assertIsNone(d["affect"])
        self.assertEqual(d["repeatedErrors"], [])
        self.assertTrue(d["caveats"])

    def test_suggested_next_from_uncovered_and_repeated_errors(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        d = build_session_debrief(self._full_record())
        joined = " ".join(d["suggestedNext"]).lower()
        self.assertIn("pedir la cuenta", joined)   # uncovered target
        self.assertIn("ser vs estar", joined)       # top repeated error
        self.assertLessEqual(len(d["suggestedNext"]), 4)  # MAX_SUGGESTIONS

    def test_malformed_input_does_not_raise(self):
        from backend.services.pedagogy.debrief import build_session_debrief
        for bad in [None, [], "x", {"analysis_state": "oops", "session_summary": 7}]:
            d = build_session_debrief(bad)
            self.assertTrue(d["caveats"])


class DebriefDirectorReSteersTests(unittest.TestCase):
    def _debrief(self, analysis_state):
        from backend.services.pedagogy.debrief import build_session_debrief
        return build_session_debrief({"id": "s1", "status": "ended", "analysis_state": analysis_state,
                                      "session_summary": {}})

    def test_resteers_shaped_and_internal_fields_omitted(self):
        d = self._debrief({"resteers": [
            {"turn_index": 4, "kind": "language_drift", "target": "Korean", "reason": "mostly english",
             "prompt": "COACH NOTE ...", "surface": "voice", "generated_at": "T"},
            {"turn_index": 7, "kind": "target_neglect", "target": "la cuenta", "reason": "no target in window",
             "prompt": "COACH NOTE ...", "surface": "text", "generated_at": "T"},
        ]})
        rs = d["directorReSteers"]
        self.assertEqual(rs["count"], 2)
        self.assertEqual(rs["items"][0], {"turnIndex": 4, "kind": "language_drift", "target": "Korean", "reason": "mostly english"})
        self.assertEqual(rs["items"][1]["kind"], "target_neglect")
        # internal fields must NOT leak
        self.assertNotIn("prompt", rs["items"][0])
        self.assertNotIn("surface", rs["items"][0])
        self.assertNotIn("generated_at", rs["items"][0])

    def test_no_resteers_is_empty(self):
        d = self._debrief({})
        self.assertEqual(d["directorReSteers"], {"count": 0, "items": []})

    def test_malformed_resteers_skipped(self):
        d = self._debrief({"resteers": ["nope", {"turn_index": 2, "kind": "language_drift", "target": "Spanish", "reason": "r"}, 5]})
        self.assertEqual(d["directorReSteers"]["count"], 1)
        self.assertEqual(d["directorReSteers"]["items"][0]["target"], "Spanish")


class DebriefEnabledTestCase(unittest.TestCase):
    def test_default_off(self):
        from backend.services.pedagogy.integration import debrief_enabled
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_DEBRIEF", None)
            self.assertFalse(debrief_enabled())

    def test_on_when_truthy(self):
        from backend.services.pedagogy.integration import debrief_enabled
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DEBRIEF": "1"}):
            self.assertTrue(debrief_enabled())


class DebriefRollupEnabledTestCase(unittest.TestCase):
    def test_reads_env_truthy(self):
        from backend.services.pedagogy.integration import debrief_rollup_enabled
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DEBRIEF_ROLLUP": "1"}):
            self.assertTrue(debrief_rollup_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DEBRIEF_ROLLUP": ""}):
            self.assertFalse(debrief_rollup_enabled())


class DebriefPromotionsTests(unittest.TestCase):
    def _debrief(self, analysis_state):
        from backend.services.pedagogy.debrief import build_session_debrief
        return build_session_debrief({"id": "s1", "status": "ended", "analysis_state": analysis_state,
                                      "session_summary": {}})

    def test_promotions_shaped_strips_grammar_prefix_and_omits_internal(self):
        d = self._debrief({"promotions": [
            {"turn_index": 5, "signature": "focus_grammar:subjunctive", "reason": "hard_target",
             "prompt": "Work the subjunctive back in ...", "generated_at": "T"},
            {"turn_index": 8, "signature": "ser vs estar", "reason": "repeat",
             "prompt": "Bring ser/estar back ...", "generated_at": "T"},
        ]})
        p = d["promotions"]
        self.assertEqual(p["count"], 2)
        self.assertEqual(p["items"][0], {"turnIndex": 5, "reason": "hard_target", "target": "subjunctive"})
        self.assertEqual(p["items"][1], {"turnIndex": 8, "reason": "repeat", "target": "ser vs estar"})
        # internal fields must NOT leak
        self.assertNotIn("prompt", p["items"][0])
        self.assertNotIn("generated_at", p["items"][0])
        self.assertNotIn("signature", p["items"][0])

    def test_no_promotions_is_empty(self):
        self.assertEqual(self._debrief({})["promotions"], {"count": 0, "items": []})

    def test_malformed_promotions_skipped(self):
        d = self._debrief({"promotions": ["nope", {"turn_index": 2, "signature": "la cuenta", "reason": "repeat"}, 7]})
        self.assertEqual(d["promotions"]["count"], 1)
        self.assertEqual(d["promotions"]["items"][0]["target"], "la cuenta")

    def test_full_record_fixture_now_shaped(self):
        # the existing BuildSessionDebriefTestCase fixture sets promotions:[{"signature":"ser vs estar","turn_index":4}]
        d = self._debrief({"promotions": [{"signature": "ser vs estar", "turn_index": 4}]})
        self.assertEqual(d["promotions"], {"count": 1, "items": [{"turnIndex": 4, "reason": "", "target": "ser vs estar"}]})


class BuildAssignmentDebriefTestCase(unittest.TestCase):
    def _session(self, *, status="completed", uid="u1", started_at="2026-06-01T10:00:00Z",
                 analysis_state=None, session_summary=None, assignment_id="a1"):
        return {
            "id": "s-" + uid + "-" + str(started_at or ""),
            "assignment_id": assignment_id,
            "status": status,
            "student_firebase_uid": uid,
            "started_at": started_at,
            "analysis_state": analysis_state or {},
            "session_summary": session_summary or {},
        }

    def test_empty_list_is_total(self):
        d = build_assignment_debrief([])
        self.assertEqual(d["assignmentId"], None)
        self.assertEqual(d["participation"], {
            "sessionCount": 0, "completedSessionCount": 0, "studentCount": 0,
            "firstStartedAt": None, "lastStartedAt": None,
        })
        self.assertEqual(d["uptake"]["selfCorrectionCount"], 0)
        self.assertEqual(d["promotions"], {"count": 0, "byTarget": []})
        self.assertEqual(d["directorReSteers"], {"count": 0, "byKind": {}, "byTarget": []})
        self.assertEqual(d["helpUsage"], {"askCount": 0, "byKind": {
            "hint": 0, "translation": 0, "definition": 0, "clarification": 0, "phrase": 0, "refusal": 0,
        }, "sessionsWithHelp": 0})
        self.assertEqual(d["affect"], {"byReadiness": {}, "sessionsWithSignal": 0})
        self.assertEqual(d["coachReview"], {"sessionCount": 0})
        self.assertEqual(d["suggestedNext"], [])
        self.assertTrue(any("aggregates 0 session" in c for c in d["caveats"]))

    def test_participation_counts_distinct_students_and_completed(self):
        sessions = [
            self._session(uid="u1", status="completed", started_at="2026-06-01T10:00:00Z"),
            self._session(uid="u1", status="active", started_at="2026-06-02T10:00:00Z"),
            self._session(uid="u2", status="completed", started_at="2026-06-03T10:00:00Z"),
            self._session(uid="", status="completed", started_at="2026-06-04T10:00:00Z"),
        ]
        d = build_assignment_debrief(sessions)
        self.assertEqual(d["assignmentId"], "a1")
        self.assertEqual(d["participation"]["sessionCount"], 4)
        self.assertEqual(d["participation"]["completedSessionCount"], 3)
        self.assertEqual(d["participation"]["studentCount"], 2)  # u1, u2; "" not counted
        self.assertEqual(d["participation"]["firstStartedAt"], "2026-06-01T10:00:00Z")
        self.assertEqual(d["participation"]["lastStartedAt"], "2026-06-04T10:00:00Z")

    def test_uptake_summed(self):
        s = {"self_correction_count": 2, "feedback_counts": {"recast": 1, "elicitation": 3, "review_item": 0},
             "task_completion_count": 1}
        d = build_assignment_debrief([self._session(session_summary=s), self._session(session_summary=s)])
        self.assertEqual(d["uptake"], {
            "selfCorrectionCount": 4,
            "feedbackCounts": {"recast": 2, "elicitation": 6, "reviewItem": 0},
            "taskCompletionCount": 2,
        })

    def test_promotions_pooled_by_target(self):
        a = {"promotions": [
            {"turn_index": 1, "reason": "r", "signature": "focus_grammar:ser_vs_estar"},
            {"turn_index": 4, "reason": "r", "signature": "ser_vs_estar"},
        ]}
        b = {"promotions": [{"turn_index": 2, "reason": "r", "signature": "focus_grammar:gender_agreement"}]}
        d = build_assignment_debrief([self._session(analysis_state=a), self._session(analysis_state=b)])
        self.assertEqual(d["promotions"]["count"], 3)
        self.assertEqual(d["promotions"]["byTarget"][0],
                         {"target": "ser_vs_estar", "count": 2, "sessionCount": 1})
        self.assertEqual(d["promotions"]["byTarget"][1],
                         {"target": "gender_agreement", "count": 1, "sessionCount": 1})

    def test_director_resteers_by_kind_and_target(self):
        a = {"resteers": [
            {"turn_index": 1, "kind": "language-drift", "target": "english_slip", "reason": "r"},
            {"turn_index": 3, "kind": "target-neglect", "target": "", "reason": "r"},
        ]}
        d = build_assignment_debrief([self._session(analysis_state=a)])
        self.assertEqual(d["directorReSteers"]["count"], 2)
        self.assertEqual(d["directorReSteers"]["byKind"],
                         {"language-drift": 1, "target-neglect": 1})
        self.assertEqual(d["directorReSteers"]["byTarget"],
                         [{"target": "english_slip", "count": 1}])  # empty target dropped

    def test_help_usage_summed_and_sessions_with_help(self):
        a = {"ask_log": [{"kind": "hint"}, {"kind": "translation"}]}
        b = {"ask_log": [{"kind": "hint"}]}
        c = {"ask_log": []}
        d = build_assignment_debrief([self._session(analysis_state=a), self._session(analysis_state=b),
                                      self._session(analysis_state=c)])
        self.assertEqual(d["helpUsage"]["askCount"], 3)
        self.assertEqual(d["helpUsage"]["byKind"]["hint"], 2)
        self.assertEqual(d["helpUsage"]["byKind"]["translation"], 1)
        self.assertEqual(d["helpUsage"]["sessionsWithHelp"], 2)

    def test_affect_distribution(self):
        sessions = [
            self._session(analysis_state={"affect_state": {"readiness": "strained", "reason": "x"}}),
            self._session(analysis_state={"affect_state": {"readiness": "strained", "reason": "y"}}),
            self._session(analysis_state={"affect_state": {"readiness": "neutral", "reason": "z"}}),
            self._session(analysis_state={}),  # no affect signal
        ]
        d = build_assignment_debrief(sessions)
        self.assertEqual(d["affect"]["byReadiness"], {"strained": 2, "neutral": 1})
        self.assertEqual(d["affect"]["sessionsWithSignal"], 3)

    def test_coach_review_count(self):
        sessions = [
            self._session(analysis_state={"coach_review": {"work_on": []}}),
            self._session(analysis_state={}),
        ]
        d = build_assignment_debrief(sessions)
        self.assertEqual(d["coachReview"], {"sessionCount": 1})

    def test_suggested_next_promotion_cluster(self):
        a = {"promotions": [{"turn_index": 1, "reason": "r", "signature": "focus_grammar:subjunctive"}]}
        b = {"promotions": [{"turn_index": 1, "reason": "r", "signature": "focus_grammar:subjunctive"}]}
        d = build_assignment_debrief([self._session(analysis_state=a), self._session(analysis_state=b)])
        self.assertTrue(any("subjunctive" in s and "mini-lesson" in s for s in d["suggestedNext"]))

    def test_suggested_next_strain(self):
        sessions = [
            self._session(analysis_state={"affect_state": {"readiness": "strained", "reason": "x"}}),
            self._session(analysis_state={"affect_state": {"readiness": "strained", "reason": "y"}}),
        ]
        d = build_assignment_debrief(sessions)
        self.assertTrue(any("strain" in s.lower() for s in d["suggestedNext"]))

    def test_suggested_next_handled_well_fallback(self):
        # completed sessions, no promotions/strain/heavy-help -> positive fallback
        d = build_assignment_debrief([self._session(status="completed")])
        self.assertTrue(any("handled" in s.lower() for s in d["suggestedNext"]))

    def test_malformed_records_do_not_raise(self):
        d = build_assignment_debrief([None, 5, "x", {}, {"analysis_state": "bad", "session_summary": 7}])
        self.assertEqual(d["participation"]["sessionCount"], 5)
        self.assertEqual(d["promotions"]["count"], 0)

    def test_started_at_uncomparable_degrades_to_none(self):
        import datetime
        sessions = [
            self._session(started_at="2026-06-01T10:00:00Z"),
            self._session(started_at=datetime.datetime(2026, 6, 2)),  # mixed type vs str
        ]
        d = build_assignment_debrief(sessions)
        # does not raise; first/last degrade to None on TypeError
        self.assertIn("firstStartedAt", d["participation"])
        self.assertIn("lastStartedAt", d["participation"])
