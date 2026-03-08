# Avatar Expression Limitations

## Purpose

This document records the currently known limitations of Lingual's `/app/chat` Live2D avatar stack.

It is intentionally narrower than the improvement plan. This file is a running limitations log so future implementation work can distinguish between:

- design goals
- current shipped behavior
- known quality ceilings

## Current Limitations

### 1. Explicit avatar directives are not the default runtime path

The `emit_avatar_directive` tool path exists, but it was disabled by default after Realtime continuation regressions.

Practical effect:

- the avatar often falls back to transcript-based affect inference
- tutor intent can feel less deliberate than intended
- the quality gap versus benchmarked vtuber behavior is larger than it should be

### 2. Mouth motion is now speech-shaped, but still heuristic

The current mouth pipeline is driven primarily by:

- remote audio RMS
- speech-shaped mouth drive
- transcript-derived vowel bias
- planner-generated jaw target

Practical effect:

- the mouth is more expressive than a plain RMS gate, but still not true phoneme/viseme playback
- speech rhythm can still drift from the exact spoken audio
- expression quality can still feel uncanny on some phrases even when the face is not frozen

### 3. Motion layering is still shallow

The runtime selects symbolic motion and expression banks, but speaking turns are still not layered enough to feel fully natural.

Practical effect:

- motion can look state-based rather than continuously performed
- long assistant turns may not feel rich enough
- transitions between turn phases can still feel mechanical

### 4. Interaction quality is limited

`avatar.hit` is supported, but the visible reaction behavior is still fairly light.

Practical effect:

- taps may not yet feel strongly acknowledged
- local reaction and assistant follow-through are not yet tightly choreographed

### 5. The current Mao asset imposes an expression ceiling

The current Live2D model does not have an unlimited authored expression library.

Practical effect:

- runtime improvements can raise quality substantially, but not infinitely
- if higher emotional range is required, the model asset itself may need to change

### 6. Live browser validation is still required for some avatar-quality conclusions

Several debug and diagnostic paths are implemented, but some issues can only be confirmed while a live assistant turn is happening in the browser.

Practical effect:

- some problems may still require manual observation with Debug enabled
- renderer, audio-feed, and asset limitations can still be confused without live confirmation

### 7. Explicit directive semantics are still intentionally coarse

The current explicit directive contract is stronger than plain transcript heuristics, but it still compresses acting intent into a relatively small symbolic set:

- `emotionKey`
- `expressionId`
- `motionRef`
- `reactionIntent`
- `intensity`

Practical effect:

- visually distinct turns are more achievable than before, but not infinitely nuanced
- subtle differences such as "gentle correction" versus "firm correction" can still collapse together
- future work may still need richer directive fields such as gaze, emphasis, or speech-style hints

## Current Diagnostic Rules

- If `RMS` and `Mouth target` move but actual `ParamA` stays flat, the issue is renderer/apply related.
- If actual `ParamA` changes but the face still appears static, the issue is likely asset/parameter-range related.
- If speaking events fire but RMS stays flat, the issue is likely audio-feed related.

## Immediate Follow-up Areas

The next high-priority areas remain:

1. safe reactivation of explicit avatar directives
2. richer mouth shaping beyond plain RMS
3. stronger talk-motion layering
4. more noticeable and contextual interaction reactions
