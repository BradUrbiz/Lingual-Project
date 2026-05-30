# School Integration Limitations

Status: Active
Last updated: 2026-05-30
Owner: Engineering

## Purpose

This document tracks currently known implementation limitations, temporary constraints, and intentional shortcuts in the school-integration build.

Use it when:

- a shipped implementation is narrower than the target architecture in `TECH_SPEC.md`
- a route, model, or UI exists but is still sample-only or placeholder-backed
- a later phase depends on hardening or replacing the current behavior

This is not the product source of truth. Product and architecture decisions still live in:

- `PRD.md`
- `TECH_SPEC.md`
- `TASKS.md`

Resolved items are removed from this file; git history is the archive.

## Postgres migration

0. School-domain state is still Firestore-backed even though the accepted post-beta target is Postgres.
Impact: the runtime still uses Firestore collections for organizations, memberships, classes, enrollments, assignments, Canvas/LTI records, compliance, practice sessions, learning events, and analytics inputs. The architecture direction and a schema-reviewed blueprint are documented in `TECH_SPEC.md`, `ADR-0001-post-beta-postgres-system-of-record.md`, and `POSTGRES_SCHEMA.md`, but no Postgres repository layer, migration scripts, or backfill/parity tooling exists yet.
Schema review status (2026-05-30): `POSTGRES_SCHEMA.md` has been reviewed field-by-field against the live Firestore writers. Known gaps the backfill must handle are now captured in that doc ("Backfill Normalization And ID Resolution") and in `TASKS.md` — notably string-ID → UUID resolution across the coexistence window, retired enum values (`pending_sync`, `join_source='canvas'`, `target_language_intensity` legacy values), field renames (`*_uid` → `*_firebase_uid`, `lingual_assignment_id` → `linked_assignment_id`), the derived (not stored) `organizations.school_admin_uids`, and `analytics_rollups` being net-new rather than a migration target.
Planned follow-up: implement the Postgres migration track in `TASKS.md`: land the pre-migration fixes, provision Cloud SQL, add SQLAlchemy/Alembic, backfill Firestore school-domain data in parent-first order, dual-write only where needed (with compensation), cut route families to Postgres behind read flags, then retire Firestore school-domain writes.

## School foundation

1. Teacher onboarding currently bootstraps one organization, one teacher-admin membership, and one first class in a single flow.
Impact: fast for pilot setup, but not yet suitable for real multi-teacher org administration.
Planned follow-up: org settings, invite flows, and role management.

2. Student invite/join flow supports class join codes and Canvas LMS roster sync, but advanced roster workflows are not yet complete.
Impact: teachers can generate/regenerate/deactivate join codes, students can join via `/app/join`, and teachers can view the roster and remove students. Canvas LMS roster sync populates a separate `canvas_roster_entries/` collection (not enrollments); students must enter the class code to actually enroll. Teachers see an "on Canvas roster" badge next to enrolled students plus a "not yet joined" gap view. However, CSV import, bulk invite, and email-based invitations are not yet implemented.
Planned follow-up: CSV roster import, email-based invitations, and Google Classroom integration.

3. Teacher analytics are available at class, assignment, and student level with basic filtering, but are still heuristic-based.
Impact: teachers can navigate from the dashboard to class analytics (aggregated across assignments), student drill-down (per-student across assignments), and per-assignment analytics. The dashboard supports a class filter that recalculates summary stats for a single class, and the class analytics page supports date range filtering (server-side session filtering) and assignment status filtering (client-side). However, all metrics (speaking time, rubric scores, error detection) are still heuristic estimates from transcript-level signals, not model-verified or provider-accurate. The dashboard-level speaking minutes stat aggregates estimated speaking time from practice sessions across the teacher's classes.
Planned follow-up: cross-class trends, richer visualization, and model-backed scoring calibration.

## Curriculum and assignments

