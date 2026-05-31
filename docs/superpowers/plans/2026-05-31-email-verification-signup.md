# Email Verification at Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require new email/password signups to verify their email with a 6-digit code before using the app; Google signups and existing accounts are unaffected.

**Architecture:** A self-grandfathering session flag drives a single guard in `login_required`. `verify_auth` starts verification only for brand-new accounts whose token isn't already provider-verified. Verification state lives in an `email_verification` map on the user doc; the code is emailed through the existing outbox → Cloud Function → Resend pipeline. The frontend shows a blocking `EmailVerificationGate` modal (mirrors `LegacyRoleMigrationModal`).

**Tech Stack:** Flask + Firestore + firebase_admin (backend), Jinja2 + Resend (Cloud Function email), React 19 + TypeScript + Vitest + testing-library (frontend). Backend tests use `unittest` with the `FakeDbBase`/`FakeFirebaseAuth` harness in `backend/tests/conftest.py`.

**Spec:** `docs/superpowers/specs/2026-05-31-email-verification-signup-design.md`

---

## File Structure

**Backend**
- `backend/services/email_verification.py` *(new)* — code gen/hash, `start_verification`, `confirm`, `resend`, `is_pending`, `send_verification_code_email`. Single responsibility: verification state + code lifecycle.
- `backend/services/outbox.py` *(modify)* — add `EMAIL_VERIFICATION_CODE` enum value.
- `backend/routes/auth.py` *(modify)* — `verify_auth` integration, two new endpoints, payload field.
- `main.py` *(modify)* — augment `login_required` with the pending-verification guard.
- `functions/main.py` *(modify)* — subject lambda for the new template.
- `functions/templates/email_verification_code.html.j2` *(new)* — the code email.
- `backend/tests/conftest.py` *(modify)* — add `update_user` to `FakeDbBase`.
- Tests *(new)*: `test_email_verification_service.py`, `test_login_required_gate.py`, `functions/tests/test_email_verification_template.py`; *(modify)* `test_auth_routes.py`.

**Frontend**
- `frontend/src/types/index.ts` *(modify)* — `emailVerificationRequired` on `User`.
- `frontend/src/api/auth.ts` *(modify)* — `confirmEmailVerification`, `resendEmailVerification`.
- `frontend/src/components/EmailVerificationGate.tsx` *(new)* — blocking gate modal.
- `frontend/src/contexts/AuthContext.tsx` *(modify)* — render the gate when the flag is set.
- Tests: `EmailVerificationGate.test.tsx` *(new)*, `auth.test.ts` *(modify)*.

**Docs**
- `docs/school-integration/LIMITATIONS.md`, `docs/school-integration/TASKS.md` *(modify)*.

**Branch:** all work happens in the worktree on branch `worktree-email-verification`. Commit after every task.

---

## Task 1: Outbox template + code email

**Files:**
- Modify: `backend/services/outbox.py` (the `OutboxTemplate` enum)
- Modify: `functions/main.py` (the `_TEMPLATE_SUBJECTS` dict)
- Create: `functions/templates/email_verification_code.html.j2`
- Test: `functions/tests/test_email_verification_template.py`

- [ ] **Step 1: Write the failing test**

Create `functions/tests/test_email_verification_template.py`:

```python
"""Template render test for the email verification code outbox template."""
from __future__ import annotations

import unittest
from unittest.mock import patch


class EmailVerificationTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_subject_is_generic(self):
        subject = self.main._TEMPLATE_SUBJECTS['email_verification_code']({'code': '123456'})
        self.assertEqual(subject, 'Verify your Lingual email')

    def test_html_contains_code_but_subject_does_not(self):
        subject = self.main._TEMPLATE_SUBJECTS['email_verification_code']({'code': '123456'})
        _, html = self.main.render_template(
            'email_verification_code',
            {'name': 'Jamie', 'code': '123456'},
        )
        self.assertIn('123456', html)
        self.assertIn('Jamie', html)
        self.assertNotIn('123456', subject)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest functions.tests.test_email_verification_template -v`
Expected: FAIL — `KeyError: 'email_verification_code'` (subject not registered).

- [ ] **Step 3: Add the enum value**

In `backend/services/outbox.py`, inside `class OutboxTemplate`, add after the Plan 5 entries:

```python
    # Email verification at signup (6-digit code)
    EMAIL_VERIFICATION_CODE = 'email_verification_code'
```

- [ ] **Step 4: Add the subject lambda**

In `functions/main.py`, add to the `_TEMPLATE_SUBJECTS` dict (before the closing brace):

```python
    # Email verification at signup
    'email_verification_code':
        lambda data: "Verify your Lingual email",
```

- [ ] **Step 5: Create the template**

Create `functions/templates/email_verification_code.html.j2`:

