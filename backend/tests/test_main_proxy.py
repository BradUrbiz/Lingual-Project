import unittest

from werkzeug.middleware.proxy_fix import ProxyFix

import main


class MainProxyConfigurationTest(unittest.TestCase):
    def test_app_trusts_one_proxy_hop_for_forwarded_headers(self):
        self.assertIsInstance(main.app.wsgi_app, ProxyFix)


if __name__ == '__main__':
    unittest.main()
