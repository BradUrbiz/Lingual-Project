# School Integration Tasks

Status: Active
Last updated: 2026-05-30
Owner: Engineering + Product

## Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` done
- `[!]` blocked / needs decision

This file lists **active and open work only.** Completed phases are summarized at the bottom; for implementation detail of shipped work, see `TECH_SPEC.md` and the plan docs under `docs/superpowers/plans/`.

## Doc upkeep

- [ ] Review docs with product lead and confirm post-beta school scope.
- [ ] Convert remaining open questions in `PRD.md` §13 into explicit architecture decisions in `TECH_SPEC.md`.

## Postgres school-domain migration

- [x] Accept persistence ADR: Firestore remains auth/profile/legacy; Postgres becomes school-domain system of record.
- [x] Add initial Postgres schema blueprint for school operations, compliance, practice sessions, learning events, and analytics.
- [x] Schema-fidelity review of `POSTGRES_SCHEMA.md` against the live Firestore writers; folded Tier-1 fixes (missing `lti_platforms`/`lti_sessions` tables, `organizations` inline fields, `enrollments` canvas fields), tightened compliance CHECK constraints, and added the "Backfill Normalization And ID Resolution" section.

### Pre-migration fixes (do before backfill code)

- [x] Add `metric.context_tag_signal` to `SUPPORTED_EVENT_TYPES` (`backend/services/practice_analytics.py:10`) — was emitted by `build_derived_learning_events` but absent from the set that gates `POST /events` (`curriculum_admin.py:527`). Fixed 2026-05-30; 90 backend tests green.
- [x] Reconcile the two org-type constants. Decision (2026-05-30): school-only tenancy. Removed `schools.py`'s local `ORGANIZATION_TYPES`; both `/api/schools` and the school-request path now share `database.ALLOWED_ORG_TYPES` (`{'school'}`). Postgres `organizations.type` CHECK narrowed to `('school')`.
- [ ] Pre-backfill data scans (fail the run if violated): duplicate active `memberships` per `(org_id, uid)`; duplicate `enrollments` per `(class_id, student_uid)` from legacy non-deterministic IDs; >1 `canvas_connections` per `class_id`; duplicate active join `code`; legacy `organizations.status='inactive'` rows.

### Implementation track

- [x] **Skeleton increment landed (2026-05-30).** Inert SQLAlchemy + Alembic + Cloud SQL engine wired behind `RouteDeps`; runtime unchanged (still Firestore). 930 backend tests green, zero regression. Ships: `backend/db/sql.py` (lazy connector/TCP engine), `backend/db/models/` (20 baseline tables, PG18 `uuidv7()` on append-heavy), `backend/db/migrations/0001_baseline` (Alembic), `backend/db/repository/` (resolution helper + inert enrollment twin), `RouteDeps.sql_engine` provider, `make test-postgres` (gated), `docs/dev/postgres-local-setup.md`.
- [x] Choose first implementation stack: `SQLAlchemy` 2.x + `Alembic` + `pg8000` + `cloud-sql-python-connector` (ADR-0001).
- [ ] Provision Cloud SQL for PostgreSQL 18 for local/staging/prod (infra owner). Local `make test-postgres` uses ephemeral Docker `postgres:18`.
- [x] Add migration tooling, connection settings, and developer setup docs.
- [x] Decide the coexistence-window write strategy. Decision (2026-05-30): `legacy_firestore_id`-resolving writes, no write-freeze, UUID PKs retained (TECH_SPEC §3.8a, POSTGRES_SCHEMA "ID resolution"). Resolution helper lives in the repository layer behind `RouteDeps`.
- [-] Build a Postgres repository layer behind `RouteDeps` without changing route contracts. Inert seam landed (resolution helper + enrollment twin, Option A flat `deps.db`-twin contract). Per-entity adapters + the delegating router are deferred to each route-family cutover increment.
- [ ] Close the `lti.py:703` `get_assignment_ref().update(...)` ref leak (add a real `update_assignment`) — a prerequisite before the assignments entity can cut over (not a skeleton task).
- [ ] Add per-route-family read feature flags so a failed cut can toggle reads back to Firestore without redeploy (TECH_SPEC §3.8e).
- [ ] Write Firestore-to-Postgres backfill scripts with dry-run, write, and parity-report modes. Run in parent-first dependency order; apply the field renames + value normalizations + type coercions from `POSTGRES_SCHEMA.md`; exclude/drain `status='active'` practice sessions; scope parity checks to stable non-mutating fields.
- [ ] Move new low-risk school-domain writes to Postgres first: organizations, classes, enrollments, assignments.
- [ ] Add temporary dual-write only for Firestore-backed readers that have not yet been cut over, with cross-store compensation (outbox record or idempotency key — not best-effort sequencing).
- [ ] Cut route reads over by family: school context, teacher class/roster, assignments, compliance, student launch, practice sessions/events, analytics.
- [ ] Migrate teacher authz off `classes.teacher_membership_ids[]` to a `class_teachers` join (filtering `removed` memberships) as part of the class/roster cutover.
- [ ] Build the `analytics_rollups` refresh worker (scheduled or write-triggered) as a separate decision before that table earns its place; until then analytics stay on the live Python aggregation path.
- [ ] Retire Firestore school-domain writes after route-family cutover and monitoring.

