import os
import unittest
from unittest import mock

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


_OWNER_SESSION = {'student_uid': 'student-1', 'assignment_id': 'asg-1', 'ui_language': 'en'}


class CoachChipRouteTestCase(unittest.TestCase):
    def setUp(self):
        self._bootstrap_patcher = mock.patch(
            'backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user',
            return_value={'mapping': {}},
        )
        self.bootstrap_resolver = self._bootstrap_patcher.start()

        self._chip_patcher = mock.patch(
            'backend.routes.curriculum_admin.generate_coach_chip',
            return_value={'turn_index': 4, 'text': 'Nice work!'},
        )
        self._chip_patcher.start()

    def tearDown(self):
        self._bootstrap_patcher.stop()
        self._chip_patcher.stop()

    def test_missing_session_returns_404(self):
        # deps.db.get_practice_session -> None
        client = _app(_Db(None)).test_client()
        _login(client)
        resp = client.post('/api/practice-sessions/nope/coach-chip', json={'turn_index': 4})
        self.assertEqual(resp.status_code, 404)

    def test_not_owner_returns_403(self):
        # session_record student_uid != current uid
        client = _app(_Db({'student_uid': 'someone-else', 'assignment_id': 'a1'})).test_client()
        _login(client)
        resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turn_index': 4})
        self.assertEqual(resp.status_code, 403)

    def test_flag_off_returns_null_without_bootstrap(self):
        # PEDAGOGY_ENGINE_COACH_CHIPS unset; assert resolve_assignment_bootstrap_for_user NOT called
        client = _app(_Db(_OWNER_SESSION)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PEDAGOGY_ENGINE_COACH_CHIPS', None)
            resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turn_index': 4})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()['coachChip'])
        self.bootstrap_resolver.assert_not_called()

    def test_flag_on_returns_chip(self):
        # PEDAGOGY_ENGINE_COACH_CHIPS=1; generate_coach_chip patched to return a chip dict
        client = _app(_Db(_OWNER_SESSION)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': '1'}):
            resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turn_index': 4})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['coachChip']['turn_index'], 4)

    def test_generate_coach_chip_raises_returns_null(self):
        # generate_coach_chip raises → route must fail-open: HTTP 200, coachChip null, success true
        client = _app(_Db(_OWNER_SESSION)).test_client()
        _login(client)
        with mock.patch(
            'backend.routes.curriculum_admin.generate_coach_chip',
            side_effect=Exception('boom'),
        ), mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': '1'}):
            resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turn_index': 4})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertIsNone(body['coachChip'])


if __name__ == '__main__':
    unittest.main()
