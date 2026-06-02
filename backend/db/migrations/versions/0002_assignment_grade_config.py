"""assignment LTI grade-passback config columns

Adds the two LTI grade-config fields (set via set_assignment_grade_config) to the
assignments table so the PG read adapter is a faithful inverse of the Firestore
get_assignment — otherwise api_get_grade_config (backend/routes/lti.py) returns
null for metric/points once READ_PG_ASSIGNMENTS flips to PG-authoritative.

Both nullable (only LTI-linked assignments carry them); no backfill of a default.

Explicit ops only (no model import) — the metadata-bootstrap pattern is for the
0001 baseline alone.

Revision ID: 0002_assignment_grade_config
Revises: 0001_baseline
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '0002_assignment_grade_config'
down_revision = '0001_baseline'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('assignments', sa.Column('grade_metric', sa.Text(), nullable=True))
    op.add_column('assignments', sa.Column('grade_points', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('assignments', 'grade_points')
    op.drop_column('assignments', 'grade_metric')
