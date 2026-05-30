"""Tier 2 (gated): enrollment dual-write end-to-end on real Postgres 18.

The shadow_* functions open their OWN Session(engine), issue a transaction-scoped
SET LOCAL statement_timeout, write through real text[]/CHECK/partial-unique DDL,
and commit — so this can only be proven against a real Postgres. Gated identically
to test_backfill_postgres.py (module skips unless DATABASE_URL is set).

    make test-postgres
    DATABASE_URL=postgresql+pg8000://u:p@host/db python3 -m unittest \\
        backend.tests.test_dual_write_enrollments_pg -v

Proves what a fake session cannot:
  (a) a create lands the row with the FK resolved to the MIGRATED class/membership,
  (b) join_source/status remaps survive the CHECK constraints (canvas->canvas_legacy),
  (c) a second create is IDEMPOTENT (composite legacy id; no duplicate row),
  (d) deactivate/reactivate flip status AND bump updated_at (no onupdate trigger),
  (e) the LTI reactivation writes all three fields (status, join_source=lti, membership),
  (f) an unresolved class is a quiet no-op (fail-open), and
  (g) parity_report reports in-sync after a dual-written enrollment.
"""

import os
import time
import unittest

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db import dual_write
from backend.db.base import Base
from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository import backfill

_engine = None
FLAG = 'DUAL_WRITE_ENROLLMENTS'


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        Base.metadata.drop_all(_engine, checkfirst=True)
        _engine.dispose()


# Parent chain the enrollment FKs resolve against (org -> class, membership).
def _parents():
    return dict(
        organizations=[{'id': 'org1', 'name': 'Springfield High', 'status': 'active'}],
        memberships=[
            {'id': 'org1_stuA', 'org_id': 'org1', 'uid': 'stuA', 'roles': ['student']},
        ],
        classes=[{'id': 'class1', 'org_id': 'org1', 'name': 'Spanish I', 'learning_locale': 'es-ES'}],
    )


class TestDualWriteEndToEnd(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get(FLAG)
        os.environ[FLAG] = '1'
        with Session(_engine) as s:
            for model in (Enrollment, Class, Membership, Organization):
                s.query(model).delete()
            s.commit()
            backfill.run_backfill(s, **_parents())
            s.commit()
            self.class1_uuid = s.execute(
                select(Class.id).where(Class.legacy_firestore_id == 'class1')
            ).scalar_one()
            self.membership_uuid = s.execute(
                select(Membership.id).where(Membership.legacy_firestore_id == 'org1_stuA')
            ).scalar_one()

    def tearDown(self):
        if self._orig is None:
            os.environ.pop(FLAG, None)
        else:
            os.environ[FLAG] = self._orig

    def _engine_provider(self):
        return lambda: _engine

    def _count(self, s, model):
        return s.execute(select(func.count()).select_from(model)).scalar_one()

    def _get(self, s, legacy_id):
        return s.execute(
            select(Enrollment).where(Enrollment.legacy_firestore_id == legacy_id)
        ).scalar_one()

    def test_create_lands_row_with_resolved_fks(self):
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1',
            student_uid='stuA',
            enrollment_id='class1_stuA',
            student_membership_id='org1_stuA',
            status='active',
            join_source='join_code',
        )
        with Session(_engine) as s:
            self.assertEqual(self._count(s, Enrollment), 1)
            enr = self._get(s, 'class1_stuA')
            self.assertEqual(enr.class_id, self.class1_uuid)
            self.assertEqual(enr.student_membership_id, self.membership_uuid)
            self.assertEqual(enr.student_firebase_uid, 'stuA')
            self.assertEqual(enr.status, 'active')
            self.assertEqual(enr.join_source, 'join_code')

    def test_create_normalizes_through_check_constraints(self):
        # canvas -> canvas_legacy, pending_sync -> inactive must survive the CHECKs.
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='pending_sync', join_source='canvas',
        )
        with Session(_engine) as s:
            enr = self._get(s, 'class1_stuA')
            self.assertEqual(enr.status, 'inactive')
            self.assertEqual(enr.join_source, 'canvas_legacy')

    def test_second_create_is_idempotent(self):
        for _ in range(2):
            dual_write.shadow_create_enrollment(
                self._engine_provider(),
                class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
                status='active', join_source='join_code',
            )
        with Session(_engine) as s:
            self.assertEqual(self._count(s, Enrollment), 1)

    def test_deactivate_flips_status_and_bumps_updated_at(self):
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='active', join_source='join_code',
        )
        with Session(_engine) as s:
            u0 = self._get(s, 'class1_stuA').updated_at
        time.sleep(0.05)  # guarantee a measurable, skew-proof difference
        dual_write.shadow_set_enrollment_status(
            self._engine_provider(), class_id='class1', student_uid='stuA', status='inactive'
        )
        with Session(_engine) as s:
            enr = self._get(s, 'class1_stuA')
            self.assertEqual(enr.status, 'inactive')
            self.assertGreater(enr.updated_at, u0)

    def test_reactivate_flips_status_back(self):
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='inactive', join_source='join_code',
        )
        dual_write.shadow_set_enrollment_status(
            self._engine_provider(), class_id='class1', student_uid='stuA', status='active'
        )
        with Session(_engine) as s:
            self.assertEqual(self._get(s, 'class1_stuA').status, 'active')

    def test_lti_reactivate_writes_three_fields(self):
        # Start from an inactive, non-LTI enrollment with no membership link.
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='inactive', join_source='join_code',
        )
        dual_write.shadow_lti_reactivate(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', student_membership_id='org1_stuA',
        )
        with Session(_engine) as s:
            enr = self._get(s, 'class1_stuA')
            self.assertEqual(enr.status, 'active')
            self.assertEqual(enr.join_source, 'lti')
            self.assertEqual(enr.student_membership_id, self.membership_uuid)

    def test_unresolved_class_is_quiet_noop(self):
        # Class 'ghost' was never backfilled -> upsert raises UnresolvedParentError,
        # which _run absorbs quietly. No row, no exception out of the shadow.
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='ghost', student_uid='stuX', enrollment_id='ghost_stuX',
            status='active', join_source='join_code',
        )
        dual_write.shadow_set_enrollment_status(
            self._engine_provider(), class_id='ghost', student_uid='stuX', status='inactive'
        )
        with Session(_engine) as s:
            self.assertEqual(self._count(s, Enrollment), 0)

    def test_flag_off_writes_nothing(self):
        os.environ.pop(FLAG, None)
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='active', join_source='join_code',
        )
        with Session(_engine) as s:
            self.assertEqual(self._count(s, Enrollment), 0)

    def test_parity_in_sync_after_dual_write(self):
        dual_write.shadow_create_enrollment(
            self._engine_provider(),
            class_id='class1', student_uid='stuA', enrollment_id='class1_stuA',
            status='active', join_source='join_code',
        )
        with Session(_engine) as s:
            report = backfill.parity_report(
                s, enrollments=[{'id': 'class1_stuA', 'class_id': 'class1', 'student_uid': 'stuA'}]
            )
            self.assertTrue(report['enrollments']['in_sync'])
            self.assertEqual(report['enrollments']['postgres_count'], 1)


if __name__ == '__main__':
    unittest.main()
