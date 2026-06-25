import unittest

import main
from backend.routes.chat import resolve_realtime_transcription_language_hint


class EnUsLocaleConfigTestCase(unittest.TestCase):
    def test_en_us_in_allowed_learning_locales(self):
        self.assertIn('en-US', main.ALLOWED_LEARNING_LOCALES)

    def test_en_us_prompt_config_shape(self):
        cfg = main.LEARNING_LOCALE_PROMPT_CONFIG['en-US']
        self.assertEqual(cfg['language_name'], 'English')
        self.assertIn('conversation_note', cfg)
        self.assertIn('register_note', cfg)

    def test_en_us_transcription_hint_is_english(self):
        self.assertEqual(
            resolve_realtime_transcription_language_hint('en-US'),
            ('en', 'English'),
        )


if __name__ == '__main__':
    unittest.main()
