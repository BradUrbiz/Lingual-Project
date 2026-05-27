# Tutor Pedagogy & Conversation Guidance — Research + Design

**Date:** 2026-05-27
**Status:** Design / research session output. Phase ① is the first buildable increment.
**Owner:** (TBD)
**Related code:** `main.py` (`build_system_prompt`), `backend/services/assignment_resolver.py` (`build_assignment_system_prompt`, tutor-stance + ladder builders), `backend/routes/chat.py`, `backend/avatar_chat.py`.

---

## 1. Motivation

The tutor is competent but "not good enough" as a *teacher*. This is not a bug hunt — the goal is to raise the pedagogical ceiling: **implant genuine "teacherness" so the agent guides a conversation the way an excellent language teacher would**, on both free practice (`/app/learn`) and inside teacher assignments. The one concrete soft spot already observed is **direction & engagement** (free chat drifts; the agenda/learner-interest balance is off).

This document does three things:
1. Synthesizes the evidence on what makes a conversational language tutor good (the doctrine to encode).
2. Analyzes what Lingual's two prompt paths already do and where the gaps are.
3. Commits to a **phased architecture (①→②→③)** and fully specifies Phase ① as the first increment.

Constraints honored: stay locale-parametric (CLAUDE.md — language support is not a product initiative); no new persistence system (TECH_SPEC §1); no per-session runtime cost added in Phases ①–②; compliance gating untouched.

---

## 2. Research synthesis — the doctrine to encode

Two deep-research inputs inform this (an agent sweep on SLA→LLM-tutor pedagogy + engineering, and a second SLA-grounded report centered on conversational-CALL/TBLT meta-analyses). Condensed below; §2.1 and §2.6 were revised after the second input. Evidence is strong unless flagged.

### 2.1 Corrective feedback (revised after second research input)
- **Default to flow-friendly correction; escalate selectively.** Observational data (Lyster & Ranta tradition) shows teachers give ~57% recasts / ~30% prompts; recasts and clarification requests preserve the meaning-focused flow that the speaking-development meta-analyses identify as the actual driver of gains. → *Default first move on an error = brief recast or clarification request, not a teaching stop.*
- **Elicitation/prompts have an uptake edge — spend it where it counts.** Prompting self-correction produces more immediate learner repair than recasts (Lyster & Ranta 1997; Li 2022), but uptake ≠ acquisition and prompt-heavy correction taxes flow. → *Escalate to elicitation on repeated errors and on teacher-designated target forms; reserve explicit correction for accuracy-priority mode or communication-blocking errors.*
- **Focus on Form > Focus on Forms** (Long 1991; Ellis 2016): correct opportunistically inside meaningful talk, not by drilling. → *Correct only high-frequency, target, or communication-blocking errors; leave the rest to a short posttask review.*
- **Feedback is a policy, not a constant** — type/timing depend on learner level and L2/FL context. → *Keep feedback mode teacher-configurable and adapt to learner response.*

### 2.2 Pushing output & scaffolding
- **Output hypothesis** (Swain): learners must be *pushed* to produce stretch output; the struggle is the learning. → *Every tutor turn ends inviting more/longer production.*
- **ZPD scaffolding** (Vygotsky): least-support-first hint ladder (wait → cue → forced choice → model); fade support as the learner succeeds. → *Never skip rungs; stop scaffolding a structure after 2 successful self-corrections.*
- **Wait time**: humans intervene <1s; 3–5s dramatically increases output quality. → *In voice, enforce a silence tolerance before stepping in; in text, wait a full learner turn.*

### 2.3 Input & engagement (the soft spot)
- **Comprehensible input i+1** (Krashen — core principle sound, construct contested): calibrate complexity just above current level using the learner's own output as the gauge.
- **Interaction / negotiation of meaning** (Long): communication breakdowns are acquisitionally rich. → *Don't charitably resolve ambiguity — surface the gap and prompt repair.*
- **Dogme / emergent language** (Thornbury): mine what the learner *almost* said and teach from it. → *Note near-miss structures; recycle them as targets within a few turns.*
- **Teacher-talk-time < student-talk-time.** LLMs are structurally biased to monologue. → *Hard cap tutor turns at 2–3 sentences in practice mode.*
- **Affective filter** (contested but directionally useful): low anxiety helps; AI's low-stakes setting helps but can become *too* low-stakes. → *Open by lowering stakes; keep challenge present.*

