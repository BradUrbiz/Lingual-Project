# Onboarding Plan 3 — Admin Org Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/signup/admin/org-wizard` with a real 4-step school registration wizard that autosaves drafts, captures audit-grade attestation, queues approval/decline emails, and seeds pre-invited teachers — without touching teacher join flow (Plan 4) or the Lingual admin panel (Plan 5).

**Architecture:** Two cooperating layers. (1) Backend extends `school_requests` with a nested enriched payload, adds a transient `school_creation_drafts/{uid}` collection for autosave, and grows three new outbox templates (`school_request_approved`, `school_request_declined`, `teacher_invitation`). (2) Frontend replaces the placeholder page with a step-machine shell (`useReducer` at the shell level, URL-synchronized `?step=N`) plus four step components, a progress bar, a sidebar, and a pending page that polls `GET /api/school-requests/mine`.

**Tech Stack:** Flask + Firebase Admin (backend); Firebase Functions for Python + Jinja2 + Resend (Cloud Function emails); React 19 + TypeScript + Vitest + React Testing Library (frontend).

**Spec reference:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` — section 4 (Admin 4-Step Org Wizard) plus the relevant parts of sections 5 (outbox templates) and the data-model + API-surface summaries.

**Out of scope for this plan** (covered in later plans or already shipped):
- Auth contract, `intended_role`, `onboarding_state`, outbox infrastructure — shipped in Plan 1
- `/login` + `/signup` split, role picker, role-aware dispatcher, `AdminOrgWizardPlaceholderPage` route — shipped in Plan 2
- Teacher join (invite-code + search), Pending teacher requests UI — Plan 4
- Lingual admin panel rewrite (`/app/lingual-admin/*`), suspend/restore, audit log — Plan 5
- Legacy user backfill + role-pick modal — Plan 6
- Renaming `/api/admin/school-requests/...` to live under `/api/lingual-admin/...` — Plan 5
- Renaming the field `rejection_reason` to `decline_reason` — kept as `rejection_*` for codebase consistency; the spec's `decline_*` naming is goals-oriented (frontend can use "Declined" labels)

---

## Plan 3 contract input (what we rely on from Plans 1 + 2)

Anything in this list is already true on `pilot/launch-v1` and does not need to be implemented here.

**Backend:**
- `users/{uid}.profile.intended_role` is `'student' | 'teacher' | 'admin' | null` (`database.ALLOWED_INTENDED_ROLES`).
- `users/{uid}.profile.onboarding_state` accepts the values in `database.ALLOWED_ONBOARDING_STATES`, including `org_creation_pending`, `awaiting_lingual`, and `complete`.
- `database.update_user_profile(uid, intended_role=..., onboarding_state=...)` validates the enum at the boundary.
- `database.get_or_create_user(uid, email, name)` and `resolve_user_school_context(...)` populate the profile fields on `/api/auth/verify`.
- `database.list_lingual_admin_emails()` returns `[{ email, name }, ...]` for the UNION of `memberships.roles contains 'lingual_admin'` and legacy `users/{uid}.lingual_admin == True`.
- `backend.services.outbox.enqueue_outbox_email(...)` writes a `pending` doc and optionally inside a transaction. The `OutboxTemplate` enum currently has one member: `SCHOOL_REQUEST_TO_LINGUAL`.
- `backend/routes/school_requests.py` already submits the thin payload, fans out `SCHOOL_REQUEST_TO_LINGUAL` emails to every Lingual admin, and exposes a `_serialize_request(req)` helper (camelCase out).
- `database.create_school_request(requester_uid, requester_email, requester_name, school_name, org_type, website_url='', canvas_instance_url='')` is the current writer.
- `database.update_school_request(request_id, updates)` writes arbitrary update maps.

**Cloud Function:**
- `functions/main.py` exposes `_send_outbox_email_impl(event)` and a scheduled `_retry_outbox_sweep_impl(...)` (see codebase-conventions §7).
- `_TEMPLATE_SUBJECTS` is a `dict[str, Callable[[dict], str]]`.
- Templates live under `functions/templates/{template_id}.html.j2`.

**Frontend:**
- `/signup/admin/org-wizard` currently renders `AdminOrgWizardPlaceholderPage` (lazy import in `App.tsx`).
- `/school/setup` permanently redirects to `/signup/admin/org-wizard`.
- The signup flow (`SignupPage` → role pick → account creation) lands an admin user with `intendedRole='admin'`, `onboardingState='role_selected'`, no memberships.
- `frontend/src/api/schoolRequests.ts` exports `submitSchoolRequest`, `getMySchoolRequest`, `listSchoolRequests`, `approveSchoolRequest`, `rejectSchoolRequest`.
- Provider stack: `AuthProvider → MembershipProvider → LanguageProvider → LearningLocaleProvider`.

If any of the above is not true on the branch when execution begins, stop and reconcile before continuing.

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `database.py` | Wizard enum constants; rich `create_school_request` payload; `cancel_school_request`; draft collection helpers; `hash_attestation_ip` helper; `record_school_request_pre_invites` helper |
| Modify | `backend/services/outbox.py` | Add 3 new `OutboxTemplate` enum members |
| Modify | `backend/routes/school_requests.py` | Extend submission with enriched payload + draft cleanup; add draft GET/PATCH; add DELETE /mine cancel; extend approve to enqueue `school_request_approved` + create pre-invite teacher_invitations + enqueue `teacher_invitation` per pre-invite; extend reject to enqueue `school_request_declined` and accept a category |
| Create | `functions/templates/school_request_approved.html.j2` | "Your school is now on Lingual" |
| Create | `functions/templates/school_request_declined.html.j2` | "Your school registration needs more info" |
| Create | `functions/templates/teacher_invitation.html.j2` | Pre-invite teacher notification |
| Modify | `functions/main.py` | Three new entries in `_TEMPLATE_SUBJECTS` |
| Modify | `firestore.rules` | `school_creation_drafts/{uid}` is owner-only read/write |
| Modify | `frontend/src/types/index.ts` (or new `frontend/src/types/schoolRequest.ts`) | `WizardPayload`, `WizardDraft`, expanded `SchoolRequest` type |
| Modify | `frontend/src/api/schoolRequests.ts` | Wizard-shaped `submitSchoolRequest`; new `getSchoolRequestDraft`, `saveSchoolRequestDraft`, `cancelMySchoolRequest`; expand `SchoolRequest` shape; accept optional `category` on `rejectSchoolRequest` |
| Create | `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.tsx` | Wizard shell — `useReducer`, URL `?step=N` sync, draft load, autosave |
| Create | `frontend/src/pages/AdminOrgWizard/wizardReducer.ts` | Pure reducer + initial state + action types |
| Create | `frontend/src/pages/AdminOrgWizard/WizardProgress.tsx` | Top progress dots |
| Create | `frontend/src/pages/AdminOrgWizard/WizardSidebar.tsx` | Left sidebar listing the four steps |
| Create | `frontend/src/pages/AdminOrgWizard/WizardField.tsx` | Reusable labeled-field wrapper (label, error, helper, required marker) |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.tsx` | Step 1 form |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.tsx` | Step 2 form + attestation |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.tsx` | Step 3 form (skippable) |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep4Review.tsx` | Step 4 review + pre-invite chip input + submit |
| Create | `frontend/src/pages/AdminPendingPage.tsx` | "Awaiting Lingual approval" status + polling |
| Modify | `frontend/src/App.tsx` | Replace placeholder import with real `AdminOrgWizardPage`; add `/signup/admin/pending` route; remove now-orphaned `AdminOrgWizardPlaceholderPage` import |
| Delete | `frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx` | Replaced by `AdminOrgWizardPage` |
| Delete | `frontend/src/pages/SchoolOnboardingPage.tsx` | Dead code (see spec §4 footprint) |
| Delete | `frontend/src/pages/SchoolRequestPage.tsx` | Replaced by wizard (verify it has no live route or import first) |
| Create | `backend/tests/test_school_creation_drafts.py` | Draft helper tests |
| Create | `backend/tests/test_school_request_enriched_submission.py` | Submission route tests for the enriched payload |
| Create | `backend/tests/test_school_request_decision_outbox.py` | Approve + reject route tests (outbox enqueues, pre-invite teacher_invitations, idempotency) |
| Create | `functions/tests/test_school_request_decision_templates.py` | Template-render tests for the 3 new templates |
| Create | `frontend/src/pages/AdminOrgWizard/wizardReducer.test.ts` | Pure reducer tests |
| Create | `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx` | Shell behavior (draft load, autosave debounce, navigation, URL sync) |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx` | Validation + onChange tests |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx` | Attestation enforcement |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx` | Skippability + Canvas conditional |
| Create | `frontend/src/pages/AdminOrgWizard/WizardStep4Review.test.tsx` | Pre-invite chip input + submit |
| Create | `frontend/src/pages/AdminPendingPage.test.tsx` | Polling + status transitions |
| Modify | `docs/school-integration/TASKS.md` | Tick the wizard items |
| Modify | `docs/school-integration/LIMITATIONS.md` | Note draft TTL is "until submit/cancel"; pre-invite email send is best-effort |

The `AdminOrgWizard/` directory lets every wizard piece live together; the existing convention for grouped page modules already exists under `frontend/src/components/` and a couple of pages.

---

## Pre-flight (no engineer action needed)

`RESEND_API_KEY` and `RESEND_FROM_ADDRESS` are already configured from Plan 1. The new templates rely on the same Cloud Function pipeline. When `RESEND_API_KEY` is unset (local dev), the trigger logs the rendered email and marks docs `sent_dev` — unchanged.

---

## Task 1: Wizard enum constants in `database.py`

**Files:**
- Modify: `database.py` (top of file, alongside `ALLOWED_INTENDED_ROLES` from Plan 1)
- Test: `backend/tests/test_school_creation_drafts.py` (new)

**Why:** Centralize the wizard's enum values so the route, validator, and tests share one source of truth. Failing validation at this boundary keeps malformed values out of Firestore.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_school_creation_drafts.py`:

```python
import unittest

import database


class WizardEnumConstantsTest(unittest.TestCase):
    def test_school_type_values(self):
        self.assertEqual(database.ALLOWED_SCHOOL_TYPES, frozenset({
            'middle', 'high', 'k12', 'university',
            'language_academy', 'district', 'other',
        }))

    def test_public_private_values(self):
        self.assertEqual(database.ALLOWED_PUBLIC_PRIVATE, frozenset({
            'public', 'private', 'charter', 'other',
        }))

    def test_grade_size_values(self):
        self.assertEqual(database.ALLOWED_GRADE_SIZES, frozenset({
            '<50', '50-100', '100-200', '200-500', '500+',
        }))

    def test_canvas_integration_types(self):
        self.assertEqual(database.ALLOWED_CANVAS_INTEGRATION_TYPES, frozenset({
            'lti13', 'roster_sync', 'grade_passback', 'sso',
        }))

    def test_grade_ranges(self):
        self.assertEqual(database.ALLOWED_GRADE_RANGES, frozenset({
            'k_2', 'g3_5', 'g6_8', 'g9_12', 'undergrad', 'graduate', 'adult_ed',
        }))

    def test_course_frameworks(self):
        self.assertEqual(database.ALLOWED_COURSE_FRAMEWORKS, frozenset({
            'ap', 'actfl', 'cefr', 'ib', 'school_specific', 'none',
        }))

    def test_rejection_categories(self):
        self.assertEqual(database.ALLOWED_REJECTION_CATEGORIES, frozenset({
            'info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other',
        }))

    def test_wizard_step_range(self):
        self.assertEqual(database.WIZARD_STEP_MIN, 1)
        self.assertEqual(database.WIZARD_STEP_MAX, 4)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 8 tests FAIL with `AttributeError: module 'database' has no attribute 'ALLOWED_SCHOOL_TYPES'`.

- [ ] **Step 3: Add the constants**

Open `database.py`. Find the existing `ALLOWED_INTENDED_ROLES` and `ALLOWED_ONBOARDING_STATES` blocks (added by Plan 1). Immediately after them, add:

```python
# School registration wizard enums (Plan 3)

ALLOWED_SCHOOL_TYPES = frozenset({
    'middle',
    'high',
    'k12',
    'university',
    'language_academy',
    'district',
    'other',
})

ALLOWED_PUBLIC_PRIVATE = frozenset({
    'public',
    'private',
    'charter',
    'other',
})

ALLOWED_GRADE_SIZES = frozenset({
    '<50',
    '50-100',
    '100-200',
    '200-500',
    '500+',
})

ALLOWED_CANVAS_INTEGRATION_TYPES = frozenset({
    'lti13',
    'roster_sync',
    'grade_passback',
    'sso',
})

ALLOWED_GRADE_RANGES = frozenset({
    'k_2',
    'g3_5',
    'g6_8',
    'g9_12',
    'undergrad',
    'graduate',
    'adult_ed',
})

ALLOWED_COURSE_FRAMEWORKS = frozenset({
    'ap',
    'actfl',
    'cefr',
    'ib',
    'school_specific',
    'none',
})

ALLOWED_REJECTION_CATEGORIES = frozenset({
    'info_missing',
    'fraud_risk',
    'out_of_scope',
    'duplicate',
    'other',
})

WIZARD_STEP_MIN = 1
WIZARD_STEP_MAX = 4
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "$(cat <<'EOF'
feat(onboarding): wizard enum constants in database

Plan 3 source of truth for school_type, public/private, grade_size,
canvas integration types, grade ranges, course frameworks, rejection
categories, and the wizard step bounds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `school_creation_drafts` collection accessor

**Files:**
- Modify: `database.py` — add `get_school_creation_drafts_collection()` and `get_school_creation_draft_ref(uid)` near the existing `get_school_requests_collection()` (around line 359).
- Test: `backend/tests/test_school_creation_drafts.py`

**Why:** Mirrors the pattern used for every other Firestore collection in this file (one-liner accessors), so tests and helpers reach the collection without re-typing the literal string.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_school_creation_drafts.py`:

```python
from unittest.mock import MagicMock, patch


class SchoolCreationDraftAccessorsTest(unittest.TestCase):
    @patch('database.get_db')
    def test_collection_accessor(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        coll = database.get_school_creation_drafts_collection()
        client.collection.assert_called_once_with('school_creation_drafts')
        self.assertEqual(coll, client.collection.return_value)

    @patch('database.get_school_creation_drafts_collection')
    def test_ref_accessor(self, mock_coll):
        ref = database.get_school_creation_draft_ref('uid-1')
        mock_coll.return_value.document.assert_called_once_with('uid-1')
        self.assertEqual(ref, mock_coll.return_value.document.return_value)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 2 new tests FAIL with `AttributeError`.

- [ ] **Step 3: Add the accessors**

In `database.py`, near the existing `get_school_requests_collection`:

```python
def get_school_creation_drafts_collection():
    """Collection of in-progress school registration wizard drafts."""
    return get_db().collection('school_creation_drafts')


def get_school_creation_draft_ref(uid):
    """Doc ref for a user's draft (doc id == uid; one draft per user)."""
    return get_school_creation_drafts_collection().document(uid)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 10 tests pass total (8 from Task 1 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "feat(school-requests): add school_creation_drafts collection accessors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Draft read/write/delete helpers

**Files:**
- Modify: `database.py` — add `get_school_creation_draft`, `upsert_school_creation_draft`, `delete_school_creation_draft` after the accessors from Task 2.
- Test: `backend/tests/test_school_creation_drafts.py`

**Why:** One read helper, one upsert (handles both first-save and subsequent autosaves), one delete (used on successful submission). The doc id IS the uid — there is only ever one draft per user, so we don't need a `where('uid', '==', uid)` query.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_creation_drafts.py`:

```python
class SchoolCreationDraftHelpersTest(unittest.TestCase):
    @patch('database.get_school_creation_draft_ref')
    def test_get_returns_none_when_missing(self, mock_ref):
        snap = MagicMock()
        snap.exists = False
        mock_ref.return_value.get.return_value = snap
        self.assertIsNone(database.get_school_creation_draft('uid-1'))

    @patch('database.get_school_creation_draft_ref')
    def test_get_returns_data_when_present(self, mock_ref):
        snap = MagicMock()
        snap.exists = True
        snap.to_dict.return_value = {
            'current_step': 2,
            'draft_payload': {'school_name': 'SF Friends'},
        }
        mock_ref.return_value.get.return_value = snap
        draft = database.get_school_creation_draft('uid-1')
        self.assertEqual(draft['current_step'], 2)
        self.assertEqual(draft['draft_payload'], {'school_name': 'SF Friends'})
        self.assertEqual(draft['uid'], 'uid-1')

    @patch('database.get_school_creation_draft_ref')
    def test_upsert_writes_payload(self, mock_ref):
        database.upsert_school_creation_draft(
            'uid-1',
            current_step=3,
            draft_payload={'school_name': 'SF Friends'},
        )
        args, kwargs = mock_ref.return_value.set.call_args
        payload = args[0]
        self.assertEqual(payload['current_step'], 3)
        self.assertEqual(payload['draft_payload'], {'school_name': 'SF Friends'})
        self.assertIn('updated_at', payload)
        self.assertEqual(kwargs, {'merge': True})

    def test_upsert_rejects_step_below_min(self):
        with self.assertRaisesRegex(ValueError, 'current_step'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=0, draft_payload={},
            )

    def test_upsert_rejects_step_above_max(self):
        with self.assertRaisesRegex(ValueError, 'current_step'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=5, draft_payload={},
            )

    def test_upsert_rejects_non_dict_payload(self):
        with self.assertRaisesRegex(ValueError, 'draft_payload'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=1, draft_payload='not a dict',
            )

    @patch('database.get_school_creation_draft_ref')
    def test_delete_calls_doc_delete(self, mock_ref):
        database.delete_school_creation_draft('uid-1')
        mock_ref.return_value.delete.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 7 new tests FAIL with `AttributeError`.

- [ ] **Step 3: Implement the helpers**

In `database.py`, immediately after `get_school_creation_draft_ref`:

```python
def get_school_creation_draft(uid):
    """Return the user's wizard draft dict, or None if no draft exists.

    The returned dict has keys `uid`, `current_step`, `draft_payload`, and
    `updated_at` (Firestore Timestamp).
    """
    snap = get_school_creation_draft_ref(uid).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data['uid'] = uid
    return data


def upsert_school_creation_draft(uid, *, current_step, draft_payload):
    """Create or update a user's wizard draft (merge semantics).

    Raises ValueError if `current_step` is outside [WIZARD_STEP_MIN, WIZARD_STEP_MAX]
    or `draft_payload` is not a dict.
    """
    if not isinstance(current_step, int) or not (
        WIZARD_STEP_MIN <= current_step <= WIZARD_STEP_MAX
    ):
        raise ValueError(
            f'current_step must be int in [{WIZARD_STEP_MIN}, {WIZARD_STEP_MAX}]; got {current_step!r}'
        )
    if not isinstance(draft_payload, dict):
        raise ValueError(f'draft_payload must be a dict; got {type(draft_payload).__name__}')

    get_school_creation_draft_ref(uid).set(
        {
            'current_step': current_step,
            'draft_payload': draft_payload,
            'updated_at': firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def delete_school_creation_draft(uid):
    """Delete a user's wizard draft. Safe to call when no draft exists."""
    get_school_creation_draft_ref(uid).delete()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: all 17 tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "feat(school-requests): add wizard draft read/upsert/delete helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Enriched `create_school_request` payload

**Files:**
- Modify: `database.py:2510` — extend `create_school_request(...)`.
- Test: `backend/tests/test_school_request_enriched_submission.py` (new)

**Why:** The wizard collects ~20 fields across four nested objects. Rather than grow the existing positional signature, accept an optional `enriched=` dict and merge it under the same document. Old callers (the legacy `SchoolRequestPage`, before its deletion in Task 26) keep working; new callers pass the full structured payload.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_school_request_enriched_submission.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

import database


class CreateSchoolRequestEnrichedTest(unittest.TestCase):
    @patch('database.get_school_requests_collection')
    def test_legacy_thin_payload_still_works(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-1'
        mock_coll.return_value.document.return_value = doc_ref

        request_id = database.create_school_request(
            requester_uid='uid-1',
            requester_email='a@b.test',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
        )

        self.assertEqual(request_id, 'req-1')
        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_name'], 'SF Friends')
        self.assertEqual(payload['status'], 'pending')
        # Enriched fields are NOT written when omitted.
        self.assertNotIn('location', payload)
        self.assertNotIn('admin_identity', payload)

    @patch('database.get_school_requests_collection')
    def test_enriched_payload_is_merged(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-2'
        mock_coll.return_value.document.return_value = doc_ref

        enriched = {
            'location': {'country': 'US', 'state': 'CA', 'county': 'San Francisco'},
            'school_type': 'k12',
            'public_private': 'private',
            'grade_size': '50-100',
            'official_email_domains': ['@ssfs.org'],
            'admin_identity': {
                'full_name': 'Ada Lovelace',
                'school_email': 'ada@ssfs.org',
                'role_title': 'Principal',
                'authorization_attestation': {
                    'confirmed_at': '2026-05-18T12:00:00Z',
                    'ip_hash': 'sha256:...',
                    'user_agent': 'Mozilla/5.0',
                },
            },
            'integration': {
                'canvas_url': 'ssfs.instructure.com',
                'canvas_integration_types': ['lti13', 'roster_sync'],
            },
            'curriculum': {
                'grade_ranges': ['g6_8', 'g9_12'],
                'languages_taught': ['es', 'fr'],
                'course_frameworks': ['ap', 'actfl'],
            },
            'pre_invited_teachers': ['t1@ssfs.org', 't2@ssfs.org'],
        }

        database.create_school_request(
            requester_uid='uid-2',
            requester_email='ada@ssfs.org',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
            enriched=enriched,
        )

        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_type'], 'k12')
        self.assertEqual(payload['location']['state'], 'CA')
        self.assertEqual(payload['admin_identity']['role_title'], 'Principal')
        self.assertEqual(payload['integration']['canvas_integration_types'],
                         ['lti13', 'roster_sync'])
        self.assertEqual(payload['curriculum']['languages_taught'], ['es', 'fr'])
        self.assertEqual(payload['pre_invited_teachers'],
                         ['t1@ssfs.org', 't2@ssfs.org'])
        # Status default still applies.
        self.assertEqual(payload['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 2 tests FAIL — `create_school_request() got an unexpected keyword argument 'enriched'`.

- [ ] **Step 3: Extend the writer**

Replace the body of `database.create_school_request` (around line 2510) with:

```python
def create_school_request(requester_uid, requester_email, requester_name,
                          school_name, org_type, website_url='',
                          canvas_instance_url='', *, enriched=None):
    """Create a school join request.

    `enriched`, when provided, is merged into the document. Legal keys are the
    Plan 3 wizard groups: `location`, `school_type`, `public_private`,
    `grade_size`, `official_email_domains`, `admin_identity`, `integration`,
    `curriculum`, `pre_invited_teachers`. Validation of inner values is the
    route's responsibility (this function trusts its caller).
    """
    doc_ref = get_school_requests_collection().document()
    payload = {
        'requester_uid': requester_uid,
        'requester_email': requester_email,
        'requester_name': requester_name,
        'school_name': school_name,
        'org_type': org_type,
        'website_url': website_url or '',
        'canvas_instance_url': canvas_instance_url or '',
        'status': 'pending',
        'reviewed_by_uid': None,
        'reviewed_at': None,
        'rejection_reason': None,
        'rejection_category': None,
        'created_org_id': None,
        'created_at': firestore.SERVER_TIMESTAMP,
    }
    if enriched:
        for key in (
            'location', 'school_type', 'public_private', 'grade_size',
            'official_email_domains', 'admin_identity', 'integration',
            'curriculum', 'pre_invited_teachers',
        ):
            if key in enriched:
                payload[key] = enriched[key]
    doc_ref.set(payload)
    return doc_ref.id
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 2 tests pass.

Run also: `make test-backend` to confirm nothing else regressed.
Expected: all backend tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_request_enriched_submission.py
git commit -m "$(cat <<'EOF'
feat(school-requests): accept enriched payload on create

Adds `enriched=` kwarg to create_school_request so the wizard can pass
location, admin_identity, integration, curriculum, and pre_invited_teachers
without breaking legacy thin callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Authorization attestation IP-hashing helper

**Files:**
- Modify: `database.py` — add `hash_attestation_ip(ip, salt=None)` near the top of the file (after the new wizard enum constants).
- Test: `backend/tests/test_school_creation_drafts.py` (append)

**Why:** The wizard records the admin's authorization checkbox with IP + UA for audit. We store an SHA-256 hash, not the raw IP, to minimize PII while keeping the data forensically useful. Salt is read from the `ATTESTATION_HASH_SALT` env var so the same IP cannot be correlated across deployments.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_school_creation_drafts.py`:

```python
import os


class HashAttestationIpTest(unittest.TestCase):
    def test_hash_is_deterministic_given_salt(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        b = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        self.assertEqual(a, b)
        self.assertTrue(a.startswith('sha256:'))

    def test_different_salts_produce_different_hashes(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepperA')
        b = database.hash_attestation_ip('1.2.3.4', salt='pepperB')
        self.assertNotEqual(a, b)

    def test_different_ips_produce_different_hashes(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        b = database.hash_attestation_ip('1.2.3.5', salt='pepper')
        self.assertNotEqual(a, b)

    def test_empty_ip_returns_empty_marker(self):
        self.assertEqual(database.hash_attestation_ip('', salt='pepper'), 'sha256:none')
        self.assertEqual(database.hash_attestation_ip(None, salt='pepper'), 'sha256:none')

    @patch.dict(os.environ, {'ATTESTATION_HASH_SALT': 'env-salt'}, clear=False)
    def test_default_salt_from_env(self):
        a = database.hash_attestation_ip('1.2.3.4')
        b = database.hash_attestation_ip('1.2.3.4', salt='env-salt')
        self.assertEqual(a, b)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement the hasher**

Near the top of `database.py`, alongside other module-level helpers (after imports), add:

```python
import hashlib as _hashlib


def hash_attestation_ip(ip, salt=None):
    """Return `sha256:<hex>` of `salt + ip` for audit-grade IP storage.

    Returns `sha256:none` for falsy IPs so the column has a stable shape.
    Salt defaults to env var ATTESTATION_HASH_SALT (or empty string).
    """
    if not ip:
        return 'sha256:none'
    if salt is None:
        salt = os.environ.get('ATTESTATION_HASH_SALT', '')
    digest = _hashlib.sha256(f'{salt}|{ip}'.encode('utf-8')).hexdigest()
    return f'sha256:{digest}'
```

Note: `os` and `hashlib` may already be imported at the top of `database.py`. If `import os` exists, drop the alias and just use it. If `hashlib` is not imported anywhere, the `_hashlib` alias prevents shadowing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: all 22 tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "feat(school-requests): add salted SHA-256 IP hasher for attestation audit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `cancel_school_request` helper

**Files:**
- Modify: `database.py` — add `cancel_school_request(request_id, uid)` after `update_school_request`.
- Test: `backend/tests/test_school_creation_drafts.py` (append)

**Why:** Wizard's "Cancel request" affects a single field set but needs an ownership check so the route can't be tricked into cancelling another user's pending request. Putting the check in the helper rather than the route keeps the invariant close to the data.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_creation_drafts.py`:

```python
from datetime import datetime


class CancelSchoolRequestTest(unittest.TestCase):
    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_cancels_own_pending_request(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'pending',
        }
        result = database.cancel_school_request('req-1', 'uid-1')
        self.assertTrue(result)
        args, _ = mock_update.call_args
        updates = args[1]
        self.assertEqual(args[0], 'req-1')
        self.assertEqual(updates['status'], 'cancelled')
        self.assertIn('cancelled_at', updates)

    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_rejects_wrong_owner(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'pending',
        }
        with self.assertRaisesRegex(PermissionError, 'not owned'):
            database.cancel_school_request('req-1', 'uid-OTHER')
        mock_update.assert_not_called()

    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_rejects_already_approved(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'approved',
        }
        with self.assertRaisesRegex(ValueError, 'not pending'):
            database.cancel_school_request('req-1', 'uid-1')
        mock_update.assert_not_called()

    @patch('database.get_school_request')
    def test_returns_false_when_not_found(self, mock_get):
        mock_get.return_value = None
        self.assertFalse(database.cancel_school_request('req-missing', 'uid-1'))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 4 new tests FAIL with `AttributeError`.

- [ ] **Step 3: Implement the helper**

In `database.py`, immediately after `update_school_request`:

```python
def cancel_school_request(request_id, uid):
    """Mark a pending school request as cancelled.

    Returns True on success, False when no such request exists.
    Raises PermissionError if `uid` is not the requester.
    Raises ValueError if the request is not in `pending` status.
    """
    req = get_school_request(request_id)
    if req is None:
        return False
    if req.get('requester_uid') != uid:
        raise PermissionError(f'Request {request_id} not owned by {uid}')
    if req.get('status') != 'pending':
        raise ValueError(
            f'Request {request_id} is not pending (status={req.get("status")!r})'
        )
    update_school_request(request_id, {
        'status': 'cancelled',
        'cancelled_at': firestore.SERVER_TIMESTAMP,
    })
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: all 26 tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "feat(school-requests): add cancel_school_request with ownership check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `record_school_request_pre_invites` helper

**Files:**
- Modify: `database.py` — add `record_school_request_pre_invites(org_id, requester_uid, emails)` after `cancel_school_request`.
- Test: `backend/tests/test_school_creation_drafts.py` (append)

**Why:** When Lingual approves a request, every email in `pre_invited_teachers` becomes a row in `teacher_invitations` so Plan 4's teacher join flow can recognize them. We isolate the helper from the route so the approve endpoint stays compact.

**Schema compatibility note:** The existing `teacher_invitations` collection (see `database.py:2627` `create_teacher_invitation`) writes `{ org_id, uid, email, name, status, reviewed_by_uid, reviewed_at, created_at }`. Pre-invite rows do not yet have a `uid` or `name` (the teacher hasn't signed up), so we write those as `None`. We additionally add two new fields — `created_by_uid` (the school admin who pre-invited) and `source: 'pre_invite'` — so Plan 4 can distinguish pre-invite rows from admin-generated invitations when consuming them. All rows in the collection have the same key set after this; Plan 4's listers won't see KeyErrors.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_creation_drafts.py`:

```python
class RecordPreInvitesTest(unittest.TestCase):
    @patch('database.get_db')
    def test_writes_one_doc_per_email_via_batch(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        ids = database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['a@x.test', 'b@x.test'],
        )

        self.assertEqual(len(ids), 2)
        # Two `batch.set(...)` calls expected, one per email.
        self.assertEqual(batch.set.call_count, 2)
        batch.commit.assert_called_once()

    @patch('database.get_db')
    def test_skips_empty_or_whitespace_emails(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        ids = database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['  ', '', 'good@x.test'],
        )

        self.assertEqual(len(ids), 1)
        self.assertEqual(batch.set.call_count, 1)

    @patch('database.get_db')
    def test_lowercases_and_strips_emails(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['  Foo@X.test  '],
        )

        payload = batch.set.call_args[0][1]
        self.assertEqual(payload['email'], 'foo@x.test')

    @patch('database.get_db')
    def test_no_emails_means_no_batch_commit(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client

        ids = database.record_school_request_pre_invites(
            org_id='org-1', requester_uid='uid-1', emails=[],
        )

        self.assertEqual(ids, [])
        client.batch.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement the helper**

In `database.py`, after `cancel_school_request`:

```python
def record_school_request_pre_invites(*, org_id, requester_uid, emails):
    """Create teacher_invitations rows for a list of pre-invite emails.

    Returns the list of new invitation ids in input order (skipping blanks).
    Emails are stripped and lowercased before write.

    Schema: matches the existing `teacher_invitations` doc shape from
    `create_teacher_invitation`, with `uid` and `name` set to None (the teacher
    hasn't signed up yet). Adds two new fields — `created_by_uid` and
    `source` — that existing rows will have absent; Plan 4 readers should
    treat them as optional.
    """
    cleaned = []
    for raw in emails or []:
        if not isinstance(raw, str):
            continue
        addr = raw.strip().lower()
        if addr:
            cleaned.append(addr)
    if not cleaned:
        return []

    client = get_db()
    coll = client.collection('teacher_invitations')
    batch = client.batch()
    ids = []
    for addr in cleaned:
        ref = coll.document()
        ids.append(ref.id)
        batch.set(ref, {
            # Existing-schema fields (match create_teacher_invitation)
            'org_id': org_id,
            'uid': None,                  # unknown until the teacher signs up
            'email': addr,
            'name': None,                 # unknown until the teacher signs up
            'status': 'pending',
            'reviewed_by_uid': None,
            'reviewed_at': None,
            'created_at': firestore.SERVER_TIMESTAMP,
            # New (additive) fields
            'created_by_uid': requester_uid,
            'source': 'pre_invite',
        })
    batch.commit()
    return ids
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_creation_drafts -v`
Expected: all 30 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_school_creation_drafts.py
git commit -m "feat(school-requests): add record_school_request_pre_invites batch writer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Three new OutboxTemplate enum members

**Files:**
- Modify: `backend/services/outbox.py` — extend `OutboxTemplate`.
- Test: `backend/tests/test_outbox_writer.py` (append; this file was created in Plan 1)

**Why:** Templates the approve/decline routes will reference. Adding the enum first ensures any later route code that names a template will fail at import time if the template hasn't been added.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_outbox_writer.py`:

```python
class OutboxTemplateEnumTest(unittest.TestCase):
    def test_school_request_approved_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.SCHOOL_REQUEST_APPROVED.value,
            'school_request_approved',
        )

    def test_school_request_declined_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.SCHOOL_REQUEST_DECLINED.value,
            'school_request_declined',
        )

    def test_teacher_invitation_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.TEACHER_INVITATION.value,
            'teacher_invitation',
        )
```

If `test_outbox_writer.py` does not yet have `import unittest` at the top, add it. Plan 1 used `unittest.TestCase` subclasses there already.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: 3 new tests FAIL with `AttributeError: SCHOOL_REQUEST_APPROVED`.

- [ ] **Step 3: Extend the enum**

In `backend/services/outbox.py`, edit the `OutboxTemplate` class:

```python
class OutboxTemplate(str, Enum):
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
    SCHOOL_REQUEST_APPROVED = 'school_request_approved'
    SCHOOL_REQUEST_DECLINED = 'school_request_declined'
    TEACHER_INVITATION = 'teacher_invitation'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_outbox_writer -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/outbox.py backend/tests/test_outbox_writer.py
git commit -m "feat(outbox): add approved/declined/invitation template enum members

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Cloud Function template subjects

**Files:**
- Modify: `functions/main.py` — extend `_TEMPLATE_SUBJECTS`.
- Test: `functions/tests/test_send_outbox_email.py` (existing; append a subject-resolution test)

**Why:** Each template needs a subject builder. Wiring all three subjects in one task ensures `render_outbox_email` (the helper in `functions/main.py` that looks up the subject) doesn't 500 when a template's subject is missing.

- [ ] **Step 1: Write the failing test**

Append to `functions/tests/test_send_outbox_email.py`:

```python
class TemplateSubjectTableTest(unittest.TestCase):
    def test_approved_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['school_request_approved']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'Your school SF Friends is now on Lingual',
        )

    def test_declined_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['school_request_declined']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'Your school registration needs more info',
        )

    def test_invitation_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['teacher_invitation']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'SF Friends is inviting you to teach on Lingual',
        )
```

If `unittest` and `patch` are not imported at the top of this file, add them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: 3 new tests FAIL with `KeyError`.

- [ ] **Step 3: Extend `_TEMPLATE_SUBJECTS`**

In `functions/main.py`, replace the existing `_TEMPLATE_SUBJECTS` block with:

```python
_TEMPLATE_SUBJECTS = {
    'school_request_to_lingual':
        lambda data: f"New school registration: {data['org_name']}",
    'school_request_approved':
        lambda data: f"Your school {data['org_name']} is now on Lingual",
    'school_request_declined':
        lambda data: "Your school registration needs more info",
    'teacher_invitation':
        lambda data: f"{data['org_name']} is inviting you to teach on Lingual",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest functions.tests.test_send_outbox_email -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/main.py functions/tests/test_send_outbox_email.py
git commit -m "feat(functions): wire approved/declined/invitation subjects

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Jinja2 templates for the three new emails

**Files:**
- Create: `functions/templates/school_request_approved.html.j2`
- Create: `functions/templates/school_request_declined.html.j2`
- Create: `functions/templates/teacher_invitation.html.j2`
- Test: `functions/tests/test_school_request_decision_templates.py` (new)

**Why:** Each template is short and plain-styled (no shared base template yet — that's Plan 6+ work if it's wanted). Render-time tests guarantee the templates accept the data shape the routes will pass.

- [ ] **Step 1: Write the failing tests**

Create `functions/tests/test_school_request_decision_templates.py`:

```python
import unittest
from unittest.mock import patch


class SchoolRequestDecisionTemplateRenderTest(unittest.TestCase):
    def _render(self, template_id, data):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _JINJA_ENV
        return _JINJA_ENV.get_template(f'{template_id}.html.j2').render(**data)

    def test_approved_template_renders(self):
        html = self._render('school_request_approved', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'login_url': 'https://lingual.app/login',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Ada', html)
        self.assertIn('https://lingual.app/login', html)

    def test_declined_template_renders_with_reason(self):
        html = self._render('school_request_declined', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'reason': 'Website not reachable.',
            'category': 'info_missing',
            'support_url': 'mailto:support@lingual.app',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Website not reachable.', html)
        self.assertIn('mailto:support@lingual.app', html)

    def test_declined_template_renders_without_reason(self):
        # Reason may be omitted; the template must still render.
        html = self._render('school_request_declined', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'reason': '',
            'category': 'other',
            'support_url': 'mailto:support@lingual.app',
        })
        self.assertIn('SF Friends', html)

    def test_teacher_invitation_template_renders(self):
        html = self._render('teacher_invitation', {
            'org_name': 'SF Friends',
            'inviter_name': 'Ada Lovelace',
            'signup_url': 'https://lingual.app/signup?role=teacher',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Ada Lovelace', html)
        self.assertIn('https://lingual.app/signup?role=teacher', html)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest functions.tests.test_school_request_decision_templates -v`
Expected: 4 tests FAIL with `TemplateNotFound`.

- [ ] **Step 3: Create the three templates**

Create `functions/templates/school_request_approved.html.j2`:

```jinja
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px;line-height:1.5;">
  <h1 style="margin:0 0 16px;font-size:22px;">Your school is now on Lingual</h1>
  <p>Hi {{ requester_name | e }},</p>
  <p><strong>{{ org_name | e }}</strong> has been approved. You can sign in and start inviting teachers and building classes.</p>
  <p style="margin:24px 0;">
    <a href="{{ login_url | e }}" style="background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Sign in to Lingual</a>
  </p>
  <p style="color:#555;font-size:13px;">If the button doesn't work, paste this link into your browser:<br>{{ login_url | e }}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="color:#888;font-size:12px;">Lingual — Teacher-designed practice, AI-executed at student scale.</p>
</body>
</html>
```

Create `functions/templates/school_request_declined.html.j2`:

```jinja
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px;line-height:1.5;">
  <h1 style="margin:0 0 16px;font-size:22px;">School registration needs more info</h1>
  <p>Hi {{ requester_name | e }},</p>
  <p>We weren't able to approve <strong>{{ org_name | e }}</strong> as submitted.</p>
  {% if reason %}
    <p style="background:#fff7d6;border:1px solid #f0d870;padding:12px 14px;border-radius:8px;">
      <strong>Reviewer notes:</strong><br>{{ reason | e }}
    </p>
  {% endif %}
  <p>You can edit your submission and resubmit, or reach out to us at <a href="{{ support_url | e }}">{{ support_url | e }}</a> with questions.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="color:#888;font-size:12px;">Lingual — Teacher-designed practice, AI-executed at student scale.</p>
</body>
</html>
```

Create `functions/templates/teacher_invitation.html.j2`:

```jinja
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px;line-height:1.5;">
  <h1 style="margin:0 0 16px;font-size:22px;">You've been invited to teach on Lingual</h1>
  <p><strong>{{ inviter_name | e }}</strong> from <strong>{{ org_name | e }}</strong> has invited you to join Lingual as a teacher.</p>
  <p style="margin:24px 0;">
    <a href="{{ signup_url | e }}" style="background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Accept invitation</a>
  </p>
  <p style="color:#555;font-size:13px;">If the button doesn't work, paste this link into your browser:<br>{{ signup_url | e }}</p>
  <p style="color:#555;font-size:13px;">Use the same email this invitation was sent to so we can connect you to <strong>{{ org_name | e }}</strong> automatically.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="color:#888;font-size:12px;">Lingual — Teacher-designed practice, AI-executed at student scale.</p>
</body>
</html>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest functions.tests.test_school_request_decision_templates -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/templates/ functions/tests/test_school_request_decision_templates.py
git commit -m "feat(outbox): add approved / declined / invitation Jinja templates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `GET /api/school-requests/draft` route

**Files:**
- Modify: `backend/routes/school_requests.py` — add a new route inside `create_school_requests_blueprint`.
- Test: `backend/tests/test_school_request_enriched_submission.py` (append; reuse the existing fake-deps pattern from Plan 1's `test_school_request_outbox_integration.py`)

**Why:** Lets the wizard load the in-progress draft on mount so a returning user resumes where they left off. Returns `null` (HTTP 200) when there's no draft — easier for the frontend than handling 404.

- [ ] **Step 1: Add a route-test scaffold**

Append to `backend/tests/test_school_request_enriched_submission.py`:

```python
from backend.route_deps import RouteDeps
from backend.tests.conftest import FakeDbBase, FakeFirebaseAuth, make_test_app, make_test_deps


class FakeSchoolRequestDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.drafts = {}              # uid -> draft dict
        self.school_requests = {}     # id -> request dict
        self.next_request_id = 1
        self.created_invites = []     # list of teacher_invitations dicts
        self.lingual_admins = []      # list of {email,name}

    # -- drafts
    def get_school_creation_draft(self, uid):
        return self.drafts.get(uid)

    def upsert_school_creation_draft(self, uid, *, current_step, draft_payload):
        if not (1 <= current_step <= 4):
            raise ValueError(f'current_step out of range: {current_step}')
        if not isinstance(draft_payload, dict):
            raise ValueError('draft_payload must be a dict')
        self.drafts[uid] = {
            'uid': uid,
            'current_step': current_step,
            'draft_payload': draft_payload,
            'updated_at': 'NOW',
        }

    def delete_school_creation_draft(self, uid):
        self.drafts.pop(uid, None)

    # -- requests
    def get_user_school_request(self, uid):
        for req in self.school_requests.values():
            if req.get('requester_uid') == uid:
                return req
        return None

    def get_school_request(self, request_id):
        return self.school_requests.get(request_id)

    def create_school_request(self, *, requester_uid, requester_email, requester_name,
                               school_name, org_type, website_url='',
                               canvas_instance_url='', enriched=None):
        req_id = f'req-{self.next_request_id}'
        self.next_request_id += 1
        req = {
            'id': req_id,
            'requester_uid': requester_uid,
            'requester_email': requester_email,
            'requester_name': requester_name,
            'school_name': school_name,
            'org_type': org_type,
            'website_url': website_url,
            'canvas_instance_url': canvas_instance_url,
            'status': 'pending',
            'reviewed_by_uid': None,
            'reviewed_at': None,
            'rejection_reason': None,
            'rejection_category': None,
            'created_org_id': None,
        }
        if enriched:
            for key in (
                'location', 'school_type', 'public_private', 'grade_size',
                'official_email_domains', 'admin_identity', 'integration',
                'curriculum', 'pre_invited_teachers',
            ):
                if key in enriched:
                    req[key] = enriched[key]
        self.school_requests[req_id] = req
        return req_id

    def cancel_school_request(self, request_id, uid):
        req = self.school_requests.get(request_id)
        if req is None:
            return False
        if req.get('requester_uid') != uid:
            raise PermissionError(f'Request {request_id} not owned by {uid}')
        if req.get('status') != 'pending':
            raise ValueError(f'Request {request_id} is not pending')
        req['status'] = 'cancelled'
        return True


class SchoolRequestDraftRouteTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSchoolRequestDb()
        self.deps = make_test_deps(
            db=self.db,
            firebase_auth=FakeFirebaseAuth({'uid-1': {'email': 'a@b.test', 'name': 'Ada'}}),
        )
        from backend.routes.school_requests import create_school_requests_blueprint
        self.app = make_test_app(self.deps, [create_school_requests_blueprint])
        self.client = self.app.test_client()

    def _login(self, uid):
        with self.client.session_transaction() as s:
            s['user_id'] = uid

    def test_returns_null_when_no_draft(self):
        self._login('uid-1')
        resp = self.client.get('/api/school-requests/draft')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertIsNone(body['draft'])

    def test_returns_existing_draft(self):
        self.db.drafts['uid-1'] = {
            'uid': 'uid-1',
            'current_step': 2,
            'draft_payload': {'school_name': 'SF Friends'},
            'updated_at': 'NOW',
        }
        self._login('uid-1')
        resp = self.client.get('/api/school-requests/draft')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body['draft']['currentStep'], 2)
        self.assertEqual(body['draft']['draftPayload']['school_name'], 'SF Friends')
```

Use the existing helpers in `backend/tests/conftest.py` (`FakeDbBase`, `FakeFirebaseAuth`, `make_test_deps`, `make_test_app`) as established in Plan 1's auth tests. If `make_test_app` does not accept a list of blueprints, check the conftest — Plan 1 wired it as `make_test_app(deps, blueprint_factories=[...])`. Adjust the call signature in the test to match what exists.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 2 new tests FAIL with 404 (route does not exist).

- [ ] **Step 3: Add the route**

In `backend/routes/school_requests.py`, inside `create_school_requests_blueprint(deps)`, after the existing `submit_school_request` endpoint and before `get_my_school_request`, add:

```python
    def _serialize_draft(draft):
        if draft is None:
            return None
        updated = draft.get('updated_at')
        return {
            'uid': draft.get('uid'),
            'currentStep': draft.get('current_step'),
            'draftPayload': draft.get('draft_payload') or {},
            'updatedAt': (
                updated.isoformat()
                if isinstance(updated, datetime)
                else updated
            ),
        }

    @bp.route('/api/school-requests/draft', methods=['GET'])
    @deps.login_required
    def get_school_request_draft():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        draft = deps.db.get_school_creation_draft(uid)
        return jsonify({'success': True, 'draft': _serialize_draft(draft)}), 200
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: all 4 tests pass (2 enriched + 2 draft).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_enriched_submission.py
git commit -m "feat(school-requests): add GET /api/school-requests/draft

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `PATCH /api/school-requests/draft` (autosave)

**Files:**
- Modify: `backend/routes/school_requests.py` — add PATCH route.
- Test: `backend/tests/test_school_request_enriched_submission.py` (append)

**Why:** The wizard issues a PATCH on each field blur. The route validates `currentStep` is in [1,4] and `draftPayload` is a dict, then upserts via the database helper. Anything fancier (deep validation of payload shape) is the route's job at submit time (Task 13), not on autosave — we want autosave to be cheap and forgiving.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_request_enriched_submission.py`:

```python
class SchoolRequestDraftSaveTest(SchoolRequestDraftRouteTest):
    def test_patch_creates_draft(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1,
            'draftPayload': {'school_name': 'SF Friends'},
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(self.db.drafts['uid-1']['current_step'], 1)
        self.assertEqual(
            self.db.drafts['uid-1']['draft_payload']['school_name'],
            'SF Friends',
        )

    def test_patch_overwrites_existing_draft(self):
        self.db.drafts['uid-1'] = {
            'uid': 'uid-1',
            'current_step': 1,
            'draft_payload': {'school_name': 'old'},
            'updated_at': 'NOW',
        }
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 2,
            'draftPayload': {'school_name': 'new', 'website_url': 'sf.org'},
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.drafts['uid-1']['current_step'], 2)
        self.assertEqual(self.db.drafts['uid-1']['draft_payload']['school_name'], 'new')

    def test_patch_rejects_invalid_step(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 9,
            'draftPayload': {},
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('currentStep', resp.get_json()['error'])

    def test_patch_rejects_non_dict_payload(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1,
            'draftPayload': 'oops',
        })
        self.assertEqual(resp.status_code, 400)

    def test_patch_requires_auth(self):
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1, 'draftPayload': {},
        })
        self.assertIn(resp.status_code, (401, 302))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 5 new tests FAIL with 404 or 405.

- [ ] **Step 3: Add the PATCH route**

In `backend/routes/school_requests.py`, immediately after the GET draft route:

```python
    @bp.route('/api/school-requests/draft', methods=['PATCH'])
    @deps.login_required
    def patch_school_request_draft():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401

        data = request.get_json(silent=True) or {}
        current_step = data.get('currentStep')
        draft_payload = data.get('draftPayload')

        if not isinstance(current_step, int) or not (1 <= current_step <= 4):
            return jsonify({
                'success': False,
                'error': 'currentStep must be an integer in [1, 4].',
            }), 400
        if not isinstance(draft_payload, dict):
            return jsonify({
                'success': False,
                'error': 'draftPayload must be a JSON object.',
            }), 400

        try:
            deps.db.upsert_school_creation_draft(
                uid,
                current_step=current_step,
                draft_payload=draft_payload,
            )
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        return jsonify({'success': True}), 200
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_enriched_submission.py
git commit -m "feat(school-requests): add PATCH /api/school-requests/draft for autosave

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Extend `POST /api/school-requests` to accept the enriched wizard payload

**Files:**
- Modify: `backend/routes/school_requests.py` — extend the existing `submit_school_request` route.
- Modify: `database.py` — make sure `get_user_field` returns falsy for missing users (Plan 1 ensured this, but verify with a smoke test once the route is wired).
- Test: `backend/tests/test_school_request_enriched_submission.py` (append)

**Why:** The wizard submits the entire collected payload in one POST. Existing thin clients (the now-deprecated `SchoolRequestPage`, to be deleted in Task 26) still send `schoolName`, `orgType`, `websiteUrl`, `canvasInstanceUrl` — we keep handling those. New clients additionally send `location`, `schoolType`, `publicPrivate`, `gradeSize`, `officialEmailDomains`, `adminIdentity`, `integration`, `curriculum`, `preInvitedTeachers`.

On success, the route deletes the draft and sets `users/{uid}/profile.onboarding_state = 'awaiting_lingual'` so the dispatcher routes the user to `/signup/admin/pending` on next page load.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_request_enriched_submission.py`:

```python
class SubmitEnrichedSchoolRequestTest(SchoolRequestDraftRouteTest):
    def setUp(self):
        super().setUp()
        # Track update_user_profile calls
        self.profile_updates = []
        def fake_update(uid, **kwargs):
            self.profile_updates.append((uid, kwargs))
        self.db.update_user_profile = fake_update
        # Lingual admin so the outbox fan-out has a recipient
        self.db.lingual_admins = [{'email': 'la@lingual.app', 'name': 'LA'}]
        def fake_list_admins():
            return list(self.db.lingual_admins)
        self.db.list_lingual_admin_emails = fake_list_admins

    def test_thin_payload_still_creates_request(self):
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends',
            'orgType': 'school',
        })
        self.assertEqual(resp.status_code, 201, resp.get_json())
        self.assertEqual(len(self.db.school_requests), 1)
        req = list(self.db.school_requests.values())[0]
        self.assertEqual(req['school_name'], 'SF Friends')
        self.assertNotIn('location', req)

    def test_enriched_payload_persists_nested_fields(self):
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends',
            'orgType': 'school',
            'websiteUrl': 'https://ssfs.org',
            'location': {'country': 'US', 'state': 'CA'},
            'schoolType': 'k12',
            'publicPrivate': 'private',
            'gradeSize': '50-100',
            'officialEmailDomains': ['@ssfs.org'],
            'adminIdentity': {
                'fullName': 'Ada Lovelace',
                'schoolEmail': 'ada@ssfs.org',
                'roleTitle': 'Principal',
                'authorizationAttested': True,
            },
            'integration': {
                'canvasUrl': 'ssfs.instructure.com',
                'canvasIntegrationTypes': ['lti13'],
            },
            'curriculum': {
                'gradeRanges': ['g9_12'],
                'languagesTaught': ['es'],
                'courseFrameworks': ['ap'],
            },
            'preInvitedTeachers': ['t1@ssfs.org', 't2@ssfs.org'],
        }, environ_base={'REMOTE_ADDR': '198.51.100.4', 'HTTP_USER_AGENT': 'pytest'})

        self.assertEqual(resp.status_code, 201, resp.get_json())
        req = list(self.db.school_requests.values())[0]
        self.assertEqual(req['school_type'], 'k12')
        self.assertEqual(req['admin_identity']['full_name'], 'Ada Lovelace')
        # Attestation is recorded server-side, NOT taken from client payload
        self.assertIn('authorization_attestation', req['admin_identity'])
        att = req['admin_identity']['authorization_attestation']
        self.assertTrue(att['ip_hash'].startswith('sha256:'))
        self.assertEqual(att['user_agent'], 'pytest')
        # Pre-invites stored
        self.assertEqual(req['pre_invited_teachers'],
                         ['t1@ssfs.org', 't2@ssfs.org'])

    def test_submit_rejects_unchecked_attestation(self):
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends',
            'orgType': 'school',
            'adminIdentity': {
                'fullName': 'Ada',
                'schoolEmail': 'ada@ssfs.org',
                'roleTitle': 'Principal',
                'authorizationAttested': False,
            },
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('authorization', resp.get_json()['error'].lower())

    def test_submit_rejects_invalid_school_type(self):
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends',
            'orgType': 'school',
            'schoolType': 'NOT_A_TYPE',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('schoolType', resp.get_json()['error'])

    def test_submit_deletes_draft_on_success(self):
        self.db.drafts['uid-1'] = {
            'uid': 'uid-1', 'current_step': 4,
            'draft_payload': {}, 'updated_at': 'NOW',
        }
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends', 'orgType': 'school',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn('uid-1', self.db.drafts)

    def test_submit_sets_onboarding_state(self):
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends', 'orgType': 'school',
        })
        self.assertEqual(resp.status_code, 201)
        match = [
            kwargs for uid, kwargs in self.profile_updates
            if uid == 'uid-1' and kwargs.get('onboarding_state') == 'awaiting_lingual'
        ]
        self.assertTrue(match, f'expected onboarding_state set, got {self.profile_updates!r}')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 6 new tests FAIL — submission currently ignores enriched fields, doesn't enforce attestation, doesn't delete draft, doesn't set onboarding state.

- [ ] **Step 3: Extend the route**

In `backend/routes/school_requests.py`, replace the body of `submit_school_request` with the version below. Key changes:
- Build an `enriched` dict from camelCase request keys.
- Validate enums against the new `database.ALLOWED_*` constants.
- Server-side compute `authorization_attestation` from `request.remote_addr` + UA — never trust the client to populate the attestation block.
- After `create_school_request`, delete the draft and update profile onboarding state.

```python
    _ENRICHED_FIELDS = (
        ('location', 'location'),
        ('schoolType', 'school_type'),
        ('publicPrivate', 'public_private'),
        ('gradeSize', 'grade_size'),
        ('officialEmailDomains', 'official_email_domains'),
    )

    def _camel_to_snake_admin_identity(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'full_name': (camel.get('fullName') or '').strip(),
            'school_email': (camel.get('schoolEmail') or '').strip().lower(),
            'role_title': (camel.get('roleTitle') or '').strip(),
        }

    def _camel_to_snake_integration(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'canvas_url': (camel.get('canvasUrl') or '').strip(),
            'canvas_integration_types': list(camel.get('canvasIntegrationTypes') or []),
        }

    def _camel_to_snake_curriculum(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'grade_ranges': list(camel.get('gradeRanges') or []),
            'languages_taught': list(camel.get('languagesTaught') or []),
            'course_frameworks': list(camel.get('courseFrameworks') or []),
        }

    def _validate_enum(value, allowed, field):
        if value is None or value == '':
            return None
        if value not in allowed:
            raise ValueError(f'Invalid {field}: {value!r}')
        return value

    def _validate_enum_list(values, allowed, field):
        if not values:
            return []
        bad = [v for v in values if v not in allowed]
        if bad:
            raise ValueError(f'Invalid {field} entries: {bad!r}')
        return list(values)

    @bp.route('/api/school-requests', methods=['POST'])
    @deps.login_required
    def submit_school_request():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'Authentication required.'}), 401

            data = request.get_json() or {}
            school_name = (data.get('schoolName') or '').strip()
            if not school_name:
                return jsonify({'success': False, 'error': 'schoolName is required.'}), 400

            existing = deps.db.get_user_school_request(uid)
            if existing and existing.get('status') in ('pending', 'approved'):
                return jsonify({'success': False, 'error': 'You already have a pending or approved request.'}), 409

            org_type = (data.get('orgType') or 'school').strip()
            requester_email = (data.get('email') or '').strip()
            requester_name = (data.get('name') or '').strip()
            website_url = (data.get('websiteUrl') or '').strip()
            canvas_instance_url = (data.get('canvasInstanceUrl') or '').strip()

            # --- Build the enriched payload ---
            enriched = {}

            for camel_key, snake_key in _ENRICHED_FIELDS:
                if camel_key not in data:
                    continue
                value = data[camel_key]
                if snake_key == 'school_type':
                    value = _validate_enum(value, database.ALLOWED_SCHOOL_TYPES, 'schoolType')
                elif snake_key == 'public_private':
                    value = _validate_enum(value, database.ALLOWED_PUBLIC_PRIVATE, 'publicPrivate')
                elif snake_key == 'grade_size':
                    value = _validate_enum(value, database.ALLOWED_GRADE_SIZES, 'gradeSize')
                elif snake_key == 'official_email_domains':
                    value = [str(d).strip().lower() for d in (value or []) if str(d).strip()]
                if value is not None:
                    enriched[snake_key] = value

            admin_identity_in = data.get('adminIdentity')
            if admin_identity_in is not None:
                ai = _camel_to_snake_admin_identity(admin_identity_in)
                if ai is None:
                    return jsonify({'success': False, 'error': 'adminIdentity must be an object'}), 400
                if not admin_identity_in.get('authorizationAttested') is True:
                    return jsonify({
                        'success': False,
                        'error': 'authorization attestation must be confirmed',
                    }), 400
                ai['authorization_attestation'] = {
                    'confirmed_at': datetime.now(UTC).isoformat(),
                    'ip_hash': database.hash_attestation_ip(request.remote_addr or ''),
                    'user_agent': (request.user_agent.string or '')[:512],
                }
                enriched['admin_identity'] = ai

            integration_in = data.get('integration')
            if integration_in is not None:
                integ = _camel_to_snake_integration(integration_in)
                if integ is None:
                    return jsonify({'success': False, 'error': 'integration must be an object'}), 400
                integ['canvas_integration_types'] = _validate_enum_list(
                    integ['canvas_integration_types'],
                    database.ALLOWED_CANVAS_INTEGRATION_TYPES,
                    'canvasIntegrationTypes',
                )
                enriched['integration'] = integ

            curriculum_in = data.get('curriculum')
            if curriculum_in is not None:
                cur = _camel_to_snake_curriculum(curriculum_in)
                if cur is None:
                    return jsonify({'success': False, 'error': 'curriculum must be an object'}), 400
                cur['grade_ranges'] = _validate_enum_list(
                    cur['grade_ranges'], database.ALLOWED_GRADE_RANGES, 'gradeRanges')
                cur['course_frameworks'] = _validate_enum_list(
                    cur['course_frameworks'], database.ALLOWED_COURSE_FRAMEWORKS, 'courseFrameworks')
                cur['languages_taught'] = [
                    str(s).strip().lower() for s in cur['languages_taught'] if str(s).strip()
                ]
                enriched['curriculum'] = cur

            pre_invites = data.get('preInvitedTeachers')
            if pre_invites is not None:
                if not isinstance(pre_invites, list):
                    return jsonify({'success': False, 'error': 'preInvitedTeachers must be a list'}), 400
                enriched['pre_invited_teachers'] = [
                    str(e).strip().lower() for e in pre_invites if str(e).strip()
                ]

            request_id = deps.db.create_school_request(
                requester_uid=uid,
                requester_email=requester_email,
                requester_name=requester_name,
                school_name=school_name,
                org_type=org_type,
                website_url=website_url,
                canvas_instance_url=canvas_instance_url,
                enriched=enriched or None,
            )

            # Drop the draft — submission is the success terminal.
            try:
                deps.db.delete_school_creation_draft(uid)
            except Exception as exc:
                print(f'[draft] cleanup failed after submit: {exc}')

            # Move the user's onboarding state forward.
            try:
                deps.db.update_user_profile(uid, onboarding_state='awaiting_lingual')
            except Exception as exc:
                print(f'[onboarding] state update failed: {exc}')

            # Fan-out outbox email to every active lingual admin (unchanged Plan 1 logic).
            try:
                review_url = f"{_public_base_url()}/app/admin/school-requests"
                firestore_client = database.get_db()
                for admin in list_lingual_admin_emails():
                    try:
                        enqueue_outbox_email(
                            db=firestore_client,
                            recipient_email=admin['email'],
                            recipient_name=admin.get('name'),
                            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                            template_data={
                                'org_name': school_name,
                                'requester_name': requester_name,
                                'requester_email': requester_email,
                                'review_url': review_url,
                            },
                            related_entity_type='school_request',
                            related_entity_id=request_id,
                            created_by_uid=uid,
                        )
                    except Exception as exc:
                        print(f"[outbox] failed to enqueue school_request_to_lingual for {admin.get('email')}: {exc}")
            except Exception as exc:
                print(f"[outbox] school_request fan-out aborted: {exc}")

            created = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(created)}), 201

        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
        except Exception as exc:
            print(f"School request submission error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500
```

Note: `_serialize_request` will be updated in Task 14 to expose the new fields camelCase. Until then it will still respond with the existing fields only — the tests above check the Firestore-side document, not the API response shape, so they don't depend on that change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: all 15 tests in this file pass.

Also run: `make test-backend`
Expected: all backend tests pass — the existing Plan 1 outbox integration test should still pass (the fan-out call signature didn't change).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_enriched_submission.py
git commit -m "$(cat <<'EOF'
feat(school-requests): accept enriched wizard payload on submit

Adds nested location, admin_identity (server-stamped attestation),
integration, curriculum, and pre_invited_teachers to /api/school-requests.
Validates enums at the boundary, drops the user's draft on success, and
moves onboarding_state to 'awaiting_lingual'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Expose new fields in `_serialize_request`

**Files:**
- Modify: `backend/routes/school_requests.py` — extend `_serialize_request`.
- Test: `backend/tests/test_school_request_enriched_submission.py` (append)

**Why:** API responses must include the new fields camelCase so the wizard (and the future Lingual admin panel — Plan 5) can read them back.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_school_request_enriched_submission.py`:

```python
class SerializeRequestTest(SchoolRequestDraftRouteTest):
    def test_response_includes_camelcased_enriched_fields(self):
        self.db.lingual_admins = []  # quiet outbox fan-out
        self.db.list_lingual_admin_emails = lambda: []
        self.db.update_user_profile = lambda uid, **kw: None
        self._login('uid-1')
        resp = self.client.post('/api/school-requests', json={
            'schoolName': 'SF Friends',
            'orgType': 'school',
            'schoolType': 'k12',
            'publicPrivate': 'private',
            'gradeSize': '50-100',
            'location': {'country': 'US', 'state': 'CA'},
            'adminIdentity': {
                'fullName': 'Ada',
                'schoolEmail': 'ada@ssfs.org',
                'roleTitle': 'Principal',
                'authorizationAttested': True,
            },
            'curriculum': {
                'gradeRanges': ['g9_12'],
                'languagesTaught': ['es'],
                'courseFrameworks': ['ap'],
            },
            'preInvitedTeachers': ['t1@ssfs.org'],
        })
        self.assertEqual(resp.status_code, 201, resp.get_json())
        req = resp.get_json()['request']
        self.assertEqual(req['schoolType'], 'k12')
        self.assertEqual(req['publicPrivate'], 'private')
        self.assertEqual(req['gradeSize'], '50-100')
        self.assertEqual(req['location']['country'], 'US')
        self.assertEqual(req['adminIdentity']['fullName'], 'Ada')
        # Attestation block is included verbatim (snake → camel where it matters)
        self.assertIn('authorizationAttestation', req['adminIdentity'])
        self.assertEqual(req['curriculum']['gradeRanges'], ['g9_12'])
        self.assertEqual(req['preInvitedTeachers'], ['t1@ssfs.org'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission.SerializeRequestTest -v`
Expected: KeyError or `None` on the new camelCase fields.

- [ ] **Step 3: Extend the serializer**

In `backend/routes/school_requests.py`, replace `_serialize_request` with:

```python
def _serialize_request(req):
    """Convert snake_case Firestore fields to camelCase for the API response."""
    if req is None:
        return None

    admin_identity = req.get('admin_identity')
    admin_identity_out = None
    if admin_identity:
        att = admin_identity.get('authorization_attestation') or {}
        admin_identity_out = {
            'fullName': admin_identity.get('full_name'),
            'schoolEmail': admin_identity.get('school_email'),
            'roleTitle': admin_identity.get('role_title'),
            'authorizationAttestation': {
                'confirmedAt': att.get('confirmed_at'),
                'ipHash': att.get('ip_hash'),
                'userAgent': att.get('user_agent'),
            },
        }

    integration = req.get('integration')
    integration_out = None
    if integration:
        integration_out = {
            'canvasUrl': integration.get('canvas_url'),
            'canvasIntegrationTypes': integration.get('canvas_integration_types') or [],
        }

    curriculum = req.get('curriculum')
    curriculum_out = None
    if curriculum:
        curriculum_out = {
            'gradeRanges': curriculum.get('grade_ranges') or [],
            'languagesTaught': curriculum.get('languages_taught') or [],
            'courseFrameworks': curriculum.get('course_frameworks') or [],
        }

    return {
        'id': req.get('id'),
        'requesterUid': req.get('requester_uid'),
        'requesterEmail': req.get('requester_email'),
        'requesterName': req.get('requester_name'),
        'schoolName': req.get('school_name'),
        'orgType': req.get('org_type'),
        'websiteUrl': req.get('website_url'),
        'canvasInstanceUrl': req.get('canvas_instance_url'),
        'status': req.get('status'),
        'reviewedByUid': req.get('reviewed_by_uid'),
        'reviewedAt': req.get('reviewed_at').isoformat() if isinstance(req.get('reviewed_at'), datetime) else req.get('reviewed_at'),
        'rejectionReason': req.get('rejection_reason'),
        'rejectionCategory': req.get('rejection_category'),
        'createdOrgId': req.get('created_org_id'),
        'createdAt': req.get('created_at').isoformat() if isinstance(req.get('created_at'), datetime) else req.get('created_at'),
        'cancelledAt': req.get('cancelled_at').isoformat() if isinstance(req.get('cancelled_at'), datetime) else req.get('cancelled_at'),
        # --- Enriched (Plan 3) ---
        'location': req.get('location'),
        'schoolType': req.get('school_type'),
        'publicPrivate': req.get('public_private'),
        'gradeSize': req.get('grade_size'),
        'officialEmailDomains': req.get('official_email_domains') or [],
        'adminIdentity': admin_identity_out,
        'integration': integration_out,
        'curriculum': curriculum_out,
        'preInvitedTeachers': req.get('pre_invited_teachers') or [],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_enriched_submission.py
git commit -m "feat(school-requests): expose enriched fields in API response

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: `DELETE /api/school-requests/mine` to cancel own pending request

**Files:**
- Modify: `backend/routes/school_requests.py` — add DELETE route.
- Test: `backend/tests/test_school_request_enriched_submission.py` (append)

**Why:** "Cancel request" on the pending page calls this. Implements ownership + status guards via the `database.cancel_school_request` helper from Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_request_enriched_submission.py`:

```python
class CancelMySchoolRequestRouteTest(SchoolRequestDraftRouteTest):
    def setUp(self):
        super().setUp()
        # Seed a pending request for uid-1
        self.db.school_requests['req-1'] = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'pending',
            'school_name': 'SF Friends',
        }

    def test_cancels_pending(self):
        self._login('uid-1')
        resp = self.client.delete('/api/school-requests/mine')
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(self.db.school_requests['req-1']['status'], 'cancelled')

    def test_returns_404_when_no_request(self):
        self.db.school_requests.clear()
        self._login('uid-1')
        resp = self.client.delete('/api/school-requests/mine')
        self.assertEqual(resp.status_code, 404)

    def test_returns_409_when_already_approved(self):
        self.db.school_requests['req-1']['status'] = 'approved'
        self._login('uid-1')
        resp = self.client.delete('/api/school-requests/mine')
        self.assertEqual(resp.status_code, 409)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: 3 new tests FAIL with 404/405.

- [ ] **Step 3: Add the route**

In `backend/routes/school_requests.py`, after `get_my_school_request`:

```python
    @bp.route('/api/school-requests/mine', methods=['DELETE'])
    @deps.login_required
    def cancel_my_school_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        existing = deps.db.get_user_school_request(uid)
        if not existing or existing.get('status') == 'cancelled':
            return jsonify({'success': False, 'error': 'No request to cancel.'}), 404
        try:
            ok = deps.db.cancel_school_request(existing['id'], uid)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 409
        except PermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        if not ok:
            return jsonify({'success': False, 'error': 'No request to cancel.'}), 404
        return jsonify({'success': True}), 200
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_enriched_submission -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_enriched_submission.py
git commit -m "feat(school-requests): add DELETE /api/school-requests/mine

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Approve route — outbox email + pre-invite teacher_invitations

**Files:**
- Modify: `backend/routes/school_requests.py` — extend `admin_approve_school_request`.
- Test: `backend/tests/test_school_request_decision_outbox.py` (new)

**Why:** On approve, three new things happen in addition to the existing create-org + create-membership: (1) drop the pre-invite teacher_invitations via `record_school_request_pre_invites`, (2) enqueue one `teacher_invitation` outbox email per pre-invite, (3) enqueue one `school_request_approved` outbox email to the requester. Each is best-effort — failure must NEVER break the approval response (so the approval is the source of truth, not the side effects).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_school_request_decision_outbox.py`:

```python
import unittest
from unittest.mock import patch

from backend.tests.conftest import (
    FakeDbBase, FakeFirebaseAuth, make_test_app, make_test_deps,
)


class FakeApprovalDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.requests = {}
        self.orgs_created = []
        self.memberships_created = []
        self.last_active = {}
        self.pre_invites_recorded = []   # list of (org_id, requester_uid, emails)
        self.lingual_admin_lookup = lambda uid: True

    def get_school_request(self, request_id):
        return self.requests.get(request_id)

    def update_school_request(self, request_id, updates):
        self.requests[request_id].update(updates)

    def create_organization(self, **kwargs):
        org_id = f'org-{len(self.orgs_created)+1}'
        self.orgs_created.append({'id': org_id, **kwargs})
        return org_id

    def create_membership(self, **kwargs):
        mid = f'mem-{len(self.memberships_created)+1}'
        self.memberships_created.append({'id': mid, **kwargs})
        return mid

    def set_user_last_active_membership(self, uid, membership_id):
        self.last_active[uid] = membership_id

    def get_user_field(self, uid, field):
        if field == 'lingual_admin':
            return self.lingual_admin_lookup(uid)
        return None

    def record_school_request_pre_invites(self, *, org_id, requester_uid, emails):
        self.pre_invites_recorded.append((org_id, requester_uid, list(emails)))
        return [f'inv-{i}' for i in range(len(emails))]

    def update_user_profile(self, uid, **kwargs):
        # Plan 1 helper — no-op for these tests.
        pass


class ApproveSchoolRequestOutboxTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeApprovalDb()
        self.db.requests['req-1'] = {
            'id': 'req-1',
            'requester_uid': 'uid-A',
            'requester_email': 'ada@ssfs.org',
            'requester_name': 'Ada',
            'school_name': 'SF Friends',
            'org_type': 'school',
            'status': 'pending',
            'pre_invited_teachers': ['t1@ssfs.org', 't2@ssfs.org'],
            'admin_identity': {'full_name': 'Ada Lovelace'},
        }
        self.deps = make_test_deps(
            db=self.db,
            firebase_auth=FakeFirebaseAuth({'lingual-1': {'email': 'la@lingual.app', 'name': 'LA'}}),
        )
        from backend.routes.school_requests import create_school_requests_blueprint
        self.app = make_test_app(self.deps, [create_school_requests_blueprint])
        self.client = self.app.test_client()
        with self.client.session_transaction() as s:
            s['user_id'] = 'lingual-1'

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_enqueues_approved_email_to_requester(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200, resp.get_json())
        approved_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'school_request_approved'
        ]
        self.assertEqual(len(approved_calls), 1, mock_enqueue.call_args_list)
        kwargs = approved_calls[0].kwargs
        self.assertEqual(kwargs['recipient_email'], 'ada@ssfs.org')
        self.assertEqual(kwargs['template_data']['org_name'], 'SF Friends')
        self.assertEqual(kwargs['template_data']['requester_name'], 'Ada')
        self.assertIn('login_url', kwargs['template_data'])

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_records_pre_invites(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(self.db.pre_invites_recorded), 1)
        org_id, requester_uid, emails = self.db.pre_invites_recorded[0]
        self.assertEqual(requester_uid, 'uid-A')
        self.assertEqual(emails, ['t1@ssfs.org', 't2@ssfs.org'])

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_enqueues_one_invitation_per_pre_invite(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        invite_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'teacher_invitation'
        ]
        self.assertEqual(len(invite_calls), 2)
        emails_sent = {c.kwargs['recipient_email'] for c in invite_calls}
        self.assertEqual(emails_sent, {'t1@ssfs.org', 't2@ssfs.org'})

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_succeeds_when_no_pre_invites(self, mock_enqueue):
        self.db.requests['req-1']['pre_invited_teachers'] = []
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        # Approved email still fires.
        approved_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'school_request_approved'
        ]
        self.assertEqual(len(approved_calls), 1)

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_returns_200_even_if_pre_invite_record_blows_up(self, mock_enqueue):
        def boom(*_a, **_kw):
            raise RuntimeError('firestore down')
        self.db.record_school_request_pre_invites = boom
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200, resp.get_json())
        # Approved email still attempted
        self.assertTrue(any(
            c.kwargs.get('template').value == 'school_request_approved'
            for c in mock_enqueue.call_args_list
        ))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_decision_outbox -v`
Expected: 5 tests FAIL — the current approve route doesn't enqueue or record pre-invites.

- [ ] **Step 3: Extend the approve route**

In `backend/routes/school_requests.py`, replace the body of `admin_approve_school_request` with:

```python
    @bp.route('/api/admin/school-requests/<request_id>/approve', methods=['POST'])
    @deps.login_required
    def admin_approve_school_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            req = deps.db.get_school_request(request_id)
            if not req:
                return jsonify({'success': False, 'error': 'Request not found.'}), 404
            if req.get('status') != 'pending':
                return jsonify({'success': False, 'error': 'Only pending requests can be approved.'}), 409

            org_id = deps.db.create_organization(
                name=req['school_name'],
                org_type=req.get('org_type', 'school'),
                pilot_stage='beta',
            )
            membership_id = deps.db.create_membership(
                org_id=org_id,
                uid=req['requester_uid'],
                roles=['school_admin'],
            )
            deps.db.set_user_last_active_membership(req['requester_uid'], membership_id)

            deps.db.update_school_request(request_id, {
                'status': 'approved',
                'reviewed_by_uid': uid,
                'reviewed_at': datetime.now(UTC),
                'created_org_id': org_id,
            })

            # Move the requester's onboarding state forward.
            try:
                deps.db.update_user_profile(req['requester_uid'], onboarding_state='complete')
            except Exception as exc:
                print(f'[onboarding] state update failed on approval: {exc}')

            # --- Best-effort side effects ---
            pre_invites = req.get('pre_invited_teachers') or []
            try:
                if pre_invites:
                    deps.db.record_school_request_pre_invites(
                        org_id=org_id,
                        requester_uid=req['requester_uid'],
                        emails=pre_invites,
                    )
            except Exception as exc:
                print(f'[pre-invites] record failed: {exc}')

            firestore_client = database.get_db()
            base = _public_base_url()
            try:
                enqueue_outbox_email(
                    db=firestore_client,
                    recipient_email=req.get('requester_email') or '',
                    recipient_name=req.get('requester_name'),
                    template=OutboxTemplate.SCHOOL_REQUEST_APPROVED,
                    template_data={
                        'org_name': req.get('school_name'),
                        'requester_name': req.get('requester_name'),
                        'login_url': f'{base}/login',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] school_request_approved enqueue failed: {exc}')

            inviter_name = (req.get('admin_identity') or {}).get('full_name') or req.get('requester_name') or 'A school administrator'
            for email in pre_invites:
                try:
                    enqueue_outbox_email(
                        db=firestore_client,
                        recipient_email=email,
                        recipient_name=None,
                        template=OutboxTemplate.TEACHER_INVITATION,
                        template_data={
                            'org_name': req.get('school_name'),
                            'inviter_name': inviter_name,
                            'signup_url': f'{base}/signup?role=teacher',
                        },
                        related_entity_type='school_request',
                        related_entity_id=request_id,
                        created_by_uid=uid,
                    )
                except Exception as exc:
                    print(f'[outbox] teacher_invitation enqueue failed for {email}: {exc}')

            updated = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(updated)}), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin approve school request error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_decision_outbox -v`
Expected: all 5 tests pass.

Also: `make test-backend`
Expected: all backend tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_decision_outbox.py
git commit -m "$(cat <<'EOF'
feat(school-requests): outbox emails + pre-invites on approve

Approval now:
- records pre_invited_teachers as teacher_invitations rows
- enqueues one `school_request_approved` email to the requester
- enqueues one `teacher_invitation` email per pre-invite
- moves onboarding_state to 'complete'

All side effects are best-effort; the approval itself never fails because
of an outbox or invitation-record problem.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Reject route — outbox decline email + category

**Files:**
- Modify: `backend/routes/school_requests.py` — extend `admin_reject_school_request`.
- Test: `backend/tests/test_school_request_decision_outbox.py` (append)

**Why:** Spec calls this "decline" in the UI but the underlying field stays `rejection_*` for codebase consistency. We add an optional `category` body field validated against `ALLOWED_REJECTION_CATEGORIES`, persist it as `rejection_category`, and enqueue one `school_request_declined` email to the requester.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_school_request_decision_outbox.py`:

```python
class RejectSchoolRequestOutboxTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeApprovalDb()
        self.db.requests['req-2'] = {
            'id': 'req-2',
            'requester_uid': 'uid-B',
            'requester_email': 'bob@ssfs.org',
            'requester_name': 'Bob',
            'school_name': 'SF Friends',
            'org_type': 'school',
            'status': 'pending',
        }
        self.deps = make_test_deps(
            db=self.db,
            firebase_auth=FakeFirebaseAuth({'lingual-1': {'email': 'la@lingual.app', 'name': 'LA'}}),
        )
        from backend.routes.school_requests import create_school_requests_blueprint
        self.app = make_test_app(self.deps, [create_school_requests_blueprint])
        self.client = self.app.test_client()
        with self.client.session_transaction() as s:
            s['user_id'] = 'lingual-1'

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_reject_persists_reason_and_category(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={
            'reason': 'Website not reachable.',
            'category': 'info_missing',
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(self.db.requests['req-2']['status'], 'rejected')
        self.assertEqual(self.db.requests['req-2']['rejection_reason'], 'Website not reachable.')
        self.assertEqual(self.db.requests['req-2']['rejection_category'], 'info_missing')

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_reject_enqueues_declined_email_to_requester(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={
            'reason': 'Need more info', 'category': 'info_missing',
        })
        self.assertEqual(resp.status_code, 200)
        declined = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'school_request_declined'
        ]
        self.assertEqual(len(declined), 1)
        kwargs = declined[0].kwargs
        self.assertEqual(kwargs['recipient_email'], 'bob@ssfs.org')
        self.assertEqual(kwargs['template_data']['org_name'], 'SF Friends')
        self.assertEqual(kwargs['template_data']['reason'], 'Need more info')
        self.assertEqual(kwargs['template_data']['category'], 'info_missing')
        self.assertIn('support_url', kwargs['template_data'])

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_reject_accepts_empty_reason(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={
            'category': 'other',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.requests['req-2']['rejection_reason'], '')
        self.assertEqual(self.db.requests['req-2']['rejection_category'], 'other')

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_reject_rejects_invalid_category(self, mock_enqueue):
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={
            'reason': 'r', 'category': 'NOT_A_CATEGORY',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.db.requests['req-2']['status'], 'pending')
        mock_enqueue.assert_not_called()

    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_reject_returns_409_on_already_decided(self, mock_enqueue):
        self.db.requests['req-2']['status'] = 'approved'
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={'reason': 'r'})
        self.assertEqual(resp.status_code, 409)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_school_request_decision_outbox -v`
Expected: 5 new tests FAIL — current route ignores category and doesn't outbox.

- [ ] **Step 3: Extend the reject route**

In `backend/routes/school_requests.py`, replace `admin_reject_school_request` with:

```python
    @bp.route('/api/admin/school-requests/<request_id>/reject', methods=['POST'])
    @deps.login_required
    def admin_reject_school_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            req = deps.db.get_school_request(request_id)
            if not req:
                return jsonify({'success': False, 'error': 'Request not found.'}), 404
            if req.get('status') != 'pending':
                return jsonify({'success': False, 'error': 'Only pending requests can be rejected.'}), 409

            data = request.get_json() or {}
            reason = (data.get('reason') or '').strip()
            category = (data.get('category') or '').strip()
            if category and category not in database.ALLOWED_REJECTION_CATEGORIES:
                return jsonify({
                    'success': False,
                    'error': f'Invalid category: {category!r}',
                }), 400

            deps.db.update_school_request(request_id, {
                'status': 'rejected',
                'reviewed_by_uid': uid,
                'reviewed_at': datetime.now(UTC),
                'rejection_reason': reason,
                'rejection_category': category or None,
            })

            try:
                base = _public_base_url()
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=req.get('requester_email') or '',
                    recipient_name=req.get('requester_name'),
                    template=OutboxTemplate.SCHOOL_REQUEST_DECLINED,
                    template_data={
                        'org_name': req.get('school_name'),
                        'requester_name': req.get('requester_name'),
                        'reason': reason,
                        'category': category or 'other',
                        'support_url': 'mailto:support@lingual.app',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] school_request_declined enqueue failed: {exc}')

            updated = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(updated)}), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin reject school request error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_school_request_decision_outbox -v`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_request_decision_outbox.py
git commit -m "feat(school-requests): outbox + category on reject

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Firestore rules for `school_creation_drafts`

**Files:**
- Modify: `firestore.rules` — add a rule block for `school_creation_drafts`.
- Test: smoke check (no test runner change; rules are validated by Firebase emulator tests in `firebase-tests/`, which require Java; we add a single rules test in the next task if the harness is wired)

**Why:** Drafts are owner-only — never readable or writable by anyone except the wizard's user. No cross-user access, no admin read (the draft is in-flight, not yet a request).

- [ ] **Step 1: Inspect current rules placement**

Open `firestore.rules` and locate the existing rule for `school_requests` (search for `match /school_requests/`). The new block goes next to it for locality.

- [ ] **Step 2: Add the rule**

Insert into `firestore.rules` (replace the value of `<<INSERT_NEAR_school_requests>>` with the actual position — anywhere inside `service cloud.firestore` and within `match /databases/{database}/documents`):

```
    match /school_creation_drafts/{uid} {
      allow read, write: if isUserOwner(uid);
    }
```

`isUserOwner` is defined at the top of `firestore.rules` (Plan 1+ codebase already uses it).

- [ ] **Step 3: Static deploy check**

Run: `firebase deploy --only firestore:rules --project lingu-480600 --dry-run` (if `firebase` CLI is installed).

Expected: Rules parse OK (no syntax error).

If `firebase` CLI is not available locally, the visual check suffices — the rule mirrors the proven pattern for `users/{uid}` ownership.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): school_creation_drafts is owner-only

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Frontend types for the wizard

**Files:**
- Create: `frontend/src/types/schoolRequest.ts` (move + extend the legacy `SchoolRequest` type)
- Modify: `frontend/src/types/index.ts` — re-export from the new file.

**Why:** The legacy `SchoolRequest` type in `frontend/src/types/index.ts` doesn't know about the enriched fields. We move it to a dedicated file so the wizard + the future Lingual admin panel (Plan 5) share a single shape.

- [ ] **Step 1: Inspect current type**

Open `frontend/src/types/index.ts` and search for `SchoolRequest`. Capture the existing fields so the new file is a strict superset.

- [ ] **Step 2: Create the new types file**

Create `frontend/src/types/schoolRequest.ts`:

```ts
// Plan 3 — admin wizard + school request shape.

export type SchoolType =
  | 'middle' | 'high' | 'k12' | 'university'
  | 'language_academy' | 'district' | 'other';

export type PublicPrivate = 'public' | 'private' | 'charter' | 'other';

export type GradeSize = '<50' | '50-100' | '100-200' | '200-500' | '500+';

export type CanvasIntegrationType =
  | 'lti13' | 'roster_sync' | 'grade_passback' | 'sso';

export type GradeRange =
  | 'k_2' | 'g3_5' | 'g6_8' | 'g9_12'
  | 'undergrad' | 'graduate' | 'adult_ed';

export type CourseFramework =
  | 'ap' | 'actfl' | 'cefr' | 'ib' | 'school_specific' | 'none';

export type RejectionCategory =
  | 'info_missing' | 'fraud_risk' | 'out_of_scope' | 'duplicate' | 'other';

export interface WizardLocation {
  country: string;
  state: string;
  county?: string;
}

export interface WizardAdminIdentityInput {
  fullName: string;
  schoolEmail: string;
  roleTitle: string;
  /** Client-side flag — the SERVER stamps the actual attestation record. */
  authorizationAttested: boolean;
}

