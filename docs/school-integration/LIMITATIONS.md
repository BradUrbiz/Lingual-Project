# School Integration Limitations

Status: Active
Last updated: 2026-03-08
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

3. Teacher analytics are available at class, assignment, and student level, but are still heuristic-based.
Impact: teachers can now navigate from the dashboard to class analytics (aggregated across assignments), student drill-down (per-student across assignments), and per-assignment analytics. However, all metrics (speaking time, rubric scores, error detection) are still heuristic estimates from transcript-level signals, not model-verified or provider-accurate.
Planned follow-up: dashboard date range filters, cross-class trends, richer visualization, and model-backed scoring calibration.

### Curriculum mapping and assignments

4. Curriculum mapping currently supports only the bundled sample curriculum package.
Impact: the runtime now uses the canonical AP French sample JSON as its bundled package source, but teachers still cannot create mappings against organization-owned or imported packages.
Planned follow-up: package ownership rules and school-aware package lookup.

5. Assignment launch currently supports assignment-aware realtime voice/hybrid sessions, but not assignment-scoped text launch.
Impact: students can start assignment-aware realtime practice, but `text_only` assignments do not yet have a dedicated assignment launch flow.
Planned follow-up: Phase 4 text fallback and assignment-aware text chat entry.

6. Live prompt generation now injects the core assignment envelope, but some teacher controls are still not enforced as hard runtime constraints.
Impact: `targetExpressions`, `focusGrammar`, `feedbackPolicy`, `scaffoldPolicy`, teacher notes, rubric/task/evidence metadata, and curriculum pedagogy tags now shape the prompt, but `allowedContextTags` and `rubricFocus` still are not enforced as hard runtime constraints.
Planned follow-up: stricter prompt-policy enforcement plus event-backed rubric measurement.

7. Practice analytics are improved, but still not equivalent to human scoring.
Impact: assignment launch now creates `practice_sessions`, emits lifecycle and turn-level `learning_events`, and rolls them into per-session summaries plus a teacher-facing assignment analytics page. The runtime now also tracks repeated-error patterns, feedback-linked correction families, actual context-tag signals, rubric-dimension evidence, rubric thresholds/confidence, and locale-aware communicative-function / discourse-move / feedback detection for English and French. However, these detections and rubric scores are still rule-based heuristics rather than model-verified semantics or certified assessment scoring.
Planned follow-up: richer realtime instrumentation, rubric-scoring calibration against teacher review, repeated-error families beyond the current rule catalog, and stronger semantic analysis.

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
