"""Route tests for GET /api/lingual-admin/organizations/<orgId> (Plan 5 Task 19).

Confirms the org-detail endpoint:
- returns the camelCased overview shape including school-admin contacts,
- writes a fail-soft `org_viewed_detail` audit row via deps.audit_logger.log,
- 404s when the org id is unknown.
"""
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeOrgDetailDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        if org_id == 'o1':
            return {
                'id': 'o1', 'name': 'Sunset HS', 'status': 'active',
                'school_type': 'high', 'country': 'US', 'state': 'CA',
                'county': 'San Mateo',
                'website_url': 'https://sunset.edu',
                'created_at': None, 'last_activity_at': None,
                'school_admin_uids': ['u1'],
            }
        return None

    def list_org_memberships(self, *, org_id, roles=None):
        return [
            {'membership_id': 'm1', 'uid': 'u1', 'email': 'admin@sunset.edu',
             'name': 'Kim', 'roles': ['school_admin'], 'status': 'active'},
        ]


class OrgDetailRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeOrgDetailDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_returns_org_overview(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['name'], 'Sunset HS')
        self.assertEqual(data['status'], 'active')
        self.assertEqual(data['county'], 'San Mateo')
        self.assertEqual(len(data['schoolAdminContacts']), 1)
        self.assertEqual(data['schoolAdminContacts'][0]['email'], 'admin@sunset.edu')

    def test_writes_org_viewed_detail_audit(self):
        self.client.get('/api/lingual-admin/organizations/o1')
        self.assertEqual(len(self.audit.calls), 1)
        call = self.audit.calls[0]
        action = call['action']
        self.assertEqual(action.value if hasattr(action, 'value') else action,
                         'org_viewed_detail')
        self.assertEqual(call['target_org_id'], 'o1')

    def test_unknown_org_is_404(self):
        resp = self.client.get('/api/lingual-admin/organizations/nope')
        self.assertEqual(resp.status_code, 404)


if __name__ == '__main__':
    unittest.main()
