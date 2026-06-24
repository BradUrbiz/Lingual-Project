# Pedagogy Engine S5 Director v2 — Language-Drift Detection — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** Add a second drift signal to the S5 Director — **language-drift** (the tutor slipping out of the target language into English) — behind the existing `PEDAGOGY_ENGINE_DIRECTOR` flag.
**Why now:** S5 v1 shipped with one signal (target-neglect) and explicitly deferred language-drift. Per the engine's design doc §6.2, language drift is the canonical voice-adherence failure the Director exists to catch, so the Director addressing only target-neglect leaves its core purpose half-met. The locale-complete-matching slice (just shipped) is the enabler: for non-Latin locales (ko/ru/he), target-script-ratio detection is now a clean, robust signal.

---

## 0. TL;DR

The S5 Director catches between-turn drift and re-steers in-character. v1 detects **target-neglect**. v2 adds **language-drift**: the tutor should speak the target language but drifted into English (the L1). Two pure-heuristic tiers:

- **Non-Latin targets (ko/ru/he):** target-script ratio — if fewer than `TARGET_SCRIPT_MIN_RATIO` (0.5) of a turn's letters are in the target script (Hangul/Cyrillic/Hebrew), it drifted. Robust, high-confidence.
- **Latin targets (es/fr/tl):** English-function-word density — `ENGLISH_MARKER_MIN_HITS` (3) distinct distinctly-English function words in what should be a Spanish/French/Tagalog turn. Conservative heuristic (es/fr are the highest-traffic locales, so worth covering).

Language-drift takes **precedence** over target-neglect (a tutor not speaking the language is the more fundamental failure) and needs no assignment targets, so the v1 hard `concrete_targets` gate relaxes. Everything else reuses v1: `decide_resteer` (cooldown/cap guards, already generic on `verdict.kind`), the `injectPromoteBack` (voice) / `coachNote` (text) delivery, the `director_state`/`resteers` persistence. Pure, no LLM, byte-identical when the flag is off.

---

## 1. Scope

### In scope (all extend existing S5 code)
1. **`drift.py`** — `detect_language_drift(latest_tutor_turn, learning_locale) -> DriftVerdict` (kind `"language_drift"`); a pure locale→script classifier + the unicode-range tests + a conservative English-function-word set + three constants; extend `build_resteer_prompt` to branch on `verdict.kind` (target_neglect vs language_drift copy). `DriftVerdict.kind` doc updated to include `"language_drift"`.
2. **`director_service.assess_drift`** — extract `learning_locale` from `bootstrap["class"]["learningLocale"]`; run `detect_language_drift` on the latest tutor turn FIRST; fall back to `detect_target_neglect` only when language-drift is clean AND concrete targets exist; relax the hard `concrete_targets` early-return so a grammar-only assignment still gets language-drift coverage.
3. **Tests** — `detect_language_drift` truth table per tier; `build_resteer_prompt` language-drift copy; `assess_drift` precedence (language-drift fires before target-neglect; grammar-only assignment still language-checked).
4. **Docs** — `backend/CLAUDE.md` (drift.py now two signals), `LIMITATIONS.md` (update (mm) — language-drift now covered; note the Latin tier is a conservative heuristic), the pedagogy memory.

