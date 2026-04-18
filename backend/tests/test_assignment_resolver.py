import unittest
from types import SimpleNamespace
from datetime import UTC, datetime
from unittest.mock import MagicMock

from backend.services.assignment_resolver import (
    load_assignment_bundle,
    user_can_access_assignment,
    is_teacher_preview_allowed,
    serialize_curriculum_mapping,
    serialize_assignment,
    build_sample_package_summary,
    _package_objective_index,
    _package_rubric_index,
    _build_bootstrap_pedagogy_context,
    resolve_assignment_bootstrap,
    resolve_assignment_bootstrap_for_user,
)
from backend.services.membership_context import SchoolRequestContext


class FakeResolverDb:
    """Fake DB for assignment resolver tests."""

    def __init__(self):
        self.assignments = {}
        self.classes = {}
        self.mappings = {}
        self.enrollments = {}

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_curriculum_mapping(self, mapping_id):
        return self.mappings.get(mapping_id)

    def get_student_class_enrollment(self, class_id, uid):
        return self.enrollments.get(f"{class_id}_{uid}")


def _make_deps(db=None, package=None):
    if db is None:
        db = FakeResolverDb()
    if package is None:
        package = _make_sample_package()
    return SimpleNamespace(
        db=db,
        load_sample_curriculum_package=lambda: package,
        get_curriculum_practice_context=lambda module_id, situation_id: (
            package,
            _find_unit(package, module_id),
            _find_module(package, module_id),
            _find_situation(package, module_id, situation_id),
            "interpersonal_speaking",
            _find_situation_objectives(package, module_id, situation_id),
        ),
        build_curriculum_system_prompt=lambda **kwargs: "SYSTEM PROMPT PLACEHOLDER",
    )


def _make_sample_package():
    return {
        "curriculum": {
            "id": "ap-french-sample",
            "title": {"en": "AP French Sample"},
            "learningLocale": "fr-FR",
            "levelBand": "intermediate",
            "version": "1.0",
            "source": {"type": "native"},
        },
        "objectives": [
            {
                "id": "obj-1",
                "mode": "interpersonal_speaking",
                "canDo": {"en": "Describe family"},
                "contextTags": ["family_structures"],
                "communicativeFunctions": ["describe_people_things"],
                "discourseMoves": ["compare_contrast"],
                "foundationDomains": ["personal"],
                "mastery": {"rubricId": "rubric-1", "threshold": 3},
                "evidenceModel": {"taskModel": "information_gap", "minTurns": 4, "timeLimitSec": 300},
                "templateRefs": ["template-1"],
            },
            {
                "id": "obj-2",
                "mode": "interpersonal_speaking",
                "canDo": {"en": "Express opinions"},
                "contextTags": ["beliefs_values"],
                "communicativeFunctions": ["express_opinion"],
                "discourseMoves": ["hedging"],
                "foundationDomains": [],
                "mastery": {"rubricId": "rubric-1", "threshold": 3},
                "evidenceModel": {"taskModel": "opinion_gap", "minTurns": 5},
                "templateRefs": [],
            },
        ],
        "rubrics": [
            {
                "id": "rubric-1",
                "title": {"en": "Speaking rubric"},
                "scale": {"min": 0, "max": 4},
                "dimensions": [
                    {"id": "interaction_management", "title": {"en": "Interaction"}, "description": {"en": "..."}},
                    {"id": "lexical_grammatical_control", "title": {"en": "Grammar"}, "description": {"en": "..."}},
                ],
            }
        ],
        "units": [
            {
                "id": "unit-1",
                "title": {"en": "Unit 1"},
                "ap": {"unitNumber": 1},
                "modules": [
                    {
                        "id": "mod-1",
                        "title": {"en": "Module 1"},
                        "moduleGoal": {"en": "Learn family vocabulary"},
                        "capstone": {"mode": "interpersonal_speaking", "taskModel": "information_gap", "situationId": "sit-1"},
                        "situations": [
                            {
                                "id": "sit-1",
                                "kind": "interpersonal_speaking",
                                "objectiveIds": ["obj-1"],
                                "seed": {
                                    "setting": {"en": "At a cafe"},
                                    "roles": [{"en": "Student"}, {"en": "Friend"}],
                                    "register": "informal",
                                    "contextTags": ["family_structures"],
                                    "constraints": {"minTurns": 4, "maxTurns": 10, "timeLimitSec": 300},
                                },
                            }
                        ],
                    }
                ],
            }
        ],
        "templates": {
            "activityTemplates": [
                {
                    "id": "template-1",
                    "title": {"en": "Family discussion"},
                    "mode": "interpersonal_speaking",
                    "assistantRole": "friend",
                    "interactionPattern": {
                        "openingMoves": ["Greet the student"],
                        "sustainMoves": ["Ask follow-up questions"],
                        "closingMoves": ["Summarize the conversation"],
                        "completionRule": "After 4 turns",
                    },
                    "promptCues": ["Ask about family members"],
                }
            ]
        },
    }


