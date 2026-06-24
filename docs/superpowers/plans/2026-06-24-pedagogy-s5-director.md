# S5 Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build S5 — the Director (L4 runtime): between-turn detection of tutor instruction-adherence drift (v1 signal: target-neglect) plus an in-character re-steer, behind `PEDAGOGY_ENGINE_DIRECTOR` (default off), byte-identical when off, fail-open.

**Architecture:** A pure stdlib detector/decision module (`pedagogy/drift.py`) + an impure, NO-LLM orchestrator (`director_service.assess_drift`) that rides the existing between-turn coach-chip round-trip. When the tutor spends a window of consecutive turns referencing no concrete assignment target, the Director returns a re-steer note that the route delivers through the proven `injectPromoteBack` (voice) / `coachNote` (text) channels — the same channels S3.3 promote-back uses.

**Tech Stack:** Python 3 / Flask (backend, repo root + `backend/`), React 19 + TypeScript + Vitest (frontend), `unittest` (backend tests), Firestore via `deps.db` (additive `analysis_state` keys, no schema change), Cloud Run + `cloudbuild.yaml` (flag default).

## Global Constraints

- **Flag:** `PEDAGOGY_ENGINE_DIRECTOR`; `director_enabled()` reads `os.environ.get("PEDAGOGY_ENGINE_DIRECTOR", "").strip().lower() in _TRUTHY` where `_TRUTHY = {"1","true","yes","on"}` (mirror the existing helpers in `integration.py`).
- **Default off + byte-identical when off:** with the flag unset, `assess_drift` returns `None` with zero DB work beyond what the route already does; the `chat.py` coachNote gate's added clause is `False`; the frontend receives `resteer: null`. No prompt, no write, no behavior change.
- **Fail-open everywhere:** every layer degrades to "no re-steer" on any exception; the live conversation is never blocked. Backend orchestrator body is one `try/except Exception` that logs and returns `None`.
- **No LLM on the live path.** `director_service` does NOT call OpenAI. The only I/O is `deps.db` reads + one analysis_state write (only when a re-steer fires).
- **Pure module = stdlib only.** `backend/services/pedagogy/drift.py` imports only `from __future__ import annotations` + `from dataclasses import dataclass`. No OpenAI/Canvas/resolver/compliance — enforced by `ImportBoundaryTestCase`.
- **Concrete targets only for matching:** `targetExpressions + targetVocabulary`. Grammar (`focusGrammar`) is EXCLUDED (abstract labels are not substring-matchable).
- **Constants (frozen):** `DRIFT_WINDOW = 3`, `DIRECTOR_COOLDOWN_TURNS = 4`, `DIRECTOR_MAX_RESTEERS = 3`, `TRANSCRIPT_WINDOW = 6`.
- **Persistence:** additive `analysis_state` keys `director_state` (`{}`) + `resteers` (`[]`) only; persist via `deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)` (NOT `update_practice_session`). Re-read session before write (S3.1 lesson). `resteers` is NEVER re-injected on hydration.
- **Model:** N/A (no LLM). Do not add any model constant to `director_service`.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main` (current branch); do not auto-create a branch.
- **cloudbuild `--set-env-vars` is REPLACE:** the new var must appear BOTH in the line-60 `--set-env-vars` string AND the `substitutions:` block, default `'0'`; no other substitution default may change.

---

### Task 1: Pure `pedagogy/drift.py` — detector + decision + prompt

**Files:**
- Create: `backend/services/pedagogy/drift.py`
- Test: `backend/tests/test_pedagogy_drift.py`

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces:
  - `DriftVerdict(drift: bool, kind: str, target: str, reason: str)` (frozen dataclass)
  - `detect_target_neglect(recent_tutor_turns: list[str], concrete_targets: list[str], *, window: int = DRIFT_WINDOW) -> DriftVerdict`
  - `ResteerDecision(resteer: bool, reason: str, target: str, signature: str)` (frozen dataclass)
  - `decide_resteer(director_state: object, verdict: DriftVerdict, turn_index: int) -> tuple[ResteerDecision, dict]`
  - `build_resteer_prompt(verdict: DriftVerdict, *, surface: str) -> str`
  - `serialize_resteer(decision: ResteerDecision, *, turn_index: int, surface: str, prompt: str, generated_at: str) -> dict`
  - constants `DRIFT_WINDOW = 3`, `DIRECTOR_COOLDOWN_TURNS = 4`, `DIRECTOR_MAX_RESTEERS = 3`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pedagogy_drift.py
import unittest

from backend.services.pedagogy.drift import (
    DRIFT_WINDOW,
    DIRECTOR_COOLDOWN_TURNS,
    DIRECTOR_MAX_RESTEERS,
    DriftVerdict,
    ResteerDecision,
    build_resteer_prompt,
    decide_resteer,
    detect_target_neglect,
    serialize_resteer,
)


class DetectTargetNeglectTests(unittest.TestCase):
    def test_no_concrete_targets_is_not_drift(self):
        v = detect_target_neglect(["hola", "que tal", "muy bien"], [])
        self.assertFalse(v.drift)
        self.assertEqual(v.kind, "none")

    def test_fewer_turns_than_window_is_not_drift(self):
        v = detect_target_neglect(["hola", "que tal"], ["la cuenta"])
        self.assertFalse(v.drift)

    def test_target_referenced_in_window_is_not_drift(self):
        turns = ["hablemos del tiempo", "que dia tan bonito", "quieres pedir La Cuenta?"]
        v = detect_target_neglect(turns, ["la cuenta", "para llevar"])
        self.assertFalse(v.drift)

    def test_window_all_off_target_is_drift_and_picks_neglected(self):
        turns = ["hola", "que tal el dia", "te gusta el cafe", "cuentame mas"]
        v = detect_target_neglect(turns, ["la cuenta", "para llevar"])
        self.assertTrue(v.drift)
        self.assertEqual(v.kind, "target_neglect")
        self.assertEqual(v.target, "la cuenta")  # first target absent from the window

    def test_match_is_case_and_edge_insensitive(self):
        turns = ["  PARA LLEVAR, por favor  ", "si", "claro"]
        v = detect_target_neglect(turns, ["para llevar"])
        self.assertFalse(v.drift)


class DecideResteerTests(unittest.TestCase):
    def _drift(self):
        return DriftVerdict(drift=True, kind="target_neglect", target="la cuenta", reason="r")

    def test_no_drift_no_resteer_state_unchanged(self):
        decision, state = decide_resteer({"last_resteer_turn": 3, "resteer_count": 1},
                                         DriftVerdict(False, "none", "", "r"), 5)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, {"last_resteer_turn": 3, "resteer_count": 1})

    def test_first_drift_fires_and_advances_state(self):
        decision, state = decide_resteer({}, self._drift(), 6)
        self.assertTrue(decision.resteer)
        self.assertEqual(decision.signature, "target_neglect:la cuenta")
        self.assertEqual(state, {"last_resteer_turn": 6, "resteer_count": 1})

    def test_within_cooldown_is_suppressed(self):
        state_in = {"last_resteer_turn": 6, "resteer_count": 1}
        decision, state = decide_resteer(state_in, self._drift(),
                                         6 + DIRECTOR_COOLDOWN_TURNS - 1)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, state_in)

    def test_cap_reached_is_suppressed(self):
        state_in = {"last_resteer_turn": 0, "resteer_count": DIRECTOR_MAX_RESTEERS}
        decision, state = decide_resteer(state_in, self._drift(), 100)
        self.assertFalse(decision.resteer)
        self.assertEqual(state, state_in)


class BuildAndSerializeTests(unittest.TestCase):
    def test_prompt_contains_target_and_is_terser_on_voice(self):
        v = DriftVerdict(True, "target_neglect", "la cuenta", "r")
        text = build_resteer_prompt(v, surface="text")
        voice = build_resteer_prompt(v, surface="voice")
        self.assertIn("la cuenta", text)
        self.assertIn("la cuenta", voice)
        self.assertNotIn("#", voice)  # no markdown
        self.assertTrue(len(voice) > 0 and len(text) > 0)
        self.assertNotEqual(text, voice)

    def test_serialize_resteer_shape(self):
        d = ResteerDecision(True, "r", "la cuenta", "target_neglect:la cuenta")
        rec = serialize_resteer(d, turn_index=6, surface="text", prompt="P", generated_at="T")
        self.assertEqual(rec, {
            "turn_index": 6, "kind": "target_neglect", "target": "la cuenta",
            "reason": "r", "prompt": "P", "surface": "text", "generated_at": "T",
        })


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_drift -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.pedagogy.drift'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/pedagogy/drift.py
"""Pure detection + decision layer for S5 — the Director (between-turn re-steer).

Stdlib only — no OpenAI/Canvas/resolver/compliance imports (import boundary,
invariant 7a). Detects tutor instruction-adherence drift from the recent tutor
turns and decides whether to act, from deterministic signals only. v1 covers one
robust, locale-agnostic signal: TARGET-NEGLECT (the tutor spending a window of
consecutive turns without working toward any concrete assignment target). The
impure orchestration (session/transcript reads, persistence) lives in
backend/services/director_service.py.

INDEPENDENT of the offline S5-gate eval scorer (backend/tests/eval/adherence_drift.py):
the live detector is a heuristic; the offline scorer is an LLM-judge aggregator.
They share no code.
"""

from __future__ import annotations

from dataclasses import dataclass

# A target is "neglected" when this many consecutive recent tutor turns reference
# no concrete target. A window (not a single turn) so a brief on-task digression
# (rapport, a clarifying question) is not mistaken for drift.
DRIFT_WINDOW = 3
# Over-nagging guards (mirror promote_back's cooldown + per-session cap).
DIRECTOR_COOLDOWN_TURNS = 4
DIRECTOR_MAX_RESTEERS = 3


@dataclass(frozen=True)
class DriftVerdict:
    drift: bool
    kind: str  # "target_neglect" | "none"
    target: str  # the target to steer back toward ("" when no drift)
    reason: str


@dataclass(frozen=True)
class ResteerDecision:
    resteer: bool
    reason: str
    target: str
    signature: str


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def detect_target_neglect(
    recent_tutor_turns: list[str],
    concrete_targets: list[str],
    *,
    window: int = DRIFT_WINDOW,
) -> DriftVerdict:
    """Pure. Drift when the last `window` tutor turns reference no concrete target.

    Concrete targets are expression/vocabulary surfaces (substring-matchable);
    grammar labels must NOT be passed here. Matching is case-insensitive.
    """
    targets = _string_list(concrete_targets)
    turns = [t for t in (_s(x) for x in recent_tutor_turns) if t]
    if not targets or len(turns) < window:
        return DriftVerdict(drift=False, kind="none", target="", reason="insufficient evidence")

    recent_lc = [t.lower() for t in turns[-window:]]
    targets_lc = [(t, t.lower()) for t in targets]

    def referenced(target_lc: str) -> bool:
        return any(target_lc in turn for turn in recent_lc)

    if any(referenced(t_lc) for _, t_lc in targets_lc):
        return DriftVerdict(drift=False, kind="none", target="", reason="a target is live in the window")

    neglected = next((orig for orig, t_lc in targets_lc if not referenced(t_lc)), targets[0])
    return DriftVerdict(
        drift=True,
        kind="target_neglect",
        target=neglected,
        reason=f"no target referenced in the last {window} tutor turns",
    )


def _normalize_state(state: object) -> dict:
    src = state if isinstance(state, dict) else {}
    last = src.get("last_resteer_turn")
    count = src.get("resteer_count")
    return {
        "last_resteer_turn": last if isinstance(last, int) else None,
        "resteer_count": count if isinstance(count, int) and count >= 0 else 0,
    }


def decide_resteer(
    director_state: object,
    verdict: DriftVerdict,
    turn_index: int,
) -> tuple[ResteerDecision, dict]:
    """Pure. Returns (decision, new_state); never mutates the input.

    Acts only when the verdict shows drift AND the cooldown and per-session cap
    allow it. On a re-steer: stamp the turn and bump the session count.
    """
    state = _normalize_state(director_state)
    if not verdict.drift:
        return ResteerDecision(resteer=False, reason="no drift", target="", signature=""), state

    signature = f"{verdict.kind}:{verdict.target}"
    last = state["last_resteer_turn"]
    cooldown_ok = last is None or (turn_index - last) >= DIRECTOR_COOLDOWN_TURNS
    cap_ok = state["resteer_count"] < DIRECTOR_MAX_RESTEERS

    if cooldown_ok and cap_ok:
        return (
            ResteerDecision(resteer=True, reason=verdict.reason, target=verdict.target, signature=signature),
            {"last_resteer_turn": turn_index, "resteer_count": state["resteer_count"] + 1},
        )

    return (
        ResteerDecision(resteer=False, reason="suppressed (cooldown/cap)",
                        target=verdict.target, signature=signature),
        state,
    )


def build_resteer_prompt(verdict: DriftVerdict, *, surface: str) -> str:
    """In-character coach note handed to the main tutor so it weaves the correction
    into its next turn in its own words. Terser on voice."""
    target = _s(verdict.target)
    lead = (
        "COACH NOTE (act in your own words, in character — do not read this aloud): "
        "the last few exchanges drifted off the lesson. "
    )
    body = (
        f'In your next turn, naturally create a reason for the learner to use "{target}" — '
        "weave it into the scene; don't announce it or lecture."
    )
    tail = " Keep it to one short sentence." if surface == "voice" else ""
    return lead + body + tail


def serialize_resteer(
    decision: ResteerDecision,
    *,
    turn_index: int,
    surface: str,
    prompt: str,
    generated_at: str,
) -> dict:
    """The durable audit record appended to analysis_state['resteers']."""
    kind = decision.signature.split(":", 1)[0] if decision.signature else "target_neglect"
    return {
        "turn_index": turn_index,
        "kind": kind,
        "target": decision.target,
        "reason": decision.reason,
        "prompt": prompt,
        "surface": surface,
        "generated_at": generated_at,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_drift -v`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/drift.py backend/tests/test_pedagogy_drift.py
