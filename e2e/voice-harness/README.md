# voice-harness

Type text → it's synthesized (TTS) and injected into Lingual's realtime voice
tutor **as live microphone input**. Lets you have a scripted spoken conversation
with the tutor without a real mic — for dogfooding and exploratory QA of the
voice path that headless tests otherwise can't reach.

## Why it's built this way

Lingual's voice tutor uses `getUserMedia` → WebRTC → OpenAI Realtime
(`frontend/src/hooks/useRealtimeChat.ts`). The naive "feed a WAV file" approach
(`--use-file-for-fake-audio-capture`) is read **once at browser launch**, so you
can't change what's spoken mid-call without restarting the browser and dropping
the WebRTC session.

Instead, `inject.js` overrides `getUserMedia` so the mic stream is a
`MediaStreamAudioDestinationNode` created **once** and kept live for the whole
session. Each utterance is decoded and played into that node → flows down the
live track → OpenAI. Between utterances the node emits digital silence, which is
exactly what `semantic_vad` needs to detect a turn boundary.

## Setup

```bash
cd e2e/voice-harness
npm install            # playwright-core only; uses your installed Google Chrome
```

Needs: Google Chrome, Node ≥ 18. OpenAI TTS reads `OPENAI_API_KEY` from your env
or the repo-root `.env`. macOS `say` (offline engine) needs no key.

## Verify the pipeline (no prod, no Realtime spend)

```bash
npm run selftest       # asserts injected audio reaches getUserMedia (uses `say`)
```

## Drive the real tutor

```bash
# Opens prod, logs in the test student. Then navigate to an assignment and click
# the mic to start voice — the browser is headed so you can drive it.
node harness.js --auto-login

# Once voice is connected, type lines in the terminal; each is spoken into the call:
speak> Hola, quiero un café con leche.
speak> ¿Cuánto cuesta?
speak> /shot cafe-turn   # screenshot
speak> /quit
```

Scripted run:

```bash
node harness.js --turns=turns.example.txt          # OpenAI TTS (default)
node harness.js --turns=turns.example.txt --engine=say   # free/offline
```

## Flags

| Flag | Default | Notes |
|------|---------|-------|
| `--url=<url>` | `https://l1ngual.com/login` | page to open |
| `--auto-login` | off | fills `STUDENT_EMAIL`/`STUDENT_PW` (defaults: test student) |
| `--engine=openai\|say` | `openai` | `say` = free, offline, robotic |
| `--voice=<name>` | `alloy` | OpenAI voice |
| `--gap=<ms>` | `700` | trailing silence after each utterance (VAD turn boundary) |
| `--headless` | off | headed by default so you can navigate/watch |
| `--self-test` | off | run the local injection check |

Test beds (from project notes): Korean Test Class (join `PMDS35`); Spanish
"Voice test - cafe scaffolded". Student: `teststudent@testing.com` / `lingual123`.

## Turn-commit: why `commitInput()` exists

Verified live against prod (Spanish café bed): the session uses `semantic_vad`
with `create_response: false` (`backend/routes/chat.py:371`). With our synthetic
mic, the server fires `input_audio_buffer.speech_started` and streams
`conversation.item.input_audio_transcription.delta` — but **never fires
`speech_stopped`**, so the turn never commits, `transcription.completed` never
fires, the app's `shouldRespondToRealtimeTurn` gate never runs, and the tutor
stays silent. A real mic emits ambient noise that lets semantic_vad detect the
pause; our trailing silence is digital-clean, so it doesn't.

`speak()` fixes this by sending `input_audio_buffer.commit` itself after each
utterance (`inject.js` → `window.__voiceHarness.commitInput()`, via the sniffed
realtime data channel). That closes the turn the way the server VAD would for a
real student; everything downstream (transcription, the response gate,
`response.create`) runs on the real app path. Proven: injected
"Quiero un café con leche, por favor." transcribed correctly and the tutor
replied "Claro, ¿algo más que te gustaría? Quizá una galleta…".

## Honest limits

- **Exploratory, not deterministic CI.** The tutor's wording varies, so you can't
  assert exact responses. Pedagogy *correctness* still belongs to the text path +
  backend unit tests; this harness proves audio→transcription→response *works* and
  lets you observe behavior.
- **Each live run spends** a Realtime session (per-minute) + TTS calls. Fine for
  manual QA; not for high-volume CI.
