# CLAUDE.md — Backend (Flask + Firestore + OpenAI)

Local conventions for the backend. The root `CLAUDE.md` carries product context, the Firestore schema, environment variables, and repo-wide conventions — both load together.

**Code split:** the Flask entrypoint and core modules live at the **repo root** (`main.py`, `database.py`, `scoring.py`), while blueprints, services, the DI container, Postgres-migration models, and tests live here under `backend/`.

## Commands

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PORT=5001 FLASK_ENV=development python main.py   # localhost:5001 (matches Vite proxy)
```

Run from the repo root — that is where `main.py` is. `main.py` fast-fails on missing required env vars in production and warns in dev; see `_validate_required_env` for the required/feature-gated lists (and the root `CLAUDE.md` Environment Variables section).

- Backend tests: `make test-backend`, or one file: `python3 -m unittest backend.tests.test_curriculum_admin_routes -v`
- Firestore-emulator integration: `make test-emulator`

## Stack

Flask 3.1, Firebase Admin SDK, Firestore, OpenAI Realtime + Chat APIs, flask-sock for websockets, PyLTI1p3 for LTI 1.3.

## Dependency injection pattern

`main.py` builds a `RouteDeps` (`backend/route_deps.py`) that carries `db`, `firebase_auth`, session helpers, OpenAI client, prompt builders, school-context resolvers, and allowed-locale sets. Every blueprint is registered via a `create_*_blueprint(deps)` factory. **New routes must follow this pattern** — never import `main` or module-level singletons directly.

## Blueprints (`backend/routes/`)

`auth`, `chat`, `assessment`, `pronunciation`, `games`, `schools`, `guardian`, `teacher`, `curriculum_admin`, `admin`, `integrations` (Canvas), `canvas_practice`, `school_requests`, `lti`. `test_harness` is registered only in development/testing and exposes `/api/test/*` for E2E.

## Services (`backend/services/`)

Domain logic that blueprints compose.
- `assignment_resolver.py` — assembles assignment-aware system prompts from assignment-owned fields + student profile + compliance policy + modality policy
- `practice_analytics.py` — session summary building, learning event rollup, class/assignment/student aggregation
- `membership_context.py` — request-level resolution of active org + role + classes
- `compliance.py`, `disclosure_logging.py`, `deletion_requests.py`, `guardian_packets.py` — the compliance surface
- `canvas/` — Canvas LMS client, AES-256-GCM PAT encryption, roster sync, practice generator
- `lti/` — LTI 1.3 identity, config, grade passback, JWKS keys
- `pedagogy/` — pedagogy-driven prompt shaping helpers
- `assignment_workspace.py` — teacher-side assignment authoring helpers

## Cloud SQL (PostgreSQL) migration layer (`backend/db/`)

In-progress migration of the school domain to Cloud SQL Postgres as system-of-record (ADR-0001). Holds SQLAlchemy `models/`, `repository/`, Alembic `migrations/`, and the dual-write paths (`dual_write.py`, `dual_write_school_chain.py`), gated by `DUAL_WRITE_SCHOOL_CHAIN` / `DUAL_WRITE_ENROLLMENTS`. Current split: writes go to both Firestore + Postgres; **reads are still 100% Firestore**. Remaining phases: parity backfill → read cutover by route-family → retire Firestore writes. This is the sanctioned exception to the root "Firestore for beta" convention — never move a read path off Firestore without checking the current migration phase/flags.

## Assignment content lives on the assignment document

The resolver reads `instructions`, `generated_scenario`, `objectives`, `target_expressions`, `focus_grammar`, `teacher_notes`, `task_type`, `target_language_intensity`, and (optionally) `canvas_module_item_ref` directly — there is no separate curriculum-overlay collection. `task_type: custom_prompt` is a scaffold-free mode that bypasses scenario generation and rubric-dependent analytics (see LIMITATIONS.md #14).

## Request flows

- **Auth:** Firebase ID token → `POST /api/auth/verify` verifies token, creates Flask session, returns memberships + active org context. `MembershipContext` on the frontend consumes this.
- **Realtime:** `POST /api/realtime/session` mints an ephemeral OpenAI Realtime credential → frontend connects via `useRealtimeChat`. Voice is compliance-gated and fails closed without consent.
- **SPA serving:** in production, Flask serves `static/react/` (built by the frontend Docker stage). Never hand-edit `static/react/`.

## Key files

- `main.py` (repo root) — Flask app, env validation, OpenAI client factory, prompt builders, blueprint registration
- `database.py` (repo root) — Firestore CRUD for all collections
- `scoring.py` (repo root) — assessment scoring + ACTFL description lookup
- `backend/route_deps.py` — DI container injected into every blueprint
- `backend/routes/curriculum_admin.py` — assignment CRUD, practice session creation, event reporting, analytics
- `backend/routes/teacher.py`, `schools.py`, `admin.py` — teacher + school-admin + Lingual-admin surfaces
- `backend/routes/integrations.py`, `canvas_practice.py` — Canvas LMS
- `backend/routes/lti.py` — LTI 1.3 launch, link-account, assignment picker, grade passback
- `backend/routes/guardian.py`, `school_requests.py` — compliance + school-request lifecycle
- `backend/services/assignment_resolver.py` — assignment-aware prompt assembly
- `backend/services/practice_analytics.py` — session summaries + analytics aggregation

## Conventions

- **Never route practice through a generic chat prompt** when an assignment context exists — always go through `assignment_resolver`.
- Implementation conventions (test framework, DI patterns, naming, Cloud Function `_impl`+wrapper split, outbox usage, Plan 1 contract surface): see `docs/superpowers/codebase-conventions.md`. Read it before writing plan code.