git commit -m "feat(pedagogy-s5): pure drift detector + re-steer decision (drift.py)"
```

---

### Task 2: `director_enabled()` flag + import-boundary enforcement

**Files:**
- Modify: `backend/services/pedagogy/integration.py` (add `director_enabled` next to `debrief_enabled`)
- Modify: `backend/tests/test_pedagogy_engine_s1.py:198-228` (add `drift` to the import-boundary probe + message)
- Test: `backend/tests/test_pedagogy_engine_s1.py` (existing `ImportBoundaryTestCase`)

**Interfaces:**
- Consumes: `pedagogy/drift.py` (Task 1).
- Produces: `director_enabled() -> bool` in `backend.services.pedagogy.integration`.

- [ ] **Step 1: Add `drift` to the import-boundary probe (the failing test)**

In `backend/tests/test_pedagogy_engine_s1.py`, inside `test_plan_and_routing_import_no_openai_or_canvas`, add the drift import line to the `probe` string after the `debrief` line, and update the assertion message:

```python
            "import backend.services.pedagogy.affect\n"
            "import backend.services.pedagogy.debrief\n"
            "import backend.services.pedagogy.drift\n"
            "forbidden = sorted(\n"
```
and:
```python
            f"plan/routing/coverage/coach_review/promote_back/ask/affect/debrief/drift pulled forbidden modules: {result.stdout.strip()}",
