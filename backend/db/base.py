"""SQLAlchemy declarative base + shared column helpers.

Mirrors docs/school-integration/POSTGRES_SCHEMA.md. Conventions:
- `uuid` primary keys, `gen_random_uuid()` default for low-churn tables,
  `uuidv7()` (PG18 core) for append-heavy tables (consent_events,
  practice_sessions, learning_events) for B-tree insert locality.
- `legacy_firestore_id text unique` on every backfilled table — the unique
  btree IS the Firestore-id -> UUID resolution index.
- All timestamps are `timestamptz` with a `now()` server default. There is NO
  blanket timestamp mixin: tables carry different subsets (consent_events and
  learning_events have only created_at; canvas_course_content only updated_at;
  deletion_execution_runs and migration_import_runs have neither pair).
"""

from __future__ import annotations

from sqlalchemy import MetaData, Text, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, mapped_column

# Deterministic constraint/index names so Alembic autogenerate stays stable and
# the model<->migration drift test (make test-postgres) has names to compare.
NAMING_CONVENTION = {
    'ix': 'ix_%(column_0_label)s',
    'uq': 'uq_%(table_name)s_%(column_0_name)s',
    'ck': 'ck_%(table_name)s_%(constraint_name)s',
    'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
    'pk': 'pk_%(table_name)s',
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def uuid_pk(server_default: str = 'gen_random_uuid()'):
    """UUID primary key. Pass server_default='uuidv7()' for append-heavy tables."""
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text(server_default),
    )


def legacy_id():
    """`legacy_firestore_id text unique` — Firestore-id -> UUID resolution key."""
    return mapped_column('legacy_firestore_id', Text, unique=True, nullable=True)


def created_at():
    return mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )


def updated_at():
    return mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
