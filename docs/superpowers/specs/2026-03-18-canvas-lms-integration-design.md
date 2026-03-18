# Canvas LMS Integration — Design Spec

Status: Draft v1.0
Date: 2026-03-18
Owner: Engineering

## 1. Goal

Integrate Canvas LMS so teachers can connect their Canvas courses to Lingual classes, import rosters and course structure, and give students a familiar Canvas-like navigation experience inside Lingual — without requiring OAuth, LTI, or Canvas admin involvement.

## 2. Summary

A teacher connects their Canvas instance using a personal access token (PAT). Lingual creates a class from the Canvas course metadata, imports the student roster, and pulls in the module/item structure. Students see their Canvas course layout inside Lingual, with "Open in Canvas" links for non-Lingual items and "Start Practice" buttons for linked Lingual assignments. Teachers can re-sync rosters and content on demand.

### Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | Personal access token (PAT) | No Canvas admin needed for beta; OAuth/LTI deferred to Phase 2 |
| PAT scope | Per-teacher on membership record | Avoids admin-level token; expand to per-org later |
| Sync trigger | Manual re-sync button | Teacher controls when sync happens; avoids background job infrastructure |
| Identity matching | Email first, SIS ID fallback | Email is universal; SIS ID adds robustness for districts |
| Unmatched students | Pending enrollment (no account creation) | Avoids FERPA/COPPA issues from auto-creating accounts |
| Canvas content scope | All modules and items | Students see full course structure, not just Lingual items |
| Non-Lingual items | Display + link back to Canvas | Lingual feels like a useful course hub, not a dead end |
| Assignment linking | Teacher manually links via dropdown | Explicit is more reliable than fuzzy title matching |
| Data direction | Read-only from Canvas | No grade passback in this phase |

## 3. Data Model

### 3.1 New Firestore collections

#### `canvas_connections/{connectionId}`

One record per teacher-class link to a Canvas course.

| Field | Type | Purpose |
|-------|------|---------|
| `membership_id` | string | Teacher's Lingual membership |
| `org_id` | string | Organization scope |
| `class_id` | string | Linked Lingual class |
| `canvas_instance_url` | string | e.g. `https://school.instructure.com` |
| `canvas_course_id` | string | Canvas course ID |
| `canvas_course_name` | string | For display and debugging |
| `encrypted_pat` | string | AES-256-GCM encrypted personal access token |
| `last_synced_at` | timestamp | Last successful sync |
| `sync_status` | string | `idle`, `syncing`, `error` |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `canvas_course_content/{contentId}`

Read-only mirror of Canvas modules and module items for student display.

| Field | Type | Purpose |
|-------|------|---------|
| `connection_id` | string | Parent canvas connection |
| `class_id` | string | For querying by class |
| `canvas_module_id` | string | Canvas module ID |
| `canvas_module_name` | string | Module title |
| `canvas_module_position` | int | Sort order |
| `item_id` | string | Canvas module item ID (null for module-level record) |
| `item_title` | string | Item title |
| `item_type` | string | `Assignment`, `Discussion`, `Page`, `ExternalUrl`, etc. |
| `item_position` | int | Sort order within module |
| `item_html_url` | string | "Open in Canvas" link |
| `due_at` | timestamp | Due date if applicable |
| `lingual_assignment_id` | string | Linked Lingual assignment (null if unlinked) |
| `updated_at` | timestamp | |

### 3.2 Modifications to existing collections

**`enrollments`** — Add optional Canvas fields:

- `canvas_user_id` (string) — Canvas user ID for traceability
- `canvas_email` (string) — Email from Canvas at sync time

Implementation note: `create_enrollment()` in `database.py` needs new optional parameters `canvas_user_id` and `canvas_email`, following the existing pattern of optional fields like `student_number`.

**`assignments`** — Add optional field:
- `canvas_module_item_id` (string) — Links a Lingual assignment to a Canvas module item

**`classes`** — Add optional field:
- `canvas_course_id` (string) — Quick reference to linked Canvas course

## 4. Backend Architecture

### 4.1 New files

