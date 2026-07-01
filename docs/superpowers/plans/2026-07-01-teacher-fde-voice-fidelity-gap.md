# Voice Fidelity Gap Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal, backend-only instrument that estimates how much the realized/uptake signal under-counts VOICE production, so we can decide whether a voice-fidelity fix is worth building before the teacher-facing modality split.

**Architecture:** A pure read-time probe (`pedagogy/voice_fidelity.py`) over already-persisted `learning_events` estimates two loss mechanisms — substring-miss (a fuzzy pass vs. production's own exact-hit events) and ASR dropout (a new `metric.voice_transcript_lost` marker) — and attributes each production to voice/text via a per-turn `payload.source` self-join. It rides the existing plan-preview `realized` branch behind a new flag `PEDAGOGY_ENGINE_VOICE_FIDELITY`. The one emission-path change is a content-less dropout marker emitted from the voice frontend, which ships live and inert. Mirrors the Alignment View / Uptake Trace precedent exactly.

**Tech Stack:** Python 3 (Flask, stdlib `difflib`/`re` for the pure probe), React 19 + TypeScript (Vite), unittest (backend), Vitest (frontend), Cloud Run + `cloudbuild.yaml`.

## Global Constraints

- **Flag:** `PEDAGOGY_ENGINE_VOICE_FIDELITY`, default **off**. cloudbuild substitution `_PEDAGOGY_ENGINE_VOICE_FIDELITY` default `'0'` (REPLACE-safe: matches absent/off live).
- **Import boundary (invariant 7a):** `voice_fidelity.py` imports stdlib (incl. `difflib`, `re`) + sibling pure pedagogy only — no OpenAI/Canvas/resolver/practice_analytics imports. Enforced by `test_pedagogy_engine_s1.ImportBoundaryTestCase`.
- **Dropout marker** `metric.voice_transcript_lost` ships **live/unconditional** (inert telemetry — NOT behind the read flag), because forward dropout data must accumulate; the **read surface** (`realized.voiceFidelity`) is flag-gated.
- **Marker inertness:** applying the marker leaves `session_summary` idempotent (no accumulating counter, existing counters preserved) and produces **zero** derived events.
- **Fail-soft:** with the flag off, the realized/uptake payload is **byte-identical**. The `voiceFidelity` block has its **own nested** try/except so a probe failure degrades it to `None` WITHOUT nulling `realized` (mirrors the uptake block). Nothing 500s.
- **Privacy:** the block returns **counts only — never utterance content**. The flag stays off in prod until an explicit go; the first real read is on our own test class via the voice harness.
- **Fuzzy:** stdlib `difflib.SequenceMatcher`, default threshold `0.85`, sliding N-token window (N = target token count). `substringMissEstimate` is a ceiling; `dropoutTurns` is a forward-looking floor.
- **Commits:** plain messages — NO `Co-Authored-By` or attribution trailer (project rule).
- **Test commands:** backend from repo root `python3 -m unittest backend.tests.<module> -v`; frontend `cd frontend && npm run test -- --run <file>`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `backend/services/pedagogy/voice_fidelity.py` (new) | Pure probe: `build_voice_fidelity(events, target_surfaces, *, fuzzy_threshold=0.85)` | 1 |
| `backend/tests/test_pedagogy_voice_fidelity.py` (new) | Unit tests for the probe | 1 |
| `backend/tests/test_pedagogy_engine_s1.py` (modify) | Add import-boundary probe line | 1 |
| `backend/services/practice_analytics.py` (modify) | Add `metric.voice_transcript_lost` to `SUPPORTED_EVENT_TYPES` | 2 |
| `backend/tests/test_voice_transcript_lost_marker.py` (new) | Marker inertness + whitelist membership | 2 |
| `backend/services/pedagogy/integration.py` (modify) | `voice_fidelity_enabled()` flag helper | 3 |
| `backend/routes/curriculum_admin.py` (modify) | Attach `realized.voiceFidelity` (nested fail-soft) | 3 |
| `backend/tests/test_teacher_plan_preview_route.py` (modify) | Route tests: flag-on attaches, flag-off omits, fail-soft | 3 |
| `cloudbuild.yaml` (modify) | `_PEDAGOGY_ENGINE_VOICE_FIDELITY` substitution + `--set-env-vars` entry | 3 |
| `frontend/src/hooks/useRealtimeChat.ts` (modify) | `onUserTranscriptLost` option, called in the `.failed` handler | 4 |
| `frontend/src/hooks/useRealtimeChat.test.tsx` (modify) | Hook test: `.failed` → callback fires; `.done` → does not | 4 |
| `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` (modify) | Wire `onUserTranscriptLost` → emit the dropout marker | 4 |
| `backend/CLAUDE.md`, `docs/school-integration/teacher-fde/{TASKS,ROADMAP}.md`, `docs/school-integration/LIMITATIONS.md` (modify) | Doc sync | 5 |

---

## Task 1: Pure probe `voice_fidelity.py` + tests + import boundary

**Files:**
- Create: `backend/services/pedagogy/voice_fidelity.py`
- Create: `backend/tests/test_pedagogy_voice_fidelity.py`
- Modify: `backend/tests/test_pedagogy_engine_s1.py` (ImportBoundaryTestCase probe, near line 212)

**Interfaces:**
- Consumes: nothing (pure, stdlib only).
- Produces: `build_voice_fidelity(events: list[dict], target_surfaces: list[str], *, fuzzy_threshold: float = 0.85) -> dict` returning
  `{"fuzzyThreshold": float, "voiceTurns": int, "modalitySplit": {"voice": int, "text": int, "unknown": int}, "substringMissEstimate": int, "dropoutTurns": int, "perTarget": [{"surface": str, "voice": int, "text": int, "substringMiss": int}]}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_pedagogy_voice_fidelity.py`:

```python
import unittest

from backend.services.pedagogy.voice_fidelity import build_voice_fidelity


def _turn(session_id, turn_index, content, source):
    return {"session_id": session_id, "event_type": "student.turn", "turn_index": turn_index,
            "payload": {"content": content, "source": source}}


def _hit(session_id, turn_index, expression, count=1):
    return {"session_id": session_id, "event_type": "metric.target_expression_hit",
            "turn_index": turn_index, "payload": {"expression": expression, "count": count}}


def _vocab_hit(session_id, turn_index, word, count=1):
    return {"session_id": session_id, "event_type": "metric.target_vocabulary_hit",
            "turn_index": turn_index, "payload": {"word": word, "count": count}}


def _dropout(session_id, turn_index):
    return {"session_id": session_id, "event_type": "metric.voice_transcript_lost",
            "turn_index": turn_index, "payload": {"source": "realtime"}}


class BuildVoiceFidelityTestCase(unittest.TestCase):
    def test_voice_hit_attributed_to_voice(self):
        events = [_turn("s1", 0, "quiero la cuenta", "realtime"), _hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 1, "text": 0, "unknown": 0})

    def test_text_hit_attributed_to_text(self):
        events = [_turn("s1", 0, "quiero la cuenta", "text"), _hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 1, "unknown": 0})

    def test_hit_without_sibling_turn_is_unknown(self):
        # Hit exists but no student.turn at that (session, turn_index) -> unknown.
        events = [_hit("s1", 0, "la cuenta")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 1})

    def test_hybrid_session_attributes_per_turn_not_per_session(self):
        # Same session, one voice turn + one text turn -> split by turn source.
        events = [
            _turn("s1", 0, "la cuenta", "realtime"), _hit("s1", 0, "la cuenta"),
            _turn("s1", 2, "gracias", "text"), _hit("s1", 2, "gracias"),
        ]
        out = build_voice_fidelity(events, ["la cuenta", "gracias"])
        self.assertEqual(out["modalitySplit"], {"voice": 1, "text": 1, "unknown": 0})

    def test_substring_miss_when_fuzzy_catches_but_no_exact_hit(self):
        # ASR drift "grasias" -> exact matcher recorded NO hit, fuzzy catches -> 1 miss.
        events = [_turn("s1", 0, "muchas grasias", "realtime")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 1)
        self.assertEqual(out["perTarget"][0]["substringMiss"], 1)

    def test_no_substring_miss_when_exact_hit_present(self):
        # Exact hit already recorded for this turn -> not a miss even if fuzzy also matches.
        events = [_turn("s1", 0, "gracias", "realtime"), _hit("s1", 0, "gracias")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 0)

    def test_substring_miss_only_on_voice_turns(self):
        # A text turn with drift is NOT probed for substring-miss (typed text is exact).
        events = [_turn("s1", 0, "grasias", "text")]
        out = build_voice_fidelity(events, ["gracias"])
        self.assertEqual(out["substringMissEstimate"], 0)

    def test_dropout_turns_counted(self):
        events = [_dropout("s1", 1), _dropout("s1", 3)]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["dropoutTurns"], 2)

    def test_vocabulary_hit_uses_word_key(self):
        events = [_turn("s1", 0, "las relaciones", "realtime"), _vocab_hit("s1", 0, "relaciones")]
        out = build_voice_fidelity(events, ["relaciones"])
        self.assertEqual(out["modalitySplit"]["voice"], 1)

    def test_count_weighting(self):
        events = [_turn("s1", 0, "la cuenta la cuenta", "realtime"), _hit("s1", 0, "la cuenta", count=2)]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"]["voice"], 2)

    def test_non_target_surface_ignored(self):
        events = [_turn("s1", 0, "hola", "realtime"), _hit("s1", 0, "hola")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 0})
        self.assertEqual(out["perTarget"], [])

    def test_malformed_events_skipped(self):
        events = [
            "not a dict",
            {"event_type": "student.turn"},  # no turn_index
            {"event_type": "metric.target_expression_hit", "turn_index": None,
             "payload": {"expression": "la cuenta"}},
            _turn("s1", 0, "la cuenta", "realtime"), _hit("s1", 0, "la cuenta"),
        ]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["modalitySplit"]["voice"], 1)

    def test_voice_turns_counted(self):
        events = [_turn("s1", 0, "hola", "realtime"), _turn("s1", 2, "adios", "realtime"),
                  _turn("s1", 4, "typed", "text")]
        out = build_voice_fidelity(events, ["la cuenta"])
        self.assertEqual(out["voiceTurns"], 2)

    def test_per_target_ordered_by_target_surfaces(self):
        events = [
            _turn("s1", 0, "b", "realtime"), _hit("s1", 0, "b"),
            _turn("s1", 2, "a", "realtime"), _hit("s1", 2, "a"),
        ]
        out = build_voice_fidelity(events, ["a", "b", "c"])  # c never produced
        self.assertEqual([t["surface"] for t in out["perTarget"]], ["a", "b"])

    def test_empty_events(self):
        out = build_voice_fidelity([], ["la cuenta"])
        self.assertEqual(out["modalitySplit"], {"voice": 0, "text": 0, "unknown": 0})
        self.assertEqual(out["substringMissEstimate"], 0)
        self.assertEqual(out["dropoutTurns"], 0)
        self.assertEqual(out["voiceTurns"], 0)
        self.assertEqual(out["perTarget"], [])
        self.assertEqual(out["fuzzyThreshold"], 0.85)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_pedagogy_voice_fidelity -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.pedagogy.voice_fidelity'`.

- [ ] **Step 3: Write the pure module**

Create `backend/services/pedagogy/voice_fidelity.py`:

```python
"""Voice fidelity gap measurement (Teacher FDE, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Estimates how much the realized/uptake signal UNDER-COUNTS voice production, so
we can decide whether a voice-fidelity fix is worth building before the
teacher-facing modality split. Derived from already-persisted ``learning_events``;
the DB read happens in the route layer.

Two loss mechanisms:
  - substring-miss: the exact matcher misses a target on ASR text. Estimated by a
    fuzzy pass over voice turns vs. production's OWN exact-hit events (so we never
    re-implement the exact matcher). A ceiling (fuzzy admits false positives).
  - ASR dropout: spoken turns with no transcript, counted from
    ``metric.voice_transcript_lost`` markers. A forward-looking floor.
Also attributes each production to voice/text via a per-turn ``payload.source``
self-join (the data core the eventual split reuses).
"""

from __future__ import annotations

import difflib
import re
from typing import Any

_HIT_SURFACE_KEY = {
    "metric.target_expression_hit": "expression",
    "metric.target_vocabulary_hit": "word",
}
_DROPOUT_TYPE = "metric.voice_transcript_lost"
_STUDENT_TURN = "student.turn"
_VOICE_SOURCE = "realtime"
_TEXT_SOURCE = "text"

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _fuzzy_hit(target_tokens: list[str], turn_tokens: list[str], threshold: float) -> bool:
    """True if some N-token window of the turn ~matches the target (N = len target).

    difflib ratio over joined token windows: tolerant of ASR spelling/boundary drift
    while still requiring the right span. Pure, stdlib-only.
    """
    n = len(target_tokens)
    if n == 0 or len(turn_tokens) < n:
        return False
    target_join = " ".join(target_tokens)
    for i in range(len(turn_tokens) - n + 1):
        window = " ".join(turn_tokens[i:i + n])
        if difflib.SequenceMatcher(None, target_join, window).ratio() >= threshold:
            return True
    return False


def build_voice_fidelity(
    events: list[dict],
    target_surfaces: list[str],
    *,
    fuzzy_threshold: float = 0.85,
) -> dict[str, Any]:
    """Estimate the voice under-count from persisted events. Pure, total, no-raise."""
    surfaces = [s for s in (target_surfaces or []) if s]
    surface_set = set(surfaces)

    voice_turns: dict[tuple, str] = {}          # (session_id, turn_index) -> voice content
    source_by_turn: dict[tuple, str] = {}       # (session_id, turn_index) -> 'realtime'/'text'
    exact_by_turn: dict[tuple, set] = {}        # (session_id, turn_index) -> {surface}
    hits: list[tuple] = []                       # (session_id, turn_index, surface, count)
    dropout_turns = 0

    for event in events or []:
        if not isinstance(event, dict):
            continue
        event_type = event.get("event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if event_type == _DROPOUT_TYPE:
            dropout_turns += 1
            continue

        turn_index = event.get("turn_index")
        if not isinstance(turn_index, int):
            continue
        key = (event.get("session_id"), turn_index)

        if event_type == _STUDENT_TURN:
            source = payload.get("source")
            if isinstance(source, str):
                source_by_turn[key] = source
            if source == _VOICE_SOURCE:
                content = payload.get("content")
                voice_turns[key] = content if isinstance(content, str) else ""
        elif event_type in _HIT_SURFACE_KEY:
            surface = payload.get(_HIT_SURFACE_KEY[event_type])
            if surface not in surface_set:
                continue
            count = payload.get("count")
            count = count if isinstance(count, int) and count > 0 else 1
            hits.append((key[0], turn_index, surface, count))
            exact_by_turn.setdefault(key, set()).add(surface)

    # Modality attribution over productions (count-weighted).
    modality = {"voice": 0, "text": 0, "unknown": 0}
    per_surface: dict[str, dict[str, int]] = {}
    for session_id, turn_index, surface, count in hits:
        src = source_by_turn.get((session_id, turn_index))
        bucket = "voice" if src == _VOICE_SOURCE else "text" if src == _TEXT_SOURCE else "unknown"
        modality[bucket] += count
        ps = per_surface.setdefault(surface, {"voice": 0, "text": 0, "substringMiss": 0})
        ps[bucket] += count

    # Substring-miss: fuzzy catch on a voice turn where the exact matcher recorded no hit.
    substring_miss = 0
    tokenized = {s: _tokens(s) for s in surface_set}
    for key, content in voice_turns.items():
        turn_tokens = _tokens(content)
        exact_here = exact_by_turn.get(key, set())
        for surface in surface_set:
            if surface in exact_here:
                continue
            if _fuzzy_hit(tokenized[surface], turn_tokens, fuzzy_threshold):
                substring_miss += 1
                ps = per_surface.setdefault(surface, {"voice": 0, "text": 0, "substringMiss": 0})
                ps["substringMiss"] += 1

    seen: set = set()
    per_target: list[dict] = []
    for s in surfaces:
        if s in seen or s not in per_surface:
            continue
        ps = per_surface[s]
        if ps["voice"] or ps["text"] or ps["substringMiss"]:
            seen.add(s)
            per_target.append({"surface": s, **ps})

    return {
        "fuzzyThreshold": fuzzy_threshold,
        "voiceTurns": len(voice_turns),
        "modalitySplit": modality,
        "substringMissEstimate": substring_miss,
        "dropoutTurns": dropout_turns,
        "perTarget": per_target,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_pedagogy_voice_fidelity -v`
Expected: PASS (16 tests OK).

- [ ] **Step 5: Add the import-boundary probe line**

In `backend/tests/test_pedagogy_engine_s1.py`, in the `ImportBoundaryTestCase` probe string, add a line right after the `import backend.services.pedagogy.uptake\n` line (currently line 212):

```python
            "import backend.services.pedagogy.uptake\n"
            "import backend.services.pedagogy.voice_fidelity\n"
```

- [ ] **Step 6: Run the import-boundary test**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1 -v`
Expected: PASS (the fresh-interpreter probe imports `voice_fidelity` with no OpenAI/Canvas/resolver in `sys.modules`).

- [ ] **Step 7: Commit**

```bash
git add backend/services/pedagogy/voice_fidelity.py backend/tests/test_pedagogy_voice_fidelity.py backend/tests/test_pedagogy_engine_s1.py
git commit -m "feat(teacher-fde): pure voice-fidelity gap probe (build_voice_fidelity)"
```

---

## Task 2: Dropout marker acceptance (`metric.voice_transcript_lost`)

**Files:**
- Modify: `backend/services/practice_analytics.py` (`SUPPORTED_EVENT_TYPES`, lines 13-31)
- Create: `backend/tests/test_voice_transcript_lost_marker.py`

**Interfaces:**
- Consumes: `apply_learning_event_to_session`, `build_derived_learning_events`, `SUPPORTED_EVENT_TYPES` (existing, `practice_analytics.py`).
- Produces: `'metric.voice_transcript_lost'` is an accepted, inert event type (write route stops 400ing it; aggregation unchanged).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_voice_transcript_lost_marker.py`:

```python
import unittest

from backend.services.practice_analytics import (
    SUPPORTED_EVENT_TYPES,
    apply_learning_event_to_session,
    build_derived_learning_events,
)

_MARKER = "metric.voice_transcript_lost"


class VoiceTranscriptLostMarkerTestCase(unittest.TestCase):
    def test_marker_is_a_supported_event_type(self):
        # The write route (curriculum_admin) 400s any type not in this set.
        self.assertIn(_MARKER, SUPPORTED_EVENT_TYPES)

    def test_marker_does_not_accumulate_or_change_counters(self):
        # Idempotent under re-application (no accumulating counter) and existing
        # counters preserved -> the marker is inert to session analytics.
        session_record = {
            "session_summary": {"target_expression_hits": {"la cuenta": 2}},
            "status": "active",
        }
        updates1 = apply_learning_event_to_session(
            session_record, event_type=_MARKER, turn_index=3, payload={"source": "realtime"})
        session_record2 = {"session_summary": updates1["session_summary"], "status": "active"}
        updates2 = apply_learning_event_to_session(
            session_record2, event_type=_MARKER, turn_index=4, payload={"source": "realtime"})
        self.assertEqual(updates1["session_summary"], updates2["session_summary"])
        self.assertEqual(updates1["session_summary"].get("target_expression_hits"), {"la cuenta": 2})

    def test_marker_produces_no_derived_events(self):
        out = build_derived_learning_events(
            {"session_summary": {}}, event_type=_MARKER, turn_index=3,
            payload={"source": "realtime"})
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_voice_transcript_lost_marker -v`
Expected: FAIL — `test_marker_is_a_supported_event_type` fails (`assertIn`) because the type is not yet in the set. (The other two may already pass — the unknown type is inert today — but the membership test pins the deliverable.)

- [ ] **Step 3: Add the marker to `SUPPORTED_EVENT_TYPES`**

In `backend/services/practice_analytics.py`, in the `SUPPORTED_EVENT_TYPES` set (lines 13-31), add the marker after `'task.completed',`:

```python
    'task.completed',
    # Voice-fidelity telemetry (Teacher FDE): a spoken user turn whose transcription
    # failed -> no student.turn was persisted. Content-less; inert to all aggregation
    # (no apply_learning_event_to_session branch, no derived events). Counted by
    # pedagogy/voice_fidelity.build_voice_fidelity as dropoutTurns.
    'metric.voice_transcript_lost',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_voice_transcript_lost_marker -v`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_voice_transcript_lost_marker.py
git commit -m "feat(teacher-fde): accept inert metric.voice_transcript_lost dropout marker"
```

---

## Task 3: Flag + route enrichment + route tests + cloudbuild

**Files:**
- Modify: `backend/services/pedagogy/integration.py` (add `voice_fidelity_enabled()` after `uptake_trace_enabled()`, near line 127)
- Modify: `backend/routes/curriculum_admin.py` (imports near lines 30/36; enrichment after the uptake block, near line 1104)
- Modify: `backend/tests/test_teacher_plan_preview_route.py` (add `VoiceFidelityRouteTests`)
- Modify: `cloudbuild.yaml` (`--set-env-vars` line 60; `substitutions`, add after line 330)

**Interfaces:**
- Consumes: `build_voice_fidelity` (Task 1); `deps.db.list_assignment_learning_events(assignment_id, event_types=...)`; the `lexical` surfaces already computed in the realized branch.
- Produces: `preview['realized']['voiceFidelity']` (the probe dict, or `None` on fail-soft) when `PEDAGOGY_ENGINE_VOICE_FIDELITY` is on AND the alignment view is on AND `?realized=1` AND sessions exist.

- [ ] **Step 1: Add the flag helper (with a failing flag test)**

First add the flag test to `backend/tests/test_teacher_plan_preview_route.py` — append at the end of the file:

```python
class VoiceFidelityFlagTestCase(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            from backend.services.pedagogy.integration import voice_fidelity_enabled
            self.assertFalse(voice_fidelity_enabled())

    def test_on_when_truthy(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_VOICE_FIDELITY": "1"}):
            from backend.services.pedagogy.integration import voice_fidelity_enabled
            self.assertTrue(voice_fidelity_enabled())
```

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route.VoiceFidelityFlagTestCase -v`
Expected: FAIL — `ImportError: cannot import name 'voice_fidelity_enabled'`.

- [ ] **Step 2: Implement the flag helper**

In `backend/services/pedagogy/integration.py`, add after `uptake_trace_enabled()` (after line 126):

```python
def voice_fidelity_enabled() -> bool:
    """Teacher FDE — voice fidelity gap measurement (internal instrument overlaid on
    the realized signal). Default off; read-only/additive (no live-path effect).
    Rides the realized block, so it is effective only with the alignment view also on.
    Reads PEDAGOGY_ENGINE_VOICE_FIDELITY."""
    return os.environ.get("PEDAGOGY_ENGINE_VOICE_FIDELITY", "").strip().lower() in _TRUTHY
```

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route.VoiceFidelityFlagTestCase -v`
Expected: PASS.

- [ ] **Step 3: Wire the route imports**

In `backend/routes/curriculum_admin.py`, add the probe import next to the uptake import (after line 30):

```python
from backend.services.pedagogy.alignment import build_alignment
from backend.services.pedagogy.uptake import build_target_uptake
from backend.services.pedagogy.voice_fidelity import build_voice_fidelity
```

And add `voice_fidelity_enabled` to the integration import block (after `uptake_trace_enabled,` near line 36):

```python
    uptake_trace_enabled,
    voice_fidelity_enabled,
```

- [ ] **Step 4: Write the failing route tests**

Append `VoiceFidelityRouteTests` to `backend/tests/test_teacher_plan_preview_route.py` (mirrors `UptakeTraceRouteTests`):

```python
class VoiceFidelityRouteTests(unittest.TestCase):
    """Route-level tests for realized.voiceFidelity (flag gate + fail-soft)."""

    _PREVIEW = {
        'engineEnabled': True, 'rawTutorMode': False, 'taskType': 'opinion_gap',
        'correctionPosture': {'mode': 'balanced', 'recastDefault': True, 'elicitationRepeatThreshold': 2},
        'targets': [{'surface': 'la cuenta', 'kind': 'expression', 'feedbackRoute': 'recast_first'}],
    }
    _SESSIONS = [{'student_uid': 's1', 'session_summary': {'target_expression_hits': {'la cuenta': 1}}}]
    _EVENTS = [
        {'session_id': 'sess1', 'event_type': 'student.turn', 'turn_index': 0,
         'payload': {'content': 'quiero la cuenta', 'source': 'realtime'}},
        {'session_id': 'sess1', 'event_type': 'metric.target_expression_hit', 'turn_index': 0,
         'payload': {'expression': 'la cuenta', 'count': 1}},
        {'session_id': 'sess1', 'event_type': 'metric.voice_transcript_lost', 'turn_index': 2,
         'payload': {'source': 'realtime'}},
    ]

    def _app(self, *, events_raise=False):
        class _Db:
            def list_assignment_practice_sessions(self, _aid):
                return VoiceFidelityRouteTests._SESSIONS

            def list_assignment_learning_events(self, _aid, event_types=None):
                if events_raise:
                    raise RuntimeError('events boom')
                return VoiceFidelityRouteTests._EVENTS

        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(RouteDeps(
            db=_Db(), firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None, get_assessment=lambda: {},
            compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
            login_required=_passthrough, get_user_proficiency_context=lambda **_: '',
            build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
            set_active_school_membership=lambda *a, **k: None,
            allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
            supported_ui_languages={'en'}, audit_logger=None,
        )))
        return app

    def _patches(self, env):
        return [
            mock.patch.dict(os.environ, env),
            mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'),
            mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={}),
            mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()),
            mock.patch('backend.routes.curriculum_admin.serialize_plan_preview',
                       return_value=dict(self._PREVIEW)),
        ]

    def test_flag_on_attaches_voice_fidelity(self):
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_VOICE_FIDELITY': '1'}):
                stack.enter_context(p)
            client = self._app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        vf = resp.get_json()['planPreview']['realized']['voiceFidelity']
        self.assertEqual(vf['modalitySplit'], {'voice': 1, 'text': 0, 'unknown': 0})
        self.assertEqual(vf['dropoutTurns'], 1)

    def test_flag_off_no_voice_fidelity_key(self):
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_VOICE_FIDELITY': ''}):
                stack.enter_context(p)
            client = self._app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        realized = resp.get_json()['planPreview']['realized']
        self.assertNotIn('voiceFidelity', realized)

    def test_fail_soft_does_not_null_realized(self):
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_VOICE_FIDELITY': '1'}):
                stack.enter_context(p)
            client = self._app(events_raise=True).test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        realized = resp.get_json()['planPreview']['realized']
        self.assertIsNotNone(realized)
        self.assertIn('perTarget', realized)
        self.assertIsNone(realized['voiceFidelity'])
