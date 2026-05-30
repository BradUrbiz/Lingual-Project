"""Tier 2 (gated): parent-chain dual-write end-to-end on real Postgres 18 (slice 2c-1).

Gated identically to the other PG tests (module skips unless DATABASE_URL is set).

    make test-postgres

Proves what a fake session cannot for the ORGANIZATION shadow:
  (a) a create lands the row keyed by legacy_firestore_id with correct flat columns,
  (b) the create is idempotent (no duplicate on re-run),
  (c) suspend -> restore round-trips status + the suspension fields through the
      targeted UPDATE without clobbering name/type, and
  (d) suspending an org not present in Postgres is a quiet no-op (fail-open).
"""

import os
import unittest

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise unittest.SkipTest('DATABASE_URL not set — run with: make test-postgres')

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

import uuid

import backend.db.models  # noqa: F401  (populate metadata)
from backend.db import dual_write_school_chain as sc
from backend.db.base import Base
from backend.db.models.org import Class, Membership, Organization
from backend.db.repository import backfill

_engine = None
FLAG = 'DUAL_WRITE_SCHOOL_CHAIN'


def setUpModule():
    global _engine
    _engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(_engine, checkfirst=True)
    Base.metadata.create_all(_engine)


def tearDownModule():
    if _engine is not None:
        Base.metadata.drop_all(_engine, checkfirst=True)
        _engine.dispose()


def _org_data(name='Springfield High', status='active'):
    # Mirrors what database.create_organization builds (minus the SERVER_TIMESTAMP
    # sentinels, which the shadow strips and upsert_organization ignores anyway).
    return {
        'name': name,
        'name_lower': name.strip().lower(),
        'type': 'school',
        'status': status,
        'pilot_stage': 'beta',
        'default_modality_policy': 'hybrid',
        'default_retention_policy': 'standard_school',
        'lms_capabilities': [],
    }


