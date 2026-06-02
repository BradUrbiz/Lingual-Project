# Analytics Family (practice_sessions + learning_events) Migration Design

**ADR-0001 Coexistence — Analytics Slice**
Date: 2026-06-02 | Status: **Slice A (assignments) SHIPPED & PG-AUTHORITATIVE in prod (2026-06-02). Events-ingest REVISED (see §5b), ready to implement next.** Internal workflow verdict was GO-WITH-FIXES → independent codex code-grounded review (2026-06-02, see "Codex Independent Review" at the end) returned RECONSIDER (3 P1 shape problems, all in the EVENTS-INGEST path) → **resolved by the revised events-ingest design in §5b** (ground-truth-first redesign workflow, 2026-06-02: 4 code-grounded fact-sets → 3 competing candidates → adversarial critique → synthesis). Companion to `READ_CUTOVER.md` (relational chain, flipped). NOTE: §2 and the original Slice B/C in §5 describe the ORIGINAL (pre-codex) events design and are **SUPERSEDED by §5b**; §1 (FK model), §3 (backfill), §4 (read cutover), and Slice A remain authoritative.

> **Slice A shipped 2026-06-02 (assignments now the FK parent for Slice B/C).** Live sequence against `lingual` / `lingual-app`: Alembic `0002` (grade columns) applied as the `postgres` table owner → deploy → `DUAL_WRITE_ASSIGNMENTS=1` (rev 00051) → unified backfill (assignments 40/40, `in_sync`, 0 missing/0 extra) → `READ_PG_ASSIGNMENTS=shadow` (rev 00052) → **offline shadow analog over ALL 41 prod assignments caught one real divergence: the vestigial `mapping_id` legacy field (removed curriculum-overlay; no consumer), now `_ASSIGNMENT_SHADOW_IGNORE`d (rev 00053)** → re-verified 41/41 clean → `READ_PG_ASSIGNMENTS=1` (rev 00054, PG-authoritative, fail-open). Live dual-write create verified (40→41), post-flip 0 fail-open. Slice B (practice_sessions) can now resolve its `assignment_id` FK against PG. See LIMITATIONS #47.

---

## 0. Executive Summary

The analytics family migration is architecturally feasible in five sequential flag-gated slices, with five mandatory fixes over the original design accepted from the adversarial critiques:

1. Per-turn `session_summary` UPDATE moves into the session-close batch (pool exhaustion at checkout is the dominant failure mode, not statement timeout).
2. Batch handler runs as a separate Cloud Run Job (not an inline Flask route) to isolate pool contention from the shared web process.
3. Bulk event INSERT uses `insert(LearningEvent).values([...]).on_conflict_do_nothing(index_elements=['legacy_firestore_id'])` — not `bulk_save_objects`, which breaks idempotency.
4. Shadow parity splits into two independent passes (session-summary: zero-divergence gate; event-derived: monotonic-convergence gate).
5. Term-scope backfill is mandatory at school onboarding, not optional.

> **Superseded by §5b (2026-06-02):** fixes **#1** (per-turn summary → session-close batch) and **#2** (separate Cloud Run Job) are **reversed** — the revised events-ingest design writes synchronously in-process and keeps the summary inline (one transaction per turn). Fixes #3 (idempotent bulk insert), #4 (split-pass parity), and #5 (term-scope backfill) **stand**, with #4's Pass-2 predicate now per-session count parity (no `events_synced_at`). Read **§5b** for the authoritative events-ingest design.

---

## 1. Entity and FK Model

### 1.1 FK Chain

```
organizations           (PG-authoritative, READ_PG_ORGANIZATIONS=1)
  └── classes           (PG-authoritative, READ_PG_CLASSES=1)
        └── assignments [SLICE A — first new entity]
              └── practice_sessions  [SLICE B]
                    └── learning_events  [SLICE C]
```

`student_firebase_uid` is a `Text` column in PG on both `PracticeSession` and `LearningEvent` — not a FK. No membership resolution needed.

### 1.2 Model Assessment

`backend/db/models/practice.py` is schema-complete for the events/sessions dual-write. `backend/db/models/assignment.py` needed **one** addition (below).

> **Alembic revision `0002` (assignment grade config) — REQUIRED for Slice A.** Adds nullable `grade_metric TEXT` + `grade_points DOUBLE PRECISION` to `assignments`. These are the LTI grade-passback fields (`set_assignment_grade_config`); without them the PG read adapter is not a faithful inverse of Firestore `get_assignment`, so `api_get_grade_config` (lti.py) would return null once `READ_PG_ASSIGNMENTS=1` (codex Slice-A P1). **Apply `0002` to the live instance BEFORE enabling `DUAL_WRITE_ASSIGNMENTS=1`** — else the assignment shadow INSERT references a missing column and fail-opens to a silent no-op.

> **~~Alembic revision (events_synced_at)~~ — SUPERSEDED by §5b (codex P1.2).** The original design added a nullable `events_synced_at TIMESTAMPTZ` to `practice_sessions` as a session-close-batch freshness marker. The revised synchronous ingest has no batch and no freshness marker — read freshness is per-session **event-count parity** instead (§4.5/§5b.4). The events/sessions dual-write needs **zero** schema changes.

Critical serializer field rename (same class as enrollment D1 defect):

| Firestore field | PG column | Rule |
|---|---|---|
| `student_uid` | `student_firebase_uid` | Every read adapter emits `student_uid` in the output dict. Covered by adapter unit tests. |

The `analytics_rollups` table has no SQLAlchemy model and is excluded from `0001_baseline.py`. It remains a schema stub — see §4.1.

### 1.3 The Assignments Prerequisite

`PracticeSession.assignment_id` and `LearningEvent.assignment_id` are `NOT NULL FK → assignments.id`. Until an assignment row exists in PG, `resolve_legacy_id(session, Assignment, firestore_assignment_id)` returns `None`. Assignments are an unconditional hard prerequisite.

Slice A must deliver all four before Slices B and C can begin:
- `shadow_create_assignment` / `shadow_update_assignment`
- `upsert_assignment` in `backfill.py`
- `DUAL_WRITE_ASSIGNMENTS` flag
- `READ_PG_ASSIGNMENTS` flag + read adapters (required for the session analytics `_weaker_mode` gate — if this stays at `''`, the weaker_mode resolves to `''` and session analytics can never activate)

---

## 2. Dual-Write Strategy

### 2.1 The Hot-Path Decision

