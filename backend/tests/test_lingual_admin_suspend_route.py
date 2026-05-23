"""Route tests for POST /api/lingual-admin/organizations/<id>/suspend (Plan 5 Task 21).

Mirrors the Task 16/17 (approve/decline) pattern: the route builds an
`audit_entry` via `deps.audit_logger.build_audit_doc(...)` and passes it to
`deps.db.suspend_organization(..., audit_entry=...)` so the audit row commits
in the same Firestore batch as the org-status transition.

The route also fans out an `org_suspended` notification email to every active
school_admin of the org via `enqueue_outbox_email`. The outbox helper is
patched here so the test does not require a real Firestore client; we still
assert one enqueue call per recipient with the correct template.
"""
import datetime
import unittest
from unittest.mock import patch

from backend.tests.conftest import FakeDbBase, FakeAuditLogger, make_test_deps, make_test_app


enqueued: list[dict] = []


def fake_enqueue(*args, **kwargs):
    enqueued.append(kwargs)


class FakeSuspendDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.suspended = None

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_organization(self, org_id):
        if org_id == 'o1':
            return {'id': 'o1', 'name': 'Sunset HS', 'status': 'active'}
        return None

    def suspend_organization(self, *, org_id, actor_uid, reason, suspended_until, audit_entry):
        if not reason:
            raise ValueError('reason required')
        if audit_entry is None:
            raise ValueError('audit_entry is required')
        self.suspended = dict(
            org_id=org_id,
            actor_uid=actor_uid,
            reason=reason,
            suspended_until=suspended_until,
            audit_entry=audit_entry,
        )

    def list_school_admin_emails(self, org_id):
        return [
            {'uid': 'u1', 'email': 'admin@sunset.edu', 'name': 'Kim'},
            {'uid': 'u2', 'email': 'second@sunset.edu', 'name': 'Lee'},
        ]


class SuspendRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        enqueued.clear()
        self.audit = FakeAuditLogger()
        self.deps = make_test_deps(db=FakeSuspendDb(), audit_logger=self.audit)
        # Patch both: the outbox enqueue (so we capture calls) AND
        # database.get_db (so the route's `db=database.get_db()` argument
        # doesn't blow up trying to initialize the Firebase Admin SDK
        # under the test runner). Mirrors the Task 17 decline-route pattern.
        self.enqueue_patcher = patch(
            'backend.routes.lingual_admin.enqueue_outbox_email',
            side_effect=fake_enqueue,
        )
        self.db_patcher = patch('backend.routes.lingual_admin.database.get_db')
        self.enqueue_patcher.start()
        self.db_patcher.start()
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def tearDown(self):
        self.enqueue_patcher.stop()
        self.db_patcher.stop()

    def test_suspend_with_reason(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'compliance review', 'suspendedUntil': None},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.deps.db.suspended['reason'], 'compliance review')
        self.assertIsNone(self.deps.db.suspended['suspended_until'])

    def test_suspend_with_until(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'temp', 'suspendedUntil': '2026-06-01T00:00:00Z'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(self.deps.db.suspended['suspended_until'], datetime.datetime)

    def test_missing_reason_400(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={},
        )
        self.assertEqual(resp.status_code, 400)

    def test_emails_each_school_admin(self):
        self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'r'},
        )
        self.assertEqual(len(enqueued), 2)
        templates = [e.get('template') or e.get('template_id') for e in enqueued]
        for t in templates:
            t_val = t.value if hasattr(t, 'value') else t
            self.assertEqual(t_val, 'org_suspended')

    def test_passes_audit_entry_to_db_helper(self):
        self.client.post(
            '/api/lingual-admin/organizations/o1/suspend',
            json={'reason': 'r'},
        )
        # State-transition path: route MUST NOT call audit_logger.log;
        # it builds the doc and passes it to the DB helper.
        self.assertEqual(len(self.audit.calls), 0)
        audit_entry = self.deps.db.suspended['audit_entry']
        self.assertEqual(audit_entry['action'], 'org_suspended')
        self.assertEqual(audit_entry['target']['id'], 'o1')
        self.assertEqual(audit_entry['target_org_id'], 'o1')

    def test_unknown_org_404(self):
        resp = self.client.post(
            '/api/lingual-admin/organizations/nope/suspend',
            json={'reason': 'r'},
        )
        self.assertEqual(resp.status_code, 404)


if __name__ == '__main__':
    unittest.main()
