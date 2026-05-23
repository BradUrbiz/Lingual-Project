# Assignment Practice Workspace Design

Status: Approved
Date: 2026-04-19

## Problem

The current student assignment launch experience treats the live transcript as a secondary card on the right side of `AssignmentLaunchPage`. As the conversation grows, the transcript keeps extending downward and makes the page longer. This makes realtime practice feel like a diagnostic log instead of a focused conversation workspace.

The product direction for this follow-up is:

- conversation should become the primary surface during assignment practice
- assignment scope and teacher guidance must stay visible while practicing
- practice history must be scoped to the current assignment
- students must be able to resume the latest active assignment thread
- students must also be able to start new attempts and reopen older threads

## Approved Product Direction

`AssignmentLaunchPage` remains the launcher and assignment overview page.

Clicking `Start assignment practice` opens a large in-page workspace dialog rather than navigating to a new route.

Inside the workspace:

- the left context panel shows assignment-relative guidance:
  - practice scope
  - objectives
  - target expressions
  - focus grammar
  - success criteria
  - teacher notes
- the right side behaves like a compact, assignment-scoped version of `/app/chat`
- the chat history sidebar only shows threads for the current assignment

This replaces the current growing transcript card with a dedicated conversation workspace.

## Core Model

This design distinguishes between a `thread` and an `attempt`.

### Thread

A thread is the persistent conversation history stored in a single `chatId`.

A thread can be reopened later and its messages remain available in the assignment workspace sidebar.

### Attempt

An attempt is a `PracticeSession`.

An attempt references:

- `assignmentId`
- `studentUid`
- `chatId`

Multiple attempts may reference the same `chatId`.

This is required for the approved behavior:

- opening an older thread does not mutate the old attempt
- resuming that older thread creates a new attempt on top of the existing thread
- analytics remain attempt-based instead of blending multiple practice runs into one record

## Session Semantics

### Resume behavior

When the assignment workspace opens:

1. if a latest active attempt exists, the workspace auto-selects that thread
2. otherwise, the workspace selects the most recently updated assignment thread
3. if no thread exists yet, the workspace opens in an empty-state ready to start a first attempt

If the selected thread already has an active attempt, the workspace resumes it directly.

If the selected thread has no active attempt, the workspace can show prior transcript history immediately, but the student must click `Resume this thread` to create a new active attempt on that thread.

### New attempt behavior

`New attempt` creates:

- a new chat session
- a new practice session linked to that new chat

The new thread becomes selected and active immediately.

### Resume old thread behavior

When a student clicks `Resume this thread` on a non-active historical thread:

- Lingual creates a new `PracticeSession`
- the new practice session reuses that thread's existing `chatId`
- the older completed attempt remains unchanged
- the transcript context stays intact because the chat history is reused

This matches the approved decision that resuming an old thread should create a new attempt record, not continue the old one.

### Ending vs closing

The workspace needs separate semantics for `End session` and `Close workspace`.

`End session`:

- ends the active practice session
- records `session.ended`
- leaves the thread in the sidebar as a historical thread

`Close workspace`:

- closes the dialog
- disconnects any active realtime transport
- does not automatically mark the attempt completed

This is necessary so a student can close the modal and later resume the latest active thread exactly where they left off.

Page unload or route leave should still preserve the existing safety behavior of marking the active session as abandoned if the student actually leaves the page entirely.

## UX Design

## 1. Entry point

`AssignmentLaunchPage` keeps the current top-level assignment summary and `Start assignment practice` CTA.

The transcript card is no longer the primary experience. Once the new workspace is available, the launch page should function as a setup and context page, while actual practice happens inside the dialog.

## 2. Workspace layout

Desktop workspace layout:

- left column: assignment context panel
- center-left narrow rail: assignment thread history
- right main panel: chat surface

### Left context panel

The left panel reuses current assignment bootstrap data already shown on the launch page:

- curriculum scope or generated scenario
- objectives
- target expressions
- focus grammar
- success criteria
- teacher notes

This panel should stay visible while chatting so students do not need to scroll away from the conversation to remember what they are supposed to practice.

### Thread history rail

This rail behaves like a smaller assignment-scoped version of the existing `/app/chat` sidebar.

Each thread item should show:

- thread title
- last updated timestamp
- status badge such as `Active` or `Past attempt`
- attempt count for that thread if more than one attempt exists

Available actions:

- select thread
- `New attempt`
- `Resume this thread` when viewing a non-active thread

The rail only includes threads associated with the current assignment.

### Main chat panel

The main panel should visually follow the `/app/chat` conversation layout rather than the current transcript card.

Requirements:

- fixed-height transcript area with internal scrolling
- realtime and text messages rendered as chat bubbles
- persistent header with current thread title and status
- realtime status controls for connect/disconnect
- text composer for text-only launch mode

The main panel should feel like a real conversation workspace, not a diagnostic event viewer.

