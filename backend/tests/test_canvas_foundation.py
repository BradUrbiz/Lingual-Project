"""Tests for Canvas LMS Firestore foundation helpers.

Uses a FakeCanvasDb that mirrors the real database.py interface
without requiring Firestore. Validates that canvas_connections,
canvas_course_content, and Canvas-extended enrollment/class/assignment
helpers work correctly.
"""

import unittest
from datetime import UTC, datetime


class FakeCanvasDb:
    """Minimal in-memory database for testing Canvas helpers."""

    def __init__(self):
        self.canvas_connections = {}
        self.canvas_course_content = {}
        self.enrollments = {}
        self.classes = {}
        self.assignments = {}
        self.memberships = {}
        self._counter = 0

    def _next_id(self, prefix='doc'):
        self._counter += 1
        return f'{prefix}-{self._counter}'

    # ── Canvas connections ──────────────────────────────────────────────

    def create_canvas_connection(
        self, membership_id, org_id, class_id,
        canvas_instance_url, canvas_course_id,
        canvas_course_name='', encrypted_pat='', connection_id=None,
    ):
        connection_id = connection_id or self._next_id('conn')
        self.canvas_connections[connection_id] = {
            'id': connection_id,
            'membership_id': membership_id,
            'org_id': org_id,
            'class_id': class_id,
            'canvas_instance_url': canvas_instance_url,
            'canvas_course_id': str(canvas_course_id),
            'canvas_course_name': canvas_course_name,
            'encrypted_pat': encrypted_pat,
            'last_synced_at': None,
            'sync_status': 'idle',
            'created_at': datetime.now(UTC).isoformat(),
            'updated_at': datetime.now(UTC).isoformat(),
        }
        return connection_id

    def get_canvas_connection(self, connection_id):
        return self.canvas_connections.get(connection_id)

    def get_canvas_connection_by_class(self, class_id):
        for conn in self.canvas_connections.values():
            if conn.get('class_id') == class_id:
                return dict(conn)
        return None

    def update_canvas_connection(self, connection_id, updates):
        if connection_id in self.canvas_connections:
            self.canvas_connections[connection_id].update(updates)

    def delete_canvas_connection(self, connection_id):
        conn = self.canvas_connections.pop(connection_id, None)
        if conn:
            to_remove = [
                cid for cid, item in self.canvas_course_content.items()
                if item.get('connection_id') == connection_id
            ]
            for cid in to_remove:
                del self.canvas_course_content[cid]

    # ── Canvas course content ───────────────────────────────────────────

    def replace_canvas_course_content_for_connection(self, connection_id, class_id, items):
        to_remove = [
            cid for cid, item in self.canvas_course_content.items()
            if item.get('connection_id') == connection_id
        ]
        for cid in to_remove:
            del self.canvas_course_content[cid]
        for item in items:
            content_id = self._next_id('content')
            self.canvas_course_content[content_id] = {
                'id': content_id,
                'connection_id': connection_id,
                'class_id': class_id,
                **item,
            }

    def list_canvas_course_content_for_class(self, class_id):
        items = [
            dict(item) for item in self.canvas_course_content.values()
            if item.get('class_id') == class_id
        ]
        items.sort(key=lambda x: (x.get('canvas_module_position', 0), x.get('item_position', 0)))
        return items

    # ── Canvas-extended enrollments ─────────────────────────────────────

    def create_enrollment(
        self, class_id, student_uid, student_membership_id='',
        status='active', join_source='manual', student_number='',
        guardian_contact_required=False, enrollment_id=None,
        canvas_user_id='', canvas_email='',
    ):
        enrollment_id = enrollment_id or f'{class_id}_{student_uid}'
        self.enrollments[enrollment_id] = {
            'id': enrollment_id,
            'class_id': class_id,
            'student_uid': student_uid,
            'student_membership_id': student_membership_id,
            'status': status,
            'join_source': join_source,
            'student_number': student_number,
            'guardian_contact_required': bool(guardian_contact_required),
            'canvas_user_id': canvas_user_id or '',
            'canvas_email': canvas_email or '',
            'created_at': datetime.now(UTC).isoformat(),
            'updated_at': datetime.now(UTC).isoformat(),
        }
        return enrollment_id

    def list_class_enrollments(self, class_id, status='active'):
        return [
            dict(e) for e in self.enrollments.values()
            if e.get('class_id') == class_id and (not status or e.get('status') == status)
        ]

    # ── Canvas-extended classes ──────────────────────────────────────────

    def create_class(
        self, org_id, name, learning_locale='ko-KR', term='', subject='',
        teacher_membership_ids=None, grade_band='', status='active',
        class_id=None, canvas_course_id='',
    ):
        class_id = class_id or self._next_id('class')
        self.classes[class_id] = {
            'id': class_id,
            'org_id': org_id,
            'name': name,
            'learning_locale': learning_locale,
            'term': term,
            'subject': subject,
            'teacher_membership_ids': list(teacher_membership_ids or []),
            'grade_band': grade_band,
            'status': status,
            'canvas_course_id': canvas_course_id or '',
        }
        return class_id

    def get_class(self, class_id):
        return self.classes.get(class_id)

    # ── Canvas-extended assignments ─────────────────────────────────────

    def link_assignment_to_canvas_item(self, assignment_id, canvas_content_id, canvas_module_item_id):
        if assignment_id in self.assignments:
            self.assignments[assignment_id]['canvas_module_item_id'] = canvas_module_item_id
        if canvas_content_id in self.canvas_course_content:
            self.canvas_course_content[canvas_content_id]['lingual_assignment_id'] = assignment_id

    def unlink_assignment_from_canvas_item(self, assignment_id, canvas_content_id):
        if assignment_id in self.assignments:
            self.assignments[assignment_id]['canvas_module_item_id'] = ''
        if canvas_content_id in self.canvas_course_content:
            self.canvas_course_content[canvas_content_id]['lingual_assignment_id'] = None


