# Assignment Practice Workspace Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline assignment transcript with an assignment-scoped practice workspace dialog that keeps assignment guidance visible, shows assignment-only thread history, resumes the latest active thread, and supports new attempts plus resuming old threads as new attempts.

**Architecture:** Add a student-facing assignment workspace read API that groups the current student's practice sessions by `chatId` and returns thread summaries plus the latest active session. On the frontend, keep `AssignmentLaunchPage` as the launcher page and move live practice into a dedicated workspace dialog component with a left context panel, a thread sidebar, and a chat panel that reuses existing chat transport and message APIs.

**Tech Stack:** Python 3.12, Flask, Firestore helper layer in `database.py`, React 19, TypeScript, Vitest, unittest

**Spec:** `docs/superpowers/specs/2026-04-19-assignment-practice-workspace-design.md`

---

## File Structure

### Backend files

- Modify: `database.py`
  - Add an assignment+student practice-session listing helper so the workspace route can query only the current student's sessions for one assignment.
- Create: `backend/services/assignment_workspace.py`
  - Build the workspace response shape: group attempts into threads by `chatId`, derive active/latest thread selection, and attach chat metadata.
- Modify: `backend/routes/curriculum_admin.py`
  - Add `GET /api/student/assignments/<assignment_id>/workspace`.
- Test: `backend/tests/test_curriculum_admin_routes_full.py`
  - Route-level coverage for workspace reads and resume-via-existing-chat behavior.
- Test: `backend/tests/test_curriculum_admin_routes.py`
  - Focused fake-db coverage for smaller route expectations if needed.

### Frontend files

- Modify: `frontend/src/types/assignment.ts`
  - Add workspace DTO types (`AssignmentWorkspaceData`, thread summary, thread attempt summary).
- Modify: `frontend/src/api/assignments.ts`
  - Add workspace fetch client.
- Create: `frontend/src/components/assignments/AssignmentContextPanel.tsx`
  - Render assignment scope, objectives, and teacher overlay in a focused reusable panel.
- Create: `frontend/src/components/assignments/AssignmentThreadSidebar.tsx`
  - Render assignment-only thread list and thread actions.
- Create: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx`
  - Own dialog state, selected thread/chat, loaded chat messages, attempt switching, realtime connect/disconnect, and text-only send flow.
- Modify: `frontend/src/pages/AssignmentLaunchPage.tsx`
  - Remove the inline transcript as the primary experience and mount the workspace dialog from the launcher CTA.
- Test: `frontend/src/pages/AssignmentLaunchPage.test.tsx`
  - Cover dialog open + initial assignment workspace behavior.
- Create: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`
  - Cover thread selection, new attempt, resume old thread, and close-vs-end behavior.

### Existing files reused without major refactor

- Reuse: `frontend/src/api/chat.ts`
  - Existing chat load/create/send/save APIs remain the underlying message transport surface.
- Reuse: `frontend/src/components/chat/ChatInput.tsx`
  - Existing text composer for text-only mode.
- Reuse: `frontend/src/hooks/useRealtimeChat.ts`
  - Existing realtime transport hook remains the voice session transport.

---

## Chunk 1: Backend Workspace Read Model

### Task 1: Add a student-assignment practice-session listing seam

**Files:**
- Modify: `database.py`
- Test: `backend/tests/test_curriculum_admin_routes_full.py`

- [ ] **Step 1: Write the failing backend test for student assignment workspace listing**

Add a test that seeds:
- one published assignment
- multiple practice sessions for the same student on that assignment
- two sessions that share one `chatId`
- one session for a different assignment or student that must not appear

The test should assert the eventual workspace route only sees the current student's sessions for the requested assignment.

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run:

```bash
python3 -m unittest backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_get_student_assignment_workspace_filters_to_current_student_and_assignment -v
```

Expected:
- the test fails because the workspace route/helper does not exist yet

- [ ] **Step 3: Add the minimal database helper**

Add a helper like:

```python
def list_student_assignment_practice_sessions(assignment_id, student_uid):
    docs = (
        get_practice_sessions_collection()
        .where('assignment_id', '==', assignment_id)
        .where('student_uid', '==', student_uid)
        .stream()
    )
```

