# Teacher FDE — SLA Grounding (research synthesis)

Status: v1 — `/deep-research` run 2026-06-27 (Opus 4.8; 5 angles, 24 sources, 102 claims → 25 verified → 21 confirmed / 4 killed)
Last updated: 2026-06-27
Owner: Product + Engineering

Grounds `DESIGN_LANGUAGE.md` §A. Scope of the question: how to design real-time conversational AI
practice for **HS advanced / pre-AP Spanish** (ACTFL Intermediate-Mid → Advanced-Low), focused on
**teacher-controllable** variables. Every claim below survived 3-vote adversarial verification unless
marked. **Read the caveats — they are load-bearing.**

## Headline

> For advanced/pre-AP learners the strongest teacher-controllable levers are **corrective feedback**
> and **task–target alignment** — *not* task complexity. AI conversational tutors are empirically
> validated to advance acquisition, which licenses the product premise. Three of the six axes we asked
> about — **language-mix/scaffolding, spaced recycling, and modality** — have *no* surviving empirical
> claim and must be treated as theory-derived.

## Confirmed findings

**F1 — Task complexity is a modest ACCURACY nudge, not a grammar-forcer.** Raising complexity on
Robinson's *resource-directing* dimensions (reasoning, perspective-taking) gives a small accuracy
effect (**d≈0.28**) with **no fluency benefit** (d≈-0.02), and the meta-analysis **disconfirmed** the
prediction that harder tasks elicit more complex syntax. *Resource-dispersing* load (remove planning,
dual-task) just disperses attention. → Don't expect difficulty to push advanced learners into higher
grammar; engineer it through task–target **design**. _Jackson & Suethanapornkul (2013), Language
Learning 63(2), k=9 — high; monologic oral tasks (ecological gap vs. dialogue)._

**F2 — Separate designable Task Complexity/Condition from learner-internal Task Difficulty; sequence
simple→complex.** Robinson's Triadic Framework + the SSARC model (Stabilize-Simplify-Automatize-
Restructure-Complexify) give a cross-assignment sequencing rule: simpler versions stabilize/automatize
before complexification triggers restructuring. **Present as a hypothesized lever** — empirical
confirmation is weak and "sequencing → acquisition" is called *inconsistent*. _Robinson (Benjamins
tblt.2.05ch1, tblt.8.04rob) — high as theory, mixed as effect._

**F3 — Task DESIGN, not task category, governs attention to target forms (the core of task–target
alignment).** Among four "focused" tasks the **editing** task drew the most grammar language-related
episodes; two *same-category* tasks (editing vs. matching) diverged because editing made learners
operate directly on the form. → Align the task so it *forces* learners to act on the target, don't
trust a task-type label. _Patanasorn (~2010), single study, hedged mechanism — medium._

**F4 — Build corrective feedback in: durable medium-to-large effect.** Two independent meta-analyses
converge — **Li (2010) d≈0.64** (33 studies), **Lyster & Saito (2010) d≈0.74** (15 classroom studies),
**maintained or growing at delayed post-test**. _high._

**F5 — Prefer feedback that PUSHES self-repair (prompts/elicitation) over recasts — especially at
advanced level.** Prompts **d≈0.83** > recasts **d≈0.53**; explicit correction **d≈0.84**. Prompts are
*especially* effective for higher-proficiency learners. Trade-off: implicit/recast feedback is **better
maintained over time**. → AI tutor should elicit self-correction (clarification request, elicitation,
metalinguistic cue) rather than silently recasting. _Lyster & Saito (2010); Li (2010) — high.
Taxonomy caveat: Lyster/Ranta "prompts vs recasts" ≠ Li "explicit vs implicit" exactly._

**F6 — Match explicitness to (a) feature complexity and (b) developmental stage.** Explicit/
metalinguistic CF for genuinely complex features (subjunctive, conditional, aspect contrasts); light
recasts for stabilized basics. Direct written CF ranged **d=-.31 (past simple) to d=2.76 (past
hypothetical conditional)**. Developmentally gated: emphasizing simple past helped high-beginners but
**backfired at low-intermediate (d≈-.59)** — a teachability window. → For pre-AP Spanish: explicit on
subjunctive/conditional/aspect; **do not re-drill features the learner has developmentally passed.**
_Schenck (2020), 15 studies — medium; Korean-L1 *written* CF, one extreme cell, author hedges._

**F7 — Deliver feedback EARLY — before the next production attempt, not banked to task end.** Immediate
≥ delayed across a controlled study + a 20-study review + a replication where *interim* feedback beat
delayed and matched immediate. **Boundary:** timing affected **explicit** knowledge only — no timing
benefit for implicit/automatized knowledge. _Fu & Li (2020/22); Frontiers review (2023); Li/Li/Qian
(2025) — high; single-structure studies. NB: one LLM-tutor study found **no** timing difference
(d=0.37, n.s.), so timing may matter less when the tutor is an LLM._

