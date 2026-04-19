# Hidden Assignment Time Limit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assignment conversations effectively untimed in product behavior by hiding time-limit semantics from prompts and UI while preserving a hidden backend cap of `6000` seconds.

**Architecture:** Keep `timeLimitSec` as an internal compatibility field in backend normalization and analytics payloads, but remove visible time-limit wording and UI affordances. Re-scope teacher assignment analytics so it emphasizes assignment evidence and rubric outcomes instead of class-level engagement metrics.

**Tech Stack:** Python backend services and unit tests, React 19 + TypeScript frontend, Vitest, school-integration docs.

---

## File Structure

- Modify: `backend/services/assignment_resolver.py`
  Responsibility: hidden evidence defaults, prompt assembly, assignment overlay text.
- Modify: `backend/tests/test_pedagogy_prompting.py`
  Responsibility: regression coverage for prompt wording and hidden defaults.
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx`
  Responsibility: remove time-limit display, remove signal-coverage section, remove class-style summary cards, relabel recent sessions.
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.test.tsx`
  Responsibility: UI regression coverage for removed analytics sections and preserved assignment evidence.
- Modify: `docs/school-integration/BDD_SCENARIOS.md`
  Responsibility: align written product behavior with untimed assignment conversations.

## Chunk 1: Backend Hidden Time-Limit Behavior

### Task 1: Add prompt/default regression tests

**Files:**
- Modify: `backend/tests/test_pedagogy_prompting.py`
- Modify: `backend/services/assignment_resolver.py`

- [ ] **Step 1: Write the failing tests**

Add assertions that:

- task-template prompt no longer includes `finish within about`
- assignment system prompt no longer includes `Evidence time limit sec`
- canvas/assignment fallback evidence default is `6000`

- [ ] **Step 2: Run the focused backend test file**

Run: `pytest backend/tests/test_pedagogy_prompting.py -q`
Expected: FAIL on the new assertions

- [ ] **Step 3: Implement the minimal backend change**

Update `assignment_resolver.py` so visible prompt text omits time-limit language and internal defaults use `6000`.

- [ ] **Step 4: Re-run the focused backend test file**

Run: `pytest backend/tests/test_pedagogy_prompting.py -q`
Expected: PASS

## Chunk 2: Assignment Analytics UI Scope Cleanup

### Task 2: Add failing frontend regression coverage

**Files:**
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.test.tsx`
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx`

- [ ] **Step 1: Write the failing test assertions**

Add assertions that the page does not render:

- `Signal coverage`
- `Time limit`
- `Sessions`
- `Speaking minutes`

and does render the preserved assignment evidence sections plus `Recent attempts`.

- [ ] **Step 2: Run the focused frontend test file**

Run: `cd frontend && npm run test -- TeacherAssignmentAnalyticsPage.test.tsx`
Expected: FAIL on the new assertions

- [ ] **Step 3: Implement the minimal frontend change**

Remove the summary stats grid and signal-coverage section, remove the time-limit tile, and relabel the recent sessions card to `Recent attempts`.

- [ ] **Step 4: Re-run the focused frontend test file**

Run: `cd frontend && npm run test -- TeacherAssignmentAnalyticsPage.test.tsx`
Expected: PASS

## Chunk 3: Docs Alignment

### Task 3: Update written product behavior

**Files:**
- Modify: `docs/school-integration/BDD_SCENARIOS.md`

- [ ] **Step 1: Update the BDD wording**

Change assignment evidence-target wording so it no longer lists a time limit.

- [ ] **Step 2: Sanity-check the diff**

Run: `git diff -- docs/school-integration/BDD_SCENARIOS.md`
Expected: only wording changes for assignment evidence targets

## Chunk 4: Final Verification

### Task 4: Run fresh verification before completion

**Files:**
- Modify: `backend/tests/test_pedagogy_prompting.py`
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.test.tsx`
- Modify: `backend/services/assignment_resolver.py`
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx`
- Modify: `docs/school-integration/BDD_SCENARIOS.md`

- [ ] **Step 1: Run backend verification**

Run: `pytest backend/tests/test_pedagogy_prompting.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `cd frontend && npm run test -- TeacherAssignmentAnalyticsPage.test.tsx`
Expected: PASS

- [ ] **Step 3: Review final diff**

Run: `git diff -- backend/services/assignment_resolver.py backend/tests/test_pedagogy_prompting.py frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx frontend/src/pages/TeacherAssignmentAnalyticsPage.test.tsx docs/school-integration/BDD_SCENARIOS.md`
Expected: only the scoped hidden-time-limit and assignment-analytics changes