class TestOrgShadowEndToEnd(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get(FLAG)
        os.environ[FLAG] = '1'
        with Session(_engine) as s:
            s.query(Organization).delete()
            s.commit()

    def tearDown(self):
        if self._orig is None:
            os.environ.pop(FLAG, None)
        else:
            os.environ[FLAG] = self._orig

    def _provider(self):
        return lambda: _engine

    def _count(self, s):
        return s.execute(select(func.count()).select_from(Organization)).scalar_one()

    def _get(self, s, legacy_id='org1'):
        return s.execute(
            select(Organization).where(Organization.legacy_firestore_id == legacy_id)
        ).scalar_one()

    def test_create_lands_row(self):
        sc.shadow_create_organization(self._provider(), org_id='org1', org_data=_org_data())
        with Session(_engine) as s:
            self.assertEqual(self._count(s), 1)
            org = self._get(s)
            self.assertEqual(org.name, 'Springfield High')
            self.assertEqual(org.type, 'school')
            self.assertEqual(org.status, 'active')
            self.assertEqual(org.pilot_stage, 'beta')

    def test_create_is_idempotent(self):
        for _ in range(2):
            sc.shadow_create_organization(self._provider(), org_id='org1', org_data=_org_data())
        with Session(_engine) as s:
            self.assertEqual(self._count(s), 1)

    def test_suspend_then_restore_round_trip(self):
        sc.shadow_create_organization(self._provider(), org_id='org1', org_data=_org_data())
        sc.shadow_suspend_organization(
            self._provider(), org_id='org1', actor_uid='admin-1',
            reason='policy violation', suspended_until=None,
        )
        with Session(_engine) as s:
            org = self._get(s)
            self.assertEqual(org.status, 'suspended')
            self.assertEqual(org.suspended_by_firebase_uid, 'admin-1')
            self.assertEqual(org.suspend_reason, 'policy violation')
            self.assertIsNotNone(org.suspended_at)
            # Stable fields untouched by the targeted UPDATE.
            self.assertEqual(org.name, 'Springfield High')
            self.assertEqual(org.type, 'school')

        sc.shadow_restore_organization(self._provider(), org_id='org1', actor_uid='admin-2')
        with Session(_engine) as s:
            org = self._get(s)
            self.assertEqual(org.status, 'active')
            self.assertIsNone(org.suspended_at)
            self.assertIsNone(org.suspended_by_firebase_uid)
            self.assertIsNone(org.suspend_reason)
            self.assertEqual(org.restored_by_firebase_uid, 'admin-2')

    def test_suspend_unresolved_org_is_noop(self):
        # No org 'ghost' in PG -> 0 rows updated, no error.
        sc.shadow_suspend_organization(
            self._provider(), org_id='ghost', actor_uid='admin-1',
            reason='x', suspended_until=None,
        )
        with Session(_engine) as s:
            self.assertEqual(self._count(s), 0)

    def test_flag_off_writes_nothing(self):
        os.environ.pop(FLAG, None)
        sc.shadow_create_organization(self._provider(), org_id='org1', org_data=_org_data())
        with Session(_engine) as s:
            self.assertEqual(self._count(s), 0)


class TestMembershipShadowEndToEnd(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get(FLAG)
        os.environ[FLAG] = '1'
        with Session(_engine) as s:
            s.query(Membership).delete()
            s.query(Organization).delete()
            s.commit()
        # Seed the parent org so membership FKs resolve.
        sc.shadow_create_organization(lambda: _engine, org_id='org1', org_data=_org_data())

    def tearDown(self):
        if self._orig is None:
            os.environ.pop(FLAG, None)
        else:
            os.environ[FLAG] = self._orig

    def _provider(self):
        return lambda: _engine

    def _mdata(self, uid='uidA', roles=('student',), status='active'):
        return {'org_id': 'org1', 'uid': uid, 'roles': list(roles), 'status': status}

    def _count_memberships(self, s):
        return s.execute(select(func.count()).select_from(Membership)).scalar_one()

    def test_create_membership_lands_with_resolved_org_fk(self):
        sc.shadow_create_membership(self._provider(), membership_id='org1_uidA', membership_data=self._mdata())
        with Session(_engine) as s:
            org_uuid = s.execute(
                select(Organization.id).where(Organization.legacy_firestore_id == 'org1')
            ).scalar_one()
            mem = s.execute(
                select(Membership).where(Membership.legacy_firestore_id == 'org1_uidA')
            ).scalar_one()
            self.assertEqual(mem.org_id, org_uuid)
            self.assertEqual(mem.firebase_uid, 'uidA')
            self.assertEqual(mem.status, 'active')
            self.assertEqual(mem.roles, ['student'])

    def test_create_membership_idempotent(self):
        for _ in range(2):
            sc.shadow_create_membership(self._provider(), membership_id='org1_uidA', membership_data=self._mdata())
        with Session(_engine) as s:
            self.assertEqual(self._count_memberships(s), 1)

    def test_create_membership_noop_when_org_absent(self):
        # Membership referencing an org not in PG -> UnresolvedParentError -> quiet no-op.
        sc.shadow_create_membership(
            self._provider(), membership_id='ghost_uidZ',
            membership_data={'org_id': 'ghost', 'uid': 'uidZ', 'roles': ['student'], 'status': 'active'},
        )
        with Session(_engine) as s:
            self.assertEqual(self._count_memberships(s), 0)

    def test_remove_membership_flips_status(self):
        sc.shadow_create_membership(self._provider(), membership_id='org1_uidA', membership_data=self._mdata())
        sc.shadow_remove_membership(self._provider(), membership_id='org1_uidA', actor_uid='admin-1')
        with Session(_engine) as s:
            mem = s.execute(
                select(Membership).where(Membership.legacy_firestore_id == 'org1_uidA')
            ).scalar_one()
            self.assertEqual(mem.status, 'removed')
            self.assertEqual(mem.removed_by_firebase_uid, 'admin-1')
            self.assertIsNotNone(mem.removed_at)

    def test_partial_unique_allows_removed_plus_active_for_same_org_uid(self):
        # The one-active-per-(org,uid) partial index covers only active/invited.
        # A removed row + a new active row for the same (org, uid) must coexist.
        sc.shadow_create_membership(
            self._provider(), membership_id='org1_uidA_old',
            membership_data=self._mdata(status='active'),
        )
        sc.shadow_remove_membership(self._provider(), membership_id='org1_uidA_old', actor_uid='admin-1')
        sc.shadow_create_membership(
            self._provider(), membership_id='org1_uidA',
            membership_data=self._mdata(status='active'),
        )
        with Session(_engine) as s:
            self.assertEqual(self._count_memberships(s), 2)  # no IntegrityError

    def test_backfill_rerun_preserves_primary_class_ids(self):
        # The upsert_membership UPDATE branch must NOT clobber primary_class_ids
        # (which the 2c-3 shadow_add_primary_class writes).
        sc.shadow_create_membership(self._provider(), membership_id='org1_uidA', membership_data=self._mdata())
        class_uuid = uuid.uuid4()
        with Session(_engine) as s:
            mem = s.execute(
                select(Membership).where(Membership.legacy_firestore_id == 'org1_uidA')
            ).scalar_one()
            mem.primary_class_ids = [class_uuid]
            s.commit()
        # Re-run the backfill upsert on the same doc.
        with Session(_engine) as s:
            backfill.upsert_membership(s, {**self._mdata(), 'id': 'org1_uidA'})
            s.commit()
        with Session(_engine) as s:
            mem = s.execute(
                select(Membership).where(Membership.legacy_firestore_id == 'org1_uidA')
            ).scalar_one()
            self.assertEqual(mem.primary_class_ids, [class_uuid])


class TestClassAndPrimaryShadowEndToEnd(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get(FLAG)
        os.environ[FLAG] = '1'
        with Session(_engine) as s:
            s.query(Membership).delete()
            s.query(Class).delete()
            s.query(Organization).delete()
            s.commit()
        sc.shadow_create_organization(lambda: _engine, org_id='org1', org_data=_org_data())
        sc.shadow_create_membership(
            lambda: _engine, membership_id='org1_uidA',
            membership_data={'org_id': 'org1', 'uid': 'uidA', 'roles': ['student'], 'status': 'active'},
        )

    def tearDown(self):
        if self._orig is None:
            os.environ.pop(FLAG, None)
        else:
            os.environ[FLAG] = self._orig

    def _p(self):
        return lambda: _engine

    def _cdata(self):
        return {'org_id': 'org1', 'name': 'Spanish I', 'learning_locale': 'es-ES', 'status': 'active'}

    def _membership(self, s):
        return s.execute(
            select(Membership).where(Membership.legacy_firestore_id == 'org1_uidA')
        ).scalar_one()

    def test_create_class_lands_with_resolved_org_fk(self):
        sc.shadow_create_class(self._p(), class_id='class1', class_data=self._cdata())
        with Session(_engine) as s:
            org_uuid = s.execute(
                select(Organization.id).where(Organization.legacy_firestore_id == 'org1')
            ).scalar_one()
            cls = s.execute(select(Class).where(Class.legacy_firestore_id == 'class1')).scalar_one()
            self.assertEqual(cls.org_id, org_uuid)
            self.assertEqual(cls.learning_locale, 'es-ES')

    def test_add_primary_class_appends_resolved_uuid(self):
        sc.shadow_create_class(self._p(), class_id='class1', class_data=self._cdata())
        sc.shadow_add_primary_class(self._p(), membership_id='org1_uidA', class_id='class1')
        with Session(_engine) as s:
            class_uuid = s.execute(
                select(Class.id).where(Class.legacy_firestore_id == 'class1')
            ).scalar_one()
            self.assertEqual(self._membership(s).primary_class_ids, [class_uuid])

    def test_add_primary_class_idempotent(self):
        sc.shadow_create_class(self._p(), class_id='class1', class_data=self._cdata())
        for _ in range(2):
            sc.shadow_add_primary_class(self._p(), membership_id='org1_uidA', class_id='class1')
        with Session(_engine) as s:
            self.assertEqual(len(self._membership(s).primary_class_ids), 1)

    def test_add_primary_class_noop_when_class_unresolved(self):
        sc.shadow_add_primary_class(self._p(), membership_id='org1_uidA', class_id='ghost')
        with Session(_engine) as s:
            self.assertEqual(self._membership(s).primary_class_ids, [])

    def test_remove_primary_class(self):
        sc.shadow_create_class(self._p(), class_id='class1', class_data=self._cdata())
        sc.shadow_add_primary_class(self._p(), membership_id='org1_uidA', class_id='class1')
        sc.shadow_remove_primary_class(self._p(), membership_id='org1_uidA', class_id='class1')
        with Session(_engine) as s:
            self.assertEqual(self._membership(s).primary_class_ids, [])

    def test_invite_code_generate_then_deactivate(self):
        sc.shadow_update_org_invite_code(self._p(), org_id='org1', code='ABC123')
        with Session(_engine) as s:
            org = s.execute(
                select(Organization).where(Organization.legacy_firestore_id == 'org1')
            ).scalar_one()
            self.assertEqual(org.teacher_invite_code, 'ABC123')
            self.assertTrue(org.teacher_invite_code_active)
            # Stable field untouched.
            self.assertEqual(org.name, 'Springfield High')
        sc.shadow_deactivate_org_invite_code(self._p(), org_id='org1')
        with Session(_engine) as s:
            org = s.execute(
                select(Organization).where(Organization.legacy_firestore_id == 'org1')
            ).scalar_one()
            self.assertFalse(org.teacher_invite_code_active)
            self.assertEqual(org.teacher_invite_code, 'ABC123')  # code preserved, only active flipped


if __name__ == '__main__':
    unittest.main()
