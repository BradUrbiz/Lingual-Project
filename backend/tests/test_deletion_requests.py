import unittest
from datetime import UTC, datetime

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.admin import create_admin_blueprint
from backend.services.deletion_requests import (
    DeletionRequestError,
    DeletionRequestNotFoundError,
    DeletionRequestStateError,
    approve_deletion_request,
    create_deletion_request,
    execute_deletion,
    reject_deletion_request,
    serialize_deletion_request,
    validate_requester_role,
    validate_scope,
)
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


class FakeDeletionDb:
    """Fake DB with the deletion-related methods plus enough school foundation for context."""

    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.users = {
            'admin-1': {
                'uid': 'admin-1',
                'name': 'Admin User',
                'email': 'admin@school.test',
                'profile': {'display_name': 'Admin User', 'age': 40},
            },
            'teacher-1': {
                'uid': 'teacher-1',
                'name': 'Teacher User',
                'email': 'teacher@school.test',
                'profile': {'display_name': 'Teacher User', 'age': 35},
            },
            'student-1': {
                'uid': 'student-1',
                'name': 'Student One',
                'email': 'student1@school.test',
                'profile': {'display_name': 'Student One', 'age': 15},
            },
        }
        self.student_compliance_records = {}
        self.consent_events_list = []  # list form for create_consent_event
        self.consent_events = {}  # dict form for Firestore collection queries
        self.deletion_requests = {}
        self.deletion_execution_runs = {}
        self.practice_sessions = {}
        self.learning_events = {}
        self.guardian_consent_packets = {}
        self.user_active_memberships = {}
        self.org_counter = 0
        self.membership_counter = 0
        self.class_counter = 0
        self.deletion_request_counter = 0
        self.deletion_run_counter = 0

    # -- Core helpers --

    def set_user_last_active_membership(self, uid, membership_id):
        self.user_active_memberships[uid] = membership_id

    def get_user(self, uid):
        return self.users.get(uid)

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def create_organization(self, name, org_type='school', status='active', pilot_stage='beta', **_):
        self.org_counter += 1
        org_id = f'org-{self.org_counter}'
        self.organizations[org_id] = {'id': org_id, 'name': name, 'type': org_type, 'status': status}
        return org_id

    def create_membership(self, org_id, uid, roles, status='active', primary_class_ids=None, membership_id=None):
        self.membership_counter += 1
        membership_id = membership_id or f'mem-{self.membership_counter}'
        self.memberships[membership_id] = {
            'id': membership_id, 'orgId': org_id, 'uid': uid,
            'roles': list(roles), 'status': status,
            'primaryClassIds': list(primary_class_ids or []),
        }
        return membership_id

    def create_class(self, org_id, name, teacher_membership_ids=None, class_id=None, **_):
        self.class_counter += 1
        class_id = class_id or f'class-{self.class_counter}'
        self.classes[class_id] = {
            'id': class_id, 'org_id': org_id, 'name': name,
            'teacher_membership_ids': list(teacher_membership_ids or []),
            'status': 'active',
        }
        return class_id

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        memberships = []
        for m in self.memberships.values():
            if m['uid'] != uid or m['status'] != 'active':
                continue
            org = self.organizations.get(m['orgId']) or {}
            memberships.append({
                'id': m['id'], 'orgId': m['orgId'], 'orgName': org.get('name', ''),
                'orgType': org.get('type'), 'roles': m['roles'], 'status': m['status'],
                'primaryClassIds': m.get('primaryClassIds', []),
            })
        active_membership_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active = next((m for m in memberships if m['id'] == active_membership_id), memberships[0] if memberships else None)
        return {
            'memberships': memberships,
            'active_membership': active,
            'active_membership_id': active['id'] if active else None,
            'active_organization_id': active['orgId'] if active else None,
            'active_roles': active['roles'] if active else [],
        }

    # -- Consent --

    def get_student_compliance_record(self, org_id, student_uid):
        r = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(r) if r else None

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        rid = f'{org_id}_{student_uid}'
        self.student_compliance_records[rid] = {'id': rid, **record}
        return rid

    def create_consent_event(self, **payload):
        self.consent_events_list.append(dict(payload))
        event_id = f'event-{len(self.consent_events_list)}'
        self.consent_events[event_id] = {
            'id': event_id,
            **payload,
        }
        return event_id

    def list_consent_events(self, org_id, limit=500):
        return [e for e in self.consent_events_list if e.get('org_id') == org_id][:limit]

    # -- Deletion requests --

    def create_deletion_request(self, *, org_id, scope_type, scope_id, requested_by_uid, request_reason=''):
        self.deletion_request_counter += 1
        rid = f'delreq-{self.deletion_request_counter}'
        self.deletion_requests[rid] = {
            'id': rid, 'org_id': org_id, 'scope_type': scope_type, 'scope_id': scope_id,
            'requested_by_uid': requested_by_uid, 'request_reason': request_reason,
            'status': 'requested', 'approved_by_uid': '', 'review_notes': '',
            'target_collections': [], 'target_storage_prefixes': [],
            'execution_summary': {},
            'created_at': datetime.now(UTC), 'updated_at': datetime.now(UTC), 'completed_at': None,
        }
        return rid

    def get_deletion_request(self, request_id):
        r = self.deletion_requests.get(request_id)
        return dict(r) if r else None

    def update_deletion_request(self, request_id, updates):
        self.deletion_requests[request_id].update(updates)
        return request_id

    def list_deletion_requests(self, org_id, status_filter=None, limit=100):
        results = [dict(r) for r in self.deletion_requests.values() if r['org_id'] == org_id]
        if status_filter:
            results = [r for r in results if r['status'] in status_filter]
        return results[:limit]

    # -- Deletion execution runs --

    def create_deletion_execution_run(self, *, request_id, org_id, scope_type, scope_id, attempt_number=1, run_id=None):
        self.deletion_run_counter += 1
        rid = run_id or f'delrun-{self.deletion_run_counter}'
        self.deletion_execution_runs[rid] = {
            'id': rid, 'request_id': request_id, 'org_id': org_id,
            'scope_type': scope_type, 'scope_id': scope_id,
            'status': 'running', 'attempt_number': attempt_number,
            'firestore_counts': {'targeted': 0, 'deleted': 0, 'failed': 0, 'by_collection': {}},
            'storage_counts': {'targeted': 0, 'deleted': 0, 'failed': 0},
            'error_summary': [],
            'started_at': datetime.now(UTC), 'finished_at': None,
        }
        return rid

    def get_deletion_execution_run(self, run_id):
        r = self.deletion_execution_runs.get(run_id)
        return dict(r) if r else None

    def update_deletion_execution_run(self, run_id, updates):
        self.deletion_execution_runs[run_id].update(updates)
        return run_id

    def list_deletion_execution_runs(self, request_id, limit=20):
        return [dict(r) for r in self.deletion_execution_runs.values() if r['request_id'] == request_id][:limit]

    # -- Practice sessions / learning events (for deletion targets) --

    def get_db(self):
        return self

    def collection(self, name):
        return FakeCollection(self, name)