### Non-goals
- **No new flag, no new persistence key, no new route, no frontend change.** v2 rides the entire v1 plumbing (same flag, same `assess_drift` round-trip, same `resteers`/`director_state` keys, same delivery channels). The `kind` field already distinguishes the two signals in the audit log.
- **No LLM.** Both tiers are pure heuristics, consistent with v1 and the Director's cost discipline.
- **No per-kind cooldown budget.** v2 keeps the single shared cooldown + per-session cap across both drift kinds (don't over-nag). A separate, more-urgent budget for language-drift is a documented follow-up.
- **The remaining LLM-judged adherence dimensions** (anti-sycophancy, elicitation quality, etc.) stay deferred to the offline eval — unchanged from v1.

---

## 2. Approaches considered

1. **Two-tier heuristic (CHOSEN):** non-Latin script-ratio (robust) + Latin English-marker density (conservative). Covers all 6 target locales, pure, rides v1. Cost: the Latin tier is heuristic (false-positive risk on heavy code-switching) — mitigated by a conservative ≥3-distinct-marker threshold + a min-length guard + documentation.
2. **Non-Latin-only (script-ratio), defer Latin.** **Rejected:** es/fr are the highest-traffic locales; deferring them means language-drift doesn't help where it matters most. The English-function-word heuristic is robust enough at a conservative threshold.
3. **Per-turn LLM language classification.** **Rejected:** the Director is pure-heuristic by design (cost discipline); a 2nd LLM call per turn is exactly what S5 avoided.

---

## 3. The detector (pure — `detect_language_drift`)

**Signature:** `detect_language_drift(latest_tutor_turn: str, learning_locale: str) -> DriftVerdict` (kind `"language_drift"`, `target` = the target-language display name for the re-steer copy, e.g. "Korean"/"Spanish").

**Locale → script classification** (pure, local to `drift.py` — it cannot import `practice_analytics`; a small prefix matcher mirrors `_detect_locale_key`): `ko`/`ru`/`he` → non-Latin tier; `es`/`fr`/`tl` → Latin tier; anything else → no language signal (returns no-drift).

**Guards (both tiers):**
- Empty turn or unrecognized locale → no-drift.
- `letters = [c for c in turn if c.isalpha()]`; if `len(letters) < LANGUAGE_DRIFT_MIN_CHARS` (12) → no-drift (a greeting, a name, "OK!" carry too little signal).

**Non-Latin tier (ko/ru/he):**
- `target_chars = count of letters in the target script's unicode range` (Hangul `U+AC00–U+D7A3` + jamo `U+1100–U+11FF` + compat `U+3130–U+318F`; Cyrillic `U+0400–U+04FF`; Hebrew `U+0590–U+05FF`).
- `ratio = target_chars / len(letters)`. If `ratio < TARGET_SCRIPT_MIN_RATIO` (0.5) → **drift** (the turn is mostly Latin/English). Else no-drift. (A brief English code-switch keeps the ratio high → no false positive.)

**Latin tier (es/fr/tl):**
- `words = set(re.findall(r"[a-z']+", turn.lower()))`; `hits = words & _ENGLISH_FUNCTION_WORDS`. If `len(hits) >= ENGLISH_MARKER_MIN_HITS` (3) → **drift**. Else no-drift.
- `_ENGLISH_FUNCTION_WORDS`: a conservative frozenset of distinctly-English grammatical words that are NOT common es/fr/tl words (e.g. `the, is, are, was, were, you, your, what, which, with, this, that, they, would, should, could, have, does, okay, let, want, need, about, because, really`). Grammatical/function words (not content words) keep the false-positive rate low — a Spanish turn does not contain "the/is/you/what"; an English loanword like "sándwich" is a content word and is not in the set.

`re` is stdlib — adding `import re` to `drift.py` does not break the import boundary (the boundary test forbids openai/canvas/resolver/compliance, not stdlib).

---

## 4. The orchestrator change (`assess_drift`)

The current flow hard-returns when there are no concrete targets, then runs only target-neglect. v2 restructures the detection block (everything else — dedup, re-read-before-write, persistence, payload — is unchanged):

```python
learning_locale = _s((bootstrap.get("class") or {}).get("learningLocale"))
concrete_targets = [...]   # may now be empty — no early return on empty

# ... fetch transcript window → recent_tutor_turns (unchanged) ...
latest = recent_tutor_turns[-1] if recent_tutor_turns else ""

# Language-drift takes precedence (the tutor isn't even speaking the target language)
# and needs no assignment targets.
verdict = detect_language_drift(latest, learning_locale)
if not verdict.drift and concrete_targets:
    verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)
if not verdict.drift:
    return None
```

The v1 `if not concrete_targets: return None` early gate (after the mapping check) is removed; a missing/invalid `mapping` still returns None (language-drift can't help without a transcript anyway, and the mapping read precedes the transcript fetch). `decide_resteer`, the re-read-before-write, the `serialize_resteer` record, and the returned payload all already key off `verdict.kind`/`verdict.target`, so they carry `"language_drift"` with no further change.

---

## 5. The re-steer copy (`build_resteer_prompt`)

Branch on `verdict.kind`:
- **`target_neglect`** (unchanged): "…naturally create a reason for the learner to use «{target}»…".
- **`language_drift`**: e.g. *"COACH NOTE (act in character — do not read this aloud): your last turn drifted into English. Respond in {target} from here; continue the scene in {target} so the learner stays immersed."* Terser on voice (the existing `tail` pattern).

Here `verdict.target` is the language name ("Korean"/"Spanish"), not an expression — the copy reads naturally either way because the branch chooses the phrasing.

---

## 6. Error handling, success criteria, testing

**Error handling.** Entirely within v1's fail-open `assess_drift` (one try/except → None). Pure detector, no I/O, no new dependency. Flag-off path unchanged (returns None before any work). Byte-identical when off.

**Success criteria.**
- A Korean/Russian/Hebrew tutor turn that is mostly English → `language_drift` re-steer (kind `"language_drift"`, target the language name).
- A Spanish/French tutor turn dense with English function words → `language_drift` re-steer.
- A clean target-language turn → no language-drift; target-neglect still evaluated (precedence preserved).
- A grammar-only assignment (no concrete targets) still gets language-drift coverage (the relaxed gate).
- Flag off → None; existing target-neglect behavior unchanged when no language drift.

**Testing.**
- `detect_language_drift`: ko mostly-Hangul → no drift; ko mostly-English → drift; ru Cyrillic → no drift, ru English → drift; he Hebrew → no drift, he English → drift; es clean → no drift, es English-dense → drift; short turn → no drift (min-length guard); brief code-switch (one English word in a Korean turn) → no drift (ratio guard); unknown locale → no drift.
- `build_resteer_prompt`: language_drift copy names the target language + differs from target_neglect copy; voice terser.
- `assess_drift` (fakes): language-drift fires and is returned with kind `"language_drift"`; language-drift takes precedence over a co-occurring target-neglect; grammar-only assignment (empty concrete_targets) still returns a language-drift payload; clean turn + no targets → None; flag off → None.
- Regression: v1 target-neglect tests still pass (a clean-language turn with neglected targets still yields target_neglect).

---

## 7. Files

| File | Change |
|---|---|
| `backend/services/pedagogy/drift.py` | `detect_language_drift` + script classifier + unicode-range tests + `_ENGLISH_FUNCTION_WORDS` + constants (`LANGUAGE_DRIFT_MIN_CHARS=12`, `TARGET_SCRIPT_MIN_RATIO=0.5`, `ENGLISH_MARKER_MIN_HITS=3`); `build_resteer_prompt` kind-branch; `import re`; `DriftVerdict.kind` doc |
| `backend/services/director_service.py` | extract `learning_locale`; language-drift-first detection with target-neglect fallback; relax the concrete_targets gate |
| `backend/tests/test_pedagogy_drift.py` | language-drift detector + prompt-copy tests |
| `backend/tests/test_director_service.py` | precedence + grammar-only + flag-off tests |
| docs | `backend/CLAUDE.md` (drift.py = two signals), `LIMITATIONS.md` ((mm) updated), pedagogy memory |

---

## 8. Follow-ups (logged)
- **Per-kind cooldown budget** — language-drift is more urgent than target-neglect; a separate (shorter) cooldown or a dedicated budget could let it fire more readily. v2 shares one budget.
- **Latin-tier refinement** — the English-function-word set + threshold are heuristic first-values; tune from real es/fr session phrasing (and watch Taglish false positives for tl) post-cutover.
- **The remaining LLM-judged adherence dimensions** (anti-sycophancy, elicitation quality) stay in the offline eval; promote to live only if eval evidence warrants.
- **Cutover** of the whole S5 Director (v1+v2) remains gated on the S5-gate eval verdict — unchanged.
