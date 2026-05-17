# School Integration Limitations

Status: Active
Last updated: 2026-04-19
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

## Current limitations

### School foundation

1. Teacher onboarding currently bootstraps one organization, one teacher-admin membership, and one first class in a single flow.
Impact: fast for pilot setup, but not yet suitable for real multi-teacher org administration.
Planned follow-up: org settings, invite flows, and role management.

2. Student invite/join flow supports class join codes and Canvas LMS roster sync, but advanced roster workflows are not yet complete.
Impact: teachers can generate/regenerate/deactivate join codes, students can join via `/app/join`, and teachers can view the roster and remove students. Canvas LMS roster sync populates a separate `canvas_roster_entries/` collection (not enrollments); students must enter the class code to actually enroll. Teachers see an "on Canvas roster" badge next to enrolled students plus a "not yet joined" gap view. However, CSV import, bulk invite, and email-based invitations are not yet implemented.
Planned follow-up: CSV roster import, email-based invitations, and Google Classroom integration.

3. Teacher analytics are available at class, assignment, and student level with basic filtering, but are still heuristic-based.
Impact: teachers can now navigate from the dashboard to class analytics (aggregated across assignments), student drill-down (per-student across assignments), and per-assignment analytics. The dashboard now supports a class filter that recalculates summary stats for a single class, and the class analytics page supports date range filtering (server-side session filtering) and assignment status filtering (client-side). However, all metrics (speaking time, rubric scores, error detection) are still heuristic estimates from transcript-level signals, not model-verified or provider-accurate. The dashboard-level speaking minutes stat now aggregates estimated speaking time from practice sessions across the teacher's classes.
Planned follow-up: cross-class trends, richer visualization, and model-backed scoring calibration.

### Curriculum mapping and assignments

4. Imported curriculum packages are not part of the shipped beta path.
Impact: the legacy bundled sample package and `curriculum_mappings` path have been removed. Teachers now author assignments from Canvas content, teacher-provided source packets, or manual advanced authoring. There is no package browser or imported-package workflow in the beta UI.
Planned follow-up: revisit imported curriculum packages only if pilot schools need a non-Canvas managed content library.

5. Assignment launch now supports assignment-scoped text fallback, but the text experience still lives in the assignment launch page instead of the shared chat shell.
Impact: `text_only` or downgraded launches now work and remain assignment-aware, but text transcripts and follow-up review still do not reuse the main chat workspace UX or a richer text-specific teacher review surface.
Planned follow-up: unify assignment text practice with the shared chat shell and extend text-mode review affordances.

6. Live prompt generation is assignment-driven, but it is still a pre-session prompt layer rather than a live intervention engine.
Impact: `instructions`, `generatedScenario`, `objectives`, `targetExpressions`, `focusGrammar`, teacher notes, task type, success criteria, and compliance/modality metadata now shape the tutor prompt directly from the assignment document. This removes the old sample-curriculum and pedagogy-package path, but there is still no mid-session server-side intervention layer once a realtime session starts.
Planned follow-up: stricter prompt-policy enforcement, stronger source-to-assignment traceability, and a later event-driven intervention layer if beta evidence shows it is needed.

14. Scaffold-free assignments (`task_type: custom_prompt`) intentionally bypass all analytics that depend on target expressions, focus grammar, or rubric dimensions.
Impact: when a teacher chooses the "Scaffold-free prompt" entry mode in the assignment builder, the assignment stores an empty `generatedScenario`, empty `targetExpressions`, empty `focusGrammar`, empty `objectives`, and the teacher's raw `instructions` are used as the AI tutor's system prompt with only the `target_language_intensity` policy appended as a final section. An optional `studentInstructions` field can be filled by the teacher and is rendered on the student launch page in place of the Practice scope and Teacher-designed practice overlay cards. The per-assignment analytics page shows a "Scaffold-free assignment" notice and hides the Evidence targets, Objective alignment, and Rubric view cards. Recent-attempts session data (turn counts, speaking time, self-corrections) still aggregates normally. The scenario-generation LLM call is skipped for these assignments.
Planned follow-up: revisit whether lightweight optional success criteria should be offered in this mode for teachers who want partial scaffolding back.

