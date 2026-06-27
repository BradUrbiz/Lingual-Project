# Teacher FDE — Phase 2 Spike: prose → structured input

Status: **Spike DONE 2026-06-28 — hypothesis SUPPORTED (with a boundary).** Not a shipped feature.
Last updated: 2026-06-28
Owner: Product + Engineering

> A throwaway hypothesis-validation spike, run BEFORE the real Phase 0 sign-off, to de-risk the
> single strongest synthetic-pre-validation finding (`PHASE0_SYNTHETIC_PREVALIDATION.md` #1, 3/3
> unanimous): **teachers won't compose from a variables table — they want their existing prose
> auto-extracted into structured input, then confirm/correct.** This also directly answers Polón's
> D8 commit condition ("authoring must cost ≤ my current two sentences"). Spike code lived in the
> session scratchpad and is not in the app; the validated extraction shape is preserved below for
> Phase 2 proper.

## Hypothesis

Given a teacher's natural-language "expectations" prose, the text LLM can infer engine-ready
structured input (objectives, target expressions/vocabulary, focus grammar, task_type/archetype,
scenario, persona, success criteria, modality, intensity) at high enough fidelity that the teacher
**confirms/corrects a populated draft** instead of composing from blank fields.

## Method

- **Real data, not invented:** Polón's verbatim Canvas prose for four tasks of varying richness
  (L1 *relaciones*, L2 *en la ciudad*, L3 *los medios*, and the deliberately thin Cap 5 "Guided
  Practice" reference). Pulled read-only 2026-06-28.
- **Real model pattern:** `gpt-5.4-mini-2026-03-17`, `reasoning_effort="high"`,
  `response_format=json_object` — the same text-LLM pattern the engine uses (ask/coach services).
- **Provenance metric:** every extracted field is tagged `explicit` (grounded in the prose) vs
  `inferred` (model guess) + confidence. **% explicit ≈ inverse of the teacher's correction burden.**
- **Gold comparison (L1):** extraction-from-prose vs. the hand-authored `DESIGN_LANGUAGE.md` §C
  worked example.

## Results — run 1 (prose only)

| Sample (richness) | % explicit | Target expr / vocab | Behavior |
|---|---|---|---|
| **L3 medios** (rich, explicit prompts) | **65%** | 8 expr, 4 vocab sets @ 0.95–0.98 | near-complete draft; 0 clarifying Qs |
| **L2 ciudad** (medium) | 37% | 2 expr, 3 vocab @ 0.92–0.96 | solid draft; 1 clarifying Q |
| **L1 relaciones** (rich but terse) | 33% | 3 expr @ 0.98–0.99, 5 vocab @ 0.97 | solid lexical core; 1 clarifying Q |
| **Cap 5 Guided** (THIN — just a Vocabulario ref) | **9%** | mostly inferred @ 0.5–0.7 | **honestly asked 2 clarifying Qs, did not hallucinate** |

**Provenance tracks input richness exactly** — rich prose → high-confidence draft (low correction
burden); thin prose → mostly inferred **+ clarifying questions** rather than confident hallucination.
That graceful-degradation is precisely the behavior the "confirm/correct" UX needs.

**Lexical core extracts faithfully.** Target expressions and vocabulary present in the prose came out
at 0.95–0.99, marked `explicit`. Scenarios and personas (inferred) were sensible and made the targets
*necessary* (the §A spine). Modality → `voice` and intensity → `target_led`/`target_only` defaulted
correctly for advanced interpersonal.

**L1 fidelity vs the §C gold:** archetype **MATCH** (`opinion_argumentation`). Target expressions:
faithful to the prose (the gold's `Conozco a gente que ___` is a hand-refinement of Polón's literal
`Conozco gente…`; `Me siento… cuando…` matched — a fuzzy-matcher artifact under-counted these). The
one real lexical gap: the gold split "¿…prefieres evitar?" into a separate `Prefiero evitar…` target.

## The one real boundary — and its fix (run 2)

**`focus_grammar` cannot be reliably pulled from prose alone**, because the teacher's grammar intent
lives in the **curriculum** (which Imagina lección → which Estructuras), not in the expectations
sentence. Run 1 inferred grammar from the vocabulary domain — sometimes right (ser/estar for
personalities, gustar for emotions), sometimes generic — and always at lower, **variable** confidence.

**Run 2 tested the fix:** pair the prose with a one-line curriculum map (Imagina L1 Estructuras = 1.1
present · 1.2 ser & estar · 1.3 gustar). Result:

| | focus_grammar | confidence |
|---|---|---|
| prose only | "expressing desires with querer/preferir", "ser/estar + adjectives", "gustar" | inferred / 0.78–0.90 (varies run-to-run) |
| **prose + curriculum map** | **presente · ser · estar · gustar y verbos similares** | **explicit / 0.99 (exact, stable)** |

The curriculum map converts the weakest field from "inferred-and-variable" to "explicit-and-exact,"
pinned to the actual textbook lección. **And Polón's prose ALWAYS references the Imagina chapter**
(`"based on Imagina, Capítulo 5 Vocabulario…"`), so the hook to look up the map is already in his
input. (Note: the §C gold's "subjunctive in adjective clauses" appears to over-reach the real L1
Estructuras — a curriculum-grounded extraction is arguably *more* correct than the hand-authored gold.)

## Verdict

**SUPPORTED, with a precise boundary.** Prose-extraction reliably produces the lexical+structural core
(expressions, vocabulary, objectives, scenario, persona, success criteria, modality, intensity) from
real teacher prose, degrades honestly on thin input, and — paired with a textbook→Estructuras map the
prose already references — fills the one field (grammar) it can't infer. The teacher reviews a
populated, mostly-correct draft instead of a blank form. That is the win all three personas demanded
and the direct answer to the D8 commit condition.

## Phase 2 design implications (for the real build, post-sign-off)

1. **Authoring surface = paste-prose → extract → confirm/correct**, not a variables form. The §B
   variable table is the *engine layer the extractor targets*, never the teacher's blank page.
2. **Pair extraction with a curriculum map** (Imagina Lección → Vocabulario + Estructuras). Seed it
   from `DESIGN_PARTNER_CURRICULUM.md`; the prose's "Capítulo X" reference is the lookup key. This is
   what makes `focus_grammar` (a high-evidence engine lever) reliable.
3. **Surface provenance in the UI.** Show `explicit` fields as pre-confirmed and `inferred` /
   low-confidence ones as "review this" — so the teacher's eye goes straight to the ~35% that needs
   correction. Provenance is also the honest readiness signal (§D).
4. **Thin input → clarifying questions, never silent hallucination.** The extractor already does this;
   keep it as the contract (it's the anti-degradation guarantee the CHARTER demands).
5. **Reusable extraction contract** (validated this spike): system prompt = field schema + §C
   archetype taxonomy + per-field `{value, source: explicit|inferred, confidence}` + conservative
   "prefer a clarifying question over a hallucinated target" rule + optional curriculum-context block.

## Caveats / what this does NOT settle

- **Generative variance:** grammar inference (prose-only) varied run-to-run — another reason to pin it
  with the curriculum map rather than trust inference.
- **One teacher, one textbook (Imagina), Spanish only.** Fidelity on other teachers/series/locales is
  unproven; the approach is locale-parametric but untested elsewhere.
- **No UI, no time-on-task measured.** The personas' "≤ my two sentences" bar is about *wall-clock in
  his hands* — only a real teacher with a real interface settles D8. This spike validates the *engine
  feasibility*, not the end-to-end UX.
- **Still pre-sign-off.** This strengthens a Phase 2 candidate; it does not close Phase 0. The real
  Polón session remains the gate.
