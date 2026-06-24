# Locale-Complete Text Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the pedagogy engine's shared heuristic text-matcher so it works for non-Latin locales (ko/ru/he) and gains a native feedback catalog for Tagalog (tl) — making feedback detection, S2 target-coverage, and signal matching functional for all 6 configured locales.

**Architecture:** All changes are in one file, `backend/services/practice_analytics.py`. The matcher's single normalization chokepoint (`_normalize_search_text`) ascii-strips, destroying non-Latin scripts. Make it script-aware (Latin keeps ascii-strip; non-Latin preserves script), refactor the fr/es-special-cased catalog dispatch into a scalable locale→catalog map, add native ko/ru/he/tl feedback catalogs, and thread locale into target-expression hit-counting. The Latin path (en/fr/es/tl) stays byte-identical.

**Tech Stack:** Python 3 / Flask, `unittest`, stdlib `unicodedata` + `re`.

## Global Constraints

- **No flag.** This is a correctness repair of an existing-but-broken heuristic (precedent: the Spanish catalog, added flag-free). Do NOT add an env flag.
- **Latin path byte-identical.** `_normalize_search_text(content)` with no locale or a Latin locale (en/fr/es/tl) MUST return exactly today's `NFKD`+ascii-strip+`.lower()`+whitespace-collapse output. The `fr`/`es` catalog merges MUST be identical to today. All existing analytics + golden tests stay green.
- **Script-aware normalization:** non-Latin locale-keys (`ko`/`ru`/`he`) → `NFKC` + `.casefold()` + whitespace-collapse (NO ascii-strip). `_NON_LATIN_LOCALE_KEYS = frozenset({'ko','ru','he'})`. Tagalog (`tl`) is Latin-script → ascii path.
- **Catalog authoring:** Latin catalogs (fr/es/tl) are written **accent-stripped + lowercase** (to match the ascii path). Non-Latin catalogs (ko/ru/he) are written in **native script**, and MUST NOT use `\b` (word boundaries are unreliable around CJK/Hebrew) — use plain literal substrings. Include common spacing/spelling variants (Korean spacing is variable; Russian е/ё both spellings).
- **Fail-open preserved:** all edits stay inside the existing matching path, which never raises; an unmatched turn yields no event (unchanged). No new I/O, no schema change.
- **Single file:** all production changes in `backend/services/practice_analytics.py`. Tests in a new `backend/tests/test_locale_text_matching.py`.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main` (current branch); do not auto-branch.

---

### Task 1: Script-aware normalization + extended locale-key router

**Files:**
- Modify: `backend/services/practice_analytics.py` — `_detect_locale_key` (~603), `_normalize_search_text` (~593), add `_NON_LATIN_LOCALE_KEYS` constant
- Test: `backend/tests/test_locale_text_matching.py` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `_detect_locale_key(locale) -> 'en'|'fr'|'es'|'ko'|'ru'|'he'|'tl'`; `_normalize_search_text(content, locale='') -> str` (locale-aware); module constant `_NON_LATIN_LOCALE_KEYS = frozenset({'ko','ru','he'})`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_locale_text_matching.py`:

```python
import unittest

from backend.services.practice_analytics import (
    _detect_locale_key,
    _normalize_search_text,
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


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_locale_text_matching -v`
Expected: FAIL — `_detect_locale_key('ko-KR')` returns `'en'` (not yet extended); non-Latin normalization assertions fail (ascii-stripped to empty).

- [ ] **Step 3: Implement**

In `backend/services/practice_analytics.py`, add the constant near the other module constants (e.g. just above `GENERIC_ASSISTANT_FEEDBACK_PATTERNS` at ~line 101):

```python
# Locales whose script is destroyed by ascii-stripping (Hangul/Cyrillic/Hebrew).
# Tagalog (tl) is Latin-script and is NOT here — it uses the ascii path.
_NON_LATIN_LOCALE_KEYS = frozenset({'ko', 'ru', 'he'})
```

Replace `_detect_locale_key` (~603) with:

