"""Route tests for DELETE /api/lingual-admin/organizations/<id>/members/<mid>
(Plan 5 Task 23 — Sprint C E2E acceptance for Plan 4's
`_sync_org_admin_uids(add=False)` invariant).

The route calls `database.remove_membership` (Task 7), which atomically
soft-removes the membership row and, when the role is `school_admin`,
strips the uid from `organizations/<orgId>.school_admin_uids` in the same
Firestore batch as the audit row.
"""
import unittest

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


class FakeMemberRemoveDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.removed = None

    def resolve_user_school_context(self, uid):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        return {'id': org_id, 'name': 'Sunset'} if org_id == 'o1' else None

    def get_membership(self, membership_id):
        if membership_id == 'm1':
            return {'id': 'm1', 'org_id': 'o1', 'uid': 'u1',
                    'roles': ['school_admin'], 'status': 'active'}
        return None

    def remove_membership(self, *, membership_id, actor_uid, audit_entry):
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.removed = dict(membership_id=membership_id, actor_uid=actor_uid,
                            audit_entry=audit_entry)
        return {'id': membership_id, 'uid': 'u1', 'org_id': 'o1',
                'roles': ['school_admin']}


class MemberRemovalRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeMemberRemoveDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_delete_with_reason(self):
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={'reason': 'teacher left school'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.removed['membership_id'], 'm1')

    def test_missing_reason_400(self):
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={},
        )
        self.assertEqual(resp.status_code, 400)

    def test_membership_belonging_to_other_org_404(self):
        """Membership exists but org_id doesn't match — should not be removable here."""
        resp = self.client.delete(
            '/api/lingual-admin/organizations/o2/members/m1',
            json={'reason': 'r'},
        )
        self.assertEqual(resp.status_code, 404)

    def test_audit_entry_passed_to_helper_atomically(self):
        self.client.delete(
            '/api/lingual-admin/organizations/o1/members/m1',
            json={'reason': 'r'},
        )
        # State-transition path: route MUST NOT call audit_logger.log;
        # it builds the doc and passes it to the DB helper.
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.removed['audit_entry']
        self.assertEqual(audit_entry['action'], 'membership_removed')
        meta = audit_entry['metadata']
        self.assertEqual(meta['reason'], 'r')
        self.assertIn('school_admin', meta['removed_roles'])
        self.assertEqual(meta['removed_uid'], 'u1')


if __name__ == '__main__':
    unittest.main()
