# Teacher FDE — Phase 0 Synthetic Pre-Validation (Polón personas)

Status: **Hypothesis-grade — NOT a sign-off.** Synthetic dry-run, 2026-06-28
Last updated: 2026-06-28
Owner: Product + Engineering

> ## ⚠️ Epistemic status — read first
> This is a **synthetic pre-validation**, not the Phase 0 design-partner sign-off. Findings come from
> **three adversarial LLM personas** role-playing Eduardo Polón, grounded in his real Canvas artifacts
> (`DESIGN_PARTNER_CURRICULUM.md`) but reasoning from the *same model priors* that built the framework.
> It therefore **cannot validate** the design language — it can only **de-risk** it: pressure-test the
> session kit, surface predictable objections, and check the §C archetypes against his real units.
> **Phase 0 stays OPEN.** Every "reshape candidate" below is a *hypothesis pending the real human*, not
> a decision. (User decision 2026-06-28: pre-validation only.) Treat convergence across the three
> personas as the strongest available signal — and still provisional.

## Method

Polón is **already a live Lingual user** (`DESIGN_PARTNER_CURRICULUM.md` — Free Practice → Guided
Practice, targets conveyed as Canvas prose). Three personas, each a real facet of him, were dispatched
**refute-biased** and grounded in his real curriculum + AI-use policy:

- **The AI-forward innovator** — already assigns Lingual, wrote the dept AI guidelines, high bar:
  "beat my Canvas prose or why switch?"
- **The productive-struggle purist** — his #1 principle weaponized: "prove your tutor elicits, doesn't
  answer-dump; prove this won't become a backdoor grade on practice."
- **The overloaded pragmatist** — 228 Canvas assignments, no time: "make it zero extra effort or I won't
  touch it."

Each walked the session kit (§A–§E + decisions D1–D8) in character. Convergence = signal.

## Convergent findings (ranked by signal strength)

### 🔴 REFUTES — framework choices the personas challenged

1. **Authoring is NOT "compose from a variables table" — it's "extract structure from the prose I
   already write." (3/3, unanimous, identical "what makes me say yes.")** All three independently
   landed on: *let me paste my existing two-sentence Canvas expectations + a Vocabulario reference; you
   infer target expressions / archetype / focus grammar / persona; I confirm or correct (one tap per
   field).* The pragmatist: "ask me to fill ten fields and I'm gone before the second row." The
   innovator: "an approval step on top of work I already did." This **reframes Phase 2** from a guided
   *form* to **prose → structured inference → confirm**, and it closes the exact gap we observed in his
   real behavior (the "expectations paragraph → structured input" move). *Highest-signal finding.*

2. **Narrative / past-event retell (preterite ↔ imperfect) must be SHIP-FIRST, not benched. (3/3.)**
   Grounded, not taste: his **L2 Estructuras IS the preterite-vs-imperfect arc** — the hardest pre-AP
   grammar contrast — and it *needs* a narrative task to force the form. The current §C bench leaves him
   nothing at his most common grammar-practice moment. Candidate: promote narrative into ship-first;
   demote negotiation/decision-making to bench for this level.

3. **"Feedback policy = accuracy-first vs. fluency-first" is the wrong axis. (2/3 — innovator +
   purist.)** The real knob he wants is **elicitation vs. recast/answer-dump** — "does the AI prompt
   self-repair (*¿Buscas a alguien que…?* and wait) or hand over the form?" This is grounded in his #1
   policy (productive struggle) *and* the very SLA evidence we cite (Lyster prompts > recasts, 0.83 vs
   0.53). The **engine already does the right thing** (grammar→prompt-first); the framework's *teacher-
   facing label* is what's wrong. Candidate: rename/reframe the feedback-policy variable around
   elicitation-over-recast, with the stance legible.

