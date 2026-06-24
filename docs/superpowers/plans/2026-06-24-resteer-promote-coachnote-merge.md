# Re-Steer + Promote-Back Same-Turn Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an S3.3 promote-back and an S5 re-steer both fire on the same turn, deliver BOTH to the tutor as one merged coach-note — closing the LIMITATIONS (nn) last-writer-wins clobber (text) / double-inject (voice).

**Architecture:** A frontend-only change to `triggerCoachChip` in `AssignmentPracticeWorkspace.tsx`: replace the two independent delivery `if` blocks with a collect-then-deliver-once step. Backend unchanged (it already returns `coachChip.promote_prompt` and `resteer.resteer_prompt` separately; the single-slot collapse is purely a frontend artifact).

**Tech Stack:** React 19 + TypeScript + Vitest.

## Global Constraints

- **Frontend-only.** No backend change; the backend `[:500]` `coachNote` cap (chat.py) is unchanged.
- **Merge, not drop.** Both signals delivered. Dropping one would desync the backend's already-recorded `promotions[]`/`promote_back_state` (and the debrief's "Targeted corrections" card) from what the learner received.
- **Order:** re-steer prompt first, promote-back prompt second; joined with a single space.
- **Single-fire and zero-fire turns stay byte-equivalent** to today (only the rare both-fire turn changes).
- **Preserve** the existing `setCoachChips` append and the `try/catch` fail-open in `triggerCoachChip`.
- **No change** to `injectPromoteBack` / the realtime queue path — call it once with the merged string instead of twice.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main`; do not auto-branch.

---

### Task 1: Merge same-turn deliveries in `triggerCoachChip`

**Files:**
- Modify: `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` (lines ~776-802, `triggerCoachChip`)
- Test: `frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx`

**Interfaces:**
- Consumes: `postCoachChip(...) → { chip: CoachChip | null, resteer: Resteer | null }` where `CoachChip` has optional `promote: boolean`, `promote_prompt?: string`, `surface` and `Resteer` has `resteer: true`, `resteer_prompt: string`, `surface`.
- Produces: at most one delivery per turn — `injectPromoteBackRef.current?.(merged)` (voice) or `pendingPromoteBackRef.current = merged` (text).

- [ ] **Step 1: Write the failing test**

In `AssignmentPracticeWorkspace.test.tsx`, add a both-fire test. Mirror the existing single-fire tests (the text-promote test at ~875 sets `pendingPromoteBackRef` then asserts the next send's `coachNote`; the resteer test at ~966 is the same shape; the voice-promote test at ~822 asserts `injectPromoteBackSpy`). Use the existing harness helpers/fixtures (`postCoachChipMock`, `injectPromoteBackSpy`, the text/voice session fixtures, the send helper).

Add TWO assertions:

```typescript
  it('merges a same-turn promote + resteer into ONE text coachNote (no clobber)', async () => {
    // text-modality session; postCoachChip returns BOTH a promote chip and a resteer
    // First send: triggerCoachChip sees both → merges into pendingPromoteBackRef
    postCoachChipMock.mockResolvedValue({
      chip: { /* ...text promote chip fixture... */ promote: true, promote_prompt: 'PROMOTE: try voy', surface: 'text', turn_index: 2 },
      resteer: { surface: 'text', resteer: true, resteer_prompt: 'RESTEER: speak Spanish' },
    });
    // ...drive first send (triggers triggerCoachChip)...
    // Second send: the merged coachNote is attached and contains BOTH prompts
    postCoachChipMock.mockResolvedValue({ chip: null, resteer: null });
    // ...drive second send, capture lastOpts...
    expect(lastOpts?.coachNote).toContain('RESTEER: speak Spanish');
    expect(lastOpts?.coachNote).toContain('PROMOTE: try voy');
  });

  it('merges a same-turn promote + resteer into ONE voice injectPromoteBack call', async () => {
    // voice-modality session; postCoachChip returns BOTH
    postCoachChipMock.mockResolvedValue({
      chip: { /* ...voice promote chip fixture... */ promote: true, promote_prompt: 'PROMOTE: try voy', surface: 'voice', turn_index: 2 },
      resteer: { surface: 'voice', resteer: true, resteer_prompt: 'RESTEER: speak Spanish' },
    });
    // ...drive a learner turn + assistant turn to trigger triggerCoachChip...
    expect(injectPromoteBackSpy).toHaveBeenCalledTimes(1);
    const arg = injectPromoteBackSpy.mock.calls[0][0];
    expect(arg).toContain('RESTEER: speak Spanish');
    expect(arg).toContain('PROMOTE: try voy');
  });
