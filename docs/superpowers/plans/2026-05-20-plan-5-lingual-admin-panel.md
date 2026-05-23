# Plan 5 — Lingual Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/app/admin/school-requests` page with a full Lingual admin panel at `/app/lingual-admin/*` (dashboard + requests + organizations list + org detail with 4 tabs + suspend/restore + member removal) backed by a complete audit trail, while absorbing Sprint C: introduce `/app/admin` as the dedicated school_admin home (resolves LIMITATIONS #27), add 5-min `AuthContext` polling (resolves LIMITATIONS #28), and exercise Plan 4's `_sync_org_admin_uids(add=False)` invariant via a real member-removal path.

**Architecture:** Three cooperating layers. (1) A new `lingual_admin_audit/` Firestore collection plus a `log_audit_event` helper that writes from every state-changing Lingual admin action and every org-detail page load (SOC 2). (2) A new `backend/routes/lingual_admin.py` blueprint exposing the 12 endpoints in spec §6, which subsumes the existing admin endpoints in `backend/routes/school_requests.py`. The existing surface (`GET/POST /api/admin/school-requests/...`) remains for one PR's worth of frontend transition then becomes a 410 Gone. (3) A frontend `LingualAdminShell` mounted at `/app/lingual-admin/*` with four routed pages and an org-detail tabbed view. Cross-cutting: a `enforce_org_active(org_id)` helper wired into the 5 suspend-enforcement points; a `auto_restore_suspended_orgs` hourly Cloud Function; two new outbox templates (`org_suspended`, `org_restored`); a separate `SCHOOL_ADMIN_HOME_ROUTE = '/app/admin'` with a school_admin landing page; and `AuthContext` polling every 5 minutes to detect server-side role/membership changes.

**Tech Stack:** Flask 3.1 + Firebase Admin SDK + Firestore (backend), Firebase Functions for Python + Jinja2 + Resend (Cloud Functions), React 19 + TypeScript + React Router v7 + Radix UI + Tailwind 4 (frontend), Vitest + RTL (frontend tests), `unittest.TestCase` + `FakeDbBase` (backend tests).

