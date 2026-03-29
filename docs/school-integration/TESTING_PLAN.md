# School Integration Testing Plan

Status: Active
Last updated: 2026-03-27
Owner: Engineering

## Purpose

This document tracks the testing strategy, current coverage, identified gaps, and prioritized work plan for the school integration feature. It complements `BDD_SCENARIOS.md` (the behavioral specification) and `LIMITATIONS.md` (shipped constraints).

---

## Current Test Inventory

### Backend (Python / unittest)

| Test File | Feature | Cases | Notes |
|---|---|---|---|
| `test_deletion_requests.py` | Deletion lifecycle | 20 | Thorough: creation, approval, rejection, state transitions, role validation |
| `test_canvas_foundation.py` | Canvas Firestore helpers | 16 | Connections, content, enrollment, class, assignment helpers |
| `test_school_foundation_routes.py` | School/org bootstrap, guardian packets, compliance | 15 | Covers join flow, compliance records, enrollment |
| `test_canvas_client.py` | Canvas HTTP client | 12 | Initialization, API calls, error handling (auth, rate limit, 404) |
| `test_canvas_sync.py` | Canvas roster/content sync | 11 | Enrollment reconciliation, content flattening, membership creation |
| `test_canvas_encryption.py` | PAT encryption | 10 | AES round trips, tamper detection, unicode |
| `test_canvas_routes.py` | Canvas integration routes | 10 | Route handlers, course syncing, assignment management |
| `test_auth_memberships.py` | Auth + membership resolution | 6 | Token verify, user creation, membership resolution |
| `test_pedagogy_prompting.py` | Pedagogy prompt building | 5 | Policy normalization, prompt sections, feedback modes |
| `test_curriculum_admin_routes.py` | Curriculum admin | 4 | Package management, metadata only |
| `test_disclosure_logging.py` | Disclosure logging | 2 | New event logging, duplicate detection |
| `test_pronunciation_routes.py` | Pronunciation compliance | 2 | Voice permission handling |

| `test_compliance.py` | Compliance service | 71 | Full: voice/text gating, minor detection, retention, modality, consent events |
| `test_practice_analytics.py` | Practice analytics service | 68 | Full: session summary, derived events, detection, payload builders |
| `test_assignment_resolver.py` | Assignment resolver service | 25 | Full: bundle loading, access checks, bootstrap, serialization, pedagogy context |
| `test_guardian_packets.py` | Guardian packets service | 38 | Full: state machine, token security, TTL, issue/resend/cancel/decide |
| `test_membership_context.py` | Membership context service | 19 | Full: context building, role checks, class scope, resolve delegation |
| `test_curriculum_admin_routes_full.py` | Curriculum admin routes | 21 | Full: packages, mappings, assignments, practice sessions, events, permissions |
| `test_admin_routes.py` | Admin routes | 26 | Full: deletion lifecycle, compliance summary/roster/bulk/export, permissions |

**Total: 381 school-integration-relevant backend test cases**

### Frontend (TypeScript / Vitest + React Testing Library)

| Test File | Feature | Cases | Depth |
|---|---|---|---|
| `CanvasModuleView.test.tsx` | Canvas module viewer | 7 | Good: grouping, navigation, linked items |
| `CanvasLinkPicker.test.tsx` | Canvas link picker | 6 | Good: grouping, selection, filtering |
| `CanvasSyncStatus.test.tsx` | Canvas sync status | 6 | Good: status display, sync progress |
| `CanvasConnectPage.test.tsx` | Canvas connect flow | 5 | Moderate: course linking, module selection |
| `OnboardingHint.test.tsx` | Onboarding hints | 5 | Good: rendering, dismissal, state |
| `TeacherRoute.test.tsx` | Role-based routing | 4 | Good: access verification, redirects |
| `curriculumTemplates.test.ts` | Template resolution | 10 | Good: indexing, resolution by objectives |
| `AppCurriculumPage.test.tsx` | Curriculum browsing | 3 | Shallow: render only |
| `AppCurriculumModulePage.test.tsx` | Module detail view | 3 | Shallow: render only |
| `AssignmentLaunchPage.test.tsx` | Assignment launch | 3 | Shallow: render/load only |
| `TeacherAssignmentBuilderPage.test.tsx` | Assignment builder | 2 | Shallow: class loading only |
| `TeacherAssignmentAnalyticsPage.test.tsx` | Assignment analytics | 2 | Shallow: render only |
| `TeacherStudentDrillDownPage.test.tsx` | Student drill-down | 2 | Shallow: render only |
| `GuardianConsentPage.test.tsx` | Guardian consent | 2 | Shallow: render only |
| `TeacherClassCompliancePage.test.tsx` | Class compliance | 3 | Shallow: render only |

