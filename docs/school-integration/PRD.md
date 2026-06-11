# School Integration PRD

Status: Beta v1.0 (shipped — pilot recruitment open)
Last updated: 2026-05-30
Owner: Product + Engineering

## 1. Why this exists

Lingual's beta-to-school motion depends on one core promise:

Teacher-designed speaking practice should scale beyond class time without turning Lingual into a generic AI chatbot.

The current product already proves that curriculum-aware practice is possible, but it is still fundamentally a single-user B2C app. To open beta to schools, Lingual needs a school-grade product surface that gives teachers control, shows measurable learning value, and bakes compliance into the workflow from day one.

## 2. Problem statement

Teachers do not have enough speaking time for each student. In a normal class period, many students get only a few minutes of actual output. Existing AI tools increase access to conversation, but they usually fail on the things schools care about most:

- The AI is not tightly aligned to what the teacher is teaching this week.
- Teachers cannot control what the AI emphasizes, corrects, or ignores.
- Data is too generic to change instruction.
- Audio and student data workflows are not designed for school compliance.
- Realtime voice costs can grow too quickly at classroom and school scale.

## 3. Product thesis

Lingual wins in schools if it is positioned and built as:

Teacher-designed practice, AI-executed at student scale.

That means the system must do five things well:

1. Turn teacher curriculum intent into concrete conversational behavior.
2. Run pedagogically structured speaking tasks, not just free chat.
3. Give corrective feedback that supports acquisition without killing fluency.
4. Produce teacher-actionable metrics, not vanity analytics.
5. Enforce school-safe privacy, consent, and retention defaults.

## 4. Product principles

### 4.1 Curriculum depth over topic tagging

It is not enough to pass "Unit 3 vocabulary" into a prompt. Teachers must be able to specify:

- target grammar or discourse moves
- target expressions
- task type
- rubric focus
- correction intensity
- scaffolding behavior
- modality policy

### 4.2 Teacher control is mandatory

Teachers must feel that they are designing the exercise and the AI is executing it. The product should never feel like an uncontrolled tutor that teaches outside the lesson plan.

### 4.3 Compliance is product architecture, not a later add-on

School beta cannot assume consumer-style data handling. Consent, retention, deletion, access control, and disclosure logging need explicit product and backend support.

### 4.4 Voice is valuable but not the default for every minute

Realtime voice should be used where it creates the most learning value. The platform should support a hybrid model where classes or assignments can choose voice-first, text-first, or mixed practice based on budget, consent, and pedagogy.

### 4.5 SLA-informed interaction beats generic conversation

The product should encode established language-learning behaviors:

- negotiation of meaning
- recast
- elicitation
- end-of-session metalinguistic review
- i+1 difficulty control
- scaffold ladders
- task-based language teaching
- pushed output

### 4.6 Teacher dashboards must change instruction

The dashboard must help a teacher decide what to reteach, who needs support, and whether students practiced the target structure. Generic progress summaries are not enough.

## 5. Target users

### 5.1 Primary users

- World language teachers
- ESL / ELD teachers
- School or program coordinators piloting AI-supported speaking practice

### 5.2 Secondary users

- Students in teacher-managed classes
- Parents or guardians in consent workflows
- School leaders reviewing usage, outcomes, and compliance readiness

## 6. Beta scope

### In scope for school beta

Shipped (2026-05-30):

- Single-school and small multi-class pilots
- Student, teacher, school-admin, and Lingual-admin roles
- School / class / roster foundation (org-admin wizard, teacher join-org with admin approval, class join-code)
- Teacher-authored assignment content (Canvas-linked, AI-assisted from teacher source packets, manual advanced, scaffold-free custom prompt) — replaces the originally-planned curriculum-overlay mapping
- Assignment-aware speaking practice with teacher targets (objectives, expressions, focus grammar, language-mix policy)
- Teacher dashboards with class, assignment, and student drill-down
- Consent-aware voice and audio handling (voice fails closed without consent; text fallback when blocked)
- Canvas LMS connector (PAT-based + LTI 1.3 launch + grade passback)
- Hybrid text/voice modality controls

Deferred to post-beta:

- Google Classroom connector
- CSV roster import + bulk/email invitations
- Mid-session intervention engine beyond pre-session prompt assembly

### Out of scope for initial beta

- Full district procurement workflows
- SIS-grade integration depth
- Automated final grades synced back to gradebooks
- Full multi-language curriculum authoring UI across every target language
- Parent portal beyond consent and notices
- Advanced district analytics or cross-school benchmarking