export interface WizardAdminIdentityStored {
  fullName: string;
  schoolEmail: string;
  roleTitle: string;
  authorizationAttestation: {
    confirmedAt: string | null;
    ipHash: string | null;
    userAgent: string | null;
  };
}

export interface WizardIntegration {
  canvasUrl: string;
  canvasIntegrationTypes: CanvasIntegrationType[];
}

export interface WizardCurriculum {
  gradeRanges: GradeRange[];
  languagesTaught: string[];          // ISO codes like 'es', 'fr'
  courseFrameworks: CourseFramework[];
}

/** Payload sent from the wizard to POST /api/school-requests. */
export interface WizardSubmitPayload {
  schoolName: string;
  orgType: string;
  websiteUrl?: string;
  canvasInstanceUrl?: string;          // legacy thin field; kept for back-compat
  location?: WizardLocation;
  schoolType?: SchoolType;
  publicPrivate?: PublicPrivate;
  gradeSize?: GradeSize;
  officialEmailDomains?: string[];
  adminIdentity?: WizardAdminIdentityInput;
  integration?: WizardIntegration;
  curriculum?: WizardCurriculum;
  preInvitedTeachers?: string[];
}

/** Persisted draft as returned by GET /api/school-requests/draft. */
export interface WizardDraft {
  uid: string;
  currentStep: 1 | 2 | 3 | 4;
  draftPayload: Partial<WizardSubmitPayload>;
  updatedAt: string | null;
}

