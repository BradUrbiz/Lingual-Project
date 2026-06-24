# L7 Debrief — Surface S3.3 Promote-Backs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shape the debrief's raw `promotions` pass-through into a teacher-facing section and render it as a "Targeted corrections" card — surfacing the S3.3 promote-back layer (the engine drilling a learner's recurring/hard-target error back in for self-repair).

**Architecture:** A pure presenter change to `build_session_debrief` (a `_promotions` helper that replaces the raw `promotions` pass-through with a shaped `{count, items:[{turnIndex, reason, target}]}`), plus a "Targeted corrections" card mirroring the just-shipped "Coaching interventions" (re-steers) card. Additive within the existing `PEDAGOGY_ENGINE_DEBRIEF` flag — no new flag, no new store, no live-path touch.

**Tech Stack:** Python 3 / Flask (`unittest`), React 19 + TypeScript + Vitest.

## Global Constraints

- **No new flag / store / live-path touch.** Additive within `PEDAGOGY_ENGINE_DEBRIEF`; pure presenter over existing `analysis_state['promotions']`.
- **`build_session_debrief` stays total/no-raise.** Use the module's existing `_l`/`_i` coercion helpers; `str(... or "")` for strings. Malformed (non-dict) records skipped, never raise.
- **Shaped, internal fields omitted.** Emit `{turnIndex, reason, target}` per promotion — NOT the internal `prompt`/`generated_at`/`signature` (raw). `target` = signature with a leading `focus_grammar:` prefix stripped; `reason` ∈ `"repeat"|"hard_target"` passed through.
- **`directorReSteers` and every other debrief section stay untouched.**
- **`count: 0` / `items: []` when there are no promotions** → the frontend card renders nothing → debrief page unchanged for those sessions (all sessions while the S3.3 flag is off).
- **No unified interventions section** — promote-backs render as a focused "Targeted corrections" card, sibling to (not merged with) the re-steers card.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main`; do not auto-branch.

---

### Task 1: Backend — shape `promotions` in `build_session_debrief`

**Files:**
- Modify: `backend/services/pedagogy/debrief.py`
- Test: `backend/tests/test_pedagogy_engine_s4.py`

**Interfaces:**
- Consumes: `analysis_state['promotions']` (S3.3; records `{turn_index, signature, reason, prompt, generated_at}` where `reason` ∈ `"repeat"|"hard_target"` and `signature` is `focus_grammar:<label>` for hard-target grammar or an expression/vocab surface otherwise).
- Produces: `build_session_debrief(...)` output's `"promotions"` key changes from a raw list to `{count: int, items: [{turnIndex, reason, target}]}`.

- [ ] **Step 1: Write the failing test**

Append a new test class to `backend/tests/test_pedagogy_engine_s4.py` (use the inline `from backend.services.pedagogy.debrief import build_session_debrief` pattern the other debrief tests use):

```python
class DebriefPromotionsTests(unittest.TestCase):
    def _debrief(self, analysis_state):
        return build_session_debrief({"id": "s1", "status": "ended", "analysis_state": analysis_state,
                                      "session_summary": {}})

    def test_promotions_shaped_strips_grammar_prefix_and_omits_internal(self):
        d = self._debrief({"promotions": [
            {"turn_index": 5, "signature": "focus_grammar:subjunctive", "reason": "hard_target",
             "prompt": "Work the subjunctive back in ...", "generated_at": "T"},
            {"turn_index": 8, "signature": "ser vs estar", "reason": "repeat",
             "prompt": "Bring ser/estar back ...", "generated_at": "T"},
        ]})
        p = d["promotions"]
        self.assertEqual(p["count"], 2)
        self.assertEqual(p["items"][0], {"turnIndex": 5, "reason": "hard_target", "target": "subjunctive"})
        self.assertEqual(p["items"][1], {"turnIndex": 8, "reason": "repeat", "target": "ser vs estar"})
        # internal fields must NOT leak
        self.assertNotIn("prompt", p["items"][0])
        self.assertNotIn("generated_at", p["items"][0])
        self.assertNotIn("signature", p["items"][0])

    def test_no_promotions_is_empty(self):
        self.assertEqual(self._debrief({})["promotions"], {"count": 0, "items": []})

    def test_malformed_promotions_skipped(self):
        d = self._debrief({"promotions": ["nope", {"turn_index": 2, "signature": "la cuenta", "reason": "repeat"}, 7]})
        self.assertEqual(d["promotions"]["count"], 1)
        self.assertEqual(d["promotions"]["items"][0]["target"], "la cuenta")

    def test_full_record_fixture_now_shaped(self):
        # the existing BuildSessionDebriefTestCase fixture sets promotions:[{"signature":"ser vs estar","turn_index":4}]
        d = self._debrief({"promotions": [{"signature": "ser vs estar", "turn_index": 4}]})
        self.assertEqual(d["promotions"], {"count": 1, "items": [{"turnIndex": 4, "reason": "", "target": "ser vs estar"}]})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s4.DebriefPromotionsTests -v`
Expected: FAIL — the current `promotions` is a raw list, so `d["promotions"]["count"]` raises `TypeError` (list indices) / assertions mismatch.

- [ ] **Step 3: Implement**

In `backend/services/pedagogy/debrief.py`, add the helper near `_director_resteers`:

```python
def _promotions(analysis_state: dict) -> dict:
    """S3.3 promote-backs surfaced for the teacher: count + shaped items.
    The engine wove a learner's recurring/hard-target error back into the
    conversation for self-repair. Omits the internal prompt/generated_at —
    the teacher sees what was drilled (reason + target), not the coach-note."""
    items = []
    for p in _l(analysis_state.get("promotions")):
        if not isinstance(p, dict):
            continue
        sig = str(p.get("signature") or "")
        target = sig.split(":", 1)[1] if sig.startswith("focus_grammar:") else sig
        items.append({
            "turnIndex": _i(p.get("turn_index")),
            "reason": str(p.get("reason") or ""),
            "target": target,
        })
    return {"count": len(items), "items": items}
