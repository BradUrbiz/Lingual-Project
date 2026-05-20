"""Route tests for GET /api/lingual-admin/requests (Plan 5 Task 14).

Confirms the list endpoint:
- returns the items list with camelCased fields,
- threads status/schoolType/country/sort query params to the DB layer,
- rejects invalid sort values with 400,
- gates non-lingual-admin callers with 403.
"""
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeRequestsDb(FakeDbBase):
    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def list_school_requests(self, *, status_filter=None, school_type=None,
                             country=None, requested_after=None,
                             requested_before=None, sort='requested_at_desc',
                             limit=50, cursor=None):
        # Mirror the production-side guard so route-level error handling
        # (400 on bad sort) is exercised end-to-end in tests.
        from database import ALLOWED_REQUEST_SORTS
        if sort not in ALLOWED_REQUEST_SORTS:
            raise ValueError(f'Invalid sort {sort!r}')
        self.last_kwargs = dict(
            status_filter=status_filter, school_type=school_type,
            country=country, requested_after=requested_after,
            requested_before=requested_before, sort=sort,
            limit=limit, cursor=cursor,
        )
        return {'items': [{'id': 'r1', 'school_name': 'Sunset', 'status': 'pending'}],
                'next_cursor': None}


class RequestsListRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeRequestsDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_default_returns_items(self):
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['schoolName'], 'Sunset')

    def test_passes_filters_to_db(self):
        resp = self.client.get(
            '/api/lingual-admin/requests'
            '?status=pending&schoolType=high&country=US&sort=name'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.last_kwargs['status_filter'], 'pending')
        self.assertEqual(self.db.last_kwargs['school_type'], 'high')
        self.assertEqual(self.db.last_kwargs['country'], 'US')
        self.assertEqual(self.db.last_kwargs['sort'], 'name')

    def test_invalid_sort_rejected(self):
        resp = self.client.get('/api/lingual-admin/requests?sort=banana')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'someone'}
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