def _find_unit(package, module_id):
    for unit in package.get("units", []):
        for mod in unit.get("modules", []):
            if mod.get("id") == module_id:
                return unit
    return {}


def _find_module(package, module_id):
    for unit in package.get("units", []):
        for mod in unit.get("modules", []):
            if mod.get("id") == module_id:
                return mod
    return {}


def _find_situation(package, module_id, situation_id):
    mod = _find_module(package, module_id)
    for sit in mod.get("situations", []):
        if sit.get("id") == situation_id:
            return sit
    return {}


def _find_situation_objectives(package, module_id, situation_id):
    situation = _find_situation(package, module_id, situation_id)
    obj_ids = situation.get("objectiveIds", [])
    obj_index = _package_objective_index(package)
    return [obj_index[oid] for oid in obj_ids if oid in obj_index]


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
        db.assignments["a-1"] = {"id": "a-1", "class_id": "c-1", "mapping_id": "m-1"}
        db.classes["c-1"] = {"id": "c-1", "org_id": "org-1", "name": "French 101"}
        db.mappings["m-1"] = {"id": "m-1", "class_id": "c-1", "package_id": "pkg-1"}
        deps = _make_deps(db)

        assignment, mapping, class_record = load_assignment_bundle(deps, "a-1")
        self.assertEqual(assignment["id"], "a-1")
        self.assertEqual(mapping["id"], "m-1")
        self.assertEqual(class_record["id"], "c-1")

    def test_raises_on_missing_assignment(self):
        db = FakeResolverDb()
        deps = _make_deps(db)
        with self.assertRaises(ValueError) as cm:
            load_assignment_bundle(deps, "nonexistent")
        self.assertIn("Assignment not found", str(cm.exception))

    def test_raises_on_missing_class(self):
        db = FakeResolverDb()
        db.assignments["a-1"] = {"id": "a-1", "class_id": "missing-class", "mapping_id": "m-1"}
        deps = _make_deps(db)
        with self.assertRaises(ValueError) as cm:
            load_assignment_bundle(deps, "a-1")
        self.assertIn("Class not found", str(cm.exception))

    def test_raises_on_missing_mapping(self):
        db = FakeResolverDb()
        db.assignments["a-1"] = {"id": "a-1", "class_id": "c-1", "mapping_id": "missing-mapping"}
        db.classes["c-1"] = {"id": "c-1"}
        deps = _make_deps(db)
        with self.assertRaises(ValueError) as cm:
            load_assignment_bundle(deps, "a-1")
        self.assertIn("mapping not found", str(cm.exception))


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
class TestSerializeCurriculumMapping(unittest.TestCase):

    def test_serializes_valid_mapping(self):
        mapping = {
            "id": "m-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "package_id": "pkg-1",
            "module_id": "mod-1",
            "objective_ids": ["obj-1"],
            "situation_ids": ["sit-1"],
            "target_expressions": ["bonjour"],
            "focus_grammar": ["past tense"],
            "feedback_policy": {"mode": "balanced"},
            "scaffold_policy": {},
            "modality_policy": {"mode": "hybrid"},
        }
        result = serialize_curriculum_mapping(mapping)
        self.assertEqual(result["id"], "m-1")
        self.assertEqual(result["packageId"], "pkg-1")
        self.assertEqual(result["objectiveIds"], ["obj-1"])
        self.assertEqual(result["targetExpressions"], ["bonjour"])
        self.assertIn("feedbackPolicy", result)
        self.assertIn("modalityPolicy", result)

    def test_returns_none_for_none(self):
        self.assertIsNone(serialize_curriculum_mapping(None))


