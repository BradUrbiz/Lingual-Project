"""Tier 2 (gated): enrollments read adapter end-to-end on real Postgres 18 (slice 8).

Gated like the other PG tests (module skips unless DATABASE_URL is set).

    make test-postgres

Proves what a fake session cannot for the enrollment read cutover:
  (a) the FK inversion (DEFECT D1) — get_student_class_enrollment emits
      class_id / student_membership_id as the parents' legacy ids via JOIN, not
      the PG UUID;
  (b) count_org_students is ONE enrollments⋈classes COUNT JOIN that filters on
      ENROLLMENT status but NOT class status (mirroring the Firestore aggregate);
  (c) list_student_classes is the read-cut of the Firestore N+1 — active
      enrollment ⋈ active class, returning the full get_class shape (D2 org_id
      legacy id + teacher junction intact);
  (d) the point-get keys on the (class, student) UNIQUE columns, so it still finds
      an inactive row (subsuming Firestore's legacy-fallback scan);
  (e) the ReadRouter in mode '1' resolves the Firestore class id -> UUID and serves
      PG, not the Firestore stub.
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
from backend.db.models.org import Class
from backend.db.read_router import ReadRouter
from backend.db.repository import backfill, classes_read, enrollments, resolution

_engine = None


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        _engine.dispose()


def _seed(s):
    backfill.upsert_organization(s, {
        'id': 'org-1', 'name': 'Alpha', 'name_lower': 'alpha', 'status': 'active'})
    backfill.upsert_membership(s, {
        'id': 'mem-t', 'org_id': 'org-1', 'uid': 'u-teacher', 'roles': ['teacher'], 'status': 'active'})
    backfill.upsert_membership(s, {
        'id': 'mem-s', 'org_id': 'org-1', 'uid': 'u-student', 'roles': ['student'], 'status': 'active'})
    backfill.upsert_class(s, {
        'id': 'cls-1', 'org_id': 'org-1', 'name': 'Spanish I', 'status': 'active',
        'teacher_membership_ids': ['mem-t']})
    backfill.upsert_enrollment(s, {
        'id': 'cls-1_u-student', 'class_id': 'cls-1', 'student_uid': 'u-student',
        'student_membership_id': 'mem-s', 'status': 'active', 'join_source': 'join_code'})


def _class_uuid(s):
    return resolution.resolve_legacy_id(s, Class, 'cls-1')


class TestEnrollmentsReadPG(unittest.TestCase):
    def setUp(self):
        with Session(_engine) as s:
            for tbl in ('enrollments', 'class_join_codes', 'class_teachers',
                        'classes', 'memberships', 'organizations'):
                s.execute(text(f'DELETE FROM {tbl}'))
            s.commit()

    def test_point_get_d1_parent_legacy_ids(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        with Session(_engine) as s:
            out = enrollments.get_student_class_enrollment(s, _class_uuid(s), 'u-student')
        self.assertEqual(out['id'], 'cls-1_u-student')
        self.assertEqual(out['class_id'], 'cls-1')                # D1: legacy, not UUID
        self.assertEqual(out['student_membership_id'], 'mem-s')   # D1
        self.assertEqual(out['student_uid'], 'u-student')
        self.assertEqual(out['status'], 'active')

    def test_lists_count_and_student_classes(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        with Session(_engine) as s:
            cu = _class_uuid(s)
            self.assertEqual([e['id'] for e in enrollments.list_class_enrollments(s, cu)],
                             ['cls-1_u-student'])
            self.assertEqual([e['id'] for e in enrollments.list_student_enrollments(s, 'u-student')],
                             ['cls-1_u-student'])
            self.assertEqual(enrollments.count_org_students(s, 'org-1'), 1)
            classes = classes_read.list_student_classes(s, 'u-student')
            self.assertEqual([c['id'] for c in classes], ['cls-1'])
            self.assertEqual(classes[0]['org_id'], 'org-1')               # D2 holds
            self.assertEqual(classes[0]['teacher_membership_ids'], ['mem-t'])

    def test_count_ignores_class_status_but_not_enrollment_status(self):
        with Session(_engine) as s:
            _seed(s)
            s.execute(text("UPDATE classes SET status='archived' WHERE legacy_firestore_id='cls-1'"))
            s.commit()
        with Session(_engine) as s:
            # class status is NOT a count filter — the active enrollment still counts:
            self.assertEqual(enrollments.count_org_students(s, 'org-1'), 1)
            # but list_student_classes filters to ACTIVE classes -> now empty:
            self.assertEqual(classes_read.list_student_classes(s, 'u-student'), [])

    def test_inactive_enrollment_excluded_but_point_get_still_finds_it(self):
        with Session(_engine) as s:
            _seed(s)
            s.execute(text(
                "UPDATE enrollments SET status='inactive' WHERE legacy_firestore_id='cls-1_u-student'"))
            s.commit()
        with Session(_engine) as s:
            self.assertEqual(enrollments.count_org_students(s, 'org-1'), 0)
            self.assertEqual(classes_read.list_student_classes(s, 'u-student'), [])
            # the (class, student) UNIQUE row is still found regardless of status:
            out = enrollments.get_student_class_enrollment(s, _class_uuid(s), 'u-student')
            self.assertEqual(out['status'], 'inactive')

    def test_unresolved_org_counts_zero(self):
        with Session(_engine) as s:
            self.assertEqual(enrollments.count_org_students(s, 'ghost-org'), 0)

    def test_router_cutover_serves_pg_not_firestore(self):
        with Session(_engine) as s:
            _seed(s)
            s.commit()
        fs = types.SimpleNamespace(
            get_student_class_enrollment=lambda cid, uid: {'id': 'x', 'src': 'firestore'},
            count_org_students=lambda *, org_id: -1)
        router = ReadRouter(fs, sql_engine=lambda: _engine)
        os.environ['READ_PG_ENROLLMENTS'] = '1'
        try:
            out = router.get_student_class_enrollment('cls-1', 'u-student')
            cnt = router.count_org_students(org_id='org-1')
        finally:
            os.environ.pop('READ_PG_ENROLLMENTS', None)
        self.assertEqual(out['class_id'], 'cls-1')   # resolved + served from PG
        self.assertNotIn('src', out)                 # not the Firestore stub
        self.assertEqual(cnt, 1)                      # PG count, not the -1 stub

    def test_backfill_preserves_firestore_created_at(self):
        # P2a: a backfilled row must keep its TRUE enrollment date (roster enrolledAt),
        # not the backfill-run now(). The doc-carried created_at is preserved.
        import datetime
        ts = datetime.datetime(2025, 9, 1, 12, 0, tzinfo=datetime.timezone.utc)
        with Session(_engine) as s:
            _seed(s)  # enrollment first created with server_default now() (no ts in doc)
            backfill.upsert_enrollment(s, {  # idempotent re-upsert WITH a Firestore created_at
                'id': 'cls-1_u-student', 'class_id': 'cls-1', 'student_uid': 'u-student',
                'student_membership_id': 'mem-s', 'status': 'active',
                'join_source': 'join_code', 'created_at': ts})
            s.commit()
        with Session(_engine) as s:
            out = enrollments.get_student_class_enrollment(s, _class_uuid(s), 'u-student')
        self.assertEqual(out['created_at'], ts)      # true Firestore date, not now()


if __name__ == '__main__':
    unittest.main()
