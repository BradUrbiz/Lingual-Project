import unittest
from datetime import UTC, datetime

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


SAMPLE_PACKAGE = {
    "curriculum": {
        "id": "ap-french-sample",
        "title": {"en": "AP French Sample"},
        "learningLocale": "fr-FR",
        "levelBand": "intermediate",
        "version": "1.0",
        "source": {"type": "native"},
    },
    "objectives": [
        {
            "id": "obj-1",
            "mode": "interpersonal_speaking",
            "canDo": {"en": "Describe family"},
            "contextTags": ["family_structures"],
            "communicativeFunctions": ["describe_people_things"],
            "discourseMoves": ["compare_contrast"],
            "foundationDomains": ["personal"],
            "mastery": {"rubricId": "rubric-1", "threshold": 3},
            "evidenceModel": {"taskModel": "information_gap", "minTurns": 4, "timeLimitSec": 300},
            "templateRefs": [],
        },
    ],
    "rubrics": [
        {
            "id": "rubric-1",
            "title": {"en": "Speaking rubric"},
            "scale": {"min": 0, "max": 4},
            "dimensions": [
                {"id": "interaction_management", "title": {"en": "Interaction"}, "description": {"en": "..."}},
            ],
        }
    ],
    "units": [
        {
            "id": "unit-1",
            "title": {"en": "Unit 1"},
            "ap": {"unitNumber": 1},
            "modules": [
                {
                    "id": "mod-1",
                    "title": {"en": "Module 1"},
                    "moduleGoal": {"en": "Learn family vocabulary"},
                    "capstone": {"mode": "interpersonal_speaking", "taskModel": "information_gap", "situationId": "sit-1"},
                    "situations": [
                        {
                            "id": "sit-1",
                            "kind": "interpersonal_speaking",
                            "objectiveIds": ["obj-1"],
                            "seed": {
                                "setting": {"en": "At a cafe"},
                                "roles": [{"en": "Student"}, {"en": "Friend"}],
                                "register": "informal",
                                "contextTags": ["family_structures"],
                                "constraints": {"minTurns": 4, "maxTurns": 10, "timeLimitSec": 300},
                            },
                        }
                    ],
                }
            ],
        }
    ],
    "templates": {"activityTemplates": []},
}
class FakeDb:
    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.assignments = {}
        self.practice_sessions = {}
        self.learning_events = []
        self.users = {}
        self.user_chats = {}
        self.student_compliance_records = {}
        self.consent_events = []
        self.user_active_memberships = {}

        self.org_counter = 0
        self.membership_counter = 0
        self.class_counter = 0
        self.assignment_counter = 0
        self.session_counter = 0
        self.event_counter = 0

    # ---- organization / membership / class scaffolding ----

    def set_user_last_active_membership(self, uid, membership_id):
        self.user_active_memberships[uid] = membership_id

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

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_user(self, uid):
        return self.users.get(uid)

    def create_chat_session(self, uid, title='New Chat', chat_id=None, messages=None, updated_at=None):
        chats = self.user_chats.setdefault(uid, {})
        chat_id = chat_id or f'chat-{len(chats) + 1}'
        timestamp = updated_at or datetime.now(UTC).isoformat()
        chats[chat_id] = {
            'id': chat_id,
            'title': title,
            'created_at': timestamp,
            'updated_at': timestamp,
            'messages': list(messages or []),
        }
        return chat_id

    def get_chat_session(self, uid, chat_id):
        chat = (self.user_chats.get(uid) or {}).get(chat_id)
        return dict(chat) if chat else None

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_student_compliance_record(self, org_id, uid):
        record = self.student_compliance_records.get(f'{org_id}_{uid}')
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id, uid, record):
        record_id = f'{org_id}_{uid}'
        self.student_compliance_records[record_id] = {'id': record_id, **record}
        return record_id

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'consent-event-{len(self.consent_events)}'

    # ---- assignments ----

    def list_class_assignments(self, class_id):
        return [
            dict(a) for a in self.assignments.values() if a.get('class_id') == class_id
        ]

    def create_assignment(self, **kwargs):
        self.assignment_counter += 1
        assignment_id = f'assignment-{self.assignment_counter}'
        now = datetime.now(UTC).isoformat()
        self.assignments[assignment_id] = {
            'id': assignment_id,
            **kwargs,
            'created_at': now,
            'updated_at': now,
        }
        return assignment_id

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def list_student_assignments(self, uid, statuses=None):
        results = []
        for assignment in self.assignments.values():
            if statuses and assignment.get('status') not in statuses:
                continue
            enrollment = self.get_student_class_enrollment(assignment.get('class_id'), uid)
            if enrollment and enrollment.get('status') == 'active':
                results.append(dict(assignment))
        return results

    def get_student_class_enrollment(self, class_id, uid):
        enrollment = self.enrollments.get(f'{class_id}_{uid}')
        return dict(enrollment) if enrollment else None

    # ---- practice sessions ----

    def create_practice_session(self, payload):
        self.session_counter += 1
        session_id = f'session-{self.session_counter}'
        self.practice_sessions[session_id] = {
            'id': session_id,
            **payload,
        }
        return session_id

    def get_practice_session(self, session_id):
        session = self.practice_sessions.get(session_id)
        return dict(session) if session else None

    def update_practice_session(self, session_id, updates):
        if session_id in self.practice_sessions:
            self.practice_sessions[session_id].update(updates)

    # ---- learning events ----

    def create_learning_event(self, payload):
        self.event_counter += 1
        event_id = f'event-{self.event_counter}'
        self.learning_events.append({'id': event_id, **payload})
        return event_id

    def list_assignment_practice_sessions(self, assignment_id):
        return [
            dict(s) for s in self.practice_sessions.values() if s.get('assignment_id') == assignment_id
        ]

    def list_student_assignment_practice_sessions(self, assignment_id, student_uid):
        return [
            dict(s)
            for s in self.practice_sessions.values()
            if s.get('assignment_id') == assignment_id and s.get('student_uid') == student_uid
        ]

    def list_assignment_learning_events(self, assignment_id):
        return [
            dict(e) for e in self.learning_events if e.get('assignment_id') == assignment_id
        ]


