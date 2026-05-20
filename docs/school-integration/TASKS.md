# School Integration Tasks

Status: Active
Last updated: 2026-04-18
Owner: Engineering + Product

## Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` done
- `[!]` blocked / needs decision

## Phase 0: Documentation and architecture lock

- [x] Create formal `docs/` structure for the school track.
- [x] Draft `PRD.md`.
- [x] Draft `TECH_SPEC.md`.
- [x] Draft `TASKS.md`.
- [x] Create `LIMITATIONS.md` for ongoing implementation constraints tracking.
- [ ] Review docs with product lead and confirm beta scope.
- [ ] Convert open questions into explicit architecture decisions.

## Phase 1: School foundation

### Auth and roles

- [x] Extend `/api/auth/verify` to return memberships and active org context.
- [x] Add backend request-context helper for active membership and role scope.
- [x] Add frontend `MembershipContext`.
- [x] Add role-aware route guards for teacher vs student pages.
- [x] Update `User` and related frontend types to include membership context.

### Domain model

- [x] Add Firestore collections for `organizations`, `memberships`, `classes`, and `enrollments`.
- [x] Define indexes needed for teacher class queries and student enrollment lookups.
- [x] Add secure Firestore rules for org/class-scoped reads and writes.
- [ ] Define data migration plan for existing users who only have `profile.school_name`.

### UI shell

- [x] Replace unrestricted `/app/teacher` access with teacher-only routing.
- [x] Build teacher home page data contract.
- [x] Add class list page or section for teachers with multiple classes.

## Phase 2: School onboarding and roster workflows

### Admin school registration wizard

- [x] Admin org wizard — 4-step form with autosave draft
- [x] Authorization attestation with server-stamped IP hash + UA
- [x] Pre-invite teachers list on submit; auto-invitations on approval
- [x] Approval / decline transactional emails via outbox

### Teacher onboarding

- [x] Design separate school onboarding flow from learner onboarding.
- [x] Create class manually flow.
- [x] Invite student flow (class join code + student join page + roster management).
- [x] Add basic teacher-facing setup checklist state.
- [x] Hybrid teacher join: invite code + name search (Plan 4)
- [x] Admin approval pipeline with email notification (Plan 4)
- [x] Removed auto-approve from /api/schools/join-as-teacher (Plan 4)
- [x] organizations.school_admin_uids denormalization for rules (Plan 4)
- [x] PendingTeacherRequestsSection on TeacherDashboardPage (Plan 4)
- [ ] Backfill `organizations.school_admin_uids` for orgs created before Plan 4 — run `scripts/backfill_school_admin_uids.py`
- [ ] Backfill `organizations.name_lower` for orgs created before Plan 4 — run `scripts/backfill_org_name_lower.py`
- [x] **(Plan 5 acceptance)** Any membership-removal path MUST call `_sync_org_admin_uids(org_id, uid, add=False)` when removing `school_admin`. Extended `backend/tests/test_school_admin_uids_invariant.py` with the removal regression (Plan 5 Task 7).
- [ ] Replace in-memory org search rate limiter with a shared store (Redis / Firestore counter) when scaling to multi-replica.
- [ ] 7-day reminder email for stale pending teacher join requests (v1.5). **Product decision needed before launch.**
- [ ] Realtime status listener on `/signup/teacher/pending` (replace 30s polling, v1.5).
- [ ] Wrap teacher-join approve flow in a Firestore batch/transaction (v1.5). Introduces the project's first transactional path — plan it cross-cuttingly.
- [ ] Document `PUBLIC_BASE_URL` in `.env.example` and the deployment runbook.
- [ ] Top-level `try/except` wrapper around the main body of each route in `backend/routes/teacher_requests.py` (matches `school_requests.py` pattern; ensures Firestore transient errors return shaped JSON, not unformatted HTML 500).

### LMS / roster import

- [x] Decide first LMS integration order — Canvas LMS first.
- [x] Choose first-party priority between Google Classroom and Canvas — Canvas chosen.
- [x] Implement LMS connection record model (`canvas_connections`, `canvas_course_content` collections).
- [x] Implement Canvas API client with pagination and typed errors (`backend/services/canvas/client.py`).
- [x] Implement PAT encryption with AES-256-GCM (`backend/services/canvas/encryption.py`).
- [x] Implement roster sync service with email match and pending_sync flow (`backend/services/canvas/sync.py`). *Superseded 2026-04-21: see roster-decouple entry below.*
- [x] Implement Canvas integration routes: validate, connect, sync, status, disconnect, link/unlink (`backend/routes/integrations.py`).
- [x] Activate pending Canvas enrollments on student login (`backend/routes/auth.py`). *Removed 2026-04-21: see roster-decouple entry below.*
- [x] Add Firestore rules for Canvas collections (deny-all for connections, enrolled-student read for content).
- [x] Build teacher Canvas connect flow (two-step: validate PAT + select course) (`CanvasConnectPage.tsx`).
- [x] Build Canvas sync status component for class analytics page (`CanvasSyncStatus.tsx`).
- [x] Build Canvas assignment link picker (`CanvasLinkPicker.tsx`).
- [x] Build student Canvas module view component (`CanvasModuleView.tsx`).
- [x] Add Canvas link button to teacher dashboard class cards.
- [x] Decouple Canvas roster from Lingual enrollments (2026-04-21).
  See `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`
  and `docs/superpowers/plans/2026-04-21-canvas-roster-decouple-from-enrollment.md`.
  Ships: new `canvas_roster_entries/` collection, "On Canvas roster" badge
  and "not yet joined" gap view on the teacher roster, `GET /api/teacher/classes/<class_id>/canvas-roster-gap`
  endpoint, one-time migration script at `scripts/migrate_canvas_roster_decouple.py`,
  removal of `pending_sync`-on-login activation in `auth.py`, and removal
  of email-match auto-enroll from `reconcile_enrollments`. Canvas PAT sync
  no longer writes to `enrollments/`; enrollments come only from join
  code or LTI deep-link launch. Deferred: manual "link to Canvas roster
  entry" UI for the email-mismatch case (see `LIMITATIONS.md` item 20).