4. Imported curriculum packages are not part of the shipped beta path.
Impact: the legacy bundled sample package and `curriculum_mappings` path have been removed. Teachers now author assignments from Canvas content, teacher-provided source packets, or manual advanced authoring. There is no package browser or imported-package workflow in the beta UI.
Planned follow-up: revisit imported curriculum packages only if pilot schools need a non-Canvas managed content library.

5. Assignment launch supports assignment-scoped text fallback, but the text experience still lives in the assignment launch page instead of the shared chat shell.
Impact: `text_only` or downgraded launches work and remain assignment-aware, but text transcripts and follow-up review do not reuse the main chat workspace UX or a richer text-specific teacher review surface.
Planned follow-up: unify assignment text practice with the shared chat shell and extend text-mode review affordances.

6. Live prompt generation is assignment-driven, but it is still a pre-session prompt layer rather than a live intervention engine.
Impact: `instructions`, `generatedScenario`, `objectives`, `targetExpressions`, `focusGrammar`, teacher notes, task type, success criteria, and compliance/modality metadata shape the tutor prompt directly from the assignment document. There is still no mid-session server-side intervention layer once a realtime session starts.
Planned follow-up: stricter prompt-policy enforcement, stronger source-to-assignment traceability, and a later event-driven intervention layer if beta evidence shows it is needed. The May 2026 tutor pedagogy design (`docs/Pedagogy Research/2026-05-27-tutor-pedagogy-conversation-guidance-design.md`) is the active proposal for closing this gap.

7. Scaffold-free assignments (`task_type: custom_prompt`) intentionally bypass all analytics that depend on target expressions, focus grammar, or rubric dimensions.
Impact: when a teacher chooses the "Scaffold-free prompt" entry mode, the assignment stores empty `generatedScenario`, `targetExpressions`, `focusGrammar`, and `objectives`. The teacher's raw `instructions` are used as the AI tutor's system prompt with only `target_language_intensity` appended. An optional `studentInstructions` field is rendered on the student launch page in place of the Practice scope and Teacher-designed practice overlay cards. The per-assignment analytics page shows a "Scaffold-free assignment" notice and hides the Evidence targets, Objective alignment, and Rubric view cards. Recent-attempts session data (turn counts, speaking time, self-corrections) still aggregates normally. Scenario generation is skipped for these assignments.
Planned follow-up: revisit whether lightweight optional success criteria should be offered in this mode for teachers who want partial scaffolding back.

8. Practice analytics are improved, but still not equivalent to human scoring.
Impact: assignment launch creates `practice_sessions`, emits lifecycle and turn-level `learning_events`, and rolls them into per-session summaries plus a teacher-facing assignment analytics page. The runtime tracks repeated-error patterns, feedback-linked correction families, context-tag signals, rubric-dimension evidence, rubric thresholds/confidence, and locale-aware communicative-function / discourse-move / feedback detection for English and French. These detections and rubric scores are still rule-based heuristics rather than model-verified semantics or certified assessment scoring.
Planned follow-up: richer realtime instrumentation, rubric-scoring calibration against teacher review, repeated-error families beyond the current rule catalog, and stronger semantic analysis.

9. Speaking time and cost are estimated, not provider-accurate.
Impact: session summaries derive speaking time from transcript word counts and track estimated voice seconds / text turns, but do not yet use raw audio durations or provider billing metadata for precise cost accounting.
Planned follow-up: realtime usage metering, model-cost accounting, and budget enforcement.

## Compliance and policy

10. Compliance gating, guardian packets, deletion requests, and school-wide admin tooling are implemented for the beta scope.
Impact: voice fails closed without consent, `textFallbackEnabled` controls assignment downgrade behavior, pronunciation raw-audio retention is policy-aware, teachers/admins can edit consent state from student drill-down, class-scoped compliance roster/bulk operations/audit export are available, guardian packets can be issued/resend/canceled from student drill-down with a secure-link public decision flow, school admins can create/approve/execute/retry deletion requests for student/class/org scope, and school admins have an org-wide compliance dashboard with summary metrics, filterable cross-class student roster with bulk consent operations, guardian packet tracking, and org-scoped audit CSV export. However, `downloadable_notice` remains a staff-managed beta path without a rendered handout artifact, deletion execution is synchronous (not async Cloud Tasks), and Firebase Storage audio deletion is a placeholder (no raw audio stored yet).
Planned follow-up: async deletion execution if needed post-beta, Firebase Storage cleanup when raw audio storage ships, and richer guardian evidence/export tooling.

