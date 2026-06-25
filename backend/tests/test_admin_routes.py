import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.admin import create_admin_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


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


class FakeDb:
    """Fake DB covering admin blueprint needs: deletion requests, compliance, guardian packets."""

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
            'student-2': {
                'uid': 'student-2',
                'name': 'Student Two',
                'email': 'student2@school.test',
                'profile': {'display_name': 'Student Two', 'age': 17},
            },
        }
        self.student_compliance_records = {}
        self.consent_events_list = []
        self.consent_events = {}
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

    def create_enrollment(self, class_id, student_uid, student_membership_id='', join_source='', **_):
        enrollment_id = f'{class_id}_{student_uid}'
        self.enrollments[enrollment_id] = {
            'id': enrollment_id,
            'class_id': class_id,
            'student_uid': student_uid,
            'student_membership_id': student_membership_id,
            'join_source': join_source,
            'status': 'active',
            'created_at': datetime.now(UTC).isoformat(),
        }
        return enrollment_id

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
        memberships.sort(key=lambda item: item['id'])
        active_membership_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active = next(
            (m for m in memberships if m['id'] == active_membership_id),
            memberships[0] if memberships else None,
        )
        return {
            'memberships': memberships,
            'active_membership': active,
            'active_membership_id': active['id'] if active else None,
            'active_organization_id': active['orgId'] if active else None,
            'active_roles': active['roles'] if active else [],
        }

    # -- Classes & enrollments --

    def list_org_classes(self, org_id, status='active'):
        return [
            dict(c) for c in self.classes.values()
            if c.get('org_id') == org_id and (not status or c.get('status') == status)
        ]

    def list_class_enrollments(self, class_id, status='active'):
        return [
            dict(e) for e in self.enrollments.values()
            if e.get('class_id') == class_id and (not status or e.get('status') == status)
        ]

    # -- Compliance records --

    def get_student_compliance_record(self, org_id, student_uid):
        r = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(r) if r else None

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        rid = f'{org_id}_{student_uid}'
        self.student_compliance_records[rid] = {'id': rid, **record}
        return rid

    def list_org_student_compliance_records(self, org_id):
        return [
            dict(r) for r in self.student_compliance_records.values()
            if r.get('org_id') == org_id
        ]

    # -- Consent events --

    def create_consent_event(self, **payload):
        self.consent_events_list.append(dict(payload))
        event_id = f'event-{len(self.consent_events_list)}'
        self.consent_events[event_id] = {'id': event_id, **payload}
        return event_id

    def list_consent_events(self, org_id, limit=500):
        return [e for e in self.consent_events_list if e.get('org_id') == org_id][:limit]

    # -- Guardian consent packets --

    def list_org_guardian_consent_packets(self, org_id, limit=1000):
        return [
            dict(p) for p in self.guardian_consent_packets.values()
            if p.get('org_id') == org_id
        ][:limit]

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
        return [
            dict(r) for r in self.deletion_execution_runs.values()
            if r['request_id'] == request_id
        ][:limit]

    # -- Firestore collection emulation for _perform_deletion --

    def get_db(self):
        return self

    def collection(self, name):
        return FakeCollection(self, name)


