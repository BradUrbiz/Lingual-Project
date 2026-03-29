# Test Observations

Status: Active
Last updated: 2026-03-27
Owner: Engineering

Observations surfaced during the P1–P5 testing sessions. Each item is categorized by severity and tracked with a resolution status.

---

## Bugs Found

### OBS-1: React hooks violation in TeacherDashboardPage.tsx
- **Severity:** Bug (crash)
- **Found by:** P4 frontend tests
- **Status:** Fixed (2026-03-27)
- **Description:** Two `useMemo` calls were placed after conditional `if (loading) return` / `if (!dashboard) return` statements. React 19 threw "Rendered more hooks than during the previous render" because the hook count changed between the loading and loaded renders.
- **Fix:** Moved both `useMemo` calls above the early returns. The callbacks now handle `dashboard === null` via optional chaining.
- **Risk if missed:** Dashboard would crash on every load in React 19 strict mode.

### OBS-2: Firestore composite indexes not deployed
- **Severity:** Bug (production-blocking)
- **Found by:** P5 E2E tests
- **Status:** Fixed (2026-03-27)
- **Description:** 7 composite indexes defined in `firestore.indexes.json` had never been deployed to the live Firestore instance. Every query using compound filters on `classes`, `enrollments`, `canvas_course_content`, and `memberships` collections returned HTTP 400.
- **Fix:** Ran `firebase deploy --only firestore:indexes`. All 7 indexes are now live on `lingu-480600`.
- **Risk if missed:** Teacher dashboard, school context resolution, class listing, enrollment queries, and Canvas content queries would all fail for any pilot user.
- **Lesson:** Add index deployment verification to the pilot readiness checklist and consider adding it to CI/CD.

---

## Architecture Issues

### OBS-3: Cookie domain mismatch between Vite dev server and Flask
- **Severity:** Development friction
- **Found by:** P5 E2E tests
- **Status:** Documented (workaround in place)
- **Description:** The Vite dev server on `:5173` proxies `/api/*` to Flask on `:5001`. Cookies set by direct HTTP requests to `:5001` are scoped to that port and don't propagate through the Vite proxy. E2E tests that login via `:5001` then navigate the frontend at `:5173` don't carry the session.
- **Workaround:** E2E tests must login via the frontend's proxy URL (`localhost:5173/api/test/login`), not the backend directly.
- **Impact:** Development-only. In production, the frontend and backend are served from the same origin (Cloud Run), so this doesn't apply.

### OBS-4: Frontend auth is a hard wall for E2E testing
- **Severity:** Testing infrastructure gap
- **Found by:** P5 E2E tests
- **Status:** Fixed (2026-03-28)
- **Description:** `AuthContext` depends entirely on Firebase `onAuthStateChanged`. There is no way to render authenticated frontend pages without a real Firebase user. We added an `__e2e_uid__` localStorage bypass that fetches user data from `/api/test/session` + `/api/schools/current`, but the response doesn't fully populate the `User` type that `MembershipContext` expects.
- **Impact:** Previously, teacher dashboard E2E worked but student learning page didn't render assignments because the E2E bypass returned incomplete membership data.
- **Fix:** Added `/api/test/verify` endpoint that returns the same user payload shape as `/api/auth/verify` (with full memberships array). Updated `AuthContext.tsx` E2E bypass to use it. Both teacher (9/9) and student (7/7) E2E tests now pass.

### OBS-5: Stale membership accumulation from repeated seeds
- **Severity:** Testing friction
- **Found by:** P5 E2E tests
- **Status:** Fixed (2026-03-28)
- **Description:** Each `POST /api/test/seed` creates a new org + new memberships for the same test user UIDs. The teacher/student users accumulate orphaned memberships from prior runs. `resolve_user_school_context` picks the first by alphabetical ID sort order, which may not be the latest org.
- **Fix:** Made the seed idempotent with fixed deterministic IDs (`e2e-org-001`, `e2e-class-001`, `e2e-mem-teacher-001`, etc.). The seed now checks for existing records before creating, and the login endpoint auto-pins the correct membership for known test users. Repeated seed calls are safe and stable.

---

## Test Coverage Gaps Revealed

