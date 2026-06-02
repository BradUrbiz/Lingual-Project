# Pedagogy Engine — Architecture Spec

**Date:** 2026-06-02
**Status:** Architecture / design. No code in this document. The build sequence (§14) is the bridge to implementation.
**Owner:** (TBD)
**Supersedes scope of:** `docs/Pedagogy Research/2026-05-27-tutor-pedagogy-conversation-guidance-design.md` (that doc scoped the work to prompt enrichment; this one re-frames it as an engine and re-houses the prompt work as the engine's first render target).
**Research inputs (cited, not restated):** `docs/Pedagogy Research/deep-research-report.md` (Input B — SLA/TBLT meta-analyses), `docs/Pedagogy Research/deep-research-report (2).md` (Input C — turn-level algorithm, constraint compiler, eval framework, governance), and the synthesis in the 2026-05-27 spec (Input A).
**Grounded against code at:** current HEAD. File:line references are real and were verified, not inferred.

---

## 0. TL;DR — the pivot in one screen

The 2026-05-27 work treated "make the tutor a better teacher" as **prompt engineering**: write one good doctrine block, inject it into two prompt builders, defer everything else. The research describes something larger — a **six-layer pedagogy system** in which the prompt is one output surface and explicitly *not* the load-bearing one. Input C's own roadmap says it plainly: build the task library + feedback policy + constraint compiler *first* (*"더 똑똑한 모델이 아니라"* — "not a smarter model"), and only then attach the voice stack.

**Thesis:** the system prompt is a **render target** of a pedagogy engine, not the engine. The engine is a set of deterministic, testable backend services that compile *(teacher intent + learner state + task model)* into a **session plan** and **per-turn decisions**, of which "the string handed to the OpenAI session" is one rendering — swappable for the coach track or `session.update` later, without rewriting the pedagogy.

**The spine is the Teacher-Constraint Compiler (Layer 2).** Every other layer hangs off its output. Get its data model right (§4) and the other five layers have a contract to plug into.

**Why this matters to the mission.** Lingual's positioning is *"teacher-designed practice, AI-executed at student scale."* That sentence is an engine spec: the **compiler** is "teacher-designed," the **turn-decision + render** layers are "AI-executed," and *"at student scale"* is precisely why this must be a deterministic, regression-tested engine rather than behavior smuggled into a prompt and hoped for across thousands of unsupervised voice sessions. The engine *is* the moat; the prompt is a detail of one renderer.

---

## 1. Motivation — why an engine, not a prompt

### 1.1 What the 2026-05-27 spec did to the research
It collapsed a six-layer architecture onto a single surface and relabeled the rest as "deferred":
- The **constraint compiler** (Input C's centerpiece) became "compile the fields we already have into prompt text," real compiler deferred.
- The **learner model** (WTC/anxiety/mastery) became "Phase ②+, not ①."
- The **coach track** (the whole conversation-management layer) became "a Phase ② component."
- The **eval harness** became "the reason ② exists."

The result reads as a prompt-engineering spec with an architecture appendix. It is not wrong — every claim in it survives — but it under-builds. A prompt cannot hold session state, cannot track target coverage, cannot route a correction by learner affect, cannot be measured turn-by-turn, and degrades as instructions stack (OpenAI's own MultiChallenge-audio adherence sits near ~30%). Those are not prompt problems; they are *missing subsystems*.

### 1.2 What the research actually demands
Both Korean reports independently derive the **same** decomposition (Input B "제품 아키텍처와 상호작용 정책"; Input C's compiler + layer model): teaching-plan, learner-model, conversation-management, feedback-policy, multimodal-interface, and teacher-control layers, atop a governance substrate, validated by a three-layer evaluation framework. Two independent research efforts converging on one architecture is the strongest signal in the corpus.

### 1.3 The lesson from the deleted engine (it is not a counter-argument)
Commit `ede4b25` (2026-04-18) deleted `backend/services/pedagogy/` — `policies`, `correction_ladder`, `feedback_mode`, `scaffold_ladder`, `output_pressure`, `task_template`, `curriculum_templates`, `template_catalog` — and inlined the policy helpers into `assignment_resolver.py`. The commit message is explicit about *why*: the engine "served the curriculum-package code path," which the Canvas + GPT-scenario migration retired. It was killed for being **content-source-coupled**, not for being modular.

> **Design rule, carried forward and extended:** the reborn engine must be **content-source-agnostic** (it describes *how to teach*, never *what content to teach*, so it survives Canvas / GPT-scenario / custom-prompt / free-chat churn) **and surface-agnostic** (it describes *what to do this turn*, never *which API renders it*, so it survives the realtime-voice / text-chat / future-director split). Surface-agnosticism is the new requirement the old engine never had — and it is what makes "prompt vs. coach track vs. session.update" a render choice instead of a rewrite.

---

## 2. Design principles & invariants

These are load-bearing constraints, not style. Every layer must honor them.

**Pedagogy invariants (from the research, enforced engine-wide):**
1. **Meaning before form.** If meaning didn't get through, form feedback won't stick. Negotiate meaning first.
2. **One focus per turn.** Correct at most one thing per learner turn; bundle the rest to a post-task review. Over-correction turns conversation into interrogation (Choi & Oh, the most context-matched study, names AI verbosity + rigid pauses as *interaction blockers*).
3. **Self-repair first.** Prompt the learner to fix it before modeling the answer. Resist "just tell me" / "just a hint" extraction.
4. **ASR-confidence gating.** Pronunciation/word-level correction fires only on high-confidence recognition; otherwise confirm what was heard. A mishearing must never be scored as a learner error.
5. **Post-task bundling.** Non-blocking errors accumulate into a short (20–40s) post-task coach turn, not mid-flow interruptions.
6. **Flow by default, uptake by exception.** Default move on a non-critical error is a flow-friendly recast/clarification; spend an interruption only on repeated or teacher-target errors (where uptake — the strongest lever — is worth the cost).

**Engineering invariants (Lingual-specific):**
7. **Content-source-agnostic AND surface-agnostic** (§1.3).
8. **Teacher is the policy-setter, AI is the executor.** The engine never invents pedagogy the teacher didn't authorize; it compiles teacher intent and runs inside it. Teacher presence is an engagement variable, not a nicety (Input C).
9. **No new persistence system.** Firestore stays system-of-record for beta (TECH_SPEC §1). Engine state is derived/snapshotted into existing collections (`practice_sessions.pedagogy_snapshot`, `analysis_state`; `learning_events`), not a new store. Postgres only via the sanctioned `backend/db/` migration.
10. **Compliance fails closed.** Voice/consent gating is upstream of and independent from the engine. The engine may *reflect* allowed behavior; it never *grants* it. Retention/redaction/access are product policy, never prompt advice.
11. **Locale-parametric.** Every layer takes `{language_name}` / `learning_locale` as a parameter; never hard-code a language (CLAUDE.md).

---

## 3. System architecture — six layers + two cross-cutting tracks

```
                          ┌───────────────────────── GOVERNANCE (substrate) ─────────────────────────┐
                          │  retention off-by-default · differential voice/transcript/translation     │
                          │  retention · AI-use disclosure · eval-vs-operational log separation        │
                          │  FERPA / COPPA / MOE / PIPC  →  maps onto existing compliance services     │
                          └───────────────────────────────────────────────────────────────────────────┘

   TEACHER INTENT ─┐
   (assignment +   │   ┌──────────────────┐   ┌───────────────┐   ┌──────────────┐   ┌─────────────────┐
    teacher fields)├──▶│ L2 CONSTRAINT    │──▶│ L1 TEACHING-  │──▶│ L4 TURN-     │──▶│  RENDER TARGET   │
                   │   │    COMPILER      │   │   PLAN        │   │  DECISION    │   │  (pluggable)     │
   LEARNER STATE ──┤   │   (the spine)    │   │ task family · │   │ per-turn     │   │ ├ system_prompt  │── today
   (L3 learner ────┤   │ hard/soft/       │   │ pretask→task→ │   │ algorithm +  │   │ ├ coach_track    │── ②
    model)         │   │ prohibited/      │   │ posttask ·    │   │ coach track  │   │ └ session.update │── ③
                   │   │ rubric/evidence/ │   │ completion    │   │              │   │                  │
   TASK MODEL  ────┘   │ safety           │   │ condition     │   │ L5 FEEDBACK  │   └─────────────────┘
                       └──────────────────┘   └───────────────┘   │  POLICY      │            │
                                │                                  │ routing      │            ▼
                                │                                  │ matrix       │   ┌──────────────────┐
                                ▼                                  └──────────────┘   │ L6 MULTIMODAL UI │
                       ┌──────────────────┐                              │            │ voice-first +    │
                       │  COVERAGE /      │◀─────────────────────────────┘            │ text support +   │
                       │  EVIDENCE STATE  │  reads learning_events, updates L3         │ coach panel +    │
                       └──────────────────┘                                           │ ASR-confidence   │
                                │                                                      └──────────────────┘
                                ▼
                       ┌──────────────────────── L7 TEACHER ANALYTICS / DEBRIEF ───────────────────────┐
                       │  dashboard · evidence-backed session report · blended teacher-AI review        │
                       └───────────────────────────────────────────────────────────────────────────────┘
```

Layer-by-layer responsibility, current state, and gap. ("Today" reflects verified code, not the old spec.)

| # | Layer | Responsibility (one line) | What exists today | The gap |
|---|---|---|---|---|
| **L1** | Teaching-plan | Turn teacher goal into a *situated task* with family, phases, completion condition | `task_type` ∈ {information_gap, opinion_gap, decision_making, custom_prompt} (`assignment.py:71`); one GPT `generated_scenario`; `build_task_template_prompt` directive | No reusable task **library**, no task-**family** pedagogy beyond 3 enums, no pretask→task→posttask phase model |
| **L2** ⭐ | Constraint compiler | Compile teacher fields into typed hard/soft/prohibited/rubric/evidence/safety constraints | Fields concatenated into prompt sections (SPINE / TARGETS / TUTOR STANCE) by `build_assignment_system_prompt` (`resolver.py:1588`) | **No compiler** — intent never becomes structured, coverable constraint objects; coverage/quota untracked |
| **L3** | Learner model | Hold *can this student speak right now* — proficiency + mastery + error patterns + WTC/anxiety/readiness | `proficiency_context`: static ACTFL band + age/rigor/frequency (`main.py:337`); fallback = Intermediate Mid/High | No session-state, no affect signal, no per-target mastery; `learning_events` emits the primitives but nothing reads them back |
| **L4** | Turn-decision / coach | Decide *what to do this learner turn*; run the coach track | Nothing — one system prompt set once at session start (`chat.py:489/506`); no per-turn or between-turns logic anywhere | No explicit turn algorithm, no parallel correction pass, no side channel |
| **L5** | Feedback policy | Route correction by target-type × affect × timing | `default_feedback_policy` (`resolver.py:49`): `recast_default: True`, `elicitation_repeat_threshold: 3`, `mode` ∈ {fluency_first, balanced, accuracy_first} | Knobs exist; **routing logic doesn't** — `recast_default` is a flat switch, not a target-type/affect router |
| **L6** | Multimodal UI | Voice-first + selective text scaffolding; surface the coach track + ASR confidence | Realtime voice (`gpt-realtime-mini`) + text/avatar (`gpt-5.3-chat-latest`); single prompt + history | No coach panel, no captions/highlights/replay/pronunciation-compare, no confidence surfacing |
| **L7** | Teacher analytics / debrief | Evidence-backed post-conversation report + dashboard + blended review | `practice_sessions` (rich: `pedagogy_snapshot`, `analysis_state`, `session_summary`, `transcript_ref`); `learning_events` taxonomy | No closed-loop debrief surface, no coverage report tied to L2 rubric, no confidence caveats packaged for teachers |
| **Gov** | Governance | Retention / disclosure / log-separation / jurisdiction compliance | `compliance_state`, `disclosure_logs`, `guardian_packets`, `deletion_requests` | Differential voice/transcript/translation retention + eval-vs-operational separation not yet engine-aware |

⭐ **L2 is the spine.** The teaching-plan consumes its output; the turn-decision layer reads its hard/soft routing; the coverage tracker measures against its rubric; the teacher dashboard reports against its evidence plan. It is specified in full in §4.

---

## 4. The spine — Teacher-Constraint Compiler (L2)

The compiler is the difference between "append teacher settings to a prompt" and "an engine." It takes the loose, human teacher input and produces **typed constraint objects** that every downstream layer can route on, cover against, and report on. This is the part the research is loudest about (Input C's `제약 컴파일러` flowchart) and the part the codebase most lacks.

### 4.1 Inputs (what the teacher actually gives us — verified fields)
From the assignment doc (`backend/db/models/assignment.py:34-64`, `database.py:116-130`):

| Field | Type | Today's use |
|---|---|---|
| `instructions` | text | free-text teacher authoring |
| `generated_scenario` | text | GPT-generated scene |
| `objectives[]` | text[] | listed in TARGETS section |
| `target_expressions[]` | text[] | "elicit naturally" |
| `target_vocabulary[]` | text[] | "elicit naturally" |
| `focus_grammar[]` | text[] | listed; no routing |
| `teacher_notes` | text | TEACHER GUIDANCE section |
| `student_instructions` | text | learner-visible |
| `success_criteria[]` | text[] (Firestore) | spine |
| `target_language_intensity` | enum {english_first…target_only} | language-mix policy |
| `task_type` | enum (4) | task template |
| `feedbackPolicy` / `scaffoldPolicy` / `outputPolicy` | dicts (`resolver.py:49-72`) | TUTOR STANCE |

**Fields the old spec invented that do NOT exist on the assignment doc:** a first-class `rubric` and explicit `modality` / `task-preference` fields. Modality lives on `practice_sessions` (`modality`, `voice_enabled`, `text_enabled`); there is no stored rubric object. The compiler must therefore *derive* rubric/evidence from `success_criteria` + targets, and treat modality as session context, not assignment config. (This is a real divergence the old spec glossed; flagged here so we don't design against fields that aren't there.)

### 4.2 Output — `CompiledConstraints` (the typed model)
A schematic data model (design notation, not code). Six constraint kinds:

```
CompiledConstraints:
  hard_agenda:      [ TargetItem ]      # must be elicited; coverage-tracked, quota'd
  soft_agenda:      [ TargetItem ]      # elicit if natural; optional expansion
  prohibited:       [ SafetyRule ]      # blocked topics / behaviors (fail-closed)
  rubric:           [ RubricDimension ] # what "success" is measured on (derived if absent)
  evidence_plan:    [ EvidenceItem ]    # what to capture for the teacher debrief
  safety_plan:      SafetyPlan          # retention/redaction/visibility (routed to compliance, not prompt)

TargetItem:
  surface:          str                 # the expression / word / grammar form
  kind:             {expression, vocabulary, grammar_rule, function, discourse_move}
  rule_based:       bool                # grammar_rule that benefits from prompt-first (Lyster)
  feedback_route:   {prompt_first, recast_first, model_first}   # derived from kind+rule_based+policy
  min_uses:         int                 # coverage quota (hard only)
  introduced_phase: {pretask, task}     # when to model it
  elicit_phase:     {task, posttask}    # when to engineer learner production

RubricDimension:
  name:             str                 # e.g. "past-tense accuracy", "turn design"
  source:           {success_criteria, focus_grammar, derived}
  observable_via:   [ learning_event_type ]   # how the coverage tracker scores it

SafetyRule / SafetyPlan:  → routed to compliance services (compliance_state, disclosure_logs);
                            the engine consumes the *resolved allowance*, never sets policy.
```

### 4.3 Compilation rules (the routing the spec's §6.4 wanted but couldn't enforce in a prompt)
- `focus_grammar[]` items → `kind=grammar_rule`. If rule-based (the common case), `feedback_route=prompt_first` (Lyster/Ammar-Spada: prompts beat recasts *specifically* for rule-based grammar). Under `feedbackPolicy.mode=accuracy_first`, lower the escalation threshold.
- `target_expressions[]` / `target_vocabulary[]` → `kind=expression|vocabulary`, `feedback_route=recast_first` (formulaic/lexical targets fit recasts + flow), `min_uses≥1`, `introduced_phase=pretask|task`, `elicit_phase=task|posttask`.
- `objectives[]` + `success_criteria[]` → `RubricDimension`s; if no explicit criteria, **derive** dimensions from targets + task family (don't fabricate a rubric the teacher didn't set; mark it `source=derived` so the debrief can caveat it).
- Affect override (needs L3 signal — ②): under detected anxiety / low WTC, bias any route toward `recast_first` even for grammar (Rassaei). Compiler emits the route; L4 applies the override at runtime.
- `prohibited` + `safety_plan` → handed to compliance; the engine receives back a resolved allowance and renders only within it.

### 4.4 Coverage / evidence state (closing the loop)
The compiler's `hard_agenda` + `rubric` define *what to watch for*. The substrate already emits the watch-points — `learning_events` carries `metric.target_expression_hit`, `metric.target_vocabulary_hit`, `metric.self_correction`, `metric.error_detected`, `metric.repeated_error`, `metric.rubric_dimension_signal`, `task.completed` (`practice_analytics.py:10-28`). Today these are written and never read. The engine adds a **coverage/evidence reader** that folds them back into L3 (learner model) and L7 (debrief): which hard targets are still uncovered, which rubric dimensions have signal, which errors repeated. This is the single highest-leverage closed loop and it needs **no new event types** — only a reader.

---

## 5. The render-target boundary (what makes it surface-agnostic)

The engine produces a **TurnDirective / SessionPlan**; a *renderer* turns that into something a specific API consumes. Three renderers, one engine:

| Renderer | Surface / API | Status | What it emits |
|---|---|---|---|
| `system_prompt` | Realtime voice (`gpt-realtime-mini`, `chat.py:489/506`) + text/avatar (`gpt-5.3-chat-latest`) | **today** | Assembled session-start prompt — exactly what `build_assignment_system_prompt` / `build_system_prompt` produce now, re-housed as a renderer over `SessionPlan` |
| `coach_track` | Side-channel UI feed + parallel correction model | ② | Per-turn coach annotations; promote-back items into the main channel |
| `session.update` | Realtime between-turns steering | ③ (gated) | One-sentence re-steer on drift signals |

**Two consumer models, one renderer contract.** The `system_prompt` renderer must serve *both* `gpt-realtime-mini` (voice; critical-rules-last, lean, explicit/unconditional wording — voice adherence is fragile) and `gpt-5.3-chat-latest` (text/avatar; tolerates more). The renderer is parameterized by surface, not forked per builder — which is the unification the old spec's "shared tutor core" was reaching for, now expressed as *one renderer over one plan* rather than *two builders sharing a string*.

**`custom_prompt` is the canonical bypass.** Today `task_type == "custom_prompt"` early-returns the base prompt (`resolver.py:1594`), skipping all overlays. In engine terms this is a **render bypass**: the teacher opted out of the scaffolded experience, so the engine compiles nothing and the renderer passes raw teacher instructions through. Keep it — it's the clean precedent for "engine off, teacher's words only," and a useful escape hatch. (Trade-off, unchanged from old spec §6.1: bypass means no anti-sycophancy / recycling / one-focus / coverage guarantees unless the teacher writes them. Surface this in authoring UX.)

---

## 6. Turn-decision layer (L4) + coach track

Where the engine stops being a session-start string and becomes per-turn. This is ② territory, specified now so the spine is built to feed it.

### 6.1 The per-turn algorithm (Input C, verbatim intent)
For each learner turn:
1. **ASR confidence check** — if low → meaning-check / clarify; do *not* correct (invariant 4).
2. **Communication breakdown OR teacher hard-target error?** If yes → prompt self-repair first (route by target-type/affect per L5); short model on a second failure.
3. **Otherwise** → pick at most *one* teachable focus, or stay silent (invariants 2, 6).
4. **On success** → brief *confirmative* acknowledgment, not effusive praise (anti-sycophancy).
5. **Bundle** all non-critical errors → post-task summary (invariant 5).

This is the same decision tree both research reports drew (Input C's mermaid `flowchart TD`); the engine implements it as L4 logic instead of hoping a voice model follows it implicitly.

### 6.2 Coach track (the conversation-management payoff)
A **parallel, cheaper correction model** analyzes each learner turn and writes findings to a **side channel** silently (preserves flow / WTC / low affective filter). **Promote-back rule:** repeated errors and errors on teacher hard-targets surface into the *main* conversation for in-the-moment self-repair ("Earlier you said X — want to try that again?"). Flow by default, uptake by exception.

**Architectural payoff:** removing correction from the main tutor's job collapses it to *hold a good conversation* — directly easing the ~30% voice instruction-adherence ceiling, which worsens as instructions stack. The correction model can be accuracy-tuned free of flow constraints and tested independently.

**Reuses existing knobs, no new config:** the promote-back policy *is* `feedbackPolicy` — `elicitation_repeat_threshold` becomes the promote-back threshold; `mode` sets aggressiveness (`fluency_first` rarely promotes, `accuracy_first` promotes sooner). The correction-ladder semantics move from "inline escalation" to "side-channel → main-channel escalation."

**Risks** (carried from old spec §7.1, still live): under-promotion turns the coach track into an unread mistakes-list (losing uptake); split attention in voice (keep terse, surface at breakpoints, expand on demand); two-model disagreement (main tutor stays correction-light, leaving correction ownership to the coach model).

---

## 7. Learner-model layer (L3)

**What it holds:** current proficiency, recent success rate, per-target mastery, error patterns, task-completion likelihood, and — the research's repeated demand — **WTC / anxiety / readiness** ("is this student ready to speak *right now*," not just their CEFR band; CALICO micro-adaptivity, *System* WTC↔proficiency work).

**Today:** `proficiency_context` is a static ACTFL band + demographics, built once per session, with an Intermediate-Mid/High fallback. Zero session-state, zero affect, zero mastery.

**The build:** L3 is fed by the §4.4 coverage/evidence reader over `learning_events`. Proficiency stays the static seed; mastery and error-patterns accumulate from emitted metrics; WTC/anxiety needs *new* session signals (silence length, turn length trend, repair frequency, abandonment) — these are derivable from the existing event stream + transcript metadata, **not** a new store. Honors invariant 9: L3 state snapshots into `practice_sessions.analysis_state`, not a new collection.

**Primary branch = proficiency, secondary = age** (Input C): beginner → short turns, narrow goals, forced-choice support; intermediate → open questions + info-gap + task repetition; advanced → debate/problem-solving + discourse strategy. Age modulates session length, multimodal density, correction conservativeness, ASR thresholds — it does *not* replace proficiency as the primary branch. (Beta posture: high-school/adolescent default; younger-child mode is out of scope until age-band policy, guardian visibility, and child-ASR thresholds are designed explicitly.)

---

## 8. Teaching-plan layer (L1)

**Task families** (pedagogical shapes) vs. **`task_type`** (4 persisted enums). Do not pretend role-play/storytelling are stored enums — derive a `task_family` in the engine:

| `task_type` / signals | Derived `task_family` | Pedagogical use |
|---|---|---|
| `information_gap` | `information_gap` | question formation, listening, accuracy under missing info |
| `opinion_gap` | `discussion` | reasons, agree/disagree, hedging, discourse strategy |
| `decision_making` + role/setting cues | `role_play` | functional/pragmatic routines in a situated goal |
| `decision_making` + recount/narrative cues | `storytelling` | longer discourse, sequencing, connectors, prosody |
| `custom_prompt` | (render bypass — no family) | teacher's raw instructions; engine off |
| unknown/legacy | `situated_conversation` | safe default: small scenario, role + goal |

**Phase model:** compact `pretask (3–5 key expressions + situation briefing + brief planning) → task (situated, goal-driven, meaning pressure) → posttask (short reflection + re-performance)`. Keep pretask *short* — over-preparing depresses spontaneity and affect (TESOL Quarterly / SSLA 2025). Phase tracking is heuristic in ② (turn count / signals); structured phase signals are ③-adjacent.

**Completion condition:** the compiler's `success_criteria` + `hard_agenda` coverage define when the task is "done" — turning a flat target checklist into a *problem-solving scene* (Input C: compile targets into a decision chain — "메뉴 추천 받기 → 재료 확인 → 알레르기 설명 → 주문 수정"). This is the L1↔L2 contract: L2 says *what must be covered*, L1 says *in what situated shape*.

**Task library** (the asset the research says to build *first*): a versioned, locale-parametric set of task templates keyed by `(task_family, proficiency_tier)`, content-source-agnostic. In-repo versioned strings to start (invariant 9); Firestore-backed only if teacher-authored task templates are later needed.

---

## 9. Feedback-policy layer (L5) — the routing matrix

Not one default — a router on **target-type × affect × timing**, atop a flow-friendly base. Built on the *existing* policy dicts (`resolver.py:49-72`), which already encode the parameters; what's missing is the routing *logic*.

| Condition | Route | Source |
|---|---|---|
| non-critical error, flow intact | brief recast / clarification (default) | observational ~57% recast |
| error on rule-based `focus_grammar` target | **prompt / elicit first** | Lyster, Ammar & Spada |
| `target_expressions` / vocab slip | recast or brief model | formulaic/lexical fit |
| learner anxiety / low WTC (needs L3) | bias to recast even on grammar | Rassaei |
| `mode = accuracy_first` | lean explicit, escalate sooner | teacher policy |
| `mode = fluency_first` | delay interruption, rarely promote | teacher policy |
| communication-blocking error | immediate, regardless of above | meaning-before-form |

**Decision recorded earlier and kept:** `recast_default: True` stays. This is *not* a global flip to elicitation-first; the routing matrix replaces the flip. The old spec briefly proposed flipping the default and reverted — the existing code was already closer to the evidence than the proposed change. The matrix is the refinement: same default, smarter routing.

---

## 10. Multimodal interface layer (L6)

**Voice-first, text-supported** (ReCALL meta-analysis: mixed modality outperforms voice-only; visual support helps lower-proficiency learners *locate* errors to self-repair). The coach track (§6.2) *is* the primary text-support surface — promoting the old spec's "someday multimodal track" to first-class.

Surfaces, by priority: coach-track panel (voice: beside realtime UI; text: side panel/collapsible) → ASR-confidence surfacing (visually mark uncertain recognition) → key-expression highlights / captions → replay + pronunciation comparison (deferred extras). Frontend track touching `useRealtimeChat` + realtime/avatar UI. Keep terse; surface at breakpoints; expand on demand (split-attention risk).

---

## 11. Teacher analytics / debrief layer (L7)

The coach track is *live, learner-facing*. L7 is the *after-conversation, teacher-facing* counterpart — a different problem (stable summary vs. in-the-moment momentum). It packages the §4.4 evidence state: hard-target coverage, learner uptake/self-repair, repeated-error families, **confidence caveats** (which pronunciation/listening claims were *not* made because ASR was uncertain — honesty over false precision), and a suggested next practice.

Built on existing substrate — `practice_sessions` already carries `pedagogy_snapshot`, `analysis_state`, `session_summary`, `transcript_ref`; `learning_events` carries the metrics. L7 is a *reader + presenter*, not a new pipeline. Depends on analytics maturity + retention policy + teacher UX, so it lands after the spine + coach track. **Do not** market a generated summary as evidence-backed until coverage tracking is real (LIMITATIONS #7/#8: analytics are heuristic for now).

---

## 12. Governance layer (substrate)

Not optional prompt advice — product/system policy (invariant 10). Principles (Input C, Korea + US): data minimization, **retention off-by-default**, **differential retention** for voice vs. transcript vs. translation logs, AI-use disclosure, **separation of learning-eval logs from operational logs**, teacher/school-configurable controls. Jurisdiction: Korea MOE AI-ethics + 2025 learning-SW selection criteria, PIPC 2025 generative-AI privacy guidance; US FERPA, COPPA (<13).

**Mapping (extend, don't rebuild):** routes onto existing `compliance_state`, `disclosure_logs`, `guardian_packets`, `deletion_requests`. The engine consumes *resolved allowances* from these services; it never sets retention/redaction/visibility itself. Belongs in the school-integration compliance surface (PRD/TECH_SPEC/LIMITATIONS), referenced here, owned there.

---

## 13. Evaluation framework

Two distinct evaluations — don't conflate them.

### 13.1 Dev harness (regression-tests prompt/pack behavior — cheap, CI-able)
A **simulated-student** model (LLM at a defined proficiency + error profile) runs N scripted sessions against the tutor; an **LLM-as-judge** scores transcripts on a pedagogy rubric (mistake ID, guidance provision, output pushing, talk-time ratio, anti-sycophancy, target recycling, language appropriateness — BEA 2025 taxonomy). Gate: a pack/version beats the incumbent on ≥3 dimensions before promotion. ~$0.05/50 sessions at mini prices. **This converts behavior from vibes to a dev metric; it does not prove learning.**

### 13.2 Product-efficacy eval (proves learning — field/human, slow)
Three operating layers (Input C):
- **System-validation:** latency, ASR error, **false-correction rate**, barge-in failure. (Separates *system* failure from *pedagogy* failure.)
- **Learning-efficacy:** CEFR/ACTFL speaking + interaction (turn complexity/diversity/timing/repair) + CAF + comprehensibility/intelligibility + listening + **WTC/anxiety** — measured **pre / post / delayed-post**. Note: anxiety reduction & WTC gains are valid *leading* outcomes even before measurable speaking gains — do not judge the tutor on talk-volume alone.
- **Classroom-operability:** teacher prep time, config usability, engagement patterns. (AI-teacher collaboration evidence is thin → operability validation matters most.)

Scoped in the school-integration docs (field study), not built here.

---

## 14. Build sequence — re-derived from the architecture

The pivot raises the *ceiling*, not the *batch size*. Build the engine in **vertical slices** (each touches the spine and ships student-visible value), not horizontal layers (which would build a cathedral before anyone speaks). Input C's own roadmap independently endorses this ordering: *task library + feedback policy + compiler before a smarter model or the voice stack.*

| Slice | Delivers | Layers touched | Render target | Net new infra |
|---|---|---|---|---|
| **S1 — Spine** | Reborn `backend/services/pedagogy/` (content+surface-agnostic): `compiler` → `CompiledConstraints`, `plan` → `SessionPlan` (task_family + phases + completion), `policy` routing matrix. `system_prompt` renderer re-houses today's two builders over the plan. Free-chat reaches assignment-grade pedagogy. The 2026-05-27 doctrine ships *as the renderer's content*. | L1, L2, L5 + render | `system_prompt` | **none** (prompt-only, zero latency/cost) |
| **S2 — Closed loop** | Coverage/evidence reader over existing `learning_events`; L3 learner-model accumulates mastery + error patterns (no affect yet); feeds recycling + uncovered-target awareness back into S1's plan. | L3 (partial), L2 coverage | `system_prompt` | reader only (no new store) |
| **S3 — Coach track** | Parallel correction model + side-channel; L4 turn algorithm; promote-back via existing `feedbackPolicy`; L6 coach panel (the multimodal text-support surface). Main tutor goes correction-light. | L4, L6, render | `coach_track` | parallel model call + UI |
| **S4 — Affect + debrief** | WTC/anxiety signals into L3 (silence/turn-trend/repair/abandonment); affect override in L5; L7 evidence-backed teacher debrief over `practice_sessions`. | L3 (full), L5 affect, L7 | both | analytics presenter |
| **S5 — Director (gated)** | Between-turns `session.update` re-steer on drift — **only if** S1–S4 eval shows static composition plateaus below target. | L4 runtime | `session.update` | +latency/cost; prove first |
| **Eval harness** | Simulated-student + LLM-judge (§13.1) — built alongside **S1**, not after, so every slice is gated by regression, not vibes. | — | — | CI job |

**Governance** rides alongside as an extension of existing compliance services, not a slice (it has no standalone student-facing increment).

S1 is the same prompt work the old spec scoped — but now it *is the renderer of the spine*, structured so S2–S5 bolt on without a rewrite. That structural difference is the entire point of the pivot.

---

## 15. Risks & open questions
- **Cathedral risk** (the pivot's own failure mode): designing six layers tempts building them all. Mitigation: the vertical-slice sequence (§14); each slice ships student value; S5 is gated on eval, not faith.
- **Reborn-engine recurrence:** the old `pedagogy/` died from content-source coupling. New invariant (content+surface-agnostic, §1.3) is the guard — but it must be *enforced in review*, not just stated.
- **Recycling without SRS state:** S1/S2 do in-session + best-effort cross-session recycling; true spaced retrieval needs per-target acquisition state (deferred).
- **Voice instruction adherence (~30%):** the coach track (S3) is the structural mitigation (shrink the main tutor's instruction load); until then, lean prompt + critical-rules-last.
- **Two-model coordination** (main tutor vs. coach model): dedup/ownership rules needed (§6.2).
- **Derived rubric honesty:** when the compiler derives a rubric the teacher didn't set, the debrief must caveat it (`source=derived`) — don't present inferred dimensions as teacher intent.
- **ASR accent/age bias:** confidence-gate correction, human-anchor pronunciation, subgroup audits before scale, conservative auto-correction for minors/beginners.
- **Translation dependence:** treat MT as emergency scaffold; mark MT-assisted turns; keep them out of the productivity signal; governed by the existing language-mix policy.
- **Contested constructs:** affective-filter / i+1 are directionally useful, not measured levers — don't market them as proven.
- **Vendor-reported efficacy** (Duolingo/Khanmigo/TalkPal): directional, not RCTs.

## 16. Relationship to existing docs (doc-sync)
- **`TECH_SPEC.md`:** add the Pedagogy Engine as a content+surface-agnostic subsystem (`backend/services/pedagogy/` reborn): compiler → plan → policy → pluggable renderer; note the coach track + render-target boundary; note L7 debrief as an analytics-backed surface distinct from live coach feedback.
- **`TASKS.md`:** add S1–S5 + eval-harness as phased items (§14).
- **`LIMITATIONS.md`:** in-session-only recycling (no SRS), pronunciation/listening deferred beyond confidence-aware confirmation, younger-child mode out of scope, `custom_prompt` render-bypass excludes engine guarantees, derived-rubric caveat, heuristic analytics until coverage tracking is real.
- **`PRD.md`:** frame the engine as the technical embodiment of "teacher-designed practice, AI-executed at student scale."
- **Compliance docs:** governance substrate (§12) extends `compliance_state` / `disclosure_logs` / `guardian_packets` / `deletion_requests` — owned there, referenced here.
- **Research folder:** `docs/Pedagogy Research/` stays as cited input (Inputs A–C); this doc is the design output derived from it.

## 17. Sources
Full citations live in the research inputs. Anchors: Lyster & Ranta 1997; Lyster (prompts > recasts for rule-based grammar); Ammar & Spada; Rassaei (anxiety: recast > metalinguistic); Swain (output); Vygotsky (ZPD); Long (interaction); Ellis (FonF); Thornbury (Dogme); Kim & Webb 2022 (spaced practice); Bibauw et al. (conversational-CALL typology); ReCALL meta-analysis (goal-oriented > free; mixed modality); Lambert/Kormos/Minn (task repetition → fluency); Choi & Oh (Korean EFL ChatGPT: verbosity + rigid pauses = interaction blockers); Jeon/Lee/Choe (ASR-chatbot typology); Ngo/Chen/Lai (ASR pronunciation: explicit > indirect); CEFR/ACTFL; sycophancy arXiv 2411.15287; BEA 2025 (tutor-eval taxonomy); OpenAI Realtime prompting guide; UNESCO GenAI governance; Korea MOE AI-ethics + 2025 learning-SW criteria; PIPC 2025; US FERPA/COPPA. See `docs/Pedagogy Research/deep-research-report.md` (Input B) and `deep-research-report (2).md` (Input C).
