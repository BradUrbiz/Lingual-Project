"""
Unit tests for LTI ToolConf (FirestoreToolConf) and JWKS key management.
"""

from __future__ import annotations

import unittest

from backend.services.lti.config import FirestoreToolConf
from backend.services.lti.keys import get_jwks
from backend.tests.conftest import FakeDbBase


# ---------------------------------------------------------------------------
# Fake DB with LTI platform support
# ---------------------------------------------------------------------------

class FakeLtiDb(FakeDbBase):
    """FakeDbBase extended with LTI platform methods."""

    def __init__(self):
        super().__init__()
        self.lti_platforms: dict[str, dict] = {}

    def get_lti_platform_by_issuer(self, issuer: str):
        for p in self.lti_platforms.values():
            if p.get('issuer') == issuer:
                return dict(p)
        return None

    def get_lti_platform_by_issuer_and_client_id(self, issuer: str, client_id: str):
        for p in self.lti_platforms.values():
            if p.get('issuer') == issuer and p.get('client_id') == client_id:
                return dict(p)
        return None

    def get_lti_platform_by_issuer_client_deployment(self, issuer: str, client_id: str, deployment_id: str):
        for p in self.lti_platforms.values():
            if (
                p.get('issuer') == issuer
                and p.get('client_id') == client_id
                and p.get('deployment_id') == deployment_id
            ):
                return dict(p)
        return None

    def get_lti_platform_by_org(self, org_id: str):
        for p in self.lti_platforms.values():
            if p.get('org_id') == org_id:
                return dict(p)
        return None

    def create_lti_platform(
        self, org_id, issuer, client_id, deployment_id,
        auth_login_url, auth_token_url, key_set_url, **kwargs
    ) -> str:
        pid = self._next_id('lti-platform')
        self.lti_platforms[pid] = {
            'id': pid,
            'org_id': org_id,
            'issuer': issuer,
            'client_id': client_id,
            'deployment_id': deployment_id,
            'auth_login_url': auth_login_url,
            'auth_token_url': auth_token_url,
            'key_set_url': key_set_url,
        }
        return pid

    def delete_lti_platform(self, platform_id: str):
        self.lti_platforms.pop(platform_id, None)


SAMPLE_PLATFORM = {
    'id': 'plat-1',
    'org_id': 'org-1',
    'issuer': 'https://canvas.example.edu',
    'client_id': '10000000001',
    'deployment_id': '1',
    'auth_login_url': 'https://canvas.example.edu/api/lti/authorize_redirect',
    'auth_token_url': 'https://canvas.example.edu/login/oauth2/token',
    'key_set_url': 'https://canvas.example.edu/api/lti/security/jwks',
}


class TestFirestoreToolConfRegistration(unittest.TestCase):
    """Tests for FirestoreToolConf.find_registration_by_issuer."""

    def setUp(self):
        self.db = FakeLtiDb()
        self.db.lti_platforms['plat-1'] = dict(SAMPLE_PLATFORM)
        self.tool_conf = FirestoreToolConf(self.db)

    def test_find_registration_by_issuer(self):
        """Returns a Registration when platform exists for the issuer."""
        reg = self.tool_conf.find_registration_by_issuer('https://canvas.example.edu')
        self.assertIsNotNone(reg)
        self.assertEqual(reg.get_issuer(), 'https://canvas.example.edu')
        self.assertEqual(reg.get_client_id(), '10000000001')

    def test_find_registration_raises_when_not_found(self):
        """Returns None when no platform matches the issuer."""
        reg = self.tool_conf.find_registration_by_issuer('https://unknown.example.edu')
        self.assertIsNone(reg)

    def test_find_registration_by_params_uses_client_id_for_shared_issuer(self):
        """Same Canvas issuer can back multiple org-specific client IDs."""
        self.db.lti_platforms['plat-2'] = {
            **SAMPLE_PLATFORM,
            'id': 'plat-2',
            'org_id': 'org-2',
            'client_id': '20000000002',
            'deployment_id': '2',
        }

        reg = self.tool_conf.find_registration_by_params(
            'https://canvas.example.edu',
            '20000000002',
        )

        self.assertIsNotNone(reg)
        self.assertEqual(reg.get_client_id(), '20000000002')

    def test_tool_conf_declares_many_clients_per_issuer(self):
        """pylti should ask for client_id when resolving shared issuers."""
        self.assertFalse(self.tool_conf.check_iss_has_one_client('https://canvas.example.edu'))
        self.assertTrue(self.tool_conf.check_iss_has_many_clients('https://canvas.example.edu'))


class TestFirestoreToolConfDeployment(unittest.TestCase):
    """Tests for FirestoreToolConf.find_deployment."""

    def setUp(self):
        self.db = FakeLtiDb()
        self.db.lti_platforms['plat-1'] = dict(SAMPLE_PLATFORM)
        self.tool_conf = FirestoreToolConf(self.db)

    def test_find_deployment(self):
        """Returns a Deployment when issuer and deployment_id match."""
        dep = self.tool_conf.find_deployment('https://canvas.example.edu', '1')
        self.assertIsNotNone(dep)
        self.assertEqual(dep.get_deployment_id(), '1')

    def test_find_deployment_returns_none_for_wrong_id(self):
        """Returns None when deployment_id does not match."""
        dep = self.tool_conf.find_deployment('https://canvas.example.edu', '999')
        self.assertIsNone(dep)

    def test_find_deployment_by_params_uses_client_id_for_shared_issuer(self):
        """Deployment lookup must not return the first org on a shared issuer."""
        self.db.lti_platforms['plat-2'] = {
            **SAMPLE_PLATFORM,
            'id': 'plat-2',
            'org_id': 'org-2',
            'client_id': '20000000002',
            'deployment_id': '2',
        }

        dep = self.tool_conf.find_deployment_by_params(
            'https://canvas.example.edu',
            '2',
            '20000000002',
        )

        self.assertIsNotNone(dep)
        self.assertEqual(dep.get_deployment_id(), '2')


class TestGetJwks(unittest.TestCase):
    """Tests for the JWKS key generation."""

    def test_get_jwks(self):
        """get_jwks returns a dict with a non-empty 'keys' list."""
        jwks = get_jwks()
        self.assertIn('keys', jwks)
        self.assertIsInstance(jwks['keys'], list)
        self.assertGreater(len(jwks['keys']), 0)
        # Each key should have standard JWK fields
        key = jwks['keys'][0]
        self.assertEqual(key['kty'], 'RSA')
        self.assertEqual(key['alg'], 'RS256')
        self.assertIn('kid', key)
        self.assertIn('n', key)
        self.assertIn('e', key)


if __name__ == '__main__':
    unittest.main()
