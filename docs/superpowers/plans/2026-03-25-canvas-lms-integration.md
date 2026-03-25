# Canvas LMS Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 Canvas LMS beta flow: teacher connects Canvas with a PAT, Lingual creates or links a class, roster/content sync runs manually, assignments can be linked to Canvas module items, and students can browse Canvas course structure inside Lingual.

**Architecture:** Build Canvas as a Canvas-specific integration slice on top of the existing school domain, not as a generic LMS abstraction. Add two server-owned Firestore collections (`canvas_connections`, `canvas_course_content`), extend existing class/enrollment/assignment/auth flows for Canvas-managed state, then layer teacher connect/sync UI and student module rendering onto the current teacher analytics, roster, assignment builder, and learning surfaces. Keep sync read-only from Canvas with manual teacher-triggered re-sync; defer OAuth 2.0, LTI 1.3, webhooks, and grade passback.

**Tech Stack:** Flask + Firebase Admin/Firestore + `requests` + `cryptography`, React 19 + TypeScript + Vite, Vitest, Firebase Emulator rule tests.

**Spec:** `docs/superpowers/specs/2026-03-18-canvas-lms-integration-design.md`

---

## Chunk 1: Domain model, Firestore indexes, and auth plumbing

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `database.py` | Add Canvas collections/helpers and extend class/enrollment/assignment records |
| Modify | `backend/routes/auth.py` | Activate `pending_sync` enrollments on login |
| Modify | `backend/routes/teacher.py` | Expose active roster plus pending Canvas signups |
| Modify | `firestore.indexes.json` | Add Canvas and pending-enrollment indexes |
| Modify | `firestore.rules` | Add `canvas_course_content` read rules and deny `canvas_connections` client access |
| Create | `backend/tests/test_canvas_foundation.py` | Auth + roster + helper coverage for Canvas foundation |
| Modify | `backend/tests/test_auth_memberships.py` | Verify pending enrollment activation on `/api/auth/verify` |
| Modify | `firebase-tests/firestore-rules.test.ts` | Add rule tests for Canvas collections |

### Task 1: Extend Firestore model for Canvas records and fields

- [ ] **Step 1: Write failing backend tests for the new data model**

Create `backend/tests/test_canvas_foundation.py` with coverage for:
- `create_enrollment(..., status='pending_sync', canvas_user_id=..., canvas_email=...)`
- `list_pending_canvas_enrollments_by_email(email)`
- roster serialization separating active students from `pending_sync`
- assignment/class helpers returning new Canvas fields

Example test shape:

```python
def test_list_pending_canvas_enrollments_by_email_returns_only_pending_matches():
    db.create_enrollment(
        class_id='class-1',
        student_uid='pending:canvas-user-1',
        status='pending_sync',
        join_source='canvas',
        canvas_user_id='canvas-user-1',
        canvas_email='student@example.com',
        enrollment_id='class-1__canvas-user-1',
    )
    matches = db.list_pending_canvas_enrollments_by_email('student@example.com')
    assert len(matches) == 1
    assert matches[0]['status'] == 'pending_sync'
```

- [ ] **Step 2: Run the new backend test file to verify RED**

Run: `pytest -q backend/tests/test_canvas_foundation.py`
Expected: FAIL because Canvas helpers/fields do not exist yet.

- [ ] **Step 3: Implement minimal Canvas schema helpers in `database.py`**

Add:
- collection/ref helpers for `canvas_connections` and `canvas_course_content`
- `create_canvas_connection`, `get_canvas_connection_by_class`, `delete_canvas_connection`
- `replace_canvas_course_content_for_connection`, `list_canvas_course_content_for_class`
- optional Canvas fields on `create_enrollment`, `create_assignment`, and `create_class`
- `list_pending_canvas_enrollments_by_email`
- a batch helper for assignment <-> Canvas item linking

Key rules:
- `pending_sync` enrollments cannot use the current deterministic `{class_id}_{student_uid}` id because no real `uid` exists yet
- use a deterministic Canvas-scoped id for pending records such as `{class_id}__{canvas_user_id}`
- preserve current deterministic ids for active Lingual users

- [ ] **Step 4: Run backend tests and keep the helper layer GREEN**

