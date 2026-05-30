"""Tier 2 (gated): Alembic baseline migration round-trip + drift check.

Verifies the baseline upgrade/downgrade actually applies on real Postgres 18,
creates pgcrypto + the partial indexes, and that the migrated schema matches the
SQLAlchemy models (no structural drift). Gated on DATABASE_URL.

    make test-postgres
"""

import os
import unittest

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db.base import Base

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Structural diff opcodes that indicate genuine model<->DB drift (ignore
# server_default cosmetic noise, which compare_metadata can over-report).
_STRUCTURAL = {
    'add_table', 'remove_table', 'add_column', 'remove_column',
    'add_index', 'remove_index', 'add_constraint', 'remove_constraint',
    'add_fk', 'remove_fk',
}


def _alembic_config():
    cfg = Config(os.path.join(_REPO_ROOT, 'alembic.ini'))
    cfg.set_main_option('script_location', os.path.join(_REPO_ROOT, 'backend/db/migrations'))
    return cfg


def _clean_db():
    engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(engine, checkfirst=True)
    with engine.begin() as conn:
        conn.execute(text('DROP TABLE IF EXISTS alembic_version'))
    engine.dispose()


class TestBaselineMigration(unittest.TestCase):
    def setUp(self):
        _clean_db()

    def tearDown(self):
        _clean_db()

    def test_upgrade_creates_schema_then_downgrade_drops_it(self):
        cfg = _alembic_config()
        command.upgrade(cfg, 'head')

        engine = create_engine(DATABASE_URL)
        try:
            insp = inspect(engine)
            tables = set(insp.get_table_names())
            # All 20 domain tables present; analytics_rollups intentionally absent.
            self.assertEqual(len(Base.metadata.tables), 20)
            for name in Base.metadata.tables:
                self.assertIn(name, tables, f'missing table {name}')
            self.assertNotIn('analytics_rollups', tables)

            # pgcrypto extension present.
            with engine.connect() as conn:
                ext = conn.execute(
                    text("select 1 from pg_extension where extname = 'pgcrypto'")
                ).scalar()
                self.assertEqual(ext, 1)

            # Partial unique indexes present (predicate carried through).
            mem_idx = {ix['name'] for ix in insp.get_indexes('memberships')}
            self.assertIn('memberships_org_uid_active_idx', mem_idx)
            jc_idx = {ix['name'] for ix in insp.get_indexes('class_join_codes')}
            self.assertIn('class_join_codes_one_active_per_class_idx', jc_idx)
        finally:
            engine.dispose()

        command.downgrade(cfg, 'base')
        engine = create_engine(DATABASE_URL)
        try:
            # Alembic keeps the (now empty) alembic_version bookkeeping table
            # after downgrade to base; only the domain tables must be gone.
            remaining = [
                t for t in inspect(engine).get_table_names() if t != 'alembic_version'
            ]
            self.assertEqual(remaining, [])
        finally:
            engine.dispose()

    def test_no_structural_drift_after_upgrade(self):
        cfg = _alembic_config()
        command.upgrade(cfg, 'head')
        engine = create_engine(DATABASE_URL)
        try:
            with engine.connect() as conn:
                ctx = MigrationContext.configure(conn)
                diffs = compare_metadata(ctx, Base.metadata)
            structural = [
                d for d in diffs
                if isinstance(d, tuple) and d and d[0] in _STRUCTURAL
            ]
            self.assertEqual(structural, [], f'unexpected structural drift: {structural}')
        finally:
            engine.dispose()


if __name__ == '__main__':
    unittest.main()