```python
def _detect_locale_key(locale: Any) -> str:
    normalized = _normalize_string(locale).lower()
    if normalized.startswith('fr'):
        return 'fr'
    if normalized.startswith('es'):
        return 'es'
    if normalized.startswith('ko'):
        return 'ko'
    if normalized.startswith('ru'):
        return 'ru'
    if normalized.startswith('he'):
        return 'he'
    if normalized.startswith('tl'):
        return 'tl'
    return 'en'
```

Replace `_normalize_search_text` (~593) with:

```python
def _normalize_search_text(content: str, locale: Any = '') -> str:
    if _detect_locale_key(locale) in _NON_LATIN_LOCALE_KEYS:
        # Preserve non-Latin script (Hangul/Cyrillic/Hebrew): NFKC compose +
        # casefold (lowercases Cyrillic; no-op for caseless scripts). NO ascii-strip.
        normalized = unicodedata.normalize('NFKC', content).casefold()
    else:
        # Latin scripts (en/fr/es/tl) + default: accent-fold via NFKD + ascii-strip.
        normalized = unicodedata.normalize('NFKD', content).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'\s+', ' ', normalized).strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_locale_text_matching -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_locale_text_matching.py
git commit -m "feat(analytics): script-aware search-text normalization + ko/ru/he/tl locale keys"
```

---

### Task 2: Scalable catalog dispatch (locale→catalog map)

**Files:**
- Modify: `backend/services/practice_analytics.py` — `_catalog_patterns` (~664), `_detect_signal_matches` (~681), `_detect_feedback_event_types` (~732); add `_FEEDBACK_LOCALE_CATALOGS`
- Test: `backend/tests/test_locale_text_matching.py`

**Interfaces:**
- Consumes: `_detect_locale_key` (Task 1).
- Produces: `_catalog_patterns(*, locale, signal_id, generic_catalog, locale_catalogs) -> tuple[str, ...]`; module dict `_FEEDBACK_LOCALE_CATALOGS` (fr/es seeded now; ko/ru/he/tl added Task 3). `_detect_feedback_event_types` and `_detect_signal_matches` produce identical results for fr/es/en as before.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_locale_text_matching.py`:

```python
from backend.services.practice_analytics import (
    _catalog_patterns,
    _detect_feedback_event_types,
    GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
    FRENCH_ASSISTANT_FEEDBACK_PATTERNS,
    SPANISH_ASSISTANT_FEEDBACK_PATTERNS,
)


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_locale_text_matching.CatalogPatternsRefactorTests -v`
Expected: FAIL — `_catalog_patterns` does not accept a `locale_catalogs` kwarg yet (`TypeError`).

- [ ] **Step 3: Implement**

Replace `_catalog_patterns` (~664) with:

```python
def _catalog_patterns(
    *,
    locale: str,
    signal_id: str,
    generic_catalog: dict[str, tuple[str, ...]],
    locale_catalogs: dict[str, dict[str, tuple[str, ...]]],
) -> tuple[str, ...]:
    patterns = list(generic_catalog.get(signal_id, ()))
    locale_catalog = locale_catalogs.get(_detect_locale_key(locale))
    if locale_catalog is not None:
        patterns.extend(locale_catalog.get(signal_id, ()))
    return tuple(patterns)
```

Replace `_detect_signal_matches` (~681) — change only the normalization (now locale-aware) and the `_catalog_patterns` call (now passes a `locale_catalogs` map built from the `french_catalog` arg, preserving the fr-only behavior of its callers):

```python
def _detect_signal_matches(
    content: str,
    allowed_ids: list[str],
    *,
    locale: str,
    generic_catalog: dict[str, tuple[str, ...]],
    french_catalog: dict[str, tuple[str, ...]],
    payload_key: str,
) -> list[dict[str, Any]]:
    search_text = _normalize_search_text(content, locale)
    locale_catalogs = {'fr': french_catalog}
    signals: list[dict[str, Any]] = []
    for allowed_id in allowed_ids:
        patterns = _catalog_patterns(
            locale=locale,
            signal_id=allowed_id,
            generic_catalog=generic_catalog,
            locale_catalogs=locale_catalogs,
        )
        matches = _find_pattern_matches(search_text, patterns)
        if matches:
            signals.append({
                payload_key: allowed_id,
                'count': len(matches),
                'matchedText': matches[0],
                'matchedTexts': matches[:3],
            })
    return signals
