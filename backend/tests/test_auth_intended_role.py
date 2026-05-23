"""
Tests for intended_role handling in POST /api/auth/verify.

Mirrors the fixture pattern from test_auth_routes.py.
"""

import unittest
from flask import session

from backend.route_deps import RouteDeps
from backend.routes.auth import create_auth_blueprint
from backend.tests.conftest import (
    FakeDbBase,
    make_test_app,
    make_user,
    passthrough_login_required,
)


# ---------------------------------------------------------------------------
# FakeAuthDb — extends FakeDbBase with auth-specific methods
# ---------------------------------------------------------------------------
class FakeAuthDb(FakeDbBase):
    """FakeDbBase + the methods auth.py calls."""

    def __init__(self):
        super().__init__()
        self.profile_updates: list[tuple] = []

    def get_or_create_user(self, uid, email, name):
        if uid not in self.users:
            self.users[uid] = make_user(uid=uid, name=name, email=email)
        return self.users[uid]

    def update_user_profile(self, uid, **kwargs):
        self.profile_updates.append((uid, kwargs))
        user = self.users.get(uid)
        if user:
            profile = user.setdefault("profile", {})
            for key, value in kwargs.items():
                if value is not None:
                    profile[key] = value

    def reset_assessment(self, uid):
        pass


# ---------------------------------------------------------------------------
# FakeFirebaseAuth — configurable per-test token map
# ---------------------------------------------------------------------------
class FakeFirebaseAuth:
    class InvalidIdTokenError(Exception):
        pass

    class ExpiredIdTokenError(Exception):
        pass

    def __init__(self):
        self._token_map: dict[str, dict] = {
            "new-user-token": {
                "uid": "new-uid",
                "email": "pat@school.edu",
                "name": "Pat",
            },
        }
        self._raise_on_verify: type[Exception] | None = None

    def verify_id_token(self, id_token):
        if self._raise_on_verify is not None:
            raise self._raise_on_verify()
        decoded = self._token_map.get(id_token)
        if decoded is None:
            raise self.InvalidIdTokenError()
        return dict(decoded)


# ---------------------------------------------------------------------------
# Helper — build app + deps wired for these tests
# ---------------------------------------------------------------------------
def _build_app(db=None, firebase_auth=None):
    db = db or FakeAuthDb()
    fa = firebase_auth or FakeFirebaseAuth()

    deps = RouteDeps(
        db=db,
        firebase_auth=fa,
        get_current_user_uid=lambda: (session.get("user") or {}).get("uid"),
        get_openai_client=lambda: None,
        get_assessment=lambda: {},
        compute_results=lambda *a, **kw: {},
        get_proficiency_description=lambda *a, **kw: {"level": "Novice Mid", "description": "Test description"},
        login_required=passthrough_login_required,
        get_user_proficiency_context=lambda: "",
        build_system_prompt=lambda _ctx: "",
        get_school_request_context=lambda: None,
        set_active_school_membership=lambda _mid: None,
        allowed_learning_locales={"ko-KR", "es-ES", "fr-FR"},
        allowed_minigame_types={"listening_quiz", "grammar_challenge"},
        supported_ui_languages={"en", "ko"},
    )

    bp = create_auth_blueprint(deps)
    app = make_test_app(bp)
    return app, db, fa


# ===========================================================================
# Test cases
# ===========================================================================


class VerifyAuthIntendedRoleTest(unittest.TestCase):

    def test_first_time_signup_persists_intended_role(self):
        """First-time user: intended_role='teacher' should be persisted with onboarding_state='role_selected'."""
        db = FakeAuthDb()
        # No memberships seeded — user looks first-time.
        app, db, fa = _build_app(db=db)
        client = app.test_client()

        resp = client.post(
            "/api/auth/verify",
            json={"idToken": "new-user-token", "intended_role": "teacher"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])

        # update_user_profile must have been called with both kwargs.
        onboarding_calls = [
            kw for uid, kw in db.profile_updates
            if kw.get("intended_role") == "teacher" and kw.get("onboarding_state") == "role_selected"
        ]
        self.assertTrue(
            len(onboarding_calls) >= 1,
            f"Expected update_user_profile to be called with intended_role='teacher' and "
            f"onboarding_state='role_selected'. Actual calls: {db.profile_updates}",
        )

    def test_existing_member_ignores_intended_role(self):
        """Existing active member: intended_role in POST body must NOT trigger onboarding profile update."""
        from backend.tests.conftest import make_membership, make_organization

        db = FakeAuthDb()
        # Seed an active membership for new-uid so the user already belongs to an org.
        org = make_organization(org_id="org-existing")
        db.organizations["org-existing"] = org
        mem = make_membership(membership_id="mem-existing", org_id="org-existing", uid="new-uid", roles=["teacher"], status="active")
        db.memberships["mem-existing"] = mem
        db.users["new-uid"] = make_user(uid="new-uid", name="Pat", email="pat@school.edu")

        app, db, fa = _build_app(db=db)
        client = app.test_client()

        resp = client.post(
            "/api/auth/verify",
            json={"idToken": "new-user-token", "intended_role": "student"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])

        # No call to update_user_profile should include intended_role.
        onboarding_calls = [
            kw for uid, kw in db.profile_updates
            if "intended_role" in kw
        ]
        self.assertEqual(
            len(onboarding_calls),
            0,
            f"Expected no update_user_profile calls with intended_role for existing member. "
            f"Actual calls: {db.profile_updates}",
        )

    def test_invalid_intended_role_returns_400(self):
        """An unrecognised intended_role value must be rejected with 400 before any DB write."""
        db = FakeAuthDb()
        app, db, fa = _build_app(db=db)
        client = app.test_client()

        resp = client.post(
            "/api/auth/verify",
            json={"idToken": "new-user-token", "intended_role": "superuser"},
        )
        self.assertEqual(resp.status_code, 400)
        body = resp.get_json()
        self.assertFalse(body.get("success"))
        self.assertIn("Invalid intended_role", body.get("error", ""))

        # Validation must happen before any onboarding DB write.
        onboarding_calls = [
            kw for uid, kw in db.profile_updates
            if "intended_role" in kw
        ]
        self.assertEqual(
            len(onboarding_calls),
            0,
            "update_user_profile should not be called when intended_role is invalid.",
        )


class BuildAuthUserPayloadTest(unittest.TestCase):
    def test_payload_includes_onboarding_fields(self):
        from backend.routes.auth import build_auth_user_payload

        ctx = {
            'memberships': [],
            'active_membership_id': None,
            'active_organization_id': None,
            'active_roles': [],
            'intended_role': 'teacher',
            'onboarding_state': 'role_selected',
            'requires_legacy_role_pick': False,
        }
        payload = build_auth_user_payload('uid-1', 'pat@school.edu', 'Pat', ctx)

        self.assertEqual(payload['intendedRole'], 'teacher')
        self.assertEqual(payload['onboardingState'], 'role_selected')
        self.assertEqual(payload['requiresLegacyRolePick'], False)

    def test_payload_handles_missing_fields(self):
        from backend.routes.auth import build_auth_user_payload

        ctx = {
            'memberships': [],
            'active_membership_id': None,
            'active_organization_id': None,
            'active_roles': [],
        }
        payload = build_auth_user_payload('uid-1', 'pat@school.edu', 'Pat', ctx)

        self.assertIsNone(payload['intendedRole'])
        self.assertIsNone(payload['onboardingState'])
        self.assertFalse(payload['requiresLegacyRolePick'])


if __name__ == "__main__":
    unittest.main()