```

Change the `promotions` key in `build_session_debrief`'s returned dict from:

```python
        "promotions": _l(analysis_state.get("promotions")),
```

to:

```python
        "promotions": _promotions(analysis_state),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s4 -v`
Expected: PASS (new promotions cases + all existing debrief tests, including the `directorReSteers` tests from the prior slice).

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/debrief.py backend/tests/test_pedagogy_engine_s4.py
git commit -m "feat(pedagogy-l7): shape S3.3 promote-backs in the session debrief"
```

---

### Task 2: Frontend — "Targeted corrections" debrief card

**Files:**
- Modify: `frontend/src/api/teacher.ts` (change `promotions` type)
- Modify: `frontend/src/pages/TeacherSessionDebriefPage.tsx` (add `PromotionsCard` + render it)
- Test: `frontend/src/pages/TeacherSessionDebriefPage.test.tsx`

**Interfaces:**
- Consumes: the debrief's `promotions` field, now `{count, items:[{turnIndex, reason, target}]}` (Task 1).
- Produces: a "Targeted corrections" card; renders nothing when `count` is 0 / field absent.

- [ ] **Step 1: Change the type**

In `frontend/src/api/teacher.ts`, in the `SessionDebrief` interface, replace the line `promotions: unknown[];` with:

```typescript
  promotions?: {
    count: number;
    items: { turnIndex: number | null; reason: string; target: string }[];
  };
```

> Check whether anything else in the frontend reads `SessionDebrief.promotions` (grep `\.promotions`). Per the spec it is currently unrendered, so nothing should break — but if a reference exists, it must tolerate the new optional object shape. Note for the implementer: the page test fixture `FULL_DEBRIEF` currently sets `promotions: []` (a raw list) — update that fixture value to the new shape `{ count: 0, items: [] }` so existing tests typecheck and still pass.

- [ ] **Step 2: Write the failing test**

In `frontend/src/pages/TeacherSessionDebriefPage.test.tsx`, add cases mirroring the re-steers tests added in the prior slice:
- with `promotions: { count: 2, items: [{turnIndex:5,reason:'hard_target',target:'subjunctive'},{turnIndex:8,reason:'repeat',target:'ser vs estar'}] }` → the page shows a "Targeted corrections" heading and text matching `/subjunctive/` and `/ser vs estar/`.
- with `promotions: { count: 0, items: [] }` → no "Targeted corrections" heading.