## 7. Core user stories

### 7.1 Teacher setup

As a teacher, I want to create a class or import one from my LMS so I can assign practice without manually creating every student account.

### 7.2 Curriculum mapping

As a teacher, I want to map this week's lesson to target grammar, expressions, tasks, and rubric focus so the AI stays aligned to my plan.

### 7.3 Assignment design

As a teacher, I want to choose task structure, feedback intensity, scaffolding behavior, and modality so the practice matches my instructional goal and budget.

### 7.4 Student practice

As a student, I want to enter a guided speaking task that feels like a real conversation but still helps me use the forms I am learning.

### 7.5 Teacher review

As a teacher, I want to see speaking time, target expression usage, repeated error patterns, and self-correction trends so I can adapt tomorrow's lesson.

### 7.6 Compliance control

As a school leader, I want voice features to respect consent and retention policy automatically so the pilot does not create avoidable privacy risk.

## 8. Functional requirements

### 8.1 School and class foundation

- Organizations, classes, and memberships must be first-class entities.
- Roles must support at least: school admin, teacher, student.
- A user must be able to belong to multiple organizations or classes.
- Access to teacher pages must be role-gated.

### 8.2 Roster and onboarding

- Teachers must be able to create classes manually.
- Teachers must be able to invite or import students.
- The system should support LMS-assisted roster creation for Google Classroom and Canvas in beta.
- Students should join through a class-aware onboarding path, not a purely consumer onboarding path.

### 8.3 Curriculum mapping

- Teachers must be able to select curriculum package, module, and objective IDs.
- Teachers must be able to define:
  - target expressions
  - focus grammar
  - allowed scenario scope
  - task type
  - rubric emphasis
  - feedback mode
  - scaffolding settings
  - voice/text mode
- The mapping layer must reference canonical curriculum content instead of duplicating it.

### 8.4 Assignment orchestration

- Teachers must be able to publish an assignment tied to a class and curriculum mapping.
- Students must launch practice from an assignment, not only from a generic chat entry point.
- The AI session must be built from assignment context plus learner state.
- If voice is blocked by consent or policy, assignment launch may downgrade to assignment-scoped text practice only when teacher-configured text fallback is enabled; otherwise launch must fail closed.

### 8.5 Pedagogical behavior

- Realtime feedback should default to recast.
- When the same target error repeats, the system should escalate to elicitation.
- End-of-session review should summarize recurring issues with clearer explanation.
- Difficulty should adapt to the student level and assignment settings.
- Practice should support task-based structures such as information gap, opinion gap, and decision-making tasks.
- The AI should actively push for extended output when the assignment calls for it.

### 8.6 Analytics

Teachers must be able to view at least:

- total speaking time
- average speaking time per student
- mean length of utterance
- target structure usage count or rate
- repeated error patterns
- self-correction rate
- task completion
- active vs inactive students
- assignment completion and modality usage

### 8.7 Compliance and privacy

- Voice-enabled practice must be blocked if consent state does not allow it.
- Pronunciation features must follow the same consent and retention rules as other school voice flows.
- The system must support parent/guardian consent tracking where required.
- Beta guardian consent should stay school-admin-assisted and notice-based; do not introduce a standalone guardian account or parent portal in beta.
- Teachers and school admins must be able to review and update student consent state within their authorized school scope during beta.
- Beta operations should include class-scoped bulk consent review/update and an exportable audit trail for consent-related events.
- Guardian consent collection and deletion handling are separate operational epics with different rollout gates, evidence requirements, and approval paths.
- Guardian collection workflows and deletion execution may remain admin-assisted until their dedicated product flows are defined and validated.
- Raw audio retention must be configurable and conservative by default.
- Schools must be able to request deletion and receive an auditable result through an approval-gated asynchronous workflow.
- Access to student data must follow role and class membership scope.
- The system must keep auditable records of consent state and sensitive disclosure events.

### 8.8 Cost controls

- Modality policy must be configurable at org, class, and assignment level.
- The platform must track voice session usage and estimated cost.
- Schools should be able to cap voice usage and fall back to text mode when needed.

## 9. Success metrics

### 9.1 North-star metric

Average weekly speaking minutes per active student outside normal class time.

### 9.2 Beta success metrics

