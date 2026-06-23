# Spanish Corrective-Feedback Pattern Catalog — Implementation Report

## Summary

Added Spanish (`es-*`) corrective-feedback detection to `backend/services/practice_analytics.py`, unblocking S3.2 live coach chips for Spanish sessions.

## Patterns Added

`SPANISH_ASSISTANT_FEEDBACK_PATTERNS` — 3 keys, all patterns accent-free/lowercase (NFKD normalizer strips diacritics before matching):

**feedback.recast** (9 patterns):
- `\bpequeno ajuste\b`, `\bpequenos ajustes\b` — primary markers from observed live sessions
- `\bse dice\b`, `\bse escribe\b` — correction-specific forms
- `\bdecimos\b` — "we say" correction form
- `\bmejor usar\b`, `\bmejor di\b` — correction offering better form (scoped to avoid bare `mejor`)
- `\bquieres decir\b` — implicit correction question
- `\bla forma correcta\b` — explicit correction label

**feedback.elicitation** (6 patterns):
- `\botra vez\b`, `\bintenta otra vez\b` — try again prompts
- `\bpuedes repetir\b`, `\bpuedes decirlo otra vez\b` — repetition requests
- `\bcomo se dice\b` — "how do you say" elicitation
- `\bintentalo\b` — "try it" imperative (accent-stripped from "inténtalo")

**feedback.review_item** (4 patterns):
- `\brecuerda\b` — "remember" review cue
- `\brepasemos\b` — "let's review"
- `\bhoy practicamos\b` — session-level review marker
- `\brepaso rapido\b` — "quick review"

Bare `\bmejor\b` deliberately excluded (fires on ordinary "está mejor" praise — too common).

## Wiring

1. **`_detect_locale_key`**: added `elif normalized.startswith('es'): return 'es'` before the `return 'en'` fallback.
2. **`_catalog_patterns`**: added optional `spanish_catalog: dict | None = None` param; `elif locale_key == 'es' and spanish_catalog is not None` branch. Existing `fr`/`en` behavior is unchanged; callers without `spanish_catalog` behave identically for all locales.
3. **`_detect_feedback_event_types`**: passes `spanish_catalog=SPANISH_ASSISTANT_FEEDBACK_PATTERNS`. All other `_catalog_patterns` callers (`_detect_communicative_function_signals`, `_detect_discourse_move_signals`) pass no `spanish_catalog` — so Spanish sessions fall through to generic-only there (no regressions to locale-filtering behavior).

## TDD Evidence

**RED phase**: Tests written first, then implementation. The locale key test (`es-ES → 'es'`) and all Spanish feedback detection tests would have failed before the implementation changes.

**GREEN phase**: All 86 tests pass after implementation.

```
Ran 86 tests in 0.014s
OK
```

Import boundary suite (pedagogy S1) unaffected:
```
Ran 3 tests in 0.326s
OK
```

## New Spanish Tests (8 added)

In `TestDetectLocaleKey`:
- `test_spanish_locale` — `es-ES` → `'es'`
- `test_spanish_locale_mx` — `es-MX` → `'es'`
- `test_korean_defaults_english` — `ko-KR` → `'en'` (regression guard)

In `TestDetectFeedbackEventTypes`:
- `test_spanish_recast_pequeno_ajuste` — live tutor line detects `feedback.recast`
- `test_spanish_elicitation_intenta_otra_vez` — detects `feedback.elicitation`
- `test_spanish_review_recuerda` — detects `feedback.review_item`
- `test_spanish_recast_not_detected_for_en_us` — locale gate: Spanish marker silent for `en-US`
- `test_spanish_praise_no_feedback_events` — "¡Muy bien! Gracias." returns 0 events (false-positive guard)

Regression tests retained:
- `test_english_recast_still_detected_for_en` — English `did you mean` still fires
- `test_french_recast_still_detected_for_fr` — French `tu veux dire` still fires

## Files Changed

- `backend/services/practice_analytics.py` — `SPANISH_ASSISTANT_FEEDBACK_PATTERNS`, `_detect_locale_key`, `_catalog_patterns`, `_detect_feedback_event_types`
- `backend/tests/test_practice_analytics.py` — 8 new tests across `TestDetectLocaleKey` and `TestDetectFeedbackEventTypes`
- `.superpowers/sdd/spanish-catalog-report.md` — this file

## Self-Review

The change is purely additive. The `spanish_catalog=None` default ensures every existing call site is signature-compatible with zero behavior change. The `elif` on `locale_key` prevents Spanish from accidentally falling into the French branch. The NFKD normalizer already handles accent-stripping, so all patterns are written accent-free. Bare common words (`mejor`, `usa`) were avoided in favor of multi-word correction-specific markers — false-positive risk is low.

## Concerns

None. The pattern catalog is conservative; precision is prioritized over recall. Additional patterns can be added as more live session data is observed.
