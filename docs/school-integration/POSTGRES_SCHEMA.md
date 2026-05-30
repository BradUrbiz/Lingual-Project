# Postgres Schema Blueprint

Status: Draft v0.1
Last updated: 2026-05-30
Owner: Engineering

## Purpose

This document defines the first Postgres schema target for the post-beta school-domain migration. It is a blueprint for Alembic migrations, not a hand-run production SQL script.

Persistence boundary:

- Firebase Auth remains the authentication provider.
- Firestore keeps identity-adjacent profile, assessment, consumer-era chats, and explicitly retained legacy/realtime data.
- Postgres owns school operations, compliance, practice-session metadata, learning events, and analytics-ready data.

## Target engine

Cloud SQL for PostgreSQL 18 (GA on Cloud SQL as of 2026). Nothing in this schema requires anything beyond PG14, so the version is an operational choice, but PG18 adds one optimization worth taking: a built-in `uuidv7()` that produces time-ordered UUIDs. For the append-heavy tables (`learning_events`, `practice_sessions`, `consent_events`), v7 keys give far better B-tree insert locality than random v4 (`gen_random_uuid()`), which reduces index bloat at scale. See conventions below.

## Conventions

- Use `firebase_uid text` to reference Firebase-authenticated users.
- Use `uuid` primary keys for Postgres-owned domain rows. On PG18, prefer `default uuidv7()` for high-insert/append-only tables (`learning_events`, `practice_sessions`, `consent_events`, disclosure/audit streams) for index locality; `gen_random_uuid()` is fine for low-churn tenancy rows. The DDL below shows `gen_random_uuid()` for version-portability -- swap to `uuidv7()` on the high-insert tables when the engine is pinned to PG18.
- Preserve Firestore IDs in `legacy_firestore_id text` during migration where traceability matters.
- Use `timestamptz` for all persisted timestamps.
- Use `jsonb` for bounded snapshots and event payloads, not for stable relational ownership.
- Prefer `check` constraints for early status vocabularies; upgrade to Postgres enum types only after the workflow stabilizes.

## Extensions

```sql
-- pgcrypto still useful for digests; gen_random_uuid() and uuidv7() are core in PG18.
create extension if not exists pgcrypto;
```

## Core Tenancy

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  name text not null,
  name_lower text not null,
  -- School-only tenancy (2026-05-30 decision). 'district'/'program' are metadata
  -- on other fields if needed, not org types. Mirrors database.ALLOWED_ORG_TYPES.
  type text not null default 'school' check (type in ('school')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  pilot_stage text,
  lms_capabilities text[] not null default '{}',
  default_modality_policy text not null default 'hybrid',
  default_retention_policy text not null default 'standard_school',
  school_type text,
  country text,
  state text,
  county text,
  city text,
  website_url text,
  public_or_private text,
  grade_size text,
 -- Inline teacher-invite-code fields (Firestore stores these on the org doc).
  teacher_invite_code text,
  teacher_invite_code_active boolean not null default false,
  teacher_invite_code_generated_at timestamptz,
  last_activity_at timestamptz,
  suspended_at timestamptz,
 -- Firestore field is suspended_by_uid; renamed on backfill (see Backfill Normalization).
  suspended_by_firebase_uid text,
  suspend_reason text,
  suspended_until timestamptz,
  restored_at timestamptz,
  restored_by_firebase_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organizations_status_name_idx
  on organizations (status, name_lower);
```

`organizations.school_admin_uids` is intentionally NOT a column. In Firestore it is a denormalized `ArrayUnion`/`ArrayRemove`-maintained array of active `school_admin` Firebase UIDs (`database.py:1327`), read by the Lingual-admin member count (`lingual_admin.py:167`). In Postgres it is derived, not stored:

```sql
-- Replacement for organizations.school_admin_uids reads.
select m.firebase_uid
from memberships m
where m.org_id = $1
  and m.status = 'active'
  and 'school_admin' = any (m.roles);
```

Callers that read `school_admin_uids` today (member count, `list_school_admin_emails`) must switch to this query or a thin view. Do not reintroduce the denormalized array as the source of truth.

```sql
create table memberships (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
 -- Firestore field is `uid`; renamed on backfill.
  firebase_uid text not null,
 -- Values seen: 'school_admin', 'teacher', 'student', 'lingual_admin'. No FK constraint by design.
  roles text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'invited', 'inactive', 'removed')),
 -- Firestore stores class doc-IDs (strings) here; backfill resolves them to
 -- classes.id via legacy_firestore_id AFTER classes are migrated. Until that
 -- resolution exists, callers may need a text[] staging column.
  primary_class_ids uuid[] not null default '{}',
  removed_at timestamptz,
 -- Firestore field is removed_by_uid; renamed on backfill.
  removed_by_firebase_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memberships_uid_status_idx
  on memberships (firebase_uid, status);

