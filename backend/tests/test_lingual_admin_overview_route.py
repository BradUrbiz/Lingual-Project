"""Route tests for GET /api/lingual-admin/overview (Plan 5 Task 13).

Confirms the dashboard endpoint returns the four tile counts and the
recent-activity feed in the expected shape, and that non-lingual-admin
callers receive a 403.
"""
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeOverviewDb(FakeDbBase):
    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def count_school_requests_pending(self):
        return 3

    def count_organizations_by_status(self, status):
        return {'active': 12, 'suspended': 1, 'archived': 0}.get(status, 0)

    def count_school_requests_since(self, *, since):
        return 4

    def list_recent_audit_events(self, *, limit):
        # Real Firestore reads return snake_case keys + datetime objects for
        # `created_at`. The fake mirrors that so we exercise the route's
        # camelize+ISO conversion (P2 #3 regression).
        import datetime
        return [
            {'id': 'a1', 'action': 'request_approved', 'actor_uid': 'u1',
             'target': {'type': 'school_request', 'id': 'r1'},
             'target_org_id': 'o1', 'ip_hash': 'h', 'user_agent': 'ua',
             'metadata': {'note': 'looks fine'},
             'created_at': datetime.datetime(2026, 5, 1, 12, 0, 0,
                                             tzinfo=datetime.timezone.utc)},
        ]


class LingualAdminOverviewRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.deps = make_test_deps(db=FakeOverviewDb())
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()

    def _as_admin(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_returns_tile_counts_and_feed(self):
        self._as_admin()
        resp = self.client.get('/api/lingual-admin/overview')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['tiles']['pendingRequests'], 3)
        self.assertEqual(data['tiles']['activeOrgs'], 12)
        self.assertEqual(data['tiles']['suspendedOrgs'], 1)
        self.assertEqual(data['tiles']['newRequestsLast7d'], 4)
        self.assertEqual(len(data['recentActivity']), 1)
        row = data['recentActivity'][0]
        self.assertEqual(row['action'], 'request_approved')
        # P2 #3 regression: wire shape is camelCase, not snake_case.
        # Pre-fix, the dashboard rendered blanks for actor + timestamp.
        self.assertEqual(row['actorUid'], 'u1')
        self.assertEqual(row['targetOrgId'], 'o1')
        self.assertEqual(row['ipHash'], 'h')
        self.assertEqual(row['userAgent'], 'ua')
        # datetime objects are normalized to ISO 8601 strings on the wire.
        self.assertEqual(row['createdAt'], '2026-05-01T12:00:00+00:00')
        # snake_case keys must not leak through.
        self.assertNotIn('actor_uid', row)
        self.assertNotIn('target_org_id', row)
        self.assertNotIn('created_at', row)

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'someone-else'}
        resp = self.client.get('/api/lingual-admin/overview')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