### 2.4 Recycling & retention
- **Spaced retrieval** (Kim & Webb 2022 meta-analysis): one of the best-validated findings in learning science. → *Each target expression appears ≥2× per session in varied contexts; reference one prior-session target in the opening turn.* (Operationalizing SRS inside free conversation is an open design problem — flagged.)
- **Elaborative interrogation**: ask "why/when else?" when introducing a target. → *Don't just use a target — probe it.*

### 2.5 LLM-specific guardrails (structural failure modes)
- **Sycophancy / over-praise** (arXiv 2411.15287): reward-trained models over-validate, including *wrong* answers. → *Forbid reflexive "Perfect!/Great!"; neutral acknowledgment is the default; affirm only genuine self-corrections/breakthroughs; never affirm an incorrect form.*
- **Answer leakage** (Khanmigo): models cave to "just tell me," including indirect "give me a hint" loops. → *Don't supply the target form until the learner has made ≥1 attempt; resist indirect extraction.*
- **Grammar hallucination**: models confidently state wrong rules. → *Only correct high-confidence forms; if unsure, prompt rather than assert a rule.*
- **Script lock**: tutor follows the scenario even when the learner pivots. → *Follow the learner's direction first, then steer back.*

### 2.6 Top-5 evidence-backed levers (highest impact / effort)
1. Goal-oriented, situated task framing (meaning pressure) > open free conversation — the strongest structural moderator in the ReCALL speaking meta-analysis.
2. Minimize tutor talk, maximize learner output (turn cap + always-invite-production).
3. Least-support scaffold ladder + wait time.
4. Recycle target expressions within/across sessions + close with a short re-performance (task repetition).
5. Hard anti-sycophancy + never-give-the-answer guardrail.

Correction *shape* is a refinement, not a top-5 lever: flow-friendly default (recast/clarification) with target-aware escalation to elicitation (§2.1) — **not** a global flip to elicitation-first.

**All five are pure prompt content — no infrastructure required.** That is why Phase ① captures them first.

---

## 3. Current-state analysis

### 3.1 Two asymmetric prompt paths
| | Free chat (`/app/learn`) | Assignment chat |
|---|---|---|
| Builder | `build_system_prompt` (`main.py:329`) | `build_assignment_system_prompt` (`assignment_resolver.py:1588`) |
| Pedagogy depth | persona + proficiency + language-mix policy + light "conversation style" | spine + targets + teacher guidance + **TUTOR STANCE** (feedback/correction/scaffold/output/clarification/review/scope) + **task-template directive** |
| Shared "tutor core" | **none — each path reinvents conversation style** | — |

Both builders feed every surface: `chat.py:445/462` (realtime + text), `avatar_chat.py:456` (avatar). A shared core injected into both builders therefore reaches all surfaces.

### 3.2 Gap analysis (doctrine vs. code)
- ✅ **Correction ladder shape is sound** (revised judgment). `assignment_resolver.py:53` sets `recast_default: True` → recast first, escalate to elicitation on repeat, model on failure. The second research input confirms a flow-friendly default *with escalation* is the evidence-aligned shape — **do not flip it.** The refinement needed is narrow: trigger elicitation sooner for teacher-*target* errors, and make `accuracy_first` lean explicit (§6.3).
- ❌ **No anti-sycophancy rule** on either path.
- ❌ **No recycling cadence** — assignment lists `TARGETS` but never instructs reuse frequency.
- ❌ **No emergent-language mining** anywhere.
- ❌ **No negotiation-of-meaning** instruction.
- ❌ **Free chat lacks**: turn-length cap, wait time, scaffold ladder, output pushing, direction-setting (← the observed soft spot).

