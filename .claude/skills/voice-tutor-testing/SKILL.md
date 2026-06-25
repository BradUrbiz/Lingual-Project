---
name: voice-tutor-testing
description: This skill should be used when the user wants to test, dogfood, or debug Lingual's realtime VOICE tutor by speaking to it — e.g. "test the voice tutor", "dogfood voice practice", "drive the realtime voice chat", "the voice tutor isn't responding", "inject audio into the call", "run the voice harness", "voice QA", or any task that needs spoken input into a voice assignment. It drives the live tutor by synthesizing typed text (TTS) and injecting it as the page microphone. NOT for normal (non-audio) browser testing — use playwright-cli for that.
version: 0.1.0
---

# Voice Tutor Testing (TTS injection harness)

Drive Lingual's realtime voice tutor with scripted text: each line is synthesized
(TTS) and injected into the page as **live microphone input**, so a spoken
conversation with the tutor runs without a real mic. The harness lives at
`e2e/voice-harness/` — this skill is the when/how/gotchas layer; the code and full
docs are there (`e2e/voice-harness/README.md`).

## When to use this vs playwright-cli

- **playwright-cli** drives all normal browser testing (clicks, forms, navigation,
  screenshots). It is the default per the repo CLAUDE.md and CANNOT inject audio.
- **This harness** is the one exception: it is for getting *spoken input* into the
  realtime voice tutor (`useRealtimeChat.ts` → getUserMedia → WebRTC → OpenAI). Reach
  for it only when the task needs voice. For everything else, use playwright-cli.

## How it works (one non-obvious thing)

The harness overrides `getUserMedia` so the mic stream is a synthetic audio bus
created once and kept live for the whole WebRTC session; each utterance is decoded
and played into it. The naive `--use-file-for-fake-audio-capture` launch flag is
read once at browser launch and can't swap audio mid-call, so it can't do multi-turn.

**The critical gotcha — always required:** the session uses `semantic_vad` with
`create_response: false` (`backend/routes/chat.py:371-376`). With a synthetic mic the
server fires `speech_started` and transcription deltas, but **never fires
`speech_stopped`** on the digital-clean trailing silence, so the turn never commits
and the tutor stays silent. The harness fixes this by sending
`input_audio_buffer.commit` itself after each utterance (`window.__voiceHarness.commitInput()`),
which closes the turn the way the server VAD does for a real student; the app's real
`shouldRespondToRealtimeTurn` gate then runs. `speak()` already does this — do not
remove it, and if writing new driver code, always commit after injecting.

## Setup

```bash
cd e2e/voice-harness && npm install   # playwright-core only; uses installed Chrome
```
OpenAI TTS reads `OPENAI_API_KEY` from env or the repo-root `.env`. Verify the
injection path with zero prod/Realtime spend first: `npm run selftest`.

## Two entry points

1. **`harness.js`** — interactive. `node harness.js --auto-login` opens prod (headed),
   logs in the test student; navigate to a voice assignment and click the mic
   yourself, then type lines at `speak>` (each is spoken into the call) or pass
   `--turns=<file>`.

2. **`live-smoke.js`** — fully scripted, auto-navigating, staged. Use this to drive a
   run end to end without manual clicks:
   ```bash
   node live-smoke.js --stage=recon                         # list the student's assignments (no spend)
   node live-smoke.js --stage=launch --assignment=<id>      # confirm voiceAllowed (no spend)
   node live-smoke.js --stage=voice --fresh --turns=turns.example.txt --assignment=<id>   # full multi-turn (spends Realtime+TTS)
   ```
   `--fresh` starts a clean attempt; per turn it injects, commits, polls for the
   tutor reply, and screenshots `turn-N.png`.

## Diagnostics (when the tutor doesn't respond)

The decisive tool is the realtime data-channel sniffer: `inject.js` records every
event into `window.__vhEvents` (in/out). Dump it to see exactly what the server
sent — `speech_started`? `transcription.completed`? `error`? Nothing? Also
`window.__voiceHarness.outboundAudioStats()` proves audio is transmitted
(`bytesSent`, `audioLevel`). Pattern: if `speech_started` + transcription deltas
arrive but no `transcription.completed`, the turn didn't commit (see the gotcha).

## Test beds and credentials

- Student: `teststudent@testing.com` / `lingual123` on `l1ngual.com` (NOT lingual.app).
- Spanish café voice bed: assignment `O1ek67KJXnw6UdhpoISL` (Testing Class).
- Korean voice bed: "한국어 카페 주문", class "Korean Test Class" join `PMDS35` (voice-only).
- Run `--stage=recon` to re-list assignment IDs if they change.

## Honest limits

Exploratory/dogfooding, not deterministic CI — the tutor's wording varies, so do not
assert exact responses. Pedagogy *correctness* still belongs to the text path +
backend unit tests. Each live run spends a Realtime session + TTS. Fast scripted
turns can interrupt the tutor mid-reply (`conversation.item.truncated`); wait for
`response.done` between turns if a clean transcript matters.

For full usage, flags, and the build/diagnosis history, read
**`e2e/voice-harness/README.md`**.