/** Full SchoolRequest shape — superset of the Plan 1 legacy shape. */
export interface SchoolRequest {
  id: string;
  requesterUid: string;
  requesterEmail: string;
  requesterName: string;
  schoolName: string;
  orgType: string;
  websiteUrl: string;
  canvasInstanceUrl: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedByUid: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  rejectionCategory: RejectionCategory | null;
  createdOrgId: string | null;
  createdAt: string | null;
  cancelledAt: string | null;

  // Enriched (may be absent on legacy thin rows)
  location?: WizardLocation | null;
  schoolType?: SchoolType | null;
  publicPrivate?: PublicPrivate | null;
  gradeSize?: GradeSize | null;
  officialEmailDomains?: string[];
  adminIdentity?: WizardAdminIdentityStored | null;
  integration?: { canvasUrl: string; canvasIntegrationTypes: CanvasIntegrationType[] } | null;
  curriculum?: WizardCurriculum | null;
  preInvitedTeachers?: string[];
}
```

- [ ] **Step 3: Update `frontend/src/types/index.ts`**

Remove the inline `SchoolRequest` interface (if present) and add a re-export:

```ts
export * from './schoolRequest';
```

If the inline interface was named differently or had additional consumers, do a `grep -rn 'SchoolRequest' frontend/src/` first and fix imports as needed — the goal is one canonical definition in `schoolRequest.ts`.

- [ ] **Step 4: Run frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors. If there are errors (e.g., consumers expected fields that the new shape no longer has), correct the consumers — do not regress the new shape.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/types/schoolRequest.ts
git commit -m "feat(types): SchoolRequest in its own file + wizard payload types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: API client functions for draft + cancel

**Files:**
- Modify: `frontend/src/api/schoolRequests.ts` — extend `submitSchoolRequest` to take a `WizardSubmitPayload`, add `getSchoolRequestDraft`, `saveSchoolRequestDraft`, `cancelMySchoolRequest`, and extend `rejectSchoolRequest` to accept a category.

**Why:** One canonical API module. We do not break the existing function signatures — `submitSchoolRequest` already takes a `SubmitSchoolRequestPayload`; we widen the type by intersecting it with the new optional fields.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/schoolRequests.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from './index';
import {
  getSchoolRequestDraft,
  saveSchoolRequestDraft,
  cancelMySchoolRequest,
  submitSchoolRequest,
  rejectSchoolRequest,
} from './schoolRequests';

vi.mock('./index', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('schoolRequests api', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
  });

  it('getSchoolRequestDraft GETs /school-requests/draft', async () => {
    mocked.get.mockResolvedValue({ data: { success: true, draft: null } });
    const out = await getSchoolRequestDraft();
    expect(mocked.get).toHaveBeenCalledWith('/school-requests/draft');
    expect(out).toBeNull();
  });

  it('saveSchoolRequestDraft PATCHes with the wizard step + payload', async () => {
    mocked.patch.mockResolvedValue({ data: { success: true } });
    await saveSchoolRequestDraft({
      currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
    });
    expect(mocked.patch).toHaveBeenCalledWith('/school-requests/draft', {
      currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
    });
  });

  it('cancelMySchoolRequest DELETEs /school-requests/mine', async () => {
    mocked.delete.mockResolvedValue({ data: { success: true } });
    await cancelMySchoolRequest();
    expect(mocked.delete).toHaveBeenCalledWith('/school-requests/mine');
  });

  it('submitSchoolRequest POSTs the full wizard payload', async () => {
    mocked.post.mockResolvedValue({
      data: { success: true, request: { id: 'r1', schoolName: 'SF Friends' } },
    });
    const req = await submitSchoolRequest({
      schoolName: 'SF Friends',
      orgType: 'school',
      schoolType: 'k12',
      adminIdentity: {
        fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
        roleTitle: 'Principal', authorizationAttested: true,
      },
    });
    expect(mocked.post).toHaveBeenCalledWith('/school-requests', expect.objectContaining({
      schoolName: 'SF Friends',
      schoolType: 'k12',
    }));
    expect(req.id).toBe('r1');
  });

  it('rejectSchoolRequest forwards the optional category', async () => {
    mocked.post.mockResolvedValue({ data: { success: true, request: { id: 'r2' } } });
    await rejectSchoolRequest('r2', 'Need more info', 'info_missing');
    expect(mocked.post).toHaveBeenCalledWith(
      '/admin/school-requests/r2/reject',
      { reason: 'Need more info', category: 'info_missing' },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/api/schoolRequests.test.ts`
