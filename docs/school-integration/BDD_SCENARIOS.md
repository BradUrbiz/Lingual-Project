# School Integration BDD Scenarios

Status: Active
Last updated: 2026-03-27
Owner: Engineering + Product

This document describes the shipped school-integration features in Behavior-Driven Development (Given-When-Then) format. Each feature area is organized by actor (Teacher, Student, Guardian, School Admin) and grouped by functional domain.

---

## Feature: School Onboarding

### Scenario: Teacher bootstraps a new school workspace

```gherkin
Given a logged-in user with no existing organization membership
When the user navigates to /school/setup
  And fills in organization name, type, first class name, term, subject, grade band, and learning locale
  And submits the form
Then the system creates an organization record in Firestore
  And creates a teacher-admin membership linking the user to the organization
  And creates the first class under the organization
  And links the membership to the class via primaryClassIds
  And updates the user profile with the school name
  And redirects the user to /app/teacher
  And the teacher dashboard shows the setup checklist with "school workspace created" and "first class created" checked
```

### Scenario: Teacher creates an additional class

```gherkin
Given a teacher with an active school membership
When the teacher opens the dashboard and clicks "Create Class"
  And enters a class name, term, subject, grade band, and learning locale
  And submits
Then the system creates a new class under the teacher's active organization
  And adds the class to the teacher's primaryClassIds
  And the class appears in the teacher's class list with 0 students and 0 assignments
```

---

## Feature: Class Join Code

### Scenario: Teacher generates a join code for a class

```gherkin
Given a teacher who owns a class with no active join code
When the teacher clicks "Generate Join Code" on the class card
Then the system generates a unique 6-character alphanumeric code
  And stores it on the class record with an active flag and timestamp
  And displays the code to the teacher with a copy button
```

### Scenario: Teacher deactivates a join code

```gherkin
Given a class with an active join code "ABC123"
When the teacher clicks "Deactivate Join Code"
Then the system marks the join code as inactive
  And students can no longer use "ABC123" to join the class
```

### Scenario: Teacher regenerates a join code

```gherkin
Given a class with an active or deactivated join code
When the teacher clicks "Regenerate Join Code"
Then the system generates a new 6-character code replacing the old one
  And the old code becomes invalid
```

---

## Feature: Student Class Enrollment

### Scenario: Student joins a class by code

```gherkin
Given a logged-in student with no class enrollment
  And a class with an active join code "XYZ789"
When the student navigates to /app/join
  And enters "XYZ789"
Then the system looks up the class by join code
  And creates a student membership for the student in the class's organization (or reuses an existing one)
  And creates an active enrollment linking the student to the class
  And sets the join source to "join_code"
  And displays a confirmation card with the class name
  And the student can navigate to /app/learn to see assignments for that class
```

### Scenario: Student re-enters a code for a class they are already enrolled in

```gherkin
Given a student already enrolled in a class with join code "XYZ789"
When the student enters "XYZ789" on the join page
Then the system detects the existing enrollment
  And shows a friendly "already enrolled" message without creating a duplicate
```

### Scenario: Teacher removes a student from the roster

```gherkin
Given a teacher viewing the roster of a class with 5 enrolled students
When the teacher clicks "Remove" next to a student
Then the system soft-deactivates the enrollment (status changes to inactive)
  And the student no longer appears in the active roster
  And the student no longer receives assignments for that class
```

---

## Feature: Teacher Dashboard

### Scenario: Teacher views the dashboard with populated classes

```gherkin
Given a teacher with 3 classes, 25 total students, and 8 assignments
When the teacher navigates to /app/teacher
Then the system returns the dashboard payload with summary stats
  And the page displays the class count, student count, and assignment count
  And each class card shows the class name, student count, and assignment count
  And each class card has navigation buttons: Analytics, Assignments, Compliance, Canvas
```

### Scenario: Teacher sees onboarding hints on an empty dashboard