11. Firestore rules are school-aware and validated via Firebase Emulator rule tests (`firebase-tests/`). Deployment rehearsal is still pending before pilot hardening is complete.
Impact: rule logic is validated against emulator tests covering all school collections and role-based access patterns.
Planned follow-up: deployment verification during hardening.

12. Disclosure logging covers two endpoints (teacher student analytics drill-down, admin compliance roster) but not all sensitive read paths.
Impact: the admin roster view logs a single org-scoped event (`student_uid=''`) rather than per-student events to avoid N+1 writes. Other endpoints that surface student data (e.g., class analytics, student drill-down compliance tab, guardian packet views) do not yet emit disclosure events.
Planned follow-up: extend disclosure logging to remaining sensitive endpoints as the audit requirements are clarified with counsel.

## Canvas LMS integration

13. Canvas LMS integration is implemented for beta scope with the following constraints:
Impact: PAT-based auth (one connection per class), manual re-sync only (no webhooks), roster sync writes to `canvas_roster_entries/` only — never to `enrollments/`. Canvas connections store encrypted PATs server-side (AES-256-GCM). Students see synced course content via `canvas_course_content` collection on AppLearningPage with "Start Practice" for linked items. Teachers can link/unlink assignments to Canvas items in the assignment builder. Firebase emulator rule tests require Java runtime which may not be available in all environments.
Planned follow-up: OAuth2 flow for Canvas auth, automatic webhook-based sync, SIS ID fallback matching, and sync cooldown enforcement.

**2026-04-21 update:** passive email-match auto-enroll is removed. Canvas PAT sync writes only to `canvas_roster_entries/`; enrollments come exclusively from join code or LTI. Existing Canvas-sourced active enrollments were grandfathered with `join_source='canvas_legacy'`. The `pending_sync`-on-login activation in `auth.py` was deleted along with the two database helpers that served it. The teacher endpoint `GET /api/teacher/classes/<class_id>/canvas-roster-gap` returns Canvas-rostered students who have not yet joined via code. See `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md` and `docs/superpowers/plans/2026-04-21-canvas-roster-decouple-from-enrollment.md`.

14. Canvas roster confirmation signal uses email equality only.
Impact: the teacher-side "On Canvas roster" badge matches by exact lowercased email equality between the Lingual account email and the `canvas_roster_entries.canvas_email` value. Students whose Lingual account email differs from their Canvas roster email (different provider, personal vs. school) will not get a matched badge even when they are on the Canvas roster by name. Teachers can visually confirm via the student's display name. The "not yet joined" gap view on the teacher roster is similarly email-keyed, so such students will also not fall out of the gap list automatically once they join.
Planned follow-up: add a teacher-side manual "link to Canvas roster entry" action, and/or a second-tier match via `canvas_user_id` derived from LTI session history.

## Teacher debrief of student practice sessions

15. Teachers cannot yet view the actual content of student practice sessions — only aggregate statistics.
Impact: the class analytics, student drill-down, and assignment analytics pages all return aggregated `session_summary` counts (turn counts, speaking time, self-corrections, feedback counts, rubric scores) but there is **no teacher endpoint** to read the conversation transcript itself. Practice sessions store a `chatId` reference to the chat transcript, but `backend/routes/chat.py` is student-only (`deps.get_current_user_uid()` scoped). A teacher who wants to see what their student actually said to the AI tutor has no way to do so from the dashboard.
Planned follow-up: (a) add `GET /api/teacher/classes/<class_id>/students/<student_uid>/sessions/<session_id>/transcript` endpoint that verifies teacher class access and returns chat messages; (b) add transcript viewing UI to `TeacherStudentDrillDownPage`; (c) add AI-generated narrative summary service (`backend/services/session_summary_generator.py`) that calls GPT-4 on the learning events to produce a teacher-readable debrief; (d) show summary alongside the heuristic `session_summary` aggregates.

