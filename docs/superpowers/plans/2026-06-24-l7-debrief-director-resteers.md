# L7 Debrief — Surface S5 Director Re-Steers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface S5 Director re-steers in the S4.2 teacher debrief — closing the cross-slice gap where the L7 evidence surface (built before S5) reflects S3.3 promote-backs but not the Director's runtime interventions.

**Architecture:** A pure presenter extension to `build_session_debrief` (a `_director_resteers` helper + a `directorReSteers` key) over the existing `analysis_state['resteers']`, plus a "Coaching interventions" card in the teacher debrief page. Additive within the existing `PEDAGOGY_ENGINE_DEBRIEF` flag — no new flag, no new store, no live-path touch.

**Tech Stack:** Python 3 / Flask (`unittest`), React 19 + TypeScript + Vitest.

## Global Constraints

- **No new flag / store / live-path touch.** Additive within `PEDAGOGY_ENGINE_DEBRIEF`; pure presenter over existing `analysis_state`.
- **`build_session_debrief` stays total/no-raise.** Use the module's existing `_l`/`_d`/`_i` coercion helpers; `str(... or "")` for strings. Malformed records are skipped, never raise.
- **Shaped, internal fields omitted.** The debrief emits `{turnIndex, kind, target, reason}` per re-steer — NOT the internal `prompt`/`surface`/`generated_at` (the teacher sees the intervention's meaning, not the engine coach-note — consistent with the debrief's counts-not-content posture).
- **`promotions` is untouched** (stays a raw pass-through; shaping it is a deferred follow-up).
- **`count: 0` / `items: []` when there are no re-steers** (the common case while the Director flag is off) → the frontend section renders nothing → debrief page unchanged for those sessions.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main`; do not auto-branch.

---

### Task 1: Backend — `directorReSteers` section in `build_session_debrief`

**Files:**
- Modify: `backend/services/pedagogy/debrief.py`
- Test: `backend/tests/test_pedagogy_engine_s4.py` (the debrief tests live here — append cases)

**Interfaces:**
- Consumes: `analysis_state['resteers']` (S5; records `{turn_index, kind, target, reason, prompt, surface, generated_at}`).
- Produces: `build_session_debrief(...)` output gains `"directorReSteers": {count: int, items: [{turnIndex, kind, target, reason}]}`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pedagogy_engine_s4.py` (use the file's existing import of `build_session_debrief`; if it imports via `from backend.services.pedagogy.debrief import build_session_debrief`, reuse that):

```python
class DebriefDirectorReSteersTests(unittest.TestCase):
    def _debrief(self, analysis_state):
        return build_session_debrief({"id": "s1", "status": "ended", "analysis_state": analysis_state,
                                      "session_summary": {}})

    def test_resteers_shaped_and_internal_fields_omitted(self):
        d = self._debrief({"resteers": [
            {"turn_index": 4, "kind": "language_drift", "target": "Korean", "reason": "mostly english",
             "prompt": "COACH NOTE ...", "surface": "voice", "generated_at": "T"},
            {"turn_index": 7, "kind": "target_neglect", "target": "la cuenta", "reason": "no target in window",
             "prompt": "COACH NOTE ...", "surface": "text", "generated_at": "T"},
        ]})
        rs = d["directorReSteers"]
        self.assertEqual(rs["count"], 2)
        self.assertEqual(rs["items"][0], {"turnIndex": 4, "kind": "language_drift", "target": "Korean", "reason": "mostly english"})
        self.assertEqual(rs["items"][1]["kind"], "target_neglect")
        # internal fields must NOT leak
        self.assertNotIn("prompt", rs["items"][0])
        self.assertNotIn("surface", rs["items"][0])
        self.assertNotIn("generated_at", rs["items"][0])

    def test_no_resteers_is_empty(self):
        d = self._debrief({})
        self.assertEqual(d["directorReSteers"], {"count": 0, "items": []})

    def test_malformed_resteers_skipped(self):
        d = self._debrief({"resteers": ["nope", {"turn_index": 2, "kind": "language_drift", "target": "Spanish", "reason": "r"}, 5]})
        self.assertEqual(d["directorReSteers"]["count"], 1)
        self.assertEqual(d["directorReSteers"]["items"][0]["target"], "Spanish")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s4.DebriefDirectorReSteersTests -v`
Expected: FAIL — `KeyError: 'directorReSteers'`.

- [ ] **Step 3: Implement**

In `backend/services/pedagogy/debrief.py`, add the helper near the other section helpers (e.g. after `_help_usage`):

```python
def _director_resteers(analysis_state: dict) -> dict:
    """S5 Director interventions surfaced for the teacher: count + shaped items.
    Omits the internal prompt/surface/generated_at — the teacher sees what the
    engine did (kind + target), not the raw coach-note."""
    items = []
    for r in _l(analysis_state.get("resteers")):
        if not isinstance(r, dict):
            continue
        items.append({
            "turnIndex": _i(r.get("turn_index")),
            "kind": str(r.get("kind") or ""),
            "target": str(r.get("target") or ""),
            "reason": str(r.get("reason") or ""),
        })
    return {"count": len(items), "items": items}
```

In `build_session_debrief`, add the key to the returned dict (next to `"promotions"`):

```python
        "directorReSteers": _director_resteers(analysis_state),
```

> Verify `_l` (list-coerce) and `_i` (int-coerce) are the existing helper names in this module (the spec + `_help_usage`/`_uptake` use them). If `_i` returns `None` for a missing/invalid int, that's fine — `turnIndex` is `int | None`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s4 -v`
Expected: PASS (new re-steer cases + all existing debrief tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/debrief.py backend/tests/test_pedagogy_engine_s4.py
git commit -m "feat(pedagogy-l7): surface S5 Director re-steers in the session debrief"
```

---

### Task 2: Frontend — "Coaching interventions" debrief card

**Files:**
- Modify: `frontend/src/api/teacher.ts` (extend `SessionDebrief`)
- Modify: `frontend/src/pages/TeacherSessionDebriefPage.tsx` (add `DirectorReSteersCard` + render it)
- Test: `frontend/src/pages/TeacherSessionDebriefPage.test.tsx`

**Interfaces:**
- Consumes: the debrief's `directorReSteers` field (Task 1).
- Produces: a card rendering the interventions; renders nothing when `count` is 0 / field absent.

- [ ] **Step 1: Write the failing test**

In `frontend/src/pages/TeacherSessionDebriefPage.test.tsx`, add a test that the page renders the interventions section when `directorReSteers.count > 0` and omits it when 0. Mirror the existing page-test harness (it already mocks `getSessionDebrief` and renders the page — find how it builds a debrief fixture and add `directorReSteers`). Assert:
- with `directorReSteers: { count: 2, items: [{turnIndex:4,kind:'language_drift',target:'Korean',reason:'r'},{turnIndex:7,kind:'target_neglect',target:'la cuenta',reason:'r'}] }` → the page shows text matching `/Korean/` and `/la cuenta/` under a "Coaching interventions" heading;
- with `directorReSteers: { count: 0, items: [] }` → no "Coaching interventions" heading.

> Implementer: copy the existing debrief fixture the page test uses and add the `directorReSteers` field; if the existing fixture omits new fields, ensure the type allows it (Task 2 Step 2 makes `directorReSteers` optional).

- [ ] **Step 2: Extend the type**

In `frontend/src/api/teacher.ts`, add to the `SessionDebrief` interface (after `promotions`):

```typescript
  directorReSteers?: {
    count: number;
    items: { turnIndex: number | null; kind: string; target: string; reason: string }[];
  };
```

- [ ] **Step 3: Implement the card + render it**

In `frontend/src/pages/TeacherSessionDebriefPage.tsx`, add a card component mirroring the existing `RepeatedErrorsCard`/`HelpUsageCard` pattern (use the same `Card`/`Section` + `Badge` primitives the page already imports):

```tsx
function DirectorReSteersCard({ reSteers }: { reSteers: SessionDebrief['directorReSteers'] }) {
  if (!reSteers || reSteers.count === 0) return null;
  const label = (kind: string, target: string) => {
    if (kind === 'language_drift') return `Kept the tutor speaking ${target || 'the target language'}`;
    if (kind === 'target_neglect') return `Steered back to “${target}”`;
    return `Re-steered the tutor${target ? ` (${target})` : ''}`;
  };
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">Coaching interventions</p>
      <p className="mb-2 text-sm text-muted-foreground">
        Moments the AI coach corrected the tutor mid-conversation.
      </p>
      <ul className="space-y-1">
        {reSteers.items.map((r, i) => (
          <li key={`${r.turnIndex}-${i}`} className="text-sm">
            {label(r.kind, r.target)}
            {r.turnIndex != null ? <span className="text-muted-foreground"> (turn {r.turnIndex})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Render `<DirectorReSteersCard reSteers={debrief.directorReSteers} />` in the page body next to the other section cards (e.g. after `RepeatedErrorsCard` / near `HelpUsageCard`), wrapped in whatever `Section`/`Card` container the sibling cards use — match the existing layout. (It returns null when empty, so placement is safe regardless of flag state.)

- [ ] **Step 4: Run tests + build**

Run: `cd frontend && npm run test -- --run src/pages/TeacherSessionDebriefPage.test.tsx`
Expected: PASS
Run: `cd frontend && npm run build`
Expected: `tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/teacher.ts frontend/src/pages/TeacherSessionDebriefPage.tsx frontend/src/pages/TeacherSessionDebriefPage.test.tsx
git commit -m "feat(pedagogy-l7): Coaching interventions section in the teacher debrief page"
```

---

### Task 3: Full-suite verification + doc-sync

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/school-integration/LIMITATIONS.md`
- (verify) backend + frontend suites

- [ ] **Step 1: Run both suites**

Run: `make test-backend`
Expected: PASS
Run: `cd frontend && npm run test -- --run`
Expected: PASS

- [ ] **Step 2: Docs**

- `backend/CLAUDE.md`: in the `debrief.py` description, note the debrief now also surfaces `directorReSteers` (S5 Director interventions: count + shaped `{turnIndex,kind,target,reason}`, internal prompt omitted).
- `docs/school-integration/LIMITATIONS.md`: update the S4.2 debrief entry / (jj) (or add a one-line note) recording that the debrief now reflects S5 Director re-steers; `promotions` remains a raw pass-through (shaping it / a unified interventions section is a deferred follow-up).

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(pedagogy-l7): debrief surfaces Director re-steers + deferred promotions-shaping note"
```

---

## Self-Review

**1. Spec coverage:**
- `_director_resteers` + `directorReSteers` key (shaped, internal fields omitted) → Task 1 ✓
- total/no-raise + coercion + malformed-skip → Task 1 code + tests ✓
- frontend type + card + render (hidden when count 0) → Task 2 ✓
- `count:0`/`items:[]` when none → Task 1 code + Task 2 null-render ✓
- `promotions` untouched → not modified in any task ✓
- docs → Task 3 ✓
- Non-goals (no flag/store, no promotions change, no raw prompt) → Global Constraints ✓

**2. Placeholder scan:** No TBD/TODO. Backend helper + tests are complete code; the frontend card is complete; the two prose-directed steps (locating the existing page-test fixture; matching the sibling-card container) are explicit about WHAT to add and WHERE, appropriate for editing large existing files.

**3. Type consistency:** `directorReSteers: {count, items: [{turnIndex, kind, target, reason}]}` identical in Task 1 (backend output), Task 2 (TS type), and the tests. `turnIndex: number | null` (TS) matches `_i(...)` returning `int | None` (backend). Internal fields (`prompt`/`surface`/`generated_at`) omitted consistently. `kind` values `"language_drift"`/`"target_neglect"` match `serialize_resteer`'s output + the card's `label()` branches.