class FakeDocSnapshot:
    def __init__(self, doc_id, data, ref):
        self.id = doc_id
        self._data = data
        self.reference = ref
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDocRef:
    def __init__(self, fake_db, collection_name, doc_id):
        self._fake_db = fake_db
        self._collection_name = collection_name
        self._doc_id = doc_id

    def get(self):
        store = self._get_store()
        data = store.get(self._doc_id)
        return FakeDocSnapshot(self._doc_id, data, self)

    def delete(self):
        store = self._get_store()
        store.pop(self._doc_id, None)

    def _get_store(self):
        return getattr(self._fake_db, self._collection_name, {})


class FakeCollection:
    def __init__(self, fake_db, name):
        self._fake_db = fake_db
        self._name = name

    def document(self, doc_id):
        return FakeDocRef(self._fake_db, self._name, doc_id)

    def where(self, field, op, value):
        return FakeQuery(self._fake_db, self._name, [(field, op, value)])


class FakeQuery:
    def __init__(self, fake_db, collection_name, filters):
        self._fake_db = fake_db
        self._collection_name = collection_name
        self._filters = filters

    def where(self, field, op, value):
        return FakeQuery(self._fake_db, self._collection_name, self._filters + [(field, op, value)])

    def stream(self):
        store = getattr(self._fake_db, self._collection_name, {})
        results = []
        for doc_id, data in store.items():
            if self._matches(data):
                ref = FakeDocRef(self._fake_db, self._collection_name, doc_id)
                results.append(FakeDocSnapshot(doc_id, data, ref))
        return results

    def _matches(self, data):
        for field, op, value in self._filters:
            actual = data.get(field) if isinstance(data, dict) else None
            if op == '==' and actual != value:
                return False
            if op == 'in' and actual not in value:
                return False
        return True


class FakeRouteDeps:
    def __init__(self, fake_db, current_uid='admin-1'):
        self.db = fake_db
        self._current_uid = current_uid

    def get_school_request_context(self):
        school_context = self.db.resolve_user_school_context(self._current_uid)
        return resolve_school_request_context(self.db, self._current_uid)

    @property
    def login_required(self):
        return passthrough_login_required

    def get_current_user_uid(self):
        return self._current_uid


