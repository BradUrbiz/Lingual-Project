import unittest
from unittest.mock import MagicMock
from flask import Flask
from backend.tests.conftest import FakeDbBase
from backend.routes.canvas_practice import create_canvas_practice_blueprint


class CanvasPracticeCreateTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDbBase()
        # Seed class + canvas content item
        self.db.classes["class-1"] = {
            "id": "class-1", "org_id": "org-1", "name": "Spanish",
            "learning_locale": "es-ES", "subject": "Spanish",
            "teacher_membership_ids": ["mem-1"],
        }
        # Ensure canvas_course_content dict exists on FakeDbBase; seed one row.
        if not hasattr(self.db, "canvas_course_content"):
            self.db.canvas_course_content = {}
        self.db.canvas_course_content["cc-1"] = {
            "id": "cc-1", "class_id": "class-1", "connection_id": "conn-1",
            "item_title": "La familia", "item_type": "Page", "item_id": "page-1",
            "canvas_module_id": "mod-1", "canvas_module_name": "Unit 1",
        }

        self.deps = MagicMock()
        self.deps.db = self.db
        self.deps.login_required = lambda f: f
        self.deps.get_current_user_uid = lambda: "uid-1"
        context = MagicMock()
        context.active_organization_id = "org-1"
        context.active_membership_id = "mem-1"
        context.has_role = lambda role: False
        context.require_any_role = lambda roles: None
        self.deps.get_school_request_context = lambda: context

        self.app = Flask(__name__)
        self.app.register_blueprint(create_canvas_practice_blueprint(self.deps))
        self.client = self.app.test_client()

    def test_create_writes_scenario_fields_onto_assignment(self):
        resp = self.client.post(
            "/api/teacher/classes/class-1/canvas-practice/create",
            json={
                "canvasContentId": "cc-1",
                "canvasModuleItemId": "page-1",
                "title": "Family introductions",
                "description": "Practice introducing your family.",
                "scenario": "You meet a new classmate. Tell them about your family.",
                "taskType": "information_gap",
                "targetExpressions": ["Mi familia es...", "Mi hermano se llama..."],
                "focusGrammar": ["possessive adjectives"],
                "successCriteria": ["Name at least 3 family members"],
                "teacherNotes": "Great for Week 1",
                "status": "published",
            },
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()
        self.assertTrue(data["success"])
        asg = self.db.assignments[data["assignmentId"]]
        self.assertEqual(asg["title"], "Family introductions")
        self.assertEqual(asg["status"], "published")
        # Fallback logic: instructions is populated from description when not explicitly set.
        self.assertEqual(asg["instructions"], "Practice introducing your family.")
        self.assertEqual(asg["target_expressions"], ["Mi familia es...", "Mi hermano se llama..."])
        self.assertEqual(asg["focus_grammar"], ["possessive adjectives"])
        self.assertEqual(asg["success_criteria"], ["Name at least 3 family members"])
        self.assertTrue(asg["generated_scenario"].startswith("You meet"))
        self.assertEqual(asg["teacher_notes"], "Great for Week 1")
        self.assertEqual(asg["canvas_module_item_ref"], {
            "connection_id": "conn-1",
            "canvas_module_id": "mod-1",
            "item_id": "page-1",
        })
        # Confirm (C2): assignment has no mapping_id field at all; scenario lives on the assignment.
        self.assertNotIn("mapping_id", asg)