```gherkin
Given a teacher who just completed school onboarding with one empty class
When the teacher views the dashboard
Then the system renders an onboarding hint: "Add students to your class using a join code or Canvas import"
  And the setup checklist shows "first student added" as unchecked
```

### Scenario: Teacher views dashboard with class filter

```gherkin
Given a teacher with multiple classes
When the teacher selects a single class from the class filter dropdown
Then the summary stats recalculate to show only that class's student count and assignment count
  And only that class's card is displayed
```

---

## Feature: Curriculum Mapping

### Scenario: Teacher creates a curriculum mapping

```gherkin
Given a teacher on the assignment builder page for a class
  And the bundled AP French sample curriculum package is loaded
When the teacher selects a module, a situation, and one or more objective IDs
  And configures feedback mode to "balanced"
  And sets scaffolding hint ladder to ["wait", "context_hint", "choice_prompt", "model_and_retry"]
  And sets modality to "hybrid" with text fallback enabled
  And submits the mapping form
Then the system validates the package ID, situation ID, and objective IDs against the bundled package
  And normalizes all pedagogy policy fields (feedback, scaffold, output) through the pedagogy engine
  And creates a curriculum_mappings record in Firestore
  And the new mapping appears in the mapping list on the assignment builder page
```

### Scenario: Teacher views available curriculum packages (sample-only limitation)

```gherkin
Given a teacher on the assignment builder page
When the page loads and fetches available curriculum packages
Then the system returns the single bundled AP French sample package summary
  And a limitations notice indicating this is a sample-only path
  And the page renders the limitation as an alert banner
```

---

## Feature: Assignment Authoring

### Scenario: Teacher creates a published assignment

```gherkin
Given a teacher with a curriculum mapping for a class
When the teacher fills in the assignment form with title, description, due date, and task type "information_gap"
  And selects the mapping
  And sets the status to "published"
  And submits
Then the system validates the mapping belongs to the class
  And creates an assignment record in Firestore with status "published"
  And the assignment appears in the class assignment list
  And enrolled students can see this assignment on their learning page
```

### Scenario: Teacher views the interaction contract preview

```gherkin
Given a teacher creating an assignment with a mapping that references curriculum objectives with templateRefs
When the page resolves activity templates from the package
Then the teacher sees a preview showing: activity template titles, assistant role, opening moves, sustain moves, closing moves, and completion rules
  And the preview reflects the structured definitions from the curriculum package
```

---

## Feature: Student Assignment Practice (Voice)

### Scenario: Student launches a voice assignment with valid consent

```gherkin
Given a student enrolled in a class with a published "information_gap" assignment
  And the student's compliance record has voice_allowed = true
When the student navigates to /app/assignments/:assignmentId
  And the system calls the bootstrap endpoint
Then the bootstrap resolves the assignment, mapping, class, and curriculum context
  And the pedagogy engine assembles the multi-layer system prompt with:
    | Layer | Content |
    | Assignment envelope | title, class, task type, modality, retention policy |
    | Objectives | canDo statements from mapped objectives |
    | Target expressions | from the curriculum mapping |
    | Feedback mode directive | based on feedbackPolicy (balanced/fluency_first/accuracy_first) |
    | Correction ladder | recast -> elicitation -> review escalation rules |
    | Scaffold ladder | wait -> context_hint -> choice_prompt -> model_and_retry |
    | Task template directive | phases, scenario anchor, communicative functions, discourse moves |
    | Output pressure directive | min word target, follow-up pressure, evidence targets |
  And the launch policy shows voiceAllowed = true, textAllowed = true, mode = "hybrid"
  And the student sees the assignment details and a "Start Practice" button
```

### Scenario: Student starts a voice practice session

```gherkin
Given a student on the assignment launch page with a valid bootstrap
When the student clicks "Start Practice"
Then the system creates a Firestore chat record
  And creates a practice_sessions record with status "active" and a snapshot of the resolved mapping and pedagogy
  And emits a "session.started" learning event
  And opens a WebSocket connection to the GPT Realtime API with the assembled system prompt
  And the student can begin speaking
```