Keep it narrow and read-only.

- [ ] **Step 4: Re-run the focused backend test and confirm it still fails for the missing route/service rather than the query seam**

Run the same unittest command and confirm the failure moved to the still-unimplemented route behavior.

### Task 2: Add the student assignment workspace service and route

**Files:**
- Create: `backend/services/assignment_workspace.py`
- Modify: `backend/routes/curriculum_admin.py`
- Test: `backend/tests/test_curriculum_admin_routes_full.py`

- [ ] **Step 1: Write the failing route test for `GET /api/student/assignments/<assignment_id>/workspace`**

The test should assert the response contains:
- `bootstrap`
- `selectedChatId`
- `latestActivePracticeSessionId`
- `threads`

At minimum, one thread should include:
- `chatId`
- `title`
- `updatedAt`
- `messageCount`
- `hasActiveAttempt`
- `latestPracticeSession`
- `attempts`

- [ ] **Step 2: Run the focused route test to verify it fails**

Run:

```bash
python3 -m unittest backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_get_student_assignment_workspace_returns_grouped_threads_and_active_selection -v
```

Expected:
- FAIL with 404 or missing fields because the route/service does not exist yet

- [ ] **Step 3: Implement the workspace builder service**

In `backend/services/assignment_workspace.py`:
- group practice sessions by `chatId`
- sort attempts within each thread by `started_at` / `created_at`
- detect the latest active practice session
- choose `selectedChatId` using the approved rule:
  - latest active thread first
  - else most recently updated thread
  - else `null`
- fetch chat details with `deps.db.get_chat_session(uid, chat_id)` to derive `title`, `updatedAt`, and `messageCount`
- serialize each attempt using existing `serialize_practice_session`

Keep grouping and sorting logic out of the route file.

- [ ] **Step 4: Implement the new student route**

Add to `backend/routes/curriculum_admin.py`:

```python
@bp.route('/api/student/assignments/<assignment_id>/workspace', methods=['GET'])
@deps.login_required
def api_get_student_assignment_workspace(assignment_id):
    ...
```

Use:
- `resolve_assignment_bootstrap_for_user(...)`
- current user uid from `deps`
- new listing helper
- new workspace builder service

Return:

```json
{
  "success": true,
  "workspace": { ... }
}
```

- [ ] **Step 5: Re-run the focused backend route test and confirm it passes**

Run the same unittest command from Step 2.

Expected:
- PASS

### Task 3: Lock in resume-old-thread-as-new-attempt semantics

**Files:**
- Modify: `backend/tests/test_curriculum_admin_routes_full.py`
- Optionally modify: `backend/routes/curriculum_admin.py` only if validation gaps appear

- [ ] **Step 1: Write the failing backend test for creating a new attempt with an existing `chatId`**

The test should:
- create an existing completed practice session on `chat-123`
- call `POST /api/student/assignments/<assignment_id>/practice-sessions` with `chatId: "chat-123"`
- assert a new practice session id is created
- assert the returned `practiceSession.chatId` is still `chat-123`
- assert the old session record remains unchanged

- [ ] **Step 2: Run the focused backend test to verify current behavior**

Run:

```bash
python3 -m unittest backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_create_practice_session_allows_new_attempt_on_existing_chat_id -v
```

Expected:
- either PASS immediately, proving the write path already supports resume semantics
- or FAIL with a concrete validation gap to fix

- [ ] **Step 3: Implement only the minimal backend adjustment if the test exposed a gap**

Do not add a separate resume endpoint unless the existing create route cannot support this behavior.

- [ ] **Step 4: Re-run both focused backend tests**

Run:

```bash
python3 -m unittest \
  backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_get_student_assignment_workspace_returns_grouped_threads_and_active_selection \
  backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_create_practice_session_allows_new_attempt_on_existing_chat_id \
  -v
```

Expected:
- both PASS

---

## Chunk 2: Frontend Types and Workspace Shell

### Task 4: Add assignment workspace DTOs and API client support

