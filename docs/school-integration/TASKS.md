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
- [-] Pre-backfill data scans. The first production backfill (2026-05-31) surfaced these empirically rather than via a separate fail-fast scan, and the per-row SAVEPOINT + the multi-role merge handle them gracefully (no whole-run abort): **duplicate active `memberships` per `(org_id, uid)`** → these are multi-role users (staff + student); `upsert_membership` now MERGES roles into the one `(org,uid)` row instead of failing (see LIMITATIONS #45). **Duplicate/empty `enrollments` per `(class_id, student_uid)`** → 37 malformed empty-`student_uid` docs + 16 `e2e_test` docs; documented Firestore-only junk. Legacy `organizations.status='inactive'` is remapped to `archived` by normalization. Still TODO as a standalone pre-flight: `canvas_connections` per `class_id` and duplicate active join `code` scans (those collections aren't in the 2a enrollment chain).

### Implementation track

- [x] **Skeleton increment landed (2026-05-30).** Inert SQLAlchemy + Alembic + Cloud SQL engine wired behind `RouteDeps`; runtime unchanged (still Firestore). 930 backend tests green, zero regression. Ships: `backend/db/sql.py` (lazy connector/TCP engine), `backend/db/models/` (20 baseline tables, PG18 `uuidv7()` on append-heavy), `backend/db/migrations/0001_baseline` (Alembic), `backend/db/repository/` (resolution helper + inert enrollment twin), `RouteDeps.sql_engine` provider, `make test-postgres` (gated), `docs/dev/postgres-local-setup.md`.
- [x] Choose first implementation stack: `SQLAlchemy` 2.x + `Alembic` + `pg8000` + `cloud-sql-python-connector` (ADR-0001).
- [x] Provision Cloud SQL for PostgreSQL 18 (2026-05-30) **+ baseline schema applied to the real instance (2026-05-31).** Instance `lingual` (connection name `lingu-480600:us-central1:lingual`), RUNNABLE, IAM auth on, public IP, `lingual` application database. Schema applied via `alembic upgrade head` (rev `0001_baseline`, 20 tables) through the Cloud SQL Python connector (env: `INSTANCE_CONNECTION_NAME`+`DB_USER=postgres`+`DB_NAME=lingual`+`DB_PASS`, plus `GOOGLE_CLOUD_QUOTA_PROJECT=lingu-480600` to dodge the ADC quota-project gotcha). DDL credential = a freshly-reset `postgres` password (one-time, ephemeral — nothing used the prior password since runtime is Firestore). Runtime is **still 100% Firestore**. Local `make test-postgres` still uses ephemeral Docker `postgres:18` (NEVER point its `DATABASE_URL` at the real instance — `setUpModule` drops all tables).
- [ ] **Cost / tier downgrade at trial-end (HARD deadline).** The `lingual` instance is a Cloud SQL **free-trial** instance (created 2026-05-30): `db-perf-optimized-N-8`, 8 vCPU, Enterprise Plus — free now, but trial instances are LOCKED (edition/machine-type changes are rejected). Decision: keep the free trial, then downgrade in place to `db-custom-1-3840` (Enterprise) AFTER the trial converts to a normal paid instance (downgrade works with data present; reconfigure + restart). RISK: when the trial ends it bills the EP rate (~$1-2K/mo) until downgraded — get the trial-end date from the Cloud SQL console banner and set a reminder a few days prior. Downgrade command (edition + tier ALONE; bundling other fields is rejected): `gcloud sql instances patch lingual --project lingu-480600 --edition=ENTERPRISE --tier=db-custom-1-3840`. Do NOT enable any EP-only feature (data cache) meanwhile or the downgrade balks. The 100 GB disk won't shrink in place (~$17/mo headroom; ignore).
- [x] Add migration tooling, connection settings, and developer setup docs.
- [x] Decide the coexistence-window write strategy. Decision (2026-05-30): `legacy_firestore_id`-resolving writes, no write-freeze, UUID PKs retained (TECH_SPEC §3.8a, POSTGRES_SCHEMA "ID resolution"). Resolution helper lives in the repository layer behind `RouteDeps`.
- [-] Build a Postgres repository layer behind `RouteDeps` without changing route contracts. Inert seam landed (resolution helper + enrollment twin, Option A flat `deps.db`-twin contract). Per-entity adapters + the delegating router are deferred to each route-family cutover increment.
- [x] Close the `lti.py:703` `get_assignment_ref().update(...)` ref leak (2026-05-30). Added `database.set_assignment_grade_config(assignment_id, grade_metric, grade_points)`; the LTI grade-config route now writes through it instead of touching the assignment ref. Added a positive grade-config test (the path was negative-only before). Unblocks the assignments-entity cutover. 932 backend tests green.
- [ ] Add per-route-family read feature flags so a failed cut can toggle reads back to Firestore without redeploy (TECH_SPEC §3.8e).
- [x] Write Firestore-to-Postgres backfill (dry-run, write, parity modes) — **enrollment chain, slice 2a complete (2026-05-30).** Library `backend/db/repository/{normalization.py, backfill.py}`: `run_backfill` processes orgs->memberships->classes->enrollments parent-first, resolves FKs via `legacy_firestore_id`, applies the documented renames/value-remaps/type-coercions, is idempotent (upsert by `legacy_firestore_id`), isolates each row in a SAVEPOINT (`begin_nested`) so a bad row never aborts the run, rejects missing-id docs, records `warnings` for would-be-NULL optional FKs, and has a chain-aware dry-run (no writes). Plus `parity_report` (Firestore vs Postgres id-set diff) and the `migration_import_runs` ledger (`start_import_run`/`finish_import_run`). Orchestrator: `scripts/backfill_postgres_school_domain.py` (`--dry-run`/`--write`/`--parity`; reads Firestore, runs via the configured engine, records the ledger). Verified: Tier-1 (no DB) + gated Tier-2 on real PG18 (`make test-postgres`, 14 tests: full-chain FK/remaps, idempotent re-run, SAVEPOINT isolation, dry-run-writes-nothing, parity in-sync + flags-unmigrated, ledger). Built via workflow + adversarial review (caught 2 critical data-corruption bugs pre-commit). **Multi-role membership merge added 2026-05-31** (after the first production backfill): `upsert_membership` UNIONs roles into the existing active `(org,uid)` row instead of inserting a row the partial-unique index rejects, so a staff+student user collapses to one row with both roles (union on both the cross-doc-merge and legacy-id-update branches → order-independent re-runs); `run_backfill` counts a merge as `updated` + emits a warning; the dry-run predicts it. The live `shadow_create_membership` inherits the fix for free (it delegates to `upsert_membership`). +7 Tier-1 + 5 Tier-2 tests (Tier-2 now 48). See LIMITATIONS #45. **Other entities** (assignments/compliance/practice) are their own cutover increments, not slice 2a.
- [x] Move new low-risk school-domain writes to Postgres first: organizations, classes, enrollments, assignments. **(enrollments via 2b `DUAL_WRITE_ENROLLMENTS`; org/membership/class + hard-delete via 2c `DUAL_WRITE_SCHOOL_CHAIN` — both flag-gated OFF, code-complete & green; assignments deferred to their own entity slice).** **Parent-chain dual-write = slice 2c, gated on its own `DUAL_WRITE_SCHOOL_CHAIN` flag (independent of `DUAL_WRITE_ENROLLMENTS`; must be enabled + parity-verified FIRST so enrollment FKs resolve).** New seam `backend/db/dual_write_school_chain.py` reuses the shared fail-open `_run` (refactored `dual_write._resolve_engine` to be flag-agnostic so both families share it). Mirror strategy: CREATE paths reuse idempotent `backfill.upsert_*`; STATUS-FLIP paths (suspend/restore/remove) use a TARGETED UPDATE keyed by `legacy_firestore_id` (a partial-doc upsert would clobber NOT-NULL `name`/`type`). **2c-1 organizations DONE (2026-05-31):** `shadow_create_organization` + `shadow_suspend_organization` + `shadow_restore_organization`; `sql_engine=` opt-in on `database.create_organization/suspend_organization/restore_organization`; wired at `schools.py:197` + `lingual_admin.py` suspend/restore. 1008 backend + gated Tier-2 PG18 (`test_dual_write_school_chain_pg`, 5 tests: create lands, idempotent, suspend/restore round-trip without clobber, unresolved no-op, flag-off inert). Built via workflow + 3-lens adversarial review. **2c-2 memberships DONE (2026-05-31):** `shadow_create_membership` (idempotent upsert; UnresolvedParentError = quiet no-op when org absent) + `shadow_remove_membership` (targeted UPDATE status=removed/removed_by_firebase_uid, no INSERT so partial-unique index never threatened). Fixed `backfill.upsert_membership` to skip `primary_class_ids` on UPDATE (so 2c-3 ARRAY writes survive a backfill re-run). `sql_engine=` opt-in on `database.create_membership`/`remove_membership`; `approve_school_request` shadows org+membership via post-commit re-read (org first so the membership FK resolves). Wired: schools.py (3 sites), teacher_requests.py, lti.py, identity.py, lingual_admin.py approve+remove. 1014 backend + Tier-2 PG18 (34 total: +resolved-FK create, idempotent, org-absent no-op, remove flips status, partial-unique removed+active coexist, backfill preserves primary_class_ids). **2c-3 classes + primary_class_ids + invite-code DONE (2026-05-31):** `shadow_create_class` (upsert; class_teachers junction deferred), `shadow_add_primary_class`/`shadow_remove_primary_class` (resolve class->UUID then `array_append`/`array_remove` on `memberships.primary_class_ids`; `NOT = ANY` guard makes add idempotent like ArrayUnion), `shadow_update_org_invite_code`/`shadow_deactivate_org_invite_code` (targeted UPDATE, never upsert). Wired the LTI `ArrayUnion` bypass (identity.py) explicitly. `sql_engine=` opt-in on `create_class`/`add_primary_class_to_membership`/`remove_primary_class_from_membership`/`generate_teacher_invite_code`/`deactivate_teacher_invite_code`; wired schools.py, teacher.py, lti.py, integrations.py. 1023 backend + Tier-2 PG18 (40 total, +6: class FK-resolved create, array append/idempotent/unresolved-no-op/remove, invite-code generate+deactivate without clobber). **At end of 2c-3 the full parent chain is mirrored — `DUAL_WRITE_SCHOOL_CHAIN` can be enabled + parity-verified, then `DUAL_WRITE_ENROLLMENTS`.** **2c-4 hard-delete mirroring DONE (2026-05-31):** `shadow_delete_org_scope` wired into `deletion_requests.execute_deletion` (after the ledger/consent writes, org-scope only, fail-open). Faithful mirror of `ORG_SCOPE_COLLECTIONS`: DELETE the org's classes (enrollments cascade) + memberships, KEEP the org row (Firestore doesn't delete the org doc — so the soft-archive-vs-hard-delete fork was moot). Resolves LIMITATIONS #43(a) for org scope; student/class scope target non-mirrored collections so no shadow fires. 1028 backend + Tier-2 PG18 (43 total, +3: full-chain org delete removes children/keeps org, unresolved no-op, flag-off inert). **Slice 2c COMPLETE — the full org/membership/class chain + hard-delete is mirrored. Schema applied + 2a backfill committed against the real instance (2026-05-31). IAM DB auth prepped (Cloud SQL IAM user = the Cloud Run SA, DML-only grants) and `cloudbuild.yaml` wired (DB env + `DUAL_WRITE_SCHOOL_CHAIN` substitution). DUAL_WRITE_SCHOOL_CHAIN=1 is now DEPLOYED & VERIFIED LIVE on `lingual-app` (us-central1, rev 00036) via passwordless IAM — a class created through the live prod UI mirrored to PG (shadow_create_class) and its UUID landed in the teacher's primary_class_ids (shadow_add_primary_class). A frontend test OOM (an AppGamesPage.test unstable-dependency render loop, fixed by the frontend agent — NOT the dual-write) had blocked the deploy through 3 build attempts. NEXT: soak, then add `DUAL_WRITE_ENROLLMENTS=1` (cloudbuild substitution) + deploy + soak; re-run 2a backfill + parity before read-cutover to catch any cold-start stragglers (e.g. the pre-fix "cloudsql2" test class).** assignments are a later entity.
- [-] Add temporary dual-write only for Firestore-backed readers that have not yet been cut over, with cross-store compensation (outbox record or idempotency key — not best-effort sequencing). **Enrollments, slice 2b code-complete + flag-gated OFF (2026-05-31).** Seam: `backend/db/dual_write.py` — `shadow_create_enrollment` / `shadow_set_enrollment_status` / `shadow_lti_reactivate`, all FAIL-OPEN (gated on `DUAL_WRITE_ENROLLMENTS=1` + a configured engine; open/close their own Session; swallow + log, never raise into the live write). Firestore stays system of record and is written FIRST. Wired via an opt-in `sql_engine=None` param on `database.create_enrollment/deactivate_enrollment/reactivate_enrollment` (callers pass `deps.sql_engine`: join-code `schools.py`, teacher remove `teacher.py`, LTI `lti.py`→`identity.py` incl. the direct-`.update()` reactivation bypass). Strategy A (trust-backfill): only enrollments mirror; an unresolved class is a quiet coexistence no-op. Cross-store compensation = idempotent upsert by composite `legacy_firestore_id` (reuses `backfill.upsert_enrollment`), NOT best-effort sequencing. Latency capped three ways (`sql.py` `pool_timeout=3` + connect timeout on both paths; transaction-scoped `SET LOCAL statement_timeout` in the shadow txn). Migration scripts (`migrate_canvas_roster_decouple.py`, `migrate_legacy_enrollment_ids.py`) abort when the flag is set. Verified: 997 backend tests + gated Tier-2 PG18 (`test_dual_write_enrollments_pg`, 9 tests: resolved-FK create, CHECK-surviving remaps, idempotency, `updated_at` bump, LTI 3-field write, unresolved no-op, flag-off inert, parity in-sync). Built via workflow + 3-lens adversarial review. **Remaining for live 2b:** schema applied + 2a backfill committed on the real instance (2026-05-31; 202/264 rows, 62-row Firestore-only parity baseline fully enumerated — see LIMITATIONS #45). IAM DB auth + cloudbuild.yaml are wired; SCHOOL_CHAIN activation is BLOCKED on the frontend test-suite leak (see slice 2c note above). After SCHOOL_CHAIN soaks clean, add `DUAL_WRITE_ENROLLMENTS=1` to cloudbuild.yaml the same way + soak. Parent-chain writes (org/membership/class) + hard-delete mirroring are slice 2c (see LIMITATIONS #43).
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