Expected: imports for `getSchoolRequestDraft`, `saveSchoolRequestDraft`, `cancelMySchoolRequest` fail; `rejectSchoolRequest` does not forward `category`.

- [ ] **Step 3: Extend the API module**

Replace `frontend/src/api/schoolRequests.ts` with (only the existing exports are shown; preserve everything below the wizard block — teacher invites, etc.):

```ts
import api from './index';
import type {
  SchoolRequest,
  TeacherInvitation,
} from '@/types';
import type {
  WizardSubmitPayload,
  WizardDraft,
} from '@/types/schoolRequest';

// --- School request (teacher submits, Lingual admin reviews) ---

export type SubmitSchoolRequestPayload = WizardSubmitPayload;

export const submitSchoolRequest = async (
  payload: SubmitSchoolRequestPayload,
): Promise<SchoolRequest> => {
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    '/school-requests',
    payload,
  );
  return response.data.request;
};

export const getMySchoolRequest = async (): Promise<SchoolRequest | null> => {
  const response = await api.get<{ success: boolean; request: SchoolRequest | null }>(
    '/school-requests/mine',
  );
  return response.data.request;
};

export const cancelMySchoolRequest = async (): Promise<void> => {
  await api.delete('/school-requests/mine');
};

export const getSchoolRequestDraft = async (): Promise<WizardDraft | null> => {
  const response = await api.get<{ success: boolean; draft: WizardDraft | null }>(
    '/school-requests/draft',
  );
  return response.data.draft;
};

export const saveSchoolRequestDraft = async (input: {
  currentStep: 1 | 2 | 3 | 4;
  draftPayload: Partial<WizardSubmitPayload>;
}): Promise<void> => {
  await api.patch('/school-requests/draft', input);
};

// --- Admin review ---

export const listSchoolRequests = async (
  status?: string,
): Promise<SchoolRequest[]> => {
  const params = status ? { status } : undefined;
  const response = await api.get<{ success: boolean; requests: SchoolRequest[] }>(
    '/admin/school-requests',
    { params },
  );
  return response.data.requests;
};

export const approveSchoolRequest = async (
  id: string,
): Promise<SchoolRequest> => {
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    `/admin/school-requests/${id}/approve`,
  );
  return response.data.request;
};

export const rejectSchoolRequest = async (
  id: string,
  reason?: string,
  category?: string,
): Promise<SchoolRequest> => {
  const body: Record<string, unknown> = {};
  if (reason !== undefined) body.reason = reason;
  if (category !== undefined) body.category = category;
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    `/admin/school-requests/${id}/reject`,
    body,
  );
  return response.data.request;
};

// --- Teacher invite codes (UNCHANGED — preserve everything below this line) ---
```

