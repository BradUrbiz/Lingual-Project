"""Tests for Task 5: assignment language-mix policy parametrized on native_language.

Three meaningful tests (not the tautological brief sketch):
1. test_english_native_byte_identical: Spanish class + ui_language='en' renders
   identical policy to PEDAGOGY_NATIVE_SCAFFOLDING=0 (flag off → forced English).
2. test_korean_native_uses_korean_support: Korean support appears when ui='ko'.
3. test_flag_off_forces_english_even_for_ko: Flag=0 keeps English even for ko.
"""
import os
import unittest
from types import SimpleNamespace
from unittest import mock

from backend.services.assignment_resolver import resolve_assignment_bootstrap


def _make_deps():
    from backend.tests.test_assignment_resolver import FakeResolverDb
    return SimpleNamespace(db=FakeResolverDb())


def _policy_for(intensity, ui_language, *, subject="Spanish", learning_locale="es-ES"):
    """Render the ## Language Mix block via the public resolver.

    Uses a Spanish class so target != native for the 'en' path (avoids the
    tautological target==native=="English" scenario in the brief's sketch).
    Returns systemPromptPreview which embeds the ## Language Mix section.
    """
    assignment = {
        "id": "a-test",
        "org_id": "org-1",
        "class_id": "c-test",
        "title": "Test assignment",
        "status": "published",
        "task_type": "scenario",
        "generated_scenario": "Order a coffee at a café.",
        "target_language_intensity": intensity,
    }
    class_record = {
        "id": "c-test",
        "org_id": "org-1",
        "name": "Spanish 101",
        "learning_locale": learning_locale,
        "subject": subject,
        "status": "active",
    }
    bootstrap = resolve_assignment_bootstrap(
        _make_deps(),
        assignment=assignment,
        class_record=class_record,
        ui_language=ui_language,
    )
    return bootstrap["systemPromptPreview"]


class AssignmentNativeScaffoldingTestCase(unittest.TestCase):

    def test_english_native_byte_identical(self):
        """ui_language='en' must produce identical policy to flag-off (forced English).

        Uses a Spanish class (target != native) so we're actually comparing
        English-support text, not a tautological English==English==Spanish case.
        """
        for intensity in ("target_only", "target_led", "balanced", "english_led", "english_first"):
            with self.subTest(intensity=intensity):
                with mock.patch.dict("os.environ", {"PEDAGOGY_NATIVE_SCAFFOLDING": "0"}):
                    flag_off = _policy_for(intensity, "ko")  # flag=0 forces English regardless of ui
                with mock.patch.dict("os.environ", {"PEDAGOGY_NATIVE_SCAFFOLDING": "1"}):
                    en_native = _policy_for(intensity, "en")  # en resolves to English
                self.assertEqual(
                    en_native,
                    flag_off,
                    f"[{intensity}] ui_language='en' output differs from flag-off output — byte-identical invariant broken",
                )

    def test_korean_native_uses_korean_support(self):
        """Korean UI with english_led intensity should say 'Korean leads the conversation'."""
        with mock.patch.dict("os.environ", {"PEDAGOGY_NATIVE_SCAFFOLDING": "1"}):
            preview = _policy_for("english_led", "ko")
        self.assertIn("Korean leads the conversation", preview)

    @mock.patch.dict("os.environ", {"PEDAGOGY_NATIVE_SCAFFOLDING": "0"})
    def test_flag_off_forces_english_even_for_ko(self):
        """Flag=0 must force 'English' as support language even when ui_language='ko'."""
        preview = _policy_for("english_led", "ko")
        self.assertIn("English leads the conversation", preview)


if __name__ == "__main__":
    unittest.main()
