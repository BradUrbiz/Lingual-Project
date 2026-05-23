"""
Regression tests for LTI route tenancy and deep-link behavior.
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.routes.lti import create_lti_blueprint
from backend.tests.conftest import (
    FakeDbBase,
    make_assignment,
    make_class,
    make_membership,
    make_organization,
    make_test_app,
    make_test_deps,
    make_user,
)


class _AssignmentRef:
    def __init__(self, db: "FakeLtiRoutesDb", assignment_id: str):
        self._db = db
        self._assignment_id = assignment_id

    def update(self, updates: dict):
        assignment = self._db.assignments[self._assignment_id]
        for key, value in updates.items():
            if key == "updated_at":
                continue
            assignment[key] = value


class FakeLtiRoutesDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.lti_platforms: dict[str, dict] = {}
        self.lti_sessions: list[dict] = []
        self.canvas_connections: list[dict] = []
        self._membership_refs: dict[str, MagicMock] = {}

    def get_lti_platform_by_issuer(self, issuer: str):
        for platform in self.lti_platforms.values():
            if platform.get("issuer") == issuer:
                return dict(platform)
        return None

    def get_lti_platform_by_issuer_and_client_id(self, issuer: str, client_id: str):
        for platform in self.lti_platforms.values():
            if platform.get("issuer") == issuer and platform.get("client_id") == client_id:
                return dict(platform)
        return None

    def get_lti_platform_by_issuer_client_deployment(self, issuer: str, client_id: str, deployment_id: str):
        for platform in self.lti_platforms.values():
            if (
                platform.get("issuer") == issuer
                and platform.get("client_id") == client_id
                and platform.get("deployment_id") == deployment_id
            ):
                return dict(platform)
        return None

    def get_lti_platform_by_org(self, org_id: str):
        for platform in self.lti_platforms.values():
            if platform.get("org_id") == org_id:
                return dict(platform)
        return None

    def create_lti_platform(self, **kwargs):
        platform_id = self._next_id("plat")
        self.lti_platforms[platform_id] = {"id": platform_id, **kwargs}
        return platform_id

    def delete_lti_platform(self, platform_id: str):
        self.lti_platforms.pop(platform_id, None)

    def get_user_by_email(self, email: str):
        for user in self.users.values():
            if user.get("email") == email:
                return dict(user)
        return None

    def get_user_by_lti_identity(self, issuer: str, canvas_user_id: str, client_id: str = ""):
        key = f"{issuer}|{client_id}|{canvas_user_id}"
        for user in self.users.values():
            if key in user.get("lti_identity_keys", []):
                return dict(user)
        return None

    def get_user_memberships(self, uid: str):
        results = []
        for membership in self.memberships.values():
            if membership.get("uid") != uid or membership.get("status") not in {"active", "invited"}:
                continue
            org = self.organizations.get(membership.get("orgId", "")) or {}
            results.append({
                "id": membership["id"],
                "orgId": membership.get("orgId", ""),
                "orgName": org.get("name", ""),
                "roles": membership.get("roles", []),
                "status": membership.get("status", "active"),
                "primaryClassIds": membership.get("primaryClassIds", []),
            })
        return results

    def update_user(self, uid: str, updates: dict):
        self.users.setdefault(uid, {"uid": uid}).update(updates)

    def create_lti_session(self, **payload):
        self.lti_sessions.append(dict(payload))
        return f"lti-session-{len(self.lti_sessions)}"

    def create_canvas_connection(self, **payload):
        self.canvas_connections.append(dict(payload))
        return f"canvas-connection-{len(self.canvas_connections)}"

    def get_membership_ref(self, membership_id: str):
        if membership_id not in self._membership_refs:
            self._membership_refs[membership_id] = MagicMock()
        return self._membership_refs[membership_id]

    def get_assignment_ref(self, assignment_id: str):
        return _AssignmentRef(self, assignment_id)


def _platform(platform_id: str, *, org_id: str, client_id: str, deployment_id: str = "deployment-1"):
    return {
        "id": platform_id,
        "org_id": org_id,
        "issuer": "https://canvas.example.edu",
        "client_id": client_id,
        "deployment_id": deployment_id,
        "auth_login_url": "https://canvas.example.edu/api/lti/authorize_redirect",
        "auth_token_url": "https://canvas.example.edu/login/oauth2/token",
        "key_set_url": "https://canvas.example.edu/api/lti/security/jwks",
    }


class LtiRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeLtiRoutesDb()
        self.app = make_test_app(create_lti_blueprint(make_test_deps(self.db)))
        self.client = self.app.test_client()

    def _login(self, uid: str, membership_id: str):
        with self.client.session_transaction() as flask_session:
            flask_session["user"] = {
                "uid": uid,
                "email": f"{uid}@example.edu",
                "name": uid,
                "active_membership_id": membership_id,
            }

    def _seed_two_orgs(self):
        self.db.organizations["org-a"] = make_organization(org_id="org-a", name="Org A")
        self.db.organizations["org-b"] = make_organization(org_id="org-b", name="Org B")
        self.db.users["teacher-a"] = make_user(uid="teacher-a", email="teacher-a@example.edu")
        self.db.users["teacher-b"] = make_user(uid="teacher-b", email="teacher-b@example.edu")
        self.db.users["student-a"] = make_user(uid="student-a", email="student-a@example.edu")
        self.db.memberships["mem-teacher-a"] = make_membership(
            membership_id="mem-teacher-a",
            org_id="org-a",
            uid="teacher-a",
            roles=["teacher"],
        )
        self.db.memberships["mem-teacher-b"] = make_membership(
            membership_id="mem-teacher-b",
            org_id="org-b",
            uid="teacher-b",
            roles=["teacher"],
        )
        self.db.memberships["mem-student-a"] = make_membership(
            membership_id="mem-student-a",
            org_id="org-a",
            uid="student-a",
            roles=["student"],
        )
        self.db.classes["class-a"] = make_class(
            class_id="class-a",
            org_id="org-a",
            teacher_membership_ids=["mem-teacher-a"],
            canvas_course_id="course-a",
        )
        self.db.classes["class-b"] = make_class(
            class_id="class-b",
            org_id="org-b",
            teacher_membership_ids=["mem-teacher-b"],
            canvas_course_id="course-b",
        )
        self.db.assignments["asg-a"] = make_assignment(
            assignment_id="asg-a",
            org_id="org-a",
            class_id="class-a",
            title="Org A assignment",
        )
        self.db.assignments["asg-b"] = make_assignment(
            assignment_id="asg-b",
            org_id="org-b",
            class_id="class-b",
            title="Org B assignment",
        )
        self.db.lti_platforms["plat-a"] = _platform("plat-a", org_id="org-a", client_id="client-a")
        self.db.lti_platforms["plat-b"] = _platform("plat-b", org_id="org-b", client_id="client-b")

    @patch("pylti1p3.contrib.flask.FlaskMessageLaunch")
    def test_callback_redirects_using_lingual_assignment_custom_param(self, launch_cls):
        self._seed_two_orgs()
        launch = launch_cls.return_value
        launch.get_launch_data.return_value = {
            "iss": "https://canvas.example.edu",
            "aud": "client-a",
            "email": "student-a@example.edu",
            "sub": "canvas-student-a",
            "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "deployment-1",
            "https://purl.imsglobal.org/spec/lti/claim/roles": [
                "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
            ],
            "https://purl.imsglobal.org/spec/lti/claim/context": {"id": "course-a", "title": "Course A"},
            "https://purl.imsglobal.org/spec/lti/claim/custom": {"lingual_assignment_id": "asg-a"},
        }

        response = self.client.post("/lti/callback")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/app/assignments/asg-a")

    @patch("pylti1p3.contrib.flask.FlaskMessageLaunch")
    def test_deep_link_respond_rejects_assignment_outside_active_teacher_tenant(self, launch_cls):
        self._seed_two_orgs()
        self._login("teacher-a", "mem-teacher-a")
        deep_link = MagicMock()
        deep_link.output_response_form_html.return_value = "<form></form>"
        launch_cls.from_cache.return_value.get_deep_link.return_value = deep_link
        with self.client.session_transaction() as flask_session:
            flask_session["lti_deep_link"] = {
                "launch_id": "launch-1",
                "issuer": "https://canvas.example.edu",
                "client_id": "client-a",
                "deployment_id": "deployment-1",
                "canvas_course_id": "course-a",
                "roles": ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
            }

        response = self.client.post("/api/lti/deep-link/respond", json={"assignmentId": "asg-b"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["success"], False)

    def test_grade_config_get_requires_teacher_access(self):
        self._seed_two_orgs()
        self._login("student-a", "mem-student-a")

        response = self.client.get("/api/teacher/assignments/asg-a/grade-config")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["success"], False)

    def test_grade_config_post_rejects_assignment_outside_active_teacher_tenant(self):
        self._seed_two_orgs()
        self._login("teacher-a", "mem-teacher-a")

        response = self.client.post(
            "/api/teacher/assignments/asg-b/grade-config",
            json={"metric": "completion", "points": 10},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["success"], False)
        self.assertIsNone(self.db.assignments["asg-b"].get("grade_metric"))

    def test_link_account_creates_platform_membership_for_future_lti_matching(self):
        self._seed_two_orgs()
        self.db.users["local-user"] = make_user(uid="local-user", email="local@example.edu")
        self._login("local-user", "")
        with self.client.session_transaction() as flask_session:
            flask_session["lti_pending_link"] = {
                "issuer": "https://canvas.example.edu",
                "client_id": "client-a",
                "deployment_id": "deployment-1",
                "email": "different-canvas-email@example.edu",
                "canvas_user_id": "canvas-local-user",
                "roles": ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
                "canvas_course_id": "course-a",
                "canvas_course_title": "Course A",
            }

        response = self.client.post("/api/lti/link-account")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["success"], True)
        linked_user = self.db.users["local-user"]
        self.assertIn(
            "https://canvas.example.edu|client-a|canvas-local-user",
            linked_user.get("lti_identity_keys", []),
        )
        created_memberships = [
            membership
            for membership in self.db.memberships.values()
            if membership.get("uid") == "local-user" and membership.get("orgId") == "org-a"
        ]
        self.assertEqual(len(created_memberships), 1)
        self.assertIn("student", created_memberships[0].get("roles", []))


if __name__ == "__main__":
    unittest.main()