class CanvasConnectionTests(unittest.TestCase):

    def setUp(self):
        self.db = FakeCanvasDb()

    def test_create_and_get_canvas_connection(self):
        conn_id = self.db.create_canvas_connection(
            membership_id='mem-1',
            org_id='org-1',
            class_id='class-1',
            canvas_instance_url='https://school.instructure.com',
            canvas_course_id='12345',
            canvas_course_name='AP French',
            encrypted_pat='encrypted-secret',
        )
        conn = self.db.get_canvas_connection(conn_id)
        self.assertIsNotNone(conn)
        self.assertEqual(conn['class_id'], 'class-1')
        self.assertEqual(conn['canvas_course_id'], '12345')
        self.assertEqual(conn['sync_status'], 'idle')

    def test_get_canvas_connection_by_class(self):
        self.db.create_canvas_connection(
            membership_id='mem-1', org_id='org-1', class_id='class-1',
            canvas_instance_url='https://school.instructure.com',
            canvas_course_id='12345',
        )
        conn = self.db.get_canvas_connection_by_class('class-1')
        self.assertIsNotNone(conn)
        self.assertEqual(conn['canvas_course_id'], '12345')

    def test_get_canvas_connection_by_class_returns_none_when_missing(self):
        self.assertIsNone(self.db.get_canvas_connection_by_class('no-such-class'))

    def test_delete_canvas_connection_removes_content(self):
        conn_id = self.db.create_canvas_connection(
            membership_id='mem-1', org_id='org-1', class_id='class-1',
            canvas_instance_url='https://school.instructure.com',
            canvas_course_id='12345',
        )
        self.db.replace_canvas_course_content_for_connection(conn_id, 'class-1', [
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Module 1',
             'canvas_module_position': 0, 'item_id': 'i1', 'item_title': 'Item',
             'item_type': 'Assignment', 'item_position': 0, 'item_html_url': ''},
        ])
        self.assertEqual(len(self.db.list_canvas_course_content_for_class('class-1')), 1)
        self.db.delete_canvas_connection(conn_id)
        self.assertIsNone(self.db.get_canvas_connection(conn_id))
        self.assertEqual(len(self.db.list_canvas_course_content_for_class('class-1')), 0)


class CanvasCourseContentTests(unittest.TestCase):

    def setUp(self):
        self.db = FakeCanvasDb()
        self.conn_id = self.db.create_canvas_connection(
            membership_id='mem-1', org_id='org-1', class_id='class-1',
            canvas_instance_url='https://school.instructure.com',
            canvas_course_id='12345',
        )

    def test_replace_and_list_course_content(self):
        items = [
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Unit 1',
             'canvas_module_position': 0, 'item_id': 'i1', 'item_title': 'Read Ch1',
             'item_type': 'Page', 'item_position': 0, 'item_html_url': 'https://example.com/1'},
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Unit 1',
             'canvas_module_position': 0, 'item_id': 'i2', 'item_title': 'Quiz 1',
             'item_type': 'Assignment', 'item_position': 1, 'item_html_url': 'https://example.com/2'},
            {'canvas_module_id': 'm2', 'canvas_module_name': 'Unit 2',
             'canvas_module_position': 1, 'item_id': 'i3', 'item_title': 'Essay',
             'item_type': 'Assignment', 'item_position': 0, 'item_html_url': 'https://example.com/3'},
        ]
        self.db.replace_canvas_course_content_for_connection(self.conn_id, 'class-1', items)
        result = self.db.list_canvas_course_content_for_class('class-1')
        self.assertEqual(len(result), 3)
        # Verify ordering: m1/i1 -> m1/i2 -> m2/i3
        self.assertEqual(result[0]['item_title'], 'Read Ch1')
        self.assertEqual(result[1]['item_title'], 'Quiz 1')
        self.assertEqual(result[2]['item_title'], 'Essay')

    def test_replace_removes_old_content(self):
        self.db.replace_canvas_course_content_for_connection(self.conn_id, 'class-1', [
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Old',
             'canvas_module_position': 0, 'item_id': 'old-1', 'item_title': 'Old Item',
             'item_type': 'Page', 'item_position': 0, 'item_html_url': ''},
        ])
        self.assertEqual(len(self.db.list_canvas_course_content_for_class('class-1')), 1)
        # Replace with new items
        self.db.replace_canvas_course_content_for_connection(self.conn_id, 'class-1', [
            {'canvas_module_id': 'm2', 'canvas_module_name': 'New',
             'canvas_module_position': 0, 'item_id': 'new-1', 'item_title': 'New Item',
             'item_type': 'Page', 'item_position': 0, 'item_html_url': ''},
        ])
        result = self.db.list_canvas_course_content_for_class('class-1')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['item_title'], 'New Item')

    def test_content_scoped_to_class(self):
        self.db.replace_canvas_course_content_for_connection(self.conn_id, 'class-1', [
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Unit 1',
             'canvas_module_position': 0, 'item_id': 'i1', 'item_title': 'Item',
             'item_type': 'Page', 'item_position': 0, 'item_html_url': ''},
        ])
        self.assertEqual(len(self.db.list_canvas_course_content_for_class('class-1')), 1)
        self.assertEqual(len(self.db.list_canvas_course_content_for_class('class-2')), 0)


