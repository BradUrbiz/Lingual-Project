# S5 Director v2 — Language-Drift Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second drift signal — language-drift (the tutor slipping out of the target language into English) — to the S5 Director, behind the existing `PEDAGOGY_ENGINE_DIRECTOR` flag.

**Architecture:** Extend the pure detector module `backend/services/pedagogy/drift.py` with `detect_language_drift` (two tiers: non-Latin target-script ratio; Latin English-function-word density) and a kind-branched `build_resteer_prompt`. Rewire the impure orchestrator `backend/services/director_service.py` to run language-drift first (it needs no targets and takes precedence), falling back to target-neglect. All v1 plumbing (`decide_resteer` guards, persistence, delivery channels, the flag) is reused unchanged.

**Tech Stack:** Python 3 / Flask, `unittest`, stdlib `unicodedata`/`re`/`dataclasses`.

## Global Constraints

- **No new flag / route / persistence key / frontend change.** v2 rides v1's plumbing entirely: same `PEDAGOGY_ENGINE_DIRECTOR` flag, same `assess_drift` round-trip, same `director_state`/`resteers` analysis_state keys, same `injectPromoteBack`(voice)/`coachNote`(text) delivery. The `kind` field already distinguishes signals.
- **Pure detector stays stdlib-only.** `drift.py` may add `import re` (stdlib — does not break the import boundary, which forbids only openai/canvas/resolver/compliance). No other imports.
- **No LLM.** Both tiers are pure heuristics.
- **Byte-identical when the flag is off.** `assess_drift` returns None before any work when `director_enabled()` is false (unchanged v1 gate).
- **Language-drift takes precedence** over target-neglect, and needs no assignment targets — so the v1 hard `if not concrete_targets: return None` early-return is removed; an invalid `mapping` still returns None.
- **Constants (frozen):** `LANGUAGE_DRIFT_MIN_CHARS = 12`, `TARGET_SCRIPT_MIN_RATIO = 0.5`, `ENGLISH_MARKER_MIN_HITS = 3`.
- **`verdict.target` holds the target-language display name** for `language_drift` (e.g. "Korean"), vs an expression for `target_neglect`. `build_resteer_prompt` branches on `verdict.kind`.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main`; do not auto-branch.

---

### Task 1: `detect_language_drift` + kind-branched `build_resteer_prompt` (pure)

**Files:**
- Modify: `backend/services/pedagogy/drift.py`
- Test: `backend/tests/test_pedagogy_drift.py`

**Interfaces:**
- Consumes: existing `DriftVerdict`, `_s` (in `drift.py`).
- Produces: `detect_language_drift(latest_tutor_turn: str, learning_locale: str) -> DriftVerdict` (kind `"language_drift"`); constants `LANGUAGE_DRIFT_MIN_CHARS`/`TARGET_SCRIPT_MIN_RATIO`/`ENGLISH_MARKER_MIN_HITS`; `build_resteer_prompt` now branches on `verdict.kind`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pedagogy_drift.py`:

```python
from backend.services.pedagogy.drift import detect_language_drift  # add to imports if not present


class DetectLanguageDriftTests(unittest.TestCase):
    def test_korean_in_korean_no_drift(self):
        v = detect_language_drift('안녕하세요 오늘 무엇을 도와드릴까요', 'ko-KR')
        self.assertFalse(v.drift)

    def test_korean_in_english_is_drift(self):
        v = detect_language_drift('Okay, so what would you like to order today?', 'ko-KR')
        self.assertTrue(v.drift)
        self.assertEqual(v.kind, 'language_drift')
        self.assertEqual(v.target, 'Korean')

    def test_russian_in_russian_no_drift(self):
        self.assertFalse(detect_language_drift('Здравствуйте, что вы хотите заказать сегодня', 'ru-RU').drift)

    def test_russian_in_english_is_drift(self):
        self.assertTrue(detect_language_drift('What would you like to order, my friend?', 'ru-RU').drift)

    def test_hebrew_in_hebrew_no_drift(self):
        self.assertFalse(detect_language_drift('שלום מה תרצה להזמין היום בבקשה', 'he-IL').drift)

    def test_spanish_clean_no_drift(self):
        self.assertFalse(detect_language_drift('¿Qué te gustaría pedir hoy?', 'es-ES').drift)

    def test_spanish_english_dense_is_drift(self):
        v = detect_language_drift('Okay so what do you want to say with this?', 'es-ES')
        self.assertTrue(v.drift)
        self.assertEqual(v.target, 'Spanish')

    def test_short_turn_no_drift(self):
        self.assertFalse(detect_language_drift('OK!', 'ko-KR').drift)

    def test_brief_codeswitch_no_drift(self):
        # one English content word in an otherwise-Korean turn keeps the ratio high
        self.assertFalse(detect_language_drift('네, sandwich 주문하시겠어요 오늘은', 'ko-KR').drift)

    def test_unknown_locale_no_drift(self):
        self.assertFalse(detect_language_drift('this is clearly english text here', 'xx-XX').drift)


class BuildResteerPromptKindTests(unittest.TestCase):
    def test_language_drift_copy_names_language(self):
        from backend.services.pedagogy.drift import DriftVerdict, build_resteer_prompt
        v = DriftVerdict(drift=True, kind='language_drift', target='Korean', reason='r')
        text = build_resteer_prompt(v, surface='text')
        self.assertIn('Korean', text)
        # distinct from target-neglect copy
        tn = build_resteer_prompt(DriftVerdict(True, 'target_neglect', 'la cuenta', 'r'), surface='text')
        self.assertNotEqual(text, tn)
        self.assertIn('la cuenta', tn)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_drift -v`
Expected: FAIL — `ImportError`/`AttributeError`: `detect_language_drift` does not exist.

- [ ] **Step 3: Implement**

In `backend/services/pedagogy/drift.py`:

(a) Add `import re` below `from dataclasses import dataclass`:

```python
import re
```

(b) Update the `DriftVerdict.kind` comment to include the new kind:

```python
    kind: str  # "target_neglect" | "language_drift" | "none"
```

(c) Add the constants below the existing `DIRECTOR_MAX_RESTEERS = 3` line:

```python
# Language-drift: the tutor should speak the target language but slipped into the L1
# (English). Non-Latin targets are judged by target-script ratio (robust); Latin-script
# targets by distinctly-English function-word density (conservative heuristic).
LANGUAGE_DRIFT_MIN_CHARS = 12   # ignore very short turns (greetings, names) — too little signal
TARGET_SCRIPT_MIN_RATIO = 0.5   # non-Latin: < this fraction of letters in target script → drift
ENGLISH_MARKER_MIN_HITS = 3     # Latin: >= this many distinct English function words → drift

# Distinctly-English grammatical function words that are NOT common es/fr/tl words.
# Function (not content) words keep the false-positive rate low: a Spanish turn does not
# contain "the/is/you/what"; an English loanword like "sandwich" is a content word, absent here.
_ENGLISH_FUNCTION_WORDS = frozenset({
    "the", "is", "are", "was", "were", "you", "your", "what", "which", "with",
    "this", "that", "they", "would", "should", "could", "have", "does",
    "okay", "let", "want", "need", "about", "because", "really",
})

# Target-language display names (used in the language-drift re-steer copy).
_LANGUAGE_NAMES = {"ko": "Korean", "ru": "Russian", "he": "Hebrew",
                   "es": "Spanish", "fr": "French", "tl": "Tagalog"}
_NON_LATIN_DRIFT_KEYS = frozenset({"ko", "ru", "he"})
_LATIN_DRIFT_KEYS = frozenset({"es", "fr", "tl"})


def _drift_locale_key(locale: object) -> str:
    """Local pure prefix matcher (drift.py cannot import practice_analytics)."""
    n = _s(locale).lower()
    for key in ("ko", "ru", "he", "es", "fr", "tl"):
        if n.startswith(key):
            return key
    return "en"


def _is_target_script_char(ch: str, locale_key: str) -> bool:
    o = ord(ch)
    if locale_key == "ko":
        return 0xAC00 <= o <= 0xD7A3 or 0x1100 <= o <= 0x11FF or 0x3130 <= o <= 0x318F
    if locale_key == "ru":
        return 0x0400 <= o <= 0x04FF
    if locale_key == "he":
        return 0x0590 <= o <= 0x05FF
    return False
```