#### `backend/services/canvas/client.py`

Thin wrapper around the Canvas REST API.

- `CanvasClient` class initialized with `instance_url` and `pat`
- Methods: `get_courses()`, `get_course()`, `get_modules()`, `get_module_items()`, `get_students()`, `get_user()`
- Handles Canvas Link-header pagination
- Raises typed exceptions: `CanvasAuthError`, `CanvasNotFoundError`, `CanvasRateLimitError`

#### `backend/services/canvas/sync.py`

Sync orchestration logic.

- `sync_roster(connection, canvas_client, deps)` — Pull Canvas students, match by email then SIS ID, create/update enrollments
- `sync_course_content(connection, canvas_client, deps)` — Pull modules and module items, upsert `canvas_course_content` records
- `reconcile_enrollments(canvas_students, existing_enrollments)` — Diff and return adds/updates/deactivations
- Returns typed `SyncResult` with counts: `added`, `updated`, `deactivated`, `matched`, `unmatched`

#### `backend/services/canvas/encryption.py`

PAT encryption and decryption using AES-256-GCM.

- Encryption key sourced from `CANVAS_PAT_ENCRYPTION_KEY` env var
- Encrypt on store, decrypt on use, never log or return raw PAT
- API responses return masked hint only (e.g. `"****7x2Q"`)

#### `backend/routes/integrations.py`

New Flask blueprint registered in `main.py`.

### 4.2 API endpoints

