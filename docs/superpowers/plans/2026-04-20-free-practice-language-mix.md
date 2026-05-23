# Free Practice Language Mix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-chat free-practice language-mix control that biases English vs target-language usage for both text and realtime voice, while allowing bounded adaptation to the learner's actual input language.

**Architecture:** Store a normalized `language_mix_level` on each free-practice chat session document, expose it through chat APIs, and thread it into the free-practice prompt builder for text and realtime routes. Keep assignment practice unchanged, use prompt-guided adaptation rather than a separate language-ratio engine, and make the frontend control session-scoped in the `AppChatPage` header.

**Tech Stack:** Flask, Firestore helper layer in `database.py`, OpenAI chat + realtime routes, React 19, TypeScript, Vitest, Python `unittest` / `pytest`

---

## File Structure

### Existing files to modify

- `main.py`
  - Expand free-practice prompt assembly to accept a normalized `language_mix_level`.
  - Add a dedicated helper for free-practice language-mix instructions so assignment policy remains separate.

- `database.py`
  - Persist `language_mix_level` on chat session documents.
  - Return it from chat read helpers.
  - Add a small chat-settings update helper.

- `backend/routes/chat.py`
  - Add a chat-settings update endpoint for `languageMixLevel`.
  - Read `language_mix_level` from free-practice chat sessions in both text and realtime routes.
  - Keep assignment flow untouched.

- `backend/tests/test_realtime_chat.py`
  - Add prompt and route coverage for free-practice `language_mix_level`.
  - Verify default normalization and route plumbing.

- `frontend/src/api/chat.ts`
  - Extend chat response types with `languageMixLevel`.
  - Add `updateChatSettings(...)`.

- `frontend/src/types/index.ts`
  - Add a shared `LanguageMixLevel` type plus chat-session fields carrying the saved setting.

- `frontend/src/pages/AppChatPage.tsx`
  - Load and display the active chat's language-mix level.
  - Save changes immediately.
  - Send `chatId` with free-practice realtime session params.
  - Show a reconnect notice when voice is already connected.

- `frontend/src/pages/AppChatPage.avatar.test.tsx`
  - Extend existing page coverage for session-specific language-mix loading and saving.

- `frontend/src/hooks/useRealtimeChat.ts`
  - No behavior change expected beyond carrying the existing `chatId` session param cleanly.
  - Touch only if typing requires it.

### Optional new focused files if needed

- `frontend/src/lib/languageMix.ts`
  - Shared labels / option metadata for the five language-mix levels if `AppChatPage.tsx` becomes too crowded.

### Files that must not change behavior

- `backend/services/assignment_resolver.py`
- assignment practice UI / tests under `frontend/src/components/assignments/*`
- assignment chat plumbing in `AssignmentPracticeWorkspace.tsx`

These should remain unaffected because the feature is free-practice-only.

## Chunk 1: Backend Data Model And Prompt Plumbing

### Task 1: Add normalized language-mix constants and helper coverage in `main.py`

**Files:**
- Modify: `main.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing backend prompt tests**

Add tests in `backend/tests/test_realtime_chat.py` for:

```python
def test_build_system_prompt_defaults_to_balanced_language_mix(self):
    prompt = main.build_system_prompt("Intermediate Mid", "es-ES")
    self.assertIn("balanced", prompt.lower())

def test_build_system_prompt_emits_target_only_policy(self):
    prompt = main.build_system_prompt("Intermediate Mid", "es-ES", "target_only")
    self.assertIn("explicitly asks for translation", prompt)

def test_build_system_prompt_normalizes_invalid_language_mix(self):
    prompt = main.build_system_prompt("Intermediate Mid", "es-ES", "invalid")
    self.assertIn("bounded by the selected language mix", prompt)
```

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL because `build_system_prompt(...)` does not yet accept `language_mix_level` and has no explicit language-mix policy section.

- [ ] **Step 3: Add normalized language-mix helper code**

Implement in `main.py`:

```python
FREE_PRACTICE_LANGUAGE_MIX_LEVELS = {
    "english_first",
    "english_led",
    "balanced",
    "target_led",
    "target_only",
}

def normalize_free_practice_language_mix_level(value: str | None) -> str:
    if value in FREE_PRACTICE_LANGUAGE_MIX_LEVELS:
        return value
    return "balanced"
```

Then split free-practice prompt language policy into a helper:

```python
def build_free_practice_language_mix_policy(language_name: str, language_mix_level: str) -> str:
    ...
```

Update:

```python
def build_system_prompt(proficiency_context, learning_locale='ko-KR', language_mix_level='balanced'):
    normalized_mix = normalize_free_practice_language_mix_level(language_mix_level)
    ...
