import base64
import os
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.integrations import create_integrations_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


class FakeCanvasRouteDb:
    """Minimal db fake for integration route tests."""

    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.canvas_connections = {}
        self.canvas_course_content = {}
        self.users = {}
        self.user_active_memberships = {}
        self.created_connections = []
        self.updated_connections = []

    def set_user_last_active_membership(self, uid, membership_id):
        self.user_active_memberships[uid] = membership_id

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        memberships = []
        for membership in self.memberships.values():
            if membership.get('uid') != uid or membership.get('status') not in {'active', 'invited'}:
                continue
            org = self.organizations.get(membership.get('org_id')) or {}
            memberships.append({
                'id': membership['id'],
                'orgId': membership['org_id'],
                'orgName': org.get('name', ''),
                'roles': membership.get('roles', []),
                'status': membership.get('status', 'active'),
                'primaryClassIds': membership.get('primaryClassIds', []),
            })
        memberships.sort(key=lambda m: m['id'])
        active_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active = next((m for m in memberships if m['id'] == active_id), memberships[0] if memberships else None)
        return {
            'memberships': memberships,
            'active_membership': active,
            'active_membership_id': active.get('id') if active else None,
            'active_organization_id': active.get('orgId') if active else None,
            'active_roles': active.get('roles', []) if active else [],
        }

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_canvas_connection_by_class(self, class_id):
        for conn in self.canvas_connections.values():
            if conn.get('class_id') == class_id:
                return conn
        return None

    def create_canvas_connection(self, membership_id, org_id, class_id,
                                  canvas_instance_url, canvas_course_id,
                                  canvas_course_name='', encrypted_pat='',
                                  connection_id=None, **_kwargs):
        cid = connection_id or f'conn_{class_id}'
        conn = {
            'id': cid,
            'membership_id': membership_id,
            'org_id': org_id,
            'class_id': class_id,
            'canvas_instance_url': canvas_instance_url,
            'canvas_course_id': canvas_course_id,
            'canvas_course_name': canvas_course_name,
            'encrypted_pat': encrypted_pat,
            'last_sync_at': None,
            'sync_status': 'never',
        }
        self.canvas_connections[cid] = conn
        self.created_connections.append(conn)
        return cid

    def update_canvas_connection(self, connection_id, updates):
        if connection_id in self.canvas_connections:
            self.canvas_connections[connection_id].update(updates)
            self.updated_connections.append((connection_id, updates))

    def delete_canvas_connection(self, connection_id):
        self.canvas_connections.pop(connection_id, None)

    def create_class(self, org_id, name, learning_locale='ko-KR', term='',
                     subject='', teacher_membership_ids=None, grade_band='',
                     status='active', class_id=None, canvas_course_id='', **_kwargs):
        cid = class_id or f'class-new'
        self.classes[cid] = {
            'id': cid, 'org_id': org_id, 'name': name,
            'teacher_membership_ids': list(teacher_membership_ids or []),
            'status': status, 'canvas_course_id': canvas_course_id,
        }
        return cid

    def add_primary_class_to_membership(self, membership_id, class_id):
        mem = self.memberships.get(membership_id)
        if mem and class_id not in mem.get('primaryClassIds', []):
            mem.setdefault('primaryClassIds', []).append(class_id)

    def list_class_enrollments(self, class_id, status=None):
        return [
            e for e in self.enrollments.values()
            if e.get('class_id') == class_id
            and (status is None or e.get('status') == status)
        ]

    def get_user_by_email(self, email):
        for u in self.users.values():
            if u.get('email') == email:
                return u
        return None

    def get_membership(self, membership_id):
        return self.memberships.get(membership_id)

    def create_membership(self, org_id, uid, roles, primary_class_ids=None, membership_id=None, **_kwargs):
        mid = membership_id or f'{org_id}_{uid}'
        self.memberships[mid] = {
            'id': mid, 'org_id': org_id, 'uid': uid,
            'roles': list(roles), 'primaryClassIds': list(primary_class_ids or []),
            'status': 'active',
        }
        return mid

    def create_enrollment(self, **kwargs):
        eid = kwargs.get('enrollment_id') or f"{kwargs['class_id']}_{kwargs.get('student_uid', '')}"
        self.enrollments[eid] = {'id': eid, **kwargs}
        return eid

    def deactivate_canvas_enrollment(self, enrollment_id):
        e = self.enrollments.get(enrollment_id)
        if e:
            e['status'] = 'inactive'

    def delete_enrollment(self, enrollment_id):
        self.enrollments.pop(enrollment_id, None)

    def replace_canvas_course_content_for_connection(self, connection_id, class_id, items):
        self.canvas_course_content[(connection_id, class_id)] = items

    def link_assignment_to_canvas_item(self, assignment_id, canvas_content_id, canvas_module_item_id):
        pass

    def unlink_assignment_from_canvas_item(self, assignment_id, canvas_content_id):
        pass


