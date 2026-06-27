# Teacher FDE — Tasks

Status: Active — Phase 0
Last updated: 2026-06-27
Owner: Product + Engineering

## Status legend

- `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked / needs decision

## Phase 0 — Design Language (keystone)

- [x] Establish the program, decisions, and doc home (`CHARTER`, `ROADMAP`, `DESIGN_LANGUAGE`, `TASKS`). — 2026-06-27
- [x] Engine-lever audit: input field → engine behavior → degradation-when-thin (folded into `DESIGN_LANGUAGE.md` §B/§E). — 2026-06-26
- [x] **Validated the v0 framework skeleton** (`DESIGN_LANGUAGE.md` §A–§E) with the team — approved as the working framework (headline metric = task–target alignment gap). Design-partner validation pending. — 2026-06-27
- [x] **External SLA-grounding research** (`/deep-research`, Opus 4.8) — DONE 2026-06-27 (24 sources, 21 verified findings). Synthesis in `RESEARCH_SLA_GROUNDING.md`; folded into `DESIGN_LANGUAGE.md` §A/§B/§C. Headline: spine confirmed, corrective feedback = #1 lever, task difficulty refuted, 3 variables (language-mix/recycling/modality) flagged theory-derived.
- [ ] **Evidence-flywheel agenda**: design Phase 1 observability to probe the 3 evidence-thin variables (see ROADMAP "Research agenda") — turn real sessions into the SLA evidence the literature lacks.
- [-] **Design-partner intake**: level = **HS advanced / pre-AP Spanish**; identity = **Eduardo Polón**. **Co-validation session kit READY** (`PHASE0_SESSION_KIT.md`, 2026-06-28 — live 30–45 min format chosen: interview-first → live alignment-view demo → §A–§E co-validation → commit). Still open (human, in-the-loop): confirm the channel to Polón, schedule + run the session, capture his authoring pain.
- [ ] Co-validate `DESIGN_LANGUAGE.md` with the design partner; reshape v0 from their mental model. **Run from `PHASE0_SESSION_KIT.md`** — drives the 8 validation decisions (D1–D8) back into §A–§E, ROADMAP, and this file.
- [x] **Synthetic pre-validation 2026-06-28** (Polón unreachable for direct co-design): 3 adversarial personas grounded in his real Canvas (`PHASE0_SYNTHETIC_PREVALIDATION.md`). **Hypothesis-grade, NOT sign-off** — Phase 0 stays open. Spine (§A) + alignment-gap (§E) held under attack; convergent refutes surfaced (prose-extraction authoring, narrative ship-first, feedback=elicitation-vs-recast, elicitation-trace signal). Sharpened the session kit (§1.1).
- [ ] **Reshape candidates pending real sign-off** (from synthetic pre-validation — do NOT enact until the human confirms): Phase 2 = prose-extraction not field-composition · §C narrative→ship-first · §B/D4 feedback=elicitation-vs-recast · §E elicitation-trace signal · persona embedded-v0 · surface his taxonomy · alignment-view grade-backdoor guardrail.
- [-] Archetypes (§C): v0 ship-first set drafted + **first worked example grounded in the partner's real L1 unit**. Confirm full set vs research + design-partner sign-off.
- [x] Ingested the design partner's real curriculum via the Canvas PAT (read-only) → `DESIGN_PARTNER_CURRICULUM.md` (Polón, VHL Imagina / AP-track); grounded the first §C worked example. — 2026-06-27
- [ ] Phase 0 exit: design-partner-validated v0, concrete enough to drive Phase 1.

## Phase 1 — Observability (intended → realized) — IN PROGRESS

- [x] Brainstormed the surface + headline metric → **Task–Target Alignment View** (extend the plan-preview into an intended→realized arc). Spec: `docs/superpowers/specs/2026-06-27-teacher-fde-alignment-view-design.md`. — 2026-06-27
- [x] Wrote the implementation plan: `docs/superpowers/plans/2026-06-27-teacher-fde-alignment-view.md` (4 TDD tasks: pure join → realized aggregator → route+flag+cloudbuild → frontend). — 2026-06-27
- [x] Built behind `PEDAGOGY_ENGINE_ALIGNMENT_VIEW` (default OFF) via subagent-driven dev — pure `pedagogy/alignment.py` + `practice_analytics.build_assignment_realized_input` + plan-preview route `?realized=1` + `AssignmentPlanPreview` realized column / never-elicited callout + analytics mount + i18n. 4 tasks each spec+quality reviewed; whole-branch review caught + fixed a no-sessions guard gap. backend 1660 OK, frontend green. Range `cd7dd8d..4672096`. — 2026-06-27
- [x] **CUT OVER 2026-06-27** — deployed `93921b5` inert (rev 00091) → flipped `PEDAGOGY_ENGINE_ALIGNMENT_VIEW=1` (rev `00092-sgk`, 100% traffic) → cloudbuild default bumped `0→1` (durable, commit 52e56e8). `backend/CLAUDE.md` synced (module/import-boundary/flag-state). LIMITATIONS entry deemed redundant (lexical-only is the **intended** scope, already in spec + UI "not yet measurable"). **Runtime-verify status:** gcloud flag-live ✅ + serializer key (`student_uid`) code-verified ✅ + 3 route tests on the real handler ✅. Rollback `--update-env-vars PEDAGOGY_ENGINE_ALIGNMENT_VIEW=0`.
- [x] **Browser dogfood with REAL data 2026-06-28** — l1ngual.com teacher → Testing Class (es-ES) → "S3.1 burn-in - cafe scaffolded (text)" (4 sessions, 1 student). The view rendered **fully lit, not the empty state**: realized column populated (`Cuanto cuesta` 2·emerging·1/1, `Gracias` 2·emerging·1/1), the **never-elicited callout fired** (`Quisiera un cafe, por favor` / `el cafe` / `la galleta` — all `0·not_attempted·0/1`), and grammar/objective rows showed `designed · not yet measurable`. Cross-checked: realized hits match the independent "Target expressions" analytics aggregate exactly (`Cuanto cuesta: 2`, `Gracias: 2`) → the join is correct. `studentsElicited` showed `1/1`, confirming the studentCount serializer bug-class is genuinely retired at runtime (not just by code-read). Corrects the earlier "no sessions exist yet" assumption — burn-in sessions already populate the view. Console errors (400 / connection-closed) were pre-login auth artifacts, unrelated.
- [ ] Fast-follow: modality split of the realized signal (voice vs. text).

## Phase 2 — Guided authoring — LATER

- [x] **Prose-extraction spike DONE 2026-06-28** (`PHASE2_PROSE_EXTRACTION_SPIKE.md`) — validated the 3/3 synthetic finding on Polón's REAL prose with the real text-LLM pattern. **Hypothesis SUPPORTED:** lexical core (expressions/vocab/objectives/scenario/persona/success/modality) extracts faithfully + degrades to clarifying questions on thin input; the one boundary — `focus_grammar` — is fixed by pairing with a curriculum map (Imagina Lección→Estructuras) the prose already references. Pre-sign-off; validates engine feasibility, not end-to-end UX.
- [ ] (Scoped after Phase 1 + sign-off.) **Authoring = paste-prose → extract → confirm/correct** (NOT a variables form). Pair with a curriculum map; surface provenance (explicit=pre-confirmed, inferred=review); thin input → clarifying questions. Reusable extraction contract in the spike doc §"Phase 2 design implications".

## Woven — Literacy

- [ ] Exemplar / archetype library (§C) teachers can clone and learn from.
- [ ] In-context authoring guidance + the observability view as a teaching mirror.