## 3. Mobile behavior

On smaller screens, conversation remains primary.

Behavior:

- main chat panel fills the modal body
- assignment context becomes a tab, sheet, or collapsible panel
- thread history becomes a drawer or temporary sidebar

The mobile rule is simple: keep transcript readability and input usability ahead of always-visible context chrome.

## Frontend Design

## Component strategy

Do not copy `AppChatPage` wholesale into the assignment flow.

Instead:

- extract the reusable chat workspace patterns from `/app/chat`
- keep assignment-specific state and controls inside the assignment flow

New components should likely include:

- `AssignmentPracticeWorkspace`
- `AssignmentContextPanel`
- `AssignmentThreadSidebar`
- reusable assignment-scoped message list / chat stage pieces derived from `AppChatPage`

`AssignmentLaunchPage` becomes the host page that:

- loads bootstrap data
- opens/closes the workspace dialog
- passes assignment context into the workspace

## State responsibilities

The workspace owns:

- selected thread
- selected chat id
- active practice session
- assignment thread list
- loaded chat history for the selected thread
- realtime connection state
- text-mode send state

The launch page should not keep rendering a duplicate transcript card outside the modal.

## Realtime behavior

The existing `useRealtimeChat` hook remains the transport layer.

What changes is the shell around it:

- messages render in a dedicated chat viewport
- reconnect/end controls move into the workspace header
- closing the dialog disconnects transport without auto-completing the attempt

## Backend Design

The existing backend already supports:

- assignment bootstrap
- practice session creation
- practice event reporting
- chat session loading by `chatId`

The missing capability is a student-facing read model for assignment-scoped thread history and resumable attempts.

## 1. Student assignment workspace endpoint

Add a new student-facing read endpoint:

`GET /api/student/assignments/<assignment_id>/workspace`

This endpoint should return:

- assignment bootstrap data or the subset needed by the workspace
- assignment-scoped thread summaries for the current student
- the latest active practice session if one exists
- grouped attempt metadata per thread

Suggested response shape:

```json
{
  "success": true,
  "workspace": {
    "bootstrap": {},
    "selectedChatId": "chat-123",
    "latestActivePracticeSessionId": "practice-9",
    "threads": [
      {
        "chatId": "chat-123",
        "title": "Could I have the soup, please?",
        "updatedAt": "2026-04-19T02:10:00Z",
        "messageCount": 12,
        "hasActiveAttempt": true,
        "latestPracticeSession": {},
        "attempts": []
      }
    ]
  }
}
```

This endpoint should only expose the current student's data for that assignment.

## 2. Practice session creation remains the write path

Keep:

`POST /api/student/assignments/<assignment_id>/practice-sessions`

The existing optional `chatId` already provides the core write primitive needed for both cases:

- absent `chatId` -> create a brand-new thread attempt
- existing `chatId` -> create a new attempt attached to an older thread

No separate resume endpoint is required if the current create route continues to accept an existing `chatId`.

## 3. Active attempt resolution

The workspace endpoint should resolve the student's effective active attempt as:

- the most recently started assignment practice session with `status == active`

If multiple active sessions exist because of legacy behavior, the UI should resume the most recent one and treat the others as stale history until cleanup logic is introduced.

## 4. Chat history loading

The frontend may keep using the existing chat-session read API for message loading once a `chatId` is selected.

The new workspace endpoint is for thread discovery and assignment scoping, not for duplicating full transcript payloads unnecessarily.

## Attempt Lifecycle Rules

When starting a new attempt or resuming a different historical thread while another attempt is active, the frontend should first end the currently active attempt with a restart/switch reason, then create the new attempt.

This keeps active-attempt state understandable for both the student UI and analytics.

Recommended end reasons:

- `manual_disconnect`
- `restarted`
- `thread_resumed`
- `page_leave`

The exact reason vocabulary can be normalized during implementation, but switching threads should not silently leave multiple current attempts open from the same student action.

## Testing

Minimum coverage for this redesign:

1. Backend route test: student workspace endpoint returns only assignment-scoped threads for the current student
2. Backend route test: creating a practice session with an existing `chatId` creates a new attempt without mutating the old one
3. Frontend test: clicking `Start assignment practice` opens the workspace dialog instead of relying on the inline transcript card
4. Frontend test: latest active assignment thread auto-loads on workspace open
5. Frontend test: `New attempt` creates a new thread and active practice session
6. Frontend test: selecting an old thread and clicking `Resume this thread` creates a new attempt on the same `chatId`
7. Frontend test: closing the workspace disconnects realtime transport without auto-ending the active attempt

## Non-goals

This redesign does not:

- move assignment practice to a separate route
- merge assignment history into the global `/app/chat` sidebar
- redesign the teacher-facing assignment analytics UI
- change the underlying scoring or pedagogical event model
- remove text-only fallback behavior
