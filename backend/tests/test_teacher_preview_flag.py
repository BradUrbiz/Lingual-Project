import os
import unittest
from unittest import mock

from backend.services.pedagogy.integration import teacher_preview_enabled


class TeacherPreviewFlagTests(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_TEACHER_PREVIEW", None)
            self.assertFalse(teacher_preview_enabled())

    def test_truthy_values_on(self):
        for val in ("1", "true", "YES", "on"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_TEACHER_PREVIEW": val}):
                self.assertTrue(teacher_preview_enabled())


if __name__ == "__main__":
    unittest.main()