### 3.3 Lesson from the deleted pedagogy engine
Commit `ede4b25` deleted `backend/services/pedagogy/` (`correction_ladder`, `feedback_mode`, `scaffold_ladder`, `output_pressure`, `task_template`, `template_catalog`, `policies`) and inlined helpers into the resolver. The commit message is explicit: it was removed because it **served the dead curriculum-package code path**, not because modular pedagogy was wrong. **Design rule for this work: pedagogy modules must be content-source-agnostic** — they describe *how to teach*, never *what content to teach*, so they survive content-pipeline churn (Canvas, GPT scenario gen, custom prompt, free chat).

---

## 4. Reframe — "skill packs" for the tutor

The user's instinct ("pedagogy skill packs that load to the agent") is the right *pattern*, with one correction confirmed by both research threads:

> Anthropic **Agent Skills (`SKILL.md`)** and **Prompt Decorators** (arXiv 2510.19850) are **content-organization patterns executed by backend code**, *not* runtime mechanisms inside a third-party LLM. Claude Code skills load into the dev assistant, **not** into the OpenAI tutor.

So a pedagogy skill pack = a **versioned, named prompt module the `assignment_resolver`/core composes** into the OpenAI system prompt, selected by `(task_type, lesson_phase, locale)`. A pack change is a backend deploy + A/B test, not a model change. This is Phase ②. Phase ① is the doctrine that those packs will eventually carry, shipped first as a single shared core.

---

## 5. Architecture — phased ①→②→③

**① Shared Tutor Core (static enrichment).** One evidence-backed doctrine block both builders inherit + free-chat parity + fix the four gaps. Zero infra, zero latency, zero cost.

**② Skill-pack registry + eval harness.** A `SkillPackRegistry` of small versioned packs composed per `(task_type, phase, locale)`; a simulated-student + LLM-as-judge eval harness so pack changes are measured, not guessed. Medium effort; this is where the "skill pack" vision lives.

**③ Runtime director (deferred, gated).** A cheap between-turns model re-steers via `session.update` / `response.create` when it detects drift. Real power, but +300–600ms latency, added cost, and voice instruction-adherence is only ~30% on OpenAI's own MultiChallenge-audio benchmark — so only pursue if ② eval shows static composition hits a ceiling.

**Rationale for phasing:** all top-5 levers are prompt content (① captures them in days); ② makes pedagogy modular and *testable* before we spend money/latency on ③; budget posture (Opus-on-request, cost-conscious) favors zero-runtime-cost phases first.

---

## 6. Phase ① — Shared Tutor Core (detailed, buildable)

### 6.1 Where it lives
New module **`backend/services/tutor_core.py`** — content-source-agnostic (the lesson from §3.3). Exposes:
```python
def build_tutor_core(*, language_name: str, learning_locale: str, surface: str) -> str
    # surface ∈ {"free_practice", "assignment"}
```
It returns the shared doctrine block. Injected by:
- `main.py:build_system_prompt` → prepend core (surface="free_practice").
- `assignment_resolver.py:build_assignment_system_prompt` → prepend core (surface="assignment"), *before* the existing spine/targets/stance overlay.

