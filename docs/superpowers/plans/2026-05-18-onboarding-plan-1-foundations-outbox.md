# Onboarding Plan 1 — Foundations + Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the auth contract and email outbox infrastructure that every subsequent onboarding plan depends on — without changing any visible user behavior.

**Architecture:** Two layers. (1) Add `intended_role` and `onboarding_state` to `users/{uid}/profile` and surface them through `/api/auth/verify`. (2) Stand up a Firestore `outbox_emails/` collection with a Python Cloud Function trigger that calls Resend. Wire exactly one template (`school_request_to_lingual`) to the existing school-request submission so the pipeline is validated end-to-end on real traffic before any other plan depends on it.

**Tech Stack:** Flask + Firebase Admin (backend), Firebase Functions for Python (Cloud Functions), Resend (transactional email), Jinja2 (email templating), React 19 + TypeScript (minimal frontend type updates only — no UI work in this plan).

**Spec reference:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` — sections 2, 5, plus the data-model and rollout sections.

**Out of scope for this plan** (covered in later plans):
- Signup page, role picker, login/signup split → Plan 2
- Admin wizard → Plan 3
- Teacher join flow → Plan 4
- Lingual admin panel → Plan 5
- Legacy migration script and modal → Plan 6
- All email templates except `school_request_to_lingual`

---

## Pre-flight operator setup (one-time, not engineer work)

These are required before the Cloud Function can actually send mail. The engineer can complete tasks 1–23 with `RESEND_API_KEY` unset; the function will fall back to dev-mode (logs the rendered email and marks the doc `sent_dev`).

1. Create a Resend account at https://resend.com.
2. Add and verify the `lingual.app` domain (SPF, DKIM, DMARC records via the Cloud DNS zone for `lingual.app`).
3. Generate an API key and store it in Google Secret Manager as `resend-api-key`.
4. Bind the secret to the Cloud Functions runtime (see Task 22 for the binding code).

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `database.py` | New fields on user profile + helpers + extend `resolve_user_school_context`; new `list_lingual_admin_emails`; outbox-collection name constant |
| Modify | `backend/routes/auth.py` | `/api/auth/verify` accepts `intended_role`; `build_auth_user_payload` returns new fields |
| Create | `backend/services/outbox.py` | `enqueue_outbox_email(...)` helper + `OutboxTemplate` enum |
| Modify | `backend/routes/school_requests.py` | On submission, enqueue `school_request_to_lingual` outbox email |
| Modify | `firestore.rules` | `outbox_emails/*` is service-account-only |
| Modify | `firestore.indexes.json` | Composite index on `outbox_emails` (status + scheduled_for) |
| Modify | `functions/main.py` | `send_outbox_email` Firestore trigger + scheduled retry; Jinja2 render + Resend client |
| Modify | `functions/requirements.txt` | Add `resend`, `jinja2`, `firebase-admin` |
| Create | `functions/templates/school_request_to_lingual.html.j2` | First email template |
| Create | `functions/templates/__init__.py` | Empty (package marker) |
| Modify | `frontend/src/api/auth.ts` | `verifyToken({ intendedRole })` accepts and forwards new param |
| Modify | `frontend/src/contexts/AuthProvider.tsx` (or wherever the user payload type lives) | Add `intendedRole`, `onboardingState`, `requiresLegacyRolePick` to user payload type |
| Create | `backend/tests/test_user_onboarding_fields.py` | Backend unit tests for new database helpers |
| Create | `backend/tests/test_auth_intended_role.py` | Route tests for `/api/auth/verify` |
| Create | `backend/tests/test_outbox_writer.py` | Tests for `enqueue_outbox_email` |
| Create | `backend/tests/test_school_request_outbox_integration.py` | Submission writes outbox doc |
| Create | `functions/tests/__init__.py` | Empty (package marker) |
| Create | `functions/tests/test_send_outbox_email.py` | Cloud Function tests (mocked Firestore + Resend) |
| Modify | `docs/school-integration/LIMITATIONS.md` | Note: v1 outbox only wires one template |
| Modify | `.env.example` | Document `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` |

---

## Task 1: Define onboarding-state constants and field metadata in database.py

**Files:**
- Modify: `database.py` (top of file, near other module-level constants)

**Why:** Centralize the allowed enum values so the auth route, the legacy detection helper, and tests all reference one source of truth. Failing the validation at this boundary keeps malformed values out of Firestore.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_user_onboarding_fields.py`:

```python
import pytest

import database


def test_intended_role_constants_are_exposed():
    assert database.INTENDED_ROLE_STUDENT == 'student'
    assert database.INTENDED_ROLE_TEACHER == 'teacher'
    assert database.INTENDED_ROLE_ADMIN == 'admin'
    assert database.ALLOWED_INTENDED_ROLES == frozenset({'student', 'teacher', 'admin'})


def test_onboarding_state_constants_are_exposed():
    expected = frozenset({
        'role_selected',
        'student_setup',
        'teacher_pending',
        'org_creation_pending',
        'awaiting_lingual',
        'complete',
    })
    assert database.ALLOWED_ONBOARDING_STATES == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: FAIL — `AttributeError: module 'database' has no attribute 'INTENDED_ROLE_STUDENT'`.

- [ ] **Step 3: Add the constants**

At the top of `database.py`, after the existing imports and module-level constants:

```python
INTENDED_ROLE_STUDENT = 'student'
INTENDED_ROLE_TEACHER = 'teacher'
INTENDED_ROLE_ADMIN = 'admin'
ALLOWED_INTENDED_ROLES = frozenset({
    INTENDED_ROLE_STUDENT,
    INTENDED_ROLE_TEACHER,
    INTENDED_ROLE_ADMIN,
})

ONBOARDING_STATE_ROLE_SELECTED = 'role_selected'
ONBOARDING_STATE_STUDENT_SETUP = 'student_setup'
ONBOARDING_STATE_TEACHER_PENDING = 'teacher_pending'
ONBOARDING_STATE_ORG_CREATION_PENDING = 'org_creation_pending'
ONBOARDING_STATE_AWAITING_LINGUAL = 'awaiting_lingual'
ONBOARDING_STATE_COMPLETE = 'complete'
ALLOWED_ONBOARDING_STATES = frozenset({
    ONBOARDING_STATE_ROLE_SELECTED,
    ONBOARDING_STATE_STUDENT_SETUP,
    ONBOARDING_STATE_TEACHER_PENDING,
    ONBOARDING_STATE_ORG_CREATION_PENDING,
    ONBOARDING_STATE_AWAITING_LINGUAL,
    ONBOARDING_STATE_COMPLETE,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_user_onboarding_fields.py
git commit -m "feat(onboarding): expose intended_role and onboarding_state enums"
```

---

## Task 2: Extend `update_user_profile` to accept onboarding fields

**Files:**
- Modify: `database.py:526` (existing `update_user_profile` function)
- Test: `backend/tests/test_user_onboarding_fields.py`

**Why:** Reuse the existing profile-writer so we don't introduce a parallel mutation path. Validate the enum at the boundary.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_user_onboarding_fields.py`:

```python
from unittest.mock import MagicMock, patch


@patch('database.get_user_ref')
def test_update_user_profile_writes_intended_role(mock_get_user_ref):
    profile_ref = MagicMock()
    mock_get_user_ref.return_value.collection.return_value.document.return_value = profile_ref

    database.update_user_profile('uid-1', intended_role='teacher')

    # The first positional arg to `set(..., merge=True)` is the update payload.
    args, kwargs = profile_ref.set.call_args
    assert args[0]['intended_role'] == 'teacher'
    assert kwargs == {'merge': True}


@patch('database.get_user_ref')
def test_update_user_profile_writes_onboarding_state(mock_get_user_ref):
    profile_ref = MagicMock()
    mock_get_user_ref.return_value.collection.return_value.document.return_value = profile_ref

    database.update_user_profile('uid-1', onboarding_state='role_selected')

    args, _ = profile_ref.set.call_args
    assert args[0]['onboarding_state'] == 'role_selected'


def test_update_user_profile_rejects_invalid_intended_role():
    with pytest.raises(ValueError, match='Invalid intended_role'):
        database.update_user_profile('uid-1', intended_role='superuser')


def test_update_user_profile_rejects_invalid_onboarding_state():
    with pytest.raises(ValueError, match='Invalid onboarding_state'):
        database.update_user_profile('uid-1', onboarding_state='not-a-state')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 4 new tests FAIL — `update_user_profile` does not accept these kwargs.

- [ ] **Step 3: Extend the function**

In `database.py`, locate the `update_user_profile` signature at line ~526 and add the new kwargs. Add them to the signature *before* the existing kwargs that have defaults, but as keyword-only with `=None`. Inside the function body, validate and add to the payload before the `set(..., merge=True)` call.

```python
def update_user_profile(
    uid,
    display_name=None,
    age=None,
    gender=None,
    # ... existing args unchanged ...
    intended_role=None,
    onboarding_state=None,
):
    # ... existing body ...

    if intended_role is not None:
        if intended_role not in ALLOWED_INTENDED_ROLES:
            raise ValueError(f"Invalid intended_role: {intended_role!r}")
        update_payload['intended_role'] = intended_role

    if onboarding_state is not None:
        if onboarding_state not in ALLOWED_ONBOARDING_STATES:
            raise ValueError(f"Invalid onboarding_state: {onboarding_state!r}")
        update_payload['onboarding_state'] = onboarding_state

    # ... existing set(..., merge=True) call ...
```

The exact variable name (`update_payload` above) must match what already exists in the function — read the current body first and reuse the same name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 6 tests pass total (2 from Task 1 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_user_onboarding_fields.py
git commit -m "feat(onboarding): write intended_role and onboarding_state via update_user_profile"
```

---

## Task 3: Add `is_legacy_user_needing_role_pick` helper

**Files:**
- Modify: `database.py` (add near `get_user`)
- Test: `backend/tests/test_user_onboarding_fields.py`

**Why:** Spec §7 defines a legacy user as having no `intended_role`, no `onboarding_state`, and no active memberships. Encapsulate this rule so callers (the auth route, the migration script, the modal) never recompute it inconsistently.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_user_onboarding_fields.py`:

```python
def test_legacy_user_with_no_role_and_no_memberships_needs_pick():
    user_doc = {'profile': {'display_name': 'Pat'}}
    memberships = []
    assert database.is_legacy_user_needing_role_pick(user_doc, memberships) is True


def test_user_with_intended_role_does_not_need_pick():
    user_doc = {'profile': {'intended_role': 'student'}}
    assert database.is_legacy_user_needing_role_pick(user_doc, []) is False


def test_user_with_onboarding_state_does_not_need_pick():
    user_doc = {'profile': {'onboarding_state': 'complete'}}
    assert database.is_legacy_user_needing_role_pick(user_doc, []) is False


def test_user_with_active_membership_does_not_need_pick():
    user_doc = {'profile': {}}
    memberships = [{'status': 'active', 'roles': ['teacher']}]
    assert database.is_legacy_user_needing_role_pick(user_doc, memberships) is False


def test_user_with_only_invited_membership_still_needs_pick():
    """`status='invited'` is not yet active; we count it as no membership."""
    user_doc = {'profile': {}}
    memberships = [{'status': 'invited', 'roles': ['teacher']}]
    assert database.is_legacy_user_needing_role_pick(user_doc, memberships) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 5 new tests FAIL — function does not exist.

- [ ] **Step 3: Implement the helper**

In `database.py`, after the constants block from Task 1:

```python
def is_legacy_user_needing_role_pick(user_doc, memberships):
    """Return True iff this user predates role-aware signup and has no usable role.

    Decision rule: profile lacks both `intended_role` and `onboarding_state`,
    AND the user has no `status='active'` memberships.
    """
    profile = (user_doc or {}).get('profile') or {}
    if profile.get('intended_role'):
        return False
    if profile.get('onboarding_state'):
        return False
    for membership in memberships or []:
        if (membership or {}).get('status') == 'active':
            return False
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 11 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_user_onboarding_fields.py
git commit -m "feat(onboarding): add is_legacy_user_needing_role_pick helper"
```

---

## Task 4: Extend `resolve_user_school_context` to surface new fields

**Files:**
- Modify: `database.py:794` (existing `resolve_user_school_context`)
- Test: `backend/tests/test_user_onboarding_fields.py`

**Why:** Auth payload assembly currently consumes `school_context`. Adding the new fields here means `build_auth_user_payload` can pass them through without a separate database read.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_user_onboarding_fields.py`:

```python
@patch('database.get_user')
@patch('database.get_user_memberships')
def test_resolve_school_context_includes_onboarding_fields(mock_memberships, mock_get_user):
    mock_get_user.return_value = {
        'profile': {'intended_role': 'teacher', 'onboarding_state': 'teacher_pending'},
    }
    mock_memberships.return_value = []

    ctx = database.resolve_user_school_context('uid-1')

    assert ctx['intended_role'] == 'teacher'
    assert ctx['onboarding_state'] == 'teacher_pending'
    assert ctx['requires_legacy_role_pick'] is False


@patch('database.get_user')
@patch('database.get_user_memberships')
def test_resolve_school_context_flags_legacy_user(mock_memberships, mock_get_user):
    mock_get_user.return_value = {'profile': {}}
    mock_memberships.return_value = []

    ctx = database.resolve_user_school_context('uid-1')

    assert ctx['intended_role'] is None
    assert ctx['onboarding_state'] is None
    assert ctx['requires_legacy_role_pick'] is True
```

(Adjust the patched names to whatever functions `resolve_user_school_context` actually calls — read the existing implementation at `database.py:794` first to confirm. The shape of the assertions stays the same.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 2 new tests FAIL.

- [ ] **Step 3: Extend the function**

In `database.py`, at the end of `resolve_user_school_context` — just before the final `return` statement — read the user profile once and add the three fields to the return dict:

```python
# Surface onboarding/role fields for role-aware routing on the frontend.
user_doc = get_user(uid) or {}
profile = user_doc.get('profile') or {}
result['intended_role'] = profile.get('intended_role')
result['onboarding_state'] = profile.get('onboarding_state')
result['requires_legacy_role_pick'] = is_legacy_user_needing_role_pick(
    user_doc, result.get('memberships') or []
)
```

(The local variable holding the return dict is named in the existing code — read line 794 onward and match the name. It is likely `result` or `school_context`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_user_onboarding_fields -v`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_user_onboarding_fields.py
git commit -m "feat(onboarding): include onboarding fields in school context resolution"
```

---

## Task 5: Modify `/api/auth/verify` to accept and persist `intended_role`

**Files:**
- Modify: `backend/routes/auth.py:28` (the `verify_auth` view)
- Test: `backend/tests/test_auth_intended_role.py` (new)

**Why:** Step 2 of the signup flow POSTs the role chosen in Step 1. We accept it on the first verify of a new user; we ignore it for users with existing active memberships.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_auth_intended_role.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

from main import app  # Flask app factory may be invoked at import; if not, adjust


class VerifyAuthIntendedRoleTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def _post(self, payload):
        return self.client.post('/api/auth/verify', json=payload)

    @patch('database.update_user_profile')
    @patch('database.get_or_create_user')
    @patch('database.resolve_user_school_context')
    @patch('database.set_user_last_active_membership')
    def test_first_time_signup_persists_intended_role(
        self, mock_set_active, mock_resolve, mock_get_or_create, mock_update
    ):
        mock_resolve.return_value = {
            'memberships': [],
            'active_membership': None,
            'active_membership_id': None,
            'active_organization_id': None,
            'active_roles': [],
            'intended_role': None,
            'onboarding_state': None,
            'requires_legacy_role_pick': False,
        }

        with patch('backend.routes.auth.RouteDeps') as _:
            # We need to invoke through the actual app deps. The simplest path
            # is to patch deps.firebase_auth.verify_id_token.
            with patch.object(
                app.extensions.get('route_deps').firebase_auth,
                'verify_id_token',
                return_value={'uid': 'new-uid', 'email': 'pat@school.edu', 'name': 'Pat'},
            ):
                resp = self._post({'idToken': 'fake', 'intended_role': 'teacher'})

        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        # First-time user: intended_role should have been written via update_user_profile.
        mock_update.assert_any_call('new-uid', intended_role='teacher', onboarding_state='role_selected')
```

This sketch assumes `main.py` exposes `app` and stores `RouteDeps` somewhere reachable. If the project uses a different injection pattern (read `main.py` and `backend/route_deps.py` first), adapt the patching strategy but keep the assertion shape identical.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_auth_intended_role -v`
Expected: FAIL — `update_user_profile` is never called with the new kwargs.

- [ ] **Step 3: Modify `verify_auth`**

In `backend/routes/auth.py`, inside `verify_auth`, after `deps.db.get_or_create_user(uid, email, name)` and before the school-context resolution:

```python
intended_role = data.get('intended_role')
if intended_role and intended_role not in {'student', 'teacher', 'admin'}:
    return jsonify({'success': False, 'error': 'Invalid intended_role'}), 400

if intended_role:
    # Persist only if the user has no active membership yet — existing memberships
    # always win over a signup-time role claim.
    existing_context = deps.db.resolve_user_school_context(uid)
    has_active_membership = any(
        (m or {}).get('status') == 'active'
        for m in (existing_context.get('memberships') or [])
    )
    if not has_active_membership:
        deps.db.update_user_profile(
            uid,
            intended_role=intended_role,
            onboarding_state='role_selected',
        )
```

Note: this calls `resolve_user_school_context` once before the existing call later in the function. That is acceptable for the first-time-write path; if you want to fold them into one call, refactor and adjust the test patch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_auth_intended_role -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_auth_intended_role.py
git commit -m "feat(auth): accept intended_role on /api/auth/verify"
```

---

## Task 6: Surface onboarding fields in `build_auth_user_payload`

**Files:**
- Modify: `backend/routes/auth.py:6` (`build_auth_user_payload`)
- Test: extend `backend/tests/test_auth_intended_role.py`

**Why:** Frontend needs these fields to route the user after Step 2 and to mount the legacy migration modal.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_auth_intended_role.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_auth_intended_role -v`
Expected: KeyError or AssertionError on `intendedRole`.

- [ ] **Step 3: Update `build_auth_user_payload`**

In `backend/routes/auth.py`:

```python
def build_auth_user_payload(uid, email, name, school_context):
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
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_auth_intended_role -v`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_auth_intended_role.py
git commit -m "feat(auth): expose intended_role and onboarding_state in /api/auth/verify response"
```

---

## Task 7: Define `OUTBOX_EMAILS_COLLECTION` and `OutboxTemplate` enum

**Files:**
- Create: `backend/services/outbox.py`
- Test: `backend/tests/test_outbox_writer.py` (new)

**Why:** Single source of truth for the collection name and the allowed template IDs. Importing strings everywhere creates drift; the enum makes it impossible.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_outbox_writer.py`:

```python
import unittest

from backend.services import outbox


class OutboxConstantsTest(unittest.TestCase):
    def test_collection_name(self):
        self.assertEqual(outbox.OUTBOX_EMAILS_COLLECTION, 'outbox_emails')

    def test_template_enum_includes_school_request_to_lingual(self):
        self.assertEqual(
            outbox.OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL.value,
            'school_request_to_lingual',
        )

    def test_template_enum_is_exhaustive_for_v1(self):
        # v1 only wires one template; later plans add more.
        self.assertEqual(
            {t.value for t in outbox.OutboxTemplate},
            {'school_request_to_lingual'},
        )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: ImportError — module does not exist.

- [ ] **Step 3: Create the module skeleton**

Create `backend/services/outbox.py`:

```python
"""Outbox writer for transactional emails.

Business code calls `enqueue_outbox_email(...)` to write a document into
`outbox_emails/`. A Cloud Function trigger picks the document up and sends
via Resend (see functions/main.py).

This module is intentionally narrow: render-time logic, retries, and
provider integration live in the Cloud Function, not here.
"""

from __future__ import annotations

from enum import Enum

OUTBOX_EMAILS_COLLECTION = 'outbox_emails'


class OutboxTemplate(str, Enum):
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/outbox.py backend/tests/test_outbox_writer.py
git commit -m "feat(outbox): scaffold outbox service with template enum"
```

---

## Task 8: Implement `enqueue_outbox_email`

**Files:**
- Modify: `backend/services/outbox.py`
- Test: extend `backend/tests/test_outbox_writer.py`

**Why:** Single helper that backend code uses. Validates recipient and template, builds the standard document shape, supports batching into a Firestore transaction (the spec calls this out as a transactionality invariant).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_outbox_writer.py`:

```python
from datetime import datetime
from unittest.mock import MagicMock

from backend.services.outbox import (
    OUTBOX_EMAILS_COLLECTION,
    OutboxTemplate,
    enqueue_outbox_email,
)


class EnqueueOutboxEmailTest(unittest.TestCase):
    def test_writes_doc_with_expected_shape(self):
        db = MagicMock()
        doc_ref = MagicMock()
        db.collection.return_value.document.return_value = doc_ref

        enqueue_outbox_email(
            db=db,
            recipient_email='admin@lingual.app',
            recipient_name='Pat',
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={'org_name': 'SF Friends School'},
            related_entity_type='school_request',
            related_entity_id='req-123',
            created_by_uid='uid-1',
        )

        db.collection.assert_called_once_with(OUTBOX_EMAILS_COLLECTION)
        args, _ = doc_ref.set.call_args
        payload = args[0]
        self.assertEqual(payload['recipient'], {'email': 'admin@lingual.app', 'name': 'Pat'})
        self.assertEqual(payload['template_id'], 'school_request_to_lingual')
        self.assertEqual(payload['template_data'], {'org_name': 'SF Friends School'})
        self.assertEqual(payload['status'], 'pending')
        self.assertEqual(payload['attempt_count'], 0)
        self.assertEqual(payload['related_entity'], {'type': 'school_request', 'id': 'req-123'})
        self.assertEqual(payload['created_by_uid'], 'uid-1')

    def test_rejects_invalid_recipient_email(self):
        db = MagicMock()
        with self.assertRaises(ValueError):
            enqueue_outbox_email(
                db=db,
                recipient_email='not-an-email',
                recipient_name=None,
                template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                template_data={},
            )

    def test_uses_transaction_when_provided(self):
        db = MagicMock()
        tx = MagicMock()
        doc_ref = MagicMock()
        db.collection.return_value.document.return_value = doc_ref

        enqueue_outbox_email(
            db=db,
            transaction=tx,
            recipient_email='admin@lingual.app',
            recipient_name='Pat',
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={},
        )

        tx.set.assert_called_once()
        doc_ref.set.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: 3 new tests FAIL — function does not exist.

- [ ] **Step 3: Implement the writer**

Append to `backend/services/outbox.py`:

```python
import re
from typing import Any

from google.cloud import firestore  # type: ignore


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def enqueue_outbox_email(
    *,
    db: Any,
    recipient_email: str,
    recipient_name: str | None,
    template: OutboxTemplate,
    template_data: dict[str, Any],
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
    created_by_uid: str | None = None,
    scheduled_for: Any | None = None,
    transaction: Any | None = None,
):
    """Write a `pending` outbox email document.

    Pass `transaction` to enqueue atomically with other Firestore writes.
    """
    if not _EMAIL_RE.match(recipient_email or ''):
        raise ValueError(f"Invalid recipient_email: {recipient_email!r}")
    if not isinstance(template_data, dict):
        raise ValueError("template_data must be a dict")

    doc_ref = db.collection(OUTBOX_EMAILS_COLLECTION).document()
    payload = {
        'recipient': {'email': recipient_email, 'name': recipient_name},
        'template_id': template.value,
        'template_data': template_data,
        'status': 'pending',
        'scheduled_for': scheduled_for or firestore.SERVER_TIMESTAMP,
        'attempt_count': 0,
        'created_at': firestore.SERVER_TIMESTAMP,
        'created_by_uid': created_by_uid,
    }
    if related_entity_type and related_entity_id:
        payload['related_entity'] = {
            'type': related_entity_type,
            'id': related_entity_id,
        }
    if transaction is not None:
        transaction.set(doc_ref, payload)
    else:
        doc_ref.set(payload)
    return doc_ref.id
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/outbox.py backend/tests/test_outbox_writer.py
git commit -m "feat(outbox): implement enqueue_outbox_email with transaction support"
```

---

## Task 9: Add `list_lingual_admin_emails` helper

**Files:**
- Modify: `database.py` (add near other membership helpers)
- Test: `backend/tests/test_outbox_writer.py` (extend)

**Why:** Submitting a school request emails every Lingual admin. Centralize the membership query rather than re-implementing it at the call site.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_outbox_writer.py`:

```python
from unittest.mock import patch, MagicMock

import database


class ListLingualAdminEmailsTest(unittest.TestCase):
    @patch('database.get_db')
    def test_returns_emails_of_active_lingual_admins(self, mock_get_db):
        db = MagicMock()
        mock_get_db.return_value = db
        # Two memberships, one active and one revoked. Both have role 'lingual_admin'.
        mem_query = MagicMock()
        mem_query.stream.return_value = [
            MagicMock(to_dict=lambda: {'uid': 'u1', 'status': 'active', 'roles': ['lingual_admin']}),
            MagicMock(to_dict=lambda: {'uid': 'u2', 'status': 'revoked', 'roles': ['lingual_admin']}),
        ]
        db.collection.return_value.where.return_value = mem_query

        # users collection lookups
        u1_snap = MagicMock(exists=True, to_dict=lambda: {'email': 'admin1@lingual.app'})
        u2_snap = MagicMock(exists=True, to_dict=lambda: {'email': 'admin2@lingual.app'})

        def get_user_by_uid(uid):
            return {'u1': u1_snap, 'u2': u2_snap}[uid]

        db.collection.return_value.document.side_effect = lambda uid: MagicMock(get=lambda: get_user_by_uid(uid))

        emails = database.list_lingual_admin_emails()
        self.assertEqual(emails, [{'uid': 'u1', 'email': 'admin1@lingual.app'}])
```

(This is illustrative; rewrite the mock plumbing to match the existing helpers in `database.py` — there are already functions like `get_user_memberships` you can reuse if cleaner.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: AttributeError — `database.list_lingual_admin_emails` does not exist.

- [ ] **Step 3: Implement the helper**

In `database.py`, near the existing membership helpers (after `get_user_memberships` around line 765):

```python
def list_lingual_admin_emails():
    """Return [{uid, email, name?}] for every user with an active `lingual_admin` membership.

    Used by outbox templates that fan out to vendor-side staff. Order is
    deterministic by uid to make tests stable.
    """
    db = get_db()
    membership_docs = (
        db.collection('memberships')
        .where('roles', 'array_contains', 'lingual_admin')
        .stream()
    )
    seen_uids = set()
    recipients = []
    for doc in membership_docs:
        data = doc.to_dict() or {}
        if data.get('status') != 'active':
            continue
        uid = data.get('uid')
        if not uid or uid in seen_uids:
            continue
        seen_uids.add(uid)
        user_snap = db.collection('users').document(uid).get()
        if not getattr(user_snap, 'exists', False):
            continue
        user = user_snap.to_dict() or {}
        email = user.get('email')
        if not email:
            continue
        recipients.append({
            'uid': uid,
            'email': email,
            'name': user.get('profile', {}).get('display_name') or user.get('name'),
        })
    recipients.sort(key=lambda r: r['uid'])
    return recipients
```

(If `db.collection('memberships')` is wrapped by a helper in the existing codebase, prefer that helper. The name shown is illustrative — read `database.py` lines 750–800 first.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_outbox_writer.py
git commit -m "feat(outbox): add list_lingual_admin_emails helper"
```

---

## Task 10: Update Firestore rules to lock down `outbox_emails`

**Files:**
- Modify: `firestore.rules`

**Why:** Outbox docs contain user emails and notification metadata. No client should read or write them; the backend (admin SDK) writes, and the Cloud Function (admin SDK) reads + updates.

- [ ] **Step 1: Add the rule block**

In `firestore.rules`, find the closing `}` of the `match /databases/{database}/documents { ... }` block and add this match block above it:

```
    match /outbox_emails/{emailId} {
      allow read, write: if false;  // service-account only (admin SDK bypasses)
    }
```

- [ ] **Step 2: Run the rules tests to verify nothing else broke**

Run: `make test-firebase`
Expected: PASS. (Requires Java; if unavailable locally, run in CI.)

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "chore(rules): deny client access to outbox_emails"
```

---

## Task 11: Add Firestore composite index for outbox retry sweep

**Files:**
- Modify: `firestore.indexes.json`

**Why:** The Cloud Function retry sweep queries for `status in {pending, failed}` AND `scheduled_for <= now`. Without an index, this query 5xx-fails at runtime — and there is a test (`backend/tests/test_firestore_indexes.py` per the recent `chore(firestore): add index manifest test`) that asserts queries the codebase performs have indexes.

- [ ] **Step 1: Add the index entry**

In `firestore.indexes.json`, add to the `indexes` array:

```json
{
  "collectionGroup": "outbox_emails",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "scheduled_for", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 2: Run the index manifest test (if present)**

Run: `python3 -m unittest backend.tests.test_firestore_indexes -v`
Expected: PASS (the test should now find this index).

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "chore(firestore): add composite index on outbox_emails(status, scheduled_for)"
```

---

## Task 12: Wire school-request submission to enqueue an outbox email

**Files:**
- Modify: `backend/routes/school_requests.py` (whichever function handles `POST /api/school-requests`)
- Test: `backend/tests/test_school_request_outbox_integration.py` (new)

**Why:** The spec calls out v1 as "one template wired end-to-end". This is that wiring. Existing request submission still works; we add the outbox enqueue inside the same transaction (or immediately after the doc is created).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_school_request_outbox_integration.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

from main import app


class SchoolRequestOutboxIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    @patch('backend.services.outbox.enqueue_outbox_email')
    @patch('database.list_lingual_admin_emails')
    def test_submission_enqueues_outbox_email_per_lingual_admin(
        self, mock_list_admins, mock_enqueue
    ):
        mock_list_admins.return_value = [
            {'uid': 'u1', 'email': 'admin1@lingual.app', 'name': 'Admin One'},
            {'uid': 'u2', 'email': 'admin2@lingual.app', 'name': 'Admin Two'},
        ]

        # Authenticate as some signed-in user — adapt to your existing test fixture.
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'requester-uid', 'email': 'pat@school.edu', 'name': 'Pat'}

        resp = self.client.post(
            '/api/school-requests',
            json={
                'organizationName': 'SF Friends School',
                'organizationType': 'private',
                'websiteUrl': 'https://sfschool.edu',
            },
        )

        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(mock_enqueue.call_count, 2)
        sent_emails = sorted(c.kwargs['recipient_email'] for c in mock_enqueue.call_args_list)
        self.assertEqual(sent_emails, ['admin1@lingual.app', 'admin2@lingual.app'])
        for c in mock_enqueue.call_args_list:
            self.assertEqual(c.kwargs['template'].value, 'school_request_to_lingual')
            self.assertIn('org_name', c.kwargs['template_data'])
            self.assertEqual(c.kwargs['related_entity_type'], 'school_request')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_school_request_outbox_integration -v`
Expected: FAIL — `enqueue_outbox_email` is not called.

- [ ] **Step 3: Wire the call**

In `backend/routes/school_requests.py`, locate the function handling `POST /api/school-requests`. After it creates the school request document (and has the resulting request ID + org name), add:

```python
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
from database import list_lingual_admin_emails

# ... after request_id = ... and org_name = ... ...

for admin in list_lingual_admin_emails():
    try:
        enqueue_outbox_email(
            db=deps.db.get_db(),  # adjust to however the route accesses the Firestore client
            recipient_email=admin['email'],
            recipient_name=admin.get('name'),
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={
                'org_name': org_name,
                'requester_name': requester_name,
                'requester_email': requester_email,
                'review_url': f"{deps.public_base_url}/app/lingual-admin/requests",
            },
            related_entity_type='school_request',
            related_entity_id=request_id,
            created_by_uid=requester_uid,
        )
    except Exception as exc:  # outbox enqueue must never fail the business call
        print(f"[outbox] failed to enqueue school_request_to_lingual: {exc}")
```

(The variable names `org_name`, `requester_name`, `requester_email`, `request_id`, `requester_uid` should be drawn from variables already present in the function — read the existing implementation and reuse them. `deps.public_base_url` may need to be added to `RouteDeps` if it isn't there; if so, hard-code `https://lingual.app` for now and TODO a real env-driven value in a follow-up — actually, *do not* TODO. If the env var doesn't exist, add `PUBLIC_BASE_URL` to `_validate_required_env` in `main.py` and consume it via `os.environ['PUBLIC_BASE_URL']` here.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_school_request_outbox_integration -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_outbox_integration.py main.py
git commit -m "feat(school-requests): enqueue outbox email on submission"
```

---

## Task 13: Add Resend and Jinja2 to functions/requirements.txt

**Files:**
- Modify: `functions/requirements.txt`

- [ ] **Step 1: Update the file**

Replace `functions/requirements.txt` with:

```
firebase_functions~=0.1.0
firebase-admin~=6.5
google-cloud-firestore~=2.18
resend~=2.0
Jinja2~=3.1
```

- [ ] **Step 2: Verify the dependency tree resolves**

Run from the repo root:
```bash
python3 -m venv /tmp/functions-venv
. /tmp/functions-venv/bin/activate
pip install -r functions/requirements.txt
deactivate
```
Expected: clean install, no version conflicts.

- [ ] **Step 3: Commit**

```bash
git add functions/requirements.txt
git commit -m "chore(functions): add resend + jinja2 + firebase-admin deps"
```

---

## Task 14: Create the first email template

**Files:**
- Create: `functions/templates/__init__.py`
- Create: `functions/templates/school_request_to_lingual.html.j2`

**Why:** Templates live next to the function that renders them. Jinja2 because both the template language and the runtime are already Python — no extra build step.

- [ ] **Step 1: Create the package marker**

Create `functions/templates/__init__.py` (empty file).

- [ ] **Step 2: Create the template**

Create `functions/templates/school_request_to_lingual.html.j2`:

```html
<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="font-size: 20px; margin: 0 0 16px;">New school registration request</h2>

    <p>A new school has submitted a registration request on Lingual.</p>

    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 6px 0; color: #555;">Organization</td><td style="padding: 6px 0;"><strong>{{ org_name }}</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #555;">Requester</td><td style="padding: 6px 0;">{{ requester_name }} &lt;{{ requester_email }}&gt;</td></tr>
    </table>

    <p style="margin: 24px 0;">
      <a href="{{ review_url }}" style="background: #111; color: #fff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Review request</a>
    </p>

    <p style="color: #888; font-size: 12px; margin-top: 32px;">
      You are receiving this because you are a Lingual administrator.
    </p>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add functions/templates/
git commit -m "feat(outbox): add school_request_to_lingual email template"
```

---

## Task 15: Implement the Resend client wrapper in functions

**Files:**
- Modify: `functions/main.py`
- Create: `functions/tests/__init__.py`
- Create: `functions/tests/test_send_outbox_email.py`

**Why:** Thin wrapper so we can mock Resend in tests and degrade gracefully in dev (`RESEND_API_KEY` unset → log and mark `sent_dev`).

- [ ] **Step 1: Create the tests package marker**

Create `functions/tests/__init__.py` (empty).

- [ ] **Step 2: Write the failing test**

Create `functions/tests/test_send_outbox_email.py`:

```python
import os
import unittest
from unittest.mock import MagicMock, patch


class ResendClientTest(unittest.TestCase):
    def test_send_in_dev_mode_returns_dev_sentinel(self):
        # Force dev mode: no API key in env.
        with patch.dict(os.environ, {}, clear=True):
            from functions.main import send_via_resend  # late import to pick up env

            result = send_via_resend(
                to_email='admin@lingual.app',
                to_name='Pat',
                subject='Test',
                html='<p>hi</p>',
            )
            self.assertEqual(result, {'mode': 'dev', 'message_id': None})

    def test_send_in_live_mode_calls_resend(self):
        with patch.dict(os.environ, {
            'RESEND_API_KEY': 'rk_test',
            'RESEND_FROM_ADDRESS': 'Lingual <noreply@lingual.app>',
        }):
            with patch('functions.main.resend') as mock_resend:
                mock_resend.Emails.send.return_value = {'id': 'msg_123'}
                from functions.main import send_via_resend

                result = send_via_resend(
                    to_email='admin@lingual.app',
                    to_name='Pat',
                    subject='Test',
                    html='<p>hi</p>',
                )
                self.assertEqual(result, {'mode': 'live', 'message_id': 'msg_123'})
                mock_resend.Emails.send.assert_called_once()
                payload = mock_resend.Emails.send.call_args[0][0]
                self.assertEqual(payload['to'], ['Pat <admin@lingual.app>'])
                self.assertEqual(payload['from'], 'Lingual <noreply@lingual.app>')
                self.assertEqual(payload['subject'], 'Test')
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: ImportError — `send_via_resend` is not defined yet.

- [ ] **Step 4: Implement the wrapper**

Replace the contents of `functions/main.py` with:

```python
"""Cloud Functions for Lingual transactional email."""

from __future__ import annotations

import os
from typing import Any, Optional

import resend
from firebase_admin import initialize_app
from firebase_functions import firestore_fn, scheduler_fn
from firebase_functions.options import set_global_options

set_global_options(max_instances=10)
initialize_app()

DEV_MODE_SENTINEL = {'mode': 'dev', 'message_id': None}


def _format_recipient(email: str, name: Optional[str]) -> str:
    if name:
        return f"{name} <{email}>"
    return email


def send_via_resend(
    *,
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
) -> dict[str, Any]:
    """Send via Resend, or return a dev sentinel if the API key is unset."""
    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        print(f"[resend:dev] would send to {to_email!r} subject={subject!r}")
        return DEV_MODE_SENTINEL

    resend.api_key = api_key
    from_address = os.environ.get('RESEND_FROM_ADDRESS', 'Lingual <noreply@lingual.app>')
    response = resend.Emails.send({
        'from': from_address,
        'to': [_format_recipient(to_email, to_name)],
        'subject': subject,
        'html': html,
    })
    return {'mode': 'live', 'message_id': response.get('id')}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add functions/main.py functions/tests/
git commit -m "feat(functions): add Resend client wrapper with dev-mode fallback"
```

---

## Task 16: Add template renderer and subject-line table

**Files:**
- Modify: `functions/main.py`
- Modify: `functions/tests/test_send_outbox_email.py`

**Why:** Each `template_id` resolves to (a) a Jinja2 file and (b) a subject-line builder. Keeping the table in one place makes adding the next template (in later plans) a one-line change.

- [ ] **Step 1: Write the failing test**

Append to `functions/tests/test_send_outbox_email.py`:

```python
class RenderTemplateTest(unittest.TestCase):
    def test_renders_school_request_to_lingual(self):
        from functions.main import render_template

        subject, html = render_template(
            'school_request_to_lingual',
            {
                'org_name': 'SF Friends School',
                'requester_name': 'Pat',
                'requester_email': 'pat@sfschool.edu',
                'review_url': 'https://lingual.app/app/lingual-admin/requests',
            },
        )

        self.assertEqual(subject, 'New school registration: SF Friends School')
        self.assertIn('SF Friends School', html)
        self.assertIn('https://lingual.app/app/lingual-admin/requests', html)

    def test_unknown_template_raises(self):
        from functions.main import render_template
        with self.assertRaises(KeyError):
            render_template('made_up_template', {})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: ImportError — `render_template` is not defined.

- [ ] **Step 3: Implement the renderer**

Append to `functions/main.py`:

```python
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATES_DIR = Path(__file__).parent / 'templates'
_JINJA_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(['html', 'j2']),
)

_TEMPLATE_SUBJECTS = {
    'school_request_to_lingual': lambda data: f"New school registration: {data['org_name']}",
}


def render_template(template_id: str, data: dict[str, Any]) -> tuple[str, str]:
    """Return (subject, html) for the given template_id + merge data."""
    if template_id not in _TEMPLATE_SUBJECTS:
        raise KeyError(f"Unknown template_id: {template_id!r}")
    template = _JINJA_ENV.get_template(f"{template_id}.html.j2")
    html = template.render(**data)
    subject = _TEMPLATE_SUBJECTS[template_id](data)
    return subject, html
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/main.py functions/tests/test_send_outbox_email.py
git commit -m "feat(functions): add Jinja2 template renderer with subject table"
```

---

## Task 17: Implement the `send_outbox_email` Firestore trigger

**Files:**
- Modify: `functions/main.py`
- Modify: `functions/tests/test_send_outbox_email.py`

**Why:** This is the core of the outbox pipeline. On document creation, render → send → update doc with `sent_at` + `resend_message_id` (or failure metadata).

- [ ] **Step 1: Write the failing test**

Append to `functions/tests/test_send_outbox_email.py`:

```python
from datetime import datetime, timezone


class SendOutboxEmailTriggerTest(unittest.TestCase):
    def _make_event(self, before, after):
        ev = MagicMock()
        ev.data = MagicMock()
        ev.data.after = MagicMock()
        ev.data.after.to_dict.return_value = after
        ev.data.after.reference = MagicMock()
        ev.params = {'emailId': 'em-1'}
        return ev

    @patch('functions.main.send_via_resend')
    @patch('functions.main.render_template')
    def test_pending_email_sends_and_updates_doc(self, mock_render, mock_send):
        mock_render.return_value = ('Subject', '<p>hi</p>')
        mock_send.return_value = {'mode': 'live', 'message_id': 'msg_999'}

        from functions.main import send_outbox_email

        ev = self._make_event(
            before=None,
            after={
                'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                'template_id': 'school_request_to_lingual',
                'template_data': {'org_name': 'X', 'requester_name': 'P', 'requester_email': 'p@x', 'review_url': 'https://x'},
                'status': 'pending',
                'attempt_count': 0,
                'scheduled_for': datetime(2025, 1, 1, tzinfo=timezone.utc),
            },
        )

        send_outbox_email(ev)

        # Final update should mark sent.
        update_calls = ev.data.after.reference.update.call_args_list
        statuses = [c.args[0]['status'] for c in update_calls]
        self.assertIn('sending', statuses)
        self.assertIn('sent', statuses)
        sent_call = next(c for c in update_calls if c.args[0]['status'] == 'sent')
        self.assertEqual(sent_call.args[0]['resend_message_id'], 'msg_999')

    @patch('functions.main.send_via_resend')
    @patch('functions.main.render_template')
    def test_resend_failure_marks_failed_with_retry_remaining(self, mock_render, mock_send):
        mock_render.return_value = ('Subject', '<p>hi</p>')
        mock_send.side_effect = RuntimeError('boom')

        from functions.main import send_outbox_email

        ev = self._make_event(
            before=None,
            after={
                'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                'template_id': 'school_request_to_lingual',
                'template_data': {'org_name': 'X', 'requester_name': 'P', 'requester_email': 'p@x', 'review_url': 'https://x'},
                'status': 'pending',
                'attempt_count': 2,
                'scheduled_for': datetime(2025, 1, 1, tzinfo=timezone.utc),
            },
        )

        send_outbox_email(ev)

        update_calls = ev.data.after.reference.update.call_args_list
        final = update_calls[-1].args[0]
        self.assertEqual(final['status'], 'failed')
        self.assertEqual(final['attempt_count'], 3)
        self.assertIn('boom', final['error'])

    @patch('functions.main.send_via_resend')
    def test_attempts_exhausted_marks_dead_letter(self, mock_send):
        mock_send.side_effect = RuntimeError('boom')

        from functions.main import send_outbox_email

        ev = self._make_event(
            before=None,
            after={
                'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                'template_id': 'school_request_to_lingual',
                'template_data': {'org_name': 'X', 'requester_name': 'P', 'requester_email': 'p@x', 'review_url': 'https://x'},
                'status': 'failed',
                'attempt_count': 4,  # next attempt would be 5
                'scheduled_for': datetime(2025, 1, 1, tzinfo=timezone.utc),
            },
        )

        send_outbox_email(ev)

        final_status = ev.data.after.reference.update.call_args_list[-1].args[0]['status']
        self.assertEqual(final_status, 'dead_letter')

    def test_already_sent_doc_is_skipped(self):
        from functions.main import send_outbox_email

        ev = self._make_event(
            before=None,
            after={
                'status': 'sent',
                'attempt_count': 1,
            },
        )
        send_outbox_email(ev)
        # No updates — already-sent docs are no-ops.
        ev.data.after.reference.update.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: ImportError — `send_outbox_email` is not defined.

- [ ] **Step 3: Implement the trigger**

Append to `functions/main.py`:

```python
MAX_ATTEMPTS = 5


@firestore_fn.on_document_written(document='outbox_emails/{emailId}')
def send_outbox_email(event):
    """Send pending outbox emails. Also handles retry of failed ones."""
    if event.data is None or event.data.after is None:
        return
    after = event.data.after.to_dict() or {}
    status = after.get('status')
    if status not in ('pending', 'failed'):
        return

    ref = event.data.after.reference
    attempt = int(after.get('attempt_count') or 0) + 1

    ref.update({
        'status': 'sending',
        'attempt_count': attempt,
        'last_attempt_at': firestore_fn.firestore.SERVER_TIMESTAMP,
    })

    try:
        subject, html = render_template(
            after['template_id'], after.get('template_data') or {}
        )
        recipient = after.get('recipient') or {}
        result = send_via_resend(
            to_email=recipient.get('email'),
            to_name=recipient.get('name'),
            subject=subject,
            html=html,
        )
    except Exception as exc:  # noqa: BLE001
        terminal = attempt >= MAX_ATTEMPTS
        ref.update({
            'status': 'dead_letter' if terminal else 'failed',
            'error': str(exc),
        })
        return

    if result.get('mode') == 'dev':
        ref.update({
            'status': 'sent_dev',
            'sent_at': firestore_fn.firestore.SERVER_TIMESTAMP,
        })
        return

    ref.update({
        'status': 'sent',
        'sent_at': firestore_fn.firestore.SERVER_TIMESTAMP,
        'resend_message_id': result.get('message_id'),
    })
```

Note: `firestore_fn.firestore.SERVER_TIMESTAMP` may need to be imported differently depending on the `firebase_functions` version. If the test asserts string equality on `SERVER_TIMESTAMP`, mock it. The functional intent is: write a sentinel that Firestore translates to server time on commit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/main.py functions/tests/test_send_outbox_email.py
git commit -m "feat(functions): implement send_outbox_email Firestore trigger"
```

---

## Task 18: Add scheduled retry sweep

**Files:**
- Modify: `functions/main.py`
- Modify: `functions/tests/test_send_outbox_email.py`

**Why:** The Firestore trigger only re-runs on document writes. Failed docs whose retry budget isn't exhausted need a periodic kick. Every 5 minutes, scan `status='failed'` with `attempt_count < MAX_ATTEMPTS` and `scheduled_for <= now`, and re-mark them `pending` (which re-triggers the on_document_written function).

- [ ] **Step 1: Write the failing test**

Append to `functions/tests/test_send_outbox_email.py`:

```python
class RetrySweepTest(unittest.TestCase):
    @patch('functions.main.firestore.client')
    def test_failed_docs_under_max_attempts_are_repromoted(self, mock_client):
        from functions.main import retry_outbox_sweep

        doc1 = MagicMock()
        doc1.to_dict.return_value = {'status': 'failed', 'attempt_count': 2}
        doc1.reference = MagicMock()

        doc2 = MagicMock()
        doc2.to_dict.return_value = {'status': 'failed', 'attempt_count': 5}
        doc2.reference = MagicMock()

        query = MagicMock()
        query.stream.return_value = [doc1, doc2]
        mock_client.return_value.collection.return_value.where.return_value.where.return_value = query

        retry_outbox_sweep(MagicMock())

        # doc1 is repromoted; doc2 is not (already at max).
        doc1.reference.update.assert_called_once()
        self.assertEqual(doc1.reference.update.call_args[0][0]['status'], 'pending')
        doc2.reference.update.assert_not_called()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: ImportError — `retry_outbox_sweep` does not exist.

- [ ] **Step 3: Implement the sweep**

Append to `functions/main.py`:

```python
from firebase_admin import firestore


@scheduler_fn.on_schedule(schedule='every 5 minutes')
def retry_outbox_sweep(event):
    """Promote retryable failed docs back to pending."""
    db = firestore.client()
    query = (
        db.collection('outbox_emails')
        .where('status', '==', 'failed')
        .where('attempt_count', '<', MAX_ATTEMPTS)
    )
    for doc in query.stream():
        doc.reference.update({'status': 'pending'})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/main.py functions/tests/test_send_outbox_email.py
git commit -m "feat(functions): add scheduled retry sweep for failed outbox emails"
```

---

## Task 19: Update frontend auth API client

**Files:**
- Modify: `frontend/src/api/auth.ts`

**Why:** When Plan 2 ships the signup page, it needs to be able to POST `intended_role`. We add the API surface now so Plan 2's UI work is purely additive.

- [ ] **Step 1: Read the current verifyToken function**

Open `frontend/src/api/auth.ts` and find the `verifyToken` function. It currently takes only the ID token. Note the exact return type.

- [ ] **Step 2: Extend the signature**

Modify `verifyToken` to accept an optional `intendedRole` second argument and POST it:

```typescript
export type IntendedRole = 'student' | 'teacher' | 'admin';

export async function verifyToken(
  idToken: string,
  options: { intendedRole?: IntendedRole } = {},
): Promise<VerifyTokenResponse> {
  const body: Record<string, unknown> = { idToken };
  if (options.intendedRole) {
    body.intended_role = options.intendedRole;
  }
  const response = await api.post('/auth/verify', body);
  return response.data;
}
```

If the current implementation does not declare `VerifyTokenResponse`, define it inline matching the backend payload — at minimum `success`, `user.uid`, `user.email`, `user.name`, `user.memberships`, `user.activeRoles`, plus the new `user.intendedRole`, `user.onboardingState`, `user.requiresLegacyRolePick`.

- [ ] **Step 3: Update the user type**

In whichever file defines the user payload type (likely `frontend/src/contexts/AuthProvider.tsx` or `frontend/src/types/auth.ts` — find it via grep for `activeRoles`), add:

```typescript
intendedRole: 'student' | 'teacher' | 'admin' | null;
onboardingState: string | null;
requiresLegacyRolePick: boolean;
```

- [ ] **Step 4: Run frontend type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS. If anything else relies on the old type and now fails, this is a Plan-2 problem — but no new code in this plan consumes the new fields, so existing call sites should continue to compile (TypeScript treats new optional fields as additive).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/auth.ts frontend/src/contexts/AuthProvider.tsx frontend/src/types/auth.ts
git commit -m "feat(frontend): accept intendedRole on verifyToken and surface new user fields"
```

(Adjust the staged paths to match whichever file you actually modified for the type.)

---

## Task 20: Document RESEND env vars and limitation

**Files:**
- Modify: `.env.example`
- Modify: `docs/school-integration/LIMITATIONS.md`

**Why:** Future engineers need to know what env vars exist and what hasn't been wired yet. Spec §5 explicitly notes the v1 outbox wires only one template.

- [ ] **Step 1: Add env var docs**

Append to `.env.example`:

```
# Resend (transactional email). Set in Cloud Functions runtime via Secret Manager.
# When unset, the outbox function logs the rendered email and marks docs 'sent_dev'.
RESEND_API_KEY=
RESEND_FROM_ADDRESS=Lingual <noreply@lingual.app>

# Public base URL used in email CTA links.
PUBLIC_BASE_URL=https://lingual.app
```

- [ ] **Step 2: Add a limitation entry**

Append to `docs/school-integration/LIMITATIONS.md` (in date order):

```markdown
## 2026-05-18 — Outbox email scope (v1)

The Firestore `outbox_emails/` collection and the `send_outbox_email` Cloud
Function are live, but only one template is wired end-to-end:
`school_request_to_lingual`. Other templates listed in the onboarding spec
(teacher join notifications, approval/decline emails, suspend/restore, reminders)
exist as enum values but have no rendering or business-side enqueue yet.

They are added in subsequent onboarding plans (Plans 3–6). Until then, the
relevant business actions complete normally but do not produce email.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/school-integration/LIMITATIONS.md
git commit -m "docs: document RESEND env vars and outbox v1 scope"
```

---

## Task 21: Smoke-test the full pipeline locally

**Files:** none (manual verification only)

**Why:** Confirm that the wiring between backend, Firestore, and Cloud Function actually works end-to-end before merging.

- [ ] **Step 1: Start the Firestore emulator**

Run: `firebase emulators:start --only firestore,functions`
Expected: emulator UI at http://localhost:4000.

- [ ] **Step 2: Start the backend pointing at the emulator**

In a second terminal:
```bash
export FIRESTORE_EMULATOR_HOST=localhost:8080
export GOOGLE_CLOUD_PROJECT=lingu-480600
export FLASK_ENV=development
export PORT=5001
python3 main.py
```

- [ ] **Step 3: Seed a Lingual admin user via the emulator**

Use the emulator UI to create:
- `users/test-lingual-admin` → `{ email: 'me@lingual.app', profile: { display_name: 'Me' } }`
- `memberships/test-mem` → `{ uid: 'test-lingual-admin', roles: ['lingual_admin'], status: 'active' }`

- [ ] **Step 4: Submit a school request via curl**

```bash
curl -X POST http://localhost:5001/api/school-requests \
  -H 'Content-Type: application/json' \
  -b 'session=<session-cookie-from-a-signed-in-user>' \
  -d '{"organizationName":"Smoke Test School","organizationType":"private","websiteUrl":"https://smoke.edu"}'
```

- [ ] **Step 5: Verify an outbox doc was written**

In the emulator UI, navigate to `outbox_emails/`. Expected: exactly one doc with `status='sent_dev'` (because `RESEND_API_KEY` is unset locally), `template_id='school_request_to_lingual'`, `recipient.email='me@lingual.app'`.

- [ ] **Step 6: Check function logs**

Inspect the Functions emulator logs. Expected line:
```
[resend:dev] would send to 'me@lingual.app' subject='New school registration: Smoke Test School'
```

- [ ] **Step 7: Commit smoke-test notes (if any)**

If you discovered anything that needs a fix-forward, commit the fix with message `fix(outbox): <what>` before declaring the plan done. Otherwise, no commit needed for this task.

---

## Self-review checklist

- [x] Every spec §2 (foundations) item is covered: `intended_role` and `onboarding_state` written via `update_user_profile` (Task 2); auth payload extended (Task 6); `requires_legacy_role_pick` flag computed (Tasks 3, 4) and surfaced (Task 6); intended-role POST accepted (Task 5).
- [x] Every spec §5 (outbox) item is covered: collection (Task 8), schema (Task 7), Firestore rules (Task 10), index (Task 11), business-side enqueue (Task 12), Cloud Function trigger (Task 17), retry sweep (Task 18), Resend integration with dev fallback (Task 15), one template wired (Task 14), template rendering (Task 16), env documentation (Task 20).
- [x] No placeholders: every code step contains exact code; no TBD/TODO except the explicit one (which is replaced inline with a concrete decision).
- [x] Type consistency: `OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL.value == 'school_request_to_lingual'` matches the template filename and the subject-lookup table key. `intendedRole`/`onboardingState`/`requiresLegacyRolePick` are camelCase in TypeScript and the JSON payload, snake_case in Python — verified consistent across Tasks 5, 6, 19.
- [x] Scope: each task is independently revertable. Tasks 1–4 can ship without Tasks 5+. Tasks 5–6 ship without consumer. Tasks 7–12 ship the backend outbox without the Cloud Function (docs just queue up). Tasks 13–18 ship the function. Tasks 19–20 are frontend/docs only.

## Deployment notes

Deploy in two waves to keep blast radius small:

**Wave A — backend + frontend types (Tasks 1–14, 19–20).** No behavior change visible to users: outbox docs queue up but the function isn't deployed yet, so nothing sends. Verify in production that `outbox_emails/` documents accumulate with `status='pending'`.

**Wave B — Cloud Function (Tasks 15–18).** Deploy with `firebase deploy --only functions`. Without `RESEND_API_KEY` in Secret Manager the function runs in dev mode (logs only). Once the operator setup is complete (top of this plan), bind the secret and the next document write will actually send.

If Wave B is ever rolled back, Wave A keeps working — docs just accumulate. No data is lost.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-onboarding-plan-1-foundations-outbox.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
