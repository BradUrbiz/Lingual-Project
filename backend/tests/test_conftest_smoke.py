"""Smoke tests for shared test infrastructure in conftest.py."""

import unittest

from flask import session

from backend.tests.conftest import (
    FakeDbBase,
    SAMPLE_CURRICULUM_PACKAGE,
    get_sample_curriculum_practice_context,
    make_assignment,
    make_class,
    make_compliance_record,
    make_enrollment,
    make_mapping,
    make_organization,
    make_membership,
    make_practice_session,
    make_test_app,
    make_test_deps,
    make_user,
    passthrough_login_required,
    reset_factories,
)
from backend.routes.schools import create_schools_blueprint
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint


class TestFactories(unittest.TestCase):

    def test_make_organization(self):
        org = make_organization(org_id="org-x", name="Test")
        self.assertEqual(org["id"], "org-x")
        self.assertEqual(org["name"], "Test")
        self.assertEqual(org["type"], "school")

    def test_make_membership(self):
        mem = make_membership(org_id="org-1", uid="u-1", roles=["teacher"])
        self.assertIn("id", mem)
        self.assertEqual(mem["roles"], ["teacher"])

    def test_make_class(self):
        cls = make_class(class_id="c-1", org_id="org-1")
        self.assertEqual(cls["id"], "c-1")
        self.assertEqual(cls["learning_locale"], "fr-FR")

    def test_make_enrollment(self):
        enr = make_enrollment(class_id="c-1", student_uid="s-1")
        self.assertEqual(enr["id"], "c-1_s-1")
        self.assertEqual(enr["status"], "active")

    def test_make_user_with_age(self):
        u = make_user(uid="u-1", age=16)
        self.assertEqual(u["profile"]["age"], 16)

    def test_make_user_without_age(self):
        u = make_user(uid="u-1")
        self.assertNotIn("age", u["profile"])

    def test_make_assignment(self):
        a = make_assignment(assignment_id="a-1")
        self.assertEqual(a["id"], "a-1")
        self.assertEqual(a["task_type"], "information_gap")

    def test_make_mapping(self):
        m = make_mapping(mapping_id="m-1")
        self.assertEqual(m["package_id"], "ap-french-sample")
        self.assertEqual(m["module_id"], "mod-1")

    def test_make_compliance_record(self):
        r = make_compliance_record(is_minor=True, voice_consent_status="granted")
        self.assertTrue(r["is_minor"])
        self.assertEqual(r["voice_consent_status"], "granted")

    def test_make_practice_session(self):
        s = make_practice_session(session_id="sess-1")
        self.assertEqual(s["status"], "active")
        self.assertIn("session_summary", s)