**Files:**
- Modify: `frontend/src/types/assignment.ts`
- Modify: `frontend/src/types/index.ts` if export wiring requires it
- Modify: `frontend/src/api/assignments.ts`
- Test: `frontend/src/pages/AssignmentLaunchPage.test.tsx`

- [ ] **Step 1: Write the failing frontend test that expects workspace data to be fetched when practice starts**

Extend `AssignmentLaunchPage.test.tsx` so it expects:
- the workspace fetch client to be called when opening the new workspace flow
- or the component tree to render content that depends on workspace data

Use mocked workspace data with:
- one active thread
- one historical thread

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run:

```bash
cd frontend && npm run test -- AssignmentLaunchPage.test.tsx
```

Expected:
- FAIL because workspace DTOs/client do not exist yet

- [ ] **Step 3: Add the workspace types**

In `frontend/src/types/assignment.ts`, add types for:
- `AssignmentWorkspaceThreadAttempt`
- `AssignmentWorkspaceThread`
- `AssignmentWorkspaceData`

Each thread type should include at least:
- `chatId`
- `title`
- `updatedAt`
- `messageCount`
- `hasActiveAttempt`
- `latestPracticeSession`
- `attempts`

- [ ] **Step 4: Add the workspace API client**

In `frontend/src/api/assignments.ts`, add:

```ts
export const getStudentAssignmentWorkspace = async (
  assignmentId: string
): Promise<AssignmentWorkspaceData> => { ... }
```

using:

```ts
GET /student/assignments/${assignmentId}/workspace
```

- [ ] **Step 5: Re-run the focused frontend test and confirm the failure moves to missing UI behavior rather than types/client gaps**

Run the same Vitest command from Step 2.

### Task 5: Build the assignment context panel and thread sidebar

