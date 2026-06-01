# Firestore → Postgres READ-CUTOVER

Status: **design (proposed).** Companion to the completed dual-write slices — 2a (backfill), 2b (enrollments, `DUAL_WRITE_ENROLLMENTS`), 2c (org/membership/class + hard-delete, `DUAL_WRITE_SCHOOL_CHAIN`). This is the **read-cutover phase** of the coexistence migration (ADR-0001, TECH_SPEC §3.8 "Migrate through coexistence"); it precedes the final "retire Firestore writes" step (TASKS.md). It is *not* product "Phase 4" — that label is the practice engine.

> **Phase invariant.** Firestore remains the system of record. Dual-write stays ON. This phase moves **read paths only**, one entity family at a time, behind per-entity flags that default OFF and **fail open to Firestore**. Nothing here retires a Firestore write.

---

## 0. Scope boundary (read first)

Read-cutover candidates are **only** the four dual-written + backfilled entities: **organizations, memberships, classes, enrollments**.

**HARD BOUNDARY — analytics stays 100% Firestore.** `assignments`, `practice_sessions`, and `learning_events` *are* modeled in `backend/db/models/` (`assignment.py`, `practice.py`) but are **NOT dual-written and NOT backfilled** — there is no `dual_write` seam, no `upsert_*` in `backfill.py`, and no flag for them. Therefore the **entire analytics route-family** (teacher assignment / class / student-drilldown analytics, teacher dashboard summary, student assignment workspace) must stay on Firestore. Cutting enrollments/classes to PG while sessions/events stay on Firestore would **split-brain a single analytics request** (an enrolled-set read from PG joined against a sessions read from Firestore). Unblocking requires first adding `practice_sessions` + `learning_events` to the dual-write + backfill program — a separate, larger increment.

Also Firestore-only (excluded from the entity flags): `school_requests`, `school_creation_drafts`, the `users` collection (incl. the legacy `lingual_admin` flag, `profile`, `email`/`display_name`), `canvas_roster_entries`, `chats/`.

---

## 1. Read-surface inventory

From the entity-by-entity map (workflow `read-cutover-scope-design`, 2026-06-01). ~45 read functions; all reads flow through `database.py` helpers — **no route issues a raw Firestore collection query** for these entities, which is what makes the centralized seam (§2) possible.

| Entity | Read fns | High-risk readers | Notes |
|--------|---------|-------------------|-------|
| organizations | 12 | `get_organization` (23 callers — admin projections + the fail-closed suspended-org gate + compliance retention default), `approve_school_request` (read+write txn, **not** a candidate) | `school_requests`/`drafts` readers stay on Firestore |
| memberships | 6 | `get_user_memberships`, `resolve_user_school_context` (feeds the role-guard on nearly every protected route) | `email`/`name` need a Firestore `users` fan-out |
| classes | 7 | `get_class` (14 callers), `list_org_classes`, `list_teacher_classes`, `get_class_by_join_code`, `list_student_classes` | junction tables not yet backfilled (§5 prereq) |
| enrollments | 4 | `get_student_class_enrollment` (13 callers, practice-launch gate), `list_class_enrollments` (roster + gap view) | twin exists but **mis-shaped** (§3.1) |
| analytics/cross-entity | 16 | every `*_practice_sessions` / `*_learning_events` reader | **BLOCKED** — out of scope |

---

## 2. Seam: a delegating `ReadRouter` on `deps.db`

Today `deps.db` IS the `database` module — routes call `deps.db.get_organization(...)` and the module is a pass-through. We keep that surface and insert a thin wrapper that overrides **only** cut-over read methods; everything else (writes, not-yet-cut readers) passes through.

```python
# backend/db/read_router.py
class ReadRouter:
    def __init__(self, fs_db, sql_engine):
        self._fs = fs_db                 # the database module
        self._sql_engine = sql_engine    # deps.sql_engine provider (engine | None)
    def __getattr__(self, name):
        return getattr(self._fs, name)   # default: Firestore
    # cut-over readers are explicit methods that call _route_read (§2.1)
```

`main.py` builds `db = ReadRouter(database, sql_engine=...)` and passes it as `RouteDeps(db=db, sql_engine=...)`. Result: **zero route edits**; the cutover is a localized change to the router + env flags. Dual-write seams are untouched (they already accept `sql_engine` explicitly).

### 2.1 Per-entity flags + delegation

