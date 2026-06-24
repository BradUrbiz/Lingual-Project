# Locale-Complete Text Matching (non-Latin normalization + ko/ru/he/tl feedback catalogs) — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** Repair the pedagogy engine's shared heuristic text-matching layer so it actually works for the non-Latin configured locales (ko/ru/he) and gains a native feedback catalog for Tagalog (tl) — closing a genuine architectural hole, not a data nicety.
**Why now:** The standing directive is to make the engine *thoroughly implemented* and to do logged follow-up work. While closing the S5 slice I verified the source and found the "ko/ru/he/tl feedback catalogs" follow-up was badly under-assessed: it is not "falls back to English," it is **silently broken**. The project's architecture is explicitly *locale-parametric* ("never hard-code a single language", root `CLAUDE.md`) — yet the core matcher fails for 3 of 6 configured locales.

---

## 0. TL;DR

`practice_analytics._normalize_search_text` does `unicodedata.normalize('NFKD', content).encode('ascii', 'ignore').decode('ascii')` — it **strips all non-ASCII**. For Latin scripts (en/fr/es/tl) that's a feature (accent-insensitive matching: "cómo"→"como"). For **Korean (Hangul), Russian (Cyrillic), Hebrew** it reduces the search text to **empty** before any pattern runs. This single chokepoint feeds ~12 matchers, so for ko/ru/he the following are all silently non-functional: feedback-event detection (the S3.2/S3.3 coach-track gate), target-expression hit-counting (S2 recycling coverage), student-error and signal detection.

This slice fixes the root: make normalization **script-aware** (Latin keeps ascii-strip; non-Latin preserves the script), make the catalog dispatch **scalable** (replace the fr/es special-casing with a locale→catalog map), add **native feedback catalogs** for ko/ru/he/tl, and **thread locale** into target-expression hit-counting so S2 coverage works for non-Latin targets. The **Latin path stays byte-identical** (default-arg behavior unchanged), so en/fr/es/tl and every existing analytics test are untouched. No flag — this is a correctness repair, not a gated capability (precedent: the Spanish catalog, added flag-free in 8d44340/883e8f1).

---

## 1. Scope

### In scope
1. **Locale-key router** — `_detect_locale_key` recognizes `ko`/`ru`/`he`/`tl` (today only `fr`/`es`/`en`).
2. **Script-aware normalization** — `_normalize_search_text(content, locale='')`: non-Latin locale-keys (`ko`/`ru`/`he`) normalize via NFKC + casefold + whitespace-collapse (NO ascii-strip); Latin keys (`en`/`fr`/`es`/`tl`) and the default `''` keep the current NFKD+ascii-strip.
3. **Scalable catalog dispatch** — refactor `_catalog_patterns` from `french_catalog` + optional `spanish_catalog` params to a `locale_catalogs: dict[str, dict[str, tuple[str, ...]]]` map (locale_key → catalog); merge generic + the per-locale catalog. Update `_detect_feedback_event_types` and `_detect_signal_matches`.
4. **Native feedback catalogs** — `KOREAN_/RUSSIAN_/HEBREW_/TAGALOG_ASSISTANT_FEEDBACK_PATTERNS` (`feedback.recast` / `feedback.elicitation` / `feedback.review_item`) wired into the feedback-detection locale-catalog map.
5. **Locale-threaded target-expression hits** — `_count_target_expression_hits(content, expressions, *, locale='')` normalizes both content and each expression with the session locale, so S2 coverage counts non-Latin targets; thread the session learning-locale at its rollup call site.

### Non-goals (documented follow-ups the fix unblocks)
- **Native student-error rules** (`ERROR_RULES`) for ko/ru/he/tl — grammar-error linguistics is a large, separate body of work; the feedback gate (not the error rules) is the primary coach-track driver. The normalization fix makes these addable later, but they are NOT in this slice.
- **Native comm-function / discourse-move / context-tag catalogs** for non-Latin — secondary analytics signals; the normalization fix + the scalable `locale_catalogs` map make them trivially addable later, but no new catalogs for them here.
- **Exhaustive catalog coverage.** The catalogs are linguistically-grounded *first sets*, explicitly heuristic and refinable via the same post-cutover monitoring the Spanish catalog used (§6).
- **No locale config change.** ko/ru/he/tl are already in `ALLOWED_LEARNING_LOCALES`; this slice does not add locales.

---

## 2. Approaches considered