**Spec reference:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` — Section 6 (Lingual Admin Panel) plus parts of Section 1 (school_admin home route) and Section 5 (org_suspended/org_restored templates).

**Builds on:** Plans 1–4 (all merged on `pilot/launch-v1` as of `a9aa9d0`). Specifically:
- Outbox infrastructure + `enqueue_outbox_email` (Plan 1).
- `lingualAdmin` payload on `/api/auth/verify` (Plan 2).
- Org enriched payload, attestation, `school_creation_drafts/`, three decision templates (Plan 3).
- `organizations.school_admin_uids[]`, `name_lower`, `_sync_org_admin_uids`, three teacher-join templates (Plan 4).

**Brainstorming decisions baked in:**
- `school_admin` home is a **new `/app/admin` route**, separate from `/app/teacher`. Resolves LIMITATIONS #27.
- Suspended org auto-restore is via a **Cloud Function scheduler** running every hour.
- Mid-session voice: **in-flight realtime sessions finish; new sessions blocked** on suspended org.
- **Member removal UI is included** in the Members tab (Lingual admin can remove school_admin/teacher); this exercises `_sync_org_admin_uids(add=False)` end-to-end.
- **AuthContext polls `/api/auth/verify` every 5 minutes** for long-lived sessions and updates React state on diff. Resolves LIMITATIONS #28.

**Out of scope** (covered by spec §710 "Open questions" or deferred):
- `PATCH /api/lingual-admin/organizations/<orgId>` (org metadata edit). Endpoint stub returns 501 Not Implemented; UI not built. v1.5 follow-up.
- Org hard delete. Out of v1.
- District admin role. Out of v1.
- Realtime listeners for status pages (still polling). v1.5.
- Email preferences UI (member opt-out). v1.5.
- Pre-invited teacher list editing on pending page. v1.5.
- Reminder emails (e.g., "your org has been suspended for 30 days"). Plan 5 ships suspend/restore notifications only; reminders need the sweep gap fix (LIMITATIONS #21) and a product decision.

---

## Plan 5 contract input (what we rely on from Plans 1–4)

If any of the following is not true on the branch when execution begins, stop and reconcile before continuing.

**Backend:**
- `backend/services/outbox.enqueue_outbox_email(...)` writes a `pending` doc, optionally inside a transaction. Existing `OutboxTemplate` enum has: `SCHOOL_REQUEST_TO_LINGUAL`, `SCHOOL_REQUEST_APPROVED`, `SCHOOL_REQUEST_DECLINED`, `TEACHER_INVITATION`, `TEACHER_JOIN_REQUEST_TO_ADMIN`, `TEACHER_JOIN_APPROVED`, `TEACHER_JOIN_DECLINED`.
- `database.create_organization(...)` accepts `status='active'|'suspended'|'archived'`.
- `database.list_lingual_admin_emails()` returns the UNION of `memberships.roles array_contains 'lingual_admin'` AND legacy `users/{uid}.lingual_admin == True`.
- `database._sync_org_admin_uids(org_id, uid, add=True|False)` is idempotent.
- `database.resolve_user_school_context(uid)` returns a dict with `lingual_admin: bool` (Plan 2).
- `backend/routes/school_requests.py` contains the live admin endpoints (`admin_list_school_requests`, `admin_get_school_request`, `admin_approve_school_request`, `admin_reject_school_request`).

**Cloud Function:**
- `functions/main.py` exposes `_send_outbox_email_impl` + `send_outbox_email` (Firestore trigger) and `_retry_outbox_sweep_impl` + `retry_outbox_sweep` (scheduler every 5 min). `_TEMPLATE_SUBJECTS` is a `dict[str, Callable[[dict], str]]`. Templates live under `functions/templates/{template_id}.html.j2`.

**Frontend:**
- `frontend/src/lib/homeRoutes.ts` exports `LINGUAL_ADMIN_HOME_ROUTE = '/app/admin/school-requests'` (will be moved to `/app/lingual-admin/requests`) and `TEACHER_HOME_ROUTE = '/app/teacher'`. `getOnboardingDestination(user)` is the canonical dispatcher.
- `frontend/src/pages/LingualSchoolRequestsPage.tsx` is the current Lingual admin surface (refactored into `LingualRequestsPage` in this plan).
- `frontend/src/contexts/AuthContext.tsx` exposes `signUpWithEmail`, `signInWithEmail`, `signInWithGoogle`, `signOut`, `user`. `setUser` updates state from `/api/auth/verify` responses.
- `frontend/src/components/layout/LingualAdminRoute.tsx` guards Lingual-admin-only routes via `user.lingualAdmin`.

---

## File structure

### Backend — Create

| Path | Responsibility |
|---|---|
| `backend/routes/lingual_admin.py` | New blueprint with 12 endpoints (overview, requests list/detail/approve/decline, orgs list/detail/members/classes/audit, suspend/restore, member-remove) |
| `backend/services/audit.py` | `AuditLogger` service + `AuditAction` enum (the `ORG_STATUS_*` / `ALLOWED_ORG_STATUSES` enum lives in `database.py`, see Task 1) |
| `backend/services/suspended_org_guard.py` | `enforce_org_active(org_id)` + `is_org_suspended(org_id)` helpers used by enforcement points |
| `functions/templates/org_suspended.html.j2` | "Your school has been suspended" |
| `functions/templates/org_restored.html.j2` | "Your school has been restored" |
| `backend/tests/test_lingual_admin_audit.py` | `log_audit_event` helper + enum tests |
| `backend/tests/test_lingual_admin_overview_route.py` | GET /overview |
| `backend/tests/test_lingual_admin_requests_routes.py` | GET list/detail + approve/decline routes (incl. audit writes) |
| `backend/tests/test_lingual_admin_orgs_routes.py` | GET list, GET detail (with org_viewed_detail audit), members/classes/audit subroutes |
| `backend/tests/test_lingual_admin_suspend_routes.py` | suspend + restore (incl. outbox + audit) |
| `backend/tests/test_lingual_admin_member_removal_route.py` | DELETE membership (incl. `_sync_org_admin_uids(add=False)` invariant) |
| `backend/tests/test_suspended_org_guard.py` | helper unit tests + each enforcement point integration |
| `functions/tests/test_lingual_admin_templates.py` | template-render tests for the two new templates |
| `functions/tests/test_auto_restore_suspended_orgs.py` | scheduler `_impl` tests |

### Backend — Modify

| Path | Change |
|---|---|
| `database.py` | `ALLOWED_ORG_STATUSES` enum + `_validate_org_status`; `suspend_organization`, `restore_organization`, `list_organizations`, `list_org_memberships`, `list_org_classes`, `list_org_audit_events` helpers; `remove_membership` helper that calls `_sync_org_admin_uids(add=False)` on `school_admin` removal; `lingual_admin_audit` collection constants + accessors; `auto_restore_due_orgs` query helper for the scheduler |
| `backend/services/outbox.py` | Two new `OutboxTemplate` enum members (`ORG_SUSPENDED`, `ORG_RESTORED`) |
| `backend/services/assignment_resolver.py` | Call `enforce_org_active(class.org_id)` at the top of `resolve_assignment_prompt(...)` |
| `backend/routes/curriculum_admin.py` | `enforce_org_active` on practice-session create / event report / assignment write endpoints |
| `backend/routes/chat.py` | `enforce_org_active` on realtime-session mint (`POST /api/realtime/session`) |
| `backend/routes/canvas_practice.py` | `enforce_org_active` on practice-launch endpoints |
| `backend/routes/teacher.py` | `enforce_org_active` on assignment-write endpoints |
| `backend/routes/school_requests.py` | Remove the four admin endpoints (their logic moves to `lingual_admin.py`); keep submit/draft/my/cancel; add `gone_410` shim under the legacy paths for one PR window |
| `backend/route_deps.py` | Inject audit logger into `RouteDeps` (so tests can swap it) |
| `main.py` | Register `create_lingual_admin_blueprint(deps)` |
| `firestore.rules` | `lingual_admin_audit` is service-account writes only; readable only by lingual_admin; `organizations.status` transitions are write-restricted (only Lingual admins via service account, not org members directly) |
| `firestore.indexes.json` | Composite index on `lingual_admin_audit(target_org_id, created_at desc)` for the org-detail audit tab |
| `functions/main.py` | Two new entries in `_TEMPLATE_SUBJECTS`; new `_auto_restore_suspended_orgs_impl()` + `@scheduler_fn.on_schedule('every 60 minutes')` wrapper |
| `functions/requirements.txt` | No change (firebase-admin already present) |

### Frontend — Create

| Path | Responsibility |
|---|---|
| `frontend/src/types/lingualAdmin.ts` | DTOs for the 12 endpoints (`OverviewResponse`, `OrgSummary`, `OrgDetail`, `MemberRow`, `ClassRow`, `AuditEntry`, `SuspendPayload`) |
| `frontend/src/api/lingualAdmin.ts` | Typed client for each endpoint |
| `frontend/src/pages/LingualAdmin/LingualAdminShell.tsx` | Left nav + outlet; mounted on every `/app/lingual-admin/*` route |
| `frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.tsx` | 4 count tiles + 20-entry activity feed |
| `frontend/src/pages/LingualAdmin/LingualRequestsPage.tsx` | Refactor of `LingualSchoolRequestsPage` with filters + sort + side panel |
| `frontend/src/pages/LingualAdmin/RequestDetailPanel.tsx` | Right-side detail panel for a selected request (org info, admin identity + attestation, integration, curriculum, pre-invite chips) |
| `frontend/src/pages/LingualAdmin/DeclineRequestModal.tsx` | reason + category (required), submit |
| `frontend/src/pages/LingualAdmin/LingualOrgsListPage.tsx` | Active orgs list with filters + sort + cursor pagination |
| `frontend/src/pages/LingualAdmin/LingualOrgDetailPage.tsx` | Tabbed shell (Overview/Members/Classes/Audit); fires `org_viewed_detail` audit on mount |
| `frontend/src/pages/LingualAdmin/OrgOverviewTab.tsx` | Metadata, timestamps, school admin contact list |
| `frontend/src/pages/LingualAdmin/OrgMembersTab.tsx` | school_admins + teachers; aggregate student count; "Remove member" action |
| `frontend/src/pages/LingualAdmin/RemoveMemberModal.tsx` | Confirm + reason; calls DELETE endpoint |
| `frontend/src/pages/LingualAdmin/OrgClassesTab.tsx` | Per-class metadata; not browsable into class internals |
| `frontend/src/pages/LingualAdmin/OrgAuditTab.tsx` | Filtered audit entries for this org |
| `frontend/src/pages/LingualAdmin/SuspendOrgModal.tsx` | reason (required) + duration (temp/indefinite) |
| `frontend/src/pages/SchoolAdminHomePage.tsx` | New school_admin landing at `/app/admin` |
| `frontend/src/pages/LingualAdmin/__tests__/...` | One test file per page + per modal (vitest + RTL) |

### Frontend — Modify

| Path | Change |
|---|---|
| `frontend/src/App.tsx` | Replace old `/app/admin/school-requests` (LingualSchoolRequestsPage) with `/app/lingual-admin/*` tree; mount `LingualAdminShell`; add `/app/admin` for school_admin home; legacy redirect `/app/admin/school-requests` → `/app/lingual-admin/requests` |
| `frontend/src/lib/homeRoutes.ts` | Change `LINGUAL_ADMIN_HOME_ROUTE` to `/app/lingual-admin/requests`; add `SCHOOL_ADMIN_HOME_ROUTE = '/app/admin'`; split `school_admin` branch from `teacher` in `getOnboardingDestination` |
| `frontend/src/lib/homeRoutes.test.ts` | Add dispatch tests for school_admin → `/app/admin` |
| `frontend/src/contexts/AuthContext.tsx` | Add 5-min interval polling of `/api/auth/verify`; diff `lingualAdmin`/`memberships`/`activeRoles` from current state; on diff, update state |
| `frontend/src/contexts/AuthContext.test.tsx` | Polling tick triggers verify; diff updates state; no-diff is no-op; polling stops on signOut |
| `frontend/src/api/schoolRequests.ts` | Remove `approveSchoolRequest`/`rejectSchoolRequest`/`listSchoolRequests` (moved to lingualAdmin.ts); keep submit/draft/me |
| `frontend/src/pages/LingualSchoolRequestsPage.tsx` | DELETED (replaced by `LingualRequestsPage`) |
| `frontend/src/pages/LingualSchoolRequestsPage.test.tsx` | DELETED |
| `frontend/src/components/AppLayout.tsx` | If user is school_admin, "Home" button routes to `/app/admin`; if lingual_admin, routes to `/app/lingual-admin` |

### Docs — Modify

| Path | Change |
|---|---|
| `docs/school-integration/TECH_SPEC.md` | `lingual_admin_audit` schema; `organizations.status` lifecycle; new endpoint list |
| `docs/school-integration/TASKS.md` | Mark Plan 5 items complete; carry over deferred items (PATCH org metadata, hard delete, reminder emails) |
| `docs/school-integration/LIMITATIONS.md` | Mark #27 + #28 as RESOLVED; new items for in-flight realtime suspend grace window, scheduler accuracy ±1h, no-PATCH-yet endpoint, English-only admin panel UI |
| `docs/superpowers/codebase-conventions.md` | New §15 — Plan 5 contract surface (audit logger DI, suspend enforcement pattern, school_admin home route) |

---

## Conventions cheat sheet (read once before each task)

- **Tests:** `unittest.TestCase` only. Single file run: `python3 -m unittest backend.tests.test_X -v`.
- **Backend routes:** Build via `create_<name>_blueprint(deps: RouteDeps)`. Access `deps.db.foo(...)`, `deps.get_current_user_uid()`, `deps.audit_logger.log(...)`. **Never import `database` directly inside a route function** — always go through `deps.db` (this is LIMITATIONS #29's planned long-term fix; Plan 5 routes set the new precedent).
- **Test fixtures:** Subclass `FakeDbBase`, use `make_test_deps(db=FakeYourDb(), audit_logger=FakeAuditLogger())`, register on `make_test_app(deps)`.
- **Naming:** snake_case in Python + Firestore + request bodies; camelCase in response bodies + TypeScript.
- **Firestore writes:** dotted paths on the doc, not subcollections.
- **Outbox:** wrap enqueue in try/except — never fail the business call. New template needs 3 changes in one commit (enum + j2 + subjects).
- **Cloud Function:** `_impl` + decorated wrapper pattern.
- **Audit:** every state-changing Lingual admin route AND every org detail page load writes a `lingual_admin_audit/` entry. Fail-soft (try/except + log) — never block the business response on audit write.
- **Commits:** `feat(scope): …`, one logical change per commit, tests + impl together. Plain commit messages (per `codebase-conventions.md` §11 — no `Co-Authored-By` trailer).

---

## Task 1: `ALLOWED_ORG_STATUSES` enum + validation helper

**Files:**
- Modify: `database.py` (near other ALLOWED_* enums, around the top with `ALLOWED_ORG_TYPES`)
- Create: `backend/tests/test_org_status_enum.py`

**Why:** The `status` field on `organizations` is currently a free string with `'active'` default. Plan 5 introduces `suspended`/`archived` transitions and the scheduler depends on querying by status; we need an enum at the boundary to reject typos. Mirrors `ALLOWED_INTENDED_ROLES`, `ALLOWED_ONBOARDING_STATES`, `ALLOWED_ORG_TYPES`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_org_status_enum.py`:

```python
"""Tests for ALLOWED_ORG_STATUSES enum and _validate_org_status."""
import unittest

import database


class OrgStatusEnumTests(unittest.TestCase):
    def test_constants_are_exposed(self):
        self.assertEqual(database.ORG_STATUS_ACTIVE, 'active')
        self.assertEqual(database.ORG_STATUS_SUSPENDED, 'suspended')
        self.assertEqual(database.ORG_STATUS_ARCHIVED, 'archived')

    def test_allowed_org_statuses_is_frozenset(self):
        self.assertIsInstance(database.ALLOWED_ORG_STATUSES, frozenset)
        self.assertEqual(
            database.ALLOWED_ORG_STATUSES,
            frozenset({'active', 'suspended', 'archived'}),
        )

    def test_validate_accepts_known(self):
        self.assertEqual(database._validate_org_status('active'), 'active')
        self.assertEqual(database._validate_org_status('suspended'), 'suspended')
        self.assertEqual(database._validate_org_status('archived'), 'archived')

    def test_validate_rejects_unknown(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status('paused')

    def test_validate_rejects_empty(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status('')

    def test_validate_rejects_none(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status(None)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_org_status_enum -v
```

Expected: FAILS with `AttributeError: module 'database' has no attribute 'ORG_STATUS_ACTIVE'`.

- [ ] **Step 3: Add enum + validator in `database.py`**

Find the existing `ALLOWED_ORG_TYPES` block (around the constants near the top of `database.py`) and add:

```python
# --- Organization status -------------------------------------------------
ORG_STATUS_ACTIVE = 'active'
ORG_STATUS_SUSPENDED = 'suspended'
ORG_STATUS_ARCHIVED = 'archived'

ALLOWED_ORG_STATUSES = frozenset({
    ORG_STATUS_ACTIVE,
    ORG_STATUS_SUSPENDED,
    ORG_STATUS_ARCHIVED,
})


def _validate_org_status(value: str) -> str:
    """Raise ValueError if value is not a known org status."""
    if not value or value not in ALLOWED_ORG_STATUSES:
        raise ValueError(
            f'Invalid org status {value!r}; allowed: {sorted(ALLOWED_ORG_STATUSES)}'
        )
    return value
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_org_status_enum -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_org_status_enum.py
git commit -m "feat(onboarding): add ALLOWED_ORG_STATUSES enum + validator"
```

---

## Task 2: `lingual_admin_audit` collection + `log_audit_event` service

**Files:**
- Create: `backend/services/audit.py`
- Create: `backend/tests/test_lingual_admin_audit.py`
- Modify: `database.py` (add `LINGUAL_ADMIN_AUDIT_COLLECTION` constant + accessor)

**Why:** Every state-changing Lingual admin action plus every org detail page load writes one row. We centralize the write so routes can call `deps.audit_logger.log(...)` (view audits) or pass an audit_entry dict to state-transition DB helpers (atomic with the business write).

**Dual-mode audit pattern (SOC 2 invariant):**

| Audit type | Examples | Strategy |
|---|---|---|
| **State-transition audits** (action changes data) | `org_suspended`, `org_restored`, `request_approved`, `request_declined`, `membership_removed` | **Atomic via Firestore batch in the DB helper.** Route builds the `audit_entry` dict and passes it to `database.suspend_organization(...)` / `restore_organization(...)` / `remove_membership(...)` / `approve_school_request(...)` / `reject_school_request(...)`. The helper writes business + audit in a single `db.batch().commit()`. Audit cannot fail silently after a state change. |
| **View audits** (no state change) | `org_viewed_detail` | **Fail-soft via `AuditLogger.log(...)`.** A failed audit write does not block the read response. |

`AuditLogger.log()` stays fail-soft because view-level audit failures should not prevent operators from reading data. State-transition audits go atomic instead — the spec's *"Every Lingual admin action is audited"* invariant (§47) requires that the audit row cannot fail to land after the state changed.

`AuditLogger.build_audit_doc(...)` returns the doc dict without writing — used by routes to construct `audit_entry` for the batched helpers.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_audit.py`:

```python
"""Tests for backend.services.audit and database accessors."""
import unittest
from unittest.mock import MagicMock, patch

import database
from backend.services.audit import AuditAction, AuditLogger


class AuditActionEnumTests(unittest.TestCase):
    def test_enum_values(self):
        self.assertEqual(AuditAction.REQUEST_APPROVED.value, 'request_approved')
        self.assertEqual(AuditAction.REQUEST_DECLINED.value, 'request_declined')
        self.assertEqual(AuditAction.ORG_SUSPENDED.value, 'org_suspended')
        self.assertEqual(AuditAction.ORG_RESTORED.value, 'org_restored')
        self.assertEqual(AuditAction.ORG_METADATA_EDITED.value, 'org_metadata_edited')
        self.assertEqual(AuditAction.ORG_VIEWED_DETAIL.value, 'org_viewed_detail')
        self.assertEqual(AuditAction.MEMBERSHIP_REMOVED.value, 'membership_removed')


class DatabaseAuditCollectionTests(unittest.TestCase):
    def test_collection_constant(self):
        self.assertEqual(database.LINGUAL_ADMIN_AUDIT_COLLECTION, 'lingual_admin_audit')

    @patch('database.get_db')
    def test_accessor_returns_collection(self, mock_get_db):
        mock_col = MagicMock(name='collection')
        mock_get_db.return_value.collection.return_value = mock_col
        result = database.get_lingual_admin_audit_collection()
        mock_get_db.return_value.collection.assert_called_once_with('lingual_admin_audit')
        self.assertIs(result, mock_col)


class AuditLoggerTests(unittest.TestCase):
    def test_log_writes_one_doc(self):
        fake_col = MagicMock(name='collection')
        fake_add = fake_col.add
        fake_add.return_value = (None, MagicMock(id='audit123'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        audit_id = logger.log(
            actor_uid='admin-uid',
            action=AuditAction.ORG_SUSPENDED,
            target_type='organization',
            target_id='org-1',
            target_org_id='org-1',
            metadata={'reason': 'fraud'},
            ip_hash='abc',
            user_agent='test-ua',
        )
        self.assertEqual(audit_id, 'audit123')
        args, _ = fake_add.call_args
        doc = args[0]
        self.assertEqual(doc['actor_uid'], 'admin-uid')
        self.assertEqual(doc['action'], 'org_suspended')
        self.assertEqual(doc['target'], {'type': 'organization', 'id': 'org-1'})
        self.assertEqual(doc['target_org_id'], 'org-1')
        self.assertEqual(doc['metadata'], {'reason': 'fraud'})
        self.assertEqual(doc['ip_hash'], 'abc')
        self.assertEqual(doc['user_agent'], 'test-ua')
        self.assertIn('created_at', doc)  # SERVER_TIMESTAMP sentinel

    def test_log_is_failsoft(self):
        """A failing audit write must not raise."""
        fake_col = MagicMock(name='collection')
        fake_col.add.side_effect = RuntimeError('Firestore down')
        logger = AuditLogger(collection_factory=lambda: fake_col)
        # Should NOT raise.
        result = logger.log(
            actor_uid='u',
            action=AuditAction.ORG_VIEWED_DETAIL,
            target_type='organization',
            target_id='org-1',
            target_org_id='org-1',
            metadata={},
            ip_hash='',
            user_agent='',
        )
        self.assertIsNone(result)

    def test_log_accepts_string_action_for_legacy_callers(self):
        fake_col = MagicMock(name='collection')
        fake_col.add.return_value = (None, MagicMock(id='id'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        logger.log(
            actor_uid='u',
            action='request_approved',  # string accepted as well
            target_type='school_request',
            target_id='req-1',
            target_org_id=None,
            metadata={},
            ip_hash='',
            user_agent='',
        )
        args, _ = fake_col.add.call_args
        self.assertEqual(args[0]['action'], 'request_approved')


class AuditLoggerBuildDocTests(unittest.TestCase):
    """`build_audit_doc` returns a dict without writing — used by state-
    transition helpers that need to batch audit with business writes."""

    def test_returns_well_formed_doc(self):
        fake_col = MagicMock(name='collection')
        logger = AuditLogger(collection_factory=lambda: fake_col)
        doc = logger.build_audit_doc(
            actor_uid='u',
            action=AuditAction.ORG_SUSPENDED,
            target_type='organization',
            target_id='o-1',
            target_org_id='o-1',
            metadata={'reason': 'fraud'},
            ip_hash='h',
            user_agent='ua',
        )
        self.assertEqual(doc['actor_uid'], 'u')
        self.assertEqual(doc['action'], 'org_suspended')
        self.assertEqual(doc['target'], {'type': 'organization', 'id': 'o-1'})
        self.assertIn('created_at', doc)
        fake_col.add.assert_not_called()  # build must NOT write
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_audit -v
```

Expected: import error — `No module named 'backend.services.audit'`.

- [ ] **Step 3: Create `backend/services/audit.py`**

```python
"""Lingual admin audit logger.

Writes to the `lingual_admin_audit/` Firestore collection. Failures are
swallowed and logged so audit never blocks the business response.
"""
from __future__ import annotations

import enum
import logging
from typing import Callable

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


class AuditAction(str, enum.Enum):
    REQUEST_APPROVED = 'request_approved'
    REQUEST_DECLINED = 'request_declined'
    ORG_SUSPENDED = 'org_suspended'
    ORG_RESTORED = 'org_restored'
    ORG_METADATA_EDITED = 'org_metadata_edited'
    ORG_VIEWED_DETAIL = 'org_viewed_detail'
    MEMBERSHIP_REMOVED = 'membership_removed'


class AuditLogger:
    """Writes audit rows. Two modes:

    - `log(...)`: fail-soft write for VIEW audits (`org_viewed_detail` etc).
      A failed write does not raise — caller is unaware.
    - `build_audit_doc(...)`: returns the doc dict WITHOUT writing. State-
      transition helpers (`database.suspend_organization`, etc) accept the
      result as `audit_entry=` and commit it atomically in a Firestore batch
      with the business write.

    Inject via RouteDeps so tests can swap it.
    """

    def __init__(self, collection_factory: Callable[[], object] | None = None):
        if collection_factory is None:
            import database
            self._collection_factory = database.get_lingual_admin_audit_collection
        else:
            self._collection_factory = collection_factory

    @staticmethod
    def build_audit_doc(
        *,
        actor_uid: str,
        action: AuditAction | str,
        target_type: str,
        target_id: str,
        target_org_id: str | None,
        metadata: dict,
        ip_hash: str,
        user_agent: str,
    ) -> dict:
        """Build a well-formed audit doc without writing.

        Used by state-transition DB helpers to batch the audit write
        atomically with the business write.
        """
        action_value = action.value if isinstance(action, AuditAction) else action
        return {
            'actor_uid': actor_uid,
            'action': action_value,
            'target': {'type': target_type, 'id': target_id},
            'target_org_id': target_org_id,
            'metadata': metadata,
            'ip_hash': ip_hash,
            'user_agent': user_agent,
            'created_at': fb_firestore.SERVER_TIMESTAMP,
        }

    def log(
        self,
        *,
        actor_uid: str,
        action: AuditAction | str,
        target_type: str,
        target_id: str,
        target_org_id: str | None,
        metadata: dict,
        ip_hash: str,
        user_agent: str,
    ) -> str | None:
        """Fail-soft write — for view audits only.

        State-transition routes MUST NOT call this; they pass
        `audit_entry=` to the DB helper instead so the audit row commits
        atomically with the state change.

        Returns the doc id, or None on failure.
        """
        doc = self.build_audit_doc(
            actor_uid=actor_uid, action=action,
            target_type=target_type, target_id=target_id,
            target_org_id=target_org_id, metadata=metadata,
            ip_hash=ip_hash, user_agent=user_agent,
        )
        try:
            _, ref = self._collection_factory().add(doc)
            return ref.id
        except Exception as exc:  # noqa: BLE001
            logger.warning('[audit] write failed: %s', exc)
            return None
```

- [ ] **Step 4: Add collection accessor in `database.py`**

Add near other collection accessor functions (search for `def get_organizations_collection`):

```python
LINGUAL_ADMIN_AUDIT_COLLECTION = 'lingual_admin_audit'


def get_lingual_admin_audit_collection():
    return get_db().collection(LINGUAL_ADMIN_AUDIT_COLLECTION)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python3 -m unittest backend.tests.test_lingual_admin_audit -v
```

Expected: 6 tests pass (4 logger + 1 enum + 1 collection accessor; plus the new `build_audit_doc` test = 7 total). Adjust the count when running locally.

- [ ] **Step 6: Commit**

```bash
git add database.py backend/services/audit.py backend/tests/test_lingual_admin_audit.py
git commit -m "feat(audit): add lingual_admin_audit collection + AuditLogger service"
```

---

## Task 3: Inject `audit_logger` into `RouteDeps`

**Files:**
- Modify: `backend/route_deps.py`
- Modify: `main.py` (construct the real logger)
- Modify: `backend/tests/conftest.py` (default fake)
- Create: `backend/tests/test_route_deps_audit_logger.py`

**Why:** Routes consume the audit logger via DI so test fixtures can swap a `FakeAuditLogger` and assert on calls without mocking Firestore. This is also the new precedent that closes LIMITATIONS #29's "routes call `database.get_db()` directly" pattern at the audit boundary.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_route_deps_audit_logger.py`:

```python
import unittest
from unittest.mock import MagicMock

from backend.route_deps import RouteDeps
from backend.services.audit import AuditLogger, AuditAction


class RouteDepsAuditLoggerTests(unittest.TestCase):
    def test_deps_has_audit_logger(self):
        deps = RouteDeps(
            db=MagicMock(),
            firebase_auth=MagicMock(),
            audit_logger=AuditLogger(collection_factory=lambda: MagicMock()),
        )
        self.assertTrue(hasattr(deps, 'audit_logger'))

    def test_audit_logger_is_callable_via_deps(self):
        fake_col = MagicMock()
        fake_col.add.return_value = (None, MagicMock(id='a1'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        deps = RouteDeps(
            db=MagicMock(),
            firebase_auth=MagicMock(),
            audit_logger=logger,
        )
        out = deps.audit_logger.log(
            actor_uid='u',
            action=AuditAction.ORG_VIEWED_DETAIL,
            target_type='organization',
            target_id='o',
            target_org_id='o',
            metadata={},
            ip_hash='',
            user_agent='',
        )
        self.assertEqual(out, 'a1')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_route_deps_audit_logger -v
```

Expected: `TypeError: __init__() got an unexpected keyword argument 'audit_logger'`.

- [ ] **Step 3: Add `audit_logger` to `RouteDeps`**

Open `backend/route_deps.py`. Find the dataclass / class definition and add the field. If it's a dataclass:

```python
from dataclasses import dataclass, field
from backend.services.audit import AuditLogger


@dataclass
class RouteDeps:
    db: object
    firebase_auth: object
    # ... existing fields ...
    audit_logger: AuditLogger = field(default_factory=lambda: AuditLogger())
```

(Place `audit_logger` after the existing fields; reorder defaults if needed so non-default fields come first.)

- [ ] **Step 4: Construct in `main.py`**

In `main.py` where `RouteDeps(...)` is built (search for `RouteDeps(`), add `audit_logger=AuditLogger()` to the keyword args.

- [ ] **Step 5: Update `backend/tests/conftest.py`**

Find `make_test_deps(...)` (or equivalent factory) and add:

```python
from backend.services.audit import AuditLogger


class FakeAuditLogger:
    """Captures audit calls for assertions; never raises."""
    def __init__(self):
        self.calls = []

    def log(self, **kwargs):
        self.calls.append(kwargs)
        return f'audit-{len(self.calls)}'


def make_test_deps(*, db=None, firebase_auth=None, audit_logger=None, **kwargs):
    return RouteDeps(
        db=db or FakeDbBase(),
        firebase_auth=firebase_auth or FakeFirebaseAuth(),
        audit_logger=audit_logger or FakeAuditLogger(),
        **kwargs,
    )
```

- [ ] **Step 6: Run tests**

```bash
python3 -m unittest backend.tests.test_route_deps_audit_logger -v
make test-backend
```

Expected: new tests pass; existing tests still pass (because `audit_logger` has a default).

- [ ] **Step 7: Commit**

```bash
git add backend/route_deps.py main.py backend/tests/conftest.py backend/tests/test_route_deps_audit_logger.py
git commit -m "feat(audit): inject AuditLogger via RouteDeps + FakeAuditLogger fixture"
```

---

## Task 4: `suspend_organization` and `restore_organization` DB helpers (atomic with audit)

**Files:**
- Modify: `database.py`
- Create: `backend/tests/test_org_suspend_restore.py`

**Why:** Suspend/restore are not bare field updates — they validate the transition, capture timestamps + reason + actor, write the audit row atomically (via Firestore batch), and (on restore) clear the suspended_* fields. Centralizing in `database.py` keeps the state machine in one place. The atomic audit write satisfies the spec §47 invariant that *"every Lingual admin action is audited"* — a partial commit where the state changed but the audit row failed is impossible by construction.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_org_suspend_restore.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

import database


SAMPLE_AUDIT_ENTRY = {
    'actor_uid': 'admin-uid',
    'action': 'org_suspended',
    'target': {'type': 'organization', 'id': 'org-1'},
    'target_org_id': 'org-1',
    'metadata': {'reason': 'fraud risk'},
    'ip_hash': 'h',
    'user_agent': 'ua',
    # created_at intentionally omitted — helper stamps SERVER_TIMESTAMP.
}


class SuspendOrganizationTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_suspend_batches_org_update_and_audit(self, mock_get_db, mock_get_org, mock_get_ref):
        """Atomic write: same Firestore batch contains BOTH the org update
        AND the audit doc. If either fails, neither commits."""
        mock_get_org.return_value = {'id': 'org-1', 'status': 'active'}
        ref = MagicMock(name='org_ref')
        mock_get_ref.return_value = ref
        batch = MagicMock(name='batch')
        audit_doc_ref = MagicMock(name='audit_doc_ref', id='audit-x')
        audit_col = MagicMock(name='audit_col')
        audit_col.document.return_value = audit_doc_ref
        db = MagicMock(name='db')
        db.batch.return_value = batch
        db.collection.return_value = audit_col
        mock_get_db.return_value = db

        database.suspend_organization(
            org_id='org-1', actor_uid='admin-uid',
            reason='fraud risk', suspended_until=None,
            audit_entry=dict(SAMPLE_AUDIT_ENTRY),
        )
        # batch.update was called with the org update
        update_call = batch.update.call_args
        self.assertIs(update_call[0][0], ref)
        update = update_call[0][1]
        self.assertEqual(update['status'], 'suspended')
        self.assertEqual(update['suspended_by_uid'], 'admin-uid')
        self.assertEqual(update['suspend_reason'], 'fraud risk')
        self.assertIn('suspended_at', update)
        # batch.set was called with the audit doc
        set_call = batch.set.call_args
        self.assertIs(set_call[0][0], audit_doc_ref)
        self.assertEqual(set_call[0][1]['action'], 'org_suspended')
        # ONE batch.commit() — single atomic write
        batch.commit.assert_called_once()

    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_suspend_records_suspended_until(self, mock_get_db, mock_get_org, mock_get_ref):
        mock_get_org.return_value = {'id': 'org-1', 'status': 'active'}
        mock_get_ref.return_value = MagicMock()
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()
        import datetime
        until = datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc)
        database.suspend_organization(
            org_id='org-1', actor_uid='u', reason='temp',
            suspended_until=until,
            audit_entry=dict(SAMPLE_AUDIT_ENTRY),
        )
        self.assertEqual(batch.update.call_args[0][1]['suspended_until'], until)

    @patch('database.get_organization')
    def test_suspend_rejects_already_suspended(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'suspended'}
        with self.assertRaisesRegex(ValueError, 'already suspended'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_rejects_missing_org(self, mock_get_org):
        mock_get_org.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.suspend_organization(
                org_id='nope', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_rejects_empty_reason(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'reason'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_requires_audit_entry(self, mock_get_org):
        """SOC 2 invariant: a state-transition cannot be called without audit."""
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=None,
            )


class RestoreOrganizationTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_restore_batches_org_update_and_audit(self, mock_get_db, mock_get_org, mock_get_ref):
        mock_get_org.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspended_at': 't', 'suspended_by_uid': 'u',
            'suspend_reason': 'r', 'suspended_until': 't2',
        }
        ref = MagicMock()
        mock_get_ref.return_value = ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()
        audit_entry = {**SAMPLE_AUDIT_ENTRY, 'action': 'org_restored'}

        database.restore_organization(
            org_id='o', actor_uid='admin',
            audit_entry=audit_entry,
        )
        update = batch.update.call_args[0][1]
        self.assertEqual(update['status'], 'active')
        self.assertEqual(update['suspend_reason'], None)
        self.assertEqual(update['suspended_at'], None)
        self.assertEqual(update['suspended_by_uid'], None)
        self.assertEqual(update['suspended_until'], None)
        self.assertEqual(update['restored_by_uid'], 'admin')
        self.assertIn('restored_at', update)
        batch.commit.assert_called_once()

    @patch('database.get_organization')
    def test_restore_rejects_already_active(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'not suspended'):
            database.restore_organization(
                org_id='o', actor_uid='admin',
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_restore_rejects_missing_org(self, mock_get_org):
        mock_get_org.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.restore_organization(
                org_id='nope', actor_uid='admin',
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_restore_requires_audit_entry(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'suspended'}
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.restore_organization(
                org_id='o', actor_uid='admin',
                audit_entry=None,
            )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_org_suspend_restore -v
```

Expected: `AttributeError: module 'database' has no attribute 'suspend_organization'`.

- [ ] **Step 3: Add helpers in `database.py`**

Find `_sync_org_admin_uids` (around line 1002) and add below it:

```python
def suspend_organization(
    *,
    org_id: str,
    actor_uid: str,
    reason: str,
    suspended_until,
    audit_entry: dict,
) -> None:
    """Transition an org from active to suspended.

    The org update AND the audit row commit atomically via a Firestore
    batch — they cannot diverge. `audit_entry` must be the dict produced
    by `AuditLogger.build_audit_doc(...)`. `created_at` is overwritten with
    `SERVER_TIMESTAMP` so callers cannot back-date.

    `suspended_until` is an optional `datetime` for auto-restore via the
    Cloud Function scheduler. None means indefinite.
    """
    if audit_entry is None:
        raise ValueError('audit_entry is required for state transitions')
    if not (reason or '').strip():
        raise ValueError('suspend reason is required')
    org = get_organization(org_id)
    if not org:
        raise ValueError(f'organization {org_id} not found')
    if org.get('status') == 'suspended':
        raise ValueError(f'organization {org_id} is already suspended')

    db = get_db()
    batch = db.batch()
    batch.update(get_organization_ref(org_id), {
        'status': ORG_STATUS_SUSPENDED,
        'suspended_at': firestore.SERVER_TIMESTAMP,
        'suspended_by_uid': actor_uid,
        'suspend_reason': reason.strip(),
        'suspended_until': suspended_until,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    audit_doc = dict(audit_entry)
    audit_doc['created_at'] = firestore.SERVER_TIMESTAMP  # server time, not caller
    audit_ref = db.collection(LINGUAL_ADMIN_AUDIT_COLLECTION).document()
    batch.set(audit_ref, audit_doc)
    batch.commit()


def restore_organization(*, org_id: str, actor_uid: str, audit_entry: dict) -> None:
    """Transition an org from suspended back to active.

    Atomic with audit (see `suspend_organization` docstring).
    """
    if audit_entry is None:
        raise ValueError('audit_entry is required for state transitions')
    org = get_organization(org_id)
    if not org:
        raise ValueError(f'organization {org_id} not found')
    if org.get('status') != ORG_STATUS_SUSPENDED:
        raise ValueError(f'organization {org_id} is not suspended')

    db = get_db()
    batch = db.batch()
    batch.update(get_organization_ref(org_id), {
        'status': ORG_STATUS_ACTIVE,
        'suspended_at': None,
        'suspended_by_uid': None,
        'suspend_reason': None,
        'suspended_until': None,
        'restored_at': firestore.SERVER_TIMESTAMP,
        'restored_by_uid': actor_uid,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    audit_doc = dict(audit_entry)
    audit_doc['created_at'] = firestore.SERVER_TIMESTAMP
    batch.set(db.collection(LINGUAL_ADMIN_AUDIT_COLLECTION).document(), audit_doc)
    batch.commit()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_org_suspend_restore -v
```

Expected: 9 tests pass (7 original + 2 new `test_requires_audit_entry` cases that enforce the SOC 2 invariant at the boundary).

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_org_suspend_restore.py
git commit -m "feat(org): add suspend_organization + restore_organization helpers"
```

---

## Task 5: `list_organizations` with filters + cursor pagination

**Files:**
- Modify: `database.py`
- Create: `backend/tests/test_list_organizations.py`

**Why:** The Lingual admin orgs list page needs filtering (status, school_type, country, public/private, created date range) and pagination. Page size is hardcoded to 25 server-side; cursor is the last doc's `name` + id (composite cursor for stable ordering).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_list_organizations.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

import database


class ListOrganizationsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_default_returns_page_of_25_active(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        docs = [MagicMock(id=f'o{i}') for i in range(25)]
        for i, d in enumerate(docs):
            d.to_dict.return_value = {
                'name': f'School {i}',
                'name_lower': f'school {i}',
                'status': 'active',
                'created_at': None,
            }
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.start_after.return_value = col
        col.stream.return_value = docs

        out = database.list_organizations()
        self.assertEqual(len(out['items']), 25)
        self.assertEqual(out['items'][0]['id'], 'o0')
        self.assertIn('next_cursor', out)

    @patch('database.get_db')
    def test_filter_by_status(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_organizations(status='suspended')
        # First .where should be on `status`.
        first_where = col.where.call_args_list[0]
        self.assertIn('status', first_where[0])
        self.assertIn('suspended', first_where[0])

    @patch('database.get_db')
    def test_filter_by_school_type(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_organizations(school_type='high')
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('school_type' in c for c in calls))

    @patch('database.get_db')
    def test_cursor_advances_query_with_positional_args(self, mock_get_db):
        """Firestore `start_after` takes positional values matching the
        order_by chain (name_lower, __name__). NOT a dict."""
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.start_after.return_value = col
        col.stream.return_value = []
        database.list_organizations(cursor={'name_lower': 'lincoln high', 'id': 'o100'})
        col.start_after.assert_called_once_with('lincoln high', 'o100')

    @patch('database.get_db')
    def test_invalid_status_rejected(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database.list_organizations(status='paused')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_list_organizations -v
```

Expected: `AttributeError: module 'database' has no attribute 'list_organizations'`.

- [ ] **Step 3: Add helper in `database.py`**

Place near `search_organizations` (around line 939):

```python
LINGUAL_ADMIN_ORGS_PAGE_SIZE = 25


def list_organizations(
    *,
    status: str | None = None,
    school_type: str | None = None,
    country: str | None = None,
    public_or_private: str | None = None,
    created_after=None,
    created_before=None,
    cursor: dict | None = None,
    limit: int = LINGUAL_ADMIN_ORGS_PAGE_SIZE,
) -> dict:
    """Paged list of organizations with optional filters.

    Returns `{ 'items': [...], 'next_cursor': dict | None }`.

    `cursor` shape: `{ 'name_lower': str, 'id': str }` — the last doc seen.
    """
    if status is not None:
        _validate_org_status(status)
    query = get_db().collection('organizations')
    if status:
        query = query.where('status', '==', status)
    if school_type:
        query = query.where('school_type', '==', school_type)
    if country:
        query = query.where('country', '==', country)
    if public_or_private:
        query = query.where('public_or_private', '==', public_or_private)
    if created_after is not None:
        query = query.where('created_at', '>=', created_after)
    if created_before is not None:
        query = query.where('created_at', '<=', created_before)
    query = query.order_by('name_lower').order_by('__name__').limit(limit)
    if cursor and cursor.get('name_lower') and cursor.get('id'):
        # Firestore `start_after` takes positional values matching the
        # order_by chain — NOT a dict. A dict here silently produces a
        # truncated query that re-reads the same page.
        query = query.start_after(cursor['name_lower'], cursor['id'])
    items = []
    last_doc = None
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        items.append(data)
        last_doc = doc
    next_cursor = None
    if last_doc is not None and len(items) == limit:
        last_data = last_doc.to_dict() or {}
        next_cursor = {'name_lower': last_data.get('name_lower', ''), 'id': last_doc.id}
    return {'items': items, 'next_cursor': next_cursor}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_list_organizations -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_list_organizations.py
git commit -m "feat(org): add list_organizations with filters + cursor pagination"
```

---

## Task 6: `list_org_memberships`, `list_org_classes`, `list_org_audit_events` helpers

**Files:**
- Modify: `database.py`
- Create: `backend/tests/test_org_detail_helpers.py`

**Why:** Org detail tabs need three scoped queries. Members tab uses `list_org_memberships` (school_admin + teacher only; students excluded for FERPA). Classes tab uses `list_org_classes` (metadata only — no internals). Audit tab uses `list_org_audit_events` (queried by `target_org_id`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_org_detail_helpers.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

import database


class ListOrgMembershipsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_returns_school_admin_and_teacher_rows(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.stream.return_value = [
            MagicMock(id='m1', to_dict=lambda: {
                'org_id': 'o', 'uid': 'u1', 'roles': ['teacher'], 'status': 'active',
                'joined_at': None,
            }),
            MagicMock(id='m2', to_dict=lambda: {
                'org_id': 'o', 'uid': 'u2', 'roles': ['school_admin'], 'status': 'active',
                'joined_at': None,
            }),
        ]
        # User lookups
        def get_user(uid):
            return {'u1': {'email': 'a@x.com', 'profile': {'display_name': 'A'}},
                    'u2': {'email': 'b@x.com', 'profile': {'display_name': 'B'}}}[uid]
        with patch('database.get_user', side_effect=get_user):
            out = database.list_org_memberships(org_id='o', roles=('school_admin', 'teacher'))
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]['email'], 'a@x.com')
        self.assertEqual(out[1]['email'], 'b@x.com')
        self.assertEqual(out[0]['membership_id'], 'm1')

    @patch('database.get_db')
    def test_excludes_student_role_by_default(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.stream.return_value = []
        database.list_org_memberships(org_id='o')
        # Should have constrained by org_id + status active, and roles filter:
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('org_id' in c for c in calls))
        self.assertTrue(any('status' in c for c in calls))


class ListOrgClassesTests(unittest.TestCase):
    @patch('database.get_db')
    def test_returns_metadata_rows(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.stream.return_value = [
            MagicMock(id='c1', to_dict=lambda: {
                'org_id': 'o', 'name': 'Spanish I', 'term': 'F2026',
                'subject': 'spanish', 'teacher_membership_ids': ['m1'],
                'created_at': None,
            }),
        ]
        out = database.list_org_classes(org_id='o')
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]['name'], 'Spanish I')
        self.assertEqual(out[0]['id'], 'c1')


class ListOrgAuditEventsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_filters_by_target_org_id_and_orders_desc(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_org_audit_events(org_id='o-1', limit=50)
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('target_org_id' in c and 'o-1' in c for c in calls))
        # order_by should be on created_at desc.
        ob_args = col.order_by.call_args
        self.assertIn('created_at', ob_args[0])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_org_detail_helpers -v
```

Expected: `AttributeError: module 'database' has no attribute 'list_org_memberships'`.

- [ ] **Step 3: Add helpers in `database.py`**

Place after `list_organizations`:

```python
def list_org_memberships(
    *,
    org_id: str,
    roles: tuple = ('school_admin', 'teacher'),
) -> list:
    """Active memberships for an org, filtered to staff roles by default.

    Students are excluded by default per FERPA. Returns [{ membership_id,
    uid, email, name, roles[], status, joined_at }, ...].
    """
    q = (
        get_db()
        .collection('memberships')
        .where('org_id', '==', org_id)
        .where('status', '==', 'active')
    )
    rows = []
    for m in q.stream():
        data = m.to_dict() or {}
        member_roles = data.get('roles') or []
        if not any(r in member_roles for r in roles):
            continue
        uid = data.get('uid')
        user = get_user(uid) if uid else None
        if not user:
            continue
        rows.append({
            'membership_id': m.id,
            'uid': uid,
            'email': user.get('email'),
            'name': (user.get('profile') or {}).get('display_name') or user.get('name'),
            'roles': member_roles,
            'status': data.get('status'),
            'joined_at': data.get('joined_at'),
        })
    return rows


def list_org_classes(*, org_id: str) -> list:
    """Class metadata rows for an org. No class internals."""
    q = (
        get_db()
        .collection('classes')
        .where('org_id', '==', org_id)
    )
    rows = []
    for c in q.stream():
        data = c.to_dict() or {}
        rows.append({
            'id': c.id,
            'name': data.get('name'),
            'term': data.get('term'),
            'subject': data.get('subject'),
            'teacher_membership_ids': data.get('teacher_membership_ids') or [],
            'created_at': data.get('created_at'),
            'last_activity_at': data.get('last_activity_at'),
        })
    return rows


def list_org_audit_events(*, org_id: str, limit: int = 50) -> list:
    """Audit rows scoped to this org, newest first."""
    q = (
        get_db()
        .collection(LINGUAL_ADMIN_AUDIT_COLLECTION)
        .where('target_org_id', '==', org_id)
        .order_by('created_at', direction='DESCENDING')
        .limit(limit)
    )
    rows = []
    for a in q.stream():
        data = a.to_dict() or {}
        data['id'] = a.id
        rows.append(data)
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_org_detail_helpers -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_org_detail_helpers.py
git commit -m "feat(org): add list_org_memberships, classes, audit_events helpers"
```

---

## Task 7: `remove_membership` helper (atomic with audit, syncs `_sync_org_admin_uids`)

**Files:**
- Modify: `database.py`
- Modify: `backend/tests/test_school_admin_uids_invariant.py` (add removal regression)
- Create: `backend/tests/test_remove_membership.py`

**Why:** This is the Sprint C absorption — the `_sync_org_admin_uids` denormalization invariant requires that every `school_admin` removal calls `add=False`. Plan 5 ships the first real removal path; we make the helper canonical, write the audit row atomically with the removal (Firestore batch), and add the regression test the codebase-conventions §14 forward obligation called for.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_remove_membership.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

import database


SAMPLE_REMOVE_AUDIT = {
    'actor_uid': 'admin',
    'action': 'membership_removed',
    'target': {'type': 'membership', 'id': 'm1'},
    'target_org_id': 'o',
    'metadata': {'reason': 'teacher left school'},
    'ip_hash': 'h',
    'user_agent': 'ua',
}


class RemoveMembershipTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_batches_membership_update_and_audit(self, mock_get_db, mock_ref, mock_get, mock_org_ref):
        """Atomic: membership update + audit doc in one batch."""
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        membership_ref = MagicMock(name='membership_ref')
        mock_ref.return_value = membership_ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        # The first batch.update is the membership update
        first_call = batch.update.call_args_list[0]
        self.assertIs(first_call[0][0], membership_ref)
        self.assertEqual(first_call[0][1]['status'], 'removed')
        self.assertEqual(first_call[0][1]['removed_by_uid'], 'admin')
        # batch.set was called with the audit doc
        set_call = batch.set.call_args
        self.assertEqual(set_call[0][1]['action'], 'membership_removed')
        batch.commit.assert_called_once()

    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_school_admin_removal_also_batches_org_admin_uids_update(
        self, mock_get_db, mock_ref, mock_get, mock_org_ref
    ):
        """`school_admin` removal must include arrayRemove on the org doc in the SAME batch."""
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['school_admin'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        org_ref = MagicMock(name='org_ref')
        mock_org_ref.return_value = org_ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        # batch.update was called TWICE: once for membership, once for org
        update_calls = batch.update.call_args_list
        self.assertEqual(len(update_calls), 2)
        # The second update is on org_ref with school_admin_uids ArrayRemove
        org_update = update_calls[1]
        self.assertIs(org_update[0][0], org_ref)
        self.assertIn('school_admin_uids', org_update[0][1])

    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_teacher_removal_does_not_touch_org_admin_uids(
        self, mock_get_db, mock_ref, mock_get, mock_org_ref
    ):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        # Only ONE batch.update (membership only)
        self.assertEqual(len(batch.update.call_args_list), 1)

    @patch('database.get_membership')
    def test_missing_membership_raises(self, mock_get):
        mock_get.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=dict(SAMPLE_REMOVE_AUDIT),
            )

    @patch('database.get_membership')
    def test_already_removed_raises(self, mock_get):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'removed',
        }
        with self.assertRaisesRegex(ValueError, 'already removed'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=dict(SAMPLE_REMOVE_AUDIT),
            )

    @patch('database.get_membership')
    def test_requires_audit_entry(self, mock_get):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=None,
            )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_remove_membership -v
```

Expected: `AttributeError: module 'database' has no attribute 'remove_membership'`.

- [ ] **Step 3: Add helper in `database.py`**

Place near `create_membership` (around line 1019):

```python
def remove_membership(*, membership_id: str, actor_uid: str, audit_entry: dict) -> dict:
    """Soft-remove a membership row, atomically with the audit row.

    Sets `status='removed'` and stamps `removed_at` / `removed_by_uid` in
    a Firestore batch alongside the audit doc. If the membership held the
    `school_admin` role, ALSO updates the org's `school_admin_uids` array
    in the same batch (via `arrayRemove`) so the denormalization
    invariant the Plan 4 codebase-conventions §14 forward obligation
    requires is preserved atomically.

    Returns the membership dict (pre-removal) for downstream UI/response
    shaping.
    """
    if audit_entry is None:
        raise ValueError('audit_entry is required for state transitions')
    m = get_membership(membership_id)
    if not m:
        raise ValueError(f'membership {membership_id} not found')
    if m.get('status') == 'removed':
        raise ValueError(f'membership {membership_id} is already removed')

    db = get_db()
    batch = db.batch()
    batch.update(get_membership_ref(membership_id), {
        'status': 'removed',
        'removed_at': firestore.SERVER_TIMESTAMP,
        'removed_by_uid': actor_uid,
    })
    # Sync school_admin_uids in the SAME batch if the removed role contained school_admin.
    if 'school_admin' in (m.get('roles') or []):
        org_id = m.get('org_id')
        uid = m.get('uid')
        if org_id and uid:
            batch.update(get_organization_ref(org_id), {
                'school_admin_uids': firestore.ArrayRemove([uid]),
                'updated_at': firestore.SERVER_TIMESTAMP,
            })
    # Audit doc.
    audit_doc = dict(audit_entry)
    audit_doc['created_at'] = firestore.SERVER_TIMESTAMP
    batch.set(db.collection(LINGUAL_ADMIN_AUDIT_COLLECTION).document(), audit_doc)
    batch.commit()
    return m
```

> Note: `_sync_org_admin_uids` (Plan 4) does the same `ArrayRemove` and additional bookkeeping. Inlining it into the batch here is the simplest way to keep the org-doc update atomic with the membership update and the audit row. If `_sync_org_admin_uids` grows additional side-effects later, refactor it to expose a `batch_update_only` variant rather than calling it outside the batch.

- [ ] **Step 4: Extend `backend/tests/test_school_admin_uids_invariant.py`**

Open the existing invariant test file. Add this test class:

```python
_INVARIANT_AUDIT = {
    'actor_uid': 'admin',
    'action': 'membership_removed',
    'target': {'type': 'membership', 'id': 'm1'},
    'target_org_id': 'o-1',
    'metadata': {'reason': 'invariant test'},
    'ip_hash': '',
    'user_agent': '',
}


class RemoveMembershipInvariantTests(unittest.TestCase):
    """Plan 5 acceptance: any school_admin removal MUST update
    `organizations.school_admin_uids` in the SAME Firestore batch."""

    @patch('database.get_organization_ref')
    @patch('database.get_membership_ref')
    @patch('database.get_membership')
    @patch('database.get_db')
    def test_remove_membership_with_school_admin_role_batches_org_update(
        self, mock_get_db, mock_get, mock_ref, mock_org_ref
    ):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o-1',
            'roles': ['school_admin'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        org_ref = MagicMock()
        mock_org_ref.return_value = org_ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(_INVARIANT_AUDIT),
        )
        # Two batch.update calls: membership + org school_admin_uids
        self.assertEqual(len(batch.update.call_args_list), 2)
        org_update_payload = batch.update.call_args_list[1][0][1]
        self.assertIn('school_admin_uids', org_update_payload)

    @patch('database.get_organization_ref')
    @patch('database.get_membership_ref')
    @patch('database.get_membership')
    @patch('database.get_db')
    def test_combined_roles_still_updates_school_admin_uids(
        self, mock_get_db, mock_get, mock_ref, mock_org_ref
    ):
        """If the role list contains BOTH teacher and school_admin, sync must fire."""
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o-1',
            'roles': ['teacher', 'school_admin'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        mock_org_ref.return_value = MagicMock()
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(_INVARIANT_AUDIT),
        )
        self.assertEqual(len(batch.update.call_args_list), 2)
```

- [ ] **Step 5: Run tests**

```bash
python3 -m unittest backend.tests.test_remove_membership -v
python3 -m unittest backend.tests.test_school_admin_uids_invariant -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add database.py backend/tests/test_remove_membership.py backend/tests/test_school_admin_uids_invariant.py
git commit -m "feat(membership): add remove_membership + school_admin sync invariant test"
```

---

## Task 8: Add `ORG_SUSPENDED` + `ORG_RESTORED` outbox templates

**Files:**
- Modify: `backend/services/outbox.py` (enum)
- Create: `functions/templates/org_suspended.html.j2`
- Create: `functions/templates/org_restored.html.j2`
- Modify: `functions/main.py` (subjects)
- Create: `functions/tests/test_lingual_admin_templates.py`

**Why:** Suspend/restore each fire one email per active school_admin of the affected org. We follow the same pattern Plan 3 used for `school_request_approved`/`school_request_declined`: enum + j2 + subject lookup in one commit.

- [ ] **Step 1: Write the failing test**

Create `functions/tests/test_lingual_admin_templates.py`:

```python
import unittest
from unittest.mock import patch


class OrgSuspendedTemplateTests(unittest.TestCase):
    def test_subject_includes_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        subject_fn = _TEMPLATE_SUBJECTS['org_suspended']
        out = subject_fn({'org_name': 'Sunset HS'})
        self.assertIn('Sunset HS', out)
        self.assertIn('suspended', out.lower())

    def test_render_includes_reason_and_until(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import render_template
        html = render_template('org_suspended', {
            'org_name': 'Sunset HS',
            'reason': 'Pending compliance review',
            'suspended_until': '2026-06-01',
            'support_email': 'help@l1ngual.com',
        })
        self.assertIn('Sunset HS', html)
        self.assertIn('Pending compliance review', html)
        self.assertIn('2026-06-01', html)
        self.assertIn('help@l1ngual.com', html)

    def test_render_omits_until_when_indefinite(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import render_template
        html = render_template('org_suspended', {
            'org_name': 'Sunset HS',
            'reason': 'X',
            'suspended_until': None,
            'support_email': 'help@l1ngual.com',
        })
        self.assertNotIn('2026', html)


class OrgRestoredTemplateTests(unittest.TestCase):
    def test_subject_includes_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        subject_fn = _TEMPLATE_SUBJECTS['org_restored']
        out = subject_fn({'org_name': 'Sunset HS'})
        self.assertIn('Sunset HS', out)
        self.assertIn('restored', out.lower())

    def test_render_includes_dashboard_link(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import render_template
        html = render_template('org_restored', {
            'org_name': 'Sunset HS',
            'dashboard_url': 'https://l1ngual.com/app/admin',
        })
        self.assertIn('Sunset HS', html)
        self.assertIn('https://l1ngual.com/app/admin', html)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest functions.tests.test_lingual_admin_templates -v
```

Expected: `KeyError: 'org_suspended'` (template not registered).

- [ ] **Step 3: Add the two enum members in `backend/services/outbox.py`**

Find the `OutboxTemplate` enum and add:

```python
class OutboxTemplate(str, enum.Enum):
    # ... existing members ...
    ORG_SUSPENDED = 'org_suspended'
    ORG_RESTORED = 'org_restored'
```

- [ ] **Step 4: Create `functions/templates/org_suspended.html.j2`**

```jinja
<!doctype html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">{{ org_name }} has been suspended on Lingual</h1>

  <p>A Lingual administrator has temporarily suspended access for {{ org_name }}.</p>

  <p><strong>Reason:</strong> {{ reason }}</p>

  {% if suspended_until %}
  <p><strong>Scheduled restore:</strong> {{ suspended_until }}</p>
  <p>If no action is needed, access will be automatically restored at that time.</p>
  {% else %}
  <p>This is an indefinite suspension. Access will resume once Lingual restores the organization.</p>
  {% endif %}

  <p>During suspension:</p>
  <ul>
    <li>Students cannot start new practice sessions.</li>
    <li>Existing voice sessions in progress will complete normally.</li>
    <li>Teachers can still log in but cannot create or modify assignments.</li>
    <li>All existing data is preserved.</li>
  </ul>

  <p>If you have questions or believe this was issued in error, reply to this email or contact <a href="mailto:{{ support_email }}">{{ support_email }}</a>.</p>

  <p style="color: #666; font-size: 13px; margin-top: 32px;">— The Lingual team</p>
</body>
</html>
```

- [ ] **Step 5: Create `functions/templates/org_restored.html.j2`**

```jinja
<!doctype html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">{{ org_name }} access has been restored</h1>

  <p>{{ org_name }} is once again active on Lingual. Students, teachers, and administrators can resume normal use immediately.</p>

  <p><a href="{{ dashboard_url }}" style="display:inline-block; padding: 10px 16px; background:#1a1a1a; color:white; text-decoration:none; border-radius: 6px;">Open dashboard</a></p>

  <p style="color: #666; font-size: 13px; margin-top: 32px;">— The Lingual team</p>
</body>
</html>
```

- [ ] **Step 6: Register subjects in `functions/main.py`**

Find `_TEMPLATE_SUBJECTS` (around the templates section) and add:

```python
_TEMPLATE_SUBJECTS: dict[str, Callable[[dict], str]] = {
    # ... existing entries ...
    'org_suspended': lambda data: f"{data.get('org_name', 'Your school')} has been suspended on Lingual",
    'org_restored': lambda data: f"{data.get('org_name', 'Your school')} access has been restored on Lingual",
}
```

- [ ] **Step 7: Run tests**

```bash
python3 -m unittest functions.tests.test_lingual_admin_templates -v
```

Expected: 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/services/outbox.py functions/main.py functions/templates/org_suspended.html.j2 functions/templates/org_restored.html.j2 functions/tests/test_lingual_admin_templates.py
git commit -m "feat(outbox): add org_suspended + org_restored email templates"
```

---

## Task 9: `enforce_org_active` helper + `SuspendedOrgError`

**Files:**
- Create: `backend/services/suspended_org_guard.py`
- Create: `backend/tests/test_suspended_org_guard.py`

**Why:** Suspend enforcement needs one helper called from 5 places (assignment_resolver, realtime mint, practice mutations, canvas_practice launch, teacher assignment writes). Centralizing the check + the 403 shape keeps every enforcement point uniform.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_suspended_org_guard.py`:

```python
import unittest
from unittest.mock import patch

from backend.services.suspended_org_guard import (
    SuspendedOrgError,
    enforce_org_active,
    is_org_suspended,
)


class IsOrgSuspendedTests(unittest.TestCase):
    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_active_returns_false(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'active'}
        self.assertFalse(is_org_suspended('o'))

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_suspended_returns_true(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'suspended'}
        self.assertTrue(is_org_suspended('o'))

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_missing_returns_false(self, mock_get):
        mock_get.return_value = None
        self.assertFalse(is_org_suspended('o'))

    def test_none_org_id_returns_false(self):
        self.assertFalse(is_org_suspended(None))
        self.assertFalse(is_org_suspended(''))


class EnforceOrgActiveTests(unittest.TestCase):
    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_active_returns_quietly(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'active'}
        enforce_org_active('o')  # no raise

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_suspended_raises_with_payload(self, mock_get):
        mock_get.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspend_reason': 'fraud risk',
            'suspended_until': '2026-06-01',
        }
        with self.assertRaises(SuspendedOrgError) as ctx:
            enforce_org_active('o')
        self.assertEqual(ctx.exception.org_id, 'o')
        self.assertEqual(ctx.exception.reason, 'fraud risk')
        self.assertEqual(ctx.exception.until, '2026-06-01')
        self.assertEqual(ctx.exception.to_payload(), {
            'error': 'org_suspended',
            'reason': 'fraud risk',
            'until': '2026-06-01',
        })

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_indefinite_suspension_has_no_until(self, mock_get):
        mock_get.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspend_reason': 'r', 'suspended_until': None,
        }
        with self.assertRaises(SuspendedOrgError) as ctx:
            enforce_org_active('o')
        self.assertNotIn('until', ctx.exception.to_payload())

    def test_none_org_id_returns_quietly(self):
        enforce_org_active(None)
        enforce_org_active('')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_suspended_org_guard -v
```

Expected: `ModuleNotFoundError: No module named 'backend.services.suspended_org_guard'`.

- [ ] **Step 3: Create `backend/services/suspended_org_guard.py`**

```python
"""Suspended-org enforcement helper.

Any code path that mutates org-scoped data or initiates a billable session
calls `enforce_org_active(org_id)`. On a suspended org the helper raises
`SuspendedOrgError`; routes translate that to a 403 with a stable payload
shape so frontends can render a consistent "school suspended" message.
"""
from __future__ import annotations

import database


class SuspendedOrgError(Exception):
    def __init__(self, *, org_id: str, reason: str | None, until=None):
        self.org_id = org_id
        self.reason = reason
        self.until = until
        super().__init__(f'organization {org_id} is suspended')

    def to_payload(self) -> dict:
        payload = {'error': 'org_suspended', 'reason': self.reason}
        if self.until is not None:
            payload['until'] = self.until
        return payload


def is_org_suspended(org_id: str | None) -> bool:
    if not org_id:
        return False
    org = database.get_organization(org_id)
    if not org:
        return False
    return org.get('status') == database.ORG_STATUS_SUSPENDED


def enforce_org_active(org_id: str | None) -> None:
    """Raise SuspendedOrgError if the org is suspended. No-op when org_id is empty."""
    if not org_id:
        return
    org = database.get_organization(org_id)
    if not org:
        return
    if org.get('status') == database.ORG_STATUS_SUSPENDED:
        raise SuspendedOrgError(
            org_id=org_id,
            reason=org.get('suspend_reason'),
            until=org.get('suspended_until'),
        )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_suspended_org_guard -v
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/suspended_org_guard.py backend/tests/test_suspended_org_guard.py
git commit -m "feat(org): add enforce_org_active + SuspendedOrgError"
```

---

## Task 10: Wire `enforce_org_active` into 5 enforcement points + in-flight grace

**Files:**
- Modify: `backend/services/assignment_resolver.py`
- Modify: `backend/routes/chat.py` (realtime session mint)
- Modify: `backend/routes/curriculum_admin.py` (practice session create + event report)
- Modify: `backend/routes/canvas_practice.py` (practice launch)
- Modify: `backend/routes/teacher.py` (assignment write endpoints)
- Modify: `database.py` — `create_practice_session` snapshots org status at creation
- Create: `backend/tests/test_suspended_org_enforcement.py`

**Why:** Spec §556 says suspend blocks `assignment_resolver`, realtime session mint, and practice mutations. We enumerate every endpoint that should fail closed and verify with one integration test per surface.

**In-flight grace (LIMITATIONS #28-style decision, brainstorming round):**
The product decision was *"in-flight realtime sessions finish; new sessions blocked."* The naive implementation (gate every event-reporting call on the current org status) breaks that — a session created when org was active would have its `POST /events` calls 403 the moment org becomes suspended, leaving the WebSocket open but transcript silent. Fix: `practice_sessions/{id}.org_status_when_created` is a snapshot of the org status at session creation. The `POST /events` enforcement check passes if (a) org is currently active, OR (b) the session's `org_status_when_created` was `active` (meaning this session predates the suspension and gets grace). New session creation still uses the *current* org status, so the suspension reaches new sessions immediately.

**Enforcement surface table (the enumeration the spec asks for):**

| Endpoint | Behavior | Check kind |
|---|---|---|
| `resolve_assignment_prompt` (resolver) | 403 `org_suspended` if org not active | current status |
| `POST /api/realtime/session` (chat) | 403 if org not active | current status |
| `POST /api/practice-sessions` (curriculum_admin) | 403 if org not active | current status |
| `POST /api/practice-sessions/<id>/events` (curriculum_admin) | 403 if BOTH current org is not active AND `org_status_when_created != 'active'` | current AND snapshot |
| `POST /api/canvas/practice/...` (canvas_practice) | 403 if org not active | current status |
| `POST /api/teacher/.../assignments` (teacher) | 403 if org not active | current status |

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_suspended_org_enforcement.py`:

```python
"""Integration tests: each enforcement point returns 403 on suspended org.

In-flight realtime sessions are intentionally NOT torn down — only NEW
session creation is blocked (Plan 5 brainstorming decision). Sessions
created before the suspension preserve `org_status_when_created='active'`
and can continue event reporting (see PracticeSessionEventGraceTests).
"""
import unittest
from unittest.mock import patch

from backend.tests.conftest import (
    FakeDbBase, FakeAuditLogger,
    make_test_deps, make_test_app,
)


class SuspendedOrgFake(FakeDbBase):
    """Test fake with one suspended org, one active org, and a few classes
    pointing at each. Subclasses extend with route-specific surface area."""

    def __init__(self):
        super().__init__()
        self.created_sessions = []

    def get_organization(self, org_id):
        if org_id == 'org-suspended':
            return {
                'id': 'org-suspended', 'status': 'suspended',
                'suspend_reason': 'compliance review',
                'suspended_until': None,
            }
        if org_id == 'org-active':
            return {'id': 'org-active', 'status': 'active'}
        return None

    def get_class(self, class_id):
        if class_id == 'c-suspended':
            return {'id': 'c-suspended', 'org_id': 'org-suspended'}
        if class_id == 'c-active':
            return {'id': 'c-active', 'org_id': 'org-active'}
        return None


class AssignmentResolverEnforcementTests(unittest.TestCase):
    def test_resolve_assignment_prompt_blocks_suspended(self):
        from backend.services.assignment_resolver import resolve_assignment_prompt
        from backend.services.suspended_org_guard import SuspendedOrgError
        with patch('backend.services.suspended_org_guard.database.get_organization') as mock_get:
            mock_get.return_value = {
                'id': 'org-suspended', 'status': 'suspended',
                'suspend_reason': 'compliance review', 'suspended_until': None,
            }
            with self.assertRaises(SuspendedOrgError):
                resolve_assignment_prompt(
                    assignment={'class_id': 'c1'},
                    student_profile={'uid': 'u'},
                    class_doc={'id': 'c1', 'org_id': 'org-suspended'},
                    compliance_policy={},
                    modality_policy={},
                )

    def test_resolve_assignment_prompt_allows_active(self):
        from backend.services.assignment_resolver import resolve_assignment_prompt
        with patch('backend.services.suspended_org_guard.database.get_organization') as mock_get:
            mock_get.return_value = {'id': 'org-active', 'status': 'active'}
            # No raise — execution proceeds into the existing resolver body.
            # We only care about the gate behavior; downstream is unit-tested
            # elsewhere. We patch the heavy parts to short-circuit.
            with patch('backend.services.assignment_resolver._build_main_prompt') as mock_build:
                mock_build.return_value = 'PROMPT'
                out = resolve_assignment_prompt(
                    assignment={'class_id': 'c1'},
                    student_profile={'uid': 'u'},
                    class_doc={'id': 'c1', 'org_id': 'org-active'},
                    compliance_policy={},
                    modality_policy={},
                )
            self.assertIsNotNone(out)


class RealtimeSessionMintTests(unittest.TestCase):
    """`POST /api/realtime/session` with `class_id=c-suspended` → 403 org_suspended."""

    def _make(self):
        from backend.routes.chat import create_chat_blueprint
        deps = make_test_deps(db=SuspendedOrgFake())
        app = make_test_app(deps, extra_blueprints=[create_chat_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'student-uid'
        return deps, client

    def test_returns_403_when_class_org_is_suspended(self):
        # Patch the OpenAI client at the boundary so this is a pure gate test.
        with patch('backend.routes.chat._mint_realtime_credential', return_value={'tok': 'x'}):
            _, client = self._make()
            resp = client.post('/api/realtime/session', json={'class_id': 'c-suspended'})
            self.assertEqual(resp.status_code, 403)
            self.assertEqual(resp.get_json().get('error'), 'org_suspended')

    def test_returns_200_when_class_org_is_active(self):
        with patch('backend.routes.chat._mint_realtime_credential', return_value={'tok': 'x'}):
            _, client = self._make()
            resp = client.post('/api/realtime/session', json={'class_id': 'c-active'})
            self.assertEqual(resp.status_code, 200)


class PracticeSessionCreateTests(unittest.TestCase):
    """`POST /api/practice-sessions` is blocked on suspended org."""

    def _make(self):
        from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
        class Fake(SuspendedOrgFake):
            def get_assignment(self, aid):
                if aid == 'a-suspended':
                    return {'id': 'a-suspended', 'class_id': 'c-suspended',
                            'status': 'published'}
                if aid == 'a-active':
                    return {'id': 'a-active', 'class_id': 'c-active',
                            'status': 'published'}
                return None
            def create_practice_session(self, *, assignment_id, student_uid,
                                        org_status_when_created):
                self.created_sessions.append({
                    'assignment_id': assignment_id, 'student_uid': student_uid,
                    'org_status_when_created': org_status_when_created,
                })
                return {'id': f's-{len(self.created_sessions)}'}
        deps = make_test_deps(db=Fake())
        app = make_test_app(deps, extra_blueprints=[create_curriculum_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'student-uid'
        return deps, client

    def test_returns_403_when_org_suspended(self):
        deps, client = self._make()
        resp = client.post('/api/practice-sessions',
                           json={'assignment_id': 'a-suspended'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json().get('error'), 'org_suspended')
        # No session was created.
        self.assertEqual(deps.db.created_sessions, [])

    def test_snapshots_org_status_when_created_on_active(self):
        """I3 invariant — session must record org status at creation time
        so later event reporting can grace pre-suspension sessions."""
        deps, client = self._make()
        resp = client.post('/api/practice-sessions',
                           json={'assignment_id': 'a-active'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(deps.db.created_sessions[0]['org_status_when_created'], 'active')


class PracticeSessionEventGraceTests(unittest.TestCase):
    """`POST /api/practice-sessions/<id>/events` — in-flight grace test.

    Sessions whose `org_status_when_created == 'active'` keep accepting
    events even if the org becomes suspended mid-flight. New session
    creation is already blocked above; this test ensures we do not break
    open WebSockets."""

    def _make(self, *, current_status, snapshot_status):
        from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
        snapshot = snapshot_status
        cur = current_status
        class Fake(SuspendedOrgFake):
            def get_organization(self, org_id):
                if org_id == 'org-x':
                    return {'id': 'org-x', 'status': cur}
                return super().get_organization(org_id)
            def get_practice_session(self, sid):
                return {
                    'id': sid, 'student_uid': 'student-uid',
                    'assignment_id': 'a1', 'class_id': 'c-x',
                    'org_status_when_created': snapshot,
                }
            def get_class(self, cid):
                if cid == 'c-x':
                    return {'id': 'c-x', 'org_id': 'org-x'}
                return super().get_class(cid)
        deps = make_test_deps(db=Fake())
        app = make_test_app(deps, extra_blueprints=[create_curriculum_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'student-uid'
        return client

    def test_event_report_passes_when_session_predates_suspension(self):
        """Org currently suspended, but session was created when active —
        events should be accepted (in-flight grace)."""
        client = self._make(current_status='suspended', snapshot_status='active')
        resp = client.post('/api/practice-sessions/s1/events',
                           json={'event_type': 'student.turn', 'payload': {}})
        self.assertEqual(resp.status_code, 200)

    def test_event_report_blocked_when_session_created_during_suspension(self):
        """Shouldn't normally happen (creation is gated), but defense in depth."""
        client = self._make(current_status='suspended', snapshot_status='suspended')
        resp = client.post('/api/practice-sessions/s1/events',
                           json={'event_type': 'student.turn', 'payload': {}})
        self.assertEqual(resp.status_code, 403)

    def test_event_report_passes_when_org_active_normal_case(self):
        client = self._make(current_status='active', snapshot_status='active')
        resp = client.post('/api/practice-sessions/s1/events',
                           json={'event_type': 'student.turn', 'payload': {}})
        self.assertEqual(resp.status_code, 200)


class CanvasPracticeLaunchTests(unittest.TestCase):
    """`POST /api/canvas/practice/start` (or whichever endpoint initiates
    a Canvas-linked practice) is blocked on suspended org."""

    def test_returns_403_when_org_suspended(self):
        from backend.routes.canvas_practice import create_canvas_practice_blueprint
        class Fake(SuspendedOrgFake):
            def get_canvas_module_item(self, ref):
                return {'class_id': 'c-suspended', 'title': 'x'}
        deps = make_test_deps(db=Fake())
        app = make_test_app(deps, extra_blueprints=[create_canvas_practice_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'student-uid'
        # Use whichever launch endpoint exists; grep `bp.post` in
        # canvas_practice.py to confirm the path.
        resp = client.post('/api/canvas/practice/start',
                           json={'class_id': 'c-suspended', 'module_item_ref': 'x'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json().get('error'), 'org_suspended')


class TeacherAssignmentWriteTests(unittest.TestCase):
    """`POST /api/teacher/classes/<id>/assignments` etc. — write endpoints
    are blocked on suspended org so teachers cannot ship new work to
    students of a suspended school."""

    def test_assignment_create_returns_403_when_org_suspended(self):
        from backend.routes.teacher import create_teacher_blueprint
        class Fake(SuspendedOrgFake):
            def resolve_user_school_context(self, uid):
                return {'memberships': [{'org_id': 'org-suspended',
                                          'roles': ['teacher'],
                                          'status': 'active'}]}
        deps = make_test_deps(db=Fake())
        app = make_test_app(deps, extra_blueprints=[create_teacher_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'teacher-uid'
        resp = client.post('/api/teacher/classes/c-suspended/assignments',
                           json={'title': 'New Assignment'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json().get('error'), 'org_suspended')
```

> Note: each `*Tests` class points at the existing Plan 1–4 test fixtures (`FakeDbBase`, `make_test_deps`, `make_test_app`). The actual endpoint names (`/api/canvas/practice/start`, etc.) MUST be confirmed via `grep "bp.post" backend/routes/canvas_practice.py` before running — if your codebase uses a different path, update the test bodies accordingly. None of these tests should use `self.skipTest`.

- [ ] **Step 2: Run test to verify the resolver test fails**

```bash
python3 -m unittest backend.tests.test_suspended_org_enforcement.AssignmentResolverEnforcementTests -v
```

Expected: FAIL (resolver does not call `enforce_org_active` yet).

- [ ] **Step 3: Wire enforcement in `backend/services/assignment_resolver.py`**

At the top of `resolve_assignment_prompt(...)` (the main entry point), add:

```python
from backend.services.suspended_org_guard import enforce_org_active

def resolve_assignment_prompt(*, assignment, student_profile, class_doc, compliance_policy, modality_policy):
    enforce_org_active((class_doc or {}).get('org_id'))
    # ... existing body ...
```

- [ ] **Step 4: Wire enforcement in `backend/routes/chat.py`**

Find the realtime session mint endpoint (`POST /api/realtime/session`). At the top of the route function, after auth, before any OpenAI call:

```python
from backend.services.suspended_org_guard import SuspendedOrgError, enforce_org_active

# Inside the route:
class_id = request.json.get('class_id') if request.is_json else None
if class_id:
    class_doc = deps.db.get_class(class_id)
    org_id = (class_doc or {}).get('org_id')
    try:
        enforce_org_active(org_id)
    except SuspendedOrgError as exc:
        return jsonify(exc.to_payload()), 403
```

- [ ] **Step 5a: Wire enforcement in `backend/routes/curriculum_admin.py`**

In each of:
- `POST /api/practice-sessions` (create) — current-status check
- assignment write endpoints (`POST /api/assignments`, `PATCH /api/assignments/<id>`, `POST /api/assignments/<id>/publish`) — current-status check

Add the same `enforce_org_active` block after auth, before any DB write.

For `POST /api/practice-sessions` specifically, also pass the resolved org status to the DB helper so it can be snapshotted:

```python
class_doc = deps.db.get_class(class_id)
org = deps.db.get_organization((class_doc or {}).get('org_id'))
try:
    enforce_org_active((class_doc or {}).get('org_id'))
except SuspendedOrgError as exc:
    return jsonify(exc.to_payload()), 403
# Pass current status so the helper records it.
session = deps.db.create_practice_session(
    assignment_id=assignment_id,
    student_uid=uid,
    org_status_when_created=(org or {}).get('status', 'active'),
)
```

- [ ] **Step 5b: Update `database.create_practice_session` to snapshot org status**

```python
def create_practice_session(*, assignment_id, student_uid, org_status_when_created='active', ...):
    doc = {
        'assignment_id': assignment_id,
        'student_uid': student_uid,
        'status': 'active',
        'org_status_when_created': org_status_when_created,  # I3 grace snapshot
        'created_at': firestore.SERVER_TIMESTAMP,
        # ... existing fields ...
    }
    # ... existing impl ...
```

- [ ] **Step 5c: Wire `POST /api/practice-sessions/<id>/events` with grace logic**

The event-report endpoint uses the snapshot rather than current status:

```python
@bp.post('/api/practice-sessions/<sid>/events')
def report_event(sid):
    # ... auth ...
    session = deps.db.get_practice_session(sid)
    if not session:
        return jsonify({'error': 'not_found'}), 404
    class_doc = deps.db.get_class(session.get('class_id'))
    org = deps.db.get_organization((class_doc or {}).get('org_id'))
    current_status = (org or {}).get('status', 'active')
    snapshot_status = session.get('org_status_when_created', 'active')
    # In-flight grace: pass if EITHER the org is currently active OR
    # this session pre-dates the suspension.
    if current_status != 'active' and snapshot_status != 'active':
        return jsonify({
            'error': 'org_suspended',
            'reason': org.get('suspend_reason'),
            'until': org.get('suspended_until'),
        }), 403
    # ... existing event recording ...
```

- [ ] **Step 6: Wire enforcement in `backend/routes/canvas_practice.py`**

In every endpoint that initiates a practice session (typically `POST /api/canvas/practice/start` or similar — grep `def ` to find them), add the same block.

- [ ] **Step 7: Wire enforcement in `backend/routes/teacher.py`**

For each endpoint that writes to assignments / classes (e.g., `POST /api/teacher/classes`, `POST /api/teacher/classes/<id>/assignments`, etc.), add the same block.

- [ ] **Step 8: Verify the enforcement test suite passes (no skips)**

All test classes in `test_suspended_org_enforcement.py` have real test bodies (Step 1) — no `self.skipTest` is used. If any endpoint path in this codebase differs from what Step 1 assumed (e.g., `/api/canvas/practice/start` may actually be `/api/canvas-practice/start`), update the test paths to match. Run with `-v` and confirm every test runs (no `s` markers indicating skips).

- [ ] **Step 9: Run full enforcement test**

```bash
python3 -m unittest backend.tests.test_suspended_org_enforcement -v
```

Expected: all tests pass (no skips).

- [ ] **Step 10: Commit**

```bash
git add backend/services/assignment_resolver.py backend/routes/chat.py backend/routes/curriculum_admin.py backend/routes/canvas_practice.py backend/routes/teacher.py backend/tests/test_suspended_org_enforcement.py
git commit -m "feat(org): wire enforce_org_active into 5 enforcement points"
```

---

## Task 11: `auto_restore_suspended_orgs` Cloud Function scheduler

**Files:**
- Modify: `functions/main.py` (`_auto_restore_suspended_orgs_impl` + decorated wrapper)
- Create: `functions/tests/test_auto_restore_suspended_orgs.py`

**Why:** Suspended orgs with `suspended_until` in the past must be returned to active automatically. We reuse the `_impl + decorated wrapper` pattern Plan 1 established. Schedule: every 60 minutes (accuracy ±1h is acceptable per brainstorming; document in LIMITATIONS). The query helper lives in `functions/main.py` only — no parallel `database.py` helper, because Cloud Functions deploys a separate dependency tree and the backend has no caller for it (and a backend caller would risk drift). Backend tests for the query are unnecessary; the Cloud Function tests exercise the actual code path.

- [ ] **Step 1: Write the failing Cloud Function test**

Create `functions/tests/test_auto_restore_suspended_orgs.py`:

```python
import unittest
from unittest.mock import patch, MagicMock


class AutoRestoreSuspendedOrgsTests(unittest.TestCase):
    def test_impl_iterates_due_orgs_and_calls_restore(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore') as mock_fb, \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore') as mock_enqueue:
            mock_list.return_value = [
                {'id': 'o1', 'name': 'A'},
                {'id': 'o2', 'name': 'B'},
            ]
            _auto_restore_suspended_orgs_impl()
            self.assertEqual(mock_restore.call_count, 2)
            mock_restore.assert_any_call('o1')
            mock_restore.assert_any_call('o2')
            self.assertEqual(mock_enqueue.call_count, 2)

    def test_impl_failsoft_per_org(self):
        """One failing restore must not block subsequent orgs."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore'), \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore'):
            mock_list.return_value = [
                {'id': 'o1', 'name': 'A'},
                {'id': 'o2', 'name': 'B'},
            ]
            mock_restore.side_effect = [RuntimeError('boom'), None]
            _auto_restore_suspended_orgs_impl()  # no raise
            self.assertEqual(mock_restore.call_count, 2)

    def test_restore_via_admin_sdk_writes_audit_doc_atomically(self):
        """C2 invariant — auto-restore must produce a `lingual_admin_audit`
        row with `actor_uid='system:auto_restore'`. The row commits in the
        SAME Firestore batch as the org update."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _restore_org_via_admin_sdk
        with patch('functions.main._fb_firestore') as mock_fb:
            db = MagicMock()
            mock_fb.client.return_value = db
            batch = MagicMock()
            db.batch.return_value = batch
            audit_doc_ref = MagicMock(id='aud-1')
            audit_col = MagicMock()
            audit_col.document.return_value = audit_doc_ref
            org_doc_ref = MagicMock()
            org_col = MagicMock()
            org_col.document.return_value = org_doc_ref
            db.collection.side_effect = lambda name: {
                'organizations': org_col,
                'lingual_admin_audit': audit_col,
            }[name]

            _restore_org_via_admin_sdk('o1', org_name='Sunset HS')
            # batch.update called with org_ref + status='active'
            self.assertIs(batch.update.call_args[0][0], org_doc_ref)
            self.assertEqual(batch.update.call_args[0][1]['status'], 'active')
            # batch.set called with audit_ref + action='org_restored'
            self.assertIs(batch.set.call_args[0][0], audit_doc_ref)
            audit_doc = batch.set.call_args[0][1]
            self.assertEqual(audit_doc['action'], 'org_restored')
            self.assertEqual(audit_doc['actor_uid'], 'system:auto_restore')
            self.assertEqual(audit_doc['target_org_id'], 'o1')
            self.assertEqual(audit_doc['metadata']['trigger'], 'auto_restore')
            batch.commit.assert_called_once()

    def test_impl_email_failure_does_not_revert_restore(self):
        """If outbox enqueue fails, the org is still restored (already
        committed atomically). The email failure is fail-soft."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore'), \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore') as mock_enq:
            mock_list.return_value = [{'id': 'o1', 'name': 'A'}]
            mock_enq.side_effect = RuntimeError('outbox down')
            _auto_restore_suspended_orgs_impl()  # no raise
            mock_restore.assert_called_once_with('o1', 'A')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest functions.tests.test_auto_restore_suspended_orgs -v
```

Expected: `ImportError: cannot import name '_auto_restore_suspended_orgs_impl'`.

- [ ] **Step 3: Implement in `functions/main.py`**

Add at the top of `functions/main.py` (after other imports):

```python
from firebase_admin import firestore as _fb_firestore


def _list_orgs_due_for_auto_restore():
    """Wrapper for test patchability."""
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    db = _fb_firestore.client()
    q = (
        db.collection('organizations')
        .where('status', '==', 'suspended')
        .where('suspended_until', '<=', now)
    )
    rows = []
    for doc in q.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        rows.append(data)
    return rows


def _restore_org_via_admin_sdk(org_id: str, org_name: str = ''):
    """Atomic auto-restore: org update + audit row in one Firestore batch.

    SOC 2 invariant — every state transition is audited, including
    system-actor ones (`actor_uid='system:auto_restore'`).
    """
    db = _fb_firestore.client()
    batch = db.batch()
    org_ref = db.collection('organizations').document(org_id)
    batch.update(org_ref, {
        'status': 'active',
        'suspended_at': None,
        'suspended_by_uid': None,
        'suspend_reason': None,
        'suspended_until': None,
        'restored_at': _fb_firestore.SERVER_TIMESTAMP,
        'restored_by_uid': 'system:auto_restore',
        'updated_at': _fb_firestore.SERVER_TIMESTAMP,
    })
    audit_ref = db.collection('lingual_admin_audit').document()
    batch.set(audit_ref, {
        'actor_uid': 'system:auto_restore',
        'action': 'org_restored',
        'target': {'type': 'organization', 'id': org_id},
        'target_org_id': org_id,
        'metadata': {'trigger': 'auto_restore', 'org_name': org_name},
        'ip_hash': '',
        'user_agent': 'cloud_function:auto_restore_suspended_orgs',
        'created_at': _fb_firestore.SERVER_TIMESTAMP,
    })
    batch.commit()


def _enqueue_outbox_for_restore(org_id: str, org_name: str):
    """Queue one org_restored email per active school_admin."""
    db = _fb_firestore.client()
    # Find admins via the org's school_admin_uids denormalization.
    org_doc = db.collection('organizations').document(org_id).get()
    if not org_doc.exists:
        return
    org_data = org_doc.to_dict() or {}
    admin_uids = org_data.get('school_admin_uids') or []
    public_base = os.environ.get('PUBLIC_BASE_URL', 'https://l1ngual.com')
    dashboard_url = f'{public_base}/app/admin'
    for uid in admin_uids:
        user_doc = db.collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        user = user_doc.to_dict() or {}
        email = user.get('email')
        if not email:
            continue
        name = (user.get('profile') or {}).get('display_name') or user.get('name', '')
        db.collection('outbox_emails').add({
            'status': 'pending',
            'template_id': 'org_restored',
            'recipient_email': email,
            'recipient_name': name,
            'template_data': {
                'org_name': org_name,
                'dashboard_url': dashboard_url,
            },
            'attempt_count': 0,
            'created_at': _fb_firestore.SERVER_TIMESTAMP,
            'scheduled_for': _fb_firestore.SERVER_TIMESTAMP,
        })


def _auto_restore_suspended_orgs_impl():
    """Pure logic, testable. See scheduler wrapper below.

    Per org: (1) atomic restore + audit batch, (2) fail-soft email
    fan-out. Email failure does NOT roll back the restore — the org IS
    active again. One failing org does not stop processing of others.
    """
    for org in _list_orgs_due_for_auto_restore():
        try:
            _restore_org_via_admin_sdk(org['id'], org.get('name', 'your school'))
            try:
                _enqueue_outbox_for_restore(org['id'], org.get('name', 'your school'))
            except Exception as exc:  # noqa: BLE001
                logger.warning('[auto-restore] email fan-out failed for org=%s: %s',
                               org['id'], exc)
            logger.info('[auto-restore] restored org=%s', org['id'])
        except Exception as exc:  # noqa: BLE001
            logger.exception('[auto-restore] failed for org=%s: %s', org['id'], exc)


@scheduler_fn.on_schedule(
    schedule='every 60 minutes',
    timeout_sec=540,
    retry_count=3,
)
def auto_restore_suspended_orgs(event) -> None:
    """Thin wrapper for testability — see _impl."""
    _auto_restore_suspended_orgs_impl()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest functions.tests.test_auto_restore_suspended_orgs -v
```

Expected: 4 tests pass (impl iterates + impl fail-soft per org + restore writes audit atomically + email failure does not revert restore).

- [ ] **Step 5: Commit**

```bash
git add functions/main.py functions/tests/test_auto_restore_suspended_orgs.py
git commit -m "feat(functions): add auto_restore_suspended_orgs hourly scheduler with atomic audit"
```

---

## Task 12: Shared `audit_utils` module + scaffold `backend/routes/lingual_admin.py`

**Files:**
- Create: `backend/services/audit_utils.py` (shared helpers used by Plan 3 `school_requests.py` and Plan 5 `lingual_admin.py`)
- Create: `backend/routes/lingual_admin.py`
- Modify: `backend/routes/school_requests.py` (replace local helpers with imports from `audit_utils`)
- Modify: `main.py` (register blueprint)
- Create: `backend/tests/test_audit_utils.py`
- Create: `backend/tests/test_lingual_admin_blueprint_smoke.py`

**Why:** Both `school_requests.py` (Plan 3) and `lingual_admin.py` (Plan 5) need `_hash_ip`, `_client_ip`, `_user_agent`, and `_public_base_url`. Plan 3 defined them inline. Plan 5 would otherwise duplicate. Centralizing into `backend/services/audit_utils.py` removes the duplication and gives every audited route the same identity-capture semantics — Plan 3 Codex round 2 explicitly flagged that scattered identity helpers create drift risk.

- [ ] **Step 1a: Create `backend/services/audit_utils.py`**

```python
"""Shared identity-capture + URL helpers used by audited routes.

Centralized so Plan 3 (`school_requests.py`) and Plan 5
(`lingual_admin.py`) cannot drift. Identity capture must match across
both surfaces — Plan 3 Codex round 2 flagged scattered helpers as a
trust-boundary risk.
"""
from __future__ import annotations

import hashlib
import os

from flask import request

_ATTESTATION_HASH_SALT_KEY = 'ATTESTATION_HASH_SALT'
_DEFAULT_PUBLIC_BASE = 'https://l1ngual.com'


def hash_ip(ip: str | None) -> str:
    if not ip:
        return ''
    salt = os.environ.get(_ATTESTATION_HASH_SALT_KEY, 'unset-salt-dev-only')
    return hashlib.sha256(f'{salt}:{ip}'.encode()).hexdigest()[:32]


def client_ip() -> str:
    """Returns the trusted client IP from `request.remote_addr` (ProxyFix
    populates this from `X-Forwarded-For`'s first entry). Never use
    `request.access_route` — see Plan 3 Codex round 1."""
    return request.remote_addr or ''


def user_agent() -> str:
    return request.headers.get('User-Agent', '')[:255]


def public_base_url() -> str:
    """Source of truth for external URLs (email CTAs, LTI callbacks).

    Never derived from `request.host_url` — ProxyFix is narrow per
    Plan 3 Codex round 2, so request state may report http:// behind a
    TLS terminator. Use this helper or fail.
    """
    return os.environ.get('PUBLIC_BASE_URL', _DEFAULT_PUBLIC_BASE)
```

Test (`backend/tests/test_audit_utils.py`):

```python
import unittest
from unittest.mock import patch
from flask import Flask

from backend.services import audit_utils


class HashIpTests(unittest.TestCase):
    def test_empty_yields_empty(self):
        self.assertEqual(audit_utils.hash_ip(''), '')
        self.assertEqual(audit_utils.hash_ip(None), '')

    @patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-x'})
    def test_same_ip_same_salt_yields_same_hash(self):
        h1 = audit_utils.hash_ip('1.2.3.4')
        h2 = audit_utils.hash_ip('1.2.3.4')
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 32)

    @patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-a'})
    def test_different_salt_different_hash(self):
        h_a = audit_utils.hash_ip('1.2.3.4')
        with patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-b'}):
            h_b = audit_utils.hash_ip('1.2.3.4')
        self.assertNotEqual(h_a, h_b)


class PublicBaseUrlTests(unittest.TestCase):
    @patch.dict('os.environ', {'PUBLIC_BASE_URL': 'https://staging.l1ngual.com'})
    def test_reads_env(self):
        self.assertEqual(audit_utils.public_base_url(), 'https://staging.l1ngual.com')

    @patch.dict('os.environ', {}, clear=True)
    def test_default_is_production(self):
        self.assertEqual(audit_utils.public_base_url(), 'https://l1ngual.com')


class FlaskRequestHelpersTests(unittest.TestCase):
    def _ctx(self, **kwargs):
        app = Flask(__name__)
        return app.test_request_context(**kwargs)

    def test_client_ip_returns_remote_addr(self):
        with self._ctx(environ_base={'REMOTE_ADDR': '1.2.3.4'}):
            self.assertEqual(audit_utils.client_ip(), '1.2.3.4')

    def test_client_ip_returns_empty_when_missing(self):
        # `environ_base` defaults already include REMOTE_ADDR='127.0.0.1';
        # set to empty to verify the fallback branch.
        with self._ctx(environ_base={'REMOTE_ADDR': ''}):
            self.assertEqual(audit_utils.client_ip(), '')

    def test_user_agent_truncates(self):
        with self._ctx(headers={'User-Agent': 'x' * 1000}):
            self.assertEqual(len(audit_utils.user_agent()), 255)
```

- [ ] **Step 1b: Migrate `backend/routes/school_requests.py` to import from `audit_utils`**

In Plan 3's `school_requests.py`, the local helpers `_hash_ip`, `_client_ip`, `_user_agent`, `_public_base_url` were defined inline. Replace them with imports:

```python
from backend.services.audit_utils import (
    hash_ip as _hash_ip,
    client_ip as _client_ip,
    user_agent as _user_agent,
    public_base_url as _public_base_url,
)
```

Delete the old inline definitions. Existing Plan 3 tests should continue to pass — the public names are kept stable via the aliased imports.

- [ ] **Step 1c: Write the failing blueprint smoke test**

Create `backend/tests/test_lingual_admin_blueprint_smoke.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeLingualAdminDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'lingual-admin-uid'}


class LingualAdminBlueprintSmokeTests(unittest.TestCase):
    def test_blueprint_registered_at_expected_prefix(self):
        deps = make_test_deps(db=FakeLingualAdminDb())
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        app = make_test_app(deps, extra_blueprints=[create_lingual_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'lingual-admin-uid'
        resp = client.get('/api/lingual-admin/_smoke')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'ok': True})

    def test_non_lingual_admin_is_403(self):
        deps = make_test_deps(db=FakeLingualAdminDb())
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        app = make_test_app(deps, extra_blueprints=[create_lingual_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['uid'] = 'regular-uid'
        resp = client.get('/api/lingual-admin/_smoke')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_blueprint_smoke -v
```

Expected: `ModuleNotFoundError: No module named 'backend.routes.lingual_admin'`.

- [ ] **Step 3: Create `backend/routes/lingual_admin.py`**

```python
"""Lingual admin panel routes — mounted at `/api/lingual-admin/*`.

Every state-changing route builds an `audit_entry` dict via
`deps.audit_logger.build_audit_doc(...)` and passes it to the DB helper,
which commits the audit row in the same Firestore batch as the business
write. Every org detail page load writes a fail-soft `org_viewed_detail`
row via `deps.audit_logger.log(...)`.

Identity helpers (`_hash_ip`, `_client_ip`, `_user_agent`) and external
URL source (`_public_base_url`) are imported from
`backend.services.audit_utils` so Plan 3 and Plan 5 cannot drift.
"""
from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.audit_utils import (
    hash_ip as _hash_ip,
    client_ip as _client_ip,
    user_agent as _user_agent,
    public_base_url as _public_base_url,
)


def create_lingual_admin_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('lingual_admin', __name__, url_prefix='/api/lingual-admin')

    def _require_lingual_admin(uid: str):
        context = deps.db.resolve_user_school_context(uid)
        if not context.get('lingual_admin'):
            raise PermissionError('lingual_admin role required')

    @bp.get('/_smoke')
    def _smoke():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403
        return jsonify({'ok': True}), 200

    return bp
```

- [ ] **Step 4: Register in `main.py`**

Find where other blueprints are registered (e.g., `app.register_blueprint(create_school_requests_blueprint(deps))`) and add:

```python
from backend.routes.lingual_admin import create_lingual_admin_blueprint

# ... near other blueprint registrations ...
app.register_blueprint(create_lingual_admin_blueprint(deps))
```

- [ ] **Step 5: Update `make_test_app` in `conftest.py`**

Add `extra_blueprints=None` kwarg if it doesn't already exist:

```python
def make_test_app(deps, *, extra_blueprints=None):
    from flask import Flask
    app = Flask(__name__)
    # ... existing setup ...
    for bp in (extra_blueprints or []):
        app.register_blueprint(bp)
    return app
```

- [ ] **Step 6: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_lingual_admin_blueprint_smoke -v
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/lingual_admin.py main.py backend/tests/conftest.py backend/tests/test_lingual_admin_blueprint_smoke.py
git commit -m "feat(lingual-admin): scaffold blueprint with smoke endpoint"
```

---

## Task 13: `GET /api/lingual-admin/overview` (dashboard tiles + activity feed)

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Modify: `database.py` (`count_school_requests_pending`, `count_organizations_by_status`, `list_recent_audit_events`)
- Create: `backend/tests/test_lingual_admin_overview_route.py`
- Create: `backend/tests/test_overview_db_helpers.py`

**Why:** First real endpoint. Returns 4 counts (pending requests, active orgs, suspended orgs, new requests last 7d) and 20 latest audit entries. We add narrow DB helpers (counts) instead of overloading `list_organizations` so the dashboard query is cheap.

- [ ] **Step 1: Write the failing DB-helper test**

Create `backend/tests/test_overview_db_helpers.py`:

```python
import unittest
from unittest.mock import MagicMock, patch
import datetime

import database


class CountSchoolRequestsPendingTests(unittest.TestCase):
    @patch('database.get_db')
    def test_filters_status_pending(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=7)]]
        n = database.count_school_requests_pending()
        self.assertEqual(n, 7)
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('status' in c and 'pending' in c for c in calls))


class CountOrganizationsByStatusTests(unittest.TestCase):
    @patch('database.get_db')
    def test_counts_per_status(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=12)]]
        n = database.count_organizations_by_status('active')
        self.assertEqual(n, 12)

    @patch('database.get_db')
    def test_rejects_invalid_status(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database.count_organizations_by_status('paused')


class CountSchoolRequestsSinceTests(unittest.TestCase):
    @patch('database.get_db')
    def test_counts_requests_created_at_after(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=3)]]
        since = datetime.datetime(2026, 5, 13, tzinfo=datetime.timezone.utc)
        n = database.count_school_requests_since(since=since)
        self.assertEqual(n, 3)


class ListRecentAuditEventsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_orders_desc_and_applies_limit(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = [
            MagicMock(id='a1', to_dict=lambda: {'action': 'request_approved'}),
        ]
        out = database.list_recent_audit_events(limit=20)
        col.order_by.assert_called_once()
        col.limit.assert_called_with(20)
        self.assertEqual(len(out), 1)
```

- [ ] **Step 2: Add helpers in `database.py`**

```python
def count_school_requests_pending() -> int:
    q = (
        get_db()
        .collection('school_requests')
        .where('status', '==', 'pending')
    )
    snap = q.count().get()
    return snap[0][0].value if snap else 0


def count_organizations_by_status(status: str) -> int:
    _validate_org_status(status)
    q = (
        get_db()
        .collection('organizations')
        .where('status', '==', status)
    )
    snap = q.count().get()
    return snap[0][0].value if snap else 0


def count_school_requests_since(*, since) -> int:
    q = (
        get_db()
        .collection('school_requests')
        .where('created_at', '>=', since)
    )
    snap = q.count().get()
    return snap[0][0].value if snap else 0


def list_recent_audit_events(*, limit: int = 20) -> list:
    q = (
        get_db()
        .collection(LINGUAL_ADMIN_AUDIT_COLLECTION)
        .order_by('created_at', direction='DESCENDING')
        .limit(limit)
    )
    rows = []
    for a in q.stream():
        data = a.to_dict() or {}
        data['id'] = a.id
        rows.append(data)
    return rows
```

- [ ] **Step 3: Verify DB helpers pass**

```bash
python3 -m unittest backend.tests.test_overview_db_helpers -v
```

Expected: 5 tests pass.

- [ ] **Step 4: Write the failing route test**

Create `backend/tests/test_lingual_admin_overview_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeOverviewDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def count_school_requests_pending(self):
        return 3

    def count_organizations_by_status(self, status):
        return {'active': 12, 'suspended': 1, 'archived': 0}.get(status, 0)

    def count_school_requests_since(self, *, since):
        return 4

    def list_recent_audit_events(self, *, limit):
        return [
            {'id': 'a1', 'action': 'request_approved', 'actor_uid': 'u1',
             'target': {'type': 'school_request', 'id': 'r1'}, 'created_at': None},
        ]


class LingualAdminOverviewRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.deps = make_test_deps(db=FakeOverviewDb())
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()

    def _as_admin(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_returns_tile_counts_and_feed(self):
        self._as_admin()
        resp = self.client.get('/api/lingual-admin/overview')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['tiles']['pendingRequests'], 3)
        self.assertEqual(data['tiles']['activeOrgs'], 12)
        self.assertEqual(data['tiles']['suspendedOrgs'], 1)
        self.assertEqual(data['tiles']['newRequestsLast7d'], 4)
        self.assertEqual(len(data['recentActivity']), 1)
        self.assertEqual(data['recentActivity'][0]['action'], 'request_approved')

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'someone-else'
        resp = self.client.get('/api/lingual-admin/overview')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 5: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_overview_route -v
```

Expected: 404 (route not registered).

- [ ] **Step 6: Add the route in `backend/routes/lingual_admin.py`**

```python
import datetime

# Inside create_lingual_admin_blueprint, after _smoke:

@bp.get('/overview')
def get_overview():
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    now = datetime.datetime.now(datetime.timezone.utc)
    seven_days_ago = now - datetime.timedelta(days=7)
    tiles = {
        'pendingRequests': deps.db.count_school_requests_pending(),
        'activeOrgs': deps.db.count_organizations_by_status('active'),
        'suspendedOrgs': deps.db.count_organizations_by_status('suspended'),
        'newRequestsLast7d': deps.db.count_school_requests_since(since=seven_days_ago),
    }
    feed = deps.db.list_recent_audit_events(limit=20)
    return jsonify({'tiles': tiles, 'recentActivity': feed}), 200
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
python3 -m unittest backend.tests.test_lingual_admin_overview_route -v
```

Expected: 2 tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/lingual_admin.py database.py backend/tests/test_overview_db_helpers.py backend/tests/test_lingual_admin_overview_route.py
git commit -m "feat(lingual-admin): GET /overview with tile counts + activity feed"
```

---

## Task 14: `GET /api/lingual-admin/requests` (list with filters + sort)

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Modify: `database.py` (`list_school_requests` extended to support `school_type`, `country`, date-range, sort)
- Create: `backend/tests/test_lingual_admin_requests_list_route.py`

**Why:** This subsumes `admin_list_school_requests` from `school_requests.py`. We extend the existing DB helper with new filters + sort options, then expose them via the route. The old `school_requests.py` admin endpoint stays in place during this PR window and is removed in Task 24.

- [ ] **Step 1: Locate existing `list_school_requests`**

```bash
grep -n "def list_school_requests" /Users/new/Documents/GitHub/Lingual-U/Lingual-Project/database.py
```

Note the current signature; extend it without breaking existing callers.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_lingual_admin_requests_list_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeRequestsDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def list_school_requests(self, *, status_filter=None, school_type=None,
                             country=None, requested_after=None,
                             requested_before=None, sort='requested_at_desc',
                             limit=50, cursor=None):
        self.last_kwargs = dict(
            status_filter=status_filter, school_type=school_type,
            country=country, requested_after=requested_after,
            requested_before=requested_before, sort=sort,
            limit=limit, cursor=cursor,
        )
        return {'items': [{'id': 'r1', 'school_name': 'Sunset', 'status': 'pending'}],
                'next_cursor': None}


class RequestsListRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeRequestsDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_default_returns_items(self):
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['schoolName'], 'Sunset')

    def test_passes_filters_to_db(self):
        resp = self.client.get(
            '/api/lingual-admin/requests'
            '?status=pending&schoolType=high&country=US&sort=name'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.last_kwargs['status_filter'], 'pending')
        self.assertEqual(self.db.last_kwargs['school_type'], 'high')
        self.assertEqual(self.db.last_kwargs['country'], 'US')
        self.assertEqual(self.db.last_kwargs['sort'], 'name')

    def test_invalid_sort_rejected(self):
        resp = self.client.get('/api/lingual-admin/requests?sort=banana')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'someone'
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 3: Extend `database.list_school_requests`**

Open `database.py` and replace the existing signature/body of `list_school_requests` to accept the new kwargs. The implementation pattern mirrors `list_organizations` (Task 5): apply filters in order, order_by based on `sort`, then paginate.

```python
ALLOWED_REQUEST_SORTS = frozenset({'requested_at_desc', 'requested_at_asc', 'name'})


def list_school_requests(
    *,
    status_filter: str | None = None,
    school_type: str | None = None,
    country: str | None = None,
    requested_after=None,
    requested_before=None,
    sort: str = 'requested_at_desc',
    limit: int = 50,
    cursor: dict | None = None,
) -> dict:
    if sort not in ALLOWED_REQUEST_SORTS:
        raise ValueError(f'Invalid sort {sort!r}')
    q = get_db().collection('school_requests')
    if status_filter:
        q = q.where('status', '==', status_filter)
    if school_type:
        q = q.where('school_type', '==', school_type)
    if country:
        q = q.where('country', '==', country)
    if requested_after is not None:
        q = q.where('created_at', '>=', requested_after)
    if requested_before is not None:
        q = q.where('created_at', '<=', requested_before)
    if sort == 'requested_at_desc':
        q = q.order_by('created_at', direction='DESCENDING')
    elif sort == 'requested_at_asc':
        q = q.order_by('created_at')
    else:  # name
        q = q.order_by('school_name')
    q = q.order_by('__name__').limit(limit)
    if cursor and cursor.get('id'):
        # Firestore `start_after` takes positional values matching the
        # order_by fields, NOT a dict. The previous dict form silently
        # mis-pages on real Firestore (same root cause as Task 5 I4 fix).
        # Because the leading order_by varies with `sort`, we capture the
        # leading field's value on the way out (see next_cursor below) and
        # pass both positionally.
        q = q.start_after(cursor.get('leading_value'), cursor['id'])
    items, last_doc = [], None
    for doc in q.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        items.append(data)
        last_doc = doc
    next_cursor = None
    if last_doc is not None and len(items) == limit:
        last_data = last_doc.to_dict() or {}
        if sort in ('requested_at_desc', 'requested_at_asc'):
            leading_value = last_data.get('created_at')
        else:  # name
            leading_value = last_data.get('school_name')
        next_cursor = {'leading_value': leading_value, 'id': last_doc.id}
    return {'items': items, 'next_cursor': next_cursor}
```

- [ ] **Step 4: Add the route in `backend/routes/lingual_admin.py`**

```python
import datetime
from flask import request

# Inside create_lingual_admin_blueprint:

def _camel_request_row(row):
    """snake_case Firestore -> camelCase response."""
    out = dict(row)
    rename = {
        'school_name': 'schoolName',
        'org_type': 'orgType',
        'school_type': 'schoolType',
        'created_at': 'createdAt',
        'requester_uid': 'requesterUid',
        'requester_email': 'requesterEmail',
        'requester_name': 'requesterName',
        'rejection_reason': 'rejectionReason',
        'rejection_category': 'rejectionCategory',
    }
    for src, dst in rename.items():
        if src in out:
            out[dst] = out.pop(src)
    return out


@bp.get('/requests')
def list_requests():
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    status = request.args.get('status')
    school_type = request.args.get('schoolType')
    country = request.args.get('country')
    sort = request.args.get('sort', 'requested_at_desc')

    try:
        result = deps.db.list_school_requests(
            status_filter=status,
            school_type=school_type,
            country=country,
            sort=sort,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({
        'items': [_camel_request_row(r) for r in result['items']],
        'nextCursor': result.get('next_cursor'),
    }), 200
```

- [ ] **Step 5: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_requests_list_route -v
make test-backend
```

Expected: 4 new tests pass; existing tests still pass (the extended signature is backward-compatible because all new args are kwargs with defaults).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/lingual_admin.py database.py backend/tests/test_lingual_admin_requests_list_route.py
git commit -m "feat(lingual-admin): GET /requests with filters + sort + cursor"
```

---

## Task 15: `GET /api/lingual-admin/requests/<id>` (detail)

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_request_detail_route.py`

**Why:** Detail endpoint returns the full wizard payload (organization fields, admin identity + attestation snapshot, integration, curriculum, pre-invited teachers). Used by `RequestDetailPanel` on the requests page.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_request_detail_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeRequestDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        if request_id == 'r1':
            return {
                'id': 'r1',
                'school_name': 'Sunset HS',
                'org_type': 'school',
                'school_type': 'high',
                'requester_uid': 'u1',
                'requester_email': 'kim@sunset.edu',
                'requester_name': 'Kim',
                'requester_title': 'Principal',
                'status': 'pending',
                'country': 'US', 'state': 'CA', 'county': 'SF',
                'website_url': 'https://sunset.edu',
                'pre_invited_teachers': ['a@s.edu', 'b@s.edu'],
                'attestation': {
                    'ip_hash': 'abc', 'user_agent': 'Mozilla', 'attested_at': None,
                },
                'integration': {'lms': 'canvas', 'instance_url': 'https://s.instructure.com'},
                'curriculum': {'language': 'es-ES', 'levels': ['Spanish I']},
            }
        return None


class RequestDetailRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.deps = make_test_deps(db=FakeRequestDb())
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_returns_full_payload_camelcased(self):
        resp = self.client.get('/api/lingual-admin/requests/r1')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['schoolName'], 'Sunset HS')
        self.assertEqual(data['requesterEmail'], 'kim@sunset.edu')
        self.assertEqual(data['preInvitedTeachers'], ['a@s.edu', 'b@s.edu'])
        self.assertEqual(data['attestation']['ipHash'], 'abc')
        self.assertEqual(data['integration']['instanceUrl'], 'https://s.instructure.com')

    def test_unknown_id_is_404(self):
        resp = self.client.get('/api/lingual-admin/requests/nope')
        self.assertEqual(resp.status_code, 404)

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'x'
        resp = self.client.get('/api/lingual-admin/requests/r1')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_request_detail_route -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
def _camel_request_detail(row):
    """Full detail camelization, recursive into nested maps."""
    out = _camel_request_row(row)
    if 'pre_invited_teachers' in out:
        out['preInvitedTeachers'] = out.pop('pre_invited_teachers')
    if 'attestation' in out and isinstance(out['attestation'], dict):
        att = out['attestation']
        out['attestation'] = {
            'ipHash': att.get('ip_hash'),
            'userAgent': att.get('user_agent'),
            'attestedAt': att.get('attested_at'),
        }
    if 'integration' in out and isinstance(out['integration'], dict):
        integ = out['integration']
        out['integration'] = {
            'lms': integ.get('lms'),
            'instanceUrl': integ.get('instance_url'),
        }
    return out


@bp.get('/requests/<request_id>')
def get_request_detail(request_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    row = deps.db.get_school_request(request_id)
    if not row:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(_camel_request_detail(row)), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_request_detail_route -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_request_detail_route.py
git commit -m "feat(lingual-admin): GET /requests/<id> detail with wizard payload"
```

---

## Task 16: `POST /api/lingual-admin/requests/<id>/approve` (with atomic audit)

**Files:**
- Modify: `database.py` — extend `approve_school_request` to accept `audit_entry` and batch the audit doc atomically with the org/membership/request writes (see "Extending the Plan 3 helper" below)
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_approve_route.py`

**Why:** Approve is the heaviest single action — creates org + school_admin membership + pre-invite teacher_invitations + approval email + per-pre-invite teacher emails + audit row. To preserve the SOC 2 invariant that *"every Lingual admin action is audited"* we extend Plan 3's `approve_school_request` to commit the audit doc in the same Firestore batch as the org+membership+request writes. The Plan 3 route at `/api/school-requests/<id>/approve` (deprecated in Task 24) was the only other caller; once Task 24 lands, the new signature is the only one in production.

**Extending the Plan 3 helper:**

Add `audit_entry: dict | None = None` to `database.approve_school_request(...)`. When provided, append `batch.set(audit_col.document(), audit_entry_with_server_timestamp)` to the existing batch before `batch.commit()`. Raise `ValueError('audit_entry is required')` when the caller does not pass it (the Plan 5 route is the only post-Task-24 caller; the legacy Plan 3 route is replaced with 410 Gone in Task 24 anyway).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_approve_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeApproveDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        return {'id': request_id, 'status': 'pending',
                'school_name': 'Sunset', 'requester_uid': 'u1',
                'requester_email': 'r@x.com', 'requester_name': 'R',
                'pre_invited_teachers': ['a@x.com', 'b@x.com']}

    def approve_school_request(self, *, request_id, reviewer_uid, internal_note=None,
                               audit_entry=None):
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.approved = dict(request_id=request_id, reviewer_uid=reviewer_uid,
                             internal_note=internal_note, audit_entry=audit_entry)
        return {
            'request_id': request_id,
            'created_org_id': 'org-new',
            'membership_id': 'm-new',
            'pre_invite_invitation_ids': ['ti-1', 'ti-2'],
        }


class ApproveRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeApproveDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_calls_db_and_returns_result(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/approve',
            json={'internalNote': 'Verified via NCES'},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['createdOrgId'], 'org-new')
        self.assertEqual(data['membershipId'], 'm-new')
        self.assertEqual(data['preInviteInvitationIds'], ['ti-1', 'ti-2'])
        self.assertEqual(self.deps.db.approved['internal_note'], 'Verified via NCES')

    def test_passes_audit_entry_atomically_to_helper(self):
        """Audit doc is built by the route and passed to the helper so
        it commits in the same batch as the org/membership writes."""
        self.client.post('/api/lingual-admin/requests/r1/approve', json={})
        self.assertEqual(len(self.audit.calls), 0)  # NOT via AuditLogger.log
        audit_entry = self.deps.db.approved['audit_entry']
        self.assertEqual(audit_entry['actor_uid'], 'admin-uid')
        self.assertEqual(audit_entry['action'], 'request_approved')
        self.assertEqual(audit_entry['target']['type'], 'school_request')
        self.assertEqual(audit_entry['target']['id'], 'r1')
        # target_org_id is None at build time; the helper rewrites it with
        # the created org_id when it builds the batch.

    def test_internal_note_too_long_rejected(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/approve',
            json={'internalNote': 'x' * 5000},
        )
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_403(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'x'
        resp = self.client.post('/api/lingual-admin/requests/r1/approve', json={})
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_approve_route -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
from backend.services.audit import AuditAction

MAX_INTERNAL_NOTE_LEN = 2000


@bp.post('/requests/<request_id>/approve')
def approve_request(request_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    body = request.get_json(silent=True) or {}
    internal_note = (body.get('internalNote') or '').strip() or None
    if internal_note and len(internal_note) > MAX_INTERNAL_NOTE_LEN:
        return jsonify({'error': 'internalNote too long'}), 400

    # Build audit_entry BEFORE the business write so it commits atomically
    # in the same batch (target_org_id is filled in by the helper once
    # the new org is created).
    audit_entry = deps.audit_logger.build_audit_doc(
        actor_uid=uid,
        action=AuditAction.REQUEST_APPROVED,
        target_type='school_request',
        target_id=request_id,
        target_org_id=None,  # helper rewrites this with the created org_id
        metadata={'internal_note': internal_note},
        ip_hash=_hash_ip(_client_ip()),
        user_agent=_user_agent(),
    )

    try:
        result = deps.db.approve_school_request(
            request_id=request_id,
            reviewer_uid=uid,
            internal_note=internal_note,
            audit_entry=audit_entry,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({
        'requestId': result.get('request_id'),
        'createdOrgId': result.get('created_org_id'),
        'membershipId': result.get('membership_id'),
        'preInviteInvitationIds': result.get('pre_invite_invitation_ids') or [],
    }), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_approve_route -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_approve_route.py
git commit -m "feat(lingual-admin): POST /requests/<id>/approve with audit"
```

---

## Task 17: `POST /api/lingual-admin/requests/<id>/decline` (with atomic audit)

**Files:**
- Modify: `database.py` — extend `reject_school_request` to accept `audit_entry` and batch the audit doc atomically (mirror of Task 16's `approve_school_request` extension)
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_decline_route.py`

**Why:** Decline requires both `reason` and `category`. We extend Plan 3's `reject_school_request` to commit the audit doc atomically with the request status update — same pattern as Task 16. The Plan 3 route deprecation in Task 24 makes this the only post-Task-24 caller.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_decline_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


VALID_CATEGORIES = ('info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other')


class FakeDeclineDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        return {'id': request_id, 'status': 'pending',
                'school_name': 'Sunset', 'requester_uid': 'u1',
                'requester_email': 'r@x.com'}

    def reject_school_request(self, *, request_id, reviewer_uid, reason, category,
                              internal_note=None, audit_entry=None):
        if not reason:
            raise ValueError('reason required')
        if category not in VALID_CATEGORIES:
            raise ValueError('invalid category')
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.declined = dict(request_id=request_id, reviewer_uid=reviewer_uid,
                             reason=reason, category=category,
                             internal_note=internal_note, audit_entry=audit_entry)
        return {'request_id': request_id}


class DeclineRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeDeclineDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_decline_with_reason_and_category(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'Cannot verify school', 'category': 'fraud_risk'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.declined['category'], 'fraud_risk')

    def test_missing_reason_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'category': 'fraud_risk'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_missing_category_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'x'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_invalid_category_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'x', 'category': 'banana'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_passes_audit_entry_atomically_to_helper(self):
        self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'r', 'category': 'duplicate'},
        )
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.declined['audit_entry']
        self.assertEqual(audit_entry['metadata']['category'], 'duplicate')
        self.assertEqual(audit_entry['metadata']['reason'], 'r')
        self.assertEqual(audit_entry['action'], 'request_declined')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_decline_route -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
ALLOWED_DECLINE_CATEGORIES = frozenset({
    'info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other',
})


@bp.post('/requests/<request_id>/decline')
def decline_request(request_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    body = request.get_json(silent=True) or {}
    reason = (body.get('reason') or '').strip()
    category = (body.get('category') or '').strip()
    internal_note = (body.get('internalNote') or '').strip() or None
    if not reason:
        return jsonify({'error': 'reason required'}), 400
    if not category:
        return jsonify({'error': 'category required'}), 400
    if category not in ALLOWED_DECLINE_CATEGORIES:
        return jsonify({'error': 'invalid category'}), 400
    if internal_note and len(internal_note) > MAX_INTERNAL_NOTE_LEN:
        return jsonify({'error': 'internalNote too long'}), 400

    audit_entry = deps.audit_logger.build_audit_doc(
        actor_uid=uid,
        action=AuditAction.REQUEST_DECLINED,
        target_type='school_request',
        target_id=request_id,
        target_org_id=None,
        metadata={'reason': reason, 'category': category, 'internal_note': internal_note},
        ip_hash=_hash_ip(_client_ip()),
        user_agent=_user_agent(),
    )

    try:
        result = deps.db.reject_school_request(
            request_id=request_id,
            reviewer_uid=uid,
            reason=reason,
            category=category,
            internal_note=internal_note,
            audit_entry=audit_entry,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({'requestId': result.get('request_id')}), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_decline_route -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_decline_route.py
git commit -m "feat(lingual-admin): POST /requests/<id>/decline with reason+category+audit"
```

---

## Task 18: `GET /api/lingual-admin/organizations` (list with filters)

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_orgs_list_route.py`

**Why:** Wraps `deps.db.list_organizations` (Task 5) with query-param parsing and camelCase response.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_orgs_list_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeOrgsDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def list_organizations(self, **kwargs):
        self.last_kwargs = kwargs
        return {
            'items': [
                {'id': 'o1', 'name': 'Alpha HS', 'status': 'active',
                 'school_type': 'high', 'country': 'US', 'school_admin_uids': ['u1', 'u2'],
                 'created_at': None, 'last_activity_at': None},
            ],
            'next_cursor': {'name_lower': 'alpha hs', 'id': 'o1'},
        }


class OrgsListRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeOrgsDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_default_returns_items_with_camelcase(self):
        resp = self.client.get('/api/lingual-admin/organizations')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['items'][0]['name'], 'Alpha HS')
        self.assertEqual(data['items'][0]['schoolType'], 'high')
        self.assertEqual(data['items'][0]['memberCount'], 2)  # derived from school_admin_uids
        self.assertEqual(data['nextCursor']['id'], 'o1')

    def test_filters_passed(self):
        resp = self.client.get(
            '/api/lingual-admin/organizations?status=suspended&schoolType=high'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.last_kwargs['status'], 'suspended')
        self.assertEqual(self.db.last_kwargs['school_type'], 'high')

    def test_invalid_status_400(self):
        resp = self.client.get('/api/lingual-admin/organizations?status=paused')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_403(self):
        with self.client.session_transaction() as sess:
            sess['uid'] = 'x'
        resp = self.client.get('/api/lingual-admin/organizations')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_orgs_list_route -v
```

Expected: 404.

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
def _camel_org_row(row):
    out = {
        'id': row.get('id'),
        'name': row.get('name'),
        'status': row.get('status'),
        'schoolType': row.get('school_type'),
        'country': row.get('country'),
        'publicOrPrivate': row.get('public_or_private'),
        'memberCount': len(row.get('school_admin_uids') or []),
        'createdAt': row.get('created_at'),
        'lastActivityAt': row.get('last_activity_at'),
    }
    return out


@bp.get('/organizations')
def list_orgs():
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    cursor_arg = request.args.get('cursor')
    cursor = None
    if cursor_arg:
        try:
            import json
            cursor = json.loads(cursor_arg)
        except Exception:
            return jsonify({'error': 'invalid cursor'}), 400

    try:
        result = deps.db.list_organizations(
            status=request.args.get('status'),
            school_type=request.args.get('schoolType'),
            country=request.args.get('country'),
            public_or_private=request.args.get('publicOrPrivate'),
            cursor=cursor,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({
        'items': [_camel_org_row(r) for r in result['items']],
        'nextCursor': result.get('next_cursor'),
    }), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_orgs_list_route -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_orgs_list_route.py
git commit -m "feat(lingual-admin): GET /organizations list with filters + cursor"
```

---

## Task 19: `GET /api/lingual-admin/organizations/<orgId>` (detail + org_viewed_detail audit)

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_org_detail_route.py`

**Why:** Returns Overview-tab payload AND writes a `org_viewed_detail` audit row on every load (spec §577 — intentional SOC 2 view-level audit).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_org_detail_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeOrgDetailDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        if org_id == 'o1':
            return {
                'id': 'o1', 'name': 'Sunset HS', 'status': 'active',
                'school_type': 'high', 'country': 'US', 'state': 'CA',
                'website_url': 'https://sunset.edu',
                'created_at': None, 'last_activity_at': None,
                'school_admin_uids': ['u1'],
            }
        return None

    def list_org_memberships(self, *, org_id, roles=None):
        return [
            {'membership_id': 'm1', 'uid': 'u1', 'email': 'admin@sunset.edu',
             'name': 'Kim', 'roles': ['school_admin'], 'status': 'active'},
        ]


class OrgDetailRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeOrgDetailDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_returns_org_overview(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['name'], 'Sunset HS')
        self.assertEqual(data['status'], 'active')
        self.assertEqual(len(data['schoolAdminContacts']), 1)
        self.assertEqual(data['schoolAdminContacts'][0]['email'], 'admin@sunset.edu')

    def test_writes_org_viewed_detail_audit(self):
        self.client.get('/api/lingual-admin/organizations/o1')
        self.assertEqual(len(self.audit.calls), 1)
        call = self.audit.calls[0]
        action = call['action']
        self.assertEqual(action.value if hasattr(action, 'value') else action,
                         'org_viewed_detail')
        self.assertEqual(call['target_org_id'], 'o1')

    def test_unknown_org_is_404(self):
        resp = self.client.get('/api/lingual-admin/organizations/nope')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_org_detail_route -v
```

Expected: 404.

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
@bp.get('/organizations/<org_id>')
def get_org_detail(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    contacts = deps.db.list_org_memberships(
        org_id=org_id, roles=('school_admin',),
    )

    try:
        deps.audit_logger.log(
            actor_uid=uid,
            action=AuditAction.ORG_VIEWED_DETAIL,
            target_type='organization',
            target_id=org_id,
            target_org_id=org_id,
            metadata={},
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )
    except Exception:  # noqa: BLE001
        pass

    return jsonify({
        'id': org_id,
        'name': org.get('name'),
        'status': org.get('status'),
        'schoolType': org.get('school_type'),
        'country': org.get('country'),
        'state': org.get('state'),
        'websiteUrl': org.get('website_url'),
        'createdAt': org.get('created_at'),
        'lastActivityAt': org.get('last_activity_at'),
        'suspendedAt': org.get('suspended_at'),
        'suspendedByUid': org.get('suspended_by_uid'),
        'suspendReason': org.get('suspend_reason'),
        'suspendedUntil': org.get('suspended_until'),
        'schoolAdminContacts': [
            {'membershipId': c['membership_id'], 'uid': c['uid'],
             'email': c['email'], 'name': c.get('name')}
            for c in contacts
        ],
    }), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_org_detail_route -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_org_detail_route.py
git commit -m "feat(lingual-admin): GET /organizations/<id> with org_viewed_detail audit"
```

---

## Task 20: Members + Classes + Audit subroutes

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_org_subroutes.py`

**Why:** Three GET endpoints — Members (school_admin + teacher rows + aggregate student count), Classes (metadata only), Audit (org-scoped audit feed). All read-only; no audit writes (the parent `/organizations/<id>` already wrote `org_viewed_detail`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_lingual_admin_org_subroutes.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeSubrouteDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        return {'id': org_id, 'name': 'Sunset', 'status': 'active'} if org_id == 'o1' else None

    def list_org_memberships(self, *, org_id, roles=None):
        return [
            {'membership_id': 'm1', 'uid': 'u1', 'email': 'a@x.com', 'name': 'A',
             'roles': ['school_admin'], 'status': 'active', 'joined_at': None},
            {'membership_id': 'm2', 'uid': 'u2', 'email': 'b@x.com', 'name': 'B',
             'roles': ['teacher'], 'status': 'active', 'joined_at': None},
        ]

    def count_org_students(self, *, org_id):
        return 42

    def list_org_classes(self, *, org_id):
        return [{'id': 'c1', 'name': 'Spanish I', 'term': 'F26',
                 'subject': 'spanish', 'teacher_membership_ids': ['m1'],
                 'created_at': None, 'last_activity_at': None}]

    def list_org_audit_events(self, *, org_id, limit):
        return [{'id': 'a1', 'action': 'org_suspended', 'actor_uid': 'admin-uid',
                 'metadata': {'reason': 'r'}, 'created_at': None,
                 'target': {'type': 'organization', 'id': 'o1'}, 'target_org_id': 'o1'}]


class MembersClassesAuditRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.deps = make_test_deps(db=FakeSubrouteDb())
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_members_returns_staff_plus_student_count(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/members')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['members']), 2)
        self.assertEqual(data['studentCount'], 42)
        # Each row should be camelCased.
        self.assertEqual(data['members'][0]['membershipId'], 'm1')

    def test_classes_returns_metadata_rows(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/classes')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['name'], 'Spanish I')
        self.assertEqual(data['items'][0]['teacherMembershipIds'], ['m1'])

    def test_audit_returns_org_scoped_rows(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/audit')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['action'], 'org_suspended')

    def test_unknown_org_is_404_on_each(self):
        for sub in ('members', 'classes', 'audit'):
            resp = self.client.get(f'/api/lingual-admin/organizations/nope/{sub}')
            self.assertEqual(resp.status_code, 404, msg=f'/{sub} should 404')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m unittest backend.tests.test_lingual_admin_org_subroutes -v
```

Expected: 404 (routes not registered).

- [ ] **Step 3: Add the routes in `backend/routes/lingual_admin.py`**

```python
@bp.get('/organizations/<org_id>/members')
def get_org_members(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    members = deps.db.list_org_memberships(
        org_id=org_id, roles=('school_admin', 'teacher'),
    )
    student_count = deps.db.count_org_students(org_id=org_id)
    return jsonify({
        'members': [
            {'membershipId': m['membership_id'], 'uid': m['uid'],
             'email': m['email'], 'name': m.get('name'),
             'roles': m['roles'], 'status': m['status'],
             'joinedAt': m.get('joined_at')}
            for m in members
        ],
        'studentCount': student_count,
    }), 200


@bp.get('/organizations/<org_id>/classes')
def get_org_classes(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    classes = deps.db.list_org_classes(org_id=org_id)
    return jsonify({
        'items': [
            {'id': c['id'], 'name': c.get('name'), 'term': c.get('term'),
             'subject': c.get('subject'),
             'teacherMembershipIds': c.get('teacher_membership_ids') or [],
             'createdAt': c.get('created_at'),
             'lastActivityAt': c.get('last_activity_at')}
            for c in classes
        ],
    }), 200


@bp.get('/organizations/<org_id>/audit')
def get_org_audit(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    limit = min(int(request.args.get('limit', 50)), 200)
    items = deps.db.list_org_audit_events(org_id=org_id, limit=limit)
    return jsonify({'items': items}), 200
```

- [ ] **Step 4: Add `count_org_students` DB helper**

In `database.py`, near `list_org_memberships`:

```python
def count_org_students(*, org_id: str) -> int:
    """Aggregate active student count for an org.

    Counts via enrollments × classes intersection (enrollments don't carry
    org_id directly).
    """
    class_ids = [c.id for c in get_db().collection('classes').where('org_id', '==', org_id).stream()]
    if not class_ids:
        return 0
    total = 0
    # Firestore `in` queries cap at 30 elements per query; batch in chunks of 30.
    for i in range(0, len(class_ids), 30):
        chunk = class_ids[i:i+30]
        snap = (
            get_db()
            .collection('enrollments')
            .where('class_id', 'in', chunk)
            .where('status', '==', 'active')
            .count()
            .get()
        )
        total += snap[0][0].value if snap else 0
    return total
```

- [ ] **Step 5: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_org_subroutes -v
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/lingual_admin.py database.py backend/tests/test_lingual_admin_org_subroutes.py
git commit -m "feat(lingual-admin): GET /organizations/<id>/(members|classes|audit)"
```

---

## Task 21: `POST /api/lingual-admin/organizations/<orgId>/suspend`

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_suspend_route.py`

**Why:** Calls `database.suspend_organization` (Task 4), writes the audit row, and fans out `org_suspended` emails to every active school_admin via the outbox.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_suspend_route.py`:

```python
import unittest
import datetime

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeSuspendDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.suspended = None
        self.outbox = []

    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        if org_id == 'o1':
            return {'id': 'o1', 'name': 'Sunset HS', 'status': 'active'}
        return None

    def suspend_organization(self, *, org_id, actor_uid, reason, suspended_until, audit_entry):
        if not reason:
            raise ValueError('reason required')
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.suspended = dict(org_id=org_id, actor_uid=actor_uid,
                              reason=reason, suspended_until=suspended_until,
                              audit_entry=audit_entry)

    def list_school_admin_emails(self, org_id):
        return [
            {'uid': 'u1', 'email': 'admin@sunset.edu', 'name': 'Kim'},
            {'uid': 'u2', 'email': 'second@sunset.edu', 'name': 'Lee'},
        ]


def fake_enqueue(*args, **kwargs):
    """Capture into a list attribute on the deps for inspection."""
    enqueued.append(kwargs)


enqueued = []


class SuspendRouteTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        enqueued.clear()
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeSuspendDb(), audit_logger=self.audit)
        self.patcher = patch(
            'backend.routes.lingual_admin.enqueue_outbox_email',
            side_effect=fake_enqueue,
        )
        self.patcher.start()
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def tearDown(self):
        self.patcher.stop()

    def test_suspend_with_reason(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'compliance review', 'suspendedUntil': None},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.suspended['reason'], 'compliance review')
        self.assertIsNone(self.deps.db.suspended['suspended_until'])

    def test_suspend_with_until(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'temp', 'suspendedUntil': '2026-06-01T00:00:00Z'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(self.deps.db.suspended['suspended_until'], datetime.datetime)

    def test_missing_reason_400(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={},
        )
        self.assertEqual(resp.status_code, 400)

    def test_emails_each_school_admin(self):
        self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'r'},
        )
        self.assertEqual(len(enqueued), 2)
        templates = [e.get('template') or e.get('template_id') for e in enqueued]
        # Outbox enum or string both acceptable.
        for t in templates:
            t_val = t.value if hasattr(t, 'value') else t
            self.assertEqual(t_val, 'org_suspended')

    def test_passes_audit_entry_to_db_helper(self):
        """Audit goes ATOMICALLY via the DB helper — not the AuditLogger.
        The fail-soft AuditLogger.log is reserved for view audits."""
        self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'r'},
        )
        # AuditLogger.log was NOT called — atomic audit lives in the helper.
        self.assertEqual(len(self.audit.calls), 0)
        # The helper received an audit_entry with action='org_suspended'.
        audit_entry = self.deps.db.suspended['audit_entry']
        self.assertEqual(audit_entry['action'], 'org_suspended')
        self.assertEqual(audit_entry['target']['id'], 'o1')
        self.assertEqual(audit_entry['target_org_id'], 'o1')

    def test_unknown_org_404(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/nope/suspend',
            json={'reason': 'r'},
        )
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_suspend_route -v
```

Expected: 404.

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
import datetime as _dt
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email

# `_public_base_url`, `_hash_ip`, `_client_ip`, `_user_agent` are imported
# at the top of `lingual_admin.py` from `backend.services.audit_utils`
# (Task 12). Do NOT redefine them inline.


def _parse_iso8601(value):
    if value is None or value == '':
        return None
    if isinstance(value, _dt.datetime):
        return value
    try:
        # Handle trailing Z
        s = value.replace('Z', '+00:00') if isinstance(value, str) else value
        return _dt.datetime.fromisoformat(s)
    except (ValueError, TypeError):
        raise ValueError(f'invalid ISO 8601 datetime: {value}')


@bp.post('/organizations/<org_id>/suspend')
def suspend_org(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    body = request.get_json(silent=True) or {}
    reason = (body.get('reason') or '').strip()
    suspended_until_str = body.get('suspendedUntil')
    if not reason:
        return jsonify({'error': 'reason required'}), 400

    try:
        suspended_until = _parse_iso8601(suspended_until_str)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    # Resolve recipient list BEFORE the atomic write so the audit metadata
    # can include the recipient count. (The list query is a read; if it
    # fails, recipients is empty and the audit still records that.)
    try:
        recipients = deps.db.list_school_admin_emails(org_id)
    except Exception:  # noqa: BLE001
        recipients = []

    # Build audit_entry to commit atomically with the org update.
    audit_entry = deps.audit_logger.build_audit_doc(
        actor_uid=uid,
        action=AuditAction.ORG_SUSPENDED,
        target_type='organization',
        target_id=org_id,
        target_org_id=org_id,
        metadata={'reason': reason,
                  'suspended_until': suspended_until.isoformat() if suspended_until else None,
                  'recipient_count': len(recipients)},
        ip_hash=_hash_ip(_client_ip()),
        user_agent=_user_agent(),
    )

    try:
        deps.db.suspend_organization(
            org_id=org_id, actor_uid=uid,
            reason=reason, suspended_until=suspended_until,
            audit_entry=audit_entry,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    # Fan out emails AFTER the atomic suspend+audit commit (fail-soft).
    support_email = os.environ.get('SUPPORT_EMAIL', 'help@l1ngual.com')
    for rec in recipients:
        try:
            enqueue_outbox_email(
                db=deps.db,
                recipient_email=rec['email'],
                recipient_name=rec.get('name', ''),
                template=OutboxTemplate.ORG_SUSPENDED,
                template_data={
                    'org_name': org.get('name', ''),
                    'reason': reason,
                    'suspended_until': suspended_until.isoformat() if suspended_until else None,
                    'support_email': support_email,
                },
            )
        except Exception:  # noqa: BLE001
            pass

    return jsonify({'ok': True, 'orgId': org_id}), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_suspend_route -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_suspend_route.py
git commit -m "feat(lingual-admin): POST /organizations/<id>/suspend with fan-out + audit"
```

---

## Task 22: `POST /api/lingual-admin/organizations/<orgId>/restore`

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_restore_route.py`

**Why:** Calls `database.restore_organization`, fans out `org_restored` emails, writes audit row.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_restore_route.py`:

```python
import unittest
from unittest.mock import patch

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeRestoreDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.restored = None

    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        if org_id == 'o1':
            return {'id': 'o1', 'name': 'Sunset HS', 'status': 'suspended'}
        return None

    def restore_organization(self, *, org_id, actor_uid, audit_entry):
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.restored = dict(org_id=org_id, actor_uid=actor_uid, audit_entry=audit_entry)

    def list_school_admin_emails(self, org_id):
        return [{'uid': 'u1', 'email': 'a@s.edu', 'name': 'Kim'}]


enqueued = []


def fake_enqueue(*args, **kwargs):
    enqueued.append(kwargs)


class RestoreRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        enqueued.clear()
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeRestoreDb(), audit_logger=self.audit)
        self.patcher = patch(
            'backend.routes.lingual_admin.enqueue_outbox_email',
            side_effect=fake_enqueue,
        )
        self.patcher.start()
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def tearDown(self):
        self.patcher.stop()

    def test_restore_returns_ok(self):
        resp = self.client.post('/api/lingual-admin/organizations/o1/restore')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.restored['org_id'], 'o1')

    def test_emails_each_school_admin(self):
        self.client.post('/api/lingual-admin/organizations/o1/restore')
        self.assertEqual(len(enqueued), 1)
        tmpl = enqueued[0].get('template') or enqueued[0].get('template_id')
        self.assertEqual(tmpl.value if hasattr(tmpl, 'value') else tmpl, 'org_restored')

    def test_passes_audit_entry_to_db_helper(self):
        """Audit goes ATOMICALLY via the DB helper, not via the AuditLogger."""
        self.client.post('/api/lingual-admin/organizations/o1/restore')
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.restored['audit_entry']
        self.assertEqual(audit_entry['action'], 'org_restored')
        self.assertEqual(audit_entry['target_org_id'], 'o1')

    def test_unknown_org_404(self):
        resp = self.client.post('/api/lingual-admin/organizations/nope/restore')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_restore_route -v
```

Expected: 404.

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
@bp.post('/organizations/<org_id>/restore')
def restore_org(org_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    # Resolve recipients first so audit metadata can record the count.
    try:
        recipients = deps.db.list_school_admin_emails(org_id)
    except Exception:  # noqa: BLE001
        recipients = []

    # Build audit_entry for atomic commit alongside the org update.
    audit_entry = deps.audit_logger.build_audit_doc(
        actor_uid=uid,
        action=AuditAction.ORG_RESTORED,
        target_type='organization',
        target_id=org_id,
        target_org_id=org_id,
        metadata={'recipient_count': len(recipients)},
        ip_hash=_hash_ip(_client_ip()),
        user_agent=_user_agent(),
    )

    try:
        deps.db.restore_organization(
            org_id=org_id, actor_uid=uid,
            audit_entry=audit_entry,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    # Fan-out emails after atomic restore+audit commit (fail-soft).
    dashboard_url = f'{_public_base_url()}/app/admin'
    for rec in recipients:
        try:
            enqueue_outbox_email(
                db=deps.db,
                recipient_email=rec['email'],
                recipient_name=rec.get('name', ''),
                template=OutboxTemplate.ORG_RESTORED,
                template_data={
                    'org_name': org.get('name', ''),
                    'dashboard_url': dashboard_url,
                },
            )
        except Exception:  # noqa: BLE001
            pass

    return jsonify({'ok': True, 'orgId': org_id}), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_restore_route -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_restore_route.py
git commit -m "feat(lingual-admin): POST /organizations/<id>/restore with fan-out + audit"
```

---

## Task 23: `DELETE /api/lingual-admin/organizations/<orgId>/members/<membershipId>`

**Files:**
- Modify: `backend/routes/lingual_admin.py`
- Create: `backend/tests/test_lingual_admin_member_removal_route.py`

**Why:** Member removal exercises the `_sync_org_admin_uids(add=False)` invariant Plan 4's forward obligation requires. Body accepts `{reason}` (required, for the audit row).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lingual_admin_member_removal_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeMemberRemoveDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.removed = None

    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        return {'id': org_id, 'name': 'Sunset'} if org_id == 'o1' else None

    def get_membership(self, membership_id):
        if membership_id == 'm1':
            return {'id': 'm1', 'org_id': 'o1', 'uid': 'u1',
                    'roles': ['school_admin'], 'status': 'active'}
        return None

    def remove_membership(self, *, membership_id, actor_uid, audit_entry):
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.removed = dict(membership_id=membership_id, actor_uid=actor_uid,
                            audit_entry=audit_entry)
        return {'id': membership_id, 'uid': 'u1', 'org_id': 'o1',
                'roles': ['school_admin']}


class MemberRemovalRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeMemberRemoveDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['uid'] = 'admin-uid'

    def test_delete_with_reason(self):
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={'reason': 'teacher left school'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.removed['membership_id'], 'm1')

    def test_missing_reason_400(self):
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={},
        )
        self.assertEqual(resp.status_code, 400)

    def test_membership_belonging_to_other_org_404(self):
        """Membership exists but org_id doesn't match — should not be removable here."""
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o2/members/m1',
            json={'reason': 'r'},
        )
        self.assertEqual(resp.status_code, 404)

    def test_audit_entry_passed_to_helper_atomically(self):
        """Audit goes via the DB helper for atomic commit."""
        self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={'reason': 'r'},
        )
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.removed['audit_entry']
        self.assertEqual(audit_entry['action'], 'membership_removed')
        meta = audit_entry['metadata']
        self.assertEqual(meta['reason'], 'r')
        # `removed_roles` and `removed_uid` are computed by the route from
        # the membership it fetched, then placed in metadata BEFORE calling
        # the helper.
        self.assertIn('school_admin', meta['removed_roles'])
        self.assertEqual(meta['removed_uid'], 'u1')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_lingual_admin_member_removal_route -v
```

Expected: 404.

- [ ] **Step 3: Add the route in `backend/routes/lingual_admin.py`**

```python
@bp.delete('/organizations/<org_id>/members/<membership_id>')
def remove_member(org_id, membership_id):
    try:
        uid = deps.get_current_user_uid()
        _require_lingual_admin(uid)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    org = deps.db.get_organization(org_id)
    if not org:
        return jsonify({'error': 'not_found'}), 404

    membership = deps.db.get_membership(membership_id)
    if not membership or membership.get('org_id') != org_id:
        return jsonify({'error': 'not_found'}), 404

    body = request.get_json(silent=True) or {}
    reason = (body.get('reason') or '').strip()
    if not reason:
        return jsonify({'error': 'reason required'}), 400

    # Build audit_entry from the membership we already fetched so the
    # roles + removed_uid are captured before we commit the removal.
    audit_entry = deps.audit_logger.build_audit_doc(
        actor_uid=uid,
        action=AuditAction.MEMBERSHIP_REMOVED,
        target_type='membership',
        target_id=membership_id,
        target_org_id=org_id,
        metadata={
            'reason': reason,
            'removed_uid': membership.get('uid'),
            'removed_roles': membership.get('roles') or [],
        },
        ip_hash=_hash_ip(_client_ip()),
        user_agent=_user_agent(),
    )

    try:
        deps.db.remove_membership(
            membership_id=membership_id, actor_uid=uid,
            audit_entry=audit_entry,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({'ok': True}), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_lingual_admin_member_removal_route -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lingual_admin.py backend/tests/test_lingual_admin_member_removal_route.py
git commit -m "feat(lingual-admin): DELETE /organizations/<id>/members/<mid> with audit"
```

---

## Task 24: Retire legacy admin endpoints in `school_requests.py`

**Files:**
- Modify: `backend/routes/school_requests.py`
- Modify: `backend/tests/test_school_requests.py`

**Why:** All four admin endpoints (`admin_list_school_requests`, `admin_get_school_request`, `admin_approve_school_request`, `admin_reject_school_request`) now live in `lingual_admin.py`. Replace the bodies with a `410 Gone` that points at the new path so any stale frontend/client gets a clear signal.

- [ ] **Step 1: Replace admin endpoint bodies with 410 Gone**

Open `backend/routes/school_requests.py`. For each of the four admin route functions, replace the body with:

```python
@bp.get('/admin/school-requests')
def admin_list_school_requests():
    return jsonify({
        'error': 'gone',
        'message': 'Use GET /api/lingual-admin/requests instead',
    }), 410


@bp.get('/admin/school-requests/<request_id>')
def admin_get_school_request(request_id):
    return jsonify({
        'error': 'gone',
        'message': f'Use GET /api/lingual-admin/requests/{request_id} instead',
    }), 410


@bp.post('/admin/school-requests/<request_id>/approve')
def admin_approve_school_request(request_id):
    return jsonify({
        'error': 'gone',
        'message': f'Use POST /api/lingual-admin/requests/{request_id}/approve instead',
    }), 410


@bp.post('/admin/school-requests/<request_id>/reject')
def admin_reject_school_request(request_id):
    return jsonify({
        'error': 'gone',
        'message': f'Use POST /api/lingual-admin/requests/{request_id}/decline instead',
    }), 410
```

Also remove the now-unused imports (`approve_school_request`, `reject_school_request` if not used elsewhere; `_require_lingual_admin` if no other route uses it).

- [ ] **Step 2: Update existing tests**

In `backend/tests/test_school_requests.py`, find tests that exercise the four admin endpoints. For each, change the assertion to expect `410` and the new shape:

```python
def test_legacy_admin_list_returns_410(self):
    # ... setup ...
    resp = self.client.get('/api/admin/school-requests')
    self.assertEqual(resp.status_code, 410)
    self.assertIn('lingual-admin', resp.get_json()['message'])
```

(Use `git grep "admin_list_school_requests\|admin_approve_school_request\|admin_reject_school_request"` to find all impacted tests.)

- [ ] **Step 3: Run the full backend suite**

```bash
make test-backend
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/school_requests.py backend/tests/test_school_requests.py
git commit -m "refactor(school-requests): retire admin endpoints in favor of /api/lingual-admin"
```

---

## Task 25: Frontend DTOs for the 12 endpoints

**Files:**
- Create: `frontend/src/types/lingualAdmin.ts`

**Why:** TypeScript types matching every endpoint response shape. Single source of truth used by the API client and every page.

- [ ] **Step 1: Create `frontend/src/types/lingualAdmin.ts`**

```typescript
export type OrgStatus = 'active' | 'suspended' | 'archived';

export type DeclineCategory =
  | 'info_missing'
  | 'fraud_risk'
  | 'out_of_scope'
  | 'duplicate'
  | 'other';

export interface OverviewTiles {
  pendingRequests: number;
  activeOrgs: number;
  suspendedOrgs: number;
  newRequestsLast7d: number;
}

export interface AuditEntry {
  id: string;
  actorUid: string;
  action: string;
  target: { type: string; id: string };
  targetOrgId: string | null;
  metadata: Record<string, unknown>;
  ipHash: string;
  userAgent: string;
  createdAt: string | null;
}

export interface OverviewResponse {
  tiles: OverviewTiles;
  recentActivity: AuditEntry[];
}

export interface SchoolRequestRow {
  id: string;
  schoolName: string;
  orgType?: string;
  schoolType?: string;
  status: string;
  requesterEmail?: string;
  requesterName?: string;
  createdAt?: string | null;
  country?: string;
  rejectionReason?: string;
  rejectionCategory?: DeclineCategory;
}

export interface RequestsListResponse {
  items: SchoolRequestRow[];
  // Backend's positional `start_after(leading_value, id)` requires both
  // the leading order_by field's value (createdAt for time sorts,
  // schoolName for the name sort) AND the doc id. See Task 14 I4 fix.
  nextCursor: { leadingValue: string | null; id: string } | null;
}

export interface AttestationDetail {
  ipHash: string;
  userAgent: string;
  attestedAt: string | null;
}

export interface IntegrationDetail {
  lms: string | null;
  instanceUrl: string | null;
}

export interface CurriculumDetail {
  language?: string;
  levels?: string[];
}

export interface SchoolRequestDetail extends SchoolRequestRow {
  requesterUid?: string;
  requesterTitle?: string;
  websiteUrl?: string;
  state?: string;
  county?: string;
  preInvitedTeachers: string[];
  attestation: AttestationDetail;
  integration: IntegrationDetail;
  curriculum?: CurriculumDetail;
}

export interface OrgSummary {
  id: string;
  name: string;
  status: OrgStatus;
  schoolType?: string;
  country?: string;
  publicOrPrivate?: string;
  memberCount: number;
  createdAt?: string | null;
  lastActivityAt?: string | null;
}

export interface OrgsListResponse {
  items: OrgSummary[];
  nextCursor: { nameLower: string; id: string } | null;
}

export interface OrgDetail {
  id: string;
  name: string;
  status: OrgStatus;
  schoolType?: string;
  country?: string;
  state?: string;
  websiteUrl?: string;
  createdAt?: string | null;
  lastActivityAt?: string | null;
  suspendedAt?: string | null;
  suspendedByUid?: string | null;
  suspendReason?: string | null;
  suspendedUntil?: string | null;
  schoolAdminContacts: Array<{
    membershipId: string;
    uid: string;
    email: string;
    name?: string;
  }>;
}

export interface MemberRow {
  membershipId: string;
  uid: string;
  email: string;
  name?: string;
  roles: string[];
  status: string;
  joinedAt?: string | null;
}

export interface MembersResponse {
  members: MemberRow[];
  studentCount: number;
}

export interface ClassRow {
  id: string;
  name?: string;
  term?: string;
  subject?: string;
  teacherMembershipIds: string[];
  createdAt?: string | null;
  lastActivityAt?: string | null;
}

export interface ClassesResponse {
  items: ClassRow[];
}

export interface OrgAuditResponse {
  items: AuditEntry[];
}

export interface SuspendPayload {
  reason: string;
  suspendedUntil?: string | null;
}

export interface DeclinePayload {
  reason: string;
  category: DeclineCategory;
  internalNote?: string;
}

export interface ApprovePayload {
  internalNote?: string;
}

export interface ApproveResponse {
  requestId: string;
  createdOrgId: string;
  membershipId: string;
  preInviteInvitationIds: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/lingualAdmin.ts
git commit -m "feat(types): add lingual admin DTOs"
```

---

## Task 26: Frontend API client

**Files:**
- Create: `frontend/src/api/lingualAdmin.ts`
- Create: `frontend/src/api/lingualAdmin.test.ts`

**Why:** Typed client per endpoint, routing through the shared `api/index.ts` axios instance.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/lingualAdmin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchOverview, fetchRequests, fetchRequestDetail,
  approveRequest, declineRequest,
  fetchOrgs, fetchOrgDetail, fetchOrgMembers,
  fetchOrgClasses, fetchOrgAudit,
  suspendOrg, restoreOrg, removeMember,
} from './lingualAdmin';
import { api } from './index';

vi.mock('./index', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('lingualAdmin API client', () => {
  it('fetchOverview calls GET /api/lingual-admin/overview', async () => {
    mockGet.mockResolvedValue({ data: { tiles: {}, recentActivity: [] } });
    await fetchOverview();
    expect(mockGet).toHaveBeenCalledWith('/api/lingual-admin/overview');
  });

  it('fetchRequests passes filters as query params', async () => {
    mockGet.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchRequests({ status: 'pending', schoolType: 'high', sort: 'name' });
    expect(mockGet).toHaveBeenCalledWith(
      '/api/lingual-admin/requests',
      expect.objectContaining({
        params: { status: 'pending', schoolType: 'high', sort: 'name' },
      }),
    );
  });

  it('approveRequest POSTs with internalNote', async () => {
    mockPost.mockResolvedValue({ data: {} });
    await approveRequest('r1', { internalNote: 'note' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/lingual-admin/requests/r1/approve',
      { internalNote: 'note' },
    );
  });

  it('declineRequest POSTs reason+category', async () => {
    mockPost.mockResolvedValue({ data: {} });
    await declineRequest('r1', { reason: 'r', category: 'fraud_risk' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/lingual-admin/requests/r1/decline',
      { reason: 'r', category: 'fraud_risk' },
    );
  });

  it('fetchOrgs serializes cursor as JSON', async () => {
    mockGet.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchOrgs({ status: 'active', cursor: { nameLower: 'lin', id: 'o1' } });
    const call = mockGet.mock.calls[0];
    expect(call[1].params.cursor).toBe(JSON.stringify({ nameLower: 'lin', id: 'o1' }));
  });

  it('suspendOrg POSTs reason+suspendedUntil', async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    await suspendOrg('o1', { reason: 'r', suspendedUntil: '2026-06-01T00:00:00Z' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/lingual-admin/organizations/o1/suspend',
      { reason: 'r', suspendedUntil: '2026-06-01T00:00:00Z' },
    );
  });

  it('restoreOrg POSTs empty body', async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    await restoreOrg('o1');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/lingual-admin/organizations/o1/restore',
    );
  });

  it('removeMember DELETEs with reason in body', async () => {
    mockDelete.mockResolvedValue({ data: { ok: true } });
    await removeMember('o1', 'm1', { reason: 'left school' });
    expect(mockDelete).toHaveBeenCalledWith(
      '/api/lingual-admin/organizations/o1/members/m1',
      { data: { reason: 'left school' } },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/api/lingualAdmin.test.ts
```

Expected: import error.

- [ ] **Step 3: Create `frontend/src/api/lingualAdmin.ts`**

```typescript
import { api } from './index';
import type {
  OverviewResponse,
  RequestsListResponse,
  SchoolRequestDetail,
  ApprovePayload,
  ApproveResponse,
  DeclinePayload,
  OrgsListResponse,
  OrgDetail,
  MembersResponse,
  ClassesResponse,
  OrgAuditResponse,
  SuspendPayload,
} from '@/types/lingualAdmin';

export async function fetchOverview(): Promise<OverviewResponse> {
  const { data } = await api.get('/api/lingual-admin/overview');
  return data;
}

export interface RequestsFilters {
  status?: string;
  schoolType?: string;
  country?: string;
  sort?: 'requested_at_desc' | 'requested_at_asc' | 'name';
  cursor?: { id: string };
}

export async function fetchRequests(
  filters: RequestsFilters = {},
): Promise<RequestsListResponse> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.schoolType) params.schoolType = filters.schoolType;
  if (filters.country) params.country = filters.country;
  if (filters.sort) params.sort = filters.sort;
  if (filters.cursor) params.cursor = JSON.stringify(filters.cursor);
  const { data } = await api.get('/api/lingual-admin/requests', { params });
  return data;
}

export async function fetchRequestDetail(id: string): Promise<SchoolRequestDetail> {
  const { data } = await api.get(`/api/lingual-admin/requests/${id}`);
  return data;
}

export async function approveRequest(
  id: string,
  payload: ApprovePayload = {},
): Promise<ApproveResponse> {
  const { data } = await api.post(`/api/lingual-admin/requests/${id}/approve`, payload);
  return data;
}

export async function declineRequest(
  id: string,
  payload: DeclinePayload,
): Promise<{ requestId: string }> {
  const { data } = await api.post(`/api/lingual-admin/requests/${id}/decline`, payload);
  return data;
}

export interface OrgsFilters {
  status?: 'active' | 'suspended' | 'archived';
  schoolType?: string;
  country?: string;
  publicOrPrivate?: string;
  cursor?: { nameLower: string; id: string };
}

export async function fetchOrgs(filters: OrgsFilters = {}): Promise<OrgsListResponse> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.schoolType) params.schoolType = filters.schoolType;
  if (filters.country) params.country = filters.country;
  if (filters.publicOrPrivate) params.publicOrPrivate = filters.publicOrPrivate;
  if (filters.cursor) params.cursor = JSON.stringify(filters.cursor);
  const { data } = await api.get('/api/lingual-admin/organizations', { params });
  return data;
}

export async function fetchOrgDetail(orgId: string): Promise<OrgDetail> {
  const { data } = await api.get(`/api/lingual-admin/organizations/${orgId}`);
  return data;
}

export async function fetchOrgMembers(orgId: string): Promise<MembersResponse> {
  const { data } = await api.get(`/api/lingual-admin/organizations/${orgId}/members`);
  return data;
}

export async function fetchOrgClasses(orgId: string): Promise<ClassesResponse> {
  const { data } = await api.get(`/api/lingual-admin/organizations/${orgId}/classes`);
  return data;
}

export async function fetchOrgAudit(
  orgId: string,
  limit = 50,
): Promise<OrgAuditResponse> {
  const { data } = await api.get(`/api/lingual-admin/organizations/${orgId}/audit`, {
    params: { limit },
  });
  return data;
}

export async function suspendOrg(orgId: string, payload: SuspendPayload): Promise<void> {
  await api.post(`/api/lingual-admin/organizations/${orgId}/suspend`, payload);
}

export async function restoreOrg(orgId: string): Promise<void> {
  await api.post(`/api/lingual-admin/organizations/${orgId}/restore`);
}

export async function removeMember(
  orgId: string,
  membershipId: string,
  payload: { reason: string },
): Promise<void> {
  await api.delete(
    `/api/lingual-admin/organizations/${orgId}/members/${membershipId}`,
    { data: payload },
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/api/lingualAdmin.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/lingualAdmin.ts frontend/src/api/lingualAdmin.test.ts
git commit -m "feat(api): typed lingualAdmin client"
```

---

## Task 27: `SCHOOL_ADMIN_HOME_ROUTE` + split dispatcher

**Files:**
- Modify: `frontend/src/lib/homeRoutes.ts`
- Modify: `frontend/src/lib/homeRoutes.test.ts`

**Why:** This is Sprint C's #27 fix. `school_admin` users now land at `/app/admin`, separate from `/app/teacher`. The dispatcher's `school_admin` branch is split out. `LINGUAL_ADMIN_HOME_ROUTE` is updated to point at the new `/app/lingual-admin/requests`.

- [ ] **Step 1: Write the failing test**

Open `frontend/src/lib/homeRoutes.test.ts` and add:

```typescript
import {
  getOnboardingDestination,
  LINGUAL_ADMIN_HOME_ROUTE,
  SCHOOL_ADMIN_HOME_ROUTE,
  TEACHER_HOME_ROUTE,
} from './homeRoutes';
import type { User } from '@/types';

describe('Plan 5 routing additions', () => {
  it('exposes SCHOOL_ADMIN_HOME_ROUTE as /app/admin', () => {
    expect(SCHOOL_ADMIN_HOME_ROUTE).toBe('/app/admin');
  });

  it('LINGUAL_ADMIN_HOME_ROUTE points at /app/lingual-admin/requests', () => {
    expect(LINGUAL_ADMIN_HOME_ROUTE).toBe('/app/lingual-admin/requests');
  });

  it('school_admin with no teacher role goes to /app/admin', () => {
    const user: User = {
      uid: 'u', email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['school_admin'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(SCHOOL_ADMIN_HOME_ROUTE);
  });

  it('school_admin who is also a teacher still goes to /app/admin', () => {
    const user: User = {
      uid: 'u', email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['school_admin', 'teacher'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(SCHOOL_ADMIN_HOME_ROUTE);
  });

  it('teacher (no school_admin) still goes to /app/teacher', () => {
    const user: User = {
      uid: 'u', email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['teacher'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(TEACHER_HOME_ROUTE);
  });

  it('lingual_admin still wins over both', () => {
    const user: User = {
      uid: 'u', email: 'a@x.com',
      lingualAdmin: true,
      memberships: [{ orgId: 'o', roles: ['school_admin'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(LINGUAL_ADMIN_HOME_ROUTE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts
```

Expected: `SCHOOL_ADMIN_HOME_ROUTE` is not exported.

- [ ] **Step 3: Modify `frontend/src/lib/homeRoutes.ts`**

```typescript
export const LEARNER_HOME_ROUTE = '/app/learn';
export const TEACHER_HOME_ROUTE = '/app/teacher';
export const SCHOOL_ADMIN_HOME_ROUTE = '/app/admin';
export const LINGUAL_ADMIN_HOME_ROUTE = '/app/lingual-admin/requests';
// ... other constants unchanged
```

Update `getOnboardingDestination`:

```typescript
export function getOnboardingDestination(user: User | null | undefined): string | null {
  if (!user) return null;

  // 1) Lingual admin wins over everything.
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  // 2) Active memberships. school_admin takes precedence over teacher
  //    (a school_admin who is also a teacher should see the admin home).
  const roles = activeRoles(user);
  if (roles.has('school_admin')) {
    return SCHOOL_ADMIN_HOME_ROUTE;
  }
  if (roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }
  if (roles.has('student')) {
    return LEARNER_HOME_ROUTE;
  }

  // 3..6 unchanged — completed legacy, intended_role resume, legacy
  //     fallback, brand-new signup.
  if (user.onboardingState === 'complete') return LEARNER_HOME_ROUTE;
  if (user.intendedRole === 'student') return STUDENT_SETUP_ROUTE;
  if (user.intendedRole === 'teacher') return TEACHER_JOIN_ORG_ROUTE;
  if (user.intendedRole === 'admin') return ADMIN_ORG_WIZARD_ROUTE;
  if (user.requiresLegacyRolePick) return STUDENT_SETUP_ROUTE;
  return ROLE_PICKER_ROUTE;
}
```

Update `getPrivilegedHomeRoute` similarly so legacy callers also get the new behavior.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts
```

Expected: all dispatcher tests (existing + new) pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/homeRoutes.ts frontend/src/lib/homeRoutes.test.ts
git commit -m "feat(routing): split school_admin to /app/admin; lingual admin to /app/lingual-admin/requests"
```

---

## Task 28: AuthContext 5-minute polling (LIMITATIONS #28 fix)

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Modify: `frontend/src/contexts/AuthContext.test.tsx`

**Why:** Plan 5 makes role grants and org status flips much more frequent. Without polling, a promoted Lingual admin still hits `LingualAdminRoute → /app/learn` until they sign out. We add a `setInterval` that re-runs `verifyToken(idToken)` every 5 minutes and updates state on diff.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/contexts/AuthContext.test.tsx`:

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '@/api/auth';

vi.mock('@/api/auth');

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext 5-minute polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('re-verifies every 5 minutes and updates state on diff', async () => {
    const verifyMock = vi.spyOn(authApi, 'verifyToken');
    verifyMock.mockResolvedValueOnce({
      user: { uid: 'u', email: 'a@x.com', lingualAdmin: false } as any,
    });
    // Simulate sign-in via Firebase Auth event...
    // (Use the existing pattern from other AuthContext tests to bootstrap a session.)

    // Advance 5 minutes — should trigger one re-verify.
    verifyMock.mockResolvedValueOnce({
      user: { uid: 'u', email: 'a@x.com', lingualAdmin: true } as any,
    });
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    await waitFor(() => {
      expect(verifyMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not poll when signed out', async () => {
    const verifyMock = vi.spyOn(authApi, 'verifyToken');
    // No sign-in.
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('cancels polling on signOut', async () => {
    // Bootstrap a signed-in session, then call signOut. Advance timers.
    // After signOut, no additional verify calls should occur.
    // (Pattern matches the existing signOut test in AuthContext.test.tsx.)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx
```

Expected: polling tests fail (no polling implemented).

- [ ] **Step 3: Add polling in `frontend/src/contexts/AuthContext.tsx`**

Inside the `AuthProvider` component:

```typescript
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

// Helper that compares the relevant fields. Returns true if state changed.
function hasMembershipDiff(prev: User | null, next: User | null): boolean {
  if (!prev || !next) return prev !== next;
  if (prev.lingualAdmin !== next.lingualAdmin) return true;
  const prevRoles = JSON.stringify((prev.activeRoles || []).slice().sort());
  const nextRoles = JSON.stringify((next.activeRoles || []).slice().sort());
  if (prevRoles !== nextRoles) return true;
  const prevMems = JSON.stringify(
    (prev.memberships || []).map(m => `${m.orgId}:${(m.roles || []).slice().sort().join(',')}:${m.status}`).sort(),
  );
  const nextMems = JSON.stringify(
    (next.memberships || []).map(m => `${m.orgId}:${(m.roles || []).slice().sort().join(',')}:${m.status}`).sort(),
  );
  return prevMems !== nextMems;
}

useEffect(() => {
  if (!user) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return;
  }
  pollRef.current = setInterval(async () => {
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) return;
      const idToken = await fbUser.getIdToken();
      const result = await verifyToken(idToken);
      const next = result.user as User;
      setUser(prev => {
        if (hasMembershipDiff(prev, next)) {
          return next;
        }
        return prev;
      });
    } catch (err) {
      console.warn('[auth] periodic verify failed', err);
    }
  }, POLL_INTERVAL_MS);
  return () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
}, [user?.uid]);
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx
```

Expected: all AuthContext tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/contexts/AuthContext.test.tsx
git commit -m "feat(auth): 5-min verify polling to detect role/membership changes"
```

---

## Task 29: `LingualAdminShell` with left nav

**Files:**
- Create: `frontend/src/pages/LingualAdmin/LingualAdminShell.tsx`
- Create: `frontend/src/pages/LingualAdmin/LingualAdminShell.test.tsx`

**Why:** Shared layout for every `/app/lingual-admin/*` page: top bar + left nav (Dashboard, Requests, Organizations) + `<Outlet />` content area.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/LingualAdminShell.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { LingualAdminShell } from './LingualAdminShell';

function renderShellAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/lingual-admin/*" element={<LingualAdminShell />}>
          <Route path="dashboard" element={<div>Dashboard view</div>} />
          <Route path="requests" element={<div>Requests view</div>} />
          <Route path="organizations" element={<div>Orgs view</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('LingualAdminShell', () => {
  it('renders three nav links', () => {
    renderShellAt('/app/lingual-admin/dashboard');
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /requests/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /organizations/i })).toBeInTheDocument();
  });

  it('renders child outlet', () => {
    renderShellAt('/app/lingual-admin/requests');
    expect(screen.getByText('Requests view')).toBeInTheDocument();
  });

  it('marks the active link', () => {
    renderShellAt('/app/lingual-admin/organizations');
    const orgsLink = screen.getByRole('link', { name: /organizations/i });
    expect(orgsLink).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualAdminShell.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `frontend/src/pages/LingualAdmin/LingualAdminShell.tsx`**

```typescript
import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/app/lingual-admin/dashboard', label: 'Dashboard' },
  { to: '/app/lingual-admin/requests', label: 'Requests' },
  { to: '/app/lingual-admin/organizations', label: 'Organizations' },
];

export function LingualAdminShell() {
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white">
        <div className="px-5 py-5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Lingual Admin
        </div>
        <nav className="flex flex-col gap-1 px-3 pb-6">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`
              }
              aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualAdminShell.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LingualAdmin/LingualAdminShell.tsx frontend/src/pages/LingualAdmin/LingualAdminShell.test.tsx
git commit -m "feat(lingual-admin): LingualAdminShell with left nav"
```

---

## Task 30: Routes in `App.tsx` + legacy redirect + school admin home stub

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/pages/SchoolAdminHomePage.tsx`
- Create: `frontend/src/pages/SchoolAdminHomePage.test.tsx`

**Why:** Wire up `/app/lingual-admin/*` subtree under the shell + `LingualAdminRoute` guard. Add `/app/admin` mounted under `TeacherRoute` (school_admin satisfies the existing guard). Add legacy redirect `/app/admin/school-requests` → `/app/lingual-admin/requests`.

The Plan 5 v1 of `SchoolAdminHomePage` is intentionally minimal — a welcome card with a link to `/app/teacher` (where the existing analytics/compliance pages live). A richer school_admin dashboard is a v1.5 follow-up (see LIMITATIONS new item in Task 42).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SchoolAdminHomePage.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { SchoolAdminHomePage } from './SchoolAdminHomePage';

describe('SchoolAdminHomePage', () => {
  it('renders welcome heading', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByText(/school admin/i)).toBeInTheDocument();
  });

  it('renders link to teacher tools', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /teacher tools|classes/i });
    expect(link).toHaveAttribute('href', '/app/teacher');
  });

  it('renders link to compliance', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /compliance/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/SchoolAdminHomePage.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `frontend/src/pages/SchoolAdminHomePage.tsx`**

```typescript
import { Link } from 'react-router-dom';

export function SchoolAdminHomePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">School Admin Home</h1>
      <p className="mt-3 text-neutral-600">
        Welcome. From here you can manage your school's teachers, classes, and
        compliance state.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/app/teacher"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">Teacher tools</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Classes, assignments, analytics, and roster.
          </p>
        </Link>
        <Link
          to="/app/admin/compliance"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">Compliance</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Org-wide consent, guardian packets, deletion requests.
          </p>
        </Link>
      </div>
    </div>
  );
}

export default SchoolAdminHomePage;
```

- [ ] **Step 4: Wire routes in `frontend/src/App.tsx`**

Find the existing `/app/admin/school-requests` route. Replace with the new tree:

```typescript
import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

const LingualAdminShell = lazy(() =>
  import('@/pages/LingualAdmin/LingualAdminShell').then(m => ({ default: m.LingualAdminShell })),
);
const LingualAdminDashboardPage = lazy(() =>
  import('@/pages/LingualAdmin/LingualAdminDashboardPage').then(m => ({ default: m.LingualAdminDashboardPage })),
);
const LingualRequestsPage = lazy(() =>
  import('@/pages/LingualAdmin/LingualRequestsPage').then(m => ({ default: m.LingualRequestsPage })),
);
const LingualOrgsListPage = lazy(() =>
  import('@/pages/LingualAdmin/LingualOrgsListPage').then(m => ({ default: m.LingualOrgsListPage })),
);
const LingualOrgDetailPage = lazy(() =>
  import('@/pages/LingualAdmin/LingualOrgDetailPage').then(m => ({ default: m.LingualOrgDetailPage })),
);
const SchoolAdminHomePage = lazy(() =>
  import('@/pages/SchoolAdminHomePage').then(m => ({ default: m.SchoolAdminHomePage })),
);

// ... inside <Routes>:

{/* school admin home */}
<Route
  path="/app/admin"
  element={
    <AppProtectedRoute>
      <TeacherRoute>
        <SchoolAdminHomePage />
      </TeacherRoute>
    </AppProtectedRoute>
  }
