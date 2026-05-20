"""Route tests for GET /api/lingual-admin/organizations (Plan 5 Task 18).

Confirms the list endpoint:
- returns the items list with camelCased fields,
- threads status/schoolType/country/publicOrPrivate/cursor query params to
  the DB layer (snake_case at the DB boundary),
- rejects invalid status values with 400 (via the DB's ValueError),
- gates non-lingual-admin callers with 403,
- computes memberCount from the school_admin_uids list,
- emits nextCursor with camelCase inner keys (name_lower → nameLower) on the
  wire, and accepts camelCase cursor input that round-trips back to snake_case
  before reaching the DB layer (Plan 5 Important #2 hardening).
"""
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeOrgsDb(FakeDbBase):
    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def list_organizations(self, **kwargs):
        self.last_kwargs = kwargs
        # Mirror the production-side validation so route-level error
        # handling (400 on bad status) is exercised end-to-end in tests.
        status = kwargs.get('status')
        if status is not None:
            from database import _validate_org_status
            _validate_org_status(status)
        return {
            'items': [
                {
                    'id': 'o1',
                    'name': 'Alpha HS',
                    'status': 'active',
                    'school_type': 'high',
                    'country': 'US',
                    'public_or_private': 'public',
                    'school_admin_uids': ['u1', 'u2'],
                    'created_at': None,
                    'last_activity_at': None,
                },
            ],
            'next_cursor': {'name_lower': 'alpha hs', 'id': 'o1'},
        }


class OrgsListRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeOrgsDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_default_returns_items_with_camelcase(self):
        resp = self.client.get('/api/lingual-admin/organizations')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['items'][0]['name'], 'Alpha HS')
        self.assertEqual(data['items'][0]['schoolType'], 'high')
        self.assertEqual(data['items'][0]['memberCount'], 2)
        # Cursor inner keys are camelCase on the wire to match FE TS types.
        self.assertEqual(data['nextCursor']['id'], 'o1')
        self.assertEqual(data['nextCursor']['nameLower'], 'alpha hs')
        self.assertNotIn('name_lower', data['nextCursor'])

    def test_cursor_input_is_snakeized_for_db_layer(self):
        """FE sends camelCase cursor; route transforms back to snake_case before
        handing to the DB helper (which uses Firestore field names)."""
        import json
        cursor_param = json.dumps({'nameLower': 'lincoln high', 'id': 'o100'})
        resp = self.client.get(
            f'/api/lingual-admin/organizations?cursor={cursor_param}'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            self.db.last_kwargs['cursor'],
            {'name_lower': 'lincoln high', 'id': 'o100'},
        )

    def test_invalid_cursor_400(self):
        resp = self.client.get('/api/lingual-admin/organizations?cursor=not-json')
        self.assertEqual(resp.status_code, 400)

    def test_filters_passed(self):
        resp = self.client.get(
            '/api/lingual-admin/organizations?status=suspended&schoolType=high'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.last_kwargs['status'], 'suspended')
        self.assertEqual(self.db.last_kwargs['school_type'], 'high')

    def test_invalid_status_400(self):
        resp = self.client.get('/api/lingual-admin/organizations?status=paused')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'x'}
        resp = self.client.get('/api/lingual-admin/organizations')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
