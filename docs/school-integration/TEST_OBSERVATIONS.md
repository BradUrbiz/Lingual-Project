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

---

## Bugs Found in Real-User Walkthrough (Kimmi @ kimmi@gmail.com)

These bugs were surfaced when testing as a real Firebase Auth user (Kimmi, a teacher who joined E2E Test School via the invite-code flow) instead of the test harness. They reflect issues that don't show up in our automated tests because the test harness short-circuits the affected code paths.

### OBS-11: Forced learner onboarding for users with teacher membership
- **Severity:** Bug (UX-blocking for new teachers)
- **Found by:** Kimmi walkthrough — sign in via /auth
- **Status:** Fixed (2026-04-08)
- **Description:** When Kimmi (who has a `teacher` membership in E2E Test School) signs in via Firebase Auth at `/auth`, the post-login routing sent her to `/general` — the learner profile setup wizard, "Step 1 of 5". She had no way to reach her teacher dashboard from the post-login flow except by typing `/app/teacher` directly into the URL bar. The post-login redirect logic treated every newly-signed-in user as a learner who needs to fill out personalization preferences first, ignoring the fact that they may already have a teacher membership.
- **Root cause:** `AuthPage.tsx` line 23 hardcoded `/general` as the default redirect, with no awareness of user roles.
- **Fix:** Updated `AuthPage.tsx` post-login `useEffect` to inspect `user.activeRoles` and `user.lingualAdmin`. Lingual admins → `/app/admin/school-requests`, teachers/school admins → `/app/teacher`, learners → `/general`. The protected-route `from` path still takes priority when present.

### OBS-12: Roster button crashed with TypeError on roster data
- **Severity:** Bug (crash, page goes blank)
- **Found by:** Kimmi walkthrough — click Roster button
- **Status:** Fixed (2026-04-08)
- **Description:** Clicking the **Roster** button on a class card on `TeacherDashboardPage` crashed the entire page with `TypeError: Cannot read properties of undefined (reading 'length')`. The whole dashboard went blank.
- **Root cause:** Frontend/backend contract mismatch. `backend/routes/teacher.py:api_get_class_roster` returned `{"success": True, "students": [...]}` while `frontend/src/api/teacher.ts:getClassRoster` read `response.data.roster`. The undefined value crashed `roster.length` in the dialog rendering.
- **Fix:** Changed backend to return `roster` field. Updated `test_school_foundation_routes.test_teacher_can_view_roster_and_remove_student` to assert on the new field name.

### OBS-13: Canvas-synced students invisible in roster (pending_sync filter)
- **Severity:** Bug (Canvas integration appears broken)
- **Found by:** Kimmi walkthrough — connect Canvas, check Roster shows 0 students
- **Status:** Fixed (2026-04-08)
- **Description:** When a teacher connects a Canvas course to a Lingual class, the sync correctly creates `pending_sync` enrollments for every Canvas student (with `canvas_user_id` and `canvas_email`). But the Roster view always showed "0 students enrolled" even though Firestore had 15 enrollment documents. From the teacher's perspective, **the Canvas roster sync looked completely broken**.
- **Root cause:** Two filters stacked. First, `database.py:list_class_enrollments` defaulted to `status='active'`, hiding `pending_sync` enrollments at the DB layer. Second, `backend/routes/teacher.py:api_get_class_roster` filtered out any enrollment with empty `student_uid` (which is exactly the `pending_sync` case). The combination meant pending Canvas students were doubly hidden.
- **Fix:** (a) `api_get_class_roster` now fetches both `active` and `pending_sync` enrollments. (b) Pending entries are included in the response with `displayName` derived from `canvas_name` (or `canvas_email` as fallback) and a `status: "pending_sync"` flag. (c) `database.py:create_enrollment` and `backend/services/canvas/sync.py` now capture and store `canvas_name` from Canvas. (d) Frontend `ClassRosterStudent` type adds `canvasEmail` and `canvasName` fields. (e) The Roster dialog UI shows a "Canvas pending" amber badge for pending students and hides the Remove button for them. (f) FakeDb classes in `conftest.py`, `test_school_foundation_routes.py`, and `test_admin_routes.py` updated to accept the new `status` kwarg.
- **Note:** Existing pending_sync rows in Firestore won't have the `canvas_name` field until they're re-created. The simplest backfill is to delete and re-sync. A future improvement would be to update `canvas_name` on the skip-existing path in `sync.py:sync_roster` so re-sync backfills the field automatically.

### OBS-14: "Workspace settings" button routes to school request page
- **Severity:** Bug (UX confusion, wrong destination)
- **Found by:** Kimmi walkthrough — click Workspace settings on dashboard
- **Status:** Open
- **Description:** Clicking **Workspace settings** on `TeacherDashboardPage` navigates to `/school/setup`, which now renders `SchoolRequestPage` (since we replaced `SchoolOnboardingPage` with the request flow in Piece 4 of the school org design). For Kimmi, this displays a stale "Pending Review — Constella" card from a school request she submitted before being approved into E2E Test School via the teacher invite code. There's no actual workspace settings UI yet, and routing teachers who already have a membership to the "request a new school" page is confusing and incorrect.
- **Resolution needed:** Two parts. (a) Build an actual **WorkspaceSettingsPage** that shows the teacher/admin their current school's settings (school name, type, status, member list, etc.) and route the button there. (b) The `GET /api/school-requests/mine` endpoint should not return a stale pending request when the user already has an active membership in any organization — or the `SchoolRequestPage` should detect that case and show a "you've already joined a school" state instead.