class TestFakeDbBase(unittest.TestCase):

    def setUp(self):
        self.db = FakeDbBase()

    def test_seed_org_teacher_class(self):
        org_id, mem_id, cls_id = self.db.seed_org_teacher_class()
        self.assertIsNotNone(self.db.get_organization(org_id))
        self.assertIsNotNone(self.db.get_class(cls_id))
        self.assertIn(cls_id, self.db.memberships[mem_id]["primaryClassIds"])

    def test_seed_student(self):
        org_id, mem_id, cls_id = self.db.seed_org_teacher_class()
        enr_id = self.db.seed_student(uid="s-1", class_id=cls_id, org_id=org_id)
        self.assertIsNotNone(self.db.get_student_class_enrollment(cls_id, "s-1"))
        self.assertEqual(self.db.get_user("s-1")["profile"]["age"], 16)

    def test_resolve_user_school_context(self):
        org_id, mem_id, cls_id = self.db.seed_org_teacher_class()
        ctx = self.db.resolve_user_school_context("teacher-1")
        self.assertEqual(ctx["active_roles"], ["teacher"])
        self.assertEqual(ctx["active_organization_id"], org_id)

    def test_crud_assignment(self):
        aid = self.db.create_assignment(org_id="o", class_id="c", mapping_id="m", title="Test", status="published", task_type="information_gap")
        self.assertIsNotNone(self.db.get_assignment(aid))
        self.assertEqual(len(self.db.list_class_assignments("c")), 1)

    def test_crud_mapping(self):
        mid = self.db.create_curriculum_mapping(org_id="o", class_id="c", package_id="p", module_id="m")
        self.assertIsNotNone(self.db.get_curriculum_mapping(mid))
        self.assertEqual(len(self.db.list_class_curriculum_mappings("c")), 1)

    def test_crud_practice_session(self):
        sid = self.db.create_practice_session({"org_id": "o", "class_id": "c", "assignment_id": "a", "student_uid": "s", "status": "active"})
        self.assertEqual(self.db.get_practice_session(sid)["status"], "active")
        self.db.update_practice_session(sid, {"status": "completed"})
        self.assertEqual(self.db.get_practice_session(sid)["status"], "completed")

    def test_crud_learning_events(self):
        eid = self.db.create_learning_event({"assignment_id": "a-1", "event_type": "student.turn"})
        self.assertEqual(len(self.db.list_assignment_learning_events("a-1")), 1)

    def test_compliance_record_roundtrip(self):
        self.db.upsert_student_compliance_record("o-1", "s-1", {"is_minor": True})
        record = self.db.get_student_compliance_record("o-1", "s-1")
        self.assertTrue(record["is_minor"])

    def test_consent_events(self):
        self.db.create_consent_event(org_id="o-1", event_type="test")
        events = self.db.list_consent_events("o-1")
        self.assertEqual(len(events), 1)

    def test_guardian_packet_roundtrip(self):
        pid = self.db.create_guardian_consent_packet(org_id="o", class_id="c", student_uid="s", token_hash="abc")
        packet = self.db.get_guardian_consent_packet(pid)
        self.assertEqual(packet["token_hash"], "abc")
        found = self.db.find_guardian_consent_packet_by_token_hash("abc")
        self.assertIsNotNone(found)

    def test_student_assignments_respects_enrollment(self):
        self.db.enrollments["c-1_s-1"] = make_enrollment(class_id="c-1", student_uid="s-1")
        self.db.assignments["a-1"] = make_assignment(assignment_id="a-1", class_id="c-1", status="published")
        self.db.assignments["a-2"] = make_assignment(assignment_id="a-2", class_id="c-2", status="published")
        result = self.db.list_student_assignments("s-1", statuses=["published"])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "a-1")


class TestSamplePackage(unittest.TestCase):

    def test_package_has_expected_structure(self):
        self.assertIn("curriculum", SAMPLE_CURRICULUM_PACKAGE)
        self.assertEqual(SAMPLE_CURRICULUM_PACKAGE["curriculum"]["id"], "ap-french-sample")
        self.assertGreater(len(SAMPLE_CURRICULUM_PACKAGE["objectives"]), 0)
        self.assertGreater(len(SAMPLE_CURRICULUM_PACKAGE["rubrics"]), 0)

    def test_practice_context_lookup(self):
        pkg, unit, mod, sit, mode, objs = get_sample_curriculum_practice_context("mod-1", "sit-1")
        self.assertEqual(mod["id"], "mod-1")
        self.assertEqual(sit["id"], "sit-1")
        self.assertEqual(mode, "interpersonal_speaking")
        self.assertGreater(len(objs), 0)

    def test_practice_context_raises_on_bad_module(self):
        with self.assertRaises(ValueError):
            get_sample_curriculum_practice_context("bad-module", "sit-1")


class TestMakeTestDepsAndApp(unittest.TestCase):

    def test_deps_creates_valid_route_deps(self):
        db = FakeDbBase()
        deps = make_test_deps(db)
        self.assertIs(deps.db, db)

    def test_full_route_integration(self):
        """Smoke test: register a blueprint and make a request."""
        db = FakeDbBase()
        org_id, mem_id, cls_id = db.seed_org_teacher_class()
        deps = make_test_deps(db)
        app = make_test_app(create_curriculum_admin_blueprint(deps))

        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["user"] = {"uid": "teacher-1"}
            resp = client.get(f"/api/teacher/classes/{cls_id}/curriculum/packages")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data["success"])
            self.assertEqual(len(data["packages"]), 1)


if __name__ == "__main__":
    unittest.main()