class TestAdminRoutes(unittest.TestCase):
    """Route-level tests for the admin blueprint (deletion requests + compliance)."""

    def setUp(self):
        self.db = FakeDb()

        # Create org, admin, teacher, class, and student enrollment
        self.org_id = self.db.create_organization('Test School')
        self.admin_mem_id = self.db.create_membership(self.org_id, 'admin-1', ['school_admin'])
        self.teacher_mem_id = self.db.create_membership(self.org_id, 'teacher-1', ['teacher'])
        self.db.set_user_last_active_membership('admin-1', self.admin_mem_id)
        self.db.set_user_last_active_membership('teacher-1', self.teacher_mem_id)

        self.class_id = self.db.create_class(self.org_id, 'Korean 101', teacher_membership_ids=[self.teacher_mem_id])
        self.db.create_enrollment(self.class_id, 'student-1')
        self.db.create_enrollment(self.class_id, 'student-2')

        # Seed compliance records for students
        self.db.upsert_student_compliance_record(self.org_id, 'student-1', {
            'org_id': self.org_id,
            'student_uid': 'student-1',
            'is_minor': True,
            'guardian_consent_status': 'granted',
            'voice_consent_status': 'granted',
            'text_allowed': True,
            'retention_policy_id': 'standard_school',
        })
        self.db.upsert_student_compliance_record(self.org_id, 'student-2', {
            'org_id': self.org_id,
            'student_uid': 'student-2',
            'is_minor': True,
            'guardian_consent_status': 'unknown',
            'voice_consent_status': 'unknown',
            'text_allowed': True,
            'retention_policy_id': 'standard_school',
        })

        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'
        self.app.config['TESTING'] = True

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            context = resolve_school_request_context(
                self.db, uid, preferred_active_membership_id=preferred,
            )
            if 'user' in session:
                session['user']['active_membership_id'] = context.active_membership_id
            self.db.set_user_last_active_membership(uid, context.active_membership_id)
            return context

        deps = RouteDeps(
            db=self.db,
            firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None,
            get_assessment=lambda: {},
            compute_results=lambda *_a, **_kw: {},
            get_proficiency_description=lambda *_a, **_kw: {},
            login_required=passthrough_login_required,
            get_user_proficiency_context=lambda **_: '',
            build_system_prompt=lambda _: '',
            get_school_request_context=get_school_request_context,
            set_active_school_membership=lambda _: None,
            allowed_learning_locales={'ko-KR'},
            allowed_minigame_types=set(),
            supported_ui_languages={'en'},
        )

        self.app.register_blueprint(create_admin_blueprint(deps))

    def _admin_session(self, client):
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'admin-1',
                'email': 'admin@school.test',
                'name': 'Admin User',
                'active_membership_id': self.admin_mem_id,
            }

    def _teacher_session(self, client):
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'teacher-1',
                'email': 'teacher@school.test',
                'name': 'Teacher User',
                'active_membership_id': self.teacher_mem_id,
            }

    # ── Deletion request endpoints ───────────────────────────────

    def test_list_deletion_requests_empty(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/deletion-requests')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['requests'], [])

    def test_create_deletion_request(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student',
                'scopeId': 'student-1',
                'requestReason': 'Parent COPPA request',
            })
            self.assertEqual(resp.status_code, 201)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['scopeType'], 'student')
            self.assertEqual(data['request']['scopeId'], 'student-1')
            self.assertEqual(data['request']['status'], 'requested')

            # Verify it shows up in the list
            resp2 = client.get('/api/admin/deletion-requests')
            self.assertEqual(len(resp2.get_json()['requests']), 1)

    def test_create_deletion_request_missing_fields(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={})
            self.assertEqual(resp.status_code, 400)
            self.assertFalse(resp.get_json()['success'])

    def test_approve_deletion_request(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-1',
            })
            request_id = resp.get_json()['request']['id']

            resp2 = client.post(f'/api/admin/deletion-requests/{request_id}/approve', json={
                'reviewNotes': 'Verified parent request',
            })
            self.assertEqual(resp2.status_code, 200)
            data = resp2.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'approved')

    def test_reject_deletion_request(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-1',
            })
            request_id = resp.get_json()['request']['id']

            resp2 = client.post(f'/api/admin/deletion-requests/{request_id}/reject', json={
                'reviewNotes': 'Denied - not needed',
            })
            self.assertEqual(resp2.status_code, 200)
            data = resp2.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'rejected')

    def test_execute_deletion_request(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            # Create and approve
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-1',
            })
            request_id = resp.get_json()['request']['id']
            client.post(f'/api/admin/deletion-requests/{request_id}/approve', json={})

            # Execute
            resp2 = client.post(f'/api/admin/deletion-requests/{request_id}/execute')
            self.assertEqual(resp2.status_code, 200)
            data = resp2.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'completed')
            self.assertEqual(data['run']['status'], 'completed')

    def test_get_deletion_request_detail(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'class', 'scopeId': self.class_id,
            })
            request_id = resp.get_json()['request']['id']

            resp2 = client.get(f'/api/admin/deletion-requests/{request_id}')
            self.assertEqual(resp2.status_code, 200)
            data = resp2.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['id'], request_id)
            self.assertIn('runs', data)

    def test_get_deletion_request_not_found(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/deletion-requests/nonexistent')
            self.assertEqual(resp.status_code, 404)

    # ── Compliance endpoints ─────────────────────────────────────

    def test_compliance_summary(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/compliance/summary')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            summary = data['summary']
            self.assertEqual(summary['studentCount'], 2)
            # Pilot override: every student is voiceAllowed regardless of consent,
            # so voiceBlockedCount is always 0 under the current config.
            self.assertEqual(summary['voiceAllowedCount'], 2)
            self.assertEqual(summary['voiceBlockedCount'], 0)

    @patch('backend.routes.admin.log_disclosure_if_new')
    def test_compliance_roster(self, _mock_log):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/compliance/roster')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertIn('summary', data)
            self.assertIn('students', data)
            self.assertEqual(len(data['students']), 2)

            # Verify student structure
            student_uids = {s['uid'] for s in data['students']}
            self.assertIn('student-1', student_uids)
            self.assertIn('student-2', student_uids)

            for student in data['students']:
                self.assertIn('displayName', student)
                self.assertIn('compliance', student)
                self.assertIn('blockedReasons', student)
                self.assertIn('classIds', student)

    @patch('backend.routes.admin.log_disclosure_if_new')
    def test_compliance_roster_filter_by_class(self, _mock_log):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get(f'/api/admin/compliance/roster?classId={self.class_id}')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(len(data['students']), 2)

    @patch('backend.routes.admin.log_disclosure_if_new')
    def test_compliance_roster_filter_voice_blocked(self, _mock_log):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/compliance/roster?consentStatus=voice_blocked')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            # Pilot override: voiceAllowed is always True, so the voice_blocked
            # filter returns an empty roster.
            self.assertEqual(len(data['students']), 0)

    def test_bulk_update_compliance(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.put('/api/admin/compliance/bulk-update', json={
                'studentUids': ['student-2'],
                'updates': {
                    'voiceConsentStatus': 'granted',
                    'guardianConsentStatus': 'granted',
                },
                'reason': 'Guardian forms received',
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['updatedCount'], 1)
            self.assertIn('student-2', data['studentUids'])

            # Verify the record was updated
            record = self.db.get_student_compliance_record(self.org_id, 'student-2')
            self.assertIsNotNone(record)
            self.assertEqual(record.get('voice_consent_status'), 'granted')
            self.assertEqual(record.get('guardian_consent_status'), 'granted')

    def test_bulk_update_compliance_missing_student_uids(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.put('/api/admin/compliance/bulk-update', json={
                'updates': {'voiceConsentStatus': 'granted'},
            })
            self.assertEqual(resp.status_code, 400)

    def test_bulk_update_compliance_no_updates(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.put('/api/admin/compliance/bulk-update', json={
                'studentUids': ['student-1'],
                'updates': {},
            })
            self.assertEqual(resp.status_code, 400)

    def test_bulk_update_compliance_unknown_student(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.put('/api/admin/compliance/bulk-update', json={
                'studentUids': ['nonexistent-student'],
                'updates': {'voiceConsentStatus': 'granted'},
            })
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertIn('nonexistent-student', data.get('missingStudentUids', []))

    def test_audit_export_returns_csv(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            # Seed a consent event so export has data
            self.db.create_consent_event(
                org_id=self.org_id,
                student_uid='student-1',
                scope_type='student',
                scope_id='student-1',
                event_type='consent.voice_granted',
                actor_type='teacher',
                actor_id='teacher-1',
                payload={'source': 'manual'},
            )

            resp = client.get('/api/admin/compliance/audit-export')
            self.assertEqual(resp.status_code, 200)
            self.assertIn('text/csv', resp.content_type)
            self.assertIn('attachment', resp.headers.get('Content-Disposition', ''))

            csv_text = resp.data.decode('utf-8')
            # Verify CSV header row
            self.assertIn('created_at', csv_text)
            self.assertIn('event_type', csv_text)
            self.assertIn('student_uid', csv_text)
            # Verify the seeded event is present
            self.assertIn('consent.voice_granted', csv_text)

    def test_guardian_packets_empty(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.get('/api/admin/compliance/guardian-packets')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['packets'], [])
            self.assertEqual(data['totalCount'], 0)

    # ── Access control ───────────────────────────────────────────

    def test_teacher_blocked_from_admin_deletion_list(self):
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.get('/api/admin/deletion-requests')
            self.assertEqual(resp.status_code, 403)

    def test_teacher_blocked_from_compliance_summary(self):
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.get('/api/admin/compliance/summary')
            self.assertEqual(resp.status_code, 403)

    def test_teacher_blocked_from_compliance_roster(self):
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.get('/api/admin/compliance/roster')
            self.assertEqual(resp.status_code, 403)

    def test_teacher_blocked_from_bulk_update(self):
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.put('/api/admin/compliance/bulk-update', json={
                'studentUids': ['student-1'],
                'updates': {'voiceConsentStatus': 'granted'},
            })
            self.assertEqual(resp.status_code, 403)

    def test_teacher_blocked_from_audit_export(self):
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.get('/api/admin/compliance/audit-export')
            self.assertEqual(resp.status_code, 403)

    def test_teacher_can_create_student_deletion_request(self):
        """Teachers can create student-scope deletion requests (admin_or_teacher gate)."""
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student',
                'scopeId': 'student-1',
                'requestReason': 'Parent request via teacher',
            })
            self.assertEqual(resp.status_code, 201)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['scopeType'], 'student')

    def test_teacher_cannot_approve_deletion_request(self):
        """Teachers cannot approve deletion requests (admin-only gate)."""
        # Create request as admin first
        with self.app.test_client() as client:
            self._admin_session(client)
            resp = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-1',
            })
            request_id = resp.get_json()['request']['id']

        # Try to approve as teacher
        with self.app.test_client() as client:
            self._teacher_session(client)
            resp = client.post(f'/api/admin/deletion-requests/{request_id}/approve', json={})
            self.assertEqual(resp.status_code, 403)

    def test_list_deletion_requests_with_status_filter(self):
        with self.app.test_client() as client:
            self._admin_session(client)
            # Create two requests
            client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-1',
            })
            resp2 = client.post('/api/admin/deletion-requests', json={
                'scopeType': 'student', 'scopeId': 'student-2',
            })
            request_id_2 = resp2.get_json()['request']['id']

            # Approve the second one
            client.post(f'/api/admin/deletion-requests/{request_id_2}/approve', json={})

            # Filter by approved status
            resp = client.get('/api/admin/deletion-requests?status=approved')
            data = resp.get_json()
            self.assertEqual(len(data['requests']), 1)
            self.assertEqual(data['requests'][0]['status'], 'approved')


if __name__ == '__main__':
    unittest.main()