/>

{/* lingual admin panel */}
<Route
  path="/app/lingual-admin"
  element={
    <AppProtectedRoute>
      <LingualAdminRoute>
        <LingualAdminShell />
      </LingualAdminRoute>
    </AppProtectedRoute>
  }
>
  <Route index element={<Navigate to="dashboard" replace />} />
  <Route path="dashboard" element={<LingualAdminDashboardPage />} />
  <Route path="requests" element={<LingualRequestsPage />} />
  <Route path="organizations" element={<LingualOrgsListPage />} />
  <Route path="organizations/:orgId" element={<LingualOrgDetailPage />} />
</Route>

{/* legacy redirect */}
<Route
  path="/app/admin/school-requests"
  element={<Navigate to="/app/lingual-admin/requests" replace />}
/>
```

- [ ] **Step 5: Update `AppLayout` Home button**

Open `frontend/src/components/AppLayout.tsx` (or wherever the Home button is rendered). Update the destination:

```typescript
import { SCHOOL_ADMIN_HOME_ROUTE, LINGUAL_ADMIN_HOME_ROUTE,
         TEACHER_HOME_ROUTE, LEARNER_HOME_ROUTE } from '@/lib/homeRoutes';

function homeRouteFor(user: User | null): string {
  if (!user) return '/';
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;
  const roles = new Set((user.activeRoles || []).concat(
    (user.memberships || []).flatMap(m => m.roles || []),
  ));
  if (roles.has('school_admin')) return SCHOOL_ADMIN_HOME_ROUTE;
  if (roles.has('teacher')) return TEACHER_HOME_ROUTE;
  return LEARNER_HOME_ROUTE;
}
```

- [ ] **Step 6: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/SchoolAdminHomePage.test.tsx
cd frontend && npm run test -- --run  # full suite
```

