# Canvas Roster Decoupling — Design Spec

Status: Draft (awaiting review)
Date: 2026-04-21
Owner: Engineering
Related docs: `docs/school-integration/TECH_SPEC.md`, `docs/school-integration/LIMITATIONS.md`, `docs/superpowers/specs/2026-03-18-canvas-lms-integration-design.md`

## Problem

Canvas PAT roster sync currently creates Lingual enrollments directly:

- Canvas student with an email matching a Lingual user → `enrollments/` row with `status='active'`, `join_source='canvas'` (immediate, silent auto-enroll).
- Canvas student with no Lingual match → `enrollments/` row with `status='pending_sync'` that auto-activates the moment a student with that email first logs in (silent delayed auto-enroll).

Result: any student whose email happens to appear on any synced Canvas roster is involuntarily enrolled in that class — often in test classes created while exploring the Canvas integration. A single teacher's exploratory PAT sync can attach dozens of real students to a class they never opted into. A manual cleanup on 2026-04-21 removed 5 offending test classes and 104 involuntary enrollments; the underlying behavior remains in production code.

## Goal

Make enrollment a sovereign act: `enrollments/` is written only by explicit student action (join code) or consent-by-click (LTI deep-link launch). Canvas roster data remains useful but is stored and queried separately.

## Non-goals

- Changing LTI deep-link auto-enroll (`backend/services/lti/identity.py::auto_enroll_student`). LTI launch is a deliberate student click, not passive matching.
- Changing the join code flow (generation, entry, validation).
- Introducing approval workflows, guardian confirmation, or rate limiting on join codes.
- Changing organization membership bootstrap.
- Building a manual "this Lingual student = this Canvas roster entry" linking UI for the email-mismatch edge case.
- Modifying `sync_course_content` / `canvas_course_content` / assignment-to-Canvas-item linking in any way.

## Core invariant

**No Canvas sync operation ever writes to `enrollments/`. No enrollment operation ever writes to `canvas_roster_entries/`.** Single-owner-per-collection makes the current bug class architecturally impossible.

## Scope of change

Canvas sync has two independent halves:

| Function | Role | Status under this spec |
|---|---|---|
| `sync_course_content` in `backend/services/canvas/sync.py` | Pulls Canvas modules and items into `canvas_course_content/`. Powers Canvas-tab assignment authoring, Canvas-linked assignments, and student "Start Practice" entries from Canvas content. | **Unchanged.** |
| `sync_roster` → `reconcile_enrollments` in `backend/services/canvas/sync.py` | Pulls Canvas roster, creates active/pending_sync enrollments on email match. | **Rewritten.** Writes to `canvas_roster_entries/` instead of `enrollments/`. |
| `auto_enroll_student` in `backend/services/lti/identity.py` (LTI deep-link launch) | Creates enrollment when a student clicks into Lingual from Canvas. | **Unchanged.** |

Teachers who click "Sync Canvas" still get the full content pull (modules, items, everything that powers the assignment builder). The only observable change is that roster sync no longer produces enrollments.

## Data model

### New collection — `canvas_roster_entries`

Composite document ID: `{class_id}__{canvas_user_id}` (makes sync a pure upsert-or-delete-by-key).

| Field | Type | Notes |
|---|---|---|
| `class_id` | str | Class the roster belongs to. |
| `connection_id` | str | Source Canvas connection id. |
| `canvas_user_id` | str | Canvas-side user id. |
| `canvas_email` | str, lowercased + trimmed | Primary match key. |
| `canvas_name` | str | Display name. Falls back to `sortable_name`. |
| `synced_at` | timestamp | Last sync where this entry was written or re-seen. |
| `created_at` | timestamp | First time this entry was written. |

### Firestore index

Composite index on `canvas_roster_entries` over `class_id` (asc) + `canvas_email` (asc). Supports the per-student badge lookup.

### `enrollments/` schema

- Add `'canvas_legacy'` to the documented `join_source` value set (grandfathered rows from migration — still `active`, still honored for authorization, but flagged as "enrolled under the old rule").
- `'canvas'` value is retired for new writes. Kept as a readable value for any rows that predate migration.
- No structural changes; `status` values unchanged.

## Behavior after change

### Canvas roster sync

```text
input:  canvas_students = [{id, email, name, sortable_name}, ...] from Canvas API
output: SyncResult {entries_upserted, entries_removed, total_canvas_students}

for each canvas_student:
    upsert canvas_roster_entries/{class_id}__{canvas_user_id}:
        {class_id, connection_id, canvas_user_id, canvas_email: lower(email),
         canvas_name, synced_at: now, created_at: now if new}

# deletion pass
for each existing canvas_roster_entries doc for this class:
    if its canvas_user_id not in current canvas_students set:
        delete it

# zero writes to enrollments/, zero reads of users/
```

### Student login (removed behavior)

The "pending_sync auto-activate on student login" code path is removed. Exact locations:

