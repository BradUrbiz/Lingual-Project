"""Smoke tests for the Plan 5 lingual-admin blueprint.

Confirms the blueprint mounts at `/api/lingual-admin/*` and that the
`_smoke` endpoint enforces the lingual_admin role via
`deps.db.resolve_user_school_context`.
"""
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeLingualAdminDb(FakeDbBase):
    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'lingual-admin-uid'}


class LingualAdminBlueprintSmokeTests(unittest.TestCase):
    def test_blueprint_registered_at_expected_prefix(self):
        deps = make_test_deps(db=FakeLingualAdminDb())
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        app = make_test_app(deps, extra_blueprints=[create_lingual_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'lingual-admin-uid'}
        resp = client.get('/api/lingual-admin/_smoke')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'ok': True})

    def test_non_lingual_admin_is_403(self):
        deps = make_test_deps(db=FakeLingualAdminDb())
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        app = make_test_app(deps, extra_blueprints=[create_lingual_admin_blueprint(deps)])
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'regular-uid'}
        resp = client.get('/api/lingual-admin/_smoke')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