```

The prompt policy text should explicitly instruct the model to:

- start from the selected level
- observe the learner's recent language choice
- adapt within the bounds of the selected level
- keep proficiency complexity independent from language-mix ratio

- [ ] **Step 4: Run the focused backend test to verify it passes**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS for the new prompt tests.

- [ ] **Step 5: Commit**

```bash
git add main.py backend/tests/test_realtime_chat.py
git commit -m "feat: add free practice language mix prompt policy"
```

## Chunk 2: Chat Session Persistence

### Task 2: Persist `language_mix_level` on chat session documents

**Files:**
- Modify: `database.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing persistence tests**

Add coverage for:

```python
def test_create_chat_session_defaults_language_mix_to_balanced(self):
    chat_id = db.create_chat_session("user-1")
    chat = db.get_chat_session("user-1", chat_id)
    self.assertEqual(chat["language_mix_level"], "balanced")

def test_get_chat_sessions_includes_language_mix_level(self):
    ...
    self.assertEqual(sessions[0]["language_mix_level"], "target_led")
```

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL because chat helpers do not yet store or return `language_mix_level`.

- [ ] **Step 3: Write minimal persistence changes**

In `database.py`:

- update `create_chat_session(...)` to write:

```python
"language_mix_level": "balanced",
```

- update `get_chat_sessions(...)` and `get_chat_session(...)` to return:

```python
"language_mix_level": normalize_free_practice_language_mix_level(
    data.get("language_mix_level")
),
```

- add a focused helper:

```python
def update_chat_settings(uid, chat_id, *, language_mix_level=None):
    updates = {"updated_at": firestore.SERVER_TIMESTAMP}
    if language_mix_level is not None:
        updates["language_mix_level"] = normalize_free_practice_language_mix_level(language_mix_level)
    get_chats_collection(uid).document(chat_id).update(updates)
```

Keep the helper narrow; do not generalize beyond the current setting.

- [ ] **Step 4: Run the focused backend test to verify it passes**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS for the new persistence assertions.

- [ ] **Step 5: Commit**

```bash
git add database.py backend/tests/test_realtime_chat.py
git commit -m "feat: persist free practice language mix on chats"
```

## Chunk 3: Backend Route Plumbing

### Task 3: Add chat settings update endpoint

**Files:**
- Modify: `backend/routes/chat.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing route test**

Add a test for:

```python
def test_patch_chat_settings_updates_language_mix_level(self):
    response = self.client.patch(
        f"/api/chats/{chat_id}/settings",
        json={"languageMixLevel": "english_led"},
    )
    self.assertEqual(response.status_code, 200)
    chat = self.fake_db.get_chat_session("user-1", chat_id)
    self.assertEqual(chat["language_mix_level"], "english_led")
```

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL with missing route / missing helper behavior.

- [ ] **Step 3: Implement the endpoint**

In `backend/routes/chat.py`, add:

```python
@bp.route('/api/chats/<chat_id>/settings', methods=['PATCH'])
@deps.login_required
def api_update_chat_settings(chat_id):
    uid = deps.get_current_user_uid()
    data = request.get_json() or {}
    chat = deps.db.get_chat_session(uid, chat_id)
    if not chat:
        return jsonify({'success': False, 'error': 'Chat not found'}), 404

    language_mix_level = data.get('languageMixLevel')
    deps.db.update_chat_settings(uid, chat_id, language_mix_level=language_mix_level)
    updated = deps.db.get_chat_session(uid, chat_id)
    return jsonify({'success': True, 'chat': updated})
```

Validate only the supported enum values through the normalization helper.

- [ ] **Step 4: Run the focused backend test to verify it passes**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS for the new settings route.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_realtime_chat.py
git commit -m "feat: add free practice chat language mix settings route"
```

### Task 4: Thread `language_mix_level` into free-practice text and realtime routes

**Files:**
- Modify: `backend/routes/chat.py`
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Write the failing route-plumbing tests**

Add tests that stub `build_system_prompt(...)` and assert the third argument:

```python
def test_realtime_session_uses_chat_language_mix_for_free_practice(self):
    ...
    self.assertEqual(captured["language_mix_level"], "target_led")

def test_text_chat_uses_chat_language_mix_for_free_practice(self):
    ...
    self.assertEqual(captured["language_mix_level"], "english_first")
```

Also add a regression asserting assignment routes do not read free-practice chat settings.

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: FAIL because routes still call `build_system_prompt(context, locale)` with only two args.

- [ ] **Step 3: Implement minimal route changes**

