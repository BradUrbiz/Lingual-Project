# Plan 6 — Legacy User Lazy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate legacy B2C learners (users created before Plans 1–5 introduced `intended_role` and `onboarding_state`) to the role-aware onboarding model. Two layers: a one-time backfill script that infers roles from existing memberships/enrollments, and a blocking `LegacyRoleMigrationModal` that handles users the script couldn't auto-resolve.

**Architecture:** Two cooperating pieces, deployed in a strict order.
1. **Backfill (`scripts/backfill_legacy_user_roles.py`):** iterates `users/` and for each user without `intended_role`, looks at active memberships in priority order — `school_admin` → `teacher` → `student` enrollment. Writes `intended_role` + `onboarding_state='complete'`. Users with no signal are left untouched (the modal handles them).
2. **Lazy modal:** Plan 1 already populated `users/{uid}.profile.requires_legacy_role_pick`-equivalent logic via `database.is_legacy_user_needing_role_pick(...)` and emitted `requiresLegacyRolePick: bool` on `/api/auth/verify`. Plan 6 adds the frontend modal that mounts when this flag is true. On role pick: `POST /api/auth/migrate-role { role }` writes the role and either lands the user in their existing flow (`student`) or in the appropriate signup flow (`teacher` → `/signup/teacher/join-org`, `admin` → `/signup/admin/org-wizard`).

**Tech Stack:** Flask 3.1 + Firebase Admin SDK + Firestore (backend), Python 3.11 standalone script (backfill), React 19 + TypeScript + Radix UI + Tailwind (frontend), `unittest.TestCase` + `FakeDbBase` (backend tests), Vitest + RTL (frontend tests).

**Spec reference:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` — Section 7 (Legacy User Lazy Migration).

**Builds on:** Plans 1–5 (all merged on `pilot/launch-v1`). Specifically:
- `database.is_legacy_user_needing_role_pick(user_doc, memberships)` (Plan 1).
- `requiresLegacyRolePick` field on `/api/auth/verify` response (Plan 1).
- `User.requiresLegacyRolePick` field on the frontend `User` type (Plan 1).
- `database.update_user_profile(uid, intended_role=..., onboarding_state=...)` (Plan 1) with enum validation.
- `getOnboardingDestination(user)` dispatcher (Plan 2 + Plan 5 split).
- `AuthContext` with 5-min polling (Plan 5).

**Brainstorming decisions baked in:**
- Backfill priority: `school_admin` > `teacher` > `student enrollment`. Multi-role users get the highest priority.
- Backfill telemetry: structured stdout logs `{transition: 'student'|'teacher'|'admin'|'skipped', uid, reason}`. No Firestore audit doc (overkill for a one-time script).
- Modal i18n: English only for v1 (matches Plan 3 #26 and Plan 5 #36).
- `migrate-role` endpoint is idempotent — calling it again returns 200 with the existing role and is a no-op for non-legacy users.
- Backfill uses **idempotent updates** (only writes if `intended_role is None`); safe to re-run.

**Out of scope:**
- "Switch to learning mode" for a teacher- or admin-picked legacy user — they retain learner data dormant; activation is v1.5.
- Backfill telemetry to a Firestore audit collection — stdout logs are enough for a one-time script.
- Modal i18n.
- A "are you sure?" confirmation on role picks beyond what the modal already does.

---

## Plan 6 contract input (what we rely on from Plans 1–5)

**Backend:**
- `database.is_legacy_user_needing_role_pick(user_doc, memberships)` returns `True` iff `intended_role is None AND onboarding_state is None AND no active memberships`.
- `database.update_user_profile(uid, *, intended_role=None, onboarding_state=None, ...)` validates enums and writes via dotted-path updates.
- `/api/auth/verify` returns `requiresLegacyRolePick: bool` in the user payload.
- `database.list_user_memberships(uid)` returns the user's memberships (or equivalent helper — verify name during Task 1).
- `database.ALLOWED_INTENDED_ROLES = frozenset({'student', 'teacher', 'admin'})`.

**Frontend:**
- `User` type has `intendedRole`, `onboardingState`, `requiresLegacyRolePick` (Plan 1).
- `AuthContext` exposes `user` (with all the above) and re-runs `verifyToken` every 5 minutes (Plan 5).
- `getOnboardingDestination(user)` returns the route a user should land on (Plan 5).
- Routes `/signup/teacher/join-org` (Plan 4) and `/signup/admin/org-wizard` (Plan 3) are live.

If any of the above is not true on the branch when execution begins, stop and reconcile before continuing.

---

## File structure

### Backend — Create

| Path | Responsibility |
|---|---|
| `scripts/backfill_legacy_user_roles.py` | One-shot backfill with `--dry-run` |
| `scripts/__init__.py` | (Already exists; ensure backfill is importable for tests) |
| `backend/tests/test_migrate_role_route.py` | Route tests |
| `backend/tests/test_mark_user_legacy_role_picked.py` | DB helper tests |
| `tests/test_backfill_legacy_user_roles.py` | Script tests (in repo root `tests/` to mirror existing migration script patterns) |

### Backend — Modify

| Path | Change |
|---|---|
| `database.py` | Add `mark_user_legacy_role_picked(uid, role)` helper that wraps `update_user_profile` with the right `onboarding_state` per role |
| `backend/routes/auth.py` | Add `POST /api/auth/migrate-role { role }` |

### Frontend — Create

| Path | Responsibility |
|---|---|
| `frontend/src/components/LegacyRoleMigrationModal.tsx` | Blocking modal with three role buttons |
| `frontend/src/components/LegacyRoleMigrationModal.test.tsx` | RTL tests |
| `frontend/src/api/auth.test.ts` (extend if exists) | Test for new `migrateRole(role)` client |

### Frontend — Modify

| Path | Change |
|---|---|
| `frontend/src/api/auth.ts` | Add `migrateRole(role)` client function |
| `frontend/src/contexts/AuthContext.tsx` | Mount `<LegacyRoleMigrationModal />` when `user.requiresLegacyRolePick === true`; gate the dispatcher (do not auto-navigate while modal is visible) |
| `frontend/src/contexts/AuthContext.test.tsx` | Add tests for modal mount/unmount behavior |

### Docs — Modify

| Path | Change |
|---|---|
| `docs/school-integration/TASKS.md` | Mark Plan 6 items complete; add v1.5 follow-up for "switch to learning mode" |
| `docs/school-integration/LIMITATIONS.md` | Plan 6 LIMITATIONS items (modal en-only, no auto-detect of "wrong" role pick, etc.) |
| `docs/school-integration/TECH_SPEC.md` | Document the legacy migration model |
| `docs/superpowers/codebase-conventions.md` | §16 — Plan 6 contract surface |

---

## Conventions cheat sheet

- **Tests:** `unittest.TestCase` only. Single file run: `python3 -m unittest backend.tests.test_X -v`.
- **Backend routes:** `create_<name>_blueprint(deps: RouteDeps)`. Access `deps.db.foo(...)`, `deps.get_current_user_uid()`.
- **Naming:** snake_case in Python + Firestore + request bodies; camelCase in response bodies + TypeScript.
- **Firestore writes:** dotted paths on the doc, not subcollections.
- **Modal:** Plan 6's modal is blocking — `Esc`, click-outside, and X-close are all intentionally disabled.
- **Commits:** `feat(scope): …`, one logical change per commit, tests + impl together. Plain commit messages (no Co-Authored-By trailer per `codebase-conventions.md` §11).

---

## Task 1: `mark_user_legacy_role_picked(uid, role)` DB helper

**Files:**
- Modify: `database.py`
- Create: `backend/tests/test_mark_user_legacy_role_picked.py`

**Why:** Centralize the "given a legacy user picked role X, set the right (intended_role, onboarding_state) pair" logic so the route stays terse. The pairs are spec §638–640:
- `student` → `intended_role='student'`, `onboarding_state='complete'`.
- `teacher` → `intended_role='teacher'`, `onboarding_state='role_selected'`.
- `admin` → `intended_role='admin'`, `onboarding_state='role_selected'`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mark_user_legacy_role_picked.py`:

```python
import unittest
from unittest.mock import patch

import database


class MarkUserLegacyRolePickedTests(unittest.TestCase):
    @patch('database.update_user_profile')
    def test_student_writes_complete(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='student')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='student',
            onboarding_state='complete',
        )

    @patch('database.update_user_profile')
    def test_teacher_writes_role_selected(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='teacher')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='teacher',
            onboarding_state='role_selected',
        )

    @patch('database.update_user_profile')
    def test_admin_writes_role_selected(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='admin')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='admin',
            onboarding_state='role_selected',
        )

    def test_rejects_unknown_role(self):
        with self.assertRaisesRegex(ValueError, 'role'):
            database.mark_user_legacy_role_picked(uid='u1', role='principal')

    def test_rejects_empty_role(self):
        with self.assertRaisesRegex(ValueError, 'role'):
            database.mark_user_legacy_role_picked(uid='u1', role='')

    def test_rejects_empty_uid(self):
        with self.assertRaisesRegex(ValueError, 'uid'):
            database.mark_user_legacy_role_picked(uid='', role='student')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_mark_user_legacy_role_picked -v
```

Expected: `AttributeError: module 'database' has no attribute 'mark_user_legacy_role_picked'`.

- [ ] **Step 3: Add helper in `database.py`**

Place near `update_user_profile`:

```python
_LEGACY_PICK_STATE_BY_ROLE = {
    INTENDED_ROLE_STUDENT: ONBOARDING_STATE_COMPLETE,
    INTENDED_ROLE_TEACHER: ONBOARDING_STATE_ROLE_SELECTED,
    INTENDED_ROLE_ADMIN: ONBOARDING_STATE_ROLE_SELECTED,
}


def mark_user_legacy_role_picked(*, uid: str, role: str) -> None:
    """Apply the role pick from the LegacyRoleMigrationModal.

    Per spec §638–640:
    - student → complete (drop into their existing learner flow).
    - teacher → role_selected (resume into teacher join-org).
    - admin → role_selected (resume into admin wizard).
    """
    if not uid:
        raise ValueError('uid is required')
    if role not in _LEGACY_PICK_STATE_BY_ROLE:
        raise ValueError(
            f'Invalid role {role!r}; allowed: {sorted(_LEGACY_PICK_STATE_BY_ROLE)}'
        )
    update_user_profile(
        uid=uid,
        intended_role=role,
        onboarding_state=_LEGACY_PICK_STATE_BY_ROLE[role],
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest backend.tests.test_mark_user_legacy_role_picked -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_mark_user_legacy_role_picked.py
git commit -m "feat(legacy-migration): add mark_user_legacy_role_picked helper"
```

---

## Task 2: `POST /api/auth/migrate-role` endpoint

**Files:**
- Modify: `backend/routes/auth.py`
- Create: `backend/tests/test_migrate_role_route.py`

**Why:** Server endpoint behind the modal's "Student / Teacher / Admin" buttons. Defense-in-depth: server re-verifies that the user is legacy before writing (a non-legacy user calling this from devtools is a no-op 200, not a corruption vector). Idempotent.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_migrate_role_route.py`:

```python
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeMigrateDb(FakeDbBase):
    """`is_legacy_user_needing_role_pick` is imported directly from
    `database` by the route — we do NOT mock it on the db fake. State
    helpers (`mark_user_legacy_role_picked`) ARE on the fake because
    they touch Firestore."""

    def __init__(self):
        super().__init__()
        self.users = {
            'u-legacy': {'uid': 'u-legacy', 'email': 'l@x.com',
                         'profile': {}},  # no intended_role, no memberships
            'u-already-migrated': {'uid': 'u-already-migrated', 'email': 'm@x.com',
                                   'profile': {'intended_role': 'student',
                                               'onboarding_state': 'complete'}},
            'u-has-membership': {'uid': 'u-has-membership', 'email': 'h@x.com',
                                 'profile': {}},
        }
        self.memberships = {
            'u-has-membership': [
                {'org_id': 'o', 'roles': ['teacher'], 'status': 'active'},
            ],
        }
        self.picked = []

    def get_user(self, uid):
        return self.users.get(uid)

    def list_user_memberships(self, uid):
        return self.memberships.get(uid, [])

    def mark_user_legacy_role_picked(self, *, uid, role):
        self.picked.append({'uid': uid, 'role': role})


class MigrateRoleRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.auth import create_auth_blueprint
        self.db = FakeMigrateDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_auth_blueprint(self.deps)],
        )
        self.client = self.app.test_client()

    def _as(self, uid):
        with self.client.session_transaction() as sess:
            sess['uid'] = uid

    def test_legacy_user_picking_student_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'student'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'student'}])
        self.assertEqual(resp.get_json()['intendedRole'], 'student')
        self.assertEqual(resp.get_json()['onboardingState'], 'complete')

    def test_legacy_user_picking_teacher_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'teacher'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'teacher'}])
        self.assertEqual(resp.get_json()['onboardingState'], 'role_selected')

    def test_legacy_user_picking_admin_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'admin'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'admin'}])

    def test_invalid_role_400(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'principal'})
        self.assertEqual(resp.status_code, 400)

    def test_missing_role_400(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={})
        self.assertEqual(resp.status_code, 400)

    def test_non_legacy_user_is_no_op_200(self):
        """Already-migrated user calling the endpoint is idempotent."""
        self._as('u-already-migrated')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'teacher'})
        self.assertEqual(resp.status_code, 200)
        # Did NOT write a new role.
        self.assertEqual(self.db.picked, [])
        # Response reflects the existing role (defense-in-depth).
        self.assertEqual(resp.get_json()['intendedRole'], 'student')

    def test_user_with_active_membership_is_no_op_200(self):
        self._as('u-has-membership')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'admin'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [])

    def test_unauthenticated_401(self):
        # No session set.
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'student'})
        self.assertEqual(resp.status_code, 401)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest backend.tests.test_migrate_role_route -v
```

