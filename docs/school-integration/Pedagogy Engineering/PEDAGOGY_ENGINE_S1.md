# Pedagogy Engine — S1 (Thin Spine) Detailed Design

**Date:** 2026-06-02
**Status:** Buildable design, pre-code. Scope narrowed by the codex review in `PEDAGOGY_ENGINE.md` §0.1.
**Parent:** `PEDAGOGY_ENGINE.md` (the six-layer target architecture). This doc is *only* Slice 1.
**Grounded against:** `backend/services/assignment_resolver.py` (policies `:49-72`, builders `:1413-1632`, custom_prompt early-return `:1594`), `backend/routes/chat.py` (`:489` assignment realtime, `:506` free realtime, `:856`/`:862` text), `main.py` (`build_system_prompt` `:337`).

---

## 1. The one sentence
Introduce `backend/services/pedagogy/` with a thin `compile_prompt_plan(bootstrap) -> PromptPlan` and `render_assignment_prompt(plan, surface) -> str`, re-house **only the assignment prompt path** over it with **proven zero regression**, and ship **one** behavior win — grammar-target slips escalate to elicitation per `feedbackPolicy.mode` instead of waiting for the flat repeat threshold.

That's it. No free-practice change, no learner model, no Conversation Sidecar / coach track, no coverage tracking, no renderer registry.

---

## 2. Goals / non-goals

**Goals (S1 ships these):**
1. A reborn, content+surface-agnostic `pedagogy/` module that survives the §1.3 lesson (enforced import rules below).
2. `PromptPlan` — the thin intermediate the assignment prompt is re-expressed over.
3. `render_assignment_prompt(plan, surface)` producing prompts **byte-equivalent** to today's `build_assignment_system_prompt` output, *except* the one intended behavior change.
4. The behavior win: target-type-aware correction routing (grammar → prompt-first) wired through the existing policy dicts.
5. L8 minimal hook: the compiled plan is inspectable as the teacher preview (reuse `systemPromptPreview`).
6. Snapshot regression tests + a feature flag for safe rollout.