In free-practice branches only:

- realtime route:

```python
chat_id = payload.get("chatId")
chat = deps.db.get_chat_session(uid, chat_id) if isinstance(chat_id, str) and chat_id.strip() else None
language_mix_level = (chat or {}).get("language_mix_level", "balanced")
system_instructions = deps.build_system_prompt(proficiency_context, learning_locale, language_mix_level)
```

- text route:

```python
chat = deps.db.get_chat_session(uid, chat_id)
language_mix_level = chat.get("language_mix_level", "balanced")
system_prompt = deps.build_system_prompt(proficiency_context, learning_locale, language_mix_level)
```

Do not alter assignment prompt branches.

- [ ] **Step 4: Run the focused backend test to verify it passes**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS with explicit coverage for both free-practice routes.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_realtime_chat.py
git commit -m "feat: apply chat language mix to free practice routes"
```

## Chunk 4: Frontend Types And API Client

### Task 5: Add shared `LanguageMixLevel` types and chat API support

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/chat.ts`
- Test: `frontend/src/pages/AppChatPage.avatar.test.tsx`

- [ ] **Step 1: Write the failing frontend type / API usage test**

Extend the `AppChatPage.avatar.test.tsx` mock chat payloads so they include:

```ts
languageMixLevel: 'balanced'
```

and add a failing expectation that the page reflects the loaded value later in the header UI.

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: FAIL because chat session types and API return shapes do not yet include `languageMixLevel`.

- [ ] **Step 3: Add minimal type / API support**

In `frontend/src/types/index.ts` add:

```ts
export type LanguageMixLevel =
  | 'english_first'
  | 'english_led'
  | 'balanced'
  | 'target_led'
  | 'target_only';
```

Extend:

- `ChatSession`
- `ChatSessionDetail`

with:

```ts
languageMixLevel?: LanguageMixLevel;
```

In `frontend/src/api/chat.ts`:

- extend response types with `languageMixLevel`
- map backend `language_mix_level` / `languageMixLevel` to frontend `languageMixLevel`
- add:

```ts
export const updateChatSettings = async (
  chatId: string,
  settings: { languageMixLevel: LanguageMixLevel }
): Promise<ChatSessionDetail> => { ... }
```

- [ ] **Step 4: Run the focused frontend test to verify it passes up to the next missing UI step**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: still FAIL on missing UI control, but no longer fail on missing type/API wiring.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/chat.ts frontend/src/pages/AppChatPage.avatar.test.tsx
git commit -m "feat: add frontend chat language mix types"
```

## Chunk 5: Free-Practice Chat Header UI

### Task 6: Render and persist the per-chat language-mix control in `AppChatPage`

**Files:**
- Modify: `frontend/src/pages/AppChatPage.tsx`
- Modify: `frontend/src/pages/AppChatPage.avatar.test.tsx`
- Optional Create: `frontend/src/lib/languageMix.ts`

- [ ] **Step 1: Write the failing UI tests**

Add tests for:

```ts
it('shows the active chat language mix level')
it('switching chats updates the visible language mix level')
it('changing the language mix level saves it for the current chat')
```

Use existing `getChatSessionsMock`, `getChatSessionMock`, and add `updateChatSettingsMock`.

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: FAIL because the selector and save flow do not exist.

- [ ] **Step 3: Implement the minimal UI**

In `AppChatPage.tsx`:

- add local state:

```ts
const [languageMixLevel, setLanguageMixLevel] = useState<LanguageMixLevel>('balanced');
const [pendingLanguageMixLevel, setPendingLanguageMixLevel] = useState<LanguageMixLevel>('balanced');
const [languageMixNotice, setLanguageMixNotice] = useState<string | null>(null);
```

- when loading a chat, hydrate both values from `chat.languageMixLevel ?? 'balanced'`
- render a compact `<select>` in the header with the five levels
- on change:
  - optimistically set local state
  - call `updateChatSettings(currentChatId, { languageMixLevel: next })`
  - update the matching session in `sessions`
  - if realtime voice is connected, show `Reconnect voice to apply this language mix`

Keep the control only in free-practice `AppChatPage`, not in assignment chat surfaces.

- [ ] **Step 4: Run the focused frontend test to verify it passes**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: PASS for the new header behavior.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AppChatPage.tsx frontend/src/pages/AppChatPage.avatar.test.tsx
git commit -m "feat: add per-chat language mix control"
```

## Chunk 6: Realtime Session Parameter Wiring

### Task 7: Send `chatId` for free-practice realtime sessions and show reconnect notice

