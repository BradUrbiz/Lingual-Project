import unittest

from flask import Flask, session

from backend.route_deps import RouteDeps
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
        self.user_active_memberships = {}
        self.updated_profiles = []
        self.org_counter = 0
        self.membership_counter = 0
        self.class_counter = 0

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

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def list_class_enrollments(self, class_id):
        return [
            dict(enrollment)
            for enrollment in self.enrollments.values()
            if enrollment.get('class_id') == class_id and enrollment.get('status') == 'active'
        ]

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


if __name__ == '__main__':
    unittest.main()