```html
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px;line-height:1.5;">
  <h1 style="margin:0 0 16px;font-size:22px;">Verify your email</h1>
  <p>Hi {{ name | e if name else 'there' }}, use this code to finish setting up your Lingual account:</p>
  <p style="margin:24px 0;">
    <span style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:700;background:#f4f4f5;border-radius:8px;padding:16px 24px;">{{ code | e }}</span>
  </p>
  <p style="color:#555;font-size:13px;">This code expires in 10 minutes.</p>
  <p style="color:#555;font-size:13px;">If you didn't sign up for Lingual, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="color:#888;font-size:12px;">Lingual — Teacher-designed practice, AI-executed at student scale.</p>
</body>
</html>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python3 -m unittest functions.tests.test_email_verification_template -v`
Expected: PASS (3 assertions).

- [ ] **Step 7: Commit**

```bash
git add backend/services/outbox.py functions/main.py functions/templates/email_verification_code.html.j2 functions/tests/test_email_verification_template.py
git commit -m "feat(email-verification): add code outbox template"
```

---

## Task 2: Add `update_user` to the test fake

**Files:**
- Modify: `backend/tests/conftest.py` (`FakeDbBase`)

The service writes verification state via `db.update_user(uid, {...})`. `FakeDbBase` lacks it. Add a fake that mimics Firestore `set(merge=True)` for our one-level-nested `email_verification` map.

- [ ] **Step 1: Add the method**

In `backend/tests/conftest.py`, inside `class FakeDbBase`, in the `-- Core CRUD --` section just after `get_user`, add:

```python
    def update_user(self, uid: str, updates: dict):
        """Mimic database.update_user (Firestore set(merge=True)).

        One-level deep-merge: a nested dict value merges into an existing
        nested dict (e.g. the email_verification map), matching how
        set(merge=True) treats nested maps. Everything else is assigned.
        """
        user = self.users.setdefault(uid, {})
        for key, value in (updates or {}).items():
            if isinstance(value, dict) and isinstance(user.get(key), dict):
                user[key].update(value)
            else:
                user[key] = value
        return uid
```

- [ ] **Step 2: Verify the suite still imports/passes**

Run: `python3 -m unittest backend.tests.test_auth_routes -v`
Expected: PASS (no behavior change yet; confirms conftest still loads).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(email-verification): add update_user to FakeDbBase"
```

---

## Task 3: Service — code generation, hashing, `start_verification`, `is_pending`

**Files:**
- Create: `backend/services/email_verification.py`
- Test: `backend/tests/test_email_verification_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_email_verification_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_email_verification_service -v`
Expected: FAIL — `ModuleNotFoundError: backend.services.email_verification`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/services/email_verification.py`:

```python
"""Email verification (6-digit code) at signup.

State lives in the `email_verification` map on the user doc. Reads/writes go
through the injected `db` (database module in prod, FakeDb in tests) so the
logic is unit-testable without Firestore. The outbox email is enqueued via the
real Firestore client (`database.get_db()`), matching the route convention.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

STATUS_PENDING = 'pending'
STATUS_VERIFIED = 'verified'

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_RESENDS = 5  # per pending verification window

_FIELD = 'email_verification'


def _now(now: datetime | None = None) -> datetime:
    return now or datetime.now(UTC)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def generate_code() -> str:
    """A 6-digit numeric code, 100000–999999 (no leading-zero ambiguity)."""
    return f"{secrets.randbelow(900000) + 100000}"


def hash_code(uid: str, code: str) -> str:
    pepper = os.environ.get('SECRET_KEY', '')
    return hashlib.sha256(f"{pepper}:{uid}:{code}".encode()).hexdigest()


def is_pending(user_doc) -> bool:
    return ((user_doc or {}).get(_FIELD) or {}).get('status') == STATUS_PENDING


def start_verification(db, uid: str, *, now: datetime | None = None) -> str:
    """Generate a fresh code, write pending state, return the plaintext code."""
    code = generate_code()
    ts = _now(now)
    db.update_user(uid, {_FIELD: {
        'status': STATUS_PENDING,
        'code_hash': hash_code(uid, code),
        'expires_at': (ts + CODE_TTL).isoformat(),
        'attempts': 0,
        'last_sent_at': ts.isoformat(),
        'resend_count': 0,
    }})
    return code
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_email_verification_service -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/email_verification.py backend/tests/test_email_verification_service.py
git commit -m "feat(email-verification): code gen, hashing, start_verification"
```

---

## Task 4: Service — `confirm`

**Files:**
- Modify: `backend/services/email_verification.py`
- Test: `backend/tests/test_email_verification_service.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_verification_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_email_verification_service.ConfirmTest -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'confirm'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/services/email_verification.py`:

