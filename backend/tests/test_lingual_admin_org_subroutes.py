"""Route tests for /api/lingual-admin/organizations/<orgId> subroutes (Plan 5 Task 20).

Covers:
- GET /organizations/<orgId>/members — staff memberships + student headcount
- GET /organizations/<orgId>/classes — class metadata rows (via list_org_classes_summary)
- GET /organizations/<orgId>/audit — org-scoped audit feed
- Each subroute 404s when the org id is unknown
"""
import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeSubrouteDb(FakeDbBase):
    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        return {'id': org_id, 'name': 'Sunset', 'status': 'active'} if org_id == 'o1' else None

    def list_org_memberships(self, *, org_id, roles=None):
        return [
            {'membership_id': 'm1', 'uid': 'u1', 'email': 'a@x.com', 'name': 'A',
             'roles': ['school_admin'], 'status': 'active', 'joined_at': None},
            {'membership_id': 'm2', 'uid': 'u2', 'email': 'b@x.com', 'name': 'B',
             'roles': ['teacher'], 'status': 'active', 'joined_at': None},
        ]

    def count_org_students(self, *, org_id):
        return 42

    def list_org_classes_summary(self, *, org_id):
        return [{'id': 'c1', 'name': 'Spanish I', 'term': 'F26',
                 'subject': 'spanish', 'teacher_membership_ids': ['m1'],
                 'created_at': None, 'last_activity_at': None}]

    def list_org_audit_events(self, *, org_id, limit):
        return [{'id': 'a1', 'action': 'org_suspended', 'actor_uid': 'admin-uid',
                 'metadata': {'reason': 'r'}, 'created_at': None,
                 'target': {'type': 'organization', 'id': 'o1'}, 'target_org_id': 'o1'}]


class MembersClassesAuditRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.deps = make_test_deps(db=FakeSubrouteDb())
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_members_returns_staff_plus_student_count(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/members')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['members']), 2)
        self.assertEqual(data['studentCount'], 42)
        self.assertEqual(data['members'][0]['membershipId'], 'm1')

    def test_classes_returns_metadata_rows(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/classes')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['name'], 'Spanish I')
        self.assertEqual(data['items'][0]['teacherMembershipIds'], ['m1'])

    def test_audit_returns_org_scoped_rows(self):
        resp = self.client.get('/api/lingual-admin/organizations/o1/audit')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['action'], 'org_suspended')

    def test_unknown_org_is_404_on_each(self):
        for sub in ('members', 'classes', 'audit'):
            resp = self.client.get(f'/api/lingual-admin/organizations/nope/{sub}')
            self.assertEqual(resp.status_code, 404, msg=f'/{sub} should 404')


if __name__ == '__main__':
    unittest.main()
