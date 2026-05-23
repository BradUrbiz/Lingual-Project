import io
import unittest
from unittest.mock import patch

from scripts.backfill_legacy_user_roles import (
    infer_role_from_memberships,
    infer_role_from_signals,
    run_backfill,
    main,
)


class _Doc:
    """Mimics a firestore DocumentSnapshot returned by .stream()."""
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
    def to_dict(self):
        return dict(self._data)


class FakeBackfillDb:
    """Fake firestore client for backfill tests — implements only what
    `run_backfill` needs: collection().stream() on users, plus the
    `list_user_memberships` / `list_user_enrollments` helpers that the
    script calls. Updates are captured in `self.updates`."""

    def __init__(self):
        self.users = []                  # list of _Doc for users collection
        self.memberships_by_uid = {}     # uid -> list[dict]
        self.enrollments_by_uid = {}     # uid -> list[id]
        self.updates = []                # captured (uid, payload) tuples

    def collection(self, name):
        # The script calls db.collection('users').stream() to iterate users
        # and db.collection('users').document(uid).update({...}) to write.
        if name != 'users':
            raise AssertionError(f'Unexpected collection: {name}')
        return _UsersCollection(self)


class _UsersCollection:
    def __init__(self, db):
        self._db = db
    def stream(self):
        return iter(self._db.users)
    def document(self, uid):
        return _UserDoc(self._db, uid)


class _UserDoc:
    def __init__(self, db, uid):
        self._db = db
        self._uid = uid
    def update(self, payload):
        self._db.updates.append((self._uid, dict(payload)))


class InferRoleFromMembershipsTests(unittest.TestCase):
    def test_school_admin_yields_admin(self):
        m = [{'org_id': 'o', 'roles': ['school_admin'], 'status': 'active'}]
        self.assertEqual(infer_role_from_memberships(m), 'admin')

    def test_teacher_yields_teacher(self):
        m = [{'org_id': 'o', 'roles': ['teacher'], 'status': 'active'}]
        self.assertEqual(infer_role_from_memberships(m), 'teacher')

    def test_priority_school_admin_over_teacher(self):
        m = [
            {'org_id': 'o1', 'roles': ['teacher'], 'status': 'active'},
            {'org_id': 'o2', 'roles': ['school_admin'], 'status': 'active'},
        ]
        self.assertEqual(infer_role_from_memberships(m), 'admin')

    def test_ignores_inactive_memberships(self):
        m = [{'org_id': 'o', 'roles': ['school_admin'], 'status': 'removed'}]
        self.assertIsNone(infer_role_from_memberships(m))

    def test_empty_memberships_yields_none(self):
        self.assertIsNone(infer_role_from_memberships([]))


class InferRoleFromSignalsTests(unittest.TestCase):
    def test_membership_wins_over_enrollment(self):
        m = [{'org_id': 'o', 'roles': ['teacher'], 'status': 'active'}]
        self.assertEqual(infer_role_from_signals(m, ['e1']), 'teacher')

    def test_enrollment_only_yields_student(self):
        self.assertEqual(infer_role_from_signals([], ['e1']), 'student')

    def test_no_signals_yields_none(self):
        self.assertIsNone(infer_role_from_signals([], []))


class RunBackfillTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeBackfillDb()

    def _add_user(self, uid, profile=None):
        self.db.users.append(_Doc(uid, {'profile': profile or {}}))

    def test_skips_users_with_existing_intended_role(self):
        self._add_user('u-already', profile={'intended_role': 'student'})
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            return_value=[],
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=[],
        ):
            stats = run_backfill(db=self.db, dry_run=False, batch_size=10)
        self.assertEqual(stats['written'], 0)
        self.assertEqual(stats['skipped_already_migrated'], 1)
        self.assertEqual(self.db.updates, [])

    def test_writes_teacher_from_membership(self):
        self._add_user('u-teach')
        def memberships_for(db, uid):
            return [{'org_id': 'o', 'roles': ['teacher'], 'status': 'active'}]
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            side_effect=memberships_for,
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=[],
        ):
            stats = run_backfill(db=self.db, dry_run=False, batch_size=10)
        self.assertEqual(stats['written'], 1)
        self.assertEqual(stats['would_set_teacher'], 1)
        self.assertEqual(len(self.db.updates), 1)
        uid, payload = self.db.updates[0]
        self.assertEqual(uid, 'u-teach')
        self.assertEqual(payload['profile.intended_role'], 'teacher')
        self.assertEqual(payload['profile.onboarding_state'], 'complete')

    def test_writes_admin_from_school_admin_membership(self):
        self._add_user('u-adm')
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            return_value=[{'org_id': 'o', 'roles': ['school_admin'], 'status': 'active'}],
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=[],
        ):
            stats = run_backfill(db=self.db, dry_run=False, batch_size=10)
        self.assertEqual(stats['would_set_admin'], 1)
        self.assertEqual(stats['written'], 1)
        self.assertEqual(self.db.updates[0][1]['profile.intended_role'], 'admin')

    def test_writes_student_from_enrollment(self):
        self._add_user('u-stu')
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            return_value=[],
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=['e1'],
        ):
            stats = run_backfill(db=self.db, dry_run=False, batch_size=10)
        self.assertEqual(stats['would_set_student'], 1)
        self.assertEqual(stats['written'], 1)
        self.assertEqual(self.db.updates[0][1]['profile.intended_role'], 'student')

    def test_dry_run_does_not_write(self):
        self._add_user('u-adm')
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            return_value=[{'org_id': 'o', 'roles': ['school_admin'], 'status': 'active'}],
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=[],
        ):
            stats = run_backfill(db=self.db, dry_run=True, batch_size=10)
        self.assertEqual(stats['would_set_admin'], 1)
        self.assertEqual(stats['written'], 0)
        self.assertEqual(self.db.updates, [])

    def test_no_signal_users_are_skipped(self):
        self._add_user('u-orphan')
        with patch(
            'scripts.backfill_legacy_user_roles.list_user_memberships',
            return_value=[],
        ), patch(
            'scripts.backfill_legacy_user_roles.list_user_enrollments',
            return_value=[],
        ):
            stats = run_backfill(db=self.db, dry_run=False, batch_size=10)
        self.assertEqual(stats['skipped_no_signal'], 1)
        self.assertEqual(self.db.updates, [])


class MainCliTests(unittest.TestCase):
    def test_main_dry_run_invokes_run_backfill_with_flag(self):
        fake_stats = {
            'scanned': 0, 'written': 0, 'skipped_already_migrated': 0,
            'skipped_no_signal': 0,
            'would_set_admin': 0, 'would_set_teacher': 0, 'would_set_student': 0,
        }
        with patch(
            'scripts.backfill_legacy_user_roles.run_backfill',
            return_value=fake_stats,
        ) as mock_run, patch(
            'scripts.backfill_legacy_user_roles._get_firestore_client',
            return_value=object(),
        ), patch('sys.stdout', new_callable=io.StringIO) as mock_stdout:
            rc = main(['--dry-run'])
        self.assertEqual(rc, 0)
        mock_run.assert_called_once()
        self.assertTrue(mock_run.call_args.kwargs['dry_run'])
        out = mock_stdout.getvalue()
        self.assertIn('scanned', out)

    def test_main_default_is_not_dry_run(self):
        fake_stats = {'scanned': 0, 'written': 0, 'skipped_already_migrated': 0,
                      'skipped_no_signal': 0,
                      'would_set_admin': 0, 'would_set_teacher': 0, 'would_set_student': 0}
        with patch(
            'scripts.backfill_legacy_user_roles.run_backfill',
            return_value=fake_stats,
        ) as mock_run, patch(
            'scripts.backfill_legacy_user_roles._get_firestore_client',
            return_value=object(),
        ), patch('sys.stdout', new_callable=io.StringIO):
            rc = main([])
        self.assertEqual(rc, 0)
        self.assertFalse(mock_run.call_args.kwargs['dry_run'])