```python
@dataclass
class ConfirmResult:
    ok: bool
    error: str | None = None


def confirm(db, uid: str, code: str, *, now: datetime | None = None) -> ConfirmResult:
    user = db.get_user(uid) or {}
    record = user.get(_FIELD) or {}

    if record.get('status') == STATUS_VERIFIED:
        return ConfirmResult(ok=True)  # idempotent

    code_hash = record.get('code_hash')
    if not code_hash:
        return ConfirmResult(ok=False, error='invalid_code')

    expires_at = _parse(record.get('expires_at'))
    if expires_at is None or _now(now) > expires_at:
        return ConfirmResult(ok=False, error='expired')

    attempts = record.get('attempts', 0)
    if attempts >= MAX_ATTEMPTS:
        return ConfirmResult(ok=False, error='too_many_attempts')

    if hash_code(uid, str(code).strip()) != code_hash:
        attempts += 1
        db.update_user(uid, {_FIELD: {'attempts': attempts}})
        if attempts >= MAX_ATTEMPTS:
            return ConfirmResult(ok=False, error='too_many_attempts')
        return ConfirmResult(ok=False, error='invalid_code')

    db.update_user(uid, {_FIELD: {
        'status': STATUS_VERIFIED,
        'verified_at': _now(now).isoformat(),
        'code_hash': None,
    }})
    return ConfirmResult(ok=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_email_verification_service -v`
