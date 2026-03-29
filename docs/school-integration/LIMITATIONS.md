# School Integration Limitations

Status: Active
Last updated: 2026-03-13
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
Impact: teachers can generate/regenerate/deactivate join codes, students can join via `/app/join`, and teachers can view the roster and remove students. Canvas LMS roster sync is now available — matched students get active enrollments, unmatched students get `pending_sync` enrollments that auto-activate on login. However, CSV import, bulk invite, and email-based invitations are not yet implemented.
Planned follow-up: CSV roster import, email-based invitations, and Google Classroom integration.

3. Teacher analytics are available at class, assignment, and student level with basic filtering, but are still heuristic-based.
Impact: teachers can now navigate from the dashboard to class analytics (aggregated across assignments), student drill-down (per-student across assignments), and per-assignment analytics. The dashboard now supports a class filter that recalculates summary stats for a single class, and the class analytics page supports date range filtering (server-side session filtering) and assignment status filtering (client-side). However, all metrics (speaking time, rubric scores, error detection) are still heuristic estimates from transcript-level signals, not model-verified or provider-accurate. The dashboard-level speaking minutes stat now aggregates estimated speaking time from practice sessions across the teacher's classes.
Planned follow-up: cross-class trends, richer visualization, and model-backed scoring calibration.

### Curriculum mapping and assignments

4. Curriculum mapping currently supports only the bundled sample curriculum package.
Impact: the runtime now uses the canonical AP French sample JSON as its bundled package source, but teachers still cannot create mappings against organization-owned or imported packages.
Planned follow-up: package ownership rules and school-aware package lookup.

5. Assignment launch now supports assignment-scoped text fallback, but the text experience still lives in the assignment launch page instead of the shared chat shell.
Impact: `text_only` or downgraded launches now work and remain assignment-aware, but text transcripts and follow-up review still do not reuse the main chat workspace UX or a richer text-specific teacher review surface.
Planned follow-up: unify assignment text practice with the shared chat shell and extend text-mode review affordances.

6. Live prompt generation now uses a modular pedagogy package, but it is still a pre-session prompt layer rather than a live intervention engine.
Impact: `targetExpressions`, `focusGrammar`, `feedbackPolicy`, `scaffoldPolicy`, teacher-configurable `outputPolicy`, teacher notes, rubric/task/evidence metadata, curriculum pedagogy tags, teacher-approved context bounds, and rubric-focus cues now shape the prompt through `backend/services/pedagogy/`. Task templates now resolve against structured curriculum package definitions instead of ID heuristics, so the bundled sample package can define opening moves, sustain moves, closing moves, completion rules, assistant role, and prompt cues explicitly. However, `allowedContextTags` and `rubricFocus` still are not hard runtime constraints, and no mid-session server-side pedagogy orchestrator updates the realtime session once it starts.
Planned follow-up: stricter prompt-policy enforcement, broader support for imported package template definitions, and a later event-driven intervention layer if beta evidence shows it is needed.

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
Impact: PAT-based auth (one connection per class), manual re-sync only (no webhooks), email-first identity matching with pending_sync for unmatched students. Canvas connections store encrypted PATs server-side (AES-256-GCM). Students see synced course content via `canvas_course_content` collection on AppLearningPage with "Start Practice" for linked items. Teachers can link/unlink assignments to Canvas items in the assignment builder. Firebase emulator rule tests require Java runtime which may not be available in all environments.
Planned follow-up: OAuth2 flow for Canvas auth, automatic webhook-based sync, SIS ID fallback matching, and sync cooldown enforcement.

11. Disclosure logging covers two endpoints (teacher student analytics drill-down, admin compliance roster) but not all sensitive read paths.
Impact: the admin roster view logs a single org-scoped event (`student_uid=''`) rather than per-student events to avoid N+1 writes. Other endpoints that surface student data (e.g., class analytics, student drill-down compliance tab, guardian packet views) do not yet emit disclosure events.
Planned follow-up: extend disclosure logging to remaining sensitive endpoints as the audit requirements are clarified with counsel.
