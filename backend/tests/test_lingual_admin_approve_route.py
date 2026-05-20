"""Route tests for POST /api/lingual-admin/requests/<id>/approve (Plan 5 Task 16).

The route builds an `audit_entry` via `deps.audit_logger.build_audit_doc(...)`
and passes it to `deps.db.approve_school_request(..., audit_entry=...)` so the
audit row commits in the same Firestore batch as the org/membership/request
writes. This is the same "atomic with audit" pattern used by Task 8 (suspend)
and Task 9 (restore), enforced by Plan 5's audit trust boundary.

These tests exercise the route layer only — the DB helper is faked so the
test can assert that:
- the audit_entry dict the route builds is the one passed into the helper
  (not written via the fail-soft `AuditLogger.log` path), and
- the response surface (`createdOrgId`, `membershipId`,
  `preInviteInvitationIds`) is camelCased from the helper's snake_case keys.
"""
import unittest

from backend.tests.conftest import (
    FakeAuditLogger,
    FakeDbBase,
    make_test_app,
    make_test_deps,
)


class FakeApproveDb(FakeDbBase):
    """Minimal fake exposing only the surface the approve route needs.

    `approve_school_request` here mirrors the *new* helper contract (kwargs +
    `audit_entry` + dict return shape with `pre_invite_invitation_ids`) so
    the route's wiring is verified end-to-end without touching Firestore.
    """

    def __init__(self):
        super().__init__()
        self.approved = None

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        return {
            'id': request_id,
            'status': 'pending',
            'school_name': 'Sunset',
            'requester_uid': 'u1',
            'requester_email': 'r@x.com',
            'requester_name': 'R',
            'pre_invited_teachers': ['a@x.com', 'b@x.com'],
        }

    def approve_school_request(
        self,
        *,
        request_id,
        reviewer_uid,
        internal_note=None,
        audit_entry=None,
    ):
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.approved = dict(
            request_id=request_id,
            reviewer_uid=reviewer_uid,
            internal_note=internal_note,
            audit_entry=audit_entry,
        )
        return {
            'request_id': request_id,
            'created_org_id': 'org-new',
            'membership_id': 'm-new',
            'pre_invite_invitation_ids': ['ti-1', 'ti-2'],
        }


class ApproveRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint

        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeApproveDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_calls_db_and_returns_result(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/approve',
            json={'internalNote': 'Verified via NCES'},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['createdOrgId'], 'org-new')
        self.assertEqual(data['membershipId'], 'm-new')
        self.assertEqual(data['preInviteInvitationIds'], ['ti-1', 'ti-2'])
        self.assertEqual(self.deps.db.approved['internal_note'], 'Verified via NCES')

    def test_passes_audit_entry_atomically_to_helper(self):
        """Audit doc is built by the route and passed to the helper so
        it commits in the same batch as the org/membership writes."""
        self.client.post('/api/lingual-admin/requests/r1/approve', json={})
        self.assertEqual(len(self.audit.calls), 0)  # NOT via AuditLogger.log
        audit_entry = self.deps.db.approved['audit_entry']
        self.assertEqual(audit_entry['actor_uid'], 'admin-uid')
        self.assertEqual(audit_entry['action'], 'request_approved')
        self.assertEqual(audit_entry['target']['type'], 'school_request')
        self.assertEqual(audit_entry['target']['id'], 'r1')

    def test_internal_note_too_long_rejected(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/approve',
            json={'internalNote': 'x' * 5000},
        )
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'x'}
        resp = self.client.post('/api/lingual-admin/requests/r1/approve', json={})
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