```

Add the feedback locale-catalog map just below `SPANISH_ASSISTANT_FEEDBACK_PATTERNS` (after ~line 170, where that dict ends):

```python
# Locale-key -> assistant-feedback catalog. ko/ru/he/tl catalogs are added in
# the locale-complete slice; fr/es preserve the prior special-cased behavior.
_FEEDBACK_LOCALE_CATALOGS: dict[str, dict[str, tuple[str, ...]]] = {
    'fr': FRENCH_ASSISTANT_FEEDBACK_PATTERNS,
    'es': SPANISH_ASSISTANT_FEEDBACK_PATTERNS,
}
```

Replace `_detect_feedback_event_types` (~732) with:

```python
def _detect_feedback_event_types(content: str, *, locale: str) -> list[dict[str, Any]]:
    detected = []
    search_text = _normalize_search_text(content, locale)
    for event_type in GENERIC_ASSISTANT_FEEDBACK_PATTERNS:
        patterns = _catalog_patterns(
            locale=locale,
            signal_id=event_type,
            generic_catalog=GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
            locale_catalogs=_FEEDBACK_LOCALE_CATALOGS,
        )
        matches = _find_pattern_matches(search_text, patterns)
        if matches:
            detected.append({
                'eventType': event_type,
                'count': len(matches),
                'matchedText': matches[0],
            })
    return detected
```

> Note: `_FEEDBACK_LOCALE_CATALOGS` must be defined AFTER the three pattern dicts it references but is used inside `_detect_feedback_event_types` (a function body, evaluated at call time) — module-load order is satisfied as long as the dict literal sits below `SPANISH_ASSISTANT_FEEDBACK_PATTERNS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_locale_text_matching -v`
Expected: PASS
Run (regression — the signal/feedback detectors feed many analytics tests): `python3 -m unittest backend.tests.test_practice_analytics -v`
Expected: PASS (fr/es/en behavior unchanged)

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_locale_text_matching.py
git commit -m "refactor(analytics): scalable locale->catalog dispatch (replaces fr/es special-casing)"
```

---

### Task 3: Native ko/ru/he/tl feedback catalogs

**Files:**
- Modify: `backend/services/practice_analytics.py` — add four catalog constants + extend `_FEEDBACK_LOCALE_CATALOGS`
- Test: `backend/tests/test_locale_text_matching.py`

**Interfaces:**
- Consumes: `_FEEDBACK_LOCALE_CATALOGS` (Task 2), `_detect_feedback_event_types` (Task 2), script-aware normalization (Task 1).
- Produces: `KOREAN_/RUSSIAN_/HEBREW_/TAGALOG_ASSISTANT_FEEDBACK_PATTERNS` constants wired into `_FEEDBACK_LOCALE_CATALOGS`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_locale_text_matching.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_locale_text_matching.NonLatinFeedbackCatalogTests -v`
Expected: FAIL — no catalogs for ko/ru/he/tl yet → no events detected.

- [ ] **Step 3: Implement**

Add these four constants just above `_FEEDBACK_LOCALE_CATALOGS` (heuristic first-sets; ko/ru/he are native-script plain substrings with NO `\b`, spacing/spelling variants included; tl is ascii-stripped + lowercase and may use `\b`):

```python
KOREAN_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.recast': (
        r'정확히는',
        r'라고 해요',
        r'라고 말해요',
        r'이렇게 말',
        r'다시 말하면',
    ),
    'feedback.elicitation': (
        r'어떻게 말',
        r'한 번 더',
        r'한번 더',
        r'다시 한번',
        r'다시 한 번',
        r'말해 볼래요',
        r'말해볼래요',
    ),
    'feedback.review_item': (
        r'오늘 배운',
        r'기억하세요',
        r'복습',
    ),
}

RUSSIAN_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.recast': (
        r'правильно сказать',
        r'мы говорим',
        r'лучше сказать',
        r'точнее',
    ),
    'feedback.elicitation': (
        r'попробуй ещё раз',
        r'попробуй еще раз',
        r'попробуйте ещё раз',
        r'как сказать',
        r'повтори',
    ),
    'feedback.review_item': (
        r'помни',
        r'сегодня мы',
        r'повторим',
    ),
}

