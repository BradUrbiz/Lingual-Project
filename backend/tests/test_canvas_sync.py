import unittest

from backend.services.canvas.sync import (
    SyncResult,
    reconcile_enrollments,
    flatten_course_content,
)


class FakeSyncDb:
    """In-memory db interface used by the sync service."""

    def __init__(self):
        self.enrollments = {}      # enrollment_id -> dict
        self.memberships = {}      # membership_id -> dict
        self.users_by_email = {}   # email -> user dict
        self.created_enrollments = []
        self.deactivated_enrollments = []
        self.deleted_enrollments = []
        self.created_memberships = []
        self.updated_memberships = []

    def list_class_enrollments(self, class_id, status=None):
        return [
            e for e in self.enrollments.values()
            if e.get('class_id') == class_id
            and (status is None or e.get('status') == status)
        ]

    def get_user_by_email(self, email):
        return self.users_by_email.get(email)

    def get_membership(self, membership_id):
        return self.memberships.get(membership_id)

    def create_membership(self, org_id, uid, roles, primary_class_ids=None, membership_id=None, **_kwargs):
        mid = membership_id or f'{org_id}_{uid}'
        membership = {
            'id': mid, 'org_id': org_id, 'uid': uid,
            'roles': list(roles), 'primaryClassIds': list(primary_class_ids or []),
            'status': 'active',
        }
        self.memberships[mid] = membership
        self.created_memberships.append(membership)
        return mid

    def add_primary_class_to_membership(self, membership_id, class_id):
        mem = self.memberships.get(membership_id)
        if mem and class_id not in mem.get('primaryClassIds', []):
            mem.setdefault('primaryClassIds', []).append(class_id)
            self.updated_memberships.append(membership_id)

    def create_enrollment(self, class_id, student_uid, student_membership_id=None,
                          status='active', join_source='canvas', student_number='',
                          enrollment_id=None, canvas_user_id='', canvas_email='', **_kwargs):
        eid = enrollment_id or f'{class_id}_{student_uid}'
        enrollment = {
            'id': eid, 'class_id': class_id, 'student_uid': student_uid,
            'student_membership_id': student_membership_id,
            'status': status, 'join_source': join_source,
            'canvas_user_id': canvas_user_id, 'canvas_email': canvas_email,
            'student_number': student_number,
        }
        self.enrollments[eid] = enrollment
        self.created_enrollments.append(enrollment)
        return eid

    def deactivate_canvas_enrollment(self, enrollment_id):
        enrollment = self.enrollments.get(enrollment_id)
        if enrollment:
            enrollment['status'] = 'inactive'
            self.deactivated_enrollments.append(enrollment_id)

    def delete_enrollment(self, enrollment_id):
        self.enrollments.pop(enrollment_id, None)
        self.deleted_enrollments.append(enrollment_id)

    def replace_canvas_course_content_for_connection(self, connection_id, class_id, items):
        self._replaced_content = (connection_id, class_id, items)