class CurriculumAdminRoutesTestCase(unittest.TestCase):
    """Tests for the curriculum_admin blueprint routes."""

    def setUp(self):
        self.fake_db = FakeDb()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'

        # ---- seed data ----

        # Organization
        self.org_id = 'org-1'
        self.fake_db.organizations[self.org_id] = {
            'id': self.org_id,
            'name': 'Test School',
            'type': 'school',
            'status': 'active',
            'pilot_stage': 'beta',
        }

        # Teacher membership
        self.teacher_uid = 'teacher-1'
        self.teacher_membership_id = 'mem-teacher-1'
        self.fake_db.memberships[self.teacher_membership_id] = {
            'id': self.teacher_membership_id,
            'orgId': self.org_id,
            'uid': self.teacher_uid,
            'roles': ['teacher'],
            'status': 'active',
            'primaryClassIds': [],
        }
        self.fake_db.users[self.teacher_uid] = {
            'uid': self.teacher_uid,
            'name': 'Teacher User',
            'email': 'teacher@example.com',
            'profile': {'display_name': 'Teacher User', 'age': 32},
        }

        # Student membership
        self.student_uid = 'student-1'
        self.student_membership_id = 'mem-student-1'
        self.fake_db.memberships[self.student_membership_id] = {
            'id': self.student_membership_id,
            'orgId': self.org_id,
            'uid': self.student_uid,
            'roles': ['student'],
            'status': 'active',
            'primaryClassIds': [],
        }
        self.fake_db.users[self.student_uid] = {
            'uid': self.student_uid,
            'name': 'Student One',
            'email': 'student1@example.com',
            'profile': {'display_name': 'Student One', 'age': 16},
        }

        # Class with the teacher assigned
        self.class_id = 'class-1'
        self.fake_db.classes[self.class_id] = {
            'id': self.class_id,
            'org_id': self.org_id,
            'name': 'French 1',
            'learning_locale': 'fr-FR',
            'term': 'Spring 2026',
            'subject': 'French',
            'teacher_membership_ids': [self.teacher_membership_id],
            'grade_band': '9-10',
            'status': 'active',
            'created_at': None,
            'updated_at': None,
        }

        # Enrollment for the student
        enrollment_key = f'{self.class_id}_{self.student_uid}'
        self.fake_db.enrollments[enrollment_key] = {
            'id': enrollment_key,
            'class_id': self.class_id,
            'student_uid': self.student_uid,
            'student_membership_id': self.student_membership_id,
            'status': 'active',
            'created_at': datetime.now(UTC).isoformat(),
        }

        # ---- build deps + register blueprint ----

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
            get_school_request_context=get_school_request_context,
            set_active_school_membership=set_active_school_membership,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_curriculum_admin_blueprint(deps))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _teacher_session(self):
        return {
            'uid': self.teacher_uid,
            'email': 'teacher@example.com',
            'name': 'Teacher User',
            'active_membership_id': self.teacher_membership_id,
        }

    def _student_session(self):
        return {
            'uid': self.student_uid,
            'email': 'student1@example.com',
            'name': 'Student One',
            'active_membership_id': self.student_membership_id,
        }

    def _create_published_assignment_via_db(self):
        """Insert a published direct-scenario assignment into FakeDb and return its id."""
        return self.fake_db.create_assignment(
            org_id=self.org_id,
            class_id=self.class_id,
            title='Family Vocab Practice',
            description='Practice describing families.',
            status='published',
            release_at='',
            due_at='',
            modality_override={},
            max_attempts=None,
            task_type='decision_making',
            success_criteria=[],
            created_by_uid=self.teacher_uid,
            instructions='Talk about family members.',
            generated_scenario='You meet a classmate and describe your family.',
            target_expressions=['ma famille'],
            focus_grammar=['present tense'],
            teacher_notes='Keep the exchange friendly.',
        )

    def _seed_chat(self, chat_id, title, *, updated_at=None, messages=None):
        return self.fake_db.create_chat_session(
            self.student_uid,
            title=title,
            chat_id=chat_id,
            updated_at=updated_at,
            messages=messages,
        )

    # ------------------------------------------------------------------
    # 1. GET /api/teacher/classes/:id/curriculum/packages
    # ------------------------------------------------------------------

    def test_get_curriculum_packages_route_is_removed(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/packages')
            self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # 4. GET /api/teacher/classes/:id/assignments
    # ------------------------------------------------------------------

    def test_list_class_assignments_empty(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/assignments')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(payload['assignments'], [])

    def test_list_class_assignments_returns_created_assignment(self):
        self._create_published_assignment_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/assignments')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(len(payload['assignments']), 1)
            self.assertEqual(payload['assignments'][0]['title'], 'Family Vocab Practice')

    # ------------------------------------------------------------------
    # 5. POST /api/teacher/classes/:id/assignments
    # ------------------------------------------------------------------

    def test_create_assignment_happy_path(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'title': 'Family Vocab Practice',
                    'description': 'Talk about your family.',
                    'status': 'draft',
                    'instructions': 'Introduce your family.',
                    'generatedScenario': 'You meet a new friend and describe your family.',
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            assignment = payload['assignment']
            self.assertEqual(assignment['title'], 'Family Vocab Practice')
            self.assertEqual(assignment['status'], 'draft')
            self.assertNotIn('mappingId', assignment)

    def test_create_assignment_missing_title(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'status': 'draft',
                    'instructions': 'x',
                    'generatedScenario': 'y',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('title', payload['error'].lower())

    def test_create_assignment_missing_instructions(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'title': 'Assignment Without Instructions',
                    'status': 'draft',
                    'generatedScenario': 'You are at a cafe.',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('instructions', payload['error'])

    def test_create_assignment_missing_generated_scenario(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'title': 'Assignment Without Scenario',
                    'status': 'draft',
                    'instructions': 'Introduce yourself.',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('generatedScenario', payload['error'])

    # ------------------------------------------------------------------
    # 6. GET /api/student/assignments
    # ------------------------------------------------------------------

    def test_list_student_assignments(self):
        self._create_published_assignment_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get('/api/student/assignments')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(len(payload['assignments']), 1)
            self.assertEqual(payload['assignments'][0]['title'], 'Family Vocab Practice')
            # Should include the class name
            self.assertEqual(payload['assignments'][0]['className'], 'French 1')

    def test_list_student_assignments_excludes_drafts(self):
        # Create a draft assignment (not published)
        self.fake_db.create_assignment(
            org_id=self.org_id,
            class_id=self.class_id,
            title='Draft Assignment',
            description='',
            status='draft',
            release_at='',
            due_at='',
            modality_override={},
            max_attempts=None,
            task_type='decision_making',
            success_criteria=[],
            created_by_uid=self.teacher_uid,
            instructions='draft instructions',
            generated_scenario='draft scenario',
        )

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get('/api/student/assignments')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(len(payload['assignments']), 0)

    # ------------------------------------------------------------------
    # 7. POST /api/student/assignments/:id/practice-sessions
    # ------------------------------------------------------------------

    def test_create_practice_session_happy_path(self):
        assignment_id = self._create_published_assignment_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/student/assignments/{assignment_id}/practice-sessions',
                json={'uiLanguage': 'en'},
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            practice_session = payload['practiceSession']
            self.assertEqual(practice_session['assignmentId'], assignment_id)
            self.assertEqual(practice_session['studentUid'], self.student_uid)
            self.assertEqual(practice_session['status'], 'active')

    # ------------------------------------------------------------------
    # 8. POST /api/practice-sessions/:id/events
    # ------------------------------------------------------------------

    def test_report_event_student_turn(self):
        assignment_id = self._create_published_assignment_via_db()

        # Create a practice session directly in the db
        session_id = self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'active',
            'modality': 'hybrid',
            'voice_enabled': True,
            'text_enabled': True,
            'session_summary': {
                'student_turn_count': 0,
                'tutor_turn_count': 0,
                'total_turns': 0,
                'total_student_words': 0,
                'total_tutor_words': 0,
                'estimated_speaking_time_seconds': 0,
                'expression_attempts': [],
                'grammar_observations': [],
                'tutor_feedback_log': [],
                'rubric_scores': [],
            },
            'cost_summary': {
                'total_input_tokens': 0,
                'total_output_tokens': 0,
                'total_audio_seconds': 0,
                'total_cost_usd': 0.0,
            },
            'analysis_state': {},
            'curriculum_snapshot': {},
            'pedagogy_snapshot': {},
            'mapping_snapshot': {},
            'assignment_snapshot': {},
            'started_at': datetime.now(UTC).isoformat(),
            'created_at': datetime.now(UTC).isoformat(),
            'updated_at': datetime.now(UTC).isoformat(),
        })

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/practice-sessions/{session_id}/events',
                json={
                    'eventType': 'student.turn',
                    'turnIndex': 1,
                    'payload': {'content': 'Bonjour, je suis etudiant.'},
                },
            )
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertIsNotNone(payload['practiceSession'])

    def test_report_event_unsupported_type(self):
        assignment_id = self._create_published_assignment_via_db()
        session_id = self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'active',
            'started_at': datetime.now(UTC).isoformat(),
            'created_at': datetime.now(UTC).isoformat(),
        })

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/practice-sessions/{session_id}/events',
                json={
                    'eventType': 'some.unsupported.event',
                    'turnIndex': 0,
                    'payload': {},
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('Unsupported eventType', payload['error'])

    def test_report_event_wrong_user(self):
        assignment_id = self._create_published_assignment_via_db()
        # Session owned by a different student
        session_id = self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': 'some-other-student',
            'status': 'active',
            'started_at': datetime.now(UTC).isoformat(),
            'created_at': datetime.now(UTC).isoformat(),
        })

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/practice-sessions/{session_id}/events',
                json={
                    'eventType': 'student.turn',
                    'turnIndex': 1,
                    'payload': {'content': 'Hello'},
                },
            )
            self.assertEqual(response.status_code, 403)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('not available', payload['error'].lower())

    # ------------------------------------------------------------------
    # 9. GET /api/student/assignments/:id/workspace
    # ------------------------------------------------------------------

    def test_get_student_assignment_workspace_filters_to_current_student_and_assignment(self):
        assignment_id = self._create_published_assignment_via_db()
        other_assignment_id = self.fake_db.create_assignment(
            org_id=self.org_id,
            class_id=self.class_id,
            title='Other Assignment',
            description='',
            status='published',
            release_at='',
            due_at='',
            modality_override={},
            max_attempts=None,
            task_type='decision_making',
            success_criteria=[],
            created_by_uid=self.teacher_uid,
            instructions='Other instructions.',
            generated_scenario='Other scenario.',
        )
        self._seed_chat(
            'chat-1',
            'Assignment thread',
            updated_at='2026-04-19T10:00:00+00:00',
            messages=[
                {'role': 'user', 'content': 'Bonjour', 'timestamp': '2026-04-19T10:00:00+00:00'},
            ],
        )
        self._seed_chat(
            'chat-2',
            'Historical thread',
            updated_at='2026-04-18T10:00:00+00:00',
            messages=[
                {'role': 'user', 'content': 'Salut', 'timestamp': '2026-04-18T10:00:00+00:00'},
            ],
        )
        self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'active',
            'transcript_ref': {'chat_id': 'chat-1'},
            'started_at': '2026-04-19T10:00:00+00:00',
            'created_at': '2026-04-19T10:00:00+00:00',
        })
        self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'completed',
            'transcript_ref': {'chat_id': 'chat-2'},
            'started_at': '2026-04-18T10:00:00+00:00',
            'created_at': '2026-04-18T10:00:00+00:00',
        })
        self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': other_assignment_id,
            'student_uid': self.student_uid,
            'status': 'completed',
            'transcript_ref': {'chat_id': 'chat-other-assignment'},
            'started_at': '2026-04-17T10:00:00+00:00',
            'created_at': '2026-04-17T10:00:00+00:00',
        })
        self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': 'student-2',
            'status': 'completed',
            'transcript_ref': {'chat_id': 'chat-other-student'},
            'started_at': '2026-04-16T10:00:00+00:00',
            'created_at': '2026-04-16T10:00:00+00:00',
        })

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get(f'/api/student/assignments/{assignment_id}/workspace')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            workspace = payload['workspace']
            self.assertEqual(workspace['selectedChatId'], 'chat-1')
            self.assertEqual(len(workspace['threads']), 2)
            self.assertEqual({thread['chatId'] for thread in workspace['threads']}, {'chat-1', 'chat-2'})

    def test_get_student_assignment_workspace_returns_grouped_threads_and_active_selection(self):
        assignment_id = self._create_published_assignment_via_db()
        self._seed_chat(
            'chat-1',
            'Current active thread',
            updated_at='2026-04-19T10:00:00+00:00',
            messages=[
                {'role': 'user', 'content': 'Bonjour', 'timestamp': '2026-04-19T10:00:00+00:00'},
                {'role': 'assistant', 'content': 'Salut', 'timestamp': '2026-04-19T10:01:00+00:00'},
            ],
        )
        self._seed_chat(
            'chat-2',
            'Past attempt thread',
            updated_at='2026-04-18T09:00:00+00:00',
            messages=[
                {'role': 'user', 'content': 'Je m appelle Lea', 'timestamp': '2026-04-18T09:00:00+00:00'},
            ],
        )
        active_session_id = self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'active',
            'modality': 'hybrid',
            'voice_enabled': True,
            'text_enabled': True,
            'transcript_ref': {'chat_id': 'chat-1'},
            'started_at': '2026-04-19T10:00:00+00:00',
            'created_at': '2026-04-19T10:00:00+00:00',
            'updated_at': '2026-04-19T10:05:00+00:00',
        })
        self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'completed',
            'modality': 'hybrid',
            'voice_enabled': True,
            'text_enabled': True,
            'transcript_ref': {'chat_id': 'chat-2'},
            'started_at': '2026-04-18T09:00:00+00:00',
            'created_at': '2026-04-18T09:00:00+00:00',
            'updated_at': '2026-04-18T09:05:00+00:00',
        })

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get(f'/api/student/assignments/{assignment_id}/workspace')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            workspace = payload['workspace']
            self.assertIn('bootstrap', workspace)
            self.assertEqual(workspace['selectedChatId'], 'chat-1')
            self.assertEqual(workspace['latestActivePracticeSessionId'], active_session_id)
            self.assertEqual(len(workspace['threads']), 2)

            active_thread = next(thread for thread in workspace['threads'] if thread['chatId'] == 'chat-1')
            historical_thread = next(thread for thread in workspace['threads'] if thread['chatId'] == 'chat-2')

            self.assertEqual(active_thread['title'], 'Current active thread')
            self.assertEqual(active_thread['messageCount'], 2)
            self.assertTrue(active_thread['hasActiveAttempt'])
            self.assertEqual(len(active_thread['attempts']), 1)
            self.assertEqual(active_thread['latestPracticeSession']['id'], active_session_id)

            self.assertEqual(historical_thread['title'], 'Past attempt thread')
            self.assertEqual(historical_thread['messageCount'], 1)
            self.assertFalse(historical_thread['hasActiveAttempt'])
            self.assertEqual(len(historical_thread['attempts']), 1)

    def test_create_practice_session_allows_new_attempt_on_existing_chat_id(self):
        assignment_id = self._create_published_assignment_via_db()
        self._seed_chat(
            'chat-123',
            'Existing assignment thread',
            updated_at='2026-04-18T10:00:00+00:00',
            messages=[
                {'role': 'user', 'content': 'Bonjour', 'timestamp': '2026-04-18T10:00:00+00:00'},
            ],
        )
        original_session_id = self.fake_db.create_practice_session({
            'org_id': self.org_id,
            'class_id': self.class_id,
            'assignment_id': assignment_id,
            'student_uid': self.student_uid,
            'status': 'completed',
            'modality': 'hybrid',
            'voice_enabled': True,
            'text_enabled': True,
            'transcript_ref': {'chat_id': 'chat-123'},
            'started_at': '2026-04-18T10:00:00+00:00',
            'created_at': '2026-04-18T10:00:00+00:00',
            'updated_at': '2026-04-18T10:05:00+00:00',
        })
        original_session = self.fake_db.get_practice_session(original_session_id)

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/student/assignments/{assignment_id}/practice-sessions',
                json={'uiLanguage': 'en', 'chatId': 'chat-123'},
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            practice_session = payload['practiceSession']
            self.assertNotEqual(practice_session['id'], original_session_id)
            self.assertEqual(practice_session['chatId'], 'chat-123')
            self.assertEqual(self.fake_db.get_practice_session(original_session_id), original_session)

    # ------------------------------------------------------------------
    # 10. Permission checks - student cannot access teacher endpoints
    # ------------------------------------------------------------------

    def test_teacher_packages_route_is_removed_for_students_too(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/packages')
            self.assertEqual(response.status_code, 404)

    def test_student_cannot_create_assignment(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'title': 'Sneaky Assignment',
                    'status': 'draft',
                    'instructions': 'unused',
                    'generatedScenario': 'unused',
                },
            )
            self.assertEqual(response.status_code, 403)
            payload = response.get_json()
            self.assertFalse(payload['success'])


if __name__ == '__main__':
    unittest.main()