16. Voice conversation recording and audio playback are not yet implemented or tested end-to-end.
Impact: the OpenAI Realtime API streams audio chunks during voice conversations but the current pipeline only captures transcribed text from `student.turn` events — raw audio bytes are never persisted. There is no `audio_url` or recording reference on practice sessions, and no Firebase Storage bucket wired up for speech recordings. End-to-end voice testing (teacher assigns voice assignment → student speaks → teacher plays back the recording) has not been executed because the recording infrastructure does not exist yet. Testing to date has only covered chat-mode (text-only) assignments.
Planned follow-up: (a) decide recording architecture (client-side MediaRecorder + Firebase Storage upload vs. server-side stream capture vs. third-party transcription archive); (b) add `audio_url` / `recording_ref` field to practice sessions; (c) wire consent-aware retention policy (already modeled in `student_compliance_records.retention_policy_id` — `no_raw_audio` vs. `standard_school`); (d) add audio player UI to teacher transcript view; (e) run full voice-mode E2E test.

17. Student dashboard class list uses N+1 Firestore reads.
Impact: `database.list_student_classes` (called by `GET /api/student/classes`) iterates student enrollments and fetches each class document in a loop. For a student in N classes that is 1 (`list_student_enrollments`) + N (`get_class`) Firestore reads per dashboard load. This is fine for the pilot (students are typically in ≤3 classes), but it scales linearly with enrollments.
Planned follow-up: batch class lookups via `get_all` / `in` queries once students routinely exceed ~5 enrollments.

## AI tutor runtime configuration

18. Lingual has no per-class or per-student proficiency band; the only ACTFL-aware signals at session time are a per-assignment teacher knob and a static fallback for unassessed free-practice users.
Impact: the `assignments` collection carries `target_language_intensity` (`target_only` / `mostly_target` / `bilingual_scaffold`, default `mostly_target`), set by the teacher in the assignment builder, which the resolver renders as a `## Language Mix` section in the system prompt. This is the only assignment-level proficiency signal — there is no `actfl_band` or `proficiency_level` on the `classes` collection, no per-student proficiency override on enrollments, and no inference from Canvas course metadata. Free-practice (`build_system_prompt`) users without a completed assessment default to ACTFL Intermediate Mid/High (instead of "beginner") so unassessed returning learners and AP-track students don't get over-scaffolded English; assessed users still drive their own ladder via `get_user_proficiency_context`.
Planned follow-up: add a `proficiency_band` field to the `classes` collection so teachers can set a class-wide default once at class creation, then have the assignment builder default `target_language_intensity` from that class field rather than always landing on `mostly_target`.

19. Live2D avatar is intentionally disabled for the pilot runtime.
Impact: student-facing pilot conversation surfaces force avatar off even if a user previously enabled it in local storage, and realtime avatar directives are hard-disabled unless the explicit pilot avatar flag is turned back on. The avatar code, routes, and assets remain in the repo for post-pilot reactivation, but they are dormant in the pilot runtime.
Planned follow-up: re-enable behind explicit frontend/backend pilot flags only if pilot evidence shows the avatar materially improves engagement or outcomes.

## Outbox email infrastructure

20. Outbox email scope (v1).
The Firestore `outbox_emails/` collection and the `send_outbox_email` Cloud Function are live. Plans 1 + 3 + 4 together wire seven templates end-to-end: `school_request_to_lingual`, `school_request_approved`, `school_request_declined`, `teacher_invitation`, `teacher_join_request_to_admin`, `teacher_join_approved`, `teacher_join_declined`. Plan 5 adds `org_suspended` + `org_restored`. Other templates listed in the onboarding spec (7-day reminders) still have no rendering or business-side enqueue.