```

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route.VoiceFidelityRouteTests -v`
Expected: FAIL — `voiceFidelity` not attached (route enrichment not written yet); `test_flag_on_attaches_voice_fidelity` raises `KeyError`/`TypeError`.

- [ ] **Step 5: Add the route enrichment**

In `backend/routes/curriculum_admin.py`, inside `api_get_assignment_plan_preview`, immediately AFTER the uptake block (after line 1104, the `preview['realized']['uptake'] = None` line, still inside `if sessions:`), add:

```python
                            if voice_fidelity_enabled():
                                # Own nested fail-soft: a voice-fidelity failure must
                                # NOT null the realized block (the outer except would).
                                # Internal measurement: counts only, never content.
                                try:
                                    vf_events = deps.db.list_assignment_learning_events(
                                        assignment_id,
                                        event_types=[
                                            'student.turn',
                                            'metric.target_expression_hit',
                                            'metric.target_vocabulary_hit',
                                            'metric.voice_transcript_lost',
                                        ],
                                    )
                                    preview['realized']['voiceFidelity'] = build_voice_fidelity(
                                        vf_events, lexical)
                                except Exception:
                                    logger.exception(
                                        'voice fidelity derivation failed; voiceFidelity=None '
                                        '(assignment_id=%s)', assignment_id)
                                    preview['realized']['voiceFidelity'] = None
```

