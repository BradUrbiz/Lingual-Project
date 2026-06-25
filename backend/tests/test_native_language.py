import inspect
import re
import unittest
from unittest import mock

from backend.services.native_language import (
    DEFAULT_NATIVE_LANGUAGE,
    resolve_native_language,
    native_scaffolding_enabled,
)
import backend.services.native_language as _native_language_module


class NativeLanguageTestCase(unittest.TestCase):
    def test_default_is_english(self):
        self.assertEqual(DEFAULT_NATIVE_LANGUAGE, 'English')

    def test_en_resolves_to_english(self):
        self.assertEqual(resolve_native_language('en'), 'English')

    def test_ko_resolves_to_korean(self):
        self.assertEqual(resolve_native_language('ko'), 'Korean')

    def test_unknown_resolves_to_english(self):
        self.assertEqual(resolve_native_language('xx'), 'English')
        self.assertEqual(resolve_native_language(None), 'English')

    @mock.patch.dict('os.environ', {'PEDAGOGY_NATIVE_SCAFFOLDING': '0'})
    def test_flag_off_forces_english(self):
        self.assertFalse(native_scaffolding_enabled())
        self.assertEqual(resolve_native_language('ko'), 'English')

    @mock.patch.dict('os.environ', {'PEDAGOGY_NATIVE_SCAFFOLDING': '1'})
    def test_flag_on_allows_korean(self):
        self.assertTrue(native_scaffolding_enabled())
        self.assertEqual(resolve_native_language('ko'), 'Korean')


class StdlibBoundaryTestCase(unittest.TestCase):
    """Assert that native_language.py only imports stdlib modules (os)."""

    def test_only_stdlib_imports(self):
        source = inspect.getsource(_native_language_module)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if re.match(r'^\s*(import|from)\s+', line)
        ]
        for line in import_lines:
            # Allow only 'import os' or 'from os ...'
            self.assertRegex(
                line,
                r'^(import os|from os\b)',
                msg=f"Non-stdlib import found in native_language.py: {line!r}",
            )


if __name__ == '__main__':
    unittest.main()
