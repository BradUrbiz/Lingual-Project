# School Integration Limitations

Status: Active
Last updated: 2026-03-09
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

2. Student invite/join flow is live via class join codes, but advanced roster workflows are not yet available.
Impact: teachers can generate/regenerate/deactivate 6-character join codes, students can join via `/app/join`, and teachers can view the roster and remove students. However, LMS roster sync, CSV import, bulk invite, and email-based invitations are not yet implemented.
Planned follow-up: LMS integration (Google Classroom / Canvas), CSV roster import, and email-based invitations.

3. Teacher analytics are available at class, assignment, and student level, but are still heuristic-based.
Impact: teachers can now navigate from the dashboard to class analytics (aggregated across assignments), student drill-down (per-student across assignments), and per-assignment analytics. However, all metrics (speaking time, rubric scores, error detection) are still heuristic estimates from transcript-level signals, not model-verified or provider-accurate.
Planned follow-up: dashboard date range filters, cross-class trends, richer visualization, and model-backed scoring calibration.

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

9. Compliance gating and guardian packet operations are now implemented for the beta scope, but the operational tooling is still narrower than the target architecture.
Impact: voice now fails closed without consent, `textFallbackEnabled` controls assignment downgrade behavior, pronunciation raw-audio retention is policy-aware, teachers/admins can edit consent state from student drill-down, class-scoped compliance roster/bulk operations/audit export are available, and guardian packets can now be issued/resend/canceled from student drill-down with a secure-link public decision flow. However, `downloadable_notice` remains a staff-managed beta path without a rendered handout artifact or offline evidence capture, and deletion requests/execution plus school-wide admin tooling are still missing.
Planned follow-up: implement Epic B for deletion requests/execution, then expand to broader school-wide admin tooling and richer guardian evidence/export tooling.

10. Firestore rules are now school-aware for the current collections, but they have not yet been validated in a Firebase emulator or deployment rehearsal for all school flows.
Impact: rule logic is materially improved, but still needs environment-level validation before pilot hardening.
Planned follow-up: emulator validation and deployment verification during hardening.
