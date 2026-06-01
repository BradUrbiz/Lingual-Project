"""Tier 2 (gated): classes read adapter end-to-end on real Postgres 18 (slice 6).

Gated identically to the other PG tests (module skips unless DATABASE_URL is set).

    make test-postgres

Proves what a fake session cannot for the class read cutover — the real junction
JOINs against backfill-populated class_teachers / class_join_codes:
  (a) get_class emits org_id as the org's legacy id (DEFECT D2 — the AI-tutor authz
      gate), teacher_membership_ids as membership legacy ids (class_teachers JOIN),
      and the active join code (class_join_codes);
  (b) a DEACTIVATED code still surfaces on get_class (join_code kept, active False)
      but get_class_by_join_code no longer resolves it;
  (c) list_org_classes / list_teacher_classes find the class via the real filters;
  (d) the full ReadRouter path in mode '1' serves the PG row, not Firestore.
"""

import os
import types
import unittest

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db.base import Base
from backend.db.read_router import ReadRouter
from backend.db.repository import backfill, classes_read

_engine = None


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        _engine.dispose()


def _seed(s, *, join_code_active=True):
    backfill.upsert_organization(s, {
        'id': 'org-1', 'name': 'Alpha', 'name_lower': 'alpha', 'status': 'active'})
    backfill.upsert_membership(s, {
        'id': 'mem-t', 'org_id': 'org-1', 'uid': 'u1', 'roles': ['teacher'], 'status': 'active'})
    backfill.upsert_class(s, {
        'id': 'cls-1', 'org_id': 'org-1', 'name': 'Spanish I', 'term': 'Fall',
        'subject': 'Spanish', 'learning_locale': 'es-ES', 'grade_band': '9-12',
        'status': 'active', 'teacher_membership_ids': ['mem-t'],
        'join_code': 'ABC123', 'join_code_active': join_code_active})


class TestClassesReadPG(unittest.TestCase):
    def setUp(self):
        with Session(_engine) as s:
            for tbl in ('class_join_codes', 'class_teachers', 'classes', 'memberships', 'organizations'):
                s.execute(text(f'DELETE FROM {tbl}'))
            s.commit()

    def test_get_class_d2_org_legacy_and_junctions(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        with Session(_engine) as s:
            out = classes_read.get_class(s, 'cls-1')
        self.assertEqual(out['id'], 'cls-1')
        self.assertEqual(out['org_id'], 'org-1')                 # D2: legacy id, not UUID
        self.assertEqual(out['teacher_membership_ids'], ['mem-t'])
        self.assertEqual(out['learning_locale'], 'es-ES')
        self.assertEqual(out['join_code'], 'ABC123')
        self.assertIs(out['join_code_active'], True)

    def test_deactivated_code_surfaced_but_not_resolvable(self):
        with Session(_engine) as s:
            _seed(s, join_code_active=False)
            s.commit()
        with Session(_engine) as s:
            out = classes_read.get_class(s, 'cls-1')
            self.assertEqual(out['join_code'], 'ABC123')          # Firestore keeps it
            self.assertIs(out['join_code_active'], False)
            # an inactive code must NOT resolve a student join:
            self.assertIsNone(classes_read.get_class_by_join_code(s, 'ABC123'))

    def test_list_org_and_teacher_classes_and_join_lookup(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        with Session(_engine) as s:
            self.assertEqual([c['id'] for c in classes_read.list_org_classes(s, 'org-1')], ['cls-1'])
            self.assertEqual([c['id'] for c in classes_read.list_teacher_classes(s, 'mem-t')], ['cls-1'])
            self.assertEqual(classes_read.get_class_by_join_code(s, 'ABC123')['id'], 'cls-1')
            # status filter + unresolved teacher:
            self.assertEqual(classes_read.list_org_classes(s, 'org-1', status='archived'), [])
            self.assertEqual(classes_read.list_teacher_classes(s, 'ghost'), [])

    def test_missing_class_returns_none(self):
        with Session(_engine) as s:
            self.assertIsNone(classes_read.get_class(s, 'ghost'))

    def test_read_router_cutover_serves_pg_not_firestore(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        fs = types.SimpleNamespace(get_class=lambda cid: {'id': cid, 'src': 'firestore'})
        router = ReadRouter(fs, sql_engine=lambda: _engine)
        os.environ['READ_PG_CLASSES'] = '1'
        try:
            out = router.get_class('cls-1')
        finally:
            os.environ.pop('READ_PG_CLASSES', None)
        self.assertEqual(out['org_id'], 'org-1')
        self.assertNotIn('src', out)  # served from PG, not the Firestore stub

    def test_list_org_classes_summary_narrow_shape_all_statuses(self):
        with Session(_engine) as s:
            _seed(s)
            # a second, ARCHIVED class — the summary includes ALL statuses (no filter)
            backfill.upsert_class(s, {
                'id': 'cls-2', 'org_id': 'org-1', 'name': 'French I', 'status': 'archived',
                'teacher_membership_ids': ['mem-t']})
            s.commit()
        with Session(_engine) as s:
            out = classes_read.list_org_classes_summary(s, 'org-1')
        self.assertEqual({c['id'] for c in out}, {'cls-1', 'cls-2'})   # archived included
        row = next(c for c in out if c['id'] == 'cls-1')
        self.assertEqual(row['name'], 'Spanish I')
        self.assertEqual(row['teacher_membership_ids'], ['mem-t'])
        self.assertIsNone(row['last_activity_at'])
        self.assertNotIn('status', row)        # curated shape — no full-record fields
        self.assertNotIn('join_code', row)


if __name__ == '__main__':
    unittest.main()