- `backend/routes/auth.py:68` — call to `deps.db.activate_pending_canvas_enrollment(...)` inside the auth-verify flow. Block removed.
- `database.py::activate_pending_canvas_enrollment` — DB method no longer called. Removed (not just deprecated) so stale callers fail loudly.
- Associated tests in `backend/tests/test_auth_memberships.py` (cases `test_activates_pending_canvas_enrollment_on_login`, `test_activates_multi_org_pending_enrollments`, and related `pending_sync` fixtures), `backend/tests/test_auth_routes.py::test_activates_pending_canvas_enrollment`, and `backend/tests/test_canvas_foundation.py::test_activate_pending_canvas_enrollment` are deleted or replaced with "login does not create an enrollment from a canvas_roster_entry" assertions.

No replacement logic is added: if a roster entry exists and no enrollment exists, the student remains unenrolled until they enter a join code.

### Teacher roster endpoint (`GET /api/teacher/classes/<class_id>/roster`)

For each returned student, look up `canvas_roster_entries` keyed by `(class_id, email=student.email)`:

- match found → `isOnCanvasRoster: true`
- no match, and class has a Canvas connection → `isOnCanvasRoster: false`
- class has no Canvas connection → field omitted entirely

### New teacher endpoint — `GET /api/teacher/classes/<class_id>/canvas-roster-gap`

Returns Canvas roster entries that do not have a matching enrollment in the class (match by email).

```json
{
  "success": true,
  "gap": [
    {"canvas_name": "Jane Doe", "canvas_email": "jane@school.edu", "synced_at": "..."}
  ],
  "summary": {
    "canvas_total": 20,
    "joined": 12,
    "not_joined": 8
  }
}
```

When class has no Canvas connection: `gap: []`, `summary: null`.

## Backend changes

| File | Change |
|---|---|
| `backend/services/canvas/sync.py` | Replace `reconcile_enrollments` with `reconcile_canvas_roster_entries` (new behavior above). Update `sync_roster` to call the new function. Update `SyncResult` dataclass fields. `sync_course_content` and `flatten_course_content` are not modified. |
| `backend/routes/integrations.py` | Update response payload shape to match new `SyncResult` (remove `matched/unmatched/deactivated/created/unchanged`, add `entries_upserted/entries_removed/total_canvas_students`). Preserve the dual-sync behavior where the Canvas sync endpoint still triggers content sync alongside roster sync. |
| `database.py` | New helpers: `upsert_canvas_roster_entry`, `delete_canvas_roster_entry`, `list_canvas_roster_entries(class_id)`, `get_canvas_roster_entry_by_email(class_id, email)`, `count_canvas_roster_entries(class_id)`. Add `'canvas_legacy'` to the documented `join_source` value list and to the `create_enrollment` docstring. |
| Auto-activate-on-login path (locate at plan time) | Remove the block that activates a `pending_sync` enrollment on login. After removal, such rows (if any) are orphaned and handled by the migration script. No replacement logic. |
| `backend/routes/teacher.py::api_get_class_roster` (lines ~758–803) | (a) Attach `isOnCanvasRoster` to each active enrollment using the `(class_id, email)` lookup against `canvas_roster_entries/`. Skip the field if the class has no Canvas connection. (b) **Remove the current pending_sync list** (lines ~765 and ~790–795) from the response payload — `status: 'pending_sync'` rows no longer appear in the teacher roster. The gap view below replaces that visibility. |
| `backend/routes/teacher.py` (new route) | `GET /api/teacher/classes/<class_id>/canvas-roster-gap` — see API shape above. Enforces same class-access check as existing roster route. |
| `firestore.indexes.json` | Add composite index for `canvas_roster_entries (class_id ASC, canvas_email ASC)`. |
| `backend/services/lti/identity.py` | Unchanged. |

Error and edge handling:
- Sync failure at the Canvas API layer does not write partial state; upserts are per-document so a half-failed sync leaves the collection stale but consistent.
- Teacher removing a student (existing manual-remove UI) only deletes the `enrollments/` row. Does not touch `canvas_roster_entries/`. The student remains on the gap view if still on the Canvas roster.
- Badge lookup on a class with no `canvas_course_id` short-circuits: no `canvas_roster_entries` query issued, no field emitted.

## Frontend changes

