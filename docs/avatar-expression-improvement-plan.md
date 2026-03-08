# Avatar Expression Improvement Plan

## Purpose

This document defines the improvement plan for making the `/app/chat` tutor avatar feel materially more alive, expressive, and responsive.

The goal is not to copy the implementation of Open-LLM-VTuber. The goal is to benchmark its architecture and user-perceived strengths, then raise Lingual's own Live2D acting quality within the current product constraints:

- keep `/app/chat` on browser-direct OpenAI Realtime for low latency and interruption
- keep the official Cubism Web SDK renderer
- improve expression richness, lipsync quality, motion layering, and contextual reactions

## Scope

In scope:

- `/app/chat` voice mode
- Live2D acting quality
- explicit avatar directive channel on the Realtime path
- lipsync / mouth motion quality
- motion/expression timing
- hit reaction quality
- responsive framing quality where it materially affects perceived avatar quality

Out of scope for this plan:

- replacing OpenAI Realtime transport
- rebuilding the entire chat product architecture
- changing text mode behavior
- adding full hand/body choreography beyond what the current model and runtime can support
- replacing the avatar asset immediately

## Benchmark Reference

Primary benchmark:

- Open-LLM-VTuber repo: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber

Useful reference pages:

- Live2D guide: https://docs.llmvtuber.com/en/docs/user-guide/live2d/
- Web mode guide: https://docs.llmvtuber.com/en/docs/user-guide/web-mode/
- v1.2.0 release note: https://docs.llmvtuber.com/en/blog/v1.2.0-release
- Model config reference: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/main/model_dict.json

## Current Lingual Architecture

### Active transport

`/app/chat` voice mode currently uses browser-direct OpenAI Realtime:

1. backend creates ephemeral session via `POST /api/realtime/session`
2. browser connects to OpenAI Realtime with WebRTC
3. client parses transcript, audio, and function-call events in `frontend/src/hooks/useRealtimeChat.ts`
4. avatar performance is generated client-side
5. Live2D is rendered client-side through the official Cubism Web SDK

### Current avatar pipeline

Relevant files:

- `backend/routes/chat.py`
- `frontend/src/hooks/useRealtimeChat.ts`
- `frontend/src/components/avatar/types.ts`
- `frontend/src/components/avatar/performance.ts`
- `frontend/src/components/avatar/useAvatarPerformance.ts`
- `frontend/src/components/avatar/live2dManifest.ts`
- `frontend/src/components/avatar/live2dMapping.ts`
- `frontend/src/components/avatar/live2dSelection.ts`
- `frontend/src/components/avatar/OfficialCubismModel.ts`
- `frontend/src/components/avatar/Live2DAvatarPanel.tsx`
- `frontend/src/pages/AppChatPage.tsx`

Current runtime flow:

1. `useRealtimeChat()` receives:
   - `isListening`
   - `isSpeaking`
   - `remoteAudioStream`
   - assistant transcript
   - optional avatar directive function calls
2. `useAvatarPerformance()` resolves:
   - dialogue state
   - affect
   - jaw/blink/gaze/head/chest values
3. `buildLive2DParameterTargets()` maps that state into Mao model parameters
4. `Live2DAvatarPanel` resolves symbolic expression/motion banks and applies them through the official Cubism SDK

### Current strengths

- low-latency Realtime transport is preserved
- explicit avatar directive channel exists conceptually
- symbolic expression and motion banks already exist
- weighted bank selection already exists
- renderer-side mouth diagnostics already exist
- backend-aware `avatar.hit` context injection already exists

## Benchmark Comparison

### What Open-LLM-VTuber is strong at

Based on the public repo and docs, the benchmark product gets much of its perceived quality from:

- explicit Live2D-oriented emotion configuration (`defaultEmotion`, `emotionMap`, `tapMotions`, idle/talk motion config)
- tighter coupling between speaking state and avatar acting
- clear interaction affordances on tap/hit areas
- simpler but more intentional model-facing configuration
- runtime polish around talk motion, expression timing, and blink/expression conflicts

### Where Lingual is already competitive

Lingual already has several structural advantages:

- official Cubism Web SDK renderer
- more detailed parameter-level control for mouth, eyes, brows, gaze, body, breath
- symbolic expression/motion banking rather than hardcoding only one expression
- backend-aware contextual tap handling on the Realtime path
- direct debug visibility into target vs actual mouth parameters

### Where Lingual still feels weaker

Perceived expressiveness is still below the benchmark because of four main gaps:

1. explicit directive control is not yet the dominant runtime path
2. mouth motion is still largely amplitude-driven rather than viseme-like
3. talk motion layering is shallow
4. interaction reactions are not yet rich enough in timing and variation

## Core Diagnosis

### Gap 1: Explicit acting control is present but not operationally central

We added `emit_avatar_directive`, but the directive path had Realtime continuation regressions and was later disabled by default for safety.

Practical effect:

- the system often falls back to transcript heuristics
- expressions feel inferred rather than intentionally performed
- distinct tutor intents blur together

### Gap 2: Mouth movement quality is still too synthetic

Current mouth logic is derived primarily from:

- `remoteAudioStream` RMS
- a synthetic talk pulse
- planner-generated jaw openness

Practical effect:

- speaking can look alive, but not linguistically grounded
- vowels and emphasis do not feel tied to actual speech shape
- the avatar can still look uncanny even if the mouth is technically moving

### Gap 3: Motion is selected, but not layered enough

Current runtime mostly chooses one motion bank and one expression bank at a time.

Practical effect:

- the avatar can feel like it is switching between prepackaged states
- speaking turns lack continuous micro-acting
- turn transitions are less fluid than they should be

### Gap 4: Interaction reactions are still too shallow

`avatar.hit` exists and is contextualized, but the reaction quality is still modest.

Practical effect:

- taps do not yet produce a strong "the avatar noticed me" feeling
- local reaction and assistant follow-through are not yet choreographed tightly enough

### Gap 5: Current model asset imposes a ceiling

The current Mao model has a limited expression library.

Practical effect:

- even a better control stack will eventually hit asset limits
- if stronger expressiveness is required, the model itself may need replacement or expansion

## Target State

Lingual should behave like a deliberate speaking performer, not a UI decoration.

Target characteristics:

- distinct visual difference between `encouraging`, `curious`, `corrective`, `affirming`, and `apologetic`
- visible but not exaggerated talk motion during assistant speech
- mouth movement that follows speech rhythm more credibly
- immediate and contextual hit reactions
- lower repetition across consecutive turns
- natural transition between listening, thinking, speaking, and post-speaking recovery

## Improvement Strategy

The work should proceed in phases. Earlier phases unlock later ones. Do not skip the stabilization phases.

## Phase 0 - Instrumentation And Baseline

### Objective

Establish a repeatable way to measure whether acting quality is improving.

### Work

- confirm renderer debug overlay is trustworthy for:
  - `audioLevel`
  - `rmsLevel`
  - `mouthTarget`
  - actual `ParamA/I/U/E/O`
  - directive source
  - last explicit directive
- add lightweight counters in dev mode for:
  - how often `emit_avatar_directive` is emitted
  - how often fallback mode is used
  - how often the same expression repeats in adjacent assistant turns
  - how often the same motion repeats in adjacent assistant turns
- add a manual benchmark checklist for:
  - listening
  - question turn
  - encouragement turn
  - correction turn
  - apology/reassurance turn
  - tap reaction

### Acceptance

- we can tell whether weak expressiveness is caused by:
  - missing directive events
  - bad mouth feed
  - renderer application failure
  - model asset limitation

## Phase 1 - Restore Explicit Directive Path Safely

### Objective

Make explicit avatar directives the primary acting signal again without breaking Realtime voice.

### Work

- stabilize `emit_avatar_directive` continuation behavior on the Realtime path
- re-enable directives behind a controlled environment flag during development
- verify function-call completion, acknowledgement, and continuation ordering
- ensure directives never block or starve assistant audio
- log directive coverage per turn in dev mode

### Key files

- `backend/routes/chat.py`
- `frontend/src/hooks/useRealtimeChat.ts`
- `frontend/src/hooks/useRealtimeChat.test.tsx`

### Acceptance

- assistant audio still speaks reliably
- interruption still works
- directive events are observed in a significant portion of meaningful assistant turns
- fallback mode is not the dominant path during rich assistant turns

## Phase 2 - Make Directive Semantics Richer

### Objective

Upgrade the directive channel from "occasionally pick an expression" to "describe how this turn should be performed."

### Work

- strengthen backend prompt instructions for when to emit directives
- expand symbolic directive semantics with stronger policy, not necessarily more raw fields yet
- define explicit expectations for:
  - question asks
  - encouragement
  - reassurance
  - correction
  - acknowledgment
  - tap follow-through
- add turn-level intent guidance so the model emits the directive near the start of a turn
- ensure subtitle text and reaction intent are coherent with motion/expression choice

### Potential future extension

If current fields are too narrow, consider extending the directive contract with:

- `microIntent`
- `gazeIntent`
- `speechStyle`
- `emphasisPattern`

This should happen only after Phase 1 is stable.

### Acceptance

- benchmark conversations show visually distinct tutor intentions
- question, correction, and encouragement no longer collapse into similar looks

## Phase 3 - Improve Mouth Quality Beyond RMS

### Objective

Reduce the uncanny quality of speaking motion.

### Work

- keep current RMS path as fallback
- introduce a more speech-shaped mouth envelope:
  - attack/decay smoothing
  - syllable pulse shaping
  - vowel bias estimation
  - stronger emphasis on sentence stress
- if the TTS or Realtime path can provide phonetic or viseme-like hints later, integrate them without redesigning the renderer
- tune how `ParamA/I/U/E/O` are balanced so the model does not look like it only opens vertically
- differentiate:
  - normal speaking
  - question ending
  - soft reassurance
  - emphatic correction

### Key files

- `frontend/src/components/avatar/performance.ts`
- `frontend/src/components/avatar/live2dMapping.ts`
- `frontend/src/components/avatar/useAudioRms.ts`
- `frontend/src/components/avatar/Live2DAvatarPanel.tsx`