**Non-goals (explicitly deferred — do not build in S1):**
- ❌ Free-practice path (`build_system_prompt`) — untouched. Fast-follow, not S1.
- ❌ `CompiledConstraints` full model, `rubric`, `evidence_plan`, `allowances` — S2+.
- ❌ `task_family` derivation, pretask/task/posttask phases — S2+.
- ❌ Learner model, WTC/anxiety, coverage/evidence reader — S2/S4.
- ❌ Conversation Sidecar / coach track, Feedback / Ask side-panel UX, `session.update`, pluggable renderer registry — S3.
- ❌ Affect-based routing override (needs a signal we don't capture) — S4.

If a PR for S1 touches `main.py:build_system_prompt` or adds a second renderer plugin, it has left scope.

---

## 3. Module layout

```
backend/services/pedagogy/
  __init__.py            # exports compile_prompt_plan, render_assignment_prompt, PromptPlan
  plan.py                # PromptPlan dataclass + compile_prompt_plan(bootstrap)
  routing.py             # target-type → feedback_route mapping (the behavior win)
  render/
    __init__.py
    assignment_prompt.py # render_assignment_prompt(plan, surface); the SPINE/TARGETS/STANCE/TEMPLATE writers move here
```

**Enforced import rules (invariant 7a — checkable in review/CI):**
- `pedagogy/plan.py` and `pedagogy/routing.py` import **no** OpenAI client, **no** Canvas/resolver content code. Inputs arrive as plain fields.
- Only `pedagogy/render/` knows about surface/model quirks (voice ordering, lean wording). It still emits a **string**, not an API payload — no OpenAI SDK import even here in S1.
- The policy-normalization helpers currently inlined in `assignment_resolver.py:49-230` (`default_feedback_policy`, `normalize_*`, `serialize_*`) **move into** `pedagogy/` (they're pedagogy, not resolver). The resolver imports them back for any non-prompt use, inverting today's coupling.

---

## 4. `PromptPlan` (the data model)

Design notation. Deliberately small — every field maps to something the renderer already consumes.

```
PromptPlan:
  targets:          [ Target ]
  feedback_policy:  FeedbackPolicy     # the existing dict (resolver.py:49-56), unchanged shape
  scaffold_policy:  ScaffoldPolicy      # existing (resolver.py:59-64)
  output_policy:    OutputPolicy        # existing (resolver.py:67-72)
  task_type:        str                 # existing enum; NOT yet task_family
  task_context:     { scenario, success_criteria[], teacher_notes, class_name, title }
  render_notes:     { is_voice_surface: bool }   # only surface hint S1 needs

Target:
  surface:          str                 # the expression / word / grammar form
  kind:             {expression, vocabulary, grammar_rule, objective}
  feedback_route:   {prompt_first, recast_first}   # derived in routing.py — the behavior win
```

`compile_prompt_plan(bootstrap)` reads the already-resolved `bootstrap` dict that `build_assignment_system_prompt` receives today (so the call site barely changes), and maps:
- `assignment.target_expressions[]` → `Target(kind=expression, feedback_route=recast_first)`
- `assignment.target_vocabulary[]` → `Target(kind=vocabulary, feedback_route=recast_first)`
- `assignment.focus_grammar[]` → `Target(kind=grammar_rule, feedback_route=prompt_first)` ← the win
- `assignment.objectives[]` → `Target(kind=objective, ...)`
- feedback/scaffold/output policies → passed through unchanged (default_* if absent)
- `generated_scenario`, `success_criteria`, `teacher_notes`, class/title → `task_context`
- surface (from caller) → `render_notes.is_voice_surface`

---

## 5. The behavior win — target-type-aware routing

This is the *only* intended output change vs. today. Specified precisely so the snapshot test can assert it and nothing else moves.

**Today** (`_build_tutor_stance`, resolver.py:1498-1587): the correction-ladder text is driven by `recast_default: True` + a flat `elicitation_repeat_threshold: 3` — *the same* for every target, grammar or vocabulary. A grammar slip waits for 3 repeats before eliciting.

**S1** (`routing.py`): the renderer emits a per-target-type correction directive:
- grammar-rule targets (`focus_grammar`) → **prompt/elicit on first slip** (`feedback_route=prompt_first`), because prompts beat recasts for rule-based grammar (Lyster). Under `mode=accuracy_first`, this is reinforced; under `mode=fluency_first`, soften to "elicit on the second slip, never mid-breakdown."
- expression/vocabulary targets → **recast or brief model** (`recast_first`) — unchanged from today's flow-friendly default.

`recast_default: True` **stays** the global base. The routing is a refinement *on top*, not a flip. No stored policy changes; no migration of existing assignments' data.

**Concretely, the TUTOR STANCE section gains one routed line per target class** instead of one flat correction-ladder paragraph. Everything else in the prompt is identical.

---

## 6. `render_assignment_prompt(plan, surface)`

The existing section writers (`_build_assignment_spine` :1413, `_build_assignment_targets` :1439, `_build_teacher_guidance` :1479, `_build_tutor_stance` :1498, `build_task_template_prompt`) **move** into `render/assignment_prompt.py`, re-typed to read from `PromptPlan` instead of poking the raw `bootstrap`. Assembly order is preserved exactly (SPINE → TARGETS → TEACHER GUIDANCE → TUTOR STANCE → TASK TEMPLATE).

**`surface` parameter** (S1 use is minimal): `surface="voice"` vs `"text"`. In S1 the only surface-dependent behavior is **critical-rules-last ordering** and lean wording for voice (the realtime model's adherence is fragile). Text keeps current ordering. This is a function parameter, not a renderer plugin — the registry is S3.

**Future sidecar compatibility:** S1 does not build the Conversation Sidecar. It must still keep target kind, feedback route, scaffold/output policy, and task context explicit in `PromptPlan` so S3 can feed the sidecar's **Feedback** mode without reparsing prompt text. Learner-initiated **Ask** mode (quick help, replay, clarification, translation, hint) is also deferred; S1 should not add UI or runtime calls for it.

**`custom_prompt` / raw tutor mode:** `compile_prompt_plan` returns `None` for `task_type == "custom_prompt"`; the call site keeps today's early-return (`resolver.py:1594`) and the base prompt passes through. Engine off, no plan, exactly as now — just named honestly.

---

## 7. Integration & migration (strangler-fig, no big-bang)

The risk codex named: S1 "replaces both live tutor entry points." Mitigation — migrate **one** path, behind a flag, proven equivalent:

1. **Build** `pedagogy/` alongside the existing builder. Don't delete `build_assignment_system_prompt` yet.
2. **Flag** `PEDAGOGY_ENGINE_ASSIGNMENT_RENDER` (env, default off). When off → today's builder. When on → `render_assignment_prompt(compile_prompt_plan(bootstrap), surface)`.
3. **Call sites** (assignment only): `chat.py:489` (realtime) and `chat.py:856` (text). Free-practice sites (`:506`, `:862`) are **not touched**.
4. **Equivalence gate** (the safety net): a snapshot test renders both paths for a corpus of real-shaped assignments and asserts they're **byte-identical except** the routed correction lines (§5). Flip the flag only after the diff is exactly the intended delta and nothing else.
5. **Burn-in then delete.** After the flag is on in prod and soaked, delete the old builder. (Mirrors the team's Postgres dual-write→cutover discipline.)

---

## 8. Test plan
- **Snapshot/regression:** both render paths byte-equal except the §5 delta, across assignments covering each `task_type`, with/without targets, with/without grammar, each `feedbackPolicy.mode`, voice + text surfaces.
- **Routing unit:** `focus_grammar` target → `prompt_first`; expression/vocab → `recast_first`; `mode=accuracy_first` reinforces; `fluency_first` softens; `recast_default` stays `True`; no stored-policy mutation.
- **Custom-prompt:** `compile_prompt_plan` returns `None`; base prompt passes through unchanged.
- **Surface:** voice render puts critical rules last; text unchanged.
- **Locale:** plan + render carry `{language_name}` / `learning_locale` through for every `ALLOWED_LEARNING_LOCALES` entry; no hard-coded language.
- **Import-boundary (invariant 7a):** a test asserts `pedagogy/plan.py` + `pedagogy/routing.py` import neither an OpenAI client nor Canvas/resolver content modules.
- Extend `backend/tests/test_pedagogy_prompting.py` (existing), `unittest`, per `make test-backend`.

---

## 9. L8 teacher-preview hook (minimal)
S1 doesn't build override UI. It does make the plan **inspectable**: `compile_prompt_plan` output (targets + each target's `feedback_route` + correction posture from `mode`) is serialized into the existing `systemPromptPreview` / `practice_sessions.system_prompt_preview` so the teacher-facing preview can later render "here's what the engine will elicit and how it'll correct each item." Wiring the field now means S4's override UI has data to bind to. No new endpoint in S1.

---

## 10. Definition of done — SHIPPED behind flag 2026-06-22 (not yet cut over)
- [x] `pedagogy/` module exists with enforced import boundaries — `test_pedagogy_engine_s1.ImportBoundaryTestCase` proves `plan.py`/`routing.py` import no OpenAI/Canvas/resolver, in a subprocess. **Scope note:** only the *policy-normalizer family* (§3's `:49-230`) physically moved into `policies.py`; the SPINE/TARGETS/GUIDANCE/TASK-TEMPLATE section writers still live in `assignment_resolver` and are imported by `render/` as pure functions (their relocation is a documented fast-follow — it doesn't affect the boundary, enforced via lazy `render` export in `__init__`).
- [x] Flag-gated assignment render path byte-equivalent to the old builder except the routed delta — frozen-golden **characterization** harness (13 fixtures) + old-vs-new **equivalence** suite; no-grammar fixtures are byte-identical, grammar fixtures differ only in the repair lines.
- [x] Grammar targets elicit-first per mode (`accuracy_first`/`balanced` → first slip, `fluency_first` → second slip); vocab/expression recast; `recast_default` unchanged; zero stored-data migration.
- [x] Free practice untouched (`build_system_prompt` not routed); `custom_prompt` passes through; locale-parametric (base prompt carried verbatim); import-boundary test green; `make test-backend` green (1246).
- [x] Plan **serializable** for the teacher preview — `serialize_plan_preview(plan)`. **Narrowed:** S1 ships the pure serializer only; persisting it into `practice_sessions.system_prompt_preview` + the override UI is S4 (LIMITATIONS #53f).
- [x] `PromptPlan` keeps target kind + feedback route + policies + task context explicit, so a later Sidecar Feedback mode needn't reparse prompt text; no Sidecar UI/runtime ships in S1.
- [x] **Added beyond spec:** voice surface relocates the tutor stance last ("critical-rules-last", §6) — a second intended delta on the voice path, tested by `SurfaceOrderingTestCase`. Lean-wording-for-voice deferred.
- [ ] **Cutover** (`PEDAGOGY_ENGINE_ASSIGNMENT_RENDER=1` in prod, burn-in, then delete the legacy builder) — NOT done; flag defaults off.

## 11. Doc-sync on completion — DONE 2026-06-22
- [x] `LIMITATIONS.md` #53 (Pedagogy Engine section): assignment-path-only; raw-tutor-mode no guarantees; target-type-aware not affect-aware; voice = stance-last; section-writer relocation + L8 persistence deferred.
- [x] `backend/CLAUDE.md`: `pedagogy/` line rewritten to describe the reborn engine + enforced boundary + flag.
- [x] `TASKS.md`: Pedagogy Engine section added — S1 done, cutover + fast-follows + S2–S5 + eval harness as open work.
- [x] `PEDAGOGY_ENGINE.md` §14: S1 row marked **✅ BUILT (behind flag, not cut over)** (full tick deferred until cutover).
