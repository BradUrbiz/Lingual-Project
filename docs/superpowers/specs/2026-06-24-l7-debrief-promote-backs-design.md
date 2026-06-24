# L7 Debrief — Surface S3.3 Promote-Backs (shape `promotions`) — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** Shape the debrief's existing raw `promotions` pass-through into a teacher-facing section and render it as a "Targeted corrections" card — surfacing the S3.3 promote-back layer (the engine drilling a learner's recurring error back into the conversation for self-repair).
**Why now:** The L7 debrief now surfaces coach-review (S3.1) and re-steers (S5, just shipped), but **S3.3 promote-backs remain invisible to the teacher**: `build_session_debrief` passes `analysis_state['promotions']` through *raw* (`promotions: unknown[]`, never rendered), and that raw form even includes the internal `prompt` coach-note text — the exact internal field the re-steers shaper was careful to omit. This is the direct, logged follow-up from the re-steers slice's spec (§6) and the last unsurfaced engine intervention layer.

---

## 0. TL;DR

`analysis_state['promotions']` (S3.3) records each promote-back as `{turn_index, signature, reason, prompt, generated_at}` (`reason` ∈ `"repeat"|"hard_target"`; `signature` is either a `focus_grammar:<label>` for hard-target grammar or an expression/vocab surface / normalized corrected form). The debrief currently emits this **raw** and the frontend ignores it. Shape it — exactly as the re-steers slice shaped `resteers` — into `promotions: {count, items:[{turnIndex, reason, target}]}` (omitting the internal `prompt`/`generated_at`; `target` = signature with the `focus_grammar:` prefix stripped). Render a "Targeted corrections" card (sibling to "Coaching interventions"), self-hiding at count 0. Additive within `PEDAGOGY_ENGINE_DEBRIEF` — no new flag, no new store, no live-path touch, total/no-raise.

---

## 1. Scope

### In scope
1. **`backend/services/pedagogy/debrief.py`** — a `_promotions(analysis_state)` helper replacing the raw `"promotions": _l(analysis_state.get("promotions"))` pass-through with `{count: int, items: [{turnIndex, reason, target}]}`. Total/no-raise + the existing `_l`/`_i` coercion. Omits internal `prompt`/`generated_at`. `target` = signature with a leading `focus_grammar:` (or any `<type>:` prefix on a grammar signature) stripped for teacher display.
2. **Frontend** `TeacherSessionDebriefPage.tsx` (+ the `SessionDebrief.promotions` type in `teacher.ts`, changing from `unknown[]` to the shaped object) — render a "Targeted corrections" card: count + per-promotion rows in plain language keyed on `reason`. Hidden when count is 0.
3. **Docs** — `backend/CLAUDE.md` (debrief now shapes promotions), `LIMITATIONS.md` (update (aa): promotions now shaped+rendered, raw internal `prompt` no longer surfaced), pedagogy memory.

### Non-goals
- **No unified "interventions" section.** Promote-backs (learner-error drilling) and re-steers (tutor-adherence) are distinct diagnostic signals; they stay as two focused, self-hiding sibling cards. Merging them is explicitly NOT done (it conflates two concepts and would rework the just-shipped re-steers card). The spec's earlier "and/or unify" note resolves to the "shape promotions" arm.
- **No change to `directorReSteers`** (the re-steers slice's output) or any other section.
- **No new flag / store / live-path touch.** Additive within `PEDAGOGY_ENGINE_DEBRIEF`; pure presenter over existing `analysis_state['promotions']`.
- **No raw coach-note text.** The internal `prompt` (the promote instruction handed to the tutor) is engine-internal; the debrief surfaces the *fact + reason + target*, consistent with the re-steers shaper and the debrief's counts-not-content posture. (Shaping `promotions` thus also removes the current raw-`prompt` exposure — a consistency fix, not a privacy breach since the teacher owns the assignment.)

---

## 2. Architecture

`build_session_debrief` (total, no-raise) gains one section helper, mirroring `_director_resteers`:

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
            "reason": str(p.get("reason") or ""),   # "repeat" | "hard_target"
            "target": target,
        })
    return {"count": len(items), "items": items}
