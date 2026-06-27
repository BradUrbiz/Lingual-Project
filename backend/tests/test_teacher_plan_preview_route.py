import os
import unittest
from unittest import mock

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint


def _passthrough(func):
    return func


class _Db:
    pass


def _deps():
    return RouteDeps(
        db=_Db(), firebase_auth=None,
        get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
        get_openai_client=lambda: None, get_assessment=lambda: {},
        compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
        login_required=_passthrough, get_user_proficiency_context=lambda **_: '',
        build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
        set_active_school_membership=lambda *a, **k: None,
        allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
        supported_ui_languages={'en'}, audit_logger=None,
    )


def _app():
    app = Flask(__name__)
    app.secret_key = 'test'
    app.register_blueprint(create_curriculum_admin_blueprint(_deps()))
    return app


def _login(client, uid='teacher-1'):
    with client.session_transaction() as s:
        s['user'] = {'uid': uid}


_ENGINE_PREVIEW = {
    'engineEnabled': True, 'rawTutorMode': False, 'taskType': 'information_gap',
    'correctionPosture': {'mode': 'balanced', 'recastDefault': True, 'elicitationRepeatThreshold': 2},
    'targets': [{'surface': 'la cuenta', 'kind': 'expression', 'feedbackRoute': 'recast'}],
}


class TeacherPlanPreviewRouteTests(unittest.TestCase):
    def test_flag_off_returns_disabled_without_resolving(self):
        resolver = mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user')
        m = resolver.start()
        self.addCleanup(resolver.stop)
        client = _app().test_client()
        _login(client)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PEDAGOGY_ENGINE_TEACHER_PREVIEW', None)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertFalse(body['teacherPreviewEnabled'])
        self.assertIsNone(body['planPreview'])
        m.assert_not_called()  # flag-off does NOT resolve a bootstrap

    def test_flag_on_returns_engine_preview(self):
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={'mapping': {}}), \
             mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()), \
             mock.patch('backend.routes.curriculum_admin.serialize_plan_preview', return_value=_ENGINE_PREVIEW):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['teacherPreviewEnabled'])
        self.assertEqual(body['planPreview'], _ENGINE_PREVIEW)

    def test_fail_soft_on_resolver_error(self):
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', side_effect=RuntimeError('boom')):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['teacherPreviewEnabled'])
        self.assertIsNone(body['planPreview'])  # fail-soft, no 500

    def test_non_teacher_403(self):
        from backend.routes.curriculum_admin import SchoolContextPermissionError
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access',
                        side_effect=SchoolContextPermissionError('no')):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 403)


class AlignmentViewRouteTests(unittest.TestCase):
    """Route-level tests for the ?realized=1 alignment overlay (flag gate + param gate)."""

    def _app_with_sessions(self, sessions):
        """Like _app() but the Db stub has list_assignment_practice_sessions."""
        class _DbWithSessions(_Db):
            def list_assignment_practice_sessions(self, _assignment_id):
                return sessions

        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(RouteDeps(
            db=_DbWithSessions(), firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None, get_assessment=lambda: {},
            compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
            login_required=_passthrough, get_user_proficiency_context=lambda **_: '',
            build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
            set_active_school_membership=lambda *a, **k: None,
            allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
            supported_ui_languages={'en'}, audit_logger=None,
        )))
        return app

    def test_flag_on_realized_param_attaches_realized_block(self):
        """Flag ON + ?realized=1 + sessions → planPreview.realized present with expected keys."""
        preview_with_targets = {
            'engineEnabled': True, 'rawTutorMode': False, 'taskType': 'information_gap',
            'correctionPosture': {'mode': 'balanced', 'recastDefault': True, 'elicitationRepeatThreshold': 2},
            'targets': [
                {'surface': 'la cuenta', 'kind': 'expression', 'feedbackRoute': 'recast_first'},
            ],
        }
        sessions = [
            {'student_uid': 's1', 'session_summary': {'target_expression_hits': {'la cuenta': 3}}},
        ]
        with mock.patch.dict(os.environ, {
                'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={}), \
             mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()), \
             mock.patch('backend.routes.curriculum_admin.serialize_plan_preview', return_value=preview_with_targets):
            client = self._app_with_sessions(sessions).test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        plan = resp.get_json()['planPreview']
        self.assertIn('realized', plan)
        realized = plan['realized']
        for key in ('studentCount', 'perTarget', 'neverElicited', 'alignmentRate'):
            self.assertIn(key, realized)
        self.assertEqual(realized['studentCount'], 1)

    def test_alignment_flag_off_no_realized_key(self):
        """Flag OFF + ?realized=1 → planPreview has no realized key (flag gate)."""
        with mock.patch.dict(os.environ, {
                'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': ''}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={}), \
             mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()), \
             mock.patch('backend.routes.curriculum_admin.serialize_plan_preview', return_value=dict(_ENGINE_PREVIEW)):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('realized', resp.get_json()['planPreview'])

    def test_no_realized_param_no_realized_key(self):
        """Flag ON but no ?realized=1 → planPreview has no realized key (param gate)."""
        with mock.patch.dict(os.environ, {
                'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={}), \
             mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()), \
             mock.patch('backend.routes.curriculum_admin.serialize_plan_preview', return_value=dict(_ENGINE_PREVIEW)):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('realized', resp.get_json()['planPreview'])
