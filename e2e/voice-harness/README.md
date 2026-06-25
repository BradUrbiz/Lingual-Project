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

## Honest limits

- **Exploratory, not deterministic CI.** The tutor's wording varies, so you can't
  assert exact responses. Pedagogy *correctness* still belongs to the text path +
  backend unit tests; this harness proves audio→transcription→response *works* and
  lets you observe behavior.
- **VAD turn-taking is the real flakiness source**, not injection. Synthetic
  silence between utterances helps, but barge-in/overlap timing is imperfect —
  inherent to testing a live realtime model.
- **Each live run spends** a Realtime session (per-minute) + TTS calls. Fine for
  manual QA; not for high-volume CI.