Below `// --- Teacher invite codes ---`, leave the existing teacher-invite-code and teacher-invitation functions untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/api/schoolRequests.test.ts`
Expected: all tests pass.

Also: `cd frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/schoolRequests.ts frontend/src/api/schoolRequests.test.ts
git commit -m "feat(api): wizard draft, cancel, and rich submit payload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Wizard reducer (pure, testable)

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/wizardReducer.ts`
- Create: `frontend/src/pages/AdminOrgWizard/wizardReducer.test.ts`

**Why:** All wizard state lives in one `useReducer` at the shell level. The reducer is pure — no async, no DOM — so it's the simplest piece to TDD. Step components dispatch field changes; the shell handles autosave and submission.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/wizardReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  wizardReducer,
  initialWizardState,
  type WizardState,
} from './wizardReducer';

describe('wizardReducer', () => {
  it('starts with empty payload at step 1', () => {
    const state = initialWizardState();
    expect(state.currentStep).toBe(1);
    expect(state.payload).toEqual({});
    expect(state.touched).toEqual({});
  });

  it('SET_FIELD updates the payload by dotted path', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'SET_FIELD', path: 'schoolName', value: 'SF Friends',
    });
    expect(state.payload.schoolName).toBe('SF Friends');
    expect(state.touched.schoolName).toBe(true);
  });

  it('SET_FIELD handles nested paths like adminIdentity.fullName', () => {
    let state = initialWizardState();
    state = wizardReducer(state, {
      type: 'SET_FIELD', path: 'adminIdentity.fullName', value: 'Ada',
    });
    state = wizardReducer(state, {
      type: 'SET_FIELD', path: 'adminIdentity.schoolEmail', value: 'ada@x.test',
    });
    expect(state.payload.adminIdentity).toEqual({
      fullName: 'Ada',
      schoolEmail: 'ada@x.test',
    });
  });

  it('GOTO_STEP clamps to [1, 4]', () => {
    let state = initialWizardState();
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 0 });
    expect(state.currentStep).toBe(1);
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 99 });
    expect(state.currentStep).toBe(4);
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 3 });
    expect(state.currentStep).toBe(3);
  });

  it('LOAD_DRAFT replaces state', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'LOAD_DRAFT',
      draft: {
        uid: 'u',
        currentStep: 2,
        draftPayload: { schoolName: 'SF Friends' },
        updatedAt: null,
      },
    });
    expect(state.currentStep).toBe(2);
    expect(state.payload.schoolName).toBe('SF Friends');
  });

  it('SET_PRE_INVITE_TEACHERS replaces the list (dedup + lowercase + trim)', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: ['  Foo@X.test ', 'foo@x.test', 'bar@x.test', ''],
    });
    expect(state.payload.preInvitedTeachers).toEqual(['foo@x.test', 'bar@x.test']);
  });

  it('RESET returns to initial', () => {
    let state = wizardReducer(initialWizardState(), {
      type: 'SET_FIELD', path: 'schoolName', value: 'SF',
    });
    state = wizardReducer(state, { type: 'RESET' });
    expect(state.currentStep).toBe(1);
    expect(state.payload).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/wizardReducer.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/pages/AdminOrgWizard/wizardReducer.ts`:

```ts
import type { WizardDraft, WizardSubmitPayload } from '@/types/schoolRequest';

export type WizardStep = 1 | 2 | 3 | 4;

export interface WizardState {
  currentStep: WizardStep;
  payload: Partial<WizardSubmitPayload>;
  /** dotted-path → whether the user has interacted with that field */
  touched: Record<string, boolean>;
}

export type WizardAction =
  | { type: 'SET_FIELD'; path: string; value: unknown }
  | { type: 'GOTO_STEP'; step: number }
  | { type: 'LOAD_DRAFT'; draft: WizardDraft }
  | { type: 'SET_PRE_INVITE_TEACHERS'; emails: string[] }
  | { type: 'RESET' };

export function initialWizardState(): WizardState {
  return { currentStep: 1, payload: {}, touched: {} };
}

function clampStep(s: number): WizardStep {
  if (s < 1) return 1;
  if (s > 4) return 4;
  return s as WizardStep;
}

/**
 * Immutably set a value at a dotted path. **Object paths only** — does not
 * support array indices. The wizard's payload shape (`adminIdentity.fullName`,
 * `location.country`, `curriculum.gradeRanges` as a whole) only needs object
 * nesting. If a future field demands array writes, replace this with `lodash.set`
 * or extend with index parsing.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const next = { ...obj };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const prev = (cursor[k] as Record<string, unknown> | undefined) ?? {};
    cursor[k] = { ...prev };
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function dedupLower(emails: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_FIELD': {
      const payload = setByPath(
        state.payload as Record<string, unknown>,
        action.path,
        action.value,
      ) as Partial<WizardSubmitPayload>;
      return {
        ...state,
        payload,
        touched: { ...state.touched, [action.path]: true },
      };
    }
    case 'GOTO_STEP':
      return { ...state, currentStep: clampStep(action.step) };
    case 'LOAD_DRAFT':
      return {
        currentStep: clampStep(action.draft.currentStep),
        payload: { ...action.draft.draftPayload },
        touched: {},
      };
    case 'SET_PRE_INVITE_TEACHERS': {
      const next = dedupLower(action.emails);
      return {
        ...state,
        payload: { ...state.payload, preInvitedTeachers: next },
        touched: { ...state.touched, preInvitedTeachers: true },
      };
    }
    case 'RESET':
      return initialWizardState();
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/wizardReducer.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/wizardReducer.ts frontend/src/pages/AdminOrgWizard/wizardReducer.test.ts
git commit -m "feat(wizard): pure reducer + actions for the admin org wizard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: `WizardField`, `WizardProgress`, `WizardSidebar` (shared chrome)

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/WizardField.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardProgress.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardSidebar.tsx`
- Test: `frontend/src/pages/AdminOrgWizard/WizardChrome.test.tsx`

**Why:** Three small presentational pieces extracted up front so every step component depends on them, not on ad-hoc markup. Keeps each step focused on its fields.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/WizardChrome.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WizardField } from './WizardField';
import { WizardProgress } from './WizardProgress';
import { WizardSidebar } from './WizardSidebar';

