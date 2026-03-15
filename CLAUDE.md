# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lingual** is an AI-powered platform for learning colloquial/spoken language through real-time conversation practice. Our mission is to become **the standard for spoken language learning**.

### Current Priority

**School integration** is the top priority. The system has moved beyond B2C-only assumptions. All new work should follow the formal school-integration documents:

- `docs/school-integration/PRD.md` - product goals, scope, success metrics
- `docs/school-integration/TECH_SPEC.md` - architecture, domain model, API design
- `docs/school-integration/TASKS.md` - phased checklist and build order
- `docs/school-integration/LIMITATIONS.md` - known gaps and temporary shortcuts

### Document-Driven Development

All school-integration work follows a document-first workflow. The four spec documents are the authoritative source of truth — code implements what the docs describe, and docs are updated to match what code ships.

**Update order:** PRD → TECH_SPEC → TASKS → LIMITATIONS.md

| Document | Purpose | When to update |
|----------|---------|----------------|
| `PRD.md` | Product goals, user stories, success metrics | Scope, user stories, or success criteria change |
| `TECH_SPEC.md` | Architecture, domain model, API design | Architecture decisions, data models, or API surface change |
| `TASKS.md` | Phased checklist (`[x]`/`[-]`/`[ ]`) | Items start, complete, or new items are identified |
| `LIMITATIONS.md` | Shipped constraints, temporary shortcuts | Shipped behavior is narrower than the intended architecture |

**Rules for Claude Code:**

- Before starting a feature: read the relevant PRD → TECH_SPEC → TASKS sections to understand scope and architecture
- After shipping: mark TASKS.md items complete, add LIMITATIONS.md entries for any behavior narrower than spec
- Do not implement features that contradict TECH_SPEC architecture without updating docs first
- When the user says "update docs," refresh all four documents to match the current codebase state
- When a feature introduces new architecture (new collections, API surface, domain concepts), update TECH_SPEC before or alongside the implementation

### Vision & Roadmap

| Aspect | Current (v1) | Future |
|--------|--------------|--------|
| **Languages** | Korean (SKLC-aligned), French (AP sample) | Spanish, Russian |
| **Market** | B2B-first (K-12 schools, language institutes) | Broader B2C |
| **Platform** | Web only | Web + Native mobile apps |

### User Roles

| Role | Capabilities |
|------|-------------|
| **Student** | Assessment, assignment-aware AI practice, progress tracking |
| **Teacher** | Class management, curriculum mapping, assignment creation, analytics |
| **Administrator** | School-wide analytics, multi-teacher management, billing |

### Core Learning Flow

1. Teacher creates class → maps curriculum → publishes assignment
2. Student launches assignment-aware speaking practice (voice/text/hybrid)
3. AI tutor follows curriculum mapping (target expressions, grammar, feedback policy)
4. System captures learning events → builds session summaries → rolls up analytics
5. Teacher reviews class/assignment/student analytics to inform instruction

**Key Principle:** Curriculum is the backbone - teachers design the exercise, AI executes it at student scale.

## Development Commands

### Backend (Flask)
```bash
pip install -r requirements.txt
PORT=5001 FLASK_ENV=development python main.py  # Runs on localhost:5001
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev      # Dev server on localhost:5173, proxies /api/* to :5001
npm run build    # TypeScript compile + Vite build
npm run lint     # ESLint
npm run test     # Vitest
```

### Running Tests
```bash
# Backend unit tests
python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_realtime_chat backend.tests.test_school_foundation_routes backend.tests.test_auth_memberships backend.tests.test_deletion_requests

# Frontend tests
cd frontend && npm run test -- --run src/pages/TeacherAssignmentAnalyticsPage.test.tsx src/components/layout/TeacherRoute.test.tsx
```

### Docker
```bash
docker build -t lingual .
docker run -p 8080:8080 lingual
```

## Architecture

### Backend

- **Flask** app registered via blueprints in `main.py`

- **Firestore** for all persistence (users, schools, sessions, events)
- **OpenAI GPT Realtime API** powers live conversation with ephemeral token auth
- **Firebase Auth** ID tokens verified server-side

Backend is organized into:
- `main.py` - Flask app, blueprint registration, legacy routes
- `database.py` - Firestore CRUD helpers for all collections
- `backend/routes/` - Blueprint modules (auth, chat, teacher, curriculum_admin, schools, pronunciation)
- `backend/services/` - Domain services (assignment_resolver, practice_analytics, membership_context, compliance)
- `backend/services/pedagogy/` - Pedagogy engine (task templates, curriculum template resolution, prompt section assembly)
- `backend/route_deps.py` - Shared dependencies injected into routes
- `scoring.py` - Assessment scoring (MCQ, heuristic text, domain aggregation)

### Frontend

