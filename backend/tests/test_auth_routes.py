"""
Tests for backend/routes/auth.py — auth, profile, language, and onboarding endpoints.

Uses FakeDbBase from conftest as the base, extended with the additional methods
that auth.py requires (get_or_create_user, update_user_profile, reset_assessment,
and Canvas enrollment helpers).
"""

import unittest
from copy import deepcopy

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
# FakeDb — extends FakeDbBase with auth-specific methods
# ---------------------------------------------------------------------------
class FakeAuthDb(FakeDbBase):
    """FakeDbBase + the methods auth.py calls that the base class lacks."""

    def __init__(self):
        super().__init__()
        self.profile_updates: list[tuple] = []
        self.assessment_resets: list[str] = []

    # -- auth.py calls --

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
        self.assessment_resets.append(uid)
        user = self.users.get(uid)
        if user:
            user["assessment"] = {
                "responses": {},
                "current_item_index": 0,
                "completed": False,
            }
            user["results"] = None


# ---------------------------------------------------------------------------
# Configurable FakeFirebaseAuth
# ---------------------------------------------------------------------------
class FakeFirebaseAuth:
    """Mock firebase_auth with configurable per-test behavior."""

    class InvalidIdTokenError(Exception):
        pass

    class ExpiredIdTokenError(Exception):
        pass

    def __init__(self):
        self._token_map: dict[str, dict] = {
            "valid-token": {
                "uid": "test-uid",
                "email": "test@example.com",
                "name": "Test User",
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
# Helper — build app + deps wired for auth tests
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


def _login_session(client):
    """Shortcut: verify with a valid token so the session is populated."""
    return client.post("/api/auth/verify", json={"idToken": "valid-token"})


# ===========================================================================
# Test cases
# ===========================================================================


class TestLogout(unittest.TestCase):
    """1. POST /api/auth/logout clears session."""

    def test_logout_clears_session(self):
        app, db, _ = _build_app()
        client = app.test_client()

        # First, log in to populate session
        _login_session(client)

        # Verify session has user data
        with client.session_transaction() as sess:
            self.assertIn("user", sess)

        # Logout
        resp = client.post("/api/auth/logout")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])

        # Session should be empty
        with client.session_transaction() as sess:
            self.assertNotIn("user", sess)


class TestVerifyAuth(unittest.TestCase):
    """2-5. POST /api/auth/verify — token validation."""

    def test_verify_with_valid_token(self):
        """2. Valid token returns user with uid, email, name, memberships and sets session."""
        app, db, _ = _build_app()
        client = app.test_client()

        resp = _login_session(client)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])

        user = data["user"]
        self.assertEqual(user["uid"], "test-uid")
        self.assertEqual(user["email"], "test@example.com")
        self.assertEqual(user["name"], "Test User")
        self.assertIn("memberships", user)

        # Session should contain user data
        with client.session_transaction() as sess:
            self.assertEqual(sess["user"]["uid"], "test-uid")
            self.assertEqual(sess["user"]["email"], "test@example.com")

    def test_verify_without_token(self):
        """3. Empty body → 400."""
        app, _, _ = _build_app()
        client = app.test_client()

        resp = client.post("/api/auth/verify", json={})
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("No token", data["error"])

    def test_verify_with_no_json_body(self):
        """3b. No JSON body at all → 400."""
        app, _, _ = _build_app()
        client = app.test_client()

        resp = client.post("/api/auth/verify", content_type="application/json", data="{}")
        self.assertEqual(resp.status_code, 400)

    def test_verify_with_invalid_token(self):
        """4. Invalid token → 401."""
        app, _, fa = _build_app()
        client = app.test_client()

        fa._raise_on_verify = FakeFirebaseAuth.InvalidIdTokenError
        resp = client.post("/api/auth/verify", json={"idToken": "bad-token"})
        self.assertEqual(resp.status_code, 401)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid token", data["error"])

    def test_verify_with_expired_token(self):
        """5. Expired token → 401."""
        app, _, fa = _build_app()
        client = app.test_client()

        fa._raise_on_verify = FakeFirebaseAuth.ExpiredIdTokenError
        resp = client.post("/api/auth/verify", json={"idToken": "expired-token"})
        self.assertEqual(resp.status_code, 401)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Token expired", data["error"])


