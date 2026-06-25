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