`custom_prompt` assignments (scaffold-free, LIMITATIONS #14) **still skip the overlay**, but SHOULD they get the core? **Decision: no** — `custom_prompt` is contractually "teacher's raw instructions only." The core is part of the scaffolded experience. Keep the early-return at `assignment_resolver.py:1594` as-is.

### 6.2 Content of the core (the doctrine, as prompt)
Locale-parametric — `{language_name}` interpolated, never hard-coded. Critical guardrails placed **last** (recency bias; voice adherence). Lean (~250–350 tokens) to protect context budget and voice instruction-following. Worded **explicitly and unconditionally** (voice models follow explicit rules far better than implicit/contextual ones).

Sections:
1. **Identity & talk economy** — "You are a language teacher, not a chat partner. Keep your turns to 2–3 sentences. Every turn ends by inviting the learner to produce more {language_name}. The learner should talk more than you."
2. **Correct lightly, scaffold instead of solving** — "On an error, keep correction brief and flow-friendly (a natural recast or a quick 'did you mean…?') and keep the conversation moving; only make a teaching stop for repeated, target, or meaning-blocking errors. When the learner is *stuck* (can't produce at all), don't hand over the answer — prompt them to try first and resist 'just tell me' / 'just a hint' shortcuts."
3. **Scaffold ladder + wait time** — "Hold brief silence first. Then escalate least-to-most: wait → situational cue → forced choice → model + retry. Never jump to the answer. Stop scaffolding a structure after two successful self-corrections."
4. **Push output** — "Don't accept one-word answers as done. Ask for one more detail, reason, or example. Calibrate difficulty to the learner's demonstrated output."
5. **Follow the learner, then steer; confirm what you heard** — "Follow the learner's conversational direction first. Mine what they *almost* said and recycle it. When their meaning — or, in voice, what you heard — is unclear, ask a quick confirmation ('I heard X — is that right?') instead of papering over it. This both repairs communication and guards against treating a mishearing as a learner error."
6. **Close with a re-do** — "End the session with one short re-performance mission, not a lecture: say it again more naturally/politely, perform the same function in a new situation, or redo it using two target expressions. Repetition with adjustment is how speaking becomes automatic."
7. **GUARDRAILS (last):** "Do not over-praise. Neutral acknowledgment is default; affirm only real self-corrections or breakthroughs; never affirm an incorrect form. Only correct forms you are confident about; if unsure, prompt instead of asserting a rule."

### 6.3 Specific behavior changes
- **Refine the correction ladder — do NOT flip the default** (revised). Keep `recast_default: True` (flow-friendly first move). Two narrow changes instead: (a) when an error hits a teacher-designated **target** form, escalate to elicitation immediately rather than waiting for `elicitation_repeat_threshold` repeats; (b) ensure `accuracy_first` mode leans toward explicit correction sooner. No behavior change for existing assignments' stored policies; no inversion of the default. Smaller and better-evidenced than the original spec's proposed flip.
- **Recycling cadence** (assignment, where targets exist): add to targets section — "Weave each target expression into your own speech once early, then engineer a natural opportunity for the learner to use it later; reference one prior-session target in your opening if available." Cross-session reference is best-effort in ① (no SRS state yet — flagged as ② follow-on).
- **Free-chat parity & direction** (the soft spot): free chat inherits the full core. Because free chat has no teacher targets and the evidence favors goal-oriented over open conversation, the **direction move** offers a *situated mini-scenario*, not just a topic: "Open by offering 2–3 concrete situations with a role and a goal (e.g., 'order food and sort out a problem with your order'), or pick up the learner's stated interest and give it a small communicative goal; gently return to it if the conversation stalls — without overriding a learner who wants to go elsewhere." This addresses drift while preserving learner-led flow.
- **Posttask re-performance** (both surfaces): the core's "close with a re-do" instruction is the implementation — one short repetition mission at session end. Pure prompt content, Phase ①.
- **Voice input confirmation (ASR-aware)**: in voice sessions, when transcription confidence is low or meaning is unclear, the tutor confirms ("I heard X — right?") before correcting, so an ASR mishear is never treated as a learner error. Lives in the core (§6.2 #5); no new infra in Phase ①.

### 6.4 Interaction with existing knobs
The core states *principles*; the assignment **TUTOR STANCE / feedback-mode / output-pressure** continue to set *parameters* (thresholds, pressure level, scope). On conflict, the more specific assignment directive wins for that parameter (mirrors the existing "language-mix level wins over proficiency" precedence rule). The core never sets the English-vs-target ratio — that stays owned by the language-mix policy.

### 6.5 Voice/Realtime considerations
- Critical guardrails last in the assembled prompt (recency).
- Keep total system prompt lean; the core adds ~300 tokens, not 1,500.
- Explicit, unconditional wording (no "when the learner seems frustrated…").
- No `session.update` / per-turn machinery in ① — purely the session-start prompt. Runtime steering is ③.

### 6.6 Testing (Phase ①)
- Unit: `tutor_core` renders for each locale in `ALLOWED_LEARNING_LOCALES`; guardrails appear last; no hard-coded language name; `custom_prompt` still bypasses.
- Unit: correction-ladder refinement — `recast_default` stays `True`; a teacher-*target* error escalates to elicitation without waiting for the repeat threshold; `accuracy_first` leans explicit; existing stored policies unchanged.
- Unit/snapshot: core contains the "close with a re-do" instruction; voice path contains the confirmation move.
- Snapshot: free-chat and assignment prompts contain the six core sections; free-chat prompt contains the direction move.
- Follows existing test conventions (`backend/tests/test_*`, `unittest`); extend `test_pedagogy_prompting.py`.

---

## 7. Phase ② — Skill-pack registry + eval harness (sketch)

**Registry.** `backend/services/skill_packs/` — small versioned markdown/string packs, content-source-agnostic, each <~200 tokens (e.g., `elicitation_correction_v1`, `output_pushing_v1`, `scaffold_ladder_v1`, `recycling_v1`, `warmup_v1`, `closing_review_v1`, `negotiation_of_meaning_v1`). A `SkillPackRegistry` maps `(task_type, lesson_phase, locale)` → ordered pack keys; the core becomes the always-on base, packs compose on top. In-repo versioned strings to start (no new persistence per TECH_SPEC §1); Firestore-backed packs only if teacher-authored packs are later needed.

**Lesson phases.** Compact 3-stage model grounded in the pretask → task → posttask literature: `pretask (brief: 3–5 key expressions + situation briefing + planning) → task (situated, goal-driven, meaning pressure) → posttask (short reflection + re-performance/repetition)`. Phases select which packs load. Keep pretask short — over-preparing depresses spontaneity and positive affect (TESOL Quarterly / SSLA 2025). Phase tracking in ② is heuristic (turn count / signals); structured phase signals are an ③-adjacent concern.

**Learner-model layer.** Feeds pack/phase selection and adaptation: current level, recent success rate, target-form mastery, error patterns, task-completion likelihood, and — per the second research input — **willingness-to-communicate (WTC) and anxiety signals** ("is this student ready to speak right now," not just their CEFR level; CALICO micro-adaptivity, *System* WTC↔proficiency work). These need session signals we don't yet capture, so this is squarely Phase ②+, not ①. It is also the layer the eval harness validates adaptation against.

**Eval harness** (the reason ② exists): a simulated-student model (LLM at a defined proficiency + error profile) runs N scripted sessions against the tutor; an LLM-as-judge scores transcripts on a pedagogy rubric (mistake identification, guidance provision, output pushing, talk-time ratio, anti-sycophancy, target recycling, language appropriateness — cf. BEA 2025 / arXiv 2412.09416 taxonomy). Gate: a pack version must beat the incumbent on ≥3 rubric dimensions over the simulated set before promotion. ~$0.05/50 sessions at mini prices. This is what converts "teacherness" from vibes to a regression-tested metric.

---

## 8. Phase ③ — Runtime director (deferred, gated)
A between-turns GPT-4o-mini call on the last 5–10 turns emits a one-sentence steering instruction injected via `session.update` / `response.create`, triggered *only* on drift signals (repeated error, N turns with no target-language token, learner stall). +300–600ms (lands in the natural end-of-turn VAD gap), ~$0.0003/triggered turn. **Gate to build it: ② eval data shows static composition (①+②) plateaus below target on the rubric.** Voice instruction-adherence (~30% MultiChallenge-audio) means steering reliability must be proven, not assumed.

## 8.1 Parallel track (out of scope here): multimodal voice-first + text-supported UI
The second research input emphasizes that *mixed modality* (voice with selective text support) outperforms voice-only in the speaking meta-analysis — captions, key-expression highlights, replay, pronunciation comparison, and condensed-recast text help lower-proficiency learners locate and repair errors, and ASR confidence should be surfaced visually. This is a **frontend/UX track** (touches `useRealtimeChat` and the realtime/avatar UI), separate from the pedagogy-prompt work in this spec. Noted so it isn't lost; it should be scoped on its own and is **not** part of Phases ①–③.

---

## 9. Risks, tradeoffs, open questions
- **Prompt drift over long voice sessions** (lost-in-the-middle; ~30% audio adherence). Mitigated in ① by lean core + critical-rules-last; fuller mitigation (reminder injection, `session.update` refresh) is ②/③.
- **Recycling without SRS state.** ① does best-effort in-session recycling; true cross-session spaced retrieval needs per-target acquisition state — deferred, flagged as open.
- **Correction-calibration risk (both directions).** Target-aware elicitation + `accuracy_first` explicitness could feel naggy if over-tuned; conversely, the flow-friendly recast default risks under-correcting if escalation triggers are too lax. The eval harness (②) is the safety net; until then, `fluency_first` ↔ `accuracy_first` are the teacher-facing escape hatches.
- **Affective-filter / anxiety claims are contested** — treat stake-lowering as UX nicety, not a measured lever.
- **AI-tutor product outcome figures** (Duolingo/Khanmigo/TalkPal) are vendor-reported, not RCTs — directional only.

## 10. Success criteria
Phase ① ships when: core injects on all surfaces; free chat reaches assignment-level pedagogy + has a situated direction move + a re-performance close; the correction ladder is refined (recast-default kept, target errors escalate to elicitation sooner, `accuracy_first` leans explicit); voice input confirmation present; anti-sycophancy + never-give-answer guardrails present; all locales render; tests green. *Whether teacherness actually improved* is answered by the ② eval rubric — that's why ② is not optional.

## 11. Doc-sync follow-ups
- `TASKS.md`: add Phase ① items (tutor_core module + injection + correction-ladder refinement + free-chat situated direction + posttask re-do + voice-input confirmation + tests).
- `LIMITATIONS.md`: note ① in-session-only recycling (no cross-session SRS state); `custom_prompt` intentionally excluded from the core.
- `TECH_SPEC.md`: document `tutor_core` as a content-source-agnostic prompt layer composed ahead of assignment overlay; note Phase ② registry direction.

## 12. Key sources
**Input A (SLA → LLM-tutor pedagogy + engineering):** Lyster & Ranta 1997; Li 2022 meta-analysis (Wiley 10.1155/2022/3444160); Ellis 2016 (FonF); Swain output hypothesis; Vygotsky ZPD; Krashen i+1 (+ Frontiers 2025 critique); Long interaction hypothesis; Thornbury Dogme; Kim & Webb 2022 spaced practice; Sycophancy arXiv 2411.15287; Dialogic Pedagogy for LLMs arXiv 2506.19484; Training LLM tutors arXiv 2503.06424; BEA 2025 Shared Task arXiv 2507.10579 + taxonomy arXiv 2412.09416; Agent Skills arXiv 2602.12430; Prompt Decorators arXiv 2510.19850; OpenAI Realtime prompting guide + gpt-realtime release; Khanmigo / Duolingo Max / Speak / TalkPal public design notes.

**Input B (conversational-CALL / TBLT line):** Bibauw et al. — conversational systems for language learning (typology: branching / form-focused / goal-oriented / reactive); ReCALL meta-analysis on conversational CALL & L2 speaking (moderators: system type, meaning constraint, modality); *Language Teaching* TBLT overview + critiques; Ellis — focus on form (*Language Teaching Research*); oral corrective-feedback observational meta-analysis (~57% recast / ~30% prompt); SSLA pretask/task/posttask placement study; TESOL Quarterly / SSLA 2025 on pre-task vocabulary support & affect; *Modern Language Journal* self-assessment + task repetition; *System* WTC ↔ oral proficiency; JSLP L2 pronunciation (intelligibility/comprehensibility) + ASR feedback; CALICO data-driven learner model / micro-adaptivity; systematic review on teacher–AI collaboration & teacher presence. *(Report's `citeturn…` markers are tool artifacts, not independently verified; the named sources are real and consistent with Input A.)*