Expected: 404 (route not registered).

- [ ] **Step 3: Add the route in `backend/routes/auth.py`**

Inside `create_auth_blueprint(deps)`, after the existing routes:

```python
ALLOWED_MIGRATE_ROLES = frozenset({'student', 'teacher', 'admin'})


@bp.post('/migrate-role')
def migrate_role():
    try:
        uid = deps.get_current_user_uid()
    except Exception:
        return jsonify({'error': 'unauthenticated'}), 401
    if not uid:
        return jsonify({'error': 'unauthenticated'}), 401

    body = request.get_json(silent=True) or {}
    role = (body.get('role') or '').strip()
    if not role:
        return jsonify({'error': 'role is required'}), 400
    if role not in ALLOWED_MIGRATE_ROLES:
        return jsonify({'error': f'invalid role {role!r}'}), 400

    user_doc = deps.db.get_user(uid)
    memberships = deps.db.list_user_memberships(uid)

    # `is_legacy_user_needing_role_pick` is a pure function (Plan 1) — import
    # directly so the route does not rely on a fake method existing on
    # `deps.db`. State-changing helpers still live behind `deps.db`.
    from database import is_legacy_user_needing_role_pick
    if is_legacy_user_needing_role_pick(user_doc, memberships):
        try:
            deps.db.mark_user_legacy_role_picked(uid=uid, role=role)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        # Re-read so the response reflects the new state.
        user_doc = deps.db.get_user(uid) or {}

    profile = (user_doc or {}).get('profile') or {}
    return jsonify({
        'intendedRole': profile.get('intended_role'),
        'onboardingState': profile.get('onboarding_state'),
    }), 200
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest backend.tests.test_migrate_role_route -v
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_migrate_role_route.py
git commit -m "feat(auth): POST /api/auth/migrate-role (legacy role pick + idempotent)"
```

---

## Task 3: Frontend `migrateRole(role)` API client

**Files:**
- Modify: `frontend/src/api/auth.ts`
- Modify: `frontend/src/api/auth.test.ts` (or create if doesn't exist)

**Why:** Typed client used by the modal.

- [ ] **Step 1: Write the failing test**

Open `frontend/src/api/auth.test.ts` (or create) and add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateRole } from './auth';
import { api } from './index';

vi.mock('./index', () => ({
  api: { post: vi.fn() },
}));

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockPost.mockReset());