7. Practice analytics are improved, but still not equivalent to human scoring.
Impact: assignment launch now creates `practice_sessions`, emits lifecycle and turn-level `learning_events`, and rolls them into per-session summaries plus a teacher-facing assignment analytics page. The runtime now also tracks repeated-error patterns, feedback-linked correction families, actual context-tag signals, rubric-dimension evidence, rubric thresholds/confidence, and locale-aware communicative-function / discourse-move / feedback detection for English and French. However, these detections and rubric scores are still rule-based heuristics rather than model-verified semantics or certified assessment scoring.
Planned follow-up: richer realtime instrumentation, rubric-scoring calibration against teacher review, repeated-error families beyond the current rule catalog, and stronger semantic analysis.

8. Speaking time and cost are currently estimated, not provider-accurate.
Impact: session summaries derive speaking time from transcript word counts and track estimated voice seconds / text turns, but they do not yet use raw audio durations or provider billing metadata for precise cost accounting.
Planned follow-up: realtime usage metering, model-cost accounting, and budget enforcement.

### Compliance and policy

9. Compliance gating, guardian packets, deletion requests, and school-wide admin tooling are now implemented for the beta scope.
Impact: voice now fails closed without consent, `textFallbackEnabled` controls assignment downgrade behavior, pronunciation raw-audio retention is policy-aware, teachers/admins can edit consent state from student drill-down, class-scoped compliance roster/bulk operations/audit export are available, guardian packets can now be issued/resend/canceled from student drill-down with a secure-link public decision flow, school admins can create/approve/execute/retry deletion requests for student, class, or org scope, and school admins now have an org-wide compliance dashboard with summary metrics, filterable cross-class student roster with bulk consent operations, guardian packet tracking, and org-scoped audit CSV export. However, `downloadable_notice` remains a staff-managed beta path without a rendered handout artifact, deletion execution is synchronous (not async Cloud Tasks), and Firebase Storage audio deletion is a placeholder (no raw audio stored yet).
Planned follow-up: async deletion execution if needed post-beta, Firebase Storage cleanup when raw audio storage ships, and richer guardian evidence/export tooling.

10. Firestore rules are now school-aware and validated via Firebase Emulator rule tests (`firebase-tests/`). Deployment rehearsal is still pending before pilot hardening is complete.
Impact: rule logic is validated against emulator tests covering all school collections and role-based access patterns.
Planned follow-up: deployment verification during hardening.

### Canvas LMS integration

12. Canvas LMS integration is implemented for beta scope with the following constraints:
Impact: PAT-based auth (one connection per class), manual re-sync only (no webhooks), roster sync writes to `canvas_roster_entries/` only — never to `enrollments/` (see 2026-04-21 update below). Canvas connections store encrypted PATs server-side (AES-256-GCM). Students see synced course content via `canvas_course_content` collection on AppLearningPage with "Start Practice" for linked items. Teachers can link/unlink assignments to Canvas items in the assignment builder. Firebase emulator rule tests require Java runtime which may not be available in all environments.
Planned follow-up: OAuth2 flow for Canvas auth, automatic webhook-based sync, SIS ID fallback matching, and sync cooldown enforcement.

**2026-04-21 update:** passive email-match auto-enroll is removed. Canvas
PAT sync now writes only to `canvas_roster_entries/`; enrollments come
exclusively from join code or LTI. Existing Canvas-sourced active
enrollments were grandfathered with `join_source='canvas_legacy'`. The
`pending_sync`-on-login activation in `auth.py` has been deleted along
with the two database helpers that served it. A new teacher endpoint
`GET /api/teacher/classes/<class_id>/canvas-roster-gap` returns Canvas-
rostered students who have not yet joined via code. See
`docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`
and `docs/superpowers/plans/2026-04-21-canvas-roster-decouple-from-enrollment.md`.

