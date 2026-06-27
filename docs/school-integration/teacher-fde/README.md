# Teacher FDE

Status: Active — Phase 0 (framework) in progress
Last updated: 2026-06-27
Owner: Product + Engineering

**Teacher FDE** (Forward-Deployed Engineering, for teachers) is the initiative that establishes
*how teachers design conversational learning* on Lingual: turning teacher intent into engine-ready
assignment input, making the conversation's execution observable, and building teacher literacy in
the medium.

It is the **teacher-facing front of the pedagogy engine** (`../Pedagogy Engineering/`). The engine
answers *"given good input, how does the conversation produce learning?"* — Teacher FDE answers the
**prior** question:

> **"What should the teacher put in, and how do they know it worked?"**

The name is deliberate. Today, no one — not teachers, not the field — has an established method for
leveraging real-time AI conversation as structured classroom learning. Lingual's job is to *be the
forward-deployed engineer*: define that method, encode it into the product, and co-develop it with
real teachers in real classrooms.

## Documents

| Document | Purpose | When to update |
|----------|---------|----------------|
| `CHARTER.md` | Why this exists, the problem, the thesis, success criteria, non-goals | Mission, scope, or success criteria change |
| `ROADMAP.md` | Phases, current status, decision log, open questions | A phase starts/ends, a decision lands, or an open question resolves |
| `DESIGN_LANGUAGE.md` | The keystone — the Conversational Learning Design Language (the framework all three surfaces draw from) | The framework's structure or content changes |
| `RESEARCH_SLA_GROUNDING.md` | Adversarially-verified SLA evidence base grounding `DESIGN_LANGUAGE.md` §A | A new research pass lands or a claim is revised |
| `DESIGN_PARTNER_CURRICULUM.md` | The design partner's real Canvas curriculum (read-only pull) grounding §C archetypes/examples | Curriculum is re-pulled or the partner changes |
| `PHASE0_SESSION_KIT.md` | Runnable facilitation kit for the Phase 0 design-partner co-validation session (run sheet, validation decisions D1–D8, capture template, live-demo path) | Session format changes, or after running it (fold results back per §6) |
| `PHASE0_SYNTHETIC_PREVALIDATION.md` | **Hypothesis-grade** dry-run: 3 adversarial Polón personas grounded in his real Canvas; reshape candidates + kit improvements. NOT a sign-off. | A new synthetic pass runs, or the real session confirms/denies its candidates |
| `PHASE2_PROSE_EXTRACTION_SPIKE.md` | Spike result: prose → structured input validated on Polón's real prose (hypothesis SUPPORTED; grammar needs a curriculum map). Phase 2 design implications + reusable extraction contract. | Phase 2 build starts, or a follow-up spike runs |
| `TASKS.md` | Phased checklist | Items start, complete, block, or are newly identified |

**Update order on scope changes:** CHARTER → DESIGN_LANGUAGE → ROADMAP → TASKS.

## Status legend (TASKS)

- `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked / needs decision

## Relationship to other docs

- `../Pedagogy Engineering/PEDAGOGY_ENGINE.md` — the execution engine Teacher FDE feeds and observes.
- `../PRD.md` / `../TECH_SPEC.md` — the parent school-integration product + architecture.
- `../../Pedagogy Research/` — SLA / pedagogy source material; Phase 0 external research lands here or is linked.
