# Assignment Realtime Fast Path Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated assignment bootstrap work from realtime session creation while preserving fresh access and consent checks.

**Architecture:** Add a `practiceSessionId` fast path in the realtime route. Reuse prompt-relevant snapshot data stored on the practice session, but still load the live assignment/class records to enforce current assignment access and current launch policy.

**Tech Stack:** Flask, Firestore-backed route deps, Python unittest/pytest

---

## Chunk 1: Realtime Route Fast Path

### Task 1: Lock the route behavior with failing tests

**Files:**
- Modify: `backend/tests/test_realtime_chat.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing test for prompt fast path**

Add a test that posts to `/api/realtime/session` with `assignmentId` and `practiceSessionId`, then asserts the route succeeds without calling `resolve_assignment_bootstrap_for_user(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL because the route still re-runs full assignment bootstrap.

- [ ] **Step 3: Write the failing test for fresh consent blocking**

Add a second test that uses the same fast path but revokes current voice permission, then asserts the route returns `403`.

- [ ] **Step 4: Run test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL because the fast path is not implemented yet.

### Task 2: Add snapshot-backed prompt reconstruction

**Files:**
- Modify: `backend/services/assignment_resolver.py`
- Modify: `backend/services/practice_analytics.py`
- Modify: `database.py`

- [ ] **Step 1: Store the missing prompt snapshot fields on new practice sessions**

Add `system_prompt_preview` and `class_snapshot` to `build_practice_session_payload(...)`.

- [ ] **Step 2: Add a helper that rebuilds a prompt bootstrap from a practice session snapshot**

Create a helper that assembles the minimal bootstrap shape required by `build_assignment_system_prompt(...)` from:
- `assignment_snapshot`
- `mapping_snapshot`
- `curriculum_snapshot`
- `class_snapshot`
- current `launch` policy
- current `teacher_preview`
- stored `system_prompt_preview`

- [ ] **Step 3: Keep a fallback for older sessions**

If a session is missing required snapshot fields, return `None` so the route can fall back to the existing full-bootstrap path.

### Task 3: Implement the realtime fast path

**Files:**
- Modify: `backend/routes/chat.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Parse `practiceSessionId` from realtime payload**

Add a helper that reads `practice.practiceSessionId`.

- [ ] **Step 2: Validate the referenced practice session**

Ensure it exists, belongs to the current user, is active, and matches the assignment.

- [ ] **Step 3: Re-run only the current access and launch policy**

Load the current assignment/class records and recompute:
- current assignment access
- current teacher preview
- current launch policy / voice permission

- [ ] **Step 4: Build prompt from the practice session snapshot**

Use the snapshot helper when possible. Fall back to `resolve_assignment_bootstrap_for_user(...)` only for older sessions missing the new snapshot fields.

- [ ] **Step 5: Run the focused tests**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS

## Chunk 2: Verification

### Task 4: Run broader regression checks

**Files:**
- Test: `backend/tests/test_realtime_chat.py`
- Test: related assignment/realtime slices as needed

- [ ] **Step 1: Run the focused realtime suite**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS

- [ ] **Step 2: Run adjacent backend regression coverage**

Run: `pytest backend/tests/test_curriculum_admin_routes_full.py -q`
Expected: PASS or only pre-existing unrelated failures.

- [ ] **Step 3: Summarize residual risk**

Document that older pre-patch practice sessions still use fallback until replaced by newly created sessions.