HEBREW_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.recast': (
        r'אומרים',
        r'נכון יותר',
        r'עדיף לומר',
        r'כדאי לומר',
    ),
    'feedback.elicitation': (
        r'נסה שוב',
        r'נסי שוב',
        r'איך אומרים',
        r'עוד פעם',
    ),
    'feedback.review_item': (
        r'זוכר',
        r'היום למדנו',
    ),
}

TAGALOG_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.recast': (
        r'\bang tama ay\b',
        r'\bmas mabuti\b',
        r'\bdapat sabihin\b',
    ),
    'feedback.elicitation': (
        r'\bsubukan ulit\b',
        r'\bsubukang muli\b',
        r'\bpaano sabihin\b',
        r'\bulitin\b',
    ),
    'feedback.review_item': (
        r'\btandaan\b',
        r'\bngayon natutunan\b',
        r'\bbalikan natin\b',
    ),
}
```

Extend `_FEEDBACK_LOCALE_CATALOGS` to:

```python
_FEEDBACK_LOCALE_CATALOGS: dict[str, dict[str, tuple[str, ...]]] = {
    'fr': FRENCH_ASSISTANT_FEEDBACK_PATTERNS,
    'es': SPANISH_ASSISTANT_FEEDBACK_PATTERNS,
    'ko': KOREAN_ASSISTANT_FEEDBACK_PATTERNS,
    'ru': RUSSIAN_ASSISTANT_FEEDBACK_PATTERNS,
    'he': HEBREW_ASSISTANT_FEEDBACK_PATTERNS,
    'tl': TAGALOG_ASSISTANT_FEEDBACK_PATTERNS,
}
```

(Define the four constants ABOVE the `_FEEDBACK_LOCALE_CATALOGS` literal so the references resolve at module load.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_locale_text_matching -v`
Expected: PASS (all four locales detect recast/elicitation/review)

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_locale_text_matching.py
git commit -m "feat(analytics): native ko/ru/he/tl assistant-feedback catalogs"
```

---

### Task 4: Locale-threaded target-expression hit-counting (S2 coverage for non-Latin)

**Files:**
- Modify: `backend/services/practice_analytics.py` — `_count_target_expression_hits` (~637) + its 4 call sites (1656, 1662, 1927, 1938)
- Test: `backend/tests/test_locale_text_matching.py`

**Interfaces:**
- Consumes: script-aware `_normalize_search_text` (Task 1).
- Produces: `_count_target_expression_hits(content, expressions, *, locale='') -> dict[str,int]`. Latin callers (default/Latin locale) behave identically; non-Latin targets are now counted.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_locale_text_matching.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_locale_text_matching.TargetExpressionHitLocaleTests -v`
Expected: FAIL — Korean/Hebrew hits are 0/None (content ascii-stripped to empty under the current no-locale call), and `_count_target_expression_hits` does not accept a `locale` kwarg yet (`TypeError`).

- [ ] **Step 3: Implement**

Replace `_count_target_expression_hits` (~637) with:

```python
def _count_target_expression_hits(content: str, expressions: list[str], *, locale: Any = '') -> dict[str, int]:
    content_lower = _normalize_search_text(content, locale)
    hits = {}
    for expression in expressions:
        normalized_expression = _normalize_string(expression)
        if not normalized_expression:
            continue
        normalized_search = _normalize_search_text(normalized_expression, locale)
        if not normalized_search:
            continue
        count = content_lower.count(normalized_search)
        if count > 0:
            hits[normalized_expression] = count
    return hits
```

Thread `locale=locale` into the 4 call sites (the variable `locale` is in scope at each — `apply_learning_event_to_session` defines it at ~1634; the derived-events function at ~1921):

- Line ~1656: `expression_hits = _count_target_expression_hits(content, target_expressions if isinstance(target_expressions, list) else [], locale=locale)`
- Line ~1662: `vocabulary_hits = _count_target_expression_hits(content, target_vocabulary if isinstance(target_vocabulary, list) else [], locale=locale)`
- Line ~1927: `for expression, count in _count_target_expression_hits(content, target_expressions if isinstance(target_expressions, list) else [], locale=locale).items():`
- Line ~1938: `for word, count in _count_target_expression_hits(content, target_vocabulary if isinstance(target_vocabulary, list) else [], locale=locale).items():`

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_locale_text_matching -v`
Expected: PASS
Run: `python3 -m unittest backend.tests.test_practice_analytics -v`
Expected: PASS (Latin target-hit behavior unchanged)

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_locale_text_matching.py
git commit -m "feat(analytics): locale-threaded target-expression hits (S2 coverage for non-Latin)"
```

