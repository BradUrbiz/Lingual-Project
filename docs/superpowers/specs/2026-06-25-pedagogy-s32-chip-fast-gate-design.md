# S3.2 Coach-Chip Fast Gate — Design

**Date:** 2026-06-25
**Status:** Design (approved approach: "Balanced" cost posture)
**Flag:** `PEDAGOGY_ENGINE_CHIP_FAST_GATE` (default `0`)
**Slice owner:** fork `s32`

## Problem

The live S3.2 coach chip lags — in runtime verification it first rendered on
**turn 3** (as a promote-back), never on the early error turns. Root cause:

- The chip gate (`coach_chip_service._turn_had_corrective_signal`) opens on
  `metric.error_detected` (the intended **turn-1 fast path**),
  `metric.repeated_error` (≥2), or the tutor's
  `feedback.recast/elicitation/review_item`.
- `metric.error_detected` / `metric.repeated_error` are produced by
  `practice_analytics._detect_student_errors` → `ERROR_RULES`, which contain
  regex patterns for **`en` and `fr` only**, further gated by focus-grammar
  match. **There are zero `es` and zero `ko` rules.**
- Therefore, for Spanish and Korean (the locales US schools and our own
  testing use most), the fast path can **never** fire. The chip only appears
  via the tutor-recast `feedback.*` path, which requires the tutor to produce
  a recast whose phrasing matches a marker — hence the multi-turn lag.

The chip's heuristic gate is a **cost optimization** (avoid spending a
`gpt-5.4-mini` chip-eval call every turn); the actual "is a chip warranted"
judgment is already made by the LLM in `parse_coach_chip`. The gate being
English/French-only means we withhold that LLM call on exactly the turns a
beginner most needs a chip.

