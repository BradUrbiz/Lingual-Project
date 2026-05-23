# Free Practice Language Mix Design

## Goal

Let learners control the degree to which free-practice AI chat uses the target language vs English on a per-chat basis, while still allowing the tutor to adapt within bounded limits to the learner's actual language use during the session.

## Problem

Free-practice prompt language mix is currently embedded in the generic backend prompt template.

- The free-practice text and realtime chat routes build their system prompt from `build_system_prompt(...)`.
- That prompt currently hard-codes language-mix behavior by proficiency.
- There is no learner-facing control for how English-heavy or target-language-heavy free practice should be.
- Assignment-based school practice already has a dedicated language-mix knob, but free practice does not.

This creates two gaps:

1. Learners cannot intentionally choose a more English-supported or more immersive practice mode.
2. The tutor does not explicitly use the learner's current chat behavior as a bounded steering signal for language mix.

## Design

### Recommended approach

Add a per-chat `language_mix_level` setting to free-practice chat sessions and feed it into the free-practice prompt builder for both text and realtime voice.

The learner chooses one of five levels:

1. `english_first`
2. `english_led`
3. `balanced`
4. `target_led`
5. `target_only`

The selected level is not a hard lock except for near-strict `target_only`. It acts as a bounded adaptive bias:

- the selected level defines the allowed range of English vs target-language usage
- the learner's actual recent language use inside the conversation can steer the tutor within that range
- proficiency still determines complexity and difficulty, not the main language ratio

### Expected tutor behavior

- `english_first`: mostly English, introduces a few target-language words or short phrases
- `english_led`: English-heavy, but uses short target-language sentences and simple repetition / recast patterns
- `balanced`: mixes both languages regularly and can swing either way based on recent learner input
- `target_led`: mostly target language, brief English help when the learner stalls or keeps falling back to English
- `target_only`: target language almost exclusively; brief English only when the learner explicitly asks for translation or help

### Session scope

This is a free-practice chat-session setting, not a global profile setting.

- each `users/{uid}/chats/{chatId}` document stores its own `language_mix_level`
- new free-practice chats default to `balanced`
- reopening an existing chat restores its saved language-mix level
- assignment practice ignores this setting entirely

### Frontend UX

Add a compact selector to the free-practice chat header in `AppChatPage.tsx`, near the text / voice mode toggle.

Recommended UI behavior:

- show current session value at all times
- save immediately when changed
- when switching chats, load and display that chat's own saved level
- if voice is already connected and the learner changes the level, show a non-blocking notice such as `Reconnect voice to apply this language mix`

Use a dropdown rather than a five-button segmented control to avoid crowding the current header layout.

### Backend prompt policy

Refactor free-practice prompt assembly so `build_system_prompt(...)` accepts:

- `proficiency_context`
- `learning_locale`
- `language_mix_level`

The free-practice prompt should include an explicit language-policy section that tells the model to:

1. start from the selected language-mix level
2. observe whether the learner is currently using mostly English, mostly target language, or both
3. adapt somewhat toward the learner's language choice
4. never exceed the bounds of the selected level
5. keep proficiency-driven complexity independent from the language-mix choice

This is prompt-guided adaptation, not a separate deterministic language-ratio engine.

## Data Flow

### Chat persistence

Store `language_mix_level` directly on chat session documents in `database.py`.

New chat creation:

- `create_chat_session(...)` initializes `language_mix_level='balanced'`

Chat read APIs:

- `get_chat_sessions(...)` includes the current session value so the chat list / sidebar can remain session-aware if needed later
- `get_chat_session(...)` includes `language_mix_level` for the active chat view

Chat update API:

- add `PATCH /api/chats/<chat_id>/settings`
- current payload supports `languageMixLevel`
- validate enum values server-side
- normalize missing or invalid values to `balanced`

### Text free-practice flow

Text free-practice requests already go through `POST /api/chats/<chat_id>/messages`.

For non-assignment chats:

1. load the chat session
2. read `language_mix_level`
3. load `learning_locale` from the profile context
4. build the free-practice prompt with all three inputs:
   - proficiency
   - locale
   - language mix level
5. send the user message with recent chat history as context

### Realtime free-practice flow

Realtime voice already accepts session params from `AppChatPage` through `useRealtimeChat`.

For non-assignment chats:

1. include `chatId` in free-practice realtime session params
2. `POST /api/realtime/session` loads that chat session
3. read `language_mix_level`
4. load `learning_locale` from the profile context
5. build the free-practice prompt with:
   - proficiency
   - locale
   - language mix level
6. create the OpenAI realtime session with those instructions

Realtime instructions are fixed at connect time. Therefore:

- text mode changes apply on the next send
- realtime changes apply on the next reconnect
- do not auto-reconnect or hot-swap an in-progress voice session

## Files

- `main.py`
- `backend/routes/chat.py`
- `database.py`
- `frontend/src/pages/AppChatPage.tsx`
- `frontend/src/api/chat.ts`
- `frontend/src/hooks/useRealtimeChat.ts`
- `frontend/src/types/index.ts`
- `backend/tests/test_realtime_chat.py`
- frontend chat page / API tests as needed

## Safety And Constraints

- This setting applies only to free practice, not assignment practice.
- Existing assignment prompt assembly must remain untouched.
- Missing or invalid chat values must safely fall back to `balanced`.
- `target_only` is the only near-strict mode; other levels remain adaptive within bounds.
- v1 should not introduce a new backend analytics system for measuring English-vs-target-language ratios.
- Adaptation should come from prompt guidance and the model's view of recent turns, not a custom language-classification subsystem.

## Verification

### Backend tests

- add tests for free-practice prompt generation for all five language-mix levels
- add tests proving missing / invalid `language_mix_level` defaults to `balanced`
- add chat-route tests proving chat settings persist correctly
- add tests proving text free-practice reads session-level `language_mix_level`
- add realtime-session tests proving free-practice voice reads session-level `language_mix_level`
- add regression coverage proving assignment prompt behavior is unchanged

### Frontend tests

- add chat-header tests showing current session language mix
- add tests proving switching chats swaps the displayed level
- add tests proving changing the level persists it
- add tests proving active voice mode shows the reconnect-to-apply notice

### Commands

- `pytest backend/tests/test_realtime_chat.py -q`
- focused frontend chat tests for `AppChatPage`
- broader frontend test run if focused tests pass
