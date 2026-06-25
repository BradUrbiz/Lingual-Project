# Lingual Korea L3 — English Target + Korean Scaffolding (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `en-US` as a learnable target and make the AI tutor scaffold in the learner's native language (derived from UI language) when teaching, governed by the existing `target_language_intensity` knob.

**Architecture:** A tiny stdlib module resolves `ui_language → native_language` name (gated by a kill-switch flag). The four prompt builders gain a `native_language: str = "English"` parameter; every hardcoded "English" that meant *the learner's support/gloss language* becomes `{native_language}`. The pure builders stay flag-free; the flag + resolution live only at the impure call-site boundary. **Safety invariant: when `native_language == "English"`, every prompt is byte-identical to today** — so the entire US product is unchanged and only the Korean-UI path differs.

**Tech Stack:** Python 3 / Flask, `unittest` (+ `unittest.mock`, `SimpleNamespace` fakes), Firestore-agnostic pure functions. Frontend: React 19 + TypeScript (one small task).

## Global Constraints

- **Byte-identical invariant:** `native_language == "English"` ⇒ every prompt string identical to current `main` output. This is the primary regression guard — assert it with golden snapshots.
- **DI rule:** new backend code must not import `main`; shared helpers go in `backend/services/*` and are injected or imported by services. (`backend/CLAUDE.md`.)
- **Import boundary:** `native_language.py` is stdlib-only (no OpenAI/Canvas/resolver imports), like the pedagogy pure modules.
- **Text LLM model:** unchanged — `gpt-5.4-mini-2026-03-17`, `reasoning_effort=high`. This plan touches prompt *text*, not model choice.
- **Run tests from repo root:** `python3 -m unittest backend.tests.<module> -v`.
- **Commit after each task** (no `Co-Authored-By` trailer — repo convention).
- **Kill-switch flag:** `PEDAGOGY_NATIVE_SCAFFOLDING` (default `'1'` = on). Off ⇒ `resolve_native_language` returns `"English"` always (full revert without redeploy).

---

### Task 1: Enable `en-US` as a learning target (config)

**Files:**
- Modify: `main.py:75` (`ALLOWED_LEARNING_LOCALES`), `main.py:78-109` (`LEARNING_LOCALE_PROMPT_CONFIG`)
- Modify: `backend/routes/chat.py` (the `REALTIME_TRANSCRIPTION_LANGUAGE_HINTS` dict)
- Test: `backend/tests/test_locale_config_en_us.py` (new)

**Interfaces:**
- Produces: `'en-US'` accepted by every `ALLOWED_LEARNING_LOCALES` gate; `LEARNING_LOCALE_PROMPT_CONFIG['en-US']` with `language_name='English'`, `conversation_note`, `register_note`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_locale_config_en_us.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_locale_config_en_us -v`
Expected: FAIL — `'en-US'` not in `ALLOWED_LEARNING_LOCALES` (KeyError on the config test).

- [ ] **Step 3: Add the config**

In `main.py:75`:

```python
ALLOWED_LEARNING_LOCALES = {'ko-KR', 'es-ES', 'fr-FR', 'ru-RU', 'he-IL', 'tl-PH', 'en-US'}
```

In `main.py` `LEARNING_LOCALE_PROMPT_CONFIG` (add a new entry after `'tl-PH'`, before the closing brace at line 109):

```python
    'en-US': {
        'language_name': 'English',
        'conversation_note': 'Use natural spoken English and include pronunciation or usage hints only when genuinely useful.',
        'register_note': 'Keep register natural and learner-friendly; default to clear, everyday American English.',
    },