class TestSerializeAssignment(unittest.TestCase):

    def test_serializes_valid_assignment(self):
        assignment = {
            "id": "a-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "mapping_id": "m-1",
            "title": "Practice 1",
            "status": "published",
            "task_type": "information_gap",
            "success_criteria": ["Complete the task"],
        }
        result = serialize_assignment(assignment)
        self.assertEqual(result["id"], "a-1")
        self.assertEqual(result["taskType"], "information_gap")
        self.assertEqual(result["successCriteria"], ["Complete the task"])

    def test_returns_none_for_none(self):
        self.assertIsNone(serialize_assignment(None))


class TestBuildSamplePackageSummary(unittest.TestCase):

    def test_extracts_package_summary(self):
        package = _make_sample_package()
        result = build_sample_package_summary(package)
        self.assertEqual(result["id"], "ap-french-sample")
        self.assertEqual(result["learningLocale"], "fr-FR")
        self.assertEqual(result["ownerScope"], "global")


# ---------------------------------------------------------------------------
# Package index helpers
# ---------------------------------------------------------------------------
class TestPackageIndexes(unittest.TestCase):

    def test_objective_index(self):
        package = _make_sample_package()
        index = _package_objective_index(package)
        self.assertIn("obj-1", index)
        self.assertIn("obj-2", index)
        self.assertEqual(index["obj-1"]["canDo"]["en"], "Describe family")

    def test_rubric_index(self):
        package = _make_sample_package()
        index = _package_rubric_index(package)
        self.assertIn("rubric-1", index)
        self.assertEqual(len(index["rubric-1"]["dimensions"]), 2)


# ---------------------------------------------------------------------------
# _build_bootstrap_pedagogy_context
# ---------------------------------------------------------------------------
class TestBuildBootstrapPedagogyContext(unittest.TestCase):

    def test_collects_from_objectives(self):
        package = _make_sample_package()
        objectives = package["objectives"]
        rubrics = package["rubrics"]
        module = _find_module(package, "mod-1")
        situation = _find_situation(package, "mod-1", "sit-1")

        result = _build_bootstrap_pedagogy_context(package, module, situation, objectives, rubrics)
        self.assertEqual(result["taskModel"], "information_gap")
        self.assertIn("obj-1", result["objectiveIds"])
        self.assertIn("obj-2", result["objectiveIds"])
        self.assertIn("describe_people_things", result["communicativeFunctions"])
        self.assertIn("express_opinion", result["communicativeFunctions"])
        self.assertIn("compare_contrast", result["discourseMoves"])
        self.assertIn("hedging", result["discourseMoves"])
        self.assertIn("family_structures", result["contextTags"])
        self.assertIn("rubric-1", result["rubricIds"])
        self.assertIn("interaction_management", result["rubricDimensionIds"])
        self.assertEqual(result["evidence"]["minTurns"], 4)
        self.assertEqual(result["evidence"]["maxTurns"], 10)
        self.assertEqual(result["evidence"]["timeLimitSec"], 300)

    def test_resolves_activity_templates(self):
        package = _make_sample_package()
        objectives = [package["objectives"][0]]  # obj-1 has templateRefs
        rubrics = package["rubrics"]
        module = _find_module(package, "mod-1")
        situation = _find_situation(package, "mod-1", "sit-1")

        result = _build_bootstrap_pedagogy_context(package, module, situation, objectives, rubrics)
        self.assertIn("template-1", result["templateRefs"])
        self.assertGreater(len(result["activityTemplates"]), 0)
        self.assertEqual(result["activityTemplates"][0]["id"], "template-1")


