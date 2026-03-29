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


def get_curriculum_practice_context(module_id=None, situation_id=None, **_kwargs):
    """Look up module and situation from SAMPLE_PACKAGE and return the context tuple."""
    package = SAMPLE_PACKAGE
    for unit in package.get("units", []):
        for module in unit.get("modules", []):
            if module.get("id") != module_id:
                continue
            for situation in module.get("situations", []):
                if situation.get("id") != situation_id:
                    continue
                mode = situation.get("kind", "interpersonal_speaking")
                objective_index = {
                    obj["id"]: obj for obj in package.get("objectives", []) if isinstance(obj, dict) and obj.get("id")
                }
                objectives_list = [
                    objective_index[oid]
                    for oid in situation.get("objectiveIds", [])
                    if oid in objective_index
                ]
                return (package, unit, module, situation, mode, objectives_list)
    raise ValueError(f"Module '{module_id}' or situation '{situation_id}' not found in sample package.")


class FakeDb:
    def __init__(self):
        self.organizations = {}
        self.memberships = {}
        self.classes = {}
        self.enrollments = {}
        self.curriculum_mappings = {}
        self.assignments = {}
        self.practice_sessions = {}
        self.learning_events = []
        self.users = {}
        self.student_compliance_records = {}
        self.consent_events = []
        self.user_active_memberships = {}

        self.org_counter = 0
        self.membership_counter = 0
        self.class_counter = 0
        self.mapping_counter = 0
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

    # ---- curriculum mappings ----

    def get_curriculum_mapping(self, mapping_id):
        return self.curriculum_mappings.get(mapping_id)

    def create_curriculum_mapping(self, **kwargs):
        self.mapping_counter += 1
        mapping_id = f'mapping-{self.mapping_counter}'
        now = datetime.now(UTC).isoformat()
        self.curriculum_mappings[mapping_id] = {
            'id': mapping_id,
            **kwargs,
            'created_at': now,
            'updated_at': now,
        }
        return mapping_id

    def list_class_curriculum_mappings(self, class_id):
        return [
            dict(m) for m in self.curriculum_mappings.values() if m.get('class_id') == class_id
        ]

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
            load_sample_curriculum_package=lambda: SAMPLE_PACKAGE,
            get_curriculum_practice_context=lambda **kwargs: get_curriculum_practice_context(**kwargs),
            build_curriculum_system_prompt=lambda **_kwargs: 'You are a French tutor.',
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

    def _create_mapping_via_db(self):
        """Directly insert a mapping into FakeDb and return its id."""
        return self.fake_db.create_curriculum_mapping(
            org_id=self.org_id,
            class_id=self.class_id,
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
            created_by_uid=self.teacher_uid,
        )

    def _create_published_assignment_via_db(self, mapping_id):
        """Insert a published assignment into FakeDb and return its id."""
        return self.fake_db.create_assignment(
            org_id=self.org_id,
            class_id=self.class_id,
            mapping_id=mapping_id,
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
        )

    # ------------------------------------------------------------------
    # 1. GET /api/teacher/classes/:id/curriculum/packages
    # ------------------------------------------------------------------

    def test_get_curriculum_packages_returns_sample_package(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/packages')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            packages = payload['packages']
            self.assertEqual(len(packages), 1)
            self.assertEqual(packages[0]['id'], 'ap-french-sample')
            self.assertEqual(packages[0]['learningLocale'], 'fr-FR')

    # ------------------------------------------------------------------
    # 2. GET /api/teacher/classes/:id/curriculum/mappings
    # ------------------------------------------------------------------

    def test_list_curriculum_mappings_empty(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/mappings')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(payload['mappings'], [])

    def test_list_curriculum_mappings_returns_created_mapping(self):
        self._create_mapping_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/mappings')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            self.assertEqual(len(payload['mappings']), 1)
            self.assertEqual(payload['mappings'][0]['packageId'], 'ap-french-sample')

    # ------------------------------------------------------------------
    # 3. POST /api/teacher/classes/:id/curriculum/mappings
    # ------------------------------------------------------------------

    def test_create_curriculum_mapping_happy_path(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/curriculum/mappings',
                json={
                    'packageId': 'ap-french-sample',
                    'moduleId': 'mod-1',
                    'objectiveIds': ['obj-1'],
                    'situationIds': ['sit-1'],
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            mapping = payload['mapping']
            self.assertEqual(mapping['packageId'], 'ap-french-sample')
            self.assertEqual(mapping['moduleId'], 'mod-1')
            self.assertIn('obj-1', mapping['objectiveIds'])

    def test_create_curriculum_mapping_missing_package_id(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/curriculum/mappings',
                json={
                    'moduleId': 'mod-1',
                    'situationIds': ['sit-1'],
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('packageId', payload['error'])

    def test_create_curriculum_mapping_wrong_package(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/curriculum/mappings',
                json={
                    'packageId': 'nonexistent-package',
                    'moduleId': 'mod-1',
                    'situationIds': ['sit-1'],
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('sample curriculum package', payload['error'].lower())

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
        mapping_id = self._create_mapping_via_db()
        self._create_published_assignment_via_db(mapping_id)

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
        mapping_id = self._create_mapping_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'mappingId': mapping_id,
                    'title': 'Family Vocab Practice',
                    'description': 'Talk about your family.',
                    'status': 'draft',
                    'taskType': 'decision_making',
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['success'])
            assignment = payload['assignment']
            self.assertEqual(assignment['title'], 'Family Vocab Practice')
            self.assertEqual(assignment['status'], 'draft')
            self.assertEqual(assignment['mappingId'], mapping_id)

    def test_create_assignment_missing_title(self):
        mapping_id = self._create_mapping_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'mappingId': mapping_id,
                    'status': 'draft',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('title', payload['error'].lower())

    def test_create_assignment_missing_mapping(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'title': 'Assignment Without Mapping',
                    'status': 'draft',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('mappingId', payload['error'])

    def test_create_assignment_mapping_from_wrong_class(self):
        # Create a mapping for a different class
        other_class_id = 'class-other'
        self.fake_db.classes[other_class_id] = {
            'id': other_class_id,
            'org_id': self.org_id,
            'name': 'Other Class',
            'learning_locale': 'fr-FR',
            'teacher_membership_ids': [self.teacher_membership_id],
            'status': 'active',
        }
        mapping_id = self.fake_db.create_curriculum_mapping(
            org_id=self.org_id,
            class_id=other_class_id,
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
            created_by_uid=self.teacher_uid,
        )

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._teacher_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'mappingId': mapping_id,
                    'title': 'Cross-class assignment',
                    'status': 'draft',
                },
            )
            self.assertEqual(response.status_code, 404)
            payload = response.get_json()
            self.assertFalse(payload['success'])
            self.assertIn('Mapping not found', payload['error'])

    # ------------------------------------------------------------------
    # 6. GET /api/student/assignments
    # ------------------------------------------------------------------

    def test_list_student_assignments(self):
        mapping_id = self._create_mapping_via_db()
        self._create_published_assignment_via_db(mapping_id)

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
        mapping_id = self._create_mapping_via_db()
        # Create a draft assignment (not published)
        self.fake_db.create_assignment(
            org_id=self.org_id,
            class_id=self.class_id,
            mapping_id=mapping_id,
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
        mapping_id = self._create_mapping_via_db()
        assignment_id = self._create_published_assignment_via_db(mapping_id)

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
        mapping_id = self._create_mapping_via_db()
        assignment_id = self._create_published_assignment_via_db(mapping_id)

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
        mapping_id = self._create_mapping_via_db()
        assignment_id = self._create_published_assignment_via_db(mapping_id)
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
        mapping_id = self._create_mapping_via_db()
        assignment_id = self._create_published_assignment_via_db(mapping_id)
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
    # 9. Permission checks - student cannot access teacher endpoints
    # ------------------------------------------------------------------

    def test_student_cannot_access_teacher_packages_endpoint(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/packages')
            self.assertEqual(response.status_code, 403)
            payload = response.get_json()
            self.assertFalse(payload['success'])

    def test_student_cannot_access_teacher_mappings_endpoint(self):
        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.get(f'/api/teacher/classes/{self.class_id}/curriculum/mappings')
            self.assertEqual(response.status_code, 403)
            payload = response.get_json()
            self.assertFalse(payload['success'])

    def test_student_cannot_create_assignment(self):
        mapping_id = self._create_mapping_via_db()

        with self.app.test_client() as client:
            with client.session_transaction() as sess:
                sess['user'] = self._student_session()

            response = client.post(
                f'/api/teacher/classes/{self.class_id}/assignments',
                json={
                    'mappingId': mapping_id,
                    'title': 'Sneaky Assignment',
                    'status': 'draft',
                },
            )
            self.assertEqual(response.status_code, 403)
            payload = response.get_json()
            self.assertFalse(payload['success'])


if __name__ == '__main__':
    unittest.main()
