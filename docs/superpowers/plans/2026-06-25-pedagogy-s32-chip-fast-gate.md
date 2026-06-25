# S3.2 Coach-Chip Fast Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the S3.2 live coach chip fire on turn 1 across all locales (not just en/fr) via a locale-agnostic L1-fallback signal plus a bounded periodic floor, behind `PEDAGOGY_ENGINE_CHIP_FAST_GATE` (default 0, byte-identical when off).

**Architecture:** Localize to `coach_chip_service` — compute the learner-side L1-fallback from the transcript the chip already fetches; do NOT emit new `learning_events` (keeps analytics/debrief and flag-off byte-identical). Shared language-detection primitives move to a new pure module `language_signal.py`, reused by S5 `drift.py`.

**Tech Stack:** Python 3 (stdlib only for the pure module — import-boundary invariant 7a), unittest.

## Global Constraints

- Pure module `language_signal.py` imports **stdlib only** (no OpenAI/Canvas/resolver/compliance/practice_analytics) — invariant 7a. It must be importable by the `ImportBoundaryTestCase` probe in `backend/tests/test_pedagogy_engine_s1.py`.
- Flag name EXACTLY `PEDAGOGY_ENGINE_CHIP_FAST_GATE`; accessor `chip_fast_gate_enabled()` mirrors `coach_chips_enabled()` in `backend/services/pedagogy/integration.py`.
- Flag OFF ⇒ `generate_coach_chip` behavior byte-identical to today (same gate, no new analysis_state field write).
- Text LLM model stays `gpt-5.4-mini-2026-03-17`; do NOT change `parse_coach_chip` chip-worthiness logic.
- `drift.py` observable behavior MUST stay byte-identical after refactor (existing drift tests are the gate). S5 `DIRECTOR` is off in prod.
- Constants: `SHORTFALL_MIN_CHARS = 12`, `TARGET_SCRIPT_MIN_RATIO = 0.5`, `ENGLISH_MARKER_MIN_HITS = 3`, `FLOOR_TURN_GAP = 2`.
- cloudbuild: every `--set-env-vars` / `--set-secrets` REPLACES the whole env; add `_PEDAGOGY_ENGINE_CHIP_FAST_GATE` default `'0'` to BOTH the set-env-vars line and the substitutions block. Do not alter other substitution defaults.

---

### Task 1: Shared language-signal module + learner shortfall detector

**Files:**
- Create: `backend/services/pedagogy/language_signal.py`
- Create: `backend/tests/test_pedagogy_language_signal.py`
- Modify: `backend/services/pedagogy/drift.py` (import shared primitives; remove private copies; keep behavior identical)

