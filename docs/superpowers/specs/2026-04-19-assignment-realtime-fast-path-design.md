# Assignment Realtime Fast Path Design

## Goal

Reduce assignment voice startup latency on `/api/realtime/session` without weakening fresh server-side access or consent enforcement.

## Problem

The current assignment realtime flow resolves the full assignment bootstrap on the launch page and then resolves it again inside `POST /api/realtime/session`. That second pass rebuilds assignment prompt context, rehydrates curriculum-shaped bootstrap data, and reruns launch policy just to create the OpenAI realtime session.

For assignment practice started from `AssignmentPracticeWorkspace`, the request already includes a `practiceSessionId`. That practice session already snapshots the assignment, mapping, curriculum, and pedagogy context needed for prompt assembly.

## Design

### Recommended approach

When `/api/realtime/session` receives both `assignmentId` and `practiceSessionId`:

1. Load the practice session and verify:
   - it exists
   - it belongs to the current student
   - it is still `active`
   - it is linked to the same assignment
2. Load the current assignment and class records only for fresh access enforcement.
3. Re-run current assignment access and current launch policy:
   - enrollment / published-state access
   - current compliance-driven voice permission
4. Build the system prompt from the practice session snapshot instead of re-running full `resolve_assignment_bootstrap_for_user(...)`.
5. Fall back to the existing full bootstrap path if the practice session snapshot is missing the fields needed for prompt reconstruction.

### Data model addition

Store these fields on newly created practice sessions:

- `system_prompt_preview`
- `class_snapshot`

This allows prompt reconstruction from session data while keeping current class/assignment access checks fresh.

### Backward compatibility

Older practice sessions will not have the new snapshot fields. For those sessions, the realtime route should keep the existing full-bootstrap fallback so no in-flight pilot data breaks.

## Safety boundary

This design preserves the important live checks:

- current assignment access
- current enrollment / publication status
- current consent / voice permission

It only removes duplicated prompt/bootstrap assembly work.

## Files

- `backend/routes/chat.py`
- `backend/services/assignment_resolver.py`
- `backend/services/practice_analytics.py`
- `backend/tests/test_realtime_chat.py`
- `database.py`

## Verification

- Add backend realtime-route tests proving the fast path skips full bootstrap when a valid `practiceSessionId` is present.
- Add backend realtime-route tests proving the fast path still blocks when current voice permission is revoked.
- Run `pytest backend/tests/test_realtime_chat.py -q`
- Run the broader relevant backend test slice if the focused test passes.