### Scenario: Student turn is recorded and analyzed

```gherkin
Given an active voice practice session
When the student speaks and the transcript is received
Then the system emits a "student.turn" learning event with the transcript text and turn index
  And the session summary is updated: turn count incremented, word count updated, speaking time estimated
  And the system runs derived event generation:
    | Detection | Method |
    | Communicative function signals | regex pattern matching against locale-aware catalogs |
    | Discourse move signals | regex pattern matching against locale-aware catalogs |
    | Error detection | grammar rules for English and French |
    | Target expression hits | substring matching against mapped target expressions |
  And any detected signals are emitted as additional learning events
```

### Scenario: Session ends on page leave

```gherkin
Given an active practice session with 8 student turns
When the student navigates away from the assignment launch page
Then the system fires a "session.ended" event with reason "page_leave"
  And the session status changes to "completed" or "abandoned"
  And final rubric dimension scores are computed from accumulated signals
```

---

## Feature: Student Assignment Practice (Text Fallback)

### Scenario: Student launches an assignment with voice blocked and text fallback enabled

```gherkin
Given a student enrolled in a class with a published "opinion_gap" assignment
  And the student's compliance record has voice_allowed = false
  And the assignment's mapping has textFallbackEnabled = true
When the student navigates to /app/assignments/:assignmentId
Then the compliance engine applies the launch compliance decision:
  And the configured mode is downgraded from "hybrid" to "text_only"
  And fallbackApplied = true
  And the student sees a notice: "Voice practice is not available. Text mode has been enabled as a fallback."
  And the student can practice via text input
```

### Scenario: Student is fully blocked when voice is off and text fallback is disabled

```gherkin
Given a student with voice_allowed = false
  And the assignment's mapping has textFallbackEnabled = false
  And the assignment's modality is "voice_only"
When the student navigates to the assignment launch page
Then the launch policy returns voiceAllowed = false, textAllowed = false
  And blockedReasons includes the reason for the voice block
  And the "Start Practice" button is disabled
  And the student sees the blocked reasons
```

---

## Feature: Teacher Preview Mode

### Scenario: Teacher previews an assignment without compliance gating

```gherkin
Given a teacher who created an assignment for their class
When the teacher navigates to the assignment launch page
Then the system detects the user is a teacher with access via teacher_membership_ids
  And sets teacherPreview = true
  And bypasses all compliance gating (voice is allowed regardless of consent state)
  And renders an alert banner: "Teacher Preview Mode"
  And the teacher can start a full practice session to verify the AI behavior
```

---

## Feature: Learning Event Analytics

### Scenario: Teacher views assignment-level analytics

```gherkin
Given a published assignment with 12 completed practice sessions across 8 students
When the teacher navigates to /app/teacher/classes/:classId/assignments/:assignmentId/analytics
Then the system loads the assignment bundle, resolves the bootstrap, and aggregates all sessions and events
  And the page displays:
    | Metric | Source |
    | Total sessions | count of practice_sessions for this assignment |
    | Unique students | distinct student_uids across sessions |
    | Total speaking minutes | sum of estimated speaking time across sessions |
    | Self-corrections | sum of self_correction_count across sessions |
    | Repeated errors | ranked error patterns by frequency across all sessions |
    | Rubric dimension scores | per-dimension averages with thresholds, confidence, and evidence arrays |
  And each objective shows turn count and rubric threshold status
  And recent sessions are listed with student name and session summary
```

### Scenario: Teacher views class-level analytics with date filter

```gherkin
Given a class with 3 assignments and 20 students
When the teacher navigates to class analytics
  And sets the date filter to "last 7 days"
Then the backend filters practice sessions by the date range server-side
  And returns class summary metrics: total sessions, completed sessions, student turns, words, speaking time
  And per-assignment summary: session count, completion rate, average speaking time
  And per-student summary: session count, turn count, word count
  And the teacher can filter by assignment status (published/draft/archived) client-side
```