```

- [ ] **Step 2: Run the import-boundary test to verify it currently passes for drift**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1.ImportBoundaryTestCase -v`
Expected: PASS — `drift.py` is stdlib-only so it pulls no forbidden modules. (If it FAILS, drift.py has an illegal import — fix drift.py.)

- [ ] **Step 3: Add the `director_enabled()` helper**

In `backend/services/pedagogy/integration.py`, after `debrief_enabled()` (around line 80), add:

```python
def director_enabled() -> bool:
    """S5 — the Director (between-turn drift re-steer). Default off; cutover gated
    on the S5-gate eval verdict (PEDAGOGY_ENGINE.md §14 S5 row)."""
    return os.environ.get("PEDAGOGY_ENGINE_DIRECTOR", "").strip().lower() in _TRUTHY
```

- [ ] **Step 4: Write + run a flag test**

Add to `backend/tests/test_pedagogy_drift.py`:

```python
import os
from unittest import mock
from backend.services.pedagogy.integration import director_enabled


class DirectorFlagTests(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_DIRECTOR", None)
            self.assertFalse(director_enabled())

    def test_truthy_values_on(self):
        for val in ("1", "true", "YES", "on"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": val}):
                self.assertTrue(director_enabled())
```

Run: `python3 -m unittest backend.tests.test_pedagogy_drift -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/tests/test_pedagogy_engine_s1.py backend/tests/test_pedagogy_drift.py
git commit -m "feat(pedagogy-s5): director_enabled() flag + drift.py import-boundary enforcement"
```

---

### Task 3: Persist `director_state` + `resteers` in analysis_state

**Files:**
- Modify: `backend/services/practice_analytics.py` — `default_analysis_state()` (~line 830-857) + `normalize_analysis_state()` (~line 904-917)
- Test: `backend/tests/test_practice_analytics.py` (add a normalize test; if that file does not exist, create `backend/tests/test_analysis_state_director.py` with the test below)

**Interfaces:**
- Consumes: nothing.
- Produces: `analysis_state` always carries `director_state: {}` and `resteers: []` (defaulted + normalized).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_analysis_state_director.py`:

```python
import unittest

from backend.services.practice_analytics import default_analysis_state, normalize_analysis_state