Run:
- `pytest -q backend/tests/test_canvas_foundation.py`
- `pytest -q backend/tests/test_auth_memberships.py backend/tests/test_school_foundation_routes.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_canvas_foundation.py backend/tests/test_auth_memberships.py
git commit -m "feat: add Canvas Firestore foundation helpers"
```

### Task 2: Activate pending Canvas enrollments during auth verification

- [ ] **Step 1: Add failing auth tests**

Extend `backend/tests/test_auth_memberships.py` to cover:
- matching `pending_sync` enrollment by `canvas_email`
- creating student membership if missing
- converting enrollment to `active`
- linking `student_uid` and `student_membership_id`
- multi-org activation behavior

Example assertion shape:

```python
assert activated_enrollment['status'] == 'active'
assert activated_enrollment['student_uid'] == 'student-1'
assert created_membership['roles'] == ['student']
```

- [ ] **Step 2: Run the auth test file to verify RED**

Run: `pytest -q backend/tests/test_auth_memberships.py`
Expected: FAIL because `/api/auth/verify` does not query pending Canvas enrollments yet.

- [ ] **Step 3: Implement the post-auth activation flow**

Modify `backend/routes/auth.py` so `verify_auth()`:
- resolves pending Canvas enrollments by `email`
- for each match:
  - creates `memberships/{org_id}_{uid}` if missing
  - activates the enrollment and fills `student_uid` / `student_membership_id`
  - preserves `join_source='canvas'`
- refreshes school context after activation before building the auth payload

- [ ] **Step 4: Re-run auth + school foundation tests**

Run:
- `pytest -q backend/tests/test_auth_memberships.py`
- `pytest -q backend/tests/test_school_foundation_routes.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/auth.py backend/tests/test_auth_memberships.py
git commit -m "feat: activate pending Canvas enrollments on login"
```

### Task 3: Update rules and indexes for Canvas collections

- [ ] **Step 1: Add failing Firebase rule tests**

Extend `firebase-tests/firestore-rules.test.ts` with cases for:
- `canvas_connections`: deny reads/writes for teacher, student, admin, outsider
- `canvas_course_content`: allow enrolled student read
- `canvas_course_content`: deny read for outsider and deny all writes

- [ ] **Step 2: Add required index definitions**

Modify `firestore.indexes.json` to add:
- `classes`: `(join_code, join_code_active, status)`
- `enrollments`: `(canvas_email, status)`
- `canvas_connections`: `(class_id)`
- `canvas_course_content`: `(class_id, canvas_module_position, item_position)`

- [ ] **Step 3: Implement rule changes**

Modify `firestore.rules`:
- add `match /canvas_connections/{connectionId}` with `allow read, write: if false;`
- add `match /canvas_course_content/{contentId}` allowing read when the current user has active enrollment for `resource.data.class_id`
- keep all writes server-only

- [ ] **Step 4: Run rule tests**

Run: `cd firebase-tests && npm test`
Expected: PASS in an environment with Java installed and Firebase Emulator available.

Prerequisite: local Java runtime. If missing, install Java before claiming completion.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json firebase-tests/firestore-rules.test.ts
git commit -m "feat: add Canvas Firestore rules and indexes"
```

## Chunk 2: Canvas backend services and route surface

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/services/canvas/client.py` | Canvas REST client with pagination and typed errors |
| Create | `backend/services/canvas/encryption.py` | PAT encrypt/decrypt using AES-256-GCM |
| Create | `backend/services/canvas/sync.py` | Roster and course content sync orchestration |
| Create | `backend/services/canvas/__init__.py` | Package exports |
| Create | `backend/routes/integrations.py` | Canvas validate/connect/sync/status/disconnect/link endpoints |
| Modify | `main.py` | Register integrations blueprint |
| Modify | `requirements.txt` | Add `cryptography` dependency for AES-GCM |
| Create | `backend/tests/test_canvas_client.py` | Canvas client unit tests |
| Create | `backend/tests/test_canvas_sync.py` | Sync reconciliation tests |
| Create | `backend/tests/test_canvas_routes.py` | Route-level behavior tests |

### Task 4: Implement Canvas API client and PAT encryption

- [ ] **Step 1: Write failing tests for the client and encryption helpers**

Create:
- `backend/tests/test_canvas_client.py`
- `backend/tests/test_canvas_encryption.py`

Cover:
- `GET /api/v1/users/self` auth validation
- Link-header pagination
- `401`, `403`, `404`, `429`, timeout handling
- encrypt/decrypt round-trip
- missing `CANVAS_PAT_ENCRYPTION_KEY` error

