# School Integration Tasks

Status: Active
Last updated: 2026-03-08
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

### Teacher onboarding

- [x] Design separate school onboarding flow from learner onboarding.
- [x] Create class manually flow.
- [ ] Invite student flow.
- [x] Add basic teacher-facing setup checklist state.

### LMS / roster import

- [ ] Decide first LMS integration order.
- [!] Choose first-party priority between Google Classroom and Canvas.
- [ ] Implement LMS connection record model.
- [ ] Implement roster import service abstraction.
- [ ] Add manual CSV fallback if LMS setup is delayed.

## Phase 3: Curriculum mapping and assignment authoring

### Curriculum package delivery

- [ ] Replace sample-only package loading with school-aware package lookup.
- [ ] Define package ownership rules: global vs organization.
- [-] Add package selection endpoint for teachers.

### Mapping overlay

- [x] Create `curriculum_mappings` model.
- [x] Build teacher UI to select package, module, objective IDs, and situations.
- [x] Add teacher controls for:
  - target expressions
  - focus grammar
  - rubric focus
  - feedback mode
  - scaffolding mode
  - modality policy
- [ ] Persist mapping versions for assignment reproducibility.

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
- [x] Snapshot resolved mapping into each practice session.
- [x] Expose rubric, task-model, and evidence metadata in assignment bootstrap.
- [x] Enforce assignment-aware prompt assembly for school practice.

### Pedagogy engine

- [ ] Encode default recast -> elicitation -> review ladder.
- [ ] Add teacher-configurable feedback modes.
- [ ] Add scaffold ladder settings.
- [ ] Support task templates:
  - information gap
  - opinion gap
  - decision-making
- [ ] Add extended-output pressure settings.

### Modality and cost controls

- [ ] Add org / class / assignment modality policies.
- [-] Track voice minutes and estimated cost per session.
- [ ] Add text fallback when voice is blocked by policy, consent, or budget.

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
- [ ] Add dashboard filters for date range, class, and assignment.

## Phase 6: Compliance, privacy, and retention

### Compliance model

- [ ] Add `student_compliance_records` model.
- [ ] Add `consent_events` audit trail.
- [ ] Define retention policy objects and defaults.
- [ ] Define deletion request and deletion execution flow.

### Enforcement

- [ ] Block voice session creation when `voice_allowed` is false.
- [ ] Block pronunciation audio storage when policy forbids it.
- [ ] Log sensitive access and disclosure events required by policy.
- [ ] Add admin tools for consent review and audit export.

### Policy review

- [ ] Validate COPPA workflow assumptions with counsel.
- [ ] Validate FERPA vendor / school-official workflow assumptions with counsel.
- [ ] Validate state biometric-risk assumptions, including Illinois BIPA exposure, with counsel.

## Phase 7: Pilot readiness

- [ ] Recruit 5-10 co-design teachers.
- [ ] Create pilot feedback loop and weekly issue triage.
- [ ] Prepare teacher onboarding guide.
- [ ] Prepare compliance and data-handling one-pager for pilot schools.
- [ ] Define beta support process for consent, roster, and integration issues.

## Recommended build order

1. Auth, memberships, and teacher route protection.
2. Class model and onboarding split.
3. Curriculum mappings and assignments.
4. Assignment-aware session bootstrap and prompt resolver.
5. Learning events and dashboard APIs.
6. Compliance enforcement and LMS hardening.

## Immediate next sprint

- [x] Finalize school entity schemas and Firestore indexes.
- [x] Update auth contract to return memberships and active context.
- [x] Add frontend `MembershipContext` and teacher route guard.
- [x] Convert `/app/teacher` from mock-only access to role-aware dashboard shell.
- [x] Define `curriculum_mappings` and `assignments` DTOs.
- [x] Add backend assignment bootstrap endpoint skeleton.

## Definition of done for beta entry

- [x] Teacher can create or import a class.
- [x] Teacher can create an assignment from curriculum mappings.
- [x] Student can launch assignment-aware practice.
- [x] Teacher can see class and student analytics tied to that assignment.
- [ ] Voice access respects consent and retention policy.
- [x] Teacher routes are role-protected.
- [x] Firestore rules are no longer placeholder-only.