(d) Add the detector function (after `detect_target_neglect`):

```python
def detect_language_drift(latest_tutor_turn: str, learning_locale: str) -> DriftVerdict:
    """Pure. The tutor should speak the target language but drifted into English.

    Non-Latin targets (ko/ru/he): target-script ratio. Latin targets (es/fr/tl):
    distinctly-English function-word density. Returns kind 'language_drift' with
    target = the target-language display name. Conservative (min-length + ratio /
    distinct-marker thresholds) so a brief code-switch is not flagged.
    """
    turn = _s(latest_tutor_turn)
    key = _drift_locale_key(learning_locale)
    lang = _LANGUAGE_NAMES.get(key, "")
    if not turn or not lang:
        return DriftVerdict(drift=False, kind="none", target="", reason="no language signal")

    letters = [c for c in turn if c.isalpha()]
    if len(letters) < LANGUAGE_DRIFT_MIN_CHARS:
        return DriftVerdict(drift=False, kind="none", target="", reason="turn too short to judge language")

    if key in _NON_LATIN_DRIFT_KEYS:
        target_chars = sum(1 for c in letters if _is_target_script_char(c, key))
        ratio = target_chars / len(letters)
        if ratio < TARGET_SCRIPT_MIN_RATIO:
            return DriftVerdict(drift=True, kind="language_drift", target=lang,
                                reason=f"only {round(ratio * 100)}% of letters were {lang} script")
        return DriftVerdict(drift=False, kind="none", target="", reason="predominantly target script")

    # Latin target (es/fr/tl): distinctly-English function-word density.
    words = set(re.findall(r"[a-z']+", turn.lower()))
    hits = words & _ENGLISH_FUNCTION_WORDS
    if len(hits) >= ENGLISH_MARKER_MIN_HITS:
        return DriftVerdict(drift=True, kind="language_drift", target=lang,
                            reason=f"{len(hits)} English function words in a {lang} turn")
    return DriftVerdict(drift=False, kind="none", target="", reason="no English-drift markers")
```

(e) Replace `build_resteer_prompt` with a kind-branched version (keep the target_neglect copy identical to today):

```python
def build_resteer_prompt(verdict: DriftVerdict, *, surface: str) -> str:
    """In-character coach note handed to the main tutor so it weaves the correction
    into its next turn in its own words. Terser on voice."""
    target = _s(verdict.target)
    lead = "COACH NOTE (act in your own words, in character — do not read this aloud): "
    if verdict.kind == "language_drift":
        body = (
            f"your last turn drifted into English. Respond in {target} from here — "
            f"continue the scene in {target} so the learner stays immersed."
        )
    else:
        body = (
            "the last few exchanges drifted off the lesson. "
            f'In your next turn, naturally create a reason for the learner to use "{target}" — '
            "weave it into the scene; don't announce it or lecture."
        )
    tail = " Keep it to one short sentence." if surface == "voice" else ""
    return lead + body + tail
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_drift -v`
Expected: PASS (new language-drift + prompt tests, and the existing v1 target-neglect/decide/serialize tests still green).

- [ ] **Step 5: Verify the import boundary still holds**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1.ImportBoundaryTestCase -v`
Expected: PASS (`drift.py` adding `import re` pulls no forbidden module).

- [ ] **Step 6: Commit**

```bash
git add backend/services/pedagogy/drift.py backend/tests/test_pedagogy_drift.py
git commit -m "feat(pedagogy-s5): language-drift detector + kind-branched re-steer prompt"
```

---

### Task 2: Wire language-drift into `assess_drift` (precedence + relaxed gate)

**Files:**
- Modify: `backend/services/director_service.py`
- Test: `backend/tests/test_director_service.py`

**Interfaces:**
- Consumes: `detect_language_drift` (Task 1), existing `detect_target_neglect`/`decide_resteer`/`build_resteer_prompt`/`serialize_resteer`.
- Produces: `assess_drift` returns a `language_drift`-kind payload when the latest tutor turn is off-language; language-drift takes precedence; grammar-only assignments (no concrete targets) still get language-drift coverage.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_director_service.py` (the file has `_Db`/`_Deps`/`_session`/`_chat`/`_BOOTSTRAP` helpers from the S5 v1 tests; reuse them — note `_BOOTSTRAP` may need a `class.learningLocale`, add it as shown):

