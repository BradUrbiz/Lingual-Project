# E2E Tests

Browser-based end-to-end tests using the Playwright CLI skill.

## Prerequisites

1. Backend running: `PORT=5001 FLASK_ENV=development python main.py`
2. Frontend running: `cd frontend && npm run dev`
3. Firebase credentials configured (`.env` with `GOOGLE_APPLICATION_CREDENTIALS`)

## Test harness

The backend exposes test-only endpoints when `FLASK_ENV=development`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/test/seed` | POST | Creates org, teacher, student, class, enrollment, mapping, assignment |
| `/api/test/login` | POST | Sets session without Firebase Auth. Body: `{ "uid": "e2e-teacher-1" }` |
| `/api/test/teardown` | POST | Cleans up test data. Body: `{ "orgId": "..." }` |
| `/api/test/session` | GET | Returns current session state |

## Running

Tests are run via the Playwright CLI skill in Claude Code. Each test file documents
the BDD scenarios it covers (from `docs/school-integration/BDD_SCENARIOS.md`).

## Test data

The seed endpoint creates:
- **Teacher**: `e2e-teacher-1` (roles: teacher + school_admin)
- **Student**: `e2e-student-1` (enrolled, minor with voice consent granted)
- **Admin**: `e2e-admin-1` (role: school_admin)
- **Class**: with join code, curriculum mapping, published assignment