class TestDeletionRequestServiceUnit(unittest.TestCase):
    """Unit tests for the deletion request service layer."""

    def setUp(self):
        self.db = FakeDeletionDb()
        self.org_id = self.db.create_organization('Test School')
        self.admin_mem_id = self.db.create_membership(self.org_id, 'admin-1', ['school_admin'])
        self.teacher_mem_id = self.db.create_membership(self.org_id, 'teacher-1', ['teacher'])
        self.db.set_user_last_active_membership('admin-1', self.admin_mem_id)
        self.db.set_user_last_active_membership('teacher-1', self.teacher_mem_id)
        self.deps = FakeRouteDeps(self.db, current_uid='admin-1')

    def test_validate_scope_valid(self):
        validate_scope('student', 'student-1')
        validate_scope('class', 'class-1')
        validate_scope('org', 'org-1')

    def test_validate_scope_invalid(self):
        with self.assertRaises(DeletionRequestError):
            validate_scope('invalid', 'id')
        with self.assertRaises(DeletionRequestError):
            validate_scope('student', '')

    def test_validate_requester_role_student_scope(self):
        validate_requester_role('student', {'teacher'})
        validate_requester_role('student', {'school_admin'})
        with self.assertRaises(DeletionRequestError):
            validate_requester_role('student', {'student'})

    def test_validate_requester_role_org_scope(self):
        validate_requester_role('org', {'school_admin'})
        with self.assertRaises(DeletionRequestError):
            validate_requester_role('org', {'teacher'})

    def test_create_request(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='admin-1',
            request_reason='Parent request',
            actor_roles={'school_admin'},
        )
        self.assertEqual(request['status'], 'requested')
        self.assertEqual(request['scope_type'], 'student')
        self.assertEqual(request['scope_id'], 'student-1')
        # Should have emitted a consent event
        self.assertTrue(any(e['event_type'] == 'deletion.requested' for e in self.db.consent_events_list))

    def test_teacher_cannot_request_org_scope(self):
        with self.assertRaises(DeletionRequestError):
            create_deletion_request(
                self.deps,
                org_id=self.org_id,
                scope_type='org',
                scope_id=self.org_id,
                requested_by_uid='teacher-1',
                actor_roles={'teacher'},
            )

    def test_approve_request(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='teacher-1',
            actor_roles={'teacher'},
        )
        approved = approve_deletion_request(
            self.deps,
            request_id=request['id'],
            approved_by_uid='admin-1',
            review_notes='Verified parent request',
        )
        self.assertEqual(approved['status'], 'approved')
        self.assertEqual(approved['approved_by_uid'], 'admin-1')
        self.assertTrue(any(e['event_type'] == 'deletion.approved' for e in self.db.consent_events_list))

    def test_approve_non_requested_fails(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='admin-1',
            actor_roles={'school_admin'},
        )
        approve_deletion_request(self.deps, request_id=request['id'], approved_by_uid='admin-1')
        with self.assertRaises(DeletionRequestStateError):
            approve_deletion_request(self.deps, request_id=request['id'], approved_by_uid='admin-1')

    def test_reject_request(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='teacher-1',
            actor_roles={'teacher'},
        )
        rejected = reject_deletion_request(
            self.deps,
            request_id=request['id'],
            rejected_by_uid='admin-1',
            review_notes='Not needed',
        )
        self.assertEqual(rejected['status'], 'rejected')
        self.assertTrue(any(e['event_type'] == 'deletion.rejected' for e in self.db.consent_events_list))

    def test_not_found_raises(self):
        with self.assertRaises(DeletionRequestNotFoundError):
            approve_deletion_request(self.deps, request_id='nonexistent', approved_by_uid='admin-1')

    def test_serialize_deletion_request(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='admin-1',
            actor_roles={'school_admin'},
        )
        serialized = serialize_deletion_request(request)
        self.assertEqual(serialized['scopeType'], 'student')
        self.assertEqual(serialized['scopeId'], 'student-1')
        self.assertEqual(serialized['status'], 'requested')
        self.assertIn('createdAt', serialized)

    def test_execute_student_scope_deletion(self):
        # Seed some practice data
        self.db.practice_sessions['ps-1'] = {
            'id': 'ps-1', 'org_id': self.org_id, 'student_uid': 'student-1',
            'class_id': 'class-1', 'assignment_id': 'a-1',
        }
        self.db.learning_events['le-1'] = {
            'id': 'le-1', 'org_id': self.org_id, 'student_uid': 'student-1',
            'class_id': 'class-1', 'session_id': 'ps-1',
        }
        self.db.student_compliance_records[f'{self.org_id}_student-1'] = {
            'id': f'{self.org_id}_student-1', 'org_id': self.org_id, 'student_uid': 'student-1',
        }

        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='admin-1',
            actor_roles={'school_admin'},
        )
        approve_deletion_request(self.deps, request_id=request['id'], approved_by_uid='admin-1')
        updated_request, run = execute_deletion(
            self.deps, request_id=request['id'], executor_uid='admin-1',
        )

        self.assertEqual(updated_request['status'], 'completed')
        self.assertEqual(run['status'], 'completed')
        # Verify data was deleted
        self.assertNotIn('ps-1', self.db.practice_sessions)
        self.assertNotIn('le-1', self.db.learning_events)
        self.assertNotIn(f'{self.org_id}_student-1', self.db.student_compliance_records)

    def test_execute_requires_approved_status(self):
        request = create_deletion_request(
            self.deps,
            org_id=self.org_id,
            scope_type='student',
            scope_id='student-1',
            requested_by_uid='admin-1',
            actor_roles={'school_admin'},
        )
        with self.assertRaises(DeletionRequestStateError):
            execute_deletion(self.deps, request_id=request['id'], executor_uid='admin-1')