```python
# A bootstrap carrying the learning locale (assess_drift reads bootstrap['class']['learningLocale']).
_KO_BOOTSTRAP = {
    "class": {"learningLocale": "ko-KR"},
    "mapping": {"targetExpressions": ["계산서"], "targetVocabulary": []},
}
_KO_GRAMMAR_ONLY = {  # no concrete targets — only language-drift can fire
    "class": {"learningLocale": "ko-KR"},
    "mapping": {"focusGrammar": ["honorifics"]},
}


class AssessLanguageDriftTests(unittest.TestCase):
    def _on(self):
        return mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": "1"})

    def test_language_drift_fires_and_returns_payload(self):
        # latest tutor turn is English in a Korean assignment
        db = _Db(_session(), _chat(["안녕하세요 반갑습니다 오늘", "Okay so what would you like to order today my friend?"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertEqual(out["kind"], "language_drift")
        self.assertEqual(out["target"], "Korean")
        self.assertIn("Korean", out["resteer_prompt"])

    def test_grammar_only_assignment_still_language_checked(self):
        db = _Db(_session(), _chat(["안녕하세요 반갑습니다 오늘", "What can I get for you today, friend?"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_GRAMMAR_ONLY, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertEqual(out["kind"], "language_drift")

    def test_clean_korean_no_language_drift_falls_back(self):
        # all-Korean turns, target referenced → no language drift; target-neglect also clean
        db = _Db(_session(), _chat(["계산서 드릴까요", "네 계산서 여기 있습니다 감사합니다", "또 오세요 안녕히 가세요"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNone(out)
```

> Implementer: confirm the existing `_chat(tutor_turns)` helper interleaves user/assistant turns so the LAST message is the last tutor turn (the language-drift detector reads `recent_tutor_turns[-1]`). If the helper appends a trailing user turn after the last tutor turn, the latest tutor turn is still the last *assistant* message in the window — which is what `assess_drift` extracts. Keep the test sentences' last tutor turn as the drift-bearing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_director_service.AssessLanguageDriftTests -v`
Expected: FAIL — `assess_drift` does not yet detect language-drift (it runs only target-neglect, and the grammar-only case early-returns on empty concrete_targets).

- [ ] **Step 3: Implement**

In `backend/services/director_service.py`:

(a) Extend the drift import:

```python
        from backend.services.pedagogy.drift import (
            build_resteer_prompt, decide_resteer, detect_language_drift,
            detect_target_neglect, serialize_resteer,
        )
```

(b) Replace the concrete-targets block + the detection call. Change the current:

```python
        mapping = bootstrap.get("mapping") if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        # Concrete (substring-matchable) targets only — grammar labels excluded.
        concrete_targets = [
            *_string_list(mapping.get("targetExpressions")),
            *_string_list(mapping.get("targetVocabulary")),
        ]
        if not concrete_targets:
            return None
```

to (remove the early return on empty concrete_targets; capture learning_locale):

```python
        mapping = bootstrap.get("mapping") if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        # Concrete (substring-matchable) targets only — grammar labels excluded.
        # May be empty: language-drift needs no targets, so we do NOT early-return here.
        concrete_targets = [
            *_string_list(mapping.get("targetExpressions")),
            *_string_list(mapping.get("targetVocabulary")),
        ]
        learning_locale = _s((bootstrap.get("class") or {}).get("learningLocale"))
```

And change the detection call. Current:

```python
        verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)
        if not verdict.drift:
            return None
```

to (language-drift first, target-neglect fallback only when targets exist):

```python
        # Language-drift takes precedence (the tutor isn't even speaking the target
        # language) and needs no assignment targets.
        latest = recent_tutor_turns[-1] if recent_tutor_turns else ""
        verdict = detect_language_drift(latest, learning_locale)
        if not verdict.drift and concrete_targets:
            verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)
        if not verdict.drift:
            return None
```

