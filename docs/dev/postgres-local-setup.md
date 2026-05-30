# Postgres local setup (school-domain migration)

Status: skeleton increment (2026-05-30). The Postgres layer is **inert** — no
route reads or writes use it yet. This doc covers running the schema/migration
tests and pointing a local engine at a database. See
`docs/school-integration/ADR-0001-post-beta-postgres-system-of-record.md`.

## What's wired

- `backend/db/sql.py` — lazy engine factory. Cloud SQL connector (prod) or a
  `DATABASE_URL` TCP DSN (local). Built post-fork on first use; never at import.
- `backend/db/models/` — SQLAlchemy 2.x models for the 20 baseline tables.
- `backend/db/migrations/` — Alembic; `0001_baseline` materializes the schema.
- `backend/db/repository/` — the resolution helper + (inert) enrollment twin.

Requires **PostgreSQL 18** — the append-heavy tables default their PKs to
`uuidv7()`, which is PG18 core.

## Option A — run the gated tests in Docker (no setup)

```bash
make test-postgres        # spins up ephemeral postgres:18, runs, tears down
```

Requires Docker running. This is the easiest way to verify the schema applies
and the array/jsonb/partial-unique/CHECK behavior holds.

## Option B — point at your own Postgres

```bash
# 1. A local Postgres 18 (Docker shown; or Postgres.app / Homebrew):
docker run -d --name lingual-pg \
  -e POSTGRES_PASSWORD=lingual -e POSTGRES_USER=lingual -e POSTGRES_DB=lingual \
  -p 5432:5432 postgres:18

# 2. Point the engine + Alembic at it (pg8000 driver):
export DATABASE_URL=postgresql+pg8000://lingual:lingual@127.0.0.1:5432/lingual

# 3. Apply the schema:
python3 -m alembic upgrade head

# 4. Run the gated tests against it:
make test-postgres        # uses your DATABASE_URL when set
```

Render the migration SQL without a database (offline):

```bash
python3 -m alembic upgrade head --sql
```

## Option C — Cloud SQL (staging/prod)

The app uses the Cloud SQL Python Connector when `INSTANCE_CONNECTION_NAME` is
set (no proxy sidecar). Env contract:

| Var | Purpose |
|-----|---------|
| `INSTANCE_CONNECTION_NAME` | `lingu-480600:REGION:INSTANCE` — selects the connector path; the only Postgres var registered in `_validate_required_env` (warn-only). |
| `DB_USER`, `DB_NAME` | required at engine-build |
| `DB_PASS` | required unless `DB_IAM_AUTH=1` |
| `DB_IAM_AUTH=1` | passwordless IAM auth (recommended on Cloud Run) |
| `DB_IP_TYPE` | `PUBLIC` (default) or `PRIVATE` (needs a VPC connector) |
| `DATABASE_URL` | local TCP escape hatch; ignored when the connector is used |

For local development against a Cloud SQL instance, run `cloud-sql-proxy` and
use `DATABASE_URL` (Option B), or set `INSTANCE_CONNECTION_NAME` to use the
connector directly.

## Notes

- Absent both `INSTANCE_CONNECTION_NAME` and `DATABASE_URL`, `sql_enabled()` is
  False and nothing connects — the app boots and behaves exactly as today.
- `analytics_rollups` is intentionally NOT in the baseline (it's net-new; ships
  with its refresh worker — see POSTGRES_SCHEMA.md "Future / Not In Initial
  Baseline").