- [ ] **Step 2: Run the focused tests to verify RED**

Run:
- `pytest -q backend/tests/test_canvas_client.py`
- `pytest -q backend/tests/test_canvas_encryption.py`

Expected: FAIL because the modules do not exist yet.

- [ ] **Step 3: Implement `CanvasClient` and encryption helpers**

Create `backend/services/canvas/client.py` with:
- `CanvasClient(instance_url: str, pat: str)`
- `get_user()`
- `get_courses()`
- `get_course(course_id)`
- `get_modules(course_id)`
- `get_module_items(course_id, module_id)`
- `get_students(course_id)`

Create `backend/services/canvas/encryption.py` with:
- `encrypt_pat(raw_pat: str) -> str`
- `decrypt_pat(ciphertext: str) -> str`
- `mask_pat(raw_pat: str) -> str`

Implementation notes:
- use existing `requests` dependency
- normalize base URL once
- respect `Retry-After` on `429`
- never log raw PAT values

- [ ] **Step 4: Re-run the focused tests**

Run:
- `pytest -q backend/tests/test_canvas_client.py`
- `pytest -q backend/tests/test_canvas_encryption.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add requirements.txt backend/services/canvas backend/tests/test_canvas_client.py backend/tests/test_canvas_encryption.py
git commit -m "feat: add Canvas API client and PAT encryption"
```

### Task 5: Implement roster/content sync orchestration

- [ ] **Step 1: Write failing sync tests**

Create `backend/tests/test_canvas_sync.py` covering:
- email match to existing Firebase user
- SIS ID fallback through `student_number`
- unmatched student -> `pending_sync`
- removed Canvas student deactivates only `join_source='canvas'` enrollments
- removed pending student gets deleted
- course content flattening preserves module/item position

Example reconciliation expectation:

```python
assert result['matched'] == 5
assert result['unmatched'] == 12
assert result['deactivated'] == 2
```

- [ ] **Step 2: Run sync tests to verify RED**

Run: `pytest -q backend/tests/test_canvas_sync.py`
Expected: FAIL because sync orchestration does not exist yet.

- [ ] **Step 3: Implement `backend/services/canvas/sync.py`**

Add:
- `sync_roster(connection, canvas_client, deps)`
- `sync_course_content(connection, canvas_client, deps)`
- `reconcile_enrollments(canvas_students, existing_enrollments)`
- `SyncResult` serialization helper

Scope rules:
- active Lingual users matched by email first, SIS fallback second
- unmatched Canvas users create `pending_sync` enrollments
- manual/join-code enrollments are never deactivated by Canvas sync
- content mirror is replaced atomically per connection sync

- [ ] **Step 4: Re-run sync + foundation tests**

Run:
- `pytest -q backend/tests/test_canvas_sync.py`
- `pytest -q backend/tests/test_canvas_foundation.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/canvas/sync.py backend/tests/test_canvas_sync.py
git commit -m "feat: add Canvas roster and content sync service"
```

### Task 6: Add the integrations blueprint and endpoint coverage

- [ ] **Step 1: Write failing route tests**

Create `backend/tests/test_canvas_routes.py` covering:
- `POST /api/integrations/canvas/validate`
- `POST /api/integrations/canvas/connect`
- `POST /api/teacher/classes/<class_id>/canvas/sync`
- `GET /api/teacher/classes/<class_id>/canvas/status`
- `DELETE /api/teacher/classes/<class_id>/canvas/disconnect`
- `POST /api/teacher/assignments/<assignment_id>/canvas-link`
- `DELETE /api/teacher/assignments/<assignment_id>/canvas-link`

Test:
- teacher-only authorization
- org/class ownership checks
- 5-minute cooldown enforcement
- PAT key missing -> `503`
- class creation/link on connect
- sync summary response shape

- [ ] **Step 2: Run route tests to verify RED**

Run: `pytest -q backend/tests/test_canvas_routes.py`
Expected: FAIL because the blueprint does not exist yet.

- [ ] **Step 3: Implement `backend/routes/integrations.py` and register it**

Create the blueprint and register it in `main.py`.