### OBS-15: Canvas re-sync skips existing rows without backfilling new fields
- **Severity:** Bug (data freshness, low priority for now)
- **Found by:** Bug hunt for OBS-13
- **Status:** Open
- **Description:** When `sync_roster` runs again on an already-synced class, it short-circuits at `existing_by_canvas_id[canvas_user_id]` and just bumps the `unchanged` counter without updating any fields (lines 56-63 of `backend/services/canvas/sync.py`). This means new fields added to the data model (like the `canvas_name` we just added) are never backfilled on existing rows — only newly-created enrollments get the field. Re-sync looks like a no-op for legacy rows.
- **Workaround:** Delete the existing pending_sync enrollments before re-syncing, which forces re-creation with the new fields.
- **Resolution needed:** Add an `update_enrollment_canvas_fields(enrollment_id, canvas_name=None, canvas_email=None)` helper to `database.py`, and call it from the skip path in `sync.py:sync_roster` whenever the existing row is missing one of the new fields. Same applies if Canvas changes a student's name in the future.

### OBS-16: Re-sync triggered by clicking "Connect course" but UI button stays "Loading..."
- **Severity:** Bug (UX, looks broken)
- **Found by:** Earlier walkthrough — connect Canvas, button stuck on Loading
- **Status:** Open (workaround documented)
- **Description:** When the teacher clicks **Connect course** on the Canvas connect page, the button shows "Loading..." while the backend syncs roster + content (20-30s for a real course). When the sync completes, the backend redirects work — but the browser's button never updates from "Loading..." even after the redirect. The teacher has to wait without feedback or refresh the page manually. Worse, if they click the button a second time thinking it didn't work, the re-click does nothing because the button is still in the loading state.
- **Resolution needed:** Either (a) add proper loading state polling/timeout in `CanvasConnectPage.tsx` so the button progresses through "Connecting → Syncing roster → Syncing content → Done", or (b) move the heavy sync work to a background task and show a "Sync in progress" banner on the redirected analytics page.

---

## Pilot Smoke Test — Teacher + Student End-to-End (2026-04-17)

Ran the full flow on `pilot/launch-v1`: teacher (`hello@gmail.com`) published `Sample: Meeting a new friend` on `AP Spanish Testing` → joined as student (`example@gmail.com`) via class join code → launched the assignment → sent a Spanish turn → inspected the AI response.

### OBS-17: Curriculum system prompt was hardcoded to French regardless of class locale
- **Severity:** Bug (pilot-blocking — every non-French class got French AI responses)
- **Found by:** Pilot smoke test — Spanish class student sent `"Hola, me llamo Example. Soy nuevo en la clase."` and the AI replied `"Salut Example ! Enchanté 😊 Moi, c'est Alex. On doit décider…"` (French).
- **Status:** Fixed (2026-04-17)
- **Description:** The `AP Spanish Testing` class had `learning_locale='es-ES'` set correctly by the teacher, the assignment resolver read the class locale, and the Teacher Assignment Builder header displayed `es-ES`. But the AI tutor responded entirely in French — every time, to every Spanish student turn. The bug affected every `learning_locale` other than `fr-FR` (so Korean, Spanish, Russian, Hebrew classes would all have failed the same way).
- **Root cause:** `main.py:build_curriculum_system_prompt` (the prompt assembly for curriculum-mapped assignments) was hardcoded to French from the original AP French v1 implementation. The function signature did not accept `learning_locale`, and the prompt body contained five hardcoded French literals: `"You are Lingu, an encouraging French speaking tutor"`, `"Target language: French (fr-FR)"`, `"respect tu/vous choices"`, `"Keep conversation primarily in French"`, and `"return to French"`. The parallel `build_system_prompt` (non-curriculum free-practice path) was already locale-parameterized via `LEARNING_LOCALE_PROMPT_CONFIG`, but `build_curriculum_system_prompt` was never updated to match.
- **Fix:** (a) `main.py:build_curriculum_system_prompt` now accepts `learning_locale='ko-KR'`, looks up `language_name` and `register_note` from the existing `LEARNING_LOCALE_PROMPT_CONFIG` table, replaces all five hardcoded literals with `{language_name}` / `{learning_locale}`, and adds an explicit rule: *"Respond ONLY in {language_name}. Never switch to another language, even if the curriculum materials or the student's turn use another language. Do not fall back to French, Spanish, or any other language unless the target language is that language."* (b) `backend/services/assignment_resolver.py` threads `class_record.learning_locale` into the builder. (c) `backend/routes/chat.py` curriculum-override path threads the user's profile `learning_locale`.
- **Verification:** Re-ran the same smoke test after restart. Identical class, assignment, curriculum mapping (`cur.fr.ap_french.fall2024.v1`), and module (`mod.1.1`); identical student turn. AI response: `"¡Hola, Example! Encantado 🙂 Yo me llamo Alex. Oye, estamos pensando en hacer una pequeña reunión con amigos y familia este fin de semana…"` — same persona, same scenario shape, **Spanish**. 94 backend tests passing (existing test fakes used `lambda **kwargs:` so they accepted the new kwarg transparently).
- **Note:** This fixed the *language* of the AI response but not the *cultural content*. Spanish classes still get French AP curriculum scenarios (e.g., `mod.1.1 = La famille et les relations`, translated to Spanish but written for a French cultural frame). Tracked as `LIMITATIONS.md #16`.
