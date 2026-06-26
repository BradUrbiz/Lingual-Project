# Teacher FDE — Roadmap

Status: Active — Phase 0 (framework) in progress
Last updated: 2026-06-27
Owner: Product + Engineering

## Phasing

The keystone is the design language; the three surfaces fall out of it. Build order is deliberately
**framework → observability → authoring**, with literacy woven through rather than built standalone.

### Phase 0 — Conversational Learning Design Language (keystone) — IN PROGRESS

Establish the lean v0 framework that all three surfaces draw from. See `DESIGN_LANGUAGE.md`.

Three research streams feed it:
- **External theory** — TBLT, focus-on-form, output/interaction hypothesis, comprehensible input,
  chatbot-mediated SLA. Output: a cited synthesis (lands in / links from `../../Pedagogy Research/`).
- **Engine-lever map** — each input field → engine behavior → learning mechanism → degradation-when-thin.
  Strong draft already exists (engine-lever audit, 2026-06-26); to be formalized into `DESIGN_LANGUAGE.md` §B/§E.
- **Teacher reality** — how a real design-partner teacher actually thinks about designing speaking
  practice; validates and reshapes the v0.

Exit: design-partner-validated v0 of the design language, concrete enough to drive Phase 1.

### Phase 1 — Observability (intended → realized) — NEXT

The cheapest surface and the one that *also* delivers literacy (teachers learn the medium by watching
their design play out). Build the "intended vs realized" view: which targets the conversation actually
elicited, where it drifted, how the teacher's input became tutor behavior. Grounds and evolves the
framework against real sessions with the design partner.

Exit: a teacher can look at a run and understand the gap between what they designed and what happened.

### Phase 2 — Guided authoring (input nearly free) — LATER

With framework + observability in hand, build the guided authoring flow: plain-language intent →
engine-ready structured input, composed from the design language's variables and patterns, with the
consequences of each choice made legible (and ideally previewed via the observability lens).

Exit: a teacher authors a strong, task–target-aligned assignment with low effort and clear *why*.

### Woven throughout — Literacy

Not a standalone phase. Delivered as: (a) in-context guidance during authoring, (b) the observability
view as a teaching mirror, (c) an **exemplar / archetype library** (the design patterns from
`DESIGN_LANGUAGE.md` §C) teachers can clone and learn from.

## Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-27 | The three asks (authoring / observability / literacy) are **one keystone** — a Conversational Learning Design Language — surfaced three ways. | They share a spine (task–target alignment) and the same source-of-truth doc; building them independently would dig the same ground three times. |
| 2026-06-27 | **Spine = Framework → Observability.** Lean v0 framework, then observability first, evolve framework from real sessions. | FDE/lean: fastest learning loop, framework grounded in real sessions not a vacuum; observability is cheapest and doubles as literacy. |
| 2026-06-27 | **Co-design with a real design-partner teacher** (available / soon). | Makes the FDE posture literal; de-risks designing in a vacuum. |
| 2026-06-27 | Track the whole initiative as a named program, **"Teacher FDE,"** under `docs/school-integration/teacher-fde/`, on the existing house style. | Multi-phase, research-heavy work needs a durable tracked home; reuse the proven school-integration doc convention, no new doc system. |

## Open questions

- [ ] **A–E framework validation.** Does the `DESIGN_LANGUAGE.md` v0 skeleton (variables list,
  patterns, quality model) match the team's and the design partner's mental model? Anything missing
  or mis-weighted in §B's variable set?
- [ ] **External research go.** Fire the parallel `/deep-research` SLA-grounding stream now? (Scoped
  question drafted; token-heavy, awaiting go/no-go + wording.)
- [ ] **Design partner specifics.** Who, which language/level, what's their current authoring pain,
  when can we observe a real session?
- [ ] **Observability surface shape (Phase 1).** Where does it live (extend the existing teacher
  debrief / plan-preview, or a new surface?) and what's the minimum first cut? — Deferred to Phase 1
  brainstorm.