**Sweep gap to watch:** `retry_outbox_sweep` in `functions/main.py` only re-promotes `status='failed'` documents back to `pending`. It does NOT yet pick up `pending` documents whose `scheduled_for` is in the past (intended for reminder emails). With current v1 templates all being immediate (`scheduled_for = SERVER_TIMESTAMP`), the Firestore `on_document_written` trigger handles every email synchronously — this gap is latent. Before wiring any reminder template (e.g., `school_request_reminder_to_lingual`, `join_request_reminder_to_admin`), extend `_retry_outbox_sweep_impl` to also query `('status', '==', 'pending') AND ('scheduled_for', '<=', now)` and re-touch those docs to fire the trigger. The composite index `(status, scheduled_for)` added in `firestore.indexes.json` already supports that query.

## Admin org wizard (Plan 3)

21. Wizard draft has no TTL. A `school_creation_drafts/{uid}` document lives until the user either submits successfully (route deletes it) or cancels the in-flight request. Stale drafts persist indefinitely.

22. Pre-invite emails are best-effort at approval time. The approve route enqueues one `teacher_invitation` outbox doc per email and one `school_request_approved` doc to the requester. Failures to enqueue are logged but do not block the approval response — the membership, org, and `teacher_invitations/` rows are written first.

23. `school_creation_drafts` rules are not under automated coverage. Task added the owner-only rule but the Firebase emulator test suite (`firebase-tests/`, Java required) was not extended. The rule mirrors the existing `users/{uid}` ownership pattern; a follow-up should add a rules test once a Java-enabled CI runner is available.

24. DB column names diverge from spec naming for decline / reject. Design spec names `decline_reason` / `decline_category` on `school_requests`. The implementation kept the pre-existing column names `rejection_reason` / `rejection_category` to avoid migrating historical rows. API responses use camelCase `rejectionReason` / `rejectionCategory`. User-facing UI copy still says "Declined". Future readers grepping for `decline_reason` will not find it.

25. Admin wizard is English-only. Wizard labels, helper text, and the three email templates (`school_request_approved`, `school_request_declined`, `teacher_invitation`) ship in English only. `LanguageProvider` (en/ko) covers the learner app but is not threaded through the wizard. Acceptable for v1 (admin audience is US schools); revisit when expanding outside the US.

## Backend tests and dev tooling

26. Backend tests can write to production Firestore without isolation. Route handlers (e.g. `submit_school_request`) call `database.get_db()` directly instead of going through a `deps`-injected client, so a test that POSTs to `/api/school-requests` while the prod service account is in scope writes real outbox docs to production. This actually happened during the Plan 3 smoke test: a `make test-backend` run created ~27 outbox docs that the deployed Cloud Function later picked up and sent as real emails to kimmi@l1ngual.com. Mitigated by a runtime guard in `backend/services/outbox.py`: `LINGUAL_BLOCK_OUTBOX_WRITES=1` makes `enqueue_outbox_email` raise `OutboxBlockedInTestMode`, which the route's existing fan-out try/except wrappers catch and log. `backend/tests/conftest.py` sets the env var at import time so every test inherits the protection. Proper long-term fix: route the Firestore client through `RouteDeps` so tests can inject a fake DB at the boundary instead of relying on an env guard. Tracked in TASKS / TECH_SPEC.

27. Local dev shows intermittent browser 500s during long-running POSTs. `main.py` runs Werkzeug's threaded dev server (`app.run`) in development. On Python 3.12, Werkzeug occasionally raises `OSError: [Errno 9] Bad file descriptor` during socket cleanup when a request handler holds the connection open across multiple Firestore round-trips (e.g. the approve route's transaction + side effects + outbox enqueue + final read). The Vite proxy interprets the dropped upstream socket as a 500 and surfaces it to the browser, even though the Flask request usually completes successfully on its own thread and logs 200 in the access log. Production is unaffected because Cloud Run uses `gunicorn --workers 1 --threads 8 --timeout 120 main:app` (see Dockerfile), which handles socket lifecycle correctly. When a local approve / submit shows a 500 in the browser: check the backend access log for the actual status, and verify Firestore + outbox state — the work is almost always already done. Optional follow-up: add a Makefile target to run local dev under gunicorn.

