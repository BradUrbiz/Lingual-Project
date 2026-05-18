"""Verify /api/schools/join-as-teacher now redirects to the new endpoint."""
from __future__ import annotations

import unittest

from backend.routes.schools import create_schools_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class LegacyJoinAsTeacherRedirectTest(unittest.TestCase):
    def test_returns_410_gone_pointing_to_new_endpoint(self):
        db = FakeDbBase()
        deps = make_test_deps(db=db)
        bp = create_schools_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/schools/join-as-teacher', json={'inviteCode': 'ABC123'})
        self.assertEqual(resp.status_code, 410)
        body = resp.get_json()
        self.assertIn('/api/teacher-join-requests', body.get('error', ''))