| File / area | Change |
|---|---|
| `frontend/src/api/teacher.ts` | Extend `RosterStudent` type with optional `isOnCanvasRoster?: boolean`. Add `getClassCanvasRosterGap(classId)` method returning `{ gap: CanvasRosterGapEntry[], summary: { canvas_total, joined, not_joined } \| null }`. |
| `frontend/src/pages/TeacherDashboardPage.tsx` (roster panel, around the `ClassRosterStudent[]` render) | Render a small badge per student row: `✓ On Canvas roster` (success tone) or `Not on Canvas roster` (muted). Hide the badge entirely when `isOnCanvasRoster` is undefined (class has no Canvas connection). **Remove** the current pending_sync rendering (rows with `status === 'pending_sync'` that shipped as part of `api_get_class_roster`'s current payload). |
| `frontend/src/types/school.ts::ClassRosterStudent` (line ~251) | Add optional `isOnCanvasRoster?: boolean` field. |
| Same view — new section below roster | "Canvas roster — not yet joined" read-only list with a summary line: `{joined} of {canvas_total} Canvas roster students have joined via class code.` Positive empty state when `not_joined == 0`. Section hidden entirely when class has no Canvas connection. |
| `CanvasSyncStatus` component | Update result copy from the old `matched / unmatched` wording to `{entries_upserted} Canvas students captured, {entries_removed} dropped from roster` (or a simpler condensed form). Rename the primary CTA to "Refresh Canvas roster". Helper text: "Updates the Canvas roster list and refreshes course content. Does not add or remove students from your class — share your class code to enroll students." |
| Copy next to the new gap section | "Students on the Canvas roster who haven't yet entered your class code. Share the code to enroll them." |

## Migration

One-time script, idempotent, dry-run by default:

```text
For each enrollments/{id}:
  if join_source == 'canvas' and status == 'active':
    update join_source = 'canvas_legacy'   ← grandfather
  elif status == 'pending_sync':
    translate {canvas_user_id, canvas_email, canvas_name, class_id, connection_id}
    into canvas_roster_entries/{class_id}__{canvas_user_id}
    then delete the enrollment row
  else:
    untouched
```

Rules:
- No `active` enrollment is ever deleted by migration.
- Script dry-runs by default; requires `--commit` to write.
- Script prints before/after counts per class and a summary (`legacy_flipped`, `pending_sync_translated`, `unchanged`).
- Idempotent: running twice yields the same final state. Running it against a DB that has already been migrated is a no-op.

Migration is only run *after* the new backend is deployed, so no concurrent sync can race the script (any sync that fires post-deploy writes into `canvas_roster_entries/` directly).

## Testing

Backend:
- `backend/tests/test_canvas_sync.py` — full rewrite. Old "email match creates active enrollment" cases become "email match writes a `canvas_roster_entries` row, makes zero writes to `enrollments/`" (verified with a mock db that records calls). Removed-from-roster case: roster entry deleted, any matching `join_code` enrollment untouched.
- New test around the login flow: login with an email matching a `canvas_roster_entries` doc does not create an enrollment. (Locate the prior pending-sync activate call site and drop its test too.)
- `test_teacher_routes.py` — roster response test: `isOnCanvasRoster` correct across matched / unmatched / no-canvas-connection cases.
- `test_teacher_routes.py` — new test for the gap endpoint: returns correct unjoined list; empty state; summary counts.
- New migration test: run the migration function against a fixture DB twice and assert idempotent outcome; assert no active enrollment is ever deleted.

Frontend:
- Teacher roster render test: badge renders with correct tone for matched/unmatched; hidden when no Canvas connection.
- Gap section test: renders list, renders summary line, renders positive empty state.
- `CanvasSyncStatus` copy test: new result wording + new CTA text.

## Rollout sequence

1. **Ship backend + migration + frontend in a single PR**, but deploy in this order:
   1. Backend changes (including the new route, new collection helpers, roster sync rewrite, auto-activate removal, firestore index deployment).
   2. Migration run: dry-run → review → `--commit`.
   3. Frontend deploy.
2. After step 1 the auto-enroll behavior is already gone in production. Step 2 fixes the pre-existing data. Step 3 surfaces the new UI.

Per `CLAUDE.md`, agent dispatch at implementation time: `spec-agent` → parallel `backend-impl` + `frontend-impl` → `cross-layer-review` → `doc-sync`. This change spans layers and touches consent-adjacent semantics, so all five agents apply.

## Doc updates (post-implementation)

- `docs/school-integration/TECH_SPEC.md` — document the `canvas_roster_entries` collection, the enrollments-are-sovereign invariant, and the updated Canvas sync contract.
- `docs/school-integration/LIMITATIONS.md` — supersede item 12 (Canvas LMS integration limitations), add a new item for the email-mismatch edge case, note the `'canvas'` legacy `join_source` value retained for read.
- `docs/school-integration/BDD_SCENARIOS.md` — add scenarios: (a) Canvas roster sync does not enroll, (b) joining via code on a Canvas-rostered class surfaces the badge, (c) gap view lists unjoined roster students.
- `docs/school-integration/TASKS.md` — mark the related roster-auto-enroll line as resolved; add rollup task for the migration run.

## Known deferred items

- **Email-mismatch edge case**: student's Canvas email differs from their Lingual account email (different provider, personal vs school). Badge will render "Not on Canvas roster" even though the student is on the roster by name. No manual-link UI is built; teachers can verify by name when needed. Documented in `LIMITATIONS.md`.
- **LTI-based secondary match**: students who have ever launched via LTI have their `canvas_user_id` on file; that id could be used as a second-tier match when email match fails. Not built; noted for a possible follow-up if the pilot surfaces false-negative badges as noise.
- **Test-class bulk cleanup**: the remaining ~24 classes in Firestore include clearly dev/test rows (multiple `E2E French 101`, single-letter names). A separate cleanup pass is worth running against them, but is out of scope for this spec.