11. Disclosure logging covers two endpoints (teacher student analytics drill-down, admin compliance roster) but not all sensitive read paths.
Impact: the admin roster view logs a single org-scoped event (`student_uid=''`) rather than per-student events to avoid N+1 writes. Other endpoints that surface student data (e.g., class analytics, student drill-down compliance tab, guardian packet views) do not yet emit disclosure events.
Planned follow-up: extend disclosure logging to remaining sensitive endpoints as the audit requirements are clarified with counsel.

### Teacher debrief of student practice sessions

13. Teachers cannot yet view the actual content of student practice sessions — only aggregate statistics.
Impact: the class analytics, student drill-down, and assignment analytics pages all return aggregated `session_summary` counts (turn counts, speaking time, self-corrections, feedback counts, rubric scores) but there is **no teacher endpoint** to read the conversation transcript itself. Practice sessions store a `chatId` reference to the chat transcript, but `backend/routes/chat.py` is student-only (`deps.get_current_user_uid()` scoped). A teacher who wants to see what their student actually said to the AI tutor has no way to do so from the dashboard.
Planned follow-up: (a) add `GET /api/teacher/classes/<class_id>/students/<student_uid>/sessions/<session_id>/transcript` endpoint that verifies teacher class access and returns chat messages; (b) add transcript viewing UI to `TeacherStudentDrillDownPage`; (c) add AI-generated narrative summary service (`backend/services/session_summary_generator.py`) that calls GPT-4 on the learning events to produce a teacher-readable debrief; (d) show summary alongside the heuristic `session_summary` aggregates.

15. Student dashboard class list uses N+1 Firestore reads.
Impact: `database.list_student_classes` (called by `GET /api/student/classes`) iterates student enrollments and fetches each class document in a loop. For a student in N classes that is 1 (`list_student_enrollments`) + N (`get_class`) Firestore reads per dashboard load. This is fine for the pilot (students are typically in ≤3 classes), but it scales linearly with enrollments.
Planned follow-up: batch class lookups via `get_all` / `in` queries once students routinely exceed ~5 enrollments.

14. Voice conversation recording and audio playback are not yet implemented or tested end-to-end.
Impact: the OpenAI Realtime API streams audio chunks during voice conversations but the current pipeline only captures transcribed text from `student.turn` events — raw audio bytes are never persisted. There is no `audio_url` or recording reference on practice sessions, and no Firebase Storage bucket wired up for speech recordings. End-to-end voice testing (teacher assigns voice assignment → student speaks → teacher plays back the recording) has not been executed because the recording infrastructure does not exist yet. Testing to date has only covered chat-mode (text-only) assignments.
Planned follow-up: (a) decide recording architecture (client-side MediaRecorder + Firebase Storage upload vs. server-side stream capture vs. third-party transcription archive); (b) add `audio_url` / `recording_ref` field to practice sessions; (c) wire consent-aware retention policy (already modeled in `student_compliance_records.retention_policy_id` — `no_raw_audio` vs. `standard_school`); (d) add audio player UI to teacher transcript view; (e) run full voice-mode E2E test (teacher assigns voice → student speaks → teacher plays recording + views transcript + reads AI debrief).

### Curriculum content authored only for French; other locales get French scenarios in translation

16. Resolved 2026-04-18 via Commit C of the Canvas content migration.
Impact: the French-only sample curriculum path is gone. Assignment content now comes from Canvas material or teacher-authored input, so non-French classes are no longer forced through translated AP French scenarios just to launch practice.
Resolution: Phase 2+3 Canvas migration removed `curriculum_mappings`, deleted the sample curriculum package loader, stored scenario fields directly on `assignments`, and removed the legacy curriculum override from realtime session creation.

### Pilot shortcut: teacher invitations auto-approve

17. Teacher invitations are auto-approved during the pilot — the `school_admin` review step is bypassed.
Impact: any teacher who enters a valid `teacher_invite_code` in `POST /api/schools/join-as-teacher` is immediately granted a `teacher` membership without `school_admin` approval. The `teacher_invitations` document is still created for audit trail (marked `status: "approved"` with `reviewed_by_uid: "system:pilot_auto_approve"`), and the `/api/schools/teacher-invitations/<id>/approve` admin endpoint still exists but now returns `409 "Invitation is already approved."` when called against an auto-approved invite. This was introduced to unblock the SSFS Pilot launch where no `school_admin` was available at the time teachers joined.
Planned follow-up: (a) restore the manual-approval flow by reverting the `api_join_as_teacher` change in `backend/routes/schools.py` once the pilot is over, or (b) gate the auto-approval behind a per-org `auto_approve_teacher_joins` boolean on the organization document for long-term use in trust-first deployments (e.g., self-serve school signups where the same person is both admin and teacher).