## Teacher join-org (Plan 4)

28. Plan 4 follow-ups. Notable shipped-state constraints on the teacher join-org flow:

    - Search is name-prefix only (`name_lower` index), not full-text. "san fran" matches "San Francisco …" but not "Friends of San Francisco".
    - One pending request per user is enforced — to retry with a different school, the user must cancel first.
    - Multi-org membership is not supported: any active membership in any org blocks a new join request.
    - Rate limiting on `/api/organizations/search` is process-local (10 req/sec/uid). Horizontal scale will require a shared store (Redis / Firestore counter).
    - Status polling on `/signup/teacher/pending` is 30s; not realtime. A realtime listener is a v1.5 follow-up.
    - A stale active invite code on a suspended org returns 404 (not a friendlier 409). Production's `get_org_by_teacher_invite_code` filters `status='active'` at the Firestore query level, so the 409 branch in the route is effectively unreachable in production. v1.5 may split the query into two steps to produce a more informative response.
    - **7-day reminder email to admins** is NOT implemented. Stale pending requests are visible on the admin dashboard but no automatic nudge is sent. Implement via a daily Cloud Function sweep that writes future-dated outbox docs once requests age past 7 days. Product decision needed before launch.
    - **Approval flow is not transactional.** `POST /api/teacher-join-requests/<id>/approve` performs three sequential Firestore writes (create membership, set last-active membership, mark request approved) plus a fail-soft profile update. If a later write fails after an earlier one succeeded, the system is briefly inconsistent (e.g. teacher has a membership but request still shows pending; or two admins approving concurrently produce duplicate memberships). Wrap in a Firestore batch in v1.5.
    - **`PUBLIC_BASE_URL` is feature-gated.** Email CTAs use absolute URLs when set; otherwise relative paths (which break in email clients). The variable is registered in `_validate_required_env` as a feature-gated key (warns in dev, fails fast in production at boot).
    - **Top-level error handling on new endpoints is light.** The new `backend/routes/teacher_requests.py` endpoints do not wrap their main body in `try/except Exception` the way `school_requests.py` does. Firestore transient errors will surface as unformatted HTML 500 rather than shaped JSON. Add the wrapper in a hardening pass.

## Lingual admin panel (Plan 5)

29. In-flight realtime voice sessions are not torn down on suspend. When an org is suspended while a student is mid-conversation, the existing session completes normally. Only new session creation is blocked. Acceptable v1 trade-off (no mid-sentence cutoffs); strict tear-down is v1.5.

30. Suspend auto-restore accuracy is ±1 hour. `auto_restore_suspended_orgs` runs every 60 minutes. An org whose `suspended_until` falls between sweep ticks is restored at the next tick. Acceptable for v1; tighten to 5-minute resolution by reusing the existing outbox sweep cadence if product requires.

31. `PATCH /api/lingual-admin/organizations/<orgId>` is not implemented. Spec lists the endpoint for org metadata editing; Plan 5 keeps it out of scope. Lingual admins use direct Firestore edits when metadata correction is needed. v1.5 follow-up.