1. **Fix at the chokepoint + scalable catalog map + native catalogs (CHOSEN).** Root fix; all matchers benefit at once; Latin path byte-identical; bounded by deferring secondary catalogs. Cost: touches the shared matching foundation (mitigated by the byte-identical Latin path + regression tests).
2. **Minimal — fix only the feedback path** (a separate unicode normalizer used only inside `_detect_feedback_event_types`). **Rejected:** knowingly leaves S2 coverage + other matchers broken for non-Latin (half-fix), and duplicates normalization logic.
3. **LLM-classify corrective turns for non-Latin** (skip catalogs). **Rejected:** the heuristic gate exists precisely to avoid per-turn LLM cost; this contradicts the engine's cost discipline and splits Latin/non-Latin into two different mechanisms.

---

## 3. Architecture (all in `backend/services/practice_analytics.py`)

The matching layer's single normalization chokepoint is `_normalize_search_text`. Making it script-aware is the root fix; everything else is wiring + content.

```
_detect_locale_key(locale) -> 'en'|'fr'|'es'|'ko'|'ru'|'he'|'tl'    (extend: + ko/ru/he/tl)

_NON_LATIN_LOCALE_KEYS = {'ko','ru','he'}                            (new constant; tl is Latin)

_normalize_search_text(content, locale='') -> str                    (script-aware)
   key = _detect_locale_key(locale)
   if key in _NON_LATIN_LOCALE_KEYS:
       return collapse_ws(unicodedata.normalize('NFKC', content).casefold())   # preserve script
   return collapse_ws(unicodedata.normalize('NFKD', content).encode('ascii','ignore').decode().lower())  # current

_catalog_patterns(*, locale, signal_id, generic_catalog, locale_catalogs)      (scalable map)
   patterns = list(generic_catalog.get(signal_id, ()))
   patterns += locale_catalogs.get(_detect_locale_key(locale), {}).get(signal_id, ())
   return tuple(patterns)

feedback locale_catalogs = {'fr':FRENCH..., 'es':SPANISH..., 'ko':KOREAN..., 'ru':RUSSIAN..., 'he':HEBREW..., 'tl':TAGALOG...}
signal  locale_catalogs = {'fr':FRENCH...}    (unchanged set — comm-fn/discourse/context still fr-only)

_count_target_expression_hits(content, expressions, *, locale='')             (locale-threaded)
   content_norm = _normalize_search_text(content, locale)
   for expr: count content_norm.count(_normalize_search_text(expr, locale))
```

**Byte-identical Latin path.** `_normalize_search_text(content)` with no/Latin locale → the exact current NFKD+ascii-strip+lower+collapse. The `locale_catalogs` map is seeded with the existing `fr`/`es` catalogs, so `_catalog_patterns` returns identical patterns for fr/es. `_count_target_expression_hits` with no/Latin locale → identical. Therefore en/fr/es/tl behavior and all existing goldens/tests are unchanged.

**Why no flag.** S2–S5 are *new capabilities* gated behind flags so cutover is deliberate. This slice *repairs* existing-but-broken behavior for already-shipped locales; there is no scenario where correct non-Latin matching should be "off," and the Latin path is provably unchanged. A flag would add a dead toggle. The Spanish-catalog addition (8d44340/883e8f1) set the flag-free precedent for catalog/heuristic repair.

---

## 4. Normalization details (the one subtle part)

- **Latin (en/fr/es/tl) + default `''`:** `re.sub(r'\s+',' ', unicodedata.normalize('NFKD', content).encode('ascii','ignore').decode('ascii').lower()).strip()` — exactly today's function. Accent-folding is preserved (the es/fr/tl catalogs are written accent-stripped, e.g. `pequeno`, `essaie`).
- **Non-Latin (ko/ru/he):** `re.sub(r'\s+',' ', unicodedata.normalize('NFKC', content).casefold()).strip()` — NFKC composes (does not decompose-then-strip), `casefold()` handles Cyrillic case (no-op for caseless Hangul/Hebrew), no ascii-strip. Mixed-script turns (a Korean tutor dropping an English word, punctuation, digits) are preserved — desirable, since the catalogs match native-script markers and code-switching is normal.
- **Catalog authoring rule (carried into the plan):** Latin catalogs (fr/es/tl) are written **accent-stripped, lowercased** to match the ascii path; non-Latin catalogs (ko/ru/he) are written in **native script** (they match the preserved text). Word-boundary `\b` is unreliable around CJK/Hebrew — non-Latin patterns must NOT rely on `\b` (use plain substrings or explicit boundaries).

---

## 5. Feedback catalogs (first sets — heuristic, native corrective-discourse markers)

Three signals per locale, mirroring the en/fr/es structure. These are linguistically-grounded starting patterns for what the tutor model (`gpt-5.4-mini-2026-03-17`) plausibly emits when recasting / eliciting / reviewing; the plan carries the concrete pattern tuples and the implementer transcribes them. Refinement is the same post-cutover monitoring as Spanish (§6).