4. **Hit-counts alone are an insufficient "realized" signal — show the elicitation TRACE. (2/3 —
   purist's "what makes me say yes" + innovator.)** A target expression in the transcript could be
   *produced under pressure* or *echoed after a recast* — opposite pedagogically. The purist: "show me
   the student closed the gap after a *prompt*, not a recast — that single signal turns the alignment
   view from surveillance into a learning diagnostic I'd stand behind." Connects directly to the
   engine's S3 coach-review / uptake events. *Strong fast-follow candidate, and it simultaneously
   answers the answer-dump fear AND the "is the gap real learning?" question.*

5. **Persona should NOT be a first-class free-text field for v0. (2/3 keep-embedded; 1 selector-if-
   anything.)** Resolves the §B open question D3 with evidence: keep scenario-embedded for v0. IF
   elevated later, make it a **named-persona selector** (curious peer / debate partner / interviewer /
   community member), never a blank box ("I'd write the same sentence every time → no signal").

6. **Don't impose a parallel taxonomy — speak his. (3/3 on D6.)** Specific: "communicative objective"
   → **"can-do"** (ACTFL, he uses it); surface **PRACTICE / ASSESS** + a visible **"Level 1 practice"**
   tag; "surface mine, hide yours" (engine variable layer underneath his OVERVIEW→ASSESS / Free-Guided).

### 🟢 VALIDATES — framework choices the personas supported

- **The spine (D1, task–target alignment): 3/3 AGREE.** "My task framing is literally *Interpersonal
  Communication by way of the Vocabulario* — alignment thinking before you named it." Difficulty-refuted
  also endorsed ("I don't write harder scenarios; I write scenarios that *require* the vocabulary").
- **The never-elicited callout lands (segment C): 3/3 find it genuinely useful** — and all frame the
  response as **redesign the scenario, not grade the student** (exactly the intended use).
- **His "productive struggle" policy pre-validates the engine's elicitation-first design** — the purist's
  trust condition (elicitation over answer-dump) is *what the engine already does*.
- **Voice is the non-negotiable default for interpersonal (3/3 on D7 modality)** → default voice for
  interpersonal task modes, override to text.
- **On-page placement validated (pragmatist):** the view must live on the analytics page he already
  visits, not a separate dashboard — which is **where we already mounted it.**

### 🟡 GUARDRAIL — a risk all surfaced

**The alignment view must not become a backdoor grade on practice. (innovator + purist, strongly.)**
Grounded in his explicit **Level 0 (assessment, no AI) / Level 1 (practice) boundary.** Mitigation
mostly already true: our realized signal is **assignment-aggregate** (an `studentsElicited` *count*,
not per-student transcripts). Actions: (a) frame it explicitly as a *practice diagnostic, not a grade*;
(b) be very deliberate about any per-student drill-down; (c) consider an export/visibility guard.

## Per-decision synthesis (D1–D8)

| # | Decision | Synthetic verdict | Note |
|---|----------|-------------------|------|
| D1 | task–target alignment spine | **AGREE 3/3** | Validated; matches his real task design. |
| D2 | §B variables = right vocabulary | **RESHAPE** | Not as a fill-out table — infer from prose. Objective/success-criteria overlap; "can-do" rename. |
| D3 | persona own field vs embedded | **EMBEDDED for v0** (2/3) | Selector, not free-text, if ever elevated. |
| D4 | own the feedback policy | **RESHAPE** | Yes he wants it — but as elicitation-vs-recast, not accuracy/fluency. |
| D5 | archetypes fit his Lecciones | **RESHAPE** | Ship narrative (preterite/imperfect); 3 of 4 fit; cultural-comparison must be framed interpersonal. |
| D6 | vocabulary map | **RESHAPE** | Speak OVERVIEW→ASSESS / Free-Guided / Level 0-3 / can-do; hide engine terms. |
| D7 | language-mix / recycling / modality | **partial** | Target-led + voice-default endorsed; **recycling must be within-unit/within-target-set** (cross-theme recycling would confuse him) → sharpens the evidence-flywheel question. |
| D8 | run one real assignment | **CONDITIONAL 3/3** | Condition is uniform: authoring ≤ his current two sentences → **gated on finding #1 (prose extraction).** |

## Reshape-candidate list (hypothesis-grade — pending real sign-off)

Prioritized for when the real session confirms/denies:
1. **Phase 2 = prose-extraction + confirm**, not field-composition. (finding #1) — *biggest product shift.*
2. **§C: promote narrative/past-event retell to ship-first.** (finding #2)
3. **§B/D4: reframe feedback policy as elicitation-vs-recast.** (finding #3)
4. **§E + fast-follow: add an elicitation-trace signal** (produced-after-prompt vs produced-after-recast) to the realized axis. (finding #4)
5. **§B/D3: persona stays embedded v0; named-selector later.** (finding #5)
6. **§B/§D + UI: surface his taxonomy** (can-do, PRACTICE/ASSESS, Level-1 tag). (finding #6)
7. **Guardrail: alignment view framed as practice-diagnostic; guard per-student exposure.** (guardrail)
8. **Modality default = voice for interpersonal.** (D7)

## Session-kit improvements (safe to apply — the kit is an instrument, not the framework)

- **Lead the demo with the prose→structure story**, not the variables table: open by pasting his real
  two-sentence expectations and showing what the engine would infer. (finding #1)
- **Add an elicitation-trace question** to segment C: "would seeing *prompt vs recast* change whether
  you trust this?" (finding #4)
- **Pre-empt the grade-backdoor fear** in segment C: state up front it's assignment-aggregate, a
  practice diagnostic, not a per-student grade. (guardrail)
- The café→advanced bridge and on-page placement were both **confirmed necessary/correct** — keep.

## What only the REAL Polón can still settle (the residual)

Simulation cannot produce these — they are why Phase 0 stays open:
- Whether prose-extraction actually saves him time *in his hands* (the D8 condition is empirical).
- His genuine reaction to a real transcript — does the elicitation trace read as authentic struggle?
- Institutional/relational truths: dept politics around the grade-backdoor risk, his real adoption ceiling.
- Whether the personas' striking *convergence* is his real mind or a shared model prior (the core caveat).

## Caveats

- **Self-confirmation residual:** personas share the model lineage that built the framework. The refutes
  (findings #1–#5 genuinely contradict current v0) are reassuring evidence it *wasn't* pure rubber-stamp,
  but convergence ≠ truth.
- **Single-source grounding:** Canvas course content only; his Google-Doc rubrics + actual class voice
  beyond the AI policy were not pulled.
- **No real session data used** — though as a live user, his real Guided-Practice runs may exist and
  would be far stronger evidence (see ROADMAP).