Recommended route split:
- `/api/integrations/canvas/validate`
- `/api/integrations/canvas/connect`
- `/api/teacher/classes/<class_id>/canvas/status`
- `/api/teacher/classes/<class_id>/canvas/sync`
- `/api/teacher/classes/<class_id>/canvas/disconnect`
- `/api/teacher/assignments/<assignment_id>/canvas-link`
- `/api/teacher/assignments/<assignment_id>/canvas-link` (`DELETE`)

Keep the blueprint server-only; all PAT handling stays on the backend.

- [ ] **Step 4: Run route + surrounding regression tests**

Run:
- `pytest -q backend/tests/test_canvas_routes.py`
- `pytest -q backend/tests/test_curriculum_admin_routes.py`
- `pytest -q backend/tests/test_school_foundation_routes.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main.py backend/routes/integrations.py backend/tests/test_canvas_routes.py
git commit -m "feat: add Canvas integration routes"
```

## Chunk 3: Teacher connection flow, sync status, and roster UX

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/api/canvas.ts` | Typed Canvas integration API client |
| Create | `frontend/src/types/canvas.ts` | Canvas DTOs |
| Create | `frontend/src/pages/CanvasConnectPage.tsx` | Two-stage teacher connect flow |
| Create | `frontend/src/pages/CanvasConnectPage.test.tsx` | Connect flow tests |
| Create | `frontend/src/components/canvas/CanvasSyncStatus.tsx` | Teacher-facing status badge and sync action |
| Create | `frontend/src/components/canvas/CanvasSyncStatus.test.tsx` | Status badge tests |
| Modify | `frontend/src/App.tsx` | Add Canvas connect route |
| Modify | `frontend/src/pages/TeacherClassAnalyticsPage.tsx` | Add connect/sync surface |
| Modify | `frontend/src/pages/TeacherDashboardPage.tsx` | Show pending Canvas signups in roster dialog |
| Create | `frontend/src/pages/TeacherDashboardPage.canvas.test.tsx` | Pending-signup roster behavior test |

### Task 7: Build the teacher Canvas connect flow

- [ ] **Step 1: Write failing frontend tests**

Create `frontend/src/pages/CanvasConnectPage.test.tsx` covering:
- instance URL + PAT form render
- validate call populates course choices
- connect submit creates/links course and navigates back to class page
- inline error display for auth failure and missing encryption key

- [ ] **Step 2: Run the page test to verify RED**

Run: `cd frontend && npx vitest run src/pages/CanvasConnectPage.test.tsx`
Expected: FAIL because the page/API/types do not exist yet.

- [ ] **Step 3: Implement `api/canvas.ts`, `types/canvas.ts`, and `CanvasConnectPage.tsx`**

The page should:
- collect `canvasInstanceUrl` and `pat`
- call validate first
- render teacher-visible course list
- allow either:
  - create a new Lingual class from the selected course
  - link selected course to an existing class if `existingClassId` is passed or selected
- call connect and redirect to `/app/teacher/classes/:classId/analytics`

- [ ] **Step 4: Add route wiring**

Modify `frontend/src/App.tsx` to add:
- `/app/teacher/classes/:classId/canvas/connect`

If a class-agnostic connect path is needed for “create class from Canvas”, add:
- `/app/teacher/canvas/connect`

- [ ] **Step 5: Re-run the connect-flow test**

Run: `cd frontend && npx vitest run src/pages/CanvasConnectPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/canvas.ts frontend/src/types/canvas.ts frontend/src/pages/CanvasConnectPage.tsx frontend/src/pages/CanvasConnectPage.test.tsx frontend/src/App.tsx
git commit -m "feat: add teacher Canvas connect flow"
```

### Task 8: Add sync status and pending-signup roster UI

- [ ] **Step 1: Write failing component/page tests**

Create:
- `frontend/src/components/canvas/CanvasSyncStatus.test.tsx`
- `frontend/src/pages/TeacherDashboardPage.canvas.test.tsx`

Cover:
- idle/syncing/error states
- cooldown message
- pending Canvas signups rendered in a separate section
- pending entries do not show remove actions meant for active students

- [ ] **Step 2: Run the new tests to verify RED**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasSyncStatus.test.tsx`
- `cd frontend && npx vitest run src/pages/TeacherDashboardPage.canvas.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the teacher-facing Canvas surfaces**

Modify:
- `TeacherClassAnalyticsPage.tsx`
  - add a “Connect Canvas” or “Sync with Canvas” action in the header area
  - render `CanvasSyncStatus`
- `TeacherDashboardPage.tsx`
  - extend roster dialog to render:
    - active students
    - “Awaiting signup” section for `pending_sync`
  - show Canvas metadata such as `canvasEmail` and sync label where helpful

- [ ] **Step 4: Re-run the new tests**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasSyncStatus.test.tsx src/pages/TeacherDashboardPage.canvas.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/canvas/CanvasSyncStatus.tsx frontend/src/components/canvas/CanvasSyncStatus.test.tsx frontend/src/pages/TeacherClassAnalyticsPage.tsx frontend/src/pages/TeacherDashboardPage.tsx frontend/src/pages/TeacherDashboardPage.canvas.test.tsx
git commit -m "feat: add Canvas sync status and pending signup roster UI"
```

