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
| 2026-06-27 | **Framework v0 (§A–§E) approved by the team** as the working skeleton; design-partner validation still pending. | Skeleton matches the team's mental model; concrete enough to drive Phase 0 grounding + Phase 1. |
| 2026-06-27 | **Design partner = high-school ADVANCED / pre-AP Spanish** (≈ ACTFL Intermediate-Mid → Advanced-Low). | Anchors §C archetypes, the research scope, and Phase 1 to a concrete learner level instead of generic SLA. |
| 2026-06-27 | **External SLA research fired** (`/deep-research`, Opus 4.8), scoped to pre-AP advanced Spanish + teacher-controllable variables. | §A grounding runs in parallel without blocking the first deployable surface. |
| 2026-06-27 | **Feedback policy is exposed to teachers** as a first-class design variable (not hidden behind a "rigor" macro). | Teachers should consciously own the accuracy↔fluency stance; it materially changes correction behavior. |
| 2026-06-27 | **Tutor persona / interlocutor role added** as a design variable (§B). | Who the AI plays drives register + which functions are elicited; first-class in the language even though it renders via scenario/instructions + the voice avatar today. |
| 2026-06-27 | **§C archetypes anchored to ACTFL interpersonal/presentational + AP Spanish themes**; beginner transaction de-emphasized. | Lingual's primary environment is pre-AP advanced Spanish / ACTFL curricula — start where it will actually be used. |
| 2026-06-27 | **Design-partner curriculum is directly readable via the class Canvas PAT** (in `.env`) — capability noted, ingestion deferred. | Lets us ground archetypes + worked examples in the partner's real AP/ACTFL units instead of invented scenarios, when we pick it up. |
| 2026-06-27 | **SLA research landed** (`RESEARCH_SLA_GROUNDING.md`): spine confirmed, **corrective feedback is the #1 evidenced lever**, task difficulty refuted as a grammar-forcer. Folded into `DESIGN_LANGUAGE.md` §A/§B/§C. | Anchors the framework in adversarially-verified evidence; sharpens which variables we trust vs. treat as hypotheses. |
| 2026-06-27 | **Observability becomes an evidence flywheel.** The three evidence-thin variables (language-mix, recycling, modality) are exactly where Lingual already runs all three and the literature is silent → our observability data is positioned to produce the missing SLA evidence. | Reframes Phase 1 from "a teacher feature" to "the way Lingual generates evidence the field lacks" — a durable strategic asset. |

## Open questions

- [x] **A–E framework validation (team).** v0 skeleton approved as the working framework
  (2026-06-27). Design-partner validation still pending (Phase 0 teacher-reality stream).
- [x] **External research go.** Fired 2026-06-27 (`/deep-research`, Opus 4.8) — scoped to pre-AP
  advanced Spanish + teacher-controllable variables.
- [-] **Design partner specifics.** Level known: **HS advanced / pre-AP Spanish**. Their real course
  materials are **readable via the class Canvas PAT** (in `.env`) — deferred ingestion, capability
  noted. Still open: who specifically, their current authoring pain, and when we can observe a real
  session.
- [ ] **Observability surface shape (Phase 1).** Where does it live (extend the existing teacher
  debrief / plan-preview, or a new surface?) and what's the minimum first cut? — Deferred to Phase 1
  brainstorm.

## Research agenda (from the SLA evidence gaps)

`RESEARCH_SLA_GROUNDING.md` found *no* surviving evidence for three of our variables — and the
literature's own open questions land exactly where Lingual already operates. Design Phase 1
observability to probe these, turning real sessions into evidence:

- **Modality** — spoken (pushed output, no planning) vs. text (noticing, planning) for advanced learners.
- **L1/L2 mix** — optimal `target_language_intensity` / translanguaging for Intermediate-Mid → Advanced-Low.
- **Spaced recycling** — does S2 cross-session recycling beat massed practice in conversational AI?
- **Real-time LLM elicitation** — can the voice tutor reliably elicit self-repair over recast without
  answer-dumping? (Directly our S3.2 / S3.3 / S3.4 anti-answer-dump problem.)