**Files:**
- Modify: `frontend/src/pages/AppChatPage.tsx`
- Modify: `frontend/src/hooks/useRealtimeChat.ts` (typing only if needed)
- Test: `frontend/src/pages/AppChatPage.avatar.test.tsx`

- [ ] **Step 1: Write the failing realtime-specific UI test**

Add a test like:

```ts
it('shows reconnect notice when language mix changes during active realtime mode')
```

Mock the realtime hook as connected and assert that the notice appears after changing the selector.

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: FAIL because no reconnect notice exists and `chatId` is not part of free-practice realtime session params.

- [ ] **Step 3: Implement minimal realtime wiring**

Update `realtimeSessionParams` in `AppChatPage.tsx`:

```ts
const realtimeSessionParams = useMemo(
  () => ({
    chatId: currentChatId,
    uiLanguage: lang,
    avatarDirectives: ...,
  }),
  [currentChatId, isAvatarEnabled, lang]
);
```

Ensure `useRealtimeChat` typing allows `chatId` to pass through unchanged.

When the language-mix dropdown changes while `isConnected` is true:

```ts
setLanguageMixNotice('Reconnect voice to apply this language mix.');
```

Do not disconnect automatically.

- [ ] **Step 4: Run the focused frontend test to verify it passes**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: PASS for the reconnect notice and session-param plumbing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AppChatPage.tsx frontend/src/hooks/useRealtimeChat.ts frontend/src/pages/AppChatPage.avatar.test.tsx
git commit -m "feat: wire chat language mix into realtime sessions"
```

## Chunk 7: End-To-End Verification

### Task 8: Run backend verification slice

**Files:**
- Test: `backend/tests/test_realtime_chat.py`

- [ ] **Step 1: Run the backend slice**

Run: `pytest backend/tests/test_realtime_chat.py -q`
Expected: PASS

- [ ] **Step 2: If a test fails, fix only the failing slice**

Stay within:

- `main.py`
- `database.py`
- `backend/routes/chat.py`
- `backend/tests/test_realtime_chat.py`

Do not broaden changes into assignment code unless a regression proves it is necessary.

- [ ] **Step 3: Commit any last backend-only fix**

```bash
git add main.py database.py backend/routes/chat.py backend/tests/test_realtime_chat.py
git commit -m "fix: stabilize free practice language mix backend tests"
```

### Task 9: Run frontend verification slice

**Files:**
- Test: `frontend/src/pages/AppChatPage.avatar.test.tsx`

- [ ] **Step 1: Run the focused chat page test**

Run: `npm test -- --run src/pages/AppChatPage.avatar.test.tsx`
Expected: PASS

- [ ] **Step 2: Run the full frontend suite**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: exit code 0

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: exit code 0

- [ ] **Step 5: Commit any final frontend-only fix**

```bash
git add frontend/src/pages/AppChatPage.tsx frontend/src/api/chat.ts frontend/src/types/index.ts frontend/src/pages/AppChatPage.avatar.test.tsx frontend/src/hooks/useRealtimeChat.ts
git commit -m "fix: stabilize free practice language mix frontend verification"
```

## Chunk 8: Final Review And Handoff

### Task 10: Confirm requirements against the approved spec

**Files:**
- Review: `docs/superpowers/specs/2026-04-20-free-practice-language-mix-design.md`
- Review: changed backend / frontend files

- [ ] **Step 1: Re-read the approved spec**

Confirm the implementation matches:

- per-chat session scope
- five language-mix levels
- bounded adaptive bias
- text applies next send
- realtime applies next reconnect
- assignment practice unchanged

- [ ] **Step 2: Check final diff for accidental scope creep**

Run:

```bash
git diff --stat
git diff -- main.py database.py backend/routes/chat.py backend/tests/test_realtime_chat.py frontend/src/api/chat.ts frontend/src/pages/AppChatPage.tsx frontend/src/pages/AppChatPage.avatar.test.tsx frontend/src/types/index.ts frontend/src/hooks/useRealtimeChat.ts
```

Expected: only free-practice chat language-mix changes.

- [ ] **Step 3: Prepare close-out notes**

Summarize:

- what changed
- what was verified
- that assignment practice was intentionally left untouched

- [ ] **Step 4: Final commit**

```bash
git add main.py database.py backend/routes/chat.py backend/tests/test_realtime_chat.py frontend/src/api/chat.ts frontend/src/pages/AppChatPage.tsx frontend/src/pages/AppChatPage.avatar.test.tsx frontend/src/types/index.ts frontend/src/hooks/useRealtimeChat.ts
git commit -m "feat: add per-chat free practice language mix"
```
