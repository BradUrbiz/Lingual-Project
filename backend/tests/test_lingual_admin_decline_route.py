"""Route tests for POST /api/lingual-admin/requests/<id>/decline (Plan 5 Task 17).

Mirrors the Task 16 approve-route pattern: the route builds an `audit_entry`
via `deps.audit_logger.build_audit_doc(...)` and passes it to
`deps.db.reject_school_request(..., audit_entry=...)` so the audit row commits
in the same Firestore batch as the request-status update.

These tests exercise the route layer only — the DB helper is faked so the
test can assert that:
- the audit_entry dict the route builds is the one passed into the helper
  (not written via the fail-soft `AuditLogger.log` path),
- request body validation (reason required, category required, category
  membership) is enforced before the DB write, and
- the SCHOOL_REQUEST_DECLINED outbox email is enqueued so Task 24 can retire
  Plan 3's legacy endpoint without losing UX.
"""
import unittest
from unittest.mock import patch

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


VALID_CATEGORIES = ('info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other')


class FakeDeclineDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.declined = None

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
        }

    def reject_school_request(
        self,
        *,
        request_id,
        reviewer_uid,
        reason,
        category,
        internal_note=None,
        audit_entry=None,
    ):
        if not reason:
            raise ValueError('reason required')
        if category not in VALID_CATEGORIES:
            raise ValueError('invalid category')
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.declined = dict(
            request_id=request_id,
            reviewer_uid=reviewer_uid,
            reason=reason,
            category=category,
            internal_note=internal_note,
            audit_entry=audit_entry,
        )
        return {'request_id': request_id}


class DeclineRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeDeclineDb(), audit_logger=self.audit)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    @patch('backend.routes.lingual_admin.enqueue_outbox_email')
    @patch('backend.routes.lingual_admin.database.get_db')
    def test_decline_with_reason_and_category(self, mock_get_db, mock_enqueue):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'Cannot verify school', 'category': 'fraud_risk'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.declined['category'], 'fraud_risk')

    def test_missing_reason_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'category': 'fraud_risk'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_missing_category_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'x'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_invalid_category_400(self):
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'x', 'category': 'banana'},
        )
        self.assertEqual(resp.status_code, 400)

    @patch('backend.routes.lingual_admin.enqueue_outbox_email')
    @patch('backend.routes.lingual_admin.database.get_db')
    def test_passes_audit_entry_atomically_to_helper(self, mock_get_db, mock_enqueue):
        self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'r', 'category': 'duplicate'},
        )
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.declined['audit_entry']
        self.assertEqual(audit_entry['metadata']['category'], 'duplicate')
        self.assertEqual(audit_entry['metadata']['reason'], 'r')
        self.assertEqual(audit_entry['action'], 'request_declined')

    @patch('backend.routes.lingual_admin.enqueue_outbox_email')
    @patch('backend.routes.lingual_admin.database.get_db')
    def test_decline_fires_email_side_effect(self, mock_get_db, mock_enqueue):
        """Decline must fire the SCHOOL_REQUEST_DECLINED email to mirror Plan 3."""
        resp = self.client.post(
            '/api/lingual-admin/requests/r1/decline',
            json={'reason': 'Out of scope', 'category': 'out_of_scope'},
        )
        self.assertEqual(resp.status_code, 200)
        mock_enqueue.assert_called_once()
        call_kwargs = mock_enqueue.call_args.kwargs
        self.assertEqual(call_kwargs['recipient_email'], 'r@x.com')


if __name__ == '__main__':
    unittest.main()