describe('WizardField', () => {
  it('renders label and required marker', () => {
    render(
      <WizardField label="School name" required htmlFor="name">
        <input id="name" />
      </WizardField>,
    );
    expect(screen.getByLabelText(/school name/i)).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders helper text and error message', () => {
    render(
      <WizardField label="Email" helper="Use your school email" error="Required">
        <input />
      </WizardField>,
    );
    expect(screen.getByText('Use your school email')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('WizardProgress', () => {
  it('marks dots [done, done, current, todo] for current=3', () => {
    render(<WizardProgress current={3} total={4} />);
    const dots = screen.getAllByTestId(/^wizard-progress-dot-/);
    expect(dots).toHaveLength(4);
    expect(dots[0]).toHaveAttribute('data-state', 'done');
    expect(dots[1]).toHaveAttribute('data-state', 'done');
    expect(dots[2]).toHaveAttribute('data-state', 'current');
    expect(dots[3]).toHaveAttribute('data-state', 'todo');
  });
});

describe('WizardSidebar', () => {
  it('lists each step title and marks the current one', () => {
    render(
      <WizardSidebar
        steps={[
          { id: 1, title: 'Organization' },
          { id: 2, title: 'Admin' },
          { id: 3, title: 'Integration' },
          { id: 4, title: 'Review' },
        ]}
        currentStep={2}
      />,
    );
    expect(screen.getByText('Organization')).toBeInTheDocument();
    const current = screen.getByText('Admin').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardChrome.test.tsx`
Expected: modules not found.

- [ ] **Step 3: Implement the three components**

Create `frontend/src/pages/AdminOrgWizard/WizardField.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface WizardFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function WizardField({
  label, htmlFor, required, helper, error, children,
}: WizardFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
        {required && <span aria-hidden className="ml-1 text-red-600">*</span>}
      </label>
      {children}
      {helper && !error && (
        <p className="text-xs text-muted-foreground">{helper}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
```

Create `frontend/src/pages/AdminOrgWizard/WizardProgress.tsx`:

```tsx
export interface WizardProgressProps {
  current: number;
  total: number;
}

export function WizardProgress({ current, total }: WizardProgressProps) {
  const dots = [];
  for (let i = 1; i <= total; i++) {
    const state = i < current ? 'done' : i === current ? 'current' : 'todo';
    const color =
      state === 'done' ? 'bg-foreground'
      : state === 'current' ? 'bg-primary'
      : 'bg-muted';
    dots.push(
      <span
        key={i}
        data-testid={`wizard-progress-dot-${i}`}
        data-state={state}
        className={`h-2.5 w-8 rounded-full ${color}`}
        aria-label={`Step ${i} of ${total}`}
      />
    );
  }
  return (
    <div className="flex items-center gap-2" role="progressbar"
         aria-valuemin={1} aria-valuemax={total} aria-valuenow={current}>
      {dots}
    </div>
  );
}
```

Create `frontend/src/pages/AdminOrgWizard/WizardSidebar.tsx`:

```tsx
export interface WizardSidebarStep {
  id: number;
  title: string;
  subtitle?: string;
}

export interface WizardSidebarProps {
  steps: WizardSidebarStep[];
  currentStep: number;
}

export function WizardSidebar({ steps, currentStep }: WizardSidebarProps) {
  return (
    <nav aria-label="Wizard steps">
      <ol className="space-y-3">
        {steps.map((s) => {
          const isCurrent = s.id === currentStep;
          const isDone = s.id < currentStep;
          return (
            <li
              key={s.id}
              aria-current={isCurrent ? 'step' : undefined}
              className={
                'flex items-start gap-3 ' +
                (isCurrent
                  ? 'text-foreground font-semibold'
                  : isDone
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/70')
              }
            >
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full border text-xs ' +
                  (isCurrent
                    ? 'border-foreground bg-foreground text-background'
                    : isDone
                      ? 'border-foreground/60'
                      : 'border-muted-foreground/40')
                }
              >
                {isDone ? '✓' : s.id}
              </span>
              <div>
                <div className="text-sm">{s.title}</div>
                {s.subtitle && (
                  <div className="text-xs text-muted-foreground">{s.subtitle}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardChrome.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/
git commit -m "feat(wizard): WizardField + WizardProgress + WizardSidebar chrome

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Step 1 — Organization Identity

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx`

**Why:** First form. Each field reads from `state.payload`, writes via `dispatch({ type: 'SET_FIELD', path, value })`. The step exposes a `validate()` returning `{ ok, errors }` so the shell can gate the "Continue" button.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep1Organization, validateStep1 } from './WizardStep1Organization';

const noopDispatch = vi.fn();

describe('WizardStep1Organization', () => {
  it('renders all required fields with their current values', () => {
    render(
      <WizardStep1Organization
        state={{
          schoolName: 'SF Friends',
          websiteUrl: 'https://ssfs.org',
          schoolType: 'k12',
          publicPrivate: 'private',
          gradeSize: '50-100',
          location: { country: 'US', state: 'CA' },
        }}
        dispatch={noopDispatch}
      />,
    );
    expect(screen.getByLabelText(/organization name/i)).toHaveValue('SF Friends');
    expect(screen.getByLabelText(/website/i)).toHaveValue('https://ssfs.org');
    expect(screen.getByLabelText(/country/i)).toHaveValue('US');
    expect(screen.getByLabelText(/state/i)).toHaveValue('CA');
    expect(screen.getByDisplayValue('K-12')).toBeChecked();
    expect(screen.getByDisplayValue('Private')).toBeChecked();
    expect(screen.getByDisplayValue('50-100')).toBeChecked();
  });

  it('dispatches SET_FIELD on text input change', () => {
    const dispatch = vi.fn();
    render(<WizardStep1Organization state={{}} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/organization name/i), {
      target: { value: 'New School' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'schoolName', value: 'New School',
    });
  });

  it('dispatches SET_FIELD for nested location.country', () => {
    const dispatch = vi.fn();
    render(<WizardStep1Organization state={{}} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'CA' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'location.country', value: 'CA',
    });
  });
});

describe('validateStep1', () => {
  it('passes when all required fields are present', () => {
    expect(validateStep1({
      schoolName: 'SF Friends',
      websiteUrl: 'https://ssfs.org',
      location: { country: 'US', state: 'CA' },
      schoolType: 'k12',
      publicPrivate: 'private',
      gradeSize: '50-100',
    })).toEqual({ ok: true, errors: {} });
  });

  it('reports missing schoolName', () => {
    const r = validateStep1({});
    expect(r.ok).toBe(false);
    expect(r.errors.schoolName).toMatch(/required/i);
  });

  it('reports invalid website URL', () => {
    const r = validateStep1({ schoolName: 'X', websiteUrl: 'not-a-url' });
    expect(r.errors.websiteUrl).toMatch(/valid/i);
  });

  it('requires country and state', () => {
    const r = validateStep1({ schoolName: 'X', websiteUrl: 'https://ok.test' });
    expect(r.errors['location.country']).toBeDefined();
    expect(r.errors['location.state']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/AdminOrgWizard/WizardStep1Organization.tsx`:

```tsx
import type { WizardAction } from './wizardReducer';
import type {
  WizardSubmitPayload,
  SchoolType,
  PublicPrivate,
  GradeSize,
} from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep1Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
}

const SCHOOL_TYPES: { value: SchoolType; label: string }[] = [
  { value: 'middle', label: 'Middle school' },
  { value: 'high', label: 'High school' },
  { value: 'k12', label: 'K-12' },
  { value: 'university', label: 'University' },
  { value: 'language_academy', label: 'Language academy' },
  { value: 'district', label: 'District' },
  { value: 'other', label: 'Other' },
];

const PUBLIC_PRIVATE: { value: PublicPrivate; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'charter', label: 'Charter' },
  { value: 'other', label: 'Other' },
];

const GRADE_SIZES: GradeSize[] = ['<50', '50-100', '100-200', '200-500', '500+'];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

export function WizardStep1Organization({ state, dispatch }: WizardStep1Props) {
  const loc = state.location ?? { country: '', state: '' };
  return (
    <div className="space-y-5">
      <WizardField label="Organization name" required htmlFor="schoolName">
        <input
          id="schoolName"
          type="text"
          className="w-full rounded-md border px-3 py-2"
          value={state.schoolName ?? ''}
          onChange={(e) => setField(dispatch, 'schoolName', e.target.value)}
        />
      </WizardField>

      <WizardField label="Organization website" required htmlFor="websiteUrl">
        <input
          id="websiteUrl"
          type="url"
          placeholder="https://yourschool.org"
          className="w-full rounded-md border px-3 py-2"
          value={state.websiteUrl ?? ''}
          onChange={(e) => setField(dispatch, 'websiteUrl', e.target.value)}
        />
      </WizardField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <WizardField label="Country" required htmlFor="country">
          <input id="country" type="text" placeholder="US"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.country}
                 onChange={(e) => setField(dispatch, 'location.country', e.target.value)} />
        </WizardField>
        <WizardField label="State / Province" required htmlFor="state">
          <input id="state" type="text"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.state}
                 onChange={(e) => setField(dispatch, 'location.state', e.target.value)} />
        </WizardField>
        <WizardField label="County / District" htmlFor="county">
          <input id="county" type="text"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.county ?? ''}
                 onChange={(e) => setField(dispatch, 'location.county', e.target.value)} />
        </WizardField>
      </div>

      <WizardField label="School type" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SCHOOL_TYPES.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="schoolType" value={label}
                     checked={state.schoolType === value}
                     onChange={() => setField(dispatch, 'schoolType', value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Public / Private" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PUBLIC_PRIVATE.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="publicPrivate" value={label}
                     checked={state.publicPrivate === value}
                     onChange={() => setField(dispatch, 'publicPrivate', value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Grade size (students per grade level)" required
                   helper="Approximate is fine — used for capacity planning only.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {GRADE_SIZES.map((v) => (
            <label key={v} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="gradeSize" value={v}
                     checked={state.gradeSize === v}
                     onChange={() => setField(dispatch, 'gradeSize', v)} />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Official email domain(s)"
                   helper="Comma-separated. Used later to verify teacher signups.">
        <input
          type="text"
          placeholder="@ssfs.org, @school.edu"
          className="w-full rounded-md border px-3 py-2"
          value={(state.officialEmailDomains ?? []).join(', ')}
          onChange={(e) =>
            setField(dispatch, 'officialEmailDomains',
              e.target.value
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            )
          }
        />
      </WizardField>
    </div>
  );
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

export function validateStep1(state: Partial<WizardSubmitPayload>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!state.schoolName || state.schoolName.trim().length < 2) {
    errors.schoolName = 'Organization name is required.';
  }
  if (!state.websiteUrl) {
    errors.websiteUrl = 'Organization website is required.';
  } else if (!URL_RE.test(state.websiteUrl)) {
    errors.websiteUrl = 'Enter a valid URL (starting with https://).';
  }
  const loc = state.location ?? { country: '', state: '' };
  if (!loc.country) errors['location.country'] = 'Country is required.';
  if (!loc.state) errors['location.state'] = 'State / Province is required.';
  if (!state.schoolType) errors.schoolType = 'School type is required.';
  if (!state.publicPrivate) errors.publicPrivate = 'Public / Private is required.';
  if (!state.gradeSize) errors.gradeSize = 'Grade size is required.';
  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/WizardStep1Organization.tsx frontend/src/pages/AdminOrgWizard/WizardStep1Organization.test.tsx
git commit -m "feat(wizard): Step 1 — Organization Identity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Step 2 — Admin Identity & Authorization

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx`

**Why:** Admin identity is prefilled from the auth user but editable; the authorization checkbox is the critical hardening field — `validate` must fail unless it's checked.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep2Admin, validateStep2 } from './WizardStep2Admin';

describe('WizardStep2Admin', () => {
  it('renders prefilled admin identity', () => {
    render(
      <WizardStep2Admin
        state={{
          adminIdentity: {
            fullName: 'Ada Lovelace',
            schoolEmail: 'ada@ssfs.org',
            roleTitle: 'Principal',
            authorizationAttested: false,
          },
        }}
        orgNamePreview="SF Friends"
        dispatch={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText(/school email/i)).toHaveValue('ada@ssfs.org');
    expect(screen.getByLabelText(/role/i)).toHaveValue('Principal');
    expect(screen.getByText(/SF Friends/)).toBeInTheDocument();
  });

  it('dispatches SET_FIELD for adminIdentity.fullName', () => {
    const dispatch = vi.fn();
    render(<WizardStep2Admin state={{}} orgNamePreview="" dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Bob' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'adminIdentity.fullName', value: 'Bob',
    });
  });

  it('toggles authorization checkbox via dispatch', () => {
    const dispatch = vi.fn();
    render(<WizardStep2Admin state={{}} orgNamePreview="" dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /authorized/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'adminIdentity.authorizationAttested',
      value: true,
    });
  });
});

describe('validateStep2', () => {
  const ok = {
    adminIdentity: {
      fullName: 'Ada',
      schoolEmail: 'ada@ssfs.org',
      roleTitle: 'Principal',
      authorizationAttested: true,
    },
  };

  it('passes a complete payload', () => {
    expect(validateStep2(ok).ok).toBe(true);
  });

  it('requires authorization checkbox', () => {
    const r = validateStep2({
      adminIdentity: { ...ok.adminIdentity, authorizationAttested: false },
    });
    expect(r.ok).toBe(false);
    expect(r.errors['adminIdentity.authorizationAttested']).toMatch(/confirm/i);
  });

  it('requires fullName, schoolEmail, roleTitle', () => {
    const r = validateStep2({ adminIdentity: { authorizationAttested: true } as never });
    expect(r.errors['adminIdentity.fullName']).toBeDefined();
    expect(r.errors['adminIdentity.schoolEmail']).toBeDefined();
    expect(r.errors['adminIdentity.roleTitle']).toBeDefined();
  });

  it('rejects malformed email', () => {
    const r = validateStep2({
      adminIdentity: { ...ok.adminIdentity, schoolEmail: 'not-an-email' },
    });
    expect(r.errors['adminIdentity.schoolEmail']).toMatch(/valid/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/AdminOrgWizard/WizardStep2Admin.tsx`:

```tsx
import type { WizardAction } from './wizardReducer';
import type { WizardSubmitPayload } from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep2Props {
  state: Partial<WizardSubmitPayload>;
  /** Used inside the attestation copy: "I am authorized by [orgNamePreview]". */
  orgNamePreview: string;
  dispatch: (action: WizardAction) => void;
}

const ROLES = ['Teacher', 'Department chair', 'Principal', 'Vice Principal', 'IT admin', 'LMS admin', 'Other'];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

export function WizardStep2Admin({ state, orgNamePreview, dispatch }: WizardStep2Props) {
  const ai = state.adminIdentity ?? {
    fullName: '', schoolEmail: '', roleTitle: '', authorizationAttested: false,
  };
  return (
    <div className="space-y-5">
      <WizardField label="Your full name" required htmlFor="fullName">
        <input id="fullName" type="text"
               className="w-full rounded-md border px-3 py-2"
               value={ai.fullName ?? ''}
               onChange={(e) => setField(dispatch, 'adminIdentity.fullName', e.target.value)} />
      </WizardField>

      <WizardField label="Your school email" required htmlFor="schoolEmail"
                   helper="Use the email you'll log in with.">
        <input id="schoolEmail" type="email"
               className="w-full rounded-md border px-3 py-2"
               value={ai.schoolEmail ?? ''}
               onChange={(e) => setField(dispatch, 'adminIdentity.schoolEmail', e.target.value)} />
      </WizardField>

      <WizardField label="Your role / title" required htmlFor="roleTitle">
        <select id="roleTitle"
                className="w-full rounded-md border px-3 py-2"
                value={ai.roleTitle ?? ''}
                onChange={(e) => setField(dispatch, 'adminIdentity.roleTitle', e.target.value)}>
          <option value="" disabled>Pick one…</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </WizardField>

      <div className="rounded-md border-2 border-foreground bg-yellow-50 p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={!!ai.authorizationAttested}
            aria-label="I am authorized to manage this organization"
            onChange={(e) =>
              setField(dispatch, 'adminIdentity.authorizationAttested', e.target.checked)}
          />
          <span>
            I confirm that I am <strong>authorized by {orgNamePreview || 'this organization'}</strong> to
            create and manage it on Lingual. I understand that misrepresentation may result in account
            termination and is logged for audit.
          </span>
        </label>
      </div>
    </div>
  );
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateStep2(state: Partial<WizardSubmitPayload>): ValidationResult {
  const errors: Record<string, string> = {};
  const ai = state.adminIdentity ?? {} as Partial<NonNullable<WizardSubmitPayload['adminIdentity']>>;
  if (!ai.fullName) errors['adminIdentity.fullName'] = 'Full name is required.';
  if (!ai.schoolEmail) {
    errors['adminIdentity.schoolEmail'] = 'School email is required.';
  } else if (!EMAIL_RE.test(ai.schoolEmail)) {
    errors['adminIdentity.schoolEmail'] = 'Enter a valid email address.';
  }
  if (!ai.roleTitle) errors['adminIdentity.roleTitle'] = 'Role / title is required.';
  if (!ai.authorizationAttested) {
    errors['adminIdentity.authorizationAttested'] =
      'You must confirm you are authorized to create this organization.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/WizardStep2Admin.tsx frontend/src/pages/AdminOrgWizard/WizardStep2Admin.test.tsx
git commit -m "feat(wizard): Step 2 — Admin identity + authorization checkbox

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: Step 3 — Integration & Curriculum (skippable)

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx`

**Why:** Entirely optional. Canvas sub-section conditionally reveals the URL + integration types when "Yes" is selected. `validate` returns `{ ok: true }` whether the user fills it in or not.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep3Integration, validateStep3 } from './WizardStep3Integration';

describe('WizardStep3Integration', () => {
  it('hides Canvas fields by default', () => {
    render(<WizardStep3Integration state={{}} dispatch={vi.fn()} />);
    expect(screen.queryByLabelText(/canvas instance/i)).not.toBeInTheDocument();
  });

  it('shows Canvas fields when user picks "Yes"', () => {
    const dispatch = vi.fn();
    const { rerender } = render(<WizardStep3Integration state={{}} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText(/uses canvas: yes/i));
    rerender(
      <WizardStep3Integration
        state={{ integration: { canvasUrl: '', canvasIntegrationTypes: [] } }}
        dispatch={dispatch}
      />,
    );
    expect(screen.getByLabelText(/canvas instance/i)).toBeInTheDocument();
  });

  it('toggles canvasIntegrationTypes via dispatch', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep3Integration
        state={{ integration: { canvasUrl: 'x.instructure.com', canvasIntegrationTypes: [] } }}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByLabelText(/LTI 1.3 assignment launch/i));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'integration.canvasIntegrationTypes',
      value: ['lti13'],
    });
  });

  it('allows selecting multiple grade ranges (chip toggles)', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep3Integration
        state={{ curriculum: { gradeRanges: ['g6_8'], languagesTaught: [], courseFrameworks: [] } }}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /9–12/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'curriculum.gradeRanges',
      value: ['g6_8', 'g9_12'],
    });
  });
});

describe('validateStep3', () => {
  it('always passes (step is optional)', () => {
    expect(validateStep3({}).ok).toBe(true);
    expect(validateStep3({
      integration: { canvasUrl: 'x.instructure.com', canvasIntegrationTypes: ['lti13'] },
    }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/AdminOrgWizard/WizardStep3Integration.tsx`:

```tsx
import { useState } from 'react';
import type { WizardAction } from './wizardReducer';
import type {
  WizardSubmitPayload,
  CanvasIntegrationType,
  GradeRange,
  CourseFramework,
} from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep3Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
}

const CANVAS_TYPES: { value: CanvasIntegrationType; label: string }[] = [
  { value: 'lti13', label: 'LTI 1.3 assignment launch' },
  { value: 'roster_sync', label: 'Roster sync' },
  { value: 'grade_passback', label: 'Grade passback' },
  { value: 'sso', label: 'SSO only' },
];

const GRADE_RANGES: { value: GradeRange; label: string }[] = [
  { value: 'k_2', label: 'K–2' },
  { value: 'g3_5', label: '3–5' },
  { value: 'g6_8', label: '6–8' },
  { value: 'g9_12', label: '9–12' },
  { value: 'undergrad', label: 'Undergrad' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'adult_ed', label: 'Adult Ed' },
];

const FRAMEWORKS: { value: CourseFramework; label: string }[] = [
  { value: 'ap', label: 'AP' },
  { value: 'actfl', label: 'ACTFL' },
  { value: 'cefr', label: 'CEFR' },
  { value: 'ib', label: 'IB' },
  { value: 'school_specific', label: 'School-specific' },
  { value: 'none', label: 'None' },
];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function WizardStep3Integration({ state, dispatch }: WizardStep3Props) {
  const integration = state.integration;
  const [usesCanvas, setUsesCanvas] = useState<'yes' | 'no' | 'unknown' | null>(
    integration ? 'yes' : null,
  );
  const curriculum = state.curriculum ?? {
    gradeRanges: [], languagesTaught: [], courseFrameworks: [],
  };

  function chooseUsesCanvas(v: 'yes' | 'no' | 'unknown') {
    setUsesCanvas(v);
    if (v === 'yes' && !integration) {
      setField(dispatch, 'integration', { canvasUrl: '', canvasIntegrationTypes: [] });
    } else if (v !== 'yes' && integration) {
      setField(dispatch, 'integration', undefined);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Tell us how you teach. You can fill this in later from settings.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Integration</h3>
        <fieldset>
          <legend className="text-sm font-medium">Does your school use Canvas LMS?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['yes', 'no', 'unknown'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="usesCanvas"
                  aria-label={`Uses Canvas: ${opt}`}
                  checked={usesCanvas === opt}
                  onChange={() => chooseUsesCanvas(opt)}
                />
                <span className="capitalize">{opt}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {usesCanvas === 'yes' && (
          <div className="space-y-3 rounded-md border-2 border-foreground/40 bg-muted/30 p-4">
            <WizardField label="Canvas instance URL" htmlFor="canvasUrl"
                         helper="Example: ssfs.instructure.com">
              <input id="canvasUrl" type="text"
                     className="w-full rounded-md border px-3 py-2"
                     value={integration?.canvasUrl ?? ''}
                     onChange={(e) => setField(dispatch, 'integration.canvasUrl', e.target.value)} />
            </WizardField>
            <WizardField label="Integration types">
              <div className="space-y-1.5">
                {CANVAS_TYPES.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={integration?.canvasIntegrationTypes?.includes(value) ?? false}
                      onChange={() =>
                        setField(dispatch, 'integration.canvasIntegrationTypes',
                          toggleInList(integration?.canvasIntegrationTypes ?? [], value))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </WizardField>
          </div>
        )}
        {(usesCanvas === 'no' || usesCanvas === 'unknown') && (
          <p className="text-xs text-muted-foreground">
            Google Classroom and Schoology support coming soon.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Curriculum</h3>

        <WizardField label="Target student grade range">
          <div className="flex flex-wrap gap-2">
            {GRADE_RANGES.map(({ value, label }) => {
              const active = curriculum.gradeRanges.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setField(dispatch, 'curriculum.gradeRanges',
                      toggleInList(curriculum.gradeRanges, value))
                  }
                  className={
                    'rounded-full border px-3 py-1 text-sm ' +
                    (active ? 'bg-foreground text-background' : '')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </WizardField>

        <WizardField label="Languages taught" htmlFor="languages"
                     helper="Comma-separated ISO codes (es, fr, ko, etc.)">
          <input
            id="languages"
            type="text"
            className="w-full rounded-md border px-3 py-2"
            value={curriculum.languagesTaught.join(', ')}
            onChange={(e) =>
              setField(dispatch, 'curriculum.languagesTaught',
                e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
            }
          />
        </WizardField>

        <WizardField label="Course frameworks">
          <div className="flex flex-wrap gap-2">
            {FRAMEWORKS.map(({ value, label }) => {
              const active = curriculum.courseFrameworks.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setField(dispatch, 'curriculum.courseFrameworks',
                      toggleInList(curriculum.courseFrameworks, value))
                  }
                  className={
                    'rounded-full border px-3 py-1 text-sm ' +
                    (active ? 'bg-foreground text-background' : '')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </WizardField>
      </section>
    </div>
  );
}

export interface ValidationResult { ok: boolean; errors: Record<string, string>; }

export function validateStep3(_state: Partial<WizardSubmitPayload>): ValidationResult {
  // Step 3 is entirely optional; nothing to validate.
  return { ok: true, errors: {} };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/WizardStep3Integration.tsx frontend/src/pages/AdminOrgWizard/WizardStep3Integration.test.tsx
git commit -m "feat(wizard): Step 3 — Integration & curriculum (skippable)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: Step 4 — Review & Submit (with pre-invite teachers)

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep4Review.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/WizardStep4Review.test.tsx`

**Why:** Read-only summary of steps 1–3 (with "Edit" links that dispatch `GOTO_STEP`), a chip-style email input for pre-invites, and the actual submit button. The submit handler is passed in as a prop so the component stays presentational.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/WizardStep4Review.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep4Review } from './WizardStep4Review';

const baseState = {
  schoolName: 'SF Friends',
  websiteUrl: 'https://ssfs.org',
  schoolType: 'k12' as const,
  publicPrivate: 'private' as const,
  gradeSize: '50-100' as const,
  location: { country: 'US', state: 'CA' },
  adminIdentity: {
    fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
    roleTitle: 'Principal', authorizationAttested: true,
  },
};

describe('WizardStep4Review', () => {
  it('summarizes Step 1 and Step 2 values', () => {
    render(
      <WizardStep4Review
        state={baseState}
        dispatch={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    expect(screen.getByText('SF Friends')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
  });

  it('clicking Edit dispatches GOTO_STEP', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={dispatch}
                          onSubmit={vi.fn()} submitting={false} submitError={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit organization/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'GOTO_STEP', step: 1 });
  });

  it('adds pre-invite email when user presses Enter', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={dispatch}
                          onSubmit={vi.fn()} submitting={false} submitError={null} />,
    );
    const input = screen.getByLabelText(/teacher email/i);
    fireEvent.change(input, { target: { value: 'newteacher@ssfs.org' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: ['newteacher@ssfs.org'],
    });
  });

  it('calls onSubmit when the submit button is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={onSubmit} submitting={false} submitError={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /submit for lingual approval/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('disables submit while submitting', () => {
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={vi.fn()} submitting submitError={null} />,
    );
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
  });

  it('shows submit error when provided', () => {
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={vi.fn()} submitting={false}
                          submitError="Server is down" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Server is down');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep4Review.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/AdminOrgWizard/WizardStep4Review.tsx`:

```tsx
import { useState } from 'react';
import type { WizardAction } from './wizardReducer';
import type { WizardSubmitPayload } from '@/types/schoolRequest';

export interface WizardStep4Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}

function SectionHeader({ title, onEdit, editLabel }: { title: string; onEdit: () => void; editLabel: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <button type="button" onClick={onEdit}
              className="text-xs text-foreground/70 underline hover:text-foreground"
              aria-label={editLabel}>
        Edit
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function WizardStep4Review({
  state, dispatch, onSubmit, submitting, submitError,
}: WizardStep4Props) {
  const [pending, setPending] = useState('');
  const preInvites = state.preInvitedTeachers ?? [];

  function commitPending() {
    const v = pending.trim().toLowerCase();
    if (!v) return;
    setPending('');
    dispatch({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: [...preInvites, v],
    });
  }

  function removeInvite(email: string) {
    dispatch({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: preInvites.filter((e) => e !== email),
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader title="Organization"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 1 })}
                       editLabel="Edit Organization" />
        <dl>
          <Row label="Name" value={state.schoolName} />
          <Row label="Website" value={state.websiteUrl} />
          <Row label="Location" value={
            [state.location?.country, state.location?.state, state.location?.county]
              .filter(Boolean).join(', ')
          } />
          <Row label="Type" value={state.schoolType} />
          <Row label="Public / Private" value={state.publicPrivate} />
          <Row label="Grade size" value={state.gradeSize} />
          <Row label="Email domains" value={(state.officialEmailDomains ?? []).join(', ')} />
        </dl>
      </section>

      <section>
        <SectionHeader title="Admin"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 2 })}
                       editLabel="Edit Admin" />
        <dl>
          <Row label="Name" value={state.adminIdentity?.fullName} />
          <Row label="Email" value={state.adminIdentity?.schoolEmail} />
          <Row label="Role" value={state.adminIdentity?.roleTitle} />
          <Row label="Authorized" value={state.adminIdentity?.authorizationAttested ? 'Confirmed' : '—'} />
        </dl>
      </section>

      <section>
        <SectionHeader title="Integration & curriculum"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 3 })}
                       editLabel="Edit Integration" />
        <dl>
          <Row label="Canvas URL" value={state.integration?.canvasUrl} />
          <Row label="Integration types"
               value={(state.integration?.canvasIntegrationTypes ?? []).join(', ')} />
          <Row label="Grade ranges" value={(state.curriculum?.gradeRanges ?? []).join(', ')} />
          <Row label="Languages" value={(state.curriculum?.languagesTaught ?? []).join(', ')} />
          <Row label="Frameworks" value={(state.curriculum?.courseFrameworks ?? []).join(', ')} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Pre-invite teachers (optional)</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          These addresses will receive an invitation email automatically once Lingual approves your school.
        </p>
        <div className="flex flex-wrap gap-1.5 rounded-md border px-2 py-2">
          {preInvites.map((email) => (
            <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {email}
              <button type="button" onClick={() => removeInvite(email)}
                      aria-label={`Remove ${email}`} className="text-muted-foreground hover:text-foreground">
                ×
              </button>
            </span>
          ))}
          <input
            type="email"
            aria-label="Teacher email"
            className="flex-1 min-w-[140px] border-0 bg-transparent text-sm outline-none"
            placeholder="teacher@school.edu"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onBlur={commitPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitPending();
              }
            }}
          />
        </div>
      </section>

      {submitError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="w-full rounded-md border-2 border-foreground bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit for Lingual approval'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/WizardStep4Review.test.tsx`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/WizardStep4Review.tsx frontend/src/pages/AdminOrgWizard/WizardStep4Review.test.tsx
git commit -m "feat(wizard): Step 4 — review, pre-invite chips, submit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 27: `AdminOrgWizardPage` shell

**Files:**
- Create: `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.tsx`
- Create: `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx`

**Why:** The page that ties everything together. Owns the reducer, loads the draft on mount, syncs `currentStep` to the URL `?step=N`, debounces autosave to PATCH `/draft`, handles the submit. Steps are pure components driven by `state`/`dispatch`. The shell uses `useNavigate` for step transitions and post-submit redirect.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminOrgWizardPage } from './AdminOrgWizardPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const getDraftMock = vi.fn();
const saveDraftMock = vi.fn();
const submitMock = vi.fn();

vi.mock('@/api/schoolRequests', () => ({
  getSchoolRequestDraft: (...args: unknown[]) => getDraftMock(...args),
  saveSchoolRequestDraft: (...args: unknown[]) => saveDraftMock(...args),
  submitSchoolRequest: (...args: unknown[]) => submitMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'uid-1', email: 'ada@ssfs.org', name: 'Ada Lovelace' },
    refreshUser: vi.fn(),
  }),
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup/admin/org-wizard" element={<AdminOrgWizardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminOrgWizardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateMock.mockReset();
    getDraftMock.mockReset().mockResolvedValue(null);
    saveDraftMock.mockReset().mockResolvedValue(undefined);
    submitMock.mockReset();
  });

  it('starts at Step 1 by default', async () => {
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
  });

  it('loads the saved draft on mount', async () => {
    getDraftMock.mockResolvedValueOnce({
      uid: 'uid-1', currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
      updatedAt: null,
    });
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/organization name/i)).not.toBeInTheDocument();
  });

  it('syncs URL with current step when Continue is clicked', async () => {
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'SF' } });
    fireEvent.change(screen.getByLabelText(/website/i), { target: { value: 'https://sf.org' } });
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText(/state/i), { target: { value: 'CA' } });
    fireEvent.click(screen.getByDisplayValue('K-12'));
    fireEvent.click(screen.getByDisplayValue('Private'));
    fireEvent.click(screen.getByDisplayValue('50-100'));

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('step=2'),
      expect.anything(),
    );
  });

  it('debounces autosave (one PATCH after the user stops typing for 800ms)', async () => {
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'AB' } });
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'ABC' } });

    expect(saveDraftMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    const lastCall = saveDraftMock.mock.calls[0][0];
    expect(lastCall.draftPayload.schoolName).toBe('ABC');
  });

  it('navigates to /signup/admin/pending after a successful submit', async () => {
    submitMock.mockResolvedValueOnce({ id: 'req-1' });
    getDraftMock.mockResolvedValueOnce({
      uid: 'uid-1', currentStep: 4,
      draftPayload: {
        schoolName: 'SF Friends', websiteUrl: 'https://sf.org',
        schoolType: 'k12', publicPrivate: 'private', gradeSize: '50-100',
        location: { country: 'US', state: 'CA' },
        adminIdentity: {
          fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
          roleTitle: 'Principal', authorizationAttested: true,
        },
      },
      updatedAt: null,
    });
    renderAt('/signup/admin/org-wizard?step=4');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /submit for lingual approval/i }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/signup/admin/pending', expect.anything()),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the shell**

Create `frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.tsx`:

```tsx
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  getSchoolRequestDraft,
  saveSchoolRequestDraft,
  submitSchoolRequest,
} from '@/api/schoolRequests';
import type { WizardSubmitPayload } from '@/types/schoolRequest';
import {
  wizardReducer,
  initialWizardState,
  type WizardStep,
} from './wizardReducer';
import { WizardProgress } from './WizardProgress';
import { WizardSidebar } from './WizardSidebar';
import {
  WizardStep1Organization,
  validateStep1,
} from './WizardStep1Organization';
import { WizardStep2Admin, validateStep2 } from './WizardStep2Admin';
import { WizardStep3Integration, validateStep3 } from './WizardStep3Integration';
import { WizardStep4Review } from './WizardStep4Review';

const STEPS = [
  { id: 1, title: 'Organization', subtitle: 'Name, website, location' },
  { id: 2, title: 'Admin', subtitle: 'Your identity & authorization' },
  { id: 3, title: 'Integration', subtitle: 'Optional — Canvas & curriculum' },
  { id: 4, title: 'Review', subtitle: 'Confirm & submit' },
];

const AUTOSAVE_DEBOUNCE_MS = 800;

function parseStep(raw: string | null): WizardStep {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 4) return 4;
  return n as WizardStep;
}

export function AdminOrgWizardPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 1. Load the draft on mount (or prefill from auth user)
  //    Effect runs once on mount; we deliberately do not depend on `user`
  //    because re-running this on every user-context change would clobber
  //    in-progress edits with the seed payload again. Refreshes to the user
  //    happen in AdminPendingPage, not here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const draft = await getSchoolRequestDraft();
        if (cancelled) return;
        if (draft) {
          dispatch({ type: 'LOAD_DRAFT', draft });
          // Sync the URL to the loaded step so a refresh resumes here too.
          const urlStep = parseStep(params.get('step'));
          if (urlStep !== draft.currentStep) {
            const next = new URLSearchParams(params);
            next.set('step', String(draft.currentStep));
            setParams(next, { replace: true });
          }
        } else if (user) {
          // User.name is the canonical type field (see frontend/src/types/index.ts).
          // Fall back to the local-part of the email if name is empty.
          const fallbackName =
            user.name && user.name.trim().length > 0
              ? user.name
              : (user.email ? user.email.split('@')[0] : '');
          const seed: Partial<WizardSubmitPayload> = {
            adminIdentity: {
              fullName: fallbackName,
              schoolEmail: user.email ?? '',
              roleTitle: '',
              authorizationAttested: false,
            },
          };
          dispatch({
            type: 'LOAD_DRAFT',
            draft: { uid: user.uid ?? '', currentStep: 1, draftPayload: seed, updatedAt: null },
          });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. URL step → reducer. One-way binding: URL is canonical for navigation
  //    (so browser back/forward works), the reducer is canonical for data.
  //    We don't depend on state.currentStep here — that would create a loop
  //    when gotoStep below pushes URL and the reducer in the same turn.
  useEffect(() => {
    const urlStep = parseStep(params.get('step'));
    if (loaded && urlStep !== state.currentStep) {
      dispatch({ type: 'GOTO_STEP', step: urlStep });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loaded]);

  // 3. Autosave (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSchoolRequestDraft({
        currentStep: state.currentStep,
        draftPayload: state.payload,
      }).catch((exc) => console.warn('[wizard] autosave failed', exc));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, loaded]);

  function gotoStep(step: WizardStep) {
    const next = new URLSearchParams(params);
    next.set('step', String(step));
    setParams(next, { replace: false });
    dispatch({ type: 'GOTO_STEP', step });
  }

  const validation = useMemo(() => {
    switch (state.currentStep) {
      case 1: return validateStep1(state.payload);
      case 2: return validateStep2(state.payload);
      case 3: return validateStep3(state.payload);
      default: return { ok: true, errors: {} as Record<string, string> };
    }
  }, [state.currentStep, state.payload]);

  async function handleSubmit() {
    // Cancel any pending autosave so it can't fire after submission deletes
    // the draft and recreate a phantom row.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Required fields enforced one more time at submit
      const v1 = validateStep1(state.payload);
      const v2 = validateStep2(state.payload);
      if (!v1.ok) {
        setSubmitError('Some Step 1 fields are missing. Please go back and complete them.');
        return;
      }
      if (!v2.ok) {
        setSubmitError('Please complete the admin identity and authorization in Step 2.');
        return;
      }
      await submitSchoolRequest({
        schoolName: state.payload.schoolName!,
        orgType: 'school',
        websiteUrl: state.payload.websiteUrl,
        location: state.payload.location,
        schoolType: state.payload.schoolType,
        publicPrivate: state.payload.publicPrivate,
        gradeSize: state.payload.gradeSize,
        officialEmailDomains: state.payload.officialEmailDomains,
        adminIdentity: state.payload.adminIdentity,
        integration: state.payload.integration,
        curriculum: state.payload.curriculum,
        preInvitedTeachers: state.payload.preInvitedTeachers,
      });
      navigate('/signup/admin/pending', { replace: true });
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : 'Submission failed.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-8 md:grid-cols-[200px_1fr]">
        <aside className="hidden md:block">
          <WizardSidebar steps={STEPS} currentStep={state.currentStep} />
        </aside>
        <main className="space-y-6">
          <header className="space-y-3">
            <h1 className="text-2xl font-display font-bold">Register your school</h1>
            <WizardProgress current={state.currentStep} total={4} />
          </header>

          <section className="rounded-lg border-2 border-foreground bg-card p-6 shadow-stamp-sm">
            {state.currentStep === 1 && (
              <WizardStep1Organization state={state.payload} dispatch={dispatch} />
            )}
            {state.currentStep === 2 && (
              <WizardStep2Admin
                state={state.payload}
                orgNamePreview={state.payload.schoolName ?? ''}
                dispatch={dispatch}
              />
            )}
            {state.currentStep === 3 && (
              <WizardStep3Integration state={state.payload} dispatch={dispatch} />
            )}
            {state.currentStep === 4 && (
              <WizardStep4Review
                state={state.payload}
                dispatch={dispatch}
                onSubmit={handleSubmit}
                submitting={submitting}
                submitError={submitError}
              />
            )}
          </section>

          {state.currentStep < 4 && (
            <footer className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => gotoStep((Math.max(1, state.currentStep - 1)) as WizardStep)}
                disabled={state.currentStep === 1}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => gotoStep((state.currentStep + 1) as WizardStep)}
                disabled={!validation.ok}
                className="rounded-md border-2 border-foreground bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Save & Continue →
              </button>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}
```

Note: this depends on the existing `@/hooks/useAuth` returning `{ user: User | null, refreshUser: () => Promise<void> }`. Plan 1 established that shape (`AuthContext.tsx:29` and `AuthContext.tsx:90`). The `User` type field is `name`, not `displayName` — the seed above is already correct. If a future User shape adds a richer display name field, prefer it in the fallback chain.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx`
Expected: all 5 tests pass.

If the autosave debounce test is flaky, ensure `vi.useFakeTimers()` is set before render and that `act` wraps `vi.advanceTimersByTime`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.tsx frontend/src/pages/AdminOrgWizard/AdminOrgWizardPage.test.tsx
git commit -m "feat(wizard): AdminOrgWizardPage shell with autosave + URL sync

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 28: `AdminPendingPage` — awaiting Lingual approval

**Files:**
- Create: `frontend/src/pages/AdminPendingPage.tsx`
- Create: `frontend/src/pages/AdminPendingPage.test.tsx`

**Why:** Polls `getMySchoolRequest()` every 30 seconds. On `approved` it must first call `useAuth().refreshUser()` so the local session picks up the new `school_admin` membership and `onboarding_state='complete'`, THEN navigate to `/app/teacher` (school admins share the teacher home until Plan 5 introduces `/app/admin` — matches the temp convention in `homeRoutes.ts` set by Plan 2). On `rejected`, displays the reason. On `cancelled` or missing, redirects back to the wizard.

> **Important:** without `refreshUser()`, the user's local `useAuth().user` is the stale signup payload (no memberships, `onboarding_state='awaiting_lingual'`). Navigating to a protected route with that stale context will bounce the user through `getOnboardingDestination` back to the wizard — an infinite loop. Always refresh, then navigate.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/AdminPendingPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPendingPage } from './AdminPendingPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const getMineMock = vi.fn();
const cancelMineMock = vi.fn();
const refreshUserMock = vi.fn();

vi.mock('@/api/schoolRequests', () => ({
  getMySchoolRequest: (...args: unknown[]) => getMineMock(...args),
  cancelMySchoolRequest: (...args: unknown[]) => cancelMineMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'uid-1', email: 'ada@ssfs.org', name: 'Ada' },
    refreshUser: (...args: unknown[]) => refreshUserMock(...args),
  }),
}));

function renderPage() {
  return render(<MemoryRouter><AdminPendingPage /></MemoryRouter>);
}

describe('AdminPendingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateMock.mockReset();
    getMineMock.mockReset();
    cancelMineMock.mockReset().mockResolvedValue(undefined);
    refreshUserMock.mockReset().mockResolvedValue(undefined);
  });

  it('shows the pending state with the school name', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'pending', schoolName: 'SF Friends',
      requesterEmail: 'ada@ssfs.org',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/SF Friends/)).toBeInTheDocument());
    expect(screen.getByText(/awaiting/i)).toBeInTheDocument();
  });

  it('redirects to the wizard when no request exists', async () => {
    getMineMock.mockResolvedValue(null);
    renderPage();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/signup/admin/org-wizard', expect.anything()),
    );
  });

  it('refreshes user then redirects to /app/teacher when status becomes approved', async () => {
    getMineMock
      .mockResolvedValueOnce({ id: 'r1', status: 'pending', schoolName: 'SF Friends' })
      .mockResolvedValueOnce({ id: 'r1', status: 'approved', schoolName: 'SF Friends' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/SF Friends/)).toBeInTheDocument());
    await act(async () => { vi.advanceTimersByTime(31000); });
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/app/teacher', expect.anything()),
    );
    // refreshUser must be called before navigate so the protected route sees
    // the new membership and onboarding_state.
    const refreshOrder = refreshUserMock.mock.invocationCallOrder[0];
    const teacherCall = navigateMock.mock.calls.findIndex(
      (c) => c[0] === '/app/teacher',
    );
    const navigateOrder = navigateMock.mock.invocationCallOrder[teacherCall];
    expect(refreshOrder).toBeLessThan(navigateOrder);
  });

  it('shows decline reason when rejected', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'rejected', schoolName: 'SF Friends',
      rejectionReason: 'Website not reachable.',
      rejectionCategory: 'info_missing',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Website not reachable/)).toBeInTheDocument());
  });

  it('cancels the request and navigates to the wizard', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'pending', schoolName: 'SF Friends',
    });
    renderPage();
    await waitFor(() => screen.getByText(/SF Friends/));
    fireEvent.click(screen.getByRole('button', { name: /cancel request/i }));
    await waitFor(() => expect(cancelMineMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/signup/admin/org-wizard', expect.anything());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/pages/AdminPendingPage.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/AdminPendingPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMySchoolRequest,
  cancelMySchoolRequest,
} from '@/api/schoolRequests';
import { useAuth } from '@/hooks/useAuth';
import type { SchoolRequest } from '@/types/schoolRequest';

const POLL_MS = 30_000;

export function AdminPendingPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [req, setReq] = useState<SchoolRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh(initial = false) {
    try {
      const next = await getMySchoolRequest();
      if (next === null) {
        navigate('/signup/admin/org-wizard', { replace: true });
        return;
      }
      setReq(next);
      if (next.status === 'approved') {
        // Refresh the local session FIRST so AppProtectedRoute and the
        // dispatcher see the new school_admin membership + onboarding_state.
        // Then send the user to the school-admin landing (currently shared
        // with /app/teacher per the Plan 2 temp convention).
        await refreshUser();
        navigate('/app/teacher', { replace: true });
        return;
      }
      if (next.status === 'cancelled') {
        navigate('/signup/admin/org-wizard', { replace: true });
        return;
      }
    } catch (exc) {
      console.warn('[pending] poll failed', exc);
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    timer.current = setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCancel() {
    if (!req || req.status !== 'pending') return;
    setCancelling(true);
    try {
      await cancelMySchoolRequest();
      navigate('/signup/admin/org-wizard', { replace: true });
    } catch (exc) {
      console.warn('[pending] cancel failed', exc);
      setCancelling(false);
    }
  }

  if (loading || !req) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (req.status === 'rejected') {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-6 py-10">
        <h1 className="text-2xl font-bold">School registration needs more info</h1>
        <p>We weren't able to approve <strong>{req.schoolName}</strong> as submitted.</p>
        {req.rejectionReason && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm">
            <div className="font-semibold">Reviewer notes</div>
            <div className="mt-1">{req.rejectionReason}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => navigate('/signup/admin/org-wizard')}
                  className="rounded-md border-2 border-foreground bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Edit and resubmit
          </button>
          <a href="mailto:support@lingual.app"
             className="rounded-md border px-4 py-2 text-sm">
            Contact support
          </a>
        </div>
      </div>
    );
  }

  // Pending UI
  return (
    <div className="mx-auto max-w-xl space-y-5 px-6 py-10">
      <h1 className="text-2xl font-bold">Awaiting Lingual approval</h1>
      <p><strong>{req.schoolName}</strong> was submitted{req.createdAt ? ` on ${new Date(req.createdAt).toLocaleDateString()}` : ''}.</p>
      <p className="text-sm text-muted-foreground">
        We usually review within 24 hours. We'll email you at <strong>{req.requesterEmail}</strong> when a decision is made.
      </p>
      {(req.preInvitedTeachers && req.preInvitedTeachers.length > 0) && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">Pre-invited teachers</div>
          <ul className="list-disc pl-5">
            {req.preInvitedTeachers.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => navigate('/signup/admin/org-wizard')}
                className="rounded-md border px-4 py-2 text-sm">
          Edit request
        </button>
        <button type="button" onClick={handleCancel} disabled={cancelling}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-60">
          {cancelling ? 'Cancelling…' : 'Cancel request'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/pages/AdminPendingPage.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminPendingPage.tsx frontend/src/pages/AdminPendingPage.test.tsx
git commit -m "feat(wizard): AdminPendingPage with polling + cancel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 29: Wire the wizard into `App.tsx`; remove placeholder

**Files:**
- Modify: `frontend/src/App.tsx` — swap the placeholder import for the real wizard; add `/signup/admin/pending`.
- Delete: `frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx`

**Why:** Until this lands, the new wizard is dead code. We make the swap atomically: same lazy-import shape, same route guard, same suspense wrapper as the placeholder. The legacy `/school/setup` → `/signup/admin/org-wizard` redirect from Plan 2 keeps working.

- [ ] **Step 1: Read the current routes block**

Open `frontend/src/App.tsx` and confirm:
- Line ~20 has `const AdminOrgWizardPlaceholderPage = lazy(...)`.
- Line ~89 has `<Route path="/signup/admin/org-wizard" element={withRouteSuspense(<AdminOrgWizardPlaceholderPage />)} />`.

- [ ] **Step 2: Make the swap**

Replace the lazy import line:

```ts
const AdminOrgWizardPlaceholderPage = lazy(() => import('./pages/AdminOrgWizardPlaceholderPage').then((module) => ({ default: module.AdminOrgWizardPlaceholderPage })));
```

with:

```ts
const AdminOrgWizardPage = lazy(() => import('./pages/AdminOrgWizard/AdminOrgWizardPage').then((module) => ({ default: module.AdminOrgWizardPage })));
const AdminPendingPage = lazy(() => import('./pages/AdminPendingPage').then((module) => ({ default: module.AdminPendingPage })));
```

Replace the route line:

```tsx
<Route path="/signup/admin/org-wizard" element={withRouteSuspense(<AdminOrgWizardPlaceholderPage />)} />
```

with:

```tsx
<Route path="/signup/admin/org-wizard" element={withRouteSuspense(<AdminOrgWizardPage />)} />
<Route path="/signup/admin/pending" element={withRouteSuspense(<AdminPendingPage />)} />
```

- [ ] **Step 3: Delete the placeholder file**

```bash
rm frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx
```

If the file is referenced anywhere else, the next step (`tsc --noEmit`) will surface it.

- [ ] **Step 4: Confirm type-check, tests, and build all pass**

Run in order:
- `cd frontend && npx tsc --noEmit`  → no errors
- `cd frontend && npm run test -- --run`  → all tests pass
- `cd frontend && npm run build`  → builds clean

If there is a stale import for `AdminOrgWizardPlaceholderPage` outside `App.tsx`, fix it (likely just removing the import and any unused reference).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx
git commit -m "feat(routing): wire real AdminOrgWizardPage and add /signup/admin/pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 30: Remove dead pages (`SchoolOnboardingPage`, `SchoolRequestPage`)

**Files:**
- Delete: `frontend/src/pages/SchoolOnboardingPage.tsx`
- Delete: `frontend/src/pages/SchoolRequestPage.tsx`

**Why:** Spec §4 explicitly calls for these to be deleted. Both are now superseded — `/school/setup` redirects to the new wizard (Plan 2), and `SchoolOnboardingPage.tsx` was never wired into any route. Removing them shrinks the surface area for the Lingual admin panel refactor in Plan 5.

- [ ] **Step 1: Confirm neither file is referenced from a live route or import**

Run:

```bash
grep -rn "SchoolRequestPage\|SchoolOnboardingPage" frontend/src/ | grep -v '\.test\.tsx'
```

Expected: the only matches should be the files themselves and possibly a comment. If you find a live `<Route>` or lazy import elsewhere, address it before deleting (most likely it's an unused import that should be removed in the same commit).

- [ ] **Step 2: Delete the files**

```bash
rm frontend/src/pages/SchoolOnboardingPage.tsx
rm frontend/src/pages/SchoolRequestPage.tsx
```

- [ ] **Step 3: Re-run the full frontend test + type-check**

Run:
- `cd frontend && npx tsc --noEmit`
- `cd frontend && npm run test -- --run`
- `cd frontend && npm run build`

Expected: clean.

If `tsc` complains about a missing identifier, find and remove that orphaned import.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SchoolOnboardingPage.tsx frontend/src/pages/SchoolRequestPage.tsx
git commit -m "chore(cleanup): delete SchoolOnboardingPage and SchoolRequestPage (dead code)

Both pages are superseded by the new admin wizard. SchoolOnboardingPage was
never wired into a route; SchoolRequestPage's URL now redirects to the wizard
via /school/setup -> /signup/admin/org-wizard (set up in Plan 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 31: Update TASKS.md and LIMITATIONS.md

**Files:**
- Modify: `docs/school-integration/TASKS.md` — tick the wizard items.
- Modify: `docs/school-integration/LIMITATIONS.md` — note draft TTL behavior and best-effort pre-invite emails.

**Why:** Plan 3 is the user-visible piece of the onboarding spec; the school-integration documents must reflect what shipped before Plan 4 starts.

- [ ] **Step 1: Mark TASKS.md items complete**

Open `docs/school-integration/TASKS.md` and find the Phase 2 / Phase 3 items related to "admin wizard", "school registration", "draft autosave", "pre-invite teachers", "approve/decline emails". Convert `[ ]` or `[-]` to `[x]` for items that shipped in Plan 3. Add new `[x]` lines if the spec calls for them but TASKS.md does not yet enumerate them. Use the existing TASKS.md style (`[x] short description`).

Example additions (only if not already present):

```
- [x] Admin org wizard — 4-step form with autosave draft
- [x] Authorization attestation with server-stamped IP hash + UA
- [x] Pre-invite teachers list on submit; auto-invitations on approval
- [x] Approval / decline transactional emails via outbox
```

- [ ] **Step 2: Append LIMITATIONS.md entries**

Open `docs/school-integration/LIMITATIONS.md` and append five entries to the existing numbered list (use the next free numbers; the literals `N` through `N+4` below are placeholders — replace with the actual next sequence numbers in the file):

```
N. **Wizard draft has no TTL.** A `school_creation_drafts/{uid}` document
   lives until the user either submits successfully (route deletes it) or
   cancels the in-flight request. Stale drafts persist indefinitely.

N+1. **Pre-invite emails are best-effort at approval time.** The approve
     route enqueues one `teacher_invitation` outbox doc per email and one
     `school_request_approved` doc to the requester. Failures to enqueue
     are logged but do not block the approval response — the membership,
     org, and `teacher_invitations/` rows are written first.

N+2. **`school_creation_drafts` rules are not under automated coverage in
     this plan.** Task 18 added the owner-only rule but the Firebase
     emulator test suite (`firebase-tests/`, Java required) was not
     extended. The rule mirrors the existing `users/{uid}` ownership
     pattern; a follow-up should add a rules test once a Java-enabled CI
     runner is available.

N+3. **DB column names diverge from spec naming for decline / reject.**
     Design spec §4 names `decline_reason` / `decline_category` on
     `school_requests`. The implementation kept the pre-existing column
     names `rejection_reason` / `rejection_category` to avoid migrating
     historical rows. API responses use camelCase `rejectionReason` /
     `rejectionCategory`. User-facing UI copy still says "Declined".
     Future readers grepping for `decline_reason` will not find it.

N+4. **Admin wizard is English-only.** Wizard labels, helper text, and
     the three new email templates (`school_request_approved`,
     `school_request_declined`, `teacher_invitation`) ship in English
     only. `LanguageProvider` (en/ko) covers the learner app but is not
     threaded through the wizard. Acceptable for v1 (admin audience is
     US schools); revisit when expanding outside the US.
```

- [ ] **Step 3: Commit**

```bash
git add docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(school-integration): record Plan 3 shipped state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 32: End-to-end smoke test (manual)

**Files:** none (manual verification)

**Why:** Backend tests + Vitest cover units. A 10-minute manual walk-through catches regressions across the stack: signup, wizard, draft, submit, Lingual approve, pending → dashboard transition, outbox.

- [ ] **Step 1: Run the stack locally**

In two terminals:

```bash
# Terminal 1 — backend
PORT=5001 FLASK_ENV=development python main.py

# Terminal 2 — frontend
cd frontend && npm run dev
```

Visit http://localhost:5173/.

- [ ] **Step 2: Walk through the happy path**

1. Click "I'm a School Administrator" on the landing CTA → arrive at `/signup?role=admin`.
2. Continue → Step 2 of signup → create account with email + password.
3. After verify, you should land at `/signup/admin/org-wizard?step=1` (or step from saved draft).
4. Fill Step 1, click Continue → URL becomes `?step=2`, sidebar marks Step 1 done.
5. Fill Step 2 including the authorization checkbox.
6. Step 3 — leave blank, hit Continue (skippable).
7. Step 4 — verify the summary, add one pre-invite email, click "Submit for Lingual approval".
8. Land on `/signup/admin/pending`. Confirm the school name and pre-invite list render.

- [ ] **Step 3: Verify the outbox doc was written**

Either via Firestore emulator UI or via gcloud:

```bash
# Firestore emulator (if running)
curl http://localhost:8080/v1/projects/lingu-480600/databases/(default)/documents/outbox_emails
```

Expected: exactly one `school_request_to_lingual` doc with the requester's school name in `template_data.org_name`.

- [ ] **Step 4: Approve from a lingual_admin account**

In a second browser session, sign in as a user with `lingual_admin: true` and:

- Open `/app/admin/school-requests` (current Lingual admin page).
- Approve the request created above.

Confirm in Firestore:
- A new `organizations/` doc exists with the school name.
- A new `memberships/` doc exists with role `school_admin` for the requester.
- For each pre-invite email, a `teacher_invitations/` doc exists with `source='pre_invite'`.
- Three new outbox docs queued: one `school_request_approved`, one `teacher_invitation` per pre-invite.

- [ ] **Step 5: Verify the pending page resolves AND watch for the refresh-before-navigate race**

Return to the original (admin) browser session. Open DevTools → Network → filter for `verify`, and DevTools → Console. Within 30 seconds, `/signup/admin/pending` should:

1. Issue a `GET /api/school-requests/mine` returning `status: 'approved'`.
2. Issue a `POST /api/auth/verify` (the `refreshUser()` call) — the response payload must contain a `memberships` array with the new `school_admin` row.
3. Navigate to `/app/teacher` and STAY there.

**Failure modes to watch for** (these would indicate the race the test suite covers via `invocationCallOrder` but cannot fully reproduce):

- The URL flickers to `/app/teacher` and then bounces back to `/signup/admin/pending` or `/signup/admin/org-wizard`. This means `navigate(...)` ran before `refreshUser()` resolved (or before React flushed the new user state), so `AppProtectedRoute` / `getOnboardingDestination` saw the stale user. **Mitigation**: confirm Task 28's implementation has `await refreshUser();` immediately followed by `navigate(...)`, and that there is no other `setState` between them that could be batched in a way that delays the user update.
- The `verify` request fires AFTER the navigation. Same diagnosis — call ordering is wrong; the `await` may be missing.

If either failure occurs, file the bug as a Plan 3 blocker and fix before merging. The most reliable fix, if React state batching turns out to be the culprit despite the await, is to have `refreshUser()` return the fresh `User` object and have `AdminPendingPage` pass it forward (e.g., via a one-shot `setBypassUser(user)` on `AuthContext`, or by waiting for the next render via a `useEffect` watching `user.memberships`). Document the chosen mitigation in `codebase-conventions.md` if it requires a pattern change.

If your `lingu-480600` project has Resend wired and `RESEND_API_KEY` is set in the local environment, also check the recipient inboxes for the rendered emails. Otherwise verify in the Cloud Function logs that the dev-mode fallback fired (`status='sent_dev'`).

- [ ] **Step 6: Commit a note (optional)**

If anything was hand-fixed during the smoke test, commit it with a small `chore(smoke):` message — otherwise nothing to commit.

This task has no automated success criterion; the success criterion is "I walked through it and everything observed in step 2 matched step 4."

---

## Closing checklist

After Task 32, run one final full pass:

```bash
make test-backend
make test-frontend
python3 -m unittest functions.tests -v
cd frontend && npm run build
```

Expected:
- All backend unittest suites pass.
- All Vitest suites pass.
- All Cloud Functions tests pass.
- Frontend production build succeeds.

If everything is green, Plan 3 is done. Plan 4 (Teacher join — invite code + search) can start.

---

## What this plan deliberately did NOT do

These come up naturally while implementing — resist them until the appropriate plan:

- **Refactor `LingualSchoolRequestsPage`** to surface the new fields. The current page still shows the thin shape; the rich review panel ships in Plan 5 along with the `/app/lingual-admin/*` namespace.
- **Add a `/api/lingual-admin/*` blueprint.** Plan 5.
- **Consume `teacher_invitations` rows on the teacher join screen.** Plan 4 owns that flow.
- **Build a reminder cron for stalled school requests.** Listed in spec §5 as a template (`school_request_reminder_to_lingual`) but not in the v1 critical path. A 1-day follow-up after Plan 3 ships.
- **Rename `rejection_reason` to `decline_reason`.** Would require migrating existing rows + every read site. Cosmetic; the UI can say "Declined" without the field renaming.
