"""Tier 1 (no DB): enrollment repository twin logic.

Drives the repo functions with a fake SQLAlchemy session to verify the
Firestore-shaped serialization (student_firebase_uid -> student_uid rename,
composite-key id), the status filter, and the soft-delete branch — without a
real Postgres engine.
"""

import datetime
import unittest
import uuid

from backend.db.models.org import Enrollment
from backend.db.repository import enrollments as repo


class _FakeResult:
    def __init__(self, scalar=None, items=None):
        self._scalar = scalar
        self._items = items or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def all(self):
        return self._items


class _FakeSession:
    def __init__(self, result=None):
        self.result = result or _FakeResult()
        self.added = []
        self.flushes = 0

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        self.flushes += 1

    def execute(self, stmt):
        return self.result


def _make_row(**overrides):
    row = Enrollment()
    row.id = overrides.get('id', uuid.uuid4())
    row.legacy_firestore_id = overrides.get('legacy_firestore_id', 'class1_studentA')
    row.class_id = overrides.get('class_id', uuid.uuid4())
    row.student_firebase_uid = overrides.get('student_firebase_uid', 'studentA')
    row.student_membership_id = overrides.get('student_membership_id', None)
    row.status = overrides.get('status', 'active')
    row.join_source = overrides.get('join_source', 'join_code')
    row.student_number = overrides.get('student_number', '')
    row.guardian_contact_required = overrides.get('guardian_contact_required', False)
    row.canvas_user_id = overrides.get('canvas_user_id', '')
    row.canvas_email = overrides.get('canvas_email', '')
    row.canvas_name = overrides.get('canvas_name', '')
    row.created_at = overrides.get('created_at', datetime.datetime(2026, 5, 30))
    row.updated_at = overrides.get('updated_at', datetime.datetime(2026, 5, 30))
    return row


class TestSerialize(unittest.TestCase):
    def test_renames_student_uid_and_uses_legacy_id(self):
        row = _make_row(legacy_firestore_id='class1_studentA', student_firebase_uid='studentA')
        out = repo._serialize(row)
        self.assertEqual(out['id'], 'class1_studentA')
        self.assertEqual(out['student_uid'], 'studentA')
        self.assertNotIn('student_firebase_uid', out)

    def test_id_falls_back_to_uuid_when_no_legacy_id(self):
        rid = uuid.uuid4()
        row = _make_row(id=rid, legacy_firestore_id=None)
        out = repo._serialize(row)
        self.assertEqual(out['id'], str(rid))

    def test_includes_timestamps_for_roster_enrolled_at(self):
        ts = datetime.datetime(2026, 1, 2)
        row = _make_row(created_at=ts, updated_at=ts)
        out = repo._serialize(row)
        self.assertEqual(out['created_at'], ts)
        self.assertEqual(out['updated_at'], ts)


class TestCreateEnrollment(unittest.TestCase):
    def test_adds_and_flushes_with_renamed_column(self):
        session = _FakeSession()
        cid = uuid.uuid4()
        row = repo.create_enrollment(
            session, cid, 'studentA', join_source='join_code',
            legacy_firestore_id='c_s',
        )
        self.assertEqual(session.added, [row])
        self.assertEqual(session.flushes, 1)
        self.assertEqual(row.class_id, cid)
        self.assertEqual(row.student_firebase_uid, 'studentA')
        self.assertEqual(row.join_source, 'join_code')
        self.assertEqual(row.legacy_firestore_id, 'c_s')


class TestQueries(unittest.TestCase):
    def test_get_found_returns_serialized(self):
        row = _make_row()
        session = _FakeSession(_FakeResult(scalar=row))
        out = repo.get_student_class_enrollment(session, row.class_id, 'studentA')
        self.assertEqual(out['student_uid'], 'studentA')

    def test_get_missing_returns_none(self):
        session = _FakeSession(_FakeResult(scalar=None))
        self.assertIsNone(
            repo.get_student_class_enrollment(session, uuid.uuid4(), 'ghost')
        )

    def test_list_class_serializes_all(self):
        rows = [_make_row(student_firebase_uid='a'), _make_row(student_firebase_uid='b')]
        session = _FakeSession(_FakeResult(items=rows))
        out = repo.list_class_enrollments(session, uuid.uuid4())
        self.assertEqual([r['student_uid'] for r in out], ['a', 'b'])

    def test_list_student_serializes_all(self):
        rows = [_make_row(status='active')]
        session = _FakeSession(_FakeResult(items=rows))
        out = repo.list_student_enrollments(session, 'studentA')
        self.assertEqual(len(out), 1)


class TestSoftDelete(unittest.TestCase):
    def test_deactivate_sets_inactive(self):
        row = _make_row(status='active')
        session = _FakeSession(_FakeResult(scalar=row))
        repo.deactivate_enrollment(session, row.class_id, 'studentA')
        self.assertEqual(row.status, 'inactive')
        self.assertEqual(session.flushes, 1)

    def test_reactivate_sets_active(self):
        row = _make_row(status='inactive')
        session = _FakeSession(_FakeResult(scalar=row))
        repo.reactivate_enrollment(session, row.class_id, 'studentA')
        self.assertEqual(row.status, 'active')

    def test_deactivate_missing_is_noop(self):
        session = _FakeSession(_FakeResult(scalar=None))
        repo.deactivate_enrollment(session, uuid.uuid4(), 'ghost')
        self.assertEqual(session.flushes, 0)


if __name__ == '__main__':
    unittest.main()
