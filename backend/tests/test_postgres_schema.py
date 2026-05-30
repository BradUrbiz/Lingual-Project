"""Tier 2 (gated): real-Postgres DDL behavior for the baseline models.

SQLite cannot represent text[]/jsonb/partial-unique/CHECK semantics, so these
run only against a real Postgres 18 (uuidv7() is PG18 core). Gated like the
Java emulator suite: the module skips cleanly unless DATABASE_URL is set.

    make test-postgres            # spins up postgres:18 in Docker
    DATABASE_URL=postgresql+pg8000://u:p@host/db python3 -m unittest \\
        backend.tests.test_postgres_schema -v
"""

import os
import unittest
import uuid

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from sqlalchemy import create_engine, select
# DBAPIError is the common parent of IntegrityError (unique, 23505) and
# ProgrammingError (check, 23514). pg8000 maps a CHECK violation to
# ProgrammingError, not IntegrityError, so assert on the parent for any
# constraint-violation test to stay driver-agnostic.
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db.base import Base
from backend.db.models.migration import MigrationImportRun
from backend.db.models.org import Membership, Organization

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


class TestArrayAndJsonbRoundTrip(unittest.TestCase):
    def test_text_array_round_trip(self):
        with Session(_engine) as s:
            org = Organization(
                name='Springfield High',
                name_lower='springfield high',
                lms_capabilities=['lti13', 'roster_sync'],
            )
            s.add(org)
            s.commit()
            got = s.execute(
                select(Organization.lms_capabilities).where(Organization.id == org.id)
            ).scalar_one()
            self.assertEqual(got, ['lti13', 'roster_sync'])
            # server default '{}' yields an empty list, not NULL
            org2 = Organization(name='B', name_lower='b')
            s.add(org2)
            s.commit()
            self.assertEqual(
                s.execute(
                    select(Organization.lms_capabilities).where(Organization.id == org2.id)
                ).scalar_one(),
                [],
            )

    def test_jsonb_round_trip(self):
        with Session(_engine) as s:
            run = MigrationImportRun(source='unit-test', counts={'organizations': 3})
            s.add(run)
            s.commit()
            self.assertEqual(
                s.execute(
                    select(MigrationImportRun.counts).where(MigrationImportRun.id == run.id)
                ).scalar_one(),
                {'organizations': 3},
            )


class TestPartialUniqueIndex(unittest.TestCase):
    def test_one_active_membership_per_org_uid(self):
        with Session(_engine) as s:
            org = Organization(name='Org', name_lower='org')
            s.add(org)
            s.commit()
            s.add(Membership(org_id=org.id, firebase_uid='userX', status='active'))
            s.commit()
            # Second active membership for the same (org, uid) violates the
            # partial unique index memberships_org_uid_active_idx.
            s.add(Membership(org_id=org.id, firebase_uid='userX', status='active'))
            with self.assertRaises(DBAPIError):
                s.commit()
            s.rollback()
            # But a 'removed' membership for the same pair is allowed (outside
            # the partial index predicate).
            s.add(Membership(org_id=org.id, firebase_uid='userX', status='removed'))
            s.commit()


class TestCheckConstraint(unittest.TestCase):
    def test_org_type_check_rejects_non_school(self):
        with Session(_engine) as s:
            s.add(Organization(name='D', name_lower='d', type='district'))
            with self.assertRaises(DBAPIError):
                s.commit()
            s.rollback()

    def test_voice_consent_status_check(self):
        from backend.db.models.compliance import StudentComplianceRecord

        with Session(_engine) as s:
            org = Organization(name='O2', name_lower='o2')
            s.add(org)
            s.commit()
            # 'not_required' is valid for guardian but NOT for voice.
            s.add(
                StudentComplianceRecord(
                    org_id=org.id,
                    student_firebase_uid='s1',
                    voice_consent_status='not_required',
                )
            )
            with self.assertRaises(DBAPIError):
                s.commit()
            s.rollback()


if __name__ == '__main__':
    unittest.main()
