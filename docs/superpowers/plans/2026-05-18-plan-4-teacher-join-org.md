# Plan 4 — Teacher Join-Org Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hybrid teacher join-org flow (invite code primary + organization-name search fallback) with admin approval pipeline, email notifications via the Plan 1 outbox, and an admin-side review section on the teacher dashboard. Removes auto-approve behavior introduced in commit `4bbcbe3`.

**Architecture:** A new `teacher_join_requests` Firestore collection captures every teacher's request to join an org. Two submission paths (`source='invite_code'` or `source='search'`) write the same shape. School admins approve/decline from their dashboard; both transitions emit transactional emails through `backend.services.outbox.enqueue_outbox_email`. The flow is fronted by new pages `/signup/teacher/join-org` (UI panes A/B/C) and `/signup/teacher/pending` (status polling).

**Tech Stack:** Flask 3.1, Firebase Admin SDK, Firestore (backend); React 19 + Vite + Vitest + axios (frontend); Resend via Cloud Function trigger (Plan 1); `unittest.TestCase` and `FakeDbBase` for backend tests, RTL+Vitest for frontend tests, `@firebase/rules-unit-testing` for rules tests. Conventions from `docs/superpowers/codebase-conventions.md` apply throughout — read it once before starting.

**Spec:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` §3 (Teacher Join-Org Flow) and §5 (Email Outbox).

**Branch / worktree:** `pilot/plan-4-teacher-join` in `.worktrees/plan-4-teacher-join`, branched from `pilot/launch-v1` (Plans 1 + 2 merged).

---

## File Structure

### Backend — Create

| Path | Responsibility |
|---|---|
| `backend/routes/teacher_requests.py` | New blueprint: all `/api/teacher-join-requests/*` + `/api/organizations/search` endpoints |
| `backend/tests/test_teacher_requests_routes.py` | Submit, status, cancel, list, approve, decline route tests |
| `backend/tests/test_teacher_requests_outbox.py` | Outbox integration for the three new templates |
| `backend/tests/test_org_search_route.py` | Search endpoint behavior + rate limiting |
| `backend/tests/test_database_teacher_join_requests.py` | DB helper tests |
| `functions/templates/teacher_join_request_to_admin.html.j2` | Email template |
| `functions/templates/teacher_join_approved.html.j2` | Email template |
| `functions/templates/teacher_join_declined.html.j2` | Email template |
| `functions/tests/test_teacher_join_templates.py` | Template render snapshot tests |
| `scripts/backfill_org_name_lower.py` | One-shot backfill of `organizations.name_lower` for orgs created before Plan 4 |
| `scripts/backfill_school_admin_uids.py` | One-shot backfill of `organizations.school_admin_uids` for orgs created before Plan 4 |

### Backend — Modify

| Path | Change |
|---|---|
| `database.py` | Add `teacher_join_requests` CRUD helpers, `search_organizations`, `list_school_admin_emails`, `_sync_org_admin_uids`, `ALLOWED_TEACHER_JOIN_REQUEST_STATUSES`, `TEACHER_JOIN_REQUESTS_COLLECTION`, `get_teacher_join_requests_collection()`. Extend `create_organization` to write `name_lower`; extend `create_membership` to call `_sync_org_admin_uids` on school_admin grants. |
| `backend/services/outbox.py` | Three new `OutboxTemplate` enum members |
| `functions/main.py` | Three new entries in `_TEMPLATE_SUBJECTS` |
| `backend/routes/schools.py` | Remove auto-approve block in `api_join_as_teacher` and replace with a 410 Gone pointer to the new endpoint |
| `firestore.rules` | Add `match /teacher_join_requests/{requestId}` block |
| `main.py` | Register `create_teacher_requests_blueprint(deps)` |

### Frontend — Create

| Path | Responsibility |
|---|---|
| `frontend/src/api/teacherRequests.ts` | Typed client for the new endpoints |
| `frontend/src/types/teacherJoin.ts` | DTO types matching the backend response shape |
| `frontend/src/pages/TeacherJoinOrgPage.tsx` | Replaces placeholder; Pane A (entry) → Pane B (code) or Pane C (search) |
| `frontend/src/pages/TeacherJoinOrgPage.test.tsx` | Pane behavior + happy/error paths |
| `frontend/src/pages/TeacherJoinPendingPage.tsx` | Status + 30s polling + cancel |
| `frontend/src/pages/TeacherJoinPendingPage.test.tsx` | Status transitions + cancel flow |
| `frontend/src/components/teacher/PendingTeacherRequestsSection.tsx` | Admin review section on the dashboard |
| `frontend/src/components/teacher/PendingTeacherRequestsSection.test.tsx` | Approve/decline flow |

### Frontend — Modify

| Path | Change |
|---|---|
| `frontend/src/App.tsx` | Replace `TeacherJoinOrgPlaceholderPage` import with `TeacherJoinOrgPage`; add `/signup/teacher/pending` route |
| `frontend/src/lib/homeRoutes.ts` | Export `TEACHER_JOIN_PENDING_ROUTE`; dispatcher returns it when `onboardingState='teacher_pending'` |
| `frontend/src/lib/homeRoutes.test.ts` | Add teacher_pending dispatch test |
| `frontend/src/pages/TeacherDashboardPage.tsx` | Mount `PendingTeacherRequestsSection`; remove the old `listTeacherInvitations` block |
| `frontend/src/api/schoolRequests.ts` | Remove `joinSchoolAsTeacher`, `listTeacherInvitations`, `approveTeacherInvitation`, `rejectTeacherInvitation` (superseded) |
| `frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx` | Delete |
| `frontend/src/pages/TeacherJoinSchoolPage.tsx` | Delete |

### Firestore Rules / Emulator Tests — Modify

| Path | Change |
|---|---|
| `firestore.rules` | Add `teacher_join_requests` rules |
| `firebase-tests/teacher_join_requests.rules.test.ts` | New test file for the new collection |

### Docs — Modify

| Path | Change |
|---|---|
| `docs/school-integration/TECH_SPEC.md` | Teacher onboarding section: new collection + endpoints |
| `docs/school-integration/TASKS.md` | Mark Plan 4 items complete |
| `docs/school-integration/LIMITATIONS.md` | Add: one pending request per user, name-only search, polling not realtime |
| `docs/superpowers/codebase-conventions.md` | Add §14 — Plan 4 contract surface |

---

## Conventions Cheat Sheet (read once before each task)

- **Tests:** `unittest.TestCase` only. Single file run: `python3 -m unittest backend.tests.test_X -v`.
- **Backend routes:** Build via `create_<name>_blueprint(deps: RouteDeps)`. Access `deps.db.foo(...)`, `deps.get_current_user_uid()`, `deps.get_school_request_context()`.
- **Test fixtures:** Subclass `FakeDbBase`, use `make_test_deps(db=FakeYourDb())`, register on `make_test_app(deps)`. See `backend/tests/conftest.py` and `test_school_request_outbox_integration.py` for canonical example.
- **Naming:** snake_case in Python + Firestore + request bodies; camelCase in response bodies + TypeScript.
- **Firestore writes:** dotted paths on the doc, not subcollections.
- **Outbox:** wrap enqueue in try/except — never fail the business call. New template needs 3 changes in one commit (enum + j2 + subjects).
- **Cloud Function:** `_impl` + decorated wrapper pattern.
- **Commits:** `feat(scope): …`, one logical change per commit, tests + impl together. Sign-off with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 1: `teacher_join_requests` DB helpers

**Files:**
- Modify: `database.py` (add constants + helpers near the existing `TEACHER_INVITATIONS_COLLECTION` block, around line 2620)
- Create: `backend/tests/test_database_teacher_join_requests.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_database_teacher_join_requests.py`:

```python
"""Tests for teacher_join_requests CRUD helpers in database.py."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import database


class TeacherJoinRequestsHelpersTest(unittest.TestCase):
    def setUp(self):
        self.fake_doc_ref = MagicMock()
        self.fake_doc_ref.id = 'tjr-1'
        self.fake_collection = MagicMock()
        self.fake_collection.document.return_value = self.fake_doc_ref
        self.fake_client = MagicMock()
        self.fake_client.collection.return_value = self.fake_collection
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def test_create_teacher_join_request_code_source(self):
        """Code path writes source='invite_code' and invite_code."""
        request_id = database.create_teacher_join_request(
            uid='teacher-1',
            org_id='org-1',
            source='invite_code',
            invite_code='ABC123',
        )
        self.assertEqual(request_id, 'tjr-1')
        self.fake_doc_ref.set.assert_called_once()
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['uid'], 'teacher-1')
        self.assertEqual(payload['org_id'], 'org-1')
        self.assertEqual(payload['source'], 'invite_code')
        self.assertEqual(payload['invite_code'], 'ABC123')
        self.assertEqual(payload['status'], 'pending')
        self.assertIn('requested_at', payload)

    def test_create_teacher_join_request_search_source(self):
        """Search path writes source='search' with no invite_code."""
        database.create_teacher_join_request(
            uid='teacher-1',
            org_id='org-1',
            source='search',
        )
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['source'], 'search')
        self.assertNotIn('invite_code', payload)

    def test_create_teacher_join_request_rejects_invalid_source(self):
        with self.assertRaisesRegex(ValueError, 'Invalid source'):
            database.create_teacher_join_request(
                uid='teacher-1',
                org_id='org-1',
                source='garbage',
            )

    def test_get_pending_teacher_join_request_by_uid_returns_first_pending(self):
        pending_doc = MagicMock()
        pending_doc.id = 'tjr-1'
        pending_doc.to_dict.return_value = {'uid': 'teacher-1', 'status': 'pending'}
        query = MagicMock()
        query.stream.return_value = iter([pending_doc])
        self.fake_collection.where.return_value.where.return_value.limit.return_value = query

        result = database.get_pending_teacher_join_request_by_uid('teacher-1')
        self.assertEqual(result['id'], 'tjr-1')
        self.assertEqual(result['status'], 'pending')

    def test_get_pending_teacher_join_request_by_uid_none(self):
        query = MagicMock()
        query.stream.return_value = iter([])
        self.fake_collection.where.return_value.where.return_value.limit.return_value = query
        self.assertIsNone(database.get_pending_teacher_join_request_by_uid('teacher-1'))

    def test_list_pending_teacher_join_requests_by_org(self):
        doc1 = MagicMock(); doc1.id = 'tjr-1'
        doc1.to_dict.return_value = {'uid': 'teacher-1', 'status': 'pending', 'org_id': 'org-1'}
        doc2 = MagicMock(); doc2.id = 'tjr-2'
        doc2.to_dict.return_value = {'uid': 'teacher-2', 'status': 'pending', 'org_id': 'org-1'}
        query = MagicMock()
        query.stream.return_value = iter([doc1, doc2])
        self.fake_collection.where.return_value.where.return_value.order_by.return_value = query

        results = database.list_pending_teacher_join_requests_by_org('org-1')
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['id'], 'tjr-1')

    def test_update_teacher_join_request_status_sets_review_metadata(self):
        database.update_teacher_join_request_status(
            request_id='tjr-1',
            status='approved',
            reviewed_by_uid='admin-1',
        )
        self.fake_doc_ref.update.assert_called_once()
        updates = self.fake_doc_ref.update.call_args[0][0]
        self.assertEqual(updates['status'], 'approved')
        self.assertEqual(updates['reviewed_by_uid'], 'admin-1')
        self.assertIn('reviewed_at', updates)

    def test_update_teacher_join_request_status_cancel_omits_review_metadata(self):
        """Self-cancellation is not a review — must NOT stamp reviewed_*."""
        database.update_teacher_join_request_status(
            request_id='tjr-1',
            status='cancelled',
        )
        updates = self.fake_doc_ref.update.call_args[0][0]
        self.assertEqual(updates['status'], 'cancelled')
        self.assertNotIn('reviewed_at', updates)
        self.assertNotIn('reviewed_by_uid', updates)

    def test_update_teacher_join_request_status_rejects_invalid_status(self):
        with self.assertRaisesRegex(ValueError, 'Invalid status'):
            database.update_teacher_join_request_status(
                request_id='tjr-1',
                status='bogus',
                reviewed_by_uid='admin-1',
            )


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests -v
```

Expected: `AttributeError: module 'database' has no attribute 'create_teacher_join_request'`.

- [ ] **Step 3: Implement the helpers**

Add to `database.py` (after the `TEACHER_INVITATIONS_COLLECTION` block, around line 2620):

```python
# ============================================================================
# Teacher Join Requests (Plan 4)
# ============================================================================

TEACHER_JOIN_REQUESTS_COLLECTION = 'teacher_join_requests'

TEACHER_JOIN_REQUEST_SOURCE_INVITE_CODE = 'invite_code'
TEACHER_JOIN_REQUEST_SOURCE_SEARCH = 'search'
ALLOWED_TEACHER_JOIN_REQUEST_SOURCES = frozenset({
    TEACHER_JOIN_REQUEST_SOURCE_INVITE_CODE,
    TEACHER_JOIN_REQUEST_SOURCE_SEARCH,
})

TEACHER_JOIN_REQUEST_STATUS_PENDING = 'pending'
TEACHER_JOIN_REQUEST_STATUS_APPROVED = 'approved'
TEACHER_JOIN_REQUEST_STATUS_DECLINED = 'declined'
TEACHER_JOIN_REQUEST_STATUS_CANCELLED = 'cancelled'
ALLOWED_TEACHER_JOIN_REQUEST_STATUSES = frozenset({
    TEACHER_JOIN_REQUEST_STATUS_PENDING,
    TEACHER_JOIN_REQUEST_STATUS_APPROVED,
    TEACHER_JOIN_REQUEST_STATUS_DECLINED,
    TEACHER_JOIN_REQUEST_STATUS_CANCELLED,
})


def get_teacher_join_requests_collection():
    return firestore.client().collection(TEACHER_JOIN_REQUESTS_COLLECTION)


def create_teacher_join_request(
    *,
    uid: str,
    org_id: str,
    source: str,
    invite_code: str | None = None,
):
    """Create a teacher_join_requests doc in 'pending' status. Returns doc id."""
    if source not in ALLOWED_TEACHER_JOIN_REQUEST_SOURCES:
        raise ValueError(f"Invalid source: {source!r}")
    doc_ref = get_teacher_join_requests_collection().document()
    payload = {
        'uid': uid,
        'org_id': org_id,
        'source': source,
        'status': TEACHER_JOIN_REQUEST_STATUS_PENDING,
        'requested_at': firestore.SERVER_TIMESTAMP,
        'reviewed_at': None,
        'reviewed_by_uid': None,
        'decline_reason': None,
    }
    if invite_code:
        payload['invite_code'] = invite_code
    doc_ref.set(payload)
    return doc_ref.id


def get_pending_teacher_join_request_by_uid(uid: str):
    """Return the user's single open (pending) request, or None."""
    query = (
        get_teacher_join_requests_collection()
        .where('uid', '==', uid)
        .where('status', '==', TEACHER_JOIN_REQUEST_STATUS_PENDING)
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_teacher_join_request(request_id: str):
    doc = get_teacher_join_requests_collection().document(request_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_pending_teacher_join_requests_by_org(org_id: str):
    """List all pending requests targeting the given org, newest first."""
    query = (
        get_teacher_join_requests_collection()
        .where('org_id', '==', org_id)
        .where('status', '==', TEACHER_JOIN_REQUEST_STATUS_PENDING)
        .order_by('requested_at', direction=firestore.Query.DESCENDING)
    )
    results = []
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


_REVIEW_STATUSES = frozenset({
    TEACHER_JOIN_REQUEST_STATUS_APPROVED,
    TEACHER_JOIN_REQUEST_STATUS_DECLINED,
})


def update_teacher_join_request_status(
    *,
    request_id: str,
    status: str,
    reviewed_by_uid: str | None = None,
    decline_reason: str | None = None,
):
    """Transition status with audit metadata.

    `reviewed_at` / `reviewed_by_uid` are stamped only for admin-review
    transitions (approved, declined). Self-cancellation just updates `status`
    — it's not a review.
    """
    if status not in ALLOWED_TEACHER_JOIN_REQUEST_STATUSES:
        raise ValueError(f"Invalid status: {status!r}")
    updates: dict = {'status': status}
    if status in _REVIEW_STATUSES:
        updates['reviewed_at'] = firestore.SERVER_TIMESTAMP
        if reviewed_by_uid is not None:
            updates['reviewed_by_uid'] = reviewed_by_uid
    if decline_reason is not None:
        updates['decline_reason'] = decline_reason
    get_teacher_join_requests_collection().document(request_id).update(updates)
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests -v
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_database_teacher_join_requests.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): add teacher_join_requests collection helpers

CRUD for the new Plan 4 request collection: create with source enum,
get pending by uid (one-request invariant), list pending by org,
update status with audit metadata. Status + source enums match spec §3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Organization search + school-admin email helpers

**Files:**
- Modify: `database.py`
- Modify: `backend/tests/test_database_teacher_join_requests.py` (add tests for the two new helpers)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_database_teacher_join_requests.py`:

```python
class OrgSearchHelperTest(unittest.TestCase):
    def setUp(self):
        self.fake_client = MagicMock()
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def _seed_org_docs(self, orgs: list[dict]):
        docs = []
        for org in orgs:
            d = MagicMock()
            d.id = org['id']
            d.to_dict.return_value = {k: v for k, v in org.items() if k != 'id'}
            docs.append(d)
        query = MagicMock()
        query.stream.return_value = iter(docs)
        self.fake_client.collection.return_value.where.return_value.limit.return_value = query

    def test_search_organizations_returns_metadata_only(self):
        """Search response excludes sensitive fields."""
        self._seed_org_docs([
            {
                'id': 'org-1',
                'name': 'San Francisco Friends School',
                'name_lower': 'san francisco friends school',
                'city': 'San Francisco',
                'state': 'CA',
                'school_type': 'k12',
                'status': 'active',
                # Sensitive fields below MUST NOT appear in result.
                'admin_email_domains': ['@sfs.org'],
                'student_count': 412,
                'teacher_count': 38,
            },
        ])
        results = database.search_organizations('san fran', limit=10)
        self.assertEqual(len(results), 1)
        result = results[0]
        self.assertEqual(result['id'], 'org-1')
        self.assertEqual(result['name'], 'San Francisco Friends School')
        self.assertEqual(result['city'], 'San Francisco')
        self.assertEqual(result['state'], 'CA')
        self.assertEqual(result['school_type'], 'k12')
        self.assertNotIn('admin_email_domains', result)
        self.assertNotIn('student_count', result)
        self.assertNotIn('teacher_count', result)

    def test_search_organizations_excludes_suspended_archived(self):
        self._seed_org_docs([
            {'id': 'org-1', 'name': 'Active', 'name_lower': 'active', 'status': 'active'},
            {'id': 'org-2', 'name': 'Susp', 'name_lower': 'susp', 'status': 'suspended'},
            {'id': 'org-3', 'name': 'Arch', 'name_lower': 'arch', 'status': 'archived'},
        ])
        results = database.search_organizations('a', limit=10)
        ids = [r['id'] for r in results]
        self.assertIn('org-1', ids)
        self.assertNotIn('org-2', ids)
        self.assertNotIn('org-3', ids)

    def test_search_organizations_blank_query_returns_empty(self):
        """Empty / whitespace-only query yields no results, no DB hit."""
        result = database.search_organizations('   ', limit=10)
        self.assertEqual(result, [])
        self.fake_client.collection.assert_not_called()


class ListSchoolAdminEmailsTest(unittest.TestCase):
    def setUp(self):
        self.fake_client = MagicMock()
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()
        # Memberships query
        self.memberships_query = MagicMock()
        # Users
        self.users_doc = MagicMock()

    def tearDown(self):
        self.client_patch.stop()

    def test_returns_active_school_admins_for_org(self):
        m1 = MagicMock()
        m1.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-1',
            'roles': ['school_admin'], 'status': 'active',
        }
        m2 = MagicMock()
        m2.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-2',
            'roles': ['school_admin', 'teacher'], 'status': 'active',
        }
        m3 = MagicMock()
        m3.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-inactive',
            'roles': ['school_admin'], 'status': 'invited',
        }
        self.memberships_query.stream.return_value = iter([m1, m2, m3])

        users = {
            'admin-1': {'email': 'a1@x.com', 'name': 'A1', 'profile': {'display_name': 'A One'}},
            'admin-2': {'email': 'a2@x.com', 'name': 'A2'},
        }

        def _collection(name):
            mock = MagicMock()
            if name == 'memberships':
                mock.where.return_value.where.return_value.where.return_value.stream.return_value = (
                    iter([m1, m2, m3])
                )
            elif name == 'users':
                def _doc(uid):
                    doc_mock = MagicMock()
                    if uid in users:
                        doc_mock.get.return_value.to_dict.return_value = users[uid]
                        doc_mock.get.return_value.exists = True
                    else:
                        doc_mock.get.return_value.exists = False
                    return doc_mock
                mock.document.side_effect = _doc
            return mock

        self.fake_client.collection.side_effect = _collection

        results = database.list_school_admin_emails('org-1')
        emails = sorted(r['email'] for r in results)
        self.assertEqual(emails, ['a1@x.com', 'a2@x.com'])
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests -v
```

Expected: `AttributeError: module 'database' has no attribute 'search_organizations'`.

- [ ] **Step 3: Implement the helpers**

Add to `database.py` (in the orgs section, near other org helpers):

```python
def search_organizations(query: str, *, limit: int = 10):
    """Public-ish org search. Returns metadata only — no PII, no counts.

    Matches against `name_lower` prefix; orgs must be `status='active'`.
    """
    q = (query or '').strip().lower()
    if not q:
        return []
    # Firestore prefix-range idiom: U+F8FF ('') is one of the highest
    # Unicode private-use code points; [q, q + ''] covers every doc whose
    # name_lower starts with q. NOTE: U+F8FF may render as empty quotes in
    # some terminals — it is a real character.
    end = q + ''
    docs = (
        firestore.client()
        .collection(ORGANIZATIONS_COLLECTION)
        .where('name_lower', '>=', q)
        .where('name_lower', '<=', end)
        .limit(limit)
    ).stream()
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        if data.get('status') != 'active':
            continue
        results.append({
            'id': doc.id,
            'name': data.get('name', ''),
            'city': data.get('city'),
            'state': data.get('state'),
            'school_type': data.get('school_type'),
        })
    return results


def list_school_admin_emails(org_id: str):
    """Return [{uid, email, name}] for every active school_admin of the org."""
    membership_docs = (
        firestore.client()
        .collection(MEMBERSHIPS_COLLECTION)
        .where('org_id', '==', org_id)
        .where('status', '==', 'active')
        .where('roles', 'array_contains', 'school_admin')
    ).stream()
    recipients = []
    seen = set()
    for m in membership_docs:
        data = m.to_dict() or {}
        uid = data.get('uid')
        if not uid or uid in seen:
            continue
        seen.add(uid)
        user_doc = firestore.client().collection(USERS_COLLECTION).document(uid).get()
        if not user_doc.exists:
            continue
        user = user_doc.to_dict() or {}
        email = user.get('email')
        if not email:
            continue
        display_name = (user.get('profile') or {}).get('display_name') or user.get('name')
        recipients.append({'uid': uid, 'email': email, 'name': display_name})
    return recipients
```

> **Critical dependency on `name_lower`:** the search query is a prefix range against `organizations.name_lower`. If this field isn't written on org creation, search silently returns empty. Steps 6–8 fix the write path in this same task. Do NOT assume Plan 3's wizard writes it — verify in code before relying on it.

- [ ] **Step 4: Write the failing test for `name_lower` on org creation**

Append to `backend/tests/test_database_teacher_join_requests.py`:

```python
class CreateOrganizationNameLowerTest(unittest.TestCase):
    def setUp(self):
        self.fake_doc_ref = MagicMock()
        self.fake_doc_ref.id = 'org-new'
        self.fake_collection = MagicMock()
        self.fake_collection.document.return_value = self.fake_doc_ref
        self.fake_client = MagicMock()
        self.fake_client.collection.return_value = self.fake_collection
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def test_create_organization_writes_name_lower(self):
        database.create_organization(name='  SF Friends School  ')
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['name_lower'], 'sf friends school')
```

- [ ] **Step 5: Update `create_organization` in `database.py`**

At the top of the `org_data` dict in `create_organization()` (around line 760), add the `name_lower` line:

```python
org_data = {
    'name': name,
    'name_lower': (name or '').strip().lower(),  # search prefix index
    'type': org_type,
    # ...rest unchanged
}
```

- [ ] **Step 6: Run org-create test to verify**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests.CreateOrganizationNameLowerTest -v
```

Expected: 1 test passes.

- [ ] **Step 7: Add a backfill script for existing orgs**

Create `scripts/backfill_org_name_lower.py`:

```python
"""Backfill organizations.name_lower for orgs created before Plan 4.

Idempotent. Run with --dry-run first.

Usage:
    python3 scripts/backfill_org_name_lower.py --dry-run
    python3 scripts/backfill_org_name_lower.py
"""
from __future__ import annotations

import argparse
import sys

import firebase_admin
from firebase_admin import firestore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    firebase_admin.initialize_app()
    db = firestore.client()
    updated = 0
    skipped = 0
    for doc in db.collection('organizations').stream():
        data = doc.to_dict() or {}
        name = data.get('name') or ''
        expected = name.strip().lower()
        if not expected:
            skipped += 1
            continue
        if data.get('name_lower') == expected:
            skipped += 1
            continue
        print(f"{'[DRY] ' if args.dry_run else ''}update {doc.id}: name_lower = {expected!r}")
        if not args.dry_run:
            doc.reference.update({'name_lower': expected})
        updated += 1
    print(f"\nDone. updated={updated} skipped={skipped}")


if __name__ == '__main__':
    sys.exit(main() or 0)
```

> **Coordination with Plan 3:** the admin org wizard (Plan 3) also creates orgs — verify in `backend/routes/school_requests.py` that the approval flow calls `database.create_organization()` (which now writes `name_lower`) rather than constructing the org doc by hand. If it bypasses the helper, file a coordination ticket against Plan 3.

- [ ] **Step 8: Run all of Task 2's tests to verify pass**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests -v
```

Expected: all tests pass (14 total in the file after Task 2 — Task 1's helpers + the three new test classes added here).

- [ ] **Step 9: Commit**

```bash
git add database.py backend/tests/test_database_teacher_join_requests.py scripts/backfill_org_name_lower.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): org search + school_admin emails + name_lower writes

search_organizations() returns metadata-only results (name, city, state,
school_type) for active orgs only. list_school_admin_emails(org_id) returns
recipients for the outbox. create_organization now writes name_lower so the
search index actually has data. Backfill script for legacy orgs included.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Three new outbox templates

**Files:**
- Modify: `backend/services/outbox.py`
- Create: `functions/templates/teacher_join_request_to_admin.html.j2`
- Create: `functions/templates/teacher_join_approved.html.j2`
- Create: `functions/templates/teacher_join_declined.html.j2`
- Modify: `functions/main.py`
- Create: `functions/tests/test_teacher_join_templates.py`

- [ ] **Step 1: Write the failing template render tests**

Create `functions/tests/test_teacher_join_templates.py`:

```python
"""Template render tests for Plan 4 outbox templates."""
from __future__ import annotations

import unittest
from unittest.mock import patch


class TeacherJoinTemplatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_request_to_admin_subject(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_request_to_admin']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'New teacher request to join SF Friends')

    def test_request_to_admin_html(self):
        subject, html = self.main.render_template(
            'teacher_join_request_to_admin',
            {
                'org_name': 'SF Friends',
                'requester_name': 'Jane Doe',
                'requester_email': 'jane@sfs.org',
                'source_label': 'invite code',
                'review_url': 'https://lingual.app/app/teacher#pending-requests',
            },
        )
        self.assertIn('SF Friends', html)
        self.assertIn('Jane Doe', html)
        self.assertIn('jane@sfs.org', html)
        self.assertIn('invite code', html)
        self.assertIn('https://lingual.app/app/teacher#pending-requests', html)

    def test_approved_subject_and_html(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_approved']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'Welcome to SF Friends on Lingual')
        _, html = self.main.render_template(
            'teacher_join_approved',
            {'org_name': 'SF Friends', 'dashboard_url': 'https://lingual.app/app/teacher'},
        )
        self.assertIn('SF Friends', html)
        self.assertIn('https://lingual.app/app/teacher', html)

    def test_declined_subject_and_html(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_declined']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'Your request to join SF Friends was not approved')
        _, html = self.main.render_template(
            'teacher_join_declined',
            {
                'org_name': 'SF Friends',
                'decline_reason': 'Please use your school email.',
                'retry_url': 'https://lingual.app/signup/teacher/join-org',
            },
        )
        self.assertIn('Please use your school email.', html)
        self.assertIn('https://lingual.app/signup/teacher/join-org', html)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest functions.tests.test_teacher_join_templates -v
```

Expected: `KeyError: 'teacher_join_request_to_admin'`.

- [ ] **Step 3: Add enum values to `backend/services/outbox.py`**

Replace the `OutboxTemplate` class:

```python
class OutboxTemplate(str, Enum):
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
    TEACHER_JOIN_REQUEST_TO_ADMIN = 'teacher_join_request_to_admin'
    TEACHER_JOIN_APPROVED = 'teacher_join_approved'
    TEACHER_JOIN_DECLINED = 'teacher_join_declined'
```

- [ ] **Step 4: Create the three template files**

`functions/templates/teacher_join_request_to_admin.html.j2`:

```html
<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1c1c1c;">
    <p>Hi,</p>
    <p>
      A teacher has requested to join <strong>{{ org_name }}</strong> on Lingual.
    </p>
    <table style="border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 4px 8px;">Name</td><td style="padding: 4px 8px;"><strong>{{ requester_name }}</strong></td></tr>
      <tr><td style="padding: 4px 8px;">Email</td><td style="padding: 4px 8px;">{{ requester_email }}</td></tr>
      <tr><td style="padding: 4px 8px;">Submitted via</td><td style="padding: 4px 8px;">{{ source_label }}</td></tr>
    </table>
    <p>
      <a href="{{ review_url }}" style="display: inline-block; padding: 10px 16px; background: #1c1c1c; color: #fff; text-decoration: none; border-radius: 6px;">
        Review request
      </a>
    </p>
    <p style="color: #6b6b6b; font-size: 13px;">
      You can approve or decline this request from your teacher dashboard.
    </p>
  </body>
</html>
```

`functions/templates/teacher_join_approved.html.j2`:

```html
<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1c1c1c;">
    <p>Welcome to <strong>{{ org_name }}</strong> on Lingual.</p>
    <p>Your request was approved. You can now build assignments and manage classes.</p>
    <p>
      <a href="{{ dashboard_url }}" style="display: inline-block; padding: 10px 16px; background: #1c1c1c; color: #fff; text-decoration: none; border-radius: 6px;">
        Open your dashboard
      </a>
    </p>
  </body>
</html>
```

`functions/templates/teacher_join_declined.html.j2`:

```html
<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1c1c1c;">
    <p>
      Your request to join <strong>{{ org_name }}</strong> on Lingual was not approved.
    </p>
    {% if decline_reason %}
    <p><strong>Reason:</strong> {{ decline_reason }}</p>
    {% endif %}
    <p>
      <a href="{{ retry_url }}" style="display: inline-block; padding: 10px 16px; background: #1c1c1c; color: #fff; text-decoration: none; border-radius: 6px;">
        Try a different school
      </a>
    </p>
    <p style="color: #6b6b6b; font-size: 13px;">
      If you believe this is a mistake, please contact your school administrator directly.
    </p>
  </body>
</html>
```

- [ ] **Step 5: Add subject entries to `functions/main.py`**

In `functions/main.py`, expand `_TEMPLATE_SUBJECTS`:

```python
_TEMPLATE_SUBJECTS = {
    'school_request_to_lingual': lambda data: f"New school registration: {data['org_name']}",
    'teacher_join_request_to_admin': lambda data: f"New teacher request to join {data['org_name']}",
    'teacher_join_approved': lambda data: f"Welcome to {data['org_name']} on Lingual",
    'teacher_join_declined': lambda data: f"Your request to join {data['org_name']} was not approved",
}
```

- [ ] **Step 6: Run test to verify pass**

```bash
python3 -m unittest functions.tests.test_teacher_join_templates -v
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/services/outbox.py functions/templates/teacher_join_*.html.j2 functions/main.py functions/tests/test_teacher_join_templates.py
git commit -m "$(cat <<'EOF'
feat(outbox): add three teacher-join email templates

teacher_join_request_to_admin -> school admins on submit
teacher_join_approved -> teacher on approval
teacher_join_declined -> teacher on decline (with reason)

Enum, j2 templates, and subject lambdas land together per the Plan 1
outbox contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Blueprint scaffold + `POST /api/teacher-join-requests` (submission)

**Files:**
- Create: `backend/routes/teacher_requests.py`
- Create: `backend/tests/test_teacher_requests_routes.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_teacher_requests_routes.py`:

```python
"""Route tests for backend/routes/teacher_requests.py."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.routes.teacher_requests import create_teacher_requests_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeTeacherRequestsDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.users = {}
        self.orgs = {}
        self.memberships = []
        self.teacher_join_requests = {}
        self._tjr_counter = 0
        self.outbox_writes = []

    # User
    def get_user(self, uid):
        return self.users.get(uid)

    def get_user_memberships(self, uid):
        return [
            {'orgId': m['org_id'], 'roles': m['roles'], 'status': m['status']}
            for m in self.memberships if m['uid'] == uid
        ]

    # Org lookup
    def get_org_by_teacher_invite_code(self, code):
        for org_id, org in self.orgs.items():
            if org.get('teacher_invite_code') == code and org.get('teacher_invite_code_active'):
                return {'id': org_id, **org}
        return None

    def get_organization(self, org_id):
        if org_id not in self.orgs:
            return None
        return {'id': org_id, **self.orgs[org_id]}

    # Teacher join requests
    def get_pending_teacher_join_request_by_uid(self, uid):
        for rid, r in self.teacher_join_requests.items():
            if r['uid'] == uid and r['status'] == 'pending':
                return {'id': rid, **r}
        return None

    def create_teacher_join_request(self, *, uid, org_id, source, invite_code=None):
        self._tjr_counter += 1
        rid = f'tjr-{self._tjr_counter}'
        rec = {
            'uid': uid, 'org_id': org_id, 'source': source,
            'status': 'pending',
        }
        if invite_code:
            rec['invite_code'] = invite_code
        self.teacher_join_requests[rid] = rec
        return rid

    # Admin emails
    def list_school_admin_emails(self, org_id):
        return [{'uid': 'admin-1', 'email': 'admin@x.com', 'name': 'Admin'}]


def _build_app(*, uid='teacher-1', user_email='t@x.com', user_name='Teacher'):
    db = FakeTeacherRequestsDb()
    db.users[uid] = {'email': user_email, 'name': user_name}
    deps = make_test_deps(db=db)
    bp = create_teacher_requests_blueprint(deps)
    app = make_test_app(bp)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess['user'] = {'uid': uid, 'email': user_email}
    return app, db


class SubmitTeacherJoinRequestTest(unittest.TestCase):
    def test_submit_by_invite_code_succeeds(self):
        app, db = _build_app()
        db.orgs['org-1'] = {
            'name': 'SF Friends',
            'teacher_invite_code': 'ABC123',
            'teacher_invite_code_active': True,
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post(
            '/api/teacher-join-requests',
            json={'inviteCode': 'ABC123'},
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['orgName'], 'SF Friends')
        self.assertEqual(body['status'], 'pending')
        self.assertIn('requestId', body)
        # One request created, source=invite_code
        self.assertEqual(len(db.teacher_join_requests), 1)
        request = next(iter(db.teacher_join_requests.values()))
        self.assertEqual(request['source'], 'invite_code')
        self.assertEqual(request['org_id'], 'org-1')

    def test_submit_by_org_id_succeeds(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 201)
        request = next(iter(db.teacher_join_requests.values()))
        self.assertEqual(request['source'], 'search')

    def test_submit_invalid_invite_code_returns_404(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'inviteCode': 'XXXXXX'})
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(resp.get_json()['success'])

    def test_submit_invite_code_for_suspended_org_returns_409(self):
        """Even if invite code is active, suspended orgs reject new joins."""
        app, db = _build_app()
        db.orgs['org-1'] = {
            'name': 'SF Friends',
            'teacher_invite_code': 'ABC123',
            'teacher_invite_code_active': True,
            'status': 'suspended',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'inviteCode': 'ABC123'})
        self.assertEqual(resp.status_code, 409)
        self.assertIn('not accepting', resp.get_json()['error'])

    def test_submit_unknown_org_id_returns_404(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-missing'})
        self.assertEqual(resp.status_code, 404)

    def test_submit_when_already_member_same_org_returns_422(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db.memberships.append({
            'uid': 'teacher-1', 'org_id': 'org-1',
            'roles': ['teacher'], 'status': 'active',
        })
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 422)
        self.assertIn('already a member', resp.get_json()['error'])

    def test_submit_when_already_member_different_org_returns_422(self):
        """Spec §3: multi-org out of scope for v1 — any active mem blocks."""
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db.orgs['org-other'] = {'name': 'Existing School', 'status': 'active'}
        db.memberships.append({
            'uid': 'teacher-1', 'org_id': 'org-other',
            'roles': ['teacher'], 'status': 'active',
        })
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 422)
        body = resp.get_json()
        self.assertIn('Existing School', body['error'])

    def test_submit_when_existing_pending_returns_409(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db.teacher_join_requests['existing'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'search', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 409)

    def test_submit_requires_one_of_code_or_org(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={})
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: `ModuleNotFoundError: No module named 'backend.routes.teacher_requests'`.

- [ ] **Step 3: Implement the blueprint**

Create `backend/routes/teacher_requests.py`:

```python
"""Teacher-join-request blueprint (Plan 4).

Endpoints:
- POST   /api/teacher-join-requests             submit by inviteCode or orgId
- GET    /api/teacher-join-requests/me          poll own request (Task 5)
- DELETE /api/teacher-join-requests/me          cancel own request (Task 5)
- GET    /api/teacher-join-requests             list pending for admin's org (Task 6)
- POST   /api/teacher-join-requests/<id>/approve  (Task 7)
- POST   /api/teacher-join-requests/<id>/decline  (Task 8)

Org search lives at GET /api/organizations/search (Task 9), registered on the
same blueprint for locality.
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
from backend.services.school_context import SchoolContextPermissionError

log = logging.getLogger(__name__)

_TEACHER_DASHBOARD_PATH = '/app/teacher#pending-requests'


def _base_url():
    """Used for email CTAs. Falls back to relative path in dev."""
    import os
    return os.environ.get('PUBLIC_BASE_URL', '').rstrip('/')


def _absolute_url(path: str) -> str:
    base = _base_url()
    return f"{base}{path}" if base else path


def create_teacher_requests_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('teacher_requests', __name__)

    @bp.route('/api/teacher-join-requests', methods=['POST'])
    @deps.login_required
    def submit_join_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401

        data = request.get_json(silent=True) or {}
        invite_code = (data.get('inviteCode') or '').strip().upper() or None
        org_id_param = (data.get('orgId') or '').strip() or None
        if not invite_code and not org_id_param:
            return jsonify({
                'success': False,
                'error': 'Either inviteCode or orgId is required.',
            }), 400
        if invite_code and org_id_param:
            return jsonify({
                'success': False,
                'error': 'Provide exactly one of inviteCode or orgId.',
            }), 400

        # Resolve target org
        if invite_code:
            org = deps.db.get_org_by_teacher_invite_code(invite_code)
            if not org:
                return jsonify({'success': False, 'error': 'Invalid or expired invite code.'}), 404
            if org.get('status') != 'active':
                # Suspended / archived orgs reject new joins even if a stale
                # invite code is still flagged active on the org doc.
                return jsonify({
                    'success': False,
                    'error': 'This school is not accepting new teachers right now.',
                }), 409
            source = 'invite_code'
        else:
            org = deps.db.get_organization(org_id_param)
            if not org or org.get('status') != 'active':
                return jsonify({'success': False, 'error': 'School not found.'}), 404
            source = 'search'

        org_id = org['id']

        # Multi-org membership is out of scope for v1 — any active membership
        # in any org blocks a new join request (spec §3 edge case).
        for m in deps.db.get_user_memberships(uid):
            if m.get('status') == 'active':
                already_org_name = ''
                already = deps.db.get_organization(m.get('orgId'))
                if already:
                    already_org_name = already.get('name', '')
                return jsonify({
                    'success': False,
                    'error': (
                        f"You're already a member of {already_org_name or 'a school'}. "
                        "Contact support to change."
                    ),
                }), 422

        # Existing pending request?
        existing = deps.db.get_pending_teacher_join_request_by_uid(uid)
        if existing:
            return jsonify({
                'success': False,
                'error': 'You already have a pending request. Cancel it before submitting a new one.',
            }), 409

        request_id = deps.db.create_teacher_join_request(
            uid=uid,
            org_id=org_id,
            source=source,
            invite_code=invite_code if source == 'invite_code' else None,
        )

        # Notify admins via outbox. Failure to enqueue must NOT break the
        # business call (Plan 1 invariant).
        try:
            user = deps.db.get_user(uid) or {}
            admins = deps.db.list_school_admin_emails(org_id)
            source_label = 'invite code' if source == 'invite_code' else 'school search'
            for admin in admins:
                enqueue_outbox_email(
                    db=deps.db,
                    recipient_email=admin['email'],
                    recipient_name=admin.get('name'),
                    template=OutboxTemplate.TEACHER_JOIN_REQUEST_TO_ADMIN,
                    template_data={
                        'org_name': org.get('name', ''),
                        'requester_name': user.get('name') or '(unnamed teacher)',
                        'requester_email': user.get('email', ''),
                        'source_label': source_label,
                        'review_url': _absolute_url(_TEACHER_DASHBOARD_PATH),
                    },
                    related_entity_type='teacher_join_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
        except Exception:
            log.exception('Outbox enqueue failed for teacher_join_request=%s', request_id)

        # Mark user as awaiting admin review.
        try:
            deps.db.update_user_profile(uid, onboarding_state='teacher_pending')
        except Exception:
            log.exception('onboarding_state update failed for uid=%s', uid)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'orgId': org_id,
            'orgName': org.get('name', ''),
            'status': 'pending',
            'source': source,
        }), 201

    return bp
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_teacher_requests_routes.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): POST /api/teacher-join-requests endpoint

Handles both invite-code and search submissions. Enforces one-pending-per-
user, blocks duplicate org membership, and enqueues outbox emails to all
active school admins of the target org. Sets onboarding_state='teacher_pending'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `GET /me` (status poll) + `DELETE /me` (cancel)

**Files:**
- Modify: `backend/routes/teacher_requests.py`
- Modify: `backend/tests/test_teacher_requests_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_teacher_requests_routes.py`:

```python
class PollAndCancelTest(unittest.TestCase):
    def test_get_me_returns_pending_request(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body['status'], 'pending')
        self.assertEqual(body['orgId'], 'org-1')
        self.assertEqual(body['orgName'], 'SF Friends')

    def test_get_me_returns_204_when_no_request(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 204)

    def test_delete_me_cancels_pending(self):
        app, db = _build_app()
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'search', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.delete('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json()['success'])
        self.assertEqual(db.teacher_join_requests['tjr-1']['status'], 'cancelled')

    def test_delete_me_returns_404_when_no_pending(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.delete('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 404)
```

Extend `FakeTeacherRequestsDb` (same file) with status update + lookup helpers used below:

```python
    # Append inside FakeTeacherRequestsDb:
    def update_teacher_join_request_status(self, *, request_id, status,
                                            reviewed_by_uid=None,
                                            decline_reason=None):
        rec = self.teacher_join_requests.get(request_id)
        if rec is None:
            raise KeyError(request_id)
        rec['status'] = status
        if reviewed_by_uid is not None:
            rec['reviewed_by_uid'] = reviewed_by_uid
        if decline_reason is not None:
            rec['decline_reason'] = decline_reason

    def update_user_profile(self, uid, **kwargs):
        # Capture for assertions; no-op semantics otherwise.
        self.profile_updates = getattr(self, 'profile_updates', [])
        self.profile_updates.append((uid, kwargs))
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes.PollAndCancelTest -v
```

Expected: `404 Not Found` (route not registered).

- [ ] **Step 3: Add the two endpoints**

Inside `create_teacher_requests_blueprint(deps)` in `backend/routes/teacher_requests.py`:

```python
    @bp.route('/api/teacher-join-requests/me', methods=['GET'])
    @deps.login_required
    def get_my_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        rec = deps.db.get_pending_teacher_join_request_by_uid(uid)
        if not rec:
            return ('', 204)
        org = deps.db.get_organization(rec['org_id']) or {}
        return jsonify({
            'requestId': rec['id'],
            'orgId': rec['org_id'],
            'orgName': org.get('name', ''),
            'status': rec['status'],
            'source': rec.get('source'),
            'declineReason': rec.get('decline_reason'),
        }), 200

    @bp.route('/api/teacher-join-requests/me', methods=['DELETE'])
    @deps.login_required
    def cancel_my_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        rec = deps.db.get_pending_teacher_join_request_by_uid(uid)
        if not rec:
            return jsonify({'success': False, 'error': 'No pending request.'}), 404
        deps.db.update_teacher_join_request_status(
            request_id=rec['id'],
            status='cancelled',
            # No reviewed_by_uid — cancellation is not a review action.
        )
        # Clear pending state on the user profile.
        try:
            deps.db.update_user_profile(uid, onboarding_state='role_selected')
        except Exception:
            log.exception('onboarding_state revert failed for uid=%s', uid)
        return jsonify({'success': True}), 200
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_teacher_requests_routes.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): add GET /me (poll) and DELETE /me (cancel)

GET returns 200 with current request or 204 if none. DELETE marks the
pending request 'cancelled' and reverts onboarding_state to 'role_selected'
so the teacher returns to /signup/teacher/join-org on next login.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `GET /api/teacher-join-requests` (admin pending list)

**Files:**
- Modify: `backend/routes/teacher_requests.py`
- Modify: `backend/tests/test_teacher_requests_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_teacher_requests_routes.py`:

```python
class AdminListPendingTest(unittest.TestCase):
    def _admin_app(self):
        app, db = _build_app(uid='admin-1', user_email='admin@x.com', user_name='Admin')
        db.memberships.append({
            'uid': 'admin-1', 'org_id': 'org-1',
            'roles': ['school_admin'], 'status': 'active',
        })
        db.orgs['org-1'] = {'name': 'SF Friends'}
        return app, db

    def test_admin_sees_pending_for_own_org(self):
        app, db = self._admin_app()
        db.users['teacher-99'] = {'email': 't99@x.com', 'name': 'T 99'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-99', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'
            sess['active_membership_id'] = 'mem-1'

        resp = client.get('/api/teacher-join-requests')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(len(body['requests']), 1)
        first = body['requests'][0]
        self.assertEqual(first['requestId'], 'tjr-1')
        self.assertEqual(first['uid'], 'teacher-99')
        self.assertEqual(first['email'], 't99@x.com')
        self.assertEqual(first['name'], 'T 99')

    def test_non_admin_gets_403(self):
        app, db = _build_app(uid='teacher-1')
        # No school_admin membership.
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests')
        self.assertEqual(resp.status_code, 403)
```

Extend `FakeTeacherRequestsDb` with:

```python
    def list_pending_teacher_join_requests_by_org(self, org_id):
        out = []
        for rid, r in self.teacher_join_requests.items():
            if r['org_id'] == org_id and r['status'] == 'pending':
                out.append({'id': rid, **r})
        return out
```

`make_test_deps` constructs a `SchoolRequestContext` resolver — we need this to respect the session-injected membership. Use the existing fixture; the active org binding is the standard pattern. If `deps.get_school_request_context()` doesn't read the session, the failing test will reveal it — at which point use `deps.require_role()` or `ctx.require_any_role({'school_admin'})` matching the pattern from `backend/routes/schools.py` line 432.

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes.AdminListPendingTest -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the endpoint**

Inside `create_teacher_requests_blueprint(deps)`:

```python
    @bp.route('/api/teacher-join-requests', methods=['GET'])
    @deps.login_required
    def admin_list_pending():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        org_id = ctx.active_organization_id
        records = deps.db.list_pending_teacher_join_requests_by_org(org_id)
        out = []
        for rec in records:
            user = deps.db.get_user(rec['uid']) or {}
            out.append({
                'requestId': rec['id'],
                'uid': rec['uid'],
                'name': user.get('name') or '',
                'email': user.get('email') or '',
                'source': rec.get('source'),
                'status': rec.get('status'),
                'requestedAt': str(rec['requested_at']) if rec.get('requested_at') else None,
            })
        return jsonify({'success': True, 'requests': out}), 200
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_teacher_requests_routes.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): GET /api/teacher-join-requests admin list

Returns pending requests for the active school_admin's org. Joins
each request to the requester's user record (name + email) for the
dashboard UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `POST /<id>/approve`

**Files:**
- Modify: `backend/routes/teacher_requests.py`
- Modify: `backend/tests/test_teacher_requests_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_teacher_requests_routes.py`:

```python
class ApproveTeacherJoinRequestTest(unittest.TestCase):
    def _admin_app(self):
        app, db = _build_app(uid='admin-1', user_email='admin@x.com')
        db.memberships.append({
            'uid': 'admin-1', 'org_id': 'org-1',
            'roles': ['school_admin'], 'status': 'active',
        })
        db.orgs['org-1'] = {'name': 'SF Friends'}
        db.users['teacher-99'] = {'email': 't99@x.com', 'name': 'T 99'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-99', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'pending',
        }
        return app, db

    def test_approve_creates_membership_and_outbox_email(self):
        app, db = self._admin_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'

        resp = client.post('/api/teacher-join-requests/tjr-1/approve')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertIn('membershipId', body)
        # Request marked approved
        self.assertEqual(db.teacher_join_requests['tjr-1']['status'], 'approved')
        # Membership recorded
        teacher_mem = [
            m for m in db.memberships
            if m['uid'] == 'teacher-99' and m['org_id'] == 'org-1'
        ]
        self.assertEqual(len(teacher_mem), 1)
        # Outbox: one approval email queued
        approval_emails = [e for e in db.outbox_writes
                           if e['template_id'] == 'teacher_join_approved']
        self.assertEqual(len(approval_emails), 1)
        self.assertEqual(approval_emails[0]['recipient']['email'], 't99@x.com')

    def test_approve_wrong_org_returns_403(self):
        app, db = self._admin_app()
        # Move the request to a different org so admin shouldn't see it.
        db.teacher_join_requests['tjr-1']['org_id'] = 'other-org'
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'

        resp = client.post('/api/teacher-join-requests/tjr-1/approve')
        self.assertEqual(resp.status_code, 403)

    def test_approve_already_decided_returns_409(self):
        app, db = self._admin_app()
        db.teacher_join_requests['tjr-1']['status'] = 'approved'
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'

        resp = client.post('/api/teacher-join-requests/tjr-1/approve')
        self.assertEqual(resp.status_code, 409)
```

Extend `FakeTeacherRequestsDb`:

```python
    def get_teacher_join_request(self, request_id):
        rec = self.teacher_join_requests.get(request_id)
        if rec is None:
            return None
        return {'id': request_id, **rec}

    def create_membership(self, *, org_id, uid, roles):
        self._mem_counter = getattr(self, '_mem_counter', 0) + 1
        membership_id = f'mem-{self._mem_counter}'
        self.memberships.append({
            'id': membership_id, 'org_id': org_id, 'uid': uid,
            'roles': roles, 'status': 'active',
        })
        return membership_id

    def set_user_last_active_membership(self, uid, membership_id):
        self.users.setdefault(uid, {})['last_active_membership_id'] = membership_id

    def collection(self, name):
        """Outbox writes go through deps.db.collection('outbox_emails').document().set(...)."""
        class _DocRef:
            def __init__(self, owner):
                self.owner = owner
                self.id = f'eml-{len(self.owner.outbox_writes) + 1}'
            def set(self, payload):
                self.owner.outbox_writes.append({'id': self.id, **payload})
        class _CollRef:
            def __init__(self, owner):
                self.owner = owner
            def document(self):
                return _DocRef(self.owner)
        return _CollRef(self)
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes.ApproveTeacherJoinRequestTest -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the endpoint**

Inside `create_teacher_requests_blueprint(deps)`:

```python
    @bp.route('/api/teacher-join-requests/<request_id>/approve', methods=['POST'])
    @deps.login_required
    def admin_approve(request_id: str):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        rec = deps.db.get_teacher_join_request(request_id)
        if not rec:
            return jsonify({'success': False, 'error': 'Request not found.'}), 404
        if rec['org_id'] != ctx.active_organization_id:
            return jsonify({'success': False, 'error': 'Not your org.'}), 403
        if rec.get('status') != 'pending':
            return jsonify({
                'success': False,
                'error': f"Request is already {rec.get('status')}.",
            }), 409

        target_uid = rec['uid']
        org_id = rec['org_id']
        admin_uid = deps.get_current_user_uid()

        # TODO(v1.5): wrap these three writes in a Firestore batch/transaction
        # so partial failure can't leave the system in an inconsistent state
        # (membership created but request still pending, etc.). For pilot scale
        # the probability is low; see LIMITATIONS.md.
        membership_id = deps.db.create_membership(
            org_id=org_id,
            uid=target_uid,
            roles=['teacher'],
        )
        deps.db.set_user_last_active_membership(target_uid, membership_id)
        deps.db.update_teacher_join_request_status(
            request_id=request_id,
            status='approved',
            reviewed_by_uid=admin_uid,
        )
        try:
            deps.db.update_user_profile(target_uid, onboarding_state='complete')
        except Exception:
            log.exception('onboarding_state update on approval failed uid=%s', target_uid)

        # Notify teacher.
        try:
            teacher_user = deps.db.get_user(target_uid) or {}
            org = deps.db.get_organization(org_id) or {}
            enqueue_outbox_email(
                db=deps.db,
                recipient_email=teacher_user.get('email', ''),
                recipient_name=teacher_user.get('name'),
                template=OutboxTemplate.TEACHER_JOIN_APPROVED,
                template_data={
                    'org_name': org.get('name', ''),
                    'dashboard_url': _absolute_url('/app/teacher'),
                },
                related_entity_type='teacher_join_request',
                related_entity_id=request_id,
                created_by_uid=admin_uid,
            )
        except Exception:
            log.exception('approval email enqueue failed request=%s', request_id)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'membershipId': membership_id,
            'status': 'approved',
        }), 200
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_teacher_requests_routes.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): POST /<id>/approve creates membership + email

School admin approval transitions the request to 'approved', creates
the teacher membership, sets onboarding_state='complete', and emits
the teacher_join_approved outbox email. Guards: not-found 404, wrong
org 403, already-decided 409.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `POST /<id>/decline`

**Files:**
- Modify: `backend/routes/teacher_requests.py`
- Modify: `backend/tests/test_teacher_requests_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_teacher_requests_routes.py`:

```python
class DeclineTeacherJoinRequestTest(unittest.TestCase):
    def _seed(self):
        app, db = _build_app(uid='admin-1', user_email='admin@x.com')
        db.memberships.append({
            'uid': 'admin-1', 'org_id': 'org-1',
            'roles': ['school_admin'], 'status': 'active',
        })
        db.orgs['org-1'] = {'name': 'SF Friends'}
        db.users['teacher-99'] = {'email': 't99@x.com', 'name': 'T 99'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-99', 'org_id': 'org-1',
            'source': 'search', 'status': 'pending',
        }
        return app, db

    def test_decline_requires_reason(self):
        app, db = self._seed()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'

        resp = client.post('/api/teacher-join-requests/tjr-1/decline', json={})
        self.assertEqual(resp.status_code, 400)

    def test_decline_marks_declined_and_emails_teacher(self):
        app, db = self._seed()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'

        resp = client.post(
            '/api/teacher-join-requests/tjr-1/decline',
            json={'reason': 'Please use your school email.'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(db.teacher_join_requests['tjr-1']['status'], 'declined')
        self.assertEqual(
            db.teacher_join_requests['tjr-1']['decline_reason'],
            'Please use your school email.',
        )
        decline_emails = [e for e in db.outbox_writes
                          if e['template_id'] == 'teacher_join_declined']
        self.assertEqual(len(decline_emails), 1)
        self.assertEqual(
            decline_emails[0]['template_data']['decline_reason'],
            'Please use your school email.',
        )
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes.DeclineTeacherJoinRequestTest -v
```

Expected: 404.

- [ ] **Step 3: Add the endpoint**

Inside `create_teacher_requests_blueprint(deps)`:

```python
    @bp.route('/api/teacher-join-requests/<request_id>/decline', methods=['POST'])
    @deps.login_required
    def admin_decline(request_id: str):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        body = request.get_json(silent=True) or {}
        reason = (body.get('reason') or '').strip()
        if not reason:
            return jsonify({'success': False, 'error': 'A reason is required.'}), 400

        rec = deps.db.get_teacher_join_request(request_id)
        if not rec:
            return jsonify({'success': False, 'error': 'Request not found.'}), 404
        if rec['org_id'] != ctx.active_organization_id:
            return jsonify({'success': False, 'error': 'Not your org.'}), 403
        if rec.get('status') != 'pending':
            return jsonify({
                'success': False,
                'error': f"Request is already {rec.get('status')}.",
            }), 409

        admin_uid = deps.get_current_user_uid()
        deps.db.update_teacher_join_request_status(
            request_id=request_id,
            status='declined',
            reviewed_by_uid=admin_uid,
            decline_reason=reason,
        )
        try:
            deps.db.update_user_profile(rec['uid'], onboarding_state='role_selected')
        except Exception:
            log.exception('onboarding_state revert on decline failed uid=%s', rec['uid'])

        try:
            teacher_user = deps.db.get_user(rec['uid']) or {}
            org = deps.db.get_organization(rec['org_id']) or {}
            enqueue_outbox_email(
                db=deps.db,
                recipient_email=teacher_user.get('email', ''),
                recipient_name=teacher_user.get('name'),
                template=OutboxTemplate.TEACHER_JOIN_DECLINED,
                template_data={
                    'org_name': org.get('name', ''),
                    'decline_reason': reason,
                    'retry_url': _absolute_url('/signup/teacher/join-org'),
                },
                related_entity_type='teacher_join_request',
                related_entity_id=request_id,
                created_by_uid=admin_uid,
            )
        except Exception:
            log.exception('decline email enqueue failed request=%s', request_id)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'status': 'declined',
        }), 200
```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_teacher_requests_routes -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_teacher_requests_routes.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): POST /<id>/decline with reason + email

Decline requires a non-empty reason. Sets status='declined', reverts
the requester's onboarding_state to 'role_selected' so they can retry,
and emails the teacher with the reason and a retry URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `GET /api/organizations/search` with rate limiting

**Files:**
- Modify: `backend/routes/teacher_requests.py`
- Create: `backend/tests/test_org_search_route.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_org_search_route.py`:

```python
"""Tests for GET /api/organizations/search."""
from __future__ import annotations

import unittest

from backend.routes.teacher_requests import create_teacher_requests_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeOrgSearchDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.orgs_index: list = []

    def search_organizations(self, query, limit=10):
        q = (query or '').strip().lower()
        if not q:
            return []
        return [o for o in self.orgs_index if o['name'].lower().startswith(q)][:limit]


class OrgSearchRouteTest(unittest.TestCase):
    def _client(self):
        db = FakeOrgSearchDb()
        db.orgs_index = [
            {'id': 'org-1', 'name': 'San Francisco Friends School', 'city': 'San Francisco',
             'state': 'CA', 'school_type': 'k12'},
            {'id': 'org-2', 'name': 'San Diego High', 'city': 'San Diego',
             'state': 'CA', 'school_type': 'high'},
            {'id': 'org-3', 'name': 'Boston Latin', 'city': 'Boston',
             'state': 'MA', 'school_type': 'high'},
        ]
        deps = make_test_deps(db=db)
        bp = create_teacher_requests_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}
        return client, db

    def test_search_returns_filtered_results(self):
        client, _ = self._client()
        resp = client.get('/api/organizations/search?q=san')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        names = [r['name'] for r in body['results']]
        self.assertIn('San Francisco Friends School', names)
        self.assertIn('San Diego High', names)
        self.assertNotIn('Boston Latin', names)

    def test_search_empty_query_returns_empty(self):
        client, _ = self._client()
        resp = client.get('/api/organizations/search?q=')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['results'], [])

    def test_search_requires_auth(self):
        db = FakeOrgSearchDb()
        deps = make_test_deps(db=db)
        bp = create_teacher_requests_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        resp = client.get('/api/organizations/search?q=san')
        self.assertEqual(resp.status_code, 401)

    def test_search_rate_limit_blocks_after_threshold(self):
        client, _ = self._client()
        # Threshold: 10 req in ~1s. Fire 12 quickly; the last calls return 429.
        statuses = []
        for _ in range(12):
            resp = client.get('/api/organizations/search?q=san')
            statuses.append(resp.status_code)
        self.assertIn(429, statuses, f"Expected at least one 429, got {statuses}")
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_org_search_route -v
```

Expected: 404 / route missing.

- [ ] **Step 3: Add the endpoint + simple in-memory rate limiter**

Add near the top of `backend/routes/teacher_requests.py` (after imports):

```python
import time
from collections import deque

# Per-uid rate limit: at most 10 search calls per 1-second window.
_RATE_LIMIT_PER_UID: dict[str, deque] = {}
_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW_SECONDS = 1.0


def _check_rate_limit(uid: str) -> bool:
    now = time.monotonic()
    bucket = _RATE_LIMIT_PER_UID.setdefault(uid, deque())
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT_MAX:
        return False
    bucket.append(now)
    return True
```

Inside `create_teacher_requests_blueprint(deps)`:

```python
    @bp.route('/api/organizations/search', methods=['GET'])
    @deps.login_required
    def org_search():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        if not _check_rate_limit(uid):
            return jsonify({'success': False, 'error': 'Too many requests.'}), 429
        query = (request.args.get('q') or '').strip()
        if not query:
            return jsonify({'success': True, 'results': []}), 200
        results = deps.db.search_organizations(query, limit=10)
        return jsonify({'success': True, 'results': results}), 200
```

> The rate limiter is process-local — fine for a single-replica Cloud Run instance. If we ever scale horizontally, replace with Firestore-backed or Redis tracking. (v1 LIMITATIONS entry covers this.)

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_org_search_route -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teacher_requests.py backend/tests/test_org_search_route.py
git commit -m "$(cat <<'EOF'
feat(teacher-join): GET /api/organizations/search (rate-limited)

Public-ish org search, auth required, 10 req/sec/uid in-memory limit.
Returns metadata only (name, city, state, school_type) — no PII or
capacity numbers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Register blueprint + remove auto-approve from `schools.py`

**Files:**
- Modify: `main.py`
- Modify: `backend/routes/schools.py`
- Modify: `backend/tests/test_school_routes_join_as_teacher.py` (or wherever the auto-approve test lives — update or delete)

- [ ] **Step 1: Write a failing test capturing the new contract**

Find or create `backend/tests/test_school_routes_join_as_teacher.py`. Add (replace any pre-existing auto-approve tests):

```python
"""Verify /api/schools/join-as-teacher now redirects to the new endpoint."""
from __future__ import annotations

import unittest

from backend.routes.schools import create_schools_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class LegacyJoinAsTeacherRedirectTest(unittest.TestCase):
    def test_returns_410_gone_pointing_to_new_endpoint(self):
        db = FakeDbBase()
        deps = make_test_deps(db=db)
        bp = create_schools_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/schools/join-as-teacher', json={'inviteCode': 'ABC123'})
        self.assertEqual(resp.status_code, 410)
        body = resp.get_json()
        self.assertIn('/api/teacher-join-requests', body.get('error', ''))
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_school_routes_join_as_teacher -v
```

Expected: 200 or 201 (auto-approve still wired), not 410.

- [ ] **Step 3: Replace the body of `api_join_as_teacher`**

In `backend/routes/schools.py` (lines 443–508), replace the entire route body with a 410 Gone response:

```python
    @bp.route("/api/schools/join-as-teacher", methods=["POST"])
    @deps.login_required
    def api_join_as_teacher():
        """Deprecated: superseded by POST /api/teacher-join-requests.

        Returns 410 Gone with a pointer. Frontends that still call this should
        be updated to use the new endpoint. Removing the route entirely would
        break any cached SPA bundle still in users' browsers — keep this until
        the next forced cache bust.
        """
        return jsonify({
            "success": False,
            "error": (
                "This endpoint has been replaced by "
                "POST /api/teacher-join-requests. Please refresh the page."
            ),
        }), 410
```

In `main.py`, register the new blueprint near the existing `create_schools_blueprint(deps)` call:

```python
from backend.routes.teacher_requests import create_teacher_requests_blueprint
# ... existing registrations ...
app.register_blueprint(create_teacher_requests_blueprint(deps))
```

- [ ] **Step 4: Run tests to verify**

```bash
python3 -m unittest backend.tests.test_school_routes_join_as_teacher backend.tests.test_teacher_requests_routes -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add main.py backend/routes/schools.py backend/tests/test_school_routes_join_as_teacher.py
git commit -m "$(cat <<'EOF'
refactor(teacher-join): retire auto-approve join-as-teacher endpoint

POST /api/schools/join-as-teacher now returns 410 Gone with a pointer
to POST /api/teacher-join-requests (Plan 4 hybrid flow). This reverts
the auto-approve behavior from commit 4bbcbe3 — every teacher join now
goes through a school_admin review.

Also registers the new teacher_requests blueprint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `organizations.school_admin_uids` denormalization

**Why:** The teacher-join Firestore rule needs a way to check "is the caller a school_admin of this org?" Firestore rules can't run arbitrary queries, so we denormalize: each `organizations/{id}` doc carries a `school_admin_uids: string[]` array that the rule can `get()` and check with `hasAny()`. This task adds the array, keeps it in sync on every membership grant/revoke that touches `school_admin`, and provides a one-shot backfill for legacy orgs.

**Files:**
- Modify: `database.py` (add `_sync_org_admin_uids` helper, call from `create_membership`, expose for membership-removal paths)
- Modify: `backend/tests/test_database_teacher_join_requests.py` (add a new test class)
- Create: `scripts/backfill_school_admin_uids.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_database_teacher_join_requests.py`:

```python
class SchoolAdminUidsDenormalizationTest(unittest.TestCase):
    def setUp(self):
        self.org_doc_ref = MagicMock()
        self.org_doc_ref.id = 'org-1'
        self.mem_doc_ref = MagicMock()
        self.mem_doc_ref.id = 'mem-1'

        # Two collections returned by client.collection(name)
        self.fake_client = MagicMock()

        def _collection(name):
            mock = MagicMock()
            if name == 'organizations':
                mock.document.return_value = self.org_doc_ref
            elif name == 'memberships':
                mock.document.return_value = self.mem_doc_ref
            return mock
        self.fake_client.collection.side_effect = _collection

        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def test_create_membership_with_school_admin_role_adds_uid_to_org(self):
        """create_membership(roles=['school_admin']) must ArrayUnion uid onto org."""
        database.create_membership(
            org_id='org-1',
            uid='admin-1',
            roles=['school_admin'],
        )
        # Org doc must have been updated with an ArrayUnion on school_admin_uids.
        self.org_doc_ref.update.assert_called_once()
        update_payload = self.org_doc_ref.update.call_args[0][0]
        self.assertIn('school_admin_uids', update_payload)

    def test_create_membership_teacher_only_does_not_touch_org_array(self):
        """Non-admin role grant doesn't mutate school_admin_uids."""
        database.create_membership(
            org_id='org-1',
            uid='teacher-1',
            roles=['teacher'],
        )
        # Org doc must NOT have been updated.
        self.org_doc_ref.update.assert_not_called()

    def test_sync_org_admin_uids_remove_uses_array_remove(self):
        """Explicit remove path uses ArrayRemove."""
        database._sync_org_admin_uids('org-1', 'admin-1', add=False)
        self.org_doc_ref.update.assert_called_once()
        update_payload = self.org_doc_ref.update.call_args[0][0]
        self.assertIn('school_admin_uids', update_payload)
```

- [ ] **Step 2: Run test to verify failure**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests.SchoolAdminUidsDenormalizationTest -v
```

Expected: `AttributeError: module 'database' has no attribute '_sync_org_admin_uids'`.

- [ ] **Step 3: Implement the helper + integrate with `create_membership`**

In `database.py`, add the helper near the other org helpers (around line 770):

```python
def _sync_org_admin_uids(org_id: str, uid: str, *, add: bool) -> None:
    """Maintain organizations/{id}.school_admin_uids in sync with membership grants.

    Called whenever a membership touching the school_admin role is created or
    removed. Idempotent; ArrayUnion / ArrayRemove are commutative.
    """
    if not org_id or not uid:
        return
    op = firestore.ArrayUnion([uid]) if add else firestore.ArrayRemove([uid])
    get_organizations_collection().document(org_id).update({'school_admin_uids': op})
```

Update `create_membership()` (around line 784) to call the helper when `school_admin` is in the granted roles. Replace the function body:

```python
def create_membership(
    org_id,
    uid,
    roles,
    status='active',
    primary_class_ids=None,
    membership_id=None,
):
    """Create a membership document.

    Side effect: if roles includes 'school_admin', also adds uid to
    organizations/{org_id}.school_admin_uids (needed for Firestore rules
    to authorize admin reads on Plan 4's teacher_join_requests).
    """
    doc_ref = get_membership_ref(membership_id) if membership_id else get_memberships_collection().document()
    normalized_roles = _normalize_string_list(roles)
    membership_data = {
        'org_id': org_id,
        'uid': uid,
        'roles': normalized_roles,
        'status': status,
        'primary_class_ids': _normalize_string_list(primary_class_ids or []),
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(membership_data)
    if 'school_admin' in normalized_roles and status == 'active':
        _sync_org_admin_uids(org_id, uid, add=True)
    return doc_ref.id
```

> **Membership-removal paths**: there are several ways memberships get deactivated or roles get changed (deletion_requests workflow, eventual role-change endpoint). Each one that downgrades school_admin must also call `_sync_org_admin_uids(org_id, uid, add=False)`. For Plan 4 we only ship the create-side hook because Plan 4 never deactivates school_admins. **Add a TODO comment** in `database.py` near the helper:
>
> ```python
> # TODO: any future path that revokes a school_admin role (membership
> # deletion, role-change endpoint, org suspension cascading to memberships)
> # MUST call _sync_org_admin_uids(org_id, uid, add=False). Audit when
> # implementing Plan 5 (Lingual admin org panel — suspend/restore).
> ```

- [ ] **Step 4: Run test to verify pass**

```bash
python3 -m unittest backend.tests.test_database_teacher_join_requests.SchoolAdminUidsDenormalizationTest -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Create the backfill script**

Create `scripts/backfill_school_admin_uids.py`:

```python
"""Backfill organizations.school_admin_uids for orgs created before Plan 4.

Walks every membership with role=school_admin & status=active, and ensures
its uid is in the target org's school_admin_uids array.

Idempotent. Run with --dry-run first.

Usage:
    python3 scripts/backfill_school_admin_uids.py --dry-run
    python3 scripts/backfill_school_admin_uids.py
"""
from __future__ import annotations

import argparse
import collections
import sys

import firebase_admin
from firebase_admin import firestore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    firebase_admin.initialize_app()
    db = firestore.client()

    # Gather active school_admin memberships per org.
    by_org: dict[str, set[str]] = collections.defaultdict(set)
    for m in (
        db.collection('memberships')
          .where('status', '==', 'active')
          .where('roles', 'array_contains', 'school_admin')
          .stream()
    ):
        data = m.to_dict() or {}
        org_id = data.get('org_id')
        uid = data.get('uid')
        if org_id and uid:
            by_org[org_id].add(uid)

    touched = 0
    skipped = 0
    for org_id, expected in by_org.items():
        org_ref = db.collection('organizations').document(org_id)
        org_doc = org_ref.get()
        if not org_doc.exists:
            skipped += 1
            continue
        current = set((org_doc.to_dict() or {}).get('school_admin_uids') or [])
        missing = expected - current
        if not missing:
            skipped += 1
            continue
        print(f"{'[DRY] ' if args.dry_run else ''}org {org_id}: adding {sorted(missing)}")
        if not args.dry_run:
            org_ref.update({
                'school_admin_uids': firestore.ArrayUnion(list(missing)),
            })
        touched += 1

    print(f"\nDone. orgs_touched={touched} orgs_skipped={skipped}")


if __name__ == '__main__':
    sys.exit(main() or 0)
```

- [ ] **Step 6: Commit**

```bash
git add database.py backend/tests/test_database_teacher_join_requests.py scripts/backfill_school_admin_uids.py
git commit -m "$(cat <<'EOF'
feat(memberships): denormalize school_admin_uids onto org docs

Firestore security rules can't run arbitrary queries, so we keep a
school_admin_uids array on every organization doc and update it as a
side effect of create_membership when school_admin is granted. Includes
backfill script for orgs created before this commit.

This unblocks the teacher_join_requests rule in the next task: an admin
can read a request if their uid is in the target org's school_admin_uids.

TODO comments flag every future membership-removal path that must also
call _sync_org_admin_uids(add=False) — audit during Plan 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Firestore rules + emulator test

**Files:**
- Modify: `firestore.rules`
- Create: `firebase-tests/teacher_join_requests.rules.test.ts`

- [ ] **Step 1: Write the failing rules test**

Create `firebase-tests/teacher_join_requests.rules.test.ts`:

```typescript
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds }
    from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

let env: RulesTestEnvironment;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'lingu-480600',
        firestore: { rules: readFileSync('../firestore.rules', 'utf8') },
    });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'memberships/admin-mem'), {
            uid: 'admin-1', org_id: 'org-1',
            roles: ['school_admin'], status: 'active',
        });
        await setDoc(doc(db, 'teacher_join_requests/tjr-1'), {
            uid: 'teacher-1', org_id: 'org-1',
            source: 'search', status: 'pending',
        });
        await setDoc(doc(db, 'teacher_join_requests/tjr-2'), {
            uid: 'teacher-2', org_id: 'org-other',
            source: 'search', status: 'pending',
        });
    });
});

test('requester can read own request', async () => {
    const ctx = env.authenticatedContext('teacher-1');
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
});

test('requester cannot read others\' requests', async () => {
    const ctx = env.authenticatedContext('teacher-1');
    await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-2')));
});

test('unauthenticated cannot read', async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
});

test('school_admin can read requests for own org', async () => {
    const ctx = env.authenticatedContext('admin-1');
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
});

test('school_admin cannot read other orgs\' requests', async () => {
    const ctx = env.authenticatedContext('admin-1');
    await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-2')));
});

test('client cannot write directly (all writes via backend admin SDK)', async () => {
    const ctx = env.authenticatedContext('teacher-1');
    await assertFails(setDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-3'), {
        uid: 'teacher-1', org_id: 'org-1', source: 'search', status: 'pending',
    }));
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
make test-firebase
```

Expected: `teacher_join_requests` rule missing — all reads fail because the default deny-all applies.

- [ ] **Step 3: Add rules to `firestore.rules`**

In `firestore.rules`, add a new block (place it near the `outbox_emails` block around line 164 or with other admin-scoped collections):

```
match /teacher_join_requests/{requestId} {
    allow read: if request.auth != null
                && (
                    resource.data.uid == request.auth.uid
                    || get(/databases/$(database)/documents/organizations/$(resource.data.org_id))
                        .data.school_admin_uids.hasAny([request.auth.uid])
                );

    // Clients never write directly; backend admin SDK bypasses rules.
    allow write: if false;
}
```

The admin clause relies on the `organizations.school_admin_uids` array maintained by Task 11. If a school_admin's uid isn't in that array (legacy org never backfilled), the rule denies them. Run `scripts/backfill_school_admin_uids.py` before deploying.

- [ ] **Step 4: Update emulator test seed** to include `school_admin_uids` on the org:

In `beforeEach` of `firebase-tests/teacher_join_requests.rules.test.ts`, add:

```typescript
await setDoc(doc(db, 'organizations/org-1'), { school_admin_uids: ['admin-1'] });
await setDoc(doc(db, 'organizations/org-other'), { school_admin_uids: [] });
```

- [ ] **Step 5: Run rules tests to verify pass**

```bash
make test-firebase
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firebase-tests/teacher_join_requests.rules.test.ts database.py
git commit -m "$(cat <<'EOF'
feat(rules): teacher_join_requests read rules + admin-uid denormalization

Requester can read own request. School admin can read requests targeting
their org via the new denormalized organizations/{id}.school_admin_uids
array. All writes go through the backend admin SDK (rule denies client
writes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **Sub-task during execution (if needed):** if `school_admin_uids` isn't yet maintained on org create / membership grant flows, add a separate commit that wires it through `database.create_membership(..., roles=['school_admin'])` and runs a backfill (`scripts/backfill_school_admin_uids.py`). Verify by reading `database.py:create_membership` before this task lands.

---

## Task 13: Frontend API client `teacherRequests.ts`

**Files:**
- Create: `frontend/src/types/teacherJoin.ts`
- Create: `frontend/src/api/teacherRequests.ts`
- Create: `frontend/src/api/teacherRequests.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/teacherRequests.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    submitTeacherJoinRequest,
    getMyTeacherJoinRequest,
    cancelMyTeacherJoinRequest,
    listPendingTeacherRequests,
    approveTeacherJoinRequest,
    declineTeacherJoinRequest,
    searchOrganizations,
} from './teacherRequests';
import api from './index';

vi.mock('./index');

const mockedApi = api as unknown as {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    mockedApi.post = vi.fn();
    mockedApi.get = vi.fn();
    mockedApi.delete = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('submitTeacherJoinRequest', () => {
    it('posts inviteCode form', async () => {
        mockedApi.post.mockResolvedValue({
            data: { success: true, requestId: 'tjr-1', orgId: 'org-1',
                    orgName: 'SF', status: 'pending', source: 'invite_code' },
        });
        const result = await submitTeacherJoinRequest({ inviteCode: 'ABC123' });
        expect(mockedApi.post).toHaveBeenCalledWith(
            '/teacher-join-requests',
            { inviteCode: 'ABC123' },
        );
        expect(result.orgName).toBe('SF');
    });

    it('posts orgId form', async () => {
        mockedApi.post.mockResolvedValue({
            data: { success: true, requestId: 'tjr-1', orgId: 'org-1',
                    orgName: 'SF', status: 'pending', source: 'search' },
        });
        await submitTeacherJoinRequest({ orgId: 'org-1' });
        expect(mockedApi.post).toHaveBeenCalledWith(
            '/teacher-join-requests',
            { orgId: 'org-1' },
        );
    });
});

describe('getMyTeacherJoinRequest', () => {
    it('returns null on 204', async () => {
        mockedApi.get.mockResolvedValue({ status: 204, data: null });
        const result = await getMyTeacherJoinRequest();
        expect(result).toBeNull();
    });

    it('returns request on 200', async () => {
        mockedApi.get.mockResolvedValue({
            status: 200,
            data: {
                requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF',
                status: 'pending', source: 'search',
            },
        });
        const result = await getMyTeacherJoinRequest();
        expect(result?.status).toBe('pending');
    });
});

describe('searchOrganizations', () => {
    it('returns empty array on blank query', async () => {
        const result = await searchOrganizations('   ');
        expect(result).toEqual([]);
        expect(mockedApi.get).not.toHaveBeenCalled();
    });

    it('hits the endpoint with query', async () => {
        mockedApi.get.mockResolvedValue({
            data: {
                success: true,
                results: [
                    { id: 'org-1', name: 'SF Friends', city: 'SF', state: 'CA', school_type: 'k12' },
                ],
            },
        });
        const result = await searchOrganizations('SF');
        expect(mockedApi.get).toHaveBeenCalledWith('/organizations/search', { params: { q: 'SF' } });
        expect(result[0].name).toBe('SF Friends');
    });
});

describe('admin actions', () => {
    it('listPendingTeacherRequests returns array', async () => {
        mockedApi.get.mockResolvedValue({
            data: { success: true, requests: [
                { requestId: 'tjr-1', uid: 'teacher-99', name: 'T', email: 't@x.com',
                  source: 'search', status: 'pending', requestedAt: '2026-05-18T00:00:00Z' },
            ]},
        });
        const result = await listPendingTeacherRequests();
        expect(result).toHaveLength(1);
        expect(result[0].email).toBe('t@x.com');
    });

    it('approveTeacherJoinRequest hits POST', async () => {
        mockedApi.post.mockResolvedValue({
            data: { success: true, requestId: 'tjr-1', membershipId: 'mem-1', status: 'approved' },
        });
        await approveTeacherJoinRequest('tjr-1');
        expect(mockedApi.post).toHaveBeenCalledWith('/teacher-join-requests/tjr-1/approve');
    });

    it('declineTeacherJoinRequest sends reason', async () => {
        mockedApi.post.mockResolvedValue({
            data: { success: true, requestId: 'tjr-1', status: 'declined' },
        });
        await declineTeacherJoinRequest('tjr-1', 'Wrong school');
        expect(mockedApi.post).toHaveBeenCalledWith(
            '/teacher-join-requests/tjr-1/decline',
            { reason: 'Wrong school' },
        );
    });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd frontend && npm run test -- --run src/api/teacherRequests.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement types + client**

Create `frontend/src/types/teacherJoin.ts`:

```typescript
export type TeacherJoinRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type TeacherJoinRequestSource = 'invite_code' | 'search';

export interface TeacherJoinRequest {
    requestId: string;
    orgId: string;
    orgName: string;
    status: TeacherJoinRequestStatus;
    source?: TeacherJoinRequestSource;
    declineReason?: string;
}

export interface PendingTeacherRequestRow {
    requestId: string;
    uid: string;
    name: string;
    email: string;
    source: TeacherJoinRequestSource;
    status: TeacherJoinRequestStatus;
    requestedAt: string | null;
}

export interface OrgSearchResult {
    id: string;
    name: string;
    city?: string;
    state?: string;
    school_type?: string;
}
```

Create `frontend/src/api/teacherRequests.ts`:

```typescript
import api from './index';
import type {
    TeacherJoinRequest,
    PendingTeacherRequestRow,
    OrgSearchResult,
} from '@/types/teacherJoin';

export interface SubmitArgs {
    inviteCode?: string;
    orgId?: string;
}

export interface SubmitResult {
    requestId: string;
    orgId: string;
    orgName: string;
    status: 'pending';
    source: 'invite_code' | 'search';
}

export async function submitTeacherJoinRequest(args: SubmitArgs): Promise<SubmitResult> {
    const payload: Record<string, string> = {};
    if (args.inviteCode) payload.inviteCode = args.inviteCode;
    if (args.orgId) payload.orgId = args.orgId;
    const { data } = await api.post('/teacher-join-requests', payload);
    return {
        requestId: data.requestId,
        orgId: data.orgId,
        orgName: data.orgName,
        status: 'pending',
        source: data.source,
    };
}

export async function getMyTeacherJoinRequest(): Promise<TeacherJoinRequest | null> {
    const resp = await api.get('/teacher-join-requests/me');
    if (resp.status === 204 || !resp.data) return null;
    return resp.data as TeacherJoinRequest;
}

export async function cancelMyTeacherJoinRequest(): Promise<void> {
    await api.delete('/teacher-join-requests/me');
}

export async function listPendingTeacherRequests(): Promise<PendingTeacherRequestRow[]> {
    const { data } = await api.get('/teacher-join-requests');
    return data.requests ?? [];
}

export async function approveTeacherJoinRequest(requestId: string): Promise<void> {
    await api.post(`/teacher-join-requests/${encodeURIComponent(requestId)}/approve`);
}

export async function declineTeacherJoinRequest(requestId: string, reason: string): Promise<void> {
    await api.post(
        `/teacher-join-requests/${encodeURIComponent(requestId)}/decline`,
        { reason },
    );
}

export async function searchOrganizations(query: string): Promise<OrgSearchResult[]> {
    const q = (query ?? '').trim();
    if (!q) return [];
    const { data } = await api.get('/organizations/search', { params: { q } });
    return data.results ?? [];
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd frontend && npm run test -- --run src/api/teacherRequests.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/teacherRequests.ts frontend/src/api/teacherRequests.test.ts frontend/src/types/teacherJoin.ts
git commit -m "$(cat <<'EOF'
feat(api): teacherRequests client + types

Typed wrappers for the new Plan 4 endpoints: submit, poll, cancel,
list, approve, decline, org search. searchOrganizations short-circuits
on blank input to spare a backend round-trip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `TeacherJoinOrgPage` (Pane A + Pane B + Pane C)

**Files:**
- Create: `frontend/src/pages/TeacherJoinOrgPage.tsx`
- Create: `frontend/src/pages/TeacherJoinOrgPage.test.tsx`

This is one of the largest single tasks. Each pane gets its own group of tests but they all live in one file because they share state.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/TeacherJoinOrgPage.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TeacherJoinOrgPage } from './TeacherJoinOrgPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

const submitMock = vi.fn();
const searchMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    submitTeacherJoinRequest: (...a: unknown[]) => submitMock(...a),
    searchOrganizations: (...a: unknown[]) => searchMock(...a),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ refreshUser: vi.fn() }),
}));

function renderPage() {
    return render(
        <MemoryRouter>
            <TeacherJoinOrgPage />
        </MemoryRouter>
    );
}

beforeEach(() => {
    navigate.mockReset();
    submitMock.mockReset();
    searchMock.mockReset();
});

describe('Pane A — entry', () => {
    it('shows two options', () => {
        renderPage();
        expect(screen.getByRole('button', { name: /invite code/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /find my school/i })).toBeInTheDocument();
    });
});

describe('Pane B — invite code', () => {
    it('submits 6-char code and navigates to pending', async () => {
        submitMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'invite_code',
        });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /invite code/i }));
        const input = screen.getByPlaceholderText(/ABC123/);
        fireEvent.change(input, { target: { value: 'abc123' } });
        fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
        await waitFor(() => {
            expect(submitMock).toHaveBeenCalledWith({ inviteCode: 'ABC123' });
        });
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/pending', { replace: true });
    });

    it('shows error on invalid code', async () => {
        submitMock.mockRejectedValue(new Error('Invalid or expired invite code.'));
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /invite code/i }));
        fireEvent.change(screen.getByPlaceholderText(/ABC123/), { target: { value: 'XXXXXX' } });
        fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
        await waitFor(() => {
            expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
        });
    });
});

describe('Pane C — search', () => {
    it('searches and shows results', async () => {
        searchMock.mockResolvedValue([
            { id: 'org-1', name: 'SF Friends', city: 'SF', state: 'CA', school_type: 'k12' },
        ]);
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        const input = screen.getByPlaceholderText(/school name/i);
        fireEvent.change(input, { target: { value: 'SF' } });
        await waitFor(() => {
            expect(searchMock).toHaveBeenCalledWith('SF');
        });
        expect(await screen.findByText('SF Friends')).toBeInTheDocument();
    });

    it('submits the selected org and navigates to pending', async () => {
        searchMock.mockResolvedValue([
            { id: 'org-1', name: 'SF Friends', city: 'SF', state: 'CA', school_type: 'k12' },
        ]);
        submitMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        fireEvent.change(screen.getByPlaceholderText(/school name/i), { target: { value: 'SF' } });
        const result = await screen.findByText('SF Friends');
        fireEvent.click(result);
        // Confirm dialog
        const confirm = await screen.findByRole('button', { name: /confirm/i });
        fireEvent.click(confirm);
        await waitFor(() => {
            expect(submitMock).toHaveBeenCalledWith({ orgId: 'org-1' });
        });
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/pending', { replace: true });
    });

    it('offers admin-wizard pivot for "Can\'t find my school"', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        const pivot = screen.getByText(/i'm actually an administrator/i);
        fireEvent.click(pivot);
        expect(navigate).toHaveBeenCalledWith('/signup/admin/org-wizard');
    });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd frontend && npm run test -- --run src/pages/TeacherJoinOrgPage.test.tsx
```

Expected: file not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/TeacherJoinOrgPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Search, Ticket } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedPage } from '@/components/layout';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import {
    submitTeacherJoinRequest,
    searchOrganizations,
} from '@/api/teacherRequests';
import type { OrgSearchResult } from '@/types/teacherJoin';

type Pane = 'entry' | 'code' | 'search';

export function TeacherJoinOrgPage() {
    const navigate = useNavigate();
    const [pane, setPane] = useState<Pane>('entry');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Pane B state
    const [code, setCode] = useState('');

    // Pane C state
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<OrgSearchResult[]>([]);
    const [confirmTarget, setConfirmTarget] = useState<OrgSearchResult | null>(null);

    useEffect(() => {
        if (pane !== 'search') return;
        const q = query.trim();
        if (!q) {
            setResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const out = await searchOrganizations(q);
                setResults(out);
            } catch {
                setResults([]);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [pane, query]);

    function reset() {
        setError(null);
        setSubmitting(false);
    }

    async function submitCode() {
        const upper = code.trim().toUpperCase();
        if (upper.length !== 6) {
            setError('Please enter a 6-character invite code.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await submitTeacherJoinRequest({ inviteCode: upper });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit code.');
        } finally {
            setSubmitting(false);
        }
    }

    async function submitOrg(orgId: string) {
        setSubmitting(true);
        setError(null);
        try {
            await submitTeacherJoinRequest({ orgId });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit request.');
            setConfirmTarget(null);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <AnimatedPage>
            <div className="min-h-screen flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                >
                    <Card className="p-8 space-y-6">
                        {pane !== 'entry' && (
                            <button
                                type="button"
                                className="flex items-center text-sm text-muted-foreground"
                                onClick={() => { reset(); setPane('entry'); }}
                            >
                                <ArrowLeft className="h-4 w-4 mr-1" /> Change role
                            </button>
                        )}

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        {pane === 'entry' && (
                            <>
                                <div className="text-center space-y-1">
                                    <h1 className="text-2xl font-bold">Find your school</h1>
                                    <p className="text-muted-foreground text-sm">
                                        Do you have an invite code from your school?
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <Button onClick={() => { reset(); setPane('code'); }}>
                                        <Ticket className="mr-2 h-4 w-4" />
                                        Yes, I have an invite code
                                    </Button>
                                    <Button variant="outline" onClick={() => { reset(); setPane('search'); }}>
                                        <Search className="mr-2 h-4 w-4" />
                                        No, find my school
                                    </Button>
                                </div>
                            </>
                        )}

                        {pane === 'code' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">Enter your invite code</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Six characters, shared by your school admin.
                                    </p>
                                </div>
                                <Input
                                    placeholder="ABC123"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                                    className="text-center text-2xl tracking-[0.3em] font-mono"
                                    maxLength={6}
                                    autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') submitCode(); }}
                                />
                                <Button onClick={submitCode} disabled={submitting || code.length !== 6} className="w-full">
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Submit code
                                </Button>
                            </>
                        )}

                        {pane === 'search' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">Find your school</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Type your school's name.
                                    </p>
                                </div>
                                <Input
                                    placeholder="School name"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    autoFocus
                                />
                                <div className="space-y-2">
                                    {results.map((r) => (
                                        <button
                                            key={r.id}
                                            type="button"
                                            className="w-full text-left rounded-md border p-3 hover:bg-accent"
                                            onClick={() => setConfirmTarget(r)}
                                        >
                                            <div className="font-medium">{r.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {[r.city, r.state, r.school_type].filter(Boolean).join(' · ')}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {confirmTarget && (
                                    <Card className="p-4 space-y-3">
                                        <p className="text-sm">
                                            Request to join <strong>{confirmTarget.name}</strong>?
                                        </p>
                                        <div className="flex gap-2">
                                            <Button onClick={() => submitOrg(confirmTarget.id)} disabled={submitting}>
                                                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                                Confirm
                                            </Button>
                                            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </Card>
                                )}
                                <details className="text-xs text-muted-foreground">
                                    <summary className="cursor-pointer">Can't find my school?</summary>
                                    <div className="mt-2 space-y-2">
                                        <button
                                            type="button"
                                            className="text-primary underline"
                                            onClick={() => navigate('/signup/admin/org-wizard')}
                                        >
                                            I'm actually an administrator — register my school
                                        </button>
                                        <p>Or try a different spelling above.</p>
                                    </div>
                                </details>
                                <p className="text-right text-sm">
                                    <a href="mailto:support@lingual.app" className="text-primary underline">
                                        Contact support
                                    </a>
                                </p>
                            </>
                        )}
                    </Card>
                </motion.div>
            </div>
        </AnimatedPage>
    );
}

export default TeacherJoinOrgPage;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd frontend && npm run test -- --run src/pages/TeacherJoinOrgPage.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TeacherJoinOrgPage.tsx frontend/src/pages/TeacherJoinOrgPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(teacher-join): TeacherJoinOrgPage with three panes

Pane A (entry): two large buttons — invite code or find by search.
Pane B (code): 6-char input, submits to POST /api/teacher-join-requests.
Pane C (search): debounced org search, confirm dialog, admin pivot
under "Can't find my school?". Navigates to /signup/teacher/pending
on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `TeacherJoinPendingPage`

**Files:**
- Create: `frontend/src/pages/TeacherJoinPendingPage.tsx`
- Create: `frontend/src/pages/TeacherJoinPendingPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/TeacherJoinPendingPage.test.tsx`:

```typescript
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeacherJoinPendingPage } from './TeacherJoinPendingPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

const getMyMock = vi.fn();
const cancelMyMock = vi.fn();
const refreshUserMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    getMyTeacherJoinRequest: (...a: unknown[]) => getMyMock(...a),
    cancelMyTeacherJoinRequest: (...a: unknown[]) => cancelMyMock(...a),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ refreshUser: refreshUserMock }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockReset();
    getMyMock.mockReset();
    cancelMyMock.mockReset();
    refreshUserMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

function renderPage() {
    return render(
        <MemoryRouter>
            <TeacherJoinPendingPage />
        </MemoryRouter>,
    );
}

describe('TeacherJoinPendingPage', () => {
    it('shows pending state', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalled());
        expect(await screen.findByText(/awaiting/i)).toBeInTheDocument();
        expect(screen.getByText(/SF Friends/)).toBeInTheDocument();
    });

    it('polls every 30 seconds', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(2));
    });

    it('navigates to dashboard on approval', async () => {
        getMyMock.mockResolvedValueOnce({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        getMyMock.mockResolvedValueOnce(null);  // status=approved → cleared
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
        expect(navigate).toHaveBeenCalledWith('/app/teacher', { replace: true });
    });

    it('cancel button calls cancelMyTeacherJoinRequest and routes back', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        cancelMyMock.mockResolvedValue(undefined);
        renderPage();
        const cancelBtn = await screen.findByRole('button', { name: /cancel request/i });
        fireEvent.click(cancelBtn);
        await waitFor(() => expect(cancelMyMock).toHaveBeenCalled());
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/join-org', { replace: true });
    });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd frontend && npm run test -- --run src/pages/TeacherJoinPendingPage.test.tsx
```

Expected: file not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/TeacherJoinPendingPage.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedPage } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import {
    getMyTeacherJoinRequest,
    cancelMyTeacherJoinRequest,
} from '@/api/teacherRequests';
import type { TeacherJoinRequest } from '@/types/teacherJoin';
import { useAuth } from '@/hooks/useAuth';

const POLL_INTERVAL_MS = 30_000;

export function TeacherJoinPendingPage() {
    const navigate = useNavigate();
    const { refreshUser } = useAuth();
    const [req, setReq] = useState<TeacherJoinRequest | null | undefined>(undefined);
    const [cancelling, setCancelling] = useState(false);
    const navigatedRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const out = await getMyTeacherJoinRequest();
            setReq(out);
            if (!out && !navigatedRef.current) {
                // Either approved (membership exists) or cleared. Resolve via auth refresh.
                navigatedRef.current = true;
                await refreshUser();
                navigate('/app/teacher', { replace: true });
            }
        } catch {
            // Network blip; next tick will retry.
        }
    }, [navigate, refreshUser]);

    useEffect(() => {
        fetchStatus();
        const timer = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [fetchStatus]);

    async function handleCancel() {
        setCancelling(true);
        try {
            await cancelMyTeacherJoinRequest();
            navigate('/signup/teacher/join-org', { replace: true });
        } finally {
            setCancelling(false);
        }
    }

    if (req === undefined) {
        return (
            <AnimatedPage>
                <div className="min-h-screen flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            </AnimatedPage>
        );
    }

    if (!req) {
        return null;  // navigation in-flight
    }

    if (req.status === 'declined') {
        return (
            <AnimatedPage>
                <div className="min-h-screen flex items-center justify-center p-4">
                    <Card className="p-8 max-w-md w-full text-center space-y-4">
                        <h1 className="text-xl font-bold">Your request was not approved</h1>
                        {req.declineReason && (
                            <p className="text-sm text-muted-foreground">{req.declineReason}</p>
                        )}
                        <Button onClick={() => navigate('/signup/teacher/join-org', { replace: true })}>
                            Try a different school
                        </Button>
                    </Card>
                </div>
            </AnimatedPage>
        );
    }

    // pending
    return (
        <AnimatedPage>
            <div className="min-h-screen flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md"
                >
                    <Card className="p-8 text-center space-y-6">
                        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Clock className="h-8 w-8" />
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-2xl font-bold">Awaiting approval</h1>
                            <p className="text-muted-foreground">
                                Your request to join <strong>{req.orgName}</strong> is with the school admin.
                                We'll email you the moment they decide.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={cancelling}
                        >
                            {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Cancel request
                        </Button>
                    </Card>
                </motion.div>
            </div>
        </AnimatedPage>
    );
}

export default TeacherJoinPendingPage;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd frontend && npm run test -- --run src/pages/TeacherJoinPendingPage.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TeacherJoinPendingPage.tsx frontend/src/pages/TeacherJoinPendingPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(teacher-join): TeacherJoinPendingPage with 30s polling

Polls GET /api/teacher-join-requests/me every 30s. On approval (request
no longer pending), refreshes auth and routes to /app/teacher. On decline,
shows the reason with a retry CTA. Cancel reverts onboarding_state and
returns the user to the join page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Wire new routes + `homeRoutes.ts` teacher_pending dispatch

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/homeRoutes.ts`
- Modify: `frontend/src/lib/homeRoutes.test.ts` (extend with new dispatch test)

- [ ] **Step 1: Write the failing dispatcher test**

Append to `frontend/src/lib/homeRoutes.test.ts` (or create if missing):

```typescript
import { describe, expect, it } from 'vitest';
import { getOnboardingDestination, TEACHER_JOIN_PENDING_ROUTE } from './homeRoutes';

describe('getOnboardingDestination — teacher_pending', () => {
    it('routes teacher_pending state to the pending page', () => {
        const user = {
            uid: 'teacher-1',
            email: 't@x.com',
            intendedRole: 'teacher' as const,
            onboardingState: 'teacher_pending' as const,
            memberships: [],
            activeRoles: [],
            lingualAdmin: false,
        };
        expect(getOnboardingDestination(user)).toBe(TEACHER_JOIN_PENDING_ROUTE);
    });

    it('still routes intendedRole=teacher without onboarding to join-org', () => {
        const user = {
            uid: 'teacher-1',
            email: 't@x.com',
            intendedRole: 'teacher' as const,
            onboardingState: 'role_selected' as const,
            memberships: [],
            activeRoles: [],
            lingualAdmin: false,
        };
        expect(getOnboardingDestination(user)).toBe('/signup/teacher/join-org');
    });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts
```

Expected: `TEACHER_JOIN_PENDING_ROUTE` not exported.

- [ ] **Step 3: Update `homeRoutes.ts`**

In `frontend/src/lib/homeRoutes.ts`:

```typescript
export const TEACHER_JOIN_PENDING_ROUTE = '/signup/teacher/pending';
```

And update `getOnboardingDestination` (insert the new branch *before* the existing `intendedRole === 'teacher'` line):

```typescript
    if (user.intendedRole === 'teacher' && user.onboardingState === 'teacher_pending') {
        return TEACHER_JOIN_PENDING_ROUTE;
    }
    if (user.intendedRole === 'teacher') return TEACHER_JOIN_ORG_ROUTE;
```

- [ ] **Step 4: Wire routes in `App.tsx`**

In `frontend/src/App.tsx`:

```typescript
// Replace the placeholder import:
const TeacherJoinOrgPage = lazy(() =>
    import('@/pages/TeacherJoinOrgPage').then(m => ({ default: m.TeacherJoinOrgPage }))
);
const TeacherJoinPendingPage = lazy(() =>
    import('@/pages/TeacherJoinPendingPage').then(m => ({ default: m.TeacherJoinPendingPage }))
);
```

Inside the `<ProtectedRoute>` block, replace `TeacherJoinOrgPlaceholderPage` and add the pending route:

```tsx
<Route path="/signup/teacher/join-org" element={withRouteSuspense(<TeacherJoinOrgPage />)} />
<Route path="/signup/teacher/pending" element={withRouteSuspense(<TeacherJoinPendingPage />)} />
```

- [ ] **Step 5: Run tests to verify**

```bash
cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts
cd frontend && npm run build  # type-check
```

Expected: tests pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/homeRoutes.ts frontend/src/lib/homeRoutes.test.ts frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(routing): wire TeacherJoinOrgPage + pending route

Replaces the placeholder at /signup/teacher/join-org with the real
Plan 4 page. Adds /signup/teacher/pending and updates the role-aware
dispatcher so onboardingState='teacher_pending' resumes the pending
page on next login.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `PendingTeacherRequestsSection` admin component

**Files:**
- Create: `frontend/src/components/teacher/PendingTeacherRequestsSection.tsx`
- Create: `frontend/src/components/teacher/PendingTeacherRequestsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/teacher/PendingTeacherRequestsSection.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PendingTeacherRequestsSection } from './PendingTeacherRequestsSection';

const listMock = vi.fn();
const approveMock = vi.fn();
const declineMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    listPendingTeacherRequests: (...a: unknown[]) => listMock(...a),
    approveTeacherJoinRequest: (...a: unknown[]) => approveMock(...a),
    declineTeacherJoinRequest: (...a: unknown[]) => declineMock(...a),
}));

beforeEach(() => {
    listMock.mockReset();
    approveMock.mockReset();
    declineMock.mockReset();
});

describe('PendingTeacherRequestsSection', () => {
    it('renders rows from listPendingTeacherRequests', async () => {
        listMock.mockResolvedValue([
            {
                requestId: 'tjr-1', uid: 'teacher-99',
                name: 'Jane Doe', email: 'jane@x.com',
                source: 'invite_code', status: 'pending',
                requestedAt: '2026-05-18T01:00:00Z',
            },
        ]);
        render(<PendingTeacherRequestsSection />);
        expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('jane@x.com')).toBeInTheDocument();
    });

    it('hides section when empty', async () => {
        listMock.mockResolvedValue([]);
        const { container } = render(<PendingTeacherRequestsSection />);
        await waitFor(() => expect(listMock).toHaveBeenCalled());
        expect(container.textContent).not.toMatch(/pending teacher request/i);
    });

    it('approve triggers API + refresh', async () => {
        listMock
            .mockResolvedValueOnce([{
                requestId: 'tjr-1', uid: 'teacher-99', name: 'J', email: 'j@x.com',
                source: 'search', status: 'pending', requestedAt: null,
            }])
            .mockResolvedValueOnce([]);
        approveMock.mockResolvedValue(undefined);
        render(<PendingTeacherRequestsSection />);
        fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
        await waitFor(() => {
            expect(approveMock).toHaveBeenCalledWith('tjr-1');
        });
        await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    });

    it('decline opens modal and submits reason', async () => {
        listMock
            .mockResolvedValueOnce([{
                requestId: 'tjr-1', uid: 'teacher-99', name: 'J', email: 'j@x.com',
                source: 'search', status: 'pending', requestedAt: null,
            }])
            .mockResolvedValueOnce([]);
        declineMock.mockResolvedValue(undefined);
        render(<PendingTeacherRequestsSection />);
        fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
        const reasonInput = await screen.findByLabelText(/reason/i);
        fireEvent.change(reasonInput, { target: { value: 'Wrong school' } });
        fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
        await waitFor(() => {
            expect(declineMock).toHaveBeenCalledWith('tjr-1', 'Wrong school');
        });
    });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd frontend && npm run test -- --run src/components/teacher/PendingTeacherRequestsSection.test.tsx
```

Expected: file not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/teacher/PendingTeacherRequestsSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import {
    listPendingTeacherRequests,
    approveTeacherJoinRequest,
    declineTeacherJoinRequest,
} from '@/api/teacherRequests';
import type { PendingTeacherRequestRow } from '@/types/teacherJoin';

export function PendingTeacherRequestsSection() {
    const [rows, setRows] = useState<PendingTeacherRequestRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [declineFor, setDeclineFor] = useState<PendingTeacherRequestRow | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const out = await listPendingTeacherRequests();
            setRows(out);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load requests.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    async function onApprove(row: PendingTeacherRequestRow) {
        setSubmitting(true);
        try {
            await approveTeacherJoinRequest(row.requestId);
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Approve failed.');
        } finally {
            setSubmitting(false);
        }
    }

    async function onDeclineSubmit() {
        if (!declineFor || !reason.trim()) return;
        setSubmitting(true);
        try {
            await declineTeacherJoinRequest(declineFor.requestId, reason.trim());
            setDeclineFor(null);
            setReason('');
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Decline failed.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!loading && rows.length === 0 && !error) {
        return null;
    }

    return (
        <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                    Pending teacher requests {rows.length > 0 ? `(${rows.length})` : ''}
                </h2>
            </div>
            {error && (
                <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.requestId} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <div className="font-medium">{row.name || '(unnamed)'}</div>
                            <div className="text-xs text-muted-foreground">
                                {row.email} · via {row.source === 'invite_code' ? 'invite code' : 'school search'}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => onApprove(row)} disabled={submitting}>
                                Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDeclineFor(row)} disabled={submitting}>
                                Decline
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            {declineFor && (
                <Card className="p-4 space-y-3">
                    <p className="text-sm">
                        Decline request from <strong>{declineFor.name || declineFor.email}</strong>?
                    </p>
                    <label className="block text-sm">
                        <span className="block mb-1">Reason</span>
                        <Input
                            aria-label="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Shared with the requester."
                        />
                    </label>
                    <div className="flex gap-2">
                        <Button onClick={onDeclineSubmit} disabled={submitting || !reason.trim()}>
                            Submit
                        </Button>
                        <Button variant="ghost" onClick={() => { setDeclineFor(null); setReason(''); }}>
                            Cancel
                        </Button>
                    </div>
                </Card>
            )}
        </Card>
    );
}

export default PendingTeacherRequestsSection;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd frontend && npm run test -- --run src/components/teacher/PendingTeacherRequestsSection.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/teacher/PendingTeacherRequestsSection.tsx frontend/src/components/teacher/PendingTeacherRequestsSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(teacher-join): admin review section for pending requests

Lists pending teacher_join_requests for the admin's org with one-click
Approve and modal-driven Decline (required reason). Auto-refreshes
the list after each action.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Mount on `TeacherDashboardPage` + retire old invitations UI

**Files:**
- Modify: `frontend/src/pages/TeacherDashboardPage.tsx`
- Modify: `frontend/src/pages/TeacherDashboardPage.test.tsx` (if exists; otherwise extend or skip)

- [ ] **Step 1: Open `TeacherDashboardPage.tsx`** and locate two things:

a. The current `listTeacherInvitations` / `approveTeacherInvitation` / `rejectTeacherInvitation` section. This is the OLD review UI that needs to be removed (it reads from `teacher_invitations`, not the new collection).

b. A spot in the JSX where the new section can be mounted — typically near the top of the dashboard, between the welcome header and the class management section.

- [ ] **Step 2: Add the import**

At the top of `TeacherDashboardPage.tsx`:

```typescript
import { PendingTeacherRequestsSection } from '@/components/teacher/PendingTeacherRequestsSection';
```

- [ ] **Step 3: Mount the section**

Inside the dashboard JSX, between the welcome/header block and the classes block, add:

```tsx
<PendingTeacherRequestsSection />
```

- [ ] **Step 4: Remove old invitations UI**

Delete the JSX block that renders teacher invitations from the old `listTeacherInvitations` call. Remove the corresponding state + handlers + imports of `listTeacherInvitations`, `approveTeacherInvitation`, `rejectTeacherInvitation`.

- [ ] **Step 5: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/TeacherDashboardPage.test.tsx
cd frontend && npm run build
```

Expected: existing dashboard tests still pass (or get adjusted minimally); build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TeacherDashboardPage.tsx frontend/src/pages/TeacherDashboardPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(teacher-dashboard): swap legacy invitations UI for Plan 4 section

PendingTeacherRequestsSection (reads teacher_join_requests) replaces
the old listTeacherInvitations / approveTeacherInvitation / reject
section. The legacy collection is now dormant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Delete legacy pages + API entries

**Files:**
- Delete: `frontend/src/pages/TeacherJoinSchoolPage.tsx`
- Delete: `frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx`
- Modify: `frontend/src/api/schoolRequests.ts` (remove `joinSchoolAsTeacher`, `listTeacherInvitations`, `approveTeacherInvitation`, `rejectTeacherInvitation`, plus their types like `JoinSchoolAsTeacherResult`)
- Modify: anywhere that imports them (`App.tsx`, `TeacherDashboardPage.tsx` already handled)

- [ ] **Step 1: Verify nothing else imports the doomed symbols**

```bash
grep -rn "joinSchoolAsTeacher\|TeacherJoinSchoolPage\|TeacherJoinOrgPlaceholderPage\|listTeacherInvitations\|approveTeacherInvitation\|rejectTeacherInvitation" frontend/src
```

Expected: results limited to the files being deleted/modified plus the tests for those files (which also get removed).

- [ ] **Step 2: Delete files**

```bash
git rm frontend/src/pages/TeacherJoinSchoolPage.tsx
git rm frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx
```

- [ ] **Step 3: Strip `schoolRequests.ts`**

Open `frontend/src/api/schoolRequests.ts` and remove:
- The interface `JoinSchoolAsTeacherResult`
- The function `joinSchoolAsTeacher`
- Any of `listTeacherInvitations`, `approveTeacherInvitation`, `rejectTeacherInvitation`, plus their types

Keep `generateTeacherInviteCode`, `getTeacherInviteCode`, `deactivateTeacherInviteCode` (the org-wide code generation still works).

- [ ] **Step 4: Build + test**

```bash
cd frontend && npm run build
cd frontend && npm run test -- --run
```

Expected: clean build, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "$(cat <<'EOF'
chore(teacher-join): delete superseded pages and legacy API client

Removes TeacherJoinSchoolPage and TeacherJoinOrgPlaceholderPage now
that TeacherJoinOrgPage covers both. Strips joinSchoolAsTeacher,
listTeacherInvitations, approveTeacherInvitation, rejectTeacherInvitation
from the API client — the new endpoints in teacherRequests.ts are
authoritative.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Update spec/docs to reflect shipped behavior

**Files:**
- Modify: `docs/school-integration/TECH_SPEC.md`
- Modify: `docs/school-integration/TASKS.md`
- Modify: `docs/school-integration/LIMITATIONS.md`
- Modify: `docs/superpowers/codebase-conventions.md`

- [ ] **Step 1: TECH_SPEC.md**

Add a section under the teacher-onboarding chapter describing:
- `teacher_join_requests/` collection schema (fields from Task 1)
- Endpoints under `/api/teacher-join-requests/*` and `/api/organizations/search`
- The approval workflow: pending → approved → membership creation + email
- The `organizations/{id}.school_admin_uids` denormalization (Task 12)

- [ ] **Step 2: TASKS.md**

Mark Plan-4-related items complete with `[x]` and add any newly-discovered follow-ups as `[ ]`. Example:

```
- [x] Hybrid teacher join: invite code + name search (Plan 4)
- [x] Admin approval pipeline with email notification (Plan 4)
- [x] Removed auto-approve from /api/schools/join-as-teacher (Plan 4)
- [ ] Backfill organizations.school_admin_uids for orgs created before Plan 4
- [ ] Replace in-memory org search rate limiter with shared store when multi-replica
- [ ] 7-day reminder email for stale pending teacher join requests (v1.5)
- [ ] Realtime status listener on /signup/teacher/pending (replace 30s polling, v1.5)
- [ ] Wrap teacher-join approve flow in a Firestore batch/transaction (v1.5 — see LIMITATIONS)
- [ ] Document PUBLIC_BASE_URL in .env.example and deployment runbook
```

- [ ] **Step 3: LIMITATIONS.md**

Add new entries:

```markdown
### Teacher join-org (Plan 4)

- Search is name-prefix only (`name_lower` index), not full-text. "san fran" matches "San Francisco …" but not "Friends of San Francisco".
- One pending request per user is enforced — to retry with a different school, the user must cancel first.
- Multi-org membership is not supported: any active membership in any org blocks a new join request.
- Rate limiting on `/api/organizations/search` is process-local (10 req/sec/uid). Horizontal scale will require a shared store (Redis / Firestore counter).
- Status polling is 30s; not realtime. A realtime listener is a v1.5 follow-up.
- Search excludes suspended and archived orgs but does not respect any further geofencing.
- **7-day reminder email to admins (spec §3) is not yet implemented.** Stale pending requests are visible on the admin dashboard but no automatic nudge is sent. Implement via a daily Cloud Function sweep that writes future-dated outbox docs once requests age past 7 days — v1.5 follow-up.
- **Approval flow is not transactional.** `POST /api/teacher-join-requests/<id>/approve` performs three sequential Firestore writes (create membership, mark request approved, update user profile). If a later write fails after an earlier one succeeded, the system is briefly inconsistent (e.g. teacher has a membership but request still shows pending). Wrap in a Firestore batch in v1.5.
- **`PUBLIC_BASE_URL` is a soft-required env var for outbound email CTAs.** Without it, email links use relative paths (`/app/teacher` rather than `https://lingual.app/app/teacher`), which break in email clients. Set in Cloud Run env for any deploy that should send real email.
```

- [ ] **Step 4: codebase-conventions.md**

Append §14:

```markdown
## 14. Plan 4 contract surface

After Plan 4 lands, the following is true and consumable:

**Backend:**
- `teacher_join_requests/{id}`: `{ uid, org_id, source, invite_code?, status, requested_at, reviewed_at?, reviewed_by_uid?, decline_reason? }`. Status enum: `pending | approved | declined | cancelled`. Source enum: `invite_code | search`.
- New endpoints under `/api/teacher-join-requests/*` and `/api/organizations/search` (see `backend/routes/teacher_requests.py`).
- `database.create_teacher_join_request`, `get_pending_teacher_join_request_by_uid`, `list_pending_teacher_join_requests_by_org`, `update_teacher_join_request_status`, `search_organizations`, `list_school_admin_emails`.
- `OutboxTemplate.TEACHER_JOIN_REQUEST_TO_ADMIN | TEACHER_JOIN_APPROVED | TEACHER_JOIN_DECLINED`.
- `organizations/{id}.school_admin_uids` array is maintained on every school_admin membership create/remove (rules query needs this).
- `POST /api/schools/join-as-teacher` returns **410 Gone**.

**Frontend:**
- API client: `frontend/src/api/teacherRequests.ts`.
- Pages: `/signup/teacher/join-org` → `TeacherJoinOrgPage`; `/signup/teacher/pending` → `TeacherJoinPendingPage`.
- Component: `PendingTeacherRequestsSection` on `TeacherDashboardPage`.
- Dispatcher: `onboardingState='teacher_pending'` resumes the pending page.

**Firestore rules:**
- `teacher_join_requests/{id}` read = requester OR school_admin of `org_id` (via `school_admin_uids` lookup). All writes go through backend admin SDK.
```

- [ ] **Step 5: Commit**

```bash
git add docs/school-integration/TECH_SPEC.md docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md docs/superpowers/codebase-conventions.md
git commit -m "$(cat <<'EOF'
docs: record Plan 4 shipped contract and limitations

TECH_SPEC: teacher_join_requests schema, endpoints, denormalized
school_admin_uids. TASKS: mark Plan 4 items complete. LIMITATIONS:
name-prefix search, single pending request, in-memory rate limiter,
polling (not realtime). codebase-conventions §14: Plan 4 contract
surface for downstream plans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all 20 tasks have committed cleanly:

```bash
make test-backend                    # all backend tests
cd frontend && npm run test -- --run # all frontend tests
make test-firebase                   # rules tests
cd frontend && npm run build         # type-check + build
```

Expected: all green.

**Pre-deploy backfills** (run on a staging env first, then production):

```bash
# Verify the backfills would touch the right rows
python3 scripts/backfill_org_name_lower.py --dry-run
python3 scripts/backfill_school_admin_uids.py --dry-run

# Apply
python3 scripts/backfill_org_name_lower.py
python3 scripts/backfill_school_admin_uids.py
```

Set `PUBLIC_BASE_URL=https://lingual.app` in the Cloud Run service config so email CTAs link to absolute URLs. Confirm `RESEND_API_KEY` is still set in the Cloud Function runtime (Plan 1 infra).

Then open a smoke test in the browser:
1. Sign up as a teacher → role pick lands on join-org page.
2. Try a bad code → friendly error.
3. Try search → see results → confirm → land on pending page.
4. As a second user (school admin of the target org), open `/app/teacher` → see the pending row → click approve.
5. As the teacher again, refresh `/signup/teacher/pending` → poll picks up approval → routes to `/app/teacher`.
6. Inbox: `teacher_join_request_to_admin` email at step 3, `teacher_join_approved` email at step 4.

If anything is off, debug via `superpowers:systematic-debugging` rather than patching reactively.

---

## Spec coverage checklist (run before claiming done)

| Spec §3 requirement | Implemented in |
|---|---|
| Pane A entry UI | Task 14 (TeacherJoinOrgPage) |
| Pane B invite code | Task 14 + Task 4 backend |
| Pane C search with debounced query | Task 14 + Task 9 backend |
| "Can't find my school" → admin pivot | Task 14 |
| `teacher_join_requests` collection schema | Task 1 |
| Both paths require admin approval | Task 4 + Task 10 (auto-approve removal) |
| One pending per user | Task 4 (409 check) |
| Already-member 422 | Task 4 |
| `GET /me` polling, `DELETE /me` cancel | Task 5 |
| Admin pending list | Task 6 |
| Admin approve creates membership | Task 7 |
| Admin decline requires reason | Task 8 |
| `GET /api/organizations/search` rate-limited | Task 9 |
| Email outbox: 3 templates | Task 3 |
| Email at submit, approve, decline | Task 4, 7, 8 |
| Pending page with 30s polling | Task 15 |
| Admin review section on dashboard | Task 17 + Task 18 |
| `organizations.school_admin_uids` denormalization | Task 11 |
| Firestore rules for new collection | Task 12 |
| Auto-approve removal | Task 10 |
| Docs + LIMITATIONS sync | Task 20 |
| 7-day admin reminder email | **Deferred to v1.5**, logged in LIMITATIONS (Task 20) |
| Multi-org membership block | Task 4 (any active membership returns 422) |

If any cell is empty after execution, that task didn't ship the spec's requirement and must be patched.
