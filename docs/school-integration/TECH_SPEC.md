# School Integration Technical Spec

Status: Post-beta architecture direction accepted
Last updated: 2026-05-30
Owner: Engineering

Implementation note:

Current shipped constraints and temporary shortcuts are recorded in `LIMITATIONS.md`. Open work is tracked in `TASKS.md`.

## 1. Goal

Build a post-beta school architecture on top of the current Flask + Firebase + React stack with a clear persistence boundary:

- Firebase Auth remains the source of truth for authentication.
- Firestore remains the source of truth for user profile, assessment state, consumer-era chats, and realtime-friendly legacy data.
- Cloud SQL for PostgreSQL becomes the source of truth for school operations, assignment delivery, compliance records, practice-session metadata, learning events, and analytics-ready data.

**Current implementation status (2026-05-30):** all school-domain state — organizations, memberships, classes, enrollments, assignments, Canvas/LTI records, compliance, practice sessions, learning events — is still served from Firestore at runtime. An **inert** Postgres skeleton has landed (`backend/db/`: lazy Cloud SQL engine, the 20 baseline SQLAlchemy models, the Alembic `0001_baseline` migration, and the resolution helper + enrollment repository twin), wired into `RouteDeps.sql_engine` and feature-gated on `INSTANCE_CONNECTION_NAME`/`DATABASE_URL`. No route read or write uses it yet; absent the env vars the app behaves exactly as before (see LIMITATIONS #0). This spec sets the post-beta target direction: new school-domain persistence work moves onto that skeleton rather than deepening Firestore as the long-term operational database.

Recommended long-term approach:

Post-beta SQL migration with pragmatic coexistence.

- Keep Firebase Auth, Flask sessions, and `users/{uid}` identity/profile flows stable.
- Introduce a Postgres domain layer for organizations, memberships, classes, enrollments, assignments, Canvas/LTI records, compliance, practice sessions, learning events, and analytics rollups.
- Route new school-domain writes to Postgres first, with temporary dual-write only where legacy Firestore readers still need the same state.
- Backfill existing Firestore school-domain records into Postgres, verify parity with dual-read checks, then cut individual read paths over to Postgres.
- Keep assignment-owned scenario fields sourced from Canvas content or teacher-authored input, but store assignment records in Postgres after the migration boundary is introduced.
- Continue building AI session prompts from assignment context plus learner/compliance/modality state.

## 2. Current-state findings

### Shipped foundation as of 2026-05-30

The school-integration foundation is shipped. Current state:

- Auth response carries memberships + active org context; backend request-context helper resolves active membership/role/classes.
- Domain model: `organizations`, `memberships`, `classes`, `enrollments`, `assignments`, `practice_sessions`, `learning_events`, `canvas_connections`, `canvas_course_content`, `canvas_roster_entries`, `lingual_admin_audit`, `outbox_emails`, plus the full compliance surface (`student_compliance_records`, `consent_events`, `disclosure_logs`, `guardian_consent_packets`, `deletion_requests`, `deletion_execution_runs`).
- Role-aware route guards (`ProtectedRoute`, `AppProtectedRoute`, `TeacherRoute`, `LingualAdminRoute`, `SchoolAdminRoute`).
- Onboarding wizards for school admin (`/signup/admin/org-wizard`, 4-step, autosave draft) and teacher join-org (`/signup/teacher/join-org` with invite-code OR org-search). Admin approval required for teacher joins (auto-approve retired by Plan 4).
- Lingual admin panel at `/lingual-admin/*` (12 endpoints; org lifecycle suspend/restore + audit; auto-restore scheduler).
- Canvas LMS integration: PAT-based auth (AES-256-GCM encrypted), manual re-sync, roster decoupled from enrollments (2026-04-21), per-class content surface, assignment link picker, LTI 1.3 deep-link launch + grade passback.
- Assignment authoring: Canvas-linked, AI-assisted from teacher source packets, manual advanced, and scaffold-free `custom_prompt` mode (legacy `curriculum_mappings` removed).
- Assignment-aware prompt assembly via `backend/services/assignment_resolver.py` (reads scenario / objectives / targets / focus_grammar / teacher notes / language-intensity directly off the assignment doc).
- Realtime practice on `gpt-realtime-mini-2025-12-15` with `semantic_vad` eagerness=auto. Compliance gating fails closed; `textFallbackEnabled` downgrades when voice is blocked.
- Learning events + per-session summaries + class/assignment/student analytics endpoints and UIs. Disclosure logging on key sensitive endpoints.
- Compliance: full Epic A (guardian packets with secure-link decisions) and Epic B (deletion requests with sync execution worker). School-admin compliance dashboard with org-scoped summary, filterable roster, bulk consent, audit CSV export.
- Outbox email infrastructure: Firestore `outbox_emails/` + `send_outbox_email` Cloud Function. 9 templates wired (Plans 1+3+4+5).
- Firestore security rules are school-aware, validated via `firebase-tests/` emulator suite (44 tests, Java required to run).
- Plan 6 legacy user role migration: `LegacyRoleMigrationModal` + backfill script + `POST /api/auth/migrate-role`.

For known limitations on each shipped feature, see `LIMITATIONS.md`. For open work, see `TASKS.md`.

### Post-beta persistence finding

The shipped school feature set is approaching the limits of Firestore as the long-term school-domain system of record. Current code already performs relational work manually:

- membership hydration reads organizations separately
- student assignment lookup walks enrollments and class assignments
- class summaries count enrollments and assignments per class
- org-level counts chunk class IDs around Firestore `in` query limits
- analytics endpoints join assignments, enrollments, sessions, events, and users in Python
- compliance and deletion workflows depend on consistent multi-collection state transitions

These are natural SQL workflows. Firestore can remain operational during the migration, but new school-domain persistence design should treat Postgres as the destination rather than adding deeper Firestore-specific workarounds.

## 3. Architecture decisions

### 3.1 Use Postgres for school-domain state

Cloud SQL for PostgreSQL is the post-beta source of truth for school-domain state:

- organizations
- memberships and roles
- classes
- enrollments
- assignments
- Canvas/LTI integration records and roster mirrors
- compliance state
- guardian consent packets
- deletion requests and execution runs
- practice sessions
- learning events
- analytics rollups

Reason:

The product's school model is relational. Teachers belong to organizations, teach classes, publish assignments, review enrolled students, inspect sessions and events, and operate under compliance policies. SQL gives these workflows explicit foreign keys, constraints, transactional writes, joins, aggregate queries, migrations, and operational reporting without reimplementing those behaviors in Python and Firestore composite indexes.

### 3.2 Keep Firebase Auth and Firestore for identity/profile/legacy data

Firebase Auth remains the authentication provider. The Firebase UID remains the stable cross-system user identifier.

Firestore keeps:

- `users/{uid}` identity-adjacent profile state
- assessment state and results while the existing learner flows depend on them
- consumer-era chats and user-owned subcollections for backward compatibility
- realtime-friendly legacy data where direct client access is still useful and rule-covered

Firestore should not own post-beta school tenancy, roster, assignment, compliance, practice-session, learning-event, or analytics state.

### 3.3 Use explicit school-domain entities

Represent the school domain as first-class Postgres tables. Do not overload Firebase Auth custom claims, `users/{uid}`, or profile fields with tenant state.

### 3.4 Keep assignment content on the assignment row

Teacher-managed content should resolve to one assignment record that carries the AI-ready fields directly:

- `instructions`
- `generated_scenario`
- `objectives`
- `target_expressions`
- `focus_grammar`
- `teacher_notes`
- `target_language_intensity` (`target_only` | `mostly_target` | `bilingual_scaffold`, default `mostly_target`) — controls how much the AI tutor stays in the target language vs. scaffolds in English. Surfaces in the assembled prompt as a `## Language Mix` section.
- optional `canvas_module_item_ref`

This keeps prompt assembly assignment-centric and avoids a second overlay collection just to resolve practice context.

### 3.5 Route every teacher-managed practice session through an assignment resolver

The prompt builder must no longer be called directly from a sample module selector alone. For school-managed practice, the flow becomes:

assignment -> class context -> student profile -> compliance policy -> modality policy -> system prompt

### 3.6 Voice gating must happen before session creation

No voice-capable route should create a session unless the student's compliance record allows it.

### 3.7 Normalize learning events before chasing dashboards

Teacher analytics should not be reverse-engineered from chat documents. Practice sessions should emit structured events that roll up into class and assignment metrics.

### 3.8 Migrate through coexistence, not a flag-day rewrite

The migration must be staged:

1. Add a Postgres access layer and schema while Firestore remains the existing runtime.
2. Backfill Firestore school-domain data into Postgres.
3. Put new school-domain writes on Postgres first.
4. Dual-write only the legacy Firestore documents that existing readers still require.
5. Add parity checks that compare Firestore reads against Postgres projections.
6. Move read paths one bounded area at a time.
7. Remove Firestore school-domain writes only after the corresponding route/UI has been fully cut over and monitored.

The staging above is the happy path. A schema-fidelity review against the live Firestore writers (`database.py` and the services) surfaced five gaps that the plan must close before backfill code is written. They are not optional refinements — each one either breaks a backfill or causes silent data loss:

**a. ID resolution across the coexistence window.** Firestore uses deterministic composite *string* IDs (`{org_id}_{uid}`, `{class_id}_{student_uid}`) as both primary key and uniqueness guard; Postgres uses opaque `uuid` PKs with `legacy_firestore_id` for traceability. Every foreign reference needs an old-string → new-UUID lookup, and the backfill must run in parent-first dependency order. A row written to Firestore *after* its parent is backfilled but *before* read-cutover will reference a string ID that has no UUID yet. **Decided (2026-05-30): resolve cross-store references through the unique `legacy_firestore_id` index on every write — no write-freeze, no downtime, UUID PKs retained.** The resolution helper is the same one backfill uses, centralized in the repository layer behind `RouteDeps`. See `POSTGRES_SCHEMA.md` → "Backfill Normalization And ID Resolution."

**b. Dual-write consistency.** Step 4 has no rollback or idempotency mechanism. A route that writes Postgres-then-Firestore (or the reverse) has no compensation if the second write fails — and today's Firestore-only writes at least fail within one store. Cross-store writes during migration need explicit compensation (an outbox-style record or per-write idempotency key), not best-effort sequencing.

**c. Parity-check scope.** Step 5 will throw false diffs: snapshot columns (`analysis_state`, `session_summary`) mutate in place in Firestore, and server timestamps differ by microseconds across stores. Parity checks must compare only stable, non-mutating fields with a defined tolerance — not whole documents.

**d. Active-session handling.** `practice_sessions.analysis_state` is rewritten on every learning event. Backfilling a `status='active'` session snapshots a moving target that diverges the instant the next event lands in Firestore. Drain or exclude active sessions from backfill.

**e. Rollback path.** Steps 6–7 are forward-only on hot paths (analytics, event capture) during school hours. A failed cut that reads from an incomplete Postgres store shows empty analytics and zero-event sessions to live classrooms. Each route-family cut needs a feature flag that toggles reads back to Firestore without a redeploy.

Two latent code bugs the migration *exposes* (fix before cutover): `metric.context_tag_signal` is emitted but missing from `SUPPORTED_EVENT_TYPES` (`practice_analytics.py:10`), and two divergent org-type constants exist (`ALLOWED_ORG_TYPES` = `{'school'}` vs `ORGANIZATION_TYPES` = `{'school','district','program'}`). Both are tracked in `TASKS.md`.

## 4. Proposed domain model

Post-beta target: Postgres owns school operations and analytics-ready learning data. Firestore collections below describe retained identity/profile data plus the current migration-source shape for school-domain data.

### 4.1 Firebase/Firestore retained data and migration source collections

### `users/{uid}`

Keep:

- identity
- learner profile
- assessment state
- consumer-era chats for backward compatibility

Add cautiously:

- `default_learning_locale`
- `last_active_membership_id`

Do not add:

- class roster state
- teacher permissions
- school analytics summaries

### `organizations/{orgId}`

Fields:

- `name`
- `type` (`school`, `district`, `program`)
- `status`
- `pilot_stage`
- `default_modality_policy`
- `default_retention_policy`
- `lms_capabilities`
- `created_at`
- `updated_at`

### `memberships/{membershipId}`

Fields:

- `org_id`
- `uid`
- `roles` (`school_admin`, `teacher`, `student`)
- `status`
- `primary_class_ids`
- `created_at`
- `updated_at`

Reason:

This supports one user in multiple schools or roles without overloading auth or profile documents.

### `classes/{classId}`

Fields:

- `org_id`
- `name`
- `term`
- `subject`
- `learning_locale`
- `teacher_membership_ids`
- `grade_band`
- `status`
- `join_code` (6-char uppercase alphanumeric, safe alphabet excluding 0/O/1/I/L)
- `join_code_active` (boolean, default `true` when generated)
- `join_code_generated_at`
- `created_at`
- `updated_at`

Join code rules:

- A class has at most one active join code at a time.
- The code is stored directly on the class document (1:1 relationship, no separate collection).
- Teachers generate, regenerate, or deactivate the code.
- Students enter the code to join the class. Joining auto-creates a student membership for the org and an active enrollment for the class.
- Duplicate join is idempotent: if the student is already enrolled and active, return success. If enrolled but inactive, reactivate.
- Requires a composite Firestore index on `(join_code, join_code_active, status)`.

### `enrollments/{enrollmentId}`

Fields:

- `class_id`
- `student_uid`
- `student_membership_id`
- `status`
- `join_source` (`manual`, `invite`, `join_code`, `lti`, `google_classroom`, `canvas_legacy`)
- `student_number` (optional)
- `guardian_contact_required`
- `created_at`
- `updated_at`

**Invariant (2026-04-21):** Canvas PAT sync never writes to `enrollments/`.
Enrollments are created only by explicit student action (join code) or
consent-by-click (LTI deep-link launch). The `canvas_legacy` value is
reserved for records grandfathered during the 2026-04-21 migration off the
old email-match auto-enroll path; no new code writes it.

### `canvas_roster_entries/{class_id}__{canvas_user_id}`

Canvas-truth view of the class roster — a read-only mirror of who Canvas
says is enrolled in the course. Written only by Canvas PAT sync. Used to
render the "On Canvas roster" badge on the teacher-side roster view and
the "not yet joined" gap list. Does **not** grant class access in Lingual
— only an `enrollments/` row does.

Fields:

- `class_id`
- `connection_id`
- `canvas_user_id`
- `canvas_email`
- `canvas_name`
- `synced_at`
- `created_at`

Purpose:

Decouple the Canvas roster signal (who Canvas thinks is in the course)
from Lingual enrollment (who has affirmatively joined and granted
whatever consent the org policy requires). A student is "Canvas-rostered"
when a row exists here, and "Lingual-enrolled" when a row exists in
`enrollments/`; the two are independent.

### `assignments/{assignmentId}`

Fields:

- `org_id`
- `class_id`
- `title`
- `description`
- `status`
- `release_at`
- `due_at`
- `modality_override`
- `max_attempts`
- `task_type` (enum: `information_gap`, `opinion_gap`, `decision_making`, `custom_prompt`; default `decision_making`). When `custom_prompt`, the assignment is scaffold-free: `instructions` is used as the system prompt with only the `target_language_intensity` policy appended (scenario / target expressions / target vocabulary / focus grammar / objectives / teacher notes / success criteria scaffolding is skipped). Analytics that depend on target expressions, focus grammar, or rubric dimensions are intentionally N/A for these assignments.
- `success_criteria`
- `created_by_uid`
- `instructions`
- `generated_scenario`
- `objectives`
- `target_expressions`
- `focus_grammar`
- `teacher_notes`
- `target_language_intensity` (enum: `english_first`, `english_led`, `balanced`, `target_led`, `target_only`; default `balanced`). Mirrors the 5-level language-mix selector used on the free-practice chat page so teachers and students share one mental model. Legacy values `mostly_target` → `target_led` and `bilingual_scaffold` → `english_led` are normalized on read for backward compatibility with pre-widening assignments.
- `canvas_module_item_ref`
- `created_at`
- `updated_at`

### `student_compliance_records/{recordId}`

One derived record per student per organization.

Fields:

- `org_id`
- `student_uid`
- `is_minor`
- `guardian_consent_status`
- `voice_consent_status`
- `text_allowed`
- `voice_allowed`
- `retention_policy_id`
- `school_agreement_version`
- `last_verified_at`
- `updated_at`

Purpose:

Provide one fast answer to the question "may this student use voice today?"

### `consent_events/{eventId}`

Audit trail for consent creation, revocation, reminders, and policy changes.

Fields:

- `org_id`
- `student_uid` (nullable for class- or org-scoped operational events)
- `scope_type` (`student` | `class` | `org`)
- `scope_id`
- `event_type`
- `actor_type`
- `actor_id`
- `evidence_ref`
- `payload`
- `created_at`

Purpose:

Record both student-scoped consent mutations and class/org-scoped sensitive access operations such as audit export.

#### Disclosure logging

The `consent_events` collection also records read-side access disclosure events — when a teacher or admin views student data through sensitive endpoints. The `log_disclosure_if_new()` service in `backend/services/disclosure_logging.py` writes disclosure events with daily deduplication per `(actor_uid, student_uid, event_type)` using UTC calendar-day boundaries.

Currently wired endpoints:

| Endpoint | Actor role | Event type |
|----------|-----------|------------|
| `GET /api/teacher/classes/{classId}/students/{studentUid}/analytics` | teacher | `disclosure.practice_data_viewed` |
| `GET /api/admin/compliance/roster` | school_admin | `disclosure.compliance_viewed` |

The admin roster view logs org-scoped events (`student_uid=''`) rather than per-student events to avoid N+1 writes.

### `guardian_consent_packets/{packetId}`

Epic A model for guardian collection. Current implementation ships secure-link guardian response plus staff-managed `downloadable_notice` packet tracking.

Fields:

- `org_id`
- `class_id`
- `student_uid`
- `notice_version`
- `consent_scope`
- `contact_channel`
- `contact_destination_hint`
- `delivery_method` (`secure_link` | `downloadable_notice`)
- `status` (`draft` | `issued` | `viewed` | `granted` | `revoked` | `expired` | `canceled`)
- `token_hash`
- `token_last_four`
- `response_method`
- `evidence_ref`
- `reminder_count`
- `expires_at`
- `issued_at`
- `last_sent_at`
- `acted_at`
- `created_by_uid`
- `created_at`
- `updated_at`

Purpose:

Support a school-admin-assisted guardian workflow without introducing a standalone guardian account model in the current school product.

State model:

- `draft`: packet prepared but not yet delivered
- `issued`: packet delivered by secure link or downloadable notice
- `viewed`: recipient opened the secure packet or confirmed receipt in staff tooling
- `granted`: guardian accepted the consent terms for the declared scope
- `revoked`: guardian explicitly withdrew a previously granted consent
- `expired`: packet timed out before a valid response
- `canceled`: staff withdrew the packet before completion

Implementation rules:

- Do not create guardian accounts until a dedicated guardian product surface is designed.
- Packets are school-admin-assisted artifacts, not a parent portal.
- `token_hash` must store only a hashed token, never the raw token.
- Every packet issuance, resend, reminder, view, grant, revoke, expire, and cancel action must emit a `consent_events` row.
- Packet completion must write both `guardian_consent_packets` state and the derived `student_compliance_records.guardian_consent_status`.

Current API surface:

- `GET /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packet`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/resend`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/cancel`
- `GET /api/guardian/consent/<token>`
- `POST /api/guardian/consent/<token>/decision`

### `deletion_requests/{requestId}`

Epic B request model for auditable deletion operations.

Fields:

- `org_id`
- `scope_type` (`student` | `class` | `org`)
- `scope_id` (student_uid for student scope, class_id for class scope, org_id for org scope)
- `requested_by_uid`
- `request_reason`
- `status` (`requested` | `approved` | `rejected` | `in_progress` | `completed` | `failed` | `partially_completed`)
- `approved_by_uid`
- `review_notes`
- `target_collections` (list of collection names targeted for deletion)
- `target_storage_prefixes` (list of Cloud Storage path prefixes targeted for deletion)
- `execution_summary` (counts and outcome from the latest execution run)
- `created_at`
- `updated_at`
- `completed_at`

Purpose:

Separate request intake, approval, and synchronous execution for deletion so storage cleanup and partial failures are auditable.

#### Frozen scope rules

| Scope | Deletion targets | Preserved |
|-------|-----------------|-----------|
| `student` | practice_sessions, learning_events, student_compliance_records, consent_events, guardian_consent_packets, and stored audio for one student within the org | users/{uid} identity, consumer-era chats, enrollment, membership, analytics_rollups |
| `class` | practice_sessions, learning_events, and stored audio for all students in the class | compliance records, enrollments, memberships, class document, assignments |
| `org` | All org-scoped data: practice_sessions, learning_events, student_compliance_records, consent_events, guardian_consent_packets, classes, enrollments, memberships, assignments, and stored audio | users/{uid} identity, consumer-era chats, analytics_rollups |

Key rule: `student`-scope deletion removes only privacy-sensitive practice data. The student's enrollment and membership are preserved. Enrollment removal is a separate roster management action.

#### Frozen approval matrix

| Scope | Who can request | Who can approve | Self-approve allowed |
|-------|----------------|----------------|---------------------|
| `student` | `teacher`, `school_admin` | `school_admin` | Yes, if requester is `school_admin` |
| `class` | `teacher` (own class), `school_admin` | `school_admin` | Yes, if requester is `school_admin` |
| `org` | `school_admin` | `school_admin` | Yes (only role with org-wide access in the current product) |

#### Deletion SLA

Target: 7 days from approval to completion.

Current execution strategy: synchronous (Flask endpoint triggers deletion immediately on approval or retry). Upgradeable to async Cloud Tasks worker as volume grows.

### `deletion_execution_runs/{runId}`

Epic B execution model for tracking deletion attempts independently from the approval request.

Fields:

- `request_id`
- `org_id`
- `scope_type`
- `scope_id`
- `status` (`running` | `completed` | `failed` | `partially_completed`)
- `attempt_number`
- `firestore_counts` (dict: `{targeted, deleted, failed, by_collection}`)
- `storage_counts` (dict: `{targeted, deleted, failed}`)
- `error_summary` (list of error strings from failed operations)
- `started_at`
- `finished_at`

Purpose:

Track every execution attempt independently from the human approval request so retries and partial failures remain auditable.

Request state model:

- `requested`: request submitted and awaiting review
- `approved`: request accepted, ready for execution
- `rejected`: request denied with review notes
- `in_progress`: execution run is active
- `completed`: deletion finished successfully
- `failed`: terminal failure without successful cleanup
- `partially_completed`: some targets were deleted but others failed; retryable

Execution rules:

- Approval and execution are separate steps.
- Execution is triggered explicitly (approve does not auto-execute; a separate execute/retry action runs the deletion).
- Firestore records and Firebase Storage artifacts are enumerated from the request scope at execution time.
- Execution must be idempotent and retryable — already-deleted docs are counted as successful.
- Every request, approval, rejection, execution start, completion, partial failure, and retry must emit a `consent_events` audit row.
- The UI must show both the request state and the latest execution run summary.

API surface:

- `GET /api/admin/deletion-requests` — list requests for the org
- `POST /api/admin/deletion-requests` — create a new request
- `GET /api/admin/deletion-requests/<request_id>` — request detail + latest execution run
- `POST /api/admin/deletion-requests/<request_id>/approve` — approve (school_admin only)
- `POST /api/admin/deletion-requests/<request_id>/reject` — reject with review notes
- `POST /api/admin/deletion-requests/<request_id>/execute` — trigger deletion (approved requests only)
- `POST /api/admin/deletion-requests/<request_id>/retry` — retry a failed/partially_completed execution

### `practice_sessions/{sessionId}`

Fields:

- `org_id`
- `class_id`
- `assignment_id`
- `student_uid`
- `mapping_snapshot`
- `modality`
- `voice_enabled`
- `status`
- `started_at`
- `ended_at`
- `prompt_version`
- `transcript_ref`
- `cost_summary`
- `session_summary`

### `learning_events/{eventId}`

Append-only event stream for analytics.

Fields:

- `org_id`
- `class_id`
- `assignment_id`
- `session_id`
- `student_uid`
- `event_type`
- `turn_index`
- `payload`
- `created_at`

Example event types:

- `session.started`
- `session.ended`
- `student.turn`
- `assistant.turn`
- `feedback.recast`
- `feedback.elicitation`
- `feedback.review_item`
- `metric.speaking_time`
- `metric.target_expression_hit`
- `metric.self_correction`
- `task.completed`

### `analytics_rollups/{rollupId}`

Precomputed summaries keyed by scope and period.

Suggested IDs:

- `class:{classId}:day:{YYYY-MM-DD}`
- `assignment:{assignmentId}:week:{YYYY-WW}`
- `student:{uid}:assignment:{assignmentId}`

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

### 4.2 Target Postgres schema

Detailed DDL blueprint: `docs/school-integration/POSTGRES_SCHEMA.md`.

The first Postgres schema should use Firebase UID strings as user references instead of duplicating Firebase Auth identities. UUID primary keys are recommended for school-domain rows unless an external identifier needs a deterministic key.

Core tenancy and roles:

| Table | Purpose | Key constraints |
|---|---|---|
| `organizations` | School, district, or program tenant | `id uuid primary key`, `status`, `name_lower`, metadata fields for admin/search |
| `memberships` | User-to-organization role assignment | `org_id references organizations`, `firebase_uid text`, `roles text[]`, unique active membership policy per `(org_id, firebase_uid)` |
| `classes` | Teacher-managed class/course shell | `org_id references organizations`, learning locale, subject, term. Join codes live in `class_join_codes` (Firestore stores them inline on the class doc; they normalize out on backfill) |
| `class_teachers` | Many-to-many teacher assignment | `class_id references classes`, `membership_id references memberships`, unique `(class_id, membership_id)` |
| `class_join_codes` | Join-code lifecycle | `class_id references classes`, unique active code, generated/deactivated timestamps |
| `enrollments` | Student enrollment in a class | `class_id references classes`, `student_firebase_uid text`, `student_membership_id references memberships`, unique `(class_id, student_firebase_uid)` |

Assignments and source integrations:

| Table | Purpose | Key constraints |
|---|---|---|
| `assignments` | Teacher-authored assignment and AI-ready prompt fields | `org_id`, `class_id`, `created_by_firebase_uid`, status, task type, modality, scenario fields |
| `canvas_connections` | Server-only Canvas connection credentials and course mapping | `class_id references classes`, encrypted PAT or LTI linkage fields |
| `canvas_course_content` | Synced Canvas modules/items | `connection_id references canvas_connections`, `class_id references classes`, optional `linked_assignment_id references assignments` |
| `canvas_roster_entries` | Canvas roster mirror only | unique `(class_id, canvas_user_id)`, no access grant by itself |
| `lti_platforms` | LTI platform registration | issuer/client/deployment identifiers, `org_id references organizations` |
| `lti_sessions` | LTI launch/session state | user/course/assignment launch metadata tied to Firebase UID |

Compliance and privacy:

| Table | Purpose | Key constraints |
|---|---|---|
| `student_compliance_records` | Current effective consent/policy answer | unique `(org_id, student_firebase_uid)` |
| `consent_events` | Append-only consent, disclosure, audit event stream | `org_id`, optional student/class scope, event type, actor metadata |
| `guardian_consent_packets` | Guardian notice/secure-link lifecycle | `org_id`, `class_id`, `student_firebase_uid`, token hash only |
| `deletion_requests` | Human approval workflow for deletion | `org_id`, scope, status, requested/approved actor fields |
| `deletion_execution_runs` | Retryable execution attempts | `request_id references deletion_requests`, attempt number, count summaries |

Practice and analytics:

| Table | Purpose | Key constraints |
|---|---|---|
| `practice_sessions` | Assignment-scoped practice attempt metadata | `org_id`, `class_id`, `assignment_id`, `student_firebase_uid`, status, modality, prompt snapshots as JSONB |
| `learning_events` | Append-only event stream | `session_id references practice_sessions`, `assignment_id`, `class_id`, `student_firebase_uid`, event type, JSONB payload |
| `analytics_rollups` | Materialized aggregates by scope/period | unique `(org_id, scope_type, scope_id, period_type, period_start)` — **net-new, excluded from the initial baseline** (analytics are computed on-the-fly today; no rollup persistence exists). Gated behind a refresh-worker decision. |

`organizations` also carries denormalized/inline fields the live writers depend on but that do not normalize cleanly: `lms_capabilities`, `teacher_invite_code*`, and `school_admin_uids` (the last is derived from `memberships` in Postgres, not stored — see `POSTGRES_SCHEMA.md`). The `lti_platforms` / `lti_sessions` tables are live Firestore collections (`database.py:4068`, `4185`), not PyLTI1p3 session files, so they are real migration targets. Field renames, legacy-value normalizations, type coercions, and the parent-first ID-resolution order are enumerated in `POSTGRES_SCHEMA.md` → "Backfill Normalization And ID Resolution."

Recommended column conventions:

- Primary keys: `uuid` generated by Postgres for domain rows.
- User references: `firebase_uid text not null` or `student_firebase_uid text not null`.
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` where mutable.
- Flexible prompt/analytics snapshots: `jsonb`, but only for bounded snapshots and event payloads. Do not use `jsonb` to avoid modeling stable relational ownership.
- Status fields: text enums enforced by `check` constraints first; upgrade to Postgres enum types only after status vocabularies stabilize.
- Soft deletion: prefer `status`/`archived_at` for operational entities; hard deletion only through deletion-request execution.

Critical indexes:

- `memberships(firebase_uid, status)`
- `memberships(org_id, status)`
- `classes(org_id, status, updated_at desc)`
- `class_teachers(membership_id, class_id)`
- `enrollments(student_firebase_uid, status, updated_at desc)`
- `enrollments(class_id, status, updated_at desc)`
- `assignments(class_id, status, due_at)`
- `practice_sessions(assignment_id, student_firebase_uid, started_at desc)`
- `practice_sessions(class_id, started_at desc)`
- `learning_events(session_id, created_at)`
- `learning_events(assignment_id, event_type, created_at)`
- `consent_events(org_id, student_firebase_uid, created_at desc)`
- `guardian_consent_packets(class_id, student_firebase_uid, updated_at desc)`

### 4.3 Why this model fits the repo

- It preserves the current `users/{uid}` contract for existing learner flows.
- It stops treating Firestore document IDs and denormalized arrays as the long-term replacement for relational constraints.
- It gives the teacher product a real school data layer instead of relying on `profile.school_name` or Firestore-side lookup choreography.
- It lets analytics use SQL joins, filters, materialized rollups, and query plans instead of loading broad Firestore result sets into Python.
- It can be added incrementally without breaking current routes because `RouteDeps.db` already acts as a persistence boundary.

## 5. Backend design

### 5.1 New responsibilities

### Auth and request context

Extend `/api/auth/verify` so the response hydrates:

- memberships
- active organization
- active role
- teacher-eligible class summaries

Add a request-context resolver to `RouteDeps` so routes can access:

- current uid
- active organization
- active membership
- role set
- allowed class scope

### School domain

Add new route modules:

- `backend/routes/schools.py`
- `backend/routes/teacher.py`
- `backend/routes/integrations.py`

Core endpoints:

- `POST /api/schools`
- `GET /api/schools/current`
- `POST /api/schools/current/active-membership`
- `GET /api/teacher/classes`
- `POST /api/teacher/classes`
- `GET /api/teacher/classes/<class_id>/dashboard`
- `POST /api/teacher/classes/<class_id>/join-code`
- `GET /api/teacher/classes/<class_id>/join-code`
- `DELETE /api/teacher/classes/<class_id>/join-code`
- `GET /api/teacher/classes/<class_id>/roster`
- `DELETE /api/teacher/classes/<class_id>/students/<student_uid>`
- `POST /api/schools/join`
- `POST /api/teacher/classes/<class_id>/roster/import`

### Curriculum admin and assignment orchestration

Add route module:

- `backend/routes/curriculum_admin.py`

Core endpoints:

- `GET /api/teacher/classes/<class_id>/canvas/content`
- `POST /api/teacher/classes/<class_id>/canvas-practice/generate`
- `POST /api/teacher/classes/<class_id>/canvas-practice/create`
- `POST /api/teacher/classes/<class_id>/assignment-drafts/generate`
- `GET /api/teacher/classes/<class_id>/assignments`
- `POST /api/teacher/classes/<class_id>/assignments`
- `GET /api/student/assignments`

### Practice session orchestration

Add service modules:

- `backend/services/assignment_resolver.py`
- `backend/services/compliance.py`
- `backend/services/events.py`
- `backend/services/analytics.py`

New sequence for school practice:

1. Student opens assignment.
2. Frontend requests practice session bootstrap with `assignmentId`.
3. Backend resolves class, assignment-owned scenario fields, learner state, compliance state, and modality.
4. Backend creates `practice_sessions/{sessionId}`.
5. Backend returns practice bootstrap plus the allowed realtime session parameters.
6. Voice routes call compliance service before creating a realtime session.
7. If voice is blocked, launch downgrades to assignment-scoped text only when `text_fallback_enabled` is true; otherwise launch fails closed.
8. Pronunciation routes use the same compliance service before creating voice-capable sessions or storing raw audio.
9. Client and server emit `learning_events`.
10. Rollup service updates class and assignment analytics.

### 5.2 Prompt architecture

The prompt builder should move to layered assembly.

### Layer 1: safety and compliance envelope

- allowed modality
- retention behavior
- prohibited behaviors
- language and role safety

### Layer 2: assignment context

- assignment instructions
- generated scenario
- teacher-authored objectives
- target expressions
- focus grammar
- task type
- success criteria
- optional Canvas source reference

### Layer 3: tutoring policy

- modality limits
- correction and coaching guidance embedded in assignment metadata
- target-output pressure
- preferred balance of fluency vs accuracy

Implementation note:

- keep `assignment_resolver.py` as the final assignment-aware prompt assembler
- keep prompt assembly deterministic and assignment-driven before introducing any live intervention layer

### Layer 4: learner personalization

- proficiency profile
- recent error patterns
- assignment history
- accessibility or pacing settings

### 5.3 Pedagogy policy model

Suggested mapping object shape:

- `feedback_policy`
  - `mode`: `fluency_first`, `balanced`, `accuracy_first`
  - `target_only_strict`: boolean
  - `recast_default`: boolean
  - `elicitation_repeat_threshold`: integer
  - `end_review_enabled`: boolean
- `scaffold_policy`
  - `silence_tolerance_ms`
  - `hint_ladder`
  - `max_modeling_steps`
- `output_policy`
  - `min_student_turn_words`
  - `follow_up_pressure`
  - `allow_clarification_requests`

Default school behavior:

- realtime turns use recast first
- same target error repeated 3 times escalates to elicitation
- session review produces metalinguistic explanations for repeated target errors

### 5.4 Compliance design

Compliance is a gating system, not a UI checkbox.

Rules to encode:

- If `voice_allowed` is false, no voice session may be created.
- If voice is blocked and `text_fallback_enabled` is true, assignment launch may downgrade to assignment-scoped text.
- If voice is blocked and `text_fallback_enabled` is false, launch must fail closed.
- If consent is revoked, active voice attempts must fail closed.
- Pronunciation routes must apply the same voice gating and retention policy checks as assignment practice routes.
- Retention policy must determine whether raw audio is stored, for how long, and where.
- Audit trail must record consent changes and sensitive access paths.
- Teachers and school admins may update consent records inside their authorized organization and class scope.
- Operational tooling starts with class-scoped bulk consent updates and class-scoped audit export from teacher workflows.
- Guardian-facing consent collection requires a dedicated actor/evidence model and should not be improvised from teacher-only forms.
- Deletion execution requires a stateful workflow that covers Firestore records and Firebase Storage audio artifacts before it is automated.

Current implementation slice:

- class compliance roster endpoint that joins active enrollments, user display names, guardian-contact flags, and effective compliance status
- class-scoped bulk consent update actions for teacher and school-admin roles
- class-scoped audit export in CSV format backed by `consent_events`
- audit export access logged as a class-scoped `consent_events` row
- guardian packet issue/resend/cancel actions from student drill-down
- class compliance roster and student drill-down surfaces that show guardian packet state alongside effective consent state
- secure-link public guardian page that records `granted` / `revoked` decisions back into `student_compliance_records`
- `downloadable_notice` delivery recorded as a staff-managed packet type without a rendered handout artifact

Remaining hardening after the current slice:

#### Epic B: Deletion requests and execution

- define request intake, approval, and async execution lifecycle
- add deletion execution runs so retries and partial failures are visible
- enumerate Firestore and Storage deletion targets from a request scope snapshot
- broaden event taxonomy for request creation, approval, rejection, queue, retry, completion, and failure

Recommended school defaults, pending counsel validation:

- text practice allowed unless school policy blocks it
- raw audio retention: 30 days
- transcripts and derived session summaries: 365 days
- aggregated analytics: term length plus 1 year
- deletion SLA target: 7 days from approved request

Hard rule:

Do not build voice identity, speaker recognition, or voiceprint features for school deployments.

### 5.5 Analytics model

Teacher analytics should come from normalized metrics, not from ad hoc transcript parsing during dashboard render.

Initial derived metrics:

- `speaking_time_ms`
- `student_turn_count`
- `mean_length_of_utterance_words`
- `target_expression_hit_count`
- `target_expression_turn_rate`
- `repeated_error_count_by_type`
- `self_correction_count`
- `task_completion_status`
- `voice_minutes_used`
- `estimated_session_cost_usd`

Initial computation strategy:

- write raw events at session time
- compute lightweight per-session summaries synchronously
- update class and assignment rollups asynchronously

### 5.6 Realtime cost controls

Every assignment should declare or inherit a modality policy:

- `text_only`
- `voice_only`
- `hybrid`

Additional controls:

- org weekly voice budget
- class weekly voice budget
- assignment voice minute cap
- automatic downgrade from voice to text when budget or consent blocks voice only if `text_fallback_enabled` is true

## 6. Frontend design

### 6.1 State model

Keep `AuthContext` for identity auth, but add:

- `MembershipContext`
- `TeacherClassContext` or per-route loaders for class-scoped pages

`MembershipContext` should expose:

- memberships
- active membership
- active role
- active organization
- available classes

### 6.2 Route structure

Top-level routes (outside `/app` shell):

- `/login`, `/signup` (split into role-aware CTAs)
- `/signup/admin/org-wizard`, `/signup/admin/pending` — admin org creation flow (Plan 3)
- `/signup/teacher/join-org`, `/signup/teacher/pending` — teacher join flow (Plan 4)
- `/lingual-admin/*` — Lingual admin panel (Plan 5; bypasses AppLayout to avoid double-nesting with `LingualAdminShell`)
- `/compliance` — public compliance information page

Inside `/app` shell:

- `/app/learn` — student home (Free Practice + Canvas module list)
- `/app/teacher` — teacher dashboard
- `/app/teacher/classes/:classId` — class overview + analytics
- `/app/teacher/classes/:classId/compliance` — class compliance roster
- `/app/teacher/assignments/:assignmentId` — assignment analytics
- `/app/teacher/students/:studentUid` — student drill-down
- `/app/admin` — school-admin home + compliance + deletion requests
- `/app/assignments/:assignmentId` — student assignment launch
- `/app/chat`, `/app/pronunciation`, `/app/games`, `/app/settings`

### 6.3 Frontend API modules

Add:

- `frontend/src/api/schools.ts`
- `frontend/src/api/teacher.ts`
- `frontend/src/api/assignments.ts`
- `frontend/src/api/compliance.ts`
- `frontend/src/types/school.ts`
- `frontend/src/types/assignment.ts`

### 6.4 Teacher dashboard hydration

Keep the current visual shell in `TeacherDashboardPage`, but replace hardcoded arrays with a single typed dashboard DTO:

- summary cards
- activity time series
- skill breakdown
- student table
- alerts

### 6.5 Curriculum mapping UI

Build a teacher-owned overlay editor, not a second curriculum editor.

The UI should let teachers:

- choose a package, module, and objectives
- enter target expressions
- choose task type
- set feedback mode
- set scaffold behavior
- set modality policy
- publish an assignment

This references stable `moduleId`, `objectiveIds`, and `situationId` values from the existing curriculum schema.

## 7. Key files

All of the files originally listed here as "to create" or "to modify" are now in code. For the canonical current-shape file map (blueprints, services, frontend pages, contexts, API modules), see the **Key Files** section of the top-level `CLAUDE.md`. Plan-specific surfaces are documented under `docs/superpowers/plans/` (Plan 3 admin wizard, Plan 4 teacher join-org, Plan 5 Lingual admin, Plan 6 legacy migration) and `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`.

## 8. Rollout phases

The phases below define the accepted post-beta migration path. The current runtime is still Firestore-backed, so implementation should proceed gradually through backfill, dual-write, parity checks, and route-family cutovers rather than a flag-day rewrite.

### Phase 0: architecture lock

- Accept ADR-0001 as the persistence decision.
- Keep Firebase Auth and Firestore identity/profile flows stable.
- Freeze the Postgres target schema for school-domain v1.
- Choose the first implementation library for Flask Postgres access (`SQLAlchemy` + `Alembic` recommended).

### Phase 1: Postgres foundation

- Provision Cloud SQL for PostgreSQL.
- Add migration tooling and local development connection docs.
- Add `backend/persistence/` or equivalent repository layer behind `RouteDeps`.
- Create tables for organizations, memberships, classes, enrollments, assignments, Canvas/LTI records, compliance records, practice sessions, learning events, and audit/deletion workflows.
- Add seed/backfill scripts that can run dry-run, write, and parity-check modes.

### Phase 2: backfill and parity

- Backfill Firestore school-domain data into Postgres.
- Keep Firestore IDs in `legacy_firestore_id` columns where route compatibility or traceability matters.
- Add parity reports for counts and sampled records across organizations, classes, enrollments, assignments, sessions, events, compliance records, and guardian packets.
- Do not cut reads over until parity reports are deterministic enough to run in CI or a release checklist.

### Phase 3: Postgres-first writes

- Move new school-domain writes to Postgres first.
- Dual-write only fields still required by existing Firestore-backed readers.
- Start with low-risk domains: new organizations/classes/enrollments/assignments.
- Then move compliance, guardian packets, deletion workflows, practice sessions, and learning events.

### Phase 4: read cutover by route family

- Switch route families one at a time from Firestore reads to Postgres reads.
- Recommended order: school context, teacher class/roster, assignments, compliance, student assignment launch, practice sessions/events, analytics.
- For each route family, compare Firestore projection and Postgres result shape before removing the Firestore read path.

### Phase 5: analytics and reporting hardening

- Replace Python-side aggregation over broad Firestore result sets with SQL-backed queries and rollups.
- Add materialized or scheduled rollups for class, assignment, and student dashboards.
- Move retention/deletion execution to async workers if synchronous execution becomes too slow or operationally risky.

### Phase 6: Firestore school-domain retirement

- Remove Firestore writes for migrated school-domain collections.
- Keep read-only archival access only where needed for audit/migration history.
- Delete obsolete composite indexes after all production readers have been cut over and monitored.
- Update Firestore rules so school-domain client reads are denied unless a retained legacy path explicitly requires them.

## 9. Testing strategy

Backend:

- SQL migration tests for schema constraints and indexes
- repository tests for Postgres persistence boundaries
- Firestore-to-Postgres backfill dry-run and parity tests
- unit tests for assignment resolver
- unit tests for compliance gating
- unit tests for analytics aggregation
- route tests for teacher authorization
- route tests for `assignmentId`-based session creation

Frontend:

- route guard tests for teacher vs student access
- mapping editor tests
- dashboard rendering tests with typed fixtures
- assignment launch flow tests
- practice-mode fallback tests for voice-blocked students

Integration:

- school onboarding -> class creation -> assignment publish -> student launch -> teacher dashboard refresh
- consent revocation blocks new voice sessions
- budget exhaustion downgrades a session from voice to text
- dual-write smoke test for route families that temporarily write both Postgres and Firestore
- read-parity smoke test before cutting a route family from Firestore to Postgres

## 10. School readiness features

### Contextual onboarding hints

State-driven `OnboardingHint` banners guide teachers through setup workflows without requiring persistent dismissal state. Hints derive their visibility from data already loaded on each page (e.g., class count, student count, assignment count).

Component: `frontend/src/components/ui/OnboardingHint.tsx`

Placements:

- **TeacherDashboardPage**: no classes, no students, no assignments (3 hints, priority order)
- **TeacherClassAnalyticsPage**: no enrollments, no assignments, assignments with zero sessions (3 hints)
- **TeacherClassCompliancePage**: students with unknown or pending consent (1 hint)

### Public compliance information page

A static page at `/compliance` (public, no auth required) provides school administrators evaluating Lingual with a summary of data collection, consent workflows, access scoping, retention defaults, deletion process, and compliance posture.

Component: `frontend/src/pages/CompliancePage.tsx`
Route: `<Route path="/compliance" />` in `App.tsx`, outside the `ProtectedRoute` wrapper.

### Firestore rules emulator tests

A standalone test project in `firebase-tests/` validates Firestore security rules against the emulator using `@firebase/rules-unit-testing` and Vitest. During migration, these tests protect retained identity/profile and legacy client-read paths. Postgres-backed school-domain routes must be protected by backend authorization tests instead of Firestore rules.

## 11. Compliance references

This spec is not legal advice. Counsel review is required before expanding post-beta school deployments.

Official references used to shape the architecture:

- FTC COPPA guidance and parental consent resources:
  - https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business
  - https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule
  - https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data
- U.S. Department of Education FERPA guidance:
  - https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa
  - https://studentprivacy.ed.gov/faq/are-educational-agencies-and-institutions-required-notify-parents-and-eligible-students-their
  - https://studentprivacy.ed.gov/faq/must-school-or-lea-record-non-consensual-disclosure-personally-identifiable-information-pii
- Illinois BIPA statutory and codified text:
  - https://www.ilga.gov/Documents/Legislation/PublicActs/95/PDF/095-0994.pdf
  - https://www.ilga.gov/documents/legislation/ilcs/documents/074000140k10.htm

## 12. Open technical questions

- Do we store any raw audio by default for general speaking assignments, or only for pronunciation-enabled assignments? (See LIMITATIONS #16 — no raw audio is persisted today.)
- How should the tutor pedagogy layer (shared tutor doctrine + skill packs + optional coach track) be sequenced into the assignment resolver and free-chat builders without regressing instruction adherence on `gpt-realtime-mini`? Design spec: `docs/Pedagogy Research/2026-05-27-tutor-pedagogy-conversation-guidance-design.md`.

Deferred (re-open with the Postgres migration):

- Where should analytics rollups run after migration — Flask, Cloud Functions, Cloud Run jobs, or scheduled SQL jobs?
- Should curriculum package payloads live in Postgres JSONB, Cloud Storage, or a mixed model?

## 13. Teacher Join-Org Flow (Plan 4)

Teachers join an existing org via one of two paths:

1. **Invite code** — admin-generated 6-char org-wide code (existing
   `teacher_invite_code` on the org doc).
2. **Search** — teacher types school name; backend prefix-matches on
   `organizations.name_lower`.

Both paths create a `teacher_join_requests/{id}` document and notify
the org's school admins via the outbox. The auto-approve behavior from
commit 4bbcbe3 is removed; every join goes through an admin review.

**Collection: `teacher_join_requests/{id}`**

| Field | Type | Notes |
|---|---|---|
| `uid` | str | requesting teacher |
| `org_id` | str | target org |
| `source` | `invite_code` \| `search` | submission path |
| `invite_code` | str? | populated when source=invite_code |
| `status` | `pending` \| `approved` \| `declined` \| `cancelled` | |
| `requested_at` | timestamp | |
| `reviewed_at` | timestamp? | stamped only on approved/declined |
| `reviewed_by_uid` | str? | stamped only on approved/declined |
| `decline_reason` | str? | required when status=declined |

**Endpoints** (all on the `teacher_requests` blueprint):

| Method | Path | Caller | Effect |
|---|---|---|---|
| POST | `/api/teacher-join-requests` | teacher | submits request, queues admin email |
| GET | `/api/teacher-join-requests/me` | teacher | latest non-cancelled request (status + decline reason) |
| DELETE | `/api/teacher-join-requests/me` | teacher | cancels pending request, reverts onboarding_state |
| GET | `/api/teacher-join-requests` | school_admin | pending list for own org |
| POST | `/api/teacher-join-requests/<id>/approve` | school_admin | creates membership + sends teacher email |
| POST | `/api/teacher-join-requests/<id>/decline` | school_admin | sets status=declined, sends teacher email |
| GET | `/api/organizations/search?q=<q>` | signed-in user | metadata-only prefix search, rate-limited |

**`organizations.school_admin_uids` denormalization**

The teacher_join_requests Firestore rule needs to authorize school_admin
reads without running a query (Firestore rules cannot query). To support
this, every organization carries a `school_admin_uids: string[]` array
that is maintained as a side-effect of `database.create_membership` when
a school_admin role is granted on an active membership. The rule
`get(...).data.school_admin_uids.hasAny([request.auth.uid])` consults
this array.

**Future obligation:** any membership-removal path (revoke, role-downgrade,
org-suspend cascade) MUST call `_sync_org_admin_uids(org_id, uid, add=False)`.
Without this, the array drifts and the rule keeps granting read access
to former admins. Plan 5 must extend `test_school_admin_uids_invariant.py`
to cover the removal path.

**Outbox templates added:**
- `teacher_join_request_to_admin` (on submit → org admins)
- `teacher_join_approved` (on approve → teacher)
- `teacher_join_declined` (on decline → teacher)
- ~~Which LMS gets the first real integration path: Google Classroom or Canvas?~~ **Resolved: Canvas LMS first. Implemented with PAT-based auth, per-class connections stored in `canvas_connections` (encrypted PAT via AES-256-GCM), roster visibility via `canvas_roster_entries/` (Canvas-truth view only; does not create enrollments — see the 2026-04-21 roster-decouple invariant in §4.1), and `canvas_course_content` for student module view. See `backend/services/canvas/` and `backend/routes/integrations.py`. Enrollments are created only by join code (student action) or LTI launch (consent-by-click), never by PAT sync.**

## 14. Legacy User Migration (Plan 6)

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
| Auth | Authenticated user (`@deps.login_required`) |
| Body | `{ role: 'student' \| 'teacher' \| 'admin' }` |
| Response | `{ intendedRole, onboardingState }` (camelCase) |
| Idempotent | Yes — re-call with same/different role on a migrated user is a no-op 200 |
| Defense-in-depth | Server re-verifies `is_legacy_user_needing_role_pick(...)`; writes only when true |