**Interfaces:**
- Produces:
  - `language_locale_key(locale: object) -> str` — prefix-matches `ko/ru/he/es/fr/tl`, else `"en"`.
  - `is_target_script_char(ch: str, locale_key: str) -> bool` — Hangul/Cyrillic/Hebrew ranges.
  - `ENGLISH_FUNCTION_WORDS: frozenset[str]` — the distinctly-English function-word set (verbatim copy of drift's current set).
  - `SHORTFALL_MIN_CHARS = 12`, `TARGET_SCRIPT_MIN_RATIO = 0.5`, `ENGLISH_MARKER_MIN_HITS = 3`.
  - `detect_target_language_shortfall(content: str, locale: object) -> bool`
  - `produced_target_language(content: str, locale: object) -> bool`

- [ ] **Step 1: Write failing tests for the detector**

```python
# backend/tests/test_pedagogy_language_signal.py
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
```

- [ ] **Step 2: Run tests, verify they fail** (`module not found` / `AttributeError`).
Run: `python3 -m unittest backend.tests.test_pedagogy_language_signal -v`
Expected: FAIL.

- [ ] **Step 3: Implement `language_signal.py`**

Lift `_drift_locale_key`, `_is_target_script_char`, and `_ENGLISH_FUNCTION_WORDS` verbatim from `drift.py` into public names. Then:

```python
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
    return len([c for c in _s(content) if c.isalpha()]) < SHORTFALL_MIN_CHARS


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
```

- [ ] **Step 4: Run tests, verify pass.**
Run: `python3 -m unittest backend.tests.test_pedagogy_language_signal -v` → PASS.

- [ ] **Step 5: Refactor `drift.py` to import shared primitives**

In `drift.py`: replace the private `_drift_locale_key`, `_is_target_script_char`, and `_ENGLISH_FUNCTION_WORDS` with imports from `language_signal`:
```python
from backend.services.pedagogy.language_signal import (
    ENGLISH_FUNCTION_WORDS as _ENGLISH_FUNCTION_WORDS,
    is_target_script_char as _is_target_script_char,
    language_locale_key as _drift_locale_key,
)
```
Delete the now-duplicate definitions. Leave `LANGUAGE_DRIFT_MIN_CHARS`, `TARGET_SCRIPT_MIN_RATIO`, `ENGLISH_MARKER_MIN_HITS`, `_NON_LATIN_DRIFT_KEYS`, and all drift decision logic untouched. Do not change any drift function signature or output.

- [ ] **Step 6: Run the full drift + pedagogy suite, verify byte-identical drift behavior.**
Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s5 backend.tests.test_pedagogy_language_signal -v`
Expected: all PASS (drift tests unchanged). If any drift test changes outcome, the refactor diverged — fix to restore parity (do NOT edit the drift tests).

- [ ] **Step 7: Commit**
```bash
git add backend/services/pedagogy/language_signal.py backend/tests/test_pedagogy_language_signal.py backend/services/pedagogy/drift.py
git commit -m "feat(pedagogy-s3.2): shared language-signal module + learner target-language-shortfall detector"
```

---

### Task 2: Flag accessor + cloudbuild wiring + import-boundary probe

**Files:**
- Modify: `backend/services/pedagogy/integration.py`
- Modify: `backend/tests/test_pedagogy_engine_s1.py` (ImportBoundaryTestCase probe — add the new module)
- Modify: `cloudbuild.yaml`
- Test: `backend/tests/test_pedagogy_engine_s3.py` (the flag-accessor tests — `coach_chips_enabled` is tested here; the flag accessor in `integration.py` uses the `_TRUTHY` pattern: `os.environ.get("PEDAGOGY_ENGINE_CHIP_FAST_GATE", "").strip().lower() in _TRUTHY`)

**Interfaces:**
- Produces: `chip_fast_gate_enabled() -> bool`

- [ ] **Step 1: Write failing test for the flag accessor**

Mirror the existing `coach_chips_enabled` flag test. Example:
```python
def test_chip_fast_gate_flag(self):
    from backend.services.pedagogy.integration import chip_fast_gate_enabled
    with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_CHIP_FAST_GATE": "1"}):
        self.assertTrue(chip_fast_gate_enabled())
    with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_CHIP_FAST_GATE": "0"}):
        self.assertFalse(chip_fast_gate_enabled())
    with mock.patch.dict(os.environ, {}, clear=True):
        self.assertFalse(chip_fast_gate_enabled())
```
(Place it beside the existing `coach_chips_enabled` flag test; reuse that file's imports/pattern.)

- [ ] **Step 2: Run, verify fail** (`ImportError`). 

- [ ] **Step 3: Implement accessor** in `integration.py`, mirroring `coach_chips_enabled` exactly (same `_flag`/truthy helper):
```python
def chip_fast_gate_enabled() -> bool:
    return _flag("PEDAGOGY_ENGINE_CHIP_FAST_GATE")
```
(Use whatever the existing private helper is named; match `coach_chips_enabled` line-for-line.)

- [ ] **Step 4: Add the new module to the import-boundary probe** in `backend/tests/test_pedagogy_engine_s1.py`: add `"import backend.services.pedagogy.language_signal\n"` to the `ImportBoundaryTestCase` probe source and update the failure-message module list, matching how `assignment_debrief` was added.

- [ ] **Step 5: Wire cloudbuild.yaml** — add `_PEDAGOGY_ENGINE_CHIP_FAST_GATE` to the `--set-env-vars` line (as `PEDAGOGY_ENGINE_CHIP_FAST_GATE=${_PEDAGOGY_ENGINE_CHIP_FAST_GATE}`) and add `_PEDAGOGY_ENGINE_CHIP_FAST_GATE: '0'` to the `substitutions:` block. Confirm by diffing that no other substitution default changed.

- [ ] **Step 6: Run flag + import-boundary tests, verify pass.**
Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1 -v` and the flag-accessor test.

- [ ] **Step 7: Commit**
```bash
git add backend/services/pedagogy/integration.py backend/tests/test_pedagogy_engine_s1.py cloudbuild.yaml backend/tests/test_pedagogy_engine_s3.py
git commit -m "feat(pedagogy-s3.2): PEDAGOGY_ENGINE_CHIP_FAST_GATE flag + cloudbuild wiring (default 0)"
```

---

### Task 3: Fast gate in `coach_chip_service` (shortfall + bounded floor)

**Files:**
- Modify: `backend/services/coach_chip_service.py`
- Modify: `backend/services/practice_analytics.py` (`default_analysis_state` + `normalize_analysis_state`: add `coach_chip_last_eval_turn`)
- Test (analysis_state field): `backend/tests/test_practice_analytics.py`
- Create (gate-logic unit tests): `backend/tests/test_coach_chip_service.py` — there is NO existing direct unit test of `generate_coach_chip` (the existing `test_curriculum_admin_coach_chip_route.py` patches `generate_coach_chip` whole at the route level). Build a `FakeDeps` stubbing the `deps.db` methods `generate_coach_chip` calls: `get_practice_session(session_id)`, `list_session_learning_events(session_id)`, `get_chat_session(uid, chat_id)`, `update_practice_session_analysis_state(session_id, state, sql_engine=...)`, plus `get_openai_client()` (return a fake whose `.chat.completions.create(...)` records calls and returns a canned JSON chip, or a sentinel to assert it was NOT called). Bootstrap needs `mapping.targetExpressions` (non-empty so the early `if not targets` guard passes). Session needs `transcript_ref={'chat_id': ...}`, `curriculum_snapshot.package.learningLocale`, and `analysis_state`.

**Interfaces:**
- Consumes: `chip_fast_gate_enabled()` (Task 2); `detect_target_language_shortfall`, `produced_target_language` (Task 1).
- Locale source: `session["curriculum_snapshot"]["package"]["learningLocale"]` (read inline; fall back to `"en"`).

- [ ] **Step 1: Add `coach_chip_last_eval_turn` to analysis_state (failing test first)**

Test in the analytics test file (match where `normalize_analysis_state` is tested):
```python
def test_analysis_state_carries_coach_chip_last_eval_turn(self):
    from backend.services.practice_analytics import normalize_analysis_state, default_analysis_state
    self.assertIsNone(default_analysis_state()["coach_chip_last_eval_turn"])
    self.assertEqual(
        normalize_analysis_state({"coach_chip_last_eval_turn": 4})["coach_chip_last_eval_turn"], 4)
    self.assertIsNone(
        normalize_analysis_state({"coach_chip_last_eval_turn": "x"})["coach_chip_last_eval_turn"])
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the field** — add `'coach_chip_last_eval_turn': None,` to `default_analysis_state()`, and in `normalize_analysis_state` coerce via the existing `_coerce_int` (None when absent/invalid). Place beside `coach_chips`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Write failing tests for the gate logic**

In the chip-service test file, add cases (use the existing test's deps/bootstrap/session fakes as the template; the chip-service tests already stub `deps.db`, `get_openai_client`, etc.):

```python
# Flag OFF => byte-identical: a turn with NO corrective event and an
# English-fallback learner turn must NOT open the gate (returns None without
# calling the LLM).
def test_flag_off_no_corrective_signal_no_chip(self): ...

# Flag ON => English-fallback learner turn opens the gate on turn 1 even with
# no corrective learning_event (LLM eval is invoked).
def test_flag_on_shortfall_opens_gate_turn1(self): ...

# Flag ON => floor: after FLOOR_TURN_GAP turns with no eval and a real
# target-language turn, the gate opens; coach_chip_last_eval_turn is advanced
# even when parse_coach_chip returns None.
def test_flag_on_floor_opens_after_gap_and_advances_last_eval_turn(self): ...

# Flag ON => floor does NOT open before the gap (last_eval_turn recent).
def test_flag_on_floor_suppressed_within_gap(self): ...
```
Assert on whether `get_openai_client().chat.completions.create` was called (gate opened) and on the persisted `coach_chip_last_eval_turn`.

- [ ] **Step 6: Run, verify fail.**

- [ ] **Step 7: Implement the gate change in `generate_coach_chip`**

- Move the transcript fetch (`transcript_ref` → `get_chat_session` → `window = messages[-TRANSCRIPT_WINDOW:]`) to BEFORE the gate decision. Derive `latest_learner = ` content of the last `window` message with `role == "user"` (`""` if none).
- Read locale inline: `locale = (((session.get("curriculum_snapshot") or {}).get("package") or {}).get("learningLocale")) or "en"`.
- Replace the single gate check:
```python
corrective = _turn_had_corrective_signal(events, turn_index)
fast = chip_fast_gate_enabled()
if fast:
    shortfall = detect_target_language_shortfall(latest_learner, locale)
    last_eval = analysis_state.get("coach_chip_last_eval_turn")
    gap = (turn_index - last_eval) if isinstance(last_eval, int) else (turn_index + 1)
    floor = gap >= FLOOR_TURN_GAP and produced_target_language(latest_learner, locale)
    open_gate = corrective or shortfall or floor
else:
    open_gate = corrective
if not open_gate:
    return None
```
- `FLOOR_TURN_GAP = 2` module constant.
- On the analysis_state write path: whenever the LLM eval ran (gate opened, `fast` on), set `target_state["coach_chip_last_eval_turn"] = turn_index` on the same re-read-before-write update that persists `coach_chips`. **Critical:** this must also persist when `parse_coach_chip` returns `None` under the fast gate — i.e. if `item is None` and `fast`, still do the re-read + write of `coach_chip_last_eval_turn` (without appending a chip), then return None. Keep the existing `item is None ⇒ return None` early-return for the flag-OFF path so off-behavior is unchanged.
- Keep all existing dedup, re-read-before-write, and S3.3 promote-back logic intact.

- [ ] **Step 8: Run chip-service + analytics tests, verify pass.**
Run: `python3 -m unittest backend.tests.test_coach_chip_service -v`

- [ ] **Step 9: Run full backend suite.**
Run: `make test-backend`
Expected: all green.

- [ ] **Step 10: Commit**
```bash
git add backend/services/coach_chip_service.py backend/services/practice_analytics.py backend/tests/test_coach_chip_service.py
git commit -m "feat(pedagogy-s3.2): fast chip gate — L1-fallback signal + bounded floor (PEDAGOGY_ENGINE_CHIP_FAST_GATE)"
```

---

## Self-Review

- Spec coverage: shortfall signal (Task 1+3), bounded floor (Task 3), flag + byte-identical-off (Task 2+3), cloudbuild (Task 2), drift parity (Task 1). ✓
- The floor advances `coach_chip_last_eval_turn` even on None evals → cost bounded. ✓
- No new `learning_events` emitted → analytics/debrief untouched. ✓
- Pure module stdlib-only + in import-boundary probe. ✓