The mission requires the engine stay **language-agnostic** ("adding a locale
is a config change, not a product initiative"). So the fix is **not** adding
`es`/`ko` regex tables; it is a locale-agnostic trigger.

## Approach (approved: "Balanced")

Two additions to the chip gate, both behind `PEDAGOGY_ENGINE_CHIP_FAST_GATE`:

1. **Locale-agnostic L1-fallback signal** — open the gate on the *current*
   learner turn when the learner reverted to L1/English or produced too little
   target-language content. This is the single most common beginner failure
   (e.g. "Hola, I want a coffee please") and is detectable in any language
   with no per-language tables — the learner-side inverse of the S5
   `drift.py` language-drift detector.

2. **Bounded floor** — give in-target-language slips (e.g. "Yo querer…",
   which is Spanish but wrong, and which no heuristic flags) an LLM look every
   `FLOOR_TURN_GAP` turns even absent a flagged signal. The LLM still decides
   whether to emit a chip (can return `None`), so this adds bounded eval cost,
   not false chips.

When the flag is **off**, the gate is byte-identical to today.

## Why localize to `coach_chip_service` (not the analytics stream)

The turn handler (`curriculum_admin.py`) creates the turn's `learning_events`
(via `build_derived_learning_events`) **before** calling `generate_coach_chip`
(verified: events created lines ~654–681, chip called line ~780). So a new
metric event *would* be visible to the turn-N gate. **But** we deliberately do
NOT emit a new learning_event:

- The chip service already fetches the transcript window, so it can compute
  L1-fallback from the latest learner utterance directly.
- Not touching `learning_events` keeps the analytics/debrief aggregations and
  the flag-off behavior byte-identical, with zero blast radius into the live
  analytics path.

## Architecture

### New pure module: `backend/services/pedagogy/language_signal.py`

Stdlib-only (import-boundary invariant 7a). Houses the language-detection
primitives currently private to `drift.py`, plus the learner-side detector:

```python
def language_locale_key(locale: object) -> str:
    """'ko-KR' -> 'ko'; matches ko/ru/he/es/fr/tl, else 'en'."""

def is_target_script_char(ch: str, locale_key: str) -> bool:
    """True if ch is in the target script (Hangul/Cyrillic/Hebrew)."""

ENGLISH_FUNCTION_WORDS: frozenset[str]   # distinctly-English function words

# Minimum learner-turn length below which we have too little signal (greetings,
# names). Mirrors drift.LANGUAGE_DRIFT_MIN_CHARS.
SHORTFALL_MIN_CHARS = 12
TARGET_SCRIPT_MIN_RATIO = 0.5    # non-Latin: < this fraction of letters in target script -> shortfall
ENGLISH_MARKER_MIN_HITS = 3      # Latin: >= this many distinct English function words -> shortfall

def detect_target_language_shortfall(content: str, locale: object) -> bool:
    """True when a learner turn of >= SHORTFALL_MIN_CHARS letters is
    predominantly L1/English rather than the target language.
      - non-Latin target (ko/ru/he): target-script-letter ratio < TARGET_SCRIPT_MIN_RATIO
      - Latin target (es/fr/tl): >= ENGLISH_MARKER_MIN_HITS distinct English function words
      - target locale en / unknown: always False (no target ≠ L1 distinction)
    Pure; no side effects."""

def produced_target_language(content: str, locale: object) -> bool:
    """Inverse-ish helper for the floor: True when the learner produced
    >= SHORTFALL_MIN_CHARS letters of content that is NOT a shortfall
    (i.e. real target-language output worth an LLM look)."""
```

`drift.py` is refactored to import `language_locale_key`,
`is_target_script_char`, and `ENGLISH_FUNCTION_WORDS` from this module
(removing its private copies). **`drift.py`'s observable behavior must stay
byte-identical**, verified by the existing drift tests. (S5 `DIRECTOR` is
off in prod, so there is no live-path risk, but behavior parity is still
required.)

### `coach_chip_service.generate_coach_chip` changes

- Fetch the transcript window **before** the gate (today it is fetched
  after). Extract the latest learner utterance = last `role == "user"` message
  in the window.
- Read `chip_fast_gate_enabled()` once.
- Gate decision (replaces the single `_turn_had_corrective_signal` check):

```
corrective = _turn_had_corrective_signal(events, turn_index)   # unchanged set

if fast_gate_enabled:
    shortfall = detect_target_language_shortfall(latest_learner, locale)
    last_eval = analysis_state["coach_chip_last_eval_turn"]  # int | None
    gap = (turn_index - last_eval) if last_eval is not None else (turn_index + 1)
    floor = (gap >= FLOOR_TURN_GAP) and produced_target_language(latest_learner, locale)
    open_gate = corrective or shortfall or floor
else:
    open_gate = corrective

if not open_gate:
    return None
```

- `FLOOR_TURN_GAP = 2` (module constant in `coach_chip_service`).
- `locale` for detection: from the session (`_session_learning_locale`
  equivalent — the chip service has the session record; reuse the same locale
  the analytics path uses).
- **Persist `coach_chip_last_eval_turn = turn_index`** in `analysis_state`
  whenever the LLM eval is actually run (i.e. once the gate opens and we
  proceed to call the model), on the same re-read-before-write
  `analysis_state` update that already writes `coach_chips`. This is what
  bounds the floor: a floor-eval that returns no chip still advances
  `last_eval_turn`, so the floor fires at most once per `FLOOR_TURN_GAP`
  turns regardless of chip outcomes. Set it even when `parse_coach_chip`
  returns `None` (so we must write analysis_state on the None path too, when
  fast gate is on and the eval ran).

`normalize_analysis_state` gains the `coach_chip_last_eval_turn` field
(default `None`), alongside the existing `coach_chips` / `promote_back_state`
/ `promotions`.

### Flag: `backend/services/pedagogy/integration.py`

```python
def chip_fast_gate_enabled() -> bool:
    return _flag("PEDAGOGY_ENGINE_CHIP_FAST_GATE")
```
(mirrors `coach_chips_enabled` / `promote_back_enabled`.)

### `cloudbuild.yaml`

Add `_PEDAGOGY_ENGINE_CHIP_FAST_GATE` to the `--set-env-vars` line and the
substitutions block, default `'0'`. (REPLACE-safety: every other substitution
default already matches live; this is an additive `'0'`, safe.)

## Behavior matrix

| Turn (es scaffolded cafe) | Today | With fast gate |
|---|---|---|
| T1 "Hola, I want a coffee please" (L1 fallback) | no chip | **chip evaluated T1** (shortfall) |
| T2 "Yo querer un café" (in-target error) | no chip | chip evaluated (floor, gap≥2 from T0) |
| T3 correct usage | chip (review_item, recast path) | chip (unchanged path) |

For `ko` the same holds: non-Latin script-ratio drives the shortfall signal;
a learner answering an `아메리카노 한 잔 주세요` prompt in English trips T1.

## Cost

Per session the extra `gpt-5.4-mini` chip-eval calls are bounded by
`ceil(turns / FLOOR_TURN_GAP)` plus shortfall turns (which overlap). For an
8-turn text session: ≤ ~4 evals vs. today's ~1. Flag-gated so we can measure
and dial `FLOOR_TURN_GAP` before/after cutover.

## Out of scope

- Adding `es`/`ko` `ERROR_RULES` (anti-mission; explicitly rejected).
- Changing `parse_coach_chip`'s chip-worthiness judgment.
- The "Aggressive" posture (eval every turn).
- Voice-specific tuning (the gate is modality-agnostic; voice rides the same
  round-trip).

## Verification

1. Unit: `language_signal` detector (es/ko/fr/ru/he/en + edge cases: short
   greeting, perfect target sentence, code-switch); gate logic (flag off =
   byte-identical; shortfall opens T1; floor cadence + `last_eval_turn`
   bounding); drift.py parity.
2. Runtime: drive the Spanish `cafe scaffolded` and Korean
   `한국어 카페 주문 (chip test)` beds with the flag on — confirm a chip
   evaluates on T1 for an English-fallback turn, and the teacher debrief still
   aggregates correctly. Flag off → confirm no behavior change.
