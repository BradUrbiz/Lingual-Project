# Teacher FDE — Charter

Status: Active — Phase 0
Last updated: 2026-06-27
Owner: Product + Engineering

## 1. Why this exists

The pedagogy engine (S1–S5) is mature: given well-structured teacher input, it weaves that input
across a live conversation and produces learning + teacher-facing evidence. But the engine assumes a
precondition it does not help create:

> **A well-intended, structured input that faithfully conveys the teacher's learning objectives,
> scope, and design.**

Today that precondition is mostly unmet, for a reason deeper than UI:

**No one has an established method for designing learning that is elicited through pure real-time
conversation.** Teachers know how to write a worksheet or a quiz. They do *not* have a mental model
for "what do I give an AI so that a 6-minute spoken dialogue reliably teaches what I intend?" Lingual
cannot wait for the field to invent this. Lingual must invent it, encode it, and co-develop it with
teachers — the **Forward-Deployed Engineering** posture.

## 2. Problem statement

Three coupled failures, all stemming from the same missing thing:

1. **Input is hard to author (blank-page / method).** "Structure learning through chat" is extremely
   abstract. Teachers need a *system* — a definite method for generating good input, not a blank
   textarea. "Make rich input nearly free" really means: *guide teachers on how to produce input and
   give them a clear framework for it.*

2. **Execution is invisible (observability).** Teachers set objectives, scope, scenarios, settings —
   but cannot see how those play out in the conversation, and cannot steer that. The engine's
   weaving of input across a session is well-designed; what is under-explored is *what* to input,
   *what structure* of input to give, and *how* the chat best leverages it. Teachers should be able
   to see and adjust the realized behavior, not just the intended input.

3. **The medium is unfamiliar (pedagogy literacy).** Teachers cannot picture what learning "elicited
   through a pure conversation" looks like. They need to be shown, in advance, how AI chat can be
   leveraged for learning and how a conversation can be *designed*.

### The underlying engine fact (why this is urgent, not cosmetic)

The engine is **permissive by design**: it fail-opens, never 500s, and silently degrades when input
is thin. Concretely (from the engine-lever audit, 2026-06-26):

- Empty `target_expressions`/`target_vocabulary` → **S2 recycling and S5 target-neglect never fire.**
- Empty `focus_grammar` → **S1 grammar-routing (Lyster prompt-first) is a silent no-op.**
- Vague targets ("be polite", "use past tense") → **hit-counting is meaningless;** recycling and
  coverage produce noise.
- A scenario that doesn't *require* the targets → the learner finishes without ever using them; the
  engine has targets to recycle but the conversation never surfaces them.

The teacher gets a worse tutor **and never finds out why.** The engine already says "teacher is the
policy-setter, AI is the executor" — but has zero visibility into whether the teacher actually *set*
policy or just left fields blank. Teacher FDE closes that loop.

## 3. Thesis

> **Lingual establishes and structures the method for leveraging real-time conversation as learning,
> encodes it as a design language teachers can compose with, and makes the gap between intended
> design and realized conversation visible and steerable.**

The three failures above are not three features. They are **three surfaces of one missing keystone:**
a **Conversational Learning Design Language** (see `DESIGN_LANGUAGE.md`).

- Surface #1 — **Authoring** (guide input generation) = the language's *variables* + *patterns*.
- Surface #2 — **Observability** (intended → realized) = the language's *quality model* + *signals*.
- Surface #3 — **Literacy** (teach the medium) = the language's *thesis* + *exemplars*.

One document is the single source of truth for all three.

## 4. The central design principle

The spine of the whole framework is **task–target alignment**: a well-formed assignment designs the
conversation so that *succeeding at the task requires using the target language* — the target is
necessary, not optional. This principle is what makes all three surfaces tractable, and it is
**measurable** (the engine already tracks per-target hit-counts), so observability can show a teacher
"your target X was never elicited by your scenario" — the realized-vs-intended gap, made concrete.

## 5. Success criteria (Phase 0 → first deployment)

- A teacher can **describe an assignment in their own terms** and end up with engine-ready structured
  input, with the *why* of each field legible.
- A teacher can **see how their assignment actually ran** — which targets were elicited, where the
  conversation drifted — without reading a transcript line by line.
- A teacher, after one cycle, can **predict** roughly how an input change will change the
  conversation (literacy acquired by observation).
- Measured against a **real design-partner teacher**, not in a vacuum.

## 6. Approach

- **Spine: Framework → Observability.** Build a *lean* design-language v0, then immediately build the
  cheapest surface (observability), and let real sessions evolve the framework. (Decision 2026-06-27.)
- **Co-design with a design partner.** A real pilot teacher is available / soon available; the FDE
  posture is literal — embed, deploy, iterate. (Decision 2026-06-27.)
- **Research-grounded, not research-gated.** External SLA/TBLT grounding runs in parallel and informs
  the framework, but does not block the first deployable surface.

## 7. Non-goals (for now)

- Not a generic "AI lesson generator." Scope is *conversational* speaking practice the engine runs.
- Not re-opening the engine architecture. Teacher FDE feeds and observes the engine; engine internals
  are settled (S1–S5, `../Pedagogy Engineering/`).
- Not language-specific. The design language is locale-parametric, like the engine.
- Not a teacher-training course. Literacy is delivered *in-context* (by doing + seeing), not as a
  separate curriculum — though an exemplar library is in scope.