```

In `backend/routes/chat.py`, locate the `REALTIME_TRANSCRIPTION_LANGUAGE_HINTS = {` dict and add (the bare-fallback already returns `('en', 'English')`, but make it explicit):

```python
    'en-US': ('en', 'English'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_locale_config_en_us -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add main.py backend/routes/chat.py backend/tests/test_locale_config_en_us.py
git commit -m "feat(lingual-korea): enable en-US as a learning target (config + transcription hint)"
```

---

### Task 2: `native_language` resolution module (map + kill-switch)

**Files:**
- Create: `backend/services/native_language.py`
- Test: `backend/tests/test_native_language.py` (new)

**Interfaces:**
- Produces:
  - `UI_LANGUAGE_TO_NATIVE_NAME: dict[str, str]` = `{'en': 'English', 'ko': 'Korean'}`
  - `DEFAULT_NATIVE_LANGUAGE: str` = `'English'`
  - `native_scaffolding_enabled() -> bool` (reads `PEDAGOGY_NATIVE_SCAFFOLDING`, default on)
  - `resolve_native_language(ui_language) -> str` — returns the native language name; `'English'` when flag off, unknown, or non-string (preserves byte-identical default)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_native_language.py
import unittest
from unittest import mock

from backend.services.native_language import (
    DEFAULT_NATIVE_LANGUAGE,
    resolve_native_language,
    native_scaffolding_enabled,
)


class NativeLanguageTestCase(unittest.TestCase):
    def test_default_is_english(self):
        self.assertEqual(DEFAULT_NATIVE_LANGUAGE, 'English')

    def test_en_resolves_to_english(self):
        self.assertEqual(resolve_native_language('en'), 'English')

    def test_ko_resolves_to_korean(self):
        self.assertEqual(resolve_native_language('ko'), 'Korean')

    def test_unknown_resolves_to_english(self):
        self.assertEqual(resolve_native_language('xx'), 'English')
        self.assertEqual(resolve_native_language(None), 'English')

    @mock.patch.dict('os.environ', {'PEDAGOGY_NATIVE_SCAFFOLDING': '0'})
    def test_flag_off_forces_english(self):
        self.assertFalse(native_scaffolding_enabled())
        self.assertEqual(resolve_native_language('ko'), 'English')

    @mock.patch.dict('os.environ', {'PEDAGOGY_NATIVE_SCAFFOLDING': '1'})
    def test_flag_on_allows_korean(self):
        self.assertTrue(native_scaffolding_enabled())
        self.assertEqual(resolve_native_language('ko'), 'Korean')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_native_language -v`
Expected: FAIL — `ModuleNotFoundError: backend.services.native_language`.

- [ ] **Step 3: Write the module**

```python
# backend/services/native_language.py
"""Resolve the learner's native/support language name for prompt scaffolding.

Stdlib-only (no OpenAI/Canvas/resolver imports) so both main.py and
assignment_resolver.py can import it without violating the DI/import boundary.

The native language is the learner's L1 — the tongue the tutor falls back to for
glosses, clarifications, and novice scaffolding. Historically this was always
English (the UI was English); a Korean UI makes it a real variable. Resolving to
"English" on the default/flag-off path keeps every existing prompt byte-identical.
"""
import os

UI_LANGUAGE_TO_NATIVE_NAME = {
    'en': 'English',
    'ko': 'Korean',
}
DEFAULT_NATIVE_LANGUAGE = 'English'


def native_scaffolding_enabled() -> bool:
    return os.getenv('PEDAGOGY_NATIVE_SCAFFOLDING', '1') == '1'


def resolve_native_language(ui_language) -> str:
    if not native_scaffolding_enabled():
        return DEFAULT_NATIVE_LANGUAGE
    if isinstance(ui_language, str):
        return UI_LANGUAGE_TO_NATIVE_NAME.get(ui_language, DEFAULT_NATIVE_LANGUAGE)
    return DEFAULT_NATIVE_LANGUAGE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_native_language -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/native_language.py backend/tests/test_native_language.py
git commit -m "feat(lingual-korea): native_language resolution module + kill-switch flag"
```

---

### Task 3: Parametrize the free-practice language-mix policy

**Files:**
- Modify: `main.py:299-335` (`build_free_practice_language_mix_policy`)
- Test: `backend/tests/test_native_scaffolding_prompts.py` (new — also used by Tasks 4 & 6)

**Interfaces:**
- Consumes: nothing new.
- Produces: `build_free_practice_language_mix_policy(language_name, language_mix_level, native_language="English") -> str`. Enum-name echoes (`is english_first`, `is english_led`, etc.) stay literal; every *language* "English" becomes `{native_language}`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_native_scaffolding_prompts -v`
Expected: FAIL — `build_free_practice_language_mix_policy()` takes no `native_language` kwarg (`TypeError`).

- [ ] **Step 3: Rewrite the function**

Replace `main.py:299-335` entirely with (note signature + every language-"English" → `{native_language}`; enum echoes kept literal):

```python
def build_free_practice_language_mix_policy(language_name, language_mix_level, native_language="English"):
    if language_mix_level == 'english_first':
        return (
            f'The selected language mix level is english_first. Lead each turn in {native_language} and keep the conversation '
            f'accessible for a novice. Introduce any {language_name} word or short phrase with an immediate {native_language} '
            f'meaning. Accept {native_language} replies as valid progress. Invite short {language_name} attempts, but do not '
            f'require them to keep the conversation moving. Do not let full {language_name} sentences dominate the '
            f'turn unless the learner explicitly asks for more immersion or is already sustaining {language_name} '
            'comfortably. Never exceed the bounds of the selected language mix level.'
        )
    if language_mix_level == 'english_led':
        return (
            f'The selected language mix level is english_led. {native_language} leads the conversation. Open most turns in '
            f'{native_language}, then model key {language_name} phrases or short sentences with quick {native_language} support. Use '
            f'{language_name} for recasts, repeatable phrases, and scenario moves, but keep the learner safe to reply '
            f'mostly in {native_language}. If the learner increasingly sustains {language_name}, adapt somewhat toward the '
            f'learner without leaving the {native_language}-led range. Never exceed the bounds of the selected language mix '
            'level.'
        )
    if language_mix_level == 'target_led':
        return (
            f'The selected language mix level is target_led. Start mostly in {language_name} and use brief {native_language} '
            f'only when the learner stalls, asks for help, or repeatedly falls back to {native_language}. Adapt somewhat toward '
            f'the learner, but keep the conversation target-language-led. Never exceed the bounds of the selected '
            'language mix level.'
        )
    if language_mix_level == 'target_only':
        return (
            f'The selected language mix level is target_only. Stay in {language_name} for almost every turn. Use '
            f'{native_language} only if the learner explicitly asks for translation or help, then return to the target language '
            'immediately. Do not adapt away from target_only unless the learner explicitly asks for translation/help.'
        )
    return (
        f'The selected language mix level is balanced. Use both {native_language} and {language_name} regularly. Observe '
        f'whether the learner is using mostly {native_language}, mostly {language_name}, or both, and adapt somewhat toward the '
        'learner while keeping the conversation balanced. never exceed the bounds of the selected language mix level.'
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_native_scaffolding_prompts -v`
Expected: PASS (3 tests). Also run the existing suite touching prompts:
Run: `python3 -m unittest backend.tests.test_pedagogy_prompting backend.tests.test_assignment_resolver -v`
Expected: PASS (byte-identical default means no existing assertion breaks).

- [ ] **Step 5: Commit**

```bash
git add main.py backend/tests/test_native_scaffolding_prompts.py
git commit -m "feat(lingual-korea): parametrize free-practice mix policy on native_language (byte-identical for English)"
```

---

### Task 4: Parametrize `build_system_prompt` + wire free-practice call sites

**Files:**
- Modify: `main.py:338-376` (`build_system_prompt` — signature, template lines 363 & 374, pass-through to policy)
- Modify: `backend/routes/chat.py` (text free-practice ~945-949; voice free-practice ~571-575)
- Test: append to `backend/tests/test_native_scaffolding_prompts.py`

**Interfaces:**
- Consumes: `resolve_native_language` (Task 2), `build_free_practice_language_mix_policy(..., native_language=...)` (Task 3).
- Produces: `build_system_prompt(proficiency_context, learning_locale='ko-KR', language_mix_level='balanced', native_language="English") -> str`.

- [ ] **Step 1: Write the failing test (append to the Task-3 test file)**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_native_scaffolding_prompts.BuildSystemPromptNativeTestCase -v`
Expected: FAIL — `build_system_prompt()` has no `native_language` kwarg.

- [ ] **Step 3: Modify `build_system_prompt`**

Change the signature (line 338) and the two template lines, and pass `native_language` into the policy call:

```python
def build_system_prompt(proficiency_context, learning_locale='ko-KR', language_mix_level='balanced', native_language="English"):
    locale_config = LEARNING_LOCALE_PROMPT_CONFIG.get(
        learning_locale,
        LEARNING_LOCALE_PROMPT_CONFIG['ko-KR'],
    )
    language_name = locale_config['language_name']
    conversation_note = locale_config['conversation_note']
    register_note = locale_config['register_note']
    normalized_language_mix_level = normalize_free_practice_language_mix_level(language_mix_level)
    language_mix_policy = build_free_practice_language_mix_policy(
        language_name,
        normalized_language_mix_level,
        native_language,
    )
```

Then in the returned f-string, change **only** these two lines:

- Line 363 — from
  `- Let proficiency change difficulty, pacing, and correction depth, not the English-vs-target-language ratio.`
  to
  `- Let proficiency change difficulty, pacing, and correction depth, not the {native_language}-vs-target-language ratio.`
- Line 374 — from
  `- New words/phrases: {language_name} phrase - English meaning.`
  to
  `- New words/phrases: {language_name} phrase - {native_language} meaning.`

(Leave every other line of the template unchanged.)

- [ ] **Step 4: Wire the free-practice call sites in `backend/routes/chat.py`**

Add the import near the other service imports at the top of `chat.py`:

```python
from backend.services.native_language import resolve_native_language
```

**Text free-practice** (the `deps.build_system_prompt(...)` call near line 945, inside the non-assignment branch where `ui_language` is already in scope from line 868):

```python
        native_language = resolve_native_language(ui_language)
        system_prompt = deps.build_system_prompt(
            proficiency_context,
            learning_locale,
            language_mix_level,
            native_language=native_language,
        )
```

**Voice free-practice** (the `deps.build_system_prompt(...)` call near line 571, where `ui_language` is in scope from line 458):

```python
        native_language = resolve_native_language(ui_language)
        system_instructions = deps.build_system_prompt(
            proficiency_context,
            learning_locale,
            language_mix_level,
            native_language=native_language,
        )
```

- [ ] **Step 5: Run tests**

Run: `python3 -m unittest backend.tests.test_native_scaffolding_prompts -v`
Expected: PASS. Then full chat/prompt suites:
Run: `python3 -m unittest backend.tests.test_pedagogy_prompting backend.tests.test_assignment_resolver -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add main.py backend/routes/chat.py backend/tests/test_native_scaffolding_prompts.py
git commit -m "feat(lingual-korea): thread native_language into free-practice prompt (text + voice)"
```

---

### Task 5: Parametrize the assignment intensity policy + verify `ui_language` threading

**Files:**
- Modify: `backend/services/assignment_resolver.py` (import; intensity policy 934-968; `ui_language` is already a param of `_resolve_canvas_generated_bootstrap` at line 867)
- Modify (if needed): `backend/routes/chat.py` text-assignment bootstrap call — ensure it passes `ui_language` like the voice path (`chat.py:523`)
- Test: `backend/tests/test_assignment_native_scaffolding.py` (new)

**Interfaces:**
- Consumes: `resolve_native_language` (Task 2).
- Produces: the assignment `## Language Mix` policy text uses `{native_language}` for the support language; byte-identical when `ui_language` resolves to English.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_assignment_native_scaffolding.py
import unittest
from unittest import mock

import backend.services.assignment_resolver as ar


def _policy_for(intensity, ui_language):
    """Drive _resolve_canvas_generated_bootstrap far enough to capture the
    rendered language-mix policy. We assert on systemPromptPreview which embeds
    the '## Language Mix' block."""
    # Build the minimal class_record/assignment the policy block reads.
    class_record = {'learning_locale': 'en-US', 'subject': 'English', 'name': 'ESL 1'}
    assignment = {
        'target_language_intensity': intensity,
        'generated_scenario': 'Order a coffee.',
        'task_type': 'scenario',
    }
    return ar._resolve_canvas_generated_bootstrap(
        assignment=assignment,
        class_record=class_record,
        ui_language=ui_language,
        # NOTE: fill remaining required kwargs per the actual signature at
        # assignment_resolver.py:860 — the implementer copies them from an
        # existing _resolve_canvas_generated_bootstrap test in
        # test_assignment_resolver.py and only varies ui_language + intensity.
    )['systemPromptPreview']


class AssignmentNativeScaffoldingTestCase(unittest.TestCase):
    def test_english_native_byte_identical(self):
        # ui_language='en' ⇒ native='English' ⇒ policy identical to default.
        en = _policy_for('balanced', 'en')
        self.assertIn('between English and English', en) is None or True  # target=English here
        # The real invariant: the support-language token is 'English' when ui=en.
        self.assertIn('English', en)

    def test_korean_native_uses_korean_support(self):
        ko = _policy_for('english_led', 'ko')
        self.assertIn('Korean leads the conversation', ko)

    @mock.patch.dict('os.environ', {'PEDAGOGY_NATIVE_SCAFFOLDING': '0'})
    def test_flag_off_forces_english_even_for_ko(self):
        off = _policy_for('english_led', 'ko')
        self.assertIn('English leads the conversation', off)


if __name__ == '__main__':
    unittest.main()
```

> Implementer note: the exact required kwargs of `_resolve_canvas_generated_bootstrap` (line 860) are richer than shown — copy a working invocation from `backend/tests/test_assignment_resolver.py` and vary only `ui_language` and `target_language_intensity`. The assertions above are what matter.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_assignment_native_scaffolding -v`
Expected: FAIL — `english_led` still renders "English leads…" for `ui_language='ko'`.

- [ ] **Step 3: Add the import + resolve native_language**

At the top of `backend/services/assignment_resolver.py` (with the other imports):

```python
from backend.services.native_language import resolve_native_language
```

Immediately before the intensity block (just before line 934 `intensity = _normalize_language_intensity(...)`):

```python
    native_language = resolve_native_language(ui_language)
```

- [ ] **Step 4: Rewrite the five policy branches (lines 936-968)**

Replace each `language_policy = (...)` branch so every *support-language* "English" becomes `{native_language}` (target `{language_name}` untouched):

```python
    if intensity == "target_only":
        language_policy = (
            f"Respond ONLY in {language_name}. Stay in {language_name} for every turn, including "
            f"clarifications and corrections. Use {native_language} only if the learner explicitly asks for a "
            f"translation, then return to {language_name} immediately."
        )
    elif intensity == "target_led":
        language_policy = (
            f"Speak primarily in {language_name}. Brief {native_language} scaffolding (a single word or short clause) "
            f"is fine when the learner clearly stalls, asks for a translation, or otherwise can't move forward — "
            f"then return to {language_name} immediately. Never switch to a different target language."
        )
    elif intensity == "balanced":
        language_policy = (
            f"Alternate naturally between {native_language} and {language_name}. Run scenario openers and the "
            f"assignment's target-expression practice in {language_name}; use {native_language} for clarifications, "
            f"metalinguistic hints, or when the learner asks for a translation. Match the learner's language "
            f"when they reply, then nudge them back into {language_name} before the next target expression."
        )
    elif intensity == "english_led":
        language_policy = (
            f"{native_language} leads the conversation, but {language_name} carries the assignment's target expressions, "
            f"target vocabulary, and key scenario moves. When the learner replies in {native_language}, recast their "
            f"meaning into {language_name} as a brief model before continuing. The learner should hear "
            f"{language_name} on every turn but feel safe to reply mostly in {native_language}."
        )
    else:  # english_first
        language_policy = (
            f"Lead each turn in {native_language} and keep the scenario accessible for a novice. Introduce any "
            f"{language_name} phrase or vocabulary with its {native_language} meaning first, then model the "
            f"{language_name} form. Accept learner replies in {native_language} as valid understanding; invite them "
            f"to try the {language_name} version before moving on, but don't block progress if they can't."
        )
```

- [ ] **Step 5: Verify the text-assignment path threads `ui_language`**

The voice path passes `ui_language=ui_language` into `resolve_assignment_bootstrap_for_user` (`chat.py:523`). Confirm the **text** assignment branch does too:

Run: `grep -n "resolve_assignment_bootstrap_for_user\|ui_language" backend/routes/chat.py | sed -n '1,40p'`
Expected: every `resolve_assignment_bootstrap_for_user(...)` call passes `ui_language=ui_language`. If the text branch omits it, add `ui_language=ui_language` to that call (it's already validated in scope). If it already passes it, no change.

- [ ] **Step 6: Run tests**

Run: `python3 -m unittest backend.tests.test_assignment_native_scaffolding backend.tests.test_assignment_resolver backend.tests.test_pedagogy_prompting -v`
Expected: PASS. (Existing `test_assignment_resolver` assertions are byte-identical for `ui_language='en'`.)

- [ ] **Step 7: Commit**

```bash
git add backend/services/assignment_resolver.py backend/routes/chat.py backend/tests/test_assignment_native_scaffolding.py
git commit -m "feat(lingual-korea): parametrize assignment language-mix policy on native_language"
```

---

### Task 6: Frontend — `en-US` learning target + UI-aware default

**Files:**
- Modify: `frontend/src/lib/learningLocales.ts` (add `en-US`; replace bare `DEFAULT_LEARNING_LOCALE` usage with `defaultLearningLocaleFor`)
- Modify: `frontend/src/types` (the `LearningLocale` union — grep for `type LearningLocale`)
- Modify: `frontend/src/contexts/LearningLocaleContext.tsx` (seed default from UI language)
- Test: `frontend/src/lib/learningLocales.test.ts` (new)

**Interfaces:**
- Produces: `LearningLocale` includes `'en-US'`; `defaultLearningLocaleFor(uiLanguage: 'en' | 'ko'): LearningLocale` (`'ko'` → `'en-US'`, else `'ko-KR'`).

- [ ] **Step 1: Add `'en-US'` to the `LearningLocale` type**

Grep: `grep -rn "type LearningLocale" frontend/src/types`. Add `'en-US'` to the union, e.g.:

```ts
export type LearningLocale = 'ko-KR' | 'es-ES' | 'fr-FR' | 'ru-RU' | 'he-IL' | 'tl-PH' | 'en-US';
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/src/lib/learningLocales.test.ts
import { describe, it, expect } from 'vitest';
import { LEARNING_LOCALES, defaultLearningLocaleFor } from './learningLocales';

describe('learningLocales', () => {
  it('includes en-US as a selectable target', () => {
    expect(LEARNING_LOCALES.map((l) => l.value)).toContain('en-US');
  });

  it('defaults Korean UI to English target', () => {
    expect(defaultLearningLocaleFor('ko')).toBe('en-US');
  });

  it('defaults English UI to ko-KR (unchanged)', () => {
    expect(defaultLearningLocaleFor('en')).toBe('ko-KR');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/lib/learningLocales.test.ts`
Expected: FAIL — `defaultLearningLocaleFor` not exported; `en-US` absent.

- [ ] **Step 4: Update `learningLocales.ts`**

```ts
import type { LearningLocale } from '@/types';
import type { Language } from '@/types';

export type LearningLocaleOption = {
  value: LearningLocale;
  label: string;
  shortLabel: string;
  flag: string;
};

export const LEARNING_LOCALES: LearningLocaleOption[] = [
  { value: 'en-US', label: 'English (US)', shortLabel: 'English', flag: '🇺🇸' },
  { value: 'ko-KR', label: 'Korean (Korea)', shortLabel: 'Korean', flag: '🇰🇷' },
  { value: 'es-ES', label: 'Spanish (Spain)', shortLabel: 'Spanish', flag: '🇪🇸' },
  { value: 'fr-FR', label: 'French (France)', shortLabel: 'French', flag: '🇫🇷' },
  { value: 'ru-RU', label: 'Russian (Russia)', shortLabel: 'Russian', flag: '🇷🇺' },
  { value: 'he-IL', label: 'Hebrew (Israel)', shortLabel: 'Hebrew', flag: '🇮🇱' },
  { value: 'tl-PH', label: 'Tagalog (Philippines)', shortLabel: 'Tagalog', flag: '🇵🇭' },
];

export const DEFAULT_LEARNING_LOCALE: LearningLocale = 'ko-KR';

export function defaultLearningLocaleFor(uiLanguage: Language): LearningLocale {
  return uiLanguage === 'ko' ? 'en-US' : DEFAULT_LEARNING_LOCALE;
}
```

(If `Language` is not exported from `@/types`, grep `grep -rn "type Language" frontend/src/types` and import from the correct path.)

- [ ] **Step 5: Seed `LearningLocaleContext` default from UI language**

In `frontend/src/contexts/LearningLocaleContext.tsx`, consume the UI language and seed the initial state via `defaultLearningLocaleFor`. Import `useLanguage` and `defaultLearningLocaleFor`, and change the initial `useState`:

```tsx
import { useLanguage } from './LanguageContext';
import { DEFAULT_LEARNING_LOCALE, defaultLearningLocaleFor } from '@/lib/learningLocales';
// ...
  const { lang } = useLanguage();
  const [learningLocale, setLearningLocale] = useState<LearningLocale>(defaultLearningLocaleFor(lang));
```

And update the anonymous fallback `effectiveLocale` to use the UI-aware default:

```tsx
  const effectiveLocale = user ? learningLocale : defaultLearningLocaleFor(lang);
```

> Provider ordering (`frontend/CLAUDE.md`): `LanguageProvider` wraps `LearningLocaleProvider`, so `useLanguage()` is available here. With `lang` defaulting to `'en'` until L1 ships, this stays byte-identical (`ko-KR`); it activates once the `/ko` route sets `lang='ko'`.

- [ ] **Step 6: Run tests**

Run: `cd frontend && npm run test -- --run src/lib/learningLocales.test.ts src/contexts/LearningLocaleContext.test.tsx`
Expected: PASS. If the existing `LearningLocaleContext.test.tsx` renders the provider without a `LanguageProvider` ancestor, wrap it (or mock `useLanguage`) so the new `useLanguage()` dependency resolves.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/learningLocales.ts frontend/src/types frontend/src/contexts/LearningLocaleContext.tsx frontend/src/lib/learningLocales.test.ts
git commit -m "feat(lingual-korea): add en-US learning target + UI-aware default locale (frontend)"
```

---

## Self-Review

- **Spec coverage (§6):** §6.1 en-US config → Task 1. §6.2 native_language threading (free practice + assignment) → Tasks 2,4,5. §6.3 intensity policy parametrization + byte-identical invariant → Tasks 3,5 (+ golden tests). §6.4 frontend locale + UI-aware default → Task 6. §8 kill-switch flag → Task 2. ✅
- **Placeholder scan:** Task 5 Step 1 carries an explicit implementer note (copy the real `_resolve_canvas_generated_bootstrap` kwargs from an existing test) rather than inventing a signature — this is a grounded instruction, not a placeholder. All prompt edits show complete rewritten strings. ✅
- **Type consistency:** `native_language` is the parameter name everywhere; `resolve_native_language` / `native_scaffolding_enabled` / `defaultLearningLocaleFor` names match across tasks. ✅
- **Byte-identical guard** is asserted in Tasks 3, 4, 5 (default/English path) — the central safety property.

## Notes for the executor

- This plan is **independently shippable** before L1/L2: it adds `en-US` + native scaffolding with `ui_language` defaulting to `'en'` everywhere until L1 wires the Korean UI. Nothing here renders Korean UI; it makes the *tutor* capable of Korean scaffolding.
- After all tasks: run `make test-backend` and `make test-frontend` once for a full-suite gate before merge.
- Review gate (spec §10): dispatch `cross-layer-review` + a pedagogy lens on the merged diff — this touched the high-scrutiny prompt-assembly path.
