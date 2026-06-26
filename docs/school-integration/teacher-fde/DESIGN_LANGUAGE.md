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
| **Tutor persona / interlocutor role** (in `instructions` / `generated_scenario` today; candidate first-class field) | Register, pragmatic functions, and affect the *role* elicits (debate opponent → argument; community member → interview; skeptical customer → persuasion) | Rendered into the system prompt via scenario/instructions; the voice surface also carries an avatar persona | Unset → generic tutor; register + role-specific functions under-elicited |
| **Target expressions / vocabulary** (`target_expressions`, `target_vocabulary`) | Forms to elicit + recycle | S1 recast-first; **S2 recycling hit-count**; S3 coach/Ask alignment; S4.2 coverage; **S5 target-neglect** | Empty → recycling + neglect-detection silently dead; vague → hit-counting meaningless |
| **Focus grammar** (`focus_grammar`) | Structures practiced under pressure | **S1 prompt-first (Lyster) routing** | Empty → grammar routing silent no-op; (note: S2 excludes grammar by design) |
| **Success criteria** (`success_criteria`) | The observable "done well" bar | S1 task context; teacher debrief | Vague → learner can't tell what counts; weak completion signal |
| **Language-mix intensity** (`target_language_intensity`) | Scaffolding level / i+1 balance | S1 language-mix scaffolding section (english-first … target-only) | Mis-set → input incomprehensible (too hard) or no stretch (too easy) |
| **Modality** (`modality_override`) | Voice = pushed output, real-time; Text = noticing, planning time | Voice vs text prompt + surface | Mismatch to objective → wrong cognitive demand |
| **Feedback policy** (`feedbackPolicy.mode`) | Accuracy↔fluency stance | S1 elicitation timing; S2 recycling directedness; S3 coach depth; S4.1 affect stance | Missing → defaults to balanced (often fine, but unset ≠ chosen) |
| **Teacher notes** (`teacher_notes`) | Conveys intent the fields can't | S1 GUIDANCE section | Missing → tutor lacks pedagogical context |

> _Resolved 2026-06-27: **feedback policy is exposed to teachers** as a first-class variable — not
> hidden behind a higher-level "rigor" macro (teachers should consciously own the accuracy↔fluency
> stance). **Tutor persona / interlocutor role added** (row above). Remaining open: does persona
> warrant its own input field now, or stay scenario-embedded for v0?_

## §C. The design patterns (archetypes / recipes)

A small set of proven task shapes, each with target slots pre-wired so task–target alignment is the
*default*, not an achievement. These become both the authoring templates (#1) and the literacy
exemplars (#3).

**v0 archetype set — anchored to ACTFL interpersonal/presentational speaking + AP Spanish Language &
Culture themes** (pre-AP advanced). Beginner "transaction/role-play" is intentionally de-emphasized —
it under-stretches this level. Each archetype pre-wires target slots so task–target alignment is the
*default*, names the interlocutor persona, and maps to a `task_type`.

Ship-first set (3–4):
1. **Opinion / argumentation** (`opinion_gap`) — defend a stance on a societal issue (AP: *los desafíos
   mundiales*, *la ciencia y la tecnología*). Elicits: opinion frames + subjunctive of doubt/emotion
   (*no creo que…*, *es importante que…*), connectors (*sin embargo, por lo tanto*), agree/disagree
   pragmatics. Persona = a respectful debate partner.
2. **Negotiation / decision-making** (`decision_making`) — reach a shared plan or agreement (AP: *la
   vida contemporánea*). Elicits: conditional, comparatives, persuasion, polite disagreement. Persona
   = a peer with competing preferences.
3. **Interview / information-gap** (`information_gap`) — each side holds half the information; interview
   a community member or exchange cultural detail (AP: *familias y comunidades*, *la identidad personal
   y pública*). Elicits: question formation, clarification/follow-up, register control. Persona = the
   person being interviewed.
4. **Cultural comparison** (presentational-into-interpersonal) — compare a product/practice/perspective
   across cultures (mirrors the AP cultural-comparison task). Elicits: comparative structures,
   presentational discourse markers, register shifts. Persona = a curious peer from the target culture.

Bench (later): **narrative / past-event retell** (preterite ↔ imperfect contrast — a core pre-AP
grammar focus); **transaction / role-play** (kept only for lower-level or scaffolding use).

Each archetype documents: the objective it fits, the target slots it naturally elicits, the scenario
shape, the **interlocutor persona**, a worked Spanish example, and the realized signals to expect (→ §E).

> _Open: confirm the ship-first set against (a) the deep-research evidence on task type × proficiency
> and (b) the design partner's actual AP/ACTFL units — readable via the class **Canvas PAT** (see
> ROADMAP). The first worked example should use a real unit from the partner's course._

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
- [x] §B variables — team-approved 2026-06-27 (feedback policy exposed; tutor persona / interlocutor role added); design-partner validation pending
- [-] §C archetypes — v0 ship-first set drafted (opinion / negotiation / interview-info-gap / cultural-comparison), anchored to ACTFL + AP themes; confirm vs research + the partner's real Canvas units
- [x] §D quality model — team-approved 2026-06-27 as the readiness rubric
- [x] §E signals — team-approved 2026-06-27 (headline metric = **task–target alignment gap**); confirm against actual engine emissions in Phase 1