def _seed_teacher_context(db):
    """Create org + teacher membership + class for a standard test."""
    db.organizations['org-1'] = {'id': 'org-1', 'name': 'Test School'}
    db.memberships['mem-t1'] = {
        'id': 'mem-t1', 'org_id': 'org-1', 'uid': 'teacher-1',
        'roles': ['teacher'], 'status': 'active', 'primaryClassIds': ['class-1'],
    }
    db.classes['class-1'] = {
        'id': 'class-1', 'org_id': 'org-1', 'name': 'Korean 101',
        'teacher_membership_ids': ['mem-t1'], 'status': 'active',
    }


def _make_app(db):
    app = Flask(__name__)
    app.secret_key = 'test-secret'

    def get_school_ctx():
        uid = (session.get('user') or {}).get('uid')
        if not uid:
            raise PermissionError('Auth required')
        preferred = (session.get('user') or {}).get('active_membership_id')
        return resolve_school_request_context(db, uid, preferred_active_membership_id=preferred)

    deps = RouteDeps(
        db=db,
        firebase_auth=None,
        get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
        get_openai_client=lambda: None,
        get_assessment=lambda: {},
        compute_results=lambda *a, **kw: {},
        get_proficiency_description=lambda *a, **kw: {'level': 'Novice', 'description': 'Test'},
        login_required=passthrough_login_required,
        get_user_proficiency_context=lambda: '',
        build_system_prompt=lambda _c: '',
            get_school_request_context=get_school_ctx,
        set_active_school_membership=lambda _mid: None,
        allowed_learning_locales={'ko-KR'},
        allowed_minigame_types=set(),
        supported_ui_languages={'en', 'ko'},
    )
    app.register_blueprint(create_integrations_blueprint(deps))
    return app


def _teacher_session():
    return {'user': {'uid': 'teacher-1', 'active_membership_id': 'mem-t1'}}


class ValidateEndpointTest(unittest.TestCase):
    @patch('backend.routes.integrations.CanvasClient')
    def test_validate_success(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_user.return_value = {'id': 1, 'name': 'Teacher'}
        mock_instance.get_courses.return_value = [
            {'id': 100, 'name': 'Korean 101', 'course_code': 'KOR101'},
        ]

        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/integrations/canvas/validate', json={
            'canvasInstanceUrl': 'https://school.instructure.com',
            'pat': 'valid-pat',
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(len(data['courses']), 1)
        self.assertEqual(data['teacher']['name'], 'Teacher')

    @patch('backend.routes.integrations.CanvasClient')
    def test_validate_auth_failure(self, MockClient):
        from backend.services.canvas.client import CanvasAuthError
        MockClient.return_value.get_user.side_effect = CanvasAuthError('Invalid PAT')

        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/integrations/canvas/validate', json={
            'canvasInstanceUrl': 'https://school.instructure.com',
            'pat': 'bad-pat',
        })
        self.assertEqual(resp.status_code, 401)


