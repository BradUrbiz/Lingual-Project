"""Tests for backend.services.audit_utils — shared identity-capture helpers
used by both Plan 3 (school_requests) and Plan 5 (lingual_admin) so the
audit trust boundary cannot drift between routes."""
import unittest
from unittest.mock import patch

from flask import Flask

from backend.services import audit_utils


class HashIpTests(unittest.TestCase):
    def test_empty_yields_empty(self):
        self.assertEqual(audit_utils.hash_ip(''), '')
        self.assertEqual(audit_utils.hash_ip(None), '')

    @patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-x'})
    def test_same_ip_same_salt_yields_same_hash(self):
        h1 = audit_utils.hash_ip('1.2.3.4')
        h2 = audit_utils.hash_ip('1.2.3.4')
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 32)

    @patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-a'})
    def test_different_salt_different_hash(self):
        h_a = audit_utils.hash_ip('1.2.3.4')
        with patch.dict('os.environ', {'ATTESTATION_HASH_SALT': 'salt-b'}):
            h_b = audit_utils.hash_ip('1.2.3.4')
        self.assertNotEqual(h_a, h_b)


class PublicBaseUrlTests(unittest.TestCase):
    @patch.dict('os.environ', {'PUBLIC_BASE_URL': 'https://staging.l1ngual.com'})
    def test_reads_env(self):
        self.assertEqual(audit_utils.public_base_url(), 'https://staging.l1ngual.com')

    @patch.dict('os.environ', {}, clear=True)
    def test_default_is_production(self):
        self.assertEqual(audit_utils.public_base_url(), 'https://l1ngual.com')


class FlaskRequestHelpersTests(unittest.TestCase):
    def _ctx(self, **kwargs):
        app = Flask(__name__)
        return app.test_request_context(**kwargs)

    def test_client_ip_returns_remote_addr(self):
        with self._ctx(environ_base={'REMOTE_ADDR': '1.2.3.4'}):
            self.assertEqual(audit_utils.client_ip(), '1.2.3.4')

    def test_client_ip_returns_empty_when_missing(self):
        with self._ctx(environ_base={'REMOTE_ADDR': ''}):
            self.assertEqual(audit_utils.client_ip(), '')

    def test_user_agent_truncates(self):
        with self._ctx(headers={'User-Agent': 'x' * 1000}):
            self.assertEqual(len(audit_utils.user_agent()), 255)


if __name__ == '__main__':
    unittest.main()
