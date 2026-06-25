"""Pure, locale-aware language-signal primitives shared by S5 drift detection
and the S3.2 chip fast gate. Stdlib only (import-boundary invariant 7a)."""
from __future__ import annotations
import re

SHORTFALL_MIN_CHARS = 12
TARGET_SCRIPT_MIN_RATIO = 0.5
ENGLISH_MARKER_MIN_HITS = 3

ENGLISH_FUNCTION_WORDS = frozenset({
    "the", "is", "are", "was", "were", "you", "your", "what", "which", "with",
    "this", "that", "they", "would", "should", "could", "have", "does",
    "okay", "let", "want", "need", "about", "because", "really",
})

_NON_LATIN_KEYS = frozenset({"ko", "ru", "he"})


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def language_locale_key(locale: object) -> str:
    n = _s(locale).lower()
    for key in ("ko", "ru", "he", "es", "fr", "tl"):
        if n.startswith(key):
            return key
    return "en"


def is_target_script_char(ch: str, locale_key: str) -> bool:
    o = ord(ch)
    if locale_key == "ko":
        return 0xAC00 <= o <= 0xD7A3 or 0x1100 <= o <= 0x11FF or 0x3130 <= o <= 0x318F
    if locale_key == "ru":
        return 0x0400 <= o <= 0x04FF
    if locale_key == "he":
        return 0x0590 <= o <= 0x05FF
    return False


def _target_script_ratio(text: str, locale_key: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    hits = sum(1 for c in letters if is_target_script_char(c, locale_key))
    return hits / len(letters)


def _english_marker_hits(text: str) -> int:
    words = set(re.findall(r"[a-z']+", text.lower()))
    return len(words & ENGLISH_FUNCTION_WORDS)


def _too_short(content: str) -> bool:
    # Use total stripped length so single CJK syllables (which are alpha)
    # are not under-counted relative to multi-byte Latin words.
    return len(_s(content)) < SHORTFALL_MIN_CHARS


def detect_target_language_shortfall(content: str, locale: object) -> bool:
    text = _s(content)
    if _too_short(text):
        return False
    key = language_locale_key(locale)
    if key == "en":
        return False
    if key in _NON_LATIN_KEYS:
        return _target_script_ratio(text, key) < TARGET_SCRIPT_MIN_RATIO
    # Latin target (es/fr/tl): distinctly-English function-word density
    return _english_marker_hits(text) >= ENGLISH_MARKER_MIN_HITS


def produced_target_language(content: str, locale: object) -> bool:
    """True when the learner produced enough non-fallback target content to be
    worth an LLM look (the floor's precondition)."""
    text = _s(content)
    if _too_short(text):
        return False
    if language_locale_key(locale) == "en":
        # No target≠L1 distinction for en; treat any sufficiently long turn as
        # worth a look so the floor still works for English assignments.
        return True
    return not detect_target_language_shortfall(text, locale)