- **Korean (ko, native script, no `\b`):** recast — `라고 해요`, `라고 말해요`, `정확히는`, `이렇게 말해요`, `다시 말하면`; elicitation — `다시 해 볼래요`, `어떻게 말할까요`, `한 번 더`, `다시 한번`; review — `오늘 배운`, `기억하세요`, `복습`.
- **Russian (ru, Cyrillic, casefolded):** recast — `правильно сказать`, `мы говорим`, `лучше сказать`, `точнее`; elicitation — `попробуй ещё раз`, `попробуйте ещё раз`, `как сказать`, `повтори`; review — `помни`, `сегодня мы`, `повторим`.
- **Hebrew (he, native script, no `\b`):** recast — `אומרים`, `נכון יותר`, `עדיף לומר`, `כדאי לומר`; elicitation — `נסה שוב`, `נסי שוב`, `איך אומרים`, `עוד פעם`; review — `זוכר`, `זוכרת`, `היום למדנו`.
- **Tagalog (tl, Latin → ascii-stripped, lowercased, may use `\b`):** recast — `ang tama ay`, `mas mabuti`, `mas maganda sabihin`, `dapat sabihin`; elicitation — `subukan ulit`, `subukang muli`, `paano sabihin`, `ulitin`; review — `tandaan`, `ngayon natutunan`, `balikan natin`.

(The plan will carry these as exact regex tuples. They are a defensible first catalog, not a claim of exhaustiveness — same posture as the Spanish catalog before its burn-in refinement.)

---

## 6. Error handling, success criteria, testing

**Error handling.** All changes live inside the existing fail-open analytics path — matching never raises; an unmatched turn simply yields no event (unchanged). No new I/O, no new external dependency, no schema change.

**Success criteria.**
- A Korean / Russian / Hebrew tutor recast produces a `feedback.recast` event (today: none).
- A Korean / Russian / Hebrew target expression appearing in content is counted by `_count_target_expression_hits` (today: broken — ascii-stripped to empty).
- A Tagalog tutor recast is detected via the new tl catalog.
- en/fr/es/tl matching and every existing analytics test are unchanged (byte-identical Latin path).

**Testing.**
- `_detect_locale_key` → ko/ru/he/tl (from ko-KR/ru-RU/he-IL/tl-PH) + unchanged fr/es/en.
- `_normalize_search_text`: Hangul/Cyrillic/Hebrew preserved for their locale; en/fr/es/tl still ascii-stripped+lowered; Cyrillic casefold lowercases; default-arg identical to today.
- `_detect_feedback_event_types`: a recast/elicitation/review marker detected for each of ko/ru/he/tl; en/fr/es still detected (regression).
- `_count_target_expression_hits`: counts a Korean target in Korean content (and a control: a Spanish target still counts under ascii-strip).
- `_catalog_patterns` refactor: fr/es produce the identical merged pattern set as before (regression guard for the map refactor).
- Full `make test-backend` green (the Latin path is byte-identical, so existing analytics + golden tests must stay green).

---

## 7. Files

| File | Change |
|---|---|
| `backend/services/practice_analytics.py` | `_detect_locale_key` (+ko/ru/he/tl), `_NON_LATIN_LOCALE_KEYS` (new), `_normalize_search_text` (locale-aware), `_catalog_patterns` (locale_catalogs map) + callers `_detect_feedback_event_types` / `_detect_signal_matches`, new `KOREAN_/RUSSIAN_/HEBREW_/TAGALOG_ASSISTANT_FEEDBACK_PATTERNS`, `_count_target_expression_hits` (locale param) + its rollup call site |
| tests | extend the analytics test suite (locale-key, normalization, feedback detection per locale, target-hit, catalog-refactor regression) |
| docs | `backend/CLAUDE.md` (feedback-catalog locale coverage now en/fr/es/ko/ru/he/tl native; non-Latin matching repaired), `LIMITATIONS.md` (deferred: student-error rules + secondary-signal catalogs for non-Latin), the pedagogy memory |

---

## 8. Follow-ups (logged)
- **Native student-error rules** (`ERROR_RULES`) for ko/ru/he/tl (grammar-error linguistics).
- **Native comm-function / discourse-move / context-tag catalogs** for non-Latin (now trivially addable via the `locale_catalogs` map).
- **Catalog refinement from real sessions** — monitor ko/ru/he/tl feedback-event fire rate post-cutover (same as the Spanish-catalog refinement), expand patterns as real tutor phrasings are observed.
- **This unblocks the S3.3 cutover prerequisite** ("validate/expand feedback-heuristic coverage for ko/ru/he/tl") recorded in the pedagogy memory.