Env vars, read on every call (like the dual-write flags), default OFF: `READ_PG_ORGANIZATIONS`, `READ_PG_MEMBERSHIPS`, `READ_PG_CLASSES`, `READ_PG_ENROLLMENTS`. A flag governs an **entity family**, not one method — so a request that reads the same entity twice can never split-brain within that entity. **This guarantee is only as strong as the override-list completeness** (see the audit requirement in §3.0).

| value | behavior |
|-------|----------|
| unset / `0` | Firestore only (today). |
| `shadow` | Firestore authoritative + PG shadow-read parity compare (logs/counts mismatch, returns Firestore). |
| `1` | PG authoritative, **fail-open** to Firestore on any error / `sql_enabled()` False / unresolved id. |

```python
def _route_read(self, flag, fs_call, pg_call):
    mode = os.environ.get(flag, '')
    engine = self._resolve_engine()            # None when no Cloud SQL target
    if mode == '' or engine is None:
        return fs_call()
    if mode == 'shadow':
        fs = fs_call()
        _shadow_compare(flag, fs, pg_call, engine)   # never raises, never mutates fs
        return fs
    try:                                       # mode == '1'
        with Session(engine) as s:             # same lifecycle as dual_write._run
            return pg_call(s)
    except Exception:
        _log.exception('%s: PG read failed; fail-open to Firestore', flag)
        return fs_call()
```

`pg_call` resolves Firestore string ids → UUIDs via `resolution.resolve_legacy_id`; an unresolved id (the ~62 junk rows, a lost-merge membership id) returns `None`/`[]` and the helper fails open to Firestore for point-gets — a correct answer, never a 404. Heavy imports stay lazy, matching `dual_write.py`.

> **Fail-open does NOT cover everything.** Point-gets degrade safely (unresolved → Firestore). But a **list** that is short a row, or a **count** that is simply low, returns *successfully* — there is no exception to trigger fail-open. Those are the silent-regression class that §3 and §4 exist to catch. A wrong roster or a wrong studentCount is teacher-visible and never raises.

---

## 3. Serializer invariants (the part that actually determines correctness)

The migration's hard part is not the engine wiring — it is that **Firestore reads return denormalized, Firestore-addressed dicts**, while Postgres returns normalized rows with UUID keys. Every read adapter is a translation layer back to the *old* shape, and **every confirmed defect lives in that translation.**

### 3.0 Invariants — MUST hold for every read adapter

1. **Foreign keys are emitted as `legacy_firestore_id`, never the UUID.** This is the read-side dual of TECH_SPEC §3.8a (writes resolve legacy→UUID; reads must resolve UUID→legacy). Every FK a caller treats as a Firestore id must be JOINed back to the parent's `legacy_firestore_id` column: `enrollment.class_id`, `enrollment.student_membership_id`, `class.org_id`, `class.teacher_membership_ids[]`, `membership.org_id` (→ `orgId`), `membership.primary_class_ids[]`. Emitting `str(row.<fk>)` (the UUID) is a bug — it will never match a Firestore-id comparison or a downstream `get_*` lookup.
2. **`id` is `legacy_firestore_id or str(row.id)`** (preserves Firestore addressing during coexistence).
3. **Field renames are reversed** back to the Firestore names callers read (`firebase_uid`→`uid`/`student_uid`, `suspended_by_firebase_uid`→`suspended_by_uid`, etc.).
4. **Output dict KEYS must match exactly** — callers use non-`.get()` subscripting in places (e.g. `lingual_admin.py` does `m['membership_id']`), so a renamed/missing key is a `KeyError` 500, not a soft miss.
5. **Full shape, not a slim projection** — a read adapter returns every field any caller of that Firestore reader consumes (see the `fields_consumed` map), because one router method backs all of them.

> **No reverse-id primitive exists yet.** `resolution.resolve_legacy_id` maps legacy→UUID only. Invariant #1 is satisfied **by JOINing the parent table and selecting its `legacy_firestore_id`** inside each adapter query (not by a post-hoc lookup). Add a small helper / documented JOIN pattern; do not hand-roll per adapter.

### 3.0a Override-list completeness audit (required before any flag flips)