### Scenario: Teacher drills down into a specific student

```gherkin
Given a teacher viewing class analytics
When the teacher clicks on a student card
Then the system loads the student drill-down with all sessions, events, and per-assignment breakdown
  And emits a "disclosure.practice_data_viewed" audit event (FERPA disclosure logging)
  And the page shows:
    | Section | Content |
    | Summary stats | total sessions, speaking time, self-corrections, errors |
    | Per-assignment breakdown | target expression hits, rubric scores per assignment |
    | Error patterns | repeated errors ranked by frequency |
    | Compliance | editable consent fields with current voice/text allowed status |
    | Guardian packets | existing packet status with issue/resend/cancel actions |
```

---

## Feature: Derived Event Auto-Generation

### Scenario: System detects communicative function signals in a student turn

```gherkin
Given an active French language practice session
When a student turn transcript contains "est-ce que tu peux"
Then the system's regex-based communicative function detector matches the "requesting" function pattern
  And emits a "metric.communicative_function_signal" learning event with functionId "requesting"
  And updates the session summary's communicative_function_signals count
```

### Scenario: System detects repeated grammar errors

```gherkin
Given a practice session where the student has made a subject-verb agreement error twice
When the third student turn contains the same error pattern
Then the error detection rules match the grammar pattern
  And the system emits a "metric.error_detected" event
  And emits a "metric.repeated_error" event
  And increments the session summary's repeated_error_counts and rubric_dimension_error_counts
```

### Scenario: System detects feedback recasts in assistant turns

```gherkin
Given an active practice session in balanced feedback mode
When the assistant turn text matches a recast pattern (e.g., a corrected form echoed back)
Then the system emits a "feedback.recast" derived learning event
  And increments the session summary's feedback_counts.recast
```

---

## Feature: Pedagogy Engine

### Scenario: Feedback mode shapes the AI prompt

```gherkin
Given a curriculum mapping with feedbackPolicy.mode = "fluency_first"
When the system builds the practice session prompt
Then the feedback mode directive instructs the AI:
  And "Do not interrupt mid-sentence"
  And "Recast errors at natural pauses only"
  And "End review is optional"
```

```gherkin
Given a curriculum mapping with feedbackPolicy.mode = "accuracy_first"
When the system builds the practice session prompt
Then the feedback mode directive instructs the AI:
  And "Provide explicit correction immediately"
  And "Escalate to elicitation without delay"
  And "End-of-session review is mandatory"
```

### Scenario: Scaffold ladder shapes the AI prompt

```gherkin
Given a curriculum mapping with scaffoldPolicy.hintLadder = ["wait", "context_hint", "choice_prompt", "model_and_retry"]
  And silenceToleranceMs = 3000
When the system builds the scaffold ladder prompt section
Then the prompt instructs the AI to:
  And wait 3 seconds on silence
  And then provide a situational nudge
  And then offer a forced choice between options
  And then model the full expected response and ask the student to retry
```

### Scenario: Task template structures the conversation

```gherkin
Given an assignment with task_type = "information_gap"
  And a curriculum situation with setting, roles, and register
  And resolved activity templates with opening/sustain/closing moves
When the system builds the task template prompt
Then the prompt includes:
  And the 3-phase task structure (setup, exchange, wrap-up)
  And the scenario anchor (setting and role descriptions)
  And register-specific behavioral hints
  And per-template assistant role, opening moves, sustain moves, closing moves, and completion rule
  And communicative function directives with behavioral hints
  And discourse move directives with behavioral hints
  And evidence targets (min turns, max turns)
```

### Scenario: Output pressure calibrates minimum student output

```gherkin
Given an assignment with task_type = "opinion_gap"
  And feedbackPolicy.mode = "accuracy_first"
When the system builds the output pressure directive
Then the minimum student turn words is set to 10 (opinion_gap default)
  And follow-up pressure is set to "high" (accuracy_first override)
  And the prompt instructs the AI to actively push for extended student output
```

