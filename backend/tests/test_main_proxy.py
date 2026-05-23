import unittest

from werkzeug.middleware.proxy_fix import ProxyFix

import main


class MainProxyConfigurationTest(unittest.TestCase):
    def test_app_trusts_only_one_x_forwarded_for_hop(self):
        """ProxyFix must trust exactly one upstream hop for the client IP and
        NOT trust X-Forwarded-Host or X-Forwarded-Proto. Trusting host/proto
        would let a spoofed forwarded header poison Flask's canonical host
        (used by request.host) and therefore any URL generation that depends
        on it (e.g., LTI callback / deep-link URLs)."""
        wsgi = main.app.wsgi_app
        self.assertIsInstance(wsgi, ProxyFix)
        self.assertEqual(wsgi.x_for, 1)
        self.assertEqual(wsgi.x_proto, 0)
        self.assertEqual(wsgi.x_host, 0)
        self.assertEqual(wsgi.x_port, 0)
        self.assertEqual(wsgi.x_prefix, 0)


if __name__ == '__main__':
    unittest.main()