class DirectorAnalysisStateTests(unittest.TestCase):
    def test_defaults_present(self):
        d = default_analysis_state()
        self.assertEqual(d["director_state"], {})
        self.assertEqual(d["resteers"], [])

    def test_normalize_keeps_valid_director_keys(self):
        out = normalize_analysis_state({
            "director_state": {"last_resteer_turn": 4, "resteer_count": 1},
            "resteers": [{"turn_index": 4, "kind": "target_neglect"}],
        })
        self.assertEqual(out["director_state"], {"last_resteer_turn": 4, "resteer_count": 1})
        self.assertEqual(out["resteers"], [{"turn_index": 4, "kind": "target_neglect"}])

    def test_normalize_rejects_wrong_types(self):
        out = normalize_analysis_state({"director_state": "nope", "resteers": "nope"})
        self.assertEqual(out["director_state"], {})
        self.assertEqual(out["resteers"], [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_analysis_state_director -v`
Expected: FAIL — `KeyError: 'director_state'` (defaults not present yet)

- [ ] **Step 3: Add the keys**

In `default_analysis_state()` (`backend/services/practice_analytics.py`), add after the `'affect_state': None,` line and before the closing `}`:

```python
        # S5 Director: between-turn re-steer guard bookkeeping (cooldown +
        # per-session cap); {} until the first re-steer fires.
        'director_state': {},
        # S5 Director: durable audit log of fired re-steers (NEVER re-injected on
        # hydration). Empty until the first re-steer.
        'resteers': [],
```

In `normalize_analysis_state()`, add after the `affect_state` block (before `return normalized`):

```python
    director_state = value.get('director_state', value.get('directorState'))
    if isinstance(director_state, dict):
        normalized['director_state'] = director_state

    resteers = value.get('resteers')
    if isinstance(resteers, list):
        normalized['resteers'] = resteers
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_analysis_state_director -v`
Expected: PASS

Then run the existing analytics suite to confirm no regression:
Run: `python3 -m unittest backend.tests.test_practice_analytics -v` (skip if the file does not exist)
Expected: PASS (or "no tests" — either is fine)

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_analysis_state_director.py
git commit -m "feat(pedagogy-s5): additive analysis_state keys director_state + resteers"
```

---

### Task 4: Impure `director_service.assess_drift` (NO LLM)

**Files:**
- Create: `backend/services/director_service.py`
- Test: `backend/tests/test_director_service.py`

**Interfaces:**
- Consumes: `pedagogy/drift.py` (`detect_target_neglect`, `decide_resteer`, `build_resteer_prompt`, `serialize_resteer`), `integration.director_enabled` (Task 2), `practice_analytics.normalize_analysis_state` + the `director_state`/`resteers` keys (Task 3).
- Produces: `assess_drift(deps, bootstrap: dict, uid: str, session_id: str, turn_index: int) -> dict | None`. On a fired re-steer returns `{turn_index, surface, resteer: True, resteer_prompt, kind, target, reason, generated_at}`; otherwise `None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_director_service.py`:

```python
import os
import unittest
from unittest import mock

from backend.services.director_service import assess_drift


class _Db:
    def __init__(self, session, chat):
        self._session = session
        self._chat = chat
        self.written = None

    def get_practice_session(self, session_id):
        return self._session

    def get_chat_session(self, uid, chat_id):
        return self._chat

    def update_practice_session_analysis_state(self, session_id, state, sql_engine=None):
        self.written = state


class _Deps:
    def __init__(self, db):
        self.db = db
        self.sql_engine = None


_BOOTSTRAP = {"mapping": {"targetExpressions": ["la cuenta"], "targetVocabulary": ["mesa"]}}


def _session(analysis_state=None, modality="text"):
    return {
        "student_uid": "u1",
        "assignment_id": "a1",
        "modality": modality,
        "transcript_ref": {"chat_id": "c1"},
        "analysis_state": analysis_state or {},
    }


def _chat(tutor_turns):
    # interleave learner/tutor; only assistant content matters to the detector
    msgs = []
    for t in tutor_turns:
        msgs.append({"role": "user", "content": "..."})
        msgs.append({"role": "assistant", "content": t})
    return {"messages": msgs}


class AssessDriftTests(unittest.TestCase):
    def _on(self):
        return mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": "1"})

    def test_flag_off_returns_none_no_write(self):
        db = _Db(_session(), _chat(["hola", "que tal", "adios"]))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_DIRECTOR", None)
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))
        self.assertIsNone(db.written)

    def test_drift_fires_returns_payload_and_persists(self):
        db = _Db(_session(), _chat(["hola", "que tal el dia", "te gusta el cafe"]))
        with self._on():
            out = assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertTrue(out["resteer"])
        self.assertEqual(out["target"], "la cuenta")
        self.assertIn("la cuenta", out["resteer_prompt"])
        self.assertEqual(db.written["director_state"], {"last_resteer_turn": 4, "resteer_count": 1})
        self.assertEqual(len(db.written["resteers"]), 1)

    def test_lesson_live_returns_none(self):
        db = _Db(_session(), _chat(["habla de la cuenta", "si", "claro"]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))
        self.assertIsNone(db.written)

    def test_no_concrete_targets_returns_none(self):
        boot = {"mapping": {"focusGrammar": ["ser vs estar"]}}
        db = _Db(_session(), _chat(["hola", "que tal", "adios"]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), boot, "u1", "s1", 4))

    def test_dedup_returns_existing_record(self):
        existing = {"turn_index": 4, "kind": "target_neglect", "target": "la cuenta"}
        db = _Db(_session({"resteers": [existing]}), _chat(["hola", "que tal", "adios"]))
        with self._on():
            out = assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4)
        self.assertEqual(out, existing)
        self.assertIsNone(db.written)  # no re-write on dedup hit

    def test_fail_open_on_db_error(self):
        class _BoomDb(_Db):
            def get_practice_session(self, session_id):
                raise RuntimeError("boom")
        db = _BoomDb(_session(), _chat([]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_director_service -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.director_service'`

- [ ] **Step 3: Write the implementation**

```python
# backend/services/director_service.py
"""Impure orchestration for S5 — the Director (between-turn drift re-steer).

Parallel to coach_chip_service but pure-heuristic (NO LLM): it reads the session
+ transcript, runs the pure detector (backend/services/pedagogy/drift.py), and on
sustained target-neglect returns a re-steer note for the route to deliver via the
proven voice (injectPromoteBack) / text (coachNote) channels. Fail-open: any
failure degrades to None so the live conversation is never blocked.

Independent of the chip's corrective-signal gate — tutor drift happens whether or
not the learner erred — so the Director runs on every between-turn trigger.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

TRANSCRIPT_WINDOW = 6  # last ~3 exchanges; matches coach_chip_service


def _s(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s for s in (_s(v) for v in value) if s]


def assess_drift(deps: Any, bootstrap: dict, uid: str, session_id: str, turn_index: int) -> dict | None:
    from backend.services.pedagogy.integration import director_enabled

    if not director_enabled():
        return None

    try:
        if not (bootstrap and uid and session_id) or turn_index is None:
            return None

        from backend.services.practice_analytics import normalize_analysis_state
        from backend.services.pedagogy.drift import (
            build_resteer_prompt, decide_resteer, detect_target_neglect, serialize_resteer,
        )

        session = deps.db.get_practice_session(session_id)
        if not isinstance(session, dict):
            return None

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

        analysis_state = normalize_analysis_state(session.get("analysis_state"))
        # Dedup: one assessment outcome per learner turn.
        for existing in analysis_state.get("resteers", []):
            if isinstance(existing, dict) and existing.get("turn_index") == turn_index:
                return existing

        # Recent tutor turns from the transcript (the synchronous source of truth;
        # analysis_state['recent_turns'] lags on the async event-rollup path).
        transcript_ref = session.get("transcript_ref")
        chat_id = _s(transcript_ref.get("chat_id")) if isinstance(transcript_ref, dict) else ""
        if not chat_id:
            return None
        chat = deps.db.get_chat_session(uid, chat_id)
        messages = chat.get("messages") if isinstance(chat, dict) else None
        messages = messages if isinstance(messages, list) else []
        recent_tutor_turns = [
            _s(m.get("content")) for m in messages[-TRANSCRIPT_WINDOW:]
            if isinstance(m, dict) and m.get("role") == "assistant"
        ]
        recent_tutor_turns = [t for t in recent_tutor_turns if t]

        verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)
        if not verdict.drift:
            return None

        decision, new_state = decide_resteer(analysis_state.get("director_state"), verdict, turn_index)
        if not decision.resteer:
            return None  # suppressed by cooldown/cap; state unchanged → nothing to persist

        surface = "voice" if "voice" in str(session.get("modality") or "").lower() else "text"

        # Re-read before write (S3.1 lesson): a concurrent analysis_state write
        # during this assessment must not be clobbered.
        fresh = deps.db.get_practice_session(session_id)
        target_state = (
            normalize_analysis_state(fresh.get("analysis_state"))
            if isinstance(fresh, dict) else analysis_state
        )
        for existing in target_state.get("resteers", []):
            if isinstance(existing, dict) and existing.get("turn_index") == turn_index:
                return existing

        generated_at = datetime.now(timezone.utc).isoformat()
        prompt = build_resteer_prompt(verdict, surface=surface)
        record = serialize_resteer(
            decision, turn_index=turn_index, surface=surface, prompt=prompt, generated_at=generated_at,
        )
        resteers = list(target_state.get("resteers", []))
        resteers.append(record)
        target_state["resteers"] = resteers
        target_state["director_state"] = new_state
        deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)

        return {
            "turn_index": turn_index,
            "surface": surface,
            "resteer": True,
            "resteer_prompt": prompt,
            "kind": verdict.kind,
            "target": verdict.target,
            "reason": verdict.reason,
            "generated_at": generated_at,
        }
    except Exception:
        logger.exception("director drift assessment failed; degrading to no re-steer "
                         "(session_id=%s, turn=%s)", session_id, turn_index)
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_director_service -v`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/services/director_service.py backend/tests/test_director_service.py
git commit -m "feat(pedagogy-s5): impure director_service.assess_drift (no LLM, fail-open)"
```

---

### Task 5: Wire `assess_drift` into the coach-chip route

**Files:**
- Modify: `backend/routes/curriculum_admin.py` — add import (~line 23, near `from backend.services.coach_chip_service import generate_coach_chip`) + extend `api_post_practice_session_coach_chip` (lines 743-783)
- Test: `backend/tests/test_curriculum_admin_coach_chip_route.py` (add Director cases)

**Interfaces:**
- Consumes: `director_service.assess_drift` (Task 4), `integration.director_enabled` (Task 2), `generate_coach_chip` (existing).
- Produces: `POST /api/practice-sessions/<id>/coach-chip` response gains a `resteer` field (`null` or the `assess_drift` payload). Bootstrap is resolved when `coach_chips_enabled() OR director_enabled()`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_curriculum_admin_coach_chip_route.py` (the module already has `_app`, `_Db`, `_login`, `_OWNER_SESSION`, and patches `resolve_assignment_bootstrap_for_user` + `generate_coach_chip`):

```python
class DirectorResteerRouteTestCase(unittest.TestCase):
    def setUp(self):
        self._bootstrap_patcher = mock.patch(
            'backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user',
            return_value={'mapping': {'targetExpressions': ['la cuenta']}},
        )
        self._bootstrap_patcher.start()
        self._chip_patcher = mock.patch(
            'backend.routes.curriculum_admin.generate_coach_chip', return_value=None,
        )
        self._chip_patcher.start()

    def tearDown(self):
        self._bootstrap_patcher.stop()
        self._chip_patcher.stop()

    def test_director_on_returns_resteer(self):
        resteer = {'turn_index': 4, 'surface': 'text', 'resteer': True,
                   'resteer_prompt': 'COACH NOTE ...', 'kind': 'target_neglect',
                   'target': 'la cuenta', 'reason': 'r', 'generated_at': 'T'}
        client = _app(_Db(_OWNER_SESSION)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_DIRECTOR': '1'}), \
             mock.patch('backend.routes.curriculum_admin.assess_drift', return_value=resteer):
            resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turnIndex': 4})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['resteer'], resteer)

    def test_director_off_resteer_null(self):
        client = _app(_Db(_OWNER_SESSION)).test_client()
        _login(client)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PEDAGOGY_ENGINE_DIRECTOR', None)
            os.environ.pop('PEDAGOGY_ENGINE_COACH_CHIPS', None)
            resp = client.post('/api/practice-sessions/sess-1/coach-chip', json={'turnIndex': 4})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()['resteer'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_coach_chip_route.DirectorResteerRouteTestCase -v`
Expected: FAIL — `KeyError: 'resteer'` (route doesn't return it yet) / `AttributeError: ... has no attribute 'assess_drift'`

- [ ] **Step 3: Implement the route change**

In `backend/routes/curriculum_admin.py`, near line 23 add the import:

```python
from backend.services.director_service import assess_drift
```

Replace the body of `api_post_practice_session_coach_chip` (lines 757-780, from `chip = None` through the `return`) with:

```python
            chip = None
            resteer = None
            assignment_id = session_record.get('assignment_id')
            # Flag gate at the route too: when both features are off, skip the
            # bootstrap resolution entirely so flag-off does NO bootstrap work
            # beyond the ownership read.
            from backend.services.pedagogy.integration import coach_chips_enabled, director_enabled
            if assignment_id and turn_index is not None and (coach_chips_enabled() or director_enabled()):
                ui_language = _normalize_string(session_record.get('ui_language')) or 'en'
                try:
                    bootstrap = resolve_assignment_bootstrap_for_user(
                        deps,
                        uid=uid,
                        context=deps.get_school_request_context(),
                        assignment_id=assignment_id,
                        ui_language=ui_language,
                    )
                except Exception:
                    bootstrap = None
                if bootstrap:
                    if coach_chips_enabled():
                        try:
                            chip = generate_coach_chip(deps, bootstrap, uid, session_id, turn_index)
                        except Exception:
                            chip = None
                    if director_enabled():
                        try:
                            resteer = assess_drift(deps, bootstrap, uid, session_id, turn_index)
                        except Exception:
                            resteer = None

            return jsonify({'success': True, 'coachChip': chip, 'resteer': resteer})
```

Also update the outer exception handler's return (currently `return jsonify({'success': True, 'coachChip': None})`) to:

```python
            return jsonify({'success': True, 'coachChip': None, 'resteer': None})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_coach_chip_route -v`
Expected: PASS (new Director cases + existing chip cases all green)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/curriculum_admin.py backend/tests/test_curriculum_admin_coach_chip_route.py
git commit -m "feat(pedagogy-s5): coach-chip route runs assess_drift, returns resteer"
```

---

### Task 6: Widen the `chat.py` coachNote gate for the Director (text re-steer)

**Files:**
- Modify: `backend/routes/chat.py:18-22` (import) + `:956` (the coachNote gate)
- Test: `backend/tests/test_realtime_chat.py` (add a Director-only coachNote case mirroring the existing ones at lines 1110-1157)

**Interfaces:**
- Consumes: `integration.director_enabled` (Task 2).
- Produces: a text-surface `coachNote` is injected as a transient system message when `coach_note_allowed AND ((promote_back_enabled() AND coach_chips_enabled()) OR director_enabled())`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_realtime_chat.py` near the existing coachNote tests (mirror `test_coach_note_injected_as_system_message_before_user_turn_when_flags_on` but with only the Director flag on). Use the same harness that test uses; the assertion is that `coach_note` appears as a `{'role': 'system', ...}` message in the outgoing `messages`:

```python
    def test_coach_note_injected_when_only_director_flag_on(self):
        # Mirror the existing flags-on test, but set ONLY PEDAGOGY_ENGINE_DIRECTOR=1
        # (promote-back + chips OFF). The Director's text re-steer rides the same
        # coachNote transport, so it must be honored.
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_DIRECTOR': '1'}):
            os.environ.pop('PEDAGOGY_ENGINE_PROMOTE_BACK', None)
            os.environ.pop('PEDAGOGY_ENGINE_COACH_CHIPS', None)
            # ... same setup as the existing flags-on coachNote test, with
            # 'coachNote': "COACH NOTE: steer toward 'la cuenta'." in the request body ...
            # assert the coach note string appears as a system message in the
            # captured outgoing messages (same assertion shape as the existing test).
```

> Implementer: copy the body of `test_coach_note_injected_as_system_message_before_user_turn_when_flags_on` (lines ~1110-1134) verbatim, change the env setup to set only `PEDAGOGY_ENGINE_DIRECTOR=1` and pop the other two flags, and keep the same assertion. Also confirm the existing `test_coach_note_not_injected_when_pedagogy_flags_off` still passes (all three flags off → not injected).

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_realtime_chat.<TestClass>.test_coach_note_injected_when_only_director_flag_on -v`
Expected: FAIL — the note is NOT injected because the current gate requires `promote_back_enabled() AND coach_chips_enabled()`.

- [ ] **Step 3: Implement the gate change**

In `backend/routes/chat.py`, extend the pedagogy import (lines 18-22) to include `director_enabled`:

```python
from backend.services.pedagogy.integration import (
    resolve_assignment_system_prompt,
    promote_back_enabled,
    coach_chips_enabled,
    director_enabled,
)
```

Change line 956 from:

```python
            if coach_note and coach_note_allowed and promote_back_enabled() and coach_chips_enabled():
```
to:
```python
            if coach_note and coach_note_allowed and (
                (promote_back_enabled() and coach_chips_enabled()) or director_enabled()
            ):
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_realtime_chat -v`
Expected: PASS (new Director case + existing flags-on + flags-off cases all green)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_realtime_chat.py
git commit -m "feat(pedagogy-s5): honor coachNote when director_enabled() (text re-steer)"
```

---

### Task 7: Frontend — surface `resteer` and route it through the existing channels

**Files:**
- Modify: `frontend/src/api/coachChips.ts` (return shape + `Resteer` interface)
- Modify: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` — `triggerCoachChip` (lines 776-793)
- Test: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx` (update existing `postCoachChip` mocks to the new shape + add resteer cases)

**Interfaces:**
- Consumes: the route's `{ coachChip, resteer }` response (Task 5).
- Produces: `postCoachChip(sessionId, turnIndex): Promise<CoachChipResult>` where `CoachChipResult = { chip: CoachChip | null; resteer: Resteer | null }`. `triggerCoachChip` routes a non-null `resteer.resteer_prompt` through `injectPromoteBackRef` (voice) / `pendingPromoteBackRef` (text), identically to a chip `promote`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`:
1. Every existing `postCoachChipMock.mockResolvedValue(X)` must become the new shape: `null → { chip: null, resteer: null }`; a chip object `CHIP → { chip: CHIP, resteer: null }`. Update all such call sites (search the file for `postCoachChipMock.mockResolvedValue` and `mockResolvedValueOnce`).
2. Add a new test (text surface): mock returns `{ chip: null, resteer: { surface: 'text', resteer_prompt: 'COACH NOTE: steer to la cuenta', turn_index: 2, resteer: true, kind: 'target_neglect', target: 'la cuenta', reason: 'r', generated_at: 'T' } }`; after a text send + a second send, assert the second send's request body carries `coachNote: 'COACH NOTE: steer to la cuenta'` (mirror the existing TEXT_PROMOTE test at lines ~919-947).

```typescript
  it('routes a director resteer through the coachNote on the next text send', async () => {
    // mirror the existing TEXT_PROMOTE test, but return a resteer (chip: null)
    postCoachChipMock.mockResolvedValue({
      chip: null,
      resteer: {
        surface: 'text', resteer: true, resteer_prompt: 'COACH NOTE: steer to la cuenta',
        turn_index: 2, kind: 'target_neglect', target: 'la cuenta', reason: 'r', generated_at: 'T',
      },
    });
    // ... same send harness as TEXT_PROMOTE ...
    // first send triggers postCoachChip -> sets pendingPromoteBackRef from resteer
    // second send must include coachNote === 'COACH NOTE: steer to la cuenta'
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPracticeWorkspace.test.tsx`
Expected: FAIL — destructuring `{ chip, resteer }` from a value the old `postCoachChip` typed as `CoachChip | null` (type error / runtime undefined), and the new resteer test asserting a coachNote that isn't sent yet.

- [ ] **Step 3: Implement — API return shape**

Replace `frontend/src/api/coachChips.ts`'s `postCoachChip` (and add `Resteer`/`CoachChipResult`):

```typescript
export interface Resteer {
  turn_index: number;
  surface: 'voice' | 'text';
  resteer: true;
  resteer_prompt: string;
  kind: string;
  target: string;
  reason: string;
  generated_at: string;
}

export interface CoachChipResult {
  chip: CoachChip | null;
  resteer: Resteer | null;
}

export const postCoachChip = async (
  sessionId: string,
  turnIndex: number,
): Promise<CoachChipResult> => {
  const response = await api.post<{ success: boolean; coachChip: CoachChip | null; resteer: Resteer | null }>(
    `/practice-sessions/${sessionId}/coach-chip`,
    { turnIndex },
  );
  return { chip: response.data.coachChip ?? null, resteer: response.data.resteer ?? null };
};
```

- [ ] **Step 4: Implement — `triggerCoachChip`**

Replace `triggerCoachChip` (AssignmentPracticeWorkspace.tsx:776-793) with:

```typescript
  const triggerCoachChip = useCallback(async (learnerTurnIndex: number) => {
    const sessionId = activePracticeSessionRef.current?.id;
    if (!sessionId || learnerTurnIndex == null) return;
    try {
      const { chip, resteer } = await postCoachChip(sessionId, learnerTurnIndex);
      if (chip) {
        setCoachChips((prev) => (prev.some((c) => c.turn_index === chip.turn_index) ? prev : [...prev, chip]));
        if (chip.promote && chip.promote_prompt) {
          if (chip.surface === 'voice') {
            injectPromoteBackRef.current?.(chip.promote_prompt);
          } else {
            pendingPromoteBackRef.current = chip.promote_prompt;
          }
        }
      }
      // S5 Director: a re-steer rides the SAME channels as a promote.
      if (resteer && resteer.resteer_prompt) {
        if (resteer.surface === 'voice') {
          injectPromoteBackRef.current?.(resteer.resteer_prompt);
        } else {
          pendingPromoteBackRef.current = resteer.resteer_prompt;
        }
      }
    } catch {
      // fail-open: a missing/failed chip/resteer or injection never disrupts the session
    }
  }, []);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPracticeWorkspace.test.tsx`
Expected: PASS (updated chip mocks + new resteer cases)
Run: `cd frontend && npm run build`
Expected: `tsc -b` clean (no type errors from the new `CoachChipResult`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/coachChips.ts frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx
git commit -m "feat(pedagogy-s5): frontend surfaces resteer, routes it via promote-back channels"
```

---

### Task 8: cloudbuild flag default + docs (deploy inert + record state)

**Files:**
- Modify: `cloudbuild.yaml` (line 60 `--set-env-vars` string + `substitutions:` block ~line 268)
- Modify: `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE_S5.md`
- Modify: `backend/CLAUDE.md` (pedagogy services list + flag-state paragraph)
- Modify: `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md` (§14 S5 row note) + `docs/school-integration/TASKS.md`
- Modify: `docs/school-integration/LIMITATIONS.md` (v1 target-neglect-only + both-fire last-writer-wins)

**Interfaces:**
- Consumes: the `PEDAGOGY_ENGINE_DIRECTOR` env var name (Task 2).
- Produces: deploy default `'0'` (inert) + accurate docs.

- [ ] **Step 1: cloudbuild — add the var to the REPLACE string**

In `cloudbuild.yaml` line 60, append to the `--set-env-vars` value, immediately after `PEDAGOGY_ENGINE_DEBRIEF=${_PEDAGOGY_ENGINE_DEBRIEF}`:

```
,PEDAGOGY_ENGINE_DIRECTOR=${_PEDAGOGY_ENGINE_DIRECTOR}
```

- [ ] **Step 2: cloudbuild — add the substitution default**

In the `substitutions:` block, after the `_PEDAGOGY_ENGINE_DEBRIEF: '0'` line (~line 268), add:

```yaml
  # Pedagogy Engine S5 Director — between-turn drift re-steer (PEDAGOGY_ENGINE_S5.md).
  # '0' = assess_drift returns None, the route returns resteer:null, byte-identical to
  # today. NOT cut over — flip via --update-env-vars PEDAGOGY_ENGINE_DIRECTOR=1 only after
  # the S5-gate eval shows a plateau. Rollback instant: =0.
  _PEDAGOGY_ENGINE_DIRECTOR: '0'
```

- [ ] **Step 3: Verify REPLACE-safety (no test cycle — a verification step)**

Run: `grep -c "PEDAGOGY_ENGINE_DIRECTOR" cloudbuild.yaml`
Expected: `2` (once in the set-env-vars string, once as the substitution). Confirm by eye that no other substitution default changed and that `_PEDAGOGY_ENGINE_DIRECTOR` default is `'0'` (matches the live-absent≈off state — safe under REPLACE).

- [ ] **Step 4: Docs**

- `PEDAGOGY_ENGINE_S5.md`: add a section "Director (built behind flag, 2026-06-24)" recording: v1 = target-neglect heuristic, pure `drift.py` + impure `director_service.assess_drift`, rides the coach-chip round-trip, delivers via injectPromoteBack/coachNote, flag `PEDAGOGY_ENGINE_DIRECTOR` default `'0'`, cutover gated on the eval verdict, `session.update`→`conversation.item.create` deviation noted.
- `backend/CLAUDE.md`: in the `pedagogy/` services bullet, add `drift.py` (pure: `detect_target_neglect`/`decide_resteer`/`build_resteer_prompt`/`serialize_resteer`; constants `DRIFT_WINDOW=3`/`DIRECTOR_COOLDOWN_TURNS=4`/`DIRECTOR_MAX_RESTEERS=3`) to the import-boundary-enforced list; add `director_enabled()` to the flag-helpers list; add the impure orchestrator line for `backend/services/director_service.py` (`assess_drift(...) → dict | None`, no LLM, fail-open, rides `POST /api/practice-sessions/<id>/coach-chip`, returns `resteer`); add the flag-state sentence (`PEDAGOGY_ENGINE_DIRECTOR` BUILT, cloudbuild default `'0'`, NOT cut over).
- `PEDAGOGY_ENGINE.md` §14 S5 row: append "Director BUILT behind `PEDAGOGY_ENGINE_DIRECTOR` (default off, 2026-06-24); v1 = target-neglect heuristic; cutover still gated on the eval plateau verdict."
- `TASKS.md`: mark the S5 build item as built-behind-flag (`[-]` or a new line), cutover pending eval.
- `LIMITATIONS.md`: add an entry — "S5 Director v1 detects only target-neglect (locale-agnostic heuristic); language-drift + LLM-judged dimensions deferred. Text re-steer + promote-back share the single `coachNote` per turn → last-writer-wins in the rare both-fire turn."

- [ ] **Step 5: Run the full backend + frontend suites + commit**

Run: `make test-backend`
Expected: PASS
Run: `cd frontend && npm run test -- --run`
Expected: PASS

```bash
git add cloudbuild.yaml "docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE_S5.md" backend/CLAUDE.md "docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md" docs/school-integration/TASKS.md docs/school-integration/LIMITATIONS.md
git commit -m "chore(pedagogy-s5): deploy Director inert (cloudbuild default 0) + doc-sync"
```

---

## Self-Review

**1. Spec coverage:**
- Pure `drift.py` (detector + decision + prompt) → Task 1 ✓
- `director_enabled()` flag + import boundary → Task 2 ✓
- Persistence keys `director_state`/`resteers` → Task 3 ✓
- Impure `assess_drift` (no LLM, fail-open, re-read-before-write, dedup, transcript source) → Task 4 ✓
- Route wiring (`resteer` in response, bootstrap if either flag) → Task 5 ✓
- chat.py coachNote gate widening (text re-steer) → Task 6 ✓
- Frontend `resteer` surfacing + channel routing → Task 7 ✓
- cloudbuild inert default + docs → Task 8 ✓
- Voice channel reuse (`injectPromoteBack`) — no `useRealtimeChat` change needed; covered by Task 7's routing through `injectPromoteBackRef` ✓
- Both-fire edge case (last-writer-wins) — documented in Task 8 LIMITATIONS ✓
- Concrete-targets-only (grammar excluded) — Task 1 detector contract + Task 4 `concrete_targets` ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Task 6 and Task 7 reference copying an existing test body verbatim with the exact change named — the existing test is cited by name+line and the change is explicit (which env vars, which assertion). All code steps show complete code.

**3. Type consistency:** `assess_drift(deps, bootstrap, uid, session_id, turn_index)` identical in Tasks 4/5. Payload keys (`turn_index, surface, resteer, resteer_prompt, kind, target, reason, generated_at`) identical across Task 4 (return), Task 5 (test), Task 7 (`Resteer` interface). `detect_target_neglect` / `decide_resteer` / `build_resteer_prompt` / `serialize_resteer` signatures identical in Tasks 1 and 4. `director_enabled()` identical in Tasks 2/4/5/6. `CoachChipResult = { chip, resteer }` consistent in Task 7 API + component + tests. Constants `DRIFT_WINDOW=3`/`DIRECTOR_COOLDOWN_TURNS=4`/`DIRECTOR_MAX_RESTEERS=3` consistent (Task 1 defines, Global Constraints repeat).
