# School Integration Technical Spec

Status: Draft v0.1
Last updated: 2026-03-09
Owner: Engineering

Implementation note:

Current shipped constraints and temporary shortcuts should also be recorded in `LIMITATIONS.md`.

## 1. Goal

Build a school-ready architecture on top of the current Flask + Firebase + React stack without introducing a second persistence system during beta.

Recommended approach:

Pragmatic balance.

- Keep Firebase Auth, Flask sessions, Firestore, and the current curriculum package model.
- Add an organization and assignment layer above the current `users/{uid}` model.
- Move prompt resolution from "generic chat or sample curriculum" to "assignment-aware practice context."
- Add compliance gating before voice features.
- Add normalized event capture before building real teacher analytics.

## 2. Current-state findings

The current codebase has the right raw ingredients, but not the right school abstractions yet.

### Existing strengths

- React app shell and typed API-client pattern already exist in `frontend/src/api/*`.
- Curriculum package schema is already defined in `frontend/src/types/curriculum.ts`.
- Realtime practice already accepts curriculum context in `frontend/src/pages/AppCurriculumModulePage.tsx` and `backend/routes/chat.py`.
- A teacher dashboard visual shell already exists in `frontend/src/pages/TeacherDashboardPage.tsx`.

### Current blockers

- Auth is identity-only and session data only stores `uid`, `email`, `name`.
- Firestore is user-centric; nearly everything hangs off `users/{uid}`.
- `profile.school_name` is only a free-text field, not a real tenancy boundary.
- Curriculum delivery is a single sample package loaded from disk.
- Teacher dashboard data is static and not role-protected.
- Practice data is stored as generic chat history rather than assignment-bound session data.
- Firestore rules are placeholder-only and not school-safe.

Relevant current files:

- `main.py`
- `database.py`
- `backend/routes/auth.py`
- `backend/routes/chat.py`
- `backend/routes/pronunciation.py`
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/App.tsx`
- `frontend/src/pages/AppCurriculumPage.tsx`
- `frontend/src/pages/AppCurriculumModulePage.tsx`
- `frontend/src/pages/TeacherDashboardPage.tsx`
- `firestore.rules`

### Current shipped foundation as of 2026-03-09

The following foundation work is now in code:

- membership-aware auth response and backend request context
- role-protected teacher area and school setup bootstrap flow
- organization, membership, class, and enrollment data model
- secure Firestore rules for the current school collections
- teacher dashboard data contract backed by school records instead of hardcoded mock data
- curriculum mapping and assignment DTOs plus backend CRUD endpoints
- assignment bootstrap endpoint that resolves assignment context into launch data for current realtime practice
- assignment-aware pedagogy engine with feedback, scaffold, output, and task-template policies
- structured activity template definitions owned by curriculum packages, resolved at assignment bootstrap time
- learning event capture, per-session summaries, and teacher-facing analytics (class, assignment, student drill-down)
- compliance gating for voice sessions, pronunciation audio retention, and consent state enforcement
- guardian consent packet lifecycle with secure-link delivery and teacher/admin management
- class compliance roster, bulk consent operations, and audit export
- interaction contract visibility in teacher assignment builder (live preview), curriculum module page (full template cards), and curriculum listing (template name summary)

Current limitations for these shipped features live in `LIMITATIONS.md`.

## 3. Architecture decisions

### 3.1 Keep `users/{uid}` as identity, not tenancy

The existing `users/{uid}` document stays as the core learner identity and profile record. It should no longer be the only organizational boundary.

### 3.2 Add explicit school-domain entities

Add first-class entities for:

- organizations
- memberships
- classes
- enrollments
- curriculum packages
- curriculum mappings
- assignments
- compliance state
- practice sessions
- learning events
- analytics rollups

### 3.3 Keep canonical curriculum separate from teacher overlays

`CurriculumPackageV1` remains the canonical package format. Teacher customization should live in a separate mapping layer that references package, module, objective, and situation IDs.

For task-template behavior, objectives should continue to reference `templateRefs`, but the package itself should own the structured definitions under `templates.activityTemplates[]`. Runtime prompt assembly should resolve objective refs against those package-level template definitions rather than inferring behavior from template IDs alone.

### 3.4 Route every teacher-managed practice session through an assignment resolver

The prompt builder must no longer be called directly from a sample module selector alone. For school-managed practice, the flow becomes:

assignment -> class context -> teacher mapping -> student profile -> compliance policy -> modality policy -> system prompt

### 3.5 Voice gating must happen before session creation

No voice-capable route should create a session unless the student's compliance record allows it.

### 3.6 Normalize learning events before chasing dashboards

Teacher analytics should not be reverse-engineered from chat documents. Practice sessions should emit structured events that roll up into class and assignment metrics.

## 4. Proposed domain model

### 4.1 Firestore collections

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
- `created_at`
- `updated_at`

### `enrollments/{enrollmentId}`

Fields:

- `class_id`
- `student_uid`
- `student_membership_id`
- `status`
- `join_source` (`manual`, `invite`, `google_classroom`, `canvas`)
- `student_number` (optional)
- `guardian_contact_required`
- `created_at`
- `updated_at`

### `curriculum_packages/{packageId}`

Fields:

- `owner_scope` (`global`, `organization`)
- `owner_id`
- `schema_version`
- `source_type` (`native`, `import`, `lms_import`)
- `title`
- `learning_locale`
- `version`
- `status`
- `package_blob_ref` or normalized document payload
- `created_at`
- `updated_at`

Beta note:

It is acceptable to keep package JSON in Firestore or Cloud Storage with metadata in Firestore as long as lookup remains simple.

### `curriculum_mappings/{mappingId}`

Teacher-owned overlay that references canonical curriculum.

Fields:

- `org_id`
- `class_id`
- `package_id`
- `module_id`
- `objective_ids`
- `situation_ids`
- `target_expressions`
- `focus_grammar`
- `allowed_context_tags`
- `feedback_policy`
- `scaffold_policy`
- `modality_policy`
- `rubric_focus`
- `teacher_notes`
- `created_by_uid`
- `created_at`
- `updated_at`

### `assignments/{assignmentId}`

Fields:

- `org_id`
- `class_id`
- `mapping_id`
- `title`
- `description`
- `status`
- `release_at`
- `due_at`
- `modality_override`
- `max_attempts`
- `task_type`
- `success_criteria`
- `created_by_uid`
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

### `guardian_consent_packets/{packetId}`

Epic A model for beta guardian collection. Current beta ships secure-link guardian response plus staff-managed `downloadable_notice` packet tracking.

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

Support a school-admin-assisted guardian workflow without introducing a standalone guardian account model in beta.

State model:

- `draft`: packet prepared but not yet delivered
- `issued`: packet delivered by secure link or downloadable notice
- `viewed`: recipient opened the secure packet or confirmed receipt in staff tooling
- `granted`: guardian accepted the consent terms for the declared scope
- `revoked`: guardian explicitly withdrew a previously granted consent
- `expired`: packet timed out before a valid response
- `canceled`: staff withdrew the packet before completion

Implementation rules:

- Do not create guardian accounts for beta.
- Packets are school-admin-assisted artifacts, not a parent portal.
- `token_hash` must store only a hashed token, never the raw token.
- Every packet issuance, resend, reminder, view, grant, revoke, expire, and cancel action must emit a `consent_events` row.
- Packet completion must write both `guardian_consent_packets` state and the derived `student_compliance_records.guardian_consent_status`.

Current beta API surface:

- `GET /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packet`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/resend`
- `POST /api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/cancel`
- `GET /api/guardian/consent/<token>`
- `POST /api/guardian/consent/<token>/decision`

### `deletion_requests/{requestId}`

Epic B request model for auditable deletion operations, not yet implemented.

Fields:

- `org_id`
- `scope_type` (`student` | `class` | `org`)
- `scope_id`
- `requested_by_uid`
- `request_reason`
- `status` (`requested` | `approved` | `rejected` | `in_progress` | `completed` | `failed` | `partially_completed`)
- `approved_by_uid`
- `review_notes`
- `target_collections`
- `target_storage_prefixes`
- `execution_summary`
- `created_at`
- `updated_at`
- `completed_at`

Purpose:

Separate request intake, approval, and asynchronous execution for deletion so storage cleanup and partial failures are auditable.

### `deletion_execution_runs/{runId}`

Epic B execution model for asynchronous deletion workers, not yet implemented.

Fields:

- `request_id`
- `org_id`
- `scope_type`
- `scope_id`
- `status` (`queued` | `running` | `completed` | `failed` | `partially_completed`)
- `attempt_number`
- `firestore_counts`
- `storage_counts`
- `error_summary`
- `started_at`
- `finished_at`
- `worker_ref`

