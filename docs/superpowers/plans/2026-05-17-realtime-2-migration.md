# Realtime 2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move Lingual voice sessions from the older Realtime session/SDP contract to the GA Realtime WebRTC flow using `gpt-realtime-2`.

**Architecture:** Preserve Lingual's existing two-step app contract so school compliance, assignment prompt bootstrap, and free-practice prompt generation remain backend-owned. The backend will mint GA client secrets through `/v1/realtime/client_secrets`, then proxy SDP offers to `/v1/realtime/calls` with the ephemeral token. The frontend keeps the same WebRTC lifecycle but stops sending a client-owned model name.

**Tech Stack:** Flask, `requests`, React 19, TypeScript, WebRTC, OpenAI Realtime GA API.

---

### Task 1: Backend GA Payload Contract

**Files:**
- Modify: `backend/tests/test_realtime_chat.py`
- Modify: `backend/routes/chat.py`

- [x] **Step 1: Write failing backend helper tests**

Update the existing realtime helper tests so `build_realtime_session_request('Base instructions')` is expected to return:

```python
payload['expires_after'] == {'anchor': 'created_at', 'seconds': 600}
payload['session']['type'] == 'realtime'
payload['session']['model'] == 'gpt-realtime-2'
payload['session']['reasoning'] == {'effort': 'low'}
payload['session']['output_modalities'] == ['audio']
payload['session']['audio']['input']['transcription']['model'] == 'gpt-4o-mini-transcribe-2025-12-15'
payload['session']['audio']['input']['turn_detection']['create_response'] is False
payload['session']['audio']['output']['voice'] == 'coral'
```

- [x] **Step 2: Run backend test and verify RED**

Run: `python3 -m unittest backend.tests.test_realtime_chat`
Expected: failure where tests still see the old top-level `model`, `voice`, `input_audio_transcription`, and `turn_detection` shape.

- [x] **Step 3: Implement nested GA session request**

Change `backend/routes/chat.py` so `build_realtime_session_request()` returns the `client_secrets` request body:

```python
{
    'expires_after': {'anchor': 'created_at', 'seconds': 600},
    'session': {
        'type': 'realtime',
        'model': REALTIME_MODEL,
        'instructions': guarded_instructions,
        'reasoning': {'effort': 'low'},
        'output_modalities': ['audio'],
        'audio': {
            'input': {
                'format': {'type': 'audio/pcm', 'rate': 24000},
                'transcription': input_audio_transcription,
                'turn_detection': {...},
            },
            'output': {
                'format': {'type': 'audio/pcm', 'rate': 24000},
                'voice': 'coral',
            },
        },
    },
}
```

- [x] **Step 4: Run backend test and verify GREEN for helper scope**

Run: `python3 -m unittest backend.tests.test_realtime_chat.RealtimeChatHelpersTestCase`
Expected: all helper tests pass.

### Task 2: Backend Route Migration

**Files:**
- Modify: `backend/tests/test_realtime_chat.py`
- Modify: `backend/routes/chat.py`

- [x] **Step 1: Write failing route tests**

Update route tests so `/api/realtime/session` posts to `https://api.openai.com/v1/realtime/client_secrets`, returns `data['value']`, `data['session']['id']`, and `data['expires_at']`, and sends `OpenAI-Safety-Identifier` without exposing the raw Firebase UID.

- [x] **Step 2: Update `/api/realtime/connect` test**

Expect the connect route to post SDP to `https://api.openai.com/v1/realtime/calls` with the ephemeral `clientSecret`, `Content-Type: application/sdp`, `Accept: application/sdp`, no `model` query parameter, and no frontend-controlled model trust boundary.

- [x] **Step 3: Run backend test and verify RED**

Run: `python3 -m unittest backend.tests.test_realtime_chat`
Expected: failures because the route still posts to `/realtime/sessions` and `/realtime`.

- [x] **Step 4: Implement route changes**

Change `create_realtime_session()` to call `/v1/realtime/client_secrets`, parse the GA response body, and attach a hashed user safety identifier header. Change `connect_realtime_session()` to call `/v1/realtime/calls` and ignore any client-supplied `model`.

- [x] **Step 5: Run backend tests and verify GREEN**

Run: `python3 -m unittest backend.tests.test_realtime_chat`
Expected: all tests in the file pass.

### Task 3: Frontend Hook Cleanup

**Files:**
- Modify: `frontend/src/hooks/useRealtimeChat.ts`
- Modify: `frontend/src/hooks/useRealtimeChat.test.tsx`

- [x] **Step 1: Write failing frontend assertion**

Update the hook test mock to assert `/realtime/connect` receives only:

```typescript
{
  offerSdp: 'mock-offer-sdp',
  clientSecret: 'test-client-secret',
}
```

- [x] **Step 2: Run frontend hook test and verify RED**

Run from `frontend/`: `npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: failure because the hook still sends `model`.

- [x] **Step 3: Remove frontend Realtime model constant and payload field**

Delete `REALTIME_MODEL` from `useRealtimeChat.ts` and remove `model: REALTIME_MODEL` from the connect request.

- [x] **Step 4: Run frontend hook test and verify GREEN**

Run from `frontend/`: `npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: all hook tests pass.

### Task 4: Final Verification

**Files:**
- Read: `git diff -- backend/routes/chat.py backend/tests/test_realtime_chat.py frontend/src/hooks/useRealtimeChat.ts frontend/src/hooks/useRealtimeChat.test.tsx docs/superpowers/plans/2026-05-17-realtime-2-migration.md`

- [x] **Step 1: Run backend route tests**

Run: `python3 -m unittest backend.tests.test_realtime_chat`
Expected: `Ran 27 tests` with `OK` and the known two skipped compliance tests.

- [x] **Step 2: Run frontend hook tests**

Run from `frontend/`: `npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: `3 tests` pass.

- [x] **Step 3: Review diff**

Confirm the only intended code paths changed are:
- backend Realtime session request body,
- backend OpenAI Realtime endpoint URLs and response parsing,
- frontend connect payload,
- targeted tests and this plan.
