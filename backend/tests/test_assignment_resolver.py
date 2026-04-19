import unittest
from types import SimpleNamespace

from backend.services.assignment_resolver import (
    load_assignment_bundle,
    user_can_access_assignment,
    is_teacher_preview_allowed,
    serialize_assignment,
    resolve_assignment_bootstrap,
    resolve_assignment_bootstrap_for_user,
    build_assignment_system_prompt,
)
from backend.services.membership_context import SchoolRequestContext


class FakeResolverDb:
    """Minimal fake DB for assignment resolver tests (C2: no mappings)."""

    def __init__(self):
        self.assignments = {}
        self.classes = {}
        self.enrollments = {}

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_student_class_enrollment(self, class_id, uid):
        return self.enrollments.get(f"{class_id}_{uid}")


def _make_deps(db=None):
    if db is None:
        db = FakeResolverDb()
    return SimpleNamespace(db=db)


def _make_context(uid="teacher-1", roles=("teacher",), org_id="org-1", membership_id="mem-1", class_ids=("class-1",)):
    return SchoolRequestContext(
        uid=uid,
        memberships=(),
        active_membership={"id": membership_id, "primaryClassIds": list(class_ids)},
        active_membership_id=membership_id,
        active_organization_id=org_id,
        active_roles=roles,
        allowed_class_ids=class_ids,
    )


# ---------------------------------------------------------------------------
# load_assignment_bundle
# ---------------------------------------------------------------------------
class TestLoadAssignmentBundle(unittest.TestCase):

    def test_loads_valid_bundle(self):
        db = FakeResolverDb()
        db.assignments["a-1"] = {"id": "a-1", "class_id": "c-1"}
        db.classes["c-1"] = {"id": "c-1", "org_id": "org-1", "name": "French 101"}
        deps = _make_deps(db)

        assignment, mapping, class_record = load_assignment_bundle(deps, "a-1")
        self.assertEqual(assignment["id"], "a-1")
        # After C2, mapping is always None — the middle slot is a legacy
        # signature placeholder for existing call sites.
        self.assertIsNone(mapping)
        self.assertEqual(class_record["id"], "c-1")

    def test_raises_on_missing_assignment(self):
        deps = _make_deps()
        with self.assertRaises(ValueError) as cm:
            load_assignment_bundle(deps, "nonexistent")
        self.assertIn("Assignment not found", str(cm.exception))

    def test_raises_on_missing_class(self):
        db = FakeResolverDb()
        db.assignments["a-1"] = {"id": "a-1", "class_id": "missing-class"}
        deps = _make_deps(db)
        with self.assertRaises(ValueError) as cm:
            load_assignment_bundle(deps, "a-1")
        self.assertIn("Class not found", str(cm.exception))


# ---------------------------------------------------------------------------
# is_teacher_preview_allowed / user_can_access_assignment
# ---------------------------------------------------------------------------
class TestIsTeacherPreviewAllowed(unittest.TestCase):

    def test_teacher_in_same_org_and_class(self):
        ctx = _make_context(roles=("teacher",), org_id="org-1", membership_id="mem-1")
        class_record = {"org_id": "org-1", "teacher_membership_ids": ["mem-1"]}
        self.assertTrue(is_teacher_preview_allowed(ctx, class_record))

    def test_school_admin_in_same_org(self):
        ctx = _make_context(roles=("school_admin",), org_id="org-1", membership_id="mem-2")
        class_record = {"org_id": "org-1", "teacher_membership_ids": ["mem-1"]}
        self.assertTrue(is_teacher_preview_allowed(ctx, class_record))

    def test_teacher_in_different_org(self):
        ctx = _make_context(roles=("teacher",), org_id="org-2")
        class_record = {"org_id": "org-1", "teacher_membership_ids": []}
        self.assertFalse(is_teacher_preview_allowed(ctx, class_record))

    def test_teacher_not_in_class_membership_ids(self):
        ctx = _make_context(roles=("teacher",), org_id="org-1", membership_id="mem-99")
        class_record = {"org_id": "org-1", "teacher_membership_ids": ["mem-1"]}
        self.assertFalse(is_teacher_preview_allowed(ctx, class_record))

    def test_none_context(self):
        class_record = {"org_id": "org-1"}
        self.assertFalse(is_teacher_preview_allowed(None, class_record))


