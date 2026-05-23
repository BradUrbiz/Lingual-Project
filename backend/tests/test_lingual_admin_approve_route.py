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
from unittest.mock import patch

from backend.services.outbox import OutboxTemplate
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

    `update_user_profile` calls are captured into `profile_updates` so the
    onboarding-state side effect can be asserted independently of the
    `FakeDbBase` no-op default.
    """

    def __init__(self):
        super().__init__()
        self.approved = None
        self.profile_updates = []

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        # Called twice by the route: once via the audit/approve path (the
        # helper itself), once after success to read the row for side-effect
        # fan-out. Returning the same dict each time matches real behavior
        # closely enough for route-layer assertions.
        return {
            'id': request_id,
            'status': 'pending',
            'school_name': 'Sunset',
            'requester_uid': 'u1',
            'requester_email': 'r@x.com',
            'requester_name': 'R',
            'admin_identity': {'full_name': 'Admin R'},
            'pre_invited_teachers': ['a@x.com', 'b@x.com'],
        }

    def update_user_profile(self, uid, **kwargs):
        self.profile_updates.append({'uid': uid, **kwargs})

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

    def test_approval_fires_email_and_onboarding_side_effects(self):
        """After a successful approval, the route must:

        1. Advance the requester's onboarding_state to 'complete'.
        2. Enqueue a SCHOOL_REQUEST_APPROVED outbox email to the requester.
        3. Enqueue one TEACHER_INVITATION outbox email per pre-invited teacher.

        These side effects mirror Plan 3's legacy approve endpoint so Task 24
        can retire it without losing the approval UX.
        """
        with patch(
            'backend.routes.lingual_admin.database.get_db',
            return_value=object(),
        ), patch(
            'backend.routes.lingual_admin.enqueue_outbox_email',
            return_value='outbox-id',
        ) as mock_enqueue:
            resp = self.client.post(
                '/api/lingual-admin/requests/r1/approve',
                json={},
            )
        self.assertEqual(resp.status_code, 200)

        # Onboarding advance
        self.assertEqual(len(self.deps.db.profile_updates), 1)
        self.assertEqual(self.deps.db.profile_updates[0]['uid'], 'u1')
        self.assertEqual(
            self.deps.db.profile_updates[0].get('onboarding_state'),
            'complete',
        )

        # Email fan-out: 1 approval + 2 teacher invitations.
        self.assertEqual(mock_enqueue.call_count, 3)
        templates = [
            call.kwargs.get('template') for call in mock_enqueue.call_args_list
        ]
        self.assertEqual(
            templates,
            [
                OutboxTemplate.SCHOOL_REQUEST_APPROVED,
                OutboxTemplate.TEACHER_INVITATION,
                OutboxTemplate.TEACHER_INVITATION,
            ],
        )

        # Approval email goes to the requester.
        approval_call = mock_enqueue.call_args_list[0]
        self.assertEqual(approval_call.kwargs['recipient_email'], 'r@x.com')
        self.assertEqual(approval_call.kwargs['related_entity_type'], 'school_request')
        self.assertEqual(approval_call.kwargs['related_entity_id'], 'r1')
        self.assertEqual(approval_call.kwargs['created_by_uid'], 'admin-uid')
        self.assertEqual(approval_call.kwargs['template_data']['org_name'], 'Sunset')

        # Teacher invitations go to each pre-invited address.
        invite_emails = [
            call.kwargs['recipient_email']
            for call in mock_enqueue.call_args_list[1:]
        ]
        self.assertEqual(invite_emails, ['a@x.com', 'b@x.com'])
        for call in mock_enqueue.call_args_list[1:]:
            self.assertEqual(call.kwargs['related_entity_type'], 'school_request')
            self.assertEqual(call.kwargs['related_entity_id'], 'r1')
            self.assertEqual(call.kwargs['created_by_uid'], 'admin-uid')
            self.assertEqual(call.kwargs['template_data']['org_name'], 'Sunset')

    def test_approval_does_not_fail_when_email_enqueue_raises(self):
        """Outbox enqueue failures are best-effort — approval still 200s."""
        with patch(
            'backend.routes.lingual_admin.enqueue_outbox_email',
            side_effect=RuntimeError('outbox boom'),
        ):
            resp = self.client.post(
                '/api/lingual-admin/requests/r1/approve',
                json={},
            )
        self.assertEqual(resp.status_code, 200)
        # The atomic Firestore write still succeeded.
        self.assertIsNotNone(self.deps.db.approved)
        # Onboarding state still advanced (independent of email errors).
        self.assertEqual(len(self.deps.db.profile_updates), 1)


if __name__ == '__main__':
    unittest.main()