class TestDeletionRequestRoutes(unittest.TestCase):
    """Route-level tests for the admin deletion API."""

    def setUp(self):
        self.db = FakeDeletionDb()
        self.org_id = self.db.create_organization('Test School')
        self.admin_mem_id = self.db.create_membership(self.org_id, 'admin-1', ['school_admin'])
        self.teacher_mem_id = self.db.create_membership(self.org_id, 'teacher-1', ['teacher'])
        self.db.set_user_last_active_membership('admin-1', self.admin_mem_id)
        self.db.set_user_last_active_membership('teacher-1', self.teacher_mem_id)

        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'
        self.app.config['TESTING'] = True

        deps = RouteDeps(
            db=self.db,
            firebase_auth=None,
            get_current_user_uid=lambda: 'admin-1',
            get_openai_client=lambda: None,
            get_assessment=lambda: {},
            compute_results=lambda _a, _b: {},
            get_proficiency_description=lambda *_: {},
            login_required=passthrough_login_required,
            get_user_proficiency_context=lambda: '',
            build_system_prompt=lambda _: '',
            load_sample_curriculum_package=lambda: {},
            get_curriculum_practice_context=lambda *_: None,
            build_curriculum_system_prompt=lambda *_: '',
            get_school_request_context=lambda: resolve_school_request_context(self.db, 'admin-1'),
            set_active_school_membership=lambda _: None,
            allowed_learning_locales={'ko-KR'},
            allowed_minigame_types=set(),
            supported_ui_languages={'en'},
        )
        self.app.register_blueprint(create_admin_blueprint(deps))
        self.client = self.app.test_client()

    def test_list_empty(self):
        resp = self.client.get('/api/admin/deletion-requests')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['requests'], [])

    def test_create_and_list(self):
        resp = self.client.post('/api/admin/deletion-requests', json={
            'scopeType': 'student',
            'scopeId': 'student-1',
            'requestReason': 'COPPA deletion',
        })
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['request']['scopeType'], 'student')

        resp = self.client.get('/api/admin/deletion-requests')
        data = resp.get_json()
        self.assertEqual(len(data['requests']), 1)

    def test_approve_and_execute(self):
        # Create
        resp = self.client.post('/api/admin/deletion-requests', json={
            'scopeType': 'student', 'scopeId': 'student-1',
        })
        request_id = resp.get_json()['request']['id']

        # Approve
        resp = self.client.post(f'/api/admin/deletion-requests/{request_id}/approve', json={
            'reviewNotes': 'OK',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['request']['status'], 'approved')

        # Execute
        resp = self.client.post(f'/api/admin/deletion-requests/{request_id}/execute')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['request']['status'], 'completed')
        self.assertEqual(data['run']['status'], 'completed')

    def test_reject(self):
        resp = self.client.post('/api/admin/deletion-requests', json={
            'scopeType': 'student', 'scopeId': 'student-1',
        })
        request_id = resp.get_json()['request']['id']

        resp = self.client.post(f'/api/admin/deletion-requests/{request_id}/reject', json={
            'reviewNotes': 'Denied',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['request']['status'], 'rejected')

    def test_get_detail(self):
        resp = self.client.post('/api/admin/deletion-requests', json={
            'scopeType': 'class', 'scopeId': 'class-1',
        })
        request_id = resp.get_json()['request']['id']

        resp = self.client.get(f'/api/admin/deletion-requests/{request_id}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['request']['id'], request_id)
        self.assertIn('runs', data)

    def test_not_found(self):
        resp = self.client.get('/api/admin/deletion-requests/nonexistent')
        self.assertEqual(resp.status_code, 404)

    def test_missing_fields(self):
        resp = self.client.post('/api/admin/deletion-requests', json={})
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main()