**Total: ~63 school-integration-relevant frontend test cases**

### Firebase Rules (Vitest + Firebase Emulator)

| Test File | Feature | Cases |
|---|---|---|
| `firestore-rules.test.ts` | Firestore security rules | ~67 |

**Solid coverage** of all school collections and role-based access patterns.

---

## Test Infrastructure Status

| Component | Status | Notes |
|---|---|---|
| Backend test framework | unittest | conftest.py with shared FakeDbBase + factories |
| Backend test runner | `make test-backend` | Also `python3 -m unittest discover -s backend/tests` |
| Frontend test framework | Vitest 3.2.4 | Configured in vite.config.ts |
| Frontend test runner | `make test-frontend` | Also `cd frontend && npm test -- --run` |
| Firebase test runner | `firebase emulators:exec` | Requires Java runtime |
| Shared FakeDb / fixtures | `backend/tests/conftest.py` | FakeDbBase (40+ methods), 10 factory functions, seed helpers |
| Test data factories | `backend/tests/conftest.py` | make_organization, make_membership, make_class, etc. |
| `.env.test` | `.env.test` | Safe defaults, no real credentials |
| Coverage reporting | `make coverage-backend` | coverage.py + .coveragerc, baseline 69% |
| CI/CD test step | None | `cloudbuild.yaml` builds+deploys without tests |
| E2E framework | None | Playwright MCP available but no test suite |

---

## Coverage Gap Analysis

### Backend: Untested Critical Services

These services contain core business logic with zero test coverage:

| Service | Lines | Risk | What's untested |
|---|---|---|---|
| `practice_analytics.py` | ~1700 | **High** | Session summary incremental updates (15 event types), derived event auto-generation (communicative functions, discourse moves, feedback detection, error patterns), all three analytics payload builders (assignment, class, student drill-down) |
| `assignment_resolver.py` | ~600 | **High** | Assignment bundle loading, access checks, full bootstrap resolution, curriculum context assembly, pedagogy context building, activity template resolution, multi-layer prompt assembly, launch modality normalization |
| `compliance.py` | ~300 | **High** | Voice/text gating decision matrix, minor detection defaults, guardian consent interaction, retention policy resolution, consent event creation, compliance record normalization and upsert |
| `guardian_packets.py` | ~250 | **Medium** | State machine (draft→issued→viewed→granted/revoked/expired/canceled), token generation and hash-only storage, TTL enforcement, resend with new token, cancel, latest packet queries |
| `membership_context.py` | ~100 | **Medium** | SchoolRequestContext construction, role priority resolution, require_any_role enforcement, class scope derivation from primaryClassIds |

### Backend: Untested Route Handlers

| Route File | What's untested |
|---|---|
| `teacher.py` | Join code generate/get/deactivate, roster view/remove, per-student compliance read/write, class compliance roster/bulk/audit-export, guardian packet issue/resend/cancel/get |
| `curriculum_admin.py` | Assignment CRUD, student assignment list, practice session bootstrap/create, learning event ingestion, all three analytics endpoints |
| `admin.py` | All endpoints: deletion request CRUD, org compliance summary/roster/bulk/guardian-packets/audit-export |

### Frontend: Shallow or Missing Tests

| Page/Component | What's untested |
|---|---|
| `AssignmentLaunchPage` | Voice launch, text fallback rendering, blocked state, event queuing, session termination, teacher preview banner |
| `TeacherAssignmentBuilderPage` | Mapping form submission, assignment creation, interaction contract preview, Canvas link picker integration |
| `TeacherDashboardPage` | Zero tests. Class creation dialog, join code management, roster view, navigation, onboarding hints, class filter |
| `SchoolOnboardingPage` | Zero tests. Form submission, org creation, redirect |
| `StudentJoinClassPage` | Zero tests. Code input, join flow, already-enrolled handling |
| `AdminDeletionRequestsPage` | Zero tests. Request creation, approve/reject/execute/retry actions |
| `AdminCompliancePage` | Zero tests. Three-tab layout, roster filtering, bulk update, audit export |
| `MembershipContext` | Zero tests. Role derivation from membership union, hasRole/hasAnyRole |

---

## Prioritized Test Work Plan

### Priority 1: Backend Unit Tests for Critical Services

Pure business logic, no external dependencies needed. Highest value per effort.

