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
- `pedagogy/` — the **Pedagogy Engine** (reborn S1 thin spine). `policies.py` (teacher-policy normalizers, relocated from the resolver), `routing.py` (target-type-aware feedback routing — the behaviour win), `plan.py` (`compile_prompt_plan` → `PromptPlan` + `serialize_plan_preview`), `render/assignment_prompt.py` (`render_assignment_prompt(plan, surface)`), `integration.py` (flag-gated dispatch). **Import boundary (enforced + tested):** `plan.py`/`routing.py` import no OpenAI/Canvas/resolver — verified by `test_pedagogy_engine_s1.ImportBoundaryTestCase`. Gated by `PEDAGOGY_ENGINE_ASSIGNMENT_RENDER` (default off → legacy `build_assignment_system_prompt`). See `docs/school-integration/Pedagogy Engineering/`.
- `assignment_workspace.py` — teacher-side assignment authoring helpers

## Cloud SQL (PostgreSQL) migration layer (`backend/db/`)

Migration of the school domain to Cloud SQL Postgres as system-of-record (ADR-0001). Holds SQLAlchemy `models/`, `repository/`, Alembic `migrations/`, the dual-write paths (`dual_write.py`, `dual_write_school_chain.py`, `dual_write_analytics.py`), and the `ReadRouter` (`read_router.py`) on `deps.db`.

**Current state (2026-06-03 — read cutover COMPLETE):**
- **Reads:** all PG-authoritative (org/class/enrollment/assignment/practice_sessions/learning_events), fail-open to Firestore via the 3-state `READ_PG_*` flags (`''`/`'0'`=Firestore, `shadow`=compare-only, `'1'`=PG-authoritative). The one exception is **memberships** (`READ_PG_MEMBERSHIPS=shadow`): the role-guard `resolve_user_school_context` reads the in-module Firestore primitive, so memberships stay **Firestore-read-authoritative by design** (D4) — see LIMITATIONS.
- **Writes — analytics family RETIRED:** `practice_sessions` + `learning_events` are **Postgres-sole** (`WRITE_FIRESTORE_ANALYTICS=0`); the `primary_*` paths are **fail-CLOSED** (a PG failure surfaces as a 500 the SPA retries, not a silent drop).
- **Writes — relational/assignment family STILL DUAL-WRITE (intended steady state, NOT a TODO):** org/class/enrollment/assignment continue to dual-write to Firestore *and* PG (`DUAL_WRITE_SCHOOL_CHAIN`/`DUAL_WRITE_ENROLLMENTS`/`DUAL_WRITE_ASSIGNMENTS=1`), fail-open. **Do not "finish the migration" by retiring these Firestore writes.** Keeping them is deliberate: the Firestore mirror is the instant **read-rollback bridge** (flip `READ_PG_*=shadow` and reads fall back to a live Firestore copy). Retiring relational writes also first requires moving the role-guard off Firestore memberships (security-critical). Revisit only post-beta on a real trigger (long PG confidence at scale, or doing the role-guard work anyway), not as cleanup.

Never move a read path's flag, or touch a dual-write seam, without checking the live flag state first (`gcloud run services describe lingual-app`). This is the sanctioned exception to the root "Firestore for beta" convention.

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