- Teacher activation: teachers who create at least one class and one assignment in week 1
- Student participation: students who complete at least one assignment in week 1
- Speaking time uplift: average weekly Lingual speaking minutes vs teacher-reported in-class speaking time
- Curriculum fidelity: percentage of assignments using mapped objectives instead of free chat
- Target usage lift: change in target expression usage over repeated assignments
- Teacher usefulness: percentage of teachers who say the dashboard changed a lesson decision that week
- Compliance readiness: percentage of voice-eligible students with valid consent state
- Cost efficiency: average AI cost per active student per week

## 10. Beta milestones

All four milestones shipped as of 2026-05-30. Pilot recruitment is the open work; see `TASKS.md` Pilot readiness.

### Milestone 1: School foundation — [x] shipped

- roles (student, teacher, school-admin, Lingual-admin)
- classes (manual create + Canvas-linked)
- roster onboarding (join-code, LTI launch, Canvas roster signal)
- teacher and admin route protection

### Milestone 2: Curriculum control — [x] shipped (pivoted from overlay to Canvas-first)

- teacher assignment authoring from Canvas content, source packets, manual advanced, or scaffold-free custom prompt
- target expressions, focus grammar, objectives, teacher notes, task type, language-mix policy
- assignment-aware prompt assembly via `assignment_resolver`

### Milestone 3: School analytics — [x] shipped (heuristic)

- class, assignment, and student drill-down dashboards
- learning events + per-session summaries + rubric-dimension scoring
- (see LIMITATIONS #8 — analytics remain rule-based heuristics, not model-verified)

### Milestone 4: Compliance and pilot hardening — [x] shipped

- consent workflow (student self-consent, guardian packets with secure-link delivery)
- retention controls (`no_raw_audio` + `standard_school` policies)
- audit logging (`consent_events`, `disclosure_logs`, `lingual_admin_audit`)
- disclosure logging on key sensitive endpoints (see LIMITATIONS #12 for coverage gaps)
- contextual onboarding hints (3 pages, 7 hints)
- public `/compliance` page
- Firestore rules emulator validation (`firebase-tests/`, 44 cases)
- Canvas LMS connector (LTI 1.3 + PAT); Google Classroom deferred

## 11. Risks and mitigations

### Risk: product becomes a generic AI chat wrapper

Mitigation:
- make assignment context required for teacher-managed practice
- keep curriculum mappings explicit
- emphasize task structures and feedback policy in prompt assembly

### Risk: teacher trust is low

Mitigation:
- expose teacher controls clearly
- show exact target focus for each assignment
- display metrics tied to weekly teaching decisions

### Risk: legal and privacy exposure

Mitigation:
- enforce voice gating with compliance state
- define retention defaults before launch
- keep compliance references and counsel review in the delivery process

### Risk: voice cost overruns

Mitigation:
- support hybrid mode
- add voice budgets and cost reporting
- reserve voice for highest-value tasks

## 12. Pilot operating assumptions

- Start with 5-10 co-design teachers.
- Prioritize ESL and world language teachers who already use weekly speaking tasks.
- Use a small number of classes to validate dashboard usefulness before scaling integrations.
- Treat teacher feedback as product input, not just validation.

## 13. Open questions

Resolved during the v1 build:

- ~~Which LMS integration should ship first in beta?~~ Canvas (PAT + LTI 1.3). Google Classroom deferred.
- ~~Which delivery method should the school-admin-assisted guardian workflow use first in beta?~~ Secure-link delivery is the primary path; `downloadable_notice` is the staff-managed fallback without a rendered handout artifact.
- ~~Which role should be allowed to approve deletion requests in beta?~~ School admin only.

Still open:

- What retention defaults are acceptable across pilot schools after counsel review? (Tracks the counsel-review TASKS items for COPPA / FERPA / BIPA.)
- Should pronunciation-specific audio storage be opt-in per assignment or per organization? (Currently no raw audio is persisted — see LIMITATIONS #16. The opt-in question only becomes live once recording infrastructure exists.)
- How should the tutor pedagogy doctrine (short turns, scaffold ladder, anti-sycophancy, recycle cadence) be embedded without overloading `gpt-realtime-mini`? Current direction: keep the main realtime tutor lean, compile teacher/student/course constraints in the Pedagogy Engine, and move side-channel correction + quick help into the Conversation Sidecar. Design specs: `docs/school-integration/PEDAGOGY_ENGINE.md` and `docs/school-integration/PEDAGOGY_ENGINE_S1.md`.