### Acceptance

- `Mouth target` and actual `ParamA/I/U/E/O` move in a way that visually matches speech rhythm
- mouth no longer looks like a simple metronome pulse during long replies

## Phase 4 - Layer Talk Motion More Intelligently

### Objective

Make speaking feel continuous rather than bank-switched.

### Work

- separate "base speaking motion" from "micro expression behavior"
- keep one base talk motion active across a turn unless a stronger trigger overrides it
- layer:
  - head beat
  - gaze settling
  - brow modulation
  - shoulder/breath motion
  - blink timing
over the active motion
- avoid restarting motions too aggressively when only expression changes
- add stronger post-speaking recovery behavior instead of snapping back

### Key files

- `frontend/src/components/avatar/live2dSelection.ts`
- `frontend/src/components/avatar/Live2DAvatarPanel.tsx`
- `frontend/src/components/avatar/live2dMapping.ts`
- `frontend/src/components/avatar/performance.ts`

### Acceptance

- motion continuity is preserved across a full spoken turn
- the avatar feels like it is talking through the sentence rather than replaying isolated clips

## Phase 5 - Improve Interaction Richness

### Objective

Make taps feel immediate, contextual, and characterful.

### Work

- strengthen local instant reaction for each hit area
- ensure the backend-aware follow-up influences the next assistant turn more reliably
- vary reactions across repeated taps using cooldown and rotation
- define separate reaction behavior for:
  - head
  - face
  - body
  - chest
  - hand
- ensure interaction does not break speaking state, interrupt handling, or Realtime continuity

### Key files

- `frontend/src/components/avatar/Live2DAvatarPanel.tsx`
- `frontend/src/hooks/useRealtimeChat.ts`
- `backend/routes/chat.py`

### Acceptance

- a tap produces an immediate visual reaction
- the next assistant behavior reflects the tap context in a visible and coherent way

## Phase 6 - Reduce Repetition

### Objective

Prevent the avatar from feeling formulaic across repeated turns.

### Work

- tune expression bank weights and cooldowns
- tune motion bank weights and cooldowns
- add turn-memory so the same bank is less likely to repeat on adjacent turns
- add small randomized variation within safe ranges for:
  - smile strength
  - brow lift
  - head beat amplitude
  - blink offset

### Acceptance

- repeated assistant turns no longer visibly reuse the same expression/motion pattern too often

## Phase 7 - Responsive Presentation Quality

### Objective

Make the avatar framing and stage composition reliable across desktop and mobile-like layouts.

### Work

- keep safe-area-based framing
- tune portrait / standard / wide profiles against actual UI occupancy
- add model-specific face-focus offset if the prop silhouette biases the visible center
- ensure bottom HUD and side padding do not visually fight the face position

### Acceptance

- face and upper torso remain the dominant focal area across supported aspect ratios

## Phase 8 - Asset Ceiling Evaluation

### Objective

Determine whether the current Mao model can realistically meet the target quality.

### Work

- audit the actual expression count and range of the current asset
- identify which desired emotional states are impossible or weak with current expressions
- decide whether to:
  - keep Mao and tune harder
  - add extra authored expressions
  - replace the avatar model with a richer licensed asset

### Decision rule

Do not replace the model until the control stack is improved through Phases 1 to 6. Otherwise asset replacement and runtime weaknesses will get conflated.

## Suggested Execution Order

1. Phase 0 - Instrumentation and baseline
2. Phase 1 - Restore explicit directive path safely
3. Phase 2 - Richer directive semantics
4. Phase 3 - Improve mouth quality
5. Phase 4 - Layer talk motion
6. Phase 5 - Improve interaction richness
7. Phase 6 - Reduce repetition
8. Phase 7 - Responsive presentation quality
9. Phase 8 - Asset ceiling evaluation

## Prioritization Rule

If a task improves only visual polish but does not improve control, do it after explicit directive reliability and mouth quality.

Reason:

- weak control makes every other visual improvement feel fake
- better lipsync and better intent signaling provide the highest perceived gain fastest

## Risks

- Realtime tool-calling can regress audio continuity if continuation ordering is wrong
- current OpenAI quota or project limits can hide avatar improvements behind response failures
- the Mao model may have insufficient expression range for the target bar
- overdriving parameters can create a more uncanny result rather than a better one
- expression richness without motion continuity can still feel robotic

## Definition Of Success

The plan is successful when `/app/chat` shows all of the following:

- the avatar visibly distinguishes encouragement, curiosity, correction, affirmation, and apology
- speaking turns feel synchronized enough that users stop calling out the mouth as obviously wrong
- tap reactions feel noticed and contextual
- repeated turns do not look like the same animation loop
- responsiveness remains compatible with the current low-latency Realtime experience

## Immediate Next Steps

Start with Phase 0 and Phase 1.

Concrete first tasks:

1. verify whether explicit directives are currently disabled in the active local environment
2. run live dev validation with debug overlay enabled
3. confirm whether Realtime still emits reliable audio when directives are re-enabled
4. measure fallback-vs-directive usage on real turns
5. only after that, tune mouth shaping and motion layering