---

## Feature: Compliance Gating

### Scenario: Minor student without guardian consent is blocked from voice

```gherkin
Given a student with age < 18 (is_minor = true)
  And guardian_consent_status = "not_granted"
  And voice_consent_status = "granted"
When the compliance engine normalizes the student's compliance record
Then voice_allowed is computed as false (minor without guardian consent)
  And voice practice is blocked for this student
```

### Scenario: Adult student with voice consent can use voice

```gherkin
Given a student with age >= 18 (is_minor = false)
  And voice_consent_status = "granted"
When the compliance engine normalizes the compliance record
Then guardian_consent_status is forced to "not_required"
  And voice_allowed = true
  And the student can launch voice-enabled practice sessions
```

### Scenario: Student with unknown age defaults to minor

```gherkin
Given a student with no age field in their user profile
When the compliance engine normalizes the compliance record
Then is_minor defaults to true (conservative)
  And guardian consent is required for voice access
```

### Scenario: Pronunciation is subject to the same compliance rules

```gherkin
Given a student with voice_allowed = false
When the student attempts to use the pronunciation practice feature
Then the system applies the same compliance gate as assignment practice
  And blocks pronunciation audio capture
  And blocks raw audio storage if the retention policy forbids it
```

---

## Feature: Guardian Consent Packets

### Scenario: Teacher issues a guardian consent packet

```gherkin
Given a teacher viewing a minor student's drill-down page
  And no active guardian consent packet exists for this student
When the teacher clicks "Issue Guardian Consent Packet"
  And selects delivery method "secure_link" and provides a contact channel
Then the system generates a secure token via secrets.token_urlsafe(32)
  And stores only the SHA-256 hash of the token in Firestore
  And creates the packet in "issued" state
  And emits a "guardian.packet_issued" consent event
  And returns the raw delivery token to the teacher once (for manual sharing)
  And the teacher sees the guardian consent URL constructed from the token
```

### Scenario: Guardian grants consent via secure link

```gherkin
Given an issued guardian consent packet with a valid token
When the guardian navigates to /guardian/consent/:token (public, no auth required)
Then the system verifies the token hash against stored packets
  And displays the consent notice with: student name, class name, notice summary, and bullet points
When the guardian checks the acknowledgment checkbox
  And clicks "Grant Consent"
Then the system updates the packet status to "granted"
  And updates the student's compliance record: guardian_consent_status = "granted"
  And the student's voice_allowed status is recalculated
  And the page shows a read-only confirmation
```

### Scenario: Guardian revokes consent

```gherkin
Given an issued guardian consent packet
When the guardian clicks "Revoke Consent" after acknowledging
Then the packet status changes to "revoked"
  And the student's guardian_consent_status is set to "revoked"
  And the student's voice_allowed is recalculated to false (if they are a minor)
```

### Scenario: Teacher resends a guardian packet

```gherkin
Given an active (non-terminal) guardian consent packet
When the teacher clicks "Resend"
Then the system increments the reminder_count
  And updates last_sent_at
  And generates a new delivery token
  And emits a "guardian.packet_resent" consent event
  And displays the new token to the teacher
```

### Scenario: Packet expires after TTL

```gherkin
Given a guardian consent packet issued 15 days ago with the default 14-day TTL
When the system checks packet validity
Then the packet is considered expired
  And the guardian can no longer act on it
  And the teacher must issue a new packet
```

---

## Feature: Class Compliance Management

### Scenario: Teacher views the class compliance roster

```gherkin
Given a teacher with a class of 15 students
When the teacher navigates to /app/teacher/classes/:classId/compliance
Then the system returns per-student compliance records and guardian packet states
  And displays summary stats:
    | Metric | Description |
    | Total students | 15 |
    | Voice allowed | count of students with voice_allowed = true |
    | Voice blocked | count of students with voice_allowed = false |
    | Guardian action required | count of minors needing guardian consent |
    | Unknown consent | count with no consent state recorded |
  And each student row shows: name, minor/adult, guardian consent status, voice consent status, voice allowed, packet status
```