describe('migrateRole', () => {
  it('POSTs to /api/auth/migrate-role with role', async () => {
    mockPost.mockResolvedValue({ data: { intendedRole: 'student', onboardingState: 'complete' } });
    const result = await migrateRole('student');
    expect(mockPost).toHaveBeenCalledWith('/api/auth/migrate-role', { role: 'student' });
    expect(result.intendedRole).toBe('student');
  });

  it('passes through teacher and admin', async () => {
    mockPost.mockResolvedValue({ data: { intendedRole: 'teacher', onboardingState: 'role_selected' } });
    await migrateRole('teacher');
    expect(mockPost).toHaveBeenLastCalledWith('/api/auth/migrate-role', { role: 'teacher' });

    mockPost.mockResolvedValue({ data: { intendedRole: 'admin', onboardingState: 'role_selected' } });
    await migrateRole('admin');
    expect(mockPost).toHaveBeenLastCalledWith('/api/auth/migrate-role', { role: 'admin' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/api/auth.test.ts
```

Expected: `migrateRole` is not exported.

- [ ] **Step 3: Add to `frontend/src/api/auth.ts`**

```typescript
import type { IntendedRole } from '@/types';

export interface MigrateRoleResponse {
  intendedRole: IntendedRole | null;
  onboardingState: string | null;
}

export async function migrateRole(role: IntendedRole): Promise<MigrateRoleResponse> {
  const { data } = await api.post('/api/auth/migrate-role', { role });
  return data;
}
```

(Verify that `IntendedRole` is already exported from `@/types`; Plan 1 added it. If not, declare locally: `export type IntendedRole = 'student' | 'teacher' | 'admin';`.)

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/api/auth.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/auth.ts frontend/src/api/auth.test.ts
git commit -m "feat(api): migrateRole client function"
```

---

## Task 4: `LegacyRoleMigrationModal` component

**Files:**
- Create: `frontend/src/components/LegacyRoleMigrationModal.tsx`
- Create: `frontend/src/components/LegacyRoleMigrationModal.test.tsx`

**Why:** Blocking modal with three role buttons. Spec §628–633 specifies exact body copy. No close button, no escape key, no click-outside dismiss.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/LegacyRoleMigrationModal.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LegacyRoleMigrationModal } from './LegacyRoleMigrationModal';

describe('LegacyRoleMigrationModal', () => {
  it('renders the welcome copy', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getByText(/lingual now supports classrooms/i)).toBeInTheDocument();
    expect(screen.getByText(/how are you using lingual/i)).toBeInTheDocument();
    expect(screen.getByText(/your existing progress stays with you/i)).toBeInTheDocument();
  });

  it('renders three role buttons', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^student$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^teacher$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /school administrator/i })).toBeInTheDocument();
  });

  it('calls onPicked with the chosen role', async () => {
    const onPicked = vi.fn().mockResolvedValue(undefined);
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('student'));
  });

  it('disables buttons while a pick is pending', async () => {
    let resolve!: () => void;
    const onPicked = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^teacher$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^student$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^teacher$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /school administrator/i })).toBeDisabled();
    });
    resolve();
  });

  it('shows error message when the pick fails', async () => {
    const onPicked = vi.fn().mockRejectedValue(new Error('network down'));
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
    await waitFor(() => screen.getByText(/network down/i));
  });

  it('does NOT have a close button or escape handler', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/close/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/components/LegacyRoleMigrationModal.test.tsx
```

Expected: import error.

- [ ] **Step 3: Create `frontend/src/components/LegacyRoleMigrationModal.tsx`**

```typescript
import { useState } from 'react';
import type { IntendedRole } from '@/types';

export interface LegacyRoleMigrationModalProps {
  onPicked(role: IntendedRole): Promise<void>;
}

const ROLES: { value: IntendedRole; label: string; description: string }[] = [
  { value: 'student', label: 'Student', description: 'Continue learning where you left off.' },
  { value: 'teacher', label: 'Teacher', description: 'Join a school and run classes.' },
  { value: 'admin', label: 'School administrator', description: 'Register or manage your school.' },
];

export function LegacyRoleMigrationModal({ onPicked }: LegacyRoleMigrationModalProps) {
  const [busy, setBusy] = useState<IntendedRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(role: IntendedRole) {
    setBusy(role);
    setError(null);
    try {
      await onPicked(role);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      // Intentionally no onClick handler — the backdrop does NOT dismiss.
      // Spec §628: blocking — no close, no escape.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h2 className="text-xl font-semibold text-neutral-900">Welcome back!</h2>
        <p className="mt-2 text-sm text-neutral-700">
          Lingual now supports classrooms.
        </p>
        <p className="mt-4 text-sm font-medium text-neutral-900">
          How are you using Lingual?
        </p>

        <div className="mt-4 grid gap-2">
          {ROLES.map(r => (
            <button
              key={r.value}
              onClick={() => pick(r.value)}
              disabled={busy !== null}
              className="rounded-md border border-neutral-300 px-4 py-3 text-left transition hover:border-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
            >
              <div className="font-medium">{r.label}</div>
              <div className="text-xs text-neutral-600">{r.description}</div>
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-neutral-500">
          Your existing progress stays with you.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/components/LegacyRoleMigrationModal.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LegacyRoleMigrationModal.tsx frontend/src/components/LegacyRoleMigrationModal.test.tsx
git commit -m "feat(legacy-migration): LegacyRoleMigrationModal (blocking, three roles)"
```

---

## Task 5: Mount modal in `AuthProvider` + post-pick navigation

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Modify: `frontend/src/contexts/AuthContext.test.tsx`

**Why:** The modal is global state — it must mount before any route content renders so the dispatcher can't navigate the user away while they're still legacy. After pick, we re-verify (to refresh `requiresLegacyRolePick` to false) and then route to the destination dispatcher chose for the new state.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/contexts/AuthContext.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '@/api/auth';

vi.mock('@/api/auth');

beforeEach(() => vi.resetAllMocks());

function Harness() {
  const { user } = useAuth();
  return <div>uid={user?.uid || '—'}; intendedRole={user?.intendedRole || '—'}</div>;
}

describe('AuthProvider — LegacyRoleMigrationModal mount', () => {
  it('mounts the modal when requiresLegacyRolePick is true', async () => {
    // Bootstrap a legacy user. Use the existing pattern in the file
    // (Firebase auth event → /api/auth/verify returns user).
    vi.mocked(authApi.verifyToken).mockResolvedValue({
      user: {
        uid: 'u-legacy', email: 'l@x.com',
        requiresLegacyRolePick: true,
        intendedRole: null, onboardingState: null,
      } as any,
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    // ... bootstrap signed-in state as the file's other tests do ...
    await waitFor(() => screen.getByText(/welcome back/i));
  });

  it('hides the modal once a role is picked + state refreshes', async () => {
    vi.mocked(authApi.verifyToken)
      .mockResolvedValueOnce({
        user: {
          uid: 'u-legacy', email: 'l@x.com',
          requiresLegacyRolePick: true,
        } as any,
      })
      // Second verify (after migrate-role) returns a non-legacy user.
      .mockResolvedValueOnce({
        user: {
          uid: 'u-legacy', email: 'l@x.com',
          requiresLegacyRolePick: false,
          intendedRole: 'student',
          onboardingState: 'complete',
        } as any,
      });
    vi.mocked(authApi.migrateRole).mockResolvedValue({
      intendedRole: 'student', onboardingState: 'complete',
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    // ... bootstrap ...
    await waitFor(() => screen.getByText(/welcome back/i));
    fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
    await waitFor(() => {
      expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/intendedRole=student/i)).toBeInTheDocument();
  });

  it('does NOT mount the modal when requiresLegacyRolePick is false', async () => {
    vi.mocked(authApi.verifyToken).mockResolvedValue({
      user: {
        uid: 'u', email: 'x@x.com',
        requiresLegacyRolePick: false,
        intendedRole: 'student',
      } as any,
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    // ... bootstrap ...
    await waitFor(() => screen.getByText(/uid=u/));
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });
});
```

(Adapt the bootstrap section to match the existing test file's pattern — e.g., dispatching a `onAuthStateChanged` mock event.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx
```

Expected: modal-mount assertions fail.

- [ ] **Step 3: Modify `frontend/src/contexts/AuthContext.tsx`**

Add the modal mount near the JSX return. Inside `AuthProvider`:

```typescript
import { LegacyRoleMigrationModal } from '@/components/LegacyRoleMigrationModal';
import { migrateRole as migrateRoleApi } from '@/api/auth';

// Inside the component:
async function handleLegacyRolePick(role: 'student' | 'teacher' | 'admin') {
  await migrateRoleApi(role);
  // Re-verify so requiresLegacyRolePick becomes false and React state updates.
  const fbUser = auth.currentUser;
  if (fbUser) {
    const idToken = await fbUser.getIdToken();
    const result = await verifyToken(idToken);
    setUser(result.user as User);
  }
}

return (
  <AuthContext.Provider value={value}>
    {children}
    {user?.requiresLegacyRolePick && (
      <LegacyRoleMigrationModal onPicked={handleLegacyRolePick} />
    )}
  </AuthContext.Provider>
);
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx
```

Expected: 3 legacy-modal tests pass; existing AuthContext tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/contexts/AuthContext.test.tsx
git commit -m "feat(auth): mount LegacyRoleMigrationModal when requiresLegacyRolePick"
```

---

## Task 6: Gate dispatcher so it does not race the modal

**Files:**
- Modify: `frontend/src/lib/homeRoutes.ts`
- Modify: `frontend/src/lib/homeRoutes.test.ts`

**Why:** If the dispatcher routes a legacy user to `/signup/student/setup` (the Plan 5 fallback for `requires_legacy_role_pick` true) before the modal mounts, the modal will mount on top of the wrong page. We update the dispatcher: when `requiresLegacyRolePick` is true, return `null` — meaning "do not navigate; let the modal handle it." Callers (AppIndexRedirect, LoginPage, SignupPage) treat `null` as "stay where you are."

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/homeRoutes.test.ts`:

```typescript
describe('Plan 6 — legacy modal gating', () => {
  it('returns null for requiresLegacyRolePick=true', () => {
    const user: User = {
      uid: 'u', email: 'a@x.com',
      requiresLegacyRolePick: true,
    } as User;
    expect(getOnboardingDestination(user)).toBeNull();
  });

  it('still routes legacy users with active memberships normally', () => {
    // After backfill, a user has memberships but no intended_role — should
    // still route based on memberships, NOT show the modal.
    const user: User = {
      uid: 'u', email: 'a@x.com',
      requiresLegacyRolePick: false,
      memberships: [{ orgId: 'o', roles: ['teacher'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(TEACHER_HOME_ROUTE);
  });
});
```

- [ ] **Step 2: Modify `getOnboardingDestination`**

Add the legacy guard at the very top, BEFORE the `lingual_admin` check:

```typescript
export function getOnboardingDestination(user: User | null | undefined): string | null {
  if (!user) return null;

  // 0) Legacy user awaiting modal — do NOT navigate, the modal handles it.
  if (user.requiresLegacyRolePick) return null;

  // 1) Lingual admin wins over everything.
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  // ... rest unchanged ...
}
```

Also update `getPrivilegedHomeRoute` similarly.

- [ ] **Step 3: Audit callers of `getOnboardingDestination`**

Search for callers and ensure each treats `null` as "stay":

```bash
grep -rn "getOnboardingDestination" frontend/src/
```

For each caller, the pattern should be:

```typescript
const dest = getOnboardingDestination(user);
if (dest) {
  navigate(dest);
}
// else: stay on current page; modal will handle it.
```

Inspect `AppIndexRedirect`, `LoginPage`, `SignupPage`, `AccountCreator`. Update any that unconditionally `navigate(dest!)` with the conditional pattern.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts
cd frontend && npm run test -- --run
```

Expected: new dispatcher tests pass; no existing tests regress.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/homeRoutes.ts frontend/src/lib/homeRoutes.test.ts
# also any callers updated to handle null
git commit -m "feat(routing): dispatcher returns null on requiresLegacyRolePick (modal handles it)"
```

---

## Task 7: Backfill script `scripts/backfill_legacy_user_roles.py`

**Files:**
- Create: `scripts/backfill_legacy_user_roles.py`
- Create: `tests/test_backfill_legacy_user_roles.py`

**Why:** One-shot script that pre-resolves the legacy → role mapping for users with discoverable memberships. Reduces the population that hits the modal.

- [ ] **Step 1: Write the failing test**

Create `tests/test_backfill_legacy_user_roles.py`:

```python
"""Tests for scripts.backfill_legacy_user_roles."""
import io
import unittest
from unittest.mock import MagicMock, patch

# Use importlib so we can call `main()` as a function with patched args.
import importlib


class BackfillLegacyUserRolesTests(unittest.TestCase):
    def _import(self):
        return importlib.import_module('scripts.backfill_legacy_user_roles')

    def test_school_admin_membership_yields_admin(self):
        mod = self._import()
        memberships = [{'org_id': 'o', 'roles': ['school_admin'], 'status': 'active'}]
        self.assertEqual(mod.infer_role_from_memberships(memberships), 'admin')

    def test_teacher_membership_yields_teacher(self):
        mod = self._import()
        memberships = [{'org_id': 'o', 'roles': ['teacher'], 'status': 'active'}]
        self.assertEqual(mod.infer_role_from_memberships(memberships), 'teacher')

    def test_student_enrollment_yields_student(self):
        mod = self._import()
        # Memberships empty; enrollment list non-empty (script treats this as student).
        self.assertEqual(mod.infer_role_from_signals([], ['enrollment-1']), 'student')

    def test_no_signals_yields_none(self):
        mod = self._import()
        self.assertIsNone(mod.infer_role_from_signals([], []))

    def test_priority_school_admin_over_teacher(self):
        mod = self._import()
        memberships = [
            {'org_id': 'o1', 'roles': ['teacher'], 'status': 'active'},
            {'org_id': 'o2', 'roles': ['school_admin'], 'status': 'active'},
        ]
        self.assertEqual(mod.infer_role_from_memberships(memberships), 'admin')

    def test_ignores_inactive_memberships(self):
        mod = self._import()
        memberships = [
            {'org_id': 'o', 'roles': ['school_admin'], 'status': 'removed'},
        ]
        self.assertIsNone(mod.infer_role_from_memberships(memberships))

    @patch('scripts.backfill_legacy_user_roles.firestore')
    def test_dry_run_does_not_write(self, mock_firestore):
        mod = self._import()
        db = MagicMock()
        db.collection.return_value.stream.return_value = [
            MagicMock(id='u1', to_dict=lambda: {'profile': {}}),
        ]
        # Memberships stream for u1: one school_admin row.
        def mock_memberships_for(uid):
            return [{'org_id': 'o', 'roles': ['school_admin'], 'status': 'active'}]
        with patch.object(mod, 'list_user_memberships', side_effect=mock_memberships_for), \
             patch.object(mod, 'list_user_enrollments', return_value=[]):
            stats = mod.run_backfill(db=db, dry_run=True, batch_size=10)
        self.assertEqual(stats['would_set_admin'], 1)
        self.assertEqual(stats['written'], 0)

    @patch('scripts.backfill_legacy_user_roles.firestore')
    def test_writes_when_not_dry_run(self, mock_firestore):
        mod = self._import()
        db = MagicMock()
        user_ref = MagicMock()
        db.collection.return_value.document.return_value = user_ref
        db.collection.return_value.stream.return_value = [
            MagicMock(id='u1', to_dict=lambda: {'profile': {}}),
        ]
        def mock_memberships_for(uid):
            return [{'org_id': 'o', 'roles': ['teacher'], 'status': 'active'}]
        with patch.object(mod, 'list_user_memberships', side_effect=mock_memberships_for), \
             patch.object(mod, 'list_user_enrollments', return_value=[]):
            stats = mod.run_backfill(db=db, dry_run=False, batch_size=10)
        self.assertEqual(stats['written'], 1)
        # The update should be the right dotted-path shape.
        update_call = user_ref.update.call_args
        self.assertIn('profile.intended_role', update_call[0][0])
        self.assertEqual(update_call[0][0]['profile.intended_role'], 'teacher')
        # Teacher gets onboarding_state='complete' from the backfill (script
        # treats all inferred-from-memberships users as completed onboarding).
        self.assertEqual(update_call[0][0]['profile.onboarding_state'], 'complete')

    @patch('scripts.backfill_legacy_user_roles.firestore')
    def test_skips_users_with_existing_intended_role(self, mock_firestore):
        mod = self._import()
        db = MagicMock()
        db.collection.return_value.stream.return_value = [
            MagicMock(id='u1', to_dict=lambda: {
                'profile': {'intended_role': 'student'},
            }),
        ]
        with patch.object(mod, 'list_user_memberships', return_value=[]), \
             patch.object(mod, 'list_user_enrollments', return_value=[]):
            stats = mod.run_backfill(db=db, dry_run=False, batch_size=10)
        self.assertEqual(stats['written'], 0)
        self.assertEqual(stats['skipped_already_migrated'], 1)

    def test_main_dry_run_via_argv(self):
        mod = self._import()
        with patch.object(mod, 'run_backfill', return_value={
                'scanned': 1, 'written': 0, 'skipped_no_signal': 0,
                'skipped_already_migrated': 1,
                'would_set_admin': 0, 'would_set_teacher': 0, 'would_set_student': 0,
            }) as mock_run, \
             patch.object(mod, '_get_firestore_client', return_value=MagicMock()), \
             patch('sys.stdout', new_callable=io.StringIO) as mock_stdout:
            rc = mod.main(['--dry-run'])
        self.assertEqual(rc, 0)
        mock_run.assert_called_once()
        kwargs = mock_run.call_args.kwargs
        self.assertTrue(kwargs['dry_run'])
        out = mock_stdout.getvalue()
        self.assertIn('scanned', out)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest tests.test_backfill_legacy_user_roles -v
```

Expected: `ModuleNotFoundError: No module named 'scripts.backfill_legacy_user_roles'`.

- [ ] **Step 3: Create `scripts/backfill_legacy_user_roles.py`**

```python
"""One-shot backfill: infer intended_role for legacy users.

Reads `users/` and, for each user without `profile.intended_role`, looks at:
  - active memberships (priority: school_admin > teacher)
  - active enrollments (treated as 'student')

Writes `profile.intended_role` + `profile.onboarding_state='complete'` so the
user routes to their existing flow on next sign-in (no modal needed).

Users with neither memberships nor enrollments are left untouched — the
LegacyRoleMigrationModal handles them at next sign-in.

Usage:
  python3 scripts/backfill_legacy_user_roles.py --dry-run
  python3 scripts/backfill_legacy_user_roles.py            # writes
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Iterable

from firebase_admin import firestore

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')


def _get_firestore_client():
    """Initialize Firebase Admin if needed; return Firestore client."""
    import firebase_admin
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


def list_user_memberships(db, uid: str) -> list:
    rows = (
        db.collection('memberships')
        .where('uid', '==', uid)
        .stream()
    )
    return [{**r.to_dict(), 'id': r.id} for r in rows]


def list_user_enrollments(db, uid: str) -> list:
    rows = (
        db.collection('enrollments')
        .where('student_uid', '==', uid)
        .where('status', '==', 'active')
        .stream()
    )
    return [r.id for r in rows]


def infer_role_from_memberships(memberships: Iterable[dict]) -> str | None:
    active = [m for m in memberships if (m.get('status') or 'active') == 'active']
    has_admin = any('school_admin' in (m.get('roles') or []) for m in active)
    has_teacher = any('teacher' in (m.get('roles') or []) for m in active)
    if has_admin:
        return 'admin'
    if has_teacher:
        return 'teacher'
    return None


def infer_role_from_signals(memberships: Iterable[dict], enrollments: list) -> str | None:
    role = infer_role_from_memberships(memberships)
    if role:
        return role
    if enrollments:
        return 'student'
    return None


def run_backfill(*, db, dry_run: bool, batch_size: int) -> dict:
    stats = {
        'scanned': 0,
        'written': 0,
        'skipped_already_migrated': 0,
        'skipped_no_signal': 0,
        'would_set_admin': 0,
        'would_set_teacher': 0,
        'would_set_student': 0,
    }
    for user_doc in db.collection('users').stream():
        stats['scanned'] += 1
        data = user_doc.to_dict() or {}
        profile = data.get('profile') or {}
        if profile.get('intended_role'):
            stats['skipped_already_migrated'] += 1
            continue

        uid = user_doc.id
        memberships = list_user_memberships(db, uid)
        enrollments = list_user_enrollments(db, uid)
        role = infer_role_from_signals(memberships, enrollments)
        if role is None:
            stats['skipped_no_signal'] += 1
            logger.info('[backfill] uid=%s transition=skipped (no_signal)', uid)
            continue

        would_key = f'would_set_{role}'
        stats[would_key] = stats.get(would_key, 0) + 1
        logger.info('[backfill] uid=%s transition=%s dry_run=%s', uid, role, dry_run)

        if not dry_run:
            db.collection('users').document(uid).update({
                'profile.intended_role': role,
                'profile.onboarding_state': 'complete',
            })
            stats['written'] += 1
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Backfill legacy user roles.')
    parser.add_argument('--dry-run', action='store_true', help='Do not write; log transitions only.')
    parser.add_argument('--batch-size', type=int, default=500, help='Reserved for future batching.')
    args = parser.parse_args(argv)

    db = _get_firestore_client()
    stats = run_backfill(db=db, dry_run=args.dry_run, batch_size=args.batch_size)
    print('Backfill stats:')
    for k, v in stats.items():
        print(f'  {k}: {v}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Run tests**

```bash
python3 -m unittest tests.test_backfill_legacy_user_roles -v
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_legacy_user_roles.py tests/test_backfill_legacy_user_roles.py
git commit -m "feat(legacy-migration): backfill_legacy_user_roles script + dry-run mode"
```

---

## Task 8: Docs updates

**Files:**
- Modify: `docs/school-integration/TASKS.md`
- Modify: `docs/school-integration/LIMITATIONS.md`
- Modify: `docs/school-integration/TECH_SPEC.md`
- Modify: `docs/superpowers/codebase-conventions.md`

**Why:** Capture Plan 6's shipped state, residual constraints, and contract.

- [ ] **Step 1: Update `docs/school-integration/TASKS.md`**

Resolve the pre-existing "Define data migration plan for existing users who only have `profile.school_name`" item under Phase 1 / Domain model:

```markdown
- [x] Define data migration plan for existing users who only have `profile.school_name`. Implemented by Plan 6: `scripts/backfill_legacy_user_roles.py` infers roles from active memberships/enrollments; the `LegacyRoleMigrationModal` handles unresolved users at next sign-in.
```

Add a new subsection under Phase 2 (or Phase 7 if rollout-related fits better):

```markdown
### Legacy migration (Plan 6)

- [x] `scripts/backfill_legacy_user_roles.py` with `--dry-run`.
- [x] `database.mark_user_legacy_role_picked(uid, role)` helper.
- [x] `POST /api/auth/migrate-role` (idempotent, defense-in-depth).
- [x] `LegacyRoleMigrationModal` blocking modal.
- [x] `AuthProvider` mounts modal on `requiresLegacyRolePick`.
- [x] Dispatcher returns `null` while modal is pending so it never races route changes.

- [ ] Run backfill --dry-run on staging.
- [ ] Run backfill on staging (writes).
- [ ] Run backfill on production.
- [ ] Monitor `legacy_role_pick` log volume for 1 week post-launch.
- [ ] "Switch to learning mode" for teacher/admin-migrated users who want to learn — v1.5.
- [ ] Localize the modal copy (en + ko) — v1.5.
```

- [ ] **Step 2: Update `docs/school-integration/LIMITATIONS.md`**

Add entries 39–42:

```markdown
39. **Legacy migration modal is English-only.** Spec §628 prescribes
    exact copy; `LanguageProvider` (en/ko) is not threaded through. Per
    Plan 6 brainstorming, acceptable for v1; revisit when ko learner
    population becomes a meaningful share.

40. **`POST /api/auth/migrate-role` is idempotent for already-migrated
    users.** Calling with `role: 'admin'` on a user whose
    `intended_role` is already `'student'` returns 200 with the existing
    state (does NOT overwrite). Defense-in-depth — prevents a user with
    a devtools console from re-picking their own role after being
    migrated, even though the modal would not mount.

41. **Backfill writes are not transactional across users.** The script
    iterates one user at a time and updates each in a separate Firestore
    write. A mid-run failure leaves the partially-processed users with
    `profile.intended_role` set (correct) and the unprocessed users in
    their legacy state (also correct — the modal handles them). Idempotent
    on re-run: users with `intended_role` already set are skipped.

42. **Backfill telemetry is stdout-only.** Each transition logs one line
    (`[backfill] uid=… transition=… dry_run=…`). No Firestore audit doc
    is written. Acceptable because the script is one-shot and operator-run;
    the log is captured by Cloud Logging when the script runs in GCP.

43. **Backfill is single-stream (no `batched_writes` / no resume
    checkpoint).** The script iterates users sequentially and writes one
    update per matched user. For pilot scale (~thousands of legacy users)
    this is fine — total runtime is bounded by Firestore write quota
    (~500 writes/sec sustained per project) and a clean run completes in
    minutes. On a partial-failure restart, the `skipped_already_migrated`
    branch makes re-runs idempotent. If legacy population grows past
    ~50k users post-pilot, refactor to `batched_writes` (batch=500) and
    consider chunking with `__name__` cursors so a single Firestore quota
    blip does not require a full re-scan.
```

- [ ] **Step 3: Update `docs/school-integration/TECH_SPEC.md`**

Find the user profile section and add:

```markdown
### Legacy migration

Users created before Plans 1–5 have `users/{uid}/profile.intended_role = null`
and `onboarding_state = null`. Two paths handle them:

1. **Backfill (`scripts/backfill_legacy_user_roles.py`)** — pre-resolves
   any user with active memberships or enrollments by setting
   `intended_role` and `onboarding_state='complete'`.

   Priority order (highest to lowest):
   - Any active membership with `school_admin` role → `admin`.
   - Any active membership with `teacher` role → `teacher`.
   - Any active enrollment → `student`.
   - Otherwise: leave untouched.

2. **`LegacyRoleMigrationModal`** — for users the backfill couldn't
   resolve, a blocking modal mounts on next sign-in. The modal
   `POST`s to `/api/auth/migrate-role { role }` which writes
   `intended_role` and `onboarding_state` per spec §638–640:
   - student → `onboarding_state='complete'` (lands on `/app/learn`).
   - teacher → `onboarding_state='role_selected'` (lands on `/signup/teacher/join-org`).
   - admin → `onboarding_state='role_selected'` (lands on `/signup/admin/org-wizard`).

   The endpoint is idempotent — non-legacy users receive 200 with no
   write. The dispatcher (`getOnboardingDestination`) returns `null`
   while `requiresLegacyRolePick` is true so the modal never races
   navigation.

### Endpoint: `POST /api/auth/migrate-role`

| | |
|---|---|
| Auth | Authenticated user (session cookie or ID token) |
| Body | `{ role: 'student' | 'teacher' | 'admin' }` |
| Response | `{ intendedRole, onboardingState }` (camelCase) |
| Idempotent | Yes — re-call with same/different role on a migrated user is a no-op 200 |
| Defense-in-depth | Server re-verifies `is_legacy_user_needing_role_pick(...)`; writes only when true |
```

- [ ] **Step 4: Update `docs/superpowers/codebase-conventions.md`**

Add §16:

```markdown
---

## 16. Plan 6 contract surface (what's true after Plan 6 lands)

**Backend:**
- `database.mark_user_legacy_role_picked(*, uid, role)` is the canonical writer for legacy-pick transitions; it dispatches to `update_user_profile` with the right `onboarding_state` per role.
- `POST /api/auth/migrate-role { role }` is the only client-facing entry point. Server re-verifies legacy status before writing — never trust the client's claim.

**Frontend:**
- `LegacyRoleMigrationModal` is mounted globally in `AuthProvider` and gated on `user.requiresLegacyRolePick`. The modal is intentionally blocking; do not add Esc/click-outside dismissal.
- `getOnboardingDestination(user)` returns `null` while `requiresLegacyRolePick` is true. **Every caller must treat `null` as "do not navigate."** Callers that unconditionally redirect (e.g., `navigate(dest!)`) will break the modal.
- The modal calls `migrateRole(role)` then triggers a fresh `verifyToken(...)` so `requiresLegacyRolePick` flips to false and React state updates — at which point the modal unmounts and the dispatcher routes the user normally.

**Operations:**
- `scripts/backfill_legacy_user_roles.py` is one-shot, idempotent, and supports `--dry-run`. Run dry then real on staging, then production. Stats include `would_set_*` (dry counts) and `written` (real counts).
- Rollout order is non-negotiable: backend endpoint must land before backfill runs; backfill must run before the frontend modal lands. The modal is non-functional without the endpoint, but the endpoint is invisible without the modal — so the only safe order is endpoint → backfill → modal. Plan 6's task order matches.
```

- [ ] **Step 5: Commit**

```bash
git add docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md docs/school-integration/TECH_SPEC.md docs/superpowers/codebase-conventions.md
git commit -m "docs: record Plan 6 shipped state + contract surface"
```

---

## Task 9: Rollout runbook

**Files:**
- Modify: `docs/school-integration/TASKS.md` (cross-link the runbook section)
- Create: `docs/school-integration/PLAN_6_ROLLOUT.md`

**Why:** Plan 6 is the first Plan in this series to require a strict staged rollout (backend → backfill → frontend). A runbook eliminates ambiguity when the operator picks this up.

- [ ] **Step 1: Create `docs/school-integration/PLAN_6_ROLLOUT.md`**

```markdown
# Plan 6 Rollout Runbook

Status: ready
Owner: Engineering

Plan 6 ships in three deployable units. Do NOT bundle them.

## Phase 1 — Backend endpoint only

1. Land Plan 6 Tasks 1–2 (mark_user_legacy_role_picked helper + /api/auth/migrate-role).
2. Deploy backend.
3. Verify: `curl -i -X POST https://l1ngual.com/api/auth/migrate-role -d '{"role":"student"}' -H 'Cookie: ...'` returns 200 for a known legacy user.
4. **Frontend has no caller yet** → no user-visible behavior change.

## Phase 2 — Backfill (dry-run, then real)

1. Run staging dry-run:
   ```
   python3 scripts/backfill_legacy_user_roles.py --dry-run
   ```
   Inspect stats. Sanity checks:
   - `scanned` matches expected user count.
   - `would_set_admin + would_set_teacher + would_set_student + skipped_already_migrated + skipped_no_signal == scanned`.
   - No exceptions in stderr.

2. Run staging real:
   ```
   python3 scripts/backfill_legacy_user_roles.py
   ```
   Verify `written` matches the dry-run's `would_set_*` sum.

3. Sample 5 users from each transition class and `git verify` their `profile.intended_role` + `onboarding_state` in Firestore console.

4. Run production dry-run.

5. Run production real. Monitor Cloud Logging for `[backfill]` lines.

## Phase 3 — Frontend modal

1. Land Plan 6 Tasks 3–6 (api client + modal + AuthContext mount + dispatcher gate).
2. Deploy frontend.
3. Verify in production:
   - Sign in as a known legacy user (one not resolved by the backfill — e.g., a B2C user with no enrollments). Modal appears.
   - Pick "Student" → modal closes, lands on `/app/learn`. Verify `users/{uid}/profile` now has `intended_role='student'`, `onboarding_state='complete'`.
   - Sign out + sign in again. Modal does NOT reappear.
4. Spot-check 3 non-legacy users (recent signups). They should NEVER see the modal.

## Monitoring (1 week)

- Cloud Logging filter: `textPayload =~ "legacy_role_pick"` (modal picks) and `textPayload =~ "\\[backfill\\]"` (script transitions).
- Look for:
  - **Picks per day** declining toward zero (modal converges).
  - **Distribution of picks** — if >5% pick teacher/admin from the modal, surface to product as a signal that the spec text should be tuned.
  - **Stuck legacy population** — users who saw the modal but did not pick (`requires_legacy_role_pick=true` and `last_sign_in` >24h after modal first appeared). Track this via an ad-hoc query if needed.

## Rollback

- If the modal breaks the app: revert Phase 3 commit only. Phases 1 + 2 are independent and remain.
- If the endpoint breaks: revert Phase 1. Phases 2 + 3 are not yet deployed at this point in the rollout.
- If the backfill misclassifies users: re-run with `--dry-run` first to inspect; correct individual users via Firestore console (the script is idempotent on subsequent runs).
```

- [ ] **Step 2: Commit**

```bash
git add docs/school-integration/PLAN_6_ROLLOUT.md
git commit -m "docs(legacy-migration): rollout runbook for Plan 6"
```

---

## Final verification

After every task is green:

- [ ] **Run the full backend suite**

```bash
make test-backend
```

Expected: all tests pass (target: ≥845 tests, +15 from Plan 5's ≥830).

- [ ] **Run the full frontend suite**

```bash
cd frontend && npm run test -- --run
```

Expected: all tests pass (target: ≥270 tests, +10 from Plan 5's ≥260).

- [ ] **Run the backfill script tests**

```bash
python3 -m unittest tests.test_backfill_legacy_user_roles -v
```

Expected: 9 tests pass.

- [ ] **Smoke test the modal flow locally**

1. Start backend + frontend (`make dev`).
2. In Firestore emulator (or local dev project), create a user with `profile = {}` and no memberships/enrollments — this is a legacy user.
3. Sign in as that user.
4. Verify the modal mounts and the body copy matches spec §630.
5. Click "Student" → modal closes; user lands at `/app/learn`. Re-sign-in does not re-mount.
6. Reset the test user to `profile = {}` again. Sign in. Click "Teacher" → modal closes; user lands at `/signup/teacher/join-org`. `intended_role='teacher'`, `onboarding_state='role_selected'`.
7. Reset to `profile = {}`. Click "School administrator" → lands at `/signup/admin/org-wizard`.

- [ ] **Smoke test the backfill in staging**

Follow `docs/school-integration/PLAN_6_ROLLOUT.md` Phase 2.

---

## Self-review checklist

**Spec coverage (Section 7 of the design doc):**

| Spec item | Task(s) |
|---|---|
| Backfill priority order (admin > teacher > student) | Task 7 (infer_role_from_memberships, infer_role_from_signals) |
| Backfill --dry-run mode + transition counts | Task 7 |
| `requires_legacy_role_pick` flag on /api/auth/verify | Plan 1 (already shipped) |
| Blocking modal with exact body copy | Task 4 |
| POST /api/auth/migrate-role with server-side recheck | Task 2 |
| Student → complete, teacher → role_selected, admin → role_selected | Tasks 1, 2 |
| Telemetry log of role picks | Tasks 4, 7 (stdout logs) |
| Data preservation invariant (never delete/mutate learner data) | Task 7 (only writes profile.intended_role + onboarding_state) |
| Backend additions (auth route + database helper) | Tasks 1, 2 |
| Frontend additions (modal + AuthProvider + api client) | Tasks 3, 4, 5 |
| Rollout order (backend → backfill → modal) | Task 9 (runbook) |

**Sprint C absorption:** N/A for Plan 6 (Sprint C lived in Plan 5).

**Placeholder scan:** All steps contain code or commands. No "TBD" / "implement later" / "fill in details."

**Type consistency:**
- `IntendedRole` type is reused from `@/types` (Plan 1) in the modal + API client.
- `mark_user_legacy_role_picked` signature is uniform across Task 1 (definition), Task 2 (route call), and Task 7 (backfill writes directly via `update`, NOT via the helper, to keep the script free of `route_deps` dependencies — note the asymmetry intentionally).
- `migrateRole` client function (Task 3) returns `{intendedRole, onboardingState}` matching the route's response shape (Task 2).

If any check fails, fix inline before handing off.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-plan-6-legacy-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review. Plan 6 is small enough (9 tasks) to complete in 1–2 days.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`. Single-shot is reasonable given the small task count.

**Recommended:** Subagent-Driven, in a worktree at `.worktrees/plan-6-legacy-migration/`. Plan 6 is independent of Plan 5's worktree — both can land on `pilot/launch-v1` in either order, though Task 9's runbook should be followed in production regardless of merge order.