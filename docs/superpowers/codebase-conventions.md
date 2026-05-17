# Codebase Conventions for Plan Implementers

Conventions discovered or relied on during Plan 1 (Foundations + Outbox) execution. Read this before writing or implementing any subsequent plan — it captures non-obvious choices that aren't in CLAUDE.md or the spec but matter when generating code or tests.

This file is intentionally short. It supplements, not replaces, `CLAUDE.md` and the spec.

---

## 1. Test framework: `unittest.TestCase`, never pytest functions

Every test file in `backend/tests/` and `functions/tests/` uses `unittest.TestCase` subclasses. Bare `def test_…()` functions (pytest style) are not the project convention. The project's standard test runner is `unittest`; `pytest` is also installed but not the primary entry point.

When writing tests:

```python
import unittest
from unittest.mock import patch, MagicMock

class MyFeatureTest(unittest.TestCase):
    def test_behavior(self):
        self.assertEqual(actual, expected)

    def test_error(self):
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            do_thing()
```

Test runners:
- Single file: `python3 -m unittest backend.tests.test_X -v`
- All backend: `make test-backend`
- All functions: `python3 -m unittest functions.tests.test_X -v`
- All frontend: `cd frontend && npm run test -- --run`
- Everything: `make test-all`

If a plan doc shows pytest-style snippets, treat them as illustrative — convert to `unittest.TestCase` when implementing.

---

## 2. Backend DI: `RouteDeps` via blueprint factory

Every Flask blueprint is registered via `create_<name>_blueprint(deps)`. Never import `main` or module-level singletons directly. Inside a route, dependencies are accessed via the `deps` parameter:

```python
deps.db.get_or_create_user(uid, email, name)
deps.firebase_auth.verify_id_token(token)
deps.allowed_learning_locales
deps.get_current_user_uid()
```

Notable: `deps.db` **is the `database` module itself** (not a class instance). So `deps.db.list_lingual_admin_emails()` and `from database import list_lingual_admin_emails` both work. Test fixtures replace `deps.db` with `FakeDbBase` subclasses.

See `backend/route_deps.py` for the full surface, `main.py` for how it's constructed, `backend/routes/*.py` for usage.

---

## 3. Backend test fixtures: `FakeDbBase`, `make_test_app`

Route tests do NOT use pytest fixtures. The pattern, established in `backend/tests/conftest.py`, is:

1. Subclass `FakeDbBase` in your test module, override only the methods your route touches. Keep state in-memory dicts.
2. Build a `RouteDeps` via `make_test_deps(db=FakeYourDb(), firebase_auth=FakeFirebaseAuth(...))`.
3. Register your blueprint on `make_test_app(deps)`.
4. Use `app.test_client()` directly. No fixtures, no monkeypatching of HTTP layer.

Example: `backend/tests/test_auth_routes.py` is the canonical reference.

For unit tests that don't need a full Flask app (helpers, services), `unittest.mock.patch` against the module is fine. See `backend/tests/test_outbox_writer.py` for the pattern.

---

## 4. Naming: snake_case in Python + Firestore, camelCase in TypeScript

| Layer | Convention | Example |
|---|---|---|
| Python identifiers | snake_case | `intended_role`, `update_user_profile` |
| Firestore field names | snake_case | `users/{uid}.profile.intended_role` |
| JSON request bodies (in to backend) | snake_case | `{ "idToken": …, "intended_role": "teacher" }` |
| JSON response bodies (out of backend) | camelCase | `{ "intendedRole": "teacher", "onboardingState": "role_selected" }` |
| TypeScript identifiers | camelCase | `intendedRole`, `onboardingState` |

Note the asymmetry between request-in (snake_case) and response-out (camelCase). This is intentional and matches existing routes — when extending an endpoint, follow it.

`idToken` is the one exception to the request-in rule and predates the convention; don't fight it.

---

## 5. Firestore writes use dotted-path updates, not subcollection set+merge

`users/{uid}` is one document with a nested `profile` map, NOT a `users/{uid}/profile/main` subcollection. Profile updates use dotted-path field updates on the user doc:

```python
# In database.update_user_profile
user_ref.update({
    'profile.display_name': display_name,
    'profile.intended_role': intended_role,
    # ...
})
```

If a plan snippet shows `user_ref.collection('profile').document('main').set(..., merge=True)` — that's WRONG for this codebase. The schema comment at the top of `database.py` mentions subcollections in places; it's drifted from reality. Trust the code.

---

## 6. Firestore SDK import path

Use:

```python
from firebase_admin import firestore as fb_firestore
# then
fb_firestore.SERVER_TIMESTAMP
fb_firestore.client()
```

Not `from google.cloud import firestore`. Both work technically; `firebase_admin.firestore` is the project standard and what existing code uses.

---

## 7. Cloud Function trigger / scheduler: split into `_impl` + decorated wrapper

`firebase_functions` decorators wrap the function so `MagicMock` events break it. The pattern that works (established in Plan 1):

```python
def _send_outbox_email_impl(event):
    # pure business logic, directly testable
    ...

@firestore_fn.on_document_written(document='outbox_emails/{emailId}')
def send_outbox_email(event):
    """Thin wrapper for testability — see _impl."""
    return _send_outbox_email_impl(event)
```