## Teacher onboarding (Plan 4 follow-ups)

- [ ] Replace in-memory org search rate limiter with a shared store (Redis / Firestore counter) when scaling to multi-replica.
- [ ] 7-day reminder email for stale pending teacher join requests (v1.5). **Product decision needed before launch.**
- [ ] Realtime status listener on `/signup/teacher/pending` (replace 30s polling, v1.5).
- [ ] Wrap teacher-join approve flow in a Firestore batch/transaction (v1.5). Introduces the project's first transactional path — plan it cross-cuttingly.
- [ ] Document `PUBLIC_BASE_URL` in `.env.example` and the deployment runbook.
- [ ] Top-level `try/except` wrapper around the main body of each route in `backend/routes/teacher_requests.py` (matches `school_requests.py` pattern; ensures Firestore transient errors return shaped JSON, not unformatted HTML 500).

## LMS / roster import

- [ ] Add manual CSV fallback if LMS setup is delayed.

## Lingual admin panel (Plan 5 follow-ups)

- [ ] `PATCH /api/lingual-admin/organizations/<orgId>` (org metadata editing) — v1.5.
- [ ] Realtime listener for org-detail audit feed (replace pagination, v1.5).
- [ ] Bulk export of org audit feed as CSV — v1.5.
- [ ] Internationalize Lingual admin panel UI (en-only in v1).
- [ ] Wire `school_request_reminder_to_lingual` once the outbox sweep gap (LIMITATIONS #20) is closed.
- [ ] Reminder email for inactive suspended orgs (≥30 days `suspended_until` in past with auto-restore disabled) — needs product decision before launch.
- [ ] Backfill top-level `country` from `location.country` for `school_requests` rows submitted before the country denormalization fix. One-shot script: query `school_requests` where `country` is missing AND `location.country` is non-empty; write `country` to each. Until run, the Requests page country filter matches only post-fix rows.
- [ ] Wire `make test-emulator` into CI so a missing composite index trips before deploy. Infrastructure exists (`backend/tests/test_firestore_indexes.py` + Makefile target). Requires Java runtime on CI agents + Firebase CLI; add as a separate job that runs alongside `make test-backend`.
- [ ] Share the school-type enum between FE and BE. Today both sides hand-code overlapping lists in TS and Python, and the drift was caught by review rather than the type system. Either (a) emit the Python enum as a generated TS const at build time, or (b) move both to a single JSON/YAML source-of-truth that both layers read.
- [ ] Delete orphan Firestore composite index on `enrollments` — see LIMITATIONS #35 for the targeted `gcloud` command.

## Legacy migration (Plan 6 rollout)

- [ ] Run backfill `--dry-run` on staging.
- [ ] Run backfill on staging (writes).
- [ ] Run backfill on production.
- [ ] Monitor `[backfill]` and `legacy_role_pick` log volume for 1 week post-launch.
- [ ] "Switch to learning mode" for teacher/admin-migrated users who want to learn — v1.5.
- [ ] Localize the modal copy (en + ko) — v1.5.

## Modality and cost controls

- [ ] Add org / class / assignment modality policies.
- [-] Track voice minutes and estimated cost per session.

## Analytics hardening

- [-] Capture estimated speaking time, turn counts, transcript-based MLU, target usage, and first-pass cost summary.
- [-] Strengthen semantic event detection with locale-aware pedagogical signal rules.

## Compliance counsel review

- [ ] Validate COPPA workflow assumptions with counsel.
- [ ] Validate FERPA vendor / school-official workflow assumptions with counsel.
- [ ] Validate state biometric-risk assumptions, including Illinois BIPA exposure, with counsel.

## Pilot readiness

- [ ] Recruit 5-10 co-design teachers.
- [ ] Create pilot feedback loop and weekly issue triage.
- [ ] Define beta support process for consent, roster, and integration issues.

## Locale content

- [ ] Author Tagalog (`tl-PH`) games/curriculum content. Locale is wired end-to-end (prompt config, locale list, pronunciation prompts) but `curriculaByLocale` in `AppGamesPage.tsx` has no `tl-PH` entry, so Tagalog learners get no minigame content. Same partial-content gap exists for non-French locales.

---

## Shipped to date (high-level)

For implementation detail, see `TECH_SPEC.md` and `docs/superpowers/plans/`.

- **Phase 1 — School foundation.** Auth + memberships, organizations/classes/enrollments domain, role-aware route guards, MembershipContext, Firestore rules.
- **Phase 2 — Onboarding & admin.** Class create + join-code, Canvas LMS roster sync (decoupled from enrollments 2026-04-21), Plan 3 admin org wizard, Plan 4 teacher join-org flow with admin approval, Plan 5 Lingual admin panel with org lifecycle (suspend/restore + audit + auto-restore scheduler), Plan 6 legacy role migration modal + backfill script.
- **Phase 3 — Content & assignments.** Canvas content picker, AI-assisted draft from source packets, manual advanced authoring, scaffold-free `custom_prompt` mode, scenario fields stored directly on assignments (legacy `curriculum_mappings` removed).
- **Phase 4 — Practice engine.** Assignment resolver, practice session bootstrap, assignment-aware realtime prompt assembly, text fallback when voice is blocked, interaction contract preview.
- **Phase 5 — Events & analytics.** `learning_events` schema, lifecycle/turn/feedback/target/error events, per-session summaries, rubric-dimension scoring, class/student/assignment analytics endpoints + UIs, dashboard filters.
- **Phase 6 — Compliance.** Voice gating + `voice_allowed` enforcement, `textFallbackEnabled` downgrade, pronunciation policy gating, disclosure logging on key endpoints, class-scoped bulk consent + audit export, Epic A guardian packets (issue/resend/cancel + secure-link decision), Epic B deletion requests (admin approve/execute/retry, sync worker), school-wide admin compliance dashboard.
- **Phase 7 (partial) — Pilot readiness.** Contextual onboarding hints, public `/compliance` page, Firestore rules emulator tests (`firebase-tests/`, 44 cases).
- **Realtime model.** Upgraded to `gpt-realtime-mini-2025-12-15` (May 2026); turn detection is `semantic_vad` eagerness=auto.
- **Outbox email infrastructure.** Firestore `outbox_emails/` + `send_outbox_email` Cloud Function, 9 templates wired (school-request approve/decline, teacher-invitation, teacher-join admin/approve/decline, org-suspended, org-restored, school-request-to-Lingual).

## Definition of done for beta entry — met

- Teacher can create or import a class. ✓
- Teacher can create an assignment from Canvas content or teacher-authored source material. ✓
- Student can launch assignment-aware practice. ✓
- Teacher can see class and student analytics tied to that assignment. ✓
- Voice access respects consent and retention policy. ✓
- Teacher routes are role-protected. ✓
- Firestore rules are no longer placeholder-only. ✓
