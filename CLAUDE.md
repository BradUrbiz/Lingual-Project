# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Development Commands

### Backend (Flask, Python 3.11)
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PORT=5001 FLASK_ENV=development python main.py   # localhost:5001 (matches Vite proxy)
```

`main.py` fast-fails on missing required env vars in production and warns in dev — see `_validate_required_env` for the required/feature-gated lists.

### Frontend (React 19 + Vite 7)
```bash
cd frontend
npm install
npm run dev       # Vite on localhost:5173, proxies /api/* to :5001
npm run build     # tsc -b && vite build → outputs to frontend/dist (Docker copies to static/react)
npm run lint
npm run test      # Vitest
```

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

### Docker
```bash
docker build -t lingual .
docker run -p 8080:8080 lingual   # multi-stage: node builds frontend, python serves via gunicorn
```

## Architecture

### Backend (Flask + Firestore + OpenAI)

**Stack:** Flask 3.1, Firebase Admin SDK, Firestore, OpenAI Realtime + Chat APIs, flask-sock for websockets, PyLTI1p3 for LTI 1.3.

**Dependency injection pattern:** `main.py` builds a `RouteDeps` (`backend/route_deps.py`) that carries `db`, `firebase_auth`, session helpers, OpenAI client, prompt builders, school-context resolvers, and allowed-locale sets. Every blueprint is registered via a `create_*_blueprint(deps)` factory. **New routes must follow this pattern** — never import `main` or module-level singletons directly.

**Blueprints** (`backend/routes/`): `auth`, `chat`, `assessment`, `pronunciation`, `games`, `schools`, `guardian`, `teacher`, `curriculum_admin`, `admin`, `integrations` (Canvas), `canvas_practice`, `school_requests`, `lti`. `test_harness` is registered only in development/testing and exposes `/api/test/*` for E2E.

**Services** (`backend/services/`): domain logic that blueprints compose.
- `assignment_resolver.py` — assembles assignment-aware system prompts from assignment-owned fields + student profile + compliance policy + modality policy
- `practice_analytics.py` — session summary building, learning event rollup, class/assignment/student aggregation
- `membership_context.py` — request-level resolution of active org + role + classes
- `compliance.py`, `disclosure_logging.py`, `deletion_requests.py`, `guardian_packets.py` — the compliance surface
- `canvas/` — Canvas LMS client, AES-256-GCM PAT encryption, roster sync, practice generator
- `lti/` — LTI 1.3 identity, config, grade passback, JWKS keys
- `pedagogy/` — pedagogy-driven prompt shaping helpers
- `assignment_workspace.py` — teacher-side assignment authoring helpers

**Assignment content lives on the assignment document.** The resolver reads `instructions`, `generated_scenario`, `objectives`, `target_expressions`, `focus_grammar`, `teacher_notes`, `task_type`, `target_language_intensity`, and (optionally) `canvas_module_item_ref` directly — there is no separate curriculum-overlay collection. `task_type: custom_prompt` is a scaffold-free mode that bypasses scenario generation and rubric-dependent analytics (see LIMITATIONS.md #14).

**Auth flow:** Firebase ID token → `POST /api/auth/verify` verifies token, creates Flask session, returns memberships + active org context. `MembershipContext` on the frontend consumes this.

**Realtime flow:** `POST /api/realtime/session` mints an ephemeral OpenAI Realtime credential → frontend connects via `useRealtimeChat`. Voice is compliance-gated and fails closed without consent.

**SPA serving:** in production, Flask serves `static/react/` (built by the frontend Docker stage). Never hand-edit `static/react/`.

### Frontend (React 19 + TypeScript + Vite)

**Stack:** React 19, React Router v7, Radix UI primitives, Tailwind CSS 4 (`@tailwindcss/vite`), Framer Motion + `motion`, Recharts, Sonner, axios, Firebase JS SDK. Avatar: `pixi-live2d-display` + Cubism SDK for Live2D and `@pixiv/three-vrm` + three.js for VRM. Speech: `microsoft-cognitiveservices-speech-sdk`.

**Context stack** (outermost → innermost, in `App.tsx`):
`AuthProvider` → `MembershipProvider` → `LanguageProvider` (en/ko UI) → `LearningLocaleProvider` (target language per session).

**Routing:** `App.tsx` uses React Router v7 with `React.lazy()` per page. Three protection layers:
- `ProtectedRoute` — signed-in users
- `AppProtectedRoute` — users inside the `/app` shell
- `TeacherRoute` — membership role must be teacher or admin
- `LingualAdminRoute` — Lingual-side superadmin

Production build uses `base: '/app/'` in Vite, and `basename` in `App.tsx` is derived from `import.meta.env.BASE_URL`.

**Layout:** `frontend/src/`
- `api/` — typed API client modules per backend blueprint (`teacher.ts`, `assignments.ts`, `canvas.ts`, `guardian.ts`, `lti.ts`, `admin.ts`, etc.). All go through `api/index.ts`'s shared axios instance.
- `types/` — DTOs matching backend contracts (`assignment.ts`, `school.ts`, `canvas.ts`, `avatarChat.ts`).
- `pages/` — one file per route; lazy-loaded.
- `hooks/` — `useRealtimeChat`, `useAvatarChatSession`, `useVoiceRecorder`, `usePronunciationPractice`, `realtimeAvatar`, `realtimeSpeechGate`.
- `contexts/`, `components/`, `lib/`, `i18n/`.

### Firestore Schema (high level)

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

### Canvas Roster Decoupling (2026-04-21)

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

## Key Files

### Backend
- `main.py` — Flask app, env validation, OpenAI client factory, prompt builders, blueprint registration
- `database.py` — Firestore CRUD for all collections
- `scoring.py` — Assessment scoring + ACTFL description lookup
- `backend/route_deps.py` — DI container injected into every blueprint
- `backend/routes/curriculum_admin.py` — Assignment CRUD, practice session creation, event reporting, analytics
- `backend/routes/teacher.py`, `schools.py`, `admin.py` — Teacher + school-admin + Lingual-admin surfaces
- `backend/routes/integrations.py`, `canvas_practice.py` — Canvas LMS
- `backend/routes/lti.py` — LTI 1.3 launch, link-account, assignment picker, grade passback
- `backend/routes/guardian.py`, `school_requests.py` — Compliance + school-request lifecycle
- `backend/services/assignment_resolver.py` — Assignment-aware prompt assembly
- `backend/services/practice_analytics.py` — Session summaries + analytics aggregation

### Frontend
- `frontend/src/App.tsx` — Router, providers, route guards
- `frontend/src/contexts/MembershipContext.tsx` — Active org, role, classes
- `frontend/src/pages/TeacherDashboardPage.tsx`, `TeacherAssignmentBuilderPage.tsx`, `TeacherAssignmentAnalyticsPage.tsx`, `TeacherClassAnalyticsPage.tsx`, `TeacherClassCompliancePage.tsx`, `TeacherStudentDrillDownPage.tsx`
- `frontend/src/pages/AppLearningPage.tsx`, `AssignmentLaunchPage.tsx`, `AppChatPage.tsx`, `PronunciationPracticePage.tsx`
- `frontend/src/pages/CanvasConnectPage.tsx`, `LtiLinkAccountPage.tsx`, `LtiAssignmentPickerPage.tsx`
- `frontend/src/pages/AdminCompliancePage.tsx`, `AdminDeletionRequestsPage.tsx`, `LingualSchoolRequestsPage.tsx`
- `frontend/src/hooks/useRealtimeChat.ts`, `useAvatarChatSession.ts`

## Working Conventions

- **Do not edit `static/react/`** — it is the frontend build output.
- **Do not add a second persistence system** — stay on Firestore for beta (see TECH_SPEC §1).
- **Never route practice through a generic chat prompt** when an assignment context exists — always go through `assignment_resolver`.
- **Compliance gating is architecture, not polish.** Voice sessions fail closed without consent. Treat any change that touches voice, audio retention, or guardian flows as high-scrutiny.
- **Analytics are heuristic for now** (see LIMITATIONS.md #7, #8). Do not market them as model-verified scoring until that's true.
- **Canvas roster ≠ enrollments.** Preserve the decoupling from 2026-04-21.
- **Implementation conventions** (test framework, DI patterns, naming, Cloud Function `_impl`+wrapper split, outbox usage, Plan 1 contract surface): see `docs/superpowers/codebase-conventions.md`. Read it before writing plan code.