### Scenario: Teacher bulk-updates compliance for selected students

```gherkin
Given a teacher on the class compliance page with 5 students selected
When the teacher sets voice_consent_status = "granted" and provides a reason
  And clicks "Apply to Selected"
Then the system updates compliance records for all 5 students
  And emits "consent.bulk_updated" events for each student with a shared batchId
  And the roster refreshes showing updated consent states
```

### Scenario: Teacher exports the consent audit trail

```gherkin
Given a teacher on the class compliance page
When the teacher clicks "Export Audit Trail"
Then the system streams a CSV of all consent_events for this class
  And emits an "audit.exported" consent event
  And the browser downloads the CSV file
```

---

## Feature: Deletion Requests

### Scenario: School admin creates and approves a student-scope deletion request

```gherkin
Given a school admin on /app/admin/deletion-requests
When the admin creates a deletion request with scope = "student" and provides the student UID and a reason
Then the system validates the scope and requester role
  And creates a deletion_requests record with status "requested"
  And emits a "deletion.requested" consent event
When the admin approves the request
Then the status changes to "approved"
  And the target_collections are frozen at approval time:
    | Collection |
    | practice_sessions |
    | learning_events |
    | student_compliance_records |
    | consent_events |
    | guardian_consent_packets |
  And a "deletion.approved" consent event is emitted
```

### Scenario: School admin executes a deletion

```gherkin
Given an approved deletion request for student scope
When the admin clicks "Execute"
Then the system sets the request to "in_progress"
  And creates a deletion_execution_runs record
  And iterates over each target collection, deleting matching Firestore documents by org_id and student_uid
  And records per-collection deletion counts
  And on success, sets the request status to "completed"
  And emits a completion consent event with the execution summary
```

### Scenario: Deletion partially fails and admin retries

```gherkin
Given a deletion execution that failed on one collection
  And the request status is "partially_completed"
When the admin clicks "Retry"
Then the system increments the attempt number
  And re-runs deletion for all target collections
  And succeeds on the previously failed collection
  And updates the request status to "completed"
```

### Scenario: Teacher requests deletion but cannot self-approve

```gherkin
Given a teacher (not school admin)
When the teacher creates a deletion request for a student in their class
Then the request is created with status "requested"
But the teacher cannot approve or execute the request
  And only a school_admin can approve it
```

---

## Feature: Admin Org-Wide Compliance

### Scenario: Admin views org-wide compliance summary

```gherkin
Given a school admin on /app/admin/compliance
When the admin opens the Overview tab
Then the system returns org-wide compliance counts
  And displays total students, consent coverage, voice-eligible counts, and action-required counts
```

### Scenario: Admin filters the org compliance roster

```gherkin
Given a school admin on the Roster tab
When the admin filters by consentStatus = "not_granted" and classId = "class_abc"
Then the system returns only students matching both filters
  And the admin can bulk-update consent for the filtered selection
```

### Scenario: Admin tracks guardian packets org-wide

```gherkin
Given a school admin on the Packets tab
When the admin filters by packet status = "issued"
Then the system returns all issued guardian packets across the organization
  And each packet shows: student name, class, delivery method, contact channel, status, timestamps
```

---

## Feature: Canvas LMS Integration

### Scenario: Teacher validates Canvas credentials

```gherkin
Given a teacher on /app/teacher/classes/:classId/canvas/connect
When the teacher enters a Canvas instance URL and Personal Access Token (PAT)
  And clicks "Validate"
Then the system calls the Canvas API to verify the PAT
  And returns the teacher's Canvas identity and a list of available courses
  And the page advances to the course selection step
```

### Scenario: Teacher connects a Canvas course to a class

