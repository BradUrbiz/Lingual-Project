import unittest

from backend.services.practice_analytics import (
    _catalog_patterns,
    _detect_feedback_event_types,
    _detect_locale_key,
    _normalize_search_text,
    GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
    FRENCH_ASSISTANT_FEEDBACK_PATTERNS,
    SPANISH_ASSISTANT_FEEDBACK_PATTERNS,
)


class LocaleKeyTests(unittest.TestCase):
    def test_extended_locale_keys(self):
        self.assertEqual(_detect_locale_key('ko-KR'), 'ko')
        self.assertEqual(_detect_locale_key('ru-RU'), 'ru')
        self.assertEqual(_detect_locale_key('he-IL'), 'he')
        self.assertEqual(_detect_locale_key('tl-PH'), 'tl')

    def test_existing_locale_keys_unchanged(self):
        self.assertEqual(_detect_locale_key('fr-FR'), 'fr')
        self.assertEqual(_detect_locale_key('es-ES'), 'es')
        self.assertEqual(_detect_locale_key('en-US'), 'en')
        self.assertEqual(_detect_locale_key('zz-ZZ'), 'en')
        self.assertEqual(_detect_locale_key(''), 'en')


class NormalizeSearchTextTests(unittest.TestCase):
    def test_latin_default_unchanged(self):
        # default (no locale) and Latin locales keep ascii-strip + lower + collapse
        self.assertEqual(_normalize_search_text('Cómo  estás'), 'como estas')
        self.assertEqual(_normalize_search_text('Cómo', 'es-ES'), 'como')
        self.assertEqual(_normalize_search_text('Café au lait', 'fr-FR'), 'cafe au lait')

    def test_tagalog_is_latin_ascii_path(self):
        self.assertEqual(_normalize_search_text('Tama', 'tl-PH'), 'tama')

    def test_non_latin_preserved(self):
        self.assertIn('계산서', _normalize_search_text('계산서 주세요', 'ko-KR'))
        self.assertIn('אומרים', _normalize_search_text('אומרים את זה', 'he-IL'))

    def test_cyrillic_casefolded_and_preserved(self):
        self.assertEqual(_normalize_search_text('ПРАВИЛЬНО  Сказать', 'ru-RU'), 'правильно сказать')

    def test_non_latin_whitespace_collapsed(self):
        self.assertEqual(_normalize_search_text('  계산서   주세요  ', 'ko-KR'), '계산서 주세요')


class CatalogPatternsRefactorTests(unittest.TestCase):
    def test_fr_merges_generic_plus_french(self):
        got = _catalog_patterns(
            locale='fr-FR', signal_id='feedback.recast',
            generic_catalog=GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
            locale_catalogs={'fr': FRENCH_ASSISTANT_FEEDBACK_PATTERNS, 'es': SPANISH_ASSISTANT_FEEDBACK_PATTERNS},
        )
        expected = (*GENERIC_ASSISTANT_FEEDBACK_PATTERNS['feedback.recast'],
                    *FRENCH_ASSISTANT_FEEDBACK_PATTERNS['feedback.recast'])
        self.assertEqual(got, expected)

    def test_en_is_generic_only(self):
        got = _catalog_patterns(
            locale='en-US', signal_id='feedback.recast',
            generic_catalog=GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
            locale_catalogs={'fr': FRENCH_ASSISTANT_FEEDBACK_PATTERNS},
        )
        self.assertEqual(got, GENERIC_ASSISTANT_FEEDBACK_PATTERNS['feedback.recast'])


class FeedbackRegressionTests(unittest.TestCase):
    def test_existing_locales_still_detected(self):
        # English generic recast
        self.assertTrue(any(e['eventType'] == 'feedback.recast'
                            for e in _detect_feedback_event_types('Did you mean to go?', locale='en-US')))
        # Spanish recast
        self.assertTrue(any(e['eventType'] == 'feedback.recast'
                            for e in _detect_feedback_event_types('Pequeño ajuste: se dice así.', locale='es-ES')))


if __name__ == '__main__':
    unittest.main()
