# L7 Debrief — Surface S5 Director Re-Steers — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** Add a `directorReSteers` section to the S4.2 teacher debrief so it reflects the S5 Director's runtime interventions (the engine catching the tutor drifting off-target / off-language and re-steering).
**Why now:** The L7 debrief (`build_session_debrief`, S4.2) was built *before* S5. It surfaces S3.3 `promotions` but is **blind to S5 `resteers`** — the teacher's after-session evidence surface does not reflect the engine's newest runtime layer. This is the same class of gap L8 closed (a layer's output not reaching its intended surface): a genuine cross-slice completeness gap, a named follow-up (LIMITATIONS (aa) flagged `promotions[]`/intervention-log consumption).

---

## 0. TL;DR

`analysis_state['resteers']` (S5) records each Director intervention `{turn_index, kind, target, reason, prompt, surface, generated_at}`. The debrief should surface this as a teacher-facing **`directorReSteers`** section: a count + a per-intervention list `{turnIndex, kind, target, reason}` (omitting the internal `prompt` text — the teacher needs *what the engine did*, not the raw coach-note, mirroring how `helpUsage` omits ask text). Shaped (unlike `promotions`' raw pass-through) so the teacher sees, e.g., "the AI re-steered 2× this session: 1 language-drift → Korean, 1 target-neglect → «la cuenta»." Rendered as a section in the existing `TeacherSessionDebriefPage`. Additive within the existing `PEDAGOGY_ENGINE_DEBRIEF` flag — no new flag, no new store, pure presenter extension, total/no-raise (the debrief's existing contract).

---

## 1. Scope

### In scope
1. **`backend/services/pedagogy/debrief.py`** — a `_director_resteers(analysis_state)` helper + a `directorReSteers` key in `build_session_debrief`'s output: `{count: int, items: [{turnIndex, kind, target, reason}]}`. Total/no-raise + the existing `_l`/`_d`/`_i` coercion discipline. Omits the internal `prompt`/`surface`/`generated_at` (teacher sees the intervention, not the raw note).
2. **Frontend** `TeacherSessionDebriefPage.tsx` (+ the `SessionDebrief` type in `teacher.ts`) — render a "Coaching interventions" section: the count + per-intervention rows (kind in plain language: "kept the tutor in {target}" / "steered back to «{target}»"). Hidden/empty when there are none.
3. **Docs** — `backend/CLAUDE.md` (debrief now surfaces director re-steers), `LIMITATIONS.md` (update the debrief entry / (aa)), pedagogy memory.

### Non-goals
- **No change to `promotions`.** It stays a raw pass-through (the frontend already consumes it); shaping it is a separate follow-up. (A future unified "interventions" section could merge promotions + re-steers — out of scope here to avoid a contract change.)
- **No new flag / store / live-path touch.** Additive within `PEDAGOGY_ENGINE_DEBRIEF`; pure presenter over existing `analysis_state`.
- **No raw coach-note text.** The internal `prompt` (the re-steer instruction handed to the tutor) is engine-internal; the debrief surfaces the *fact + kind + target* of the intervention, not the prompt (consistent with the debrief's HELP≠EVIDENCE / counts-not-content posture).

---

## 2. Architecture

`build_session_debrief` (total, no-raise) gains one section, mirroring the shape discipline of `_uptake`/`_help_usage`:

```python
def _director_resteers(analysis_state: dict) -> dict:
    raw = _l(analysis_state.get("resteers"))
    items = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        items.append({
            "turnIndex": _i(r.get("turn_index")),
            "kind": str(r.get("kind") or ""),          # "target_neglect" | "language_drift"
            "target": str(r.get("target") or ""),
            "reason": str(r.get("reason") or ""),
        })
    return {"count": len(items), "items": items}
```

Added to the returned dict as `"directorReSteers": _director_resteers(analysis_state)`. `count: 0`/`items: []` when there are no re-steers (the common case while the Director flag is off — the section renders nothing).

**Why shaped (not a raw pass-through like `promotions`):** the raw `resteers` records carry the internal `prompt`/`surface`/`generated_at`; the teacher surface should show the intervention's *meaning* (count, kind, target), not the engine-internal coach-note. Shaping also lets the frontend render plain-language rows without parsing internal fields.

---

## 3. Frontend

- `frontend/src/api/teacher.ts`: extend the `SessionDebrief` type with `directorReSteers?: { count: number; items: { turnIndex: number | null; kind: string; target: string; reason: string }[] }`.
- `TeacherSessionDebriefPage.tsx`: a "Coaching interventions" section that renders only when `directorReSteers?.count > 0`. Each row in plain language keyed on `kind`:
  - `language_drift` → "Kept the tutor speaking {target}" (target = the language name, e.g. "Korean").
  - `target_neglect` → "Steered the conversation back to «{target}»".
  - other/unknown kind → a generic "Re-steered the tutor ({target})".
- Honest framing: "Moments the AI coach corrected the tutor mid-conversation." Section hidden when count is 0 (so the page is unchanged for sessions with no re-steers — i.e., all sessions while the Director flag is off).

---

## 4. Error handling, success criteria, testing

**Error handling.** Pure presenter extension inside the existing total/no-raise `build_session_debrief`; `_l`/`_i`/`str(... or "")` coercion guards malformed records. No new I/O. The debrief endpoint's flag gate + fail-soft are unchanged. Frontend renders nothing when count is 0 or the field is absent (older debriefs).

**Success criteria.**
- A session whose `analysis_state['resteers']` has 2 records → debrief `directorReSteers: {count: 2, items: [{turnIndex, kind, target, reason} ×2]}`; the page renders a 2-row "Coaching interventions" section with plain-language rows.
- A session with no re-steers → `directorReSteers: {count: 0, items: []}`; the section is not rendered.
- The `prompt`/`surface`/`generated_at` internal fields are NOT in the debrief output.
- All existing debrief fields/tests unchanged.

**Testing.**
- `backend/tests/...debrief...`: `build_session_debrief` with a `resteers` list of mixed valid/invalid records → correct `{count, items}` shape, internal fields omitted, malformed records skipped; with no `resteers` key → `{count: 0, items: []}`; existing debrief assertions still pass.
- Frontend: the page renders the interventions section with both kinds' plain-language rows; renders nothing when count 0.

---

## 5. Files

| File | Change |
|---|---|
| `backend/services/pedagogy/debrief.py` | `_director_resteers` helper + `directorReSteers` key in `build_session_debrief` |
| `backend/tests/<debrief test>` | re-steer shaping tests (find the existing debrief test; add cases) |
| `frontend/src/api/teacher.ts` | extend `SessionDebrief` with `directorReSteers` |
| `frontend/src/pages/TeacherSessionDebriefPage.tsx` | "Coaching interventions" section (+ test) |
| docs | `backend/CLAUDE.md`, `LIMITATIONS.md`, pedagogy memory |

---

## 6. Follow-ups (logged)
- **Shape `promotions` too** (currently a raw pass-through) and/or merge promotions + re-steers into a unified "interventions" section — a coherent L7 refinement, deferred to avoid changing the existing `promotions` frontend contract here.
- **Assignment-level debrief roll-up** (S4.2b) — aggregate per-session debriefs (incl. intervention counts) to the assignment level for the teacher.