- [ ] **Step 6: Run the route tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route -v`
Expected: PASS (all classes, including the existing uptake/alignment tests — the addition is additive).

- [ ] **Step 7: Wire cloudbuild (REPLACE-safe)**

In `cloudbuild.yaml`, append the new env var to the end of the `--set-env-vars` string on line 60 (just after `PEDAGOGY_ENGINE_UPTAKE_TRACE=${_PEDAGOGY_ENGINE_UPTAKE_TRACE}`, keeping the closing quote):

```
,PEDAGOGY_ENGINE_VOICE_FIDELITY=${_PEDAGOGY_ENGINE_VOICE_FIDELITY}'
```

And add the substitution after the `_PEDAGOGY_ENGINE_UPTAKE_TRACE: '1'` line (after line 330):

```yaml
  # Teacher FDE — voice fidelity gap measurement (internal instrument). Default '0'
  # (REPLACE-safe: matches absent/off live). Read surface flag-gated; the dropout
  # marker ships live/unconditional (inert telemetry). Ship inert; flip only to read
  # on the test class. Rollback: --update-env-vars PEDAGOGY_ENGINE_VOICE_FIDELITY=0.
  _PEDAGOGY_ENGINE_VOICE_FIDELITY: '0'
```

- [ ] **Step 8: Verify cloudbuild parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('cloudbuild.yaml'))" && echo OK`
Expected: `OK` (no YAML error; the quote/brace balance is intact).

