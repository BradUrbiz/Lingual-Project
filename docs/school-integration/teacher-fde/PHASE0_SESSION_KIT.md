# Teacher FDE — Phase 0 Design-Partner Co-Validation Session Kit

Status: Ready to run — live co-validation with **Eduardo Polón**
Last updated: 2026-06-28
Owner: Product + Engineering

A runnable facilitation kit for the **Phase 0 sign-off** session: a single 30–45 min live
co-validation with the design partner that produces the Phase 0 exit — a *design-partner-validated v0*
of `DESIGN_LANGUAGE.md`, concrete enough to drive Phase 1. Read alongside `DESIGN_LANGUAGE.md`
(the thing being validated), `DESIGN_PARTNER_CURRICULUM.md` (his real units), and `ROADMAP.md`
(the open questions this resolves).

---

## 0. The one thing this session must produce

Not "does he like it." The exit is a **validated-or-reshaped v0**, defined as: answers to the 8
validation decisions (§3), his authoring pain captured in his own words (§2 segment B), and a
yes/no on **"would you run one real assignment through this and let us watch?"** (the Phase 1
grounding + the start of the evidence flywheel).

If he diverges from v0, that is **success, not failure** — the whole point of the FDE posture is to
reshape the framework from a real teacher's mental model rather than ship a vacuum design.

## 1. The governing principle — don't lead the witness

The single biggest failure mode is **showing him the design language first and getting polite
agreement.** That produces a rubber-stamp, not validation.