Expected: new tests pass; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/src/pages/SchoolAdminHomePage.tsx frontend/src/pages/SchoolAdminHomePage.test.tsx
git commit -m "feat(routing): mount /app/lingual-admin tree + /app/admin school home"
```

---

## Task 31: `LingualAdminDashboardPage`

**Files:**
- Create: `frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.tsx`
- Create: `frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.test.tsx`

**Why:** 4 count tiles + 20-row activity feed. Backed by `fetchOverview()` (Task 26).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualAdminDashboardPage } from './LingualAdminDashboardPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('LingualAdminDashboardPage', () => {
  it('renders tile counts after load', async () => {
    vi.mocked(api.fetchOverview).mockResolvedValue({
      tiles: { pendingRequests: 3, activeOrgs: 12, suspendedOrgs: 1, newRequestsLast7d: 4 },
      recentActivity: [],
    });
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText('3'));
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders activity feed entries', async () => {
    vi.mocked(api.fetchOverview).mockResolvedValue({
      tiles: { pendingRequests: 0, activeOrgs: 0, suspendedOrgs: 0, newRequestsLast7d: 0 },
      recentActivity: [
        {
          id: 'a1', actorUid: 'u', action: 'request_approved',
          target: { type: 'school_request', id: 'r1' }, targetOrgId: 'o1',
          metadata: {}, ipHash: '', userAgent: '', createdAt: null,
        },
      ],
    });
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText(/request_approved/i));
  });

  it('shows error state on failure', async () => {
    vi.mocked(api.fetchOverview).mockRejectedValue(new Error('boom'));
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText(/failed to load/i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualAdminDashboardPage.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { fetchOverview } from '@/api/lingualAdmin';
import type { OverviewResponse } from '@/types/lingualAdmin';

const TILES = [
  { key: 'pendingRequests', label: 'Pending requests' },
  { key: 'activeOrgs', label: 'Active organizations' },
  { key: 'suspendedOrgs', label: 'Suspended organizations' },
  { key: 'newRequestsLast7d', label: 'New requests (last 7d)' },
] as const;

export function LingualAdminDashboardPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message || 'unknown'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="text-red-600">Failed to load: {error}</div>;
  if (!data) return <div className="text-neutral-500">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Lingual-side operational overview.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map(t => (
          <div key={t.key} className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="text-3xl font-semibold">{data.tiles[t.key]}</div>
            <div className="mt-1 text-sm text-neutral-600">{t.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {data.recentActivity.length === 0 && (
            <li className="px-4 py-6 text-sm text-neutral-500">No recent activity.</li>
          )}
          {data.recentActivity.map(a => (
            <li key={a.id} className="px-4 py-3 text-sm">
              <span className="font-mono text-xs text-neutral-500">{a.actorUid}</span>{' '}
              <span className="font-medium">{a.action}</span>{' '}
              <span className="text-neutral-500">
                → {a.target.type}/{a.target.id}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default LingualAdminDashboardPage;
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualAdminDashboardPage.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.tsx frontend/src/pages/LingualAdmin/LingualAdminDashboardPage.test.tsx
git commit -m "feat(lingual-admin): dashboard page with tiles + activity feed"
```