**P1-A: Compliance Service** (`compliance.py`)
- `normalize_student_compliance_record`: minor detection (age < 18, missing age, adult), guardian consent forcing for adults, voice_allowed computation, retention policy fallback
- `apply_launch_compliance`: full decision matrix (voice_only/hybrid/text_only x voice_allowed/blocked x text_fallback_enabled x teacher_preview)
- `resolve_assignment_launch`: integration of compliance resolution + launch gating
- Retention policy lookup
- `upsert_student_compliance_record`: merge + normalize behavior
- **Estimated: ~15 test cases**

**P1-B: Practice Analytics** (`practice_analytics.py`)
- `apply_learning_event_to_session`: one test per event type (session.started, session.ended, student.turn, assistant.turn, feedback.recast, feedback.elicitation, metric.target_expression_hit, metric.self_correction, metric.communicative_function_signal, metric.discourse_move_signal, metric.error_detected, metric.repeated_error, metric.rubric_dimension_signal, task.completed)
- `build_derived_learning_events`: communicative function detection, discourse move detection, feedback pattern detection, error detection, rubric dimension signal detection; locale dispatch (generic vs French)
- `build_assignment_analytics_payload`: aggregation correctness with multi-student multi-session data
- `build_class_analytics_payload`: class-level aggregation
- `build_student_drill_down_payload`: per-student aggregation
- `build_practice_session_payload`: initial session document structure
- **Estimated: ~25 test cases**

**P1-C: Assignment Resolver** (`assignment_resolver.py`)
- `load_assignment_bundle`: valid bundle, missing assignment, missing mapping, missing class, cross-class mismatch
- `user_can_access_assignment`: enrolled student, unenrolled student, teacher preview, non-org teacher
- `resolve_assignment_bootstrap`: full resolution with sample package, objective resolution, rubric resolution, pedagogy context building, activity template resolution
- `build_assignment_system_prompt`: verify all prompt layers are assembled in order
- Launch modality normalization from assignment override vs mapping policy
- **Estimated: ~15 test cases**

**P1-D: Guardian Packets** (`guardian_packets.py`)
- State machine: issue (draft→issued), resend (active states), cancel (active→canceled), grant (→granted), revoke (→revoked)
- Token security: raw token returned once, only hash stored, hash verification
- TTL: default 14 days, max 30 days, expired packet rejection
- Error states: duplicate active packet, cancel terminal packet, resend terminal packet
- Serialization: token_hash excluded from API output
- **Estimated: ~12 test cases**

**P1-E: Membership Context** (`membership_context.py`)
- `build_school_request_context`: valid context, missing active membership, multiple memberships
- `has_role` / `has_any_role`: single role, multiple roles, missing role
- `require_any_role`: pass and fail (raises SchoolContextPermissionError)
- `allowed_class_ids` derivation from primaryClassIds
- Role priority resolution (school_admin > teacher > student)
- **Estimated: ~8 test cases**

### Priority 2: Backend Route Tests for Untested Endpoints ✅

- `teacher.py` routes: Already covered (15 cases in test_school_foundation_routes.py)
- `curriculum_admin.py` routes: 21 cases in test_curriculum_admin_routes_full.py
- `admin.py` routes: 26 cases in test_admin_routes.py

### Priority 3: Shared Test Infrastructure ✅

Delivered:
- `backend/tests/conftest.py` — `FakeDbBase` (composable in-memory store with 40+ methods), 10 factory functions (`make_organization`, `make_membership`, `make_class`, `make_enrollment`, `make_user`, `make_assignment`, `make_mapping`, `make_compliance_record`, `make_practice_session`), `SAMPLE_CURRICULUM_PACKAGE`, `make_test_deps()`, `make_test_app()`, `passthrough_login_required`
- `backend/tests/test_conftest_smoke.py` — 26 smoke tests validating all factories, FakeDbBase CRUD, seed helpers, and end-to-end route integration
- `.env.test` — safe defaults for test environment (no real credentials)
- `.coveragerc` — coverage config targeting `backend/` with test exclusions
- `Makefile` — unified runner: `make test-backend`, `make test-frontend`, `make test-all`, `make coverage-backend`
- `.gitignore` updated with `coverage_html/`, `.coverage`

**Backend coverage baseline: 69%** (5269 statements, 3646 covered). Key service coverage: compliance 96%, assignment_resolver 96%, practice_analytics 81%, guardian_packets 80%, pedagogy 85-96%.

Note: Existing test files still use their own inline FakeDb classes. New tests should use `conftest.py` imports. Migrating existing tests is optional and low-priority.

### Priority 4: Frontend Integration Tests ✅