(No other change — `decide_resteer`, the re-read-before-write, `serialize_resteer`, and the returned payload already key off `verdict.kind`/`verdict.target`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_director_service -v`
Expected: PASS (new language-drift cases + the existing v1 target-neglect/dedup/fail-open/flag-off cases all green — the v1 `test_drift_fires_returns_payload_and_persists` etc. still pass because those use all-target-language or target-referencing turns; if a v1 fixture's tutor turns are English and now trip language-drift, the implementer updates that fixture to be in the target language, preserving the v1 intent).

- [ ] **Step 5: Commit**

```bash
git add backend/services/director_service.py backend/tests/test_director_service.py
git commit -m "feat(pedagogy-s5): assess_drift runs language-drift first, target-neglect fallback"
```

---

### Task 3: Full-suite verification + doc-sync

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/school-integration/LIMITATIONS.md`
- (verify) backend suite

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: green suite + accurate docs.

- [ ] **Step 1: Run the full backend suite**

Run: `make test-backend`
Expected: PASS. If a pre-existing S5 v1 test fails because its fixture tutor turns are English (now tripping language-drift), that is a real interaction — fix the fixture to use target-language turns (preserving the v1 test's target-neglect intent) and re-run. STOP and report if anything else fails.

- [ ] **Step 2: Update `backend/CLAUDE.md`**

In the `drift.py` description (the pedagogy services bullet), change the v1 single-signal phrasing to note two signals. Find `drift.py` (stdlib-only S5 pure module: `detect_target_neglect(...)` ...) and add, after `detect_target_neglect`: `+ detect_language_drift(latest_tutor_turn, learning_locale) -> DriftVerdict (kind "language_drift"; non-Latin target-script ratio + Latin English-function-word density)`. In the S5 flag-state sentence, note the Director now detects target-neglect AND language-drift.

- [ ] **Step 3: Update `docs/school-integration/LIMITATIONS.md`**

Update item **(mm)** (which said "S5 Director v1 detects only target-neglect; language-drift … deferred"): change it to record that language-drift is now covered (target-script ratio for ko/ru/he; English-function-word density for es/fr/tl — a conservative heuristic with documented false-positive risk on heavy code-switching/Taglish), and that the remaining LLM-judged dimensions (anti-sycophancy, elicitation quality) stay deferred. Keep the (mm) label.

- [ ] **Step 4: Commit**

```bash
git add backend/CLAUDE.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(pedagogy-s5): Director v2 language-drift — two signals + deferred dimensions"
```

---

## Self-Review

**1. Spec coverage:**
- `detect_language_drift` (two tiers) → Task 1 ✓
- kind-branched `build_resteer_prompt` → Task 1 ✓
- import-boundary still holds (drift.py + `import re`) → Task 1 Step 5 ✓
- `assess_drift` language-drift-first precedence + relaxed concrete_targets gate + learning_locale extraction → Task 2 ✓
- grammar-only assignment still language-checked → Task 2 test ✓
- byte-identical-when-off / fail-open → unchanged v1 gate (Global Constraints) ✓
- docs ((mm) update + drift.py two-signal) → Task 3 ✓
- Non-goals (no flag/route/key/frontend; no LLM; shared cooldown) → Global Constraints ✓

**2. Placeholder scan:** No TBD/TODO. All constants, the English-word set, the unicode ranges, and all test code are concrete literals.

**3. Type consistency:** `detect_language_drift(latest_tutor_turn: str, learning_locale: str) -> DriftVerdict` identical in Task 1 def + Task 2 call. `DriftVerdict(drift, kind, target, reason)` reused unchanged. `build_resteer_prompt(verdict, *, surface)` signature unchanged (only the body branches). `verdict.target` carries the language name for `language_drift` (consumed by the copy + `serialize_resteer`'s existing `target` field). Constants `LANGUAGE_DRIFT_MIN_CHARS=12`/`TARGET_SCRIPT_MIN_RATIO=0.5`/`ENGLISH_MARKER_MIN_HITS=3` consistent between Task 1 def and Global Constraints. `assess_drift` reads `bootstrap["class"]["learningLocale"]` (verified path).
