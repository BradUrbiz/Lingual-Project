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

Three deep-research inputs inform this: (A) an agent sweep on SLA→LLM-tutor pedagogy + engineering; (B) an SLA-grounded report on conversational-CALL/TBLT meta-analyses; (C) a comprehensive design report adding a turn-level decision algorithm, teacher-constraint compilation, an evaluation framework, and Korea/US governance. Condensed below; §2.1 was revised across inputs into the feedback-routing matrix. Evidence is strong unless flagged.

### 2.1 Corrective feedback — routing matrix (revised across all three inputs)
The correction decision is **not** one default; it routes on **target type × learner affect**, atop a flow-friendly base.
- **Flow-friendly base.** Teachers give ~57% recasts / ~30% prompts; recasts/clarification requests preserve the meaning-focused flow the speaking meta-analyses credit for gains. → *Default first move on a non-critical error = brief recast or clarification request, not a teaching stop.*
- **Route by target type (Input C).** Prompts beat recasts **specifically for rule-based grammar** targets (Lyster, SSLA); recasts/models fit formulaic and lexical targets and fast flow. → *On an error that hits a teacher-designated rule-based grammar form (`focus_grammar`), prompt/elicit first; on a `target_expressions`/vocabulary slip, recast or briefly model. Escalate either on repeats; reserve explicit correction for accuracy-priority mode or communication-blocking errors.*
- **Route by affect (Input C).** High-anxiety learners benefit more from recasts than from metalinguistic feedback (Rassaei). → *Bias toward recast under learner anxiety / low WTC, even on a grammar target (needs an affect signal — Phase ②).*
- **Focus on Form > Focus on Forms** (Long 1991; Ellis 2016): correct opportunistically inside meaningful talk, not by drilling. → *Correct only high-frequency, target, or communication-blocking errors; bundle the rest into a short posttask review.*
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

Correction *shape* is a refinement, not a top-5 lever: a flow-friendly base with a **routing matrix** (target-type × affect, §2.1) — **not** a global flip to elicitation-first.

**All five have a prompt-only first slice — but not all are fully enforceable by prompt.** Phase ① captures the doctrine immediately in the session-start prompt and existing assignment prompt sections; Phases ②–③ add the runtime/state machinery needed to measure and enforce the turn-level parts.

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
- ✅ **Correction ladder shape is sound** (revised judgment). `assignment_resolver.py:53` sets `recast_default: True` → recast first, escalate on repeat, model on failure. Inputs B–C confirm a flow-friendly base is the evidence-aligned shape — **do not flip it.** The refinement is the routing matrix (§2.1): `focus_grammar` (rule-based) errors prompt first, `target_expressions`/vocab errors recast, `accuracy_first` leans explicit (§6.4).
- ❌ **No anti-sycophancy rule** on either path.
- ❌ **No recycling cadence** — assignment lists `TARGETS` but never instructs reuse frequency.
- ❌ **No emergent-language mining** anywhere.
- ❌ **No negotiation-of-meaning** instruction.
- ❌ **Free chat lacks**: turn-length cap, wait time, scaffold ladder, output pushing, direction-setting (← the observed soft spot).

### 3.3 Lesson from the deleted pedagogy engine
Commit `ede4b25` deleted `backend/services/pedagogy/` (`correction_ladder`, `feedback_mode`, `scaffold_ladder`, `output_pressure`, `task_template`, `template_catalog`, `policies`) and inlined helpers into the resolver. The commit message is explicit: it was removed because it **served the dead curriculum-package code path**, not because modular pedagogy was wrong. **Design rule for this work: pedagogy modules must be content-source-agnostic** — they describe *how to teach*, never *what content to teach*, so they survive content-pipeline churn (Canvas, GPT scenario gen, custom prompt, free chat).

---

## 4. Reframe — "skill packs" for the tutor

The user's instinct ("pedagogy skill packs that load to the agent") is the right *pattern*, with one correction confirmed across the research:

> Anthropic **Agent Skills (`SKILL.md`)** and **Prompt Decorators** (arXiv 2510.19850) are **content-organization patterns executed by backend code**, *not* runtime mechanisms inside a third-party LLM. Claude Code skills load into the dev assistant, **not** into the OpenAI tutor.

So a pedagogy skill pack = a **versioned, named prompt module the `assignment_resolver`/core composes** into the OpenAI system prompt, selected by `(task_family, lesson_phase, locale)`. A pack change is a backend deploy + A/B test, not a model change. This is Phase ②. Phase ① is the doctrine that those packs will eventually carry, shipped first as a single shared core.

---

## 5. Architecture — phased ①→②→③

**① Shared Tutor Core (static enrichment).** One evidence-backed doctrine block both builders inherit + free-chat parity + fix the prompt-level gaps. Zero infra, zero latency, zero cost.

**② Skill-pack registry + eval harness + coach track.** A `SkillPackRegistry` of small versioned packs composed per `(task_family, phase, locale)`; a simulated-student + LLM-as-judge eval harness so pack changes are measured, not guessed; and the **coach track** (§7.1) — a parallel correction model + side-channel UI that moves corrective feedback off the main conversation (flow by default, uptake by exception). Medium effort; this is where the "skill pack" vision lives.

**③ Runtime director (deferred, gated).** A cheap between-turns model re-steers via `session.update` / `response.create` when it detects drift. Real power, but +300–600ms latency, added cost, and voice instruction-adherence is only ~30% on OpenAI's own MultiChallenge-audio benchmark — so only pursue if ② eval shows static composition hits a ceiling.

**Rationale for phasing:** all top-5 levers have a prompt-first version (① captures them in days); ② makes pedagogy modular and *testable* before we spend money/latency on ③; budget posture (Opus-on-request, cost-conscious) favors zero-runtime-cost phases first.

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

