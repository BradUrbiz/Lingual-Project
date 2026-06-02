"""Tier 2 (gated): assignments dual-write/backfill + read adapter end-to-end on
real Postgres 18 (ANALYTICS_MIGRATION Slice A).

Gated identically to the other PG tests (module skips unless DATABASE_URL is set).

    make test-postgres

Proves what a fake session cannot for the assignment cutover — the real FK JOINs
against backfill-populated organizations/classes, the NOT-NULL CHECK columns, and
the round-trip through the live ReadRouter:
  (a) upsert_assignment resolves org_id + class_id and the read adapter emits them
      back as the parents' LEGACY ids (not the UUIDs);
  (b) created_by_uid <-> created_by_firebase_uid rename survives the round-trip;
  (c) the target_language_intensity legacy value (mostly_target) is normalized to
      the model-CHECK-valid 'target_led' on write and read back canonical;
  (d) a missing parent raises UnresolvedParentError (the coexistence no-op signal);
  (e) list_class_assignments honors the status filter;
  (f) the full ReadRouter path in mode '1' serves the PG row, not Firestore.
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
from backend.db.repository import assignments_read, backfill
from backend.db.repository.backfill import UnresolvedParentError

_engine = None


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        _engine.dispose()


def _seed_parents(s):
    backfill.upsert_organization(s, {
        'id': 'org-1', 'name': 'Alpha', 'name_lower': 'alpha', 'status': 'active'})
    backfill.upsert_class(s, {
        'id': 'cls-1', 'org_id': 'org-1', 'name': 'French I', 'status': 'active'})


def _assignment_doc(**o):
    doc = {
        'id': 'asg-1', 'org_id': 'org-1', 'class_id': 'cls-1',
        'title': 'Cafe', 'status': 'published', 'task_type': 'information_gap',
        'created_by_uid': 'teacher-9', 'instructions': 'Order a drink.',
        'generated_scenario': 'A cafe.', 'target_expressions': ['bonjour'],
        # legacy value the model CHECK rejects -> must be normalized on write:
        'target_language_intensity': 'mostly_target',
    }
    doc.update(o)
    return doc


class TestAssignmentsReadPG(unittest.TestCase):
    def setUp(self):
        with Session(_engine) as s:
            for tbl in ('assignments', 'classes', 'organizations'):
                s.execute(text(f'DELETE FROM {tbl}'))
            s.commit()

    def test_round_trip_fk_legacy_ids_rename_and_normalization(self):
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc())
            s.commit()
        with Session(_engine) as s:
            out = assignments_read.get_assignment(s, 'asg-1')
        self.assertEqual(out['id'], 'asg-1')
        self.assertEqual(out['org_id'], 'org-1')            # FK legacy id, not UUID
        self.assertEqual(out['class_id'], 'cls-1')          # FK legacy id, not UUID
        self.assertEqual(out['created_by_uid'], 'teacher-9')  # rename round-trips
        self.assertEqual(out['task_type'], 'information_gap')
        self.assertEqual(out['target_expressions'], ['bonjour'])
        # legacy intensity normalized to the model-CHECK-valid canonical value:
        self.assertEqual(out['target_language_intensity'], 'target_led')
        # an unlinked assignment renders canvas_module_item_id as '' (Firestore shape):
        self.assertEqual(out['canvas_module_item_id'], '')

    def test_upsert_is_idempotent_and_edits_in_place(self):
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc(title='V1'))
            backfill.upsert_assignment(s, _assignment_doc(title='V2'))  # same id -> UPDATE
            s.commit()
        with Session(_engine) as s:
            rows = assignments_read.list_class_assignments(s, 'cls-1')
        self.assertEqual([r['title'] for r in rows], ['V2'])   # one row, edited in place

    def test_unresolved_parent_raises(self):
        with Session(_engine) as s:
            _seed_parents(s)
            with self.assertRaises(UnresolvedParentError):
                backfill.upsert_assignment(s, _assignment_doc(class_id='ghost-class'))
            s.rollback()

    def test_list_class_assignments_status_filter(self):
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc(id='a-pub', status='published'))
            backfill.upsert_assignment(s, _assignment_doc(id='a-draft', status='draft'))
            s.commit()
        with Session(_engine) as s:
            all_ids = {r['id'] for r in assignments_read.list_class_assignments(s, 'cls-1')}
            pub_ids = {r['id'] for r in assignments_read.list_class_assignments(
                s, 'cls-1', ['published'])}
        self.assertEqual(all_ids, {'a-pub', 'a-draft'})        # no filter -> all
        self.assertEqual(pub_ids, {'a-pub'})                   # filtered

    def test_canvas_link_shadow_updates_item_id(self):
        from backend.db.dual_write_analytics import shadow_update_assignment_canvas_link
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc())
            s.commit()
        os.environ['DUAL_WRITE_ASSIGNMENTS'] = '1'
        try:
            shadow_update_assignment_canvas_link(
                lambda: _engine, assignment_id='asg-1', canvas_module_item_id='cmi-42')
        finally:
            os.environ.pop('DUAL_WRITE_ASSIGNMENTS', None)
        with Session(_engine) as s:
            out = assignments_read.get_assignment(s, 'asg-1')
        self.assertEqual(out['canvas_module_item_id'], 'cmi-42')

    def test_grade_config_round_trips(self):
        # backfilled grade config reads back; the shadow set updates it in place.
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(
                s, _assignment_doc(grade_metric='completion', grade_points=10.0))
            s.commit()
        with Session(_engine) as s:
            out = assignments_read.get_assignment(s, 'asg-1')
        self.assertEqual(out['grade_metric'], 'completion')
        self.assertEqual(out['grade_points'], 10.0)
        # the targeted shadow update mirrors a later set_assignment_grade_config:
        from backend.db.dual_write_analytics import shadow_set_assignment_grade_config
        os.environ['DUAL_WRITE_ASSIGNMENTS'] = '1'
        try:
            shadow_set_assignment_grade_config(
                lambda: _engine, assignment_id='asg-1',
                grade_metric='completion', grade_points=25.0)
        finally:
            os.environ.pop('DUAL_WRITE_ASSIGNMENTS', None)
        with Session(_engine) as s:
            out = assignments_read.get_assignment(s, 'asg-1')
        self.assertEqual(out['grade_points'], 25.0)

    def test_unset_dates_serialize_empty_string(self):
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc())  # no release_at/due_at
            s.commit()
        with Session(_engine) as s:
            out = assignments_read.get_assignment(s, 'asg-1')
        self.assertEqual(out['release_at'], '')   # None column -> '' (Firestore shape)
        self.assertEqual(out['due_at'], '')

    def test_missing_assignment_returns_none(self):
        with Session(_engine) as s:
            self.assertIsNone(assignments_read.get_assignment(s, 'ghost'))

    def test_read_router_cutover_serves_pg_not_firestore(self):
        with Session(_engine) as s:
            _seed_parents(s)
            backfill.upsert_assignment(s, _assignment_doc())
            s.commit()
        fs = types.SimpleNamespace(get_assignment=lambda aid: {'id': aid, 'src': 'firestore'})
        router = ReadRouter(fs, sql_engine=lambda: _engine)
        os.environ['READ_PG_ASSIGNMENTS'] = '1'
        try:
            out = router.get_assignment('asg-1')
        finally:
            os.environ.pop('READ_PG_ASSIGNMENTS', None)
        self.assertEqual(out['class_id'], 'cls-1')
        self.assertNotIn('src', out)   # served from PG, not the Firestore stub


if __name__ == '__main__':
    unittest.main()
