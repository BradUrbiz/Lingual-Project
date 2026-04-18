import unittest
from backend.tests.conftest import FakeDbBase

class CreateAssignmentDirectFieldsTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDbBase()

    def test_create_assignment_persists_direct_scenario_fields(self):
        assignment_id = self.db.create_assignment(
            org_id="org-1",
            class_id="class-1",
            mapping_id=None,
            title="Sample",
            description="",
            status="draft",
            task_type="decision_making",
            success_criteria=[],
            created_by_uid="uid-1",
            instructions="Practice ordering food in Spanish.",
            canvas_module_item_ref={"connection_id": "c1", "canvas_module_id": "m1", "item_id": "i1"},
            objectives=["Order a dish", "Ask for the bill"],
            target_expressions=["Me gustaria", "La cuenta por favor"],
            focus_grammar=["conditional 'gustaria'"],
            generated_scenario="You are a waiter at a Madrid tapas bar...",
            teacher_notes="Keep feedback focused on polite restaurant register.",
        )
        doc = self.db.get_assignment(assignment_id)
        self.assertEqual(doc["instructions"], "Practice ordering food in Spanish.")
        self.assertEqual(doc["canvas_module_item_ref"]["item_id"], "i1")
        self.assertEqual(doc["objectives"], ["Order a dish", "Ask for the bill"])
        self.assertEqual(doc["target_expressions"], ["Me gustaria", "La cuenta por favor"])
        self.assertEqual(doc["focus_grammar"], ["conditional 'gustaria'"])
        self.assertTrue(doc["generated_scenario"].startswith("You are a waiter"))
        self.assertEqual(doc["teacher_notes"], "Keep feedback focused on polite restaurant register.")

    def test_create_assignment_default_fields_empty(self):
        assignment_id = self.db.create_assignment(
            org_id="org-1", class_id="class-1", mapping_id=None,
            title="Minimal", description="", status="draft",
            task_type="decision_making", success_criteria=[], created_by_uid="uid-1",
        )
        doc = self.db.get_assignment(assignment_id)
        self.assertEqual(doc.get("instructions", ""), "")
        self.assertEqual(doc.get("objectives", []), [])
        self.assertEqual(doc.get("target_expressions", []), [])
        self.assertEqual(doc.get("focus_grammar", []), [])
        self.assertIsNone(doc.get("canvas_module_item_ref"))
        self.assertEqual(doc.get("generated_scenario", ""), "")
        self.assertEqual(doc.get("teacher_notes", ""), "")