**Files:**
- Create: `frontend/src/components/assignments/AssignmentContextPanel.tsx`
- Create: `frontend/src/components/assignments/AssignmentThreadSidebar.tsx`
- Create: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`

- [ ] **Step 1: Write failing component tests for the context panel and thread sidebar**

Cover:
- context panel shows objectives and teacher notes from bootstrap data
- thread sidebar lists only assignment threads
- active thread badge renders
- historical thread renders a `Resume this thread` action

- [ ] **Step 2: Run the focused component test to verify it fails**

Run:

```bash
cd frontend && npm run test -- AssignmentPracticeWorkspace.test.tsx
```

Expected:
- FAIL because the new components do not exist yet

- [ ] **Step 3: Implement `AssignmentContextPanel`**

Render:
- scope/situation
- objectives
- target expressions
- focus grammar
- success criteria
- teacher notes

Keep it purely presentational.

- [ ] **Step 4: Implement `AssignmentThreadSidebar`**

Render:
- thread title
- timestamp
- status badge (`Active` / historical)
- `New attempt`
- `Resume this thread` for non-active thread selection

Keep actions passed in as props.

- [ ] **Step 5: Re-run the focused component test and confirm it passes**

Run the same Vitest command from Step 2.

---

## Chunk 3: Workspace Dialog and Assignment Flow Integration

### Task 6: Build the workspace dialog orchestration component

**Files:**
- Create: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx`
- Modify: `frontend/src/api/chat.ts` only if small helper additions make message loading cleaner
- Test: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`

- [ ] **Step 1: Write the failing workspace behavior tests**

Cover:
- auto-select latest active thread on open
- load messages for selected `chatId`
- selecting a historical thread shows its transcript
- clicking `New attempt` creates a new chat then a new practice session
- clicking `Resume this thread` creates a new practice session on the selected existing `chatId`

- [ ] **Step 2: Run the focused workspace behavior test to verify it fails**

Run:

```bash
cd frontend && npm run test -- AssignmentPracticeWorkspace.test.tsx
```

Expected:
- FAIL because orchestration behavior is not implemented yet

- [ ] **Step 3: Implement the workspace state machine**

`AssignmentPracticeWorkspace.tsx` should own:
- open/close lifecycle
- selected thread/chat
- loaded chat detail via `getChatSession(chatId)`
- active practice session
- realtime vs text launch behavior
- `New attempt`
- `Resume this thread`

Use existing primitives:
- `createChatSession`
- `getChatSession`
- `createAssignmentPracticeSession`
- `reportPracticeSessionEvent`
- `sendChatMessage`
- `saveMessageToChat`
- `useRealtimeChat`

- [ ] **Step 4: Implement close-vs-end semantics**

Behavior:
- closing dialog disconnects realtime transport
- closing dialog does not auto-send `session.ended`
- explicit `End session` sends `session.ended` and updates active state

- [ ] **Step 5: Re-run the focused workspace test and confirm it passes**

Run the same Vitest command from Step 2.

### Task 7: Integrate the workspace into `AssignmentLaunchPage`

**Files:**
- Modify: `frontend/src/pages/AssignmentLaunchPage.tsx`
- Modify: `frontend/src/pages/AssignmentLaunchPage.test.tsx`
- Test: `frontend/src/pages/AssignmentLaunchPage.blocked.test.tsx`

- [ ] **Step 1: Write the failing page-level test for dialog launch**

The test should assert:
- clicking `Start assignment practice` opens the workspace dialog
- the launch page no longer relies on the right-column transcript card as the primary interaction

- [ ] **Step 2: Run the focused page test to verify it fails**

Run:

```bash
cd frontend && npm run test -- AssignmentLaunchPage.test.tsx AssignmentLaunchPage.blocked.test.tsx
```

Expected:
- FAIL because the page still renders the old inline transcript-first layout

- [ ] **Step 3: Refactor `AssignmentLaunchPage` into launcher + dialog host**

Keep on page:
- assignment header
- limitations / compliance notices
- start CTA

Move practice UI responsibility into `AssignmentPracticeWorkspace`.

Do not regress:
- blocked launch states
- text-only fallback notice
- teacher preview notice

- [ ] **Step 4: Re-run the focused page tests and confirm they pass**

Run the same Vitest command from Step 2.

### Task 8: Keep mobile and layout behavior sane without widening scope

**Files:**
- Modify: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx`
- Test: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`

- [ ] **Step 1: Add a failing test or DOM assertion for mobile-priority layout hooks if practical**

If a DOM-level test is too brittle, skip the extra test and verify this in the final UI build/test step instead.

- [ ] **Step 2: Implement the minimal responsive behavior**

For the first shipping version:
- desktop: visible context panel + visible thread rail + main chat panel
- mobile: keep chat panel primary and collapse context/sidebar behind simple toggles or stacked sections

Do not introduce a full responsive redesign beyond what is required to keep the workspace usable.

- [ ] **Step 3: Re-run the workspace test suite**

Run:

```bash
cd frontend && npm run test -- AssignmentPracticeWorkspace.test.tsx
```

Expected:
- PASS

---

## Chunk 4: Verification and Cleanup

### Task 9: Run focused backend and frontend verification

**Files:**
- No new files

- [ ] **Step 1: Run the focused backend test set**

Run:

```bash
python3 -m unittest \
  backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_get_student_assignment_workspace_filters_to_current_student_and_assignment \
  backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_get_student_assignment_workspace_returns_grouped_threads_and_active_selection \
  backend.tests.test_curriculum_admin_routes_full.CurriculumAdminRoutesTestCase.test_create_practice_session_allows_new_attempt_on_existing_chat_id \
  -v
```

Expected:
- PASS

- [ ] **Step 2: Run the focused frontend test set**

Run:

```bash
cd frontend && npm run test -- \
  AssignmentLaunchPage.test.tsx \
  AssignmentLaunchPage.blocked.test.tsx \
  AssignmentPracticeWorkspace.test.tsx
```

Expected:
- PASS

- [ ] **Step 3: Run the frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected:
- exit code 0

### Task 10: Record any intentional scope limits

**Files:**
- Modify: `docs/school-integration/LIMITATIONS.md` only if the shipped workspace is intentionally narrower than the approved design

- [ ] **Step 1: Review the shipped behavior against the spec**
- [ ] **Step 2: Update `LIMITATIONS.md` only if any planned behavior is intentionally deferred**
- [ ] **Step 3: Summarize what shipped, what was verified, and any remaining gaps**
