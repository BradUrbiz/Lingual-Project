"""baseline school-domain schema

Materializes the initial Postgres schema from docs/school-integration/POSTGRES_SCHEMA.md.

This BASELINE migration bootstraps the schema directly from `Base.metadata`
(via create_all) so it is guaranteed to match the SQLAlchemy models exactly —
including uuidv7()/gen_random_uuid() defaults, text[]/jsonb server defaults,
partial unique indexes, and named CHECK constraints. This metadata-bootstrap
pattern is for the FIRST migration only. Every subsequent migration MUST use
explicit ops (op.add_column, op.create_index, ...) and MUST NOT import models.

`analytics_rollups` is intentionally NOT created here (Future / Not In Initial
Baseline in POSTGRES_SCHEMA.md).

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-30
"""

from alembic import op

import backend.db.models  # noqa: F401  (populate Base.metadata)
from backend.db.base import Base

# revision identifiers, used by Alembic.
revision = '0001_baseline'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgcrypto for token digests. uuidv7()/gen_random_uuid() are PG18 core and
    # do NOT require an extension; pgcrypto is created for completeness per the
    # schema doc's Extensions block.
    op.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    bind = op.get_bind()
    # checkfirst=False: baseline runs on an empty DB, and it lets offline
    # `alembic upgrade head --sql` render without reflecting a live DB.
    Base.metadata.create_all(bind=bind, checkfirst=False)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=False)
    # Drops pgcrypto on full teardown. Re-upgrade is idempotent
    # (CREATE EXTENSION IF NOT EXISTS). If a future migration or operator comes
    # to depend on pgcrypto, stop dropping it here.
    op.execute('DROP EXTENSION IF EXISTS pgcrypto')