class CanvasEnrollmentTests(unittest.TestCase):

    def setUp(self):
        self.db = FakeCanvasDb()

    def test_create_pending_sync_enrollment(self):
        eid = self.db.create_enrollment(
            class_id='class-1',
            student_uid='pending:canvas-user-1',
            status='pending_sync',
            join_source='canvas',
            canvas_user_id='canvas-user-1',
            canvas_email='student@example.com',
            enrollment_id='class-1__canvas-user-1',
        )
        self.assertEqual(eid, 'class-1__canvas-user-1')
        enrollment = self.db.enrollments[eid]
        self.assertEqual(enrollment['status'], 'pending_sync')
        self.assertEqual(enrollment['canvas_user_id'], 'canvas-user-1')
        self.assertEqual(enrollment['canvas_email'], 'student@example.com')

    def test_pending_sync_excluded_from_active_list(self):
        self.db.create_enrollment(
            class_id='class-1', student_uid='student-1',
            status='active', join_source='join_code',
        )
        self.db.create_enrollment(
            class_id='class-1', student_uid='pending:canvas-1',
            status='pending_sync', join_source='canvas',
            canvas_user_id='canvas-1', canvas_email='pending@example.com',
            enrollment_id='class-1__canvas-1',
        )
        active = self.db.list_class_enrollments('class-1', status='active')
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['student_uid'], 'student-1')

class CanvasClassExtensionTests(unittest.TestCase):

    def setUp(self):
        self.db = FakeCanvasDb()

    def test_create_class_with_canvas_course_id(self):
        class_id = self.db.create_class(
            org_id='org-1', name='AP French',
            canvas_course_id='12345',
        )
        cls = self.db.get_class(class_id)
        self.assertEqual(cls['canvas_course_id'], '12345')

    def test_create_class_without_canvas_defaults_to_empty(self):
        class_id = self.db.create_class(org_id='org-1', name='Normal Class')
        cls = self.db.get_class(class_id)
        self.assertEqual(cls['canvas_course_id'], '')


class CanvasAssignmentLinkTests(unittest.TestCase):

    def setUp(self):
        self.db = FakeCanvasDb()
        self.db.assignments['assign-1'] = {
            'id': 'assign-1', 'canvas_module_item_id': '',
        }
        conn_id = self.db.create_canvas_connection(
            membership_id='mem-1', org_id='org-1', class_id='class-1',
            canvas_instance_url='https://school.instructure.com',
            canvas_course_id='12345',
        )
        self.db.replace_canvas_course_content_for_connection(conn_id, 'class-1', [
            {'canvas_module_id': 'm1', 'canvas_module_name': 'Unit 1',
             'canvas_module_position': 0, 'item_id': 'canvas-item-99',
             'item_title': 'Speaking Practice', 'item_type': 'Assignment',
             'item_position': 0, 'item_html_url': 'https://example.com/99'},
        ])
        content = self.db.list_canvas_course_content_for_class('class-1')
        self.content_id = content[0]['id']

    def test_link_assignment_to_canvas_item(self):
        self.db.link_assignment_to_canvas_item('assign-1', self.content_id, 'canvas-item-99')
        self.assertEqual(self.db.assignments['assign-1']['canvas_module_item_id'], 'canvas-item-99')
        self.assertEqual(
            self.db.canvas_course_content[self.content_id]['lingual_assignment_id'],
            'assign-1',
        )

    def test_unlink_assignment_from_canvas_item(self):
        self.db.link_assignment_to_canvas_item('assign-1', self.content_id, 'canvas-item-99')
        self.db.unlink_assignment_from_canvas_item('assign-1', self.content_id)
        self.assertEqual(self.db.assignments['assign-1']['canvas_module_item_id'], '')
        self.assertIsNone(self.db.canvas_course_content[self.content_id]['lingual_assignment_id'])


if __name__ == '__main__':
    unittest.main()
