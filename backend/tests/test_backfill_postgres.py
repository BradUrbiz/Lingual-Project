"""Tier 2 (gated): enrollment-chain backfill end-to-end on real Postgres.

run_backfill writes through real text[]/jsonb/CHECK/partial-unique DDL, so this
runs only against a real Postgres 18 — gated identically to
test_postgres_schema.py (module skips cleanly unless DATABASE_URL is set).

    make test-postgres
    DATABASE_URL=postgresql+pg8000://u:p@host/db python3 -m unittest \\
        backend.tests.test_backfill_postgres -v

Proves the parts a fake session cannot:
  (a) row counts land,
  (b) the enrollment FK class_id points to the right MIGRATED class (resolved
      through legacy_firestore_id, not the Firestore string),
  (c) status/join_source remaps survive the CHECK constraints
      (pending_sync -> inactive, canvas -> canvas_legacy),
  (d) a second run is IDEMPOTENT — no duplicate rows, stats show updates.
"""

import os
import unittest

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db.base import Base
from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository import backfill

_engine = None


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        Base.metadata.drop_all(_engine, checkfirst=True)
        _engine.dispose()


# Small in-memory fixture: 2 orgs, a few memberships/classes, enrollments
# including one pending_sync status and one canvas join_source (to prove
# remaps) and one whose class resolves via legacy_firestore_id.
def _fixture():
    return dict(
        organizations=[
            {'id': 'org1', 'name': 'Springfield High', 'status': 'active'},
            # legacy 'inactive' org status -> 'archived' on normalize.
            {'id': 'org2', 'name': 'Shelbyville High', 'status': 'inactive'},
        ],
        memberships=[
            {'id': 'org1_teach', 'org_id': 'org1', 'uid': 'teach1', 'roles': ['teacher']},
            {'id': 'org1_stuA', 'org_id': 'org1', 'uid': 'studentA', 'roles': ['student']},
            {'id': 'org2_stuB', 'org_id': 'org2', 'uid': 'studentB', 'roles': ['student']},
        ],
        classes=[
            {'id': 'class1', 'org_id': 'org1', 'name': 'Spanish I', 'learning_locale': 'es-ES'},
            {'id': 'class2', 'org_id': 'org2', 'name': 'French I', 'learning_locale': 'fr-FR'},
        ],
        enrollments=[
            # Resolves class via legacy_firestore_id; links a membership.
            {
                'id': 'class1_studentA',
                'class_id': 'class1',
                'student_uid': 'studentA',
                'student_membership_id': 'org1_stuA',
                'status': 'active',
                'join_source': 'join_code',
            },
            # pending_sync -> inactive remap.
            {
                'id': 'class1_studentC',
                'class_id': 'class1',
                'student_uid': 'studentC',
                'status': 'pending_sync',
                'join_source': 'manual',
            },
            # canvas -> canvas_legacy remap.
            {
                'id': 'class2_studentB',
                'class_id': 'class2',
                'student_uid': 'studentB',
                'status': 'active',
                'join_source': 'canvas',
            },
        ],
    )