class TestUserProfile(unittest.TestCase):
    """7-9. GET /api/user/profile."""

    def test_get_profile_unassessed(self):
        """7. User with no assessment → assessed=False."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(
            uid="test-uid",
            name="Test User",
            email="test@example.com",
            age=25,
        )
        # No 'results' and assessment not completed
        db.users["test-uid"]["assessment"] = {"completed": False}

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.get("/api/user/profile")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertFalse(data["assessed"])
        self.assertEqual(data["display_name"], "Test User")

    def test_get_profile_assessed(self):
        """8. User with completed assessment → proficiency data."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(
            uid="test-uid",
            name="Test User",
            email="test@example.com",
            age=25,
        )
        db.users["test-uid"]["assessment"] = {"completed": True}
        db.users["test-uid"]["results"] = {
            "global_stage": 3,
            "framework": "ACTFL",
            "proficiency_level": "Intermediate Low",
            "proficiency_description_en": "Can converse on familiar topics.",
            "actfl_level": "Intermediate Low",
            "actfl_description_en": "Can converse on familiar topics.",
            "domain_bands": {"personal": 3},
        }

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.get("/api/user/profile")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["assessed"])
        self.assertEqual(data["global_stage"], 3)
        self.assertEqual(data["framework"], "ACTFL")
        self.assertEqual(data["proficiency_level"], "Intermediate Low")
        self.assertEqual(data["domain_bands"], {"personal": 3})

    def test_get_profile_not_found(self):
        """9. Unknown uid → 404."""
        db = FakeAuthDb()
        # No user seeded — set session manually to avoid get_or_create_user

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "nonexistent-uid", "email": "x@x.com", "name": "X"}

        resp = client.get("/api/user/profile")
        self.assertEqual(resp.status_code, 404)
        data = resp.get_json()
        self.assertFalse(data["assessed"])
        self.assertIn("not found", data["message"].lower())


class TestUpdateProfile(unittest.TestCase):
    """10-11. POST /api/profile."""

    def test_update_profile(self):
        """10. Valid profile update → stored and returned."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, db, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        payload = {
            "displayName": "New Name",
            "age": 30,
            "gender": "female",
            "rigor": "moderate",
            "frequency": 3,
            "frequencyUnit": "per_week",
            "levelObjective": "conversational",
            "learningLocale": "fr-FR",
        }
        resp = client.post("/api/profile", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["profile"]["displayName"], "New Name")
        self.assertEqual(data["profile"]["age"], 30)
        self.assertEqual(data["profile"]["learningLocale"], "fr-FR")

        # update_user_profile should have been called
        self.assertTrue(len(db.profile_updates) > 0)
        # reset_assessment should be called since isEdit is not set (defaults to False)
        self.assertIn("test-uid", db.assessment_resets)

    def test_update_profile_with_invalid_locale(self):
        """11. Invalid learningLocale → 400."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.post("/api/profile", json={"learningLocale": "zz-ZZ"})
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid learning locale", data["error"])


class TestSetLanguage(unittest.TestCase):
    """12-13. POST /api/set-language."""

    def test_set_valid_language(self):
        """12. Valid language → session updated."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, db, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.post("/api/set-language", json={"language": "ko"})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["language"], "ko")

        # Session should have ui_language
        with client.session_transaction() as sess:
            self.assertEqual(sess["ui_language"], "ko")

        # update_user_profile should have been called with ui_language
        uid_updates = [(uid, kw) for uid, kw in db.profile_updates if uid == "test-uid"]
        self.assertTrue(any(kw.get("ui_language") == "ko" for _, kw in uid_updates))

    def test_set_invalid_language(self):
        """13. Invalid language → 400."""
        app, _, _ = _build_app()
        client = app.test_client()

        resp = client.post("/api/set-language", json={"language": "xx"})
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid language", data["error"])


class TestInitialOnboarding(unittest.TestCase):
    """14-15. POST /api/onboarding/initial."""

    def test_initial_onboarding(self):
        """14. Valid onboarding → saves locale + assessment_preference, resets assessment."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, db, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.post("/api/onboarding/initial", json={
            "learningLocale": "ko-KR",
            "assessmentPreference": "take",
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["learningLocale"], "ko-KR")
        self.assertEqual(data["assessmentPreference"], "take")

        # update_user_profile called with the right kwargs
        uid_updates = [(uid, kw) for uid, kw in db.profile_updates if uid == "test-uid"]
        self.assertTrue(any(
            kw.get("learning_locale") == "ko-KR" and kw.get("assessment_preference") == "take"
            for _, kw in uid_updates
        ))

        # Assessment reset
        self.assertIn("test-uid", db.assessment_resets)

    def test_initial_onboarding_with_invalid_assessment_preference(self):
        """15. Invalid assessmentPreference → 400."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.post("/api/onboarding/initial", json={
            "learningLocale": "ko-KR",
            "assessmentPreference": "invalid_value",
        })
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid assessment preference", data["error"])

    def test_initial_onboarding_with_invalid_locale(self):
        """Bonus: invalid learningLocale in onboarding → 400."""
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid")

        app, _, _ = _build_app(db=db)
        client = app.test_client()
        _login_session(client)

        resp = client.post("/api/onboarding/initial", json={
            "learningLocale": "zz-ZZ",
            "assessmentPreference": "take",
        })
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid learning locale", data["error"])


if __name__ == "__main__":
    unittest.main()
