"""The login_required guard must block pending-verification sessions while
grandfathering legacy sessions that lack the email_verified key."""
import unittest

from flask import Flask, jsonify

import main


def _gate_app():
    app = Flask(__name__)
    app.secret_key = "test"

    @app.route("/protected")
    @main.login_required
    def protected():
        return jsonify({"ok": True})

    return app


class LoginRequiredGateTest(unittest.TestCase):
    def test_no_session_is_401(self):
        client = _gate_app().test_client()
        resp = client.get("/protected")
        self.assertEqual(resp.status_code, 401)

    def test_pending_session_is_403(self):
        app = _gate_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "u1", "email_verified": False}
        resp = client.get("/protected")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json()["error"], "email_verification_required")

    def test_verified_session_passes(self):
        app = _gate_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "u1", "email_verified": True}
        resp = client.get("/protected")
        self.assertEqual(resp.status_code, 200)

    def test_legacy_session_without_key_passes(self):
        app = _gate_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "u1"}  # no email_verified key
        resp = client.get("/protected")
        self.assertEqual(resp.status_code, 200)