Because the entity-atomicity guarantee (§2.1) depends on it, enumerate **every** org/membership/class/enrollment reader in `database.py` and mark each as *overridden* or *consciously left on Firestore*. The map already found one miss: **`get_org_by_teacher_invite_code` (`database.py:3944`)** — it must be in the `organizations` adapter + override list, or a single teacher-join request reads the org entity from two stores. Also map the suspend/restore/invite-code precheck reads and the `approve_school_request` re-read.

**Router-bypass audit (the deeper requirement).** The router only intercepts calls made through `deps.db`. Any caller that does `import database; database.get_organization(...)` **bypasses the router entirely** — harmless in `shadow` (Firestore is authoritative everywhere) but a **split-brain at `1`** (it keeps reading Firestore while routed callers read PG). **Audit completed for `get_organization` (2026-06-01): no production bypass.** Every route/service consumer already calls `deps.db.get_organization` (the codebase deliberately injects `db=deps.db` — `suspended_org_guard.enforce_org_active`/`is_org_suspended` take an injectable `db` and all callers pass `deps.db`: chat.py:432, curriculum_admin.py:189/237, teacher.py:293, canvas_practice.py:56/143, assignment_resolver.py:976; `compliance.auto_grant_voice_consent_for_pilot(db,…)` is passed `deps.db` at schools.py:319 and via `auto_enroll_student(deps.db,…)` at lti.py:306/548). The only direct `database.get_organization` calls are (a) `suspended_org_guard._lookup_org`'s **fallback when `db is None`** — a latent footgun: a FUTURE `enforce_org_active` caller that forgets `db=deps.db` would silently read Firestore at flag=1 (mitigation: convention + this audit; re-audit before flipping), and (b) four database.py-INTERNAL prechecks/re-reads (suspend/restore/approve) which correctly stay Firestore (they're the write path's own reads). Repeat this audit per entity. The shadow counters only cover routed reads, so a low compare-count relative to traffic would itself signal a bypass.

### 3.1 Confirmed defects — MUST fix before the corresponding flip

| # | Defect | Evidence | Fix |
|---|--------|----------|-----|
| D1 | **Enrollment twin emits `class_id` as the PG UUID.** `enrollments.py:48` `'class_id': str(row.class_id)`; the module docstring even states it "operate[s] in Postgres-native terms." Breaks `list_student_classes` (`database.py:2319` calls `get_class(class_id)`), the `get_student_class_enrollment` legacy-fallback compare (`:2282`), and `list_student_assignments` (`:2298`) the instant `READ_PG_ENROLLMENTS=1`. | ✅ verified in live code | JOIN `classes` and emit `class_id = classes.legacy_firestore_id`; same for `student_membership_id` → `memberships.legacy_firestore_id`. Regression test: `get_student_class_enrollment(pg)['class_id']` round-trips through `get_class()`. |
| D2 | **Class serializer must emit `org_id` as the legacy id.** `assignment_resolver.py:1289` gates AI-tutor prompt assembly on `class_record['org_id'] == context.active_organization_id` (a Firestore id); `build_class_summary` re-exposes it as wire field `orgId`. Emitting the UUID fails authz + renders a UUID. | critique-verified | JOIN `organizations`, emit `org_id = organizations.legacy_firestore_id`. Authz test under PG. |
| D3 | **lingual-admin org LIST regresses.** `_camel_org_row` (`lingual_admin.py:167`) computes `memberCount = len(row['school_admin_uids'])` and reads `country/county/public_or_private/created_at/last_activity_at`. `school_admin_uids` is **not a PG column**; a slim `list_organizations` projection blanks all of these. (Design mis-filed this as an open question — it is a blocker.) | critique-verified | `list_organizations` returns the full shape AND derives `school_admin_uids` via a memberships subquery (`roles @> '{school_admin}'`, `status='active'`). Couples org-list reads to memberships — acceptable, document it. |
| D4 | **`list_org_memberships` needs Firestore user data.** Output keys are `membership_id`/`uid`/`email`/`name`/`roles`/`status`/`joined_at`; callers do non-`.get()` `c['membership_id']`. `email`/`name` come from the `users` collection (**not in PG**) → a pure-SQL adapter is impossible; it must fan out to Firestore `get_user` per row (cross-store, N+1). Same for `list_school_admin_emails`. | critique-verified | **RESOLVED (2026-06-01): leave on Firestore.** `list_org_memberships`, `list_school_admin_emails`, `list_lingual_admin_emails` are membership⋈users HYBRIDS; `email`/`name` are irreducibly Firestore (`users` never migrates per ADR-0001) and the per-row fan-out — the dominant cost — is unavoidable either way, so routing only the membership filter adds a parity surface for a cold admin path with zero benefit. They are NOT overridden on the router (passthrough). Consistent with the spec's own carve-out for `resolve_user_school_context`. The membership flip's atomicity therefore covers the two raw-row readers (`get_membership`, `get_user_memberships`) only. |
| D5 | **`primary_class_ids` is deferred to `[]` in the backfill.** `upsert_membership` writes `primary_class_ids = []` (classes migrate after memberships, so the UUIDs weren't resolvable at backfill time); the LIVE add/remove/create path DOES mirror it (`shadow_add_primary_class` resolves each class to a **UUID**). So backfilled teacher→class attaches are absent in PG until a reconciliation backfill. `get_user_memberships.primaryClassIds` / `get_membership.primary_class_ids` would read short from PG. | verified (`backfill.py:228`, `dual_write_school_chain.py:206`) | Serializer translates the stored UUIDs back to `classes.legacy_firestore_id` in array order (the array dual of D1/D2). Shadow allowlists the field on the point-get (`_MEMBERSHIP_SHADOW_IGNORE`); the LIST path diffs by id-set so never sees it. **Low blast radius** — `primaryClassIds` has no UI/route consumer (a frontend `primaryClassIds?` type only). A `primary_class_ids` reconciliation backfill is the flip prereq for full per-field parity (paired with `parity_report`, since a clean shadow can't prove a field it allowlists). |

