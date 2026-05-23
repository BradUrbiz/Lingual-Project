"""LTI URL generation must use PUBLIC_BASE_URL, not Flask's request state.

ProxyFix is configured with `x_proto=0, x_host=0` (see main.py) to prevent
forwarded-header spoofing. The trade-off: Flask sees the request as HTTP
behind Cloud Run's HTTPS terminator. If LTI URLs were built from
`request.host_url` or `url_for(_external=True)`, they would emit
`http://...` and Canvas would reject them.

The fix at backend/routes/lti.py: `_lti_callback_url()` reads
`PUBLIC_BASE_URL` instead.
"""
import os
import unittest
from unittest.mock import patch

from backend.routes.lti import _lti_callback_url


class LtiCallbackUrlTest(unittest.TestCase):
    def test_uses_public_base_url_when_set(self):
        with patch.dict(os.environ, {'PUBLIC_BASE_URL': 'https://l1ngual.com'}):
            self.assertEqual(_lti_callback_url(), 'https://l1ngual.com/lti/callback')

    def test_strips_trailing_slash_on_base(self):
        with patch.dict(os.environ, {'PUBLIC_BASE_URL': 'https://l1ngual.com/'}):
            self.assertEqual(_lti_callback_url(), 'https://l1ngual.com/lti/callback')

    def test_falls_back_to_production_default(self):
        env = {k: v for k, v in os.environ.items() if k != 'PUBLIC_BASE_URL'}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(_lti_callback_url(), 'https://l1ngual.com/lti/callback')

    def test_honors_https_scheme_for_dev_overrides(self):
        with patch.dict(os.environ, {'PUBLIC_BASE_URL': 'https://staging.l1ngual.com'}):
            self.assertTrue(_lti_callback_url().startswith('https://'))


if __name__ == '__main__':
    unittest.main()
