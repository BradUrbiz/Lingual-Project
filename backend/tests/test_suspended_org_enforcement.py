"""End-to-end enforcement tests for the suspended-org guard.

Plan 5 Task 10. The guard from ``backend.services.suspended_org_guard`` is
wired into five enforcement points:

* ``resolve_assignment_bootstrap`` (resolver) — current status
* ``POST /api/realtime/session``                — current status
* ``POST /api/student/assignments/<id>/practice-sessions``
  + ``POST /api/teacher/classes/<id>/assignments``
  + ``POST /api/teacher/classes/<id>/assignment-drafts/generate`` (curriculum_admin) — current status
* ``POST /api/practice-sessions/<id>/events``     — current status AND
  ``org_status_when_created`` snapshot (in-flight grace)
* ``POST /api/teacher/classes/<id>/canvas-practice/{generate,create}``
  (canvas_practice) — current status
* ``POST /api/teacher/classes`` (teacher) — current status

Each route returns the stable ``{"error": "org_suspended", ...}`` payload
on a 403 so the SPA can render a single suspended-school message.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.canvas_practice import create_canvas_practice_blueprint
from backend.routes.chat import create_chat_blueprint
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.routes.teacher import create_teacher_blueprint
from backend.services.assignment_resolver import resolve_assignment_bootstrap
from backend.services.suspended_org_guard import SuspendedOrgError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _passthrough_login_required(func):
    return func


def _suspended_org() -> dict:
    """A canonical suspended-org payload as written by ``suspend_organization``."""
    return {
        'id': 'org-1',
        'name': 'Lingual Academy',
        'type': 'school',
        'status': 'suspended',
        'suspend_reason': 'unpaid balance',
        'suspended_until': None,
    }


def _active_org() -> dict:
    return {
        'id': 'org-1',
        'name': 'Lingual Academy',
        'type': 'school',
        'status': 'active',
    }


# ---------------------------------------------------------------------------
# 1. resolver: direct unit test
# ---------------------------------------------------------------------------

class ResolveAssignmentBootstrapSuspendedOrgTests(unittest.TestCase):
    """``resolve_assignment_bootstrap`` raises ``SuspendedOrgError`` before
    doing any prompt assembly when the assignment's owning org is suspended.
    Routes translate this to a 403 with the stable payload.
    """

    def _make_deps(self, org_status: str):
        class FakeDb:
            def __init__(self, status):
                self.status = status

            def get_organization(self, _org_id):
                return {
                    'id': 'org-1',
                    'status': self.status,
                    'suspend_reason': 'unpaid balance' if self.status == 'suspended' else None,
                }
        return SimpleNamespace(db=FakeDb(org_status))

    def _assignment(self):
        return {
            'id': 'asg-1',
            'class_id': 'class-1',
            'org_id': 'org-1',
            'status': 'published',
            'title': 't',
            'instructions': 'do the thing',
            'generated_scenario': 'a scene',
            'task_type': 'decision_making',
        }

    def _class(self):
        return {
            'id': 'class-1',
            'org_id': 'org-1',
            'name': 'French 2',
            'learning_locale': 'fr-FR',
            'subject': 'French',
        }

    def test_active_org_allows_bootstrap(self):
        deps = self._make_deps('active')
        bootstrap = resolve_assignment_bootstrap(
            deps,
            assignment=self._assignment(),
            class_record=self._class(),
            ui_language='en',
        )
        self.assertIn('assignment', bootstrap)

    def test_suspended_org_raises(self):
        deps = self._make_deps('suspended')
        with self.assertRaises(SuspendedOrgError) as ctx:
            resolve_assignment_bootstrap(
                deps,
                assignment=self._assignment(),
                class_record=self._class(),
                ui_language='en',
            )
        self.assertEqual(ctx.exception.org_id, 'org-1')
        self.assertEqual(ctx.exception.reason, 'unpaid balance')

    def test_missing_class_record_does_not_raise_on_empty_org_id(self):
        """An empty class_record has no org_id; the guard no-ops, so the
        suspended-status on the org is never consulted. The bootstrap then
        proceeds with whatever the rest of the resolver does."""
        deps = self._make_deps('suspended')
        # An empty assignment serializes fine, so we'd get a bootstrap back
        # without ever raising SuspendedOrgError — the guard is keyed on
        # class_record['org_id'], not on the org itself.
        bootstrap = resolve_assignment_bootstrap(
            deps,
            assignment=self._assignment(),
            class_record={},
            ui_language='en',
        )
        self.assertIn('assignment', bootstrap)


# ---------------------------------------------------------------------------
# Shared FakeDb for Flask-route tests
# ---------------------------------------------------------------------------

class SuspendedOrgFake:
    """In-memory FakeDb covering the methods touched by the guarded routes.

    Each test seeds a single org, one class, and ``status`` flips between
    'active' and 'suspended' to exercise the guard. Methods unrelated to
    the guard return empty / no-op values so the route can run far enough
    to hit the guard.
    """

    def __init__(self, org_status: str = 'active'):
        self.org_status = org_status
        self.classes = {
            'class-1': {
                'id': 'class-1',
                'org_id': 'org-1',
                'name': 'French 2',
                'learning_locale': 'fr-FR',
                'subject': 'French',
                'term': 'Fall 2026',
                'grade_band': '9-12',
                'teacher_membership_ids': ['mem-teacher'],
                'status': 'active',
            }
        }
        self.assignments = {
            'asg-1': {
                'id': 'asg-1',
                'class_id': 'class-1',
                'org_id': 'org-1',
                'status': 'published',
                'task_type': 'decision_making',
                'title': 't',
                'instructions': 'Use polite forms.',
                'generated_scenario': 'You meet a classmate.',
                'objectives': ['greet'],
                'target_expressions': ['Bonjour'],
                'focus_grammar': ['present tense'],
            }
        }
        self.enrollments = {
            'class-1_student-1': {
                'id': 'class-1_student-1',
                'class_id': 'class-1',
                'student_uid': 'student-1',
                'status': 'active',
            }
        }
        self.memberships = {
            'mem-teacher': {
                'id': 'mem-teacher',
                'uid': 'teacher-1',
                'orgId': 'org-1',
                'roles': ['teacher'],
                'status': 'active',
                'primaryClassIds': ['class-1'],
            },
            'mem-student': {
                'id': 'mem-student',
                'uid': 'student-1',
                'orgId': 'org-1',
                'roles': ['student'],
                'status': 'active',
                'primaryClassIds': ['class-1'],
            },
        }
        self.student_compliance_records = {
            'org-1_student-1': {
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
        }
        self.practice_sessions = {}
        self.learning_events = []
        self.consent_events = []
        self.chat_sessions = {
            ('student-1', 'chat-1'): {
                'id': 'chat-1',
                'uid': 'student-1',
                'messages': [],
                'language_mix_level': 'balanced',
            },
        }
        self.canvas_course_content = {
            'cc-1': {
                'id': 'cc-1', 'class_id': 'class-1', 'connection_id': 'conn-1',
                'item_title': 'La famille', 'item_type': 'Page', 'item_id': 'page-1',
                'canvas_module_id': 'mod-1', 'canvas_module_name': 'Unit 1',
            }
        }
        self._counter = 0

    # -- Lookups ------------------------------------------------------------

    def get_organization(self, _org_id):
        if self.org_status == 'suspended':
            return {
                'id': 'org-1', 'name': 'Lingual Academy', 'type': 'school',
                'status': 'suspended',
                'suspend_reason': 'unpaid balance', 'suspended_until': None,
            }
        return {
            'id': 'org-1', 'name': 'Lingual Academy', 'type': 'school',
            'status': 'active',
        }

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def get_student_class_enrollment(self, class_id, uid):
        return self.enrollments.get(f'{class_id}_{uid}')

    def get_student_compliance_record(self, org_id, student_uid):
        record = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        self.student_compliance_records[f'{org_id}_{student_uid}'] = dict(record)

    def get_user(self, uid):
        return {'uid': uid, 'profile': {'age': 15}}

    def get_user_profile_context(self, _uid):
        return {'learning_locale': 'fr-FR'}

    # -- Mutations ----------------------------------------------------------

    def create_assignment(self, **payload):
        self._counter += 1
        assignment_id = f'asg-new-{self._counter}'
        self.assignments[assignment_id] = {'id': assignment_id, **payload}
        return assignment_id

    def create_class(self, **payload):
        self._counter += 1
        class_id = f'class-new-{self._counter}'
        self.classes[class_id] = {'id': class_id, **payload}
        return class_id

    def add_primary_class_to_membership(self, *_args, **_kwargs):
        pass

    def set_user_last_active_membership(self, *_args, **_kwargs):
        pass

    def create_practice_session(self, payload, session_id=None):
        self._counter += 1
        sid = session_id or f'sess-{self._counter}'
        self.practice_sessions[sid] = {'id': sid, **payload}
        return sid

    def get_practice_session(self, session_id):
        record = self.practice_sessions.get(session_id)
        return dict(record) if record else None

    def update_practice_session(self, session_id, updates):
        if session_id in self.practice_sessions:
            self.practice_sessions[session_id].update(updates)

    def create_learning_event(self, payload, event_id=None):
        self._counter += 1
        eid = event_id or f'evt-{self._counter}'
        self.learning_events.append({'id': eid, **payload})
        return eid

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'cev-{len(self.consent_events)}'

    # -- Canvas / extras ----------------------------------------------------

    def get_canvas_course_content(self, content_id):
        return self.canvas_course_content.get(content_id)

    def get_canvas_connection_by_class(self, _class_id):
        return None

    def link_assignment_to_canvas_item(self, *_args, **_kwargs):
        pass

    # -- Chat sessions / analytics readers ---------------------------------

    def get_chat_session(self, uid, chat_id):
        return self.chat_sessions.get((uid, chat_id))

    def add_message_to_chat(self, uid, chat_id, role, content):
        chat = self.chat_sessions.get((uid, chat_id))
        if chat is None:
            return None
        msg = {'role': role, 'content': content}
        chat.setdefault('messages', []).append(msg)
        return msg

    def update_chat_title(self, *_args, **_kwargs):
        pass

    def list_assignment_practice_sessions(self, assignment_id):
        return [s for s in self.practice_sessions.values() if s.get('assignment_id') == assignment_id]

    def list_assignment_learning_events(self, assignment_id):
        return [e for e in self.learning_events if e.get('assignment_id') == assignment_id]

    def list_student_assignment_practice_sessions(self, assignment_id, uid):
        return [
            s for s in self.practice_sessions.values()
            if s.get('assignment_id') == assignment_id and s.get('student_uid') == uid
        ]

    # -- School-context resolver -------------------------------------------

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        memberships = []
        for membership in self.memberships.values():
            if membership.get('uid') != uid:
                continue
            memberships.append({
                'id': membership['id'],
                'orgId': membership['orgId'],
                'orgName': 'Lingual Academy',
                'orgType': 'school',
                'roles': membership['roles'],
                'status': membership['status'],
                'primaryClassIds': membership.get('primaryClassIds', []),
            })
        active_membership = None
        if preferred_active_membership_id:
            active_membership = next(
                (membership for membership in memberships
                 if membership['id'] == preferred_active_membership_id),
                None,
            )
        if active_membership is None and memberships:
            active_membership = memberships[0]
        return {
            'memberships': memberships,
            'active_membership': active_membership,
            'active_membership_id': active_membership.get('id') if active_membership else None,
            'active_organization_id': active_membership.get('orgId') if active_membership else None,
            'active_roles': active_membership.get('roles', []) if active_membership else [],
        }


def _make_deps(fake_db):
    from backend.services.membership_context import resolve_school_request_context

    def get_school_request_context():
        uid = (session.get('user') or {}).get('uid')
        preferred = (session.get('user') or {}).get('active_membership_id')
        return resolve_school_request_context(
            fake_db,
            uid,
            preferred_active_membership_id=preferred,
        )

    fake_openai = MagicMock()
    fake_openai.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='{"scenario": "s"}'))],
    )

    return RouteDeps(
        db=fake_db,
        firebase_auth=None,
        get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
        get_openai_client=lambda: fake_openai,
        get_assessment=lambda: {},
        compute_results=lambda *_args, **_kwargs: {},
        get_proficiency_description=lambda *_args, **_kwargs: {
            'level': 'Intermediate Mid', 'description': 'Test level',
        },
        login_required=_passthrough_login_required,
        get_user_proficiency_context=lambda: 'Intermediate Mid',
        build_system_prompt=lambda *_args, **_kwargs: 'free practice prompt',
        get_school_request_context=get_school_request_context,
        set_active_school_membership=lambda _mid: None,
        allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
        allowed_minigame_types={'listening_quiz'},
        supported_ui_languages={'en', 'ko'},
    )


# ---------------------------------------------------------------------------
# 2. POST /api/teacher/classes/<id>/assignments
# ---------------------------------------------------------------------------

class CreateAssignmentSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'teacher-1', 'name': 'T',
                'active_membership_id': 'mem-teacher',
            }
        return client

    def _payload(self):
        return {
            'title': 'Weekend recap',
            'instructions': 'Tell me about your weekend.',
            'generatedScenario': 'You meet a friend after the weekend.',
            'status': 'published',
        }

    def test_active_org_allows_create(self):
        client = self._make_client('active')
        response = client.post(
            '/api/teacher/classes/class-1/assignments', json=self._payload(),
        )
        self.assertEqual(response.status_code, 201)

    def test_suspended_org_returns_403_org_suspended(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/teacher/classes/class-1/assignments', json=self._payload(),
        )
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')
        self.assertEqual(body['reason'], 'unpaid balance')


# ---------------------------------------------------------------------------
# 3. POST /api/teacher/classes/<id>/assignment-drafts/generate
# ---------------------------------------------------------------------------

class GenerateAssignmentDraftSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'teacher-1', 'name': 'T',
                'active_membership_id': 'mem-teacher',
            }
        return client

    def test_suspended_org_returns_403(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/teacher/classes/class-1/assignment-drafts/generate',
            json={'sourceText': 'A short source packet.'},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')


# ---------------------------------------------------------------------------
# 4. POST /api/student/assignments/<id>/practice-sessions
# ---------------------------------------------------------------------------

class CreatePracticeSessionSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_suspended_org_returns_403(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/student/assignments/asg-1/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')

    def test_active_org_snapshots_org_status_on_session(self):
        client = self._make_client('active')
        response = client.post(
            '/api/student/assignments/asg-1/practice-sessions',
            json={'uiLanguage': 'en'},
        )
        self.assertEqual(response.status_code, 201)
        session_id = response.get_json()['practiceSession']['id']
        record = self.fake_db.practice_sessions[session_id]
        # The route snapshots the org's current status on the session doc
        # so the events endpoint can apply the in-flight grace rule.
        self.assertEqual(record['org_status_when_created'], 'active')


# ---------------------------------------------------------------------------
# 5. POST /api/practice-sessions/<id>/events  — in-flight grace
# ---------------------------------------------------------------------------

class PracticeSessionEventsInFlightGraceTests(unittest.TestCase):
    """When an org is suspended mid-session, sessions that started while
    the org was active must continue to drain events to closure. New
    sessions on a suspended org cannot reach this endpoint because the
    create endpoint blocks them first.
    """

    def _make_client(self, status, *, snapshot='active'):
        self.fake_db = SuspendedOrgFake(org_status=status)
        # Seed an existing practice session for student-1.
        self.fake_db.practice_sessions['sess-1'] = {
            'id': 'sess-1',
            'org_id': 'org-1',
            'class_id': 'class-1',
            'assignment_id': 'asg-1',
            'student_uid': 'student-1',
            'status': 'active',
            'modality': 'hybrid',
            'session_summary': {},
            'org_status_when_created': snapshot,
        }
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_session_started_while_active_can_post_events_after_suspension(self):
        """In-flight grace: snapshot=='active' + org=='suspended' → 200."""
        client = self._make_client('suspended', snapshot='active')
        response = client.post(
            '/api/practice-sessions/sess-1/events',
            json={'eventType': 'student.turn', 'turnIndex': 1, 'payload': {}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['success'])

    def test_session_with_suspended_snapshot_is_blocked_when_org_suspended(self):
        """Both snapshot and current are suspended → 403."""
        client = self._make_client('suspended', snapshot='suspended')
        response = client.post(
            '/api/practice-sessions/sess-1/events',
            json={'eventType': 'student.turn', 'turnIndex': 1, 'payload': {}},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')

    def test_active_org_always_allows_events(self):
        client = self._make_client('active', snapshot='active')
        response = client.post(
            '/api/practice-sessions/sess-1/events',
            json={'eventType': 'student.turn', 'turnIndex': 1, 'payload': {}},
        )
        self.assertEqual(response.status_code, 200)


# ---------------------------------------------------------------------------
# 6. POST /api/teacher/classes/<id>/canvas-practice/{generate,create}
# ---------------------------------------------------------------------------

class CanvasPracticeSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = MagicMock()
        deps.db = self.fake_db
        deps.login_required = _passthrough_login_required
        deps.get_current_user_uid = lambda: 'teacher-1'
        ctx = MagicMock()
        ctx.active_organization_id = 'org-1'
        ctx.active_membership_id = 'mem-teacher'
        ctx.has_role = lambda role: False
        ctx.require_any_role = lambda roles: None
        deps.get_school_request_context = lambda: ctx
        deps.get_openai_client = lambda: MagicMock()
        app = Flask(__name__)
        app.register_blueprint(create_canvas_practice_blueprint(deps))
        return app.test_client()

    def test_canvas_practice_generate_blocked_on_suspended_org(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/teacher/classes/class-1/canvas-practice/generate',
            json={'canvasContentId': 'cc-1'},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')

    def test_canvas_practice_create_blocked_on_suspended_org(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/teacher/classes/class-1/canvas-practice/create',
            json={
                'canvasContentId': 'cc-1',
                'title': 'Family intro',
                'scenario': 'A scene',
            },
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')


# ---------------------------------------------------------------------------
# 7. POST /api/teacher/classes  (teacher.py class create)
# ---------------------------------------------------------------------------

class CreateClassSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_teacher_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'teacher-1', 'name': 'T',
                'active_membership_id': 'mem-teacher',
            }
        return client

    def test_suspended_org_returns_403(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/teacher/classes',
            json={'name': 'New class', 'learningLocale': 'fr-FR'},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'org_suspended')


# ---------------------------------------------------------------------------
# 8. POST /api/realtime/session
# ---------------------------------------------------------------------------

class RealtimeSessionSuspendedOrgTests(unittest.TestCase):
    """The realtime session mint route runs the resolver, which raises on
    suspended org; the chat blueprint catches ``SuspendedOrgError`` and
    emits the stable 403 payload.
    """

    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_chat_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_assignment_aware_session_blocked_on_suspended_org(self):
        client = self._make_client('suspended')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}, clear=False):
            response = client.post(
                '/api/realtime/session',
                json={'uiLanguage': 'en', 'assignmentId': 'asg-1'},
            )
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')


# ---------------------------------------------------------------------------
# 9. POST /api/chats/<chat_id>/messages  (assignment-aware text path)
# ---------------------------------------------------------------------------

class SendChatMessageAssignmentSuspendedOrgTests(unittest.TestCase):
    """Regression for the missing SuspendedOrgError handler at chat.py:885.
    Before the fix, a student in a suspended org sending an assignment-linked
    text message got HTTP 500 with a leaked 'organization <id> is suspended'
    body instead of the stable 403 org_suspended payload.
    """

    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_chat_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_suspended_org_returns_403_org_suspended(self):
        client = self._make_client('suspended')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}, clear=False):
            response = client.post(
                '/api/chats/chat-1/messages',
                json={'message': 'Bonjour', 'assignmentId': 'asg-1', 'uiLanguage': 'en'},
            )
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')
        self.assertEqual(body['reason'], 'unpaid balance')


# ---------------------------------------------------------------------------
# 10. POST /api/student/assignments/<id>/bootstrap
# ---------------------------------------------------------------------------

class BootstrapStudentAssignmentSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_suspended_org_returns_403_org_suspended(self):
        client = self._make_client('suspended')
        response = client.post(
            '/api/student/assignments/asg-1/bootstrap',
            json={'uiLanguage': 'en'},
        )
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')
        self.assertEqual(body['reason'], 'unpaid balance')


# ---------------------------------------------------------------------------
# 11. GET /api/student/assignments/<id>/workspace
# ---------------------------------------------------------------------------

class StudentAssignmentWorkspaceSuspendedOrgTests(unittest.TestCase):
    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'student-1', 'name': 'S',
                'active_membership_id': 'mem-student',
            }
        return client

    def test_suspended_org_returns_403_org_suspended(self):
        client = self._make_client('suspended')
        response = client.get('/api/student/assignments/asg-1/workspace')
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')


# ---------------------------------------------------------------------------
# 12. GET /api/teacher/assignments/<id>/analytics
# ---------------------------------------------------------------------------

class AssignmentAnalyticsSuspendedOrgTests(unittest.TestCase):
    """Read-only teacher analytics: also gated on suspended org. The team
    may want to revisit whether read-only views should enforce suspension,
    but as of Plan 5 the resolver is what runs and the resolver raises.
    """

    def _make_client(self, status):
        self.fake_db = SuspendedOrgFake(org_status=status)
        deps = _make_deps(self.fake_db)
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(deps))
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {
                'uid': 'teacher-1', 'name': 'T',
                'active_membership_id': 'mem-teacher',
            }
        return client

    def test_suspended_org_returns_403_org_suspended(self):
        client = self._make_client('suspended')
        response = client.get('/api/teacher/assignments/asg-1/analytics')
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'org_suspended')


if __name__ == '__main__':
    unittest.main()