Expected: PASS (all ConfirmTest + earlier tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/email_verification.py backend/tests/test_email_verification_service.py
git commit -m "feat(email-verification): confirm with attempt lockout + expiry"
```

---

## Task 5: Service — `resend`

**Files:**
- Modify: `backend/services/email_verification.py`
- Test: `backend/tests/test_email_verification_service.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_verification_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_email_verification_service.ResendTest -v`
Expected: FAIL — `AttributeError: ... 'resend'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/services/email_verification.py`:

```python
@dataclass
class ResendResult:
    allowed: bool
    code: str | None = None
    cooldown_seconds: int = 0


def resend(db, uid: str, *, now: datetime | None = None) -> ResendResult:
    ts = _now(now)
    user = db.get_user(uid) or {}
    record = user.get(_FIELD) or {}

    if record.get('status') == STATUS_VERIFIED:
        return ResendResult(allowed=False)

    last_sent = _parse(record.get('last_sent_at'))
    if last_sent is not None:
        elapsed = (ts - last_sent).total_seconds()
        if elapsed < RESEND_COOLDOWN.total_seconds():
            return ResendResult(
                allowed=False,
                cooldown_seconds=int(RESEND_COOLDOWN.total_seconds() - elapsed),
            )

    resend_count = record.get('resend_count', 0)
    if resend_count >= MAX_RESENDS:
        return ResendResult(allowed=False)

    code = generate_code()
    db.update_user(uid, {_FIELD: {
        'status': STATUS_PENDING,
        'code_hash': hash_code(uid, code),
        'expires_at': (ts + CODE_TTL).isoformat(),
        'attempts': 0,
        'last_sent_at': ts.isoformat(),
        'resend_count': resend_count + 1,
    }})
    return ResendResult(
        allowed=True,
        code=code,
        cooldown_seconds=int(RESEND_COOLDOWN.total_seconds()),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_email_verification_service -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/email_verification.py backend/tests/test_email_verification_service.py
git commit -m "feat(email-verification): resend with cooldown + cap"
```

---

## Task 6: Service — `send_verification_code_email`

**Files:**
- Modify: `backend/services/email_verification.py`
- Test: `backend/tests/test_email_verification_service.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_verification_service.py`:

```python
from unittest.mock import patch


class SendEmailTest(unittest.TestCase):
    def test_enqueues_with_template_and_code(self):
        captured = {}

        def fake_enqueue(**kwargs):
            captured.update(kwargs)
            return "outbox-1"

        with patch.object(ev, "enqueue_outbox_email", fake_enqueue):
            ev.send_verification_code_email("a@b.test", "Jamie", "123456", db=object())

        self.assertEqual(captured["recipient_email"], "a@b.test")
        self.assertEqual(captured["template"], ev.OutboxTemplate.EMAIL_VERIFICATION_CODE)
        self.assertEqual(captured["template_data"], {"name": "Jamie", "code": "123456"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_email_verification_service.SendEmailTest -v`
Expected: FAIL — `AttributeError: ... 'send_verification_code_email'` (and `enqueue_outbox_email` not imported).

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `backend/services/email_verification.py` (after the stdlib imports):

```python
import database
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
```

Append the function:

```python
def send_verification_code_email(recipient_email: str, recipient_name: str | None,
                                 code: str, *, db=None) -> None:
    """Enqueue the verification-code email via the outbox pipeline.

    Uses the real Firestore client by default (route convention). Callers wrap
    this in try/except so a delivery-layer failure never blocks verification.
    """
    enqueue_outbox_email(
        db=db if db is not None else database.get_db(),
        recipient_email=recipient_email,
        recipient_name=recipient_name,
        template=OutboxTemplate.EMAIL_VERIFICATION_CODE,
        template_data={'name': recipient_name or '', 'code': code},
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_email_verification_service -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/email_verification.py backend/tests/test_email_verification_service.py
git commit -m "feat(email-verification): outbox email helper"
```

---

## Task 7: Integrate into `verify_auth`

**Files:**
- Modify: `backend/routes/auth.py` (`build_auth_user_payload`, `verify_auth`, new helper)
- Test: `backend/tests/test_auth_routes.py`

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_auth_routes.py`, the `FakeFirebaseAuth._token_map` only has `valid-token`. Add tokens for the new cases and tests. First, extend the token map — replace the `_token_map` initializer in `FakeFirebaseAuth.__init__` with:

```python
        self._token_map: dict[str, dict] = {
            "valid-token": {
                "uid": "test-uid",
                "email": "test@example.com",
                "name": "Test User",
            },
            "new-password-token": {
                "uid": "new-pw-uid",
                "email": "newpw@example.com",
                "name": "New PW User",
                "email_verified": False,
            },
            "google-token": {
                "uid": "google-uid",
                "email": "g@example.com",
                "name": "Google User",
                "email_verified": True,
            },
        }
```

Then add a test class:

```python
class TestEmailVerificationGating(unittest.TestCase):
    """New email/password accounts get gated; Google + existing don't."""

    def test_new_password_account_is_pending(self):
        app, db, _ = _build_app()
        client = app.test_client()

        resp = client.post("/api/auth/verify", json={"idToken": "new-password-token"})
        self.assertEqual(resp.status_code, 200)
        user = resp.get_json()["user"]
        self.assertTrue(user["emailVerificationRequired"])

        record = db.users["new-pw-uid"]["email_verification"]
        self.assertEqual(record["status"], "pending")

        with client.session_transaction() as sess:
            self.assertFalse(sess["user"]["email_verified"])

    def test_new_google_account_is_not_pending(self):
        app, db, _ = _build_app()
        client = app.test_client()

        resp = client.post("/api/auth/verify", json={"idToken": "google-token"})
        self.assertEqual(resp.status_code, 200)
        user = resp.get_json()["user"]
        self.assertFalse(user["emailVerificationRequired"])
        self.assertNotIn("email_verification", db.users["google-uid"])

        with client.session_transaction() as sess:
            self.assertTrue(sess["user"]["email_verified"])

    def test_existing_account_not_regated(self):
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid", email="test@example.com")
        app, db, _ = _build_app(db=db)
        client = app.test_client()

        resp = _login_session(client)  # valid-token, existing user, no email_verified claim
        user = resp.get_json()["user"]
        self.assertFalse(user["emailVerificationRequired"])
        self.assertNotIn("email_verification", db.users["test-uid"])

    def test_returning_pending_account_is_regated(self):
        db = FakeAuthDb()
        db.users["test-uid"] = make_user(uid="test-uid", email="test@example.com")
        db.users["test-uid"]["email_verification"] = {"status": "pending"}
        app, db, _ = _build_app(db=db)
        client = app.test_client()

        resp = _login_session(client)
        self.assertTrue(resp.get_json()["user"]["emailVerificationRequired"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_auth_routes.TestEmailVerificationGating -v`
Expected: FAIL — `KeyError: 'emailVerificationRequired'` (payload lacks the field).

- [ ] **Step 3: Write the implementation**

In `backend/routes/auth.py`, add the import at the top (with the other backend imports):

```python
from backend.services import email_verification
```

Update `build_auth_user_payload` to accept and emit the flag — change its signature and add the field:

```python
def build_auth_user_payload(uid, email, name, school_context, email_verification_required=False):
    """Build the auth payload returned to the frontend."""
    return {
        'uid': uid,
        'email': email,
        'name': name,
        'memberships': school_context.get('memberships', []),
        'activeMembershipId': school_context.get('active_membership_id'),
        'activeOrganizationId': school_context.get('active_organization_id'),
        'activeRoles': school_context.get('active_roles', []),
        'intendedRole': school_context.get('intended_role'),
        'onboardingState': school_context.get('onboarding_state'),
        'requiresLegacyRolePick': bool(school_context.get('requires_legacy_role_pick')),
        'lingualAdmin': bool(school_context.get('lingual_admin')),
        'emailVerificationRequired': bool(email_verification_required),
    }
```

Add a module-level helper (near `build_auth_user_payload`):

```python
def _resolve_email_verification(deps, decoded_token, existing_user, uid, email, name):
    """Return True if this account must verify its email before using the app.

    Starts verification (and emails a code) only for brand-new accounts whose
    provider has not already verified the email — so Google (email_verified
    claim True) is auto-verified and existing accounts are never re-gated.
    """
    is_new_account = existing_user is None
    provider_verified = bool(decoded_token.get('email_verified'))

    if is_new_account and not provider_verified:
        try:
            code = email_verification.start_verification(deps.db, uid)
            email_verification.send_verification_code_email(email, name, code)
        except Exception as exc:  # delivery/start failure must not block signup
            print(f'[email-verification] start failed for {uid}: {exc}')
        return True

    return email_verification.is_pending(existing_user)
```

In `verify_auth`, replace:

```python
            deps.db.get_or_create_user(uid, email, name)
```

with:

```python
            existing_user = deps.db.get_user(uid)
            deps.db.get_or_create_user(uid, email, name)
            email_verification_required = _resolve_email_verification(
                deps, decoded_token, existing_user, uid, email, name,
            )
```

Then update the session write to include the flag — replace:

```python
            session['user'] = {
                'uid': uid,
                'email': email,
                'name': name,
                'active_membership_id': school_context.get('active_membership_id'),
            }
```

with:

```python
            session['user'] = {
                'uid': uid,
                'email': email,
                'name': name,
                'active_membership_id': school_context.get('active_membership_id'),
                'email_verified': not email_verification_required,
            }
```

And update the success return — replace:

```python
                'user': build_auth_user_payload(uid, email, name, school_context),
```

with:

```python
                'user': build_auth_user_payload(
                    uid, email, name, school_context, email_verification_required,
                ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_auth_routes -v`
Expected: PASS (existing tests + `TestEmailVerificationGating`). The email enqueue raises `OutboxBlockedInTestMode` inside the wrapped helper and is swallowed; state is still written.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_auth_routes.py
git commit -m "feat(email-verification): gate new password signups in verify_auth"
```

---

## Task 8: Resend + confirm endpoints

**Files:**
- Modify: `backend/routes/auth.py`
- Test: `backend/tests/test_auth_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_auth_routes.py`:

```python
class TestEmailVerificationEndpoints(unittest.TestCase):
    def _seed_pending(self, db, uid="test-uid"):
        from backend.services import email_verification
        db.users[uid] = make_user(uid=uid, email="test@example.com")
        return email_verification.start_verification(db, uid)

    def test_confirm_success_clears_gate(self):
        db = FakeAuthDb()
        code = self._seed_pending(db)
        app, db, _ = _build_app(db=db)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "test-uid", "email": "test@example.com",
                            "name": "T", "email_verified": False}

        resp = client.post("/api/auth/email-verification/confirm", json={"code": code})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json()["success"])
        with client.session_transaction() as sess:
            self.assertTrue(sess["user"]["email_verified"])

    def test_confirm_wrong_code(self):
        db = FakeAuthDb()
        self._seed_pending(db)
        app, db, _ = _build_app(db=db)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "test-uid", "email": "test@example.com",
                            "name": "T", "email_verified": False}

        resp = client.post("/api/auth/email-verification/confirm", json={"code": "000000"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_json()["error"], "invalid_code")

    def test_confirm_requires_session(self):
        app, _, _ = _build_app()
        client = app.test_client()
        resp = client.post("/api/auth/email-verification/confirm", json={"code": "123456"})
        self.assertEqual(resp.status_code, 401)

    def test_resend_returns_success(self):
        db = FakeAuthDb()
        self._seed_pending(db)
        app, db, _ = _build_app(db=db)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {"uid": "test-uid", "email": "test@example.com",
                            "name": "T", "email_verified": False}

        # Default start sets last_sent_at = now, so an immediate resend hits the
        # cooldown → 429. That's the deterministic behavior we assert.
        resp = client.post("/api/auth/email-verification/resend", json={})
        self.assertEqual(resp.status_code, 429)
        self.assertGreater(resp.get_json()["cooldownSeconds"], 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_auth_routes.TestEmailVerificationEndpoints -v`
Expected: FAIL — 404 (routes not registered yet).

- [ ] **Step 3: Write the implementation**

In `backend/routes/auth.py`, inside `create_auth_blueprint(deps)` (alongside the other `@bp.route` handlers), add:

```python
    @bp.route('/api/auth/email-verification/confirm', methods=['POST'])
    def confirm_email_verification():
        user = session.get('user')
        if not user or not user.get('uid'):
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        data = request.get_json(silent=True) or {}
        code = str(data.get('code', '')).strip()
        result = email_verification.confirm(deps.db, user['uid'], code)

        if not result.ok:
            return jsonify({'success': False, 'error': result.error}), 400

        try:
            deps.firebase_auth.update_user(user['uid'], email_verified=True)
        except Exception as exc:  # best-effort sync; Firestore is authoritative
            print(f"[email-verification] firebase sync failed for {user['uid']}: {exc}")

        session['user']['email_verified'] = True
        session.modified = True
        return jsonify({'success': True})

    @bp.route('/api/auth/email-verification/resend', methods=['POST'])
    def resend_email_verification():
        user = session.get('user')
        if not user or not user.get('uid'):
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        result = email_verification.resend(deps.db, user['uid'])
        if not result.allowed:
            return jsonify({
                'success': False,
                'error': 'cooldown',
                'cooldownSeconds': result.cooldown_seconds,
            }), 429

        try:
            email_verification.send_verification_code_email(
                user.get('email', ''), user.get('name'), result.code,
            )
        except Exception as exc:
            print(f"[email-verification] resend enqueue failed for {user['uid']}: {exc}")

        return jsonify({'success': True, 'cooldownSeconds': result.cooldown_seconds})
```

> Note: these handlers deliberately do **not** use `deps.login_required` — they must work while the session is still pending (Task 9 makes `login_required` reject pending sessions).

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_auth_routes -v`
Expected: PASS (all auth route tests).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_auth_routes.py
git commit -m "feat(email-verification): confirm + resend endpoints"
```

---

## Task 9: The `login_required` gate

**Files:**
- Modify: `main.py` (`login_required`)
- Test: `backend/tests/test_login_required_gate.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_login_required_gate.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_login_required_gate -v`
Expected: FAIL — `test_pending_session_is_403` returns 200 (guard not added yet).

- [ ] **Step 3: Write the implementation**

In `main.py`, replace the body of `login_required`:

```python
def login_required(f):
    """Decorator to require authentication for API routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = session.get('user')
        if not user:
            return jsonify({'error': 'Authentication required', 'success': False}), 401
        # `is False` only — legacy sessions (and Google) lack the key (None) and
        # must pass. Only sessions explicitly marked pending are blocked.
        if user.get('email_verified') is False:
            return jsonify({'error': 'email_verification_required', 'success': False}), 403
        return f(*args, **kwargs)
    return decorated_function
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_login_required_gate -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full backend auth-adjacent suite for regressions**

Run: `python3 -m unittest backend.tests.test_auth_routes backend.tests.test_email_verification_service backend.tests.test_login_required_gate -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add main.py backend/tests/test_login_required_gate.py
git commit -m "feat(email-verification): block pending sessions in login_required"
```

---

## Task 10: Frontend types + API client

**Files:**
- Modify: `frontend/src/types/index.ts` (`User`)
- Modify: `frontend/src/api/auth.ts`
- Test: `frontend/src/api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

In `frontend/src/api/auth.test.ts`, extend the existing import (line 2) to:

```typescript
import { migrateRole, confirmEmailVerification, resendEmailVerification } from './auth';
```

The file already has `vi.mock('./index')` and a `mockedApi` whose `post` is reset in `beforeEach` — reuse them. Append this describe block:

```typescript
describe('email verification api', () => {
  it('posts the code to confirm and returns the body', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true } });
    const res = await confirmEmailVerification('123456');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/auth/email-verification/confirm',
      { code: '123456' },
      { validateStatus: expect.any(Function) },
    );
    expect(res.success).toBe(true);
  });

  it('returns the body (does not throw) on a failure status', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: false, error: 'invalid_code' } });
    const res = await confirmEmailVerification('000000');
    expect(res.error).toBe('invalid_code');
  });

  it('posts to resend and returns cooldown', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, cooldownSeconds: 60 } });
    const res = await resendEmailVerification();
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/auth/email-verification/resend',
      {},
      { validateStatus: expect.any(Function) },
    );
    expect(res.cooldownSeconds).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/api/auth.test.ts`
Expected: FAIL — `confirmEmailVerification is not a function`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/types/index.ts`, add to the `User` interface (after `requiresLegacyRolePick`):

```typescript
  emailVerificationRequired?: boolean;
```

In `frontend/src/api/auth.ts`, append:

```typescript
export interface EmailVerificationResponse {
  success: boolean;
  error?: string;
  cooldownSeconds?: number;
}

// validateStatus: () => true so 400/429 resolve (with the body) instead of
// throwing — the gate component reads `success`/`error` uniformly.
export const confirmEmailVerification = async (
  code: string,
): Promise<EmailVerificationResponse> => {
  const response = await api.post<EmailVerificationResponse>(
    '/auth/email-verification/confirm',
    { code },
    { validateStatus: () => true },
  );
  return response.data;
};

export const resendEmailVerification = async (): Promise<EmailVerificationResponse> => {
  const response = await api.post<EmailVerificationResponse>(
    '/auth/email-verification/resend',
    {},
    { validateStatus: () => true },
  );
  return response.data;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/api/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/auth.ts frontend/src/api/auth.test.ts
git commit -m "feat(email-verification): frontend types + api client"
```

---

## Task 11: `EmailVerificationGate` component

**Files:**
- Create: `frontend/src/components/EmailVerificationGate.tsx`
- Test: `frontend/src/components/EmailVerificationGate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/EmailVerificationGate.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailVerificationGate } from './EmailVerificationGate';

const confirmMock = vi.fn();
const resendMock = vi.fn();

vi.mock('@/api/auth', () => ({
  confirmEmailVerification: (...a: unknown[]) => confirmMock(...a),
  resendEmailVerification: (...a: unknown[]) => resendMock(...a),
}));

describe('EmailVerificationGate', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    resendMock.mockReset();
  });

  it('shows the target email', () => {
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText(/a@b\.test/)).toBeInTheDocument();
  });

  it('calls onVerified after a correct code', async () => {
    confirmMock.mockResolvedValueOnce({ success: true });
    const onVerified = vi.fn();
    render(<EmailVerificationGate email="a@b.test" onVerified={onVerified} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith('123456');
      expect(onVerified).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error message on an invalid code', async () => {
    confirmMock.mockResolvedValueOnce({ success: false, error: 'invalid_code' });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/isn't right|not right/i);
    });
  });

  it('calls onSignOut from the escape link', () => {
    const onSignOut = vi.fn();
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('disables resend with a countdown after resending', async () => {
    resendMock.mockResolvedValueOnce({ success: true, cooldownSeconds: 60 });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resend/i })).toBeDisabled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/EmailVerificationGate.test.tsx`
Expected: FAIL — cannot resolve `./EmailVerificationGate`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/EmailVerificationGate.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { confirmEmailVerification, resendEmailVerification } from '@/api/auth';

export interface EmailVerificationGateProps {
  email: string;
  onVerified: () => Promise<void> | void;
  onSignOut: () => void;
}

const ERROR_COPY: Record<string, string> = {
  invalid_code: "That code isn't right. Check it and try again.",
  expired: 'That code expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
};

// Blocking modal — intentionally NO close button / escape / click-outside.
// New accounts MUST verify before using the app. Mirrors LegacyRoleMigrationModal.
export function EmailVerificationGate({ email, onVerified, onSignOut }: EmailVerificationGateProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleVerify = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await confirmEmailVerification(code.trim());
      if (result.success) {
        await onVerified();
        return;
      }
      setError(ERROR_COPY[result.error ?? ''] ?? 'Verification failed. Please try again.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [code, onVerified]);

  const handleResend = useCallback(async () => {
    setError(null);
    try {
      const result = await resendEmailVerification();
      setCooldown(result.cooldownSeconds ?? 60);
    } catch {
      setError('Could not resend the code. Please try again.');
    }
  }, []);

  return (
    <dialog open aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h2 className="text-xl font-semibold text-neutral-900">Verify your email</h2>
        <p className="mt-2 text-sm text-neutral-700">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to finish setting up your account.
        </p>

        <form onSubmit={handleVerify} className="mt-5 space-y-4">
          <div>
            <label htmlFor="ev-code" className="block text-sm font-medium text-neutral-900">
              Verification code
            </label>
            <input
              id="ev-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-lg tracking-widest"
              placeholder="123456"
            />
          </div>

          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || code.trim().length < 6}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            className="text-neutral-700 underline disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
          <button type="button" onClick={onSignOut} className="text-neutral-500 underline">
            Wrong email? Sign out
          </button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/EmailVerificationGate.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EmailVerificationGate.tsx frontend/src/components/EmailVerificationGate.test.tsx
git commit -m "feat(email-verification): EmailVerificationGate component"
```

---

## Task 12: Wire the gate into `AuthProvider`

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Test: `frontend/src/contexts/AuthContext.test.tsx`

- [ ] **Step 1: Write the failing test**

First extend the api mock factory in `frontend/src/contexts/AuthContext.test.tsx` (the `vi.mock('../api/auth', ...)` near the top) so the gate's imports resolve — change it to:

```typescript
vi.mock('../api/auth', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
  logout: vi.fn(),
  migrateRole: (...args: unknown[]) => migrateRoleMock(...args),
  confirmEmailVerification: vi.fn(),
  resendEmailVerification: vi.fn(),
}));
```

Then append a new describe block (it reuses `verifyTokenMock` and `firebaseAuthState`, which are already declared at the top of the file). This mirrors the existing "LegacyRoleMigrationModal mount" block:

```typescript
describe('AuthContext - EmailVerificationGate mount', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    firebaseAuthState.currentUser = null;
    localStorage.clear();
  });

  function CallSignInForGate() {
    const { signInWithEmail } = useAuth();
    const signedInRef = useRef(false);
    useEffect(() => {
      if (signedInRef.current) return;
      signedInRef.current = true;
      void signInWithEmail('pending@b.test', 'password123');
    }, [signInWithEmail]);
    return <div>ready</div>;
  }

  it('mounts the gate when emailVerificationRequired is true', async () => {
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: { uid: 'u1', email: 'pending@b.test', name: 'P', emailVerificationRequired: true },
    });
    firebaseAuthState.currentUser = { getIdToken: vi.fn().mockResolvedValue('id-token-pending') };

    render(
      <AuthProvider>
        <CallSignInForGate />
      </AuthProvider>,
    );

    await screen.findByText(/verify your email/i);
    expect(screen.getByText(/pending@b\.test/)).toBeInTheDocument();
  });

  it('does NOT mount the gate when the flag is false', async () => {
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: { uid: 'u1', email: 'a@b.test', name: 'A', emailVerificationRequired: false },
    });
    firebaseAuthState.currentUser = { getIdToken: vi.fn().mockResolvedValue('id-token-ok') };

    render(
      <AuthProvider>
        <CallSignInForGate />
      </AuthProvider>,
    );

    await screen.findByText('ready');
    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx`
Expected: FAIL — gate text not found (not wired yet).

- [ ] **Step 3: Write the implementation**

In `frontend/src/contexts/AuthContext.tsx`, add the import near the `LegacyRoleMigrationModal` import:

```typescript
import { EmailVerificationGate } from '@/components/EmailVerificationGate';
```

Replace the `AuthProvider` body so the gate takes precedence over the legacy role modal:

```tsx
export function AuthProvider({ children }: { children: ReactNode }) {
  const { value, user, handleLegacyRolePick } = useAuthProviderController();

  return (
    <AuthContext.Provider value={value}>
      {children}
      {user?.emailVerificationRequired ? (
        <EmailVerificationGate
          email={user.email}
          onVerified={value.refreshUser}
          onSignOut={value.logout}
        />
      ) : (
        user?.requiresLegacyRolePick && (
          <LegacyRoleMigrationModal onPicked={handleLegacyRolePick} />
        )
      )}
    </AuthContext.Provider>
  );
}
```

> `value.refreshUser` re-runs `/api/auth/verify`; once the account is verified the payload returns `emailVerificationRequired: false`, the gate unmounts, and the app renders. `value.logout` provides the "wrong email" escape.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the frontend lint + the touched tests**

Run: `cd frontend && npm run lint && npm run test -- --run src/components/EmailVerificationGate.test.tsx src/contexts/AuthContext.test.tsx src/api/auth.test.ts`
Expected: lint clean, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/contexts/AuthContext.test.tsx
git commit -m "feat(email-verification): render gate in AuthProvider"
```

---

## Task 13: Documentation

**Files:**
- Modify: `docs/school-integration/LIMITATIONS.md`
- Modify: `docs/school-integration/TASKS.md`

- [ ] **Step 1: Add a LIMITATIONS entry**

Append a new numbered entry to `docs/school-integration/LIMITATIONS.md` (use the next number in sequence):

```markdown
### NN. Email verification scope (shipped 2026-05-31)

New **email/password** signups must enter a 6-digit code (10-min TTL, 5-attempt
lockout, 60-s resend cooldown, max 5 resends) before using the app, enforced by a
single `login_required` guard on a session flag. **Google** signups are
auto-verified (provider asserts `email_verified`). **Existing accounts are
grandfathered** — the gate only triggers on accounts created after this shipped
(no `email_verification` field ⇒ not gated). LTI/Canvas-provisioned users never
hit the password-signup path, so they are exempt. The code email rides the
existing outbox → Cloud Function → Resend pipeline, so codes only deliver where
`RESEND_API_KEY` is configured. Out of scope: email-change re-verification, admin
force-resend, stale-pending cleanup, template i18n.
```

- [ ] **Step 2: Mark the TASKS item**

In `docs/school-integration/TASKS.md`, add (or check off, if an item exists) under the appropriate auth/onboarding phase:

```markdown
- [x] Email verification at signup — 6-digit code for new email/password accounts (Google auto-verified, existing grandfathered)
```

- [ ] **Step 3: Commit**

```bash
git add docs/school-integration/LIMITATIONS.md docs/school-integration/TASKS.md
git commit -m "docs(email-verification): LIMITATIONS + TASKS"
```

---

## Final Verification

- [ ] **Backend:** `python3 -m unittest backend.tests.test_email_verification_service backend.tests.test_auth_routes backend.tests.test_login_required_gate -v` → all PASS
- [ ] **Functions:** `python3 -m unittest functions.tests.test_email_verification_template -v` → PASS
- [ ] **Frontend:** `cd frontend && npm run test -- --run src/api/auth.test.ts src/components/EmailVerificationGate.test.tsx src/contexts/AuthContext.test.tsx` → all PASS
- [ ] **Full suites (regression):** `make test-backend` and `cd frontend && npm run test -- --run` → green
- [ ] **Lint:** `cd frontend && npm run lint` → clean
- [ ] Confirm no `email_verification` field is written for Google or existing accounts (covered by `TestEmailVerificationGating`).
