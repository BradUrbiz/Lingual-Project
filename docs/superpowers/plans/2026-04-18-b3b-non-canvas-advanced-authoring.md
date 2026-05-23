# B3b Non-Canvas Advanced Authoring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-Canvas Advanced authoring so teachers can generate assignments from pasted instructional materials or author them manually without Canvas linkage.

**Architecture:** Keep Quick Assign Canvas-only. Extend Advanced mode with `AI-assisted source` and `Manual authoring`, backed by a new source-text draft generation route and a broadened direct-field assignment create path that does not require `mappingId`.

**Tech Stack:** Python 3.12, Flask, React 19, TypeScript, Vitest, unittest

**Spec:** `docs/superpowers/specs/2026-04-18-b3b-non-canvas-advanced-authoring-design.md`

---

## Chunk 1: Backend

### Task 1: Allow direct-field assignment creation without `mappingId`

**Files:**
- Modify: `backend/routes/curriculum_admin.py`
- Test: `backend/tests/test_curriculum_admin_routes_full.py`

- [ ] **Step 1: Write the failing route test**
- [ ] **Step 2: Run it to verify it fails because `mappingId` is currently required**
- [ ] **Step 3: Implement the direct-field create path with teacher/class auth checks**
- [ ] **Step 4: Run the focused backend test to verify it passes**

### Task 2: Add source-text assignment draft generation

**Files:**
- Modify or create: backend teacher route module
- Test: `backend/tests/test_curriculum_admin_routes_full.py`

- [ ] **Step 1: Write the failing route test for `POST /assignment-drafts/generate`**
- [ ] **Step 2: Run it to verify it fails**
- [ ] **Step 3: Implement the route with source-text validation and teacher/class auth checks**
- [ ] **Step 4: Run the focused backend test to verify it passes**

### Task 3: Verify backend regression safety

**Files:**
- Test: `backend/tests/test_canvas_practice.py`
- Test: `backend/tests/test_assignment_resolver.py`
- Test: `backend/tests/test_curriculum_admin_routes.py`

- [ ] **Step 1: Run backend assignment/canvas focused tests**
- [ ] **Step 2: Fix any regressions**
- [ ] **Step 3: Run `python3 -m unittest discover backend/tests`**

## Chunk 2: Frontend

### Task 4: Extend API client surface

**Files:**
- Modify: `frontend/src/api/assignments.ts`
- Modify or create: draft-generation client module

- [ ] **Step 1: Add failing frontend tests that need new API calls**
- [ ] **Step 2: Extend the client surface for source-text generation and direct-field assignment create**
- [ ] **Step 3: Run the focused frontend test to confirm the mocks/types line up**

### Task 5: Add Advanced entry-mode selector

**Files:**
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.tsx`
- Test: `frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx`

- [ ] **Step 1: Write failing test for AI-assisted source mode**
- [ ] **Step 2: Write failing test for Manual authoring mode**
- [ ] **Step 3: Implement the Advanced mode selector and mode-specific inputs**
- [ ] **Step 4: Reuse the shared review form for all Advanced paths**
- [ ] **Step 5: Run the focused frontend test to verify both paths pass**

### Task 6: Preserve Canvas behavior

**Files:**
- Test: `frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx`

- [ ] **Step 1: Re-run the existing Canvas-focused tests**
- [ ] **Step 2: Fix any Canvas regressions**
- [ ] **Step 3: Run `cd frontend && npm run build`**

## Chunk 3: Wrap-up

### Task 7: Update docs and validate

**Files:**
- Modify: `docs/school-integration/LIMITATIONS.md` if any B3b scope remains deferred

- [ ] **Step 1: Update limitations/docs if the full B3b scope is still partial**
- [ ] **Step 2: Run focused verification commands**
- [ ] **Step 3: Summarize shipped behavior and remaining gaps**
