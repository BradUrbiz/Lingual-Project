# Pilot Avatar Disable Design

## Goal

Disable the avatar for the pilot runtime without deleting the existing avatar codepath.

## Design

- Frontend `/app/chat` forces avatar off even if `lingual:chat:avatarEnabled` was previously stored as `true`.
- Frontend no longer requests realtime avatar directives during the pilot.
- Backend hard-disables realtime avatar directives unless an explicit pilot avatar flag is enabled.
- Existing avatar components, routes, and assets remain in place but dormant for a later re-enable.

## Runtime gates

- Frontend: `VITE_ENABLE_PILOT_AVATAR` must be `true` before avatar can render.
- Backend: `ENABLE_PILOT_AVATAR` must be `true` before realtime avatar directives can be added.

Both flags default to disabled for the pilot.

## Files

- `frontend/src/pages/AppChatPage.tsx`
- `frontend/src/pages/AppChatPage.avatar.test.tsx`
- `backend/routes/chat.py`
- `backend/tests/test_realtime_chat.py`
- `docs/school-integration/LIMITATIONS.md`