- [ ] Add manual CSV fallback if LMS setup is delayed.

### Lingual admin panel (Plan 5)

- [x] Routes mounted at `/lingual-admin/*` (top-level, outside `/app`, so AppLayout does not double-nest with `LingualAdminShell`).
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
- [x] Legacy `/app/admin/school-requests` route redirects to `/lingual-admin/requests`.

- [ ] `PATCH /api/lingual-admin/organizations/<orgId>` (org metadata editing) — v1.5.
- [ ] Realtime listener for org-detail audit feed (replace pagination, v1.5).
- [ ] Bulk export of org audit feed as CSV — v1.5.
- [ ] Internationalize Lingual admin panel UI (en-only in v1).
- [ ] Wire `school_request_reminder_to_lingual` once the outbox sweep gap (LIMITATIONS #21) is closed.
- [ ] Delete orphan Firestore composite index `enrollments(status, student_uid, updated_at DESC)` (LIMITATIONS #41) — safe, redundant with the IaC-managed `(student_uid, status, updated_at DESC)` index. Targeted `gcloud firestore indexes composite delete` command in LIMITATIONS #41.
- [ ] Reminder email for inactive suspended orgs (≥30 days suspended_until in past with auto-restore disabled) — needs product decision before launch.
- [ ] Backfill top-level `country` from `location.country` for `school_requests` rows submitted before the LIMITATIONS #47 denormalization fix. One-shot script: query `school_requests` where `country` is missing AND `location.country` is non-empty; write `country` to each. Until run, the Requests page country filter (LIMITATIONS #47) matches only post-fix rows.

## Phase 3: Canvas content and assignment authoring

### Content sources

- [x] Replace sample-only package loading with Canvas-synced content and teacher-authored source text.
- [x] Remove the sample package selection endpoint for teachers.
- [x] Add Canvas content picker for assignment authoring.
- [x] Add AI-assisted draft generation from teacher-provided source packets.
- [x] Add manual advanced authoring without any Canvas item.

### Assignment content model

- [x] Remove `curriculum_mappings` from the beta assignment path.
- [x] Store assignment scenario fields directly on `assignments`.
- [x] Add teacher controls for:
  - objectives
  - target expressions
  - focus grammar
  - teacher notes
  - modality policy
  - task type / success criteria

### Assignments

- [x] Create `assignments` model.
- [x] Build teacher assignment authoring UI.
- [x] Add student assignment list API.
- [x] Add student assignment launch page.

## Phase 4: Assignment-aware practice engine

### Backend session orchestration

- [x] Add assignment resolver service.
- [x] Add practice session bootstrap endpoint.
- [x] Extend realtime session creation to accept `assignmentId`.
- [x] Snapshot resolved assignment context into each practice session.
- [x] Expose rubric, task-model, and evidence metadata in assignment bootstrap.
- [x] Enforce assignment-aware prompt assembly for school practice.

### Assignment prompt policy

- [x] Encode assignment-aware prompt assembly around instructions, generated scenario, and teacher targets.
- [x] Add interaction contract preview to teacher assignment builder.
- [x] Remove the legacy sample-curriculum and pedagogy-engine prompt path.

### Modality and cost controls

- [ ] Add org / class / assignment modality policies.
- [-] Track voice minutes and estimated cost per session.
- [x] Add assignment-scoped text fallback when voice is blocked by policy, consent, or budget and `textFallbackEnabled` is true.

## Phase 5: Learning events and analytics

### Event capture

- [x] Define `learning_events` schema.
- [x] Emit session lifecycle events.
- [x] Emit student/assistant turn events.
- [x] Emit feedback-type events.
- [x] Emit target-expression hit events.
- [x] Emit context-tag, error-pattern, and repeated-error signals.
- [x] Emit self-correction and task-completion events.

### Session summary

- [x] Write synchronous per-session summaries.
- [-] Capture estimated speaking time, turn counts, transcript-based MLU, target usage, and first-pass cost summary.
- [x] Capture repeated errors.
- [x] Capture self-correction from live events.
- [x] Add first-pass rubric-dimension scoring.
- [-] Strengthen semantic event detection with locale-aware pedagogical signal rules.

### Teacher dashboard

- [x] Replace hardcoded teacher dashboard data with typed API payload.
- [x] Build class dashboard endpoint.
- [x] Build student drill-down endpoint.
- [x] Build assignment analytics endpoint.
- [x] Add assignment analytics drill-down UI.
- [x] Add class analytics drill-down UI.
- [x] Add student drill-down UI.
- [x] Add dashboard filters for date range, class, and assignment.

## Phase 6: Compliance, privacy, and retention

### Compliance model

- [x] Add `student_compliance_records` model.
- [x] Add `consent_events` audit trail.
- [x] Define retention policy objects and defaults.
- [ ] Define deletion request and deletion execution flow.
- [x] Define guardian-facing consent workflow, evidence model, and delivery path.
- [x] Add teacher and school-admin consent review/update workflow within authorized school scope.
- [x] Add class compliance roster view that joins enrollment and effective compliance state.

### Enforcement

- [x] Block voice session creation when `voice_allowed` is false.
- [x] Apply the same compliance gate to pronunciation voice flows as assignment practice.
- [x] Block pronunciation audio storage when policy forbids it.
- [x] Log sensitive access and disclosure events required by policy.
- [x] Add class-scoped bulk consent operations for teacher and school-admin workflows.
- [x] Add class-scoped consent audit export.
- [x] Add admin tools for school-wide consent review and audit export.

Current completion state:

1. Class-scoped compliance roster, bulk consent operations, and audit export are shipped.
2. Epic A guardian consent packets are shipped with secure-link guardian response, teacher/admin packet management, and packet status surfaces in class compliance plus student drill-down.
3. `downloadable_notice` remains a staff-managed beta path; it records packet state without generating a rendered handout artifact.
4. Epic B deletion requests/execution is shipped.
5. School-wide admin compliance tooling is shipped (org summary, filterable roster, guardian packet tracking, org audit export).

### Epic A: Guardian Consent Packets

- [x] Freeze packet states, notice versioning, token TTL, and delivery methods.
- [x] Add `guardian_consent_packets` model and packet audit taxonomy.
- [x] Add teacher/admin packet issuance, resend, and cancel endpoints.
- [x] Add guardian decision endpoint for secure-link delivery.
- [x] Add packet status surface to class compliance and student drill-down flows.
- [x] Add reminder and expiry handling.

### Epic B: Deletion Requests and Execution

- [x] Freeze request scope rules and approval matrix.
- [x] Add `deletion_requests` model.
- [x] Add `deletion_execution_runs` model.
- [x] Add request create/review/detail endpoints for admin workflows.
- [x] Add synchronous execution worker for Firestore cleanup (Storage placeholder for post-beta).
- [x] Add execution summary, retry handling, and partial-failure recovery rules.

Recommended sequence for the remaining hardening work:

1. Epic B: Deletion requests and execution.
2. School-wide admin tooling on top of the current compliance stack.

### Policy review

- [ ] Validate COPPA workflow assumptions with counsel.
- [ ] Validate FERPA vendor / school-official workflow assumptions with counsel.
- [ ] Validate state biometric-risk assumptions, including Illinois BIPA exposure, with counsel.

## Phase 7: Pilot readiness

- [ ] Recruit 5-10 co-design teachers.
- [ ] Create pilot feedback loop and weekly issue triage.
- [x] Add contextual onboarding hints for teacher setup workflows (7 hints across 3 pages).
- [x] Add public compliance information page at `/compliance` for school evaluators.
- [x] Add Firestore rules emulator tests (`firebase-tests/`, 44 test cases).
- [ ] Define beta support process for consent, roster, and integration issues.

## Recommended build order

1. Auth, memberships, and teacher route protection.
2. Class model and onboarding split.
3. Canvas content and assignments.
4. Assignment-aware session bootstrap and prompt resolver.
5. Learning events and dashboard APIs.
6. Compliance enforcement and LMS hardening.

## Immediate next sprint

- [x] Finalize school entity schemas and Firestore indexes.
- [x] Update auth contract to return memberships and active context.
- [x] Add frontend `MembershipContext` and teacher route guard.
- [x] Convert `/app/teacher` from mock-only access to role-aware dashboard shell.
- [x] Define assignment DTOs and bootstrap contracts.
- [x] Add backend assignment bootstrap endpoint skeleton.

## Definition of done for beta entry

- [x] Teacher can create or import a class.
- [x] Teacher can create an assignment from Canvas content or teacher-authored source material.
- [x] Student can launch assignment-aware practice.
- [x] Teacher can see class and student analytics tied to that assignment.
- [x] Voice access respects consent and retention policy.
- [x] Teacher routes are role-protected.
- [x] Firestore rules are no longer placeholder-only.
