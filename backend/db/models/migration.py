"""Backfill ledger. Records each Firestore -> Postgres import run."""

from __future__ import annotations

from sqlalchemy import Text, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, uuid_pk


class MigrationImportRun(Base):
    __tablename__ = 'migration_import_runs'

    id = uuid_pk()
    source = mapped_column(Text, nullable=False)
    started_at = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
    finished_at = mapped_column(TIMESTAMP(timezone=True))
    status = mapped_column(Text, nullable=False, server_default=text("'running'"))
    counts = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error_summary = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