---

### Task 5: Full-suite verification + doc-sync

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/school-integration/LIMITATIONS.md`
- (verify) entire backend suite

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: accurate docs; green suite.

- [ ] **Step 1: Run the full backend suite**

Run: `make test-backend`
Expected: PASS (the Latin path is byte-identical, so every existing analytics + golden test stays green; the new locale tests pass).
If anything fails, STOP and report — a failure means the Latin path was not byte-identical and must be fixed before docs.

- [ ] **Step 2: Update `backend/CLAUDE.md`**

Find the S3.2 line that reads "Feedback catalog covers en/fr/es natively; ko/ru/he/tl fall back to generic-English until native catalogs are added." Replace with:

> Feedback catalog covers **en/fr/es/ko/ru/he/tl natively** (locale→catalog map `_FEEDBACK_LOCALE_CATALOGS`). Non-Latin matching was repaired 2026-06-24: `_normalize_search_text(content, locale)` is script-aware (Latin ascii-strips; ko/ru/he preserve script via NFKC+casefold) — previously the ascii-strip silently disabled feedback detection, target-expression hits, and signal matching for ko/ru/he. Native student-error rules + comm-function/discourse/context catalogs for non-Latin remain follow-ups.

- [ ] **Step 3: Update `docs/school-integration/LIMITATIONS.md`**

Add an entry (next to the existing pedagogy/analytics limitations) recording: "Non-Latin locale matching repaired 2026-06-24 (feedback catalogs + target-coverage now work for ko/ru/he/tl). STILL deferred for non-Latin: native student-error rules (`ERROR_RULES` is en/fr/es-only) and comm-function/discourse-move/context-tag catalogs (the scalable `_FEEDBACK_LOCALE_CATALOGS`/`locale_catalogs` map makes them addable). Feedback patterns are heuristic first-sets, refinable from real-session phrasing (same posture as the Spanish catalog)."

- [ ] **Step 4: Commit**

```bash
git add backend/CLAUDE.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(analytics): locale-complete matching — catalog coverage + deferred non-Latin signals"
```

---

## Self-Review

**1. Spec coverage:**
- Script-aware normalization → Task 1 ✓
- Extended locale-key router (ko/ru/he/tl) → Task 1 ✓
- Scalable `locale_catalogs` dispatch (replaces fr/es special-casing) → Task 2 ✓
- Native ko/ru/he/tl feedback catalogs → Task 3 ✓
- Locale-threaded target-expression hits (S2 coverage) → Task 4 ✓
- Byte-identical Latin path → enforced by Global Constraints + the default-arg behavior + regression tests in Tasks 2/4 + the full-suite gate in Task 5 ✓
- No flag → Global Constraints ✓
- Docs (catalog coverage + deferred non-Latin signals) → Task 5 ✓
- Non-goals (student-error rules, secondary-signal catalogs) → documented in Task 5 LIMITATIONS ✓

**2. Placeholder scan:** No TBD/TODO. All catalog patterns are concrete literals (Task 3). All call-site line numbers + exact replacement lines given (Task 4). Test code is complete.

**3. Type consistency:** `_normalize_search_text(content, locale='')` signature identical across Tasks 1/2/4. `_catalog_patterns(*, locale, signal_id, generic_catalog, locale_catalogs)` identical in Task 2 def + Task 2/3 callers. `_count_target_expression_hits(content, expressions, *, locale='')` identical in Task 4 def + 4 call sites. `_FEEDBACK_LOCALE_CATALOGS` keys (fr/es then +ko/ru/he/tl) consistent Task 2→3. `_NON_LATIN_LOCALE_KEYS = frozenset({'ko','ru','he'})` (tl excluded) consistent with the Tagalog-is-Latin decision throughout.