32. Lingual admin panel UI is English-only. Wizard labels, table headers, modal copy, audit action labels all ship in English. Match the Plan 3 admin wizard constraint (#25).

33. `org_viewed_detail` audit may produce high write volume. Every org detail page load writes one row. For a Lingual admin paging through 50 orgs in a session, that's 50 writes per day per admin. Acceptable at current scale; consider sampling or rate-limiting if audit traffic exceeds 10k rows/day.

34. `backend/tests/test_lingual_admin_*` tests use the `FakeAuditLogger` pattern; Firestore writes from `AuditLogger` itself have no automated integration coverage. The unit tests on `AuditLogger` exercise the failsoft + payload-shape contract via mocked collection factories, but a true round-trip to Firestore (or the emulator) is not part of CI yet. Acceptable because the write surface is small; revisit if the schema grows. Likewise, the Java-backed emulator rules test for `lingual_admin_audit` was skipped — the deny-all rule is verified by code inspection of `firestore.rules` rather than an automated `firebase-tests/` run.

35. Production Firestore has 1 orphan composite index not managed by `firestore.indexes.json`. `gcloud firestore indexes composite list` reports an extra index on `enrollments` with fields `(status ASC, student_uid ASC, updated_at DESC)` (id `CICAgOjXh4EK`, state `READY`). The matching IaC-managed index — same fields in `(student_uid, status, updated_at)` order — already serves `database.list_student_enrollments(student_uid, status)`. Firestore matches composite indexes to equality-filter queries regardless of which equality field comes first in the index, so the orphan is genuinely redundant. Almost certainly created via the Firebase console "Create index" error link before the IaC entry was added; never appears in any commit of `firestore.indexes.json`. Functional impact: none. Cost impact: one index's storage on a small admin-side collection. Symptom: every `firebase deploy --only firestore:indexes` prints "there are 1 indexes defined in your project that are not present in your firestore indexes file." Cleanup is safe and targeted:
    `gcloud firestore indexes composite delete projects/lingu-480600/databases/\(default\)/collectionGroups/enrollments/indexes/CICAgOjXh4EK`

## Legacy migration (Plan 6)

36. Legacy migration modal is English-only. Spec prescribes exact copy; `LanguageProvider` (en/ko) is not threaded through. Acceptable for v1; revisit when ko learner population becomes a meaningful share.

37. `POST /api/auth/migrate-role` is idempotent for already-migrated users. Calling with `role: 'admin'` on a user whose `intended_role` is already `'student'` returns 200 with the existing state (does NOT overwrite). Defense-in-depth — prevents a user with a devtools console from re-picking their own role after being migrated, even though the modal would not mount.

38. Backfill writes are not transactional across users. The script iterates one user at a time and updates each in a separate Firestore write. A mid-run failure leaves the partially-processed users with `profile.intended_role` set (correct) and the unprocessed users in their legacy state (also correct — the modal handles them). Idempotent on re-run: users with `intended_role` already set are skipped.

39. Backfill has no per-user try/except on writes. A transient Firestore write error for one user will abort the run with no partial stats printed. Operator should re-run the script (it's idempotent on already-migrated users) and watch logs for the failing uid. Acceptable for a one-shot operator-supervised migration; if this script is ever re-purposed for routine maintenance, wrap the update call in try/except and add a `write_errors` counter.

40. Backfill telemetry is stdout-only. Each transition logs one line (`[backfill] uid=… transition=… dry_run=…`). No Firestore audit doc is written. Acceptable because the script is one-shot and operator-run; the log is captured by Cloud Logging when the script runs in GCP.

41. `AppLayout.tsx` retains a `?? LEARNER_HOME_ROUTE` fallback on the home-logo link (`getPrivilegedHomeRoute(user) ?? LEARNER_HOME_ROUTE`). For a legacy user awaiting the modal, `getPrivilegedHomeRoute` now returns null but the fallback still resolves to `/app/learn`. The modal at `z-50` fully covers the AppLayout header at `z-30`, so the home-logo click is blocked in practice. Convert the home link to a no-op or `href="#"` when null after the backfill removes legacy users from the active population.

## Profile data shape

42. Stored `age` is a coarse range midpoint, not actual age. The profile age selectors (`GeneralPage`, `AppSettingsPage`) write the midpoint of a bucket (`frontend/src/lib/ageRanges.ts`) — e.g. a user in "18 – 24" is stored as `21`. Existing users with a real age are silently coarsened to the midpoint the next time they save their profile. Compliance is unaffected: bucket boundaries align with the `age < 18` minor gate in `_derive_is_minor` (`backend/services/compliance.py`), and the gate fails closed when age is unset. But any future logic that assumes precise age (e.g. age-targeted content) must treat the value as a bucket midpoint. `ageRanges.test.ts` guards the minor/adult boundary so a future bucket can't straddle 18.