The original design proposed synchronous per-turn `session_summary` UPDATE with 500ms statement timeout. **This is the wrong latency model.**

`sql.py` configures `pool_size=8, max_overflow=2, pool_timeout=3s` — 10 total connections. Under 30 concurrent students submitting conversational turns, 30 `_run` calls compete for 10 pool slots. The `statement_timeout=500ms` is irrelevant — it only applies **after** a connection is obtained. The dominant failure mode is pool contention at checkout: ~20 students wait up to 3s at `pool_timeout`.

**Resolution: all per-turn analytics writes move into the session-close batch. The live per-turn path has zero PG writes after this change.** The only synchronous PG write on the live path is the session CREATE (one write per session, student already waits on session init).

### 2.2 What Goes Synchronous vs. Batch

| Operation | Strategy | Rationale |
|---|---|---|
| Session CREATE | Synchronous `_run_with_timeout` (1000ms) | One write per session; student waits on session init; acceptable |
| `session.started` event | Session-close batch | Adds no analytics value not on the session row; synchronous doubles pool exposure at init |
| Per-turn `session_summary` UPDATE | Session-close batch | Pool exhaustion at 30 concurrent students (§2.1) |
| All other events | Session-close batch | High volume, hot path |
| Session-close task | Cloud Tasks → separate Cloud Run Job | Isolated pool |

### 2.3 The `_run_with_timeout` Helper

**Do NOT modify the existing `_run` helper in `dual_write.py`.** Dynamically constructing the `SET LOCAL` f-string inside `_run` is a correctness hazard (missing `ms` suffix or wrong variable name → silently unlimited timeout, swallowed by `except Exception`). Existing callers use positional arguments.

**Create `_run_with_timeout(sql_engine, op_name, fn, *, timeout_ms: int)` as a new helper in `dual_write_analytics.py`** (keyword-only `timeout_ms` prevents positional misuse). Same fail-open contract as `_run`; hardcodes the timeout to the caller-supplied value.

### 2.4 Dual-Write for `practice_sessions`

**Flag: `DUAL_WRITE_ANALYTICS_SESSIONS`**

`shadow_create_practice_session(session_doc)` in `dual_write_analytics.py`:
- Uses `_run_with_timeout(sql_engine, 'create_practice_session', fn, timeout_ms=1000)`
- Resolves `org_id`, `class_id`, `assignment_id` FKs via `resolve_legacy_id`
- On `UnresolvedParentError`: log DEBUG, return silently (fail-open)
- On `session.ended`: if `DUAL_WRITE_ANALYTICS_EVENTS=1`, enqueue Cloud Tasks task with `{session_firestore_id}`

No `shadow_update_practice_session`. The session_summary deferred UPDATE is written in the session-close batch.

### 2.5 Dual-Write for `learning_events`

**Flag: `DUAL_WRITE_ANALYTICS_EVENTS`**

All events — including `session.started` — are written via the session-close batch task. There are no synchronous event shadows.

**Session-close batch handler (separate Cloud Run Job):**

```python
# analytics_batcher/handler.py
# Validates Cloud Tasks OIDC token (NOT Firebase ID token)
# Uses own pool: pool_size=4, pool_timeout=30s

def handle_batch(session_firestore_id: str, db_session: Session) -> None:
    session_doc = database.get_practice_session(session_firestore_id)
    # Resolve all four FKs ONCE — shared across all events in this session
    org_uuid      = resolve_legacy_id(db_session, Organization, session_doc['org_id'])
    class_uuid    = resolve_legacy_id(db_session, Class, session_doc['class_id'])
    assignment_uuid = resolve_legacy_id(db_session, Assignment, session_doc['assignment_id'])
    session_uuid  = resolve_legacy_id(db_session, PracticeSession, session_firestore_id)

    # Remediation: if session_uuid is None but assignment resolves,
    # attempt session CREATE before processing events
    if session_uuid is None and assignment_uuid is not None:
        upsert_practice_session(db_session, session_doc)
        session_uuid = resolve_legacy_id(db_session, PracticeSession, session_firestore_id)

    if any(x is None for x in [org_uuid, class_uuid, assignment_uuid, session_uuid]):
        raise BatchFKResolutionError(...)  # Cloud Tasks retry; NOT UnresolvedParentError

    events = database.list_session_learning_events(session_firestore_id)
    # Single multi-row INSERT with ON CONFLICT DO NOTHING (SA 2.0 idiom)
    db_session.execute(
        insert(LearningEvent).values([
            {
                'legacy_firestore_id': e['id'],
                'org_id': org_uuid, 'class_id': class_uuid,
                'assignment_id': assignment_uuid, 'session_id': session_uuid,
                'student_firebase_uid': e['student_uid'],
                'event_type': e['event_type'], 'turn_index': e.get('turn_index'),
                'payload': e.get('payload', {}), 'created_at': e.get('created_at'),
            }
            for e in events
        ]).on_conflict_do_nothing(index_elements=['legacy_firestore_id'])
    )
    # Deferred session_summary UPDATE (was per-turn in original design)
    db_session.execute(
        update(PracticeSession).where(PracticeSession.id == session_uuid)
        .values(
            session_summary=session_doc.get('session_summary', {}),
            cost_summary=session_doc.get('cost_summary', {}),
            analysis_state=session_doc.get('analysis_state', {}),
            status=session_doc.get('status', 'completed'),
            ended_at=session_doc.get('ended_at'),
            events_synced_at=datetime.now(UTC),
        )
    )
    db_session.commit()
```

**Retry policy:** 3 attempts, exponential backoff. On exhaustion: emit structured Cloud Logging entry `{event: 'event_batch_failed', session_firestore_id: ..., error: ...}` + Log-Based Alert in Cloud Monitoring. **No `failed_event_batches` PG table** — if PG is unhealthy the table INSERT would also fail; Cloud Logging is the correct durability primitive for a shadow failure.

**`BatchFKResolutionError` is distinct from `UnresolvedParentError`.** `UnresolvedParentError` is the quiet-coexistence no-op signal in `_run`'s except handler. `BatchFKResolutionError` signals that a batch task must retry. It does NOT inherit from `UnresolvedParentError` and is NOT caught by `_run`.

---

## 3. Backfill Strategy

### 3.1 Term-Scope Backfill Is Mandatory

Pure forward-only cutoff produces two problems that block the migration goal:

1. **Unreadable shadow soak:** any assignment with pre-cutoff sessions produces permanent aggregate divergence (Firestore has those sessions; PG does not), making the Pass 1/Pass 2 soak signal permanently nonzero.
2. **Firestore write retirement blocked:** TASKS.md goal is to retire Firestore writes after read cutover. If pre-cutoff sessions are permanently Firestore-only, Firestore reads must remain operational forever.

**Decision:** The term-scope backfill (sessions from active academic term start date) is **mandatory** at school onboarding, run BEFORE any dual-write flag is enabled.

### 3.2 What Goes Into `run_backfill`

```python
_PIPELINE = (
    ('organizations', Organization, upsert_organization),
    ('memberships',   Membership,   upsert_membership),
    ('classes',       Class,        upsert_class),
    ('enrollments',   Enrollment,   upsert_enrollment),
    ('assignments',   Assignment,   upsert_assignment),  # Slice A
    # practice_sessions and learning_events are NOT here — see §3.3
)
```

### 3.3 Why Events Are NOT in `run_backfill`

The SAVEPOINT-per-row loop (3 PG round-trips per row through pg8000) at 600k events (2,400 sessions × 250 events — revised estimate based on `build_derived_learning_events` emitting 6-10 derived events per `student.turn` × ~20 turns/session + primary events) takes 3–6 hours wall-clock. This is not acceptable.

**The correct bulk insert pattern for events (in `scripts/backfill_practice_sessions_term.py`):**

```python
CHUNK_SIZE = 2000
for i in range(0, len(event_rows), CHUNK_SIZE):
    chunk = event_rows[i:i + CHUNK_SIZE]
    db_session.execute(
        insert(LearningEvent).values(chunk)
        .on_conflict_do_nothing(index_elements=['legacy_firestore_id'])
    )
db_session.commit()
```

Single multi-row INSERT per chunk, no per-row SAVEPOINT, genuine idempotency. Drops 600k-row event backfill from hours to 2-4 minutes. The implementation plan must **explicitly prohibit** the SAVEPOINT-per-row pattern for events.

### 3.4 Parity Strategy

**Sessions:** id-set diff (existing `parity_report` pattern) is feasible at ~2,400 rows per term.

**Events: per-session COUNT diff, not full-table id-set diff.**

The existing `parity_report` does `SELECT legacy_firestore_id FROM learning_events` with no WHERE clause. At 600k rows this produces ~120 MB of Python objects (each UUID string ~36 bytes × ~200 bytes Python set overhead) plus hours of Firestore reads at throughput limits. This cannot scale to events.

The correct event parity is a per-session COUNT comparison:

```python
# O(num_sessions) queries, not O(num_events)
pg_counts = {session_legacy_id: count
             for session_legacy_id, count in db_session.execute(
                 select(PracticeSession.legacy_firestore_id, func.count(LearningEvent.id))
                 .join(LearningEvent).where(Class.legacy_firestore_id == class_id)
                 .group_by(PracticeSession.legacy_firestore_id)
             ).all()}
```

---

## 4. Read Cutover

### 4.1 The `analytics_rollups` Decision

**No precomputed `analytics_rollups` for beta.** TASKS.md line 56 stays `[-]`.

**Important caveat:** the 5-50ms query time claim applies to session_summary aggregations only. `_aggregate_context_tag_counts` and `_aggregate_error_event_metadata` read the `payload` JSONB column per row. Without a GIN index on `payload`, these scan JSONB fields for every event in the assignment. A GIN index on `learning_events(payload)` OR denormalization of `context_tag` into an indexed column is required before Slice E read flip.

### 4.2 Aggregation Strategy: Python-over-PG

Analytics layer stays in Python. Read path becomes a direct substitution: swap Firestore fetcher for PG adapter, pass same list of dicts to same Python functions in `practice_analytics.py`. No changes to `practice_analytics.py` in this migration.

### 4.3 ReadRouter Adapters

All adapters in `backend/db/repository/analytics_reads.py`. Each emits `student_uid` (not `student_firebase_uid`). FK columns emitted as parent's `legacy_firestore_id` via JOIN (never raw UUIDs — same rule as enrollment D1 fix).

- **`list_assignment_practice_sessions_pg`**: resolve Assignment FK; `WHERE assignment_id = $uuid ORDER BY started_at DESC`
- **`list_class_practice_sessions_pg`**: resolve Class FK; `WHERE class_id = $uuid ORDER BY started_at DESC`
- **`list_student_assignment_practice_sessions_pg`**: resolve Assignment FK; `WHERE assignment_id = $uuid AND student_firebase_uid = $uid`
- **`list_student_class_practice_sessions_pg`**: resolve Class FK; `WHERE class_id = $uuid AND student_firebase_uid = $uid`
- **`list_assignment_learning_events_pg`**: resolve Assignment FK; `WHERE assignment_id = $uuid [AND event_type = ANY($types)] ORDER BY created_at` — event_type filter pushed into SQL
- **`list_session_learning_events_pg`**: resolve PracticeSession FK; `WHERE session_id = $uuid ORDER BY created_at`
- **`list_student_class_learning_events_pg`**: resolve Class FK; `WHERE class_id = $uuid AND student_firebase_uid = $uid ORDER BY created_at`

**Assignment read adapters (also Slice A):** `get_assignment_pg`, `list_class_assignments_pg` — required for `READ_PG_ASSIGNMENTS` to reach `1`.

### 4.4 The `_weaker_mode` Gate for Analytics

**Session reads gate:**
```python
_weaker_mode('READ_PG_ASSIGNMENTS', 'READ_PG_ANALYTICS_SESSIONS')
```
`READ_PG_CLASSES` is NOT in this gate — classes are already PG-authoritative (`=1`), adding it is a vacuous check. The actual FK dependency is assignments.

**Event reads gate:**
```python
_weaker_mode('READ_PG_ANALYTICS_SESSIONS', 'READ_PG_ANALYTICS_EVENTS')
```

`_route_read`'s `also` parameter currently accepts a single string. It must be extended to accept a tuple of flags. This is a small interface change in `read_router.py`.