### AI tutor proficiency signal

18. Lingual has no per-class or per-student proficiency band; the only ACTFL-aware signals at session time are a per-assignment teacher knob and a static fallback for unassessed free-practice users.
Impact: the `assignments` collection now carries `target_language_intensity` (`target_only` / `mostly_target` / `bilingual_scaffold`, default `mostly_target`), set by the teacher in the assignment builder, which the resolver renders as a `## Language Mix` section in the system prompt. This is the only assignment-level proficiency signal — there is no `actfl_band` or `proficiency_level` on the `classes` collection, no per-student proficiency override on enrollments, and no inference from Canvas course metadata. Free-practice (`build_system_prompt`) users without a completed assessment now default to ACTFL Intermediate Mid/High (instead of "beginner") so unassessed returning learners and AP-track students don't get over-scaffolded English; assessed users still drive their own ladder via `get_user_proficiency_context`.
Planned follow-up: add a `proficiency_band` field to the `classes` collection so teachers can set a class-wide default once at class creation, then have the assignment builder default `target_language_intensity` from that class field rather than always landing on `mostly_target`.

19. Live2D avatar is intentionally disabled for the pilot runtime.
Impact: student-facing pilot conversation surfaces now force avatar off even if a user previously enabled it in local storage, and realtime avatar directives are hard-disabled unless the explicit pilot avatar flag is turned back on. The avatar code, routes, and assets remain in the repo for post-pilot reactivation, but they are dormant in the pilot runtime.
Planned follow-up: re-enable behind explicit frontend/backend pilot flags only if pilot evidence shows the avatar materially improves engagement or outcomes.

### Canvas roster confirmation signal

20. Canvas roster confirmation signal uses email equality only.
Impact: the teacher-side "On Canvas roster" badge matches by exact
lowercased email equality between the Lingual account email and the
`canvas_roster_entries.canvas_email` value. Students whose Lingual
account email differs from their Canvas roster email (different
provider, personal vs. school) will not get a matched badge even when
they are on the Canvas roster by name. Teachers can visually confirm
via the student's display name. The "not yet joined" gap view on the
teacher roster is similarly email-keyed, so such students will also
not fall out of the gap list automatically once they join.
Planned follow-up: add a teacher-side manual "link to Canvas roster
entry" action, and/or a second-tier match via `canvas_user_id` derived
from LTI session history.

21. Outbox email scope (v1) — 2026-05-18

The Firestore `outbox_emails/` collection and the `send_outbox_email` Cloud
Function are live, but only one template is wired end-to-end:
`school_request_to_lingual`. Other templates listed in the onboarding spec
(teacher join notifications, approval/decline emails, suspend/restore, reminders)
exist as enum values but have no rendering or business-side enqueue yet.

They are added in subsequent onboarding plans (Plans 3–6). Until then, the
relevant business actions complete normally but do not produce email.

**Sweep gap to watch:** `retry_outbox_sweep` in `functions/main.py` only re-promotes `status='failed'` documents back to `pending`. It does NOT yet pick up `pending` documents whose `scheduled_for` is in the past (intended for reminder emails). With v1 templates all being immediate (`scheduled_for = SERVER_TIMESTAMP`), the Firestore `on_document_written` trigger handles every email synchronously — this gap is latent. Before Plan 3+ wires any reminder template (e.g., `school_request_reminder_to_lingual`, `join_request_reminder_to_admin`), extend `_retry_outbox_sweep_impl` to also query `('status', '==', 'pending') AND ('scheduled_for', '<=', now)` and re-touch those docs to fire the trigger. The composite index `(status, scheduled_for)` added in `firestore.indexes.json` already supports that query.
