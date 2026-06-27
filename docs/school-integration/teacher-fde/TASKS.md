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
- [-] **Design-partner intake**: level = **HS advanced / pre-AP Spanish**. Still open: identity, current authoring pain, schedule a real session to observe.
- [ ] Co-validate `DESIGN_LANGUAGE.md` with the design partner; reshape v0 from their mental model.
- [-] Archetypes (§C): v0 ship-first set drafted + **first worked example grounded in the partner's real L1 unit**. Confirm full set vs research + design-partner sign-off.
- [x] Ingested the design partner's real curriculum via the Canvas PAT (read-only) → `DESIGN_PARTNER_CURRICULUM.md` (Polón, VHL Imagina / AP-track); grounded the first §C worked example. — 2026-06-27
- [ ] Phase 0 exit: design-partner-validated v0, concrete enough to drive Phase 1.

## Phase 1 — Observability (intended → realized) — IN PROGRESS

- [x] Brainstormed the surface + headline metric → **Task–Target Alignment View** (extend the plan-preview into an intended→realized arc). Spec: `docs/superpowers/specs/2026-06-27-teacher-fde-alignment-view-design.md`. — 2026-06-27
- [x] Wrote the implementation plan: `docs/superpowers/plans/2026-06-27-teacher-fde-alignment-view.md` (4 TDD tasks: pure join → realized aggregator → route+flag+cloudbuild → frontend). — 2026-06-27
- [x] Built behind `PEDAGOGY_ENGINE_ALIGNMENT_VIEW` (default OFF) via subagent-driven dev — pure `pedagogy/alignment.py` + `practice_analytics.build_assignment_realized_input` + plan-preview route `?realized=1` + `AssignmentPlanPreview` realized column / never-elicited callout + analytics mount + i18n. 4 tasks each spec+quality reviewed; whole-branch review caught + fixed a no-sessions guard gap. backend 1660 OK, frontend green. Range `cd7dd8d..4672096`. — 2026-06-27
- [ ] Deploy inert → cut over (`--update-env-vars PEDAGOGY_ENGINE_ALIGNMENT_VIEW=1`) → runtime-verify with the test teacher on an assignment WITH sessions AND one WITHOUT (proves the no-sessions guard). **At cutover:** add LIMITATIONS entry (grammar/obj realized = honest "not yet measurable") + `backend/CLAUDE.md` alignment.py + flag-state line.
- [ ] Fast-follow: modality split of the realized signal (voice vs. text).

## Phase 2 — Guided authoring — LATER

- [ ] (Scoped after Phase 1.) Plain-language intent → engine-ready structured input, composed from §B/§C.

## Woven — Literacy

- [ ] Exemplar / archetype library (§C) teachers can clone and learn from.
- [ ] In-context authoring guidance + the observability view as a teaching mirror.