### OBS-6: FakeDb doesn't catch Firestore index requirements
- **Severity:** Systemic testing gap
- **Found by:** P5 E2E tests (OBS-2 root cause)
- **Status:** Fixed (2026-03-28)
- **Description:** Backend unit tests use in-memory FakeDb classes that implement filtering with Python list comprehensions. This means any query that works in FakeDb will pass tests, even if the equivalent Firestore query requires a composite index that doesn't exist. The `list_student_assignments`, `list_org_classes`, and `list_teacher_classes` queries all silently passed in unit tests but failed in production Firestore.
- **Impact:** Unit tests cannot catch missing Firestore indexes. Only integration tests against a real Firestore (or emulator) can.
- **Fix:** Created `test_firestore_indexes.py` with 7 integration tests that run against the Firestore emulator. Each test exercises a compound query from `database.py` that requires a composite index. Tests auto-skip when the emulator isn't running (normal `make test-backend` still works). Run with `make test-emulator`. All 7 indexes from `firestore.indexes.json` are now verified: memberships (uid+status), classes (org_id+status+updated_at, teacher_membership_ids+status+updated_at), enrollments (class_id, student_uid, canvas_email variants), and canvas_course_content (class_id+positions).

### OBS-7: Formal register error detection is silently conditional
- **Severity:** Low (correct behavior, but fragile configuration)
- **Found by:** P1-B practice analytics tests
- **Status:** Documented (covered by unit tests now)
- **Description:** The `fr.formal_register_mismatch` error rule only fires when the situation's `register` field is exactly `"formal"` AND the locale starts with `fr`. If a teacher sets `register: "informal"`, the formal register error detection is completely disabled — which is correct, but there's no teacher-facing indication that this rule is inactive.
- **Impact:** Teachers might expect register feedback regardless of the situation register setting. A future UI enhancement could show which error rules are active for a given mapping.

### OBS-8: Dashboard speakingMinutes is always 0
- **Severity:** Medium (pilot-visible)
- **Found by:** P4 frontend tests + P5 E2E tests
- **Status:** Fixed (2026-03-28)
- **Description:** The teacher dashboard summary endpoint does not aggregate session-level `estimated_speaking_time_seconds` into the `speakingMinutes` stat. The stat card always renders "0". Individual class analytics and student drill-down do show speaking time correctly — it's only the dashboard-level summary that's missing the aggregation.
- **Fix:** `build_teacher_dashboard_payload` in `teacher.py` now iterates over accessible classes, loads their practice sessions, and sums `estimated_speaking_time_seconds` from session summaries. Result is rounded to whole minutes. LIMITATIONS.md updated to remove the hardcoded-zero note.

---

## Process Observations

### OBS-9: Backend coverage baseline
- **Severity:** Informational
- **Found by:** P3 coverage reporting
- **Status:** Improved (auth.py 35% → 95%; overall 69% stable after adding 455 tests)
- **Coverage by area (current):**
  - `auth.py` routes: **95%** (was 35%, fixed via mock firebase_auth)
  - `compliance.py`: 96%
  - `assignment_resolver.py`: 96%
  - `pedagogy/*`: 85–96%
  - `practice_analytics.py`: 81%
  - `guardian_packets.py`: 80%
  - `admin.py` routes: 72%
  - `teacher.py` routes: 67%
  - `curriculum_admin.py` routes: 60%
  - `chat.py` routes: 40% (legacy, not school-integration — not planned)
  - `games.py` routes: 0% (not school-integration — not planned)
- **Resolution:** School-integration services and auth are well-covered. Remaining gaps are in legacy routes intentionally excluded from scope.

### OBS-10: 17 duplicated FakeDb classes across test files
- **Severity:** Low (tech debt)
- **Found by:** P3 audit
- **Status:** Mitigated (shared `conftest.py` for new tests)
- **Description:** Each test file defines its own inline FakeDb with 15–30 methods, many of which are identical across files. The shared `FakeDbBase` in `conftest.py` solves this for new tests, but the existing 17 classes remain.
- **Resolution:** New tests should import from `conftest.py`. Migrating existing tests is optional and low-priority since they all pass.