The connect flow is a two-stage process. Stage 1 (validate + list courses) does not require a `classId` because the Lingual class may not exist yet. Stage 2 (connect a specific course) creates or links the class.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/integrations/canvas/validate` | Validate PAT + instance URL, return teacher's Canvas courses |
| `POST` | `/api/integrations/canvas/connect` | Pick a Canvas course → create Lingual class, run initial sync |
| `POST` | `/api/teacher/classes/{classId}/canvas/sync` | Re-sync roster + content |
| `GET` | `/api/teacher/classes/{classId}/canvas/status` | Connection status, last sync, counts |
| `DELETE` | `/api/teacher/classes/{classId}/canvas/disconnect` | Remove Canvas link (preserves Lingual class and students) |
| `POST` | `/api/teacher/assignments/{assignmentId}/canvas-link` | Link Lingual assignment to Canvas module item |
| `DELETE` | `/api/teacher/assignments/{assignmentId}/canvas-link` | Unlink |

The `/api/integrations/canvas/*` endpoints live in `backend/routes/integrations.py`. The `/api/teacher/classes/*/canvas/*` and `/api/teacher/assignments/*` endpoints live in the same blueprint but use the `/api/teacher/` prefix for consistency with existing teacher-scoped routes.

### 4.3 Connect flow

1. Teacher provides Canvas instance URL and PAT.
2. Frontend calls `POST /api/integrations/canvas/validate` with URL + PAT.
3. Backend validates PAT by calling Canvas `GET /api/v1/users/self`.
4. Backend returns the teacher's Canvas course list (no PAT stored yet).
5. Teacher picks a Canvas course.
6. Frontend calls `POST /api/integrations/canvas/connect` with URL, PAT, and selected `canvas_course_id`.
7. Backend encrypts PAT, creates `canvas_connections` record.
8. Backend creates a new Lingual class with Canvas course metadata (name, term), or links to an existing class if the teacher specifies one.
9. Backend runs initial sync: roster (students) + content (modules/items).
10. Lingual class gets `canvas_course_id` set; enrollments created with `join_source: "canvas"`.

### 4.4 Re-sync flow

1. Teacher clicks "Sync with Canvas."
2. Server-side 5-minute cooldown check via `last_synced_at`.
3. Backend fetches current Canvas roster, diffs against existing enrollments.
4. New students → create enrollment (`active` if matched, `pending_sync` if not).
5. Removed students → deactivate enrollment.
6. Backend fetches current modules/items, upserts `canvas_course_content`.
7. Returns `SyncResult` summary to teacher.

## 5. Identity Matching

### 5.1 Matching strategy

Per Canvas student during roster sync:

1. **Email match** — Query Firebase Auth by Canvas student email. If found, link to existing Lingual `uid`.
2. **SIS ID fallback** — If no email match and Canvas provides `sis_user_id`, search existing enrollments across the org for a matching `student_number`. If found, link to that student's `uid`.
3. **No match → pending enrollment** — Create enrollment with `status: "pending_sync"`, store `canvas_user_id` and `canvas_email`. No Lingual account is created.

### 5.2 Pending enrollment activation

When a new user signs up via Firebase Auth and their email matches a `pending_sync` enrollment's `canvas_email`:

- The auth verification flow (`/api/auth/verify`) runs a post-auth check: query `enrollments` where `canvas_email == user.email` and `status == "pending_sync"` (unscoped — across all orgs).
- For each match: activate the enrollment (`status: "active"`, set `student_uid`), create a student membership for the org if none exists.
- If matches span multiple orgs, activate all of them. The student picks an active org via `MembershipContext` as usual.
- This query adds one Firestore read per login for users with no pending enrollments. Requires a composite index on `(canvas_email, status)`.
- Student immediately sees the matched classes in their dashboard.

### 5.3 Re-sync reconciliation rules

| Canvas state | Lingual state | Action |
|-------------|---------------|--------|
| Student in Canvas, not in Lingual | — | Create enrollment (`active` or `pending_sync`) |
| Student in Canvas and Lingual | `active` | Update Canvas fields if changed |
| Student in Canvas and Lingual | `pending_sync` | Keep pending, update Canvas fields |
| Student in Canvas and Lingual | `inactive` | Reactivate to `active` or `pending_sync` |
| Student NOT in Canvas | `active` + `join_source: "canvas"` | Deactivate enrollment |
| Student NOT in Canvas | `active` + other `join_source` | No action (manually enrolled, not Canvas-managed) |
| Student NOT in Canvas | `pending_sync` | Remove enrollment (never activated, safe to delete) |

**Important:** Re-sync deactivation only applies to enrollments with `join_source: "canvas"`. Manually enrolled students (via join code or manual add) are never affected by Canvas sync.

### 5.4 Impact on existing code paths

The `pending_sync` status is new. Existing code that queries enrollments defaults to `status='active'` (e.g., `list_class_enrollments` in `database.py`). This is intentional — `pending_sync` students should be excluded from:

- Analytics aggregation (no practice data exists)
- Compliance roster (no Lingual account to gate)
- Assignment resolution (cannot launch practice)

`pending_sync` students appear only in the teacher roster view as a separate "Awaiting signup" list, fetched via an explicit query for `status='pending_sync'`.

### 5.5 Teacher-visible sync summary

- "5 students matched to existing accounts"
- "12 students pending signup"
- "2 students removed from roster"

Pending students appear greyed out in the class roster with an "Awaiting signup" label.

## 6. Frontend Architecture

### 6.1 New files

**`frontend/src/api/canvas.ts`** — Typed API client for all Canvas integration endpoints.

**`frontend/src/types/canvas.ts`** — DTOs: `CanvasConnection`, `CanvasCourse`, `CanvasModuleItem`, `SyncResult`.

**`frontend/src/pages/CanvasConnectPage.tsx`** — Teacher flow:
1. Enter Canvas URL + PAT (with help link for PAT generation).
2. Validate → show list of Canvas courses.
3. Pick course → initial sync → redirect to class page.

**`frontend/src/components/canvas/CanvasModuleView.tsx`** — Student-facing view. Renders Canvas modules as collapsible sections, items as cards. Non-Lingual items show title + due date + "Open in Canvas" link. Lingual-linked items show "Start Practice" button.

**`frontend/src/components/canvas/CanvasSyncStatus.tsx`** — Badge on teacher class page showing connection state, last sync time, and "Sync Now" button.

**`frontend/src/components/canvas/CanvasLinkPicker.tsx`** — Dropdown in assignment builder for linking a Lingual assignment to a Canvas module item.

### 6.2 Modified files

- **`TeacherClassAnalyticsPage.tsx`** — Add Canvas sync status badge and "Sync with Canvas" action.
- **`TeacherAssignmentBuilderPage.tsx`** — Add optional Canvas link picker when class has a Canvas connection.
- **`App.tsx`** — Add route for `/app/teacher/classes/:classId/canvas/connect`.

### 6.3 Student experience

When a class has a Canvas connection, students see a "Course Content" tab/section:

- Canvas modules as collapsible organizational sections
- Within each module: Canvas items and linked Lingual assignments interleaved by position
- Non-Lingual items: title, due date, "Open in Canvas" link
- Linked Lingual items: title, due date, "Start Practice" button
- Unlinked Lingual assignments appear in the existing "Assignments" section as before

Non-Canvas classes are unaffected.

## 7. Security

### 7.1 PAT encryption

- AES-256-GCM via server-side `CANVAS_PAT_ENCRYPTION_KEY` env var.
- Key format: 32-byte key, base64-encoded (e.g., generated via `python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`).
- Storage format: `encrypted_pat` contains the base64-encoded concatenation of `nonce (12 bytes) + ciphertext + tag (16 bytes)`.
- Raw PAT never stored, logged, or returned in API responses.
- API responses return masked hint only (e.g. `"****7x2Q"`).
- If encryption key is not configured, Canvas endpoints return 503.
- Key rotation: deferred. Changing the key invalidates all existing PATs — teachers must reconnect. A future migration tool could re-encrypt.

### 7.2 Canvas API error handling

| Canvas response | Lingual behavior |
|----------------|-----------------|
| 401 Unauthorized | Mark connection `error`, return "PAT expired or revoked" |
| 403 Forbidden | Return "Insufficient Canvas permissions" |
| 404 Not Found | Flag specific items, continue sync |
| 429 Rate Limited | Respect `Retry-After`, return partial result |
| 5xx / timeout | Mark sync `error`, return "Canvas temporarily unavailable" |

### 7.3 Authorization

- Only teachers with active membership for the class's org can connect/sync/disconnect.
- Students can read `canvas_course_content` for enrolled classes; cannot see connection details or PATs.
- Reuses existing `SchoolRequestContext` authorization from `membership_context.py`.

### 7.4 Sync rate limiting

- Server-side cooldown: one sync per class per 5 minutes, enforced via `last_synced_at`.

### 7.5 Firestore rules and indexes

**Security rules for new collections:**

- `canvas_connections`: read/write denied to all clients. All access is server-side via Admin SDK. This ensures PATs are never exposed to the browser.
- `canvas_course_content`: read allowed for students enrolled in the matching `class_id`. Write denied to all clients (server-side only).

**Required composite indexes:**

- `canvas_course_content`: `(class_id, canvas_module_position, item_position)` — for ordered display
- `enrollments`: `(canvas_email, status)` — for pending enrollment activation at login
- `canvas_connections`: `(class_id)` — for status lookups

New collections must have corresponding emulator tests in `firebase-tests/` following the existing pattern (44+ test cases).

### 7.6 Assignment link atomicity

Linking a Lingual assignment to a Canvas module item writes to two documents: `assignments.canvas_module_item_id` and `canvas_course_content.lingual_assignment_id`. These writes must use a Firestore batch write to ensure atomicity. If one side fails, neither is committed. Unlinking follows the same pattern.

### 7.7 Data boundaries

- Read-only from Canvas — no writes, no grade passback.
- Canvas data in Lingual is a cache — re-sync fixes drift.
- Disconnect removes `canvas_connections` and `canvas_course_content` but preserves Lingual classes, enrollments, and assignments.

## 8. Phasing

### Phase 1 — PAT beta (this spec)

- Teacher connects Canvas via PAT
- Course → class creation with metadata
- Roster sync with email + SIS ID matching
- Pending enrollment flow for unmatched students
- Canvas module/item import for student navigation
- Manual re-sync button
- Lingual assignment ↔ Canvas item linking
- Student sees Canvas course structure with "Open in Canvas" links
- Disconnect flow preserving Lingual data

### Phase 2 — OAuth/LTI (deferred)

| Feature | Notes |
|---------|-------|
| OAuth 2.0 / LTI 1.3 auth | Replaces PAT, enables broader permissions |
| Per-org Canvas connection | Admin-level token, one setup per school |
| Grade passback | Completion status or proficiency score → Canvas gradebook |
| Automatic periodic sync | Background job, replaces manual re-sync |
| Canvas webhook listeners | Requires OAuth |
| Deep linking from Canvas | LTI launch into specific Lingual assignments |

### Phase 2+ — Multi-LMS

| Feature | Notes |
|---------|-------|
| Google Classroom integration | Same sync interface, different client |
| LMS connection abstraction | Unify `canvas_connections` into generic `lms_connections` |

### Multi-LMS readiness principle

Make the Canvas integration clean and complete, not generic. Extract the abstraction when the second LMS arrives.

- `backend/services/canvas/client.py` is Canvas-specific.
- `backend/services/canvas/sync.py` returns generic `SyncResult` types.
- A future `backend/services/google_classroom/` would implement the same sync patterns.

## 9. Environment Variables

New required variables for Canvas integration:

| Variable | Purpose |
|----------|---------|
| `CANVAS_PAT_ENCRYPTION_KEY` | AES-256-GCM key for encrypting stored PATs |

Canvas integration endpoints return 503 if this key is not configured.

## 10. Testing Strategy

### Backend

- **`backend/services/canvas/client.py`** — Unit tests with mocked HTTP responses covering pagination, auth errors, rate limits, timeouts.
- **`backend/services/canvas/sync.py`** — Unit tests for `reconcile_enrollments()` with fixtures covering all reconciliation table cases (new, matched, deactivated, reactivated, pending). Test email match and SIS ID fallback independently.
- **`backend/services/canvas/encryption.py`** — Round-trip encrypt/decrypt tests. Verify that missing key raises the expected error.
- **`backend/routes/integrations.py`** — Route-level tests for authorization (teacher-only), connect flow validation, sync cooldown enforcement, and error propagation.
- **Pending enrollment activation** — Test that `/api/auth/verify` activates pending enrollments on email match, including multi-org scenarios.

### Frontend

- **`CanvasConnectPage`** — Render tests for the two-stage connect flow (validate → pick course → sync).
- **`CanvasModuleView`** — Render tests with fixture data showing modules, non-Lingual items with Canvas links, and linked Lingual items with practice buttons.
- **`CanvasSyncStatus`** — State rendering for idle, syncing, error, and cooldown.
- **`CanvasLinkPicker`** — Dropdown rendering and selection behavior.

### Firestore rules

- Add emulator tests for `canvas_connections` (deny client reads/writes) and `canvas_course_content` (allow enrolled student reads, deny writes) to `firebase-tests/`.

### Integration

- Full connect-sync-link flow: validate PAT → pick course → initial sync creates class + enrollments + content → link assignment → student sees module view.
- Re-sync flow: add/remove Canvas students → verify enrollment reconciliation.
- Disconnect flow: verify Canvas data removed, Lingual data preserved.

## 11. Resolved Design Decisions

Decisions resolved during design that were initially open questions:

- **Pending enrollment activation** happens synchronously in `/api/auth/verify` via a single Firestore query on `(canvas_email, status)`. The cost is one read per login — acceptable for beta.
- **`canvas_course_content` uses the flat model** (one document per module item). Simpler to query and sort; document count is manageable for typical Canvas courses (10-20 modules, 5-15 items each = ~200 docs max per class).
- **Required Canvas PAT permissions**: teachers need a PAT with default scope (no special admin permissions). Canvas PATs inherit the generating user's permissions — a teacher's PAT can access their own courses, enrollments, and modules.

## 12. Open Questions

- Should we display a Canvas PAT generation tutorial inline, or link to Canvas's own documentation?
- Should the connect flow allow linking to an existing Lingual class, or always create a new one? (Current spec supports both — teacher can specify an existing class or let one be created.)
