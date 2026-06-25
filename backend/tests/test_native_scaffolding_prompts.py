# backend/tests/test_native_scaffolding_prompts.py
import unittest
from unittest import mock

import main
from main import build_free_practice_language_mix_policy


class FreePracticeMixPolicyNativeTestCase(unittest.TestCase):
    LEVELS = ['english_first', 'english_led', 'target_led', 'target_only', 'balanced']

    def test_default_native_is_byte_identical_for_english(self):
        # Capturing the CURRENT output as the golden: calling with the default
        # native_language must equal calling with native_language="English".
        for level in self.LEVELS:
            with self.subTest(level=level):
                self.assertEqual(
                    build_free_practice_language_mix_policy('Spanish', level),
                    build_free_practice_language_mix_policy('Spanish', level, native_language='English'),
                )

    def test_korean_native_replaces_support_language(self):
        # Korean learner of English: target=English, support=Korean.
        policy = build_free_practice_language_mix_policy('English', 'english_first', native_language='Korean')
        self.assertIn('Korean', policy)
        self.assertIn('Lead each turn in Korean', policy)
        # The enum name echo must remain literal.
        self.assertIn('is english_first', policy)

    def test_korean_native_no_stray_english_support(self):
        # In english_led, the support language leads; with Korean native it must say Korean leads.
        policy = build_free_practice_language_mix_policy('English', 'english_led', native_language='Korean')
        self.assertIn('Korean leads the conversation', policy)


class BuildSystemPromptNativeTestCase(unittest.TestCase):
    def test_default_native_byte_identical(self):
        from main import build_system_prompt
        self.assertEqual(
            build_system_prompt('PROFICIENCY', 'es-ES', 'balanced'),
            build_system_prompt('PROFICIENCY', 'es-ES', 'balanced', native_language='English'),
        )

    def test_korean_native_in_template(self):
        from main import build_system_prompt
        prompt = build_system_prompt('PROFICIENCY', 'en-US', 'balanced', native_language='Korean')
        # The gloss line and the ratio line must use the native language.
        self.assertIn('Korean meaning', prompt)
        self.assertIn('not the Korean-vs-target-language ratio', prompt)


class ProficiencyContextNativeTestCase(unittest.TestCase):
    def test_default_contains_english_scaffolding(self):
        with mock.patch.object(main, 'get_current_user_uid', return_value=None):
            self.assertIn('English scaffolding', main.get_user_proficiency_context())

    def test_default_byte_identical_to_explicit_english(self):
        with mock.patch.object(main, 'get_current_user_uid', return_value=None):
            self.assertEqual(
                main.get_user_proficiency_context(),
                main.get_user_proficiency_context(native_language='English'),
            )

    def test_korean_native_scaffolding(self):
        with mock.patch.object(main, 'get_current_user_uid', return_value=None):
            self.assertIn('Korean scaffolding', main.get_user_proficiency_context(native_language='Korean'))


if __name__ == '__main__':
    unittest.main()