**F8 — AI conversational tutors measurably advance acquisition — premise validated.** Chatbots
**g≈0.608** (Lyu, Lai & Guo 2025, 31 studies); GenAI-only **ES≈0.576** (Li, Wang & Yang 2025).
_high; evidence skews EFL/lower-proficiency, so advanced-Spanish applicability is extrapolation._

## Refuted (did NOT survive — do not build on these)

- ✗ "Increasing task complexity along resource-directing dimensions pushes learners toward more complex
  grammar" (0-3). The teacher-facing temptation to "make it harder to force better grammar" is **not
  supported.**
- ✗ "Recasts produce a stable uniform effect (d .67–1.27) — a safe default" (0-3).
- ✗ "Implicit/recast feedback benefits from immediate delivery specifically" (1-2).
- ✗ "A task lacking a production requirement draws fewer target LREs (pushed-output mechanism)" (0-3) —
  intuitive but unconfirmed here.

## Evidence gaps — exactly three of our variables

**No claim survived verification** for: **(d) scaffolding & L1/L2 language-mix ratio**, **(e) spaced
recycling / distributed retrieval**, **(f) modality (real-time spoken vs. text)**. A teacher-facing
framework can ground task design + corrective feedback + the AI-tutor premise in solid evidence, but
its **scaffolding-ratio, recycling, and modality recommendations are theory-derived** (Krashen i+1,
Swain output, Long interaction), **not meta-analytically confirmed**.

**Population/modality mismatch:** almost all surviving evidence is EFL/lower-proficiency, often
university, often written/monologic — *not* HS advanced Spanish in real-time spoken dialogue. Two
threads do extend toward advanced learners: prompts work better for higher-proficiency; and the
disconfirmed syntactic-complexity prediction means you cannot lean on difficulty for advanced grammar.

## Open questions (→ the empirical agenda for our observability loop)

These are precisely where Lingual already operates and the literature is silent — so our own data can
generate the missing evidence:

1. **Modality** — does real-time spoken (pushed output, no planning) vs. text (noticing, planning
   time) differentially produce acquisition for advanced learners? (We run both.)
2. **L1/L2 mix** — optimal ratio / translanguaging policy for Intermediate-Mid → Advanced-Low? (We
   have `target_language_intensity`.)
3. **Spaced recycling** — does distributed retrieval across sessions beat massed practice in
   conversational AI? (We already do **S2 recycling** — a designable lever lacking a cited effect.)
4. **Real-time LLM executability** — can an LLM *voice* tutor reliably detect the error and choose
   **elicitation over recast in real time without answer-dumping**, and does prompts-favor-advanced
   hold for LLM (vs. human) feedback? (This is exactly our **S3.2 chip / S3.3 promote-back / S3.4 Ask**
   anti-answer-dump problem — the literature flags our hardest engineering question as the open one.)
5. **External replication** for advanced secondary Spanish in real-time spoken AI dialogue.

## Implications for the design language

- **Keep the spine** (task–target alignment); **demote complexity/difficulty** as a lever (§C).
- **Corrective feedback is the highest-evidence lever** → the `feedback policy` variable (now
  teacher-exposed) is well-placed; encode **prompts > recasts**, **match explicitness to feature
  complexity + developmental stage**, **deliver early**. This **validates the engine's existing
  target-type routing** (grammar → prompt-first / Lyster; lexical → recast-first) and its
  anti-answer-dump stance.
- **Flag language-mix, recycling, modality as theory-derived** in §B — and make them the first targets
  of the observability + design-partner evidence loop.

## Sources (primary unless noted)

Jackson & Suethanapornkul 2013 (Lang. Learning) https://onlinelibrary.wiley.com/doi/abs/10.1111/lang.12008 ·
Robinson — Cognition Hypothesis https://benjamins.com/catalog/tblt.2.05ch1 · SSARC https://benjamins.com/catalog/tblt.8.04rob ·
Patanasorn (focused tasks/LREs) http://www.academia.edu/4016981 ·
Li 2010 CF meta-analysis https://www.researchgate.net/publication/229940242 ·
Lyster & Saito 2010 oral CF meta-analysis https://www.researchgate.net/publication/234580927 ·
Schenck 2020 (feature complexity × CF) https://link.springer.com/article/10.1186/s40862-020-00097-9 ·
Fu & Li (immediate vs delayed CF) https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/effects-of-immediate-and-delayed-corrective-feedback-on-l2-development/B4B2D455749B752BD4F6DD636ACD688F ·
Frontiers 2023 CF-timing review https://pmc.ncbi.nlm.nih.gov/articles/PMC9995700/ ·
Li/Li/Qian 2025 (interim CF replication) https://onlinelibrary.wiley.com/doi/full/10.1111/lang.70019 ·
Lyu, Lai & Guo 2025 (chatbot meta-analysis) https://onlinelibrary.wiley.com/doi/full/10.1111/ijal.12668 ·
plus modality/distributed-practice/LLM-CF sources (Sauro & Smith; CALL 2024; Frontiers in Education 2026; SSLA distributed practice) — see the full run output for the complete 24-source list.
