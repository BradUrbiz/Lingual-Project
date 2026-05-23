# Pilot Avatar Disable Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force the avatar off in the pilot runtime while keeping the avatar code dormant for later reuse.

**Architecture:** Add explicit frontend and backend pilot avatar gates that default to disabled. The chat UI ignores old local preference when the pilot gate is off, and the realtime backend refuses to attach avatar directives unless the pilot gate is enabled.

**Tech Stack:** React, Vite env flags, Flask, Python unittest, Vitest

---

### Task 1: Lock pilot force-off behavior with tests

**Files:**
- Modify: `frontend/src/pages/AppChatPage.avatar.test.tsx`
- Modify: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing frontend test**

Assert that `/app/chat` does not render `live2d-avatar` even when local storage says avatar is enabled.

- [ ] **Step 2: Write the failing backend test**

Assert that realtime avatar directives are skipped unless the pilot avatar flag is explicitly enabled.

- [ ] **Step 3: Run focused tests to verify failure**

Run:
- `npm run test -- AppChatPage.avatar.test.tsx`
- `pytest backend/tests/test_realtime_chat.py -q`

### Task 2: Implement pilot runtime gates

**Files:**
- Modify: `frontend/src/pages/AppChatPage.tsx`
- Modify: `backend/routes/chat.py`

- [ ] **Step 1: Add the frontend pilot avatar gate**
- [ ] **Step 2: Ignore old local storage when pilot avatar is disabled**
- [ ] **Step 3: Prevent frontend realtime avatar-directive requests**
- [ ] **Step 4: Add the backend pilot avatar gate**
- [ ] **Step 5: Prevent backend realtime directives unless the pilot gate is enabled**

### Task 3: Document and verify

**Files:**
- Modify: `docs/school-integration/LIMITATIONS.md`

- [ ] **Step 1: Add the pilot limitation note**
- [ ] **Step 2: Run focused tests**
- [ ] **Step 3: Run broader verification**
