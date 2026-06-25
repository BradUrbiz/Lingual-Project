import unittest
from backend.services.pedagogy import language_signal as ls


class TargetLanguageShortfallTests(unittest.TestCase):
    def test_spanish_english_fallback_is_shortfall(self):
        # >=3 distinct English function words, Latin target -> shortfall
        self.assertTrue(ls.detect_target_language_shortfall(
            "I want a coffee please and what is the price", "es-ES"))

    def test_spanish_real_target_is_not_shortfall(self):
        self.assertFalse(ls.detect_target_language_shortfall(
            "Quisiera un cafe y una galleta, por favor.", "es-ES"))

    def test_korean_english_fallback_is_shortfall(self):
        # non-Latin target, content is Latin/English -> target-script ratio ~0 -> shortfall
        self.assertTrue(ls.detect_target_language_shortfall(
            "one americano please how much is it", "ko-KR"))

    def test_korean_real_target_is_not_shortfall(self):
        self.assertFalse(ls.detect_target_language_shortfall(
            "아메리카노 한 잔 주세요. 얼마예요?", "ko-KR"))

    def test_short_greeting_below_min_chars_not_shortfall(self):
        self.assertFalse(ls.detect_target_language_shortfall("Hola", "es-ES"))
        self.assertFalse(ls.detect_target_language_shortfall("안녕", "ko-KR"))

    def test_english_target_locale_never_shortfall(self):
        self.assertFalse(ls.detect_target_language_shortfall(
            "I want a coffee please and what is the price", "en-US"))

    def test_produced_target_language_true_for_real_target(self):
        self.assertTrue(ls.produced_target_language(
            "Quisiera un cafe, por favor.", "es-ES"))
        self.assertTrue(ls.produced_target_language(
            "아메리카노 한 잔 주세요.", "ko-KR"))

    def test_produced_target_language_false_for_fallback_or_short(self):
        self.assertFalse(ls.produced_target_language(
            "I want a coffee please and what is the price", "es-ES"))
        self.assertFalse(ls.produced_target_language("Hola", "es-ES"))


class LocaleKeyTests(unittest.TestCase):
    def test_prefix_match(self):
        self.assertEqual(ls.language_locale_key("ko-KR"), "ko")
        self.assertEqual(ls.language_locale_key("es-ES"), "es")
        self.assertEqual(ls.language_locale_key("en-US"), "en")
        self.assertEqual(ls.language_locale_key(None), "en")