create index memberships_org_status_idx
  on memberships (org_id, status);

create unique index memberships_org_uid_active_idx
  on memberships (org_id, firebase_uid)
  where status in ('active', 'invited');
```

## Classes And Rosters

```sql
create table classes (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  term text,
  subject text,
  learning_locale text not null default 'ko-KR',
  grade_band text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  canvas_course_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classes_org_status_updated_idx
  on classes (org_id, status, updated_at desc);
```

```sql
create table class_teachers (
  class_id uuid not null references classes(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, membership_id)
);

create index class_teachers_membership_idx
  on class_teachers (membership_id, class_id);
```

```sql
create table class_join_codes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  code text not null,
  active boolean not null default true,
  generated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index class_join_codes_active_code_idx
  on class_join_codes (code)
  where active;

create unique index class_join_codes_one_active_per_class_idx
  on class_join_codes (class_id)
  where active;
```

Firestore has no join-code collection: `join_code`, `join_code_active`, and `join_code_generated_at` are scalar fields on the class document (`database.py:1801`). Lookup queries the `classes` collection by `join_code` (`database.py:1821`); that path must become `select class_id from class_join_codes where code = $1 and active`. Backfill synthesizes one `class_join_codes` row per class that has a non-null `join_code`, mapping `active = join_code_active`. `deactivated_at` is unrecoverable -- Firestore only ever stored the boolean, so historical inactive codes backfill with `deactivated_at = null`.

`class_teachers` is the normalized form of the Firestore `classes.teacher_membership_ids[]` array (`database.py:1659`), which is the live teacher-authorization check (`teacher.py:204`, `curriculum_admin.py:92`, `integrations.py:29`). There is no remove-teacher path, so the array can hold stale IDs for `removed` memberships. Backfill MUST resolve each membership doc-ID to `memberships.id` and skip entries whose membership is missing or `status = 'removed'`, or it will mint phantom teacher-access rows. All authz checks must move from the array read to a `class_teachers` join.

```sql
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  class_id uuid not null references classes(id) on delete cascade,
 -- Firestore field is student_uid; renamed on backfill.
  student_firebase_uid text not null,
  student_membership_id uuid references memberships(id) on delete set null,
 -- Legacy Firestore status 'pending_sync' (pre-2026-04-21 Canvas sync) must be
 -- remapped to 'inactive' on backfill; it is intentionally not in this CHECK.
  status text not null default 'active'
    check (status in ('active', 'inactive', 'removed')),
 -- Legacy 'canvas' join_source (pre-roster-decouple) must be remapped to
 -- 'canvas_legacy' on backfill. 'invite' and 'google_classroom' are
 -- forward-looking placeholders with no current writer.
  join_source text not null default 'manual'
    check (join_source in ('manual', 'invite', 'join_code', 'lti', 'google_classroom', 'canvas_legacy')),
  student_number text,
  guardian_contact_required boolean not null default false,
 -- Legacy Canvas linkage fields still written (default-blank) on every enrollment.
  canvas_user_id text,
  canvas_email text,
  canvas_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_firebase_uid)
);

create index enrollments_student_status_updated_idx
  on enrollments (student_firebase_uid, status, updated_at desc);

create index enrollments_class_status_updated_idx
  on enrollments (class_id, status, updated_at desc);