```

> Implementer: build the chip/session fixtures by copying the EXISTING single-fire tests in this file (voice-promote ~822, text-promote ~875) — reuse their session fixtures, their send-driving helper, and their `lastOpts` capture pattern verbatim; only the `postCoachChipMock` return (both chip+resteer) and the assertions differ. Match the file's existing chip fixture shape (it includes the fields the chip-append needs, e.g. `turn_index`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPracticeWorkspace.test.tsx`
Expected: the voice test FAILS (`injectPromoteBackSpy` called 2×, not 1×) and the text test FAILS (`coachNote` contains only the resteer prompt — the promote prompt was clobbered).

- [ ] **Step 3: Implement the merge**

In `triggerCoachChip` (`AssignmentPracticeWorkspace.tsx`), replace the two delivery blocks (the `if (chip.promote && chip.promote_prompt) {...}` inside the `if (chip)` block AND the separate `if (resteer && resteer.resteer_prompt) {...}` block) with collect-then-deliver-once.

Keep the `setCoachChips` append. The chip-append stays inside `if (chip) {...}`; REMOVE only the promote-delivery `if` from inside it. After the `if (chip)` block, add:

```typescript
      // Merge a same-turn re-steer + promote-back into ONE delivery so neither is
      // clobbered (text single-slot) or double-injected (voice). Re-steer first
      // (more fundamental "get back on task/language"), promote-back second.
      const notes: string[] = [];
      let surface: 'voice' | 'text' = 'text';
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

The resulting `triggerCoachChip` body:
```typescript
    try {
      const { chip, resteer } = await postCoachChip(sessionId, learnerTurnIndex);
      if (chip) {
        setCoachChips((prev) => (prev.some((c) => c.turn_index === chip.turn_index) ? prev : [...prev, chip]));
      }
      // ...the merge block above...
    } catch {
      // fail-open: a missing/failed chip/resteer or injection never disrupts the session
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPracticeWorkspace.test.tsx`
Expected: PASS — the new both-fire tests AND all existing coach-chip tests (voice promote, text promote, resteer, merge-hydration) green.

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: `tsc -b && vite build` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx frontend/src/components/assignments/AssignmentPracticeWorkspace.test.tsx
git commit -m "fix(pedagogy): merge same-turn re-steer + promote-back into one coach-note (close LIMITATIONS nn)"
```

---

### Task 2: Full-suite verification + doc-sync

**Files:**
- Modify: `docs/school-integration/LIMITATIONS.md` (nn)
- (verify) frontend suite (backend untouched, but run it to confirm no incidental breakage)

- [ ] **Step 1: Run the frontend suite**

Run: `cd frontend && npm run test -- --run`
Expected: PASS

- [ ] **Step 2: Docs**

- `docs/school-integration/LIMITATIONS.md` (nn): the entry currently says re-steer + promote-back share the single `coachNote` per turn → last-writer-wins, "a proper merge strategy is deferred." Update it: the same-turn collision is now resolved — `triggerCoachChip` MERGES both prompts into one delivery (re-steer first, promote-back second; one `coachNote` for text / one `injectPromoteBack` for voice). The only-remaining bound is merged-note truncation against the backend `[:500]` cap (rare; re-steer-first preserves the fundamental signal).

- [ ] **Step 3: Commit**

```bash
git add docs/school-integration/LIMITATIONS.md
git commit -m "docs(pedagogy): LIMITATIONS (nn) — same-turn re-steer/promote-back now merged, not clobbered"
```

---

## Self-Review

**1. Spec coverage:**
- collect-then-deliver-once merge (re-steer first) → Task 1 ✓
- both-fire text + voice tests + single-fire unchanged → Task 1 Step 1/4 ✓
- preserve `setCoachChips` + `try/catch` fail-open → Task 1 Step 3 (explicit) ✓
- docs (nn) → Task 2 ✓
- Non-goals (no backend change, no drop, no flag, no injectPromoteBack change) → Global Constraints ✓

**2. Placeholder scan:** The test fixtures in Step 1 are sketched with `/* ... */` for the chip/session boilerplate because the implementer MUST copy the exact existing single-fire fixtures in the same file (reproducing them blindly here risks drift from the real fixture shape) — Step 1's note makes that explicit (copy from tests at ~822/~875, change only the mock return + assertions). The merge implementation (Step 3) is complete, literal code.

**3. Type consistency:** `notes: string[]`, `surface: 'voice' | 'text'`, `merged = notes.join(' ')`. `injectPromoteBackRef.current?.(merged)` matches the existing `injectPromoteBackRef` signature `(prompt: string) => void`; `pendingPromoteBackRef.current = merged` matches `useRef<string | null>`. `chip?.promote`/`chip.promote_prompt`/`chip.surface` and `resteer.resteer_prompt`/`resteer.surface` match the `CoachChip`/`Resteer` types in `api/coachChips.ts`.