- **React 19 + TypeScript + Vite** with React Router v7
- **Contexts**: `AuthContext` (Firebase user, session, memberships), `LanguageContext` (en/ko UI), `MembershipContext` (active org, role, classes)
- **UI**: Radix UI primitives + Tailwind CSS 4 + Framer Motion
- **Route-level lazy loading** via `React.lazy()` in `App.tsx`
- **Vendor chunking** configured in `vite.config.ts`

Frontend is organized into:
- `frontend/src/App.tsx` - Router, lazy-loaded pages, `TeacherRoute` guard
- `frontend/src/api/` - Typed API client modules (teacher, assignments, schools, compliance)
- `frontend/src/types/` - TypeScript DTOs (school, assignment, curriculum)
- `frontend/src/pages/` - Page components
- `frontend/src/contexts/` - React contexts
- `frontend/src/components/` - Shared UI components

### Data Flow

1. Firebase Auth issues ID token → `/api/auth/verify` creates session + returns memberships
2. `MembershipContext` hydrates active org, role, classes
3. `TeacherRoute` guards teacher-only pages by checking membership role
4. Teacher creates assignment → curriculum mapping → assignment record
5. Student launches assignment → backend resolves assignment context → creates practice session
6. During practice: learning events emitted → session summary updated in real-time
7. Teacher views analytics: backend aggregates sessions + events into typed payloads

### Firestore Schema

```
users/{uid}/
  ├── profile/       (display_name, age, rigor, frequency, ui_language)
  ├── assessment/    (responses, current_item_index, completed)
  ├── results/       (global_stage, domain_bands, domain_raw_scores)
  └── chats/{id}/    (title, messages[], timestamps)

organizations/{orgId}          (name, type, status, pilot_stage, policies)
memberships/{membershipId}     (org_id, uid, roles[], status)
classes/{classId}              (org_id, name, term, subject, teacher_membership_ids[])
enrollments/{enrollmentId}     (class_id, student_uid, status, join_source)
curriculum_mappings/{mappingId} (class_id, package_id, module_id, objectives, policies)
assignments/{assignmentId}     (class_id, mapping_id, title, status, task_type)
practice_sessions/{sessionId}  (assignment_id, student_uid, session_summary, cost_summary)
learning_events/{eventId}      (assignment_id, session_id, event_type, turn_index, payload)
```

## Key Files

### Backend - School Integration

- `backend/routes/curriculum_admin.py` - Assignment CRUD, practice session creation, event reporting, analytics endpoints
- `backend/routes/teacher.py` - Teacher dashboard, class CRUD
- `backend/routes/schools.py` - School/org bootstrap and management
- `backend/services/practice_analytics.py` - Session summary building, learning event processing, assignment analytics aggregation
- `backend/services/assignment_resolver.py` - Assignment bootstrap, curriculum resolution, prompt assembly
- `backend/services/pedagogy/` - Task template prompt assembly, curriculum template resolution, template catalog
- `backend/services/membership_context.py` - Request-level school context and role checking

### Backend - Core

- `main.py` - Flask app with blueprint registration and legacy routes
- `database.py` - Firestore CRUD for all collections
- `scoring.py` - Assessment scoring

### Frontend - Teacher Flow

- `TeacherDashboardPage.tsx` - Class list, summary stats, setup checklist
- `TeacherAssignmentBuilderPage.tsx` - Curriculum mapping, assignment authoring, interaction contract preview
- `TeacherAssignmentAnalyticsPage.tsx` - Per-assignment analytics drill-down
- `frontend/src/api/teacher.ts` - Teacher dashboard and class API
- `frontend/src/api/assignments.ts` - Assignment CRUD and analytics API
- `frontend/src/types/assignment.ts` - Assignment, practice session, analytics DTOs
- `frontend/src/types/school.ts` - School, class, membership DTOs

### Frontend - Student Flow

- `AppCurriculumPage.tsx` - Curriculum browsing with template summaries
- `AppCurriculumModulePage.tsx` - Module practice entry with interaction contract display
- `ChatPage.tsx` - AI tutor conversation (legacy + assignment-aware)

### Frontend - Core

- `frontend/src/App.tsx` - Router with lazy-loaded pages and TeacherRoute guard
- `frontend/src/contexts/AuthContext.tsx` - Firebase auth + session
- `frontend/src/contexts/MembershipContext.tsx` - Active org, role, classes
- `frontend/src/components/layout/TeacherRoute.tsx` - Role-gated route wrapper

## Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` - For GPT Realtime API
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Firebase service account JSON
- `GOOGLE_CLOUD_PROJECT` - Firebase project ID (defaults to `lingu-480600`)
- `SECRET_KEY` - Flask session secret
- `PORT` - Backend port (default 5000; set to 5001 for Vite proxy)
- `FLASK_ENV` - Set to `development` for debug mode