```

## Assignments

```sql
create table assignments (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
 -- Firestore stores release_at/due_at as ISO strings or '' ; backfill parses
 -- non-empty values and coerces '' to null.
  release_at timestamptz,
  due_at timestamptz,
  modality_override jsonb not null default '{}'::jsonb,
  max_attempts integer,
  task_type text not null default 'decision_making'
    check (task_type in ('information_gap', 'opinion_gap', 'decision_making', 'custom_prompt')),
  success_criteria text[] not null default '{}',
 -- Firestore field is created_by_uid; renamed on backfill.
  created_by_firebase_uid text not null,
  instructions text not null default '',
  generated_scenario text not null default '',
 -- Firestore stores objectives as list[str]; text[] is the faithful type.
  objectives text[] not null default '{}',
  target_expressions text[] not null default '{}',
  target_vocabulary text[] not null default '{}',
  focus_grammar text[] not null default '{}',
  teacher_notes text not null default '',
  student_instructions text not null default '',
 -- Legacy values 'mostly_target' and 'bilingual_scaffold' are still accepted on
 -- write today; backfill normalizes them (-> 'target_led' / 'english_led', per
 -- assignment_resolver.py:820) before insert.
  target_language_intensity text not null default 'balanced'
    check (target_language_intensity in ('english_first', 'english_led', 'balanced', 'target_led', 'target_only')),
  canvas_module_item_ref jsonb,
  canvas_module_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assignments_class_status_due_idx
  on assignments (class_id, status, due_at);

create index assignments_org_created_idx
  on assignments (org_id, created_at desc);
```

## Canvas And LTI

```sql
create table canvas_connections (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  membership_id uuid references memberships(id) on delete set null,
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  canvas_instance_url text not null,
  canvas_course_id text not null,
  canvas_course_name text,
  encrypted_pat text,
  auth_method text not null default 'pat',
  lti_deployment_id text,
  lti_context_id text,
  lti_lineitem_url text,
  grade_metric text,
  grade_points numeric,
  last_synced_at timestamptz,
  sync_status text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id)
);
```

```sql
create table canvas_course_content (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  connection_id uuid not null references canvas_connections(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  canvas_module_id text,
  canvas_module_name text,
  canvas_module_position integer not null default 0,
  item_id text,
  item_title text,
  item_type text,
  item_position integer not null default 0,
  item_html_url text,
  due_at timestamptz,
  points_possible numeric,
 -- Firestore field is lingual_assignment_id; renamed on backfill.
  linked_assignment_id uuid references assignments(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index canvas_course_content_class_order_idx
  on canvas_course_content (class_id, canvas_module_position, item_position);
```

```sql
create table canvas_roster_entries (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  class_id uuid not null references classes(id) on delete cascade,
  connection_id uuid not null references canvas_connections(id) on delete cascade,
  canvas_user_id text not null,
  canvas_email text,
  canvas_name text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (class_id, canvas_user_id)
);

create index canvas_roster_entries_class_email_idx
  on canvas_roster_entries (class_id, canvas_email);
```

## LTI 1.3

Both tables are live Firestore collections today (`database.py:4068`, `database.py:4185`), not PyLTI1p3 session files. The JWKS private key stays in GCP Secret Manager; the transient OIDC state stays in the Flask session. Only the durable platform registration and launch-session records migrate here.

```sql
create table lti_platforms (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  issuer text not null,
  client_id text not null,
  deployment_id text not null,
  auth_login_url text not null,
  auth_token_url text not null,
  key_set_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer, client_id, deployment_id)
);

create index lti_platforms_org_idx
  on lti_platforms (org_id);
```

```sql
create table lti_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  platform_id uuid not null references lti_platforms(id) on delete cascade,
 -- Firestore field is user_uid; renamed on backfill.
  user_firebase_uid text not null,
  canvas_user_id text,
  canvas_course_id text,
  roles text[] not null default '{}',
  access_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lti_sessions_user_idx
  on lti_sessions (user_firebase_uid, created_at desc);

create index lti_sessions_platform_course_idx
  on lti_sessions (platform_id, canvas_course_id);
```

## Compliance And Privacy

```sql
create table student_compliance_records (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
 -- Firestore field is student_uid; Firestore doc ID is the composite
 -- '{org_id}_{student_uid}', carried into legacy_firestore_id verbatim.
  student_firebase_uid text not null,
  is_minor boolean not null default false,
  guardian_consent_status text not null default 'unknown'
    check (guardian_consent_status in ('unknown', 'granted', 'revoked', 'not_required')),
 -- 'not_required' is valid only for guardian_consent_status, never voice.
  voice_consent_status text not null default 'unknown'
    check (voice_consent_status in ('unknown', 'granted', 'revoked')),
  text_allowed boolean not null default true,
  voice_allowed boolean not null default false,
  retention_policy_id text not null default 'standard_school',
  school_agreement_version text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, student_firebase_uid)
);
```

```sql
create table consent_events (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  student_firebase_uid text,
  scope_type text not null check (scope_type in ('student', 'class', 'org')),
  scope_id text not null,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  evidence_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index consent_events_org_student_created_idx
  on consent_events (org_id, student_firebase_uid, created_at desc);

create index consent_events_scope_idx
  on consent_events (org_id, scope_type, scope_id, created_at desc);
```

```sql
create table guardian_consent_packets (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
 -- Firestore field is student_uid; renamed on backfill. Multiple packets per
 -- (class, student) are intentional (history is retained) -- no unique constraint.
  student_firebase_uid text not null,
  notice_version text not null,
  consent_scope text not null,
  contact_channel text
    check (contact_channel is null or contact_channel in ('email', 'phone', 'paper', 'other')),
  contact_destination_hint text,
  delivery_method text not null
    check (delivery_method in ('secure_link', 'downloadable_notice')),
  status text not null
    check (status in ('draft', 'issued', 'viewed', 'granted', 'revoked', 'expired', 'canceled')),
  token_hash text,
  token_last_four text,
  response_method text,
  evidence_ref text,
  reminder_count integer not null default 0,
  expires_at timestamptz,
  issued_at timestamptz,
  last_sent_at timestamptz,
  acted_at timestamptz,
 -- Firestore field is created_by_uid; renamed on backfill.
  created_by_firebase_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guardian_packets_class_student_updated_idx
  on guardian_consent_packets (class_id, student_firebase_uid, updated_at desc);
```

## Practice And Learning Events

```sql
create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  assignment_id uuid not null references assignments(id) on delete cascade,
 -- Firestore field is student_uid; renamed on backfill. Active sessions mutate
 -- analysis_state/session_summary per event -- drain or exclude status='active'
 -- rows from backfill to avoid immediate divergence.
  student_firebase_uid text not null,
  mapping_snapshot jsonb not null default '{}'::jsonb,
  assignment_snapshot jsonb not null default '{}'::jsonb,
  curriculum_snapshot jsonb not null default '{}'::jsonb,
  pedagogy_snapshot jsonb not null default '{}'::jsonb,
  class_snapshot jsonb not null default '{}'::jsonb,
  modality text not null default 'hybrid',
  voice_enabled boolean not null default false,
  text_enabled boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  prompt_version text,
  system_prompt_preview text,
  transcript_ref jsonb not null default '{}'::jsonb,
  cost_summary jsonb not null default '{}'::jsonb,
  session_summary jsonb not null default '{}'::jsonb,
  analysis_state jsonb not null default '{}'::jsonb,
  teacher_preview boolean not null default false,
  ui_language text not null default 'en',
  org_status_when_created text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index practice_sessions_assignment_student_started_idx
  on practice_sessions (assignment_id, student_firebase_uid, started_at desc);

create index practice_sessions_class_started_idx
  on practice_sessions (class_id, started_at desc);
```

```sql
create table learning_events (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  assignment_id uuid not null references assignments(id) on delete cascade,
  session_id uuid not null references practice_sessions(id) on delete cascade,
  student_firebase_uid text not null,
  event_type text not null,
  turn_index integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index learning_events_session_created_idx
  on learning_events (session_id, created_at);

create index learning_events_assignment_type_created_idx
  on learning_events (assignment_id, event_type, created_at);

create index learning_events_class_student_created_idx
  on learning_events (class_id, student_firebase_uid, created_at);
```

`learning_events` is the last table in the initial baseline for this section. Rollups are **not** part of the baseline -- see "Future / Not In Initial Baseline" near the end of this doc.

## Deletion Workflow

```sql
create table deletion_requests (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  org_id uuid not null references organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('student', 'class', 'org')),
  scope_id text not null,
 -- Firestore field is requested_by_uid; renamed on backfill.
  requested_by_firebase_uid text not null,
  request_reason text,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'in_progress',
                      'completed', 'failed', 'partially_completed')),
 -- Firestore field is approved_by_uid; renamed on backfill.
  approved_by_firebase_uid text,
  review_notes text,
  target_collections text[] not null default '{}',
  target_storage_prefixes text[] not null default '{}',
  execution_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index deletion_requests_org_status_created_idx
  on deletion_requests (org_id, status, created_at desc);
```

```sql
create table deletion_execution_runs (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  request_id uuid not null references deletion_requests(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('student', 'class', 'org')),
  scope_id text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'partially_completed')),
  attempt_number integer not null default 1,
  firestore_counts jsonb not null default '{}'::jsonb,
  storage_counts jsonb not null default '{}'::jsonb,
  error_summary text[] not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index deletion_runs_request_attempt_idx
  on deletion_execution_runs (request_id, attempt_number);
```

## Migration Columns

Tables that receive backfilled Firestore data include:

- `legacy_firestore_id`
- `created_at`
- `updated_at`

Backfill scripts should also keep a separate migration ledger, for example:

```sql
create table migration_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  counts jsonb not null default '{}'::jsonb,
  error_summary text[] not null default '{}'
);
```

## Backfill Normalization And ID Resolution

The backfill cannot be a straight column copy. Firestore carries retired vocabularies, string-keyed references, and differently-named fields. A `COPY`-style fast load will fail on the first CHECK violation; a row-by-row load that silently coerces unknown values loses fidelity. The backfill must apply the rules below explicitly and report any value it cannot map.

### Field renames

| Table | Firestore field | Postgres column |
|---|---|---|
| memberships | `uid` | `firebase_uid` |
| memberships | `removed_by_uid` | `removed_by_firebase_uid` |
| organizations | `suspended_by_uid` / `restored_by_uid` | `suspended_by_firebase_uid` / `restored_by_firebase_uid` |
| enrollments | `student_uid` | `student_firebase_uid` |
| assignments | `created_by_uid` | `created_by_firebase_uid` |
| canvas_course_content | `lingual_assignment_id` | `linked_assignment_id` |
| student_compliance_records / guardian_consent_packets / practice_sessions / learning_events | `student_uid` | `student_firebase_uid` |
| guardian_consent_packets | `created_by_uid` | `created_by_firebase_uid` |
| deletion_requests | `requested_by_uid` / `approved_by_uid` | `requested_by_firebase_uid` / `approved_by_firebase_uid` |
| lti_sessions | `user_uid` | `user_firebase_uid` |

### Value normalizations (apply before insert)

| Table.column | Legacy value | Normalized value | Source of map |
|---|---|---|---|
| enrollments.status | `pending_sync` | `inactive` | retired post roster-decouple (2026-04-21) |
| enrollments.join_source | `canvas` | `canvas_legacy` | pre-decouple rows |
| assignments.target_language_intensity | `mostly_target` | `target_led` | `assignment_resolver.py:820` |
| assignments.target_language_intensity | `bilingual_scaffold` | `english_led` | `assignment_resolver.py:820` |
| organizations.status | `inactive` | `archived` | pre-enum rows (scan first) |

### Type coercions

- `assignments.release_at` / `due_at`: ISO string -> `timestamptz`; `''` -> `null`.
- `canvas_course_content.due_at`, `lti_sessions.token_expires_at`: raw Canvas string or `None` -> `timestamptz` / `null`.
- `assignments.objectives`: Firestore `list[str]` -> `text[]` (verify it is not `list[dict]`).
- `modality_override`, snapshot/payload columns: `None` -> `{}` / `[]`.
- Legacy default-blank scalars stored as `''` in Firestore (`enrollments.canvas_user_id` / `canvas_email` / `canvas_name` / `student_number`, `classes.canvas_course_id`) -> `null` on backfill. Lossless: the columns are nullable and `''` carries no meaning.

### ID resolution (the load-bearing rule)

Firestore uses deterministic composite string IDs as both primary key and uniqueness guard: memberships `{org_id}_{uid}`, enrollments/compliance `{class_id}_{student_uid}` and `{org_id}_{student_uid}`, roster `{class_id}__{canvas_user_id}`. Postgres uses opaque `uuid` PKs with `legacy_firestore_id` for traceability. Every foreign reference therefore needs an old-string -> new-UUID lookup, and the migration must run in dependency order so the target row exists first:

```
organizations -> memberships -> classes -> (class_teachers, class_join_codes, enrollments)
  -> assignments -> canvas_* / lti_* -> compliance/guardian/deletion -> practice_sessions -> learning_events