class ConnectEndpointTest(unittest.TestCase):
    @patch('backend.routes.integrations.encrypt_pat')
    @patch('backend.routes.integrations.CanvasClient')
    def test_connect_creates_connection_and_class(self, MockClient, mock_encrypt):
        mock_encrypt.return_value = 'encrypted_pat_data'
        mock_canvas = MockClient.return_value
        mock_canvas.get_user.return_value = {'id': 1, 'name': 'Teacher'}
        mock_canvas.get_students.return_value = []
        mock_canvas.get_modules.return_value = []

        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/integrations/canvas/connect', json={
            'canvasInstanceUrl': 'https://school.instructure.com',
            'pat': 'valid-pat',
            'canvasCourseId': '100',
            'canvasCourseName': 'Korean 101',
            'existingClassId': 'class-1',
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(len(db.created_connections), 1)
        self.assertEqual(db.created_connections[0]['class_id'], 'class-1')

    @patch('backend.routes.integrations.encrypt_pat')
    def test_connect_missing_encryption_key_returns_503(self, mock_encrypt):
        mock_encrypt.side_effect = ValueError('Key not set')

        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/integrations/canvas/connect', json={
            'canvasInstanceUrl': 'https://school.instructure.com',
            'pat': 'valid-pat',
            'canvasCourseId': '100',
            'canvasCourseName': 'Korean 101',
        })
        self.assertEqual(resp.status_code, 503)


class StatusEndpointTest(unittest.TestCase):
    def test_status_returns_connection_info(self):
        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1', 'org_id': 'org-1',
            'canvas_instance_url': 'https://school.instructure.com',
            'canvas_course_id': '100', 'canvas_course_name': 'Korean 101',
            'sync_status': 'completed', 'last_sync_at': None,
            'membership_id': 'mem-t1',
        }
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.get('/api/teacher/classes/class-1/canvas/status')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['connected'])
        self.assertEqual(data['canvasCourseId'], '100')

    def test_status_no_connection(self):
        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.get('/api/teacher/classes/class-1/canvas/status')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertFalse(data['connected'])


class SyncEndpointTest(unittest.TestCase):
    @patch('backend.routes.integrations.decrypt_pat')
    @patch('backend.routes.integrations.CanvasClient')
    @patch('backend.routes.integrations.sync_roster')
    @patch('backend.routes.integrations.sync_course_content')
    def test_sync_triggers_roster_and_content(self, mock_content, mock_roster, MockClient, mock_decrypt):
        from backend.services.canvas.sync import SyncResult
        mock_decrypt.return_value = 'decrypted-pat'
        mock_roster.return_value = SyncResult(
            entries_upserted=7, entries_removed=2, total_canvas_students=7,
        )
        mock_content.return_value = 10

        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1', 'org_id': 'org-1',
            'canvas_instance_url': 'https://school.instructure.com',
            'canvas_course_id': '100', 'encrypted_pat': 'enc_data',
            'sync_status': 'completed', 'last_sync_at': None,
            'membership_id': 'mem-t1',
        }
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/teacher/classes/class-1/canvas/sync')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['roster']['entries_upserted'], 7)
        self.assertEqual(data['roster']['entries_removed'], 2)
        self.assertEqual(data['roster']['total_canvas_students'], 7)
        mock_roster.assert_called_once()
        mock_content.assert_called_once()

    def test_sync_no_connection_returns_404(self):
        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.post('/api/teacher/classes/class-1/canvas/sync')
        self.assertEqual(resp.status_code, 404)


class DisconnectEndpointTest(unittest.TestCase):
    def test_disconnect_removes_connection(self):
        db = FakeCanvasRouteDb()
        _seed_teacher_context(db)
        db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1', 'org_id': 'org-1',
            'canvas_instance_url': 'https://school.instructure.com',
            'canvas_course_id': '100', 'encrypted_pat': 'enc',
            'sync_status': 'completed', 'last_sync_at': None,
            'membership_id': 'mem-t1',
        }
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess.update(_teacher_session())

        resp = client.delete('/api/teacher/classes/class-1/canvas/disconnect')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('conn-1', db.canvas_connections)


class AuthorizationTest(unittest.TestCase):
    def test_student_cannot_access_canvas_status(self):
        db = FakeCanvasRouteDb()
        db.organizations['org-1'] = {'id': 'org-1', 'name': 'Test School'}
        db.memberships['mem-s1'] = {
            'id': 'mem-s1', 'org_id': 'org-1', 'uid': 'student-1',
            'roles': ['student'], 'status': 'active', 'primaryClassIds': [],
        }
        db.classes['class-1'] = {
            'id': 'class-1', 'org_id': 'org-1', 'name': 'Korean 101',
            'teacher_membership_ids': ['mem-t1'], 'status': 'active',
        }
        app = _make_app(db)
        client = app.test_client()

        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'student-1', 'active_membership_id': 'mem-s1'}

        resp = client.get('/api/teacher/classes/class-1/canvas/status')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