class TestUserCanAccessAssignment(unittest.TestCase):

    def test_enrolled_student_published_assignment(self):
        db = FakeResolverDb()
        db.enrollments["c-1_stu-1"] = {"status": "active"}
        deps = _make_deps(db)

        allowed, teacher_preview = user_can_access_assignment(
            deps,
            uid="stu-1",
            context=_make_context(uid="stu-1", roles=("student",), org_id="org-1"),
            assignment={"class_id": "c-1", "status": "published"},
            class_record={"id": "c-1", "org_id": "org-1", "teacher_membership_ids": []},
        )
        self.assertTrue(allowed)
        self.assertFalse(teacher_preview)

    def test_unenrolled_student_rejected(self):
        db = FakeResolverDb()
        deps = _make_deps(db)

        allowed, _ = user_can_access_assignment(
            deps,
            uid="stu-1",
            context=_make_context(uid="stu-1", roles=("student",), org_id="org-1"),
            assignment={"class_id": "c-1", "status": "published"},
            class_record={"id": "c-1", "org_id": "org-1", "teacher_membership_ids": []},
        )
        self.assertFalse(allowed)

    def test_draft_assignment_rejected_for_student(self):
        db = FakeResolverDb()
        db.enrollments["c-1_stu-1"] = {"status": "active"}
        deps = _make_deps(db)

        allowed, _ = user_can_access_assignment(
            deps,
            uid="stu-1",
            context=_make_context(uid="stu-1", roles=("student",)),
            assignment={"class_id": "c-1", "status": "draft"},
            class_record={"id": "c-1", "org_id": "org-1", "teacher_membership_ids": []},
        )
        self.assertFalse(allowed)

    def test_teacher_gets_preview(self):
        db = FakeResolverDb()
        deps = _make_deps(db)

        allowed, teacher_preview = user_can_access_assignment(
            deps,
            uid="teacher-1",
            context=_make_context(uid="teacher-1", roles=("teacher",), membership_id="mem-1"),
            assignment={"class_id": "c-1", "status": "draft"},
            class_record={"id": "c-1", "org_id": "org-1", "teacher_membership_ids": ["mem-1"]},
        )
        self.assertTrue(allowed)
        self.assertTrue(teacher_preview)


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------
class TestSerializeAssignment(unittest.TestCase):

    def test_serializes_valid_assignment(self):
        assignment = {
            "id": "a-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "title": "Practice 1",
            "status": "published",
            "task_type": "information_gap",
            "success_criteria": ["Complete the task"],
        }
        result = serialize_assignment(assignment)
        self.assertEqual(result["id"], "a-1")
        self.assertNotIn("taskType", result)
        self.assertEqual(result["successCriteria"], ["Complete the task"])

    def test_returns_none_for_none(self):
        self.assertIsNone(serialize_assignment(None))

    def test_serializes_direct_scenario_fields(self):
        assignment = {
            "id": "a-2",
            "org_id": "org-1",
            "class_id": "c-1",
            "title": "Canvas practice",
            "task_type": "decision_making",
            "instructions": "Order dinner politely.",
            "generated_scenario": "You are at a busy bistro.",
            "objectives": ["request food", "clarify choices"],
            "target_expressions": ["Je voudrais", "L'addition"],
            "target_vocabulary": ["réservation", "addition"],
            "focus_grammar": ["polite conditional"],
            "teacher_notes": "Keep it polite.",
            "canvas_module_item_ref": {
                "connection_id": "cn1",
                "canvas_module_id": "mo1",
                "item_id": "it1",
            },
        }
        result = serialize_assignment(assignment)
        self.assertEqual(result["instructions"], "Order dinner politely.")
        self.assertEqual(result["generatedScenario"], "You are at a busy bistro.")
        self.assertEqual(result["objectives"], ["request food", "clarify choices"])
        self.assertEqual(result["targetExpressions"], ["Je voudrais", "L'addition"])
        self.assertEqual(result["targetVocabulary"], ["réservation", "addition"])
        self.assertEqual(result["focusGrammar"], ["polite conditional"])
        self.assertEqual(result["teacherNotes"], "Keep it polite.")
        self.assertEqual(result["canvasModuleItemRef"]["item_id"], "it1")

    def test_omits_absent_direct_scenario_fields(self):
        assignment = {
            "id": "a-3",
            "org_id": "org-1",
            "class_id": "c-1",
            "title": "Minimal",
            "task_type": "information_gap",
        }
        result = serialize_assignment(assignment)
        for key in ("instructions", "generatedScenario", "objectives",
                    "targetExpressions", "focusGrammar", "teacherNotes",
                    "canvasModuleItemRef"):
            self.assertNotIn(key, result)


