# backend/tests/test_native_scaffolding_prompts.py
import unittest

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


if __name__ == '__main__':
    unittest.main()