Tests import and call `_send_outbox_email_impl(MagicMock())` directly. Same pattern for `_retry_outbox_sweep_impl` + `retry_outbox_sweep` scheduler.

When mocking the function module in tests, also wrap with `patch('firebase_admin.initialize_app')` because `functions/main.py` calls `initialize_app()` at module level:

```python
with patch('firebase_admin.initialize_app'):
    from functions.main import _send_outbox_email_impl
```

---

## 8. Outbox pattern for emails (Plan 1 contract)

Any business action that triggers an email writes to the Firestore `outbox_emails/` collection via `backend.services.outbox.enqueue_outbox_email(...)`. A Cloud Function in `functions/main.py` picks up new docs and sends via Resend.

Key invariants:
- Outbox write goes inside (or alongside) the business transaction.
- Failure to enqueue must NEVER fail the business call. Wrap with try/except.
- Each new template needs: an `OutboxTemplate` enum entry, a `functions/templates/{template_id}.html.j2` file, and an entry in `_TEMPLATE_SUBJECTS` in `functions/main.py`.
- The trigger only processes `status='pending'`; the 5-min scheduler promotes `failed→pending` and touches stuck pending docs. See `functions/main.py` for the full state machine.

When adding a new template (Plans 3+): all three additions land in one commit and are wired together with a test that asserts the business action queues the expected outbox doc.

---

## 9. Frontend: lazy routes + provider stack + typed API modules

`frontend/src/App.tsx` is the router. New page = new `React.lazy()` + new `<Route>`. Use the right guard wrapper:

| Guard | When |
|---|---|
| `ProtectedRoute` | Signed-in users only |
| `AppProtectedRoute` | Inside the `/app` shell |
| `TeacherRoute` | Teacher or school_admin membership |
| `LingualAdminRoute` | Lingual superadmin only |

Provider stack (outermost → inner) in `App.tsx`:
`AuthProvider → MembershipProvider → LanguageProvider → LearningLocaleProvider`.

API client modules live one-per-blueprint in `frontend/src/api/`. All routes through the shared axios instance in `frontend/src/api/index.ts`. Types live in `frontend/src/types/index.ts` (the `User` interface) and `frontend/src/types/<domain>.ts`.

---

## 10. Plan 1 contract surface (what later plans build on)

After Plan 1 lands, the following is true and consumable:

**Backend (`/api/auth/verify`):**
- Accepts optional `intended_role` in body (validated against `database.ALLOWED_INTENDED_ROLES`).
- On first verify of a user with no active memberships, persists `intended_role` + `onboarding_state='role_selected'` to `users/{uid}/profile`.
- Returns payload with `intendedRole`, `onboardingState`, `requiresLegacyRolePick` (camelCase) alongside existing fields.

**User profile:**
- `users/{uid}.profile.intended_role`: `'student' | 'teacher' | 'admin' | null`.
- `users/{uid}.profile.onboarding_state`: one of `ALLOWED_ONBOARDING_STATES` (see `database.py`).
- `database.is_legacy_user_needing_role_pick(user_doc, memberships)` is the canonical legacy detector.

**Outbox infrastructure:**
- `outbox_emails/` collection (denied to clients, written by backend, processed by Cloud Function).
- `OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL` is the one wired template. Adding more is mechanical.
- `database.list_lingual_admin_emails()` returns the UNION of `memberships.roles contains 'lingual_admin'` AND legacy `users/{uid}.lingual_admin == True` (transitional — the legacy branch goes away once admins are fully migrated to memberships).
- Email CTA links currently point to `/app/admin/school-requests` (the existing route). Plan 5 will introduce `/app/lingual-admin/*` and a permanent redirect; until then, use the existing route.

**Frontend:**
- `User` type has `intendedRole?`, `onboardingState?`, `requiresLegacyRolePick?`.
- `verifyToken(idToken, { intendedRole })` accepts the new optional argument.
- No UI for role-aware signup yet — that's Plan 2.

---

## 11. Commit message style

```
feat(scope): short imperative description

Longer body if needed: WHY this change, not WHAT.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Scopes seen so far: `auth`, `onboarding`, `outbox`, `school-requests`, `functions`, `frontend`, `firestore`, `rules`. Pick the most specific.

Verbs: `feat` for additive behavior, `fix` for correctness, `refactor` for non-behavioral cleanup, `chore` for config/deps, `docs` for documentation only.

One logical change per commit. Tests + implementation go in the same commit (TDD discipline).

---

## 12. Make targets cheat sheet

```bash
make test-backend          # Python unittest in backend/tests/
make test-frontend         # Vitest in frontend/
make test-firebase         # Firestore emulator rules tests (needs Java)
make test-e2e              # Shell-based E2E
make test                  # backend + frontend
make test-all              # everything above
make coverage-backend      # HTML coverage report
```

Cloud Functions tests are not yet in any Makefile target — run with `python3 -m unittest functions.tests.test_X -v` directly. Add a `make test-functions` target if you wire it up.

---

## 13. When something here is wrong

This doc is itself a Plan 1 byproduct. If a future plan discovers a different convention or this doc is out of date, the *code* is the source of truth — update this file in the same PR that changes the convention.