Build the fixtures by spreading the existing `FULL_DEBRIEF` (as the re-steers tests do) and overriding `promotions`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/TeacherSessionDebriefPage.test.tsx`
Expected: FAIL — no "Targeted corrections" card exists yet.

- [ ] **Step 4: Implement the card + render it**

In `frontend/src/pages/TeacherSessionDebriefPage.tsx`, add a card component mirroring `DirectorReSteersCard` (same `SectionCard` + `Badge` structure; pick an imported lucide icon — add `Repeat` to the `lucide-react` import block and use `icon={Repeat}`):

```tsx
function PromotionsCard({ promotions }: { promotions: SessionDebrief['promotions'] }) {
  if (!promotions || promotions.count === 0) return null;
  const label = (reason: string, target: string) => {
    if (reason === 'hard_target') return `Drilled “${target}” (focus grammar)`;
    if (reason === 'repeat') return `Drilled “${target}” (recurring error)`;
    return `Drilled “${target}”`;
  };
  const reasonLabel = (reason: string) => {
    if (reason === 'hard_target') return 'Grammar';
    if (reason === 'repeat') return 'Recurring';
    return 'Promoted';
  };
  return (
    <SectionCard title="Targeted corrections" icon={Repeat} accent="bg-accent/20 text-accent-foreground">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Recurring errors the engine wove back into the conversation for self-repair.
        </p>
        <ul className="space-y-1.5">
          {promotions.items.map((p, i) => (
            <li key={`${p.turnIndex}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="flex-1 text-sm text-foreground">
                {label(p.reason, p.target)}
                {p.turnIndex != null ? (
                  <span className="ml-1 text-muted-foreground">(turn {p.turnIndex})</span>
                ) : null}
              </p>
              <Badge variant="secondary" size="sm">{reasonLabel(p.reason)}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
```

Render `<PromotionsCard promotions={debrief.promotions} />` immediately AFTER `<DirectorReSteersCard reSteers={debrief.directorReSteers} />` (the two intervention cards sit together). It self-hides at count 0, so placement is safe regardless of flag state.

- [ ] **Step 5: Run tests + build**

Run: `cd frontend && npm run test -- --run src/pages/TeacherSessionDebriefPage.test.tsx`
Expected: PASS
Run: `cd frontend && npm run build`
Expected: `tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/teacher.ts frontend/src/pages/TeacherSessionDebriefPage.tsx frontend/src/pages/TeacherSessionDebriefPage.test.tsx
git commit -m "feat(pedagogy-l7): Targeted corrections (promote-back) card in the teacher debrief page"
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

- `backend/CLAUDE.md`: in the `debrief.py` description (where the `directorReSteers` note was just added), note the debrief now also shapes `promotions` via `_promotions` (S3.3 promote-backs: count + `{turnIndex, reason, target}`, `focus_grammar:` prefix stripped, internal `prompt`/`generated_at` omitted — no longer a raw pass-through).
- `docs/school-integration/LIMITATIONS.md`: update entry (aa) — it currently says `promotions[]` is a raw pass-through the frontend does not render. Replace that clause: the L7 debrief now **shapes and renders** promotions (a "Targeted corrections" card), and the raw internal `prompt` is no longer surfaced. The unified-interventions section remains the only deferred item.

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(pedagogy-l7): debrief shapes + renders S3.3 promote-backs (Targeted corrections)"
```

---

## Self-Review

**1. Spec coverage:**
- `_promotions` helper + shape the `promotions` key (strip `focus_grammar:`, omit internal fields) → Task 1 ✓
- total/no-raise + coercion + malformed-skip → Task 1 code + tests ✓
- frontend type change + "Targeted corrections" card + render (hidden when count 0) → Task 2 ✓
- `count:0`/`items:[]` when none → Task 1 code + Task 2 null-render ✓
- `directorReSteers` untouched → not modified in any task ✓
- docs → Task 3 ✓
- Non-goals (no flag/store, no unified section, no raw prompt) → Global Constraints ✓

**2. Placeholder scan:** No TBD/TODO. Backend helper + tests are complete code; the frontend card is complete; the prose-directed steps (locate the `FULL_DEBRIEF` fixture, update its `promotions` value, grep for other `.promotions` readers) are explicit about what and where.

**3. Type consistency:** `promotions: {count, items:[{turnIndex, reason, target}]}` identical in Task 1 (backend output), Task 2 (TS type + tests). `turnIndex: number | null` (TS) matches `_i(...)` (backend). `reason` values `"repeat"|"hard_target"` match `promote_back.py` and drive the card's `label()`/`reasonLabel()` branches. Internal fields (`prompt`/`generated_at`/raw `signature`) omitted consistently. Mirrors the just-shipped `directorReSteers`/`DirectorReSteersCard` shape exactly.
