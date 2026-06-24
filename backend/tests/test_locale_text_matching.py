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


class NonLatinFeedbackCatalogTests(unittest.TestCase):
    def _has(self, content, locale, event_type):
        return any(e['eventType'] == event_type
                   for e in _detect_feedback_event_types(content, locale=locale))

    def test_korean_signals(self):
        self.assertTrue(self._has('정확히는 "갔어요"라고 해요.', 'ko-KR', 'feedback.recast'))
        self.assertTrue(self._has('어떻게 말할까요? 한 번 더 해볼까요?', 'ko-KR', 'feedback.elicitation'))
        self.assertTrue(self._has('오늘 배운 표현을 기억하세요.', 'ko-KR', 'feedback.review_item'))

    def test_russian_signals(self):
        self.assertTrue(self._has('Правильно сказать "пошёл".', 'ru-RU', 'feedback.recast'))
        self.assertTrue(self._has('Попробуй ещё раз. Как сказать это?', 'ru-RU', 'feedback.elicitation'))
        self.assertTrue(self._has('Помни это слово. Сегодня мы практиковали.', 'ru-RU', 'feedback.review_item'))

    def test_hebrew_signals(self):
        self.assertTrue(self._has('נכון יותר לומר ככה. אומרים אחרת.', 'he-IL', 'feedback.recast'))
        self.assertTrue(self._has('נסה שוב. איך אומרים את זה?', 'he-IL', 'feedback.elicitation'))
        self.assertTrue(self._has('היום למדנו מילה חדשה.', 'he-IL', 'feedback.review_item'))

    def test_tagalog_signals(self):
        self.assertTrue(self._has('Ang tama ay ganito. Dapat sabihin nang iba.', 'tl-PH', 'feedback.recast'))
        self.assertTrue(self._has('Subukan ulit. Paano sabihin ito?', 'tl-PH', 'feedback.elicitation'))
        self.assertTrue(self._has('Tandaan mo ito. Ngayon natutunan natin.', 'tl-PH', 'feedback.review_item'))


from backend.services.practice_analytics import _count_target_expression_hits


class TargetExpressionHitLocaleTests(unittest.TestCase):
    def test_korean_target_counted(self):
        hits = _count_target_expression_hits('계산서 주세요. 계산서 부탁합니다.', ['계산서'], locale='ko-KR')
        self.assertEqual(hits.get('계산서'), 2)

    def test_hebrew_target_counted(self):
        hits = _count_target_expression_hits('אני רוצה חשבון בבקשה', ['חשבון'], locale='he-IL')
        self.assertEqual(hits.get('חשבון'), 1)

    def test_spanish_target_still_counted_control(self):
        hits = _count_target_expression_hits('La cuenta, por favor. La cuenta ya.', ['la cuenta'], locale='es-ES')
        self.assertEqual(hits.get('la cuenta'), 2)

    def test_default_locale_latin_unchanged(self):
        hits = _count_target_expression_hits('the bill please', ['the bill'])
        self.assertEqual(hits.get('the bill'), 1)


if __name__ == '__main__':
    unittest.main()
