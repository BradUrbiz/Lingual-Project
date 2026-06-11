## On letting users set eagerness — yes, do it, with one refinement

Making `eagerness` a setting with `auto` as default is the right call, and it's nearly free to build (it's already a field in `build_realtime_session_request`). One refinement worth considering:

**A flat `auto` default leaves pedagogical value on the table.** The research is consistent that *proficiency is the primary branch*: beginners pause mid-utterance to retrieve words and get cut off at 4s (`auto`/medium), while advanced learners want snappier turns (`high`/2s). So the strongest version is **proficiency-derived default + user override**: beginner → `low` (8s), intermediate → `auto`, advanced → `high`. You already have `proficiency_context` at session build, so this is one mapping function, not new infrastructure. If you'd rather keep v1 dead-simple, flat-`auto`-plus-override is a fine starting point and real usage will tell you the right defaults.

Two implementation notes: (1) **don't expose "eagerness/low/medium/high" to students** — frame it in human terms ("How long should I wait before I reply?" → *Patient / Balanced / Snappy*). (2) For assignments, this is naturally a **teacher knob**, parallel to `feedback_mode` — teachers tuning wait-time per activity fits the "teacher-designed, AI-executed" thesis.

`★ Insight ─────────────────────────────────────`
- Eagerness is a *turn-control* knob, conceptually identical to the feedback/scaffold policies already in `assignment_resolver`. So it belongs in the same teacher-configurable surface, not as a one-off in `chat.py`. That's a small architectural tell: the realtime session config and the pedagogy-policy layer are converging into one "how this tutor behaves" bundle.
- This also means eagerness is itself a candidate **skill-pack parameter** (Phase ② keys on proficiency_tier anyway) — the registry could emit both prompt text *and* session-config knobs.
`─────────────────────────────────────────────────`

---

# Deepened research synthesis — all four areas

Verified and corrected for **gpt-realtime-mini** (your actual model). Here's what the four parallel investigations actually changed versus the existing spec.

## 1. Voice-model prompt engineering

The doctrine the spec already has (lean prompt, critical-rules-last, explicit unconditional phrasing) is **confirmed by OpenAI's own Realtime prompting guide** — but the agents added concrete craft:

- **Use labeled sections + bullets, not prose.** OpenAI explicitly recommends `## Role & Objective`, `## Personality & Tone`, `## Instructions`, `## Conversation Flow` etc. The model follows *labeled* directives far more reliably. Your tutor core should adopt this structure verbatim.
- **Anchor behaviors with literal example turns.** "The model closely mirrors provided examples." One good 2-sentence tutor turn + one bad (too-long) turn does more for talk-economy than any abstract "keep it short" rule.
- **The instruction-adherence ceiling is the gravitational constant — and it's *worse* for you.** The ~30–48% MultiChallenge-audio figures are for the *flagship*. gpt-realtime-mini sits below that. **This is the single most important architectural fact**: every additional simultaneous rule degrades adherence to all the others. It's the core argument for (a) a lean core, (b) **offloading correction to the coach track** so the live prompt carries fewer rules, and (c) *not* building Phase ③ runtime steering on a mini model.
- **Eagerness `low`=8s / `auto`=4s / `high`=2s** — verified. (Drives the decision above.)
- **Long-session drift is real** (degrades after 1–2 min). Mitigation that fits mini: re-inject the system prompt via `session.update` every ~10–12 turns; cap sessions at ~20–25 min and re-token. No per-turn machinery.

**Correction to the spec:** drop any "bump reasoning effort" notion — gpt-realtime-mini isn't a reasoning model.

## 2. Skill-pack registry architecture

The agent grounded your instinct into a buildable shape and caught the real traps:

- **Key space doesn't explode if you use sparse hierarchical fallback.** `(task_family × phase × locale × tier)` is ~288 naive rows, but you store only *deviations* from defaults (~15–25 real entries) and fall back: exact → wildcard-tier → wildcard-locale → phase-default. Same pattern as HTTP content-negotiation / Django template loaders.
- **Precedence = specificity wins, not priority weights.** Resolve "core says recast / pack says elicit" by writing packs to govern *conditions* ("on a rule-based grammar target, elicit first…"), never to restate the baseline. The core is the catch-all; packs are targeted overrides. This is already your spec's §6.5 rule, now generalized.
- **Versioning with no new persistence:** version-in-filename (`elicitation_correction_v2.py`) + write the active variant tag onto the existing `practice_sessions` doc. `practice_analytics.py` can then bucket by variant. **Zero new collections.**
- **Borrow from DSPy/LangSmith selectively:** DSPy's *optimize-against-a-metric* idea is the eval harness — but defer the actual framework until you have ≥50 scored transcripts; don't add LangSmith Hub (network dep at serve time). 
- **Hard "don't":** resist letting teachers author raw packs (un-evaluated prompt edits regress the tutor); keep teacher authority at the knob level (`feedback_mode`, eagerness, intensity).