### 3.2 Adapter shape rules (per entity)

New modules `backend/db/repository/<entity>_read.py`, session-injected, returning Firestore-shaped dicts.

- **organizations** — `get_organization` returns the FULL doc shape (all denormalized wizard fields + `suspend_*` + policy fields). It backs broad admin projections AND the **fail-closed** suspended-org gate (`suspended_org_guard.py` reads `status`/`suspend_reason`/`suspended_until`) AND the compliance retention default — a slim projection silently degrades all three. `search_organizations`/`get_org_by_teacher_invite_code` preserve the `status='active'` filter (suspended orgs must not leak into search/join). `list_organizations` replicates the `(name_lower, id)` keyset ordering incl. the "full-page-always-sets-cursor" quirk. `school_admin_uids` is derived (D3).
- **memberships** *(BUILT 2026-06-01, flag OFF — `memberships_read.py` + router overrides + Tier-1/Tier-2 tests)* — routes ONLY the two raw-row readers: `get_membership` (raw doc shape; inverse renames `firebase_uid`→`uid`, `removed_by_firebase_uid`→`removed_by_uid`; `org_id`→org `legacy_firestore_id` via JOIN) and `get_user_memberships` (one dict per ROW with `orgName`/`orgType` from a real JOIN to `organizations`, `orgId` as the org legacy id, sorted by the replicated `_membership_sort_key`). **Merge-shape** is handled at the data layer: a multi-role user is already ONE PG row with unioned `roles[]` (the backfill's `_merge_roles`), so the reader needs no special case. `primaryClassIds` translates stored class UUIDs → legacy ids (D5; deferred-backfill caveat). **`resolve_user_school_context` is NOT overridden** — it passes through to Firestore and calls the *in-module* `get_user_memberships`, so flipping `READ_PG_MEMBERSHIPS=1` moves the two direct-`deps.db` readers to PG but leaves the role-guard (the highest-stakes read) Firestore-authoritative. Whether to also route the role-guard is a deliberate, separate decision at flip time — the conservative default is to keep it on the proven store. `list_org_memberships`/`list_school_admin_emails`/`list_lingual_admin_emails` stay on Firestore (D4 resolution — membership⋈users hybrids). `get_membership` by a lost-merge `{org}_{uid}` id resolves to no PG row → fails open to Firestore.
- **classes** — every serializer JOINs `class_teachers` to rebuild `teacher_membership_ids[]` (as `legacy_firestore_id`s, so `active_membership_id in teacher_membership_ids` authz keeps working) and JOINs `class_join_codes(active)` to rebuild `join_code`/`join_code_active`/`join_code_generated_at`. **Junction WRITES landed 2026-06-01 (slice 5):** `upsert_class` now reconciles both junctions from the denormalized class doc (`reconcile_class_teachers` from `teacher_membership_ids[]`; `reconcile_class_join_code` from `join_code`/`join_code_active`/`join_code_generated_at`) — convergent + idempotent. `shadow_create_class` inherits the teacher reconcile; the live join-code path has `shadow_generate_class_join_code`/`shadow_deactivate_class_join_code` (reusing the same reconcile so live + backfill are byte-identical). **Still TODO before class reads:** a reconciliation backfill run (`--write` re-run populates the junctions for already-migrated classes) + a junction-aware `parity_report`, then a deploy (the writes are flag-gated on `DUAL_WRITE_SCHOOL_CHAIN`, already live, but the code isn't deployed yet).
- **enrollments** *(ADAPTERS BUILT 2026-06-02)* — D1 fixed (FKs emitted as parent legacy ids via JOIN). `get_student_class_enrollment` is a point-get on the `(class_id, student_firebase_uid)` UNIQUE columns — which **subsumes** the Firestore deterministic-key + legacy-fallback scan: Firestore needs the fallback only because it addresses enrollments by the concatenated `{class}_{student}` doc id (auto-id rows miss), whereas PG matches on the FK columns, so the unique row is found regardless of how it was keyed (the deterministic-key audit is moot, not just documentation). The `(class,student)` uniqueness also means at most one row → no active/inactive multiplicity. `count_org_students` is a `COUNT(enrollments⋈classes)` filtering ENROLLMENT status='active' but NOT class status (the Firestore aggregate counts active enrollments across all the org's classes regardless of class status). Routed by `READ_PG_ENROLLMENTS`.

---

## 4. Shadow-read parity (the safe pre-flip gate)

In `shadow` mode both stores are read; Firestore is returned; the PG result is compared by **VALUE/SHAPE** and mismatches logged + counted, never surfaced. The live analog of the offline `backfill.parity_report`.

- **Point-gets**: deep-compare only the `fields_consumed` subset, datetimes normalized to ISO, `None`/`''`/missing treated as equal.
- **Lists**: compare as a SET keyed by `id` (membership parity), THEN compare ordering for ordered readers (roster `updated_at DESC`, keyset lists). Report `missing_in_pg` / `extra_in_pg` / `order_drift` separately.
- **Derived values — REQUIRED, not just stored rows.** The load-bearing outputs are *derived*, and the merge special-case will mark stored rows GREEN while a derived output silently changes:
  - `resolve_user_school_context` → `active_membership_id` / `active_roles` / `active_organization_id` (post-sort, **post-merge**: the merged row's `role_priority` is `min()` over the union, and its `membership_id` is whichever doc won the merge — this can change which org/role the whole protected surface resolves to for the 3 users). Manually verify the 3 affected users pre/post flip.
  - `memberCount` (D3) and `studentCount`.
- **Counts have no fail-open** → compare counts as their own class with a **numeric tolerance == the documented junk-row count per org**; alert only if the delta exceeds the allowlisted junk set. Decide explicitly whether a known-low count is acceptable to show teachers, or pin counts to Firestore until the junk rows are reconciled.
- **Known-divergence allowlist** (suppress alerts, still count): the ~62 Firestore-only junk rows (`extra_in_firestore`, by id so they don't mask NEW drift); the 3 merged-membership users (GROUP Firestore rows by `(orgId, uid)`, union roles, compare the grouped shape — but still surface the derived active-selection diff above); `school_admin_uids` derived-vs-stored; `last_activity_at` always-None on classes.

**Implemented in `read_router.py` (2026-06-01):** the comparator's `_norm` collapses `None` / `''` / `[]` / **`False`** to None — the universal Firestore(absent)≈PG(`NOT NULL` default) rule (the org soak's first finding was `teacher_invite_code_active: (None, False)` on every read; `is False` is used so a real `0` isn't collapsed, and `True` vs `None` is still flagged so a dual-write bug isn't masked). A per-process counter logs at WARNING on the first compare + every 25 (`shadow-read <FLAG>: N compared, M mismatched`) so a CLEAN shadow is observable — "no MISMATCH" alone can't distinguish clean from never-ran (INFO/DEBUG don't surface in prod). Per-entity ignore allowlists live in the router (`_ORG_SHADOW_IGNORE` = `school_admin_uids`, `last_activity_at`, `created_at`, `updated_at`; `_MEMBERSHIP_SHADOW_IGNORE` = `primary_class_ids` (D5 deferred-backfill, not benign), `created_at`, `updated_at`, `removed_at`).

**Promotion criterion (`shadow` → `1`):** ALL of —
1. zero un-allowlisted mismatches (incl. derived values + counts) over a 48–72h soak (full school-day cycle);
2. a fresh in-sync `backfill.parity_report` at the documented-junk baseline;
3. **dual-write shadow drop-rate ≈ 0** over the soak (lossless rollback depends on PG/Firestore staying in sync — a dropped shadow write makes a row simply absent from a PG list, with no fail-open). Monitor `gcloud run services logs read lingual-app` for `dual-write … failed`.

---

## 5. Sequencing (ordered reviewable slices)

Simplest point-gets first → lists → cross-entity joins, in dependency order.

1. **enrollments-read-prereq** *(code-only, flag OFF)* — fix D1 (serializer FKs → legacy ids); add `count_org_students`. No flip.
2. **organizations-read** + flag — full org shape (incl. D3 derivation + the D3.0a missed reader `get_org_by_teacher_invite_code`); cut the whole org-doc family atomically (a partial flip split-brains suspension state). `school_requests`/`drafts`/`approve` stay on Firestore.
3. **organizations COUNT aggregations** — ride the same flag.
4. **memberships-read** *(ADAPTERS BUILT 2026-06-01, flag OFF — `READ_PG_MEMBERSHIPS`)* — `get_membership` + `get_user_memberships` routed (shadow-capable); admin lists + `resolve_user_school_context` stay on Firestore (D4 resolved; role-guard stays Firestore-authoritative even at flag=1 unless separately decided). **Before flip:** (a) the id-set shadow must be green over a soak; (b) D5 — run a `primary_class_ids` reconciliation backfill + `parity_report` (the shadow allowlists that field, so it can't prove it); (c) decide the `resolve_user_school_context` routing question. NEXT: deploy `READ_PG_MEMBERSHIPS=shadow` to soak.
5. **classes-junction-backfill-prereq** *(HARD prereq — ✅ COMPLETE 2026-06-01: built + deployed + backfilled + parity-verified)* — `upsert_class` populates `class_teachers` + `class_join_codes` (reconcile helpers, convergent; codex-reviewed, global-active-code slot fix); `shadow_create_class` inherits the teacher reconcile; `shadow_generate_class_join_code`/`shadow_deactivate_class_join_code` mirror the live join-code lifecycle. **Junction writes LIVE on `lingual-app-00044-4dw` (`DUAL_WRITE_SCHOOL_CHAIN=1`).** Reconciliation `--write` run against the real instance → all 27 PG classes have ≥1 teacher link, 22 active join codes, 0 classes with >1 active code (invariant holds on real PG). Parity at the documented-junk baseline (`extra_in_postgres=0`; the only `missing_in_postgres` are documented dirty-data rows). **Class-read (slice 6) is now unblocked.** (Anchors TASKS.md line ~55.)
6. **classes-read** *(FLIPPED TO PG-AUTHORITATIVE 2026-06-02, rev `lingual-app-00047-74z`, `READ_PG_CLASSES=1`, fail-open)* — `classes_read.py` routes `get_class` (keystone), `list_org_classes`, `list_teacher_classes`, `get_class_by_join_code` + overrides + tests. D2 FIXED (org_id→legacy via JOIN). Junctions reconstructed: `teacher_membership_ids[]` from `class_teachers` (sorted legacy ids), `join_code`/`_active`/`_generated_at` from the most-recent `class_join_codes` row (deactivated code still surfaced, but `get_class_by_join_code` filters active). `_CLASS_SHADOW_IGNORE` = created_at/updated_at/join_code_generated_at (clock skew). **Promotion evidence:** clean shadow soak — **100 compares, 0 mismatched** across BOTH the point-get (`/api/teacher/classes/{id}/analytics`→`get_class`) and the list readers (`/api/teacher/dashboard`→`list_teacher_classes`/`list_org_classes`), 0 fail-open; junction backfill parity-verified; dual-write drop-rate 0. **Post-flip verified:** banner `READ_PG_CLASSES=1 — class reads served from Postgres`, 24/24 PG-served with **0 fail-open** lines, teacher dashboard renders all 4 classes from PG (Testing Class es-ES, others ko-KR). `get_class_by_join_code` was not shadow-soaked (would require a real prod join) — accepted: single indexed lookup, Tier-2 tested incl. deactivated-code, all 22 active codes present in PG, and fail-open covers any miss. **Rollback:** instant `gcloud run services update lingual-app --region us-central1 --project lingu-480600 --update-env-vars READ_PG_CLASSES=shadow`. The shadow-deploy step (2026-06-01, rev 00046) required a full rebuild (rev 00045's image predated the code) and bumped `_READ_PG_MEMBERSHIPS` 0→shadow in the same commit to preserve the live membership shadow. `list_student_classes`/`list_org_classes_summary` deferred to slice 7 (need the enrollments JOIN).
7. **classes student/admin lists** *(BUILT 2026-06-02, flag OFF)* — `list_student_classes` (the read-cut of the Firestore N+1 → one `enrollments⋈classes` JOIN, full `get_class` shape, ordered by enrollment `updated_at` DESC to match Firestore) + `list_org_classes_summary` (curated admin shape, all statuses) in `classes_read.py`. **`list_student_classes` gates on BOTH `READ_PG_ENROLLMENTS` AND `READ_PG_CLASSES` (the WEAKER mode wins)** — it reads PG class rows via the JOIN, so codex flagged that gating on enrollments alone would keep serving PG class data after a class rollback (a rollback-ordering footgun); the weaker-of-two gate removes the dependency on operators following the runbook. `list_org_classes_summary` rides `READ_PG_CLASSES` (class-only).
8. **enrollments-read** *(ADAPTERS BUILT 2026-06-02, flag OFF — `READ_PG_ENROLLMENTS`)* — `get_student_class_enrollment`, `list_class_enrollments`, `list_student_enrollments`, `count_org_students` routed (roster, Canvas gap view, studentCount on every class list, practice-launch gate). The point-get keys on the `(class_id, student_firebase_uid)` UNIQUE columns, so it subsumes the Firestore deterministic-key + legacy-fallback scan (which exists only because Firestore addresses by the `{class}_{student}` doc id) — the deterministic-key audit is therefore moot, not just documentation. `count_org_students` is one `COUNT(enrollments⋈classes)` filtering enrollment status but NOT class status (mirrors the Firestore aggregate). **Codex-reviewed (SHIP-WITH-FIXES, all addressed):** (P1) an unresolved-parent read now returns a `_FALLBACK` sentinel → the router fail-opens to Firestore instead of an authoritative `None`/`[]` that would deny practice-launch/roster for an enrollment whose class missed the PG backfill; (P2a) `backfill.upsert_enrollment` preserves the Firestore `created_at`/`updated_at` so a backfilled row keeps its true `enrolledAt` (the live shadow omits them → `now()` ≈ SERVER_TIMESTAMP, unaffected); (P2b) the two-flag gate above; (P3) ordering. 20 Tier-1 + gated Tier-2 PG tests; 1138 backend green. **NEXT:** deploy `READ_PG_ENROLLMENTS=shadow` → soak (roster/dashboard traffic); a fresh re-backfill (now timestamp-preserving) before the flip → flip `=1` (last read family). Then retire Firestore writes.
9. **analytics — BLOCKED** by the sessions/events boundary (§0).

---

## 6. Rollback

Per-entity flag flip, **no deploy**. `1`→`shadow`/`0` instantly restores Firestore reads with zero data loss (dual-write keeps PG/Firestore in sync; Firestore is still SoR). Fail-open already degrades a PG outage to Firestore per-request. Roll back multi-entity changes in **REVERSE dependency order** (enrollments → classes → memberships → organizations) so a child is never left reading PG while its parent is back on Firestore.

**Rollback triggers (any one):** un-allowlisted shadow mismatches after a flip; the suspended-org gate or a voice/compliance fail-closed path mis-evaluating; teacher roster / not-yet-joined gap view showing wrong membership; a derived active-membership change for the 3 merged users; PG p99 read latency or error-rate breaching SLO.

**Hard floor:** do not begin "retire Firestore writes" (TASKS.md line 50) until all four flags have been at `1` and monitored for a full soak — that is the point of no cheap rollback.

---

## 7. Reused existing infrastructure (no new persistence system)

`RouteDeps.sql_engine` provider, `backend/db/sql.py` engine/`Session`, `resolution.resolve_legacy_id` (+ the new reverse-JOIN rule), the `enrollments.py` serializer pattern (corrected per D1), `dual_write._run`'s session lifecycle, and `backfill.parity_report` (offline parity paired with the live shadow compare). This is the sanctioned ADR-0001 coexistence path.
