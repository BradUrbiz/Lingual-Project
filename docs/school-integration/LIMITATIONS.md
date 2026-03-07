# School Integration Limitations

Status: Active
Last updated: 2026-03-07
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

2. Student roster workflows are not live yet.
Impact: no invite flow, no LMS roster sync, no CSV fallback, and no teacher-managed student join UX.
Planned follow-up: Phase 2 onboarding and roster workflows.

3. Teacher dashboard summary metrics are still early-stage.
Impact: class and assignment counts now reflect real school records, and a first assignment analytics endpoint exists, but the dashboard UI still does not surface full session analytics or student drill-downs.
Planned follow-up: dashboard integration, class analytics, and student-level drill-down views.

### Curriculum mapping and assignments

4. Curriculum mapping currently supports only the bundled sample curriculum package.
Impact: teachers can create mappings and assignments only against the existing sample package, not organization-owned or imported packages.
Planned follow-up: package ownership rules and school-aware package lookup.

5. Assignment launch currently supports assignment-aware realtime voice/hybrid sessions, but not assignment-scoped text launch.
Impact: students can start assignment-aware realtime practice, but `text_only` assignments do not yet have a dedicated assignment launch flow.
Planned follow-up: Phase 4 text fallback and assignment-aware text chat entry.

6. Live prompt generation now injects the core assignment envelope, but some teacher controls are still not enforced as hard runtime constraints.
Impact: `targetExpressions`, `focusGrammar`, `feedbackPolicy`, `scaffoldPolicy`, and teacher notes shape the prompt, but `allowedContextTags`, `rubricFocus`, and downstream analytics are not yet enforced or measured.
Planned follow-up: stricter prompt-policy enforcement plus event-backed rubric measurement.

7. Practice analytics are now first-pass, not pedagogically complete.
Impact: assignment launch now creates `practice_sessions`, emits lifecycle and turn-level `learning_events`, and rolls them into per-session summaries plus an assignment analytics endpoint. However, feedback-type events, self-correction events, task-completion events, repeated-error tracking, and rubric-level rollups are still not emitted by the live runtime.
Planned follow-up: richer realtime instrumentation, pedagogical event capture, and analytics rollups.

8. Speaking time and cost are currently estimated, not provider-accurate.
Impact: session summaries derive speaking time from transcript word counts and track estimated voice seconds / text turns, but they do not yet use raw audio durations or provider billing metadata for precise cost accounting.
Planned follow-up: realtime usage metering, model-cost accounting, and budget enforcement.

### Compliance and policy

9. Compliance gating is not yet enforced in assignment bootstrap or realtime session creation.
Impact: launch data currently assumes voice is allowed unless future policy layers block it.
Planned follow-up: student compliance records, consent checks, retention enforcement, and voice gating.

10. Firestore rules are now school-aware for the current collections, but they have not yet been validated in a Firebase emulator or deployment rehearsal for all school flows.
Impact: rule logic is materially improved, but still needs environment-level validation before pilot hardening.
Planned follow-up: emulator validation and deployment verification during hardening.