Purpose:

Track every async execution attempt independently from the human approval request so retries and partial failures remain auditable.

Request state model:

- `requested`: request submitted and awaiting review
- `approved`: request accepted and queued for execution
- `rejected`: request denied with review notes
- `in_progress`: at least one execution run is active
- `completed`: deletion finished successfully
- `failed`: terminal failure without successful cleanup
- `partially_completed`: some targets were deleted but manual intervention is still required

Execution rules:

- Approval and execution are separate steps.
- Firestore records and Firebase Storage artifacts must be enumerated from the same request scope snapshot.
- Execution must be idempotent and retryable.
- Every request, approval, rejection, queue, execution start, retry, completion, and failure action must emit a `consent_events` or deletion-specific audit event.
- The UI must show both the request state and the latest execution run summary.

Suggested API surface:

- `GET /api/admin/deletion-requests`
- `POST /api/admin/deletion-requests`
- `GET /api/admin/deletion-requests/<request_id>`
- `POST /api/admin/deletion-requests/<request_id>/approve`
- `POST /api/admin/deletion-requests/<request_id>/reject`
- `POST /api/admin/deletion-requests/<request_id>/retry`

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

### 4.2 Why this model fits the repo

- It preserves the current `users/{uid}` contract for existing learner flows.
- It avoids a full database migration for beta.
- It gives the teacher product a real school data layer instead of relying on `profile.school_name`.
- It can be added incrementally without breaking current routes.

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
- `POST /api/teacher/classes/<class_id>/roster/import`

### Curriculum admin and assignment orchestration

Add route module:

- `backend/routes/curriculum_admin.py`

Core endpoints:

- `GET /api/teacher/classes/<class_id>/curriculum/packages`
- `POST /api/teacher/classes/<class_id>/curriculum/mappings`
- `GET /api/teacher/classes/<class_id>/curriculum/mappings`
- `POST /api/teacher/classes/<class_id>/assignments`
- `GET /api/student/assignments`

### Practice session orchestration

Add service modules:

- `backend/services/assignment_resolver.py`
- `backend/services/pedagogy/`
- `backend/services/compliance.py`
- `backend/services/events.py`
- `backend/services/analytics.py`

New sequence for school practice:

1. Student opens assignment.
2. Frontend requests practice session bootstrap with `assignmentId`.
3. Backend resolves class, mapping, curriculum package, learner state, compliance state, and modality.
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

### Layer 2: assignment and curriculum context

- curriculum package
- unit/module
- target objectives
- target expressions
- task type
- scenario bounds

### Layer 3: pedagogical policy

- correction mode
- elicitation threshold
- scaffold ladder
- curriculum-aware task template structure
- target-output pressure
- preferred balance of fluency vs accuracy

Implementation note:

- keep `assignment_resolver.py` as the final assignment-aware prompt assembler
- keep pedagogy-specific policy normalization and prompt sections in `backend/services/pedagogy/`
- let task-template assembly compile situation seed, communicative functions, discourse moves, rubric focus, and resolved curriculum template definitions into deterministic prompt sections
- keep the beta pedagogy engine deterministic and policy-driven before introducing any live intervention layer

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

Default beta behavior:

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
- Teachers and school admins may update consent records inside their authorized organization and class scope during beta.
- Beta operational tooling should start with class-scoped bulk consent updates and class-scoped audit export from teacher workflows.
- Guardian-facing consent collection requires a dedicated actor/evidence model and should not be improvised from teacher-only forms.
- Deletion execution requires a stateful workflow that covers Firestore records and Firebase Storage audio artifacts before it is automated.

Current beta implementation slice:

- class compliance roster endpoint that joins active enrollments, user display names, guardian-contact flags, and effective compliance status
- class-scoped bulk consent update actions for teacher and school-admin roles
- class-scoped audit export in CSV format backed by `consent_events`
- audit export access logged as a class-scoped `consent_events` row
- guardian packet issue/resend/cancel actions from student drill-down
- class compliance roster and student drill-down surfaces that show guardian packet state alongside effective consent state
- secure-link public guardian page that records `granted` / `revoked` decisions back into `student_compliance_records`
- `downloadable_notice` delivery recorded as a staff-managed packet type without a rendered handout artifact in beta

Remaining hardening after the current slice:

#### Epic B: Deletion requests and execution

