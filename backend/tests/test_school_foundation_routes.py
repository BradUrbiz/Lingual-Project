import unittest
import secrets
from datetime import UTC, datetime, timedelta

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.guardian import create_guardian_blueprint
from backend.routes.schools import create_schools_blueprint
from backend.routes.teacher import create_teacher_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


class FakeSchoolDb:
    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.users = {
            'teacher-1': {
                'uid': 'teacher-1',
                'name': 'Teacher User',
                'email': 'teacher@example.com',
                'profile': {'display_name': 'Teacher User', 'age': 32},
            },
            'student-1': {
                'uid': 'student-1',
                'name': 'Student One',
                'email': 'student1@example.com',
                'profile': {'display_name': 'Student One', 'age': 16},
            },
            'student-2': {
                'uid': 'student-2',
                'name': 'Student Two',
                'email': 'student2@example.com',
                'profile': {'display_name': 'Student Two', 'age': 17},
            },
        }
        self.student_compliance_records = {}
        self.guardian_packets = {}
        self.consent_events = []
        self.user_active_memberships = {}
        self.updated_profiles = []
        self.org_counter = 0
        self.membership_counter = 0
        self.class_counter = 0
        self.guardian_packet_counter = 0

    def set_user_last_active_membership(self, uid, membership_id):
        self.user_active_memberships[uid] = membership_id

    def create_organization(self, name, org_type='school', status='active', pilot_stage='beta', **_kwargs):
        self.org_counter += 1
        org_id = f'org-{self.org_counter}'
        self.organizations[org_id] = {
            'id': org_id,
            'name': name,
            'type': org_type,
            'status': status,
            'pilot_stage': pilot_stage,
        }
        return org_id

    def create_membership(self, org_id, uid, roles, status='active', primary_class_ids=None, membership_id=None):
        self.membership_counter += 1
        membership_id = membership_id or f'mem-{self.membership_counter}'
        self.memberships[membership_id] = {
            'id': membership_id,
            'orgId': org_id,
            'roles': list(roles),
            'uid': uid,
            'status': status,
            'primaryClassIds': list(primary_class_ids or []),
        }
        return membership_id

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        memberships = []
        for membership in self.memberships.values():
            if membership.get('uid') != uid or membership.get('status') not in {'active', 'invited'}:
                continue
            org = self.organizations.get(membership.get('orgId')) or {}
            memberships.append({
                'id': membership['id'],
                'orgId': membership['orgId'],
                'orgName': org.get('name', ''),
                'orgType': org.get('type'),
                'roles': membership.get('roles', []),
                'status': membership.get('status', 'active'),
                'primaryClassIds': membership.get('primaryClassIds', []),
            })

        memberships.sort(key=lambda item: item['id'])
        active_membership_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active_membership = next(
            (membership for membership in memberships if membership['id'] == active_membership_id),
            memberships[0] if memberships else None,
        )

        return {
            'memberships': memberships,
            'active_membership': active_membership,
            'active_membership_id': active_membership.get('id') if active_membership else None,
            'active_organization_id': active_membership.get('orgId') if active_membership else None,
            'active_roles': active_membership.get('roles', []) if active_membership else [],
        }

    def create_class(
        self,
        org_id,
        name,
        learning_locale='ko-KR',
        term='',
        subject='',
        teacher_membership_ids=None,
        grade_band='',
        status='active',
        class_id=None,
    ):
        self.class_counter += 1
        class_id = class_id or f'class-{self.class_counter}'
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
            'created_at': None,
            'updated_at': None,
        }
        return class_id

    def add_primary_class_to_membership(self, membership_id, class_id):
        membership = self.memberships[membership_id]
        if class_id not in membership['primaryClassIds']:
            membership['primaryClassIds'].append(class_id)

    def update_user_profile(self, uid, school_name=None, **_kwargs):
        self.updated_profiles.append((uid, school_name))

    def get_user(self, uid):
        return self.users.get(uid)

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def list_class_enrollments(self, class_id):
        return [
            dict(enrollment)
            for enrollment in self.enrollments.values()
            if enrollment.get('class_id') == class_id and enrollment.get('status') == 'active'
        ]

    def get_student_class_enrollment(self, class_id, student_uid):
        enrollment = self.enrollments.get(f'{class_id}_{student_uid}')
        return dict(enrollment) if enrollment else None

    def get_student_compliance_record(self, org_id, student_uid):
        record = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        record_id = f'{org_id}_{student_uid}'
        self.student_compliance_records[record_id] = {
            'id': record_id,
            **record,
        }
        return record_id

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'event-{len(self.consent_events)}'

    def list_consent_events(self, org_id, limit=500):
        events = [dict(event) for event in self.consent_events if event.get('org_id') == org_id]
        return list(reversed(events))[:limit]

    def create_guardian_consent_packet(self, **payload):
        self.guardian_packet_counter += 1
        packet_id = payload.get('packet_id') or f'packet-{self.guardian_packet_counter}'
        self.guardian_packets[packet_id] = {
            'id': packet_id,
            **payload,
            'created_at': payload.get('created_at'),
            'updated_at': payload.get('updated_at'),
        }
        return packet_id

    def get_guardian_consent_packet(self, packet_id):
        packet = self.guardian_packets.get(packet_id)
        return dict(packet) if packet else None

    def update_guardian_consent_packet(self, packet_id, updates):
        self.guardian_packets[packet_id].update(dict(updates))
        return packet_id

    def list_class_guardian_consent_packets(self, class_id, student_uid=None, limit=500):
        packets = [
            dict(packet)
            for packet in self.guardian_packets.values()
            if packet.get('class_id') == class_id and (not student_uid or packet.get('student_uid') == student_uid)
        ]
        packets.sort(key=lambda packet: packet.get('id', ''), reverse=True)
        return packets[:limit]

    def find_guardian_consent_packet_by_token_hash(self, token_hash):
        for packet in self.guardian_packets.values():
            if packet.get('token_hash') == token_hash:
                return dict(packet)
        return None

    def generate_class_join_code(self, class_id):
        alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
        code = ''.join(secrets.choice(alphabet) for _ in range(6))
        if class_id in self.classes:
            self.classes[class_id]['join_code'] = code
            self.classes[class_id]['join_code_active'] = True
            self.classes[class_id]['join_code_generated_at'] = datetime.now(UTC).isoformat()
        return code

    def deactivate_class_join_code(self, class_id):
        if class_id in self.classes:
            self.classes[class_id]['join_code_active'] = False

    def get_class_by_join_code(self, code):
        for class_record in self.classes.values():
            if (
                class_record.get('join_code') == code
                and class_record.get('join_code_active')
                and class_record.get('status') == 'active'
            ):
                return dict(class_record)
        return None

    def get_membership(self, membership_id):
        return self.memberships.get(membership_id)

    def create_enrollment(self, class_id, student_uid, student_membership_id='', join_source='', **_kwargs):
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

    def deactivate_enrollment(self, class_id, student_uid):
        enrollment_id = f'{class_id}_{student_uid}'
        if enrollment_id in self.enrollments:
            self.enrollments[enrollment_id]['status'] = 'inactive'

    def reactivate_enrollment(self, class_id, student_uid):
        enrollment_id = f'{class_id}_{student_uid}'
        if enrollment_id in self.enrollments:
            self.enrollments[enrollment_id]['status'] = 'active'

    def list_class_assignments(self, class_id):
        return []

    def list_org_classes(self, org_id, status='active'):
        return [
            dict(class_record)
            for class_record in self.classes.values()
            if class_record.get('org_id') == org_id and (not status or class_record.get('status') == status)
        ]

    def list_teacher_classes(self, membership_id, status='active'):
        return [
            dict(class_record)
            for class_record in self.classes.values()
            if membership_id in class_record.get('teacher_membership_ids', [])
            and (not status or class_record.get('status') == status)
        ]


class SchoolFoundationRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakeSchoolDb()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            context = resolve_school_request_context(
                self.fake_db,
                uid,
                preferred_active_membership_id=preferred,
            )
            if 'user' in session:
                session['user']['active_membership_id'] = context.active_membership_id
            self.fake_db.set_user_last_active_membership(uid, context.active_membership_id)
            return context

        def set_active_school_membership(membership_id):
            uid = (session.get('user') or {}).get('uid')
            context = resolve_school_request_context(
                self.fake_db,
                uid,
                preferred_active_membership_id=membership_id,
            )
            if context.active_membership_id != membership_id:
                raise LookupError('Membership not found for the current user.')
            session['user']['active_membership_id'] = context.active_membership_id
            self.fake_db.set_user_last_active_membership(uid, membership_id)
            return context

        deps = RouteDeps(
            db=self.fake_db,
            firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None,
            get_assessment=lambda: {},
            compute_results=lambda *_args, **_kwargs: {},
            get_proficiency_description=lambda *_args, **_kwargs: {
                'level': 'Novice Mid',
                'description': 'Test level',
            },
            login_required=passthrough_login_required,
            get_user_proficiency_context=lambda: '',
            build_system_prompt=lambda _context: '',
            load_sample_curriculum_package=lambda: {},
            get_curriculum_practice_context=lambda **_kwargs: None,
            build_curriculum_system_prompt=lambda **_kwargs: '',
            get_school_request_context=get_school_request_context,
            set_active_school_membership=set_active_school_membership,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_schools_blueprint(deps))
        self.app.register_blueprint(create_guardian_blueprint(deps))
        self.app.register_blueprint(create_teacher_blueprint(deps))
        self.client = self.app.test_client()

        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'teacher-1',
                'email': 'teacher@example.com',
                'name': 'Teacher User',
                'active_membership_id': None,
            }

    def test_school_onboarding_bootstraps_org_membership_and_class(self):
        response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })

        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['school']['activeRoles'], ['school_admin', 'teacher'])
        self.assertEqual(payload['school']['teacherClasses'][0]['name'], 'Spanish 1 - Period 2')
        self.assertEqual(payload['createdClass']['learningLocale'], 'es-ES')
        self.assertEqual(self.fake_db.updated_profiles, [('teacher-1', 'Lingual Academy')])

    def test_teacher_dashboard_and_class_creation_use_school_context(self):
        self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })

        create_class_response = self.client.post('/api/teacher/classes', json={
            'name': 'Spanish 2 - Period 4',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '10-11',
            'learningLocale': 'es-ES',
        })
        self.assertEqual(create_class_response.status_code, 201)

        classes_response = self.client.get('/api/teacher/classes')
        self.assertEqual(classes_response.status_code, 200)
        classes_payload = classes_response.get_json()
        self.assertEqual(len(classes_payload['classes']), 2)

        dashboard_response = self.client.get('/api/teacher/dashboard')
        self.assertEqual(dashboard_response.status_code, 200)
        dashboard_payload = dashboard_response.get_json()['dashboard']
        self.assertEqual(dashboard_payload['summary']['classCount'], 2)
        self.assertIn('Create school workspace', [item['title'] for item in dashboard_payload['setupChecklist']])

    def test_teacher_can_review_and_update_student_compliance(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        created_class = onboarding_response.get_json()['createdClass']
        class_id = created_class['id']
        org_id = onboarding_response.get_json()['school']['activeOrganizationId']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
        }

        get_response = self.client.get(f'/api/teacher/classes/{class_id}/students/student-1/compliance')
        self.assertEqual(get_response.status_code, 200)
        self.assertFalse(get_response.get_json()['compliance']['voiceAllowed'])

        update_response = self.client.put(
            f'/api/teacher/classes/{class_id}/students/student-1/compliance',
            json={
                'isMinor': True,
                'guardianConsentStatus': 'granted',
                'voiceConsentStatus': 'granted',
                'textAllowed': True,
                'retentionPolicyId': 'no_raw_audio',
            },
        )
        self.assertEqual(update_response.status_code, 200)
        compliance = update_response.get_json()['compliance']
        self.assertTrue(compliance['voiceAllowed'])
        self.assertEqual(compliance['retentionPolicyId'], 'no_raw_audio')
        self.assertEqual(self.fake_db.student_compliance_records[f'{org_id}_student-1']['voice_consent_status'], 'granted')
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'consent.updated')

    def test_teacher_can_view_class_compliance_roster_and_bulk_update(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        created_class = onboarding_response.get_json()['createdClass']
        class_id = created_class['id']
        org_id = onboarding_response.get_json()['school']['activeOrganizationId']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
            'guardian_contact_required': True,
            'student_number': 'A001',
        }
        self.fake_db.enrollments[f'{class_id}_student-2'] = {
            'id': f'{class_id}_student-2',
            'class_id': class_id,
            'student_uid': 'student-2',
            'status': 'active',
            'guardian_contact_required': True,
            'student_number': 'A002',
        }

        roster_response = self.client.get(f'/api/teacher/classes/{class_id}/compliance')
        self.assertEqual(roster_response.status_code, 200)
        roster = roster_response.get_json()['roster']
        self.assertEqual(roster['summary']['studentCount'], 2)
        self.assertEqual(roster['summary']['voiceBlockedCount'], 2)
        self.assertEqual(roster['students'][0]['displayName'], 'Student One')
        self.assertTrue(roster['students'][0]['guardianContactRequired'])

        bulk_response = self.client.put(
            f'/api/teacher/classes/{class_id}/compliance/bulk',
            json={
                'studentUids': ['student-1', 'student-2'],
                'updates': {
                    'guardianConsentStatus': 'granted',
                    'voiceConsentStatus': 'granted',
                    'textAllowed': True,
                },
                'reason': 'Batch pilot cleanup',
            },
        )
        self.assertEqual(bulk_response.status_code, 200)
        self.assertEqual(bulk_response.get_json()['updatedCount'], 2)
        self.assertEqual(self.fake_db.student_compliance_records[f'{org_id}_student-1']['voice_consent_status'], 'granted')
        self.assertEqual(self.fake_db.student_compliance_records[f'{org_id}_student-2']['voice_consent_status'], 'granted')
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'consent.bulk_updated')

        refreshed_roster = self.client.get(f'/api/teacher/classes/{class_id}/compliance').get_json()['roster']
        self.assertEqual(refreshed_roster['summary']['voiceAllowedCount'], 2)
        self.assertEqual(refreshed_roster['summary']['voiceBlockedCount'], 0)

    def test_teacher_can_export_class_compliance_audit_csv(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        created_class = onboarding_response.get_json()['createdClass']
        class_id = created_class['id']
        org_id = onboarding_response.get_json()['school']['activeOrganizationId']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
        }
        self.fake_db.create_consent_event(
            org_id=org_id,
            student_uid='student-1',
            event_type='consent.updated',
            actor_type='teacher',
            actor_id='teacher-1',
            payload={'classId': class_id},
            scope_type='student',
            scope_id='student-1',
        )

        export_response = self.client.get(f'/api/teacher/classes/{class_id}/compliance/audit-export')

        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.mimetype, 'text/csv')
        export_text = export_response.data.decode('utf-8')
        self.assertIn('event_type', export_text)
        self.assertIn('consent.updated', export_text)
        self.assertIn('Student One', export_text)
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'audit.exported')
        self.assertEqual(self.fake_db.consent_events[-1]['scope_type'], 'class')
        self.assertEqual(self.fake_db.consent_events[-1]['scope_id'], class_id)

    def test_teacher_can_issue_and_resend_guardian_consent_packet(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        class_id = onboarding_response.get_json()['createdClass']['id']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
            'guardian_contact_required': True,
        }

        issue_response = self.client.post(
            f'/api/teacher/classes/{class_id}/students/student-1/guardian-consent-packets',
            json={
                'deliveryMethod': 'secure_link',
                'contactChannel': 'email',
                'contactDestinationHint': 'parent@example.org',
            },
        )

        self.assertEqual(issue_response.status_code, 201)
        issue_payload = issue_response.get_json()
        self.assertEqual(issue_payload['guardianPacket']['status'], 'issued')
        self.assertTrue(issue_payload['deliveryToken'])
        packet_id = issue_payload['guardianPacket']['id']
        first_token = issue_payload['deliveryToken']
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'guardian_packet.issued')

        resend_response = self.client.post(
            f'/api/teacher/classes/{class_id}/students/student-1/guardian-consent-packets/{packet_id}/resend',
        )

        self.assertEqual(resend_response.status_code, 200)
        resend_payload = resend_response.get_json()
        self.assertEqual(resend_payload['guardianPacket']['status'], 'issued')
        self.assertEqual(resend_payload['guardianPacket']['reminderCount'], 1)
        self.assertNotEqual(resend_payload['deliveryToken'], first_token)
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'guardian_packet.resent')

    def test_guardian_secure_link_updates_student_compliance(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        class_id = onboarding_response.get_json()['createdClass']['id']
        org_id = onboarding_response.get_json()['school']['activeOrganizationId']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
            'guardian_contact_required': True,
        }

        issue_response = self.client.post(
            f'/api/teacher/classes/{class_id}/students/student-1/guardian-consent-packets',
            json={'deliveryMethod': 'secure_link'},
        )
        token = issue_response.get_json()['deliveryToken']

        view_response = self.client.get(f'/api/guardian/consent/{token}')
        self.assertEqual(view_response.status_code, 200)
        self.assertEqual(view_response.get_json()['guardianConsent']['packet']['status'], 'viewed')

        decision_response = self.client.post(
            f'/api/guardian/consent/{token}/decision',
            json={'decision': 'granted', 'acknowledged': True},
        )

        self.assertEqual(decision_response.status_code, 200)
        self.assertEqual(decision_response.get_json()['guardianPacket']['status'], 'granted')
        self.assertEqual(decision_response.get_json()['compliance']['guardianConsentStatus'], 'granted')
        self.assertEqual(self.fake_db.student_compliance_records[f'{org_id}_student-1']['guardian_consent_status'], 'granted')
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'guardian_packet.granted')

    def test_expired_guardian_consent_link_returns_gone(self):
        onboarding_response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Spanish 1 - Period 2',
            'term': 'Spring 2026',
            'subject': 'Spanish',
            'gradeBand': '9-10',
            'learningLocale': 'es-ES',
        })
        class_id = onboarding_response.get_json()['createdClass']['id']
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
            'guardian_contact_required': True,
        }

        issue_response = self.client.post(
            f'/api/teacher/classes/{class_id}/students/student-1/guardian-consent-packets',
            json={'deliveryMethod': 'secure_link'},
        )
        token = issue_response.get_json()['deliveryToken']
        packet_id = issue_response.get_json()['guardianPacket']['id']
        self.fake_db.guardian_packets[packet_id]['expires_at'] = datetime.now(UTC) - timedelta(days=1)

        expired_response = self.client.get(f'/api/guardian/consent/{token}')

        self.assertEqual(expired_response.status_code, 410)
        self.assertEqual(self.fake_db.guardian_packets[packet_id]['status'], 'expired')
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'guardian_packet.expired')


    # ── Join code and roster tests ──────────────────────────────────────

    def _bootstrap_school(self):
        response = self.client.post('/api/schools', json={
            'orgName': 'Lingual Academy',
            'orgType': 'school',
            'className': 'Korean 1',
            'term': 'Fall 2026',
            'subject': 'Korean',
            'gradeBand': '9-10',
            'learningLocale': 'ko-KR',
        })
        payload = response.get_json()
        return payload['createdClass']['id'], payload['school']['activeOrganizationId']

    def test_teacher_can_generate_and_retrieve_join_code(self):
        class_id, _org_id = self._bootstrap_school()

        generate_response = self.client.post(f'/api/teacher/classes/{class_id}/join-code')
        self.assertEqual(generate_response.status_code, 200)
        code = generate_response.get_json()['joinCode']
        self.assertEqual(len(code), 6)
        self.assertTrue(generate_response.get_json()['active'])

        get_response = self.client.get(f'/api/teacher/classes/{class_id}/join-code')
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.get_json()['joinCode'], code)
        self.assertTrue(get_response.get_json()['active'])

    def test_teacher_can_deactivate_join_code(self):
        class_id, _org_id = self._bootstrap_school()
        self.client.post(f'/api/teacher/classes/{class_id}/join-code')

        delete_response = self.client.delete(f'/api/teacher/classes/{class_id}/join-code')
        self.assertEqual(delete_response.status_code, 200)

        get_response = self.client.get(f'/api/teacher/classes/{class_id}/join-code')
        self.assertFalse(get_response.get_json()['active'])

    def test_student_can_join_class_with_valid_code(self):
        class_id, org_id = self._bootstrap_school()
        self.client.post(f'/api/teacher/classes/{class_id}/join-code')
        code = self.fake_db.classes[class_id]['join_code']

        # Switch to student session
        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student1@example.com',
                'name': 'Student One',
                'active_membership_id': None,
            }

        join_response = self.client.post('/api/schools/join', json={'joinCode': code})
        self.assertEqual(join_response.status_code, 201)
        payload = join_response.get_json()
        self.assertFalse(payload['alreadyEnrolled'])
        self.assertEqual(payload['class']['id'], class_id)
        self.assertEqual(payload['class']['name'], 'Korean 1')

        # Verify enrollment and membership were created
        enrollment = self.fake_db.enrollments.get(f'{class_id}_student-1')
        self.assertIsNotNone(enrollment)
        self.assertEqual(enrollment['status'], 'active')
        self.assertEqual(enrollment['join_source'], 'join_code')

        membership = self.fake_db.memberships.get(f'{org_id}_student-1')
        self.assertIsNotNone(membership)
        self.assertIn('student', membership['roles'])

    def test_student_join_is_idempotent(self):
        class_id, _org_id = self._bootstrap_school()
        self.client.post(f'/api/teacher/classes/{class_id}/join-code')
        code = self.fake_db.classes[class_id]['join_code']

        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student1@example.com',
                'name': 'Student One',
                'active_membership_id': None,
            }

        # First join
        self.client.post('/api/schools/join', json={'joinCode': code})

        # Second join with same code
        second_response = self.client.post('/api/schools/join', json={'joinCode': code})
        self.assertEqual(second_response.status_code, 200)
        self.assertTrue(second_response.get_json()['alreadyEnrolled'])

    def test_student_join_reactivates_inactive_enrollment(self):
        class_id, _org_id = self._bootstrap_school()
        self.client.post(f'/api/teacher/classes/{class_id}/join-code')
        code = self.fake_db.classes[class_id]['join_code']

        # Pre-create an inactive enrollment
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'inactive',
        }

        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student1@example.com',
                'name': 'Student One',
                'active_membership_id': None,
            }

        join_response = self.client.post('/api/schools/join', json={'joinCode': code})
        self.assertEqual(join_response.status_code, 201)
        self.assertFalse(join_response.get_json()['alreadyEnrolled'])
        self.assertEqual(self.fake_db.enrollments[f'{class_id}_student-1']['status'], 'active')

    def test_join_with_invalid_code_returns_404(self):
        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student1@example.com',
                'name': 'Student One',
                'active_membership_id': None,
            }

        response = self.client.post('/api/schools/join', json={'joinCode': 'ZZZZZZ'})
        self.assertEqual(response.status_code, 404)

    def test_teacher_can_view_roster_and_remove_student(self):
        class_id, _org_id = self._bootstrap_school()
        self.fake_db.enrollments[f'{class_id}_student-1'] = {
            'id': f'{class_id}_student-1',
            'class_id': class_id,
            'student_uid': 'student-1',
            'status': 'active',
            'join_source': 'join_code',
        }

        roster_response = self.client.get(f'/api/teacher/classes/{class_id}/roster')
        self.assertEqual(roster_response.status_code, 200)
        students = roster_response.get_json()['students']
        self.assertEqual(len(students), 1)
        self.assertEqual(students[0]['displayName'], 'Student One')
        self.assertEqual(students[0]['joinSource'], 'join_code')

        remove_response = self.client.delete(f'/api/teacher/classes/{class_id}/students/student-1')
        self.assertEqual(remove_response.status_code, 200)
        self.assertEqual(self.fake_db.enrollments[f'{class_id}_student-1']['status'], 'inactive')

        # Roster should be empty after removal (soft delete)
        refreshed = self.client.get(f'/api/teacher/classes/{class_id}/roster')
        self.assertEqual(len(refreshed.get_json()['students']), 0)


if __name__ == '__main__':
    unittest.main()
