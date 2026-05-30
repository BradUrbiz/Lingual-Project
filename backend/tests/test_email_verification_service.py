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


class ConfirmTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeEvDb()
        self.db.users["u1"] = make_user(uid="u1", email="a@b.test")
        self.code = ev.start_verification(self.db, "u1")

    def test_correct_code_verifies_and_clears_hash(self):
        result = ev.confirm(self.db, "u1", self.code)
        self.assertTrue(result.ok)
        record = self.db.users["u1"]["email_verification"]
        self.assertEqual(record["status"], ev.STATUS_VERIFIED)
        self.assertIsNone(record["code_hash"])
        self.assertIn("verified_at", record)

    def test_wrong_code_increments_attempts(self):
        result = ev.confirm(self.db, "u1", "000000")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "invalid_code")
        self.assertEqual(self.db.users["u1"]["email_verification"]["attempts"], 1)

    def test_lockout_after_max_attempts(self):
        for _ in range(ev.MAX_ATTEMPTS):
            ev.confirm(self.db, "u1", "000000")
        result = ev.confirm(self.db, "u1", self.code)  # correct code, but locked
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "too_many_attempts")

    def test_expired_code(self):
        future = datetime.now(UTC) + timedelta(minutes=11)
        result = ev.confirm(self.db, "u1", self.code, now=future)
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "expired")

    def test_confirm_when_no_code_present(self):
        self.db.users["u2"] = make_user(uid="u2")
        result = ev.confirm(self.db, "u2", "123456")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "invalid_code")

    def test_confirm_is_idempotent_when_already_verified(self):
        ev.confirm(self.db, "u1", self.code)
        result = ev.confirm(self.db, "u1", "anything")
        self.assertTrue(result.ok)


class ResendTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeEvDb()
        self.db.users["u1"] = make_user(uid="u1", email="a@b.test")
        self.t0 = datetime(2026, 5, 31, 12, 0, 0, tzinfo=UTC)
        ev.start_verification(self.db, "u1", now=self.t0)

    def test_resend_within_cooldown_blocked(self):
        result = ev.resend(self.db, "u1", now=self.t0 + timedelta(seconds=30))
        self.assertFalse(result.allowed)
        self.assertGreater(result.cooldown_seconds, 0)

    def test_resend_after_cooldown_allowed_with_new_code(self):
        old_hash = self.db.users["u1"]["email_verification"]["code_hash"]
        result = ev.resend(self.db, "u1", now=self.t0 + timedelta(seconds=61))
        self.assertTrue(result.allowed)
        self.assertRegex(result.code, r"^\d{6}$")
        new_hash = self.db.users["u1"]["email_verification"]["code_hash"]
        self.assertNotEqual(new_hash, old_hash)
        self.assertEqual(self.db.users["u1"]["email_verification"]["resend_count"], 1)

    def test_resend_cap(self):
        t = self.t0
        for _ in range(ev.MAX_RESENDS):
            t = t + timedelta(seconds=61)
            self.assertTrue(ev.resend(self.db, "u1", now=t).allowed)
        t = t + timedelta(seconds=61)
        result = ev.resend(self.db, "u1", now=t)
        self.assertFalse(result.allowed)