# ---------------------------------------------------------------------------
# resolve_assignment_bootstrap (Canvas-first — the only remaining path)
# ---------------------------------------------------------------------------
class TestResolveAssignmentBootstrap(unittest.TestCase):

    def test_canvas_first_bootstrap(self):
        deps = _make_deps()
        assignment = {
            "id": "a-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "title": "Family practice",
            "status": "published",
            "task_type": "information_gap",
            "generated_scenario": "You meet a new classmate. Tell them about your family.",
            "objectives": ["Describe family relationships", "Ask one follow-up question"],
            "target_expressions": ["Mi familia", "Tengo hermanos"],
            "target_vocabulary": ["madre", "hermano"],
            "focus_grammar": ["possessive adjectives"],
            "teacher_notes": "Keep the exchange informal.",
            "canvas_module_item_ref": {
                "item_title": "Family introductions page",
                "canvas_module_name": "Unit 2: Family",
            },
        }
        class_record = {
            "id": "c-1",
            "org_id": "org-1",
            "name": "Spanish",
            "learning_locale": "es-ES",
            "subject": "Spanish",
            "status": "active",
        }

        bootstrap = resolve_assignment_bootstrap(
            deps,
            assignment=assignment,
            class_record=class_record,
        )

        self.assertIn("assignment", bootstrap)
        self.assertIn("mapping", bootstrap)
        self.assertIn("class", bootstrap)
        self.assertIn("curriculum", bootstrap)
        self.assertIn("launch", bootstrap)
        self.assertIn("realtimeSessionParams", bootstrap)
        self.assertIn("systemPromptPreview", bootstrap)

        self.assertEqual(bootstrap["assignment"]["id"], "a-1")
        self.assertEqual(bootstrap["class"]["learningLocale"], "es-ES")
        # Scenario fields surface on the empty mapping dto for legacy reads.
        self.assertEqual(
            bootstrap["mapping"]["generatedScenario"],
            "You meet a new classmate. Tell them about your family.",
        )
        self.assertEqual(
            bootstrap["mapping"]["targetExpressions"],
            ["Mi familia", "Tengo hermanos"],
        )
        self.assertEqual(
            bootstrap["mapping"]["targetVocabulary"],
            ["madre", "hermano"],
        )
        self.assertEqual(
            bootstrap["mapping"]["focusGrammar"], ["possessive adjectives"],
        )
        self.assertEqual(
            [objective["canDo"]["en"] for objective in bootstrap["curriculum"]["objectives"]],
            ["Describe family relationships", "Ask one follow-up question"],
        )
        self.assertEqual(bootstrap["mapping"]["objectiveIds"], ["canvas-objective-1", "canvas-objective-2"])
        # System prompt includes the scenario + target expressions + grammar.
        prompt = bootstrap["systemPromptPreview"]
        full_prompt = build_assignment_system_prompt(bootstrap)
        self.assertIn("Mi familia", prompt)
        self.assertIn("madre", prompt)
        self.assertIn("You meet a new classmate", prompt)
        self.assertIn("Family introductions page", prompt)
        self.assertIn("Unit 2: Family", prompt)
        self.assertIn("possessive adjectives", prompt)
        self.assertIn("es-ES", prompt)
        self.assertIn("Describe family relationships", full_prompt)
        self.assertIn("TARGET VOCABULARY TO ELICIT", full_prompt)
        # Realtime params use the canvas_generated shape.
        self.assertEqual(
            bootstrap["realtimeSessionParams"]["practice"]["type"],
            "canvas_generated",
        )

    def test_canvas_first_bootstrap_uses_hidden_100_minute_internal_time_cap(self):
        deps = _make_deps()
        assignment = {
            "id": "a-2",
            "org_id": "org-1",
            "class_id": "c-1",
            "title": "Untimed conversation",
            "status": "published",
            "generated_scenario": "Talk naturally about weekend plans.",
            "objectives": ["Discuss weekend plans naturally."],
        }
        class_record = {
            "id": "c-1",
            "org_id": "org-1",
            "name": "French",
            "learning_locale": "fr-FR",
            "subject": "French",
            "status": "active",
        }

        bootstrap = resolve_assignment_bootstrap(
            deps,
            assignment=assignment,
            class_record=class_record,
        )

        self.assertEqual(
            bootstrap["curriculum"]["pedagogy"]["evidence"]["timeLimitSec"],
            6000,
        )
        self.assertEqual(
            bootstrap["curriculum"]["objectives"][0]["evidenceModel"]["timeLimitSec"],
            6000,
        )