## Chunk 4: Assignment linking and student Canvas course content

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/components/canvas/CanvasLinkPicker.tsx` | Assignment-builder Canvas item picker |
| Create | `frontend/src/components/canvas/CanvasLinkPicker.test.tsx` | Picker tests |
| Create | `frontend/src/components/canvas/CanvasModuleView.tsx` | Student module/item renderer |
| Create | `frontend/src/components/canvas/CanvasModuleView.test.tsx` | Student view tests |
| Modify | `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` | Add optional Canvas item linking |
| Modify | `frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx` | Cover linking flow |
| Modify | `frontend/src/pages/AppLearningPage.tsx` | Render connected-class course content |
| Create | `frontend/src/pages/AppLearningPage.test.tsx` | Student course-content rendering test |
| Modify | `backend/tests/test_canvas_routes.py` | Add assignment link/unlink assertions |

### Task 9: Add assignment <-> Canvas module item linking

- [ ] **Step 1: Extend failing tests**

Add tests for:
- `CanvasLinkPicker` rendering available module items
- assignment builder showing the picker only when the class has a Canvas connection
- link/unlink action calling the new endpoints

- [ ] **Step 2: Run the focused tests to verify RED**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasLinkPicker.test.tsx`
- `cd frontend && npx vitest run src/pages/TeacherAssignmentBuilderPage.test.tsx`
- `pytest -q backend/tests/test_canvas_routes.py`

Expected: FAIL.

- [ ] **Step 3: Implement picker + backend wiring**

Modify:
- `TeacherAssignmentBuilderPage.tsx`
  - fetch Canvas status/content when the class is Canvas-connected
  - show `CanvasLinkPicker` beside assignment authoring controls
  - include linked item state in the assignment list
- backend assignment link/unlink endpoints
  - use Firestore batch writes so both sides update atomically