```gherkin
Given a validated Canvas connection with 5 available courses
When the teacher selects a course and clicks "Connect Course"
Then the system creates a canvas_connections record with the encrypted PAT (AES-256-GCM)
  And runs an initial roster sync:
    | Match | Result |
    | Canvas student email matches Lingual user | Active enrollment with join_source "canvas_sync" |
    | Canvas student email has no Lingual match | pending_sync enrollment (auto-activates on student login) |
  And runs a content sync: all Canvas module items are stored as canvas_course_content records
  And navigates the teacher to the class analytics page
```

### Scenario: Canvas roster sync activates on student login

```gherkin
Given a canvas_connections record with pending_sync enrollments for unmatched students
When a student logs in whose email matches a pending_sync enrollment
Then the auth flow detects the pending Canvas enrollment
  And activates it (status changes from pending_sync to active)
  And the student sees assignments for the Canvas-synced class
```

### Scenario: Teacher manually re-syncs Canvas

```gherkin
Given a class with an active Canvas connection
When the teacher clicks "Re-sync" on the Canvas sync status component
Then the system decrypts the stored PAT
  And runs roster sync (new students matched, unmatched get pending_sync)
  And runs content sync (new module items upserted, existing items updated)
  And the sync status component updates with the latest sync timestamp
```

### Scenario: Teacher links an assignment to a Canvas module item

```gherkin
Given a teacher on the assignment builder page with Canvas content loaded
When the teacher selects a Canvas module item from the link picker dropdown for an assignment
Then the system calls the link endpoint and stores the association
  And the Canvas item shows as "linked" in the picker
  And on the student's learning page, the Canvas module view shows a "Start Practice" button for that item
```

### Scenario: Student views Canvas modules on the learning page

```gherkin
Given a student enrolled in a Canvas-synced class
When the student navigates to /app/learn
Then the system loads Canvas course content for the student's enrolled classes
  And renders the CanvasModuleView component with module items grouped by Canvas module
  And items linked to Lingual assignments show a "Start Practice" button
  And items without a Lingual link show an "Open in Canvas" external link
```

### Scenario: Teacher disconnects Canvas

```gherkin
Given a class with an active Canvas connection
When the teacher clicks "Disconnect"
Then the system deletes the canvas_connections record
  And the sync status component shows "Not connected" with a "Connect Canvas" button
  And existing enrollments created via Canvas sync remain active
```

---

## Feature: Membership and Role Resolution

### Scenario: User login resolves school context

```gherkin
Given a user with 2 memberships: teacher in Org A and student in Org B
When the user's Firebase ID token is verified via /api/auth/verify
Then the backend queries all memberships for the user
  And selects the highest-priority active membership (teacher > student by SCHOOL_ROLE_PRIORITY)
  And loads the corresponding organization
  And returns the user object with memberships[], activeMembershipId, activeOrganizationId, and activeRoles
  And MembershipContext on the frontend derives a roleSet from the union of all memberships
```

### Scenario: TeacherRoute guards teacher pages

```gherkin
Given a user with only a student membership
When the user attempts to navigate to /app/teacher
Then TeacherRoute checks the role set for "teacher" or "school_admin"
  And the check fails
  And the user is redirected to /app/learn
```

```gherkin
Given a user with no memberships at all
When the user attempts to navigate to /app/teacher
Then TeacherRoute detects empty memberships
  And redirects the user to /school/setup
```

### Scenario: Backend enforces role-based access on every endpoint

```gherkin
Given a student attempting to call GET /api/teacher/dashboard
When the backend resolves the school request context
  And calls context.require_any_role({'teacher', 'school_admin'})
Then the check fails
  And the endpoint returns HTTP 403
```

---

## Feature: Consent Audit Trail

### Scenario: Consent events are logged for all compliance changes

