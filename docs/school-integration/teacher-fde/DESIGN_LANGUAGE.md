# The Conversational Learning Design Language

Status: **v0 — team-approved 2026-06-27** (working framework; pending design-partner validation + external-research grounding)
Last updated: 2026-06-27
Owner: Product + Engineering

> This is the **keystone** of Teacher FDE. It is the single source of truth all three surfaces draw
> from: Authoring (#1) = §B + §C, Observability (#2) = §D + §E, Literacy (#3) = §A + §C.
>
> v0 is intentionally lean — a *validatable skeleton*, not a complete theory. It will be grounded by
> the external-research stream and reshaped by what the design partner's real sessions reveal.

---

## §A. The thesis (the "why")

Learning happens by **doing the language under a designed constraint**. An assignment is a *designed
constraint on an open-ended dialogue*, such that the act of conversing reliably produces the intended
learning.

**Central principle — task–target alignment:** the task must make the target language *necessary*,
not optional. A good assignment is one where *succeeding at the task requires using the targets*.
Thin/misaligned input fails not because a field is blank but because the learner can complete the
scenario without ever using what they were meant to practice.

Supporting SLA principles (to be grounded / corrected by the external-research stream):
- **Pushed output** (Swain) — production under communicative pressure drives acquisition.
- **Focus on form** (Long) — attention to form *within* meaningful interaction, not isolated drill.
- **Interaction / negotiation of meaning** — repair and clarification are where learning concentrates.
- **Comprehensible input / i+1** (Krashen) — scaffolding pitched just beyond current level.
- **Spaced retrieval / recycling** — targets re-encountered across sessions, not once.

> _Open: confirm/rank these against the literature; add task-complexity (Robinson) and corrective-
> feedback timing evidence. (External-research stream.)_

## §B. The design variables (the teacher's vocabulary)

The knobs a teacher composes with. **These map 1:1 to existing assignment input fields and to engine
behavior** — so the language is not aspirational; it describes what already drives the engine. For
each: what it is · the learning mechanism it serves · what the engine does with it · what good / thin
/ misaligned looks like · how it is *observed* (→ §E).

| Variable (field) | Learning mechanism | Engine behavior | Degradation when thin/misaligned |
|---|---|---|---|
| **Communicative objective** (`objectives`) | Defines the can-do goal | S1 objective-target routing; S3 coach/Ask scope | Empty → no objective anchor; corrections untethered to intent |
| **Task / scenario** (`generated_scenario`, `task_type`) | The situation that makes targets *necessary* (TBLT) | S1 task context; `task_type` = info-gap / opinion-gap / decision-making (TBLT shapes) or `custom_prompt` (engine OFF) | Misaligned scenario → targets never elicited; `custom_prompt` → no pedagogy guarantees |
| **Target expressions / vocabulary** (`target_expressions`, `target_vocabulary`) | Forms to elicit + recycle | S1 recast-first; **S2 recycling hit-count**; S3 coach/Ask alignment; S4.2 coverage; **S5 target-neglect** | Empty → recycling + neglect-detection silently dead; vague → hit-counting meaningless |
| **Focus grammar** (`focus_grammar`) | Structures practiced under pressure | **S1 prompt-first (Lyster) routing** | Empty → grammar routing silent no-op; (note: S2 excludes grammar by design) |
| **Success criteria** (`success_criteria`) | The observable "done well" bar | S1 task context; teacher debrief | Vague → learner can't tell what counts; weak completion signal |
| **Language-mix intensity** (`target_language_intensity`) | Scaffolding level / i+1 balance | S1 language-mix scaffolding section (english-first … target-only) | Mis-set → input incomprehensible (too hard) or no stretch (too easy) |
| **Modality** (`modality_override`) | Voice = pushed output, real-time; Text = noticing, planning time | Voice vs text prompt + surface | Mismatch to objective → wrong cognitive demand |
| **Feedback policy** (`feedbackPolicy.mode`) | Accuracy↔fluency stance | S1 elicitation timing; S2 recycling directedness; S3 coach depth; S4.1 affect stance | Missing → defaults to balanced (often fine, but unset ≠ chosen) |
| **Teacher notes** (`teacher_notes`) | Conveys intent the fields can't | S1 GUIDANCE section | Missing → tutor lacks pedagogical context |

> _Open: is this the complete set of variables a teacher should consciously control, or do we hide
> some (e.g. feedback policy) behind a higher-level "rigor" choice? Are we missing a variable for
> **interlocutor role / tutor persona**?_

## §C. The design patterns (archetypes / recipes)

A small set of proven task shapes, each with target slots pre-wired so task–target alignment is the
*default*, not an achievement. These become both the authoring templates (#1) and the literacy
exemplars (#3).

Candidate archetypes (v0 — to be validated/expanded):
- **Transaction / role-play** (order food, book a room) — forces functional expressions + politeness forms.
- **Opinion / debate** (opinion-gap) — forces stance + justification + agreement/disagreement language.
- **Information gap / jigsaw** — forces question forms + clarification; each side holds half the info.
- **Narrative retell** — forces past tense + sequencing connectives.
- **Decision / negotiation** — forces conditionals + comparison + persuasion.

Each archetype documents: the communicative objective it fits, the target slots it naturally elicits,
the scenario shape, a worked example, and the realized signals to expect (→ §E).

> _Open: which 3–4 archetypes do we ship first? Anchor to what the design partner actually teaches —
> **HS advanced / pre-AP Spanish** (AP Spanish Language & Culture themes; opinion/debate + negotiation
> likely weigh heavier than beginner transactions at this level)._

## §D. The quality model (when is input "engine-ready"?)

The checklist that defines a well-formed assignment — and the **intended** axis of observability:

1. **Concrete targets.** Are targets specific forms/expressions, not vague behaviors? ("_Quisiera…_"
   not "be polite".)
2. **Task–target alignment.** Does succeeding at the scenario *require* the targets?
3. **Observable success criteria.** Can "done well" be judged from the conversation?
4. **Level-matched scaffolding.** Does language-mix intensity fit the learners' level?
5. **Modality fit.** Does the modality match the cognitive demand of the objective?

This model powers the authoring-time readiness check **and** is the yardstick the realized signals
(§E) are compared against.

## §E. The observability mapping (intended → realized)

For each variable, the signal the engine already emits — so "did the design work?" is answerable from
data, not transcript-reading. This is the **realized** axis; the gap against §D is the whole product
of Phase 1.

| Design intent (§B/§D) | Realized signal (engine) |
|---|---|
| Targets should be elicited | per-target **hit-counts** (S2 coverage), uncovered/recycle/solid tiers |
| Grammar should be practiced + repaired | uptake / self-correction events, repeated-error counts |
| Conversation should stay on target language | S5 language-drift + target-neglect detectors |
| Help-seeking (not evidence) | Ask-mode log (kept separate from learning evidence) |
| Learner affect / strain | S4.1 readiness heuristic |
| Overall design fidelity | the **task–target alignment gap**: targets intended (§D) vs targets actually elicited |

> _Open: the headline observability metric for v1 is almost certainly the **alignment gap** (intended
> targets vs elicited targets). Confirm, and decide its first visual form in the Phase 1 brainstorm._

---

## How the three surfaces fall out

- **#1 Authoring** = §B (compose from variables) + §C (start from a pattern). The readiness check is §D.
- **#2 Observability** = §D (intended) measured against §E (realized); headline = the alignment gap.
- **#3 Literacy** = §A (the principle) taught through §C (worked exemplars) and seen through §E.

## Validation status

- [-] §A thesis — external-research grounding fired (`/deep-research`, 2026-06-27); design-partner validation pending
- [x] §B variables — team-approved 2026-06-27; design-partner validation pending (possible add: tutor persona / interlocutor role)
- [ ] §C archetypes — first 3–4 chosen, anchored to the design partner's real teaching (**HS advanced / pre-AP Spanish**)
- [x] §D quality model — team-approved 2026-06-27 as the readiness rubric
- [x] §E signals — team-approved 2026-06-27 (headline metric = **task–target alignment gap**); confirm against actual engine emissions in Phase 1