- [ ] **Step 4: Re-run focused tests**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasLinkPicker.test.tsx src/pages/TeacherAssignmentBuilderPage.test.tsx`
- `pytest -q backend/tests/test_canvas_routes.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/canvas/CanvasLinkPicker.tsx frontend/src/components/canvas/CanvasLinkPicker.test.tsx frontend/src/pages/TeacherAssignmentBuilderPage.tsx frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx backend/tests/test_canvas_routes.py
git commit -m "feat: add Canvas assignment linking flow"
```

### Task 10: Render Canvas course structure for students

- [ ] **Step 1: Write failing student-view tests**

Create:
- `frontend/src/components/canvas/CanvasModuleView.test.tsx`
- `frontend/src/pages/AppLearningPage.test.tsx`

Cover:
- collapsible modules render in Canvas order
- non-Lingual items show due date + “Open in Canvas”
- linked Lingual items show “Start Practice”
- unlinked Lingual assignments still appear in the existing assigned-practice section

- [ ] **Step 2: Run the new tests to verify RED**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasModuleView.test.tsx`
- `cd frontend && npx vitest run src/pages/AppLearningPage.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement student Canvas module rendering**

Modify `AppLearningPage.tsx` to:
- load Canvas-connected course content alongside assignments
- render a per-class “Course Content” section when a class has synced Canvas content
- reuse assignment launch links for linked Lingual items
- keep existing “Assigned practice” cards intact

Create `CanvasModuleView.tsx` to own the layout and sorting logic.

- [ ] **Step 4: Re-run student-view tests**

Run:
- `cd frontend && npx vitest run src/components/canvas/CanvasModuleView.test.tsx src/pages/AppLearningPage.test.tsx`
- `cd frontend && npx vitest run src/pages/AssignmentLaunchPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/canvas/CanvasModuleView.tsx frontend/src/components/canvas/CanvasModuleView.test.tsx frontend/src/pages/AppLearningPage.tsx frontend/src/pages/AppLearningPage.test.tsx
git commit -m "feat: render Canvas course content for students"
```

## Chunk 5: Hardening, docs, and release verification

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `docs/school-integration/TASKS.md` | Mark Canvas implementation progress |
| Modify | `docs/school-integration/LIMITATIONS.md` | Record beta constraints after ship |
| Modify | `docs/school-integration/TECH_SPEC.md` | Align any implementation-narrowing decisions made during delivery |
| Modify | `docs/superpowers/specs/2026-03-18-canvas-lms-integration-design.md` | Only if implementation requires design updates |
| Modify | `backend/tests/test_canvas_routes.py` | Final regression additions |
| Modify | `frontend/src/pages/CanvasConnectPage.test.tsx` | Final regression additions |

### Task 11: Document shipped scope and final verification

- [ ] **Step 1: Run the full targeted verification set**

Run:
- `pytest -q backend/tests/test_canvas_foundation.py backend/tests/test_canvas_client.py backend/tests/test_canvas_encryption.py backend/tests/test_canvas_sync.py backend/tests/test_canvas_routes.py backend/tests/test_auth_memberships.py backend/tests/test_curriculum_admin_routes.py backend/tests/test_school_foundation_routes.py`
- `cd frontend && npm run test -- --run src/pages/CanvasConnectPage.test.tsx src/components/canvas/CanvasSyncStatus.test.tsx src/components/canvas/CanvasLinkPicker.test.tsx src/components/canvas/CanvasModuleView.test.tsx src/pages/TeacherAssignmentBuilderPage.test.tsx src/pages/AppLearningPage.test.tsx src/pages/AssignmentLaunchPage.test.tsx`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd firebase-tests && npm test`

Expected: all PASS. Do not claim Firestore rules are verified if Java/Firebase Emulator is unavailable.

- [ ] **Step 2: Update docs to reflect shipped state**

Modify:
- `docs/school-integration/TASKS.md`
  - mark Canvas-first LMS tasks complete or in progress
- `docs/school-integration/LIMITATIONS.md`
  - record remaining beta limits:
    - PAT-only auth
    - manual re-sync only
    - no grade passback
    - no OAuth/LTI
    - any cut scope such as new-class-only connect if that is what shipped
- `docs/school-integration/TECH_SPEC.md`
  - only if implementation narrowed or clarified architecture

- [ ] **Step 3: Manual smoke test against a real Canvas sandbox**

Verify end-to-end:
1. Validate PAT against a real Canvas sandbox teacher account.
2. Connect a real course.
3. Confirm class creation or linking.
4. Confirm roster sync creates matched + pending signups correctly.
5. Link one Lingual assignment to one Canvas module item.
6. Confirm student sees Canvas module structure and can launch the linked assignment.
7. Trigger a re-sync and confirm cooldown behavior.
8. Disconnect and confirm Lingual class/enrollments/assignments remain.

- [ ] **Step 4: Commit docs and verification follow-up**

```bash
git add docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md docs/school-integration/TECH_SPEC.md docs/superpowers/specs/2026-03-18-canvas-lms-integration-design.md
git commit -m "docs: record shipped Canvas LMS integration scope"
```

---

## Execution notes

- Keep Canvas integration Canvas-specific in this plan. Do not introduce a generic `lms_connections` abstraction in Phase 1.
- Do not auto-create Firebase Auth users from Canvas roster data.
- Do not let Canvas sync remove manually enrolled or join-code students.
- Do not expose PATs or `canvas_connections` to client reads.
- If existing-class linking materially slows delivery, ship the new-class connect path first and immediately record the narrower scope in `LIMITATIONS.md`.
- If adding `cryptography` requires build/runtime changes in deployment, include that verification in the same change set rather than deferring it.

## Resolved decisions

- **Teacher entry point:** Both `TeacherClassAnalyticsPage` and `TeacherDashboardPage` get Canvas connect/sync surfaces.
- **Student course content:** Lives on `AppLearningPage`, no dedicated route for beta.
- **Existing class linking:** Supported in the first shipped slice — teacher can connect a Canvas course to an existing Lingual class or create a new one.