Delivered:
- `MembershipContext.test.tsx` — 7 tests: role detection, union-of-all-memberships behavior, active org, empty state, school_admin, active membership selection
- `StudentJoinClassPage.test.tsx` — 5 tests: render, successful join, invalid code error, auto-uppercase + 6-char limit, disabled submit
- `AssignmentLaunchPage.blocked.test.tsx` — 2 tests: fully blocked launch (disabled button + reasons), teacher preview banner
- `TeacherDashboardPage.test.tsx` — 4 tests: org name + stats, class list, onboarding hint, setup checklist

Also fixed: `TeacherDashboardPage.tsx` React hooks violation (useMemo after conditional return)

Remaining lower-priority pages (not blocking):
- `AdminDeletionRequestsPage` — tested via backend route tests
- `AdminCompliancePage` — tested via backend route tests

### Priority 5: E2E Tests (Playwright) — Infrastructure ✅, Tests Next

**Infrastructure delivered:**
- `backend/routes/test_harness.py` — dev-only seed/login/teardown/session endpoints
- `main.py` — conditional registration when `FLASK_ENV=development`
- `e2e/README.md` — usage documentation
- `firestore.indexes.json` — 7 composite indexes deployed to Firestore

**Verified flow:** seed → login (with membershipId pinning) → authenticated API calls return real data (1 class, 1 student, 1 assignment).

**Next:** Write Playwright test scripts using the `playwright-cli` skill.

Map BDD scenarios from `BDD_SCENARIOS.md` to Playwright test suites:

| Suite | BDD Scenarios Covered |
|---|---|
| `teacher-onboarding.spec.ts` | School Onboarding, Class Join Code |
| `student-enrollment.spec.ts` | Student Class Enrollment |
| `assignment-authoring.spec.ts` | Curriculum Mapping, Assignment Authoring |
| `student-practice.spec.ts` | Student Practice (Voice + Text Fallback) |
| `analytics.spec.ts` | Learning Event Analytics, Teacher Dashboard |
| `compliance.spec.ts` | Compliance Gating, Class Compliance, Guardian Consent |
| `canvas.spec.ts` | Canvas LMS Integration |
| `admin.spec.ts` | Deletion Requests, Admin Compliance |

### Priority 6: CI/CD

- Add test step to `cloudbuild.yaml` or create `.github/workflows/test.yml`
- Run backend + frontend + firebase rule tests before deploy
- Fail build on test failure
- Report coverage

---

## Session Tracking

Track progress of dedicated test sessions here.

| Session | Date | Priority | Scope | Tests Added | Status |
|---|---|---|---|---|---|
| 1 | 2026-03-27 | P1-A | Compliance service unit tests | 71 | Complete |
| 1 | 2026-03-27 | P1-B | Practice analytics unit tests | 68 | Complete |
| 2 | 2026-03-27 | P1-C | Assignment resolver unit tests | 25 | Complete |
| 2 | 2026-03-27 | P1-D | Guardian packets unit tests | 38 | Complete |
| 2 | 2026-03-27 | P1-E | Membership context unit tests | 19 | Complete |
| 3 | 2026-03-27 | P2 | Curriculum admin route tests | 21 | Complete |
| 3 | 2026-03-27 | P2 | Admin route tests | 26 | Complete |
| 3 | 2026-03-27 | P2 | Teacher route tests | — | Already covered (15 in test_school_foundation_routes) |
| 4 | 2026-03-27 | P3 | Shared test infrastructure | 26 (smoke) | Complete |
| 5 | 2026-03-27 | P4 | MembershipContext tests | 7 | Complete |
| 5 | 2026-03-27 | P4 | StudentJoinClassPage tests | 5 | Complete |
| 5 | 2026-03-27 | P4 | AssignmentLaunchPage blocked + preview | 2 | Complete |
| 5 | 2026-03-27 | P4 | TeacherDashboardPage tests | 4 | Complete |
| 6 | 2026-03-27 | P5 | E2E test harness + Firestore indexes | — | Complete |
| 6 | 2026-03-27 | P5 | E2E teacher dashboard test | 9 assertions | Complete |
| 6 | 2026-03-27 | P5 | E2E student assignment flow | 7 assertions | Complete |
| 7 | 2026-03-28 | — | Auth route tests (mock firebase_auth) | 17 | Complete |
| 7 | 2026-03-28 | — | Firebase emulator config | — | Complete |
| 7 | 2026-03-28 | P6 | CI/CD test gate in cloudbuild.yaml | — | Complete |
| 7 | 2026-03-28 | — | Firestore emulator index integration tests | 7 | Complete |