- [ ] **Step 9: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/routes/curriculum_admin.py backend/tests/test_teacher_plan_preview_route.py cloudbuild.yaml
git commit -m "feat(teacher-fde): attach realized.voiceFidelity (flag PEDAGOGY_ENGINE_VOICE_FIDELITY, default off)"
```

---

## Task 4: Frontend dropout instrumentation (the one emission-path change)

**Files:**
- Modify: `frontend/src/hooks/useRealtimeChat.ts` (options interface ~line 34; capture ~line 156; `.failed` handler ~line 935; deps array ~line 1020)
- Modify: `frontend/src/hooks/useRealtimeChat.test.tsx` (parametrize `HookHarness`; add two tests)
- Modify: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` (define handler ~before line 843; wire into `useRealtimeChat({...})` ~line 856)

**Interfaces:**
- Consumes: `queuePracticeEvent(practiceSessionId, eventType, turnIndex, payload)` (existing, `AssignmentPracticeWorkspace.tsx:40`); the marker type accepted in Task 2.
- Produces: `useRealtimeChat` option `onUserTranscriptLost?: () => void`, invoked once per `conversation.item.input_audio_transcription.failed`.

- [ ] **Step 1: Parametrize the test harness + write the failing tests**

In `frontend/src/hooks/useRealtimeChat.test.tsx`, change `HookHarness` (line 76) to accept options:

```tsx
function HookHarness({ options }: { options?: Parameters<typeof useRealtimeChat>[0] } = {}) {
  const hookState = useRealtimeChat(options);

  useEffect(() => {
    latestHookState = hookState;
  }, [hookState]);

  return null;
}
```

(Existing `render(<HookHarness />)` calls remain valid — `options` is optional.)

Then add two tests inside the existing `describe('useRealtimeChat directive continuation', ...)` block (so they inherit its `beforeEach`/`afterEach`):

```tsx
  it('emits onUserTranscriptLost when a user transcription fails', async () => {
    const onLost = vi.fn();
    render(<HookHarness options={{ onUserTranscriptLost: onLost }} />);

    await act(async () => {
      await latestHookState?.connect();
    });
    act(() => {
      activeDataChannel?.open();
    });
    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.failed',
        item_id: 'item_lost',
        error: { message: 'no audio' },
      });
    });

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('does not emit onUserTranscriptLost when a user transcription succeeds', async () => {
    const onLost = vi.fn();
    render(<HookHarness options={{ onUserTranscriptLost: onLost }} />);

    await act(async () => {
      await latestHookState?.connect();
    });
    act(() => {
      activeDataChannel?.open();
    });
    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.done',
        item_id: 'item_ok',
        transcript: 'Hola, quiero un café',
      });
    });

    expect(onLost).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: FAIL — `emits onUserTranscriptLost when a user transcription fails` fails (`onLost` never called; the option isn't consumed yet).

- [ ] **Step 3: Add the option to the hook**

In `frontend/src/hooks/useRealtimeChat.ts`, extend `UseRealtimeChatOptions` (line 34):

```typescript
interface UseRealtimeChatOptions {
  onMessage?: (role: 'user' | 'assistant', content: string) => void;
  onUserTranscriptLost?: () => void;
```

Capture it next to `onMessageCallback` (after line 156):

```typescript
  const onMessageCallback = options?.onMessage;
  const onUserTranscriptLostCallback = options?.onUserTranscriptLost;
```

- [ ] **Step 4: Call it in the `.failed` handler**

In the `conversation.item.input_audio_transcription.failed` case (lines 935-942), add the callback after the state reset, before the `setError`:

```typescript
        case 'conversation.item.input_audio_transcription.failed':
          pendingUserOrderRef.current = null;
          inputSpeechStartedAtRef.current = null;
          currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();
          // Voice-fidelity telemetry: a spoken turn produced no transcript -> no
          // student.turn will be persisted. Surface it so the workspace can record
          // an ASR-dropout marker. Fail-open: never disrupt the session.
          onUserTranscriptLostCallback?.();
          if (event.error?.message) {
            setError(event.error.message);
          }
          break;
```

Add `onUserTranscriptLostCallback` to the `handleServerEvent` dependency array (line 1020 block) — insert it among the callbacks (e.g., right after `finalizeTranscript,` on line 1028):

```typescript
      finalizeTranscript,
      onUserTranscriptLostCallback,
```

- [ ] **Step 5: Run the hook tests to verify they pass**

Run: `cd frontend && npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: PASS (both new tests + all existing hook tests).

- [ ] **Step 6: Wire the workspace handler**

In `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx`, define the handler right after `persistRealtimeMessage` closes (after line 841), before the `useRealtimeChat({...})` call:

```typescript
  const handleUserTranscriptLost = () => {
    const persistenceTarget = realtimePersistenceTargetRef.current;
    if (!persistenceTarget) return;
    // Occupy this turn's slot so the marker sits in order like a real turn would.
    const sortOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;
    void queuePracticeEvent(
      persistenceTarget.practiceSessionId,
      'metric.voice_transcript_lost',
      sortOrder,
      { source: 'realtime' },
    ).catch(() => {
      // fail-soft: dropout telemetry must never disrupt the session
    });
  };
```

Wire it into the `useRealtimeChat({...})` options (line 856-861):

```typescript
  } = useRealtimeChat({
    onMessage: (role, content) => {
      void persistRealtimeMessage(role, content);
    },
    onUserTranscriptLost: handleUserTranscriptLost,
    sessionParams: realtimeSessionParams,
  });
```

- [ ] **Step 7: Verify the frontend still type-checks and the workspace test suite passes**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPracticeWorkspace.test.tsx && npx tsc -b`
Expected: PASS (workspace tests green) and `tsc -b` clean (no type errors from the new option/handler).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/useRealtimeChat.ts frontend/src/hooks/useRealtimeChat.test.tsx frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx
git commit -m "feat(teacher-fde): emit inert metric.voice_transcript_lost on ASR dropout (voice)"
```

---

## Task 5: Doc sync

**Files:**
- Modify: `backend/CLAUDE.md` (pedagogy module enumeration + import-boundary list + a flag-state sentence)
- Modify: `docs/school-integration/teacher-fde/TASKS.md`
- Modify: `docs/school-integration/teacher-fde/ROADMAP.md`
- Modify: `docs/school-integration/LIMITATIONS.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update `backend/CLAUDE.md`**

In the `pedagogy/` services bullet, add `voice_fidelity.py` to the module enumeration right after the `uptake.py` clause:

```
, `voice_fidelity.py` (stdlib-only Teacher FDE pure probe: `build_voice_fidelity(events, target_surfaces, *, fuzzy_threshold=0.85) -> dict` — internal instrument estimating the VOICE under-count of the realized/uptake signal: substring-miss via a `difflib` fuzzy pass vs. production's own exact-hit events + ASR `dropoutTurns` from `metric.voice_transcript_lost` markers + a per-turn `payload.source` voice/text modality split; no DB/OpenAI imports)
```

Add `voice_fidelity.py` to the **Import boundary** enumeration (the `plan.py`/…/`uptake.py` list):

```
/`uptake.py`/`voice_fidelity.py` import no OpenAI/Canvas/resolver
```

Add a flag-state sentence after the uptake-trace paragraph:

```
The **Teacher FDE voice fidelity gap** is gated by `PEDAGOGY_ENGINE_VOICE_FIDELITY` (**BUILT, cloudbuild default `'0'`, NOT cut over** — internal measurement instrument, backend-only). When on AND the alignment view on AND `?realized=1` AND sessions exist, the plan-preview route attaches `realized.voiceFidelity` (own nested fail-soft, counts only never content) estimating how much the realized/uptake signal under-counts voice production (substring-miss ceiling + ASR-dropout floor + voice/text modality split) via the pure `pedagogy/voice_fidelity.py`. The one emission-path change is the content-less `metric.voice_transcript_lost` marker (in `SUPPORTED_EVENT_TYPES`, inert to all aggregation), which ships live/unconditional so forward dropout data accumulates; the read surface stays flag-gated. Off ⇒ no `voiceFidelity` key, byte-identical. Spec/plan `docs/superpowers/{specs,plans}/2026-07-01-teacher-fde-voice-fidelity-gap*.md`. Rollback `--update-env-vars PEDAGOGY_ENGINE_VOICE_FIDELITY=0`.
```

- [ ] **Step 2: Update `docs/school-integration/teacher-fde/TASKS.md`**

Under `## Phase 1 — Observability`, replace the fast-follow line `- [ ] Fast-follow: modality split of the realized signal (voice vs. text).` with:

```markdown
- [-] Fast-follow: modality split of the realized signal (voice vs. text). **Gated on a voice-fidelity measurement first** (below).
- [x] **Voice fidelity gap measurement BUILT (behind `PEDAGOGY_ENGINE_VOICE_FIDELITY`, default off) 2026-07-01** — internal backend-only instrument that estimates how much the realized/uptake signal under-counts VOICE production before we build the teacher-facing split: pure `pedagogy/voice_fidelity.py` (substring-miss ceiling via a `difflib` fuzzy pass vs. production's own exact hits + ASR-dropout floor from the new inert `metric.voice_transcript_lost` marker + a per-turn `payload.source` voice/text split) attached as `realized.voiceFidelity` (own nested fail-soft, counts only). Motivated by the design-partner reality that production is mostly VOICE, where the exact matcher runs on lossy ASR text. Spec/plan `docs/superpowers/{specs,plans}/2026-07-01-teacher-fde-voice-fidelity-gap*.md`. **Not cut over** — flip only to read a number (test class first, via the voice harness); real prod read needs an explicit go (privacy).
```

- [ ] **Step 3: Update `docs/school-integration/teacher-fde/ROADMAP.md`**

Add a decision-log row (in the `## Decision log` table, after the uptake-trace row):

```markdown
| 2026-07-01 | **Voice fidelity gap measurement BUILT** (behind `PEDAGOGY_ENGINE_VOICE_FIDELITY`, default off), gating the modality split. Since production is mostly VOICE and the hit detector runs on lossy ASR text, a naive voice-vs-text split would be an unfair comparison. This internal instrument estimates the under-count (substring-miss ceiling + ASR-dropout floor + voice/text attribution) so we decide the fidelity fix with a number. Backend-only; first read on the test class via the voice harness; real prod read needs an explicit go. | Measure before we build (and before we show teachers) — a biased modality signal would poison the evidence flywheel on the exact variable (modality) we're trying to generate evidence on. |
```

- [ ] **Step 4: Add a `LIMITATIONS.md` entry**

In `docs/school-integration/LIMITATIONS.md`, append a new lettered entry (the current last entry is `(vv)`, so this is `(ww)`; match the file's existing indentation for these entries):

```markdown
    **(ww) The realized/uptake signal structurally under-counts VOICE production.** The target-hit detector is a normalized substring match run on ASR transcripts; spoken turns lose production two ways a typed turn does not — (1) ASR dropout (a failed transcription persists no `student.turn`, so zero hits) and (2) substring-miss (ASR spelling/boundary drift the exact matcher can't catch). Because real practice skews voice, the alignment view + uptake trace under-represent the dominant modality. Quantified (not yet corrected) by the internal `PEDAGOGY_ENGINE_VOICE_FIDELITY` instrument (2026-07-01): `substringMissEstimate` (a fuzzy-vs-exact ceiling) + `dropoutTurns` (a forward-looking floor from the `metric.voice_transcript_lost` marker). The teacher-facing modality split is deliberately gated on this measurement; the fidelity fix (fuzzy matching / dropout recovery) is a downstream decision.
```

- [ ] **Step 5: Verify docs reference real artifacts + commit**

Run: `ls docs/superpowers/specs/2026-07-01-teacher-fde-voice-fidelity-gap-design.md docs/superpowers/plans/2026-07-01-teacher-fde-voice-fidelity-gap.md && grep -c PEDAGOGY_ENGINE_VOICE_FIDELITY cloudbuild.yaml backend/CLAUDE.md`
Expected: both files listed; `cloudbuild.yaml` count ≥ 2 and `backend/CLAUDE.md` count ≥ 1.

```bash
git add backend/CLAUDE.md docs/school-integration/teacher-fde/TASKS.md docs/school-integration/teacher-fde/ROADMAP.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(teacher-fde): sync voice-fidelity gap measurement (built behind flag, inert)"
```

---

## Notes for the executor

- **Full backend suite before finishing:** `make test-backend` (expect all green; baseline was 1595+ before this work).
- **Full frontend suite:** `cd frontend && npm run test -- --run` (one pre-existing flaky test — `AppChatPage.avatar.test.tsx` — is unrelated to this change; confirm it fails identically on the base commit before attributing anything).
- **Do NOT deploy or flip the flag as part of this plan.** Shipping is a separate, explicit step: deploy inert → flip `PEDAGOGY_ENGINE_VOICE_FIDELITY=1` only to read → generate voice turns in the test class via the voice harness → read `realized.voiceFidelity` via the route. Real prod read waits for an explicit go (privacy).
- **REPLACE-safety:** before any prod build, confirm every `cloudbuild.yaml` substitution default matches live env (`gcloud run services describe lingual-app --region us-central1`), per the standing rule.
```