```

- Resolve FKs through each parent table's `legacy_firestore_id` unique index (the unique constraint *is* the btree lookup index -- no extra index needed).
- `memberships.primary_class_ids` and `classes.teacher_membership_ids[]` hold class/membership doc-IDs; resolve each element, dropping any with no migrated parent (and, for teachers, any `removed` membership).
- **Coexistence-window strategy (decided 2026-05-30):** resolve every cross-store foreign reference through `legacy_firestore_id` on each write -- no write-freeze, no downtime. A row written while some families are still on the legacy path resolves its parent's Postgres UUID via the unique `legacy_firestore_id` index (the same lookup backfill uses, so no extra machinery). PKs stay UUID. This is centralized in the repository layer behind `RouteDeps` so route code never hand-resolves IDs.

### Pre-backfill uniqueness scans (fail the run if violated)

- `memberships`: duplicate `active`/`invited` rows for one `(org_id, uid)` -- teacher-join paths don't guard before `create_membership`.
- `enrollments`: a deterministic-ID row plus a legacy non-deterministic-ID row for the same `(class_id, student_uid)`.
- `canvas_connections`: more than one connection per `class_id`.
- `class_join_codes`: the same active `code` across two classes.

## Future / Not In Initial Baseline

Everything in this section is **deliberately excluded from the first Alembic migration.** Do not copy these blocks into the baseline. Each lands only after its own design decision and an owner for the populating job.

### analytics_rollups (deferred)

Net-new infrastructure, not a migration target. No rollup persistence exists today -- `practice_analytics.py` recomputes class/assignment/student aggregates in Python on every request. This table buys nothing until a refresh worker (scheduled or write-triggered) populates it; shipping it empty just falls back to the same Python aggregation path. Add it (and the worker) only when on-the-fly aggregation becomes a measured bottleneck.

```sql
-- NOT in the initial baseline. Ships with its refresh worker, not before.
create table analytics_rollups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('org', 'class', 'assignment', 'student')),
  scope_id text not null,
  period_type text not null check (period_type in ('day', 'week', 'term', 'all_time')),
  period_start date,
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (org_id, scope_type, scope_id, period_type, period_start)
);
```

## Open Schema Decisions

- `assignments.objectives` is `text[]` for v1 (faithful to the current `list[str]` shape). Splitting into `assignment_objectives` / `assignment_targets` / `assignment_rubric_dimensions` is deferred until rubric-driven analytics need it.
- `memberships.primary_class_ids` is kept as a compatibility array for v1; the long-term direction is to drop it in favor of `class_teachers` + `enrollments` joins. Open question: whether to stage it as `text[]` until class IDs are resolved.
- `analytics_rollups` is excluded from the initial baseline; the open decision is ordinary table vs. materialized view vs. scheduled worker, plus who owns the refresh job.
- Whether the coexistence window uses per-route-family write freezes or a `legacy_firestore_id`-resolving dual-write layer (see ID resolution above).