```

The returned dict's `"promotions"` key changes from `_l(analysis_state.get("promotions"))` (raw) to `_promotions(analysis_state)` (shaped). `count: 0`/`items: []` when there are no promotions (the common case while the S3.3 flag is off — the card renders nothing).

**Target extraction.** `error_signature` (promote_back.py) returns either the chip's `target` surface (which for grammar is `focus_grammar:<label>`) or a normalized corrected form. The `reason` is `"hard_target"` exactly when the signature starts with `focus_grammar:`. So stripping that one prefix yields a teacher-readable target for grammar, and passes other signatures through unchanged. (Only `focus_grammar:` is stripped; other signatures have no type prefix.)

---

## 3. Frontend

- `frontend/src/api/teacher.ts`: change `promotions: unknown[]` to `promotions?: { count: number; items: { turnIndex: number | null; reason: string; target: string }[] }`.
- `TeacherSessionDebriefPage.tsx`: a `PromotionsCard` ("Targeted corrections") rendering only when `promotions?.count > 0`. Mirrors the `DirectorReSteersCard` structure (SectionCard + icon + per-row list + a humanized reason Badge). Each row in plain language keyed on `reason`:
  - `hard_target` → "Drilled «{target}» (focus grammar)"
  - `repeat` → "Drilled «{target}» (recurring error)"
  - other/empty → "Drilled «{target}»"
  - + a muted "(turn {turnIndex})" when turnIndex != null.
- Honest framing subtitle: "Recurring errors the engine wove back into the conversation for self-repair."
- Reason Badge humanized like the re-steers `kindLabel`: `hard_target` → "Grammar", `repeat` → "Recurring", else "Promoted".
- Placed immediately after `DirectorReSteersCard` (the two intervention cards sit together). Self-hides at count 0 → page unchanged for sessions with no promote-backs (i.e. all sessions while the S3.3 flag is off).

---

## 4. Error handling, success criteria, testing

**Error handling.** Pure presenter extension inside the existing total/no-raise `build_session_debrief`; `_l`/`_i`/`str(... or "")` coercion guards malformed records; non-dict records skipped. No new I/O. Frontend renders nothing when count is 0 or the field is absent (older debriefs).

**Success criteria.**
- A session whose `analysis_state['promotions']` has 2 records (one `focus_grammar:subjunctive` hard_target, one `ser vs estar` repeat) → debrief `promotions: {count: 2, items: [{turnIndex, reason:"hard_target", target:"subjunctive"}, {turnIndex, reason:"repeat", target:"ser vs estar"}]}`; the page renders a 2-row "Targeted corrections" card.
- A session with no promotions → `promotions: {count: 0, items: []}`; the card is not rendered.
- The internal `prompt`/`generated_at` are NOT in the debrief output (verify in the existing help≠evidence repr-scan style).
- `directorReSteers` and all other debrief sections unchanged.

**Testing.**
- `backend/tests/test_pedagogy_engine_s4.py`: `build_session_debrief` with a `promotions` list of mixed valid/invalid records → correct `{count, items}` shape, `focus_grammar:` prefix stripped, internal fields omitted, malformed skipped; with no `promotions` key → `{count: 0, items: []}`. (Note: the existing `_full_record` fixture sets `promotions: [{"signature": "ser vs estar", "turn_index": 4}]` but no test currently asserts its shape — add an assertion that it now shapes to `{count:1, items:[{turnIndex:4, reason:"", target:"ser vs estar"}]}`.)
- Frontend: the page renders the "Targeted corrections" card with both reasons' plain-language rows; renders nothing when count 0; existing debrief tests unchanged.

---

## 5. Files

| File | Change |
|---|---|
| `backend/services/pedagogy/debrief.py` | `_promotions` helper + shape the `promotions` key (was raw) |
| `backend/tests/test_pedagogy_engine_s4.py` | promotions shaping tests (+ assert `_full_record` shapes) |
| `frontend/src/api/teacher.ts` | `promotions` type `unknown[]` → shaped object |
| `frontend/src/pages/TeacherSessionDebriefPage.tsx` | `PromotionsCard` "Targeted corrections" (+ test) |
| docs | `backend/CLAUDE.md`, `LIMITATIONS.md` (aa), pedagogy memory |

---

## 6. Follow-ups (logged)
- **Unified "interventions" view** remains a possible future refinement (one section grouping coach-review + promote-backs + re-steers chronologically) — deliberately NOT done; two focused cards is the clearer teacher UX and the simpler change. Revisit only if real teacher feedback shows the split is confusing.
- **Assignment-level debrief roll-up** (S4.2b) — aggregate per-session debriefs (incl. intervention/promotion counts) to the assignment level.
