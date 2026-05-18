"""Tests for GET /api/organizations/search."""
from __future__ import annotations

import unittest

from backend.routes.teacher_requests import create_teacher_requests_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeOrgSearchDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.orgs_index: list = []

    def search_organizations(self, query, limit=10):
        q = (query or '').strip().lower()
        if not q:
            return []
        return [o for o in self.orgs_index if o['name'].lower().startswith(q)][:limit]


class OrgSearchRouteTest(unittest.TestCase):
    def _client(self):
        db = FakeOrgSearchDb()
        db.orgs_index = [
            {'id': 'org-1', 'name': 'San Francisco Friends School', 'city': 'San Francisco',
             'state': 'CA', 'school_type': 'k12'},
            {'id': 'org-2', 'name': 'San Diego High', 'city': 'San Diego',
             'state': 'CA', 'school_type': 'high'},
            {'id': 'org-3', 'name': 'Boston Latin', 'city': 'Boston',
             'state': 'MA', 'school_type': 'high'},
        ]
        deps = make_test_deps(db=db)
        bp = create_teacher_requests_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}
        return client, db

    def test_search_returns_filtered_results(self):
        client, _ = self._client()
        resp = client.get('/api/organizations/search?q=san')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        names = [r['name'] for r in body['results']]
        self.assertIn('San Francisco Friends School', names)
        self.assertIn('San Diego High', names)
        self.assertNotIn('Boston Latin', names)

    def test_search_empty_query_returns_empty(self):
        client, _ = self._client()
        resp = client.get('/api/organizations/search?q=')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['results'], [])

    def test_search_requires_auth(self):
        db = FakeOrgSearchDb()
        deps = make_test_deps(db=db)
        bp = create_teacher_requests_blueprint(deps)
        app = make_test_app(bp)
        client = app.test_client()
        resp = client.get('/api/organizations/search?q=san')
        self.assertEqual(resp.status_code, 401)

    def test_search_rate_limit_blocks_after_threshold(self):
        """Deterministic via monkey-patched time.monotonic — wall clock independent."""
        client, _ = self._client()
        from unittest.mock import patch
        from backend.routes import teacher_requests as tr_module
        # Clear any state from prior tests in the module.
        tr_module._RATE_LIMIT_PER_UID.clear()
        # Freeze time so the 1s window never rolls; 11th request must 429.
        with patch.object(tr_module.time, 'monotonic', return_value=1000.0):
            statuses = []
            for _ in range(12):
                resp = client.get('/api/organizations/search?q=san')
                statuses.append(resp.status_code)
        # First 10 succeed, next 2 are rate-limited.
        self.assertEqual(statuses[:10], [200] * 10, f"first 10 should all 200: {statuses}")
        self.assertEqual(statuses[10:], [429, 429], f"requests 11+12 should 429: {statuses}")

    def test_rate_limit_window_clears_after_advance(self):
        """Advancing past the window resets the bucket."""
        client, _ = self._client()
        from unittest.mock import patch
        from backend.routes import teacher_requests as tr_module
        tr_module._RATE_LIMIT_PER_UID.clear()

        with patch.object(tr_module.time, 'monotonic') as mock_clock:
            mock_clock.return_value = 1000.0
            for _ in range(10):
                client.get('/api/organizations/search?q=san')
            blocked = client.get('/api/organizations/search?q=san')
            self.assertEqual(blocked.status_code, 429)
            # Advance past the 1-second window
            mock_clock.return_value = 1002.0
            unblocked = client.get('/api/organizations/search?q=san')
            self.assertEqual(unblocked.status_code, 200)