- define request intake, approval, and async execution lifecycle
- add deletion execution runs so retries and partial failures are visible
- enumerate Firestore and Storage deletion targets from a request scope snapshot
- broaden event taxonomy for request creation, approval, rejection, queue, retry, completion, and failure

Recommended beta defaults, pending counsel validation:

- text practice allowed unless school policy blocks it
- raw audio retention: 30 days
- transcripts and derived session summaries: 365 days
- aggregated analytics: term length plus 1 year
- deletion SLA target: 7 days from approved request

Hard rule:

Do not build voice identity, speaker recognition, or voiceprint features for school beta.

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

Beta computation strategy:

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

Keep current `/app` shell, but create a real teacher area:

- `/app/teacher`
- `/app/teacher/classes/:classId`
- `/app/teacher/classes/:classId/curriculum`
- `/app/teacher/classes/:classId/assignments/:assignmentId`
- `/app/teacher/classes/:classId/students/:studentUid`

Student practice entry point:

- `/app/assignments/:assignmentId`

Do not continue routing all teacher workflows through the current flat `/app/teacher` mock page.

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

## 7. File-level implementation map

### 7.1 Backend files to create

- `backend/routes/schools.py`
- `backend/routes/teacher.py`
- `backend/routes/curriculum_admin.py`
- `backend/routes/integrations.py`
- `backend/services/assignment_resolver.py`
- `backend/services/prompt_builder.py`
- `backend/services/compliance.py`
- `backend/services/events.py`
- `backend/services/analytics.py`
- `backend/services/membership_context.py`

### 7.2 Backend files to modify

- `main.py`
  - register new blueprints
  - move prompt assembly responsibilities into services
- `backend/route_deps.py`
  - add membership and compliance dependencies
- `backend/routes/auth.py`
  - return memberships and active context
- `backend/routes/chat.py`
  - accept `assignmentId`
  - call compliance and assignment resolver
- `backend/routes/pronunciation.py`
  - enforce compliance checks
- `database.py`
  - keep legacy helpers
  - add school-domain helpers only if they stay readable
- `firestore.rules`
  - replace placeholder rules with org/class-aware access rules

### 7.3 Frontend files to create

- `frontend/src/api/schools.ts`
- `frontend/src/api/teacher.ts`
- `frontend/src/api/assignments.ts`
- `frontend/src/api/compliance.ts`
- `frontend/src/types/school.ts`
- `frontend/src/types/assignment.ts`
- `frontend/src/contexts/MembershipContext.tsx`
- `frontend/src/components/layout/TeacherRoute.tsx`
- `frontend/src/pages/TeacherClassPage.tsx`
- `frontend/src/pages/TeacherCurriculumPage.tsx`
- `frontend/src/pages/AssignmentLaunchPage.tsx`
- `frontend/src/pages/StudentAssignmentReportPage.tsx`

### 7.4 Frontend files to modify

- `frontend/src/App.tsx`
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/components/layout/AppProtectedRoute.tsx`
- `frontend/src/components/layout/AppLayout.tsx`
- `frontend/src/pages/TeacherDashboardPage.tsx`
- `frontend/src/pages/AppCurriculumPage.tsx`
- `frontend/src/pages/AppCurriculumModulePage.tsx`
- `frontend/src/types/index.ts`

## 8. Rollout phases

### Phase 0: foundation

- org and membership model
- role-aware auth response
- route protection
- secure Firestore rules

### Phase 1: classes and onboarding

- class CRUD
- roster import
- teacher and student onboarding split

### Phase 2: curriculum control

- mapping overlay
- assignment creation
- assignment-aware prompt builder

### Phase 3: sessions and events

- practice session bootstrap
- event stream
- per-session summaries

### Phase 4: dashboards and reporting

- teacher dashboard DTO
- student drill-down
- assignment analytics

### Phase 5: compliance and LMS hardening

- consent workflows
- retention enforcement
- LMS sync
- audit logging

## 9. Testing strategy

Backend:

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

## 10. Compliance references

This spec is not legal advice. Counsel review is required before production rollout.

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

## 11. Open technical questions

- Should analytics rollups run in Flask, Cloud Functions, or scheduled GCP jobs for beta?
- Should curriculum package payloads live fully in Firestore, Cloud Storage, or a mixed model?
- Do we store any raw audio by default for general speaking assignments, or only for pronunciation-enabled assignments?
- Which LMS gets the first real integration path: Google Classroom or Canvas?
