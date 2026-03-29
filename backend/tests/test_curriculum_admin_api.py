import unittest
from datetime import UTC, datetime

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


# ---------------------------------------------------------------------------
# Minimal sample curriculum package
# ---------------------------------------------------------------------------

SAMPLE_PACKAGE = {
    'curriculum': {
        'id': 'ap-french-sample',
        'title': {'en': 'AP French Sample', 'fr': 'AP Francais Exemple'},
        'learningLocale': 'fr-FR',
        'levelBand': 'intermediate',
        'version': '1.0.0',
        'source': {'type': 'native'},
    },
    'units': [
        {
            'id': 'unit-1',
            'title': {'en': 'Families in Different Societies'},
            'ap': {'unitNumber': 1},
            'modules': [
                {
                    'id': 'mod-1',
                    'title': {'en': 'Family Structures'},
                    'moduleGoal': {'en': 'Discuss family structures across cultures.'},
                    'capstone': {
                        'mode': 'speaking',
                        'taskModel': 'decision_making',
                        'situationId': 'sit-1',
                    },
                    'situations': [
                        {
                            'id': 'sit-1',
                            'kind': 'roleplay',
                            'objectiveIds': ['obj-1'],
                            'seed': {
                                'contextTags': ['family_structures'],
                                'constraints': {
                                    'timeLimitSec': 300,
                                    'minTurns': 4,
                                    'maxTurns': 12,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    'objectives': [
        {
            'id': 'obj-1',
            'mode': 'interpersonal',
            'canDo': {'en': 'I can discuss family roles in a conversation.'},
            'contextTags': ['family_structures'],
            'communicativeFunctions': ['express_opinion'],
            'discourseMoves': ['compare_contrast'],
            'foundationDomains': ['vocabulary', 'grammar'],
            'register': 'informal',
            'mastery': {'rubricId': 'rubric-1', 'threshold': 3},
            'evidenceModel': {
                'taskModel': 'decision_making',
                'timeLimitSec': 300,
                'minTurns': 4,
                'inputProfile': {},
            },
            'templateRefs': [],
        },
    ],
    'rubrics': [
        {
            'id': 'rubric-1',
            'title': {'en': 'Interpersonal Speaking Rubric'},
            'scale': {'min': 1, 'max': 5},
            'dimensions': [
                {
                    'id': 'dim-1',
                    'title': {'en': 'Task Completion'},
                    'description': {'en': 'Degree to which the task was completed.'},
                },
            ],
            'notes': '',
        },
    ],
    'templates': [],
}


def _find_module_and_situation(package, module_id, situation_id):
    """Walk the sample package to locate the requested module and situation."""
    for unit in package.get('units', []):
        for module in unit.get('modules', []):
            if module.get('id') != module_id:
                continue
            for situation in module.get('situations', []):
                if situation.get('id') == situation_id:
                    objectives = [
                        obj for obj in package.get('objectives', [])
                        if obj.get('id') in (situation.get('objectiveIds') or [])
                    ]
                    return package, unit, module, situation, 'interpersonal', objectives
    raise ValueError(f'Module {module_id} / situation {situation_id} not found in sample package.')


# ---------------------------------------------------------------------------
# FakeDb — in-memory store that satisfies all curriculum_admin DB calls
# ---------------------------------------------------------------------------

class FakeCurriculumDb:
    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.users = {}
        self.student_compliance_records = {}
        self.consent_events = []
        self.user_active_memberships = {}

        self.curriculum_mappings = {}
        self.assignments = {}
        self.practice_sessions = {}
        self.learning_events = {}

        self._mapping_counter = 0
        self._assignment_counter = 0
        self._session_counter = 0
        self._event_counter = 0

    # ---- user / org / membership helpers ----------------------------------

    def set_user_last_active_membership(self, uid, membership_id):
        self.user_active_memberships[uid] = membership_id

    def get_user(self, uid):
        return self.users.get(uid)

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

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
            (m for m in memberships if m['id'] == active_membership_id),
            memberships[0] if memberships else None,
        )

        return {
            'memberships': memberships,
            'active_membership': active_membership,
            'active_membership_id': active_membership.get('id') if active_membership else None,
            'active_organization_id': active_membership.get('orgId') if active_membership else None,
            'active_roles': active_membership.get('roles', []) if active_membership else [],
        }

    # ---- class / enrollment -----------------------------------------------

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_student_class_enrollment(self, class_id, uid):
        enrollment = self.enrollments.get(f'{class_id}_{uid}')
        return dict(enrollment) if enrollment else None

    def list_class_enrollments(self, class_id, status=None):
        return [
            dict(e) for e in self.enrollments.values()
            if e.get('class_id') == class_id
            and (status is None or e.get('status') == status)
        ]

    # ---- compliance -------------------------------------------------------

    def get_student_compliance_record(self, org_id, uid):
        record = self.student_compliance_records.get(f'{org_id}_{uid}')
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id, uid, record):
        record_id = f'{org_id}_{uid}'
        self.student_compliance_records[record_id] = {'id': record_id, **record}
        return record_id

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'event-{len(self.consent_events)}'

    # ---- curriculum mappings -----------------------------------------------

    def list_class_curriculum_mappings(self, class_id):
        return [
            dict(m) for m in self.curriculum_mappings.values()
            if m.get('class_id') == class_id
        ]

    def create_curriculum_mapping(self, **kwargs):
        self._mapping_counter += 1
        mapping_id = f'mapping-{self._mapping_counter}'
        now = datetime.now(UTC)
        self.curriculum_mappings[mapping_id] = {
            'id': mapping_id,
            **kwargs,
            'created_at': now,
            'updated_at': now,
        }
        return mapping_id

    def get_curriculum_mapping(self, mapping_id):
        mapping = self.curriculum_mappings.get(mapping_id)
        return dict(mapping) if mapping else None

    # ---- assignments -------------------------------------------------------

    def list_class_assignments(self, class_id):
        return [
            dict(a) for a in self.assignments.values()
            if a.get('class_id') == class_id
        ]

    def create_assignment(self, **kwargs):
        self._assignment_counter += 1
        assignment_id = f'assign-{self._assignment_counter}'
        now = datetime.now(UTC)
        self.assignments[assignment_id] = {
            'id': assignment_id,
            **kwargs,
            'created_at': now,
            'updated_at': now,
        }
        return assignment_id

    def get_assignment(self, assignment_id):
        assignment = self.assignments.get(assignment_id)
        return dict(assignment) if assignment else None

    def list_student_assignments(self, uid, statuses=None):
        results = []
        for assignment in self.assignments.values():
            if statuses and assignment.get('status') not in statuses:
                continue
            enrollment = self.get_student_class_enrollment(assignment.get('class_id'), uid)
            if enrollment and enrollment.get('status') == 'active':
                results.append(dict(assignment))
        return results

    # ---- practice sessions -------------------------------------------------

    def create_practice_session(self, payload):
        self._session_counter += 1
        session_id = f'session-{self._session_counter}'
        self.practice_sessions[session_id] = {
            'id': session_id,
            **payload,
        }
        return session_id

    def get_practice_session(self, session_id):
        session_record = self.practice_sessions.get(session_id)
        return dict(session_record) if session_record else None

    def update_practice_session(self, session_id, updates):
        if session_id in self.practice_sessions:
            self.practice_sessions[session_id].update(updates)

    # ---- learning events ---------------------------------------------------

    def create_learning_event(self, payload):
        self._event_counter += 1
        event_id = f'evt-{self._event_counter}'
        self.learning_events[event_id] = {
            'id': event_id,
            **payload,
        }
        return event_id

    def list_assignment_practice_sessions(self, assignment_id):
        return [
            dict(s) for s in self.practice_sessions.values()
            if s.get('assignment_id') == assignment_id
        ]

    def list_assignment_learning_events(self, assignment_id):
        return [
            dict(e) for e in self.learning_events.values()
            if e.get('assignment_id') == assignment_id
        ]


# ---------------------------------------------------------------------------
# Test case
# ---------------------------------------------------------------------------

class CurriculumAdminApiTestCase(unittest.TestCase):
    """Tests for the curriculum_admin blueprint routes."""

    def setUp(self):
        self.fake_db = FakeCurriculumDb()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'

        fake_db = self.fake_db

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            context = resolve_school_request_context(
                fake_db,
                uid,
                preferred_active_membership_id=preferred,
            )
            if 'user' in session:
                session['user']['active_membership_id'] = context.active_membership_id
            fake_db.set_user_last_active_membership(uid, context.active_membership_id)
            return context

        def set_active_school_membership(membership_id):
            uid = (session.get('user') or {}).get('uid')
            context = resolve_school_request_context(
                fake_db,
                uid,
                preferred_active_membership_id=membership_id,
            )
            if context.active_membership_id != membership_id:
                raise LookupError('Membership not found for the current user.')
            session['user']['active_membership_id'] = context.active_membership_id
            fake_db.set_user_last_active_membership(uid, membership_id)
            return context

        deps = RouteDeps(
            db=fake_db,
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
            load_sample_curriculum_package=lambda: SAMPLE_PACKAGE,
            get_curriculum_practice_context=lambda **kwargs: _find_module_and_situation(
                SAMPLE_PACKAGE, kwargs.get('module_id'), kwargs.get('situation_id'),
            ),
            build_curriculum_system_prompt=lambda **_kwargs: 'You are a helpful French tutor.',
            get_school_request_context=get_school_request_context,
            set_active_school_membership=set_active_school_membership,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_curriculum_admin_blueprint(deps))
        self.client = self.app.test_client()

        # ----- pre-seed org, memberships, class, enrollment, compliance -----
        self.fake_db.organizations['org-1'] = {
            'id': 'org-1',
            'name': 'Test Academy',
            'type': 'school',
            'status': 'active',
            'pilot_stage': 'beta',
        }

        self.fake_db.memberships['mem-teacher'] = {
            'id': 'mem-teacher',
            'orgId': 'org-1',
            'uid': 'teacher-1',
            'roles': ['teacher'],
            'status': 'active',
            'primaryClassIds': ['class-1'],
        }

        self.fake_db.memberships['mem-student'] = {
            'id': 'mem-student',
            'orgId': 'org-1',
            'uid': 'student-1',
            'roles': ['student'],
            'status': 'active',
            'primaryClassIds': ['class-1'],
        }

        self.fake_db.classes['class-1'] = {
            'id': 'class-1',
            'org_id': 'org-1',
            'name': 'French 101',
            'learning_locale': 'fr-FR',
            'term': 'Spring 2026',
            'subject': 'French',
            'teacher_membership_ids': ['mem-teacher'],
            'grade_band': '9-10',
            'status': 'active',
        }

        self.fake_db.enrollments['class-1_student-1'] = {
            'id': 'class-1_student-1',
            'class_id': 'class-1',
            'student_uid': 'student-1',
            'status': 'active',
        }

        self.fake_db.users['teacher-1'] = {
            'uid': 'teacher-1',
            'name': 'Teacher User',
            'email': 'teacher@example.com',
            'profile': {'display_name': 'Teacher User', 'age': 32},
        }
        self.fake_db.users['student-1'] = {
            'uid': 'student-1',
            'name': 'Student One',
            'email': 'student1@example.com',
            'profile': {'display_name': 'Student One', 'age': 16},
        }

        # Compliance record: voice and text allowed
        self.fake_db.student_compliance_records['org-1_student-1'] = {
            'id': 'org-1_student-1',
            'org_id': 'org-1',
            'student_uid': 'student-1',
            'is_minor': True,
            'guardian_consent_status': 'granted',
            'voice_consent_status': 'granted',
            'text_allowed': True,
            'voice_allowed': True,
            'retention_policy_id': 'standard_school',
        }

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _set_session_user(self, uid, active_membership_id=None):
        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': uid,
                'email': f'{uid}@example.com',
                'name': uid,
                'active_membership_id': active_membership_id,
            }

    def _seed_mapping_and_assignment(self, status='published'):
        """Insert a mapping and assignment directly into the fake DB and return their ids."""
        mapping_id = self.fake_db.create_curriculum_mapping(
            org_id='org-1',
            class_id='class-1',
            package_id='ap-french-sample',
            module_id='mod-1',
            objective_ids=['obj-1'],
            situation_ids=['sit-1'],
            target_expressions=[],
            focus_grammar=[],
            allowed_context_tags=[],
            feedback_policy={},
            scaffold_policy={},
            output_policy={},
            modality_policy={},
            rubric_focus=[],
            teacher_notes='',
            created_by_uid='teacher-1',
        )
        assignment_id = self.fake_db.create_assignment(
            org_id='org-1',
            class_id='class-1',
            mapping_id=mapping_id,
            title='Family Discussion',
            description='Practice discussing family roles.',
            status=status,
            release_at='',
            due_at='',
            modality_override={},
            max_attempts=None,
            task_type='decision_making',
            success_criteria=[],
            created_by_uid='teacher-1',
        )
        return mapping_id, assignment_id

    # -----------------------------------------------------------------------
    # 1. GET /api/teacher/classes/<id>/curriculum/packages
    # -----------------------------------------------------------------------

    def test_get_curriculum_packages_returns_sample_package(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        response = self.client.get('/api/teacher/classes/class-1/curriculum/packages')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        packages = payload['packages']
        self.assertEqual(len(packages), 1)
        self.assertEqual(packages[0]['id'], 'ap-french-sample')
        self.assertEqual(packages[0]['learningLocale'], 'fr-FR')

    # -----------------------------------------------------------------------
    # 2. POST /api/teacher/classes/<id>/curriculum/mappings — happy path
    # -----------------------------------------------------------------------

    def test_create_curriculum_mapping_happy_path(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        response = self.client.post(
            '/api/teacher/classes/class-1/curriculum/mappings',
            json={
                'packageId': 'ap-french-sample',
                'moduleId': 'mod-1',
                'situationIds': ['sit-1'],
                'objectiveIds': ['obj-1'],
            },
        )
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        mapping = payload['mapping']
        self.assertEqual(mapping['packageId'], 'ap-french-sample')
        self.assertEqual(mapping['moduleId'], 'mod-1')
        self.assertIn('sit-1', mapping['situationIds'])
        self.assertIn('obj-1', mapping['objectiveIds'])
        self.assertIsNotNone(mapping['id'])

    # -----------------------------------------------------------------------
    # 3. POST /api/teacher/classes/<id>/curriculum/mappings — missing packageId
    # -----------------------------------------------------------------------

    def test_create_curriculum_mapping_rejects_missing_package_id(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        response = self.client.post(
            '/api/teacher/classes/class-1/curriculum/mappings',
            json={
                'moduleId': 'mod-1',
                'situationIds': ['sit-1'],
            },
        )
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('packageId', payload['error'])

    # -----------------------------------------------------------------------
    # 4. GET /api/teacher/classes/<id>/assignments — list
    # -----------------------------------------------------------------------

    def test_list_class_assignments(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        self._seed_mapping_and_assignment(status='published')

        response = self.client.get('/api/teacher/classes/class-1/assignments')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['assignments']), 1)
        self.assertEqual(payload['assignments'][0]['title'], 'Family Discussion')

    # -----------------------------------------------------------------------
    # 5. POST /api/teacher/classes/<id>/assignments — happy path
    # -----------------------------------------------------------------------

    def test_create_assignment_happy_path(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        mapping_id, _ = self._seed_mapping_and_assignment()

        response = self.client.post(
            '/api/teacher/classes/class-1/assignments',
            json={
                'mappingId': mapping_id,
                'title': 'New Assignment',
                'status': 'draft',
                'taskType': 'decision_making',
            },
        )
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        assignment = payload['assignment']
        self.assertEqual(assignment['title'], 'New Assignment')
        self.assertEqual(assignment['mappingId'], mapping_id)
        self.assertEqual(assignment['status'], 'draft')

    # -----------------------------------------------------------------------
    # 6. POST /api/teacher/classes/<id>/assignments — missing title
    # -----------------------------------------------------------------------

    def test_create_assignment_rejects_missing_title(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        mapping_id, _ = self._seed_mapping_and_assignment()

        response = self.client.post(
            '/api/teacher/classes/class-1/assignments',
            json={
                'mappingId': mapping_id,
                'status': 'draft',
            },
        )
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('title', payload['error'])

    # -----------------------------------------------------------------------
    # 7. POST /api/teacher/classes/<id>/assignments — wrong mapping class
    # -----------------------------------------------------------------------

    def test_create_assignment_rejects_wrong_mapping_class(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        # Create a mapping under a *different* class that the teacher also owns
        self.fake_db.classes['class-other'] = {
            'id': 'class-other',
            'org_id': 'org-1',
            'name': 'Other Class',
            'learning_locale': 'fr-FR',
            'term': '',
            'subject': '',
            'teacher_membership_ids': ['mem-teacher'],
            'grade_band': '',
            'status': 'active',
        }
        other_mapping_id = self.fake_db.create_curriculum_mapping(
            org_id='org-1',
            class_id='class-other',
            package_id='ap-french-sample',
            module_id='mod-1',
            objective_ids=['obj-1'],
            situation_ids=['sit-1'],
            target_expressions=[],
            focus_grammar=[],
            allowed_context_tags=[],
            feedback_policy={},
            scaffold_policy={},
            output_policy={},
            modality_policy={},
            rubric_focus=[],
            teacher_notes='',
            created_by_uid='teacher-1',
        )

        response = self.client.post(
            '/api/teacher/classes/class-1/assignments',
            json={
                'mappingId': other_mapping_id,
                'title': 'Bad Mapping Assignment',
                'status': 'draft',
            },
        )
        self.assertEqual(response.status_code, 404)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('Mapping not found', payload['error'])

    # -----------------------------------------------------------------------
    # 8. GET /api/student/assignments — list published for student
    # -----------------------------------------------------------------------

    def test_list_student_assignments(self):
        self._set_session_user('student-1', 'mem-student')
        self._seed_mapping_and_assignment(status='published')

        response = self.client.get('/api/student/assignments')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['assignments']), 1)
        self.assertEqual(payload['assignments'][0]['status'], 'published')

    # -----------------------------------------------------------------------
    # 9. POST /api/student/assignments/<id>/practice-sessions — happy path
    # -----------------------------------------------------------------------

    def test_create_practice_session_happy_path(self):
        self._set_session_user('student-1', 'mem-student')
        _mapping_id, assignment_id = self._seed_mapping_and_assignment(status='published')

        response = self.client.post(
            f'/api/student/assignments/{assignment_id}/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        ps = payload['practiceSession']
        self.assertEqual(ps['assignmentId'], assignment_id)
        self.assertEqual(ps['studentUid'], 'student-1')
        self.assertEqual(ps['status'], 'active')
        # Should have created at least one learning event (session.started)
        self.assertGreaterEqual(len(self.fake_db.learning_events), 1)

    # -----------------------------------------------------------------------
    # 10. POST /api/practice-sessions/<id>/events — report event happy path
    # -----------------------------------------------------------------------

    def test_report_practice_session_event(self):
        self._set_session_user('student-1', 'mem-student')
        _mapping_id, assignment_id = self._seed_mapping_and_assignment(status='published')

        # Create a session first
        create_response = self.client.post(
            f'/api/student/assignments/{assignment_id}/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        session_id = create_response.get_json()['practiceSession']['id']

        response = self.client.post(
            f'/api/practice-sessions/{session_id}/events',
            json={
                'eventType': 'student.turn',
                'turnIndex': 1,
                'payload': {'content': 'Ma famille est grande.'},
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertIsNotNone(payload['practiceSession'])

    # -----------------------------------------------------------------------
    # 11. POST /api/practice-sessions/<id>/events — unsupported event type
    # -----------------------------------------------------------------------

    def test_report_event_rejects_unsupported_event_type(self):
        self._set_session_user('student-1', 'mem-student')
        _mapping_id, assignment_id = self._seed_mapping_and_assignment(status='published')

        create_response = self.client.post(
            f'/api/student/assignments/{assignment_id}/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        session_id = create_response.get_json()['practiceSession']['id']

        response = self.client.post(
            f'/api/practice-sessions/{session_id}/events',
            json={
                'eventType': 'bogus.event',
                'turnIndex': 0,
                'payload': {},
            },
        )
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('Unsupported', payload['error'])

    # -----------------------------------------------------------------------
    # 12. POST /api/practice-sessions/<id>/events — wrong user (403)
    # -----------------------------------------------------------------------

    def test_report_event_rejects_wrong_user(self):
        # Create session as student-1
        self._set_session_user('student-1', 'mem-student')
        _mapping_id, assignment_id = self._seed_mapping_and_assignment(status='published')

        create_response = self.client.post(
            f'/api/student/assignments/{assignment_id}/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        session_id = create_response.get_json()['practiceSession']['id']

        # Add a second student so we can switch to them
        self.fake_db.users['student-2'] = {
            'uid': 'student-2',
            'name': 'Student Two',
            'email': 'student2@example.com',
            'profile': {'display_name': 'Student Two', 'age': 17},
        }
        self.fake_db.memberships['mem-student-2'] = {
            'id': 'mem-student-2',
            'orgId': 'org-1',
            'uid': 'student-2',
            'roles': ['student'],
            'status': 'active',
            'primaryClassIds': ['class-1'],
        }

        # Switch session to student-2 and try to report on student-1's session
        self._set_session_user('student-2', 'mem-student-2')
        response = self.client.post(
            f'/api/practice-sessions/{session_id}/events',
            json={
                'eventType': 'student.turn',
                'turnIndex': 1,
                'payload': {'content': 'Bonjour!'},
            },
        )
        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])

    # -----------------------------------------------------------------------
    # 13. GET /api/teacher/classes/<id>/curriculum/packages — student role 403
    # -----------------------------------------------------------------------

    def test_get_curriculum_packages_rejects_student_role(self):
        self._set_session_user('student-1', 'mem-student')
        response = self.client.get('/api/teacher/classes/class-1/curriculum/packages')
        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])


if __name__ == '__main__':
    unittest.main()
