import os
import unittest
from unittest import mock

_FLAG_ON = {'PEDAGOGY_ENGINE_COACH_REVIEW': '1'}

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint


def _passthrough(func):
    return func


class _Db:
    def __init__(self, sess):
        self._sess = sess

    def get_practice_session(self, session_id):
        return self._sess


def _deps(db):
    return RouteDeps(
        db=db, firebase_auth=None,
        get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
        get_openai_client=lambda: None, get_assessment=lambda: {},
        compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
        login_required=_passthrough, get_user_proficiency_context=lambda: '',
        build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
        set_active_school_membership=lambda *a, **k: None,
        allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
        supported_ui_languages={'en'}, audit_logger=None,
    )


def _app(db):
    app = Flask(__name__)
    app.secret_key = 'test'
    app.register_blueprint(create_curriculum_admin_blueprint(_deps(db)))
    return app


def _login(client, uid='student-1'):
    with client.session_transaction() as s:
        s['user'] = {'uid': uid}


class CoachReviewRouteTestCase(unittest.TestCase):
    def test_404_when_missing(self):
        client = _app(_Db(None)).test_client()
        _login(client)
        self.assertEqual(client.get('/api/practice-sessions/x/coach-review').status_code, 404)

    def test_403_when_not_owner(self):
        client = _app(_Db({'student_uid': 'someone-else', 'assignment_id': 'a1'})).test_client()
        _login(client)
        self.assertEqual(client.get('/api/practice-sessions/x/coach-review').status_code, 403)

    def test_200_with_review(self):
        sess = {'student_uid': 'student-1', 'assignment_id': 'a1', 'ui_language': 'en'}
        client = _app(_Db(sess)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, _FLAG_ON), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user',
                        return_value={'mapping': {}}), \
             mock.patch('backend.routes.curriculum_admin.generate_coach_review',
                        return_value={'model': 'gpt-5.4-mini-2026-03-17', 'wins': [{'text': 'ok'}], 'work_on': []}):
            resp = client.get('/api/practice-sessions/x/coach-review')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['coachReview']['model'], 'gpt-5.4-mini-2026-03-17')

    def test_200_with_null_when_service_returns_none(self):
        sess = {'student_uid': 'student-1', 'assignment_id': 'a1', 'ui_language': 'en'}
        client = _app(_Db(sess)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, _FLAG_ON), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user',
                        return_value={'mapping': {}}), \
             mock.patch('backend.routes.curriculum_admin.generate_coach_review', return_value=None):
            body = client.get('/api/practice-sessions/x/coach-review').get_json()
        self.assertTrue(body['success'])
        self.assertIsNone(body['coachReview'])

    def test_flag_off_returns_null_and_skips_generation(self):
        # Route-level flag gate: with the flag off, the endpoint returns
        # coachReview:null WITHOUT resolving the bootstrap or calling the service.
        sess = {'student_uid': 'student-1', 'assignment_id': 'a1', 'ui_language': 'en'}
        client = _app(_Db(sess)).test_client()
        _login(client)
        gen = mock.MagicMock()
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_REVIEW': '0'}), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user') as boot, \
             mock.patch('backend.routes.curriculum_admin.generate_coach_review', gen):
            body = client.get('/api/practice-sessions/x/coach-review').get_json()
        self.assertTrue(body['success'])
        self.assertIsNone(body['coachReview'])
        gen.assert_not_called()
        boot.assert_not_called()


if __name__ == '__main__':
    unittest.main()
