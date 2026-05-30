"""Unit tests for backend/services/email_verification.py."""
from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from backend.services import email_verification as ev
from backend.tests.conftest import FakeDbBase, make_user


class FakeEvDb(FakeDbBase):
    """FakeDbBase already provides get_user + update_user."""


class StartVerificationTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeEvDb()
        self.db.users["u1"] = make_user(uid="u1", email="a@b.test")

    def test_generate_code_is_six_digits(self):
        for _ in range(50):
            code = ev.generate_code()
            self.assertRegex(code, r"^\d{6}$")

    def test_start_writes_pending_state(self):
        code = ev.start_verification(self.db, "u1")
        record = self.db.users["u1"]["email_verification"]
        self.assertEqual(record["status"], ev.STATUS_PENDING)
        self.assertEqual(record["attempts"], 0)
        self.assertEqual(record["resend_count"], 0)
        self.assertNotEqual(record["code_hash"], code)  # stored hashed, not plaintext
        self.assertEqual(record["code_hash"], ev.hash_code("u1", code))

    def test_is_pending(self):
        self.assertFalse(ev.is_pending(self.db.users["u1"]))
        ev.start_verification(self.db, "u1")
        self.assertTrue(ev.is_pending(self.db.users["u1"]))
        self.assertFalse(ev.is_pending({}))
        self.assertFalse(ev.is_pending(None))