# ---------------------------------------------------------------------------
# resolve_assignment_bootstrap (integration)
# ---------------------------------------------------------------------------
class TestResolveAssignmentBootstrap(unittest.TestCase):

    def test_full_bootstrap_resolution(self):
        db = FakeResolverDb()
        package = _make_sample_package()
        deps = _make_deps(db, package)

        assignment = {
            "id": "a-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "mapping_id": "m-1",
            "title": "Practice 1",
            "status": "published",
            "task_type": "information_gap",
            "modality_override": None,
        }
        mapping = {
            "id": "m-1",
            "org_id": "org-1",
            "class_id": "c-1",
            "package_id": "ap-french-sample",
            "module_id": "mod-1",
            "objective_ids": ["obj-1"],
            "situation_ids": ["sit-1"],
            "target_expressions": ["bonjour", "comment ca va"],
            "focus_grammar": ["present tense"],
            "feedback_policy": {"mode": "balanced"},
            "scaffold_policy": {},
            "modality_policy": {"mode": "hybrid"},
        }
        class_record = {"id": "c-1", "org_id": "org-1", "name": "French 101", "learning_locale": "fr-FR"}

        bootstrap = resolve_assignment_bootstrap(
            deps,
            assignment=assignment,
            mapping=mapping,
            class_record=class_record,
        )

        # Top-level structure
        self.assertIn("assignment", bootstrap)
        self.assertIn("mapping", bootstrap)
        self.assertIn("class", bootstrap)
        self.assertIn("curriculum", bootstrap)
        self.assertIn("launch", bootstrap)
        self.assertIn("realtimeSessionParams", bootstrap)
        self.assertIn("systemPromptPreview", bootstrap)
        self.assertIn("limitations", bootstrap)

        # Assignment serialized
        self.assertEqual(bootstrap["assignment"]["id"], "a-1")
        self.assertEqual(bootstrap["assignment"]["taskType"], "information_gap")

        # Curriculum resolved
        curriculum = bootstrap["curriculum"]
        self.assertEqual(curriculum["package"]["id"], "ap-french-sample")
        self.assertEqual(curriculum["module"]["id"], "mod-1")
        self.assertEqual(curriculum["situation"]["id"], "sit-1")
        self.assertGreater(len(curriculum["objectives"]), 0)
        self.assertGreater(len(curriculum["rubrics"]), 0)
        self.assertIn("pedagogy", curriculum)

        # Pedagogy populated
        pedagogy = curriculum["pedagogy"]
        self.assertIn("taskModel", pedagogy)
        self.assertIn("communicativeFunctions", pedagogy)
        self.assertIn("objectiveIds", pedagogy)

        # Launch pre-compliance
        launch = bootstrap["launch"]
        self.assertIn("voiceAllowed", launch)
        self.assertIn("textAllowed", launch)

    def test_rejects_wrong_package_id(self):
        db = FakeResolverDb()
        deps = _make_deps(db)

        with self.assertRaises(ValueError) as cm:
            resolve_assignment_bootstrap(
                deps,
                assignment={"id": "a-1", "class_id": "c-1", "mapping_id": "m-1", "task_type": "information_gap"},
                mapping={"id": "m-1", "package_id": "wrong-package", "module_id": "mod-1", "situation_ids": ["sit-1"]},
                class_record={"id": "c-1", "org_id": "org-1"},
            )
        self.assertIn("sample curriculum", str(cm.exception))

    def test_rejects_missing_situation(self):
        db = FakeResolverDb()
        deps = _make_deps(db)

        with self.assertRaises(ValueError) as cm:
            resolve_assignment_bootstrap(
                deps,
                assignment={"id": "a-1", "class_id": "c-1", "mapping_id": "m-1", "task_type": "information_gap"},
                mapping={"id": "m-1", "package_id": "ap-french-sample", "module_id": "mod-1", "situation_ids": []},
                class_record={"id": "c-1", "org_id": "org-1"},
            )
        self.assertIn("speaking situation", str(cm.exception))