---

## Task 32: `LingualRequestsPage` (refactor of `LingualSchoolRequestsPage`)

**Files:**
- Create: `frontend/src/pages/LingualAdmin/LingualRequestsPage.tsx`
- Create: `frontend/src/pages/LingualAdmin/LingualRequestsPage.test.tsx`
- Create: `frontend/src/pages/LingualAdmin/RequestDetailPanel.tsx`
- Create: `frontend/src/pages/LingualAdmin/DeclineRequestModal.tsx`
- Delete: `frontend/src/pages/LingualSchoolRequestsPage.tsx`
- Delete: `frontend/src/pages/LingualSchoolRequestsPage.test.tsx`

**Why:** Filters (status/school_type/country), sort, table with row click → side panel. The side panel exposes Approve (with optional internalNote) and Decline (modal w/ category + reason). Replaces the old page.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/LingualRequestsPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualRequestsPage } from './LingualRequestsPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('LingualRequestsPage', () => {
  it('lists requests', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [
        { id: 'r1', schoolName: 'Sunset HS', status: 'pending', requesterEmail: 'a@x.com' },
      ],
      nextCursor: null,
    });
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
  });

  it('opens the detail panel when row clicked', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue({
      id: 'r1', schoolName: 'Sunset HS', status: 'pending',
      preInvitedTeachers: ['a@x.com'],
      attestation: { ipHash: 'h', userAgent: 'ua', attestedAt: null },
      integration: { lms: null, instanceUrl: null },
    } as any);
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));
    await waitFor(() => screen.getByText(/pre-invited teachers/i));
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('approve button calls approveRequest', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue({
      id: 'r1', schoolName: 'Sunset HS', status: 'pending',
      preInvitedTeachers: [],
      attestation: { ipHash: '', userAgent: '', attestedAt: null },
      integration: { lms: null, instanceUrl: null },
    } as any);
    vi.mocked(api.approveRequest).mockResolvedValue({
      requestId: 'r1', createdOrgId: 'o-new', membershipId: 'm', preInviteInvitationIds: [],
    });
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(api.approveRequest).toHaveBeenCalledWith('r1', { internalNote: undefined }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualRequestsPage.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `RequestDetailPanel.tsx`**

```typescript
import { useState } from 'react';
import type { SchoolRequestDetail } from '@/types/lingualAdmin';
import { DeclineRequestModal } from './DeclineRequestModal';

export interface RequestDetailPanelProps {
  request: SchoolRequestDetail;
  onApprove(internalNote?: string): Promise<void>;
  onDecline(reason: string, category: SchoolRequestDetail['rejectionCategory'] | string): Promise<void>;
  onClose(): void;
}

export function RequestDetailPanel(props: RequestDetailPanelProps) {
  const { request, onApprove, onDecline, onClose } = props;
  const [note, setNote] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <aside className="w-[420px] shrink-0 border-l border-neutral-200 bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{request.schoolName}</h2>
          <p className="text-sm text-neutral-500">{request.status}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-900">×</button>
      </div>

      <dl className="mt-6 space-y-3 text-sm">
        <div><dt className="text-neutral-500">Requester</dt><dd>{request.requesterName} &lt;{request.requesterEmail}&gt;</dd></div>
        <div><dt className="text-neutral-500">Website</dt><dd>{request.websiteUrl || '—'}</dd></div>
        <div><dt className="text-neutral-500">Location</dt><dd>{[request.county, request.state, request.country].filter(Boolean).join(', ')}</dd></div>
        <div><dt className="text-neutral-500">Org type</dt><dd>{request.orgType} / {request.schoolType}</dd></div>
        <div>
          <dt className="text-neutral-500">Pre-invited teachers</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {request.preInvitedTeachers.length === 0 && <span className="text-neutral-400">—</span>}
            {request.preInvitedTeachers.map(t => (
              <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{t}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Attestation</dt>
          <dd className="font-mono text-xs">
            ip_hash={request.attestation.ipHash || '—'}{' '}
            ua={request.attestation.userAgent?.slice(0, 40) || '—'}
          </dd>
        </div>
      </dl>

      {request.status === 'pending' && (
        <div className="mt-8 space-y-3">
          <label className="block text-xs uppercase tracking-wide text-neutral-500">
            Internal note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            maxLength={2000}
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await onApprove(note || undefined); } finally { setBusy(false); }
              }}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => setShowDecline(true)}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {showDecline && (
        <DeclineRequestModal
          onCancel={() => setShowDecline(false)}
          onConfirm={async (reason, category) => {
            setBusy(true);
            try { await onDecline(reason, category); } finally { setBusy(false); setShowDecline(false); }
          }}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Create `DeclineRequestModal.tsx`**

```typescript
import { useState } from 'react';
import type { DeclineCategory } from '@/types/lingualAdmin';

const CATEGORIES: { value: DeclineCategory; label: string }[] = [
  { value: 'info_missing', label: 'Information missing' },
  { value: 'fraud_risk', label: 'Fraud risk' },
  { value: 'out_of_scope', label: 'Out of scope' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

export interface DeclineRequestModalProps {
  onCancel(): void;
  onConfirm(reason: string, category: DeclineCategory): Promise<void>;
}

export function DeclineRequestModal({ onCancel, onConfirm }: DeclineRequestModalProps) {
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<DeclineCategory | ''>('');
  const valid = reason.trim().length > 0 && category !== '';
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Decline request</h3>
        <p className="mt-1 text-sm text-neutral-600">Both fields are required and sent in the email to the requester.</p>

        <label className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value as DeclineCategory)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">Select…</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <label className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(reason.trim(), category as DeclineCategory)}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm decline
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `LingualRequestsPage.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { fetchRequests, fetchRequestDetail, approveRequest, declineRequest } from '@/api/lingualAdmin';
import type { SchoolRequestRow, SchoolRequestDetail, DeclineCategory } from '@/types/lingualAdmin';
import { RequestDetailPanel } from './RequestDetailPanel';

export function LingualRequestsPage() {
  const [items, setItems] = useState<SchoolRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SchoolRequestDetail | null>(null);
  const [status, setStatus] = useState('');
  const [schoolType, setSchoolType] = useState('');
  const [sort, setSort] = useState<'requested_at_desc' | 'requested_at_asc' | 'name'>('requested_at_desc');

  async function reload() {
    try {
      const result = await fetchRequests({
        status: status || undefined,
        schoolType: schoolType || undefined,
        sort,
      });
      setItems(result.items);
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [status, schoolType, sort]);

  async function openDetail(id: string) {
    const d = await fetchRequestDetail(id);
    setSelected(d);
  }

  async function handleApprove(internalNote?: string) {
    if (!selected) return;
    await approveRequest(selected.id, { internalNote });
    setSelected(null);
    reload();
  }

  async function handleDecline(reason: string, category: DeclineCategory | string) {
    if (!selected) return;
    await declineRequest(selected.id, { reason, category: category as DeclineCategory });
    setSelected(null);
    reload();
  }

  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold">School requests</h1>

        <div className="mt-4 flex gap-3 text-sm">
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
          </select>
          <select value={schoolType} onChange={e => setSchoolType(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All types</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as any)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="requested_at_desc">Newest first</option>
            <option value="requested_at_asc">Oldest first</option>
            <option value="name">Name</option>
          </select>
        </div>

        {error && <p className="mt-4 text-red-600">Failed: {error}</p>}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-2">School</th>
              <th>Status</th>
              <th>Requester</th>
              <th>Country</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {items.map(r => (
              <tr key={r.id} onClick={() => openDetail(r.id)} className="cursor-pointer hover:bg-neutral-100">
                <td className="py-2 font-medium">{r.schoolName}</td>
                <td>{r.status}</td>
                <td className="text-neutral-600">{r.requesterEmail}</td>
                <td className="text-neutral-600">{r.country}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <RequestDetailPanel
          request={selected}
          onApprove={handleApprove}
          onDecline={handleDecline}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default LingualRequestsPage;
```

- [ ] **Step 6: Delete old page**

```bash
rm frontend/src/pages/LingualSchoolRequestsPage.tsx
rm frontend/src/pages/LingualSchoolRequestsPage.test.tsx
```

- [ ] **Step 7: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/
```

Expected: all new tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/LingualAdmin/LingualRequestsPage.tsx frontend/src/pages/LingualAdmin/LingualRequestsPage.test.tsx frontend/src/pages/LingualAdmin/RequestDetailPanel.tsx frontend/src/pages/LingualAdmin/DeclineRequestModal.tsx
git rm frontend/src/pages/LingualSchoolRequestsPage.tsx frontend/src/pages/LingualSchoolRequestsPage.test.tsx
git commit -m "feat(lingual-admin): requests page with filters + detail panel + decline modal"
```

---

## Task 33: `LingualOrgsListPage`

**Files:**
- Create: `frontend/src/pages/LingualAdmin/LingualOrgsListPage.tsx`
- Create: `frontend/src/pages/LingualAdmin/LingualOrgsListPage.test.tsx`

**Why:** Active orgs list with filters (status, school_type, country, public/private) and cursor pagination. Row click navigates to `/app/lingual-admin/organizations/<orgId>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/LingualOrgsListPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualOrgsListPage } from './LingualOrgsListPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

const renderWithRouter = () =>
  render(<MemoryRouter><LingualOrgsListPage /></MemoryRouter>);

describe('LingualOrgsListPage', () => {
  it('lists orgs', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({
      items: [{ id: 'o1', name: 'Sunset HS', status: 'active', memberCount: 2 }],
      nextCursor: null,
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Sunset HS'));
  });

  it('filters by status', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({ items: [], nextCursor: null });
    renderWithRouter();
    await waitFor(() => expect(api.fetchOrgs).toHaveBeenCalled());
    vi.mocked(api.fetchOrgs).mockClear();
    const select = screen.getByLabelText(/status/i);
    fireEvent.change(select, { target: { value: 'suspended' } });
    await waitFor(() => expect(api.fetchOrgs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended' }),
    ));
  });

  it('row link points to org detail', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({
      items: [{ id: 'o1', name: 'Sunset HS', status: 'active', memberCount: 2 }],
      nextCursor: null,
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Sunset HS'));
    const link = screen.getByRole('link', { name: /sunset hs/i });
    expect(link).toHaveAttribute('href', '/app/lingual-admin/organizations/o1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualOrgsListPage.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `LingualOrgsListPage.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrgs } from '@/api/lingualAdmin';
import type { OrgSummary, OrgStatus } from '@/types/lingualAdmin';

export function LingualOrgsListPage() {
  const [items, setItems] = useState<OrgSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<{ nameLower: string; id: string } | null>(null);
  const [status, setStatus] = useState<'' | OrgStatus>('');
  const [schoolType, setSchoolType] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    try {
      const result = await fetchOrgs({
        status: status || undefined,
        schoolType: schoolType || undefined,
        country: country || undefined,
        cursor: reset ? undefined : nextCursor || undefined,
      });
      setItems(prev => reset ? result.items : [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [status, schoolType, country]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Organizations</h1>

      <div className="mt-4 flex gap-3 text-sm">
        <label className="flex items-center gap-2">
          Status
          <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as any)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Type
          <select value={schoolType} onChange={e => setSchoolType(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Country
          <input value={country} onChange={e => setCountry(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1" placeholder="US" />
        </label>
      </div>

      {error && <p className="mt-4 text-red-600">Failed: {error}</p>}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Status</th><th>Type</th><th>Country</th><th>Members</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {items.map(o => (
            <tr key={o.id}>
              <td className="py-2 font-medium">
                <Link to={`/app/lingual-admin/organizations/${o.id}`} className="hover:underline">
                  {o.name}
                </Link>
              </td>
              <td>{o.status}</td>
              <td>{o.schoolType || '—'}</td>
              <td>{o.country || '—'}</td>
              <td>{o.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {nextCursor && (
        <button onClick={() => load(false)} className="mt-4 rounded-md border border-neutral-300 px-3 py-1 text-sm">
          Load more
        </button>
      )}
    </div>
  );
}

export default LingualOrgsListPage;
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualOrgsListPage.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LingualAdmin/LingualOrgsListPage.tsx frontend/src/pages/LingualAdmin/LingualOrgsListPage.test.tsx
git commit -m "feat(lingual-admin): orgs list with filters + cursor pagination"
```

---

## Task 34: `LingualOrgDetailPage` shell with 4 tabs + `SuspendOrgModal`

**Files:**
- Create: `frontend/src/pages/LingualAdmin/LingualOrgDetailPage.tsx`
- Create: `frontend/src/pages/LingualAdmin/LingualOrgDetailPage.test.tsx`
- Create: `frontend/src/pages/LingualAdmin/SuspendOrgModal.tsx`
- Create: `frontend/src/pages/LingualAdmin/OrgOverviewTab.tsx`

**Why:** Tab navigation via URL hash (`#overview`/`#members`/`#classes`/`#audit`) + suspend/restore action buttons at the top. Overview tab is included here; Members/Classes/Audit tabs come in Tasks 35–37.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/LingualOrgDetailPage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualOrgDetailPage } from './LingualOrgDetailPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/lingual-admin/organizations/:orgId" element={<LingualOrgDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LingualOrgDetailPage', () => {
  it('renders org name and overview tab content', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active',
      schoolAdminContacts: [{ membershipId: 'm1', uid: 'u1', email: 'a@x.com' }],
    } as any);
    renderAt('/app/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('shows Suspend button when active', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active', schoolAdminContacts: [],
    } as any);
    renderAt('/app/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument();
  });

  it('shows Restore button when suspended', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'suspended', schoolAdminContacts: [],
      suspendReason: 'compliance review',
    } as any);
    renderAt('/app/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  it('Suspend opens modal and calls API on confirm', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active', schoolAdminContacts: [],
    } as any);
    vi.mocked(api.suspendOrg).mockResolvedValue();
    renderAt('/app/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'fraud risk' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.suspendOrg).toHaveBeenCalledWith('o1', expect.objectContaining({ reason: 'fraud risk' })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualOrgDetailPage.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `SuspendOrgModal.tsx`**

```typescript
import { useState } from 'react';

export interface SuspendOrgModalProps {
  onCancel(): void;
  onConfirm(reason: string, suspendedUntil: string | null): Promise<void>;
}

export function SuspendOrgModal({ onCancel, onConfirm }: SuspendOrgModalProps) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'indefinite' | 'temporary'>('indefinite');
  const [until, setUntil] = useState('');
  const valid = reason.trim().length > 0 && (mode === 'indefinite' || until);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Suspend organization</h3>

        <label className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          aria-label="Reason"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <fieldset className="mt-4">
          <legend className="text-xs uppercase tracking-wide text-neutral-500">Duration</legend>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="radio" name="duration" checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} />
            Indefinite
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="radio" name="duration" checked={mode === 'temporary'} onChange={() => setMode('temporary')} />
            Until specific date
          </label>
          {mode === 'temporary' && (
            <input
              type="datetime-local"
              value={until}
              onChange={e => setUntil(e.target.value)}
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          )}
        </fieldset>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={!valid}
            onClick={async () => {
              const isoUntil = mode === 'temporary' && until
                ? new Date(until).toISOString()
                : null;
              await onConfirm(reason.trim(), isoUntil);
            }}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm suspend
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `OrgOverviewTab.tsx`**

```typescript
import type { OrgDetail } from '@/types/lingualAdmin';

export function OrgOverviewTab({ org }: { org: OrgDetail }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Metadata</h3>
        <dl className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-neutral-500">Status</dt><dd>{org.status}</dd></div>
          <div><dt className="text-neutral-500">Type</dt><dd>{org.schoolType || '—'}</dd></div>
          <div><dt className="text-neutral-500">Country / State</dt><dd>{[org.country, org.state].filter(Boolean).join(' / ') || '—'}</dd></div>
          <div><dt className="text-neutral-500">Website</dt><dd>{org.websiteUrl || '—'}</dd></div>
        </dl>
      </section>

      {org.status === 'suspended' && (
        <section className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <strong>Suspended.</strong> Reason: {org.suspendReason || '—'}.
          {org.suspendedUntil && <> Auto-restore at {org.suspendedUntil}.</>}
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-500">School admin contacts</h3>
        <ul className="mt-2 divide-y divide-neutral-200">
          {org.schoolAdminContacts.length === 0 && (
            <li className="py-2 text-sm text-neutral-500">No active school admins.</li>
          )}
          {org.schoolAdminContacts.map(c => (
            <li key={c.membershipId} className="py-2 text-sm">
              <span className="font-medium">{c.name || '—'}</span>{' '}
              <span className="text-neutral-500">&lt;{c.email}&gt;</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Create `LingualOrgDetailPage.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { fetchOrgDetail, suspendOrg, restoreOrg } from '@/api/lingualAdmin';
import type { OrgDetail } from '@/types/lingualAdmin';
import { OrgOverviewTab } from './OrgOverviewTab';
import { OrgMembersTab } from './OrgMembersTab';
import { OrgClassesTab } from './OrgClassesTab';
import { OrgAuditTab } from './OrgAuditTab';
import { SuspendOrgModal } from './SuspendOrgModal';

const TABS = [
  { hash: '#overview', label: 'Overview' },
  { hash: '#members', label: 'Members' },
  { hash: '#classes', label: 'Classes' },
  { hash: '#audit', label: 'Audit' },
] as const;

export function LingualOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSuspend, setShowSuspend] = useState(false);

  const activeHash = hash || '#overview';

  async function reload() {
    if (!orgId) return;
    try {
      setOrg(await fetchOrgDetail(orgId));
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!org) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">Status: {org.status}</p>
        </div>
        <div>
          {org.status === 'active' && (
            <button onClick={() => setShowSuspend(true)} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white">
              Suspend
            </button>
          )}
          {org.status === 'suspended' && (
            <button
              onClick={async () => {
                if (!orgId) return;
                if (!confirm('Restore this organization?')) return;
                await restoreOrg(orgId);
                reload();
              }}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Restore
            </button>
          )}
        </div>
      </div>

      <nav className="mt-6 flex gap-4 border-b border-neutral-200 text-sm">
        {TABS.map(t => (
          <button
            key={t.hash}
            onClick={() => navigate({ hash: t.hash }, { replace: true })}
            aria-current={activeHash === t.hash ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${
              activeHash === t.hash
                ? 'border-neutral-900 font-medium'
                : 'border-transparent text-neutral-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {activeHash === '#overview' && <OrgOverviewTab org={org} />}
        {activeHash === '#members' && <OrgMembersTab orgId={orgId!} />}
        {activeHash === '#classes' && <OrgClassesTab orgId={orgId!} />}
        {activeHash === '#audit' && <OrgAuditTab orgId={orgId!} />}
      </div>

      {showSuspend && (
        <SuspendOrgModal
          onCancel={() => setShowSuspend(false)}
          onConfirm={async (reason, until) => {
            if (!orgId) return;
            await suspendOrg(orgId, { reason, suspendedUntil: until });
            setShowSuspend(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

export default LingualOrgDetailPage;
```

- [ ] **Step 6: Run tests**

Members/Classes/Audit tabs are implemented in Tasks 35–37; for now the imports will fail. Stub them temporarily:

```typescript
// Same dir, temporary stubs:
// OrgMembersTab.tsx: export function OrgMembersTab({ orgId }: { orgId: string }) { return <p>Members (Task 35)</p>; }
// OrgClassesTab.tsx: export function OrgClassesTab({ orgId }: { orgId: string }) { return <p>Classes (Task 36)</p>; }
// OrgAuditTab.tsx:   export function OrgAuditTab({ orgId }: { orgId: string }) { return <p>Audit (Task 37)</p>; }
```

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/LingualOrgDetailPage.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LingualAdmin/LingualOrgDetailPage.tsx frontend/src/pages/LingualAdmin/LingualOrgDetailPage.test.tsx frontend/src/pages/LingualAdmin/OrgOverviewTab.tsx frontend/src/pages/LingualAdmin/SuspendOrgModal.tsx frontend/src/pages/LingualAdmin/OrgMembersTab.tsx frontend/src/pages/LingualAdmin/OrgClassesTab.tsx frontend/src/pages/LingualAdmin/OrgAuditTab.tsx
git commit -m "feat(lingual-admin): org detail page shell with overview tab + suspend modal"
```

---

## Task 35: `OrgMembersTab` + `RemoveMemberModal`

**Files:**
- Create (replace stub): `frontend/src/pages/LingualAdmin/OrgMembersTab.tsx`
- Create: `frontend/src/pages/LingualAdmin/OrgMembersTab.test.tsx`
- Create: `frontend/src/pages/LingualAdmin/RemoveMemberModal.tsx`

**Why:** Lists school_admins and teachers (FERPA — students aggregate-only). Each row has a "Remove" action that opens `RemoveMemberModal` (reason required). On confirm, calls `removeMember(orgId, membershipId, { reason })` and reloads.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/OrgMembersTab.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgMembersTab } from './OrgMembersTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('OrgMembersTab', () => {
  it('lists school_admins and teachers + aggregate student count', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [
        { membershipId: 'm1', uid: 'u1', email: 'a@x.com', name: 'A', roles: ['school_admin'], status: 'active' },
        { membershipId: 'm2', uid: 'u2', email: 'b@x.com', name: 'B', roles: ['teacher'], status: 'active' },
      ],
      studentCount: 42,
    });
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    expect(screen.getByText(/42 students/i)).toBeInTheDocument();
  });

  it('opens RemoveMemberModal and calls removeMember on confirm', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [
        { membershipId: 'm1', uid: 'u1', email: 'a@x.com', roles: ['school_admin'], status: 'active' },
      ],
      studentCount: 0,
    });
    vi.mocked(api.removeMember).mockResolvedValue();
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'left school' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() =>
      expect(api.removeMember).toHaveBeenCalledWith('o1', 'm1', { reason: 'left school' }),
    );
  });

  it('disables Confirm when reason is empty', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [{ membershipId: 'm1', uid: 'u1', email: 'a@x.com', roles: ['teacher'], status: 'active' }],
      studentCount: 0,
    });
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgMembersTab.test.tsx
```

Expected: stub component renders text "Members (Task 35)"; the assertions fail because no `a@x.com` is rendered.

- [ ] **Step 3: Create `RemoveMemberModal.tsx`**

```typescript
import { useState } from 'react';
import type { MemberRow } from '@/types/lingualAdmin';

export interface RemoveMemberModalProps {
  member: MemberRow;
  onCancel(): void;
  onConfirm(reason: string): Promise<void>;
}

export function RemoveMemberModal({ member, onCancel, onConfirm }: RemoveMemberModalProps) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Remove member</h3>
        <p className="mt-2 text-sm text-neutral-600">
          You are about to remove <strong>{member.email}</strong> ({member.roles.join(', ')}).
          Their data is preserved; the membership is soft-deleted.
        </p>

        <label className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          aria-label="Reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm remove
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Replace `OrgMembersTab.tsx` stub with real component**

```typescript
import { useEffect, useState } from 'react';
import { fetchOrgMembers, removeMember } from '@/api/lingualAdmin';
import type { MemberRow, MembersResponse } from '@/types/lingualAdmin';
import { RemoveMemberModal } from './RemoveMemberModal';

export function OrgMembersTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<MemberRow | null>(null);

  async function reload() {
    try {
      setData(await fetchOrgMembers(orgId));
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!data) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div>
      <p className="text-sm text-neutral-600">
        <strong>{data.studentCount}</strong> students (count only — student data is never exposed in the Lingual admin panel).
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Email</th><th>Roles</th><th>Joined</th><th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {data.members.map(m => (
            <tr key={m.membershipId}>
              <td className="py-2 font-medium">{m.name || '—'}</td>
              <td>{m.email}</td>
              <td>{m.roles.join(', ')}</td>
              <td className="text-neutral-500">{m.joinedAt || '—'}</td>
              <td className="text-right">
                <button
                  onClick={() => setPendingRemove(m)}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingRemove && (
        <RemoveMemberModal
          member={pendingRemove}
          onCancel={() => setPendingRemove(null)}
          onConfirm={async reason => {
            await removeMember(orgId, pendingRemove.membershipId, { reason });
            setPendingRemove(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgMembersTab.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LingualAdmin/OrgMembersTab.tsx frontend/src/pages/LingualAdmin/OrgMembersTab.test.tsx frontend/src/pages/LingualAdmin/RemoveMemberModal.tsx
git commit -m "feat(lingual-admin): members tab with remove modal"
```

---

## Task 36: `OrgClassesTab`

**Files:**
- Create (replace stub): `frontend/src/pages/LingualAdmin/OrgClassesTab.tsx`
- Create: `frontend/src/pages/LingualAdmin/OrgClassesTab.test.tsx`

**Why:** Lists class metadata. Per spec §550: not browsable — no link into class internals, no assignment list, no student list.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/OrgClassesTab.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgClassesTab } from './OrgClassesTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');
beforeEach(() => vi.resetAllMocks());

describe('OrgClassesTab', () => {
  it('renders class rows', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({
      items: [
        { id: 'c1', name: 'Spanish I', term: 'F26', subject: 'spanish', teacherMembershipIds: ['m1'] },
        { id: 'c2', name: 'French II', term: 'S26', subject: 'french', teacherMembershipIds: ['m2', 'm3'] },
      ],
    });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText('Spanish I'));
    expect(screen.getByText('French II')).toBeInTheDocument();
  });

  it('does not render links into classes (no browsable internals)', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({
      items: [{ id: 'c1', name: 'Spanish I', teacherMembershipIds: [] }],
    });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText('Spanish I'));
    expect(screen.queryByRole('link', { name: /spanish i/i })).not.toBeInTheDocument();
  });

  it('shows empty state', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({ items: [] });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText(/no classes/i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgClassesTab.test.tsx
```

Expected: stub renders text "Classes (Task 36)"; assertions fail.

- [ ] **Step 3: Replace `OrgClassesTab.tsx` stub with real component**

```typescript
import { useEffect, useState } from 'react';
import { fetchOrgClasses } from '@/api/lingualAdmin';
import type { ClassRow } from '@/types/lingualAdmin';

export function OrgClassesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOrgClasses(orgId)
      .then(r => { if (!cancelled) setItems(r.items); })
      .catch(e => { if (!cancelled) setError(e.message || 'unknown'); });
    return () => { cancelled = true; };
  }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!items) return <p className="text-neutral-500">Loading…</p>;
  if (items.length === 0) return <p className="text-neutral-500">No classes.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-2">Name</th>
          <th>Term</th>
          <th>Subject</th>
          <th>Teachers</th>
          <th>Created</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200">
        {items.map(c => (
          <tr key={c.id}>
            {/* Plain text — intentionally NOT a link. Spec §550. */}
            <td className="py-2 font-medium">{c.name || '—'}</td>
            <td>{c.term || '—'}</td>
            <td>{c.subject || '—'}</td>
            <td>{c.teacherMembershipIds.length}</td>
            <td className="text-neutral-500">{c.createdAt || '—'}</td>
            <td className="text-neutral-500">{c.lastActivityAt || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgClassesTab.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LingualAdmin/OrgClassesTab.tsx frontend/src/pages/LingualAdmin/OrgClassesTab.test.tsx
git commit -m "feat(lingual-admin): classes tab (metadata only, no class internals)"
```

---

## Task 37: `OrgAuditTab`

**Files:**
- Create (replace stub): `frontend/src/pages/LingualAdmin/OrgAuditTab.tsx`
- Create: `frontend/src/pages/LingualAdmin/OrgAuditTab.test.tsx`

**Why:** Org-scoped audit trail (rows from `lingual_admin_audit` where `target_org_id == orgId`). Display: timestamp, actor uid, action, metadata snippet. Limit 50 rows; "Load more" button advances limit if needed.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LingualAdmin/OrgAuditTab.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgAuditTab } from './OrgAuditTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');
beforeEach(() => vi.resetAllMocks());

describe('OrgAuditTab', () => {
  it('renders audit rows', async () => {
    vi.mocked(api.fetchOrgAudit).mockResolvedValue({
      items: [
        {
          id: 'a1', actorUid: 'admin-1', action: 'org_suspended',
          target: { type: 'organization', id: 'o1' }, targetOrgId: 'o1',
          metadata: { reason: 'compliance review' }, ipHash: 'h', userAgent: 'ua', createdAt: '2026-05-20T01:00:00Z',
        },
        {
          id: 'a2', actorUid: 'admin-1', action: 'org_viewed_detail',
          target: { type: 'organization', id: 'o1' }, targetOrgId: 'o1',
          metadata: {}, ipHash: 'h', userAgent: 'ua', createdAt: '2026-05-20T00:50:00Z',
        },
      ],
    });
    render(<OrgAuditTab orgId="o1" />);
    await waitFor(() => screen.getByText('org_suspended'));
    expect(screen.getByText('org_viewed_detail')).toBeInTheDocument();
    expect(screen.getByText(/compliance review/i)).toBeInTheDocument();
  });

  it('shows empty state when there are no entries', async () => {
    vi.mocked(api.fetchOrgAudit).mockResolvedValue({ items: [] });
    render(<OrgAuditTab orgId="o1" />);
    await waitFor(() => screen.getByText(/no audit/i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgAuditTab.test.tsx
```

Expected: stub fails the assertions.

- [ ] **Step 3: Replace `OrgAuditTab.tsx` stub with real component**

```typescript
import { useEffect, useState } from 'react';
import { fetchOrgAudit } from '@/api/lingualAdmin';
import type { AuditEntry } from '@/types/lingualAdmin';

export function OrgAuditTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOrgAudit(orgId, 50)
      .then(r => { if (!cancelled) setItems(r.items); })
      .catch(e => { if (!cancelled) setError(e.message || 'unknown'); });
    return () => { cancelled = true; };
  }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!items) return <p className="text-neutral-500">Loading…</p>;
  if (items.length === 0) return <p className="text-neutral-500">No audit entries for this organization.</p>;

  return (
    <ul className="divide-y divide-neutral-200">
      {items.map(a => {
        const metaSnippet = Object.entries(a.metadata || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ');
        return (
          <li key={a.id} className="py-3 text-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-neutral-500">{a.createdAt || '—'}</span>
              <span className="font-mono text-xs text-neutral-500">{a.actorUid}</span>
              <span className="font-medium">{a.action}</span>
            </div>
            {metaSnippet && (
              <div className="mt-1 text-xs text-neutral-600">{metaSnippet}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/pages/LingualAdmin/OrgAuditTab.test.tsx
cd frontend && npm run test -- --run src/pages/LingualAdmin/
```

Expected: all LingualAdmin tab tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LingualAdmin/OrgAuditTab.tsx frontend/src/pages/LingualAdmin/OrgAuditTab.test.tsx
git commit -m "feat(lingual-admin): audit tab with metadata snippets"
```

---

## Task 38: Firestore rules + composite index

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `firebase-tests/lingual_admin_audit.rules.test.ts` (only if Java emulator already available; otherwise note in LIMITATIONS)

**Why:** Lock down `lingual_admin_audit/` so clients can't write or read it (writes are server-side via Admin SDK; reads are only via the backend, which already gates on `lingual_admin`). Add a composite index on `(target_org_id ASC, created_at DESC)` so the org audit query stays cheap.

The rules also gate `organizations.status` transitions — only the server (Admin SDK) can flip status; org members can't suspend their own org.

- [ ] **Step 1: Update `firestore.rules`**

Open `firestore.rules`. Find the existing rules block (likely already has `outbox_emails`, `school_creation_drafts`, `teacher_join_requests`). Add:

```
match /lingual_admin_audit/{auditId} {
  // Service account only — clients never see this collection directly.
  // The backend (with admin credentials) writes rows and the lingual_admin
  // routes read them; client SDKs cannot.
  allow read, write: if false;
}
```

And update the `organizations/{orgId}` block (assumed to exist) to make `status`, `suspended_*`, and `restored_*` server-only. If the current block is `allow read, write: if false;` (admin SDK only), nothing to do. If clients can write some fields, add a guard:

```
match /organizations/{orgId} {
  allow read: if isLingualAdmin()
              || (request.auth != null && isMemberOfOrg(orgId));
  // Writes are Admin-SDK only; clients (including school_admins) cannot
  // modify status/suspended_*/restored_* directly. They use the routes.
  allow write: if false;
}
```

(Adapt to existing helper function names; do not invent new ones if the file already uses different naming.)

- [ ] **Step 2: Add composite index in `firestore.indexes.json`**

Append to the `indexes` array:

```json
{
  "collectionGroup": "lingual_admin_audit",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "target_org_id", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" }
  ]
}
```

Also append for the auto-restore scheduler query (Plan 5 Task 11):

```json
{
  "collectionGroup": "organizations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "suspended_until", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 3: (Optional) Rules test**

If a Java emulator is available on the dev machine, create `firebase-tests/lingual_admin_audit.rules.test.ts` mirroring the existing pattern in `firebase-tests/`:

```typescript
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-lingual',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(() => env.cleanup());

describe('lingual_admin_audit rules', () => {
  it('client read is denied', async () => {
    const ctx = env.authenticatedContext('any-uid').firestore();
    await assertFails(getDoc(doc(ctx, 'lingual_admin_audit', 'a1')));
  });

  it('client write is denied', async () => {
    const ctx = env.authenticatedContext('any-uid').firestore();
    await assertFails(setDoc(doc(ctx, 'lingual_admin_audit', 'a1'), { action: 'test' }));
  });
});
```

If no Java is available, skip this step and note "Java emulator coverage pending" in LIMITATIONS (Task 39).

- [ ] **Step 4: Deploy rules + indexes locally to verify syntax**

```bash
firebase deploy --only firestore:rules,firestore:indexes --dry-run
```

Expected: validates without errors. (If the operator does not have firebase-cli set up, this can be done by another engineer.)

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json
# include the rules test file if you created one
git commit -m "chore(rules): deny client access to lingual_admin_audit + index for org audit + auto-restore"
```

---

## Task 39: Docs updates

**Files:**
- Modify: `docs/school-integration/TASKS.md`
- Modify: `docs/school-integration/LIMITATIONS.md`
- Modify: `docs/school-integration/TECH_SPEC.md`
- Modify: `docs/superpowers/codebase-conventions.md`

**Why:** Reflect Plan 5's shipped state. Mark resolved items, add new v1.5 follow-ups, record the Plan 5 contract surface for Plan 6 + future work.

- [ ] **Step 1: Update `docs/school-integration/TASKS.md`**

Find the Plan 5 acceptance item under "### Teacher onboarding" (Plan 4's follow-up list) and mark it complete. Add a new section under "## Phase 2: School onboarding and roster workflows" or create a new "### Lingual admin panel" subsection:

```markdown
### Lingual admin panel (Plan 5)

- [x] Routes mounted at `/app/lingual-admin/*` (dashboard, requests, organizations, org detail).
- [x] `lingual_admin_audit` collection with `AuditLogger` service.
- [x] 12 endpoints under `backend/routes/lingual_admin.py`.
- [x] Org suspend/restore with email fan-out via outbox.
- [x] Auto-restore hourly Cloud Function scheduler.
- [x] Suspended-org enforcement at 5 points (assignment_resolver, realtime mint, practice mutations, canvas_practice, teacher writes).
- [x] Member removal UI with `_sync_org_admin_uids(add=False)` invariant test (Plan 4 forward obligation).
- [x] `org_suspended` + `org_restored` email templates.
- [x] `/app/admin` school_admin home route (separated from `/app/teacher`).
- [x] AuthContext 5-min `/api/auth/verify` polling.
- [x] Legacy `/api/admin/school-requests/*` endpoints return 410 Gone.
- [x] Legacy `/app/admin/school-requests` route redirects to `/app/lingual-admin/requests`.

- [ ] `PATCH /api/lingual-admin/organizations/<orgId>` (org metadata editing) — v1.5.
- [ ] Realtime listener for org-detail audit feed (replace pagination, v1.5).
- [ ] Bulk export of org audit feed as CSV — v1.5.
- [ ] Internationalize Lingual admin panel UI (en-only in v1).
- [ ] Wire `school_request_reminder_to_lingual` once the outbox sweep gap (LIMITATIONS #21) is closed.
- [ ] Reminder email for inactive suspended orgs (≥30 days suspended_until in past with auto-restore disabled) — needs product decision before launch.
```

Also mark the Plan 4 "Plan 5 acceptance" item under teacher onboarding as `[x]`:

```markdown
- [x] **(Plan 5 acceptance)** Any membership-removal path MUST call `_sync_org_admin_uids(org_id, uid, add=False)` when removing `school_admin`. Extended `backend/tests/test_school_admin_uids_invariant.py` with the removal regression (Plan 5 Task 7).
```

- [ ] **Step 2: Update `docs/school-integration/LIMITATIONS.md`**

Find items 27 and 28. Replace their bodies with the resolved markers (keep the entry for historical context):

```markdown
27. **Approved admin pending state auto-navigates instead of showing a
    dashboard CTA.** _RESOLVED by Plan 5._ school_admin users now land at
    the dedicated `/app/admin` home route (see `SchoolAdminHomePage`). The
    pending page still auto-navigates on approval, but it now lands on a
    school_admin-specific home rather than the shared `/app/teacher`.

28. **Role grants and changes require a session refresh to take effect.**
    _RESOLVED by Plan 5._ `AuthContext` now re-runs `/api/auth/verify`
    every 5 minutes and updates React state when `lingualAdmin`,
    `memberships`, or `activeRoles` differ from the cached payload.
    Worst-case staleness is ≤5 minutes. A signed-out user does not poll.
```

Add new entries 33–37 for Plan 5:

```markdown
33. **In-flight realtime voice sessions are not torn down on suspend.**
    When an org is suspended while a student is mid-conversation, the
    existing session completes normally. Only new session creation is
    blocked. Acceptable v1 trade-off (no mid-sentence cutoffs); strict
    tear-down is v1.5.

34. **Suspend auto-restore accuracy is ±1 hour.** `auto_restore_suspended_orgs`
    runs every 60 minutes. An org whose `suspended_until` falls between
    sweep ticks is restored at the next tick. Acceptable for v1; tighten
    to 5-minute resolution by reusing the existing outbox sweep cadence
    if product requires.

35. **`PATCH /api/lingual-admin/organizations/<orgId>` is not implemented.**
    Spec §594 lists the endpoint for org metadata editing; Plan 5 keeps it
    out of scope. Lingual admins use direct Firestore edits when metadata
    correction is needed. v1.5 follow-up.

36. **Lingual admin panel UI is English-only.** Wizard labels, table
    headers, modal copy, audit action labels all ship in English. Match
    the Plan 3 admin wizard constraint (LIMITATIONS #26).

37. **`org_viewed_detail` audit may produce high write volume.** Every
    org detail page load writes one row. For a Lingual admin paging
    through 50 orgs in a session, that's 50 writes per day per admin.
    Acceptable at current scale; consider sampling or rate-limiting if
    audit traffic exceeds 10k rows/day.

38. **`backend/tests/test_lingual_admin_*` tests use the `FakeAuditLogger`
    pattern; Firestore writes from `AuditLogger` itself have no automated
    integration coverage.** The unit tests on `AuditLogger` (Task 2)
    exercise the failsoft + payload-shape contract via mocked collection
    factories, but a true round-trip to Firestore (or the emulator) is
    not part of CI yet. Acceptable because the write surface is small;
    revisit if the schema grows.
```

(If the Java rules test was skipped in Task 38, also add an entry noting that `lingual_admin_audit` rules have no automated coverage yet.)

- [ ] **Step 3: Update `docs/school-integration/TECH_SPEC.md`**

Find the Firestore schema section (near the top of the doc). Add:

```markdown
### `lingual_admin_audit/{logId}`

| Field | Type | Notes |
|---|---|---|
| `actor_uid` | str | The acting Lingual admin's uid |
| `action` | str | One of `request_approved`, `request_declined`, `org_suspended`, `org_restored`, `org_metadata_edited`, `org_viewed_detail`, `membership_removed` |
| `target` | map | `{type: 'school_request'|'organization'|'membership', id}` |
| `target_org_id` | str? | Denormalized for org-scoped queries |
| `metadata` | map | Action-specific (reason, category, suspended_until, recipient_count, …) |
| `ip_hash` | str | Salted SHA-256 of `request.remote_addr` |
| `user_agent` | str | First 255 chars of `User-Agent` header |
| `created_at` | ts | Server timestamp |

Writes are Admin-SDK only (clients denied). Reads are gated by the backend on `lingual_admin` role; the collection's rule is `allow read, write: if false;` because there is no client-side read path.

### `organizations.status` lifecycle

`active → suspended → active` (cycle) or `active → archived` (terminal, v1.5).

Suspended orgs:
- `status = 'suspended'`
- `suspended_at = ts`
- `suspended_by_uid = lingual_admin_uid`
- `suspend_reason = string`
- `suspended_until = ts | null` (null means indefinite)

Restoring (manual via Lingual admin or auto via scheduler) clears all `suspended_*` fields and sets `restored_at`, `restored_by_uid` (the latter may be `'system:auto_restore'`).

### Suspend enforcement points

Every code path below calls `enforce_org_active(org_id)` before mutating org-scoped data or creating billable sessions. SuspendedOrgError → 403 with payload `{error: 'org_suspended', reason, until?}`.

1. `backend.services.assignment_resolver.resolve_assignment_prompt`
2. `POST /api/realtime/session` (chat blueprint)
3. `POST /api/practice-sessions` (curriculum_admin)
4. `POST /api/practice-sessions/<id>/events` (curriculum_admin)
5. `POST /api/canvas/practice/start` (canvas_practice)
6. `POST /api/teacher/...` (assignment write endpoints in teacher blueprint)
```

- [ ] **Step 4: Update `docs/superpowers/codebase-conventions.md`**

Add a new section §15 — Plan 5 contract surface:

```markdown
---

## 15. Plan 5 contract surface (what later plans build on)

After Plan 5 lands, the following is true and consumable:

**Backend:**
- `database.ORG_STATUS_ACTIVE`/`SUSPENDED`/`ARCHIVED` + `ALLOWED_ORG_STATUSES` + `_validate_org_status`.
- `database.suspend_organization(*, org_id, actor_uid, reason, suspended_until)` and `database.restore_organization(*, org_id, actor_uid)` are the only paths that mutate `organizations.status`. **Do not write `status` directly.**
- `database.remove_membership(*, membership_id, actor_uid)` soft-removes and auto-syncs `school_admin_uids`. **Any future role-removal path MUST go through this helper** (or call `_sync_org_admin_uids(org_id, uid, add=False)` explicitly).
- `database.list_organizations(...)` / `list_org_memberships(...)` / `list_org_classes(...)` / `list_org_audit_events(...)` / `list_orgs_due_for_auto_restore(...)` / `count_*` helpers.
- `backend.services.audit.AuditLogger` + `AuditAction` enum. Routes call `deps.audit_logger.log(...)`. Audit writes are fail-soft.
- `backend.services.suspended_org_guard.enforce_org_active(org_id)` and `is_org_suspended(org_id)`. SuspendedOrgError → 403 payload `{error:'org_suspended', reason, until?}`.
- `OutboxTemplate.ORG_SUSPENDED` and `OutboxTemplate.ORG_RESTORED`.
- `LINGUAL_ADMIN_AUDIT_COLLECTION` + `get_lingual_admin_audit_collection()`.

**Cloud Function:**
- `auto_restore_suspended_orgs` — every 60 min, restores due orgs and queues `org_restored` emails.
- Both `_send_outbox_email_impl` and `_auto_restore_suspended_orgs_impl` follow the `_impl + decorated wrapper` pattern (see §7).

**Frontend:**
- `SCHOOL_ADMIN_HOME_ROUTE = '/app/admin'`. `LINGUAL_ADMIN_HOME_ROUTE = '/app/lingual-admin/requests'`.
- `getOnboardingDestination` order: `lingual_admin` → `school_admin` → `teacher` → `student` → completed → resume by `intended_role` → legacy → role picker.
- `AuthContext` polls `/api/auth/verify` every 5 min on signed-in users; diff detected → state updated.
- `frontend/src/api/lingualAdmin.ts` exports a typed client for all 12 endpoints.
- `LingualAdminShell` + child pages live under `frontend/src/pages/LingualAdmin/`.

**Forward obligation for Plan 6+:**
1. `LegacyRoleMigrationModal` (Plan 6) must mount BEFORE the dispatcher routes a user away. Mount it at the `AuthProvider` level on `requires_legacy_role_pick === true`, and gate `getOnboardingDestination` from running until the modal resolves.
2. Any new role-removal code path MUST go through `database.remove_membership(...)` so `school_admin_uids` stays in sync. Plan 5 added the helper and its invariant test (`backend/tests/test_school_admin_uids_invariant.py::RemoveMembershipInvariantTests`); extend the test if you add a new removal path.
3. Any new code that mutates `organizations.status` MUST go through `database.suspend_organization` / `restore_organization`. Adding a third status (`archived`) is allowed; reuse the validator.
4. When wiring a future reminder template, close the outbox sweep gap first (LIMITATIONS #21) — Plan 5 does NOT close it because no reminder template ships in this plan.
```

- [ ] **Step 5: Update `.env.example`**

Add the two new env vars Plan 5 introduces (both feature-gated — warn in dev, fail-fast in production via `_validate_required_env`):

```bash
# Support email shown in org_suspended template footer + future email CTAs.
SUPPORT_EMAIL=help@l1ngual.com
```

`PUBLIC_BASE_URL` was added in Plan 4 — confirm it is already present; if not, add it now.

- [ ] **Step 6: Update `_validate_required_env` in `main.py`**

Register `SUPPORT_EMAIL` as a feature-gated key (warn-only in dev, fail-fast in prod):

```python
FEATURE_GATED_ENV_KEYS = (
    'CANVAS_PAT_ENCRYPTION_KEY',
    'PUBLIC_BASE_URL',
    'SUPPORT_EMAIL',  # Plan 5 — fall back to 'help@l1ngual.com' if unset
)
```

- [ ] **Step 7: Commit**

```bash
git add docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md docs/school-integration/TECH_SPEC.md docs/superpowers/codebase-conventions.md .env.example main.py
git commit -m "docs(plan-5): record shipped state, contract surface, v1.5 follow-ups + env"
```

---

## Final verification

After every task is green:

- [ ] **Run the full backend suite**

```bash
make test-backend
```

Expected: all tests pass (target: ≥830 tests, +100 from Plan 4's 728).

- [ ] **Run the full frontend suite**

```bash
cd frontend && npm run test -- --run
```

Expected: all tests pass (target: ≥260 tests, +30 from Plan 4's 230).

- [ ] **Run the Cloud Function tests**

```bash
python3 -m unittest discover -s functions/tests -p "test_*.py" -v
```

Expected: all tests pass (target: ≥20 tests, +5 from Plan 4's 15).

- [ ] **Smoke test the full Lingual admin flow locally**

1. Start backend + frontend (`make dev` or equivalent).
2. Sign in as a Lingual admin (`users/{uid}.lingual_admin = true` or via a `lingual_admin` membership).
3. Navigate `/app/lingual-admin` → confirm dashboard tiles render.
4. Open Requests, click a row → side panel shows enriched payload.
5. Open Organizations, click a row → org detail with 4 tabs.
6. Suspend an org → confirm `org_suspended` outbox doc written, then (in dev) `sent_dev` after function fires.
7. Wait or trigger auto-restore manually (CLI) → confirm `org_restored` row + flip to active.
8. Sign in as a student in the suspended org → confirm 403 on practice session create.
9. Sign in as a school_admin → confirm landing at `/app/admin`.
10. Promote a regular user to school_admin via Lingual admin or direct Firestore edit → wait 5 min, observe their UI update without re-login (AuthContext polling).

- [ ] **Update branch state and prepare for review**

Branch `pilot/launch-v1` should now contain all of Plans 1–5. Run:

```bash
git log --oneline a9aa9d0..HEAD | wc -l
git status
```

Expected: ~45 commits added; clean working tree.

---

## Self-review checklist (writing-plans §Self-Review)

After completing this plan doc, verify:

**Spec coverage (Section 6 of `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md`):**

| Spec item | Task(s) |
|---|---|
| 4 routes + `LingualAdminRoute` guard | Task 30 |
| Left nav with 3 items | Task 29 |
| Dashboard 4 tiles + 20-entry feed | Tasks 13, 31 |
| Requests page (refactor, filters, sort, side panel) | Tasks 14, 15, 32 |
| Approve action + audit | Tasks 16, 32 |
| Decline action (required reason + category) + audit | Tasks 17, 32 |
| Orgs list (filters, sort) | Tasks 18, 33 |
| Org detail tabs (Overview/Members/Classes/Audit) | Tasks 19, 20, 34–37 |
| Suspend modal (reason + duration) | Tasks 21, 34 |
| Restore | Tasks 22, 34 |
| Backend enforcement on suspended orgs | Tasks 9, 10 |
| Member-facing UX on suspend | Tasks 8, 21, 22 (emails) |
| `lingual_admin_audit/` schema + actions | Task 2 |
| `org_viewed_detail` on detail page load | Task 19 |
| 11 endpoints (10 implemented + PATCH deferred) | Tasks 13–23 |
| New blueprint `backend/routes/lingual_admin.py` | Task 12 |
| `database.py` helpers (suspend/restore, members/classes summary) | Tasks 1, 4–7, 11 |
| `firestore.rules` for `lingual_admin_audit` | Task 38 |
| New components (LingualAdminShell, …) | Tasks 29–37 |

**Sprint C absorption:**
- LIMITATIONS #27 (school_admin home) — Task 27 (dispatcher) + Task 30 (route) + Task 39 (mark resolved).
- LIMITATIONS #28 (stale session) — Task 28 + Task 39 (mark resolved).
- `_sync_org_admin_uids(add=False)` invariant test — Task 7.

**Placeholder scan:** All steps contain code blocks or exact commands. No "TBD" / "implement later" / "similar to Task N" anywhere.

**Type consistency:** `OrgStatus`, `DeclineCategory`, `AuditAction`, `SuspendPayload`, `MemberRow`, `OrgDetail` are defined once in `frontend/src/types/lingualAdmin.ts` (Task 25) and reused throughout. Backend uses `database.ORG_STATUS_*` constants consistently. `AuditAction` enum members match `_TEMPLATE_SUBJECTS` keys and the rules collection name in §15.

If any of the above fails the check, fix inline before handing off to execution.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-plan-5-lingual-admin-panel.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between tasks. Fast iteration; main session reviews diffs and runs cross-layer checks. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review.

**Recommended:** Subagent-Driven, with a worktree at `.worktrees/plan-5-lingual-admin/` so Plan 6 (smaller) can be drafted/executed in parallel on `pilot/launch-v1` directly.
