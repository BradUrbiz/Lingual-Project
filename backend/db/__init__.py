"""Postgres persistence package (post-beta school-domain system of record).

This package is INERT in the current runtime: nothing here is wired into any
route's read or write path yet. It exists so the Cloud SQL engine, SQLAlchemy
models, Alembic migrations, and the repository seam can be built and tested
ahead of the staged Firestore -> Postgres cutover described in
docs/school-integration/ADR-0001-post-beta-postgres-system-of-record.md.

Importing this package must remain side-effect-free (no engine, no network).
"""