## 3. Eval harness — measuring teacherness

This is where the research **tempered the spec's confidence**, and it matters:

- **The "≥3 rubric dimensions" gate can't be a hard gate on the hard dimensions.** BEA 2025 (arXiv 2507.10579): "providing guidance" was the *weakest* track (best F1 ~58). MRBench (arXiv 2412.09416) found LLM judges "unreliable" on guidance/scaffolding quality. So: **split the rubric** into *deterministic* metrics (talk-time ratio, target-expression recycle count, L1-token ratio, question density — compute these directly, no judge, high power) vs *LLM-judged* (mistake identification, anti-sycophancy, scaffold-vs-solve — reliable as 3-class with anchored examples) vs *soft-signal-only* (guidance quality — calibrate against ~20–30 human-labeled transcripts before trusting).
- **Simulated student has two documented failure modes**: competence leak (too-correctable) and alignment drift (drifts toward tutor register over turns — arXiv 2505.08351). Fixes: explicit error-inventory + anti-self-correction instruction + re-inject persona every ~5 turns + cap session length.
- **Cost reality:** the spec's "$0.05/50 sessions" is **too optimistic — realistic ~$0.22–0.35** with gpt-4o-mini judge. Cheaper judge (Gemini Flash) or 8-turn sessions get closer. Not a blocker, just correct the number.

## 4. Coach-track design

Strongest single addition across all four:

- **Cognitive-load theory gives you the timing rule precisely:** never demand *reading* during *active speech* (split-attention). Three legal windows — mid-turn (write silently, subdued), **between-turns (200–600ms gap = best moment to surface a chip)**, post-task (dense review fine). Beginners: max **one chip per turn**, single-word error label, expand-on-demand.
- **Biggest risk = ASR mishear → false error chip**, and it's cheap to de-risk: pipe word-level ASR confidence into the coach model's prompt; gate panel-writes at ≥0.7 and promote-back at ≥0.85. Eliminates ~70–80% of false positives at near-zero cost. (This *is* your spec's confidence-gating guardrail, now made concrete.)
- **Promote-back as precision/recall, asymmetric:** under-promotion → dead panel nobody repairs; over-promotion → naggy. Heuristic: surface an error pattern after **≥2 occurrences**, drop to **1 for teacher-target forms**, max once per ~3 turns, only at topic transitions, phrased as **elicitation not recast** (Lyster & Ranta: elicitation yields higher uptake than recasts).
- **Two-model dedup:** string-contains check — if the main tutor's transcript already contains the coach's `target_form`, mark addressed, don't re-surface. Coach = cheap text model (gpt-4o-mini), runs in the inter-turn gap (~300–500ms), fire-and-forget.

---

## The cross-cutting decision this surfaces

All four threads point at the same structural choice, and your model constraint sharpens it:

> **Because gpt-realtime-mini's instruction-adherence is low, the live voice prompt must do *less*, not more.** The coach track isn't just a feature — it's the mechanism that lets the main prompt shed its correction rules so the few rules it keeps (turn cap, language lock, always-invite-production) actually get followed.

That reframes the phasing slightly: the coach track (spec §7.1, currently Phase ②) is arguably *more* load-bearing than the spec treats it, precisely because of the mini model. Worth deciding whether a minimal coach-track slice should move earlier.

Want me to (a) write this up as a research addendum appended to the existing design doc, (b) pressure-test the revised plan with Codex, or (c) move into resolving the Phase ① open tensions and building `tutor_core.py`?

Sources:
- [gpt-realtime-2 Model | OpenAI API](https://developers.openai.com/api/docs/models/gpt-realtime-2)
- [OpenAI Releases Three New Realtime Voice Models (gHacks)](https://www.ghacks.net/2026/05/11/openai-releases-three-new-realtime-voice-models-for-the-api-with-gpt-5-class-reasoning/)
- [Voice activity detection (VAD) | OpenAI API](https://platform.openai.com/docs/guides/realtime-vad)
- [Realtime Prompting Guide — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/realtime_prompting_guide)
- [BEA 2025 Shared Task (arXiv 2507.10579)](https://arxiv.org/abs/2507.10579)
- [MRBench / Tutor Evaluation Taxonomy (arXiv 2412.09416)](https://arxiv.org/abs/2412.09416)
- [Alignment Drift in CEFR-prompted LLMs (arXiv 2505.08351)](https://arxiv.org/abs/2505.08351)