```gherkin
Given a teacher updating a student's voice_consent_status to "granted"
When the update is saved via the compliance endpoint
Then the system emits a "consent.updated" event in the consent_events collection
  And the event includes: org_id, actor_uid, actor_role, student_uid, event_type, payload, timestamp
```

### Scenario: Disclosure logging on sensitive data access

```gherkin
Given a teacher viewing a student's analytics drill-down for the first time today
When the endpoint loads the student's practice data
Then the system checks if a "disclosure.practice_data_viewed" event exists for this actor + student + today
  And since it does not, creates a new consent_events record
  And subsequent views by the same teacher for the same student on the same day do not create duplicate events
```

---

## Feature: Public Compliance Page

### Scenario: School evaluator views compliance information

```gherkin
Given a school leader evaluating Lingual for adoption
When they navigate to /compliance (public, no auth required)
Then the page displays Lingual's data handling practices, consent workflows, retention policies, and compliance commitments
  And provides enough information for the evaluator to assess COPPA/FERPA readiness
```

---

## Feature: Student Curriculum Browsing (Legacy B2C Path)

### Scenario: Student browses the curriculum without an assignment

```gherkin
Given a student navigating to /app/curriculum
When the page loads the bundled sample curriculum package
Then the student sees units with expandable module cards
  And each module card shows: title, goal, situation count, and interaction contract summary (activity templates)
When the student clicks on a module
  And selects a situation and mode
Then a free-practice session is launched via the realtime chat without creating a practice_sessions record
  And no learning_events are emitted
  And the session does not appear in any teacher analytics
```

---

## Feature: Retention Policies

### Scenario: Standard school retention policy is applied

```gherkin
Given a student with retention_policy_id = "standard_school"
When the system resolves the retention policy
Then the policy specifies:
  | Field | Value |
  | Raw audio storage | 30 days |
  | Transcript storage | 365 days |
  | Analytics storage | 730 days |
  | Raw audio storage allowed | true |
```

### Scenario: No-raw-audio retention policy is applied

```gherkin
Given a student with retention_policy_id = "no_raw_audio"
When the system resolves the retention policy
Then the policy specifies:
  | Field | Value |
  | Raw audio storage allowed | false |
  | Transcript storage | 365 days |
  | Analytics storage | 730 days |
```

---

## Known Limitations Affecting Scenarios

The following constraints are shipped behavior documented in LIMITATIONS.md. They represent intentional narrowing from the target architecture:

| # | Limitation | Impact on Scenarios |
|---|-----------|---------------------|
| 1 | Single sample curriculum package (AP French) | All curriculum mapping and assignment scenarios use only the bundled sample package |
| 2 | Heuristic-based analytics (regex, not model-verified) | All derived event and analytics scenarios produce approximate signals |
| 3 | Estimated speaking time (word count / 2.3 wps) | Speaking time metrics in analytics scenarios are estimates |
| 4 | Pre-session pedagogy only (no live intervention) | Pedagogy engine scenarios apply at prompt assembly time, not mid-conversation |
| 5 | Dashboard speaking minutes hardcoded at 0 | Teacher dashboard summary scenario shows 0 for speaking minutes |
| 6 | downloadable_notice is staff-managed | Guardian packet "downloadable_notice" delivery does not generate a PDF artifact |
| 7 | Synchronous deletion execution | Deletion scenarios execute in-request, not via async Cloud Tasks |
| 8 | Firebase Storage deletion is placeholder | Deletion scenarios only clean Firestore; no raw audio files are deleted |
| 9 | Canvas PAT-only auth, manual sync | Canvas scenarios use PAT (no OAuth2) and require manual re-sync (no webhooks) |
| 10 | Disclosure logging covers 2 endpoints | Only teacher student drill-down and admin roster emit disclosure events |
| 11 | TeacherRoute does not distinguish teacher from school_admin | Admin page scenarios are accessible to teachers at the route level; server-side enforcement is the real gate |
| 12 | Student weekly stats are mocked | AppLearningPage scenario stats (streak, XP, etc.) are hardcoded constants |