**Order is load-bearing:**
1. Capture his *uncontaminated* mental model first (segment B — interview, no framework shown).
2. Then let observability sell itself (segment C — show, don't tell).
3. *Only then* reveal the framework and check it against what he already said (segment D).

When you reveal §B, frame every variable as a **question mapped to his own words** ("you said you
care about X — we call that Y; does that match?"), never as a feature tour.

## 1.1 What the synthetic pre-validation sharpened (2026-06-28)

A three-persona adversarial dry-run (`PHASE0_SYNTHETIC_PREVALIDATION.md`, hypothesis-grade) predicted
his objections. Bake these into the live run — but **let him reach them himself**; don't pre-load his
answers:

- **Lead the demo with prose→structure, not the variables table.** Open by pasting his real two-sentence
  Canvas "expectations" and showing what the engine would infer — all three personas refused to fill a
  ten-field form. The variables table is the *engine layer*, not the authoring surface.
- **Pre-empt the grade-backdoor fear in segment C** (he protects a Level 0 / Level 1 line): say up front
  it's an **assignment-aggregate practice diagnostic, not a per-student grade.**
- **Add the elicitation-trace question** (§2.2 probe 3b below): the purist's trust hinges on *prompt vs
  recast*, not hit-counts.
- **Watch for the narrative gap** (§C): his L2 is the preterite↔imperfect unit; if he reaches for a
  past-event task and the archetypes don't have one, that's predicted — capture it as D5 reshape.

## 2. The run sheet (timed, ~45 min)

| Time | Segment | Goal | Facilitator does |
|------|---------|------|------------------|
| 0–2 | **A. Frame** | Set the FDE posture | One sentence: *"We built an AI that runs your speaking task across a live conversation at student scale. We're now designing the teacher's side — and we want you to co-design it. Today I mostly want you reacting honestly, including 'this is wrong.'"* Make explicit: disagreement is the deliverable. |
| 2–12 | **B. Authoring pain — interview FIRST** | His real mental model, uncontaminated | **Do NOT show the design language.** Ask open questions (§2.1). Capture verbatim phrases — they become the vocabulary we map onto. |
| 12–22 | **C. Show, don't tell — the alignment view** | Let observability land as a diagnosis of *his* world | Walk a real intended→realized gap on the live view (§5 demo path). Point at the **never-elicited callout** and the **realized column**. Ask: *"if this were your task, what would you do with this?"* Watch for the "aha." |
| 22–37 | **D. Co-validate §A–§E** | Validate / reshape the framework | Reveal the spine, then the §B variables — each as a question, mapped to segment B. Drive to the §3 decisions. (§2.2.) |
| 37–42 | **E. Archetype check** | Do the patterns fit his curriculum | Show the 4 ship-first archetypes + the L1 *relaciones* worked example built from **his own unit**. *"Do these cover your Lecciones? Is the relaciones example right? What's missing?"* |
| 42–45 | **F. Close + commit** | Secure Phase 1 grounding | *"What would make this genuinely useful to you?"* then the real ask: *"Would you run ONE real assignment through this and let us watch how it runs?"* |

### 2.1 Segment B — authoring-pain questions (ask, don't lead)

- Walk me through how you build a speaking task today — from blank page to something students do.
- Where does that break down or eat your time?
- When you hand students a speaking task, what do you *wish* you could control about how it goes —
  that you currently can't?
- How do you know, afterward, whether the speaking practice actually worked? What do you look at?
- When you imagine an AI running your speaking task with 25 students at once — what's your first worry?

> These map directly onto CHARTER §2's three failures (authoring / observability / literacy). You are
> testing whether those failures are *real for him*, not assuming they are.

### 2.2 Segment D — the co-validation probes (framework as questions)

Reveal in this order. Each probe targets a specific `DESIGN_LANGUAGE.md` claim or open question.

1. **Spine (§A).** *"Our core principle: a good speaking task makes the target language* **necessary** *—
   you can't succeed at the task without using what you meant to practice. Does that match how you
   think about a strong speaking task?"* → validates/refines §A. (Note for you: SLA research **refuted**
   "harder task → better grammar" — if he reaches for difficulty as the knob, that's a teaching moment,
   gently: it's *design*, not difficulty.)
2. **Variables (§B) as his vocabulary.** Show the variable list. *"Are these the right knobs? Which do
   you actually think about? What's missing? What do you call these?"* Capture term-mapping onto his
   `OVERVIEW · LEARN · PRACTICE · APPLY · ANALYZE · ASSESS` taxonomy + ACTFL modes (D6).
3. **Feedback policy (D4).** *"We let you set the AI's correction stance — accuracy-first vs.
   fluency-first — yourself, rather than hiding it. Do you want to own that? When would you flip it?"*
   (Synthetic run predicts he rejects the accuracy/fluency framing and reframes it as **elicitation vs.
   answer-dump** — his "productive struggle" principle. If he does, that's a D4 reshape; don't argue.)
   - **3b. Elicitation trace (D4 / §E).** *"Would it change your trust if the view showed whether a
     student produced the form after a* **prompt** *(we made them retrieve it) vs. after a* **recast**
     *(we gave it to them)?"* — the predicted trust-maker; capture as a fast-follow signal.
4. **Tutor persona (D3).** *"Who the AI plays — debate partner, curious peer, person being interviewed —
   changes what language comes out. Should that be its own thing you set, or just part of the scenario?"*
   → resolves the §B open question (own field now vs. scenario-embedded for v0).
5. **The three uncertain knobs (D7).** *"On three things even the research is unsure for advanced
   learners: how much Spanish-only vs. English support; spacing the same targets across sessions; and
   voice vs. text. From your classroom — what's your read?"* → his experience is candidate evidence for
   the variables `RESEARCH_SLA_GROUNDING.md` couldn't confirm (the evidence-flywheel seed).

## 3. The validation decisions to extract (this IS the sign-off)

"Sign-off" = these resolved, written into the docs. Pulled from the `DESIGN_LANGUAGE.md` / `ROADMAP.md`
open questions.

| # | Decision | Validates | Lands in |
|---|----------|-----------|----------|
| D1 | Does **task–target alignment** match his mental model of a good speaking task? | §A spine | `DESIGN_LANGUAGE.md` §A validation status |
| D2 | Are the **§B variables** the right vocabulary — missing / extra / renamed? | §B | §B validation status |
| D3 | **Tutor persona**: own input field now, or scenario-embedded for v0? | §B open Q | §B note + ROADMAP decision log |
| D4 | **Feedback policy**: does he want to consciously own the accuracy↔fluency stance? | §B / decision 2026-06-27 | confirm or revisit decision log |
| D5 | **Archetypes**: do the 4 ship-first patterns cover his Lecciones? confirm/adjust the set. | §C | §C validation status |
| D6 | **Vocabulary map**: our terms ↔ his `OVERVIEW→ASSESS` + ACTFL modes. | adoption | `DESIGN_PARTNER_CURRICULUM.md` signals |
| D7 | **Theory-derived knobs**: any real-world read on language-mix / recycling / modality? | §B evidence gaps | ROADMAP research agenda |
| D8 | **Commit**: will he run one real assignment through it (Phase 1 grounding)? | Phase 0 → 1 | TASKS Phase 0 exit + Phase 1 |

## 4. Capture template (fill live; drops straight back into the docs)

```
SESSION — Eduardo Polón — <date>

B. AUTHORING PAIN (verbatim phrases):
  - builds a speaking task today by: ...
  - biggest friction: ...
  - wishes he could control: ...
  - judges success by: ...
  - first worry at scale: ...

C. ALIGNMENT-VIEW REACTION:
  - the "aha" (or lack of): ...
  - what he'd do with the never-elicited list: ...

D. FRAMEWORK VALIDATION:
  D1 spine matches mental model?        Y / N / RESHAPE → ...
  D2 variables right vocabulary?        missing: ...  extra: ...  renames: ...
  D3 persona own field or embedded?     ...
  D4 wants to own feedback policy?      Y / N — when he'd flip: ...
  D5 archetypes cover his units?        confirmed: ...  add: ...  drop: ...
  D6 term map (ours ↔ his OVERVIEW→ASSESS / ACTFL): ...
  D7 read on language-mix / recycling / modality: ...

F. COMMIT:
  D8 will run one real assignment?      Y / N — which unit: ...
  what would make it genuinely useful: ...
```

## 5. Demo walkthrough (exact path — verified live 2026-06-28)

The realized side only lights up where student sessions exist. Use the assignment confirmed lit:

1. `l1ngual.com` → sign in **`testteacher@testing.com` / `lingual123`** (NOT the `@l1ngual.com`
   variant — invalid credential).
2. Teacher dashboard → **Testing Class** (Spanish) → its analytics.
3. Assignments list → **"S3.1 burn-in - cafe scaffolded (text)"** (4 sessions).
   (Direct: `…/classes/Bgr5BHJdEniOsNeD6CCa/assignments/Yf6WGE4uKu0UixT5afb4/analytics`.)
4. Scroll to **"How the AI ran this assignment."** Point at:
   - the **yellow never-elicited callout** — *"Designed but never came up"* (`Quisiera un cafe`, `el cafe`,
     `la galleta`) — **this is the headline; lead with it.**
   - the **Realized column** — `Cuanto cuesta` 2·emerging·1/1, `Gracias` 2·emerging·1/1 vs. the 0s.
   - the grammar/objective rows showing **"designed · not yet measurable"** (honest scope — say so).

**Framing caveat:** this demo task is a beginner café transaction; he teaches advanced. Say it
explicitly: *"ignore that this one's a café order — imagine this same view on your* relaciones *task:
did the conversation actually force* Me siento… cuando… *?"* Bridges to the §C worked example.

**Optional ambitious pre-stage (high payoff, ~20 min before the session):** author a real Lingual
assignment from his **L1 *relaciones*** task (the seed is in `DESIGN_PARTNER_CURRICULUM.md` →
`DESIGN_LANGUAGE.md` §C worked example), so the *intended* side of the demo is on **his** content. The
realized side won't be lit (no sessions yet) — that's fine; pair it with the café one for "what it
looks like once students run it." Don't author it silently in prod without deciding it's worth the
session time.

**Fallback if the view is down:** the screenshot in this session's history (`alignment-panel.png`) shows
the same panel; walk that instead. Don't let a daemon hiccup derail the session.

## 6. After the session — fold it back

The session output is not done until it's in the docs (this is what makes it "sign-off," not a chat):

- **`DESIGN_LANGUAGE.md`** — update §validation status per D1–D7; reshape any variable/archetype he
  diverged on. If he reshapes the spine or a high-evidence lever, that's a v0→v0.1 bump.
- **`ROADMAP.md`** — add a decision-log row per resolved open question (D3 persona, D5 archetype set,
  D7 evidence reads); flip the "design partner specifics" open question toward closed.
- **`TASKS.md`** — check off the Phase 0 intake / co-validate / archetype items; if D8 = yes, open the
  Phase 1 "run a real assignment + observe" task (the alignment view's first real design-partner data).
- **`DESIGN_PARTNER_CURRICULUM.md`** — add the term-map (D6) so future copy speaks his vocabulary.
- **memory** `project-teacher-fde` — update status to "Phase 0 validated / reshaped."

Phase 0 exits when `DESIGN_LANGUAGE.md` is design-partner-validated and D8 gives us a real assignment
to observe — which is also the moment the alignment view first shows data from a task *he* designed.
```