# ---------------------------------------------------------------------------
# resolve_assignment_bootstrap_for_user — Canvas-first (no mapping row) path
# ---------------------------------------------------------------------------
class TestCanvasGeneratedBootstrapFromAssignment(unittest.TestCase):
    """Test that the resolver correctly handles assignments with scenario fields
    directly on the assignment document (no curriculum_mappings row)."""

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
        """When an assignment has generated_scenario on its own doc (no mapping row),
        the resolver must still produce a valid bootstrap with the scenario in the
        system prompt and the correct learning locale enforced."""
        # Seed a class with Spanish locale
        self.db.classes["c1"] = {
            "id": "c1",
            "org_id": "o1",
            "name": "Spanish",
            "learning_locale": "es-ES",
            "subject": "Spanish",
            "teacher_membership_ids": ["m1"],
            "status": "active",
        }
        # Student enrolled in the class
        self.db.enrollments["c1_u1"] = {
            "id": "c1_u1",
            "class_id": "c1",
            "student_uid": "u1",
            "status": "active",
            "join_source": "join_code",
        }
        # Seed an assignment with scenario fields DIRECTLY on the assignment doc,
        # NOT via a curriculum_mapping row (Canvas-first path from Task A2).
        asg_id = "asg-canvas-1"
        self.db.assignments[asg_id] = {
            "id": asg_id,
            "org_id": "o1",
            "class_id": "c1",
            "mapping_id": None,
            "title": "Canvas test",
            "description": "",
            "status": "published",
            "task_type": "decision_making",
            "success_criteria": [],
            "created_by_uid": "uid-t",
            "instructions": "Talk about your family.",
            "generated_scenario": "You meet a new classmate. Tell them about your family.",
            "target_expressions": ["Mi familia", "Tengo hermanos"],
            "focus_grammar": ["possessive adjectives"],
            "teacher_notes": "Keep the exchange informal and supportive.",
            "canvas_module_item_ref": {
                "connection_id": "cn1",
                "canvas_module_id": "mo1",
                "item_id": "it1",
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
        # System prompt contains the scenario + target expressions + focus grammar
        self.assertIn("Mi familia", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("You meet a new classmate", bootstrap.get("systemPromptPreview", ""))
        self.assertIn("possessive adjectives", bootstrap.get("systemPromptPreview", ""))
        # The class's learning locale flows into the prompt. Asserting on the
        # raw locale code ("es-ES") rather than the language name ("Spanish")
        # avoids false positives from class name / subject occurrences.
        self.assertIn("es-ES", bootstrap.get("systemPromptPreview", ""))
        # Mapping key is present (may be an empty/None-valued dto — just must exist)
        self.assertIn("mapping", bootstrap)
        # Direct Canvas assignment fields must be exposed in the mapping-shaped
        # DTO because launch UI, prompt overlays, and analytics snapshots still
        # read these values from bootstrap["mapping"] during this migration.
        self.assertEqual(bootstrap["mapping"]["generatedScenario"], "You meet a new classmate. Tell them about your family.")
        self.assertEqual(bootstrap["mapping"]["targetExpressions"], ["Mi familia", "Tengo hermanos"])
        self.assertEqual(bootstrap["mapping"]["focusGrammar"], ["possessive adjectives"])
        self.assertEqual(bootstrap["mapping"]["teacherNotes"], "Keep the exchange informal and supportive.")
        # realtimeSessionParams uses the canvas_generated type
        self.assertEqual(
            bootstrap["realtimeSessionParams"]["practice"]["type"], "canvas_generated"
        )

    def test_canvas_first_dispatch_skips_curriculum_mapping_lookup(self):
        """Regression guard for dispatcher ordering. The Canvas-first branch
        (generated_scenario + no mapping_id) must route directly to the
        no-mapping resolver without touching db.get_curriculum_mapping. If a
        future edit reorders the dispatcher branches, this test fails fast."""
        # Same Canvas-first seed as the test above.
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
        asg_id = "asg-canvas-2"
        self.db.assignments[asg_id] = {
            "id": asg_id,
            "org_id": "o1",
            "class_id": "c1",
            "mapping_id": None,
            "title": "Dispatcher regression",
            "description": "",
            "status": "published",
            "task_type": "decision_making",
            "success_criteria": [],
            "created_by_uid": "uid-t",
            "instructions": "",
            "generated_scenario": "You meet a classmate. Talk about your weekend.",
            "target_expressions": ["Fui al parque"],
            "focus_grammar": ["preterite"],
            "canvas_module_item_ref": {
                "connection_id": "cn1",
                "canvas_module_id": "mo1",
                "item_id": "it1",
            },
        }

        # Intercept get_curriculum_mapping — calling it means the dispatcher
        # fell through to the legacy path, which is a regression.
        original_get = self.db.get_curriculum_mapping
        tracker = MagicMock(side_effect=original_get)
        self.db.get_curriculum_mapping = tracker

        resolve_assignment_bootstrap_for_user(
            deps=self.deps,
            uid="u1",
            context=self.context,
            assignment_id=asg_id,
            ui_language="en",
        )

        tracker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