class TestBackfillEndToEnd(unittest.TestCase):
    def setUp(self):
        # Clean slate per test (children first to respect FKs).
        with Session(_engine) as s:
            for model in (Enrollment, Class, Membership, Organization):
                s.query(model).delete()
            s.commit()

    def _count(self, s, model):
        return s.execute(select(func.count()).select_from(model)).scalar_one()

    def test_full_chain_counts_fk_and_remaps(self):
        with Session(_engine) as s:
            stats = backfill.run_backfill(s, **_fixture())
            s.commit()

            # (a) row counts
            self.assertEqual(stats['organizations']['inserted'], 2)
            self.assertEqual(stats['memberships']['inserted'], 3)
            self.assertEqual(stats['classes']['inserted'], 2)
            self.assertEqual(stats['enrollments']['inserted'], 3)
            for entity in stats:
                self.assertEqual(stats[entity]['errors'], [], entity)

            self.assertEqual(self._count(s, Organization), 2)
            self.assertEqual(self._count(s, Membership), 3)
            self.assertEqual(self._count(s, Class), 2)
            self.assertEqual(self._count(s, Enrollment), 3)

            # (b) the enrollment FK class_id points to the right migrated class.
            class1_uuid = s.execute(
                select(Class.id).where(Class.legacy_firestore_id == 'class1')
            ).scalar_one()
            enr = s.execute(
                select(Enrollment).where(
                    Enrollment.legacy_firestore_id == 'class1_studentA'
                )
            ).scalar_one()
            self.assertEqual(enr.class_id, class1_uuid)
            # student_membership_id resolved to the migrated membership UUID.
            stuA_membership = s.execute(
                select(Membership.id).where(Membership.legacy_firestore_id == 'org1_stuA')
            ).scalar_one()
            self.assertEqual(enr.student_membership_id, stuA_membership)
            # student_uid renamed, not resolved.
            self.assertEqual(enr.student_firebase_uid, 'studentA')

            # (c) status / join_source remaps survived the CHECK constraints.
            pending = s.execute(
                select(Enrollment.status).where(
                    Enrollment.legacy_firestore_id == 'class1_studentC'
                )
            ).scalar_one()
            self.assertEqual(pending, 'inactive')
            canvas = s.execute(
                select(Enrollment.join_source).where(
                    Enrollment.legacy_firestore_id == 'class2_studentB'
                )
            ).scalar_one()
            self.assertEqual(canvas, 'canvas_legacy')
            # org status remap.
            org2_status = s.execute(
                select(Organization.status).where(
                    Organization.legacy_firestore_id == 'org2'
                )
            ).scalar_one()
            self.assertEqual(org2_status, 'archived')

    def test_second_run_is_idempotent(self):
        fixture = _fixture()
        with Session(_engine) as s:
            backfill.run_backfill(s, **fixture)
            s.commit()

        with Session(_engine) as s:
            stats = backfill.run_backfill(s, **fixture)
            s.commit()

            # (d) no duplicate rows; counts show updates, not inserts.
            self.assertEqual(self._count(s, Organization), 2)
            self.assertEqual(self._count(s, Membership), 3)
            self.assertEqual(self._count(s, Class), 2)
            self.assertEqual(self._count(s, Enrollment), 3)

            self.assertEqual(stats['organizations']['updated'], 2)
            self.assertEqual(stats['organizations']['inserted'], 0)
            self.assertEqual(stats['memberships']['updated'], 3)
            self.assertEqual(stats['memberships']['inserted'], 0)
            self.assertEqual(stats['classes']['updated'], 2)
            self.assertEqual(stats['classes']['inserted'], 0)
            self.assertEqual(stats['enrollments']['updated'], 3)
            self.assertEqual(stats['enrollments']['inserted'], 0)

    def test_dirty_row_is_isolated_by_savepoint_and_run_continues(self):
        # C2 regression: a membership doc missing 'uid' violates NOT NULL on
        # firebase_uid at flush. The per-row SAVEPOINT must roll back ONLY that
        # row — the 3 good memberships, both classes, and all enrollments must
        # still insert and COMMIT. Without begin_nested() the failed flush would
        # poison the transaction and abort every later doc.
        fixture = _fixture()
        fixture['memberships'].append(
            {'id': 'org1_bad', 'org_id': 'org1', 'roles': ['student']}  # no 'uid'
        )
        with Session(_engine) as s:
            stats = backfill.run_backfill(s, **fixture)
            s.commit()

            self.assertEqual(stats['memberships']['inserted'], 3)
            self.assertEqual(len(stats['memberships']['errors']), 1)
            self.assertEqual(stats['memberships']['errors'][0]['id'], 'org1_bad')
            # Later entities were NOT aborted by the poisoned-transaction bug.
            self.assertEqual(stats['classes']['inserted'], 2)
            self.assertEqual(stats['enrollments']['inserted'], 3)

        with Session(_engine) as s:
            # Good rows committed; the bad one did not.
            self.assertEqual(self._count(s, Membership), 3)
            self.assertEqual(self._count(s, Class), 2)
            self.assertEqual(self._count(s, Enrollment), 3)

    def test_dry_run_writes_nothing(self):
        with Session(_engine) as s:
            stats = backfill.run_backfill(s, **_fixture(), dry_run=True)
            s.rollback()  # caller's contract after a dry run

        with Session(_engine) as s:
            self.assertEqual(self._count(s, Organization), 0)
            self.assertEqual(self._count(s, Enrollment), 0)
        # Dry run still reports the would-be inserts.
        self.assertEqual(stats['enrollments']['inserted'], 3)


if __name__ == '__main__':
    unittest.main()