`custom_prompt` assignments (scaffold-free, LIMITATIONS #14) **still skip the overlay**, but SHOULD they get the core? **Decision: no** — `custom_prompt` is contractually "teacher's raw instructions only." The core is part of the scaffolded experience. Keep the early-return at `assignment_resolver.py:1594` as-is. This is a deliberate research deviation: scaffold-free assignments bypass the shared pedagogy layer, target-driven recycling, and prompt-level feedback doctrine unless the teacher writes those instructions themselves.

### 6.2 Content of the core (the doctrine, as prompt)
Locale-parametric — `{language_name}` interpolated, never hard-coded. Critical guardrails placed **last** (recency bias; voice adherence). Lean (~250–350 tokens) to protect context budget and voice instruction-following. Worded **explicitly and unconditionally** (voice models follow explicit rules far better than implicit/contextual ones).

Sections:
1. **Identity & talk economy** — "You are a language teacher, not a chat partner. Keep your turns to 2–3 sentences. Every turn ends by inviting the learner to produce more {language_name}. The learner should talk more than you."
2. **Correct lightly, scaffold instead of solving** — "On an error, keep correction brief and flow-friendly (a natural recast or a quick 'did you mean…?') and keep the conversation moving; only make a teaching stop for repeated, target, or meaning-blocking errors. When the learner is *stuck* (can't produce at all), don't hand over the answer — prompt them to try first and resist 'just tell me' / 'just a hint' shortcuts."
3. **Scaffold ladder + wait time** — "Hold brief silence first. Then escalate least-to-most: wait → situational cue → forced choice → model + retry. Never jump to the answer. Stop scaffolding a structure after two successful self-corrections."
4. **Push output** — "Don't accept one-word answers as done. Ask for one more detail, reason, or example. Calibrate difficulty to the learner's demonstrated output."
5. **Follow the learner, then steer; confirm what you heard** — "Follow the learner's conversational direction first. Mine what they *almost* said and recycle it. When their meaning — or, in voice, what you heard — is unclear, ask a quick confirmation ('I heard X — is that right?') instead of papering over it. This both repairs communication and guards against treating a mishearing as a learner error."
6. **Close with a re-do** — "End the session with one short re-performance mission, not a lecture: say it again more naturally/politely, perform the same function in a new situation, or redo it using two target expressions. Repetition with adjustment is how speaking becomes automatic."
7. **GUARDRAILS (last):** "Do not over-praise. Neutral acknowledgment is default; affirm only real self-corrections or breakthroughs; never affirm an incorrect form. Only correct forms you are confident about; if unsure, prompt instead of asserting a rule. In voice, correct a pronunciation or word-level error only when recognition is high-confidence; otherwise confirm what you heard or defer to the teacher — never treat a probable mishearing as a learner error."

### 6.3 Prompt approximation vs. enforceable behavior
Phase ① is a deterministic prompt-composition change. It reaches both assignment and free-practice sessions because those sessions receive one assembled system prompt at startup (`chat.py` realtime/text paths), but it does not observe every turn with independent state. The implementation contract is therefore:

| Research-backed behavior | Phase ① prompt approximation | Phase ②/③ enforcement path | Boundary |
|---|---|---|---|
| Wait time / silence tolerance | State the scaffold ladder and keep the existing `silenceToleranceMs` wording in assignment `TUTOR STANCE`. | Realtime turn detector / coach track decides when a stall is real and when to hold space. | ① can instruct patience; it cannot guarantee timing if VAD or model turn-taking behaves differently. |
| ASR-confidence gating | Core says to confirm what was heard before correcting uncertain voice input. | Coach track consumes transcript confidence / ASR metadata and blocks correction below threshold; UI can surface uncertainty. | ① can reduce false correction by wording; only ②+ can make confidence a hard gate. |
| Target recycling | Assignment targets section tells the tutor to model each target early and engineer later learner use. | Coverage tracker records target use, missed targets, and prior-session targets for spaced retrieval. | ① handles in-session reuse only; cross-session SRS needs state. |
| One-focus correction | Core and `TUTOR STANCE` say to correct only one high-value issue and bundle the rest. | Coach track selects one promoted issue per turn and accumulates non-critical issues for posttask review. | ① biases the main model; ② makes correction selection testable and deduplicated. |
| Talk-time ratio / output pressure | Core caps tutor turns at 2–3 sentences; output policy presses for longer learner turns. | Eval harness scores tutor/learner word ratio; runtime director can re-steer if the tutor monologues. | ① can cap style; ②/③ measure and rescue drift. |

### 6.4 Specific behavior changes
- **Implement the correction routing matrix — do NOT flip the default** (revised across inputs, see §2.1). Keep `recast_default: True` as the flow-friendly base. Route instead: (a) an error on a teacher-designated **rule-based grammar** target (`focus_grammar`) → prompt/elicit first, rather than waiting for `elicitation_repeat_threshold` repeats; (b) a `target_expressions`/vocabulary slip → recast or briefly model; (c) `accuracy_first` mode leans explicit sooner; (d) bias toward recast under learner anxiety / low WTC (Phase ②, needs an affect signal). No behavior change for existing assignments' stored policies; no inversion of the default. **Keep this inline correction intentionally light** — in Phase ② it migrates to the coach track (§7.1), so don't over-build inline correction machinery now.
- **Compile existing teacher constraints in Phase ①, not just later.** Phase ① does not build the full Input C hard/soft/prohibited/rubric compiler, but it must compile the fields Lingual already has into explicit prompt behavior:
  - `focusGrammar` / `focus_grammar` → mark rule-based grammar targets as prompt-first / self-repair-first, especially under `accuracy_first`.
  - `targetExpressions` / `targetVocabulary` → model once early, create a natural later opportunity for learner production, recast or briefly model slips, and feed end-review/re-do prompts.
  - `feedbackPolicy.mode` → set intervention aggressiveness (`fluency_first` delays interruption, `balanced` escalates repeated target slips, `accuracy_first` cues repair sooner).
  - `scaffoldPolicy` / `outputPolicy` → preserve the existing silence ladder and learner-output pressure in `TUTOR STANCE`.
  - `teacherNotes` / success criteria → constrain the communicative goal without turning notes into hidden private instructions; teachers should assume notes can shape student-facing behavior.
- **Recycling cadence** (assignment, where targets exist): add to targets section — "Weave each target expression into your own speech once early, then engineer a natural opportunity for the learner to use it later; reference one prior-session target in your opening if available." Cross-session reference is best-effort in ① (no SRS state yet — flagged as ② follow-on).
- **Free-chat parity & direction** (the soft spot): free chat inherits the full core. Because free chat has no teacher targets and the evidence favors goal-oriented over open conversation, the **direction move** offers a *situated mini-scenario*, not just a topic: "Open by offering 2–3 concrete situations with a role and a goal (e.g., 'order food and sort out a problem with your order'), or pick up the learner's stated interest and give it a small communicative goal; gently return to it if the conversation stalls — without overriding a learner who wants to go elsewhere." This addresses drift while preserving learner-led flow.
- **Posttask re-performance** (both surfaces): the core's "close with a re-do" instruction is the implementation — one short repetition mission at session end. Pure prompt content, Phase ①.
- **Voice input confirmation (ASR-aware)**: in voice sessions, when transcription confidence is low or meaning is unclear, the tutor confirms ("I heard X — right?") before correcting, so an ASR mishear is never treated as a learner error. Lives in the core (§6.2 #5); no new infra in Phase ①.

### 6.5 Interaction with existing knobs
The core states *principles*; the assignment **TUTOR STANCE / feedback-mode / output-pressure** continue to set *parameters* (thresholds, pressure level, scope). On conflict, the more specific assignment directive wins for that parameter (mirrors the existing "language-mix level wins over proficiency" precedence rule). The core never sets the English-vs-target ratio — that stays owned by the language-mix policy.

### 6.6 Voice/Realtime considerations
- Critical guardrails last in the assembled prompt (recency).
- Keep total system prompt lean; the core adds ~300 tokens, not 1,500.
- Explicit, unconditional wording (no "when the learner seems frustrated…").
- No `session.update` / per-turn machinery in ① — purely the session-start prompt. Runtime steering is ③.

### 6.7 Testing (Phase ①)
- Unit: `tutor_core` renders for each locale in `ALLOWED_LEARNING_LOCALES`; guardrails appear last; no hard-coded language name; `custom_prompt` still bypasses.
- Unit: correction routing / teacher-constraint compilation — `recast_default` stays `True`; a `focus_grammar` (rule-based) error prompts/elicits first while a `target_expressions`/vocabulary slip recasts; `accuracy_first` leans explicit; `fluency_first` preserves flow; existing stored policies unchanged.
- Unit/snapshot: core contains the "close with a re-do" instruction; voice path contains the confirmation move.
- Snapshot: free-chat and assignment prompts contain the six core sections; free-chat prompt contains the direction move.
- Follows existing test conventions (`backend/tests/test_*`, `unittest`); extend `test_pedagogy_prompting.py`.

---

## 7. Phase ② — Skill-pack registry + eval harness (sketch)

**Registry.** `backend/services/skill_packs/` — small versioned markdown/string packs, content-source-agnostic, each <~200 tokens (e.g., `elicitation_correction_v1`, `output_pushing_v1`, `scaffold_ladder_v1`, `recycling_v1`, `warmup_v1`, `closing_review_v1`, `negotiation_of_meaning_v1`). A `SkillPackRegistry` maps `(task_family, lesson_phase, locale, proficiency_tier)` → ordered pack keys; the core becomes the always-on base, packs compose on top. In-repo versioned strings to start (no new persistence per TECH_SPEC §1); Firestore-backed packs only if teacher-authored packs are later needed. `task_family` is a new pedagogy classification layer, not a replacement for the persisted assignment `task_type`.

**Task family mapping (Input C, schema-compatible).** Research task families are pedagogical shapes; current persisted assignment `task_type`s are `information_gap`, `opinion_gap`, and `decision_making`. Do not pretend role-play/storytelling already exist as stored enum values. Add a derived `task_family` in the resolver/registry:

| Current `task_type` / signals | Derived `task_family` | Pedagogical use |
|---|---|---|
| `information_gap` | `information_gap` | Question formation, listening, clarification, accuracy under missing information. |
| `opinion_gap` | `discussion` | Reasons, agreement/disagreement, hedging, discourse strategy. |
| `decision_making` + role/setting scenario | `role_play` | Functional/pragmatic routines in a situated communicative goal. |
| `decision_making` + recount/narrative cues | `storytelling` | Longer discourse, sequencing, connectors, prosody. |
| Unknown/legacy | `situated_conversation` | Safe default: small scenario with role + goal. |

**Proficiency-tiered task shape (Input C).** Proficiency is the primary branch, age a secondary safety/length parameter: beginner → short turns, narrow goals, forced-choice support, short model+retry; intermediate → open questions + information-gap + task repetition; advanced → debate/problem-solving with discourse strategies (hedging, turn design, rebuttal). Pack selection keys on proficiency tier plus derived `task_family`; the existing `proficiency_context` is the input.

**Lesson phases.** Compact 3-stage model grounded in the pretask → task → posttask literature: `pretask (brief: 3–5 key expressions + situation briefing + planning) → task (situated, goal-driven, meaning pressure) → posttask (short reflection + re-performance/repetition)`. Phases select which packs load. Keep pretask short — over-preparing depresses spontaneity and positive affect (TESOL Quarterly / SSLA 2025). Phase tracking in ② is heuristic (turn count / signals); structured phase signals are an ③-adjacent concern.

**Learner-model layer.** Feeds pack/phase selection and adaptation: current level, recent success rate, target-form mastery, error patterns, task-completion likelihood, and — per Inputs B–C — **willingness-to-communicate (WTC) and anxiety signals** ("is this student ready to speak right now," not just their CEFR level; CALICO micro-adaptivity, *System* WTC↔proficiency work). These need session signals we don't yet capture, so this is squarely Phase ②+, not ①. It is also the layer the eval harness validates adaptation against.

**Eval harness** (the reason ② exists): a simulated-student model (LLM at a defined proficiency + error profile) runs N scripted sessions against the tutor; an LLM-as-judge scores transcripts on a pedagogy rubric (mistake identification, guidance provision, output pushing, talk-time ratio, anti-sycophancy, target recycling, language appropriateness — cf. BEA 2025 / arXiv 2412.09416 taxonomy). Gate: a pack version must beat the incumbent on ≥3 rubric dimensions over the simulated set before promotion. ~$0.05/50 sessions at mini prices. This converts prompt behavior from vibes to a regression-tested dev metric; it does **not** prove learning efficacy. The separate **product-efficacy evaluation** (CEFR/ACTFL speaking + interaction/CAF + pronunciation-comprehensibility + listening + affect/WTC + system-quality + fairness, measured pre/post/delayed across system-validation / learning-efficacy / classroom-operability layers — Input C) requires field/human evaluation and is scoped in the school-integration docs, not here.

### 7.1 Coach track — side-channel corrective feedback (Phase ② component)
**Problem it solves.** Inline correction forces every recast/elicitation to compete with conversational momentum for the same turn — the core flow-vs-uptake tension behind §2.1. A side channel ("coach track," analogous to a `/btw` aside) decouples the streams: the main tutor holds the conversation; a separate pass feeds a visual coach track.

**Model — hybrid (async accumulate + promote-back), chosen over pure-async and live-annotation:**
- A parallel, cheaper correction model analyzes each learner turn for errors and writes them to the coach track **silently** — no interruption to the main conversation (preserves flow + low affective filter / WTC). This is the architecture research's Layer-5 parallel call, now learner-facing.
- **Promote-back rule:** repeated errors and errors on teacher-designated **target** forms are surfaced into the *main* conversation for in-the-moment self-repair ("Earlier you said X — want to try that again?"). This preserves **uptake** — the strongest lever (§2.1) — and spends interruption only where it counts. Flow by default, uptake by exception.
- **Timing:** between turns / at breakpoints, **never simultaneous** with the learner's production, to avoid split-attention overload (acute in voice and for lower-proficiency learners).
- The accumulated coach track *is* the posttask review feed (drives "close with a re-do," §6.2 #6).

**Turn-level decision policy (Input C) — what the coach-track correction model executes each learner turn:**
1. ASR confidence check — if low, meaning-check/clarify, don't correct.
2. Communication breakdown or teacher-target error? If yes, prompt self-repair first (route by target type / affect per §2.1); short model on a second failure.
3. Otherwise pick at most **one** teachable focus, or stay silent.
4. On success, brief *confirmative* acknowledgment (not effusive praise).
5. Bundle all non-critical errors into the post-task summary.
Five invariants: **meaning-before-form, one-focus-per-turn, self-repair-first, ASR-confidence-gating, post-task-bundling.**

**Reuses existing teacher knobs — no new config.** The promote-back policy *is* the existing `feedbackPolicy`: `elicitation_repeat_threshold` becomes the promote-back threshold; `mode` sets aggressiveness (`fluency_first` rarely promotes; `accuracy_first` promotes sooner). The correction-ladder semantics simply move from "inline escalation" to "side-channel → main-channel escalation."

**Architectural payoff.** Removing correction from the main tutor's prompt collapses its job to *hold a good conversation* — directly improving instruction-following (the ~30% voice-adherence ceiling worsens as instructions stack). The correction model can be analytical/accuracy-tuned free of flow constraints, and is independently testable via the §7 harness (add a "promote-back precision/recall" rubric dimension).

**Surface.** Voice-primary: a visual coach track beside the realtime UI — this *is* the §8.1 multimodal text-support layer, now promoted to first-class. Text chat: a side panel / collapsible annotations.

**Phase ① implication.** Keep Phase ①'s inline correction in the Tutor Core **deliberately light** (a gentle, flow-friendly conversationalist) so we don't build heavy inline correction machinery that the coach track replaces in ②.

---

## 8. Phase ③ — Runtime director (deferred, gated)
A between-turns GPT-4o-mini call on the last 5–10 turns emits a one-sentence steering instruction injected via `session.update` / `response.create`, triggered *only* on drift signals (repeated error, N turns with no target-language token, learner stall). +300–600ms (lands in the natural end-of-turn VAD gap), ~$0.0003/triggered turn. **Gate to build it: ② eval data shows static composition (①+②) plateaus below target on the rubric.** Voice instruction-adherence (~30% MultiChallenge-audio) means steering reliability must be proven, not assumed.

## 8.1 Multimodal voice-first + text-supported UI (frontend track; now anchored by the coach track)
Inputs B–C emphasize that *mixed modality* (voice with selective text support) outperforms voice-only in the speaking meta-analysis — captions, key-expression highlights, replay, pronunciation comparison, and condensed-recast text help lower-proficiency learners locate and repair errors, and ASR confidence should be surfaced visually. This is a **frontend/UX track** (touches `useRealtimeChat` and the realtime/avatar UI). It was originally parked as out-of-scope, but the **coach track (§7.1) promotes it to first-class**: the coach track *is* the primary text-support surface, so this UI work is now the rendering half of the Phase ② coach track rather than a separate someday-track. Remaining multimodal extras (pronunciation comparison, replay) can still be scoped incrementally on top.

---

## 9. Risks, tradeoffs, open questions
- **Prompt drift over long voice sessions** (lost-in-the-middle; ~30% audio adherence). Mitigated in ① by lean core + critical-rules-last; fuller mitigation (reminder injection, `session.update` refresh) is ②/③.
- **Recycling without SRS state.** ① does best-effort in-session recycling; true cross-session spaced retrieval needs per-target acquisition state — deferred, flagged as open.
- **Scaffold-free assignment research deviation.** `custom_prompt` intentionally bypasses the tutor core to preserve the raw teacher-instruction contract. That means no shared anti-sycophancy, recycling, one-focus correction, or target-compilation guarantee unless the teacher writes it. Keep this visible in authoring UX/docs if scaffold-free becomes common.
- **Correction-calibration risk (both directions).** Target-aware elicitation + `accuracy_first` explicitness could feel naggy if over-tuned; conversely, the flow-friendly recast default risks under-correcting if escalation triggers are too lax. The eval harness (②) is the safety net; until then, `fluency_first` ↔ `accuracy_first` are the teacher-facing escape hatches.
- **Affective-filter / anxiety claims are contested** — treat stake-lowering as UX nicety, not a measured lever.
- **AI-tutor product outcome figures** (Duolingo/Khanmigo/TalkPal) are vendor-reported, not RCTs — directional only.
- **Coach track: passive-feed risk.** If too little is promoted back, the side channel becomes a mistakes-list the learner reads but never repairs — losing the uptake mechanism. Promote-back thresholds must be tuned (and measured by a promote-back precision/recall rubric dimension in §7); under-promotion is the failure mode to watch.
- **Coach track: split attention.** Even between turns, a busy side channel competes for attention in voice. Keep it terse, surface at breakpoints, and let the learner expand on demand.
- **Coach track: two-model disagreement.** The main tutor may implicitly recast something the coach-track model also flags. Needs dedup/coordination (e.g., the main tutor stays correction-light per the Phase ① note, leaving correction ownership to the coach model).
- **Translation dependence (Input C).** Learners can lean on L1/MT and produce less L2. → *Treat MT as an emergency scaffold only; mark translation-assisted turns; keep them out of the productivity signal. Governed by the existing language-mix policy (`english_first…target_only`).*
- **ASR accent/age bias (Input C).** Recognition is weaker for younger and accented/non-native speech, so automated correction can be unfair across subgroups. → *Confidence-gate correction (§6.2 #7), human-anchor pronunciation scores, run subgroup audits before scaling, and keep auto-correction conservative in minor/beginner contexts.*
- **AI verbosity + rigid pause thresholds are documented interaction blockers** (Choi & Oh, Korean EFL ChatGPT longitudinal — the most context-matched study). → *The turn cap (§6.2 #1) and flexible wait time (§2.2) are load-bearing, not stylistic.*

## 10. Success criteria
Phase ① ships when: core injects on all scaffolded surfaces; free chat reaches assignment-level pedagogy + has a situated direction move + a re-performance close; the correction ladder is refined (recast-default kept, target errors escalate to elicitation sooner, `accuracy_first` leans explicit); existing teacher fields compile into concrete prompt behavior; voice input confirmation present; anti-sycophancy + never-give-answer guardrails present; all locales render; tests green. Phase ② answers whether prompt/pack behavior improved in simulation; actual learning efficacy still requires field or human evaluation. Note (Input C): anxiety reduction and willingness-to-communicate gains are valid *leading* outcomes even before measurable speaking gains — do not judge the tutor on talk-volume alone.

## 11. Doc-sync follow-ups
- `TASKS.md`: add Phase ① items (tutor_core module + injection + correction-ladder refinement + existing teacher-field compilation + free-chat situated direction + posttask re-do + voice-input confirmation + tests).
- `LIMITATIONS.md`: note ① in-session-only recycling (no cross-session SRS state); `custom_prompt` intentionally excluded from the core.
- `TECH_SPEC.md`: document `tutor_core` as a content-source-agnostic prompt layer composed ahead of assignment overlay; note Phase ② registry + **coach track** (parallel correction model + side-channel feedback, reusing `feedbackPolicy` as promote-back policy) direction.
- **School-integration docs (PRD/TECH_SPEC/LIMITATIONS), not here:** Input C's governance belongs on the school surface — voice/transcript/translation retention off-by-default + differential retention, AI-use disclosure, separation of learning-eval vs operational logs, Korea MOE AI-ethics + 2025 learning-SW selection criteria + PIPC 2025 generative-AI privacy guidance, US FERPA/COPPA. These map to existing compliance services (`compliance_state`, `disclosure_logs`, `guardian_packets`, `deletion_requests`) — extend, don't rebuild.
- **Teacher-constraint compiler (assignment/analytics direction):** Phase ① compiles the fields already available in prompts (`target_expressions`, `target_vocabulary`, `focus_grammar`, `feedbackPolicy`, scaffold/output policy). The fuller Input C hard/soft/prohibited/rubric compiler + must-use "quota" coverage tracking remains an `assignment_resolver` + `practice_analytics` enhancement.
- **Product roadmap:** Input C's discovery→voice-MVP→pilot→efficacy→hardening is the *product* roadmap; this spec's ①→②→③ is the pedagogy-prompt slice living inside its MVP+pilot phases. Input C's stated priority — *build the task library + feedback policy before chasing a smarter model or attaching the voice stack* — independently endorses the Phase ① ordering.

## 12. Key sources
**Input A (SLA → LLM-tutor pedagogy + engineering):** Lyster & Ranta 1997; Li 2022 meta-analysis (Wiley 10.1155/2022/3444160); Ellis 2016 (FonF); Swain output hypothesis; Vygotsky ZPD; Krashen i+1 (+ Frontiers 2025 critique); Long interaction hypothesis; Thornbury Dogme; Kim & Webb 2022 spaced practice; Sycophancy arXiv 2411.15287; Dialogic Pedagogy for LLMs arXiv 2506.19484; Training LLM tutors arXiv 2503.06424; BEA 2025 Shared Task arXiv 2507.10579 + taxonomy arXiv 2412.09416; Agent Skills arXiv 2602.12430; Prompt Decorators arXiv 2510.19850; OpenAI Realtime prompting guide + gpt-realtime release; Khanmigo / Duolingo Max / Speak / TalkPal public design notes.

**Input B (conversational-CALL / TBLT line):** Bibauw et al. — conversational systems for language learning (typology: branching / form-focused / goal-oriented / reactive); ReCALL meta-analysis on conversational CALL & L2 speaking (moderators: system type, meaning constraint, modality); *Language Teaching* TBLT overview + critiques; Ellis — focus on form (*Language Teaching Research*); oral corrective-feedback observational meta-analysis (~57% recast / ~30% prompt); SSLA pretask/task/posttask placement study; TESOL Quarterly / SSLA 2025 on pre-task vocabulary support & affect; *Modern Language Journal* self-assessment + task repetition; *System* WTC ↔ oral proficiency; JSLP L2 pronunciation (intelligibility/comprehensibility) + ASR feedback; CALICO data-driven learner model / micro-adaptivity; systematic review on teacher–AI collaboration & teacher presence. *(Report's `citeturn…` markers are tool artifacts, not independently verified; the named sources are real and consistent with Input A.)*

**Input C (comprehensive design report):** Lyster, Saito & Sato (OCF review); Loewen & Sato (interactionist ISLA); Pica (information-gap); Ammar & Spada and Lyster (recast vs prompt; prompts > recasts for rule-based grammar); Lambert/Kormos/Minn (task repetition → fluency); Canals / Li replications (immediate vs delayed CF); Rassaei (anxiety: recast > metalinguistic for high-anxiety learners); Nassaji (feedback needs multi-measure designs); Jeon/Lee/Choe (ASR-chatbot typology: goal-orientation / embodiment / multimodality); Du & Daniel, Wiboolyasarin et al., Lai & Lee (chatbot speaking reviews; Asian-EFL evidence skew); Tai et al. (GAI+ASR, primary & university); Ericsson et al. (embodied SDS, adolescents); Choi & Oh (Korean EFL ChatGPT role-play: AI verbosity + rigid pause = interaction blockers); Ngo/Chen/Lai (ASR pronunciation: explicit > indirect, segmental > suprasegmental); Tsunemoto et al. (visual cues ↑ comprehensibility); CEFR / ACTFL can-do descriptors; UNESCO GenAI governance; Korea MOE AI-ethics + 2025 learning-SW selection criteria; PIPC 2025 generative-AI privacy guidance; US FERPA / COPPA. *(Report's `citeturn…` markers are tool artifacts; named sources are real and consistent with Inputs A–B.)*
