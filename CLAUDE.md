# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Layered docs.** This root file is the big picture and loads every session. Subsystem detail lives in **`backend/CLAUDE.md`** and **`frontend/CLAUDE.md`**, which load on demand when Claude reads files there. Keep this file lean — push stack and implementation detail down into those.

## Attitude

Aim high. **Lingual** can reshape how language is learned in the classroom in the AI era. Today the product is spoken-language practice; the architecture is built so the same pattern can extend to other subjects later. Be ambitious, be opinionated, and treat school beta as the real product.

## Project Overview

**Lingual** is an AI-powered platform for teacher-designed speaking practice that runs at student scale. Mission: become **the standard for spoken language learning** in schools.

**Positioning:** *Teacher-designed practice, AI-executed at student scale.* Curriculum is the backbone — the teacher designs the exercise, the AI executes it.

### Current Priority: School Integration

School integration is the top strategic priority. The system has moved past its B2C-only origins. The authoritative specs live in `docs/school-integration/`:

| Document | Purpose | When to update |
|----------|---------|----------------|
| `PRD.md` | Product goals, user stories, success metrics | Scope, user stories, or success criteria change |
| `TECH_SPEC.md` | Architecture, domain model, API design | Architecture decisions, data models, or API surface change |
| `TASKS.md` | Phased checklist (`[x]`/`[-]`/`[ ]`/`[!]`) | Items start, complete, block, or new items are identified |
| `LIMITATIONS.md` | Shipped constraints and temporary shortcuts | Shipped behavior is narrower than the intended architecture |

**Update order on scope changes:** PRD → TECH_SPEC → TASKS → LIMITATIONS.

**Rules:**
- Before touching architecture, data model, or API surface: read PRD → TECH_SPEC → TASKS for the relevant area.
- After shipping: mark TASKS items complete and add LIMITATIONS entries where behavior is narrower than spec.
- Do not implement features that contradict TECH_SPEC. Update docs first, or in the same change set.
- When the user says "update docs," refresh all four to match the codebase.

### Language Support Is Not the Focus

The learning engine is deliberately language-agnostic. Adding a locale is a config change in `main.py` (`ALLOWED_LEARNING_LOCALES` + `LEARNING_LOCALE_PROMPT_CONFIG`), not a product initiative. Currently configured locales: `ko-KR`, `es-ES`, `fr-FR`, `ru-RU`, `he-IL`, `tl-PH`. Most US schools teach Spanish and French, so those get exercised most, but the architecture should never hard-code a single language. Prompt assembly, analytics, and rubrics must stay locale-parametric.

### User Roles

| Role | Capabilities |
|------|-------------|
| **Student** | Assessment, assignment-aware AI practice, progress tracking |
| **Teacher** | Class + roster management, Canvas-linked or teacher-authored assignment creation, analytics, compliance management |
| **School Admin** | Org-wide analytics, multi-teacher management, compliance dashboard, deletion-request lifecycle |
| **Lingual Admin** | Approves school creation requests |

### Core Learning Flow

1. Teacher connects Canvas (optional) → creates class → authors assignment from Canvas content, teacher source packet, or custom prompt → publishes.
2. Student joins via class code (or LTI launch, or Canvas roster) → completes consent → launches assignment-aware speaking/text practice.
3. AI tutor runs with assignment-resolved prompt (instructions, generated scenario, target expressions, focus grammar, language-mix policy, modality policy).
4. Runtime emits `learning_events` → `practice_sessions` get rolling summaries → analytics aggregate class/assignment/student.
5. Teacher reviews class, assignment, and student analytics; manages compliance roster and guardian packets.

## Repository Structure

- **Backend core lives at the repo root**, not under `backend/`: `main.py` (Flask app, env validation, OpenAI client factory, prompt builders, blueprint registration), `database.py` (Firestore CRUD for all collections), `scoring.py` (assessment scoring + ACTFL lookup). Run the backend from the repo root.
- `backend/` — route blueprints, services, the DI container, Postgres-migration models (`backend/db/`), and backend tests. **See `backend/CLAUDE.md`.**
- `frontend/` — React 19 + Vite SPA; run from `frontend/`. **See `frontend/CLAUDE.md`.**
- `docs/school-integration/` — authoritative product + architecture specs (table above). `docs/superpowers/` — design specs + `codebase-conventions.md`.
- `firebase-tests/` — Firestore-rules emulator tests (Java). `e2e/` — shell E2E. `functions/` — Cloud Functions. `dataconnect/` + `frontend/src/dataconnect-generated/` — Firebase Data Connect (generated). `static/react/` — built frontend served in prod (build output; do not edit).

## Development Commands

Per-side dev and build commands live in `backend/CLAUDE.md` and `frontend/CLAUDE.md`. Repo-wide commands:

### Tests (Makefile is the source of truth)

```bash
make test                 # backend + frontend
make test-backend         # python3 -m unittest discover -s backend/tests -p "test_*.py" -v
make test-frontend        # cd frontend && npm run test -- --run
make test-firebase        # firebase-tests/ — requires Java runtime (Firestore emulator)
make test-e2e             # bash e2e/*.sh — requires backend + frontend running
make test-emulator        # backend integration against Firestore emulator
make test-all             # everything above
make coverage-backend     # HTML report in coverage_html/
```

Run a single test file:
```bash
python3 -m unittest backend.tests.test_curriculum_admin_routes -v
cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx
```
For live Web test, or smoke test, use playwright-cli, and below test account credentials if 
needed:

School admin: testorg@testing.com,  pw lingual123
Teacher account: testteacher@testing.com, pw lingual123, join code for example class KCRWSK
Student account: teststudent@testing.com, pw lingual123


### Docker
```bash
docker build -t lingual .
docker run -p 8080:8080 lingual   # multi-stage: node builds frontend, python serves via gunicorn
```

## Firestore Schema (high level)

```
users/{uid}/
  profile/          display_name, age, rigor, frequency, ui_language, last_active_membership_id
  assessment/       responses, current_item_index, completed
  results/          global_stage, domain_bands, domain_raw_scores, framework
  chats/{id}/       (legacy B2C chat history)

organizations/{orgId}              name, type, status, pilot_stage, policies
memberships/{membershipId}         org_id, uid, roles[], status
classes/{classId}                  org_id, name, term, subject, teacher_membership_ids[]
enrollments/{enrollmentId}         class_id, student_uid, status, join_source  (only real enrollments)
assignments/{assignmentId}         class_id, title, status, task_type, instructions,
                                   generated_scenario, target_expressions, focus_grammar,
                                   objectives, teacher_notes, target_language_intensity,
                                   canvas_module_item_ref?
practice_sessions/{sessionId}      assignment_id, student_uid, session_summary, cost_summary
learning_events/{eventId}          assignment_id, session_id, event_type, turn_index, payload

canvas_connections/{id}            encrypted PAT (AES-256-GCM), class binding, sync status
canvas_course_content/{id}         synced modules/items visible to enrolled students
canvas_roster_entries/{id}         Canvas roster snapshot (decoupled from enrollments, 2026-04-21)

guardian_packets/{id}              secure-link consent lifecycle
deletion_requests/{id}             student/class/org-scoped deletion workflow
compliance_state, disclosure_logs  consent + audit surface
```

Firestore rules live in `firestore.rules` and are validated via Firebase Emulator tests in `firebase-tests/` (requires Java).

## Canvas Roster Decoupling (2026-04-21)

Canvas roster sync writes **only** to `canvas_roster_entries/`. It never auto-enrolls students. Enrollments come from class-join codes or LTI launches. Teachers see an "on Canvas roster" badge next to enrolled students and a "not yet joined" gap view. If you touch Canvas sync or auth activation, preserve this separation. Design notes: `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`.

## Environment Variables

Hard-required in production (fail-fast in `_validate_required_env`):
- `OPENAI_API_KEY` — AI chat, realtime voice, scoring
- `SECRET_KEY` — Flask session signing (dev fallback is explicitly rejected in prod)

Feature-gated (warns on missing):
- `CANVAS_PAT_ENCRYPTION_KEY` — Canvas connect returns 503 without it

Other:
- `GOOGLE_APPLICATION_CREDENTIALS` — path to Firebase service account JSON (or rely on ADC)
- `GOOGLE_CLOUD_PROJECT` — defaults to `lingu-480600`
- `PORT` — backend port (use `5001` locally to match Vite proxy; Cloud Run uses `8080`)
- `FLASK_ENV` — `development` enables debug + test-harness blueprint

## Development Workflow Agents

The repo ships a local plugin at `.claude/plugins/lingual-dev-agents/` with five agents. They are part of the workflow, not optional.

| Agent | Dispatch when | Skip when |
|-------|--------------|-----------|
| `spec-agent` | Before implementing any TASKS.md item touching architecture, data model, or API surface | Pure UI polish, copy, or single-file bug fix |
| `backend-impl` | Backend changes, typically parallel with `frontend-impl` | Frontend-only change |
| `frontend-impl` | Frontend changes, parallel with `backend-impl` or sequential after a backend contract lands | Backend-only change |
| `cross-layer-review` | After a feature that spans backend + frontend — especially compliance, prompt assembly, or analytics | Change is isolated to one layer |
| `doc-sync` | After finishing a TASKS.md phase or introducing new collections, endpoints, or domain concepts | Trivial bug fix |

**Parallel pattern:** When backend and frontend work are independent, dispatch `backend-impl` and `frontend-impl` simultaneously with `isolation: "worktree"`, review both diffs, then run `cross-layer-review` on the merged state.

**Advisory vs. writing:** `spec-agent`, `cross-layer-review`, and `doc-sync` propose — they do not modify files. Read their output before acting. `backend-impl` and `frontend-impl` write code in isolated worktrees; always review before merging.

## Working Conventions

- **Do not add a new persistence system.** Firestore is the system of record for beta (see TECH_SPEC §1). The one sanctioned exception is the in-progress school-domain migration to Cloud SQL (PostgreSQL) under `backend/db/` — dual-write now, reads still 100% Firestore. See `backend/CLAUDE.md`; never move a read path off Firestore without checking the current migration phase.
- **Compliance gating is architecture, not polish.** Voice sessions fail closed without consent. Treat any change that touches voice, audio retention, or guardian flows as high-scrutiny.
- **Analytics are heuristic for now** (see LIMITATIONS.md #7, #8). Do not market them as model-verified scoring until that's true.
- **Canvas roster ≠ enrollments.** Preserve the decoupling from 2026-04-21 (see section above).

Subsystem conventions — backend DI rules, prompt-assembly routing, `codebase-conventions.md`, and frontend build-output rules — live in `backend/CLAUDE.md` and `frontend/CLAUDE.md`.