class ReconcileEnrollmentsTest(unittest.TestCase):
    def test_email_match_creates_active_enrollment(self):
        db = FakeSyncDb()
        db.users_by_email['alice@school.edu'] = {'uid': 'alice-uid', 'email': 'alice@school.edu'}

        canvas_students = [
            {'id': 50, 'email': 'alice@school.edu', 'name': 'Alice', 'sis_user_id': None},
        ]
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=canvas_students,
        )
        self.assertEqual(result.matched, 1)
        self.assertEqual(result.unmatched, 0)
        self.assertEqual(len(db.created_enrollments), 1)
        self.assertEqual(db.created_enrollments[0]['status'], 'active')
        self.assertEqual(db.created_enrollments[0]['student_uid'], 'alice-uid')

    def test_unmatched_student_creates_pending_sync(self):
        db = FakeSyncDb()
        canvas_students = [
            {'id': 51, 'email': 'bob@school.edu', 'name': 'Bob', 'sis_user_id': None},
        ]
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=canvas_students,
        )
        self.assertEqual(result.matched, 0)
        self.assertEqual(result.unmatched, 1)
        self.assertEqual(len(db.created_enrollments), 1)
        self.assertEqual(db.created_enrollments[0]['status'], 'pending_sync')
        # pending_sync uses double-underscore ID format
        self.assertIn('__', db.created_enrollments[0]['id'])

    def test_removed_canvas_student_deactivated(self):
        db = FakeSyncDb()
        # Existing Canvas-sourced enrollment
        db.enrollments['class-1__cv99'] = {
            'id': 'class-1__cv99', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync',
            'join_source': 'canvas', 'canvas_user_id': 'cv99',
            'canvas_email': 'gone@school.edu',
        }
        # Canvas returns NO students now
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=[],
        )
        self.assertEqual(result.deactivated, 1)

    def test_manual_enrollment_not_touched(self):
        db = FakeSyncDb()
        db.enrollments['class-1_manual-student'] = {
            'id': 'class-1_manual-student', 'class_id': 'class-1',
            'student_uid': 'manual-student', 'status': 'active',
            'join_source': 'manual', 'canvas_user_id': '',
            'canvas_email': '',
        }
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=[],
        )
        self.assertEqual(result.deactivated, 0)
        self.assertEqual(db.enrollments['class-1_manual-student']['status'], 'active')

    def test_already_enrolled_student_skipped(self):
        db = FakeSyncDb()
        db.users_by_email['alice@school.edu'] = {'uid': 'alice-uid', 'email': 'alice@school.edu'}
        db.enrollments['class-1_alice-uid'] = {
            'id': 'class-1_alice-uid', 'class_id': 'class-1',
            'student_uid': 'alice-uid', 'status': 'active',
            'join_source': 'canvas', 'canvas_user_id': '50',
            'canvas_email': 'alice@school.edu',
        }
        canvas_students = [
            {'id': 50, 'email': 'alice@school.edu', 'name': 'Alice', 'sis_user_id': None},
        ]
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=canvas_students,
        )
        self.assertEqual(result.matched, 1)
        self.assertEqual(result.created, 0)

    def test_mixed_scenario(self):
        db = FakeSyncDb()
        db.users_by_email['alice@school.edu'] = {'uid': 'alice-uid', 'email': 'alice@school.edu'}
        # Existing pending enrollment that should be deactivated (student removed from Canvas)
        db.enrollments['class-1__cv_gone'] = {
            'id': 'class-1__cv_gone', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync',
            'join_source': 'canvas', 'canvas_user_id': 'cv_gone',
            'canvas_email': 'gone@school.edu',
        }
        canvas_students = [
            {'id': 50, 'email': 'alice@school.edu', 'name': 'Alice', 'sis_user_id': None},
            {'id': 51, 'email': 'bob@school.edu', 'name': 'Bob', 'sis_user_id': None},
        ]
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=canvas_students,
        )
        self.assertEqual(result.matched, 1)    # Alice
        self.assertEqual(result.unmatched, 1)   # Bob
        self.assertEqual(result.deactivated, 1)  # cv_gone removed

    def test_existing_membership_gets_class_added(self):
        db = FakeSyncDb()
        db.users_by_email['alice@school.edu'] = {'uid': 'alice-uid', 'email': 'alice@school.edu'}
        db.memberships['org-1_alice-uid'] = {
            'id': 'org-1_alice-uid', 'org_id': 'org-1', 'uid': 'alice-uid',
            'roles': ['student'], 'primaryClassIds': ['class-other'],
        }
        canvas_students = [
            {'id': 50, 'email': 'alice@school.edu', 'name': 'Alice', 'sis_user_id': None},
        ]
        reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=canvas_students,
        )
        self.assertIn('class-1', db.memberships['org-1_alice-uid']['primaryClassIds'])
        self.assertEqual(len(db.created_memberships), 0)

    def test_pending_sync_removed_student_deleted_not_deactivated(self):
        """pending_sync enrollments for removed students should be deleted, not deactivated."""
        db = FakeSyncDb()
        db.enrollments['class-1__cv_gone'] = {
            'id': 'class-1__cv_gone', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync',
            'join_source': 'canvas', 'canvas_user_id': 'cv_gone',
            'canvas_email': 'gone@school.edu',
        }
        result = reconcile_enrollments(
            db=db, class_id='class-1', org_id='org-1',
            canvas_students=[],
        )
        self.assertEqual(len(db.deleted_enrollments), 1)
        self.assertEqual(result.deactivated, 1)


class FlattenCourseContentTest(unittest.TestCase):
    def test_flattens_modules_and_items(self):
        modules = [
            {'id': 10, 'name': 'Week 1', 'position': 1},
            {'id': 11, 'name': 'Week 2', 'position': 2},
        ]
        items_by_module = {
            10: [
                {'id': 100, 'title': 'Reading', 'type': 'Page', 'position': 1},
                {'id': 101, 'title': 'Quiz', 'type': 'Quiz', 'position': 2},
            ],
            11: [
                {'id': 200, 'title': 'Essay', 'type': 'Assignment', 'position': 1},
            ],
        }
        flat = flatten_course_content('conn1', 'class-1', modules, items_by_module)
        self.assertEqual(len(flat), 3)
        self.assertEqual(flat[0]['canvas_module_name'], 'Week 1')
        self.assertEqual(flat[0]['canvas_module_position'], 1)
        self.assertEqual(flat[0]['item_position'], 1)
        self.assertEqual(flat[0]['title'], 'Reading')
        self.assertEqual(flat[2]['canvas_module_position'], 2)

    def test_empty_modules(self):
        flat = flatten_course_content('conn1', 'class-1', [], {})
        self.assertEqual(flat, [])


class SyncResultTest(unittest.TestCase):
    def test_to_dict(self):
        r = SyncResult(matched=5, unmatched=12, deactivated=2, created=17, unchanged=3)
        d = r.to_dict()
        self.assertEqual(d['matched'], 5)
        self.assertEqual(d['unmatched'], 12)
        self.assertEqual(d['deactivated'], 2)
        self.assertEqual(d['created'], 17)
        self.assertEqual(d['unchanged'], 3)


if __name__ == '__main__':
    unittest.main()