**Sessions and events can flip independently** (the original design's "must flip together" claim is over-constrained):
- `READ_PG_ANALYTICS_SESSIONS=1` enables session-summary-derived analytics
- `READ_PG_ANALYTICS_EVENTS=1` additionally enables context_tag and error_spread
- The `_weaker_mode` gate enforces the dependency automatically

### 4.5 Split Aggregate Shadow Parity

**Pass 1 — Session-summary metrics (convergence target: zero divergence):**
- Fields: `total_student_turns`, `total_assistant_turns`, `total_student_words`, `rubric_dimension_scores`, `completed_session_count`
- Derived from pre-rolled `session_summary` JSONB blob; expected exact match once session dual-write is stable
- Tolerance map: `{total_student_turns: 0, total_student_words: 0, rubric_dimension_scores: 0.01}`
- Divergence here indicates a serialization bug

**Pass 2 — Event-derived metrics (convergence target: per-session count parity):**
- Fields: `context_tag_counts`, `error_event_metadata`
- **Amended per §5b (codex P1.2):** synchronous ingest replaces the old session-close batch, so there is **no batch lag** and no `events_synced_at` column. The freshness predicate is **per-session event-count parity**: accept the read flip for a session when `count(PG learning_events) == count(Firestore learning_events)` for that session. Steady-state divergence comes only from the coexistence-drop paths in §5b.6, which the term-scope backfill closes.

The two passes must NOT be combined into a single mismatch threshold.

### 4.6 The Live Cross-Store Split-Brain (Active Today)

`list_class_enrollments` is PG-authoritative; `list_class_practice_sessions` is Firestore. Both are joined in Python by `student_uid` in `build_class_analytics_payload`. The cascade-delete divergence (LIMITATIONS #43a) can produce phantom enrolled-but-session-less students. This is active today, is not introduced by this migration, and is fully resolved when analytics reads cut over at Slice E. Add a LIMITATIONS entry documenting this condition.

---

## 5. Slice Decomposition and Sequencing

### Slice A: Assignments Dual-Write + Read Adapters

**Prereqs:** `READ_PG_CLASSES=1` (live), `READ_PG_ORGANIZATIONS=1` (live)

**Deliverables:**
- `dual_write_analytics.py`: `_run_with_timeout`, `shadow_create_assignment`, `shadow_update_assignment`; `DUAL_WRITE_ASSIGNMENTS` flag
- `backfill.py`: `upsert_assignment` (resolves `org_id`/`class_id` FKs, maps `canvas_module_item_ref` JSONB); add to `_PIPELINE`
- `analytics_reads.py`: `get_assignment_pg`, `list_class_assignments_pg`
- `read_router.py`: `READ_PG_ASSIGNMENTS` flag; extend `_route_read` to accept `also` as tuple
- `scripts/backfill_assignments.py`

**Tests:** shadow writes assignment row with correct FK UUIDs; `UnresolvedParentError` when class not in PG; id-set parity against Firestore; adapters emit `legacy_firestore_id` not UUID for FK fields.

**Flags introduced:** `DUAL_WRITE_ASSIGNMENTS`, `READ_PG_ASSIGNMENTS`

---

### Slice B: practice_sessions Dual-Write

**Prereqs:** Slice A complete; assignments backfilled; parity clean; Cloud Tasks queue provisioned; Alembic revision 0002 applied to live instance

**Deliverables:**
- `dual_write_analytics.py`: `shadow_create_practice_session`; `DUAL_WRITE_ANALYTICS_SESSIONS` flag
- Session-create shadow: synchronous, `_run_with_timeout(..., timeout_ms=1000)`; resolves 3 FK parents; on `session.ended` + `DUAL_WRITE_ANALYTICS_EVENTS=1`: enqueue Cloud Tasks task
- Alembic revision `0002`: `events_synced_at TIMESTAMPTZ` (nullable) on `practice_sessions`
- `scripts/backfill_practice_sessions_term.py`: **MANDATORY** term-scope backfill; chunked bulk INSERT for events (not SAVEPOINT-per-row); runs BEFORE the dual-write flag is enabled

**No `shadow_update_practice_session`.** Session_summary deferred to session-close batch.

**Tests:** session create → PG row with correct FKs; session end → Cloud Tasks task enqueued (mock task client); unresolved parent → silent no-op, Firestore write completes; pool exhaustion simulation → shadow dropped, no exception surfaced.

**Flags introduced:** `DUAL_WRITE_ANALYTICS_SESSIONS`

---

### Slice C: learning_events Session-Close Batch Handler (Cloud Run Job)

**Prereqs:** Slice B complete; `DUAL_WRITE_ANALYTICS_SESSIONS` live; session rows in PG; revision 0002 applied

**Deliverables:**
- Separate `analytics_batcher` Cloud Run Job; validates Cloud Tasks OIDC tokens; `pool_size=4, pool_timeout=30s`
- Batch handler: resolve 4 parent FKs once per batch; `insert(...).on_conflict_do_nothing(index_elements=['legacy_firestore_id'])`; deferred session_summary UPDATE; sets `events_synced_at`
- `BatchFKResolutionError` (distinct from `UnresolvedParentError`)
- Retry policy: 3 attempts, exponential backoff; on exhaustion: Cloud Logging structured log + Log-Based Alert; **no `failed_event_batches` table**
- `DUAL_WRITE_ANALYTICS_EVENTS` flag

**Tests:** N events inserted correctly; idempotent re-run; FK resolution for 4 parent IDs; `BatchFKResolutionError` on unresolved → retry; session-not-in-PG remediation path.

**Flags introduced:** `DUAL_WRITE_ANALYTICS_EVENTS`

---

### Slice D: Read Adapters + Split-Pass Shadow Soak

**Prereqs:** Slices A + B + C complete; term-scope backfill run; PG session and event rows present

**Deliverables:**
- All 7 session/event read adapters in `analytics_reads.py`
- `read_router.py`: session reads gated on `_weaker_mode('READ_PG_ASSIGNMENTS', 'READ_PG_ANALYTICS_SESSIONS')`; event reads on `_weaker_mode('READ_PG_ANALYTICS_SESSIONS', 'READ_PG_ANALYTICS_EVENTS')`
- GIN index on `learning_events(payload)` OR context_tag column denormalization (Alembic revision 0003)
- Split-pass shadow parity: Pass 1 (session-summary, zero-divergence) and Pass 2 (event-derived, monotonic-convergence) as separate compare paths
- Deploy `READ_PG_ASSIGNMENTS=shadow` → soak → flip to `1` → deploy `READ_PG_ANALYTICS_SESSIONS=shadow` → 2-week prod soak

---

### Slice E: Read Flag Flip + Firestore Write Retirement

**Prereqs:** Pass 1 mismatch <0.5%; Pass 2 **per-session event-count parity** (`count(PG)==count(Firestore)` per session — replaces the old `events_synced_at` predicate, see §5b.4/§4.5); GIN index deployed

**Deliverables:**
- Flip `READ_PG_ANALYTICS_SESSIONS=1`; soak 48h; flip `READ_PG_ANALYTICS_EVENTS=1`
- `WRITE_FIRESTORE_ANALYTICS` safety-net flag (default `1` for 1 sprint); retire Firestore writes after clean serving sprint
- LIMITATIONS.md: add entries for historical Firestore fallback and cross-store split-brain resolution
- TASKS.md analytics items complete

---

### Sequencing

```
A: DUAL_WRITE_ASSIGNMENTS + READ_PG_ASSIGNMENTS infrastructure + assignment read adapters
  ↓ (term-scope backfill MANDATORY before B)
B: DUAL_WRITE_ANALYTICS_SESSIONS (create-only shadow + Cloud Tasks enqueue)
  ↓
C: DUAL_WRITE_ANALYTICS_EVENTS (Cloud Run Job batch handler)
  ↓
D: All read adapters + shadow soak (READ_PG_ASSIGNMENTS=1 → READ_PG_ANALYTICS_SESSIONS=shadow)
  ↓
E: READ_PG_ANALYTICS_SESSIONS=1 + READ_PG_ANALYTICS_EVENTS=1 + retire Firestore writes
```

Minimum elapsed time: ~5 weeks from Slice A start to Slice E completion.

---

## 5b. Events Ingest — Revised Design (supersedes §2, original Slice B, original Slice C)

**Verdict of the redesign:** the original events-ingest design (Cloud Tasks → a Cloud Run **Job**, per-turn `session_summary` deferred to a session-close batch, events re-read from Firestore at close) is replaced by a **synchronous, batched, in-process dual-write.** Net-new infra is minimal: **no new service, queue, or Job** — only **one Cloud Scheduler trigger** for the orphaned-session reconciler (which calls an internal route on the existing app). The async fan-out (outbox / Cloud Tasks → Cloud Run **Service**) is the correct *GA-scale* end state and is spec'd here as the upgrade path, but is **deferred until measured pool/latency pressure justifies it** — which does not exist at one-school beta.

> **Codex re-review (2026-06-02): RECONSIDER → all P1/P2 incorporated below (see §5b.7).** The two central structural bets were *validated* against the code — batching N events + the summary into one `_run`/one-commit/one-checkout works, and FK-resolve-once is sound (primary and derived events share one `build_learning_event_payload`/`session_record`). The findings corrected specifics, not the architecture.

This was derived from a ground-truth-first redesign workflow (2026-06-02). The two decisive critiques split: **infra-simplicity** ranked synchronous-in-process first (zero new operational surfaces); **pool/latency** ranked it last (its naive form does up to 13 sequential PG round-trips per turn on the live voice path). The synthesis below **neutralizes the latency objection by batching**, keeping the simplicity win.

### 5b.1 The load-bearing facts (verified against code)

- **Pool:** `pool_size=8, max_overflow=2, pool_timeout=3s, pool_pre_ping=True` (`backend/db/sql.py:36-43`), **one pool per process**, prod gunicorn `--workers 1 --threads 8` (`Dockerfile:59`). Hard ceiling = 10 concurrent connections; `pool_timeout=3s` already caps checkout wait (**resolves codex P2b** for the main app).
- **Hot path:** `POST /api/practice-sessions/<id>/events` is awaited by the SPA on **every conversational turn** — both the realtime voice path (`persistRealtimeMessage`) and the text path (`handleSendText`) (`AssignmentPracticeWorkspace.tsx`). Per student turn the handler writes **1 primary + a variable number of derived events + 1 `update_practice_session`** — the derived count is **not code-bounded** (loops over target expressions, vocabulary, communicative functions, discourse moves, detected errors, rubric dimensions — `practice_analytics.py:1824+`), commonly a handful but unbounded in principle. These are already that-many sequential Firestore round-trips today (`curriculum_admin.py:556-578`). The FK fields (`org_id, class_id, assignment_id, student_uid`) are **identical across all events in a turn** (copied from `session_record`, fetched at `:530`) — **codex-validated**, so resolve-once is sound.
- **Session close:** there is **no server-owned close today** — `session.ended` is client-fired, including a fire-and-forget unmount path; sessions can be left permanently `status='active'` (`curriculum_admin.py:535`, `AssignmentPracticeWorkspace.tsx:1068`). This is codex P1.2.
- **Deploy:** single Cloud Run service via gunicorn; **no existing Cloud Tasks / Pub/Sub / second service**. ⚠️ **The Firebase Cloud Functions package (`functions/main.py`) is Firestore-only** — its `requirements.txt` has no SQLAlchemy / pg8000 / Cloud SQL connector and it explicitly cannot import backend modules (`functions/main.py:303`), and Cloud SQL IAM/env is wired for the **Cloud Run** deploy only (`cloudbuild.yaml:55`). So `functions/` **cannot host a Postgres sweeper** (codex P1.1). The reconciler therefore lives as an internal route in the Flask app, triggered by Cloud Scheduler over HTTP (see §5b.2 #5).

### 5b.2 The design

**(1) One transaction per turn, not one per event.** New module `backend/db/dual_write_analytics.py`, `shadow_write_turn(engine, *, session_firestore_id, events, session_updates)`:
- Opens **one** Session via a **new hot-path `_run` variant** that sets `SET LOCAL statement_timeout = 2000ms` (the existing `dual_write._run` hardcodes 10s — `dual_write.py:36` — which is a worst-case ceiling, not a hot-path budget; do **not** reuse it as-is). Factor the shared own-Session/swallow-all skeleton, parameterize the timeout.
- Resolves the parent FKs (`session→UUID`, plus `assignment/class/org`) **once** per turn via `resolve_legacy_id` — not once per event.
- **Stable event IDs are required (codex P1.3).** `on_conflict_do_nothing(index_elements=['legacy_firestore_id'])` only gives idempotency if each row carries a non-null `legacy_firestore_id` — but `legacy_firestore_id` is *nullable*-unique (`base.py:45`), so null IDs do **not** dedupe. Today the route discards the Firestore event id that `create_learning_event` auto-generates and returns (`database.py:2459`, `curriculum_admin.py:556/570`). **Implementation requirement:** capture the returned Firestore id for the primary **and each derived** event (or preallocate ids and pass `event_id=` into `create_learning_event`), collect them with their payloads, then hand the `(id, payload)` list to `shadow_write_turn`.
- Bulk-inserts the collected events: `insert(LearningEvent).values([...]).on_conflict_do_nothing(index_elements=['legacy_firestore_id'])` (kept from original fix #3), then applies the `practice_sessions` UPDATE (rolling summary / finalize) as the **last statement**, then a single `commit`. Fail-open (swallow all).
- **Result:** **one** pool checkout per turn (~20–40ms healthy) instead of one-per-event. This *bounds* the pool/latency cost — it does not eliminate it: under degraded PG each turn still occupies one connection up to the `pool_timeout=3s` checkout wait + statement ceiling, and with 1 worker / 8 threads a slow PG can tie up all request threads (once per turn now, not once per event). Beta-acceptable; the GA upgrade path (§5b.3) moves it off the hot path if measured p95 degrades.

**(2) `session_summary` stays inline (deliberate reversal of original fix #1).** The original moved the per-turn summary UPDATE into a close-time batch *because* per-event pool churn risked exhaustion. Batching removes that risk (one checkout/turn), so the summary UPDATE rides the same transaction — matching what Firestore does inline at `:578` today, keeping analytics **fresh per-turn** (teachers query immediately after class) and eliminating the need for an `events_synced_at` freshness gate.

**(3) Durable post-cutover source (resolves P1.1).** Every row is built from request scope (`session_record` + event payload) and inserted in the same handler. **Firestore is never re-read.** When Firestore school-domain writes retire (Slice E), the write seam is unchanged — events still originate from the request. An invariant comment in `dual_write_analytics.py` forbids introducing a Firestore re-read.

**(4) Server-owned finalize (resolves P1.2).** On the `session.ended` branch (`curriculum_admin.py:578`), after the Firestore update, the same `shadow_write_turn` call stamps PG `status`/`ended_at` as the final statement. No client dependency; idempotent (overwrite semantics match Firestore today).

**(5) Reconciler for orphaned sessions (resolves P1.2; corrected per codex P1.1).** An **internal Flask route** in the existing app (e.g. `POST /internal/analytics/sweep-orphaned-sessions`, registered only in the blueprint, auth = a shared-secret/OIDC header — **not** a public route, **not** `functions/`, which can't reach Cloud SQL), invoked by **one Cloud Scheduler HTTP trigger** every 60 min: PG `practice_sessions WHERE status='active' AND started_at < now() - INTERVAL '90 min'` → `abandoned`, `ended_at=now()`, plus a synthetic `session.ended` event row. Runs in-process on the app's existing engine (one short transaction touching ~0 rows at beta — negligible pool impact; reuse the hot-path `_run` variant). **Gated on `DUAL_WRITE_ANALYTICS_SESSIONS=1`** — dormant until sessions are in PG. Net-new infra = **one Cloud Scheduler trigger + one internal route**; no new service, queue, or Job. (90 min: a class period is ≤60 min.)

**(6) No Cloud Run Job (resolves P1.3).** The wrong primitive is **removed**, not fixed. At beta the synchronous batched write is simpler-correct.

**(7) One combined call per turn — flag matrix (codex P2c).** The route has exactly **one** post-event update seam (`curriculum_admin.py:578`). To keep "one checkout per turn," the two flags must compose into a **single** shadow call, never a sessions-shadow *plus* an events-shadow:

| `DUAL_WRITE_ANALYTICS_SESSIONS` | `DUAL_WRITE_ANALYTICS_EVENTS` | Hot-path behavior at `:578` |
|---|---|---|
| off | off | no PG write (Firestore only) |
| **on** | off | `shadow_update_practice_session` only (summary + finalize); session-create uses `shadow_create_practice_session`. Slice B's standalone state. |
| on | **on** | **`shadow_write_turn`** does events **and** the summary/finalize UPDATE in one transaction. The standalone `shadow_update_practice_session` is **not** also called — `shadow_write_turn` subsumes it. |
| off | on | invalid (blocked by §5b.5 ordering — events need sessions in PG) |

`shadow_write_turn` takes `session_updates` precisely so the summary UPDATE rides the same transaction as the event inserts when both flags are on.

### 5b.3 GA-scale upgrade path (deferred, not discarded)

If Cloud Run request-latency **p95 on `POST /events` measurably degrades** at multi-school scale, move `shadow_write_turn` off the hot path **without changing the data model or FK logic** — two options, both already designed in the candidate set:
- **PG outbox + in-process drain** (synchronous outbox row is the durability anchor; a daemon drains it). Note the Cloud-Run CPU-throttle caveat: a `threading.Event`-driven drain, not a bare sleep.
- **Cloud Tasks → Cloud Run *Service*** (not a Job), event carried **in the task body** (never re-read from Firestore), OIDC auth to a private worker service.

The task-body-self-contained row is forward-compatible with both. **Trigger to revisit:** measured p95 regression, expected only at ~3+ concurrent schools.

### 5b.4 Re-sliced B/C (these supersede the originals in §5)

- **Slice B (revised) — practice_sessions dual-write:** `shadow_create_practice_session` (at session-create) **and** `shadow_update_practice_session` (at `:578`, rolling summary **and** finalize) — the latter is the **events-flag-off** path per the §5b.2 #7 matrix. Server-owned finalize on `session.ended`. Internal-route reconciler + Cloud Scheduler trigger (dormant until flag on). **No Cloud Tasks, no Alembic `0002` (`events_synced_at`) — summary is inline/fresh.** Term-scope backfill (kept) + session-summary parity (Pass 1, zero-divergence). Flag: `DUAL_WRITE_ANALYTICS_SESSIONS`.
- **Slice C (revised) — learning_events dual-write:** `shadow_write_turn` batched single-transaction per turn (FKs resolved once, stable Firestore event ids → `on_conflict_do_nothing`). When this flag is on it **subsumes** the standalone summary update (§5b.2 #7). Chunked bulk term-scope backfill (kept) + count-based per-session parity (Pass 2). Flag: `DUAL_WRITE_ANALYTICS_EVENTS`.
- **Slice A: unchanged.** **Slices D/E: AMENDED (codex P1.2).** Because `events_synced_at` is dropped, the event-read freshness predicate in §4.5 Pass 2 and the Slice E prereq is **replaced by per-session event-count parity**: accept the event read-flip for a session when `count(PG learning_events) == count(Firestore learning_events)` for that session (synchronous ingest means this converges per-turn, not after a batch). §4 read-cutover otherwise stands — Python-over-PG aggregation on the pre-aggregated `session_summary` JSONB (**resolves codex P2a**, no per-event N+1) and the `_weaker_mode` gates are unchanged.

### 5b.5 Hard prerequisite ordering (operational rule)

`Slice A` (assignments in PG; `READ_PG_ASSIGNMENTS=1` soaked) → `DUAL_WRITE_ANALYTICS_SESSIONS=1` soaked → `DUAL_WRITE_ANALYTICS_EVENTS=1` → read flips. Enabling the events flag before sessions **and** assignments are in PG makes every event shadow a silent FK no-op. Enforce in TASKS/TECH_SPEC.

### 5b.6 Accepted limitation — coexistence drop window (broadened per codex P2a)

During coexistence the PG shadow can silently drop an event in **more than just a crash**, because `_run` swallows all failures and `resolve_legacy_id` returns `None` for unmapped parents (`dual_write.py:91`, `resolution.py:20`):
- **SIGKILL** in the ~20–40ms window between the Firestore write and the `shadow_write_turn` commit.
- **Unresolved-parent FK no-op:** if a session's shadow-create dropped (or it predates `DUAL_WRITE_ANALYTICS_SESSIONS=1`), its events also no-op even with the events flag on.
- **Generic PG failure** (timeout, pool exhaustion) swallowed fail-open.

In all three, the event is in Firestore but not PG. This is acceptable *only because* the **mandatory term-scope backfill + per-session count-parity gate** (Slice C/E) reconciles every divergence **after** the coexistence drops occur and **before** Firestore writes retire (Slice E). The gate — not the synchronous write — is what makes PG complete. Record all three in LIMITATIONS, not just the crash window.

### 5b.7 Codex re-review disposition (2026-06-02)

Independent code-grounded review returned **RECONSIDER**; all findings are incorporated above (none changed the architecture):
- **P1.1** reconciler moved out of `functions/` (Firestore-only) into an internal Flask route + Cloud Scheduler trigger; "zero net-new infra" corrected to "one Cloud Scheduler trigger."
- **P1.2** dropped `events_synced_at` → §4.5 Pass 2 / Slice E freshness predicate replaced by per-session event-count parity (§5b.4).
- **P1.3** batch idempotency requires capturing the Firestore-returned event id as `legacy_firestore_id` (nullable-unique → null ≠ dedupe); §5b.2 #1.
- **P2a** drop limitation broadened to all fail-open/no-op paths (§5b.6).
- **P2b** "batching removes pool risk" softened to "bounds, not eliminates"; the 2000ms hot-path timeout needs a new `_run` variant (existing is 10s); §5b.2 #1.
- **P2c** flag matrix added so events+summary compose into one call, not two (§5b.2 #7).
- **P3** "~11 derived events" → variable, not code-bounded (§5b.1).
- **Validated by codex:** one-`_run`/one-commit/one-checkout batching is structurally sound; FK-resolve-once is correct; `:578` is the right finalize seam and `session_updates` carries `status`/`ended_at` on `session.ended`.

---

## 6. FK Resolution

### 6.1 Resolution Chain Per Entity

**Session CREATE shadow:**
```
resolve_legacy_id(session, Organization, org_id_str)      → org_pg_uuid
resolve_legacy_id(session, Class, class_id_str)           → class_pg_uuid
resolve_legacy_id(session, Assignment, assignment_id_str) → assignment_pg_uuid
student_firebase_uid = firestore_doc['student_uid']       # direct copy
```

**Per-turn shadow (`shadow_write_turn`, once per turn, reused for all of the turn's events):**
```
resolve_legacy_id(db_session, Organization, session_doc['org_id'])
resolve_legacy_id(db_session, Class, session_doc['class_id'])
resolve_legacy_id(db_session, Assignment, session_doc['assignment_id'])
resolve_legacy_id(db_session, PracticeSession, session_firestore_id)
# O(4) resolutions total regardless of event count — not O(4N). (codex-validated:
# primary + derived events share one session_record, so the 4 parents are identical.)
```

### 6.2 Unresolved-Parent Remediation (per turn / backfill)

When `shadow_write_turn` (or the term-scope backfill) finds `session_uuid is None`:
- On the **live path**: fail-open no-op (the event stays Firestore-only this turn; §5b.6) — the term-scope backfill + count-parity gate reconciles it before write retirement.
- In the **backfill**: if `assignment_uuid is not None`, `upsert_practice_session(db_session, session_doc)` then re-resolve — handles the gap between dual-write enablement and term-scope backfill; if `assignment_uuid is None` too, raise `BatchFKResolutionError` (term-scope backfill has not run; operator must run it).

---

## 7. Open Decisions Deferred

1. **`analytics_rollups` refresh worker** — deferred post-beta (TASKS.md line 56 stays `[-]`). Revisit when PG analytics query times exceed 200ms at school-of-record scale.
2. **Event retention + partitioning** — monthly range partitioning with DROP for old partitions is the standard pattern. Not required for beta; must be designed before multi-school GA.
3. **`event_type` CHECK constraint** — left unconstrained during coexistence. The 18-value `SUPPORTED_EVENT_TYPES` set is application-layer enforced. Add a permissive CHECK or enum type only if a data-quality incident occurs.
4. **Assignments read cutover scope** — assignment read adapters are scoped into Slice A (they are required for `READ_PG_ASSIGNMENTS=1` which gates session analytics). The full assignment CRUD route cutover (beyond the two analytics-path reads) is a separate follow-on slice.

---

## 8. Critique Disposition

| Finding | Decision |
|---|---|
| Hot-path latency: 500ms timeout is irrelevant; pool contention at checkout is the real bound | ACCEPTED — per-turn UPDATE moved to batch |
| Triple round-trip per turn | MOOT after fix 1; session-create still has 4 RTTs but once per session |
| Surge + auth gap: batch handler in Flask shares pool; Firebase vs OIDC auth mismatch | ACCEPTED — separate Cloud Run Job with own pool and OIDC validation |
| session.started synchronous shadow on init critical path | ACCEPTED — folded into session-close batch |
| _run extension risk: f-string hazard, positional kwarg misuse | ACCEPTED — _run_with_timeout as new helper; _run untouched |
| Forward-cutoff + shadow soak: permanently noisy without backfill | ACCEPTED — term-scope backfill mandatory; split-pass parity |
| bulk_save_objects: SA 1.x legacy API, no ON CONFLICT | ACCEPTED — insert(...).on_conflict_do_nothing() |
| _weaker_mode gate: READ_PG_CLASSES spurious; multi-flag interface gap | ACCEPTED — gate on READ_PG_ASSIGNMENTS + READ_PG_ANALYTICS_SESSIONS; extend _route_read |
| failed_event_batches table: PG write to handle PG write failure | ACCEPTED — Cloud Logging + Log-Based Alert; no new table |
| Event count underestimate: 80/session too low | ACCEPTED — revised to 250/session |
| SAVEPOINT-per-row infeasible at event scale | ACCEPTED — chunked bulk INSERT; explicit prohibition in implementation spec |
| parity_report id-set infeasible at 600k events | ACCEPTED — per-session COUNT diff |
| Pool exhaustion at session-close surge (duplicate of Finding 3) | ACCEPTED — same fix |
| JSONB payload cost not analyzed; 5-50ms claim overstated for context_tag/error queries | ACCEPTED — GIN index or denormalization required before Slice E |
| Forward-only cutoff incompatible with retiring Firestore writes | ACCEPTED — term-scope backfill mandatory |
| Split-brain already live; cascade-delete divergence | ACCEPTED — LIMITATIONS entry; resolved at Slice E |
| Aggregate parity structurally ambiguous | ACCEPTED — split-pass design |
| Doubly-unresolved FK chain | ACCEPTED — remediation path in batch handler; mandatory backfill |
| Per-turn UPDATE pool pressure (duplicate) | ACCEPTED — same fix |
| session_summary NOT sufficient for all analytics | ACCEPTED — Pass 2 parity + LIMITATIONS entry |
| READ_PG_ASSIGNMENTS=1 gate deferred out-of-scope | ACCEPTED — assignment read adapters scoped into Slice A |
| uuidv7 asymmetry + Alembic revision ordering | ACCEPTED — revision 0002 explicitly called out; handler must not run before migration applied |

---

## Codex Independent Review (2026-06-02) — VERDICT: RECONSIDER

An independent gpt-5.5 (codex) review grounded against the live code, AFTER the internal workflow's GO-WITH-FIXES. It found 3 P1 shape problems — all in the events-ingest path (Slices B/C/E). **Slice A is validated and unaffected.** These must be resolved before B/C/E are implemented; §2/§5 above are the pre-review design.

**P1 — must fix (events-ingest redesign):**
1. **No post-cutover event source.** The batch reads events from Firestore (`database.list_session_learning_events`, design §2.5 ↔ `curriculum_admin.py:552`→`database.py:2459`), yet Slice E retires Firestore writes — the batcher would then have no durable source. Session-close-from-Firestore is a COEXISTENCE BRIDGE only. **Fix:** define the end-state event source — write events to PG directly from the `POST /events` request, OR carry event payloads in the Cloud Tasks message — never re-read Firestore post-cutover.
2. **The session-close trigger is client-driven & on the wrong seam.** `session.ended` arrives via the events POST route (`curriculum_admin.py:535/578`), not session-create; the frontend fires it fire-and-forget on page-leave (`AssignmentPracticeWorkspace.tsx:1068`), so a browser-close orphans the batch. **Fix:** enqueue server-side after `update_practice_session` in the `session.ended` route + add a sweeper/reconciler for sessions that never send a close event.
3. **"Cloud Run Job" is the wrong primitive.** Jobs don't serve HTTP; Cloud Tasks targets a request-serving URL with OIDC. The repo deploys one Cloud Run *service* via `cloudbuild.yaml:41`/`Dockerfile:58`. **Fix:** a separate Cloud Run **Service** from the same image (still pool-isolated), or an explicit admin job-runner flow — not a Cloud-Tasks-HTTP-handler "Job".

**P2 — real risks:**
4. **Python-over-PG reloads every event** unless callers change — `list_assignment_learning_events` is called with no type filter (`curriculum_admin.py:600`); analytics only needs context/error families (`practice_analytics.py:2053`). A GIN index doesn't fix "load every event"; push the `event_type` filter into the PG reader.
5. **`_run_with_timeout(1000ms)` doesn't cap pool CHECKOUT** — `sql.py` confirmed `pool_size=8/max_overflow=2/pool_timeout=3` on one Gunicorn worker / 8 threads; checkout can still wait 3s before the statement timeout applies.

**P3 — confirmations (design was right):**
6. Assignments ARE a hard FK prereq — `PracticeSession.assignment_id`/`LearningEvent.assignment_id` are NOT-NULL FKs (`practice.py:29/86`), assignments not yet in backfill (`backfill.py`). Slice A ordering correct.
7. `_route_read(also=tuple)` is a clean small extension (`read_router.py:109/189`) — add string-vs-tuple test coverage.

**Disposition:** Slice A proceeds as designed. Slices B/C/E events-ingest to be redesigned around a durable post-cutover event source (likely: dual-write events to PG from the request, or task-payload-sourced batch via a Cloud Run *service*) + a server-owned trigger + a reconciler. Re-review the revised events design before implementing.

**RESOLVED (2026-06-02) — see §5b.** The redesign workflow (ground-truth-first: code-grounded facts → 3 candidates → critique → synthesis) closed all three P1s:
- **P1.1 (post-cutover source):** events build from request scope and insert in the same handler; Firestore is never re-read (§5b.2 #3).
- **P1.2 (server-owned trigger):** finalize on the `session.ended` branch + an **internal-route reconciler invoked by Cloud Scheduler** (corrected from a `functions/` `@scheduler_fn`, which can't reach Cloud SQL — see the §5b re-review), gated dormant until sessions are in PG (§5b.2 #4–5, #7).
- **P1.3 (wrong primitive):** the Cloud Run **Job** is removed; the beta design is synchronous in-process. Net-new infra = **one Cloud Scheduler trigger** (no new service/queue/Job). The async path (outbox / Cloud Tasks → Cloud Run **Service**) is deferred to GA as a forward-compatible upgrade (§5b.3).

> **Note (2026-06-02):** a second, deeper codex review of **§5b itself** returned RECONSIDER and was fully incorporated — see **§5b.7** for the disposition. The above bullets reflect the corrected design.
- **P2a/P2b:** aggregation reads the pre-aggregated `session_summary` (no per-event N+1); the hot path does **one** pool checkout per turn, capped by `pool_timeout=3s` (§5b.1–2). The naive "13 round-trips per turn" objection is neutralized by batching all of a turn's events into a single transaction with FKs resolved once.