# ---------------------------------------------------------------------------
# resolve_assignment_bootstrap_for_user — Canvas-first path
# ---------------------------------------------------------------------------
class TestCanvasGeneratedBootstrapFromAssignment(unittest.TestCase):
    """Test that the resolver correctly handles assignments with scenario fields
    directly on the assignment document (no curriculum_mappings row — C2)."""

    def setUp(self):
        self.db = FakeResolverDb()
        self.deps = _make_deps(self.db)
        self.context = _make_context(
            uid="u1",
            roles=("student",),
            org_id="o1",
            membership_id="m1",
        )

    def test_canvas_generated_bootstrap_reads_scenario_from_assignment(self):
        self.db.classes["c1"] = {
            "id": "c1",
            "org_id": "o1",
            "name": "Spanish",
            "learning_locale": "es-ES",
            "subject": "Spanish",
            "teacher_membership_ids": ["m1"],
            "status": "active",
        }
        self.db.enrollments["c1_u1"] = {
            "id": "c1_u1",
            "class_id": "c1",
            "student_uid": "u1",
            "status": "active",
            "join_source": "join_code",
        }
        asg_id = "asg-canvas-1"
        self.db.assignments[asg_id] = {
            "id": asg_id,
            "org_id": "o1",
            "class_id": "c1",
            "title": "Canvas test",
            "description": "",
            "status": "published",
            "task_type": "decision_making",
            "success_criteria": [],
            "created_by_uid": "uid-t",
            "instructions": "Talk about your family.",
            "generated_scenario": "You meet a new classmate. Tell them about your family.",
            "objectives": ["Describe family relationships"],
            "target_expressions": ["Mi familia", "Tengo hermanos"],
            "target_vocabulary": ["madre", "hermano"],
            "focus_grammar": ["possessive adjectives"],
            "teacher_notes": "Keep the exchange informal and supportive.",
            "canvas_module_item_ref": {
                "connection_id": "cn1",
                "canvas_module_id": "mo1",
                "item_id": "it1",
                "item_title": "Family introductions page",
                "canvas_module_name": "Unit 2: Family",
            },
        }

        bootstrap = resolve_assignment_bootstrap_for_user(
            deps=self.deps,
            uid="u1",
            context=self.context,
            assignment_id=asg_id,
            ui_language="en",
        )

        # Class locale honored
        self.assertEqual(bootstrap["class"]["learningLocale"], "es-ES")
        # System prompt contains scenario + target expressions + grammar
        self.assertIn("Mi familia", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("madre", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("You meet a new classmate", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("Family introductions page", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("possessive adjectives", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("es-ES", bootstrap.get("systemPromptPreview", ""))
        # Mapping key is present and exposes scenario fields for legacy reads.
        self.assertIn("mapping", bootstrap)
        self.assertEqual(bootstrap["mapping"]["generatedScenario"], "You meet a new classmate. Tell them about your family.")
        self.assertEqual(bootstrap["mapping"]["targetExpressions"], ["Mi familia", "Tengo hermanos"])
        self.assertEqual(bootstrap["mapping"]["targetVocabulary"], ["madre", "hermano"])
        self.assertEqual(bootstrap["mapping"]["focusGrammar"], ["possessive adjectives"])
        self.assertEqual(bootstrap["mapping"]["teacherNotes"], "Keep the exchange informal and supportive.")
        self.assertEqual(bootstrap["curriculum"]["objectives"][0]["canDo"]["en"], "Describe family relationships")
        self.assertEqual(
            bootstrap["realtimeSessionParams"]["practice"]["type"], "canvas_generated"
        )

    def _seed_language_mix_assignment(self, intensity_value):
        self.db.classes["c1"] = {
            "id": "c1", "org_id": "o1", "name": "Spanish",
            "learning_locale": "es-ES", "subject": "Spanish",
            "teacher_membership_ids": ["m1"], "status": "active",
        }
        self.db.enrollments["c1_u1"] = {
            "id": "c1_u1", "class_id": "c1", "student_uid": "u1",
            "status": "active", "join_source": "join_code",
        }
        self.db.assignments["asg-mix"] = {
            "id": "asg-mix", "org_id": "o1", "class_id": "c1",
            "title": "Mix test", "status": "published",
            "task_type": "decision_making", "success_criteria": [],
            "created_by_uid": "uid-t",
            "instructions": "Talk.", "generated_scenario": "Order coffee.",
            "objectives": ["Order food"], "target_expressions": [],
            "target_vocabulary": [], "focus_grammar": [],
            "teacher_notes": "",
            "target_language_intensity": intensity_value,
        }

    def test_language_mix_target_only_emits_strict_directive(self):
        self._seed_language_mix_assignment("target_only")
        bootstrap = resolve_assignment_bootstrap_for_user(
            deps=self.deps, uid="u1", context=self.context,
            assignment_id="asg-mix", ui_language="en",
        )
        prompt = bootstrap["systemPromptPreview"]
        self.assertIn("## Language Mix", prompt)
        self.assertIn("Respond ONLY in Spanish", prompt)
        self.assertNotIn("Bilingual scaffolding is on", prompt)

    def test_language_mix_mostly_target_is_default(self):
        # Omit target_language_intensity entirely — should default to mostly_target.
        self._seed_language_mix_assignment("")
        del self.db.assignments["asg-mix"]["target_language_intensity"]
        bootstrap = resolve_assignment_bootstrap_for_user(
            deps=self.deps, uid="u1", context=self.context,
            assignment_id="asg-mix", ui_language="en",
        )
        prompt = bootstrap["systemPromptPreview"]
        self.assertIn("Speak primarily in Spanish", prompt)
        self.assertIn("Brief English scaffolding", prompt)
        self.assertNotIn("Respond ONLY in Spanish", prompt)

    def test_language_mix_bilingual_scaffold_emits_glossing_directive(self):
        self._seed_language_mix_assignment("bilingual_scaffold")
        bootstrap = resolve_assignment_bootstrap_for_user(
            deps=self.deps, uid="u1", context=self.context,
            assignment_id="asg-mix", ui_language="en",
        )
        prompt = bootstrap["systemPromptPreview"]
        self.assertIn("Bilingual scaffolding is on", prompt)
        self.assertIn("English gloss in parentheses", prompt)


if __name__ == "__main__":
    unittest.main()
