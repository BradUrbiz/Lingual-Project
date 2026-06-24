# Re-Steer + Promote-Back Same-Turn Merge (close LIMITATIONS (nn)) — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** When an S3.3 promote-back and an S5 Director re-steer both fire on the same turn, deliver BOTH to the tutor as one merged coach-note instead of letting the second silently clobber the first.
**Why now:** LIMITATIONS **(nn)** documents a real deferred bug: text re-steer + promote-back share the single `pendingPromoteBackRef`/`coachNote` slot per turn, so on a both-fire turn the second write wins and the first intervention is silently lost. On voice, the two fire as two back-to-back `injectPromoteBack` calls (two queued system notes + two response triggers). This is a latent correctness gap that matters **more** as cutover approaches (S3.3 + S5 both live). It also creates a **state/delivery mismatch**: the backend has already recorded the promote-back in `promote_back_state` + `promotions[]` (and the teacher debrief now renders it as a "Targeted correction"), so a dropped delivery means the debrief claims an intervention the learner never received.

---

## 0. TL;DR

In `AssignmentPracticeWorkspace.tsx` `triggerCoachChip`, the promote-back and re-steer deliveries are two independent `if` blocks, each writing the same single delivery slot (`pendingPromoteBackRef` for text, `injectPromoteBack` for voice). Replace them with one collection-then-deliver step: gather the prompts that fired (re-steer first as the more fundamental "get back on task/language" signal, then promote-back), and deliver them **once** as a single merged note per surface — text sets `pendingPromoteBackRef` to the joined string; voice calls `injectPromoteBack` once with the joined string. No clobber, no double-flush, no signal lost, and backend-recorded interventions all actually reach the tutor. Frontend-only; backend unchanged (it already returns `coachChip.promote_prompt` and `resteer.resteer_prompt` separately — the collapse to one slot is purely a frontend delivery artifact).

---

## 1. Scope

### In scope
1. **`frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx`** — rewrite the two delivery `if` blocks in `triggerCoachChip` (currently lines ~783-798) into: collect fired prompts into an ordered list + a resolved surface, then deliver once. Order: re-steer prompt first, promote-back prompt second. Join with a single space. Voice → one `injectPromoteBackRef.current?.(merged)`; text → `pendingPromoteBackRef.current = merged`. Preserve the existing chip-append (`setCoachChips`) and the fail-open `try/catch`.
2. **Test** `AssignmentPracticeWorkspace.test.tsx` — add a both-fire case (chip.promote + resteer in the same `postCoachChip` response) asserting a SINGLE merged delivery containing BOTH prompts (text: one `coachNote` on the next send containing both; voice: one `injectPromoteBack` call with both). Keep/verify the existing single-fire tests (voice promote, text promote, resteer) still pass unchanged.
3. **Docs** — `LIMITATIONS.md` (nn) (merge strategy implemented), pedagogy memory.

### Non-goals
- **No backend change.** The coach-chip route correctly returns both `coachChip` (with `promote_prompt`) and `resteer` (with `resteer_prompt`); the merge is a frontend delivery concern. The backend `[:500]` `coachNote` cap (chat.py) is unchanged.
- **No priority-drop.** Dropping one signal would desync the backend's recorded `promotions[]`/`promote_back_state` (already updated) from what the learner received, and would make the debrief's "Targeted corrections" card claim an undelivered intervention. Merge preserves consistency.
- **No new flag / store.** Behavior change is confined to the rare both-fire turn; single-fire and zero-fire turns are byte-equivalent to today.
- **No change to `injectPromoteBack` / the realtime queue path** — we call it once with a merged string instead of twice.

---

## 2. Architecture

`triggerCoachChip` (after the `postCoachChip` round-trip), replacing the two independent deliver blocks:

```typescript
      const notes: string[] = [];
      let surface: 'voice' | 'text' = 'text';
      // Re-steer first (the more fundamental "get back on task/language" signal),
      // promote-back second. Both delivered so neither the backend-recorded
      // promotion nor the re-steer is silently dropped on a both-fire turn.
      if (resteer && resteer.resteer_prompt) {
        notes.push(resteer.resteer_prompt);
        if (resteer.surface === 'voice') surface = 'voice';
      }
      if (chip?.promote && chip.promote_prompt) {
        notes.push(chip.promote_prompt);
        if (chip.surface === 'voice') surface = 'voice';
      }
      if (notes.length > 0) {
        const merged = notes.join(' ');
        if (surface === 'voice') {
          injectPromoteBackRef.current?.(merged);
        } else {
          pendingPromoteBackRef.current = merged;
        }
      }
```

(The `setCoachChips` append for the chip stays where it is, before this block; the surrounding `try/catch` fail-open is unchanged.)

**Why re-steer first.** A re-steer means the tutor isn't doing its basic job (off-target / off-language); a promote-back is a refinement (drill a recurring learner error) layered on a functioning conversation. Ordering re-steer first reads naturally as one instruction and, if the backend `[:500]` cap truncates an unusually long merged note, preserves the more fundamental signal. Single-fire turns produce exactly the prior single-prompt delivery (order is irrelevant when only one fires).

**Surface resolution.** `chip.surface` and `resteer.surface` both derive from the session surface and will agree in practice; resolving `surface = 'voice'` if EITHER says voice is a defensive belt-and-suspenders that cannot misroute (they never disagree).

---

## 3. Error handling, success criteria, testing

**Error handling.** Confined to `triggerCoachChip`'s existing `try/catch` fail-open (a failed inject/round-trip never disrupts the session). No new I/O. The merged text note is still subject to the backend `[:500]` cap (documented bound — both-fire is rare and each prompt is short; the re-steer-first order keeps the fundamental signal under truncation).

**Success criteria.**
- Both fire (text): one `coachNote` on the next send containing BOTH the resteer and promote prompts (joined), not just one.
- Both fire (voice): exactly ONE `injectPromoteBack` call, with the merged string containing both prompts.
- Only promote fires: unchanged (single prompt delivered, voice inject / text pending).
- Only re-steer fires: unchanged.
- Neither fires: no delivery.

**Testing.**
- `AssignmentPracticeWorkspace.test.tsx`: NEW both-fire test (text surface: assert the next send's `coachNote` contains both prompt substrings; voice surface: assert one `injectPromoteBack` call whose arg contains both). Existing single-fire tests (voice promote line ~822, text promote ~875, resteer ~966) must remain green unchanged.

---

## 4. Files

| File | Change |
|---|---|
| `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` | merge fired prompts → single delivery in `triggerCoachChip` |
| `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx` | both-fire merge test (+ verify single-fire unchanged) |
| docs | `LIMITATIONS.md` (nn), pedagogy memory |

---

## 5. Follow-ups (logged)
- **Per-kind cooldown budget** (LIMITATIONS (mm)) — language-drift re-steer is arguably more urgent than target-neglect and could warrant its own budget separate from the shared `DIRECTOR_COOLDOWN_TURNS`/`DIRECTOR_MAX_RESTEERS`. Separate refinement.
- **Merged-note truncation** — if a both-fire merged text note exceeds the backend `[:500]` cap, the promote-back (second) is truncated. Bounded (both-fire is rare, prompts are short); revisit only if observed in real sessions.
